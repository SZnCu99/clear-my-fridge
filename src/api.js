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

export const api = {
  list: () => request('GET', '/api/items'),
  create: (item) => request('POST', '/api/items', item),
  update: (id, changes) => request('PATCH', `/api/items/${id}`, changes),
  remove: (id) => request('DELETE', `/api/items/${id}`),
};
