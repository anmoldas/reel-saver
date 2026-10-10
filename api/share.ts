import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { runPipeline } from '../src/pipeline.js';
import { failedRow } from '../src/rows.js';
import { findExisting, writeRows } from '../src/sheet.js';
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

/** POST { url, secret } from the iOS Shortcut. Always answers with { ok, message }. */
export async function POST(request: Request): Promise<Response> {
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
  const savedAt = new Date().toISOString();

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

  try {
    const existing = await findExisting(env, url);
    if (existing.exists) return json({ ok: true, duplicate: true, message: `Already saved: ${existing.title ?? url}` });
  } catch (err) {
    console.log(`[reel-saver] duplicate check failed, continuing: ${errorMessage(err)}`);
  }

  // Build step 2: `"stub": true` writes a placeholder row without calling Apify or Gemini.
  if (body.stub === true || body.stub === 'true') {
    await writeRows(env, url, [{ saved_at: savedAt, type: 'recommendation', title: 'Stub row', source_url: url, status: 'to try' }]);
    return json({ ok: true, message: `Stub row written for ${url}` });
  }

  // Keep running after we answer; wait briefly so fast saves get a real confirmation.
  const work = runPipeline(env, { url, platform, savedAt });
  waitUntil(work);
  const quick = await Promise.race([
    work,
    new Promise<null>((r) => setTimeout(() => r(null), env.SYNC_WAIT_SECONDS * 1000)),
  ]);
  return json(quick ?? { ok: true, pending: true, message: 'Saving… it will be in your sheet in a minute' });
}
