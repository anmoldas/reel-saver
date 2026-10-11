import { describe, expect, it } from 'vitest';
import { normalizeItem } from '../src/apify.js';
import { PermanentError } from '../src/errors.js';
import { apiError, needsVideo, normalizeParse } from '../src/gemini.js';
import { cityAndCountry, countryName } from '../src/places.js';
import { countryFromAddress, itemRow, mentionRows, shopLink, summarize } from '../src/rows.js';
import { DEFAULT_PLACE_TYPES, DEFAULT_TOPICS, lists, placeTypeList, topicList } from '../src/topics.js';

describe('normalizeItem', () => {
  it('maps Instagram fields', () => {
    expect(
      normalizeItem('instagram', [{ caption: 'yum', ownerUsername: 'chef', videoUrl: 'https://v', displayUrl: 'https://t' }]),
    ).toEqual({ caption: 'yum', creator: 'chef', videoUrl: 'https://v', imageUrls: [], thumbnailUrl: 'https://t' });
  });

  it('keeps Instagram carousel slides, leaving video slides to the video step', () => {
    const post = normalizeItem('instagram', [{
      caption: 'tips', type: 'Sidecar', displayUrl: 'https://s1',
      childPosts: [{ type: 'Image', displayUrl: 'https://s1' }, { type: 'Video', displayUrl: 'https://v-cover' }, { type: 'Image', displayUrl: 'https://s3' }],
      images: ['https://s1', 'https://s3'],
    }]);
    expect(post.imageUrls).toEqual(['https://s1', 'https://s3']);
  });

  it('keeps a single Instagram photo, but not a reel cover', () => {
    expect(normalizeItem('instagram', [{ caption: 'x', type: 'Image', displayUrl: 'https://p' }]).imageUrls).toEqual(['https://p']);
    expect(normalizeItem('instagram', [{ caption: 'x', type: 'Video', videoUrl: 'https://v', displayUrl: 'https://cover' }]).imageUrls).toEqual([]);
  });

  it('caps a carousel at 10 images', () => {
    const images = Array.from({ length: 20 }, (_, i) => `https://s${i}`);
    expect(normalizeItem('instagram', [{ caption: 'x', type: 'Sidecar', images }]).imageUrls).toHaveLength(10);
  });

  it('keeps TikTok photo-mode slides, preferring the Apify copies', () => {
    const post = normalizeItem('tiktok', [{
      text: 'slides', authorMeta: { name: 'joe' },
      slideshowImageLinks: [{ tiktokLink: 'https://tt/1', downloadLink: 'https://api.apify.com/1' }, { tiktokLink: 'https://tt/2', downloadLink: 'https://api.apify.com/2' }],
    }]);
    expect(post.imageUrls).toEqual(['https://api.apify.com/1', 'https://api.apify.com/2']);
  });

  it('maps TikTok fields, preferring the downloaded video', () => {
    const post = normalizeItem('tiktok', [
      { text: 'hi', authorMeta: { name: 'joe' }, mediaUrls: ['https://apify/v.mp4'], videoMeta: { coverUrl: 'https://c' } },
    ]);
    expect(post).toEqual({ caption: 'hi', creator: 'joe', videoUrl: 'https://apify/v.mp4', imageUrls: [], thumbnailUrl: 'https://c' });
  });

  it('fails cleanly on private or deleted posts', () => {
    expect(() => normalizeItem('instagram', [])).toThrow(PermanentError);
    expect(() => normalizeItem('instagram', [{ error: 'not_found', errorDescription: 'Post does not exist' }])).toThrow(
      /Post does not exist/,
    );
  });
});

