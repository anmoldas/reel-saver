# Reel Saver: setup guide for Claude Code

> **If you're a person reading this:** you don't need to follow these steps yourself. Open Claude Code in an empty folder and say:
>
> *Set up Reel Saver for me by following https://raw.githubusercontent.com/moneymolz/reel-saver/main/SETUP.md*
>
> It takes about 30–45 minutes, mostly creating free accounts. You'll need a computer (Mac or Windows) and an iPhone.

---

## Instructions for Claude Code

You are setting up **Reel Saver** for someone who is probably not a developer. When it's done, they tap Share on an Instagram reel or TikTok, and a row appears in their Google Sheet: a **place** (with a Maps link), a **recipe** (ingredients and steps), or an **idea** (tips, with key takeaways and the products mentioned).

How it works: an iOS Shortcut sends the link to a small Vercel function. The function fetches the post with Apify, reads it (and the video when needed) with Gemini, optionally looks up places with Google Places, and writes rows to their Google Sheet through an Apps Script web app.

### How to work with the person

- **One step at a time.** Give one short instruction, then wait for them to say it's done. Don't paste the whole guide at them.
- **Plain language.** Say "the settings file", not ".env.local". Say exactly which button to click. If a screen doesn't match what they describe, ask what they see.
- **Keys stay out of the chat.** Never ask them to paste an API key into the conversation, and never print a key or the secret, not even partly. They paste keys into the settings file, which you open for them. Use `node scripts/setup.mjs` to check, copy and send keys; it never prints values. If they paste a key into the chat anyway, use it, and mention they can make a new key later if they want.
- **Check before moving on.** After each account, run `node scripts/setup.mjs check`, which tests each key. Fix any ✗ before continuing.
- **Cost honesty.** Everything here is free for normal personal use, and only the optional Google Places step asks for a card. Say so when it comes up.

### Step 1: Get the code

Check Node.js 20 or newer is installed: `node -v`. If it's missing or old, ask them to install the **LTS** version from https://nodejs.org (click the big download button, run the installer), then open a new Claude Code session in the same folder.

Download the code into the current folder, without needing git:

```sh
curl -L https://github.com/moneymolz/reel-saver/archive/refs/heads/main.tar.gz | tar xz
cd reel-saver-main
npm install
npm test
```

On Windows, if `tar` or `curl` fail, download https://github.com/moneymolz/reel-saver/archive/refs/heads/main.zip, unzip it, and `cd` into it. All tests should pass. Every later command runs inside this folder.

Then create the settings file. This also generates their private SECRET:

```sh
node scripts/setup.mjs init
```

Open `.env.local` for them in a text editor (`open -e .env.local` on Mac, `notepad .env.local` on Windows). They'll paste keys there in the next steps. Remind them to **save the file** after each paste.

### Step 2: Apify (fetches the reel or TikTok)

1. Go to https://apify.com and sign up (free, no card).
2. Click **Settings** (bottom left) → **API & Integrations**.
3. Copy the **Personal API token**. It starts with `apify_api_`.
4. Paste it after `APIFY_TOKEN=` in the settings file and save.

The free plan includes $5 of credit a month. A save costs a fraction of a cent, so that covers hundreds of saves a month.

### Step 3: Gemini (reads the post and watches the video)

1. Go to https://aistudio.google.com and sign in with Google.
2. Click **Get API key** → **Create API key**. If asked, create it in a new project.
3. Paste it after `GEMINI_API_KEY=` and save.

It's free, with no card. Mention this once: on Gemini's free tier, Google may use the requests to improve its products. Here that means the public reels they save.

Run `node scripts/setup.mjs check`. Apify and Gemini should show ✓ (the Sheet comes next).

### Step 4: The Google Sheet and its Apps Script

1. Go to https://sheets.new to make a blank Sheet, and give it a name like "Reel Saver".
2. Click **Extensions → Apps Script**. A code editor opens in a new tab.
3. Copy the script to their clipboard: `pbcopy < apps-script/Code.gs` on Mac, or `Get-Content apps-script\Code.gs -Raw | Set-Clipboard` in Windows PowerShell. In the editor, they select everything in `Code.gs`, paste over it, and click the **save** icon.
4. Run `node scripts/setup.mjs copy SECRET` to copy their secret. In Apps Script: **gear icon (Project Settings)** → scroll to **Script properties** → **Add script property** → Property `SECRET`, Value: paste → **Save script properties**.
5. Back in the editor (the `< >` icon), pick **`testWrite`** in the function dropdown → **Run**. Google asks for permission: **Review permissions** → choose their account → **"Google hasn't verified this app"** → **Advanced** → **Go to … (unsafe)** → **Allow**. Explain why this is fine: it's their own script, in their own account, and Google shows that warning for any personal script. A **Places** tab with a "Test Ramen Bar" row appears, plus **Topics** and **Place types** tabs. They can delete the test row.
6. **Deploy → New deployment** → gear next to "Select type" → **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. This matters: anything else makes saves fail with a 401 error. The secret keeps strangers out. Click **Deploy**, then copy the **Web app URL** (ending in `/exec`).
7. They paste it after `SHEET_URL=` and save.

