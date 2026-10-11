#!/usr/bin/env node
// Setup helper used by SETUP.md (and handy if you set things up by hand). It keeps your keys in
// .env.local on your computer and never prints them.
//
//   node scripts/setup.mjs init            create .env.local with a generated SECRET
//   node scripts/setup.mjs check           say which keys are set and whether each one works
//   node scripts/setup.mjs copy NAME       copy one value to the clipboard
//   node scripts/setup.mjs push            send the keys to the linked Vercel project (production)
//   node scripts/setup.mjs test URL [link] health check, then a stub row (or a real save if a link is given)

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const FILE = '.env.local';
const REQUIRED = ['SECRET', 'APIFY_TOKEN', 'GEMINI_API_KEY', 'SHEET_URL'];
const OPTIONAL = ['PLACES_API_KEY', 'GEMINI_MODEL', 'INSTAGRAM_ACTOR', 'TIKTOK_ACTOR', 'CONFIDENCE_THRESHOLD', 'SYNC_WAIT_SECONDS'];

function readEnv() {
  if (!existsSync(FILE)) die(`${FILE} not found. Run: node scripts/setup.mjs init`);
  const env = {};
  for (const line of readFileSync(FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  // Treat the example placeholders as empty.
  for (const [k, v] of Object.entries(env)) if (/xxx|pick-a-long-random-string/.test(v)) env[k] = '';
  return env;
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function status(url, init) {
  try {
    const res = await fetch(url, init);
    return { code: res.status, body: await res.text() };
  } catch (err) {
    return { code: 0, body: String(err) };
  }
}

const commands = {
  init() {
    if (existsSync(FILE)) {
      console.log(`${FILE} already exists; leaving it as is.`);
      return;
    }
    copyFileSync('.env.example', FILE);
    const secret = randomBytes(24).toString('hex');
    writeFileSync(FILE, readFileSync(FILE, 'utf8').replace(/^SECRET=.*$/m, `SECRET=${secret}`));
    console.log(`✓ Created ${FILE} with a new random SECRET (not shown). Fill in the other keys there.`);
  },

  async check() {
    const env = readEnv();
    let ok = true;
    for (const k of REQUIRED) {
      if (!env[k]) {
        console.log(`✗ ${k} is empty`);
        ok = false;
      }
    }
    if (env.APIFY_TOKEN) {
      const r = await status('https://api.apify.com/v2/users/me', { headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` } });
      console.log(r.code === 200 ? '✓ Apify token works' : `✗ Apify token rejected (HTTP ${r.code})`);
      ok &&= r.code === 200;
    }
    if (env.GEMINI_API_KEY) {
      const r = await status('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      });
      console.log(r.code === 200 ? '✓ Gemini key works' : `✗ Gemini key rejected (HTTP ${r.code})`);
      ok &&= r.code === 200;
    }
    if (env.SHEET_URL) {
      if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(env.SHEET_URL)) {
        console.log('✗ SHEET_URL should be the Apps Script web app URL ending in /exec');
        ok = false;
      } else {
        const r = await status(env.SHEET_URL);
        const good = r.code === 200 && r.body.includes('"ok":true');
        console.log(
          good
            ? '✓ Sheet web app reachable'
            : `✗ Sheet web app not reachable (HTTP ${r.code}). Check Deploy > Manage deployments: Execute as "Me", Who has access "Anyone"`,
        );
        ok &&= good;
        if (good && env.SECRET) {
          const w = await status(env.SHEET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: env.SECRET, action: 'check', source_url: 'https://example.com/setup-check' }),
          });
          const secretOk = w.body.includes('"ok":true');
          console.log(
            secretOk
              ? '✓ Sheet accepts the SECRET'
              : '✗ Sheet rejected the SECRET. In Apps Script: Project Settings > Script properties > SECRET must match .env.local',
          );
          ok &&= secretOk;
        }
      }
    }
    if (env.PLACES_API_KEY) {
      const r = await status('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.PLACES_API_KEY, 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: 'Eiffel Tower', pageSize: 1 }),
      });
      console.log(r.code === 200 ? '✓ Places key works' : `✗ Places key rejected (HTTP ${r.code}). Is "Places API (New)" enabled with billing?`);
      ok &&= r.code === 200;
    } else {
      console.log('· PLACES_API_KEY not set (optional: places save without address or coordinates)');
    }
    console.log(ok ? '\nAll set.' : '\nFix the ✗ items above, then run check again.');
    process.exit(ok ? 0 : 1);
  },

  copy(name) {
    if (!name) die('Usage: node scripts/setup.mjs copy NAME');
    const value = readEnv()[name];
    if (!value) die(`${name} is empty in ${FILE}`);
    const tool =
      process.platform === 'darwin' ? ['pbcopy', []] : process.platform === 'win32' ? ['clip', []] : ['xclip', ['-selection', 'clipboard']];
    const r = spawnSync(tool[0], tool[1], { input: value });
    if (r.status !== 0) die(`Could not copy to the clipboard (${tool[0]} failed). Open ${FILE} and copy ${name} by hand.`);
    console.log(`✓ Copied ${name} to the clipboard (not shown).`);
  },

  push() {
    const env = readEnv();
    const missing = REQUIRED.filter((k) => !env[k]);
    if (missing.length) die(`Fill these in ${FILE} first: ${missing.join(', ')}`);
    for (const k of [...REQUIRED, ...OPTIONAL]) {
      if (!env[k]) continue;
      // Replace any existing value so re-running is safe.
      spawnSync('npx', ['vercel', 'env', 'rm', k, 'production', '--yes'], { stdio: 'ignore', shell: process.platform === 'win32' });
      const r = spawnSync('npx', ['vercel', 'env', 'add', k, 'production'], {
        input: env[k],
        stdio: ['pipe', 'ignore', 'pipe'],
        shell: process.platform === 'win32',
      });
      if (r.status !== 0) die(`Could not add ${k} to Vercel: ${String(r.stderr).trim().split('\n').pop()}`);
      console.log(`✓ ${k}`);
    }
    console.log('\nKeys are in Vercel. Deploy (or redeploy) so they take effect: npx vercel deploy --prod --yes');
  },

  async test(base, link) {
    if (!base) die('Usage: node scripts/setup.mjs test https://YOUR-PROJECT.vercel.app [link]');
    const endpoint = `${base.replace(/\/+$/, '').replace(/\/api\/share$/, '')}/api/share`;
    const env = readEnv();
    const health = await status(endpoint);
    if (!health.body.includes('"ok":true')) {
      die(`${endpoint} did not answer (HTTP ${health.code}). Is the deploy finished? If it shows a Vercel login page, turn off Deployment Protection for production.`);
    }
    console.log('✓ Endpoint is live');
    const body = link ? { url: link, secret: env.SECRET } : { url: 'https://www.instagram.com/reel/SETUPTEST/', secret: env.SECRET, stub: true };
    const r = await status(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let message = r.body;
    try {
      message = JSON.parse(r.body).message;
    } catch {}
    console.log(`${r.code === 200 ? '✓' : '✗'} ${message}`);
    if (!link && r.code === 200) console.log('  A "Stub row" should now be in the Ideas tab. Delete it.');
    process.exit(r.code === 200 ? 0 : 1);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) die(`Unknown command "${cmd ?? ''}". Commands: ${Object.keys(commands).join(', ')}`);
await commands[cmd](...args);
