import { useEffect, useState } from 'react';
import { api, formatAmount } from './api.js';
import { addMonthsISO, expiryLabel, expiryStatus, formatDate, todayISO } from './dates.js';

const backButton = 'rounded-lg px-2 py-1 text-sm font-medium text-teal-800 hover:bg-teal-50';

// Items worth freezing: expiring within the "soon" window and not frozen yet. Expired food isn't offered.
export const freezeCandidates = (items) =>
  (items ?? []).filter((i) => !i.frozen_on && expiryStatus(i.expires_on) === 'soon');

// "Too lazy to cook?" screen: everything expiring soon, each with how to freeze it.
export function FreezeView({ items, onBack, onFreeze }) {
  const list = freezeCandidates(items);
  return (
    <section aria-label="Freeze what's expiring">
      <div className="mb-4 flex items-center justify-between gap-2">
        <button onClick={onBack} className={backButton}>
          ← Fridge
        </button>
        <p className="text-sm text-slate-500">Too lazy to cook? Freeze it.</p>
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-slate-500">
          Nothing is about to expire. 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((item) => (
            <li key={item.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-200">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="truncate text-lg font-semibold text-slate-900">{item.name}</h2>
                <span className="shrink-0 text-sm text-slate-500">{formatAmount(item.amount, item.unit)}</span>
              </div>
              <p className="mt-0.5 text-sm font-medium text-amber-800">{expiryLabel(item.expires_on)}</p>
              <FreezePanel item={item} onFreeze={onFreeze} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// How to freeze one item, plus the "I froze it" button. Loads the tips when it first shows.
export function FreezePanel({ item, onFreeze, onCancel }) {
  const [state, setState] = useState({ loading: true, error: '', tips: null, source: null });
  const [busy, setBusy] = useState(false);
  const [anyway, setAnyway] = useState(false);

  const load = () => {
    setState({ loading: true, error: '', tips: null, source: null });
    api
      .freezeTips(item.id)
      .then(({ tips, source }) => setState({ loading: false, error: '', tips, source }))
      .catch((e) => setState({ loading: false, error: e.message, tips: null, source: null }));
  };
  useEffect(load, [item.id]);

  const { loading, error, tips, source } = state;
  const months = tips?.keeps_months ?? 3;
  const until = addMonthsISO(todayISO(), months);

  const froze = async () => {
    setBusy(true);
    try {
      await onFreeze(item, months);
    } catch {
      setBusy(false); // error is shown by the parent
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-black/10 pt-3 text-sm">
      {loading && (
        <p className="text-slate-600" role="status">
          Looking up the best way to freeze {item.name}…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
          {error}{' '}
          <button onClick={load} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}
      {tips && (
        <>
          {!tips.freezable && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 font-medium text-amber-900">This doesn't freeze well.</p>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-slate-800">
            {tips.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {tips.freezable && (
            <p className="text-slate-700">
              <span className="font-semibold">Keeps about {months} {months === 1 ? 'month' : 'months'}</span> in the freezer.
            </p>
          )}
          {tips.thaw && (
            <p className="text-slate-700">
              <span className="font-semibold">To use:</span> {tips.thaw}
            </p>
          )}
          {tips.tip && <p className="text-slate-600 italic">{tips.tip}</p>}
          <p className="text-xs text-slate-400">{source === 'ai' ? 'Tips by Gemini, check they make sense.' : 'Built-in tips.'}</p>

          {tips.freezable || anyway ? (
            <button
              onClick={froze}
              disabled={busy}
              className="w-full rounded-lg bg-sky-700 px-4 py-2.5 font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
            >
              ❄ I froze it · keeps until {formatDate(until)}
            </button>
          ) : (
            <button onClick={() => setAnyway(true)} className="text-sm font-medium text-slate-600 underline">
              Freeze it anyway
            </button>
          )}
        </>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full rounded-lg bg-slate-100 px-3 py-2 font-medium text-slate-700 hover:bg-slate-200"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