Run `node scripts/setup.mjs check`. All required items should be ✓. If the Sheet line fails, the access setting is almost always the cause. Fix it under **Deploy → Manage deployments → pencil → Who has access: Anyone → Version: New version → Deploy**; the URL stays the same.

### Step 5 (optional): Google Places, for exact addresses and map pins

Without this, places still save with a Google Maps search link, but without an address, coordinates or an exact pin. Ask whether they want it. It needs a card on a Google Cloud account, though the first 5,000 lookups each month are free.

If yes:
1. https://console.cloud.google.com → project picker at the top → **New project** (e.g. "reel-saver") → select it.
2. Search the top bar for **Places API (New)** → **Enable**. Add a billing account when asked.
3. **APIs & Services → Credentials → Create credentials → API key**. Then click the key → **API restrictions → Restrict key → Places API (New)** → **Save**.
4. Paste it after `PLACES_API_KEY=` and save. Run `check` again.

### Step 6: Put it online with Vercel

1. Ask them to sign up at https://vercel.com. The free **Hobby** plan is for personal use, which this is.
2. Run `npx vercel login` and have them finish the login in the browser window that opens.
3. Create the project and link this folder: `npx vercel link --yes --project reel-saver`. If the name is taken, add something to it, like `reel-saver-<their initials>`.
4. Send the keys: `node scripts/setup.mjs push`.
5. Deploy: `npx vercel deploy --prod --yes`. The output lists two addresses: a long one unique to this deploy, and a short production one (`https://<project>.vercel.app`, after "Aliased"). Use the **short** one as their **app address**: it stays the same across deploys, and Vercel's default protection blocks the long one. It's fine to show the address, since it's useless without the secret. If the output doesn't show it, find it under the project's **Domains** in the Vercel dashboard.
6. Test it: `node scripts/setup.mjs test https://<their-app>.vercel.app`. It should report the endpoint is live and that a stub row was written. Ask them to check the **Ideas** tab for the "Stub row" and delete it.

   If the test reaches a Vercel login page instead of the app: in the Vercel dashboard, open the project → **Settings → Deployment Protection**, and make sure production isn't protected.

7. A real test: ask them for a link to a reel or TikTok they like (a restaurant, a recipe or a tips video), then run `node scripts/setup.mjs test https://<their-app>.vercel.app "<link>"`. It answers "Saved …" or "Saving…". Within a minute or two the row should be in the right tab. If not, see **Troubleshooting**.

### Step 7: The iPhone Shortcut

This is what makes it one tap from Instagram or TikTok. It's easiest to build on a Mac in the **Shortcuts** app, which syncs to the iPhone through iCloud. It also works directly on the iPhone. Walk them through it:

1. Shortcuts → **+** → name it **Save to Sheet**.
2. Open the **ⓘ** (details) → turn on **Show in Share Sheet**. In the **Receive** block at the top, set the input types to just **URLs** and **Text**, and set **If there's no input** to **Get Clipboard**.
3. Add the **Get Contents of URL** action:
   - The URL is their app address followed by `/api/share`, e.g. `https://<their-app>.vercel.app/api/share`. If Shortcuts filled the URL slot with "Shortcut Input", clear it first.
   - Open the action's options (the **›** arrow, or **Show More** on Mac): **Method: POST**, **Request Body: JSON**.
   - **Add new field → Text**: key `url`, value = the **Shortcut Input** variable.
   - **Add new field → Text**: key `secret`, value = their secret. Run `node scripts/setup.mjs copy SECRET` so they can paste it. If they're building on the iPhone and own a Mac with the same Apple ID, Universal Clipboard carries the copy across; otherwise they paste it into a note to themselves first.
4. Add **Get Dictionary Value**: get **Value** for key `message` in **Contents of URL**.
5. Add **Show Notification** with the **Dictionary Value**.

Test it on the Mac: copy a reel link, then press ▶ in the Shortcut. On the iPhone, in Instagram tap **Share (paper plane) → Share to… / More → Save to Sheet**; in TikTok, **Share → More → Save to Sheet**. The first time, iOS asks to allow the connection, so tap **Always Allow**. Tip: in the share sheet, **Edit Actions** → add Save to Sheet to Favorites.

Android doesn't have Shortcuts. An Android user can get the same result with the free **HTTP Shortcuts** app, sending the same POST and JSON body.

### Step 8: Show them around

Finish with a short tour in plain words:

