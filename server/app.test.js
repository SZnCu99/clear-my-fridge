import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';
import { createApp } from './app.js';

let base, server;

const stop = () => { server?.closeAllConnections(); server?.close(); };
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

test('adds items and lists them soonest-expiring first', async () => {
  await req('POST', '/items', { name: 'Yogurt', quantity: '2 pots', expires_on: '2026-11-20' });
  await req('POST', '/items', { name: 'Milk', quantity: '1 L', expires_on: '2026-11-14' });
  await req('POST', '/items', { name: 'Cheese', expires_on: '2026-12-01' });
  const items = await (await req('GET', '/items')).json();
  assert.deepEqual(items.map((i) => i.name), ['Milk', 'Yogurt', 'Cheese']);
  assert.equal(items[2].quantity, '');
});

test('rejects bad input', async () => {
  for (const body of [
    { expires_on: '2026-11-20' },
    { name: '  ', expires_on: '2026-11-20' },
    { name: 'Eggs' },
    { name: 'Eggs', expires_on: '2026-02-30' },
    { name: 'Eggs', expires_on: 'tomorrow' },
  ]) {
    const res = await req('POST', '/items', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
  }
});

test('edits and removes an item', async () => {
  const created = await (await req('POST', '/items', { name: 'Eggs', quantity: 6, expires_on: '2026-11-25' })).json();
  assert.equal(created.quantity, '6');

  const patched = await req('PATCH', `/items/${created.id}`, { quantity: '4' });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.quantity, '4');
  assert.equal(updated.name, 'Eggs');

  assert.equal((await req('DELETE', `/items/${created.id}`)).status, 204);
  assert.equal((await req('DELETE', `/items/${created.id}`)).status, 404);
  assert.equal((await req('PATCH', `/items/${created.id}`, { quantity: '1' })).status, 404);
  assert.deepEqual(await (await req('GET', '/items')).json(), []);
});
