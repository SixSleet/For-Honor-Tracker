/* Privacy-safe Vercel build probe for ranked + match-history research.
 * Never logs usernames, profile ids, tickets, session ids, or response values.
 * Output is limited to statuses, JSON key names, array sizes, and sanitized
 * public config/service strings.
 */

const BRANCH = 'chatgpt-ranked-history-research';
const UBI = 'https://public-ubiservices.ubi.com';
const API_UBI = 'https://api-ubiservices.ubi.com';
const FH_SPACE = 'c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const LEGACY_SPACE = '882ad5b5-f549-44a1-a434-c465d22fe4bf';
const DEFAULT_APP_ID = 'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const TIMEOUT = 12000;

const log = (s) => console.log(`[FH_RESEARCH_PROBE] ${s}`);
const clean = (s) => String(s)
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
  .replace(/\b\d{12,}\b/g, '<id>')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
  .replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi, '$1 t=<redacted>')
  .slice(0, 500);

function shape(text) {
  if (!text) return { kind: 'empty', keys: [], paths: [], arrays: [] };
  let body;
  try { body = JSON.parse(text); } catch { return { kind: 'non-json', keys: [], paths: [], arrays: [] }; }
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort().slice(0, 40) : [];
  const paths = new Set();
  const arrays = [];
  function walk(v, path = '', depth = 0) {
    if (depth > 3 || v == null) return;
    if (Array.isArray(v)) {
      arrays.push(`${path || '<root>'}[${v.length}]`);
      if (v[0] !== undefined) walk(v[0], `${path}[]`, depth + 1);
      return;
    }
    if (typeof v !== 'object') return;
    for (const k of Object.keys(v).sort().slice(0, 80)) {
      const p = path ? `${path}.${k}` : k;
      paths.add(p);
      walk(v[k], p, depth + 1);
    }
  }
  walk(body);
  return { kind: Array.isArray(body) ? 'array' : typeof body, keys, paths: [...paths].slice(0, 120), arrays: arrays.slice(0, 40) };
}

function leaderboardIds(body) {
  const out = new Set();
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v)) {
      const n = k.replace(/[_-]/g, '').toLowerCase();
      if (n === 'leaderboardid' && typeof x === 'string') out.add(x);
      if (n === 'leaderboardids' && Array.isArray(x)) x.forEach((i) => typeof i === 'string' && out.add(i));
      walk(x);
    }
  }
  walk(body);
  return [...out].slice(0, 5);
}

function applicationIds(body) {
  const out = new Set();
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v)) {
      const n = k.replace(/[_-]/g, '').toLowerCase();
      if ((n === 'applicationid' || n === 'appid') && typeof x === 'string'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)) out.add(x);
      walk(x);
    }
  }
  walk(body);
  return [...out].slice(0, 12);
}

function interestingConfig(body) {
  const entries = [];
  const urls = [];
  function walk(v, path = '') {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.slice(0, 100).forEach((x) => walk(x, `${path}[]`));
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (/(rank|leader|match|skill|hn_)/i.test(p) && ['string','number','boolean'].includes(typeof x))
        entries.push(`${p}=${clean(x)}`);
      if (typeof x === 'string' && /^https?:\/\//i.test(x) && /(rank|leader|match|skill|hn_)/i.test(p + x))
        urls.push({ key: p, url: x });
      walk(x, p);
    }
  }
  walk(body);
  return { entries: entries.slice(0, 160), urls: urls.slice(0, 30) };
}

