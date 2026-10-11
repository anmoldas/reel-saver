// Used when the sheet's Topics / Place types tabs are empty or unreachable. The tabs are the source of truth.
export const DEFAULT_TOPICS = [
  'Travel tips',
  'Clothing',
  'Career',
  'AI',
  'Video editing',
  'Journaling',
  'Organization',
];

export const DEFAULT_PLACE_TYPES = [
  'restaurant',
  'cafe',
  'bar',
  'bakery & dessert',
  'home & ceramics',
  'clothing',
  'beauty',
  'books & stationery',
  'market',
  'museum & gallery',
  'sight',
  'activity',
  'stay',
];

export const MENTION_KINDS = ['product', 'app/tool', 'brand', 'store', 'book', 'show/movie', 'course', 'person'];

export const OTHER = 'Other';
export const OTHER_PLACE = 'other';

/** How an idea's guide is named, for saving a new idea and for grouping older ones. */
export const GUIDE_NAMING = `The broad subject the idea belongs to, so every saved video on it can be read together as one guide. Two to four words, and broad:
    - travel: the country (tips on Tokyo, Kyoto, Japanese shopping or konbini go under "Japan"), or a city for a city break when there is no guide for its country (e.g. "Amsterdam"). Shopping on a trip goes under the destination. General travel advice that is not about one place (flights, miles, lounges, jet lag, packing) is "Travel hacks".
    - everything else: the skill or area of life, e.g. "Video editing", "Growing on Instagram", "Workouts", "Budgeting", "Housing", "Hair & beauty", "Wardrobe", "Cooking & eating well", "Home & cleaning", "Organization", "What to watch & play", "AI tools", "Wellness".
    - products from a country that are used at home go by what they are ("Hair & beauty"), not the country.`;

/** The lists Gemini chooses from, read from the sheet on each save. */
export interface Lists {
  topics: string[];
  placeTypes: string[];
  /** Guide names already in use. Unlike topics, a new one can be added. */
  guides: string[];
  /** Cities in the Places tab, most places first, so the same city is spelled the same way. */
  cities: string[];
}

/** Clean list from the sheet (or the defaults), with blanks and duplicates removed and `last` at the end. */
function cleanList(fromSheet: unknown, defaults: string[], last: string): string[] {
  const cleaned = Array.isArray(fromSheet)
    ? fromSheet.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : [];
  const items = cleaned.length ? cleaned : defaults;
  const unique = [...new Set(items.filter((t) => t.toLowerCase() !== last.toLowerCase()))];
  return [...unique, last];
}

export function topicList(fromSheet: unknown): string[] {
  return cleanList(fromSheet, DEFAULT_TOPICS, OTHER);
}

export function placeTypeList(fromSheet: unknown): string[] {
  return cleanList(fromSheet, DEFAULT_PLACE_TYPES, OTHER_PLACE);
}

/** Names from the sheet with blanks and repeats (ignoring case) removed, at most `max`. */
export function guideList(fromSheet: unknown, max = Infinity): string[] {
  if (!Array.isArray(fromSheet)) return [];
  const seen = new Set<string>();
  return fromSheet
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, max);
}

export function lists(topics?: unknown, placeTypes?: unknown, guides?: unknown, cities?: unknown): Lists {
  return { topics: topicList(topics), placeTypes: placeTypeList(placeTypes), guides: guideList(guides), cities: guideList(cities, 80) };
}

/** An existing guide's spelling when the name matches one (ignoring case), else the name as given. */
export function matchGuide(name: string, guides: string[]): string {
  const n = name.trim().slice(0, 60);
  return guides.find((g) => g.toLowerCase() === n.toLowerCase()) ?? n;
}
