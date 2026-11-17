import { useState } from 'react';
import { formatAmount } from './api.js';
import { expiryLabel, expiryStatus } from './dates.js';

const backButton = 'rounded-lg px-2 py-1 text-sm font-medium text-teal-800 hover:bg-teal-50';

// Recipe suggestions. state: { loading, error, recipes, itemIds (null = whole fridge) }
export function MealsView({ state, onBack, onAgain, onTweak, onCook }) {
  const { loading, error, recipes, itemIds } = state;
  return (
    <section aria-label="Meal suggestions">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button onClick={onBack} className={backButton}>
          ← Fridge
        </button>
        <p className="text-sm text-slate-500">
          {itemIds ? `Using ${itemIds.length} picked ${itemIds.length === 1 ? 'item' : 'items'}` : 'Using your whole fridge'}
        </p>
      </div>

      {loading && (
        <p className="rounded-xl bg-white px-4 py-8 text-center text-slate-600 ring-1 ring-slate-200" role="status">
          Finding meals that use up what's expiring…
        </p>
      )}
      {error && !loading && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {!loading && recipes && (
        <ul className="space-y-3">
          {recipes.map((r) => (
            <RecipeCard key={r.title} recipe={r} onCook={onCook} />
          ))}
        </ul>
      )}

      {!loading && (
        <div className="mt-5 space-y-2">
          <button
            onClick={onAgain}
            className="w-full rounded-lg bg-slate-800 px-4 py-2.5 font-semibold text-white hover:bg-slate-900"
          >
            {recipes ? 'Suggest different meals' : 'Try again'}
          </button>
          <button
            onClick={onTweak}
            className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-teal-800 ring-1 ring-teal-700/30 hover:bg-teal-50"
          >
            Not what you want? Tweak the ingredients you want to use first
          </button>
        </div>
      )}
    </section>
  );
}

function RecipeCard({ recipe, onCook }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cook = async () => {
    setBusy(true);
    try {
      await onCook(recipe);
    } catch {
      setBusy(false); // error is shown by the parent
    }
  };

  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{recipe.title}</h2>
        {recipe.minutes && <span className="shrink-0 text-sm text-slate-500">{recipe.minutes} min</span>}
      </div>

      <p className="mt-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">From your fridge</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {recipe.uses.map((u) => {
          const soon = expiryStatus(u.expires_on) === 'soon';
          return (
            <li
              key={u.id}
              className={`rounded-full px-2.5 py-1 text-sm ${soon ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}
              title={expiryLabel(u.expires_on)}
            >
              {u.name} · {formatAmount(u.amount, u.unit)}
              {soon && <span className="sr-only"> ({expiryLabel(u.expires_on)})</span>}
            </li>
          );
        })}
      </ul>

      {recipe.missing.length > 0 && (
        <p className="mt-3 text-sm text-slate-600">
          <span className="font-medium text-slate-700">You'd also need:</span> {recipe.missing.join(', ')}
        </p>
      )}

      {recipe.steps.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-sm font-medium text-teal-800">
            {open ? 'Hide steps' : `Show ${recipe.steps.length} steps`}
          </button>
          {open && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {recipe.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <button
        onClick={cook}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
      >
        Cook this
      </button>
      <p className="mt-1 text-center text-xs text-slate-500">Takes the amounts above out of your fridge. You can undo it.</p>
    </li>
  );
}

// Pick which items to cook with. Every unexpired item starts ticked (or the last pick, if there was one).
export function PickView({ items, initial, onBack, onSuggest }) {
  const usable = items.filter((i) => expiryStatus(i.expires_on) !== 'expired');
  const [picked, setPicked] = useState(() => new Set(initial ?? usable.map((i) => i.id)));
  const toggle = (id) =>
    setPicked((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const chosen = usable.filter((i) => picked.has(i.id)).map((i) => i.id);
  const allTicked = chosen.length === usable.length;

  return (
    <section aria-label="Pick ingredients">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button onClick={onBack} className={backButton}>
          ← Back
        </button>
        <button
          onClick={() => setPicked(new Set(allTicked ? [] : usable.map((i) => i.id)))}
          className="rounded-lg px-2 py-1 text-sm font-medium text-slate-600 hover:bg-black/5"
        >
          {allTicked ? 'Untick all' : 'Tick all'}
        </button>
      </div>
      <p className="mb-3 text-sm text-slate-600">Untick anything you don't want to cook with. Expired items aren't shown.</p>

      <ul className="space-y-2">
        {usable.map((item) => {
          const soon = expiryStatus(item.expires_on) === 'soon';
          return (
            <li key={item.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl p-3 shadow-sm ring-1 ${
                  soon ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  className="size-5 accent-teal-700"
                  checked={picked.has(item.id)}
                  onChange={() => toggle(item.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{item.name}</span>{' '}
                  <span className="text-sm text-slate-500">{formatAmount(item.amount, item.unit)}</span>
                  <span className={`block text-sm ${soon ? 'text-amber-800' : 'text-slate-500'}`}>{expiryLabel(item.expires_on)}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 mt-4 bg-gradient-to-t from-slate-50 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => onSuggest(chosen)}
          disabled={chosen.length === 0}
          className="w-full rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {chosen.length === 0 ? 'Pick at least one ingredient' : `Suggest meals with ${chosen.length} ${chosen.length === 1 ? 'ingredient' : 'ingredients'}`}
        </button>
      </div>
    </section>
  );
}
