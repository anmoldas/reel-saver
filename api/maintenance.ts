// Used only by scripts/retry-failed.mjs, which reads the Failed tab through here and tries those saves again.

import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { secretMatches } from '../src/secret.js';
import { readFailed } from '../src/sheet.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * What the script can ask for (every request includes your secret):
 *   POST { secret, action: 'failed' } → every row in the Failed tab
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
    return json({ ok: false, message: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
}
