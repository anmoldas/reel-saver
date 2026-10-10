import type { Env } from './types.js';

const REQUIRED = ['SECRET', 'APIFY_TOKEN', 'GEMINI_API_KEY', 'PLACES_API_KEY', 'SHEET_URL'] as const;

export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  return {
    SECRET: source.SECRET!,
    APIFY_TOKEN: source.APIFY_TOKEN!,
    GEMINI_API_KEY: source.GEMINI_API_KEY!,
    PLACES_API_KEY: source.PLACES_API_KEY!,
    SHEET_URL: source.SHEET_URL!,
    GEMINI_MODEL: source.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    INSTAGRAM_ACTOR: source.INSTAGRAM_ACTOR || 'apify/instagram-scraper',
    TIKTOK_ACTOR: source.TIKTOK_ACTOR || 'clockworks/tiktok-scraper',
    CONFIDENCE_THRESHOLD: Number(source.CONFIDENCE_THRESHOLD || 0.7),
    SYNC_WAIT_SECONDS: Number(source.SYNC_WAIT_SECONDS || 20),
  };
}
