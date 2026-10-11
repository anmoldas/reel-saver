// The front door. Your iPhone Shortcut sends each shared link here (https://YOUR-APP.vercel.app/api/share),
// and so do the import and retry scripts. This file checks the secret, tidies up the link, skips posts
// you already saved, then hands the real work to src/pipeline.ts.

import { waitUntil } from '@vercel/functions';
import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { secretMatches } from '../src/secret.js';
import { runPipeline } from '../src/pipeline.js';
import { failedRow } from '../src/rows.js';
import { findExisting, writeRows } from '../src/sheet.js';
import { lists as listsFrom } from '../src/topics.js';
import { extractUrl, resolvePostUrl } from '../src/urls.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The request body, whether it was sent as JSON or as a form. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/** Opening the address in a browser just says the app is running. */
export function GET(): Response {
  return json({ ok: true, service: 'save-faves' });
}

/**
 * Saves one post. The body is { url, secret } from the Shortcut; the scripts can also send
 * saved_at, note, wait and guides (explained below). Always answers with { ok, message }, and the
 * Shortcut shows that message as a notification.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (err) {
    console.log(`[save-faves] request failed: ${errorMessage(err)}`);
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

  // The same post can arrive as a share link, a short link or the full link. Turn them all into one
  // standard link, so a post saved twice is spotted as a repeat.
  let resolved;
  try {
    resolved = await resolvePostUrl(raw);
  } catch (err) {
    const message = errorMessage(err);
    await writeRows(env, raw, [failedRow({ savedAt, sourceUrl: raw }, message)]).catch(() => undefined);
    return json({ ok: false, message: `Couldn't save: ${message}` });
  }
  const { url, platform } = resolved;

  // Ask the sheet whether this post is already saved. The same call returns your topics, place types,
  // guide names and cities, which Gemini picks from so new rows match the ones you have.
  let lists = listsFrom();
  try {
    const existing = await findExisting(env, url);
    if (existing.exists) return json({ ok: true, duplicate: true, message: `Already saved: ${existing.title ?? url}` });
    lists = listsFrom(existing.topics, existing.place_types, existing.guides, existing.cities);
  } catch (err) {
    console.log(`[save-faves] duplicate check failed, continuing: ${errorMessage(err)}`);
  }

  // For testing the setup: `"stub": true` writes a placeholder row without calling Apify or Gemini.
  if (body.stub === true || body.stub === 'true') {
    await writeRows(env, url, [{ saved_at: savedAt, type: 'idea', topic: 'Other', title: 'Stub row', source_url: url }]);
    return json({ ok: true, message: `Stub row written for ${url}` });
  }

  // Imports can pass a short note for the notes column (e.g. "IG collection: Food").
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
  // Imports send guides: false and rebuild the Guides tab once at the end instead of after every save.
  const skipGuides = body.guides === false || body.guides === 'false';
  const work = runPipeline(env, { url, platform, savedAt, lists, ...(note ? { note } : {}), ...(skipGuides ? { skipGuides } : {}) });
  // Imports ask to wait for the real outcome, so they can stop on errors.
  if (body.wait === true || body.wait === 'true') return json(await work);

  // A save can take a minute or two, longer than the Shortcut wants to wait. So wait up to
  // SYNC_WAIT_SECONDS: quick saves get a real "Saved place: …" notification, slower ones get
  // "Saving…" and keep running in the background (that's what waitUntil allows).
  waitUntil(work);
  const quick = await Promise.race([
    work,
    new Promise<null>((r) => setTimeout(() => r(null), env.SYNC_WAIT_SECONDS * 1000)),
  ]);
  return json(quick ?? { ok: true, pending: true, message: 'Saving… it will be in your sheet in a minute' });
}
