import { DEFAULT_PLACE_TYPES, GUIDE_NAMING, MENTION_KINDS, OTHER, OTHER_PLACE, matchGuide, type Lists } from './topics.js';
import { errorMessage, withRetry } from './errors.js';
import type { Env, ItemType, Mention, ParsedItem, ParseResult, Post } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com';

const STR = { type: 'STRING' };
const STR_LIST = { type: 'ARRAY', items: STR };

/** Gemini's structured-output schema (OpenAPI subset). The lists come from the sheet, so it is built per call. */
export function responseSchema({ topics, placeTypes }: Lists) {
  return {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: ['place', 'recipe', 'idea'] },
            title: STR,
            summary: STR,
            confidence: { type: 'NUMBER' },
            place: {
              type: 'OBJECT',
              nullable: true,
              properties: {
                name: STR,
                city: STR,
                country: STR,
                category: { type: 'STRING', enum: placeTypes },
                specialty: STR,
                what_to_order: STR,
              },
              required: ['name', 'city', 'country', 'category', 'specialty', 'what_to_order'],
            },
            recipe: {
              type: 'OBJECT',
              nullable: true,
              properties: { ingredients: STR_LIST, steps: STR_LIST, servings: STR, time: STR },
              required: ['ingredients', 'steps', 'servings', 'time'],
            },
            idea: {
              type: 'OBJECT',
              nullable: true,
              properties: {
                topic: { type: 'STRING', enum: topics },
                suggested_topic: STR,
                guide: STR,
                takeaways: STR_LIST,
                mentioned: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      name: STR,
                      kind: { type: 'STRING', enum: MENTION_KINDS },
                      brand: STR,
                      why: STR,
                      price: STR,
                    },
                    required: ['name', 'kind', 'brand', 'why', 'price'],
                  },
                },
              },
              required: ['topic', 'suggested_topic', 'guide', 'takeaways', 'mentioned'],
            },
          },
          required: ['type', 'title', 'summary', 'confidence'],
          propertyOrdering: ['type', 'title', 'summary', 'confidence', 'place', 'recipe', 'idea'],
        },
      },
      needs_video: { type: 'BOOLEAN' },
      just_for_fun: { type: 'BOOLEAN' },
    },
    required: ['items', 'needs_video', 'just_for_fun'],
  };
}

export function instructions({ topics, placeTypes, guides }: Lists): string {
  return `You turn a saved social media post into structured notes.

Classify what the post is worth saving for:
- "place": a specific named restaurant, cafe, bar, shop, sight, activity or hotel someone could visit. Fill "place" with:
  - "name", "city" and "country".
  - "category": one of ${placeTypes.map((t) => `"${t}"`).join(', ')}. Pick the closest; use "${OTHER_PLACE}" only if none fit.
  - "specialty": a few words on what exactly it is (e.g. "ceramics and glassware store", "natural wine bar", "ramen").
  - "what_to_order": what to order, buy or do there.
- "recipe": a dish someone could cook. Fill "recipe" with every ingredient (with quantities when given) and the steps in order.
- "idea": everything else worth remembering: advice, tips, how-tos, products, outfits, tools. Fill "idea" with:
  - "topic": one of ${topics.map((t) => `"${t}"`).join(', ')}. Travel advice without specific named spots is "Travel tips".
  - "suggested_topic": only when the topic is "${OTHER}", a short name for the topic it would need (e.g. "Fitness"); otherwise empty.
  - "guide": ${GUIDE_NAMING}
    ${guides.length ? `Use one of the guides that already exist when it fits: ${guides.map((g) => `"${g}"`).join(', ')}. Otherwise name a new one.` : 'Name a new one.'}
  - "takeaways": the 3 to 5 most useful points the post actually makes, each a short standalone sentence.
  - "mentioned": the specific products, apps, tools, brands, stores, books, shows, courses or people the post recommends, reviews or shows how to use: things the viewer could buy, use, watch, read or follow. Leave out:
    - names that are only part of the creator's story or background, such as their employers, schools, clients or cities they lived in;
    - anything mentioned only in passing, criticised, ruled out ("too expensive", "didn't like it") or only used for comparison;
    - giveaway prizes, sponsors of a giveaway, and sources the post merely credits (e.g. "via The Points Guy");
    - places someone would visit (restaurants, shops as destinations, sights, temples, hotels, neighbourhoods) and transport lines: those are "place" items, not mentions. An online store or a chain to shop at is fine.
    Empty is fine. For each:
    - "name": what it is called, as specifically as the post says it (e.g. "Tea Tree & Rosemary Shampoo", "CapCut"), without words like "app" or "brand" unless they are part of the real name.
    - "kind": one of ${MENTION_KINDS.map((k) => `"${k}"`).join(', ')}. "product" is a specific thing you buy; "brand" is a company or label recommended as a whole; "app/tool" is software or a website; "store" is where to buy; "show/movie" includes TV series and theatre; "book" is only for books.
    - "brand": the brand or maker when it is not already part of the name; otherwise empty.
    - "why": one short line on why the post recommends it.
    - "price": only if the post states a price; otherwise empty.

Rules:
- A post can mention several places. Return one item per place. A list of tips is one idea, not one item per tip.
- Leave the sub-objects that do not match the item's type as null.
- "title" is short (the place name, the dish, or what the idea is about). "summary" is one line on why it is worth saving.
- "confidence" is 0 to 1: how sure you are that the item is complete and correct.
- Never invent ingredients, steps, places, cities or takeaways. If something is missing, leave it empty and lower the confidence.
- Set "needs_video" to true when the text alone is not enough, for example a recipe whose steps are only spoken in the video, a place whose name or city is only shown on screen, or tips that are only said out loud.
- Set "just_for_fun" to true, with no items, when the post is only entertainment: jokes, skits, memes, relatable humour, pranks, dances, reactions, pets, or a personal vlog with nothing someone could visit, cook, buy or learn. A funny post that still names a real place, product or useful tip is not just for fun: return those items. If the text alone cannot tell, set "needs_video" instead.
- Write in English.`;
}

