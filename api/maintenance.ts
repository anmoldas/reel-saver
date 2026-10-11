import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { secretMatches } from '../src/secret.js';
import { combinePlaceNotes, type PlaceNote } from '../src/notes.js';
import { readFailed, readPlaceNotes, setPlaceNotes, tidySheet } from '../src/sheet.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Sheet upkeep, driven by scripts/retry-failed.mjs and scripts/tidy-sheet.mjs.
 *   POST { secret, action: 'failed' }                 → every row in the Failed tab
 *   POST { secret, action: 'tidy' }                   → what the tidy would change; changes nothing
 *   POST { secret, action: 'tidy', apply: true, count } → does it, if Places still has `count` rows
 *   POST { secret, action: 'notes' }                  → one-line notes for places with several; changes nothing
 *   POST { secret, action: 'notes', updates }         → writes those notes
 */
export async function POST(request: Request): Promise<Response> {
  let env;
  try {
    env = getEnv();
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Body is not JSON' }, 400);
  }
  if (!secretMatches(body?.secret, env.SECRET)) return json({ ok: false, message: 'Wrong secret' }, 401);

  try {
    if (body.action === 'failed') return json({ ok: true, rows: await readFailed(env) });
    if (body.action === 'tidy') {
      if (body.apply === true && !Number.isInteger(body.count)) return json({ ok: false, message: 'Pass the count from the preview' }, 400);
      return json({ ok: true, applied: body.apply === true, ...(await tidySheet(env, body.apply === true ? body.count : null, body.apply !== true)) });
    }
    if (body.action === 'notes') {
      if (Array.isArray(body.updates)) {
        const updates = (body.updates as PlaceNote[]).filter((u) => u && typeof u.source_url === 'string' && typeof u.what_to_order === 'string');
        return json({ ok: true, applied: true, ...(await setPlaceNotes(env, updates)) });
      }
      const places = await readPlaceNotes(env);
      const combined = await combinePlaceNotes(env, places);
      const before = new Map(places.map((p) => [`${p.source_url}\n${p.title}`, p.what_to_order]));
      return json({ ok: true, applied: false, updates: combined.map((c) => ({ ...c, before: before.get(`${c.source_url}\n${c.title}`) ?? '' })) });
    }
    return json({ ok: false, message: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
}
