# reel saver

tap **Share** on an instagram reel or tiktok, and it lands in your own google sheet, already sorted: **places** with a maps link, **recipes** with ingredients and steps, and **ideas** (tips, advice, products) with the key takeaways and a shopping list of everything recommended.

<!-- TODO screenshot: the sheet (Places / Ideas / Mentions tabs) next to the phone notification "Saved place: …" -->

## what you need

- an **iPhone** (it uses the Shortcuts app; Android works with the free HTTP Shortcuts app, see [SETUP.md](SETUP.md))
- a **google account** for the sheet
- a mac or windows computer for the one-time setup, about **45 minutes**, mostly making free accounts
- **$0 to run** for normal use. none of the services it uses ask for a card, except the optional exact-address lookup
- for the guided setup, [Claude Code](https://claude.com/claude-code), which needs a paid Claude plan. you can also [set it up by hand](#doing-it-by-hand) for free

## set it up

open [Claude Code](https://claude.com/claude-code) in an empty folder and say:

> Set up Reel Saver for me by following https://raw.githubusercontent.com/moneymolz/reel-saver/main/SETUP.md

it walks you through each account one step at a time, keeps your keys in a file on your computer instead of the chat, puts the app online, and tests everything. at the end it can also bring in the tiktoks and instagram posts you've already saved. prefer doing it yourself? see [doing it by hand](#doing-it-by-hand).

## your data

- **your saves are yours.** they go into a google sheet and drive folder in your own google account. nobody else sees them, including whoever shared this with you.
- **your keys stay with you**, in a file on your computer and in your own Vercel account.
- **two services read each post you save:** Apify fetches the public post, and Google's Gemini reads it (and watches the video when needed). on Gemini's free tier, Google may use those requests to improve its products. that's the public posts you save, nothing else.
- saving only works with your private secret, so nobody else can add rows to your sheet.

## what it costs

for a few saves a day, $0. rough numbers per save:

| | cost | free allowance |
|---|---|---|
| Apify (instagram) | ~$0.003 | $5/month credit |
| Apify (tiktok) | ~$0.005–0.01, including the video download | same credit |
| Gemini 3.1 Flash-Lite, caption | well under $0.001 | free tier |
| Gemini, 60s video fallback | ~$0.005 | free tier |
| Places text search (optional) | ~$0.03 | 5,000/month free |
| Vercel, Apps Script | 0 | free |

so roughly 500 tiktoks or 1,500 reels a month before Apify's free credit runs out. if it does, saves fail with a note in the **Failed** tab until the next month.

## how it decides

- **caption first for places and recipes.** Gemini reads the caption. it falls back to the video only if the model says it needs it, a recipe is missing ingredients or steps, a place has no name or city, or confidence is below `CONFIDENCE_THRESHOLD` (0.7).
- **ideas always watch the video.** tips and advice are usually spoken, and the caption is just a teaser, so any post read as an idea is re-read with the video.
- **photos and carousels** are read the same way: if the caption isn't enough, Gemini looks at the images (up to 10 slides), including any text on them. a carousel with a video slide gets both. tiktok photo-mode slideshows too.
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
| **Mentions** | one row per product, app, brand, store, book, show, course or person an idea recommends | `saved_at, status, name, kind, brand, why, price, topic, times_mentioned, shop_link, from, creator, source_url, notes` |
| **Failed** | saves that couldn't be processed | `saved_at, source_url, error, creator` |

- place `category` comes from the **Place types** tab (see below); `specialty` keeps the specific description, e.g. "ceramics and glassware store". `country` lets you filter a trip (Japan, Netherlands…).
- `takeaways` are the 3–5 useful points the video makes; `mentioned` lists the tools, apps, products or brands it recommends (not ones that are just part of the creator's story, like their employers).
- `done` is a checkbox; `notes` is yours. the script never writes either after the row is created.

### mentions

every thing an idea recommends gets one row in **Mentions**: a shopping and to-try list across all your saves. when another save recommends the same thing, it's added to that row instead of making a new one.

- `kind` is one of product, app/tool, brand, store, book, show/movie, course, person. `why` is one line on why it was recommended; `price` is filled only when the video says one.
- `shop_link` is a Google Shopping search for products and brands, and a web search for everything else.
- `status` is a dropdown (want, bought, tried, skip); `notes` is yours.
- `times_mentioned` counts the saves that recommend it, so something three creators recommend stands out. `from`, `creator` and `source_url` list each of those saves, one per line. `why` keeps the first save's reason.
- names match loosely: case, accents and punctuation don't matter, and "Glaze Drops" by Kérastase matches "Kerastase Glaze Drops". a brand on its own ("Muji") stays separate from its products ("Muji Lip Essence").
- places don't go here (they're in Places), and neither does anything the creator criticised, a giveaway prize or a credited source.
- **tidying up older rows** (from before grouping and the stricter rules): `node scripts/clean-mentions.mjs --url https://YOUR-APP.vercel.app` asks Gemini to review every row and shows what it would remove, re-kind and merge, without changing anything. add `--apply` to do exactly that; the tab is copied to `Mentions (backup)` first. to only merge duplicates, run `mergeDuplicateMentions` from the Apps Script editor. don't run either while an import is going.
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

## importing what you've already saved

bring in your past TikTok favorites and Instagram saved posts. ask each app for your data in **JSON** format:

- **tiktok**: Settings and privacy → Account → Download your data → JSON. you get `user_data_tiktok.json`.
- **instagram**: Accounts Center → Your information and permissions → Download your information → Some of your information → **Saved** only → Download to device, Format **JSON**, Date range **All time**. unzip it; that's the folder you pass.

then:

```sh
node scripts/import-saves.mjs user_data_tiktok.json instagram-folder --url https://YOUR-APP.vercel.app --since 2025-01-01
```

it sends everything newest first, one at a time, waiting for each save to finish, and each row keeps the date you saved it. instagram collections go in the `notes` column ("IG collection: Food"). it stops at the first error that isn't about a single post (out of Apify credit, Gemini's daily limit) or after 3 failures in a row; deleted or private posts are just skipped. `--dry-run` lists them without sending, `--limit 50` stops early, and running it again skips anything already done (progress is in `.import-progress.json`). the SECRET is read from `.env.local`. at about half a cent to a cent per TikTok and a third of a cent per Instagram post, around 500 TikToks or 1,500 posts fit in Apify's free $5 a month; for more, spread runs across months.

## how it works

```
iOS share sheet ──▶ Vercel function (api/share.ts)
                     ├─ resolve short link, check for duplicates (answers in ~2s)
                     └─ in the background (up to 4 min):
                          Apify scrape → Gemini (caption, then video if needed)
                          → Google Places → Apps Script → Google Sheet
```

the shortcut waits up to 20 seconds. if the save finishes in that time you get "Saved place: X", otherwise "Saving…" and the row shows up a bit later. posts that are just for fun get "Skipped: just for fun". anything that fails still gets a row in the **Failed** tab with the error, and sharing the same link again retries it.

## doing it by hand

the same steps Claude Code follows. you'll also need to make up one long random string as your `SECRET` (`node scripts/setup.mjs init` makes one for you in `.env.local`).

### 1. accounts and keys

| what | where | notes |
|---|---|---|
| Apify token | apify.com → Settings → API & Integrations | free plan includes $5/month of credit |
| Gemini key | aistudio.google.com → Get API key | free tier, no card needed |
| Places key (optional) | console.cloud.google.com → new project → enable **Places API (New)** → Credentials → Create API key | adds address, coordinates and an exact Maps pin. under "API restrictions" pick Places API (New) only. needs a billing account, but 5,000 lookups a month are free. without it, places save with a Maps search link |
| Vercel | vercel.com | free Hobby plan |

### 2. sheet + apps script (build step 1)

1. create a new google sheet.
2. Extensions → Apps Script. delete what's there and paste in `apps-script/Code.gs`.
3. Project Settings (gear icon) → Script properties → add `SECRET` = your secret.
4. back in the editor, pick `testWrite` from the function dropdown and click Run. approve the permissions (Sheets, Drive for thumbnails, external requests). a `Places` tab appears with one test row, plus `Topics` and `Place types` tabs. delete the test row.
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

## license

[MIT](LICENSE): use it, change it, share it. it comes with no warranty.
