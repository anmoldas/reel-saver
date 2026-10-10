import type { Lists } from './topics.js';

export type Platform = 'instagram' | 'tiktok';

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
  url: string; // canonical post URL
  platform: Platform;
  savedAt: string; // ISO timestamp of the share
  lists: Lists; // idea topics and place types, from the sheet's tabs
}

export interface PipelineResult {
  ok: boolean;
  message: string;
}

/** What we keep from the scraper. */
export interface Post {
  caption: string;
  creator: string;
  videoUrl: string;
  thumbnailUrl: string;
}

export type ItemType = 'recipe' | 'place' | 'idea';

export interface ParsedItem {
  type: ItemType;
  title: string;
  summary: string;
  confidence: number;
  recipe: { ingredients: string[]; steps: string[]; servings: string; time: string } | null;
  place: { name: string; city: string; country: string; category: string; specialty: string; what_to_order: string } | null;
  idea: { topic: string; suggested_topic: string; takeaways: string[]; mentioned: string[] } | null;
}

export interface ParseResult {
  items: ParsedItem[];
  /** The model's own judgement that the caption was not enough. */
  needs_video: boolean;
}

export interface PlaceMatch {
  placeId: string;
  address: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
}

export type Row = Record<string, string | number>;
