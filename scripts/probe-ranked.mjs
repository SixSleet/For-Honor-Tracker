import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Offline by default. Opt in with --live. No login, session renewal or writes.
export const ORIGIN = 'https://public-ubiservices.ubi.com';
export const SPACES = [
  'c2294cd6-bd01-4f19-81e9-4e5d32cb763a',
  '882ad5b5-f549-44a1-a434-c465d22fe4bf',
];
const APP_ID = 'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const TITLE_KEYS = [
  'hn_ranking_public_v1', 'hn_ranking_public_v2',
  'hn_leaderboard_public_v1', 'hn_skillrating_public_v1',
];
const SDK_KEYS = ['spacesLeaderboard', 'profilesLeaderboard', 'profilesMeLeaderboard'];

export function allowedUrl(value) {
  try {
    const u = new URL(value);
    if (u.origin !== ORIGIN || u.username || u.password || u.hash) return false;
    if ([...u.searchParams.keys()].some(k => k !== 'spaceId')) return false;
    if (u.search && !SPACES.includes(u.searchParams.get('spaceId'))) return false;
    if (/^\/v1\/profiles\/(?:me\/)?ranks$/.test(u.pathname)) return true;
    return SPACES.some(space =>
      u.pathname === `/v1/spaces/${space}/parameters` ||
      u.pathname === `/v1/spaces/${space}/leaderboards` ||
      new RegExp(`^/v1/spaces/${space}/title/hero/hero-live/(?:heroranking/public/v[12]|heroleaderboard/public/v1|skillrating/public/v1)/$`).test(u.pathname)
    );
  } catch { return false; }
}

export function advertisedRoutes(body, space) {
  const params = body?.parameters ?? {};
  const title = params['fh-configuration']?.fields ?? {};
  const sdk = params['us-sdkClientUrls']?.fields ?? {};
  const routes = [];
  for (const key of TITLE_KEYS) {
    if (typeof title[key] === 'string' && allowedUrl(title[key])) {
      routes.push({ key, url: title[key] });
    }
  }
  for (const key of SDK_KEYS) {
    if (typeof sdk[key] !== 'string') continue;
    const resolved = sdk[key].replace('{baseurl_aws}', ORIGIN)
      .replace('{version}', 'v1').replace('{spaceId}', space);
    if (!allowedUrl(resolved)) continue;
    const url = new URL(resolved);
    if (key !== 'spacesLeaderboard') url.searchParams.set('spaceId', space);
    routes.push({ key, url: url.href });
  }
  return routes;
}

export function summarize(status, body) {
  // Never emit response text, headers, credentials, identifiers or arbitrary keys.
  // A 200 is only a response, not proof of a working player-rank API.
  const result = { status, outcome: status === 200 ? 'response-received-unverified' :
    status === 401 || status === 403 ? 'authentication-or-access-required' :
    status === 404 ? 'path-not-found' : status === 429 ? 'rate-limited' :
    status >= 300 && status < 400 ? 'redirect-not-followed' : 'request-not-successful' };
  if (Number.isInteger(body?.errorCode)) result.errorCode = body.errorCode;
  for (const key of ['cardinality', 'totalCount']) {
    if (Number.isFinite(body?.[key])) result[key] = body[key];
  }
  for (const key of ['standings', 'leaderboards', 'ranks']) {
    if (Array.isArray(body?.[key])) result[`${key}Count`] = body[key].length;
  }
  return result;
}

export async function run({ live = false, env = process.env, fetchImpl = fetch, pause = delay } = {}) {
  if (!live) return { mode: 'offline', instructions: 'Use --live for bounded GET requests. Optional UBISOFT_TICKET and UBISOFT_SESSION_ID are read only from the environment.', spaces: SPACES };
  const headers = { 'Ubi-AppId': APP_ID, 'Ubi-LocaleCode': 'en-US', Accept: 'application/json' };
  if (env.UBISOFT_TICKET) headers.Authorization = `Ubi_v1 t=${env.UBISOFT_TICKET}`;
  if (env.UBISOFT_SESSION_ID) headers['Ubi-SessionId'] = env.UBISOFT_SESSION_ID;
  const report = { generatedAt: new Date().toISOString(), authenticated: Boolean(env.UBISOFT_TICKET), requests: [], catalogues: [] };
  let halted = false;
  async function get(url, key) {
    if (!allowedUrl(url)) throw new Error('URL outside the fixed read-only allowlist');
    if (halted || report.requests.length >= 16) return null;
    if (report.requests.length) await pause(1000);
    try {
      const res = await fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      // Cap downloads, not just printed output.
      let length = 0;
      const chunks = [];
      if (res.body) for await (const chunk of res.body) {
        length += chunk.length;
        if (length > 512_000) throw new Error('Response too large');
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(raw); } catch { /* Non-JSON bodies stay private. */ }
      report.requests.push({ key, url, ...summarize(res.status, body) });
      if ([401, 403, 429].includes(res.status) || /captcha-delivery|datadome/i.test(raw)) halted = true;
      return res.ok ? { body, sha256: createHash('sha256').update(raw).digest('hex') } : null;
    } catch {
      report.requests.push({ key, url, outcome: 'network-or-response-error' });
      halted = true; // No retries or exception text that could contain credentials.
      return null;
    }
  }
  // Fetch both catalogues before probing routes, so an auth boundary does not
  // prevent recording the other public configuration.
  const routes = [];
  for (const space of SPACES) {
    const result = await get(`${ORIGIN}/v1/spaces/${space}/parameters`, 'parameters');
    if (!result) continue;
    const advertised = advertisedRoutes(result.body, space);
    report.catalogues.push({ space, sha256: result.sha256, advertised });
    routes.push(...advertised);
  }
  for (const route of [...new Map(routes.map(r => [r.url, r])).values()]) {
    if (halted) break;
    await get(route.url, route.key);
  }
  report.halted = halted;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--live')) {
    console.error('Only --live is accepted; never pass credentials on the command line.');
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(await run({ live: process.argv.includes('--live') }), null, 2));
  }
}
