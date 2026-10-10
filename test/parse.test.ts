import { describe, expect, it } from 'vitest';
import { normalizeItem } from '../src/apify.js';
import { PermanentError } from '../src/errors.js';
import { needsVideo, normalizeParse } from '../src/gemini.js';
import { itemRow, summarize } from '../src/rows.js';

describe('normalizeItem', () => {
  it('maps Instagram fields', () => {
    expect(
      normalizeItem('instagram', [{ caption: 'yum', ownerUsername: 'chef', videoUrl: 'https://v', displayUrl: 'https://t' }]),
    ).toEqual({ caption: 'yum', creator: 'chef', videoUrl: 'https://v', thumbnailUrl: 'https://t' });
  });

  it('maps TikTok fields, preferring the downloaded video', () => {
    const post = normalizeItem('tiktok', [
      { text: 'hi', authorMeta: { name: 'joe' }, mediaUrls: ['https://apify/v.mp4'], videoMeta: { coverUrl: 'https://c' } },
    ]);
    expect(post).toEqual({ caption: 'hi', creator: 'joe', videoUrl: 'https://apify/v.mp4', thumbnailUrl: 'https://c' });
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
    expect(needsVideo(normalizeParse({ items: [{ type: 'recommendation', title: 'x', confidence: 0.3 }] }), 0.7)).toMatch(/low/);
    expect(needsVideo(normalizeParse({ items: [] }), 0.7)).toMatch(/nothing/);
  });

  it('cleans up bad model output', () => {
    const r = normalizeParse({ items: [{ type: 'bogus', title: ' A ', confidence: 7 }, { type: 'place', place: { name: 'Bar X' } }] });
    expect(r.items[0]).toMatchObject({ type: 'recommendation', title: 'A', confidence: 1 });
    expect(r.items[1]).toMatchObject({ type: 'place', title: 'Bar X', confidence: 0 });
  });
});

describe('rows', () => {
  const base = { savedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://u', post: { caption: '', creator: 'c', videoUrl: '', thumbnailUrl: 't' } };

  it('writes a place row with enrichment', () => {
    const [item] = normalizeParse({
      items: [{ type: 'place', title: 'Joe', summary: 's', confidence: 1, place: { name: 'Joe', city: 'NYC', category: 'pizza', what_to_order: 'slice' } }],
    }).items;
    const row = itemRow(base, item, { placeId: 'P1', address: '1 St', lat: 1, lng: 2, mapsUrl: 'https://m' });
    expect(row).toMatchObject({
      type: 'place', place_name: 'Joe', place_city: 'NYC', place_address: '1 St', lat: 1, lng: 2,
      maps_url: 'https://m', place_id: 'P1', category: 'pizza', details: 'Order: slice', creator: '@c', status: 'to try',
    });
  });

  it('summarizes for the notification', () => {
    const items = normalizeParse({
      items: ['A', 'B', 'C', 'D'].map((t) => ({ type: 'place', title: t, confidence: 1, place: { name: t } })),
    }).items;
    expect(summarize(items.slice(0, 1))).toBe('Saved place: A');
    expect(summarize(items)).toBe('Saved 4 places: A, B, C, +1 more');
  });
});
