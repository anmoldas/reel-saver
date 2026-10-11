// Step 1: fetch the post. Apify (apify.com) runs ready-made "scrapers" that open a public Instagram or
// TikTok post and return its caption, creator, video and photos. Each scraper is called an "actor".
// A run is started, waited on, then its results are read and turned into a simple Post.

import { PermanentError } from './errors.js';
import type { Env, Platform, Post } from './types.js';

const API = 'https://api.apify.com/v2';

function actorFor(env: Env, platform: Platform): string {
  const id = platform === 'instagram' ? env.INSTAGRAM_ACTOR : env.TIKTOK_ACTOR;
  return id.replace('/', '~'); // Apify's URL form of "user/actor"
}

/** The settings each scraper is started with. */
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
    // Photo-mode posts: the slides are read when the caption is not enough.
    shouldDownloadSlideshowImages: true,
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

/** Waits for the run to finish. Each check is held open by Apify for up to 60s, so few checks are needed. */
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

/** The run's results (its "dataset"): normally one item, the post. */
export async function getItems(env: Env, datasetId: string): Promise<any[]> {
  return apify(env, `/datasets/${datasetId}/items?clean=true&limit=5`);
}

const MAX_IMAGES = 10;

/** Distinct http(s) links, in order, at most MAX_IMAGES. */
function links(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && !out.includes(v)) out.push(v);
    if (out.length === MAX_IMAGES) break;
  }
  return out;
}

/** Instagram: a carousel's slides, or the photo itself. Video slides are left to the video step. */
function instagramImages(item: any): string[] {
  const children: any[] = Array.isArray(item.childPosts) ? item.childPosts : [];
  const fromChildren = children.filter((c) => c?.type !== 'Video').map((c) => c?.displayUrl);
  const images: unknown[] = Array.isArray(item.images) ? item.images : [];
  if (fromChildren.length || images.length) return links([...fromChildren, ...images]);
  return item.type === 'Image' ? links([item.displayUrl]) : [];
}

/** TikTok photo mode: Apify's stored copies first (the TikTok links need cookies), then TikTok's own. */
function tiktokImages(item: any): string[] {
  const slides: any[] = Array.isArray(item.slideshowImageLinks) ? item.slideshowImageLinks : [];
  const stored = links(slides.map((s) => s?.downloadLink));
  if (stored.length) return stored;
  const own: any[] = Array.isArray(item.imagePost?.images) ? item.imagePost.images : [];
  return links([...slides.map((s) => s?.tiktokLink), ...own.map((i) => i?.imageURL?.urlList?.[0])]);
}

function first(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Turns the scraper's result into a Post, or throws if the post could not be read.
 * If you swap in a different scraper (INSTAGRAM_ACTOR / TIKTOK_ACTOR), this is where its field names go.
 */
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
      imageUrls: instagramImages(item),
      thumbnailUrl: first(item.displayUrl, item.images?.[0], item.thumbnailUrl),
    };
  }
  return {
    caption: first(item.text, item.desc),
    creator: first(item.authorMeta?.name, item.authorMeta?.nickName, item.author?.uniqueId),
    videoUrl: first(item.mediaUrls?.[0], item.videoMeta?.downloadAddr, item.videoUrl),
    imageUrls: tiktokImages(item),
    thumbnailUrl: first(item.videoMeta?.originalCoverUrl, item.videoMeta?.coverUrl, item.covers?.[0], item.coverUrl),
  };
}
