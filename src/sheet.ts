import { errorMessage, withRetry } from './errors.js';
import type { CleanupPlan, MentionRow } from './cleanup.js';
import type { GuideVideo, IdeaRow } from './guides.js';
import type { Env, Row } from './types.js';

// Apps Script now and then answers with an error page instead of JSON; a retry usually works.
// Writes are safe to repeat: the script skips a save that is already in the sheet.
function call(env: Env, payload: Record<string, unknown>): Promise<any> {
  return withRetry(() => callOnce(env, payload), (err) => /^Sheet endpoint returned non-JSON \((404|429|5\d\d)\)/.test(errorMessage(err)));
}

async function callOnce(env: Env, payload: Record<string, unknown>): Promise<any> {
  // Apps Script answers POSTs with a redirect to the result; fetch follows it.
  const res = await fetch(env.SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.SECRET, ...payload }),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Sheet endpoint returned non-JSON (${res.status}). Check SHEET_URL and the web app's access setting`);
  }
  if (!data.ok) throw new Error(`Sheet: ${data.error ?? 'unknown error'}`);
  return data;
}

/** Is this URL already saved (ignoring failed rows)? Also returns the Topics and Place types tabs, the guide names and the cities. */
export async function findExisting(
  env: Env,
  sourceUrl: string,
): Promise<{ exists: boolean; title?: string; type?: string; topics?: string[]; place_types?: string[]; guides?: string[]; cities?: string[] }> {
  return call(env, { action: 'check', source_url: sourceUrl });
}

/** Appends rows. Replaces earlier "failed" rows for the same URL. */
export async function writeRows(env: Env, sourceUrl: string, rows: Row[]): Promise<{ written: number; duplicate?: boolean }> {
  return call(env, { action: 'write', source_url: sourceUrl, rows });
}

/** Every Mentions row with its row number, for the one-time cleanup. */
export async function readMentions(env: Env): Promise<{ count: number; rows: MentionRow[] }> {
  return call(env, { action: 'mentions' });
}

export interface CleanupResult {
  before: number;
  removed: number;
  after: number;
  merged: string[];
}

/** Applies a reviewed plan (or, with dryRun, reports what it would do). The Sheet backs the tab up first. */
export async function cleanMentions(env: Env, plan: CleanupPlan, dryRun: boolean): Promise<CleanupResult> {
  return call(env, {
    action: 'cleanMentions',
    count: plan.count,
    remove: plan.remove.map((r) => r.row),
    updates: plan.updates.map((u) => ({ row: u.row, kind: u.kind, shop_link: u.shop_link })),
    dry_run: dryRun,
  });
}

/** Every Ideas row, for grouping the ones without a guide. */
export async function readIdeas(env: Env): Promise<IdeaRow[]> {
  return (await call(env, { action: 'ideas' })).rows ?? [];
}

/** Sets the guide column on the Ideas rows with these links. */
export async function assignGuides(env: Env, assignments: { source_url: string; guide: string }[]): Promise<{ assigned: number }> {
  return call(env, { action: 'assignGuides', assignments });
}

/** The ideas in one guide, newest first. */
export async function guideVideos(env: Env, guide: string): Promise<GuideVideo[]> {
  return (await call(env, { action: 'guideVideos', guide })).videos ?? [];
}

/** Writes a guide's row (or removes it when the guide has fewer than two videos). */
export async function writeGuide(env: Env, guide: string, summary: string, takeaways: string): Promise<{ written: number; videos: number }> {
  return call(env, { action: 'writeGuide', guide, summary, takeaways });
}

/** Every Failed row, for retrying the ones that might work now. */
export async function readFailed(env: Env): Promise<{ saved_at: string; source_url: string; error: string; creator: string }[]> {
  return (await call(env, { action: 'failed' })).rows ?? [];
}

export interface TidyResult {
  count: number;
  before: number;
  after: number;
  merged: string[];
  placeholders: number;
  countries: number;
}

/** Merges repeat places, blanks placeholder cells and evens out country names (or, with dryRun, reports it). */
export async function tidySheet(env: Env, count: number | null, dryRun: boolean): Promise<TidyResult> {
  return call(env, { action: 'tidy', count, dry_run: dryRun });
}
