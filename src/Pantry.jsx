import { useState } from 'react';

const COMMON = [
  'Olive oil', 'Butter', 'Garlic', 'Onions', 'Soy sauce', 'Sugar', 'Flour', 'Vinegar', 'Rice vinegar',
  'Sesame oil', 'Fish sauce', 'Oyster sauce', 'Chili flakes', 'Cumin', 'Paprika', 'Dried oregano',
  'Honey', 'Stock cubes', 'Ketchup', 'Mustard', 'Rice', 'Pasta',
];

const backButton = 'rounded-lg px-2 py-1 text-sm font-medium text-teal-800 hover:bg-teal-50';

// Pantry staples (what meal ideas may assume you have) and the default cuisine.
export function PantryView({ staples, cuisines, cuisine, onBack, onAdd, onRemove, onCuisine }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const have = new Set((staples ?? []).map((s) => s.name.toLowerCase()));
  const ideas = COMMON.filter((c) => !have.has(c.toLowerCase()));

  const add = async (value) => {
    setError('');
    try {
      await onAdd(value);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  };
  const submit = async (e) => {
    e.preventDefault();
    if (await add(name)) setName('');
  };

  return (
    <section aria-label="Pantry and preferences">
      <div className="mb-4">
        <button onClick={onBack} className={backButton}>
          ← Fridge
        </button>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Pantry staples</h2>
        <p className="mt-1 text-sm text-slate-600">
          Condiments and basics you always keep. Meal ideas assume you have only these (and water). Anything else a recipe
          needs shows up under "You'd also need".
        </p>

        {staples === null && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
        {staples?.length === 0 && <p className="mt-3 text-sm text-slate-500">No staples yet, so recipes will assume nothing.</p>}
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {staples?.map((s) => (
            <li key={s.id} className="flex items-center rounded-full bg-teal-50 py-1 pr-1 pl-3 text-sm text-teal-900 ring-1 ring-teal-700/20">
              {s.name}
              <button
                onClick={() => onRemove(s).catch((e) => setError(e.message))}
                className="ml-1 rounded-full px-1.5 text-teal-700 hover:bg-teal-100"
                aria-label={`Remove ${s.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <form onSubmit={submit} className="mt-3 flex gap-2">
          <input
            aria-label="Add a staple"
            placeholder="Add a staple, e.g. chili oil"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" className="shrink-0 rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white hover:bg-teal-800">
            Add
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {ideas.length > 0 && (
          <>
            <p className="mt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">Common staples, tap to add</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {ideas.map((c) => (
                <li key={c}>
                  <button
                    onClick={() => add(c)}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-200"
                  >
                    + {c}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <label className="block">
          <span className="text-lg font-semibold text-slate-900">Default cuisine</span>
          <span className="mt-1 block text-sm text-slate-600">
            Used when you tap "Suggest meals". You can still switch it on the suggestions screen.
          </span>
          <CuisineSelect cuisines={cuisines} value={cuisine} onChange={onCuisine} className="mt-3" />
        </label>
      </div>
    </section>
  );
}

export function CuisineSelect({ cuisines, value, onChange, className = '', ...rest }) {
  return (
    <select
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 focus:outline-none ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      {(cuisines ?? [{ id: 'any', label: 'Any' }]).map((c) => (
        <option key={c.id} value={c.id}>
          {c.id === 'any' ? 'Any cuisine' : c.label}
        </option>
      ))}
    </select>
  );
}
