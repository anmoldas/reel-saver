import type { ParsedItem, PlaceMatch, Post, Row } from './types.js';
import { mapsUrl } from './places.js';

// Each row's `type` picks its tab in the sheet: place → Places, recipe → Recipes,
// idea → Ideas, failed → Failed. The Apps Script owns each tab's column list.

interface Base {
  savedAt: string;
  sourceUrl: string;
  post?: Post;
}

function baseRow({ savedAt, sourceUrl, post }: Base): Row {
  return {
    saved_at: savedAt,
    source_url: sourceUrl,
    creator: post?.creator ? `@${post.creator}` : '',
    thumbnail_url: post?.thumbnailUrl ?? '',
  };
}

const bullets = (items: string[]) => items.map((i) => `• ${i}`).join('\n');

/** "1-2-3 Shibuya, Tokyo 150-0002, Japan" → "Japan". */
export function countryFromAddress(address: string): string {
  const last = address.split(',').pop()?.trim() ?? '';
  return /\d/.test(last) ? '' : last;
}

export function itemRow(base: Base, item: ParsedItem, match: PlaceMatch | null = null): Row {
  const row: Row = { ...baseRow(base), type: item.type, title: item.title, summary: item.summary };
  if (item.place) {
    const p = item.place;
    row.category = p.category;
    row.specialty = p.specialty;
    row.city = p.city;
    row.country = p.country || countryFromAddress(match?.address ?? '');
    row.what_to_order = p.what_to_order;
    row.maps_url = match?.mapsUrl ?? mapsUrl(p.name, p.city);
    if (match) {
      row.place_id = match.placeId;
      row.address = match.address;
      if (match.lat !== null) row.lat = match.lat;
      if (match.lng !== null) row.lng = match.lng;
    }
  }
  if (item.recipe) {
    const r = item.recipe;
    row.ingredients = bullets(r.ingredients);
    row.steps = r.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    row.servings = r.servings;
    row.time = r.time;
  }
  if (item.idea) {
    const d = item.idea;
    row.topic = d.topic;
    row.suggested_topic = d.suggested_topic;
    row.takeaways = bullets(d.takeaways);
    row.mentioned = d.mentioned.join(', ');
  }
  return row;
}

export function failedRow(base: Base, error: string): Row {
  return { ...baseRow(base), type: 'failed', error };
}

/** Text for the iOS notification. */
export function summarize(items: ParsedItem[]): string {
  if (items.length === 1) return `Saved ${items[0].type}: ${items[0].title}`;
  const types = new Set(items.map((i) => i.type));
  const noun = types.size === 1 ? `${items[0].type}s` : 'items';
  const names = items.map((i) => i.title);
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, +${names.length - 3} more` : '');
  return `Saved ${items.length} ${noun}: ${shown}`;
}
