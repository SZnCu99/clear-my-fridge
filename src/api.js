async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const UNITS = ['pcs', 'g', 'kg', 'ml', 'L', 'pack'];

export const api = {
  list: () => request('GET', '/api/items'),
  create: (item) => request('POST', '/api/items', item),
  update: (id, changes) => request('PATCH', `/api/items/${id}`, changes),
  // how: { all: true } | { fraction: 0.5 } | { amount: 200 }. Resolves to { item } (null when all gone).
  use: (id, how) => request('POST', `/api/items/${id}/use`, how),
  remove: (id) => request('DELETE', `/api/items/${id}`),
  // Whole fridge when itemIds is null. cuisine overrides the saved default. Resolves to { recipes, item_ids, cuisine }.
  suggest: (itemIds, cuisine) =>
    request('POST', '/api/suggestions', { ...(itemIds ? { item_ids: itemIds } : {}), ...(cuisine ? { cuisine } : {}) }),
  cuisines: () => request('GET', '/api/cuisines'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (changes) => request('PATCH', '/api/settings', changes),
  staples: () => request('GET', '/api/staples'),
  addStaple: (name) => request('POST', '/api/staples', { name }),
  removeStaple: (id) => request('DELETE', `/api/staples/${id}`),
  // uses: [{ id, amount }]. Resolves to { before, items } (before = rows to pass to restore for Undo).
  cook: (uses) => request('POST', '/api/cook', { uses }),
  restore: (items) => request('POST', '/api/items/restore', { items }),
  // Resolves to { tips: { freezable, steps, keeps_months, thaw, tip }, source: 'ai' | 'builtin' }.
  freezeTips: (id) => request('POST', `/api/items/${id}/freeze-tips`),
  // Marks the item frozen today with a new expiry months from now. Resolves to { before, item }.
  freeze: (id, months) => request('POST', `/api/items/${id}/freeze`, { months }),
};

export function formatAmount(amount, unit) {
  const n = Number(amount.toFixed(2)).toString();
  return `${n} ${unit}`;
}
