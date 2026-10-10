# reel saver

share an instagram reel or tiktok from your phone → a row lands in a google sheet as a place, a recipe, or an idea (tips, advice, products).

```
iOS share sheet ──▶ Vercel function (api/share.ts)
                     ├─ resolve short link, check for duplicates (answers in ~2s)
                     └─ in the background (up to 4 min):
                          Apify scrape → Gemini (caption, then video if needed)
                          → Google Places → Apps Script → Google Sheet
```

the shortcut waits up to 20 seconds. if the save finishes in that time you get "Saved place: X", otherwise "Saving…" and the row shows up a bit later. anything that fails still gets a row in the **Failed** tab with the error, and sharing the same link again retries it.

## setup (about 30 minutes, once)

**easiest:** open [Claude Code](https://claude.com/claude-code) in an empty folder and say:

> Set up Reel Saver for me by following https://raw.githubusercontent.com/anmoldas/reel-saver/main/SETUP.md

it walks you through the accounts one at a time, keeps your keys in a local file instead of the chat, deploys to Vercel, and tests everything. [SETUP.md](SETUP.md) is that guide.

the manual steps below do the same thing by hand.

### 1. accounts and keys

| what | where | notes |
|---|---|---|
| Apify token | apify.com → Settings → API & Integrations | free plan includes $5/month of credit |
| Gemini key | aistudio.google.com → Get API key | free tier, no card needed |
| Places key (optional) | console.cloud.google.com → new project → enable **Places API (New)** → Credentials → Create API key | adds address, coordinates and an exact Maps pin. under "API restrictions" pick Places API (New) only. needs a billing account, but 5,000 lookups a month are free. without it, places save with a Maps search link |
| Vercel | vercel.com | free Hobby plan |

also make up one long random string to use as your `SECRET` (`node scripts/setup.mjs init` makes one for you in `.env.local`).

### 2. sheet + apps script (build step 1)

1. create a new google sheet.
2. Extensions → Apps Script. delete what's there and paste in `apps-script/Code.gs`.
3. Project Settings (gear icon) → Script properties → add `SECRET` = your secret.
4. back in the editor, pick `testWrite` from the function dropdown and click Run. approve the permissions (Sheets, Drive for thumbnails, external requests). a `Places` tab appears with one test row, plus a `Topics` tab. delete the test row.
5. Deploy → New deployment → type **Web app**. Execute as **Me**, Who has access **Anyone**. copy the URL ending in `/exec`. that's your `SHEET_URL`.

> if you edit `Code.gs` later, use Deploy → Manage deployments → edit → Version: New version, so the URL stays the same.

### 3. deploy to vercel

1. vercel.com → Add New → Project → import your copy of this repo (or deploy from the folder with `npx vercel deploy --prod`).
2. framework preset: Other. leave the build settings empty.
3. Environment Variables: add `SECRET`, `APIFY_TOKEN`, `GEMINI_API_KEY`, `SHEET_URL`, and `PLACES_API_KEY` if you have one. the rest of `.env.example` is optional.
4. Deploy. your endpoint is `https://<project>.vercel.app/api/share`.

test it with a stub row (build step 2, which skips Apify and Gemini):

```sh
curl -X POST https://<project>.vercel.app/api/share \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.instagram.com/reel/TEST1/","secret":"YOUR_SECRET","stub":true}'
```

then a real one (drop `"stub":true` and use a real reel or tiktok link). logs are under the project's **Logs** tab in Vercel. every step prints a `[reel-saver]` line.

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

- **caption first for places and recipes.** Gemini reads the caption. it falls back to the video only if the model says it needs it, a recipe is missing ingredients or steps, a place has no name or city, or confidence is below `CONFIDENCE_THRESHOLD` (0.7).
- **ideas always watch the video.** tips and advice are usually spoken, and the caption is just a teaser, so any post read as an idea is re-read with the video.
- **several places in one post** become one row each.
- **just for fun is skipped.** jokes, memes, skits, pets and vlogs with nothing to visit, cook, buy or learn get "Skipped: just for fun" and no row. if the caption can't tell, it watches the video first. a funny post that still names a place, product or tip is saved.
- **duplicates**: links are normalised (`instagram.com/share/...`, `vm.tiktok.com/...`, `?igsh=` all collapse to one URL). if a non-failed row already exists you get "Already saved: X" and nothing runs.
- **thumbnails** are copied to a `Reel Saver thumbnails` folder in your Drive, because instagram and tiktok image links expire within days.

## the sheet

one tab per kind of save. columns are matched by name, so you can reorder them or add your own.

| tab | what lands there | columns |
|---|---|---|
| **Places** | restaurants, cafes, bars, shops, sights, activities, hotels | `saved_at, done, title, category, specialty, city, country, address, what_to_order, summary, maps_url, lat, lng, place_id, creator, source_url, thumbnail_url, notes` |
| **Recipes** | anything you'd cook | `saved_at, done, title, summary, time, servings, ingredients, steps, creator, source_url, thumbnail_url, notes` |
| **Ideas** | everything else: tips, advice, how-tos, products, outfits, tools | `saved_at, done, topic, title, summary, takeaways, mentioned, suggested_topic, creator, source_url, thumbnail_url, notes` |
| **Mentions** | one row per product, app, brand, store, book, show, course or person an idea names | `saved_at, status, name, kind, brand, why, price, topic, times_mentioned, shop_link, from, creator, source_url, notes` |
| **Failed** | saves that couldn't be processed | `saved_at, source_url, error, creator` |

- place `category` comes from the **Place types** tab (see below); `specialty` keeps the specific description, e.g. "ceramics and glassware store". `country` lets you filter a trip (Japan, Netherlands…).
- `takeaways` are the 3–5 useful points the video makes; `mentioned` lists the tools, apps, products or brands it names.
- `done` is a checkbox; `notes` is yours. the script never writes either after the row is created.

### mentions

every thing an idea names gets its own row in **Mentions**: a shopping and to-try list across all your saves.

- `kind` is one of product, app/tool, brand, store, book, show/movie, course, person. `why` is one line on why it was recommended; `price` is filled only when the video says one.
- `shop_link` is a Google Shopping search for products and brands, and a web search for everything else.
- `status` is a dropdown (want, bought, tried, skip); `notes` is yours.
- `times_mentioned` counts how many rows name the same thing, so something three creators recommend stands out.
- ideas saved before this tab existed only have the plain `mentioned` list. run `backfillMentions` once from the editor to turn those into rows (kind, brand, why and price stay empty for them).

### topics

the **Topics** tab lists the idea topics (Travel tips, Clothing, Career, AI, Video editing, Journaling, Organization to start). Gemini must pick one of them or "Other".

- **to add a topic**, add a row to the Topics tab. the next save uses it; no redeploy.
- **to find new topics**, filter Ideas to `topic = Other` now and then. the `suggested_topic` column says what Gemini would have called each one. if the same suggestion keeps appearing, add it to Topics.

### place types

the **Place types** tab lists the place categories: restaurant, cafe, bar, bakery & dessert, home & ceramics, clothing, beauty, books & stationery, market, museum & gallery, sight, activity, stay. Gemini must pick one or "other", so a pottery shop, a ceramics store and a home decor shop all land in **home & ceramics**, and the dashboard can group on `category` without its own mapping. add a row to add a type.

places saved before this list existed have free-text categories. run `recategorizePlaces` once from the editor: it moves the old wording to `specialty`, guesses the type from keywords, and logs any it set to "other" so you can fix those by hand.

### moving from the old single tab

if your sheet has the older `Saves` tab, paste the new `Code.gs`, pick `migrateSaves` in the function dropdown and click Run once. rows move to the new tabs and the old tab is kept as `Saves (old)`. then deploy a new version (Deploy → Manage deployments → edit → Version: New version) so the web app uses the new code.

### importing old TikTok favorites

request your data in TikTok (Settings → Account → Download your data, format **JSON**), unzip it, then:

```sh
node scripts/import-tiktok.mjs user_data_tiktok.json --url https://YOUR-APP.vercel.app --since 2025-01-01
```

it sends your Favorites newest first, 30 seconds apart, and each row keeps the date you favorited it. `--dry-run` lists them without sending, `--limit 50` stops early, and running it again skips anything already done (progress is in `.tiktok-import.json`). the SECRET is read from `.env.local`. at ~$0.003–0.005 a TikTok, a few hundred fit in Apify's free $5 a month; for more, spread runs across months.

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
