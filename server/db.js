import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack'];

// Schema versions (PRAGMA user_version):
//   0 → fresh database, or the first milestone-1 draft with a free-text `quantity` column
//   1 → `amount` (number) + `unit` (one of UNITS)
//   2 → `staples` (pantry staples the meal suggestions may assume) + `settings` (key/value)
const SCHEMA_VERSION = 2;

// What a new pantry starts with. The user edits this list in the app.
export const DEFAULT_STAPLES = ['Salt', 'Black pepper', 'Cooking oil'];

const CREATE_STAPLES = `
  CREATE TABLE staples (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const CREATE_ITEMS = `
  CREATE TABLE items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    amount     REAL    NOT NULL CHECK (amount > 0),
    unit       TEXT    NOT NULL,
    expires_on TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX items_expires_on ON items (expires_on);
`;

// Best-effort conversion of an old free-text quantity like "500 g", "1 L" or "2 pots".
export function parseLegacyQuantity(text) {
  const m = String(text ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)/);
  const amount = m ? Number(m[1].replace(',', '.')) : 1;
  const raw = (m?.[2] ?? '').toLowerCase();
  const unit =
    { g: 'g', kg: 'kg', ml: 'ml', l: 'L', pack: 'pack', packs: 'pack' }[raw] ?? 'pcs';
  return { amount: amount > 0 ? amount : 1, unit };
}

function migrate(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version >= SCHEMA_VERSION) return;

  db.transaction(() => {
    if (version < 1) migrateItems(db);
    if (version < 2) {
      db.exec(CREATE_STAPLES);
      const insert = db.prepare('INSERT INTO staples (name) VALUES (?)');
      for (const name of DEFAULT_STAPLES) insert.run(name);
    }
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  })();
}

function migrateItems(db) {
  const cols = db.prepare("SELECT name FROM pragma_table_info('items')").all().map((c) => c.name);
  if (cols.length === 0) {
    db.exec(CREATE_ITEMS);
  } else if (cols.includes('quantity')) {
    const old = db.prepare('SELECT * FROM items').all();
    db.exec('DROP INDEX IF EXISTS items_expires_on; ALTER TABLE items RENAME TO items_old;');
    db.exec(CREATE_ITEMS);
    const insert = db.prepare(
      `INSERT INTO items (id, name, amount, unit, expires_on, created_at, updated_at)
       VALUES (@id, @name, @amount, @unit, @expires_on, @created_at, @updated_at)`
    );
    for (const row of old) insert.run({ ...row, ...parseLegacyQuantity(row.quantity) });
    db.exec('DROP TABLE items_old;');
  }
}

export function openDb(file = process.env.DB_PATH || 'data/fridge.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}