describe('normalizeParse and needsVideo', () => {
  const recipe = (steps: string[]) =>
    normalizeParse({
      items: [{ type: 'recipe', title: 'Pasta', summary: 's', confidence: 0.9, recipe: { ingredients: ['pasta'], steps } }],
      needs_video: false,
    });

  it('accepts a complete caption parse', () => {
    expect(needsVideo(recipe(['boil']), 0.7)).toBeNull();
  });

  it('asks for the video when a recipe has no steps', () => {
    expect(needsVideo(recipe([]), 0.7)).toMatch(/missing/);
  });

  it('asks for the video on low confidence or empty results', () => {
    expect(needsVideo(normalizeParse({ items: [{ type: 'idea', title: 'x', confidence: 0.3 }] }), 0.7)).toMatch(/low/);
    expect(needsVideo(normalizeParse({ items: [] }), 0.7)).toMatch(/nothing/);
  });

  it('always uses the video for ideas, even with a confident caption parse', () => {
    const idea = normalizeParse({ items: [{ type: 'idea', title: 'x', confidence: 0.95, idea: { takeaways: ['a', 'b', 'c'] } }] });
    expect(needsVideo(idea, 0.7)).toMatch(/ideas always use the video/);
  });

  it('cleans up bad model output', () => {
    const r = normalizeParse({ items: [{ type: 'bogus', title: ' A ', confidence: 7 }, { type: 'place', place: { name: 'Bar X' } }] });
    expect(r.items[0]).toMatchObject({ type: 'idea', title: 'A', confidence: 1, idea: { topic: 'Other' } });
    expect(r.items[1]).toMatchObject({ type: 'place', title: 'Bar X', confidence: 0, place: { category: 'other' } });
  });

  it('matches topics from the sheet and keeps invented ones as suggestions', () => {
    const r = normalizeParse(
      {
        items: [
          { type: 'idea', title: 'a', idea: { topic: 'clothing', takeaways: ['x'] } },
          { type: 'idea', title: 'b', idea: { topic: 'Fitness', takeaways: ['y'] } },
          { type: 'idea', title: 'c', idea: { topic: 'Other', suggested_topic: 'Skincare' } },
        ],
      },
      lists(['Clothing', 'AI']),
    );
    expect(r.items.map((i) => [i.idea?.topic, i.idea?.suggested_topic])).toEqual([
      ['Clothing', ''],
      ['Other', 'Fitness'],
      ['Other', 'Skincare'],
    ]);
  });
});

describe('guides', () => {
  it('uses an existing guide\'s spelling and keeps new names', () => {
    const r = normalizeParse(
      {
        items: [
          { type: 'idea', title: 'a', idea: { topic: 'AI', guide: ' japan ', takeaways: ['x'] } },
          { type: 'idea', title: 'b', idea: { topic: 'AI', guide: 'Workouts', takeaways: ['y'] } },
          { type: 'idea', title: 'c', idea: { topic: 'AI', takeaways: ['z'] } },
        ],
      },
      lists(['AI'], undefined, ['Japan', 'japan', '', 'Amsterdam']),
    );
    expect(r.items.map((i) => i.idea?.guide)).toEqual(['Japan', 'Workouts', '']);
  });
});

describe('topicList', () => {
  it('uses the sheet list, drops blanks and duplicates, and always ends in Other', () => {
    expect(topicList([' AI ', '', 'AI', 'other', 'Career'])).toEqual(['AI', 'Career', 'Other']);
  });

  it('falls back to the defaults when the sheet has none', () => {
    expect(topicList(undefined)).toEqual([...DEFAULT_TOPICS, 'Other']);
    expect(placeTypeList([])).toEqual([...DEFAULT_PLACE_TYPES, 'other']);
  });
});

describe('place types', () => {
  it('maps a category onto the sheet list; an invented one becomes the specialty', () => {
    const r = normalizeParse(
      {
        items: [
          { type: 'place', title: 'A', place: { name: 'A', category: 'Home & Ceramics', specialty: 'pottery shop' } },
          { type: 'place', title: 'B', place: { name: 'B', category: 'ceramics and glassware store' } },
        ],
      },
      lists(undefined, ['home & ceramics', 'cafe']),
    );
    expect(r.items.map((i) => [i.place?.category, i.place?.specialty])).toEqual([
      ['home & ceramics', 'pottery shop'],
      ['other', 'ceramics and glassware store'],
    ]);
  });
});

