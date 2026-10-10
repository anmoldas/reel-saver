import { getItems, normalizeItem, startRun, waitForRun } from './apify.js';
import { errorMessage } from './errors.js';
import { deleteVideo, needsVideo, parseCaption, parseVideo, uploadVideo } from './gemini.js';
import { findPlace } from './places.js';
import { failedRow, itemRow, summarize } from './rows.js';
import { writeRows } from './sheet.js';
import type { Env, ParseResult, PipelineParams, PipelineResult, PlaceMatch, Post } from './types.js';

// Vercel Hobby stops functions at 300s. Give up early enough to still write the failure row.
const DEADLINE_MS = 240_000;

const log = (url: string, msg: string) => console.log(`[reel-saver] ${url} ${msg}`);

/**
 * Fetch → parse → enrich → store. Never throws: any failure becomes a "failed" row
 * so nothing shared is silently lost.
 */
export async function runPipeline(env: Env, params: PipelineParams, deadlineMs = DEADLINE_MS): Promise<PipelineResult> {
  const state = { abandoned: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${Math.round(deadlineMs / 1000)}s`)), deadlineMs);
  });

  let post: Post | undefined;
  try {
    return await Promise.race([
      runSteps(env, params, state, (p) => (post = p)),
      timeout,
    ]);
  } catch (err) {
    state.abandoned = true; // stops a timed-out run from writing rows later
    const message = errorMessage(err);
    log(params.url, `failed: ${message}`);
    try {
      await writeRows(env, params.url, [failedRow({ savedAt: params.savedAt, sourceUrl: params.url, post }, message)]);
    } catch (writeErr) {
      log(params.url, `could not write failure row: ${errorMessage(writeErr)}`);
    }
    return { ok: false, message: `Couldn't save: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runSteps(
  env: Env,
  { url, platform, savedAt, topics }: PipelineParams,
  state: { abandoned: boolean },
  onPost: (p: Post) => void,
): Promise<PipelineResult> {
  // 1. Fetch
  const { runId, datasetId } = await startRun(env, platform, url);
  await waitForRun(env, runId, 200);
  const items = await getItems(env, datasetId);
  const post = normalizeItem(platform, items);
  if (!post.caption) log(url, `no caption; scraper fields: ${Object.keys(items[0] ?? {}).join(', ')}`);
  onPost(post);
  log(url, `fetched @${post.creator}, caption ${post.caption.length} chars, video ${post.videoUrl ? 'yes' : 'no'}`);

  // 2. Parse: caption first, video only when the caption is not enough
  let result: ParseResult | null = post.caption ? await parseCaption(env, topics, post) : null;
  const reason = result ? needsVideo(result, env.CONFIDENCE_THRESHOLD) : 'no caption';
  if (reason && post.videoUrl) {
    log(url, `using video: ${reason}`);
    try {
      const file = await uploadVideo(env, post.videoUrl);
      try {
        const fromVideo = await parseVideo(env, topics, post, file);
        if (fromVideo.items.length) result = fromVideo;
      } finally {
        await deleteVideo(env, file.name);
      }
    } catch (err) {
      // Keep the caption result if we have one; otherwise this is a real failure.
      if (!result?.items.length) throw err;
      log(url, `video fallback failed, keeping caption parse: ${errorMessage(err)}`);
    }
  }
  if (!result?.items.length) throw new Error('Found nothing to save in this post');

  // 3. Enrich places (a lookup failure only loses the address, not the row)
  const matches: (PlaceMatch | null)[] = await Promise.all(
    result.items.map(async (item) => {
      if (!item.place?.name) return null;
      try {
        return await findPlace(env, item.place.name, item.place.city);
      } catch (err) {
        log(url, `place lookup failed for ${item.place.name}: ${errorMessage(err)}`);
        return null;
      }
    }),
  );

  // 4. Store
  if (state.abandoned) return { ok: false, message: 'abandoned' };
  const base = { savedAt, sourceUrl: url, post };
  const written = await writeRows(env, url, result.items.map((item, i) => itemRow(base, item, matches[i])));
  if (written.duplicate) return { ok: true, message: 'Already saved' };

  const message = summarize(result.items);
  log(url, message);
  return { ok: true, message };
}
