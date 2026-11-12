# clear-my-fridge

Keep track of what's in your fridge and use things up before they expire.

**Milestone 1** is a fridge list you can open on your phone:

- Add an item with a name, an amount and unit (pcs, g, kg, ml, L, pack) and an expiry date (with quick "Today / +3 days / +1 week" buttons)
- Everything is sorted by what expires first; items expiring within 2 days are amber and expired items are red
- Tap an item to edit it, including its expiry date (handy if you froze it)
- Tap **Use** to use up ½, ⅓ or ¼ of what's left, a specific amount, or all of it (with an Undo). An item disappears once it's all used
- Names are tidied (extra spaces removed) and must contain at least one letter
- Data is saved in SQLite (`data/fridge.db`), so it survives a refresh or restart

Stack: React + Vite + Tailwind (installable PWA) and Node + Express + better-sqlite3.

## Run it

Needs Node 20 or newer.

```sh
npm install
npm run dev
```

This starts the API on port 3001 and the app on http://localhost:5173. To open it on your phone,
connect to the same Wi-Fi and visit `http://<your-computer's-IP>:5173` (Vite prints the address).

### Production build

```sh
npm run build
npm start
```

Express serves the built app and the API together on http://localhost:3001 (set `PORT` to change it,
and `DB_PATH` to put the database somewhere else).

Note: browsers only offer "Install app" and offline support over HTTPS or on `localhost`. Over plain
`http://` on your local network the app works fine, but it will be a home-screen shortcut rather than
a full install until it's served over HTTPS.

## API

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/items` | – (sorted by `expires_on`) |
| POST | `/api/items` | `{ name, amount? (default 1), unit? (default "pcs"), expires_on: "YYYY-MM-DD" }` |
| PATCH | `/api/items/:id` | any of `name`, `amount`, `unit`, `expires_on` |
| POST | `/api/items/:id/use` | `{ all: true }`, `{ fraction: 0.5 }` or `{ amount: 200 }`; returns `{ item }`, `null` once it's all used |
| DELETE | `/api/items/:id` | – |

If your database is from the first draft (free-text quantity), it's converted automatically on start-up:
"500 g" becomes 500 g, and anything that can't be read becomes 1 pcs.

## Tests

```sh
npm test
```