describe('rows', () => {
  const base = { savedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://u', post: { caption: '', creator: 'c', videoUrl: '', imageUrls: [], thumbnailUrl: 't' } };

  it('writes a place row with enrichment, taking the country from the address', () => {
    const [item] = normalizeParse({
      items: [{ type: 'place', title: 'Joe', summary: 's', confidence: 1, place: { name: 'Joe', city: 'Tokyo', category: 'Restaurant', specialty: 'pizza by the slice', what_to_order: 'slice' } }],
    }).items;
    const row = itemRow(base, item, { placeId: 'P1', address: '1-2 Shibuya, Tokyo 150-0002, Japan', lat: 1, lng: 2, mapsUrl: 'https://m' });
    expect(row).toMatchObject({
      type: 'place', title: 'Joe', city: 'Tokyo', country: 'Japan', address: '1-2 Shibuya, Tokyo 150-0002, Japan',
      lat: 1, lng: 2, maps_url: 'https://m', place_id: 'P1', category: 'restaurant', specialty: 'pizza by the slice', what_to_order: 'slice', creator: '@c',
    });
  });

  it('writes an idea row with takeaways and mentions', () => {
    const [item] = normalizeParse(
      {
        items: [
          { type: 'idea', title: 'Editing', confidence: 1, idea: { topic: 'Video editing', takeaways: ['Cut on beat', 'Use J-cuts'], mentioned: ['CapCut', 'Premiere'] } },
        ],
      },
      lists(['Video editing']),
    ).items;
    expect(itemRow(base, item)).toMatchObject({
      type: 'idea', topic: 'Video editing', suggested_topic: '', takeaways: '• Cut on beat\n• Use J-cuts', mentioned: 'CapCut, Premiere',
    });
  });

  it('only takes a country from the address when it has no digits', () => {
    expect(countryFromAddress('Prinsengracht 1, 1015 DZ Amsterdam, Netherlands')).toBe('Netherlands');
    expect(countryFromAddress('123 Main St, Springfield 12345')).toBe('');
    expect(countryFromAddress('')).toBe('');
  });

  it('summarizes for the notification', () => {
    const items = normalizeParse({
      items: ['A', 'B', 'C', 'D'].map((t) => ({ type: 'place', title: t, confidence: 1, place: { name: t } })),
    }).items;
    expect(summarize(items.slice(0, 1))).toBe('Saved place: A');
    expect(summarize(items)).toBe('Saved 4 places: A, B, C, +1 more');
  });
});

describe('mentions', () => {
  const base = { savedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://u', post: { caption: '', creator: 'egg', videoUrl: '', imageUrls: [], thumbnailUrl: 't' } };
  const parsed = normalizeParse(
    {
      items: [
        {
          type: 'idea',
          title: 'Inexpensive Hair Products',
          confidence: 1,
          idea: {
            topic: 'beauty',
            takeaways: ['x'],
            mentioned: [
              { name: 'Tea Tree & Rosemary Shampoo', kind: 'Product', brand: 'Renpure', why: 'helps an itchy scalp', price: '$8' },
              { name: 'CapCut', kind: 'app/tool', brand: '', why: '', price: '' },
              { name: 'Mystery', kind: 'gadget' },
              { name: '', kind: 'product' },
            ],
          },
        },
      ],
    },
    lists(['Beauty']),
  );
  const [item] = parsed.items;

  it('keeps structured mentions, normalizes kind, and drops nameless ones', () => {
    expect(item.idea?.mentioned.map((m) => [m.name, m.kind])).toEqual([
      ['Tea Tree & Rosemary Shampoo', 'product'],
      ['CapCut', 'app/tool'],
      ['Mystery', 'product'],
    ]);
    expect(itemRow(base, item).mentioned).toBe('Tea Tree & Rosemary Shampoo, CapCut, Mystery');
  });

  it('writes one Mentions row per mention with a search link and the save it came from', () => {
    const rows = mentionRows(base, item);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      type: 'mention', status: 'want', name: 'Tea Tree & Rosemary Shampoo', kind: 'product', brand: 'Renpure',
      why: 'helps an itchy scalp', price: '$8', topic: 'Beauty', from: 'Inexpensive Hair Products', creator: '@egg', source_url: 'https://u',
      shop_link: 'https://www.google.com/search?tbm=shop&q=Renpure%20Tea%20Tree%20%26%20Rosemary%20Shampoo',
    });
  });

  it('uses Google Shopping for products and a web search for everything else', () => {
    expect(shopLink({ name: 'CapCut', kind: 'app/tool', brand: '', why: '', price: '' })).toBe('https://www.google.com/search?q=CapCut%20app');
    expect(shopLink({ name: 'Delta app', kind: 'app/tool', brand: 'Delta', why: '', price: '' })).toBe('https://www.google.com/search?q=Delta%20app');
    expect(shopLink({ name: 'YesStyle Store', kind: 'store', brand: '', why: '', price: '' })).toBe('https://www.google.com/search?q=YesStyle%20Store');
    expect(shopLink({ name: 'Atomic Habits', kind: 'book', brand: '', why: '', price: '' })).toBe(
      'https://www.google.com/search?q=Atomic%20Habits%20book',
    );
    expect(shopLink({ name: 'Renpure Shampoo', kind: 'product', brand: 'Renpure', why: '', price: '' })).toBe(
      'https://www.google.com/search?tbm=shop&q=Renpure%20Shampoo',
    );
  });

  it('has no mentions for places and recipes', () => {
    const [place] = normalizeParse({ items: [{ type: 'place', title: 'A', place: { name: 'A' } }] }).items;
    expect(mentionRows(base, place)).toEqual([]);
  });
});

