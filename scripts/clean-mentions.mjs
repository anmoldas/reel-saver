#!/usr/bin/env node
// One-time cleanup of the Mentions tab: drops rows that don't belong (places, things the creator
// criticised, giveaway prizes, credited sources), fixes kinds, and merges duplicates into one row each.
//
//   node scripts/clean-mentions.mjs --url https://YOUR-APP.vercel.app            preview, changes nothing
//   node scripts/clean-mentions.mjs --url https://YOUR-APP.vercel.app --apply    apply the previewed plan
//
// The preview asks Gemini to review every row (text only, no Apify cost) and saves the plan to
// .mentions-cleanup-plan.json. --apply sends that same plan, so what you saw is what happens.
// The Sheet copies the tab to "Mentions (backup)" before changing it, and refuses the plan if the
// tab gained or lost rows since the preview (run it again then). Don't run it while an import is running.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PLAN = '.mentions-cleanup-plan.json';

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
  const res = await fetch(`${url.replace(/\/+$/, '')}/api/cleanup-mentions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: readSecret(), ...body }),
  });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!data.ok) die(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

if (apply) {
  if (!existsSync(PLAN)) die('No preview yet. Run without --apply first.');
  const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
  const r = await send({ plan });
  console.log(`✓ Done. ${r.before} rows → ${r.after}: ${r.removed} removed, ${r.merged.length} merged. The old tab is in "Mentions (backup)".`);
} else {
  console.log('Reviewing every Mentions row with Gemini… (a minute or two)');
  const { plan, preview } = await send({});
  writeFileSync(PLAN, JSON.stringify(plan, null, 1));
  console.log(`\n${preview.before} rows now → ${preview.after} after the cleanup.\n`);
  console.log(`Remove (${plan.remove.length}):`);
  for (const r of plan.remove) console.log(`  - ${r.name}: ${r.reason}`);
  console.log(`\nChange kind (${plan.updates.length}):`);
  for (const u of plan.updates) console.log(`  - ${u.name}: ${u.from_kind || '(blank)'} → ${u.kind}`);
  console.log(`\nMerge (${preview.merged.length}):`);
  for (const m of preview.merged) console.log(`  - ${m}`);
  console.log(`\nNothing has changed yet. To apply exactly this: node scripts/clean-mentions.mjs --url ${url} --apply`);
}
