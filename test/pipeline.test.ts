import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from '../src/env.js';
import { retryDelaysMs } from '../src/errors.js';
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
function fakeServices(opts: { caption: string; captionParse: unknown; videoParse?: unknown; guideParse?: unknown; guideVideos?: unknown[]; apifyItem?: unknown }) {
  const sheetWrites: any[] = [];
  const calls: string[] = [];
  const geminiBodies: any[] = [];
  let geminiCalls = 0;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.apify.com') && url.includes('/runs')) return ok({ data: { id: 'run1', defaultDatasetId: 'ds1' } });
    if (url.includes('/actor-runs/')) return ok({ data: { status: 'SUCCEEDED' } });
    if (url.includes('/datasets/'))
      return ok([opts.apifyItem ?? { caption: opts.caption, ownerUsername: 'chef', videoUrl: 'https://cdn/v.mp4', displayUrl: 'https://cdn/t.jpg' }]);
    if (url.startsWith('https://cdn/img')) {
      if (url.includes('broken')) return new Response('nope', { status: 404 });
      return new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'image/png' } });
    }
    if (url === 'https://cdn/v.mp4') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } });
    if (url.includes('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.test/1' } });
    if (url === 'https://upload.test/1') return ok({ file: { name: 'files/1', uri: 'https://g/files/1', state: 'ACTIVE', mimeType: 'video/mp4' } });
    if (url.includes('/v1beta/files/1')) return ok({});
    if (url.includes(':generateContent')) geminiBodies.push(JSON.parse(String(init?.body)));
    if (url.includes(':generateContent')) {
      const n = geminiCalls++;
      return gemini(n === 0 ? opts.captionParse : n === 1 ? opts.videoParse : opts.guideParse);
    }
    if (url.includes('places.googleapis.com'))
      return ok({ places: [{ id: 'PID', formattedAddress: '1 Main St', location: { latitude: 40, longitude: -73 } }] });
    if (url === env.SHEET_URL) {
      const body = JSON.parse(String(init?.body));
      sheetWrites.push(body);
      if (body.action === 'guideVideos') return ok({ ok: true, videos: opts.guideVideos ?? [] });
      return ok({ ok: true, written: body.rows?.length ?? 0 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { sheetWrites, calls, geminiBodies, geminiCalls: () => geminiCalls };
}

retryDelaysMs.splice(0, retryDelaysMs.length, 0, 0);
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

  it('skips a just-for-fun post without watching the video or writing a row, clearing an earlier failure', async () => {
    const svc = fakeServices({ caption: 'when your cat hears the treat bag 😂', captionParse: { needs_video: false, just_for_fun: true, items: [] } });
    const result = await runPipeline(env, params);
    expect(result).toEqual({ ok: true, skipped: true, message: 'Skipped: just for fun, nothing to save' });
    expect(svc.geminiCalls()).toBe(1);
    expect(svc.sheetWrites).toEqual([{ secret: 's', action: 'write', source_url: params.url, rows: [] }]);
  });

  it('watches the video before deciding a post is just for fun', async () => {
    const svc = fakeServices({
      caption: '😂😂',
      captionParse: { needs_video: true, just_for_fun: false, items: [] },
      videoParse: { needs_video: false, just_for_fun: true, items: [] },
    });
    const result = await runPipeline(env, params);
    expect(result.skipped).toBe(true);
    expect(svc.geminiCalls()).toBe(2);
    expect(svc.sheetWrites.map((w) => w.rows)).toEqual([[]]);
  });

  it('keeps items even if the model also says just for fun', async () => {
    const svc = fakeServices({
      caption: 'funny but go to Veracruz in Austin',
      captionParse: {
        needs_video: false,
        just_for_fun: true,
        items: [{ type: 'place', title: 'Veracruz', summary: 'tacos', confidence: 0.9, place: { name: 'Veracruz', city: 'Austin', category: 'tacos', what_to_order: '' } }],
      },
    });
    const result = await runPipeline(env, params);
    expect(result.skipped).toBeUndefined();
    expect(svc.sheetWrites[0].rows[0]).toMatchObject({ title: 'Veracruz' });
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

  it('reads a carousel\'s images when the caption is not enough', async () => {
    const svc = fakeServices({
      caption: '5 money tips 👇',
      apifyItem: { caption: '5 money tips 👇', ownerUsername: 'mm', type: 'Sidecar', images: ['https://cdn/img1', 'https://cdn/img-broken', 'https://cdn/img3'] },
      captionParse: { needs_video: true, items: [] },
      videoParse: { needs_video: false, items: [{ type: 'idea', title: 'Money tips', summary: 's', confidence: 0.9, idea: { topic: 'Other', suggested_topic: 'Finance', takeaways: ['save'], mentioned: [] } }] },
    });
    const result = await runPipeline(env, params);
    expect(result.message).toMatch(/Money tips/);
    expect(svc.calls.some((u) => u.includes('upload'))).toBe(false); // no video to upload
    const parts = svc.geminiBodies[1].contents[0].parts;
    expect(parts.filter((p: any) => p.inlineData)).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'CQk=' } },
      { inlineData: { mimeType: 'image/png', data: 'CQk=' } },
    ]);
    expect(parts.at(-1).text).toMatch(/2 image\(s\)/);
  });

  it('sends the video and the images together for a mixed carousel', async () => {
    const svc = fakeServices({
      caption: 'outfits',
      apifyItem: { caption: 'outfits', ownerUsername: 'mm', type: 'Sidecar', videoUrl: 'https://cdn/v.mp4', childPosts: [{ type: 'Video', displayUrl: 'https://cdn/cover' }, { type: 'Image', displayUrl: 'https://cdn/img2' }] },
      captionParse: { needs_video: true, items: [] },
      videoParse: { needs_video: false, items: [{ type: 'idea', title: 'Outfits', summary: 's', confidence: 0.9, idea: { topic: 'Clothing', suggested_topic: '', takeaways: ['x'], mentioned: [] } }] },
    });
    await runPipeline(env, params);
    const parts = svc.geminiBodies[1].contents[0].parts;
    expect(parts[0].fileData).toBeDefined();
    expect(parts.filter((p: any) => p.inlineData)).toHaveLength(1);
  });

  it('fails clearly when none of the images download and the caption had nothing', async () => {
    const svc = fakeServices({
      caption: '',
      apifyItem: { caption: '', ownerUsername: 'mm', type: 'Image', displayUrl: 'https://cdn/img-broken' },
      captionParse: {},
    });
    const result = await runPipeline(env, params);
    expect(result.message).toBe("Couldn't save: Could not download the images");
    expect(svc.sheetWrites[0].rows[0].type).toBe('failed');
  });

  it('puts an import\'s note in the notes column of the saved rows only', async () => {
    const svc = fakeServices({
      caption: 'Best tacos: Veracruz in Austin',
      captionParse: { needs_video: false, items: [{ type: 'place', title: 'Veracruz', summary: 'tacos', confidence: 0.9, place: { name: 'Veracruz', city: 'Austin', category: 'restaurant', what_to_order: '' } }] },
    });
    await runPipeline(env, { ...params, note: 'IG collection: Food' });
    expect(svc.sheetWrites[0].rows[0]).toMatchObject({ title: 'Veracruz', notes: 'IG collection: Food' });
  });

  it('tries Gemini again when it is briefly overloaded', async () => {
    const svc = fakeServices({
      caption: 'Best tacos: Veracruz in Austin',
      captionParse: { needs_video: false, items: [{ type: 'place', title: 'Veracruz', summary: 'tacos', confidence: 0.9, place: { name: 'Veracruz', city: 'Austin', category: 'restaurant', what_to_order: '' } }] },
    });
    const real = globalThis.fetch;
    let busy = 1;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => {
      if (String(u).includes(':generateContent') && busy-- > 0) return new Response('{"error":{"code":503}}', { status: 503 });
      return real(u, i);
    });
    const result = await runPipeline(env, params);
    expect(result.message).toBe('Saved place: Veracruz');
    expect(svc.sheetWrites[0].rows[0].title).toBe('Veracruz');
  });

  it('gives up on Gemini after the retries', async () => {
    fakeServices({ caption: 'x', captionParse: {} });
    const real = globalThis.fetch;
    let tries = 0;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => {
      if (String(u).includes(':generateContent')) {
        tries++;
        return new Response('{"error":{"code":503}}', { status: 503 });
      }
      return real(u, i);
    });
    const result = await runPipeline(env, params);
    expect(result.message).toMatch(/^Couldn't save: Gemini 503/);
    expect(tries).toBe(3);
  });

  it('does not retry a Gemini error that will not pass', async () => {
    fakeServices({ caption: 'x', captionParse: {} });
    const real = globalThis.fetch;
    let tries = 0;
    vi.stubGlobal('fetch', async (u: string, i?: RequestInit) => {
      if (String(u).includes(':generateContent')) {
        tries++;
        return new Response('{"error":{"code":400}}', { status: 400 });
      }
      return real(u, i);
    });
    await runPipeline(env, params);
    expect(tries).toBe(1);
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

describe('guides', () => {
  const idea = (guide: string) => ({
    needs_video: false,
    items: [{ type: 'idea', title: 'Kyoto tips', summary: 's', confidence: 0.9, idea: { topic: 'Travel tips', guide, takeaways: ['Go early'], mentioned: [] } }],
  });
  const videos = [
    { title: 'Kyoto tips', takeaways: '• Go early', creator: '@a', source_url: 'u1' },
    { title: 'Japan tips', takeaways: '• Get a Suica', creator: '@b', source_url: 'u2' },
  ];

  it('rewrites the guide from all its videos after saving an idea', async () => {
    const svc = fakeServices({
      caption: 'kyoto',
      captionParse: idea('japan'),
      videoParse: idea('japan'),
      guideParse: { summary: 'Japan trip notes', sections: [{ heading: '', points: ['Go early', 'Get a Suica'] }] },
      guideVideos: videos,
    });
    const run = { ...params, lists: lists(undefined, undefined, ['Japan', 'Amsterdam']) };
    const result = await runPipeline(env, run);
    expect(result.message).toBe('Saved idea: Kyoto tips');
    expect(svc.geminiBodies[0].systemInstruction.parts[0].text).toContain('"Japan", "Amsterdam"');
    expect(svc.sheetWrites.map((b) => b.action)).toEqual(['write', 'guideVideos', 'writeGuide']);
    expect(svc.sheetWrites[0].rows[0].guide).toBe('Japan'); // the existing spelling
    expect(svc.sheetWrites[2]).toMatchObject({ guide: 'Japan', summary: 'Japan trip notes', takeaways: '• Go early\n• Get a Suica' });
  });

  it('does not combine a guide that has only this video', async () => {
    const svc = fakeServices({ caption: 'k', captionParse: idea('Kyoto'), videoParse: idea('Kyoto'), guideVideos: videos.slice(0, 1) });
    await runPipeline(env, params);
    expect(svc.geminiCalls()).toBe(2);
    expect(svc.sheetWrites.at(-1)).toMatchObject({ action: 'writeGuide', guide: 'Kyoto', takeaways: '' });
  });

  it('leaves guides alone for imports, and a guide failure does not fail the save', async () => {
    const opts = { caption: 'k', captionParse: idea('Japan'), videoParse: idea('Japan'), guideVideos: videos, guideParse: 'not json' };
    const svc = fakeServices(opts);
    expect((await runPipeline(env, { ...params, skipGuides: true })).message).toBe('Saved idea: Kyoto tips');
    expect(svc.sheetWrites.map((b) => b.action)).toEqual(['write']);
    const broken = fakeServices(opts);
    expect(await runPipeline(env, params)).toEqual({ ok: true, message: 'Saved idea: Kyoto tips' });
    expect(broken.sheetWrites.map((b) => b.action)).toEqual(['write', 'guideVideos']);
  });
});

describe('video download', () => {
  it('sends the Apify token when the video is stored in Apify', async () => {
    const seen: Record<string, string | null> = {};
    const svc = fakeServices({
      caption: '',
      // No caption means the first (and only) Gemini call is the video one.
      captionParse: { needs_video: false, items: [{ type: 'idea', title: 'Thing', summary: '', confidence: 0.9, idea: { topic: 'Other', takeaways: ['y'], mentioned: [{ name: 'CapCut', kind: 'app/tool' }] } }] },
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
    // The idea and its mention go to the sheet in one write.
    expect(svc.sheetWrites.at(-1).rows.map((r: any) => [r.type, r.title ?? r.name])).toEqual([
      ['idea', 'Thing'],
      ['mention', 'CapCut'],
    ]);
  });
});

describe('without a Places key', () => {
  it('still saves places, with a Maps search link and no lookup', async () => {
    const svc = fakeServices({
      caption: 'Try Veracruz in Austin',
      captionParse: {
        needs_video: false,
        items: [{ type: 'place', title: 'Veracruz', summary: '', confidence: 0.9, place: { name: 'Veracruz', city: 'Austin', category: 'restaurant' } }],
      },
    });
    const noPlaces = getEnv({ SECRET: 's', APIFY_TOKEN: 'a', GEMINI_API_KEY: 'g', SHEET_URL: 'https://sheet.test/exec' });
    const result = await runPipeline(noPlaces, params);
    expect(result.message).toBe('Saved place: Veracruz');
    expect(svc.calls.some((u) => u.includes('places.googleapis.com'))).toBe(false);
    expect(svc.sheetWrites[0].rows[0]).toMatchObject({
      maps_url: 'https://www.google.com/maps/search/?api=1&query=Veracruz%2C%20Austin',
    });
    expect(svc.sheetWrites[0].rows[0].place_id).toBeUndefined();
  });
});
