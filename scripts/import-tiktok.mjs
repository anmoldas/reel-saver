#!/usr/bin/env node
// Sends your TikTok Favorites (from TikTok's "Download your data" JSON export) to Reel Saver,
// one at a time, keeping each video's original save date.
//
//   node scripts/import-tiktok.mjs EXPORT.json --url https://YOUR-APP.vercel.app [options]
//
//   --since 2025-01-01   only favorites saved on or after this date
//   --limit 50           stop after this many sends
//   --delay 30           seconds between sends (default 30, to stay inside the free Gemini/Apify limits)
//   --dry-run            list what would be sent, send nothing
//
// The SECRET comes from .env.local (or the SECRET environment variable); it is never printed.
// Progress is kept in .tiktok-import.json, so running the same command again picks up where it stopped.
// Newest favorites go first.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const STATE = '.tiktok-import.json';

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { delay: 30, limit: Infinity, since: null, dryRun: false, url: '', file: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--url') opts.url = argv[++i] ?? '';
    else if (a === '--since') opts.since = argv[++i] ?? '';
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--delay') opts.delay = Number(argv[++i]);
    else if (!a.startsWith('--') && !opts.file) opts.file = a;
    else die(`Unknown option: ${a}`);
  }
  if (!opts.file) die('Pass the path to user_data_tiktok.json');
  if (!opts.dryRun && !/^https:\/\//.test(opts.url)) die('Pass your app address with --url https://….vercel.app');
  if (opts.since && isNaN(Date.parse(opts.since))) die(`--since is not a date: ${opts.since}`);
  if (!(opts.limit > 0) || !(opts.delay >= 0)) die('--limit and --delay must be positive numbers');
  return opts;
}

function readSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  if (existsSync('.env.local')) {
    const m = readFileSync('.env.local', 'utf8').match(/^\s*SECRET\s*=\s*["']?([^"'\r\n]+)/m);
    if (m) return m[1].trim();
  }
  die('No SECRET found. Put it in .env.local or run with SECRET=… in front of the command');
}

/** Favorites from the export, newest first. TikTok writes dates as "YYYY-MM-DD HH:MM:SS" in UTC. */
function readFavorites(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    die(`Could not read ${file}: ${err.message}`);
  }
  const list = data?.['Likes and Favorites']?.['Favorite Videos']?.FavoriteVideoList;
  if (!Array.isArray(list)) die('No "Favorite Videos" found. Is this the JSON version of the TikTok export?');
  return list
    .filter((f) => typeof f?.Link === 'string')
    .map((f) => ({ link: f.Link, savedAt: f.Date ? `${f.Date.replace(' ', 'T')}Z` : undefined }))
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

// Outcomes that should not be retried on the next run.
const FINAL = /Already saved|private or deleted|Post unavailable/i;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const sinceMs = opts.since ? Date.parse(opts.since) : -Infinity;

  const todo = readFavorites(opts.file).filter(
    (f) => (!f.savedAt || Date.parse(f.savedAt) >= sinceMs) && !state[f.link]?.done,
  );
  const batch = todo.slice(0, opts.limit);
  console.log(`${todo.length} favorites to send${opts.since ? ` since ${opts.since}` : ''}; sending ${batch.length}.`);
  if (opts.dryRun) {
    for (const f of batch) console.log(`  ${f.savedAt?.slice(0, 10) ?? '?'}  ${f.link}`);
    return;
  }

  const secret = readSecret();
  const endpoint = `${opts.url.replace(/\/+$/, '')}/api/share`;
  const counts = { saved: 0, duplicate: 0, skipped: 0, failed: 0 };

  for (const [i, f] of batch.entries()) {
    let result;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: f.link, secret, saved_at: f.savedAt }),
      });
      result = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
      if (res.status === 401) die('The app rejected the SECRET. Check it matches the one in Vercel.');
    } catch (err) {
      result = { ok: false, message: String(err) };
    }

    const message = String(result.message ?? '');
    const kind = result.duplicate ? 'duplicate' : result.skipped ? 'skipped' : result.ok ? 'saved' : 'failed';
    counts[kind]++;
    state[f.link] = { done: result.ok === true || FINAL.test(message), message, at: new Date().toISOString() };
    writeFileSync(STATE, JSON.stringify(state, null, 1));
    console.log(`[${i + 1}/${batch.length}] ${kind === 'failed' ? '✗' : '✓'} ${f.savedAt?.slice(0, 10) ?? ''} ${message}`);

    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, opts.delay * 1000));
  }
  console.log(`Done: ${counts.saved} sent, ${counts.duplicate} already saved, ${counts.skipped} skipped as just for fun, ${counts.failed} failed.`);
  if (counts.failed) console.log('Run the same command again to retry the failed ones.');
}

main();
