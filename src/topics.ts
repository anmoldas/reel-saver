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

/** The fixed lists Gemini must choose from, read from the sheet on each save. */
export interface Lists {
  topics: string[];
  placeTypes: string[];
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

export function lists(topics?: unknown, placeTypes?: unknown): Lists {
  return { topics: topicList(topics), placeTypes: placeTypeList(placeTypes) };
}
