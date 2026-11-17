import { useEffect, useRef, useState } from 'react';
import { api, formatAmount, UNITS } from './api.js';
import { expiryLabel, expiryStatus, formatDate, todayISO } from './dates.js';
import { MealsView, PickView } from './Meals.jsx';
import { PantryView } from './Pantry.jsx';
import { FreezePanel, FreezeView, freezeCandidates } from './Freeze.jsx';

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
  const [view, setView] = useState('fridge'); // fridge | meals | pick | pantry | freeze
  // Last suggestions, kept while moving between screens so going back doesn't cost another call.
  const [meals, setMeals] = useState({ loading: false, error: '', recipes: null, itemIds: null, cuisine: null });
  const suggestSeq = useRef(0);
  const [staples, setStaples] = useState(null);
  const [cuisines, setCuisines] = useState(null);
  const [defaultCuisine, setDefaultCuisine] = useState('any');

  useEffect(() => {
    api.list().then(setItems).catch((e) => setError(e.message));
    api.staples().then(setStaples).catch(() => {});
    api.cuisines().then(setCuisines).catch(() => {});
    api.settings().then((s) => setDefaultCuisine(s.cuisine)).catch(() => {});
  }, []);

  // Suggestions made with an older pantry or cuisine are stale, so the next tap asks again.
  const staleMeals = () => setMeals((m) => ({ ...m, recipes: null }));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const addStaple = async (name) => {
    const s = await api.addStaple(name);
    setStaples((xs) => (xs.some((x) => x.id === s.id) ? xs : [...xs, s].sort(byName)));
    staleMeals();
  };
  const removeStaple = async (s) => {
    await api.removeStaple(s.id);
    setStaples((xs) => xs.filter((x) => x.id !== s.id));
    staleMeals();
  };
  const saveCuisine = async (cuisine) => {
    setDefaultCuisine(cuisine);
    staleMeals();
    const saved = await api.saveSettings({ cuisine }).catch((e) => (setError(e.message), null));
    if (saved) setDefaultCuisine(saved.cuisine);
  };

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

  const showUndo = (label, undoFn) => {
    clearTimeout(undoTimer.current);
    setUndo({ label, undoFn });
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
  };

  // Use up part or all of an item. Returns a promise so the row can close its panel.
  const use = (item, how, label) =>
    run(async () => {
      const { item: updated } = await api.use(item.id, how);
      if (updated) {
        setItems((xs) => xs.map((x) => (x.id === item.id ? updated : x)));
        showUndo(`Used ${label} of ${item.name}`, () => save(item.id, { amount: item.amount }));
      } else {
        setItems((xs) => xs.filter((x) => x.id !== item.id));
        showUndo(`Used up ${item.name}`, () =>
          add({ name: item.name, amount: item.amount, unit: item.unit, expires_on: item.expires_on, frozen_on: item.frozen_on })
        );
      }
    });

  const restore = () => {
    const { undoFn } = undo;
    setUndo(null);
    clearTimeout(undoTimer.current);
    run(undoFn).catch(() => {});
  };

  // itemIds: null for the whole fridge (mode 1), or the picked ids (mode 2).
  // cuisine: the style for this request (the default cuisine when not given).
  const suggest = async (itemIds = null, cuisine = defaultCuisine) => {
    const seq = ++suggestSeq.current;
    setView('meals');
    setMeals({ loading: true, error: '', recipes: null, itemIds, cuisine });
    try {
      const res = await api.suggest(itemIds, cuisine);
      if (seq === suggestSeq.current)
        setMeals({ loading: false, error: '', recipes: res.recipes, itemIds: itemIds ? res.item_ids : null, cuisine: res.cuisine });
    } catch (e) {
      if (seq === suggestSeq.current) setMeals({ loading: false, error: e.message, recipes: null, itemIds, cuisine });
    }
  };

  const cook = async (recipe) => {
    try {
      const { before, items: updated } = await api.cook(recipe.uses.map((u) => ({ id: u.id, amount: u.amount })));
      setItems(updated);
      setMeals((m) => ({ ...m, recipes: null })); // amounts changed, so old suggestions are stale
      setView('fridge');
      showUndo(`Cooked ${recipe.title}`, async () => setItems(await api.restore(before)));
    } catch (e) {
      setMeals((m) => ({ ...m, error: e.message }));
      throw e;
    }
  };

  // "I froze it": marks the item frozen and pushes its expiry out by `months`, with an Undo.
  const freeze = (item, months) =>
    run(async () => {
      const { before, item: updated } = await api.freeze(item.id, months);
      setItems((xs) => xs.map((x) => (x.id === item.id ? updated : x)).sort(byExpiry));
      setMeals((m) => ({ ...m, recipes: null })); // expiry dates changed, so old suggestions are stale
      showUndo(`Froze ${item.name}`, async () => setItems(await api.restore([before])));
    });

  const toFreeze = freezeCandidates(items).length;
  const expired = items?.filter((i) => expiryStatus(i.expires_on) === 'expired').length ?? 0;
  const soon = items?.filter((i) => expiryStatus(i.expires_on) === 'soon').length ?? 0;

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(6rem,env(safe-area-inset-bottom))]">
      <header className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-teal-800">Clear My Fridge</h1>
          {view !== 'pantry' && (
            <button
              onClick={() => setView('pantry')}
              className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-teal-800 ring-1 ring-teal-700/30 hover:bg-teal-50"
            >
              Pantry & cuisine
            </button>
          )}
        </div>
        {items && items.length > 0 && (
          <p className="mt-1 text-sm text-slate-600">
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {soon > 0 && <span className="font-medium text-amber-700"> · {soon} expiring soon</span>}
            {expired > 0 && <span className="font-medium text-red-700"> · {expired} expired</span>}
          </p>
        )}
        {view === 'fridge' && items && items.some((i) => expiryStatus(i.expires_on) !== 'expired') && (
          <button
            onClick={() => (meals.recipes ? setView('meals') : suggest())}
            className="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-slate-900 hover:bg-amber-400"
          >
            {meals.recipes ? 'See meal suggestions' : 'Suggest meals'}
          </button>
        )}
        {view === 'fridge' && toFreeze > 0 && (
          <button
            onClick={() => setView('freeze')}
            className="mt-2 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-sky-800 ring-1 ring-sky-700/30 hover:bg-sky-50"
          >
            ❄ Too lazy to cook? Freeze what's expiring ({toFreeze})
          </button>
        )}
      </header>

      {view === 'meals' && (
        <MealsView
          state={meals}
          onBack={() => setView('fridge')}
          onAgain={() => suggest(meals.itemIds, meals.cuisine)}
          cuisines={cuisines}
          onCuisine={(c) => suggest(meals.itemIds, c)}
          onTweak={() => setView('pick')}
          onCook={cook}
        />
      )}
      {view === 'freeze' && (
        <>
          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
          <FreezeView items={items} onBack={() => setView('fridge')} onFreeze={freeze} />
        </>
      )}
      {view === 'pick' && items && (
        <PickView items={items} initial={meals.itemIds} onBack={() => setView('meals')} onSuggest={(ids) => suggest(ids, meals.cuisine ?? defaultCuisine)} />
      )}
      {view === 'pantry' && (
        <PantryView
          staples={staples}
          cuisines={cuisines}
          cuisine={defaultCuisine}
          onBack={() => setView('fridge')}
          onAdd={addStaple}
          onRemove={removeStaple}
          onCuisine={saveCuisine}
        />
      )}

      {view === 'fridge' && (
        <>
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
                <ItemRow key={item.id} item={item} onSave={save} onUse={use} onFreeze={freeze} />
              ))}
            </ul>
          </section>
        </>
      )}

      {undo && (
        <div className="fixed inset-x-0 bottom-0 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex w-full max-w-xl items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
            <span className="truncate">{undo.label}</span>
            <button onClick={restore} className="shrink-0 font-semibold text-teal-300">
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AmountFields({ amount, unit, onAmount, onUnit, labels = true }) {
  return (
    <div className="grid grid-cols-[1fr_5.5rem] gap-2">
      <label className="block">
        {labels && <span className="mb-1 block text-sm font-medium text-slate-700">Amount</span>}
        <input
          aria-label="Amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          className={inputClass}
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          required
        />
      </label>
      <label className="block">
        {labels && <span className="mb-1 block text-sm font-medium text-slate-700">Unit</span>}
        <select aria-label="Unit" className={inputClass} value={unit} onChange={(e) => onUnit(e.target.value)}>
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function AddForm({ onAdd }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('pcs');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onAdd({ name, amount, unit, expires_on: expiresOn });
      setName('');
      setAmount('1');
      setUnit('pcs');
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
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Item</span>
        <input
          ref={nameRef}
          aria-label="Item"
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Milk"
          maxLength={100}
          required
        />
      </label>
      <AmountFields amount={amount} unit={unit} onAmount={setAmount} onUnit={setUnit} />
      <div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Expires on</span>
          <input
            aria-label="Expires on"
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
  frozen: { row: 'bg-sky-50 ring-sky-200', badge: 'bg-sky-100 text-sky-900' },
};

const FRACTIONS = [
  ['½', 1 / 2, 'half'],
  ['⅓', 1 / 3, 'a third'],
  ['¼', 1 / 4, 'a quarter'],
];

function ItemRow({ item, onSave, onUse, onFreeze }) {
  const [mode, setMode] = useState('view'); // view | edit | use | freeze
  const [draft, setDraft] = useState(item);
  const [used, setUsed] = useState('');
  const status = expiryStatus(item.expires_on);
  const s = statusStyles[item.frozen_on && status === 'ok' ? 'frozen' : status];

  const startEdit = () => {
    setDraft({ ...item, amount: String(item.amount) });
    setMode('edit');
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    try {
      await onSave(item.id, { name: draft.name, amount: draft.amount, unit: draft.unit, expires_on: draft.expires_on });
      setMode('view');
    } catch {
      // error is shown by the parent
    }
  };

  const doUse = async (how, label) => {
    try {
      await onUse(item, how, label);
      setUsed('');
      setMode('view');
    } catch {
      // error is shown by the parent; keep the panel open
    }
  };

  const submitUse = (e) => {
    e.preventDefault();
    doUse({ amount: used }, formatAmount(Number(used), item.unit));
  };

  if (mode === 'edit') {
    return (
      <li className="rounded-xl bg-white p-3 shadow-sm ring-2 ring-teal-600">
        <form onSubmit={submitEdit} className="space-y-2">
          <input
            aria-label="Item"
            className={inputClass}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            maxLength={100}
            required
            autoFocus
          />
          <AmountFields
            labels={false}
            amount={draft.amount}
            unit={draft.unit}
            onAmount={(amount) => setDraft({ ...draft, amount })}
            onUnit={(unit) => setDraft({ ...draft, unit })}
          />
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">Expires on (change it if you froze it)</span>
            <input
              aria-label="Expires on"
              type="date"
              className={inputClass}
              value={draft.expires_on}
              onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })}
              required
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-800">
              Save
            </button>
            <button
              type="button"
              onClick={() => setMode('view')}
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
    <li className={`rounded-xl p-3 shadow-sm ring-1 ${s.row}`}>
      <div className="flex items-center gap-3">
        <button onClick={startEdit} className="min-w-0 flex-1 text-left" aria-label={`Edit ${item.name}`}>
          <div className="flex items-baseline gap-2">
            <span className="truncate font-semibold">{item.name}</span>
            <span className="shrink-0 text-sm text-slate-500">{formatAmount(item.amount, item.unit)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {item.frozen_on && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-900">❄ Frozen</span>
            )}
            <span className={`rounded-full px-2 py-0.5 font-medium ${s.badge}`}>{expiryLabel(item.expires_on)}</span>
            <span className="text-slate-500">{formatDate(item.expires_on)}</span>
          </div>
        </button>
        <button
          onClick={() => setMode(mode === 'view' ? 'use' : 'view')}
          aria-expanded={mode !== 'view'}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-black/5"
          aria-label={`Use ${item.name}`}
        >
          {mode === 'view' ? 'Use' : 'Close'}
        </button>
      </div>

      {mode === 'use' && (
        <div className="mt-3 space-y-2 border-t border-black/10 pt-3">
          <p className="text-sm text-slate-600">How much did you use?</p>
          <div className="grid grid-cols-4 gap-2">
            {FRACTIONS.map(([label, fraction, words]) => (
              <button
                key={label}
                onClick={() => doUse({ fraction }, words)}
                className="rounded-lg bg-white px-2 py-2 text-lg font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50"
                aria-label={`Use ${words}`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => doUse({ all: true })}
              className="rounded-lg bg-teal-700 px-2 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              All
            </button>
          </div>
          <form onSubmit={submitUse} className="flex gap-2">
            <div className="relative flex-1">
              <input
                aria-label="Amount used"
                type="number"
                inputMode="decimal"
                min="0"
                max={item.amount}
                step="any"
                placeholder="Other amount"
                className={`${inputClass} pr-14`}
                value={used}
                onChange={(e) => setUsed(e.target.value)}
                required
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-500">
                {item.unit}
              </span>
            </div>
            <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900">
              Use
            </button>
          </form>
          {!item.frozen_on && status !== 'expired' && (
            <button
              onClick={() => setMode('freeze')}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-sky-800 ring-1 ring-sky-700/30 hover:bg-sky-50"
            >
              ❄ Not cooking it? Freeze it instead
            </button>
          )}
        </div>
      )}
      {mode === 'freeze' && (
        <FreezePanel
          item={item}
          onFreeze={async (it, months) => {
            await onFreeze(it, months);
            setMode('view');
          }}
          onCancel={() => setMode('use')}
        />
      )}
    </li>
  );
}
