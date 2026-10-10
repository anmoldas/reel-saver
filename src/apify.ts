import { PermanentError } from './errors.js';
import type { Env, Platform, Post } from './types.js';

const API = 'https://api.apify.com/v2';

function actorFor(env: Env, platform: Platform): string {
  const id = platform === 'instagram' ? env.INSTAGRAM_ACTOR : env.TIKTOK_ACTOR;
  return id.replace('/', '~'); // Apify's URL form of "user/actor"
}

export function actorInput(platform: Platform, url: string): Record<string, unknown> {
  if (platform === 'instagram') {
    return { directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false };
  }
  return {
    postURLs: [url],
    resultsPerPage: 1,
    // TikTok's own video links need cookies; a copy in Apify storage does not.
    shouldDownloadVideos: true,
    // TikTok's cover link is public, so the Apps Script can copy it to Drive; an Apify copy would need the token.
    shouldDownloadCovers: false,
    shouldDownloadSubtitles: false,
    shouldDownloadSlideshowImages: false,
  };
}

async function apify(env: Env, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.APIFY_TOKEN}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apify ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function startRun(env: Env, platform: Platform, url: string): Promise<{ runId: string; datasetId: string }> {
  const { data } = await apify(env, `/acts/${actorFor(env, platform)}/runs`, {
    method: 'POST',
    body: JSON.stringify(actorInput(platform, url)),
  });
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

const DONE = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/** Long-polls the run (Apify holds each request up to 60s). */
export async function waitForRun(env: Env, runId: string, maxSeconds = 300): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const { data } = await apify(env, `/actor-runs/${runId}?waitForFinish=60`);
    if (DONE.has(data.status)) {
      if (data.status !== 'SUCCEEDED') throw new Error(`Scraper run ${data.status.toLowerCase()}`);
      return;
    }
  }
  throw new Error('Scraper took too long');
}

export async function getItems(env: Env, datasetId: string): Promise<any[]> {
  return apify(env, `/datasets/${datasetId}/items?clean=true&limit=5`);
}

function first(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** Map a raw dataset item to a Post, or throw if the post could not be read. */
export function normalizeItem(platform: Platform, items: any[]): Post {
  const item = items[0];
  if (!item) throw new PermanentError('Post not found. It may be private or deleted');
  if (item.error || item.errorDescription) {
    throw new PermanentError(`Post unavailable: ${first(item.errorDescription, item.error)}`);
  }

  if (platform === 'instagram') {
    return {
      caption: first(item.caption),
      creator: first(item.ownerUsername, item.owner?.username),
      videoUrl: first(item.videoUrl),
      thumbnailUrl: first(item.displayUrl, item.images?.[0], item.thumbnailUrl),
    };
  }
  return {
    caption: first(item.text, item.desc),
    creator: first(item.authorMeta?.name, item.authorMeta?.nickName, item.author?.uniqueId),
    videoUrl: first(item.mediaUrls?.[0], item.videoMeta?.downloadAddr, item.videoUrl),
    thumbnailUrl: first(item.videoMeta?.originalCoverUrl, item.videoMeta?.coverUrl, item.covers?.[0], item.coverUrl),
  };
}
