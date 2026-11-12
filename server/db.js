import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file = process.env.DB_PATH || 'data/fridge.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      quantity   TEXT    NOT NULL DEFAULT '',
      expires_on TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS items_expires_on ON items (expires_on);
  `);
  return db;
}
