# upgrading an older sheet

one-time fixes for sheets made before a feature was added. **a new sheet doesn't need any of this.**

functions like `sortAllTabs` run from the Apps Script editor: pick the function in the dropdown and click Run. the `node scripts/...` commands run in the save-faves folder on your computer. don't run any of the scripts while an import is going.

## moving from the old single tab

if your sheet has the older `Saves` tab, paste the new `Code.gs`, pick `migrateSaves` in the function dropdown and click Run once. rows move to the new tabs and the old tab is kept as `Saves (old)`. then deploy a new version (Deploy → Manage deployments → edit → Version: New version) so the web app uses the new code.

## newest first

run `sortAllTabs` once to put existing rows newest first.

## place types

places saved before the **Place types** tab existed have free-text categories. run `recategorizePlaces` once: it moves the old wording to `specialty`, guesses the type from keywords, and logs any it set to "other" so you can fix those by hand.

## places saved more than once

to merge places saved more than once, clear "Not specified" cells from Places and Recipes and spell countries one way, run `node scripts/tidy-sheet.mjs --url https://YOUR-APP.vercel.app`. it shows what it would change without changing anything; add `--apply` to do exactly that. Places is copied to `Places (backup)` first.

then `--notes` does the same for the merged places' `what_to_order`: it previews each one rewritten as one line, and `--notes --apply` writes exactly those.

## mentions

- ideas saved before the **Mentions** tab existed only have the plain `mentioned` list. run `backfillMentions` once to turn those into rows (kind, brand, why and price stay empty for them).
- to tidy rows from before grouping and the stricter rules, run `node scripts/clean-mentions.mjs --url https://YOUR-APP.vercel.app`. it asks Gemini to review every row and shows what it would remove, re-kind and merge, without changing anything. add `--apply` to do exactly that; the tab is copied to `Mentions (backup)` first. to only merge duplicates, run `mergeDuplicateMentions`.

## guides

ideas saved before guides existed have no `guide`. `node scripts/build-guides.mjs --url https://YOUR-APP.vercel.app` asks Gemini to pick one for every idea that has none and prints the groups, without changing anything. it saves them in `.guides-plan.json`: change any `guide` there to rename or move one. add `--apply` to write them and build the Guides tab.
