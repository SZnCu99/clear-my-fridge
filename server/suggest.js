// Builds the meal-suggestion prompt and checks what the model sends back.

export const SOON_DAYS = 2; // same rule as the fridge list
export const MAX_ITEMS = 60;
export const RECIPE_COUNT = 3;

export function localISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(`${toISO}T00:00:00Z`) - Date.parse(`${fromISO}T00:00:00Z`)) / 86_400_000);
}

// items: rows sorted by expiry. Returns the unexpired ones (soonest first, capped) with days left.
export function pickItems(items, today, ids) {
  let list = items.filter((i) => daysBetween(today, i.expires_on) >= 0);
  if (ids) {
    const wanted = new Set(ids);
    list = list.filter((i) => wanted.has(i.id));
  }
  return list.slice(0, MAX_ITEMS).map((i) => ({ ...i, days_left: daysBetween(today, i.expires_on) }));
}

const daysText = (n) => (n === 0 ? 'expires today' : n === 1 ? 'expires tomorrow' : `expires in ${n} days`);

export function buildPrompt(items, { selected = false } = {}) {
  const lines = items.map((i) => `- id ${i.id}: ${i.name}, ${Number(i.amount.toFixed(2))} ${i.unit}, ${daysText(i.days_left)}`);
  return `You suggest simple home-cooked meals that help someone use up what is in their fridge.

${selected ? 'The person picked these items to cook with. Only use these items' : 'Fridge items'} (plus pantry staples):
${lines.join('\n')}

Rules:
- Assume pantry staples are available: salt, pepper, cooking oil, butter, water, flour, sugar, vinegar, soy sauce and common dried herbs and spices. Never list these as missing.
- Strongly favour items that expire soonest. Each recipe should use at least one of the items expiring within ${SOON_DAYS} days if there are any.
- Make the ${RECIPE_COUNT} recipes clearly different from each other.
- "uses" lists the fridge items the recipe needs, by id, with the amount needed in that item's own unit. Never use more than the amount listed.
- "missing" lists only ingredients the recipe truly needs that are not in the list above and are not pantry staples. Leave out optional extras and garnishes. Prefer recipes with nothing missing.
- Keep steps short and practical, at most 6 steps.

Reply with JSON only, in exactly this shape:
{"recipes":[{"title":string,"minutes":number,"uses":[{"id":number,"amount":number}],"missing":[string],"steps":[string]}]}`;
}

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// Validates the model's JSON against the items that were sent. Throws on unusable output.
export function parseRecipes(text, items) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new Error('The model did not return valid JSON.');
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const raw = Array.isArray(data?.recipes) ? data.recipes : [];

  const recipes = [];
  for (const r of raw) {
    const title = str(r?.title, 120);
    if (!title) continue;

    const seen = new Set();
    const uses = [];
    for (const u of Array.isArray(r.uses) ? r.uses : []) {
      const item = byId.get(Number(u?.id));
      if (!item || seen.has(item.id)) continue; // drop ids we didn't send (made up by the model)
      seen.add(item.id);
      const asked = Number(u.amount);
      // No amount, or more than there is: use it all.
      const amount = Number.isFinite(asked) && asked > 0 ? Math.min(Math.round(asked * 1000) / 1000, item.amount) : item.amount;
      uses.push({ id: item.id, name: item.name, unit: item.unit, amount, expires_on: item.expires_on, days_left: item.days_left });
    }
    if (uses.length === 0) continue; // a recipe that uses nothing from the fridge isn't useful here

    const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => str(s, 300)).filter(Boolean).slice(0, 8);
    const missing = (Array.isArray(r.missing) ? r.missing : []).map((s) => str(s, 80)).filter(Boolean).slice(0, 10);
    const minutes = Number(r.minutes);
    recipes.push({
      title,
      minutes: Number.isFinite(minutes) && minutes > 0 && minutes < 1000 ? Math.round(minutes) : null,
      uses,
      missing,
      steps,
    });
  }
  if (recipes.length === 0) throw new Error('The model returned no usable recipes.');

  // Most soon-to-expire items used first, then fewest missing ingredients.
  const soon = (r) => r.uses.filter((u) => u.days_left <= SOON_DAYS).length;
  return recipes
    .map((r, i) => ({ r, i }))
    .sort((a, b) => soon(b.r) - soon(a.r) || a.r.missing.length - b.r.missing.length || a.i - b.i)
    .map(({ r }) => r)
    .slice(0, RECIPE_COUNT);
}
