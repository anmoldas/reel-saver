# loc saver

share an instagram reel or tiktok from your phone → a row lands in a google sheet as a recipe, a place, or a recommendation.

```
iOS share sheet ──▶ Vercel function (api/share.ts)
                     ├─ resolve short link, check for duplicates (answers in ~2s)
                     └─ in the background (up to 4 min):
                          Apify scrape → Gemini (caption, then video if needed)
                          → Google Places → Apps Script → Google Sheet
```

the shortcut waits up to 20 seconds. if the save finishes in that time you get "Saved place: X", otherwise "Saving…" and the row shows up a bit later. anything that fails still gets a row with `type = failed` and the error in `summary`, and sharing the same link again retries it.

## setup (about 30 minutes, once)

### 1. accounts and keys

| what | where | notes |
|---|---|---|
| Apify token | apify.com → Settings → API & Integrations | free plan includes $5/month of credit |
| Gemini key | aistudio.google.com → Get API key | free tier, no card needed |
| Places key | console.cloud.google.com → new project → enable **Places API (New)** → Credentials → Create API key | under "API restrictions" pick Places API (New) only. needs a billing account, but 5,000 lookups a month are free |
| Vercel | vercel.com | free Hobby plan |

also make up one long random string to use as your `SECRET` (for example run `openssl rand -hex 24`, or mash the keyboard).

### 2. sheet + apps script (build step 1)

1. create a new google sheet.
2. Extensions → Apps Script. delete what's there and paste in `apps-script/Code.gs`.
3. Project Settings (gear icon) → Script properties → add `SECRET` = your secret.
4. back in the editor, pick `testWrite` from the function dropdown and click Run. approve the permissions (Sheets, Drive for thumbnails, external requests). a `Saves` tab appears with a header and one test row. delete the row.
5. Deploy → New deployment → type **Web app**. Execute as **Me**, Who has access **Anyone**. copy the URL ending in `/exec`. that's your `SHEET_URL`.

> if you edit `Code.gs` later, use Deploy → Manage deployments → edit → Version: New version, so the URL stays the same.

### 3. deploy to vercel

1. vercel.com → Add New → Project → import `anmoldas/loc-saver`.
2. framework preset: Other. leave the build settings empty.
3. Environment Variables: add `SECRET`, `APIFY_TOKEN`, `GEMINI_API_KEY`, `PLACES_API_KEY`, `SHEET_URL`. the rest of `.env.example` is optional.
4. Deploy. your endpoint is `https://<project>.vercel.app/api/share`.

test it with a stub row (build step 2, which skips Apify and Gemini):

```sh
curl -X POST https://<project>.vercel.app/api/share \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.instagram.com/reel/TEST1/","secret":"YOUR_SECRET","stub":true}'
```

then a real one (drop `"stub":true` and use a real reel or tiktok link). logs are under the project's **Logs** tab in Vercel. every step prints a `[loc-saver]` line.

### 4. iOS shortcut

1. Shortcuts app → + → name it **Save to Sheet**.
2. tap the ⓘ (details) → turn on **Show in Share Sheet**. under the share sheet types, keep only **URLs** and **Text**.
3. add **Get Contents of URL**:
   - URL: `https://<project>.vercel.app/api/share`
   - Method: POST
   - Request Body: JSON, with two text fields:
     - `url` → the **Shortcut Input** variable
     - `secret` → your secret
4. add **Get Dictionary Value**: get value for `message` in *Contents of URL*.
5. add **Show Notification** with the *Dictionary Value*.

in instagram or tiktok: Share → Save to Sheet (in tiktok it's under Share → More, or copy link first). the first time, iOS asks to allow the connection to vercel.app. choose Always Allow.

## how it decides

- **caption first.** Gemini reads the caption. it falls back to the video only if the model says it needs it, a recipe is missing ingredients or steps, a place has no name or city, or confidence is below `CONFIDENCE_THRESHOLD` (0.7).
- **several places in one post** become one row each.
- **duplicates**: links are normalised (`instagram.com/share/...`, `vm.tiktok.com/...`, `?igsh=` all collapse to one URL). if a non-failed row already exists you get "Already saved: X" and nothing runs.
- **thumbnails** are copied to a `Loc Saver thumbnails` folder in your Drive, because instagram and tiktok image links expire within days.

## sheet columns

`saved_at, type, title, summary, details, source_url, creator, thumbnail_url, recipe_ingredients, recipe_steps, place_name, place_address, place_city, lat, lng, maps_url, place_id, category, notes, status`

- `details`: servings/time for recipes, what to order for places, the specifics for recommendations
- `notes` is yours; the script never writes it
- columns are matched by name, so you can reorder or add your own

## what it costs

for a few saves a day, $0. rough numbers per save:

| | cost | free allowance |
|---|---|---|
| Apify (instagram) | ~$0.003 | $5/month credit |
| Apify (tiktok) | ~$0.002 + small video-download charge | same credit |
| Gemini 3.1 Flash-Lite, caption | well under $0.001 | free tier |
| Gemini, 60s video fallback | ~$0.005 | free tier |
| Places text search | ~$0.03 | 5,000/month free |
| Vercel, Apps Script | 0 | free |

note: on Gemini's free tier, Google may use your requests to improve its products.

## changing things

all optional, set as Vercel env vars:

- `GEMINI_MODEL`: default `gemini-3.1-flash-lite`. try `gemini-3.1-flash` if parses are sloppy
- `INSTAGRAM_ACTOR` / `TIKTOK_ACTOR`: Apify actor IDs. defaults `apify/instagram-scraper`, `clockworks/tiktok-scraper`. if one starts failing, swap it here. a different actor may name its output fields differently, see `normalizeItem` in `src/apify.ts`
- `CONFIDENCE_THRESHOLD`, `SYNC_WAIT_SECONDS`

## develop

```sh
npm install
npm test          # all outside services are mocked
npm run typecheck
```

## later

- map page: read the sheet (publish it as CSV, or add a `doGet` that returns rows) and drop Leaflet pins from `lat`/`lng`.
