import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { geminiProvider, LlmError } from './gemini.js';
import { buildPrompt, parseRecipes, pickItems, MAX_ITEMS } from './suggest.js';

const TODAY = '2026-11-12';
let base, server, calls, reply;

const stop = () => {
  server?.closeAllConnections();
  server?.close();
};
after(stop);

// A fake model: records the prompt and returns whatever `reply` is (a string, an object, or an Error).
const generate = async (prompt) => {
  calls.push(prompt);
  if (reply instanceof Error) throw reply;
  return typeof reply === 'string' ? reply : JSON.stringify(reply);
};

async function start(options) {
  stop();
  calls = [];
  const app = createApp(openDb(':memory:'), options);
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
}
beforeEach(() => start({ generate, today: () => TODAY }));

const req = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const add = async (name, amount, unit, expires_on) => (await req('POST', '/items', { name, amount, unit, expires_on })).body;

async function stockFridge() {
  return {
    old: await add('Old ham', 100, 'g', '2026-11-10'), // expired
    chicken: await add('Chicken thighs', 500, 'g', '2026-11-13'),
    tomatoes: await add('Cherry tomatoes', 250, 'g', '2026-11-13'),
    eggs: await add('Eggs', 6, 'pcs', '2026-11-22'),
    rice: await add('Rice', 1, 'kg', '2027-09-01'),
  };
}

test('mode 1 sends every unexpired item, soonest first, with days left', async () => {
  const f = await stockFridge();
  reply = { recipes: [{ title: 'Omelette', minutes: 10, uses: [{ id: f.eggs.id, amount: 3 }], missing: [], steps: ['Whisk', 'Cook'] }] };
  const res = await req('POST', '/suggestions', {});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.item_ids, [f.tomatoes.id, f.chicken.id, f.eggs.id, f.rice.id]);

  const prompt = calls[0];
  assert.match(prompt, /Chicken thighs, 500 g, expires tomorrow/);
  assert.match(prompt, /Eggs, 6 pcs, expires in 10 days/);
  assert.doesNotMatch(prompt, /Old ham/);
  assert.match(prompt, /^Fridge items/m);

  const [omelette] = res.body.recipes;
  assert.equal(omelette.title, 'Omelette');
  assert.deepEqual(omelette.uses, [
    { id: f.eggs.id, name: 'Eggs', unit: 'pcs', amount: 3, expires_on: '2026-11-22', days_left: 10 },
  ]);
});

