import express from 'express';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Returns { value } or { error } for an item body. With partial=true, missing fields are allowed.
function validate(body, { partial = false } = {}) {
  const out = {};
  const b = body ?? {};

  if (b.name !== undefined || !partial) {
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    if (!name) return { error: 'Name is required.' };
    if (name.length > 100) return { error: 'Name must be 100 characters or fewer.' };
    out.name = name;
  }
  if (b.quantity !== undefined) {
    if (typeof b.quantity !== 'string' && typeof b.quantity !== 'number')
      return { error: 'Quantity must be text or a number.' };
    const q = String(b.quantity).trim();
    if (q.length > 50) return { error: 'Quantity must be 50 characters or fewer.' };
    out.quantity = q;
  } else if (!partial) {
    out.quantity = '';
  }
  if (b.expires_on !== undefined || !partial) {
    if (typeof b.expires_on !== 'string' || !isRealDate(b.expires_on))
      return { error: 'Expiry date must be a valid date (YYYY-MM-DD).' };
    out.expires_on = b.expires_on;
  }
  if (partial && Object.keys(out).length === 0) return { error: 'Nothing to update.' };
  return { value: out };
}

export function createApp(db) {
  const app = express();
  app.use(express.json({ limit: '10kb' }));

  const listItems = db.prepare('SELECT * FROM items ORDER BY expires_on ASC, name COLLATE NOCASE ASC, id ASC');
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const insertItem = db.prepare(
    'INSERT INTO items (name, quantity, expires_on) VALUES (@name, @quantity, @expires_on)'
  );
  const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');

  const parseId = (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid id.' });
      return null;
    }
    return id;
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