async function storedSession() {
  if (process.env.UBISOFT_TICKET) return {
    ticket: process.env.UBISOFT_TICKET,
    sessionId: process.env.UBISOFT_SESSION_ID || '', profileId: null,
    expiresAt: null, source: 'env',
  };
  const su = process.env.SUPABASE_URL, sk = process.env.SUPABASE_ANON_KEY, ss = process.env.SESSION_STORE_SECRET;
  if (su && sk && ss) try {
    const r = await fetch(`${su}/rest/v1/rpc/fh_session_read`, {
      method: 'POST', headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: ss }), signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.ok) { const b = await r.json(); if (b?.ticket) return { ...b, source: 'supabase' }; }
  } catch {}
  const uu = process.env.UPSTASH_REDIS_REST_URL, ut = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (uu && ut) try {
    const r = await fetch(uu, {
      method: 'POST', headers: { Authorization: `Bearer ${ut}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', 'ubisoft:session']), signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.ok) { const b = await r.json(); const x = b?.result ? JSON.parse(b.result) : null; if (x?.ticket) return { ...x, source: 'upstash' }; }
  } catch {}
  return null;
}

async function probe(label, url, headers) {
  try {
    const r = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    const text = (await r.text()).slice(0, 1000000);
    const s = shape(text);
    log(`${label}: status=${r.status} kind=${s.kind} topKeys=${s.keys.join(',') || '-'} arrays=${s.arrays.join(',') || '-'}`);
    if (s.paths.length) log(`${label}: schema=${s.paths.join('|')}`);
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    log(`${label}: network_error=${clean(e?.name || 'Error')}`);
    return null;
  }
}

async function inspectConfig(label, result, exact) {
  if (!result?.ok) return;
  try {
    const q = interestingConfig(JSON.parse(result.text));
    if (q.entries.length) log(`${label}: interesting=${q.entries.join('|')}`);
    exact.push(...q.urls);
  } catch {}
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) {
    log('skipped: not research branch'); return;
  }
  log('begin privacy-safe ranked/history probe');
  const appId = process.env.UBISOFT_APP_ID || DEFAULT_APP_ID;
  const session = await storedSession();
  const fresh = !session?.expiresAt || Number(session.expiresAt) > Date.now();
  log(`session: available=${Boolean(session?.ticket)} fresh=${Boolean(session?.ticket && fresh)} source=${session?.source || 'none'} profileId_available=${Boolean(session?.profileId)}`);
  if (!session?.ticket || !fresh) { log('authenticated probes skipped'); return; }
  const headers = {
    Accept: 'application/json', 'Ubi-AppId': appId,
    'Ubi-SessionId': session.sessionId || '', Authorization: `Ubi_v1 t=${session.ticket}`,
  };

  const groups = encodeURIComponent('us-sdkClientFeaturesSwitches,us-sdkClientUrls');
  const exact = [];

  // Current web-client application config: useful as a control.
  const configUrls = [
    `${UBI}/v1/applications/${encodeURIComponent(appId)}/parameters?parameterGroups=${groups}`,
    `${UBI}/v1/applications/${encodeURIComponent(appId)}/parameters?spaceId=${FH_SPACE}&sandbox=HERO_PC_LNCH_A&parameterGroups=${groups}`,
    `${UBI}/v1/applications/${encodeURIComponent(appId)}/parameters?spaceId=${FH_SPACE}&sandbox=HERO_PC_LNCH_A`,
    `${UBI}/v1/applications/${encodeURIComponent(appId)}/configuration`,
  ];
  for (let i=0; i<configUrls.length; i++) {
    const x = await probe(`app-config-${i+1}`, configUrls[i], headers);
    await inspectConfig(`app-config-${i+1}`, x, exact);
  }

  // Space configuration can advertise title-specific service groups even when
  // the web-client application config is intentionally minimal.
  const spaceUrls = [
    `${UBI}/v1/spaces/${FH_SPACE}/parameters?parameterGroups=${groups}`,
    `${UBI}/v1/spaces/${FH_SPACE}/parameters`,
    `${UBI}/v1/spaces/${LEGACY_SPACE}/parameters?parameterGroups=${groups}`,
    `${UBI}/v1/spaces/${LEGACY_SPACE}/parameters`,
  ];
  for (let i=0; i<spaceUrls.length; i++) {
    const x = await probe(`space-config-${i+1}`, spaceUrls[i], headers);
    await inspectConfig(`space-config-${i+1}`, x, exact);
  }

  // Public application metadata lookup observed in Ubisoft Connect clients.
  // We only print application UUIDs returned for the already-public For Honor
  // space IDs; no profile/account metadata is logged.
  const appLookups = [
    `${API_UBI}/v2/applications?spaceIds=${FH_SPACE}`,
    `${API_UBI}/v2/applications?spaceIds=${LEGACY_SPACE}`,
    `${UBI}/v1/applications?spaceIds=${FH_SPACE}`,
    `${UBI}/v1/applications?spaceId=${FH_SPACE}`,
  ];
  const discoveredApps = new Set();
  for (let i=0; i<appLookups.length; i++) {
    const x = await probe(`application-metadata-${i+1}`, appLookups[i], headers);
    if (!x?.ok) continue;
    try {
      const ids = applicationIds(JSON.parse(x.text));
      ids.forEach((id) => discoveredApps.add(id));
      log(`application-metadata-${i+1}: application_ids=${ids.join(',') || '-'}`);
    } catch {}
  }

  // Inspect only public application configuration for IDs explicitly returned
  // by the known For Honor space metadata lookup.
  let appNo = 0;
  for (const candidate of [...discoveredApps].slice(0, 8)) {
    appNo++;
    const h = { ...headers, 'Ubi-AppId': candidate };
    for (const [suffix, url] of [
      ['parameters', `${UBI}/v1/applications/${candidate}/parameters?spaceId=${FH_SPACE}&sandbox=HERO_PC_LNCH_A`],
      ['configuration', `${UBI}/v1/applications/${candidate}/configuration`],
    ]) {
      const x = await probe(`discovered-app-${appNo}-${suffix}`, url, h);
      await inspectConfig(`discovered-app-${appNo}-${suffix}`, x, exact);
    }
  }

  const boards = await probe('leaderboard-space-collection', `${UBI}/v1/spaces/${FH_SPACE}/leaderboards?offset=0&limit=20`, headers);
  await probe('leaderboard-me-ranks', `${UBI}/v1/profiles/me/ranks?spaceId=${FH_SPACE}&offset=0&limit=20`, headers);
  if (session.profileId) await probe('leaderboard-profile-ranks-self', `${UBI}/v1/profiles/ranks?spaceId=${FH_SPACE}&profileIds=${encodeURIComponent(session.profileId)}&offset=0&limit=20`, headers);
  if (boards?.ok) try {
    const ids = leaderboardIds(JSON.parse(boards.text));
    log(`leaderboard-space-collection: explicit_leaderboard_ids_found=${ids.length}`);
    for (let i=0; i<ids.length; i++) {
      const id = encodeURIComponent(ids[i]);
      await probe(`leaderboard-space-item-${i+1}`, `${UBI}/v1/spaces/${FH_SPACE}/leaderboards/${id}?offset=0&limit=10`, headers);
      await probe(`leaderboard-me-item-${i+1}`, `${UBI}/v1/profiles/me/ranks?spaceId=${FH_SPACE}&leaderboardIds=${id}`, headers);
    }
  } catch {}
  await probe('leaderboard-legacy-space-collection', `${UBI}/v1/spaces/${LEGACY_SPACE}/leaderboards?offset=0&limit=5`, headers);

  if (session.profileId) {
    await probe('matches-self-base', `${UBI}/v1/profiles/${encodeURIComponent(session.profileId)}/matches`, headers);
    await probe('matches-self-space', `${UBI}/v1/profiles/${encodeURIComponent(session.profileId)}/matches?spaceId=${FH_SPACE}&offset=0&limit=10`, headers);
  }

  const seen = new Set();
  const usable = exact.filter((x) => x.url && !x.url.includes('{') && /^https:\/\//i.test(x.url) && !seen.has(x.url) && seen.add(x.url));
  log(`config: exact_interesting_service_urls=${usable.length}`);
  for (let i=0; i<Math.min(usable.length,16); i++) await probe(`config-service-${i+1}-${clean(usable[i].key)}`, usable[i].url, headers);
  log('end probe');
}

main().catch(() => log('unexpected_error=redacted'));
