import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { geminiProvider } from './gemini.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (GEMINI_API_KEY etc.) if there is one. Variables already set in the environment win.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const db = openDb(process.env.DB_PATH || path.join(root, 'data', 'fridge.db'));
const apiKey = process.env.GEMINI_API_KEY?.trim();
const hasKey = Boolean(apiKey) && apiKey !== 'your-gemini-api-key-here';
const generate = hasKey ? geminiProvider({ apiKey, model: process.env.GEMINI_MODEL || undefined }) : null;
if (!generate) console.warn('GEMINI_API_KEY is not set in .env, so meal suggestions are off.');
const app = createApp(db, { generate });

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
