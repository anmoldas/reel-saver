#!/usr/bin/env node
// Tries the saves in the Failed tab again: the ones that failed for a reason that passes (Gemini busy,
// a timeout, a hiccup), whether they came from your phone or an import. Each keeps its original date,
// and a save that works now (or turns out to have nothing worth saving) clears its Failed row. Deleted or private posts, and posts with nothing
// to save, are listed but not retried.
//
//   node scripts/retry-failed.mjs --url https://YOUR-APP.vercel.app             retry them
//   node scripts/retry-failed.mjs --url https://YOUR-APP.vercel.app --dry-run   list them, send nothing
//
//   --delay 5   seconds between saves (default 5)
//
// Each retry uses Apify credit and Gemini's daily allowance like a new save. It stops when either runs
// out, and you can run it again later.

import { existsSync, readFileSync } from 'node:fs';

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
const url = (args[args.indexOf('--url') + 1] ?? '').replace(/\/+$/, '');
if (args.indexOf('--url') === -1 || !/^https:\/\//.test(url)) die('Pass your app address with --url https://….vercel.app');
const dryRun = args.includes('--dry-run');
const delay = args.includes('--delay') ? Number(args[args.indexOf('--delay') + 1]) : 5;
if (!(delay >= 0)) die('--delay must be a number of seconds');

// Failures that another try won't fix.
const PERMANENT = /private or deleted|Post unavailable|Found nothing to save|not a valid link|Only Instagram and TikTok|Could not work out which post/i;
// Errors that mean "stop for today", with what to tell the person.
const EXPLAIN = [
  [/exceeded your current quota|RESOURCE_EXHAUSTED|Gemini 429/i,
    "Gemini's free daily allowance is used up. Everyday saves from your phone will fail too until it resets (midnight Pacific time). Run this again tomorrow."],
  [/Apify 402|not enough usage|credit|usage limit|monthly/i,
    'Your Apify credit for this month looks used up, so saving anything will fail until it renews. Check apify.com → Billing.'],
];

const secret = readSecret();

async function post(path, body) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, ...body }),
  });
  if (res.status === 401) die('The app rejected the SECRET. Check it matches the one in Vercel.');
  return res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
}

const list = await post('/api/maintenance', { action: 'failed' });
if (!list.ok) die(list.message ?? 'Could not read the Failed tab');
if (!Array.isArray(list.rows)) die('The sheet did not understand "failed". Paste the new Code.gs and deploy a new version first.');

const firstLine = (s) => String(s).split('\n')[0].slice(0, 160);
const retry = list.rows.filter((r) => r.source_url && !PERMANENT.test(r.error));
const left = list.rows.filter((r) => r.source_url && PERMANENT.test(r.error));
console.log(`${list.rows.length} rows in Failed: ${retry.length} worth another try, ${left.length} that won't work.`);
for (const r of left) console.log(`  · not retrying ${r.source_url}: ${firstLine(r.error)}`);
if (dryRun) {
  for (const r of retry) console.log(`  → ${r.saved_at.slice(0, 10)} ${r.source_url}: ${firstLine(r.error)}`);
  process.exit(0);
}

const counts = { saved: 0, skipped: 0, failed: 0 };
let stopReason = '';
for (const [i, r] of retry.entries()) {
  let result;
  try {
    result = await post('/api/share', { url: r.source_url, saved_at: r.saved_at || undefined, wait: true });
  } catch (err) {
    result = { ok: false, message: String(err) };
  }
  const message = String(result.message ?? '');
  counts[result.skipped ? 'skipped' : result.ok ? 'saved' : 'failed']++;
  console.log(`[${i + 1}/${retry.length}] ${result.ok ? '✓' : '✗'} ${message.split('\n')[0]}`);
  const why = !result.ok && EXPLAIN.find(([re]) => re.test(message));
  if (why) {
    stopReason = why[1];
    break;
  }
  if (i < retry.length - 1) await new Promise((res) => setTimeout(res, delay * 1000));
}
if (stopReason) console.log(`Stopped: ${stopReason}`);
console.log(`Done: ${counts.saved} saved, ${counts.skipped} skipped as not worth saving, ${counts.failed} still failing (they stay in the Failed tab).`);
