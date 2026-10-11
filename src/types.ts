// The shapes of the data passed around the app, in one place.

import type { Lists } from './topics.js';

export type Platform = 'instagram' | 'tiktok';

/** Your keys and settings; see src/env.ts and .env.example. */
export interface Env {
  SECRET: string;
  APIFY_TOKEN: string;
  GEMINI_API_KEY: string;
  PLACES_API_KEY: string;
  SHEET_URL: string;
  GEMINI_MODEL: string;
  INSTAGRAM_ACTOR: string;
  TIKTOK_ACTOR: string;
  CONFIDENCE_THRESHOLD: number;
  SYNC_WAIT_SECONDS: number;
}

export interface PipelineParams {
  url: string; // the post's standard link (see src/urls.ts)
  platform: Platform;
  savedAt: string; // ISO timestamp of the share
  lists: Lists; // idea topics and place types, from the sheet's tabs
  note?: string; // goes in the notes column, e.g. the collection an import came from
  /** Imports skip updating the Guides tab on every save; scripts/build-guides.mjs --rebuild does it once after. */
  skipGuides?: boolean;
}

export interface PipelineResult {
  ok: boolean;
  message: string;
  /** True when the post was only entertainment and no row was written. */
  skipped?: boolean;
}

/** What we keep from the scraper. */
export interface Post {
  caption: string;
  creator: string;
  videoUrl: string;
  /** Photos and carousel slides (TikTok photo mode too). Read when the caption is not enough. */
  imageUrls: string[];
  thumbnailUrl: string;
}

export type ItemType = 'recipe' | 'place' | 'idea';

/** One place, recipe or idea Gemini found in a post. Only the part matching `type` is filled. */
export interface ParsedItem {
  type: ItemType;
  title: string;
  summary: string;
  confidence: number;
  recipe: { ingredients: string[]; steps: string[]; servings: string; time: string } | null;
  place: { name: string; city: string; country: string; category: string; specialty: string; what_to_order: string } | null;
  idea: { topic: string; suggested_topic: string; guide: string; takeaways: string[]; mentioned: Mention[] } | null;
}

/** A product, app, brand, store, book, etc. named in a post. Each becomes a row in the Mentions tab. */
export interface Mention {
  name: string;
  kind: string;
  brand: string;
  why: string;
  price: string;
}

/** Everything Gemini found in one post. */
export interface ParseResult {
  items: ParsedItem[];
  /** The model's own judgement that the caption was not enough. */
  needs_video: boolean;
  /** Only entertainment, nothing worth saving. Never true when there are items. */
  just_for_fun: boolean;
}

/** What Google Maps found for a place. */
export interface PlaceMatch {
  placeId: string;
  /** From the address; empty when Google has none. */
  city?: string;
  country?: string;
  address: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
}

/** One spreadsheet row: column name → value. */
export type Row =Record<string, string | number>;