test('mode 2 sends only the picked items', async () => {
  const f = await stockFridge();
  reply = { recipes: [{ title: 'Egg fried rice', uses: [{ id: f.eggs.id, amount: 2 }, { id: f.rice.id, amount: 0.2 }], steps: ['Fry'] }] };
  const res = await req('POST', '/suggestions', { item_ids: [f.eggs.id, f.rice.id, f.old.id] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.item_ids, [f.eggs.id, f.rice.id]); // expired item never sent
  assert.match(calls[0], /picked these items/);
  assert.doesNotMatch(calls[0], /Chicken/);

  assert.equal((await req('POST', '/suggestions', { item_ids: [] })).status, 400);
  assert.equal((await req('POST', '/suggestions', { item_ids: ['x'] })).status, 400);
  assert.equal((await req('POST', '/suggestions', { item_ids: [9999] })).status, 400);
});

test('checks and ranks what the model sends back', async () => {
  const f = await stockFridge();
  reply = {
    recipes: [
      { title: 'Plain rice', uses: [{ id: f.rice.id, amount: 0.1 }], missing: [], steps: ['Boil'] },
      { title: 'Made-up', uses: [{ id: 9999, amount: 1 }], steps: ['?'] }, // id we never sent: dropped
      { title: 'Ham sandwich', uses: [{ id: f.old.id, amount: 50 }], steps: ['?'] }, // expired, not sent: dropped
      {
        title: 'Chicken traybake',
        minutes: 40,
        uses: [{ id: f.chicken.id, amount: 9000 }, { id: f.tomatoes.id }, { id: f.chicken.id, amount: 1 }],
        missing: ['Lemon'],
        steps: ['Roast'],
      },
    ],
  };
  const { status, body } = await req('POST', '/suggestions', {});
  assert.equal(status, 200);
  assert.deepEqual(body.recipes.map((r) => r.title), ['Chicken traybake', 'Plain rice']); // most expiring items first
  const tray = body.recipes[0];
  assert.deepEqual(tray.uses.map((u) => [u.name, u.amount]), [
    ['Chicken thighs', 500], // capped at what's there
    ['Cherry tomatoes', 250], // no amount given: all of it
  ]);
  assert.deepEqual(tray.missing, ['Lemon']);
});

test('reports unusable answers and Gemini errors clearly', async () => {
  await stockFridge();
  reply = 'not json';
  assert.equal((await req('POST', '/suggestions', {})).status, 502);
  reply = { recipes: [] };
  assert.equal((await req('POST', '/suggestions', {})).status, 502);
  reply = new LlmError('rate_limit', 'slow down');
  const limited = await req('POST', '/suggestions', {});
  assert.equal(limited.status, 429);
  assert.match(limited.body.error, /free Gemini limit/);
  reply = new LlmError('timeout', 'slow');
  assert.equal((await req('POST', '/suggestions', {})).status, 504);
});

test('suggestions are off without an API key, and need something in the fridge', async () => {
  assert.equal((await req('POST', '/suggestions', {})).status, 400); // empty fridge
  await start({ today: () => TODAY });
  await stockFridge();
  const res = await req('POST', '/suggestions', {});
  assert.equal(res.status, 503);
  assert.match(res.body.error, /GEMINI_API_KEY/);
});

test('cooking uses up several items at once, and undo puts them back', async () => {
  const f = await stockFridge();
  const cooked = await req('POST', '/cook', { uses: [{ id: f.chicken.id, amount: 500 }, { id: f.eggs.id, amount: 2 }] });
  assert.equal(cooked.status, 200);
  assert.deepEqual(cooked.body.items.map((i) => [i.name, i.amount]), [
    ['Old ham', 100],
    ['Cherry tomatoes', 250],
    ['Eggs', 4],
    ['Rice', 1],
  ]);
  assert.deepEqual(cooked.body.before.map((i) => i.id), [f.chicken.id, f.eggs.id]);

  const undone = await req('POST', '/items/restore', { items: cooked.body.before });
  assert.equal(undone.status, 200);
  const chicken = undone.body.find((i) => i.id === f.chicken.id);
  assert.equal(chicken.amount, 500);
  assert.equal(undone.body.find((i) => i.id === f.eggs.id).amount, 6);
});

test('cooking is all or nothing', async () => {
  const f = await stockFridge();
  const res = await req('POST', '/cook', { uses: [{ id: f.eggs.id, amount: 2 }, { id: 9999, amount: 1 }] });
  assert.equal(res.status, 409);
  const items = (await req('GET', '/items')).body;
  assert.equal(items.find((i) => i.id === f.eggs.id).amount, 6);

  assert.equal((await req('POST', '/cook', { uses: [] })).status, 400);
  assert.equal((await req('POST', '/cook', { uses: [{ id: f.eggs.id, amount: 0 }] })).status, 400);
  assert.equal((await req('POST', '/items/restore', { items: [{ id: 1, name: '' }] })).status, 400);
});

test('caps how many items are sent', () => {
  const items = Array.from({ length: 80 }, (_, i) => ({
    id: i + 1,
    name: `Item ${i + 1}`,
    amount: 1,
    unit: 'pcs',
    expires_on: '2026-12-01',
  }));
  assert.equal(pickItems(items, TODAY).length, MAX_ITEMS);
});

test('accepts JSON wrapped in a code fence', () => {
  const items = [{ id: 1, name: 'Eggs', amount: 6, unit: 'pcs', expires_on: '2026-11-20', days_left: 8 }];
  const text = '```json\n{"recipes":[{"title":"Boiled eggs","uses":[{"id":1,"amount":2}],"steps":["Boil"]}]}\n```';
  assert.equal(parseRecipes(text, items)[0].title, 'Boiled eggs');
  assert.match(buildPrompt(items), /id 1: Eggs, 6 pcs, expires in 8 days/);
});

test('the Gemini provider sends the key as a header and reads the text back', async () => {
  let seen;
  const fakeFetch = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"recipes":[]}' }] } }] }), { status: 200 });
  };
  const gen = geminiProvider({ apiKey: 'test-key', fetch: fakeFetch });
  assert.equal(await gen('hello'), '{"recipes":[]}');
  assert.match(seen.url, /models\/gemini-3\.1-flash-lite:generateContent$/);
  assert.doesNotMatch(seen.url, /test-key/); // never in the URL, where it could end up in logs
  assert.equal(seen.init.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.contents[0].parts[0].text, 'hello');

  const limited = geminiProvider({ apiKey: 'k', fetch: async () => new Response('{}', { status: 429 }) });
  await assert.rejects(limited('x'), (e) => e instanceof LlmError && e.kind === 'rate_limit');
  const badKey = geminiProvider({
    apiKey: 'k',
    fetch: async () => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 }),
  });
  await assert.rejects(badKey('x'), (e) => e.kind === 'auth');
});
