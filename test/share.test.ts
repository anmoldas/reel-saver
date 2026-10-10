import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../api/share.js';

const post = (body: unknown) => POST(new Request('https://x/api/share', { method: 'POST', body: JSON.stringify(body) }));
let sheet: any[];

beforeEach(() => {
  Object.assign(process.env, { SECRET: 'sek', APIFY_TOKEN: 'a', GEMINI_API_KEY: 'g', PLACES_API_KEY: 'p', SHEET_URL: 'https://sheet.test/exec' });
  sheet = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sheet.push(body);
    const exists = body.action === 'check' && body.source_url.includes('DUPE');
    return new Response(JSON.stringify({ ok: true, exists, title: 'Old save', written: 1 }));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/share', () => {
  it('rejects a wrong secret', async () => {
    expect((await post({ url: 'https://www.instagram.com/reel/A/', secret: 'nope' })).status).toBe(401);
  });

  it('reports duplicates without reprocessing', async () => {
    const res = await (await post({ url: 'https://www.instagram.com/reel/DUPE/?igsh=1', secret: 'sek' })).json();
    expect(res).toMatchObject({ ok: true, duplicate: true, message: 'Already saved: Old save' });
    expect(sheet.map((c) => c.action)).toEqual(['check']);
  });

  it('writes a stub row', async () => {
    const res = await (await post({ url: 'look https://www.instagram.com/reel/NEW/', secret: 'sek', stub: true })).json();
    expect(res.message).toBe('Stub row written for https://www.instagram.com/reel/NEW/');
    expect(sheet[1]).toMatchObject({ action: 'write', secret: 'sek', rows: [{ title: 'Stub row' }] });
  });

  it('writes a failed row for unsupported links', async () => {
    const res = await (await post({ url: 'https://youtube.com/shorts/x', secret: 'sek' })).json();
    expect(res.ok).toBe(false);
    expect(sheet[0].rows[0]).toMatchObject({ type: 'failed', source_url: 'https://youtube.com/shorts/x' });
  });
});
