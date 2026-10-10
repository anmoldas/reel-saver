import type { ParsedItem, PlaceMatch, Post, Row } from './types.js';
import { mapsUrl } from './places.js';

// Same order as the Sheet header (the Apps Script matches by name, so order is cosmetic).
export const COLUMNS = [
  'saved_at', 'type', 'title', 'summary', 'details', 'source_url', 'creator', 'thumbnail_url',
  'recipe_ingredients', 'recipe_steps', 'place_name', 'place_address', 'place_city',
  'lat', 'lng', 'maps_url', 'place_id', 'category', 'notes', 'status',
] as const;

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
    status: 'to try',
  };
}

export function itemRow(base: Base, item: ParsedItem, match: PlaceMatch | null = null): Row {
  const row: Row = { ...baseRow(base), type: item.type, title: item.title, summary: item.summary };
  if (item.recipe) {
    const r = item.recipe;
    row.recipe_ingredients = r.ingredients.map((i) => `• ${i}`).join('\n');
    row.recipe_steps = r.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    row.details = [r.servings && `Serves ${r.servings}`, r.time].filter(Boolean).join(' · ');
  }
  if (item.place) {
    const p = item.place;
    row.place_name = p.name;
    row.place_city = p.city;
    row.category = p.category;
    row.details = p.what_to_order ? `Order: ${p.what_to_order}` : '';
    row.maps_url = match?.mapsUrl ?? mapsUrl(p.name, p.city);
    if (match) {
      row.place_id = match.placeId;
      row.place_address = match.address;
      if (match.lat !== null) row.lat = match.lat;
      if (match.lng !== null) row.lng = match.lng;
    }
  }
  if (item.recommendation) {
    row.category = item.recommendation.category;
    row.details = item.recommendation.details;
  }
  return row;
}

export function failedRow(base: Base, error: string): Row {
  return { ...baseRow(base), type: 'failed', title: 'Could not save', summary: error };
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
