// Dates are plain YYYY-MM-DD strings, compared in the user's local time zone.

export function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export const SOON_DAYS = 2;

export function expiryStatus(iso) {
  const n = daysUntil(iso);
  if (n < 0) return 'expired';
  if (n <= SOON_DAYS) return 'soon';
  return 'ok';
}

export function expiryLabel(iso) {
  const n = daysUntil(iso);
  if (n < -1) return `Expired ${-n} days ago`;
  if (n === -1) return 'Expired yesterday';
  if (n === 0) return 'Expires today';
  if (n === 1) return 'Expires tomorrow';
  return `Expires in ${n} days`;
}

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