function generateUrl(model: string): string {
  return `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

// Overloaded (503), rate limited (429) or a server error: worth another try.
const TEMPORARY_GEMINI = /^Gemini (429|500|502|503|504)\b/;

/** Asks Gemini for JSON matching `schema`, retrying temporary failures. Returns the parsed JSON. */
export function askJson(env: Env, system: string, parts: unknown[], schema: unknown): Promise<any> {
  return withRetry(() => askJsonOnce(env, system, parts, schema), (err) => TEMPORARY_GEMINI.test(errorMessage(err)));
}

async function askJsonOnce(env: Env, system: string, parts: unknown[], schema: unknown): Promise<any> {
  const res = await fetch(generateUrl(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  const data = JSON.parse(body);
  const text: string = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p: any) => typeof p.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('');
  if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? 'no candidates'})`);
  return JSON.parse(text);
}

async function generate(env: Env, lists: Lists, parts: unknown[]): Promise<ParseResult> {
  return normalizeParse(await askJson(env, instructions(lists), parts, responseSchema(lists)), lists);
}

function postContext(post: Post): string {
  return `Creator: @${post.creator || 'unknown'}\nCaption:\n${post.caption.slice(0, 8000) || '(no caption)'}`;
}

export function parseCaption(env: Env, lists: Lists, post: Post): Promise<ParseResult> {
  return generate(env, lists, [{ text: postContext(post) }]);
}

export interface Media {
  /** An uploaded video (or a slideshow's audio). */
  file?: { uri: string; mimeType: string };
  /** Photos or slides, in order. */
  images: InlineImage[];
}

export interface InlineImage {
  mimeType: string;
  data: string; // base64
}

/** Reads the post with its video and/or images. */
export function parseMedia(env: Env, lists: Lists, post: Post, media: Media): Promise<ParseResult> {
  const what = [media.file ? 'the video (speech, on-screen text and visuals)' : '', media.images.length ? `the ${media.images.length} image(s), in order (text on them, products, places)` : '']
    .filter(Boolean)
    .join(' and ');
  return generate(env, lists, [
    ...(media.file ? [{ fileData: { mimeType: media.file.mimeType, fileUri: media.file.uri } }] : []),
    ...media.images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    { text: `${postContext(post)}\n\nUse ${what} together with the caption. needs_video should be false now.` },
  ]);
}

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 15 * 1024 * 1024; // Gemini caps a whole request at 20MB

