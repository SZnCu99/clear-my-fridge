// "Too lazy to cook? Freeze it": how to freeze one item so it keeps its flavour, and how long it lasts frozen.
// Tips come from the LLM when there is one (see gemini.js), with a small built-in list as the fallback.

export const DEFAULT_MONTHS = 3;
export const MAX_MONTHS = 12;

const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).map((s) => str(s, maxLen)).filter(Boolean).slice(0, maxItems);

export const clampMonths = (n) => {
  const m = Math.round(Number(n));
  return Number.isFinite(m) && m >= 1 ? Math.min(m, MAX_MONTHS) : DEFAULT_MONTHS;
};

// YYYY-MM-DD plus whole months, clamped to the end of shorter months (Jan 31 + 1 month = Feb 28).
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month + 1)}-${p(Math.min(d, last))}`;
}

export function buildFreezePrompt(item) {
  return `Someone has "${item.name}" (${Number(item.amount.toFixed(2))} ${item.unit}) in their fridge that is about to expire.
They don't want to cook it now and would rather freeze it.

Explain briefly how to freeze it at home so it keeps the best flavour and texture.
- If it does not freeze well, say so and set "freezable" to false, and give a quick way to use or preserve it instead in "steps".
- "steps": at most 5 short practical steps (prep, portioning, wrapping, labelling).
- "keeps_months": how many months it stays good in a home freezer at -18°C, as a whole number from 1 to 12.
- "thaw": one sentence on how to thaw or use it from frozen.
- "tip": one optional sentence about flavour or texture, or "".