- **Places, Recipes, Ideas** tabs. Each row has a **done** checkbox and a **notes** column that are theirs.
- **Mentions**: every product, app, brand or book an idea recommends, with a shopping link, a want / bought / tried / skip dropdown, and how many saves mention it.
- **Topics** and **Place types** tabs: these are the lists Gemini sorts into. Encourage them to replace the starter topics with their own interests (e.g. Fitness, Skincare, Home). Adding a row is all it takes; no code. Ideas that fit nothing land in **Other** with a **suggested_topic**, which shows which topics to add.
- **Failed** tab: anything that couldn't be saved, with the reason. Sharing the same link again retries it.
- Sharing the same post twice says "Already saved".
- Posts that are just for fun (jokes, memes, skits) say "Skipped: just for fun" and add no row.

### Step 9 (optional): Bring in the TikToks they've already saved

Ask whether they want their past TikTok favorites in the sheet too. If yes:

1. In TikTok: **Profile → ☰ → Settings and privacy → Account → Download your data**. Pick **JSON** as the format, select **All data**, and tap **Request data**. It's usually ready within a few minutes to a day; they'll get a notification, then download the zip from the same screen (the **Download data** tab).
2. Have them put the zip in this folder, or tell you where it is. Unzip it into its own new folder and find `user_data_tiktok.json`. Only read the favorites part; the file also holds their DMs, which you don't need.
3. Preview first: `node scripts/import-tiktok.mjs <path to user_data_tiktok.json> --url https://<their-app>.vercel.app --dry-run`. Tell them how many favorites there are per year.
4. Cost check before sending: each TikTok uses about half a cent to a cent of Apify's free $5 a month, so around 500 fit in a month. Suggest starting with the newest, e.g. `--since 2025-01-01`, or a quick `--limit 10` test they can look at first.
5. Run it without `--dry-run`. It sends one at a time, newest first, keeps the date they favorited each one, skips deleted videos and just-for-fun posts, and stops by itself on errors like running out of Apify credit. Running the same command again later continues where it stopped.

---

## Troubleshooting (for Claude Code)

To see what happened on a save, run `npx vercel logs <their-app-url>`. Every step logs a line starting with `[reel-saver]`.

| What they see | Cause | Fix |
|---|---|---|
| `Sheet endpoint returned non-JSON (401)` | Web app access isn't "Anyone", or `SHEET_URL` isn't the `/exec` URL | Deploy → Manage deployments → pencil → Who has access: **Anyone** → New version → Deploy. Check `SHEET_URL`. |
| `Sheet: Wrong secret` | Script property `SECRET` doesn't match the settings file | `node scripts/setup.mjs copy SECRET`, then re-paste it in Project Settings → Script properties. |
| `Wrong secret` (from the app itself) | The Shortcut's secret field doesn't match | Re-copy the secret into the Shortcut's `secret` field. |
| `Missing environment variables: …` | Keys not sent to Vercel, or not redeployed after sending | `node scripts/setup.mjs push`, then `npx vercel deploy --prod --yes`. Vercel only picks up key changes on a new deploy. |
| Changes to the settings file have no effect | Same as above | Push and redeploy. |
| A row in **Failed**: `Post not found` / `Post unavailable` | Private or deleted post | Nothing to fix; it can't be read. |
| Failed: `Could not download the video (403)` | Very rare; the video link expired | Share it again. |
| Failed: `Apify 402` or a credits message | The month's free Apify credit is used up | Wait for next month, or add credit at apify.com. |
| Failed: `Gemini 429` | Free-tier rate limit (too many saves at once) | Wait a minute and share again. |
| "Skipped: just for fun" | Gemini judged the post to be only entertainment, so no row was added | Expected. If it got one wrong, there's no override yet; sharing again will usually give the same answer. |
| Failed: `Found nothing to save in this post` | Gemini couldn't find a place, recipe or tip, but wasn't sure it was just for fun | Usually nothing to fix. Delete the Failed row if they don't care about it. |
| Failed: `Timed out after 240s` | A slow scrape or long video | Share again. |
| A place has no address or coordinates | No `PLACES_API_KEY` (optional), or Places couldn't find it | Expected without Places. Otherwise the Maps link still works. |
| Shortcut shows nothing or an error page | Wrong URL in the Shortcut | It must be the app address followed by `/api/share`. |
| A test reaches a Vercel login page | Deployment Protection is on for production | Project → Settings → Deployment Protection → leave production unprotected. |

## Updating later

To get a newer version: download the code again (Step 1) into a fresh folder, copy their `.env.local` across, then run `npx vercel link --yes --project <their project>` and `npx vercel deploy --prod --yes`. If `apps-script/Code.gs` changed, paste it into Apps Script again and do **Deploy → Manage deployments → pencil → New version → Deploy**.
