// Builds the meal-suggestion prompt and checks what the model sends back.

export const SOON_DAYS = 2; // same rule as the fridge list
export const MAX_ITEMS = 60;
export const RECIPE_COUNT = 3; // shown to the user
export const CANDIDATE_COUNT = 5; // asked of the model, so the server can drop ones that break the rules
export const MIN_FRIDGE_ITEMS = 2; // per recipe, when the fridge has that many
export const FALLBACK_PRIORITY = 3; // "use first" items when nothing expires within SOON_DAYS

// Cuisine styles the user can pick. 'any' means no preference.
export const CUISINES = {
  any: 'Any',
  asian: 'Asian (any)',
  chinese: 'Chinese',
  japanese: 'Japanese',
  korean: 'Korean',
  thai: 'Thai',
  vietnamese: 'Vietnamese',
  indian: 'Indian',
  italian: 'Italian',
  spanish: 'Spanish',
  french: 'French',
  greek: 'Greek',
  mediterranean: 'Mediterranean',
  middle_eastern: 'Middle Eastern',
  mexican: 'Mexican',
  american: 'American',
  british: 'British',
};

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

// The items every recipe must use one of: everything expiring within SOON_DAYS,
// or the few soonest-expiring items if nothing is that close. items are sorted soonest first.
export function priorityItems(items) {
  const soon = items.filter((i) => i.days_left <= SOON_DAYS);
  return soon.length ? soon : items.slice(0, FALLBACK_PRIORITY);
}

const daysText = (n) => (n === 0 ? 'expires today' : n === 1 ? 'expires tomorrow' : `expires in ${n} days`);

// staples: names from the user's pantry list. cuisine: a key of CUISINES.
export function buildPrompt(items, { selected = false, staples = [], cuisine = 'any' } = {}) {
  const line = (i) => `- id ${i.id}: ${i.name}, ${Number(i.amount.toFixed(2))} ${i.unit}, ${daysText(i.days_left)}`;
  const first = priorityItems(items);
  const firstIds = new Set(first.map((i) => i.id));
  const others = items.filter((i) => !firstIds.has(i.id));
  const minUses = Math.min(MIN_FRIDGE_ITEMS, items.length);
  const pantry = staples.length
    ? `The person's pantry has only these staples (plus water): ${staples.join(', ')}.`
    : 'The person has no pantry staples, only water.';
  const style =
    cuisine && cuisine !== 'any' && CUISINES[cuisine]
      ? `\n- Make every recipe ${/^[AEIOU]/.test(CUISINES[cuisine]) ? 'an' : 'a'} ${CUISINES[cuisine]} dish${cuisine === 'asian' ? ' (from any Asian cuisine)' : ''}, using that cuisine's typical flavours and techniques with the ingredients available.`
      : '';
  return `You suggest simple home-cooked meals that help someone use up what is in their fridge.

${selected ? 'The person picked these items to cook with. Only use these items' : 'Fridge items'} (plus their pantry staples).

USE FIRST (these expire soonest):
${first.map(line).join('\n')}
${others.length ? `\nOther fridge items:\n${others.map(line).join('\n')}\n` : ''}
${pantry}

Rules:
- Only assume the pantry staples above and water are available. Any other ingredient that is not in the fridge list, including seasonings, sauces, spices and herbs, must be listed in "missing". Never list the pantry staples as missing.${style}
- Every recipe MUST use at least one USE FIRST item. Across the recipes, use as many different USE FIRST items as you can, starting with the ones that expire soonest.${
    minUses > 1
      ? `\n- Every recipe MUST use at least ${minUses} fridge items, and ideally 3 or more. A dish built around a single fridge item is not acceptable.`
      : ''
  }
- Suggest ${CANDIDATE_COUNT} recipes that are clearly different from each other.
- "uses" lists the fridge items the recipe needs, by id, with the amount needed in that item's own unit. Never use more than the amount listed.
- "missing" lists only ingredients the recipe truly needs that are not in the list above and are not pantry staples. Leave out optional extras and garnishes. Using more fridge items matters more than having nothing missing, but keep missing ingredients to one or two.
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
  // Gemini sometimes drops the {"recipes": ...} wrapper and returns the bare array.
  const raw = Array.isArray(data) ? data : Array.isArray(data?.recipes) ? data.recipes : [];

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

  return chooseRecipes(recipes, items);
}

// Keeps recipes that follow the rules (one or more "use first" items, enough fridge items), ranks them,
// and picks RECIPE_COUNT that between them use as many different "use first" items as possible.
// If the model broke the rules on every recipe, the best of what it sent is returned rather than nothing.
export function chooseRecipes(recipes, items) {
  const first = new Set(priorityItems(items).map((i) => i.id));
  const minUses = Math.min(MIN_FRIDGE_ITEMS, items.length);
  const firstUsed = (r) => r.uses.filter((u) => first.has(u.id));
  const urgency = (r) => firstUsed(r).reduce((sum, u) => sum + 1 / (1 + u.days_left), 0);
  const follows = (r) => firstUsed(r).length > 0 && r.uses.length >= minUses;

  const ranked = recipes
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        follows(b.r) - follows(a.r) ||
        urgency(b.r) - urgency(a.r) ||
        b.r.uses.length - a.r.uses.length ||
        a.r.missing.length - b.r.missing.length ||
        a.i - b.i
    )
    .map(({ r }) => r);
  const pool = ranked.some(follows) ? ranked.filter(follows) : ranked;

  // Greedy: each pick prefers a recipe that uses "use first" items not covered yet, then the ranking above.
  const chosen = [];
  const covered = new Set();
  const seenTitles = new Set();
  while (chosen.length < RECIPE_COUNT) {
    let best = null;
    let bestNew = -1;
    for (const r of pool) {
      if (chosen.includes(r) || seenTitles.has(r.title.toLowerCase())) continue;
      const fresh = firstUsed(r).filter((u) => !covered.has(u.id)).length;
      if (fresh > bestNew) [best, bestNew] = [r, fresh];
    }
    if (!best) break;
    chosen.push(best);
    seenTitles.add(best.title.toLowerCase());
    firstUsed(best).forEach((u) => covered.add(u.id));
  }
  return chosen;
}
