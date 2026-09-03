#!/usr/bin/env node
/**
 * Runs the Ubisoft chain from wherever you run it.
 *
 * Why this exists: the same code deployed to Vercel is met with a DataDome
 * bot-protection challenge (HTTP 403, geo.captcha-delivery.com). Datacenter IP
 * ranges are challenged far more aggressively than residential ones, so the
 * deployment failing does not prove a normal machine will.
 *
 * This makes no attempt to defeat that protection. It sends one ordinary
 * request with an honest User-Agent from whatever connection you are on. If
 * you are challenged too, that is the answer, and the Ubisoft route is closed.
 *
 *   cp .env.example .env.local        # fill in UBISOFT_EMAIL / UBISOFT_PASSWORD
 *   node scripts/ubisoft-login-test.mjs SomePlayerName
 *
 * Nothing is written to disk and neither the password nor the session ticket is
 * ever printed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UBI = 'https://public-ubiservices.ubi.com';
const APP_ID = process.env.UBISOFT_APP_ID?.trim() || 'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const PLATFORMS = ['uplay', 'steam', 'psn', 'xbl'];
const USER_AGENT =
  'ForHonorTracker/0.1 (+https://github.com/SixSleet/For-Honor-Tracker) open-source stats viewer';

// --- configuration ----------------------------------------------------------

/** Minimal .env reader, so the script works without a dependency. */
function loadEnvFile(filename) {
  try {
    const text = readFileSync(resolve(process.cwd(), filename), 'utf8');
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // Absent file is fine — the variables may already be exported.
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

const email = process.env.UBISOFT_EMAIL?.trim();
const password = process.env.UBISOFT_PASSWORD;
const username = process.argv[2];

if (!email || !password) {
  console.error(
    'Missing credentials. Set UBISOFT_EMAIL and UBISOFT_PASSWORD in .env.local or the environment.',
  );
  process.exit(1);
}
if (!username) {
  console.error('Usage: node scripts/ubisoft-login-test.mjs <ubisoft-username>');
  process.exit(1);
}

// --- helpers ----------------------------------------------------------------

function redact(text) {
  return String(text)
    .replace(/Ubi_v1\s+t=[\w.~+/=-]+/gi, 'Ubi_v1 t=<redacted>')
    .replace(/\b(Basic|Bearer)\s+[\w.~+/=-]{8,}/gi, '$1 <redacted>')
    .replace(/"ticket"\s*:\s*"[^"]*"/gi, '"ticket":"<redacted>"')
    .replace(/"sessionId"\s*:\s*"[^"]*"/gi, '"sessionId":"<redacted>"')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<redacted-email>');
}

function isBotChallenge(status, body) {
  return status === 403 && /captcha-delivery|datadome|please enable js/i.test(body);
}

async function call(label, url, headers, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'User-Agent': USER_AGENT, ...headers },
    body: options.body,
    redirect: 'manual',
  });
  const text = await response.text();
  console.log(`  ${String(response.status).padEnd(4)} ${label}`);
  return { status: response.status, text };
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- run --------------------------------------------------------------------

console.log(`\nFor Honor Tracker — Ubisoft login test`);
console.log(`Running from this machine's own IP address at ${new Date().toISOString()}\n`);

console.log('1. Sign in');
const basic = Buffer.from(`${email}:${password}`, 'utf8').toString('base64');
const session = await call('POST /v3/profiles/sessions', `${UBI}/v3/profiles/sessions`, {
  'Ubi-AppId': APP_ID,
  'Content-Type': 'application/json',
  Authorization: `Basic ${basic}`,
}, { method: 'POST', body: JSON.stringify({ rememberMe: true }) });

if (isBotChallenge(session.status, session.text)) {
  console.log(`
  BLOCKED — bot protection.

  Ubisoft answered with a DataDome challenge rather than a login response, so
  no session is obtainable from this network either.

  This project does not solve or evade that challenge, so this is the end of
  the Ubisoft route. Everything else the tracker shows comes from Steam, which
  needs no credentials at all.
`);
  process.exit(2);
}

if (session.status === 401) {
  console.log('\n  REJECTED — Ubisoft did not accept those credentials.');
  console.log('  Check UBISOFT_EMAIL / UBISOFT_PASSWORD. Two-factor accounts cannot be used.\n');
  process.exit(3);
}

