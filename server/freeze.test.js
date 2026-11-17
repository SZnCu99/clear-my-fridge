import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { LlmError } from './gemini.js';
import { addMonths, buildFreezePrompt, curatedTips, parseFreezeTips } from './freeze.js';

const TODAY = '2026-11-17';
let base, server, calls, reply;

const stop = () => {
  server?.closeAllConnections();
  server?.close();
};
after(stop);

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
const add = async (body) => (await req('POST', '/items', { amount: 1, unit: 'pcs', ...body })).body;

const GOOD = {
  freezable: true,
  steps: ['Slice it', 'Bag it and press out the air', 'Label it'],
  keeps_months: 3,
  thaw: 'Toast from frozen.',
  tip: '',
};

test('freeze tips come from the model and are cached by name', async () => {
  reply = GOOD;
  const bread = await add({ name: 'Sourdough bread', expires_on: '2026-11-18' });
  const r = await req('POST', `/items/${bread.id}/freeze-tips`);
  assert.equal(r.status, 200);
  assert.equal(r.body.source, 'ai');
  assert.deepEqual(r.body.tips, GOOD);
  assert.match(calls[0], /Sourdough bread/);

  const again = await req('POST', `/items/${bread.id}/freeze-tips`);
  assert.deepEqual(again.body.tips, GOOD);
  assert.equal(calls.length, 1);
});

test('freeze tips fall back to the built-in list when the model fails or is off', async () => {
  const mince = await add({ name: 'Beef mince', amount: 500, unit: 'g', expires_on: '2026-11-18' });
  for (const bad of [new LlmError('rate_limit', 'limit'), 'not json', { steps: [] }]) {
    reply = bad;
    const r = await req('POST', `/items/${mince.id}/freeze-tips`);
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'builtin');
    assert.equal(r.body.tips.freezable, true);
    assert.match(r.body.tips.steps.join(' '), /air/);
  }

  await start({ generate: null, today: () => TODAY });
  const salad = await add({ name: 'Lettuce', expires_on: '2026-11-18' });
  const r = await req('POST', `/items/${salad.id}/freeze-tips`);
  assert.equal(r.body.source, 'builtin');
  assert.equal(r.body.tips.freezable, false);
  assert.equal((await req('POST', '/items/999/freeze-tips')).status, 404);
});

test('"I froze it" marks the item frozen and pushes the expiry out, with undo', async () => {
  const milk = await add({ name: 'Milk', unit: 'L', expires_on: '2026-11-18' });
  assert.equal(milk.frozen_on, null);

  const r = await req('POST', `/items/${milk.id}/freeze`, { months: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.item.frozen_on, TODAY);
  assert.equal(r.body.item.expires_on, '2027-01-17');
  assert.equal(r.body.before.expires_on, '2026-11-18');

  assert.equal((await req('POST', `/items/${milk.id}/freeze`)).status, 409);

  const restored = await req('POST', '/items/restore', { items: [r.body.before] });
  assert.equal(restored.status, 200);
  assert.equal(restored.body[0].frozen_on, null);
  assert.equal(restored.body[0].expires_on, '2026-11-18');

  // Defaults to 3 months
  const again = await req('POST', `/items/${milk.id}/freeze`, {});
  assert.equal(again.body.item.expires_on, '2027-02-17');
});

test('rejects bad freeze input', async () => {
  const eggs = await add({ name: 'Eggs', expires_on: '2026-11-18' });
  for (const months of [0, 13, 1.5, '3']) {
    assert.equal((await req('POST', `/items/${eggs.id}/freeze`, { months })).status, 400, String(months));
  }
  assert.equal((await req('POST', '/items/999/freeze', {})).status, 404);
  assert.equal((await req('POST', '/items', { name: 'Peas', expires_on: '2026-11-18', frozen_on: 'yesterday' })).status, 400);
});

test('unfreezing by editing frozen_on back to null', async () => {
  const peas = await add({ name: 'Peas', expires_on: '2027-03-01', frozen_on: '2026-11-01' });
  assert.equal(peas.frozen_on, '2026-11-01');
  const r = await req('PATCH', `/items/${peas.id}`, { frozen_on: null });
  assert.equal(r.body.frozen_on, null);
});

test('migrates a version-1 database by adding frozen_on', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-')), 'v1.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL,
    unit TEXT NOT NULL, expires_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO items (name, amount, unit, expires_on) VALUES ('Ham', 200, 'g', '2026-11-20');`);
  old.pragma('user_version = 1');
  old.close();

  const db = openDb(file);
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(db.prepare('SELECT name, frozen_on FROM items').all(), [{ name: 'Ham', frozen_on: null }]);
  db.close();
});

test('migrates a version-2 pantry database: keeps its staples and adds frozen_on', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-')), 'v2.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL,
    unit TEXT NOT NULL, expires_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE staples (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO staples (name) VALUES ('Soy sauce');
    INSERT INTO items (name, amount, unit, expires_on) VALUES ('Tofu', 1, 'pack', '2026-11-20');`);
  old.pragma('user_version = 2');
  old.close();

  const db = openDb(file);
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(db.prepare('SELECT name FROM staples').all(), [{ name: 'Soy sauce' }]);
  assert.deepEqual(db.prepare('SELECT name, frozen_on FROM items').all(), [{ name: 'Tofu', frozen_on: null }]);
  db.close();
});

test('helpers', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-17', 3), '2027-02-17');
  assert.equal(addMonths('2026-12-05', 12), '2027-12-05');

  assert.equal(curatedTips('Fresh basil').keeps_months, 6);
  assert.equal(curatedTips('Mystery tub').keeps_months, 3);
  assert.equal(curatedTips('Free range eggs').steps[0].includes('shells'), true);

  const p = buildFreezePrompt({ name: 'Spinach', amount: 200, unit: 'g' });
  assert.match(p, /"Spinach" \(200 g\)/);

  const t = parseFreezeTips('```json\n{"freezable":false,"steps":["Eat it today"],"keeps_months":40,"thaw":"","tip":""}\n```');
  assert.equal(t.freezable, false);
  assert.equal(t.keeps_months, 12);
  assert.throws(() => parseFreezeTips('{"steps":[]}'));
});
