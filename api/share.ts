import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { runPipeline } from '../src/pipeline.js';
import { failedRow } from '../src/rows.js';
import { findExisting, writeRows } from '../src/sheet.js';
import { lists as listsFrom } from '../src/topics.js';
import { extractUrl, resolvePostUrl } from '../src/urls.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function secretMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export function GET(): Response {
  return json({ ok: true, service: 'reel-saver' });
}

/** POST { url, secret, saved_at?, wait?, note? } from the iOS Shortcut or an import script. Always answers with { ok, message }. */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (err) {
    console.log(`[reel-saver] request failed: ${errorMessage(err)}`);
    return json({ ok: false, message: `Error: ${errorMessage(err)}` }, 500);
  }
}

async function handle(request: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
  const body = await readBody(request);
  if (!secretMatches(body.secret ?? request.headers.get('x-secret'), env.SECRET)) {
    return json({ ok: false, message: 'Wrong secret' }, 401);
  }

  const raw = extractUrl(String(body.url ?? body.text ?? ''));
  if (!raw) return json({ ok: false, message: 'No link found in what was shared' }, 400);
  // Imports pass the original save date (e.g. from a TikTok data export); the Shortcut does not.
  const givenDate = typeof body.saved_at === 'string' ? new Date(body.saved_at) : null;
  const savedAt = (givenDate && !isNaN(givenDate.getTime()) ? givenDate : new Date()).toISOString();

  // Resolve short links so duplicates are detected on one canonical URL.
  let resolved;
  try {
    resolved = await resolvePostUrl(raw);
  } catch (err) {
    const message = errorMessage(err);
    await writeRows(env, raw, [failedRow({ savedAt, sourceUrl: raw }, message)]).catch(() => undefined);
    return json({ ok: false, message: `Couldn't save: ${message}` });
  }
  const { url, platform } = resolved;

  let lists = listsFrom();
  try {
    const existing = await findExisting(env, url);
    if (existing.exists) return json({ ok: true, duplicate: true, message: `Already saved: ${existing.title ?? url}` });
    lists = listsFrom(existing.topics, existing.place_types);
  } catch (err) {
    console.log(`[reel-saver] duplicate check failed, continuing: ${errorMessage(err)}`);
  }

  // Build step 2: `"stub": true` writes a placeholder row without calling Apify or Gemini.
  if (body.stub === true || body.stub === 'true') {
    await writeRows(env, url, [{ saved_at: savedAt, type: 'idea', topic: 'Other', title: 'Stub row', source_url: url }]);
    return json({ ok: true, message: `Stub row written for ${url}` });
  }

  // Imports can pass a short note for the notes column (e.g. "IG collection: Food").
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  const work = runPipeline(env, { url, platform, savedAt, lists, ...(note ? { note } : {}) });
  // Imports ask to wait for the real outcome, so they can stop on errors.
  if (body.wait === true || body.wait === 'true') return json(await work);

  // Keep running after we answer; wait briefly so fast saves get a real confirmation.
  waitUntil(work);
  const quick = await Promise.race([
    work,
    new Promise<null>((r) => setTimeout(() => r(null), env.SYNC_WAIT_SECONDS * 1000)),
  ]);
  return json(quick ?? { ok: true, pending: true, message: 'Saving… it will be in your sheet in a minute' });
}