describe('placeholders and place names', () => {
  it('blanks "Not specified" and the like instead of saving them', () => {
    const { items } = normalizeParse({
      items: [
        { type: 'recipe', title: 'Soup', confidence: 1, recipe: { ingredients: ['leeks', 'N/A'], steps: ['boil'], servings: 'Not specified', time: 'Unknown.' } },
        { type: 'place', title: 'JINS', confidence: 1, place: { name: 'JINS', city: 'Various', country: 'United States', what_to_order: 'not mentioned' } },
      ],
    });
    expect(items[0].recipe).toEqual({ ingredients: ['leeks'], steps: ['boil'], servings: '', time: '' });
    expect(items[1].place).toMatchObject({ city: '', country: 'USA', what_to_order: '' });
    // An empty city now means the video gets a look.
    expect(needsVideo({ items: [items[1]], needs_video: false, just_for_fun: false }, 0.7)).toMatch(/city/);
  });

  it('spells countries one way', () => {
    expect(['United States', 'US', 'United Kingdom', 'Japan'].map(countryName)).toEqual(['USA', 'USA', 'UK', 'Japan']);
  });

  it('reads city and country from Google, with Tokyo wards as Tokyo', () => {
    const part = (longText: string, ...types: string[]) => ({ longText, types });
    expect(cityAndCountry([part('Shibuya City', 'locality'), part('Tokyo', 'administrative_area_level_1'), part('Japan', 'country')]))
      .toEqual({ city: 'Tokyo', country: 'Japan' });
    expect(cityAndCountry([part('Amsterdam', 'locality'), part('Netherlands', 'country')])).toEqual({ city: 'Amsterdam', country: 'Netherlands' });
    expect(cityAndCountry([part('New York', 'locality'), part('United States', 'country')])).toEqual({ city: 'New York', country: 'USA' });
    expect(cityAndCountry(undefined)).toEqual({ city: '', country: '' });
  });

  it("prefers Google's country and the post's city", () => {
    const base = { savedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://u' };
    const [item] = normalizeParse({ items: [{ type: 'place', title: 'Joe', confidence: 1, place: { name: 'Joe', city: 'New York City', country: 'America' } }] }).items;
    const match = { placeId: 'P', city: 'New York', country: 'USA', address: '1 Main St, New York, NY 10001, USA', lat: 1, lng: 2, mapsUrl: 'https://m' };
    expect(itemRow(base, item, match)).toMatchObject({ city: 'New York City', country: 'USA' });
    const [noCity] = normalizeParse({ items: [{ type: 'place', title: 'Joe', confidence: 1, place: { name: 'Joe' } }] }).items;
    expect(itemRow(base, noCity, match)).toMatchObject({ city: 'New York', country: 'USA' });
  });

  it('turns a Google error body into one line', () => {
    const body = JSON.stringify({ error: { code: 503, message: 'This model is currently\n experiencing high demand.', status: 'UNAVAILABLE' } }, null, 2);
    expect(apiError(body)).toBe('UNAVAILABLE: This model is currently experiencing high demand.');
    expect(apiError('<html>\n oops')).toBe('<html> oops');
  });
});
