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
};

export function formatAmount(amount, unit) {
  const n = Number(amount.toFixed(2)).toString();
  return `${n} ${unit}`;
}
