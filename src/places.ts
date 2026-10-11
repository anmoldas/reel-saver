import type { Env, PlaceMatch } from './types.js';

// Only these fields are requested. Field choice sets the Places price tier; all of these are in the
// same tier as the address, so asking for the address parts costs nothing extra.
const FIELD_MASK = 'places.id,places.formattedAddress,places.location,places.addressComponents';

// The names the sheet uses, for countries that are written several ways.
const COUNTRY_NAMES: Record<string, string> = {
  'united states': 'USA',
  'united states of america': 'USA',
  us: 'USA',
  'u.s.': 'USA',
  'u.s.a.': 'USA',
  'united kingdom': 'UK',
  'great britain': 'UK',
  'u.k.': 'UK',
};

/** "United States" → "USA", so a country filter finds every row. Other names are kept as given. */
export function countryName(name: string): string {
  const n = name.trim();
  return COUNTRY_NAMES[n.toLowerCase()] ?? n;
}

interface AddressComponent {
  longText?: string;
  types?: string[];
}

/** City and country from a place's address parts. Tokyo's wards count as localities, so they become "Tokyo". */
export function cityAndCountry(parts: AddressComponent[] | undefined): { city: string; country: string } {
  const find = (type: string) => (parts ?? []).find((p) => p.types?.includes(type))?.longText?.trim() ?? '';
  const country = find('country');
  const region = find('administrative_area_level_1');
  const city = country === 'Japan' && /^tokyo/i.test(region) ? 'Tokyo' : find('locality') || find('postal_town');
  return { city, country: countryName(country) };
}

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
    ...cityAndCountry(place.addressComponents),
    address: place.formattedAddress ?? '',
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    mapsUrl: mapsUrl(name, city, place.id),
  };
}
