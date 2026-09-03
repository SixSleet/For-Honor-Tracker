/* Privacy-safe endpoint mapping for For Honor's live game2web service.
 * Follows Claude's redacted endpoint-probe approach: no usernames, profile IDs,
 * tickets, session IDs, or successful response values are printed.
 */
const BRANCH = 'chatgpt-follow-claude-endpoints-v2';
const UBI = 'https://public-ubiservices.ubi.com';
const SPACE = 'c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const GAME_APP = '3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD = 'CERT_PC_70.713_C9831255_D485915_S20473';
const TIMEOUT = 10000;
const ROOT = `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/game2web/public/v1/`;

const log = (s) => console.log(`[FH_GAME2WEB] ${s}`);
const clean = (value) => String(value ?? '-')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{27}\b/gi, '<uuid>')
  .replace(/\b\d{12,}\b/g, '<id>')
  .replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi, '$1 t=<redacted>')
  .replace(/Bearer\s+[^\s&"']+/gi, 'Bearer <redacted>')
  .slice(0, 300);

async function storedSession() {
  if (process.env.UBISOFT_TICKET) return { ticket: process.env.UBISOFT_TICKET, sessionId: process.env.UBISOFT_SESSION_ID || '' };
  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_ANON_KEY;
  const ss = process.env.SESSION_STORE_SECRET;
  if (su && sk && ss) {
    try {
      const r = await fetch(`${su}/rest/v1/rpc/fh_session_read`, {
        method: 'POST', headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: ss }), signal: AbortSignal.timeout(TIMEOUT),
      });
      if (r.ok) { const s = await r.json(); if (s?.ticket) return s; }
    } catch {}
  }
  const uu = process.env.UPSTASH_REDIS_REST_URL;
  const ut = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (uu && ut) {
    try {
      const r = await fetch(uu, { method: 'POST', headers: { Authorization: `Bearer ${ut}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', 'ubisoft:session']), signal: AbortSignal.timeout(TIMEOUT) });
      if (r.ok) { const b = await r.json(); const s = b?.result ? JSON.parse(b.result) : null; if (s?.ticket) return s; }
    } catch {}
  }
  return null;
}

function shape(text) {
  try {
    const body = JSON.parse(text);
    const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().slice(0, 30) : [];
    const paths = new Set();
    const walk = (v, p = '', depth = 0) => {
      if (depth > 2 || v == null) return;
      if (Array.isArray(v)) { if (v[0] !== undefined) walk(v[0], `${p}[]`, depth + 1); return; }
      if (typeof v !== 'object') return;
      for (const k of Object.keys(v).sort().slice(0, 40)) { const n = p ? `${p}.${k}` : k; paths.add(n); walk(v[k], n, depth + 1); }
    };
    walk(body);
    return { body, keys, paths: [...paths].slice(0, 70) };
  } catch { return { body: null, keys: [], paths: [] }; }
}

async function probe(label, suffix, headers) {
  try {
    const r = await fetch(ROOT + suffix, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    const text = await r.text();
    const s = shape(text);
    log(`${label}: status=${r.status} allow=${clean(r.headers.get('allow'))} keys=${s.keys.join(',') || '-'}`);
    if (r.ok) log(`${label}: schema=${s.paths.join('|') || '-'}`);
    else if (s.body) log(`${label}: code=${clean(s.body.errorCode)} context=${clean(s.body.errorContext)} resource=${clean(s.body.resource)} message=${clean(s.body.message)}`);
  } catch (e) { log(`${label}: network_error=${clean(e?.name || 'Error')}`); }
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) { log('skipped: not research branch'); return; }
  const session = await storedSession();
  log(`session_available=${Boolean(session?.ticket)}`);
  if (!session?.ticket) return;
  const headers = {
    Accept: 'application/json',
    'Ubi-AppId': GAME_APP,
    'X-Platform-AppId': GAME_APP,
    'Ubi-AppBuildId': BUILD,
    'Ubi-LocaleCode': 'en-US',
    'Ubi-SessionId': session.sessionId || '',
    Authorization: `Ubi_v1 t=${session.ticket}`,
  };

  const candidates = [
    ['root', ''], ['player', 'player'], ['players', 'players'], ['profile', 'profile'],
    ['stats', 'stats'], ['playerstats', 'playerstats'], ['statistics', 'statistics'],
    ['ranking', 'ranking'], ['rankings', 'rankings'], ['leaderboard', 'leaderboard'],
    ['leaderboards', 'leaderboards'], ['matches', 'matches'], ['history', 'history'],
    ['matchhistory', 'matchhistory'], ['recentmatches', 'recentmatches'],
  ];
  for (const [label, suffix] of candidates) await probe(label, suffix, headers);
}
main().catch((e) => log(`unexpected_error=${clean(e?.name || 'Error')}`));
