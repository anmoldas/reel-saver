// Guides: every idea gets a broad subject ("Japan", "Video editing"), and ideas on the same subject are
// combined into one row in the Guides tab, so ten videos about one trip read as a single list.
// Gemini does the combining. The second half of this file is for grouping ideas saved before guides
// existed, used by scripts/build-guides.mjs.

import { askJson } from './gemini.js';
import { guideVideos, writeGuide } from './sheet.js';
import { GUIDE_NAMING, guideList, matchGuide } from './topics.js';
import type { Env } from './types.js';

/** An Ideas row as the Sheet sends it for grouping. */
export interface IdeaRow {
  source_url: string;
  title: string;
  summary: string;
  topic: string;
  guide: string;
}

/** One idea in a guide, as the Sheet sends it. */
export interface GuideVideo {
  saved_at: string;
  title: string;
  topic: string;
  takeaways: string;
  creator: string;
  source_url: string;
}

/** A guide picked for one idea. */
export interface Assignment {
  title: string;
  guide: string;
  source_url: string;
}

// ---- combining a guide's takeaways ----

/** The instructions Gemini follows when combining a guide. */
export const GUIDE_RULES =`You combine the takeaways from several saved social media videos on one subject into a single guide someone can read instead of rewatching them.

- Keep every useful point. When several videos say the same thing, write it once, keeping the most specific version (names, prices, numbers, places).
- Each point is one short standalone sentence. Never invent anything that is not in the takeaways.
- With more than 12 points, sort them into 2 to 6 sections with short headings (for a country, e.g. "Planning & getting around", "Shopping", "Drugstore & konbini", or a city's name). With 12 or fewer, return one section with an empty heading.
- "summary": one line on what the guide covers.
- Write in English.`;

function guideSchema() {
  return {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      sections: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { heading: { type: 'STRING' }, points: { type: 'ARRAY', items: { type: 'STRING' } } },
          required: ['heading', 'points'],
        },
      },
    },
    required: ['summary', 'sections'],
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Sections as cell text: bullets, with a heading line above each section when there is more than one. */
export function formatSections(sections: unknown): string {
  const clean = (Array.isArray(sections) ? sections : [])
    .map((sec: any) => ({ heading: str(sec?.heading), points: (Array.isArray(sec?.points) ? sec.points : []).map(str).filter(Boolean) }))
    .filter((sec) => sec.points.length);
  const bullets = (points: string[]) => points.map((p) => `• ${p}`).join('\n');
  if (clean.length === 1) return bullets(clean[0].points);
  return clean.map((sec) => (sec.heading ? `${sec.heading}\n${bullets(sec.points)}` : bullets(sec.points))).join('\n\n');
}

/** Asks Gemini to merge the videos' takeaways into one guide. */
export async function combineTakeaways(env: Env, guide: string, videos: GuideVideo[]): Promise<{ summary: string; takeaways: string }> {
  const input = videos.map((v) => ({ title: v.title, creator: v.creator, takeaways: v.takeaways }));
  const answer = await askJson(env, GUIDE_RULES, [{ text: `Guide: ${guide}\n\nVideos:\n${JSON.stringify(input)}` }], guideSchema());
  const takeaways = formatSections(answer?.sections);
  // Never replace a guide's takeaways with nothing.
  if (!takeaways) throw new Error('Gemini returned an empty guide');
  return { summary: str(answer?.summary), takeaways };
}

/** Rewrites one guide's row from its videos. A guide with one video gets no row. Returns the number of videos. */
export async function refreshGuide(env: Env, guide: string): Promise<number> {
  const videos = await guideVideos(env, guide);
  if (videos.length < 2) {
    await writeGuide(env, guide, '', ''); // drops a row left over from when it had more
    return videos.length;
  }
  const { summary, takeaways } = await combineTakeaways(env, guide, videos);
  await writeGuide(env, guide, summary, takeaways);
  return videos.length;
}

// ---- grouping older ideas (scripts/build-guides.mjs) ----

/** The instructions Gemini follows when picking guides for older ideas. */
export const GROUP_RULES =`You sort saved "ideas" (tips, advice and recommendations from social media videos) into guides, so ideas on the same subject can be read together.

For each idea, give its "guide": ${GUIDE_NAMING}

Use the existing guides listed in the input when they fit, and the same name for every idea on the same subject. A guide with only one idea is fine. Return one answer per idea, using its "id".`;

function groupSchema() {
  return {
    type: 'OBJECT',
    properties: {
      answers: {
        type: 'ARRAY',
        items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, guide: { type: 'STRING' } }, required: ['id', 'guide'] },
      },
    },
    required: ['answers'],
  };
}

// Ideas sent to Gemini per request.
const BATCH = 150;

/** Gives every idea without a guide one, reusing the guides already in use. Text only, in batches. */
export async function groupIdeas(env: Env, ideas: IdeaRow[]): Promise<Assignment[]> {
  const known = guideList(ideas.map((i) => i.guide));
  const todo = ideas.filter((i) => !str(i.guide) && i.source_url);
  const out: Assignment[] = [];
  for (let start = 0; start < todo.length; start += BATCH) {
    const batch = todo.slice(start, start + BATCH);
    const input = {
      existing_guides: known,
      ideas: batch.map((i, id) => ({ id, title: i.title, summary: i.summary, topic: i.topic })),
    };
    const answer = await askJson(env, GROUP_RULES, [{ text: JSON.stringify(input) }], groupSchema());
    out.push(...addAnswers(batch, Array.isArray(answer?.answers) ? answer.answers : [], known));
  }
  return out;
}

/** Turns answers into assignments; new names join `known` so later batches reuse them. Missing answers are skipped. */
export function addAnswers(batch: IdeaRow[], answers: any[], known: string[]): Assignment[] {
  const out: Assignment[] = [];
  const seen = new Set<number>();
  for (const a of answers) {
    const idea = batch[Number(a?.id)];
    const name = matchGuide(str(a?.guide), known);
    if (!idea || !name || seen.has(Number(a.id))) continue;
    seen.add(Number(a.id));
    if (!known.includes(name)) known.push(name);
    out.push({ title: idea.title, guide: name, source_url: idea.source_url });
  }
  return out;
}
