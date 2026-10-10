import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/cleanup-mentions.js';
import { addReviews, type CleanupPlan } from '../src/cleanup.js';

const rows = [
  { row: 2, name: 'Sensoji Temple', kind: 'product', brand: '', why: 'A landmark to visit', topic: 'Travel tips', from: 'Tokyo' },
  { row: 3, name: 'Blom Kranz', kind: 'person', brand: '', why: 'Brand of quilted bags', topic: 'Travel tips', from: 'Souvenirs' },
  { row: 4, name: 'Uniqlo', kind: 'brand', brand: '', why: 'Basics', topic: 'Clothing', from: 'Shopping' },
];

describe('addReviews', () => {
  it('turns reviews into removals and kind fixes, ignoring rows it was not sent', () => {
    const plan: CleanupPlan = { count: 3, remove: [], updates: [] };
    addReviews(plan, rows, [
      { row: 2, keep: false, kind: 'product', reason: 'a place to visit' },
      { row: 3, keep: true, kind: 'brand', reason: '' },
      { row: 4, keep: true, kind: 'brand', reason: '' },
      { row: 99, keep: false, kind: 'brand', reason: 'not ours' },
      { row: 2, keep: true, kind: 'brand', reason: 'second answer for the same row' },
    ]);
    expect(plan.remove).toEqual([{ row: 2, name: 'Sensoji Temple', reason: 'a place to visit' }]);
    expect(plan.updates).toEqual([
      { row: 3, name: 'Blom Kranz', from_kind: 'person', kind: 'brand', shop_link: 'https://www.google.com/search?tbm=shop&q=Blom%20Kranz' },
    ]);
  });

  it('leaves rows alone when the review is missing or the kind is unknown', () => {
    const plan: CleanupPlan = { count: 3, remove: [], updates: [] };
    addReviews(plan, rows, [{ row: 3, keep: true, kind: 'gadget' }]);
    expect(plan).toEqual({ count: 3, remove: [], updates: [] });
  });
});

const post = (body: unknown) =>
  POST(new Request('https://x/api/cleanup-mentions', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/cleanup-mentions', () => {
  afterEach(() => vi.unstubAllGlobals());
  Object.assign(process.env, { SECRET: 'sek', APIFY_TOKEN: 'a', GEMINI_API_KEY: 'g', SHEET_URL: 'https://sheet.test/exec' });

  it('rejects a wrong secret', async () => {
    expect((await post({ secret: 'nope' })).status).toBe(401);
  });

  it('previews: reads the tab, reviews it, and asks the Sheet for a dry run', async () => {
    const sheetCalls: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).includes(':generateContent')) {
        const reviews = [{ row: 2, keep: false, kind: 'product', reason: 'place' }, { row: 3, keep: true, kind: 'brand', reason: '' }];
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ reviews }) }] } }] });
      }
      sheetCalls.push(body);
      if (body.action === 'mentions') return Response.json({ ok: true, count: 3, rows });
      return Response.json({ ok: true, before: 3, removed: 1, after: 2, merged: [] });
    });
    const res = await (await post({ secret: 'sek' })).json();
    expect(res.applied).toBe(false);
    expect(res.plan.remove.map((r: any) => r.row)).toEqual([2]);
    expect(sheetCalls.at(-1)).toMatchObject({ action: 'cleanMentions', count: 3, remove: [2], dry_run: true });
  });

  it('applies a plan as given, without asking Gemini again', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ action: 'cleanMentions', count: 3, remove: [2], dry_run: false });
      return Response.json({ ok: true, before: 3, removed: 1, after: 2, merged: [] });
    });
    const plan = { count: 3, remove: [{ row: 2, name: 'x', reason: 'y' }], updates: [] };
    const res = await (await post({ secret: 'sek', plan })).json();
    expect(res).toMatchObject({ ok: true, applied: true, after: 2 });
    expect(calls).toEqual(['https://sheet.test/exec']);
  });
});
