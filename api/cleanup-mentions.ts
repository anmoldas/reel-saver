import { reviewMentions, type CleanupPlan } from '../src/cleanup.js';
import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { secretMatches } from '../src/secret.js';
import { cleanMentions, readMentions } from '../src/sheet.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * One-time Mentions cleanup, driven by scripts/clean-mentions.mjs.
 *   POST { secret }        → reviews every row with Gemini and returns the plan plus what it would change
 *   POST { secret, plan }  → applies that plan (the Sheet backs the tab up first)
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
    if (body.plan) {
      const plan = body.plan as CleanupPlan;
      if (!Number.isInteger(plan.count) || !Array.isArray(plan.remove) || !Array.isArray(plan.updates)) {
        return json({ ok: false, message: 'That is not a cleanup plan' }, 400);
      }
      return json({ ok: true, applied: true, ...(await cleanMentions(env, plan, false)) });
    }
    const { count, rows } = await readMentions(env);
    const plan = await reviewMentions(env, rows, count);
    return json({ ok: true, applied: false, plan, preview: await cleanMentions(env, plan, true) });
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
}
