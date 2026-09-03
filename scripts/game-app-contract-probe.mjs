/* Privacy-safe comparison of Ubisoft web-client vs For Honor game AppId.
 * Never prints profile ids, tickets, session ids, usernames, or payload values.
 */
const BRANCH = 'chatgpt-ranked-history-research';
const UBI = 'https://public-ubiservices.ubi.com';
const FH_SPACE = 'c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const WEB_APP = process.env.UBISOFT_APP_ID || 'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const GAME_APP = '3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const TIMEOUT = 12000;
const log = (s) => console.log(`[FH_GAME_APP_PROBE] ${s}`);

function clean(s) {
  return String(s)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{12,}\b/g, '<id>')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi, '$1 t=<redacted>')
    .slice(0, 350);
}

async function session() {
  if (process.env.UBISOFT_TICKET) return { ticket: process.env.UBISOFT_TICKET, sessionId: process.env.UBISOFT_SESSION_ID || '', profileId: null };
  const su = process.env.SUPABASE_URL, sk = process.env.SUPABASE_ANON_KEY, ss = process.env.SESSION_STORE_SECRET;
  if (su && sk && ss) try {
    const r = await fetch(`${su}/rest/v1/rpc/fh_session_read`, {
      method: 'POST', headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_secret: ss }), signal: AbortSignal.timeout(TIMEOUT),
    });
    if (r.ok) { const b = await r.json(); if (b?.ticket) return { ticket: b.ticket, sessionId: b.sessionId || '', profileId: b.profileId || null }; }
  } catch {}
  const uu = process.env.UPSTASH_REDIS_REST_URL, ut = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (uu && ut) try {
    const r = await fetch(uu, { method: 'POST', headers: { Authorization: `Bearer ${ut}`, 'Content-Type': 'application/json' }, body: JSON.stringify(['GET','ubisoft:session']), signal: AbortSignal.timeout(TIMEOUT) });
    if (r.ok) { const b = await r.json(); const x = b?.result ? JSON.parse(b.result) : null; if (x?.ticket) return { ticket: x.ticket, sessionId: x.sessionId || '', profileId: x.profileId || null }; }
  } catch {}
  return null;
}

function schema(text) {
  try {
    const b = JSON.parse(text);
    const top = b && typeof b === 'object' && !Array.isArray(b) ? Object.keys(b).sort() : [];
    const paths = new Set();
    function walk(v, p='', d=0) {
      if (d > 4 || v == null || typeof v !== 'object') return;
      if (Array.isArray(v)) { paths.add(`${p}[${v.length}]`); if (v[0] !== undefined) walk(v[0], `${p}[]`, d+1); return; }
      for (const k of Object.keys(v).sort().slice(0,100)) { const q = p ? `${p}.${k}` : k; paths.add(q); walk(v[k], q, d+1); }
    }
    walk(b);
    return { top: top.slice(0,40), paths: [...paths].slice(0,140), body: b };
  } catch { return { top: [], paths: [], body: null }; }
}

async function probe(label, url, headers, method='GET') {
  try {
    const r = await fetch(url, { method, headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    const text = (await r.text()).slice(0, 500000);
    const s = schema(text);
    log(`${label}: method=${method} status=${r.status} allow=${clean(r.headers.get('allow') || '-')}`);
    log(`${label}: topKeys=${s.top.join(',') || '-'} schema=${s.paths.join('|') || '-'}`);
    if (s.body && !r.ok) {
      const ec = typeof s.body.errorContext === 'string' ? s.body.errorContext : '';
      const msg = typeof s.body.message === 'string' ? s.body.message : '';
      if (ec || msg) log(`${label}: errorContext=${clean(ec || '-')} message=${clean(msg || '-')}`);
    }
    return { status: r.status, body: s.body };
  } catch (e) {
    log(`${label}: network_error=${clean(e?.name || 'Error')}`);
    return null;
  }
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) { log('skipped: not research branch'); return; }
  const s = await session();
  log(`session_available=${Boolean(s?.ticket)} profileId_available=${Boolean(s?.profileId)}`);
  if (!s?.ticket) return;

  const contexts = [ ['web', WEB_APP], ['game', GAME_APP] ];
  for (const [name, appId] of contexts) {
    const h = { Accept: 'application/json', 'Ubi-AppId': appId, 'Ubi-SessionId': s.sessionId || '', Authorization: `Ubi_v1 t=${s.ticket}` };
    log(`context=${name}`);
    await probe(`${name}-space-leaderboards`, `${UBI}/v1/spaces/${FH_SPACE}/leaderboards?offset=0&limit=20`, h);
    await probe(`${name}-me-ranks`, `${UBI}/v1/profiles/me/ranks?spaceId=${FH_SPACE}&offset=0&limit=20`, h);
    if (s.profileId) {
      await probe(`${name}-profile-ranks-self`, `${UBI}/v1/profiles/ranks?spaceId=${FH_SPACE}&profileIds=${encodeURIComponent(s.profileId)}&offset=0&limit=20`, h);
      const base = `${UBI}/v1/profiles/${encodeURIComponent(s.profileId)}/matches`;
      const qs = [
        ['', 'base'],
        [`?spaceId=${FH_SPACE}`, 'space'],
        [`?spaceId=${FH_SPACE}&platform=PC`, 'space-platform'],
        [`?spaceId=${FH_SPACE}&sandbox=HERO_PC_LNCH_A`, 'space-sandbox'],
        [`?spaceId=${FH_SPACE}&offset=0&limit=10`, 'space-offset-limit'],
        [`?spaceId=${FH_SPACE}&startIndex=0&limit=10`, 'space-startindex-limit'],
      ];
      for (const [q, suffix] of qs) await probe(`${name}-matches-${suffix}`, `${base}${q}`, h);
      await probe(`${name}-matches-options`, base, h, 'OPTIONS');
    }

    const title = `${UBI}/v1/spaces/${FH_SPACE}/title/hero/hero-live`;
    for (const [svc, version] of [['heroranking','v1'],['heroranking','v2'],['heroleaderboard','v1'],['skillrating','v1']]) {
      const root = `${title}/${svc}/public/${version}/`;
      await probe(`${name}-${svc}-${version}-root`, root, h);
    }
  }
}

main().catch(() => log('unexpected_error=redacted'));
