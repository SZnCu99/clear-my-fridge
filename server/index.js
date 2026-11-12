import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_PATH || path.join(root, 'data', 'fridge.db'));
const app = createApp(db);

// In production, serve the built PWA from dist/ (run `npm run build` first).
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, '0.0.0.0', () => {
  console.log(`clear-my-fridge API listening on http://localhost:${port}`);
});
