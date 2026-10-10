import { getItems, normalizeItem, startRun, waitForRun } from './apify.js';
import { errorMessage } from './errors.js';
import { deleteVideo, downloadImages, needsVideo, parseCaption, parseMedia, uploadVideo, type Media } from './gemini.js';
import { findPlace } from './places.js';
import { failedRow, itemRow, mentionRows, summarize } from './rows.js';
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

/**
 * Uploads the video and downloads the images, then reads them together with the caption.
 * Either one failing is fine as long as the other worked; returns null when there was nothing to read.
 */
async function readMedia(env: Env, lists: PipelineParams['lists'], post: Post, url: string): Promise<ParseResult | null> {
  const [file, images] = await Promise.all([
    post.videoUrl
      ? uploadVideo(env, post.videoUrl).catch((err) => {
          if (!post.imageUrls.length) throw err;
          log(url, `video failed, using images only: ${errorMessage(err)}`);
          return undefined;
        })
      : Promise.resolve(undefined),
    downloadImages(env, post.imageUrls),
  ]);
  if (post.imageUrls.length) log(url, `read ${images.length} of ${post.imageUrls.length} images`);
  const media: Media = { file, images };
  try {
    if (!file && !images.length) {
      if (post.imageUrls.length) throw new Error('Could not download the images');
      return null;
    }
    return await parseMedia(env, lists, post, media);
  } finally {
    if (file) await deleteVideo(env, file.name);
  }
}

async function runSteps(
  env: Env,
  { url, platform, savedAt, lists, note }: PipelineParams,
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

  // 2. Parse: caption first, then the video and/or images only when the caption is not enough
  let result: ParseResult | null = post.caption ? await parseCaption(env, lists, post) : null;
  const reason = result ? needsVideo(result, env.CONFIDENCE_THRESHOLD) : 'no caption';
  if (reason && (post.videoUrl || post.imageUrls.length)) {
    log(url, `using media: ${reason}`);
    try {
      const fromMedia = await readMedia(env, lists, post, url);
      if (fromMedia && (fromMedia.items.length || fromMedia.just_for_fun)) result = fromMedia;
    } catch (err) {
      // Keep the caption result if we have one; otherwise this is a real failure.
      if (!result?.items.length) throw err;
      log(url, `media fallback failed, keeping caption parse: ${errorMessage(err)}`);
    }
  }
  if (result?.just_for_fun) {
    log(url, 'just for fun, nothing saved');
    return { ok: true, skipped: true, message: 'Skipped: just for fun, nothing to save' };
  }
  if (!result?.items.length) throw new Error('Found nothing to save in this post');

  // 3. Enrich places (a lookup failure only loses the address, not the row)
  const matches: (PlaceMatch | null)[] = await Promise.all(
    result.items.map(async (item) => {
      if (!item.place?.name || !env.PLACES_API_KEY) return null;
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
  const rows = result.items.flatMap((item, i) => [
    { ...itemRow(base, item, matches[i]), ...(note ? { notes: note } : {}) },
    ...mentionRows(base, item),
  ]);
  const written = await writeRows(env, url, rows);
  if (written.duplicate) return { ok: true, message: 'Already saved' };

  const message = summarize(result.items);
  log(url, message);
  return { ok: true, message };
}
