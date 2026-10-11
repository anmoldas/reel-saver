#!/usr/bin/env node
// One-time tidy of the sheet, for rows saved before the app did these itself:
//   - a place saved from several posts becomes one row, listing every post (times_saved counts them);
//   - "Not specified", "N/A", "Various" and the like are cleared from Places and Recipes;
//   - "United States" and similar become the name the rest of the sheet uses ("USA").
//
//   node scripts/tidy-sheet.mjs --url https://YOUR-APP.vercel.app            preview, changes nothing
//   node scripts/tidy-sheet.mjs --url https://YOUR-APP.vercel.app --apply    do it
//
// No Gemini or Apify use. Places are the same when Google gave them the same place ID, or, for rows
// without one, when they have the same name and city. --apply copies the tab to "Places (backup)"
// first and refuses if Places gained or lost rows since the preview. Don't run it while an import is running.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PLAN = '.tidy-plan.json';

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function readSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  if (existsSync('.env.local')) {
    const m = readFileSync('.env.local', 'utf8').match(/^\s*SECRET\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1].trim();
  }
  die('No SECRET found. Put it in .env.local or run with SECRET=… in front of the command');
}

const args = process.argv.slice(2);
const url = args[args.indexOf('--url') + 1] ?? '';
if (args.indexOf('--url') === -1 || !/^https:\/\//.test(url)) die('Pass your app address with --url https://….vercel.app');
const apply = args.includes('--apply');

async function send(body) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: readSecret(), action: 'tidy', ...body }),
  });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!data.ok) die(data.message ?? data.error ?? `HTTP ${res.status}`);
  if (data.before === undefined) die('The sheet did not understand "tidy". Paste the new Code.gs and deploy a new version first.');
  return data;
}

if (apply) {
  if (!existsSync(PLAN)) die('No preview yet. Run without --apply first.');
  const { count } = JSON.parse(readFileSync(PLAN, 'utf8'));
  const r = await send({ apply: true, count });
  console.log(`✓ Done. Places: ${r.before} rows → ${r.after}, ${r.merged.length} merged. ${r.placeholders} placeholder cells cleared, ${r.countries} countries renamed.`);
  console.log('The old Places tab is in "Places (backup)".');
} else {
  const r = await send({});
  writeFileSync(PLAN, JSON.stringify({ count: r.count }, null, 1));
  console.log(`Places: ${r.before} rows now → ${r.after} after merging repeats.\n`);
  console.log(`Merge (${r.merged.length}):`);
  for (const m of r.merged) console.log(`  - ${m}`);
  console.log(`\nClear ${r.placeholders} "Not specified"-style cells in Places and Recipes.`);
  console.log(`Rename ${r.countries} countries (e.g. "United States" → "USA").`);
  console.log(`\nNothing has changed yet. To apply exactly this: node scripts/tidy-sheet.mjs --url ${url} --apply`);
}