Reply with JSON only, in exactly this shape:
{"freezable":boolean,"steps":[string],"keeps_months":number,"thaw":string,"tip":string}`;
}

export function parseFreezeTips(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    throw new Error('The model did not return valid JSON.');
  }
  const steps = list(data?.steps, 6, 300);
  if (steps.length === 0) throw new Error('The model returned no steps.');
  return {
    freezable: data.freezable !== false,
    steps,
    keeps_months: clampMonths(data.keeps_months),
    thaw: str(data.thaw, 300),
    tip: str(data.tip, 300),
  };
}

// Built-in tips, matched on words in the item name. First match wins, so specific entries come first.
const CURATED = [
  {
    words: ['lettuce', 'salad', 'rocket', 'arugula', 'cucumber', 'radish', 'watercress', 'sprouts', 'cress'],
    freezable: false,
    steps: [
      "Salad leaves and cucumber go limp and watery when frozen, so it's best not to.",
      'Use it today in a salad or sandwich, or wilt leaves into a soup or stir-fry.',
    ],
    keeps_months: 1,
    thaw: '',
    tip: '',
  },
  {
    words: ['egg', 'eggs'],
    freezable: true,
    steps: [
      "Don't freeze eggs in their shells: they crack.",
      'Crack them into a bowl and beat lightly with a pinch of salt (for savoury) or sugar (for baking).',
      'Pour into an ice-cube tray or a small labelled box. One cube of about 3 tablespoons is one egg.',
    ],
    keeps_months: 12,
    thaw: 'Thaw overnight in the fridge and use in scrambles, omelettes or baking.',
    tip: '',
  },
  {
    words: ['bread', 'loaf', 'baguette', 'bagel', 'bun', 'buns', 'rolls', 'tortilla', 'tortillas', 'pita', 'croissant'],
    freezable: true,
    steps: [
      'Slice loaves first so you can take out only what you need.',
      'Wrap tightly in a freezer bag and squeeze out the air.',
      'Label with the date.',
    ],
    keeps_months: 3,
    thaw: 'Toast slices straight from frozen, or thaw at room temperature for about 30 minutes.',
    tip: 'Freeze it on the day you buy it or as soon as you see it going stale.',
  },
  {
    words: ['chicken', 'beef', 'pork', 'lamb', 'mince', 'steak', 'sausage', 'sausages', 'bacon', 'turkey', 'ham', 'meat'],
    freezable: true,
    steps: [
      'Pat dry, then split into meal-sized portions.',
      'Wrap each portion tightly in cling film or put it in a freezer bag and press out all the air (this prevents freezer burn).',
      'Flatten mince in the bag so it freezes and thaws quickly.',
      'Label with the name and date.',
    ],
    keeps_months: 4,
    thaw: 'Thaw overnight in the fridge on a plate and cook within a day. Never refreeze raw meat after thawing.',
    tip: 'Freeze it before the use-by date, not on it.',
  },
  {
    words: ['fish', 'salmon', 'cod', 'tuna', 'prawn', 'prawns', 'shrimp', 'haddock', 'seafood', 'mackerel'],
    freezable: true,
    steps: [
      'Pat the fish dry with kitchen paper.',
      'Wrap each piece tightly in cling film, then put it in a freezer bag with the air pressed out.',
      'Label with the date.',
    ],
    keeps_months: 3,
    thaw: 'Thaw overnight in the fridge, or cook thin fillets straight from frozen with a few extra minutes.',
    tip: 'Oily fish like salmon and mackerel taste best within 2 months.',
  },
  {
    words: ['berry', 'berries', 'strawberries', 'blueberries', 'raspberries', 'grapes', 'cherries', 'mango', 'pineapple'],
    freezable: true,
    steps: [
      'Wash and dry well. Hull strawberries and cut big fruit into chunks.',
      'Spread in one layer on a lined tray and freeze for 2 hours so the pieces don\'t stick together.',
      'Tip into a freezer bag, press out the air and label.',
    ],
    keeps_months: 8,
    thaw: 'Use straight from frozen in smoothies, porridge or baking. Thawed fruit will be soft.',
    tip: '',
  },
  {
    words: ['banana', 'bananas'],
    freezable: true,
    steps: ['Peel first (the skins go black and are hard to remove frozen).', 'Slice or halve, then freeze in a bag with the air pressed out.'],
    keeps_months: 3,
    thaw: 'Blend from frozen into smoothies or "nice cream", or thaw for banana bread.',
    tip: 'The riper they are, the sweeter they are frozen.',
  },
  {
    words: ['basil', 'parsley', 'coriander', 'cilantro', 'dill', 'chives', 'mint', 'herbs', 'thyme', 'rosemary'],
    freezable: true,
    steps: [
      'Wash, dry well and chop.',
      'Pack into an ice-cube tray and top up with olive oil or a little water.',
      'Freeze, then pop the cubes into a labelled bag.',
    ],
    keeps_months: 6,
    thaw: 'Drop a cube straight into sauces, soups or a hot pan.',
    tip: 'Freezing in oil keeps the flavour brighter than water.',
  },
  {
    words: ['cheese', 'cheddar', 'mozzarella', 'parmesan'],
    freezable: true,
    steps: ['Grate hard cheese first, so it\'s ready to use.', 'Put it in a freezer bag, press out the air and label.'],
    keeps_months: 4,
    thaw: 'Use from frozen in cooking. Frozen cheese gets crumbly, so it is better melted than on a cheese board.',
    tip: "Soft cheeses like brie and cream cheese go grainy, so cook with them after freezing.",
  },
  {
    words: ['milk', 'cream', 'yogurt', 'yoghurt'],
    freezable: true,
    steps: [
      'Pour into a freezer-safe container, leaving a few centimetres of space at the top because it expands.',
      'Or freeze small amounts in an ice-cube tray for coffee and cooking.',
      'Label with the date.',
    ],
    keeps_months: 2,
    thaw: 'Thaw in the fridge and shake well. It may separate a little, which is fine for cooking, baking and smoothies.',
    tip: 'Whipped cream freezes better than liquid cream.',
  },
  {
    words: ['butter'],
    freezable: true,
    steps: ['Keep it in its wrapper and put it in a freezer bag so it doesn\'t pick up other smells.', 'Label with the date.'],
    keeps_months: 9,
    thaw: 'Thaw in the fridge overnight, or grate it straight from frozen for pastry.',
    tip: '',
  },
  {
    words: ['rice', 'pasta', 'soup', 'stew', 'curry', 'leftover', 'leftovers', 'sauce', 'chili', 'cooked'],
    freezable: true,
    steps: [
      'Cool it quickly (within an hour or two) and spread rice out on a tray to cool faster.',
      'Portion into freezer boxes or bags, leaving a little room at the top.',
      'Label with the name and date.',
    ],
    keeps_months: 3,
    thaw: 'Thaw overnight in the fridge, then reheat until steaming hot all the way through. Reheat only once.',
    tip: '',
  },
  {
    words: ['tomato', 'tomatoes'],
    freezable: true,
    steps: ['Wash and freeze whole, or chop them.', 'Freeze in a bag with the air pressed out and label.'],
    keeps_months: 6,
    thaw: 'Use from frozen in sauces and soups. Under warm water the skins slip right off.',
    tip: 'They go soft once thawed, so use them for cooking, not salads.',
  },
  {
    words: ['onion', 'onions', 'pepper', 'peppers', 'mushroom', 'mushrooms', 'leek', 'leeks', 'garlic', 'ginger', 'chilli'],
    freezable: true,
    steps: ['Chop or slice the way you usually cook it.', 'Freeze flat in a bag, press out the air, then label.'],
    keeps_months: 6,
    thaw: 'Cook straight from frozen, no thawing needed.',
    tip: 'Double-bag onions so the smell stays in.',
  },
  {
    words: ['broccoli', 'cauliflower', 'carrot', 'carrots', 'beans', 'peas', 'spinach', 'kale', 'courgette', 'zucchini', 'corn', 'sprout', 'cabbage', 'asparagus'],
    freezable: true,
    steps: [
      'Wash and cut into bite-size pieces.',
      'Blanch: boil for 1 to 3 minutes (leaves 1 minute), then plunge into ice water. This keeps the colour, flavour and crunch.',
      'Drain and pat very dry, freeze on a tray, then bag with the air pressed out.',
      'Label with the date.',
    ],
    keeps_months: 8,
    thaw: 'Cook straight from frozen in stir-fries, soups or steamed.',
    tip: '',
  },
];

const GENERIC = {
  freezable: true,
  steps: [
    'Portion it into the amounts you would use at once.',
    'Wrap tightly or use a freezer bag or box, and press out as much air as you can to avoid freezer burn.',
    'Label with the name and date.',
  ],
  keeps_months: DEFAULT_MONTHS,
  thaw: 'Thaw overnight in the fridge, or cook from frozen where you can.',
  tip: '',
};

export function curatedTips(name) {
  const words = new Set(String(name).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  const hit = CURATED.find((c) => c.words.some((w) => words.has(w)));
  const { words: _w, ...tips } = hit ?? GENERIC;
  return { ...tips, steps: [...tips.steps] };
}