/** Files the scraper stored in Apify need the token: new Apify accounts keep storage private. */
function apifyAuth(env: Env, url: string): RequestInit | undefined {
  return new URL(url).hostname === 'api.apify.com' ? { headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` } } : undefined;
}

/** Downloads images for Gemini. Skips any that fail or are too big; returns what it got, in order. */
export async function downloadImages(env: Env, urls: string[]): Promise<InlineImage[]> {
  const got = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, apifyAuth(env, url));
        if (!res.ok) return null;
        const type = (res.headers.get('content-type') || '').split(';')[0];
        const bytes = await res.arrayBuffer();
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
        return { mimeType: type.startsWith('image/') ? type : 'image/jpeg', data: Buffer.from(bytes).toString('base64'), size: bytes.byteLength };
      } catch {
        return null;
      }
    }),
  );
  const out: InlineImage[] = [];
  let total = 0;
  for (const img of got) {
    if (!img || total + img.size > MAX_TOTAL_IMAGE_BYTES) continue;
    total += img.size;
    out.push({ mimeType: img.mimeType, data: img.data });
  }
  return out;
}

/** Why the caption-only result is not good enough, or null if it is. */
export function needsVideo(result: ParseResult, threshold: number): string | null {
  if (result.needs_video) return 'model asked for the video';
  if (result.just_for_fun) return null; // nothing to save, so no need to watch it
  if (result.items.length === 0) return 'nothing found in the caption';
  for (const item of result.items) {
    if (item.confidence < threshold) return `low confidence (${item.confidence})`;
    if (item.type === 'recipe' && (!item.recipe?.ingredients.length || !item.recipe?.steps.length)) {
      return 'recipe is missing ingredients or steps';
    }
    if (item.type === 'place' && (!item.place?.name || !item.place?.city)) return 'place is missing a name or city';
    // Tips and advice live in what is said, not the caption, so ideas always get the video.
    if (item.type === 'idea') return 'ideas always use the video';
  }
  return null;
}

// ---- input clean-up: never trust the model's JSON shape blindly ----

const TYPES: ItemType[] = ['recipe', 'place', 'idea'];

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);

/** Case-insensitive match against a fixed list, else the fallback. */
function pick(value: unknown, options: string[], fallback: string): string {
  const v = s(value).toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ?? fallback;
}

function mentions(v: unknown): Mention[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((m: any): Mention[] => {
    // Older or looser output may give plain names.
    if (typeof m === 'string') return m.trim() ? [{ name: m.trim(), kind: 'product', brand: '', why: '', price: '' }] : [];
    const name = s(m?.name);
    if (!name) return [];
    return [{ name, kind: pick(m?.kind, MENTION_KINDS, 'product'), brand: s(m?.brand), why: s(m?.why), price: s(m?.price) }];
  });
}

export function normalizeParse(
  raw: any,
  { topics, placeTypes, guides }: Lists = { topics: [OTHER], placeTypes: [...DEFAULT_PLACE_TYPES, OTHER_PLACE], guides: [] },
): ParseResult {
  const items: ParsedItem[] = (Array.isArray(raw?.items) ? raw.items : []).flatMap((it: any): ParsedItem[] => {
    const type = TYPES.includes(it?.type) ? (it.type as ItemType) : 'idea';
    const conf = Number(it?.confidence);
    const item: ParsedItem = {
      type,
      title: s(it?.title),
      summary: s(it?.summary),
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
      recipe: null,
      place: null,
      idea: null,
    };
    if (type === 'recipe') {
      const r = it?.recipe ?? {};
      item.recipe = { ingredients: list(r.ingredients), steps: list(r.steps), servings: s(r.servings), time: s(r.time) };
    } else if (type === 'place') {
      const p = it?.place ?? {};
      item.place = {
        name: s(p.name) || item.title,
        city: s(p.city),
        country: s(p.country),
        category: pick(p.category, placeTypes, OTHER_PLACE),
        // A category the model invented is kept as the specialty rather than lost.
        specialty: s(p.specialty) || (pick(p.category, placeTypes, '') ? '' : s(p.category)),
        what_to_order: s(p.what_to_order),
      };
    } else {
      const r = it?.idea ?? {};
      const topic = pick(r.topic, topics, OTHER);
      const rawTopic = s(r.topic);
      // A topic the model invented is kept as the suggestion rather than lost.
      const invented = rawTopic.toLowerCase() === OTHER.toLowerCase() ? '' : rawTopic;
      item.idea = {
        topic,
        suggested_topic: topic === OTHER ? s(r.suggested_topic) || invented : '',
        guide: matchGuide(s(r.guide), guides),
        takeaways: list(r.takeaways),
        mentioned: mentions(r.mentioned),
      };
    }
    if (!item.title) item.title = item.place?.name ?? '';
    return item.title ? [item] : [];
  });
  return { items, needs_video: raw?.needs_video === true, just_for_fun: raw?.just_for_fun === true && items.length === 0 };
}

// ---- video upload (Gemini Files API) ----

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Downloads the video and uploads it to Gemini. Returns the file handle. */
export async function uploadVideo(env: Env, videoUrl: string): Promise<{ name: string; uri: string; mimeType: string }> {
  const dl = await fetch(videoUrl, apifyAuth(env, videoUrl));
  if (!dl.ok) throw new Error(`Could not download the video from ${new URL(videoUrl).hostname} (${dl.status})`);
  const bytes = await dl.arrayBuffer();
  if (bytes.byteLength > MAX_VIDEO_BYTES) throw new Error('Video is too large');
  // A photo-mode TikTok's "video" can be its audio track, which Gemini reads too.
  const type = (dl.headers.get('content-type') || '').split(';')[0];
  const mimeType = type.startsWith('video/') || type.startsWith('audio/') ? type : 'video/mp4';

  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.GEMINI_API_KEY,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'reel-saver' } }),
  });
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start failed (${start.status})`);

  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: bytes,
  });
  if (!up.ok) throw new Error(`Gemini upload failed (${up.status})`);
  let file = (await up.json()).file;

  // Videos are processed before use; wait until ACTIVE.
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
    if (!res.ok) throw new Error(`Gemini file status ${res.status}`);
    file = await res.json();
  }
  if (file.state !== 'ACTIVE') throw new Error(`Gemini could not process the video (${file.state})`);
  return { name: file.name, uri: file.uri, mimeType: file.mimeType || mimeType };
}

/** Best effort; Gemini also deletes uploads after 48 hours. */
export async function deleteVideo(env: Env, name: string): Promise<void> {
  await fetch(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': env.GEMINI_API_KEY } }).catch(
    () => undefined,
  );
}
