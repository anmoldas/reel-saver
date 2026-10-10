import type { Env, PlaceMatch } from './types.js';

// Only these fields are requested. Field choice sets the Places price tier.
const FIELD_MASK = 'places.id,places.formattedAddress,places.location';

export function mapsUrl(name: string, city: string, placeId = ''): string {
  const q = encodeURIComponent([name, city].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}${placeId ? `&query_place_id=${placeId}` : ''}`;
}

/** Text Search for "name, city". Returns null when there is no match. */
export async function findPlace(env: Env, name: string, city: string): Promise<PlaceMatch | null> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.PLACES_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: [name, city].filter(Boolean).join(', '), pageSize: 1 }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const place = (await res.json()).places?.[0];
  if (!place?.id) return null;
  return {
    placeId: place.id,
    address: place.formattedAddress ?? '',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    mapsUrl: mapsUrl(name, city, place.id),
  };
}
