import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from '../src/env.js';
import { runPipeline } from '../src/pipeline.js';
import { lists } from '../src/topics.js';

const env = getEnv({ SECRET: 's', APIFY_TOKEN: 'a', GEMINI_API_KEY: 'g', PLACES_API_KEY: 'p', SHEET_URL: 'https://sheet.test/exec' });
const params = { url: 'https://www.instagram.com/reel/ABC/', platform: 'instagram' as const, savedAt: '2026-10-10T00:00:00Z', lists: lists() };

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

function gemini(result: unknown) {
  return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] });
}

/** Routes fetch calls to fake services and records what the sheet received. */
function fakeServices(opts: { caption: string; captionParse: unknown; videoParse?: unknown; apifyItem?: unknown }) {
  const sheetWrites: any[] = [];
  const calls: string[] = [];
  let geminiCalls = 0;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.apify.com') && url.includes('/runs')) return ok({ data: { id: 'run1', defaultDatasetId: 'ds1' } });
    if (url.includes('/actor-runs/')) return ok({ data: { status: 'SUCCEEDED' } });
    if (url.includes('/datasets/'))
      return ok([opts.apifyItem ?? { caption: opts.caption, ownerUsername: 'chef', videoUrl: 'https://cdn/v.mp4', displayUrl: 'https://cdn/t.jpg' }]);
    if (url === 'https://cdn/v.mp4') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    if (url.includes('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.test/1' } });
    if (url === 'https://upload.test/1') return ok({ file: { name: 'files/1', uri: 'https://g/files/1', state: 'ACTIVE', mimeType: 'video/mp4' } });
    if (url.includes('/v1beta/files/1')) return ok({});
    if (url.includes(':generateContent')) return gemini(geminiCalls++ === 0 ? opts.captionParse : opts.videoParse);
    if (url.includes('places.googleapis.com'))
      return ok({ places: [{ id: 'PID', formattedAddress: '1 Main St', location: { latitude: 40, longitude: -73 } }] });
    if (url === env.SHEET_URL) {
      const body = JSON.parse(String(init?.body));
      sheetWrites.push(body);
      return ok({ ok: true, written: body.rows?.length ?? 0 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { sheetWrites, calls, geminiCalls: () => geminiCalls };
}

afterEach(() => vi.unstubAllGlobals());

describe('runPipeline', () => {
  it('saves several places from the caption without touching the video', async () => {
    const svc = fakeServices({
      caption: 'Best tacos in Austin: Veracruz and Suerte',
      captionParse: {
        needs_video: false,
        items: ['Veracruz', 'Suerte'].map((n) => ({
          type: 'place', title: n, summary: 'tacos', confidence: 0.9,
          place: { name: n, city: 'Austin', category: 'tacos', what_to_order: '' },
        })),
      },
    });
    const result = await runPipeline(env, params);
    expect(result).toEqual({ ok: true, message: 'Saved 2 places: Veracruz, Suerte' });
    expect(svc.geminiCalls()).toBe(1);
    expect(svc.calls.some((u) => u.includes('upload'))).toBe(false);
    const rows = svc.sheetWrites[0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ type: 'place', title: 'Veracruz', city: 'Austin', place_id: 'PID', lat: 40, lng: -73, creator: '@chef' });
  });

  it('falls back to the video when the caption lacks steps', async () => {
    const svc = fakeServices({
      caption: 'Easy pasta 🍝',
      captionParse: { needs_video: true, items: [{ type: 'recipe', title: 'Pasta', summary: '', confidence: 0.4, recipe: { ingredients: [], steps: [] } }] },
      videoParse: {
        needs_video: false,
        items: [{ type: 'recipe', title: 'Garlic pasta', summary: 'quick', confidence: 0.9, recipe: { ingredients: ['pasta', 'garlic'], steps: ['boil', 'toss'], servings: '2', time: '15 min' } }],
      },
    });
    const result = await runPipeline(env, params);
    expect(result.message).toBe('Saved recipe: Garlic pasta');
    expect(svc.geminiCalls()).toBe(2);
    expect(svc.sheetWrites[0].rows[0]).toMatchObject({
      ingredients: '• pasta\n• garlic', steps: '1. boil\n2. toss', servings: '2', time: '15 min',
    });
  });

  it('writes a failed row for a private post', async () => {
    const svc = fakeServices({ caption: '', captionParse: {}, apifyItem: { error: 'not_found', errorDescription: 'Private profile' } });
    const result = await runPipeline(env, params);
    expect(result.ok).toBe(false);
    expect(svc.sheetWrites[0].rows[0]).toMatchObject({ type: 'failed', error: 'Post unavailable: Private profile', source_url: params.url });
  });

  it('writes a failed row when it runs out of time', async () => {
    const svc = fakeServices({ caption: 'x', captionParse: {} });
    const slow = globalThis.fetch;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => {
      if (String(u).includes('/actor-runs/')) await new Promise((r) => setTimeout(r, 200));
      return slow(u, i);
    });
    const result = await runPipeline(env, params, 50);
    expect(result.message).toMatch(/Timed out/);
    expect(svc.sheetWrites.at(-1).rows[0].type).toBe('failed');
  });
});

describe('video download', () => {
  it('sends the Apify token when the video is stored in Apify', async () => {
    const seen: Record<string, string | null> = {};
    const svc = fakeServices({
      caption: '',
      // No caption means the first (and only) Gemini call is the video one.
      captionParse: { needs_video: false, items: [{ type: 'idea', title: 'Thing', summary: '', confidence: 0.9, idea: { topic: 'Other', takeaways: ['y'] } }] },
      apifyItem: { text: '', authorMeta: { name: 'a' }, mediaUrls: ['https://api.apify.com/v2/key-value-stores/s/records/v'] },
    });
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
      if (String(u).startsWith('https://api.apify.com/v2/key-value-stores/')) {
        seen.auth = new Headers(init?.headers).get('authorization');
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'video/mp4' } });
      }
      return inner(u, init);
    });
    const result = await runPipeline(env, { ...params, platform: 'tiktok' });
    expect(seen.auth).toBe('Bearer a');
    expect(result.message).toBe('Saved idea: Thing');
    expect(svc.geminiCalls()).toBe(1); // no caption, so straight to the video
  });
});
