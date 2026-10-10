# reel saver

tap **Share** on an instagram reel or tiktok, and it lands in your own google sheet, already sorted: **places** with a maps link, **recipes** with ingredients and steps, and **ideas** (tips, advice, how-tos) with the key takeaways. every product, app or brand a creator recommends also goes on a **mentions** list, so you can see what keeps coming up and tick off what you bought or tried. posts that are just for fun are skipped.

<!-- TODO screenshot: the sheet (Places / Ideas / Mentions tabs) next to the phone notification "Saved place: …" -->

## what you need

- an **iPhone** (it uses the Shortcuts app; Android works with the free HTTP Shortcuts app, see [SETUP.md](SETUP.md))
- a **google account** for the sheet
- a mac or windows computer for the one-time setup, about **45 minutes**, mostly making free accounts
- for the guided setup, [Claude Code](https://claude.com/claude-code), which needs a paid Claude plan. you can also [set it up by hand](#doing-it-by-hand) for free

and these accounts, which the setup walks you through one at a time, so you don't need them beforehand:

| account | what it does | cost |
|---|---|---|
| [Apify](https://apify.com) | fetches the post from instagram or tiktok | free, $5/month of credit, no card |
| [Google AI Studio](https://aistudio.google.com) (Gemini) | reads the post and watches the video | free, no card. just sign in with your google account |
| [Vercel](https://vercel.com) | runs the small app your phone sends links to | free Hobby plan, no card |
| [Google Cloud](https://console.cloud.google.com) (optional) | exact addresses and map pins for places | asks for a card, but 5,000 lookups a month are free. skip it and places still get a maps link |

so it's **$0 to run** for normal use.

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

so roughly 500 tiktoks or 1,500 instagram posts a month before Apify's free credit runs out. if it does, saves fail with a note in the **Failed** tab until the next month.

## how it decides

- **caption first.** Gemini reads the caption and decides whether the post is a place, a recipe, an idea or just for fun.
- **then the video, when the caption isn't enough.** for places and recipes that's when Gemini asks for it, a recipe is missing ingredients or steps, a place has no name or city, or confidence is below `CONFIDENCE_THRESHOLD` (0.7). ideas always get the video, because tips are usually spoken and the caption is just a teaser.
- **photos and carousels** work the same way, with the images instead of a video: up to 10 slides, including any text on them. a carousel with a video slide gets both, and tiktok photo slideshows count too.
- **several places in one post** become one row each.
- **just for fun is skipped.** jokes, memes, skits, pets and vlogs with nothing to visit, cook, buy or learn get "Skipped: just for fun" and no row. if the caption can't tell, it watches the video first. a funny post that still names a place, product or tip is saved.
- **duplicates**: share links are cleaned up first (`instagram.com/share/...`, `vm.tiktok.com/...` and `?igsh=` all point to the same post), so sharing a post twice says "Already saved: X" and nothing runs. failed saves are the exception: sharing again retries them.
- **thumbnails** are copied to a `Reel Saver thumbnails` folder in your Drive, because instagram and tiktok image links expire within days.

## the sheet

one tab per kind of save, newest at the top. every save re-sorts its tab by `saved_at`, so imported old posts land in date order too. columns are matched by name, so you can reorder them or add your own.

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
- **older sheets:** run `sortAllTabs` once to put existing rows newest first.

notes marked **older sheets** are one-time fixes for sheets made before a feature was added; a new sheet doesn't need them. functions like `sortAllTabs` run from the Apps Script editor: pick the function in the dropdown and click Run.

### mentions

everything an idea recommends gets one row in **Mentions**: a shopping and to-try list across all your saves. when another save recommends the same thing, it's added to that row instead of making a new one.

- `kind` is one of product, app/tool, brand, store, book, show/movie, course, person. `why` is one line on why it was recommended (from the first save that mentioned it); `price` is filled only when the video says one.
- `shop_link` is a Google Shopping search for products and brands, and a web search for everything else.
- `status` is a dropdown (want, bought, tried, skip); `notes` is yours.
- `times_mentioned` counts the saves that recommend it, so something three creators recommend stands out. `from`, `creator` and `source_url` list each of those saves, one per line.
- names match loosely: case, accents and punctuation don't matter, and "Glaze Drops" by Kérastase matches "Kerastase Glaze Drops". a brand on its own ("Muji") stays separate from its products ("Muji Lip Essence").
- places don't go here (they're in Places), and neither does anything the creator criticised, a giveaway prize or a credited source.
- **older sheets:** ideas saved before this tab existed only have the plain `mentioned` list. run `backfillMentions` once to turn those into rows (kind, brand, why and price stay empty for them).
- **older sheets:** to tidy rows from before grouping and the stricter rules, run `node scripts/clean-mentions.mjs --url https://YOUR-APP.vercel.app`. it asks Gemini to review every row and shows what it would remove, re-kind and merge, without changing anything. add `--apply` to do exactly that; the tab is copied to `Mentions (backup)` first. to only merge duplicates, run `mergeDuplicateMentions`. don't run either while an import is going.

### topics

the **Topics** tab lists the idea topics (Travel tips, Clothing, Career, AI, Video editing, Journaling, Organization to start). Gemini must pick one of them or "Other".

- **to add a topic**, add a row to the Topics tab. the next save uses it; no redeploy.
- **after adding a topic**, run `applyNewTopics` from the Apps Script editor to move ideas already saved under "Other" whose `suggested_topic` matches it. their Mentions rows follow.
- **to find new topics**, filter Ideas to `topic = Other` now and then. the `suggested_topic` column says what Gemini would have called each one. if the same suggestion keeps appearing, add it to Topics.

### place types

the **Place types** tab lists the place categories: restaurant, cafe, bar, bakery & dessert, home & ceramics, clothing, beauty, books & stationery, market, museum & gallery, sight, activity, stay. Gemini must pick one or "other", so a pottery shop, a ceramics store and a home decor shop all land in **home & ceramics**, which makes `category` easy to filter on. add a row to add a type.

**older sheets:** places saved before this list existed have free-text categories. run `recategorizePlaces` once: it moves the old wording to `specialty`, guesses the type from keywords, and logs any it set to "other" so you can fix those by hand.

### moving from the old single tab

if your sheet has the older `Saves` tab, paste the new `Code.gs`, pick `migrateSaves` in the function dropdown and click Run once. rows move to the new tabs and the old tab is kept as `Saves (old)`. then deploy a new version (Deploy → Manage deployments → edit → Version: New version) so the web app uses the new code.

## importing what you've already saved

bring in your past TikTok favorites and Instagram saved posts. three things to know first:

- **it runs on your computer**, not online. your computer has to stay on, awake and connected the whole time. if it sleeps or you close the window, it just stops; run the same command again and it picks up where it left off.
- **it's slow on purpose.** it sends one post at a time and waits for each to finish, so figure on roughly a minute per post: 100 posts is an hour or two, 500 is most of a day. plug in your laptop.
- **it uses the same $5 of Apify credit as your everyday saves.** that's about 500 TikToks or 1,500 Instagram posts a month in total (see [what it costs](#what-it-costs)). if an import uses it all up, sharing new reels fails until next month. so leave some room: import a few hundred at a time with `--limit`, and do the rest next month. you can see what's left on apify.com under **Billing**.

ask each app for your data in **JSON** format:

- **tiktok**: Settings and privacy → Account → Download your data → JSON. you get `user_data_tiktok.json`.
- **instagram**: Accounts Center → Your information and permissions → Download your information → Some of your information → **Saved** only → Download to device, Format **JSON**, Date range **All time**. unzip it; that's the folder you pass.

see how many there are first (this sends nothing and costs nothing):

```sh
node scripts/import-saves.mjs user_data_tiktok.json instagram-folder --dry-run
```

then send the newest ones, a batch at a time:

```sh
node scripts/import-saves.mjs user_data_tiktok.json instagram-folder --url https://YOUR-APP.vercel.app --since 2025-01-01 --limit 300
```

on a mac, put `caffeinate -i` in front of the command to keep it from sleeping while it runs. on windows, set Settings → System → Power → Sleep to Never while it runs.

it sends newest first, and each row keeps the date you saved it. instagram collections go in the `notes` column ("IG collection: Food"). it stops by itself at the first error that isn't about a single post (out of Apify credit, Gemini's daily limit) or after 3 failures in a row; deleted or private posts are just skipped. running it again skips anything already done (progress is in `.import-progress.json`), so next month's batch is the same command. the SECRET is read from `.env.local`.

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

### 2. sheet + apps script

1. create a new google sheet.
2. Extensions → Apps Script. delete what's there and paste in `apps-script/Code.gs`.
3. Project Settings (gear icon) → Script properties → add `SECRET` = your secret.
4. back in the editor, pick `testWrite` from the function dropdown and click Run. approve the permissions (Sheets, Drive for thumbnails, external requests). a `Places` tab appears with one test row, plus `Topics` and `Place types` tabs. delete the test row.
5. Deploy → New deployment → type **Web app**. Execute as **Me**, Who has access **Anyone**. copy the URL ending in `/exec`. that's your `SHEET_URL`.

> if you edit `Code.gs` later, use Deploy → Manage deployments → edit → Version: New version, so the URL stays the same. don't make a new deployment or archive the old one: the address changes and every save fails until `SHEET_URL` is updated.

### 3. deploy to vercel

1. vercel.com → Add New → Project → import your copy of this repo (or deploy from the folder with `npx vercel deploy --prod`).
2. framework preset: Other. leave the build settings empty.
3. Environment Variables: add `SECRET`, `APIFY_TOKEN`, `GEMINI_API_KEY`, `SHEET_URL`, and `PLACES_API_KEY` if you have one. the rest of `.env.example` is optional.
4. Deploy. your endpoint is `https://<project>.vercel.app/api/share`.

test it with a stub row, which skips Apify and Gemini:

```sh
curl -X POST https://<project>.vercel.app/api/share \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.instagram.com/reel/TEST1/","secret":"YOUR_SECRET","stub":true}'
```

then a real one (drop `"stub":true` and use a real reel or tiktok link). logs are under the project's **Logs** tab in Vercel. every step prints a `[reel-saver]` line.

### 4. iOS shortcut

1. Shortcuts app → + → name it **Save to Sheet**.
2. tap the ⓘ (details) → turn on **Show in Share Sheet**. under the share sheet types, keep only **URLs** and **Text**, and set **If there's no input** to **Get Clipboard**.
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