if (session.status !== 200) {
  console.log(`\n  Unexpected response.\n  ${redact(session.text).slice(0, 400)}\n`);
  process.exit(4);
}

const body = parse(session.text);
if (!body?.ticket) {
  console.log('\n  A session came back without a ticket. Cannot continue.\n');
  process.exit(4);
}

console.log(`\n  SUCCESS — signed in. Ticket acquired (not printed).`);
console.log(`  Expires: ${body.expiration ?? 'unknown'}`);
console.log(`  Remember-me ticket: ${body.rememberMeTicket ? 'present (enables auto-renewal)' : 'ABSENT'}\n`);

// --seed <url> pushes this session to the deployed site once, so the server
// can serve every visitor with no login and renew itself via remember-me.
const seedFlag = process.argv.find((arg) => arg.startsWith('--seed='));
const seedToken = process.argv.find((arg) => arg.startsWith('--token='))?.split('=')[1];
if (seedFlag) {
  const seedUrl = seedFlag.split('=')[1];
  if (!seedToken) {
    console.log('  --seed given without --token=<DIAGNOSTICS_TOKEN>. Skipping seed.\n');
  } else {
    const res = await fetch(`${seedUrl}?token=${encodeURIComponent(seedToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        ticket: body.ticket,
        sessionId: body.sessionId ?? '',
        profileId: body.profileId ?? '',
        rememberMeTicket: body.rememberMeTicket ?? null,
        expiration: body.expiration ?? null,
      }),
    });
    const seedBody = parse(await res.text());
    console.log(`  Seeded session to server: ${res.status} — ${seedBody?.message ?? ''}\n`);
  }
}

const auth = {
  'Ubi-AppId': APP_ID,
  'Ubi-SessionId': body.sessionId ?? '',
  'Ubi-LocaleCode': 'en-US',
  'Content-Type': 'application/json',
  Authorization: `Ubi_v1 t=${body.ticket}`,
};

// 2. Resolve the username on every platform.
console.log(`2. Search for "${username}"`);
let target = null;
for (const platformType of PLATFORMS) {
  const response = await call(
    `${platformType}`,
    `${UBI}/v2/profiles?platformType=${platformType}&nameOnPlatform=${encodeURIComponent(username)}`,
    auth,
  );
  const profile = parse(response.text)?.profiles?.[0];
  if (profile && !target) {
    target = { ...profile, platformType };
    console.log(`       found: ${profile.nameOnPlatform} (${profile.profileId})`);
  }
}

if (!target) {
  console.log('\n  Session works, but that username matched no profile on any platform.\n');
  process.exit(0);
}

// 3. Games played, which is also how For Honor's space id is located.
console.log('\n3. Games played');
const games = await call(
  'GET /v1/profiles/gamesplayed',
  `${UBI}/v1/profiles/gamesplayed?profileIds=${target.profileId}`,
  auth,
);
const gameList = parse(games.text)?.profiles?.flatMap((p) => p.games ?? []) ?? [];
console.log(`       ${gameList.length} games`);
for (const game of gameList) console.log(`       - ${game.name} ${game.spaceId ?? ''}`);

const forHonor = gameList.find((game) => /for\s*honor/i.test(game.name ?? ''));
const spaceId = forHonor?.spaceId ?? process.env.UBISOFT_FORHONOR_SPACE_ID ?? null;

if (!spaceId) {
  console.log('\n  For Honor was not among the games played, and no space id is configured.\n');
  process.exit(0);
}

console.log(`\n  For Honor space id: ${spaceId}\n`);

// 4. Everything For Honor might expose.
console.log('4. For Honor data');
for (const [label, url] of [
  ['profiles/stats', `${UBI}/v1/profiles/stats?spaceId=${spaceId}&profileIds=${target.profileId}`],
  ['statscard', `${UBI}/v1/profiles/${target.profileId}/statscard?spaceId=${spaceId}`],
  ['club/actions', `${UBI}/v1/profiles/${target.profileId}/club/actions?spaceId=${spaceId}`],
  ['club/challenges', `${UBI}/v1/profiles/${target.profileId}/club/challenges?spaceId=${spaceId}`],
]) {
  const response = await call(label, url, auth);
  const snippet = redact(response.text).slice(0, 1500);
  console.log(`       ${snippet}\n`);
}

console.log(`
Done. If profiles/stats or the club endpoints returned real For Honor figures,
paste the (redacted) output into a GitHub issue so the provider can map those
keys properly.
`);
