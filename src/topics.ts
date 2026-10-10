// Used when the sheet's Topics tab is empty or unreachable. The tab is the source of truth.
export const DEFAULT_TOPICS = [
  'Travel tips',
  'Clothing',
  'Career',
  'AI',
  'Video editing',
  'Journaling',
  'Organization',
];

export const OTHER = 'Other';

export const PLACE_CATEGORIES = ['food', 'cafe', 'bar', 'shop', 'sight', 'activity', 'stay', 'other'];

/** Clean topic list from the sheet, always ending in "Other". */
export function topicList(fromSheet: unknown): string[] {
  const cleaned = Array.isArray(fromSheet)
    ? fromSheet.map((t) => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : [];
  const topics = cleaned.length ? cleaned : DEFAULT_TOPICS;
  const unique = [...new Set(topics.filter((t) => t.toLowerCase() !== OTHER.toLowerCase()))];
  return [...unique, OTHER];
}
