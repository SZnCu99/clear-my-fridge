import express from 'express';
import { UNITS } from './db.js';
import { LlmError } from './gemini.js';
import { buildPrompt, localISO, parseRecipes, pickItems } from './suggest.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AMOUNT = 100000;
// Anything at or below this after using some up counts as gone.
const EPSILON = 0.001;

const round3 = (n) => Math.round(n * 1000) / 1000;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Accepts a number or a numeric string ("1.5", "1,5"). Returns a number or NaN.
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) return Number(v.trim().replace(',', '.'));
  return NaN;
}

export function cleanName(v) {
  if (typeof v !== 'string') return { error: 'Name is required.' };
  const name = v.normalize('NFC').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) return { error: 'Name is required.' };
  if (name.length > 100) return { error: 'Name must be 100 characters or fewer.' };
  if (!/\p{L}/u.test(name)) return { error: 'Name needs at least one letter.' };
  return { value: name };
}

function cleanAmount(v) {
  const n = toNumber(v);
  if (!Number.isFinite(n) || n <= 0) return { error: 'Amount must be a number greater than 0.' };
  if (n > MAX_AMOUNT) return { error: `Amount must be ${MAX_AMOUNT} or less.` };
  return { value: round3(n) };
}

// Returns { value } or { error } for an item body. With partial=true, missing fields are allowed.
function validate(body, { partial = false } = {}) {
  const out = {};
  const b = body && typeof body === 'object' ? body : {};

  if (b.name !== undefined || !partial) {
    const r = cleanName(b.name);
    if (r.error) return r;
    out.name = r.value;
  }
  if (b.amount !== undefined || !partial) {
    const r = cleanAmount(b.amount ?? 1);
    if (r.error) return r;
    out.amount = r.value;
  }
  if (b.unit !== undefined || !partial) {
    const unit = b.unit ?? 'pcs';
    if (!UNITS.includes(unit)) return { error: `Unit must be one of: ${UNITS.join(', ')}.` };
    out.unit = unit;
  }
  if (b.expires_on !== undefined || !partial) {
    if (typeof b.expires_on !== 'string' || !isRealDate(b.expires_on))
      return { error: 'Expiry date must be a valid date (YYYY-MM-DD).' };
    out.expires_on = b.expires_on;
  }
  if (partial && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

const LLM_ERRORS = {
  rate_limit: [429, 'The free Gemini limit has been reached for now. Try again in a minute.'],
  auth: [502, 'Gemini rejected the API key. Check GEMINI_API_KEY in .env.'],
  timeout: [504, 'Gemini took too long to answer. Try again.'],
};

// options.generate: (prompt) => Promise<string>, see gemini.js. Without it, suggestions are off.
// options.today: () => 'YYYY-MM-DD' (local date), overridable for tests.
export function createApp(db, { generate = null, today = () => localISO() } = {}) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  const listItems = db.prepare('SELECT * FROM items ORDER BY expires_on ASC, name COLLATE NOCASE ASC, id ASC');
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const insertItem = db.prepare(
    'INSERT INTO items (name, amount, unit, expires_on) VALUES (@name, @amount, @unit, @expires_on)'
  );
  const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
  const setAmount = db.prepare("UPDATE items SET amount = ?, updated_at = datetime('now') WHERE id = ?");

  // Use up part (or all) of an item. Returns { item } (null if it's all gone) or { error, status }.
  const useItem = db.transaction((id, body) => {
    const item = getItem.get(id);
    if (!item) return { status: 404, error: 'Item not found.' };
    const b = body && typeof body === 'object' ? body : {};

    let used;
    if (b.all === true) {
      used = item.amount;
    } else if (b.fraction !== undefined) {
      const f = toNumber(b.fraction);
      if (!Number.isFinite(f) || f <= 0 || f > 1) return { status: 400, error: 'Fraction must be between 0 and 1.' };
      used = item.amount * f;
    } else if (b.amount !== undefined) {
      const r = cleanAmount(b.amount);
      if (r.error) return { status: 400, error: r.error };
      if (r.value > item.amount + EPSILON)
        return { status: 400, error: `Only ${item.amount} ${item.unit} left.` };
      used = r.value;
    } else {
      return { status: 400, error: 'Say how much was used: all, fraction or amount.' };
    }

    const left = round3(item.amount - used);
    if (left <= EPSILON) {
      deleteItem.run(id);
      return { item: null };
    }
    setAmount.run(left, id);
    return { item: getItem.get(id) };
  });

  // Cook a recipe: use up several items at once. All or nothing.
  // Throwing inside a better-sqlite3 transaction rolls it back.
  const cookTx = db.transaction((uses) => {
    const before = [];
    for (const u of uses) {
      const item = getItem.get(u.id);
      if (!item) throw Object.assign(new Error('Some of these items are no longer in your fridge. Refresh and try again.'), { status: 409 });
      before.push(item);
      const r = useItem(item.id, u.amount >= item.amount - EPSILON ? { all: true } : { amount: u.amount });
      if (r.error) throw Object.assign(new Error(r.error), { status: r.status });
    }
    return before;
  });
  const cook = (uses) => {
    try {
      return { before: cookTx(uses) };
    } catch (e) {
      if (e.status) return { status: e.status, error: e.message };
      throw e;
    }
  };

  // Put items back exactly as they were (used by Undo after cooking).
  const upsertItem = db.prepare(
    `INSERT INTO items (id, name, amount, unit, expires_on) VALUES (@id, @name, @amount, @unit, @expires_on)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, amount = excluded.amount, unit = excluded.unit,
       expires_on = excluded.expires_on, updated_at = datetime('now')`
  );
  const restore = db.transaction((rows) => {
    for (const row of rows) upsertItem.run(row);
  });

  const parseId = (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id.' });
      return null;
    }
    return id;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/units', (_req, res) => res.json(UNITS));

  app.get('/api/items', (_req, res) => res.json(listItems.all()));

  app.post('/api/items', (req, res) => {
    const { value, error } = validate(req.body);
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = insertItem.run(value);
    res.status(201).json(getItem.get(lastInsertRowid));
  });

  app.patch('/api/items/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const { value, error } = validate(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const cols = Object.keys(value);
    const sql = `UPDATE items SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @id`;
    const { changes } = db.prepare(sql).run({ ...value, id });
    if (!changes) return res.status(404).json({ error: 'Item not found.' });
    res.json(getItem.get(id));
  });

  app.post('/api/items/:id/use', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const result = useItem(id, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ item: result.item });
  });

  app.post('/api/items/restore', (req, res) => {
    const rows = req.body?.items;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100)
      return res.status(400).json({ error: 'Send the items to restore.' });
    const clean = [];
    for (const row of rows) {
      const id = Number(row?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
      const { value, error } = validate(row);
      if (error) return res.status(400).json({ error });
      clean.push({ ...value, id });
    }
    restore(clean);
    res.json(listItems.all());
  });

  app.post('/api/cook', (req, res) => {
    const raw = req.body?.uses;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100)
      return res.status(400).json({ error: 'Say which items the recipe uses.' });
    const uses = [];
    for (const u of raw) {
      const id = Number(u?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id.' });
      const amount = toNumber(u.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Amount must be a number greater than 0.' });
      uses.push({ id, amount: round3(amount) });
    }
    const result = cook(uses);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ before: result.before, items: listItems.all() });
  });

  // Meal suggestions. Body: {} for the whole fridge, or { item_ids: [...] } to cook with only those.
  app.post('/api/suggestions', async (req, res, next) => {
    if (!generate)
      return res.status(503).json({ error: 'Meal suggestions are off. Add GEMINI_API_KEY to .env and restart the server.' });

    let ids;
    if (req.body?.item_ids !== undefined) {
      if (!Array.isArray(req.body.item_ids) || !req.body.item_ids.every((n) => Number.isInteger(n) && n > 0))
        return res.status(400).json({ error: 'item_ids must be a list of item ids.' });
      ids = req.body.item_ids;
      if (ids.length === 0) return res.status(400).json({ error: 'Pick at least one ingredient.' });
    }
    const items = pickItems(listItems.all(), today(), ids);
    if (items.length === 0)
      return res.status(400).json({ error: ids ? 'None of those items are in your fridge any more.' : 'Add some unexpired items to your fridge first.' });

    try {
      const text = await generate(buildPrompt(items, { selected: Boolean(ids) }));
      let recipes;
      try {
        recipes = parseRecipes(text, items);
      } catch (e) {
        console.error('Unusable suggestions:', e.message);
        return res.status(502).json({ error: "The suggestions didn't come back in a usable form. Try again." });
      }
      res.json({ recipes, item_ids: items.map((i) => i.id) });
    } catch (e) {
      if (!(e instanceof LlmError)) return next(e);
      console.error('Gemini:', e.message);
      const [status, message] = LLM_ERRORS[e.kind] ?? [502, "Couldn't get suggestions right now. Try again."];
      res.status(status).json({ error: message });
    }
  });

  app.delete('/api/items/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === null) return;
    const { changes } = deleteItem.run(id);
    if (!changes) return res.status(404).json({ error: 'Item not found.' });
    res.status(204).end();
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  // Malformed JSON and other errors
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}
