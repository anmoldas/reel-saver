#!/usr/bin/env node
// Groups your saved ideas into guides and builds the Guides tab: one row per subject, with the
// takeaways of every video on it combined. New saves are grouped as they come in; this is for the
// ideas you saved before guides existed, and for rebuilding after an import.
//
//   node scripts/build-guides.mjs --url https://YOUR-APP.vercel.app             preview, changes nothing
//   node scripts/build-guides.mjs --url https://YOUR-APP.vercel.app --apply     apply the previewed plan
//   node scripts/build-guides.mjs --url https://YOUR-APP.vercel.app --rebuild   rebuild every guide's row
//
// The preview asks Gemini to pick a guide for every idea that has none (text only, no Apify cost) and
// saves the plan to .guides-plan.json. You can edit the "guide" names in that file before applying.
// --apply writes them to the Ideas tab's guide column, then rebuilds each guide they touch.
// Don't run it while an import is running.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PLAN = '.guides-plan.json';

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

async function send(body) {
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/guides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: readSecret(), ...body }),
  });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!data.ok) die(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

/** Rebuilds each guide with two or more videos, one at a time. If one fails, run --rebuild to finish. */
async function build(guides) {
  let built = 0;
  for (const guide of guides) {
    const r = await send({ action: 'build', guide });
    if (r.videos > 1) {
      built++;
      console.log(`  ✓ ${guide} (${r.videos} videos)`);
    }
  }
  console.log(`\n✓ Done. ${built} guides in the Guides tab. Guides with one video get a row once a second one is saved.`);
}

if (args.includes('--rebuild')) {
  const { guides } = await send({ action: 'list' });
  console.log(`Rebuilding ${guides.filter((g) => g.videos > 1).length} guides…`);
  await build(guides.map((g) => g.guide));
} else if (args.includes('--apply')) {
  if (!existsSync(PLAN)) die('No preview yet. Run without --apply first.');
  const { assignments } = JSON.parse(readFileSync(PLAN, 'utf8'));
  const r = await send({ action: 'assign', assignments });
  console.log(`✓ Set the guide on ${r.assigned} ideas. Building the guides…`);
  await build([...new Set(assignments.map((a) => a.guide.trim()).filter(Boolean))]);
} else {
  console.log('Grouping your ideas with Gemini… (a minute or so)');
  const { existing, assignments } = await send({ action: 'preview' });
  writeFileSync(PLAN, JSON.stringify({ assignments }, null, 1));
  const groups = new Map();
  for (const a of assignments) groups.set(a.guide, [...(groups.get(a.guide) ?? []), a.title]);
  const already = new Map(existing.map((e) => [e.guide, e.videos]));
  const sorted = [...groups].sort((a, b) => b[1].length + (already.get(b[0]) ?? 0) - a[1].length - (already.get(a[0]) ?? 0));
  console.log(`\n${assignments.length} ideas without a guide → ${groups.size} guides:\n`);
  for (const [guide, titles] of sorted) {
    const had = already.get(guide);
    console.log(`${guide} (${titles.length}${had ? ` new, ${had} already in it` : ''})`);
    for (const t of titles) console.log(`  - ${t}`);
  }
  console.log(`\nNothing has changed yet. To rename or move one, edit the "guide" in ${PLAN}.`);
  console.log(`To apply: node scripts/build-guides.mjs --url ${url} --apply`);
}
