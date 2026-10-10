import { describe, expect, it } from 'vitest';
import { normalizeItem } from '../src/apify.js';
import { PermanentError } from '../src/errors.js';
import { needsVideo, normalizeParse } from '../src/gemini.js';
import { countryFromAddress, itemRow, summarize } from '../src/rows.js';
import { DEFAULT_TOPICS, topicList } from '../src/topics.js';

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
    const topics = ['Clothing', 'AI', 'Other'];
    const r = normalizeParse(
      {
        items: [
          { type: 'idea', title: 'a', idea: { topic: 'clothing', takeaways: ['x'] } },
          { type: 'idea', title: 'b', idea: { topic: 'Fitness', takeaways: ['y'] } },
          { type: 'idea', title: 'c', idea: { topic: 'Other', suggested_topic: 'Skincare' } },
        ],
      },
      topics,
    );
    expect(r.items.map((i) => [i.idea?.topic, i.idea?.suggested_topic])).toEqual([
      ['Clothing', ''],
      ['Other', 'Fitness'],
      ['Other', 'Skincare'],
    ]);
  });
});

describe('topicList', () => {
  it('uses the sheet list, drops blanks and duplicates, and always ends in Other', () => {
    expect(topicList([' AI ', '', 'AI', 'other', 'Career'])).toEqual(['AI', 'Career', 'Other']);
  });

  it('falls back to the defaults when the sheet has none', () => {
    expect(topicList(undefined)).toEqual([...DEFAULT_TOPICS, 'Other']);
  });
});

describe('rows', () => {
  const base = { savedAt: '2026-10-10T00:00:00Z', sourceUrl: 'https://u', post: { caption: '', creator: 'c', videoUrl: '', thumbnailUrl: 't' } };

  it('writes a place row with enrichment, taking the country from the address', () => {
    const [item] = normalizeParse({
      items: [{ type: 'place', title: 'Joe', summary: 's', confidence: 1, place: { name: 'Joe', city: 'Tokyo', category: 'Food', what_to_order: 'slice' } }],
    }).items;
    const row = itemRow(base, item, { placeId: 'P1', address: '1-2 Shibuya, Tokyo 150-0002, Japan', lat: 1, lng: 2, mapsUrl: 'https://m' });
    expect(row).toMatchObject({
      type: 'place', title: 'Joe', city: 'Tokyo', country: 'Japan', address: '1-2 Shibuya, Tokyo 150-0002, Japan',
      lat: 1, lng: 2, maps_url: 'https://m', place_id: 'P1', category: 'food', what_to_order: 'slice', creator: '@c',
    });
  });

  it('writes an idea row with takeaways and mentions', () => {
    const [item] = normalizeParse(
      {
        items: [
          { type: 'idea', title: 'Editing', confidence: 1, idea: { topic: 'Video editing', takeaways: ['Cut on beat', 'Use J-cuts'], mentioned: ['CapCut', 'Premiere'] } },
        ],
      },
      ['Video editing', 'Other'],
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
