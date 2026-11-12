import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { expiryLabel, expiryStatus, formatDate, todayISO } from './dates.js';

const byExpiry = (a, b) =>
  a.expires_on.localeCompare(b.expires_on) ||
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
  a.id - b.id;

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none';

export default function App() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef();

  useEffect(() => {
    api.list().then(setItems).catch((e) => setError(e.message));
  }, []);

  const run = async (fn) => {
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      throw e;
    }
  };

  const add = (item) =>
    run(async () => {
      const created = await api.create(item);
      setItems((xs) => [...xs, created].sort(byExpiry));
    });

  const save = (id, changes) =>
    run(async () => {
      const updated = await api.update(id, changes);
      setItems((xs) => xs.map((x) => (x.id === id ? updated : x)).sort(byExpiry));
    });

  const remove = (item) =>
    run(async () => {
      await api.remove(item.id);
      setItems((xs) => xs.filter((x) => x.id !== item.id));
      clearTimeout(undoTimer.current);
      setUndo(item);
      undoTimer.current = setTimeout(() => setUndo(null), 6000);
    }).catch(() => {});

  const restore = () => {
    const item = undo;
    setUndo(null);
    clearTimeout(undoTimer.current);
    add({ name: item.name, quantity: item.quantity, expires_on: item.expires_on }).catch(() => {});
  };

  const expired = items?.filter((i) => expiryStatus(i.expires_on) === 'expired').length ?? 0;
  const soon = items?.filter((i) => expiryStatus(i.expires_on) === 'soon').length ?? 0;

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-teal-800">Clear My Fridge</h1>
        {items && items.length > 0 && (
          <p className="mt-1 text-sm text-slate-600">
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {soon > 0 && <span className="font-medium text-amber-700"> · {soon} expiring soon</span>}
            {expired > 0 && <span className="font-medium text-red-700"> · {expired} expired</span>}
          </p>
        )}
      </header>

      <AddForm onAdd={add} />

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="mt-6" aria-label="Fridge items">
        {items === null && !error && <p className="text-slate-500">Loading…</p>}
        {items?.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500">
            Your fridge list is empty. Add something above.
          </p>
        )}
        <ul className="space-y-2">
          {items?.map((item) => (
            <ItemRow key={item.id} item={item} onSave={save} onRemove={remove} />
          ))}
        </ul>
      </section>

      {undo && (
        <div className="fixed inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
            <span className="truncate">Removed {undo.name}</span>
            <button onClick={restore} className="shrink-0 font-semibold text-teal-300">
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddForm({ onAdd }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onAdd({ name, quantity, expires_on: expiresOn });
      setName('');
      setQuantity('');
      setExpiresOn('');
      nameRef.current?.focus();
    } catch {
      // error is shown by the parent
    } finally {
      setBusy(false);
    }
  };

  const quick = [
    ['Today', 0],
    ['+3 days', 3],
    ['+1 week', 7],
  ];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Item</span>
          <input
            ref={nameRef}
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Milk"
            maxLength={100}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Quantity</span>
          <input
            className={inputClass}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1 L"
            maxLength={50}
          />
        </label>
      </div>
      <div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Expires on</span>
          <input
            type="date"
            className={inputClass}
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            required
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {quick.map(([label, days]) => (
            <button
              key={label}
              type="button"
              onClick={() => setExpiresOn(todayISO(days))}
              className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700 hover:bg-slate-200"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
      >
        Add to fridge
      </button>
    </form>
  );
}

const statusStyles = {
  expired: { row: 'bg-red-50 ring-red-200', badge: 'bg-red-100 text-red-800' },
  soon: { row: 'bg-amber-50 ring-amber-200', badge: 'bg-amber-100 text-amber-900' },
  ok: { row: 'bg-white ring-slate-200', badge: 'bg-slate-100 text-slate-600' },
};

function ItemRow({ item, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const status = expiryStatus(item.expires_on);
  const s = statusStyles[status];

  const startEdit = () => {
    setDraft(item);
    setEditing(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      await onSave(item.id, { name: draft.name, quantity: draft.quantity, expires_on: draft.expires_on });
      setEditing(false);
    } catch {
      // error is shown by the parent
    }
  };

  if (editing) {
    return (
      <li className="rounded-xl bg-white p-3 shadow-sm ring-2 ring-teal-600">
        <form onSubmit={submit} className="space-y-2">
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <input
              aria-label="Item"
              className={inputClass}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={100}
              required
              autoFocus
            />
            <input
              aria-label="Quantity"
              className={inputClass}
              value={draft.quantity}
              onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
              maxLength={50}
            />
          </div>
          <input
            aria-label="Expires on"
            type="date"
            className={inputClass}
            value={draft.expires_on}
            onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800">
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex-1 rounded-lg bg-slate-100 px-3 py-2 font-medium text-slate-700 hover:bg-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className={`flex items-center gap-3 rounded-xl p-3 shadow-sm ring-1 ${s.row}`}>
      <button onClick={startEdit} className="min-w-0 flex-1 text-left" aria-label={`Edit ${item.name}`}>
        <div className="flex items-baseline gap-2">
          <span className="truncate font-semibold">{item.name}</span>
          {item.quantity && <span className="shrink-0 text-sm text-slate-500">{item.quantity}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2 py-0.5 font-medium ${s.badge}`}>{expiryLabel(item.expires_on)}</span>
          <span className="text-slate-500">{formatDate(item.expires_on)}</span>
        </div>
      </button>
      <button
        onClick={() => onRemove(item)}
        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-black/5"
        aria-label={`Remove ${item.name}`}
      >
        Used up
      </button>
    </li>
  );
}
