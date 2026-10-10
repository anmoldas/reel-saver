import { askJson } from './gemini.js';
import { shopLink } from './rows.js';
import { MENTION_KINDS } from './topics.js';
import type { Env, Mention } from './types.js';

/** A Mentions row as the Sheet sends it for review. */
export interface MentionRow {
  row: number;
  name: string;
  kind: string;
  brand: string;
  why: string;
  topic: string;
  from: string;
}

export interface CleanupPlan {
  count: number; // rows in the tab when it was read; the Sheet refuses the plan if this changed
  remove: { row: number; name: string; reason: string }[];
  updates: { row: number; name: string; from_kind: string; kind: string; shop_link: string }[];
}

const BATCH = 60;

export const REVIEW_RULES = `You review rows of a "Mentions" list: a shopping and to-try list built from social media posts someone saved. Each row is one thing a post named, with why the post mentioned it.

For every row, decide:
- "keep": false when the row does not belong on a shopping or to-try list:
  - a place someone would visit (a restaurant, a shop as a destination, a sight, temple, museum, hotel, neighbourhood or city) or a transport line. An online store or a chain to shop at is fine.
  - the post criticised it, ruled it out ("too expensive", "didn't like it", "not comfortable") or only used it for comparison;
  - a giveaway prize or sponsor, or a source the post only credits (e.g. "published the original article");
  - only part of the creator's story or background, such as their employer, school or clients.
  Otherwise keep it. When "why" is empty or you are unsure, keep it.
- "kind": one of ${MENTION_KINDS.map((k) => `"${k}"`).join(', ')}. "product" is a specific thing you buy; "brand" is a company or label recommended as a whole; "app/tool" is software or a website; "store" is where to buy; "show/movie" includes TV series and theatre; "book" is only for books; "person" is someone to follow or learn from. Keep the current kind when it fits.
- "reason": a few words, only when "keep" is false.

Return one review per row, using its "row" number.`;

function reviewSchema() {
  return {
    type: 'OBJECT',
    properties: {
      reviews: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            row: { type: 'INTEGER' },
            keep: { type: 'BOOLEAN' },
            kind: { type: 'STRING', enum: MENTION_KINDS },
            reason: { type: 'STRING' },
          },
          required: ['row', 'keep', 'kind', 'reason'],
        },
      },
    },
    required: ['reviews'],
  };
}

/** Asks Gemini to review every row (text only, in batches) and turns the answers into a plan. */
export async function reviewMentions(env: Env, rows: MentionRow[], count: number): Promise<CleanupPlan> {
  const plan: CleanupPlan = { count, remove: [], updates: [] };
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const input = batch.map((r) => ({ row: r.row, name: r.name, kind: r.kind, brand: r.brand, why: r.why, from: firstLine(r.from) }));
    const answer = await askJson(env, REVIEW_RULES, [{ text: JSON.stringify(input) }], reviewSchema());
    addReviews(plan, batch, Array.isArray(answer?.reviews) ? answer.reviews : []);
  }
  return plan;
}

const firstLine = (s: string) => String(s ?? '').split('\n')[0];

/** Only rows that were sent count; anything missing or malformed is left as it is. */
export function addReviews(plan: CleanupPlan, batch: MentionRow[], reviews: any[]): void {
  const byRow = new Map(batch.map((r) => [r.row, r]));
  const seen = new Set<number>();
  for (const rev of reviews) {
    const r = byRow.get(Number(rev?.row));
    if (!r || seen.has(r.row)) continue;
    seen.add(r.row);
    if (rev.keep === false) {
      plan.remove.push({ row: r.row, name: r.name, reason: String(rev.reason ?? '').trim() });
    } else if (MENTION_KINDS.includes(rev.kind) && rev.kind !== r.kind) {
      const m: Mention = { name: r.name, kind: rev.kind, brand: r.brand, why: r.why, price: '' };
      plan.updates.push({ row: r.row, name: r.name, from_kind: r.kind, kind: rev.kind, shop_link: shopLink(m) });
    }
  }
}
