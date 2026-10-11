// Used only by scripts/build-guides.mjs, to group ideas you saved earlier into guides and rebuild the
// Guides tab. Everyday saves don't need it: each new idea updates its guide as it's saved.

import { getEnv } from '../src/env.js';
import { errorMessage } from '../src/errors.js';
import { groupIdeas, refreshGuide, type IdeaRow } from '../src/guides.js';
import { secretMatches } from '../src/secret.js';
import { assignGuides, readIdeas } from '../src/sheet.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** How many ideas each guide has, most first. */
function counts(ideas: IdeaRow[]): { guide: string; videos: number }[] {
  const byKey = new Map<string, { guide: string; videos: number }>();
  for (const i of ideas) {
    const guide = String(i.guide ?? '').trim();
    if (!guide) continue;
    const entry = byKey.get(guide.toLowerCase()) ?? { guide, videos: 0 };
    entry.videos++;
    byKey.set(guide.toLowerCase(), entry);
  }
  return [...byKey.values()].sort((a, b) => b.videos - a.videos);
}

/**
 * What the script can ask for (every request includes your secret):
 *   POST { secret, action: 'preview' }              → a guide for every idea without one; changes nothing
 *   POST { secret, action: 'assign', assignments }  → writes those guide names to the Ideas tab
 *   POST { secret, action: 'list' }                 → every guide with its number of videos
 *   POST { secret, action: 'build', guide }         → rewrites that guide's row in the Guides tab
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
    if (body.action === 'preview') {
      const ideas = await readIdeas(env);
      return json({ ok: true, existing: counts(ideas), assignments: await groupIdeas(env, ideas) });
    }
    if (body.action === 'assign') {
      const list = Array.isArray(body.assignments) ? body.assignments : null;
      if (!list || list.some((a: any) => typeof a?.source_url !== 'string' || typeof a?.guide !== 'string')) {
        return json({ ok: false, message: 'assignments must be a list of { source_url, guide }' }, 400);
      }
      const r = await assignGuides(env, list.map((a: any) => ({ source_url: a.source_url, guide: a.guide.trim() })));
      return json({ ok: true, assigned: r.assigned });
    }
    if (body.action === 'list') return json({ ok: true, guides: counts(await readIdeas(env)) });
    if (body.action === 'build') {
      if (typeof body.guide !== 'string' || !body.guide.trim()) return json({ ok: false, message: 'Which guide?' }, 400);
      return json({ ok: true, videos: await refreshGuide(env, body.guide.trim()) });
    }
    return json({ ok: false, message: `Unknown action: ${body.action}` }, 400);
  } catch (err) {
    return json({ ok: false, message: errorMessage(err) }, 500);
  }
}
