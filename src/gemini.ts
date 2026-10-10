import type { Env, ItemType, ParsedItem, ParseResult, Post } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com';

const STR = { type: 'STRING' };
const STR_LIST = { type: 'ARRAY', items: STR };

// Gemini's structured-output schema (OpenAPI subset).
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: { type: 'STRING', enum: ['recipe', 'place', 'recommendation'] },
          title: STR,
          summary: STR,
          confidence: { type: 'NUMBER' },
          recipe: {
            type: 'OBJECT',
            nullable: true,
            properties: { ingredients: STR_LIST, steps: STR_LIST, servings: STR, time: STR },
            required: ['ingredients', 'steps', 'servings', 'time'],
          },
          place: {
            type: 'OBJECT',
            nullable: true,
            properties: { name: STR, city: STR, category: STR, what_to_order: STR },
            required: ['name', 'city', 'category', 'what_to_order'],
          },
          recommendation: {
            type: 'OBJECT',
            nullable: true,
            properties: { category: STR, details: STR },
            required: ['category', 'details'],
          },
        },
        required: ['type', 'title', 'summary', 'confidence'],
        propertyOrdering: ['type', 'title', 'summary', 'confidence', 'recipe', 'place', 'recommendation'],
      },
    },
    needs_video: { type: 'BOOLEAN' },
  },
  required: ['items', 'needs_video'],
};

const INSTRUCTIONS = `You turn a saved social media post into structured notes.

Classify what the post is worth saving for:
- "recipe": a dish someone could cook. Fill "recipe" with every ingredient (with quantities when given) and the steps in order.
- "place": a specific restaurant, cafe, bar, shop, hotel or attraction. Fill "place" with its name, city, a short category (e.g. "ramen", "cocktail bar", "bakery") and what to order or do there.
- "recommendation": anything else worth remembering (a product, book, show, tip, app). Fill "recommendation" with a category and the details.

Rules:
- A post can mention several places or recommendations. Return one item per place or thing.
- Leave the sub-objects that do not match the item's type as null.
- "title" is short (the dish, the place name, or the thing). "summary" is one line on why it is worth saving.
- "confidence" is 0 to 1: how sure you are that the item is complete and correct.
- Never invent ingredients, steps, places or cities. If something is missing, leave it empty and lower the confidence.
- Set "needs_video" to true when the text alone is not enough, for example a recipe whose steps are only spoken in the video, or a place whose name or city is only shown on screen.
- Write in English.`;

function generateUrl(model: string): string {
  return `${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function generate(env: Env, parts: unknown[]): Promise<ParseResult> {
  const res = await fetch(generateUrl(env.GEMINI_MODEL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
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
  return normalizeParse(JSON.parse(text));
}

function postContext(post: Post): string {
  return `Creator: @${post.creator || 'unknown'}\nCaption:\n${post.caption.slice(0, 8000) || '(no caption)'}`;
}

export function parseCaption(env: Env, post: Post): Promise<ParseResult> {
  return generate(env, [{ text: postContext(post) }]);
}

export function parseVideo(env: Env, post: Post, file: { uri: string; mimeType: string }): Promise<ParseResult> {
  return generate(env, [
    { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
    {
      text: `${postContext(post)}\n\nUse the video (speech, on-screen text and visuals) together with the caption. needs_video should be false now.`,
    },
  ]);
}

/** Why the caption-only result is not good enough, or null if it is. */
export function needsVideo(result: ParseResult, threshold: number): string | null {
  if (result.needs_video) return 'model asked for the video';
  if (result.items.length === 0) return 'nothing found in the caption';
  for (const item of result.items) {
    if (item.confidence < threshold) return `low confidence (${item.confidence})`;
    if (item.type === 'recipe' && (!item.recipe?.ingredients.length || !item.recipe?.steps.length)) {
      return 'recipe is missing ingredients or steps';
    }
    if (item.type === 'place' && (!item.place?.name || !item.place?.city)) return 'place is missing a name or city';
  }
  return null;
}

// ---- input clean-up: never trust the model's JSON shape blindly ----

const TYPES: ItemType[] = ['recipe', 'place', 'recommendation'];

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);

export function normalizeParse(raw: any): ParseResult {
  const items: ParsedItem[] = (Array.isArray(raw?.items) ? raw.items : []).flatMap((it: any): ParsedItem[] => {
    const type = TYPES.includes(it?.type) ? (it.type as ItemType) : 'recommendation';
    const conf = Number(it?.confidence);
    const item: ParsedItem = {
      type,
      title: s(it?.title),
      summary: s(it?.summary),
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0,
      recipe: null,
      place: null,
      recommendation: null,
    };
    if (type === 'recipe') {
      const r = it?.recipe ?? {};
      item.recipe = { ingredients: list(r.ingredients), steps: list(r.steps), servings: s(r.servings), time: s(r.time) };
    } else if (type === 'place') {
      const p = it?.place ?? {};
      item.place = { name: s(p.name) || item.title, city: s(p.city), category: s(p.category), what_to_order: s(p.what_to_order) };
    } else {
      const r = it?.recommendation ?? {};
      item.recommendation = { category: s(r.category), details: s(r.details) };
    }
    if (!item.title) item.title = item.place?.name ?? '';
    return item.title ? [item] : [];
  });
  return { items, needs_video: raw?.needs_video === true };
}

// ---- video upload (Gemini Files API) ----

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Downloads the video and uploads it to Gemini. Returns the file handle. */
export async function uploadVideo(env: Env, videoUrl: string): Promise<{ name: string; uri: string; mimeType: string }> {
  const dl = await fetch(videoUrl);
  if (!dl.ok) throw new Error(`Could not download the video (${dl.status})`);
  const bytes = await dl.arrayBuffer();
  if (bytes.byteLength > MAX_VIDEO_BYTES) throw new Error('Video is too large');
  const mimeType = (dl.headers.get('content-type') || '').startsWith('video/')
    ? dl.headers.get('content-type')!.split(';')[0]
    : 'video/mp4';

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
    body: JSON.stringify({ file: { display_name: 'loc-saver' } }),
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
