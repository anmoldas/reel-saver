#!/usr/bin/env node
// Sends the posts you saved on TikTok or Instagram to Reel Saver, one at a time, keeping each
// post's original save date. Works with each app's "Download your data" export in JSON format:
//   TikTok:    user_data_tiktok.json (your Favorites)
//   Instagram: the unzipped export folder, or its your_instagram_activity/saved/saved_posts.json
//              (your Saved posts; the collection each one is in goes in the notes column)
//
//   node scripts/import-saves.mjs EXPORT [EXPORT…] --url https://YOUR-APP.vercel.app [options]
//
//   --since 2025-01-01   only favorites saved on or after this date
//   --limit 50           stop after this many sends
//   --delay 5            seconds between sends (default 5; each send already waits for the save to finish)
//   --dry-run            list what would be sent, send nothing
//
// It stops at the first error that is not about one video (out of Apify credit, Gemini's daily
// limit, the Sheet not answering), or after 3 failures in a row. Deleted, private or very slow videos are skipped,
// and so is a video Gemini is too busy to watch right now (it is tried again on the next run).
// The SECRET comes from .env.local (or the SECRET environment variable); it is never printed.
// Progress is kept in .import-progress.json, so running the same command again picks up where it stopped.
// Newest saves go first.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE = '.import-progress.json';
const OLD_STATE = '.tiktok-import.json'; // from before Instagram support; read, never written

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { delay: 5, limit: Infinity, since: null, dryRun: false, url: '', files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--url') opts.url = argv[++i] ?? '';
    else if (a === '--since') opts.since = argv[++i] ?? '';
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--delay') opts.delay = Number(argv[++i]);
    else if (!a.startsWith('--')) opts.files.push(a);
    else die(`Unknown option: ${a}`);
  }
  if (!opts.files.length) die('Pass the export: user_data_tiktok.json, or the unzipped Instagram folder');
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

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    die(`Could not read ${file}: ${err.message}`);
  }
}

/** TikTok Favorites. Dates are "YYYY-MM-DD HH:MM:SS" in UTC. */
function tiktokSaves(data) {
  const list = data?.['Likes and Favorites']?.['Favorite Videos']?.FavoriteVideoList;
  if (!Array.isArray(list)) return null;
  return list
    .filter((f) => typeof f?.Link === 'string')
    .map((f) => ({ link: f.Link, savedAt: f.Date ? `${f.Date.replace(' ', 'T')}Z` : undefined }));
}

const IG_POST = /^https:\/\/www\.instagram\.com\/(p|reel|reels|tv)\/[\w-]+\/?/;

/** Every Instagram post link anywhere inside `o` (the export nests them in label/value lists). */
function igLinks(o, out = new Set()) {
  if (Array.isArray(o)) o.forEach((v) => igLinks(v, out));
  else if (o && typeof o === 'object') {
    for (const v of [o.href, o.value]) if (typeof v === 'string' && IG_POST.test(v)) out.add(v.match(IG_POST)[0]);
    Object.values(o).forEach((v) => igLinks(v, out));
  }
  return out;
}

/** Instagram Saved posts, with the collections each is in. Timestamps are Unix seconds. */
function instagramSaves(posts, collections) {
  if (!Array.isArray(posts)) return null;
  const inCollections = new Map();
  for (const c of Array.isArray(collections) ? collections : []) {
    const name = (c?.label_values ?? []).find((lv) => lv?.label === 'Name')?.value;
    if (!name) continue;
    for (const link of igLinks(c.label_values)) inCollections.set(link, [...(inCollections.get(link) ?? []), name]);
  }
  const saves = new Map();
  for (const p of posts) {
    const savedAt = p?.timestamp ? new Date(p.timestamp * 1000).toISOString() : undefined;
    for (const link of igLinks(p?.label_values)) saves.set(link, { link, savedAt });
  }
  // A post can sit in a collection without being in the main Saved list.
  for (const link of inCollections.keys()) if (!saves.has(link)) saves.set(link, { link, savedAt: undefined });
  return [...saves.values()].map((s) => {
    const names = inCollections.get(s.link);
    return names ? { ...s, note: `IG collection: ${names.join(', ')}` } : s;
  });
}

