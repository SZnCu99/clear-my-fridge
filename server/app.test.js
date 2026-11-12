import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDb, parseLegacyQuantity } from './db.js';
import { createApp } from './app.js';

let base, server;

const stop = () => {
  server?.closeAllConnections();
  server?.close();
};
after(stop);

beforeEach(async () => {
  stop();
  const app = createApp(openDb(':memory:'));
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

const req = (method, url, body) =>
  fetch(base + url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
const add = async (body) => (await req('POST', '/items', body)).json();

test('adds items and lists them soonest-expiring first', async () => {
  await add({ name: 'Yogurt', amount: 2, unit: 'pcs', expires_on: '2026-11-20' });
  await add({ name: 'Milk', amount: '1', unit: 'L', expires_on: '2026-11-14' });
  await add({ name: 'Cheese', expires_on: '2026-12-01' });
  const items = await (await req('GET', '/items')).json();
  assert.deepEqual(items.map((i) => i.name), ['Milk', 'Yogurt', 'Cheese']);
  assert.equal(items[0].amount, 1);
  assert.equal(items[0].unit, 'L');
  // amount and unit default to 1 pcs
  assert.equal(items[2].amount, 1);
  assert.equal(items[2].unit, 'pcs');
});

test('cleans up names', async () => {
  const item = await add({ name: '  Greek\t\tyogurt \n', expires_on: '2026-11-20' });
  assert.equal(item.name, 'Greek yogurt');
  const accented = await add({ name: 'Crème fraîche', expires_on: '2026-11-20' });
  assert.equal(accented.name, 'Crème fraîche');
});

test('rejects malformed input', async () => {
  for (const body of [
    { expires_on: '2026-11-20' },
    { name: '  ', expires_on: '2026-11-20' },
    { name: '!!!', expires_on: '2026-11-20' },
    { name: '1234', expires_on: '2026-11-20' },
    { name: 'x'.repeat(101), expires_on: '2026-11-20' },
    { name: 42, expires_on: '2026-11-20' },
    { name: 'Eggs' },
    { name: 'Eggs', expires_on: '2026-02-30' },
    { name: 'Eggs', expires_on: 'tomorrow' },
    { name: 'Eggs', amount: 0, expires_on: '2026-11-20' },
    { name: 'Eggs', amount: -2, expires_on: '2026-11-20' },
    { name: 'Eggs', amount: 'lots', expires_on: '2026-11-20' },
    { name: 'Eggs', amount: 1e9, expires_on: '2026-11-20' },
    { name: 'Eggs', amount: 6, unit: 'dozen', expires_on: '2026-11-20' },
  ]) {
    const res = await req('POST', '/items', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
  const res = await fetch(base + '/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});

test('edits (including the expiry date) and removes an item', async () => {
  const created = await add({ name: 'Eggs', amount: 6, unit: 'pcs', expires_on: '2026-11-25' });

  const patched = await req('PATCH', `/items/${created.id}`, { amount: 4, expires_on: '2027-02-01' });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.amount, 4);
  assert.equal(updated.expires_on, '2027-02-01');
  assert.equal(updated.name, 'Eggs');
  assert.equal((await req('PATCH', `/items/${created.id}`, { unit: 'cups' })).status, 400);

  assert.equal((await req('DELETE', `/items/${created.id}`)).status, 204);
  assert.equal((await req('DELETE', `/items/${created.id}`)).status, 404);
  assert.equal((await req('PATCH', `/items/${created.id}`, { amount: 1 })).status, 404);
  assert.deepEqual(await (await req('GET', '/items')).json(), []);
});

test('uses up part of an item', async () => {
  const milk = await add({ name: 'Milk', amount: 1, unit: 'L', expires_on: '2026-11-25' });
  const use = async (body) => req('POST', `/items/${milk.id}/use`, body);

  let res = await use({ fraction: 0.5 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).item.amount, 0.5);

  res = await use({ fraction: 1 / 3 });
  assert.equal((await res.json()).item.amount, 0.333);

  res = await use({ amount: 0.1 });
  assert.equal((await res.json()).item.amount, 0.233);

  assert.equal((await use({ amount: 5 })).status, 400); // more than is left
  assert.equal((await use({ fraction: 2 })).status, 400);
  assert.equal((await use({ fraction: 0 })).status, 400);
  assert.equal((await use({})).status, 400);

  res = await use({ amount: '0.233' });
  assert.deepEqual(await res.json(), { item: null });
  assert.deepEqual(await (await req('GET', '/items')).json(), []);
  assert.equal((await use({ all: true })).status, 404);
});

test('using all of an item removes it', async () => {
  const eggs = await add({ name: 'Eggs', amount: 6, expires_on: '2026-11-25' });
  const res = await req('POST', `/items/${eggs.id}/use`, { all: true });
  assert.deepEqual(await res.json(), { item: null });
  assert.deepEqual(await (await req('GET', '/items')).json(), []);
});

test('parses old free-text quantities', () => {
  assert.deepEqual(parseLegacyQuantity('500 g'), { amount: 500, unit: 'g' });
  assert.deepEqual(parseLegacyQuantity('1 L'), { amount: 1, unit: 'L' });
  assert.deepEqual(parseLegacyQuantity('1,5l'), { amount: 1.5, unit: 'L' });
  assert.deepEqual(parseLegacyQuantity('2 pots'), { amount: 2, unit: 'pcs' });
  assert.deepEqual(parseLegacyQuantity(''), { amount: 1, unit: 'pcs' });
  assert.deepEqual(parseLegacyQuantity('lots'), { amount: 1, unit: 'pcs' });
});

test('migrates a database from the first draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fridge-'));
  const file = path.join(dir, 'fridge.db');
  const old = new Database(file);
  old.exec(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '', expires_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO items (name, quantity, expires_on) VALUES ('Milk', '1 L', '2026-11-14'), ('Eggs', '', '2026-11-20');`);
  old.close();

  const db = openDb(file);
  const rows = db.prepare('SELECT name, amount, unit, expires_on FROM items ORDER BY id').all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { name: 'Milk', amount: 1, unit: 'L', expires_on: '2026-11-14' },
    { name: 'Eggs', amount: 1, unit: 'pcs', expires_on: '2026-11-20' },
  ]);
  db.close();
  // Opening again is a no-op
  openDb(file).close();
  fs.rmSync(dir, { recursive: true, force: true });
});
