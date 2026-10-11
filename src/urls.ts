// Works out which post a shared link points to. Instagram and TikTok links come in many forms (share
// links, short links, links with tracking bits); each is turned into one standard link per post.

import type { Platform } from './types.js';

// Short links are followed as if from an iPhone browser, which is what the sites expect.
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Pull the first http(s) URL out of whatever the share sheet sent. */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

/** Instagram, TikTok, or null for any other site. */
export function detectPlatform(u: URL): Platform | null {
  const host = u.hostname.toLowerCase();
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  // TikTok's data export links to www.tiktokv.com/share/video/ID.
  if (host === 'tiktokv.com' || host.endsWith('.tiktokv.com')) return 'tiktok';
  return null;
}

const IG_KINDS: Record<string, string> = { reel: 'reel', reels: 'reel', p: 'p', tv: 'tv' };

/**
 * The standard link for the post, if `u` already points straight at one, else null.
 * Instagram: https://www.instagram.com/reel/CODE/ (also handles /username/reel/CODE/)
 * TikTok:    https://www.tiktok.com/@user/video/ID
 */
export function canonicalize(u: URL): string | null {
  const platform = detectPlatform(u);
  const parts = u.pathname.split('/').filter(Boolean);
  if (platform === 'instagram') {
    if (parts[0] === 'share') return null; // share links need resolving
    for (let i = 0; i < parts.length - 1; i++) {
      const kind = IG_KINDS[parts[i].toLowerCase()];
      if (kind && /^[A-Za-z0-9_-]+$/.test(parts[i + 1])) {
        return `https://www.instagram.com/${kind}/${parts[i + 1]}/`;
      }
    }
    return null;
  }
  if (platform === 'tiktok') {
    const i = parts.findIndex((p) => p === 'video' || p === 'photo');
    if (i >= 1 && parts[i - 1].startsWith('@') && /^\d+$/.test(parts[i + 1] ?? '')) {
      return `https://www.tiktok.com/${parts[i - 1]}/${parts[i]}/${parts[i + 1]}`;
    }
    return null;
  }
  return null;
}

/**
 * The video ID of a TikTok link that has no username in it, else null:
 * /share/video/ID (data export, via tiktokv.com) and /@/video/ID (where that redirects).
 */
export function tiktokIdWithoutUser(u: URL): string | null {
  if (detectPlatform(u) !== 'tiktok') return null;
  const m = u.pathname.match(/^\/(?:share|@)\/(video|photo)\/(\d+)\/?$/);
  return m ? m[2] : null;
}

/** Asks TikTok's public embed service who posted a video, so the link gets its real username. */
async function tiktokUrlFromId(id: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@/video/${id}`)}`,
  );
  const data: any = res.ok ? await res.json().catch(() => null) : null;
  const user = typeof data?.author_unique_id === 'string' ? data.author_unique_id : '';
  // TikTok usernames are letters, digits, "_" and "."; anything else is not trusted into the URL.
  if (!/^[A-Za-z0-9._]{1,64}$/.test(user)) throw new Error('Post not found. It may be private or deleted');
  return `https://www.tiktok.com/@${user}/video/${id}`;
}

/**
 * Follows the link, one redirect at a time, until it reaches a post (at most 6 hops). Done by hand
 * rather than letting fetch follow them, so it can stop as soon as the post's link is known.
 */
export async function resolvePostUrl(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; platform: Platform }> {
  let current: URL;
  try {
    current = new URL(raw.trim());
  } catch {
    throw new Error('That is not a valid link');
  }
  for (let hop = 0; hop < 6; hop++) {
    const platform = detectPlatform(current);
    if (!platform) throw new Error(`Only Instagram and TikTok links are supported (got ${current.hostname})`);

    const bareId = tiktokIdWithoutUser(current);
    if (bareId) return { url: await tiktokUrlFromId(bareId, fetchImpl), platform };

    const canonical = canonicalize(current);
    if (canonical) return { url: canonical, platform };

    // Instagram sometimes bounces to the login page with the real path in ?next=
    const next = current.searchParams.get('next');
    if (next && current.pathname.startsWith('/accounts/login')) {
      current = new URL(next, current);
      continue;
    }

    const res = await fetchImpl(current.toString(), {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    const location = res.headers.get('location');
    if (location) {
      current = new URL(location, current);
      continue;
    }
    // No redirect: as a last resort, look for the post's own link in the page's HTML.
    const html = res.status === 200 ? await res.text() : '';
    const og = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i) ?? html.match(/property="og:url"[^>]+content="([^"]+)"/i);
    if (og) {
      const found = new URL(og[1].replace(/&amp;/g, '&'), current);
      const c = canonicalize(found);
      if (c) return { url: c, platform };
    }
    break;
  }
  throw new Error(`Could not work out which post this link points to: ${raw}`);
}