/** Reads one export (a file or the unzipped folder) into { link, savedAt?, note? } entries. */
function readExport(path) {
  if (!existsSync(path)) die(`Not found: ${path}`);
  if (statSync(path).isDirectory()) {
    for (const f of ['user_data_tiktok.json', 'your_instagram_activity/saved/saved_posts.json', 'saved_posts.json']) {
      if (existsSync(join(path, f))) return readExport(join(path, f));
    }
    die(`No user_data_tiktok.json or saved_posts.json in ${path}`);
  }
  const data = readJson(path);
  const tiktok = tiktokSaves(data);
  if (tiktok) return tiktok;
  const collectionsFile = join(dirname(path), 'saved_collections.json');
  const instagram = instagramSaves(data, existsSync(collectionsFile) ? readJson(collectionsFile) : []);
  if (instagram) return instagram;
  die(`${path} is not a TikTok or Instagram export in JSON format`);
}

/** Progress from both files; re-read before each write so two imports at once don't overwrite each other. */
function readState() {
  const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
  return { ...read(OLD_STATE), ...read(STATE) };
}

function saveProgress(link, entry) {
  const current = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  current[link] = entry;
  writeFileSync(STATE, JSON.stringify(current, null, 1));
}

// Outcomes that should not be retried on the next run.
const FINAL = /Already saved|private or deleted|Post unavailable|Found nothing to save/i;
// Failures that are about one video, so the import carries on.
const PER_VIDEO = /private or deleted|Post unavailable|Found nothing to save|Video is too large|Could not download the (video|images)|Could not work out which post|Timed out after|Gemini 503/i;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const state = readState();
  const sinceMs = opts.since ? Date.parse(opts.since) : -Infinity;

  const seen = new Set();
  const all = opts.files
    .flatMap(readExport)
    .filter((f) => !seen.has(f.link) && seen.add(f.link)) // the same post saved on two accounts
    .sort((a, b) => String(b.savedAt ?? '').localeCompare(String(a.savedAt ?? '')));
  // Older progress files marked fewer outcomes as done, so check the message too.
  const done = (link) => state[link]?.done || FINAL.test(state[link]?.message ?? '');
  const todo = all.filter((f) => (!f.savedAt || Date.parse(f.savedAt) >= sinceMs) && !done(f.link));
  const batch = todo.slice(0, opts.limit);
  console.log(`${todo.length} saves to send${opts.since ? ` since ${opts.since}` : ''}; sending ${batch.length}.`);
  if (opts.dryRun) {
    for (const f of batch) console.log(`  ${f.savedAt?.slice(0, 10) ?? '?'}  ${f.link}${f.note ? `  (${f.note})` : ''}`);
    return;
  }

  const secret = readSecret();
  const endpoint = `${opts.url.replace(/\/+$/, '')}/api/share`;
  const counts = { saved: 0, duplicate: 0, skipped: 0, failed: 0 };
  let failedInARow = 0;
  let stopReason = '';

  for (const [i, f] of batch.entries()) {
    let result;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: f.link, secret, saved_at: f.savedAt, note: f.note, wait: true }),
      });
      result = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
      if (res.status === 401) die('The app rejected the SECRET. Check it matches the one in Vercel.');
    } catch (err) {
      result = { ok: false, message: String(err) };
    }

    const message = String(result.message ?? '');
    const kind = result.duplicate ? 'duplicate' : result.skipped ? 'skipped' : result.ok ? 'saved' : 'failed';
    counts[kind]++;
    saveProgress(f.link, { done: result.ok === true || FINAL.test(message), message, at: new Date().toISOString() });
    console.log(`[${i + 1}/${batch.length}] ${kind === 'failed' ? '✗' : '✓'} ${f.savedAt?.slice(0, 10) ?? ''} ${message}`);

    failedInARow = kind === 'failed' ? failedInARow + 1 : 0;
    if (kind === 'failed' && !PER_VIDEO.test(message)) stopReason = message;
    else if (failedInARow >= 3) stopReason = '3 failures in a row';
    if (stopReason) break;

    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, opts.delay * 1000));
  }
  if (stopReason) console.log(`Stopped: ${stopReason}`);
  console.log(`Done: ${counts.saved} sent, ${counts.duplicate} already saved, ${counts.skipped} skipped as just for fun, ${counts.failed} failed.`);
  if (counts.failed) console.log('Run the same command again to retry the failed ones.');
}

main();
