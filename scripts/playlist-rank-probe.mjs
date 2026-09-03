/* Privacy-safe research probe for public For Honor playlist/config artifacts.
 * Never logs account/session/profile values. Any emitted values come only from
 * Ubisoft's public title configuration or public static playlist host.
 */

const BRANCH = 'chatgpt-ranked-history-research';
const UBI = 'https://public-ubiservices.ubi.com';
const FH_SPACE = 'c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const APP_ID = process.env.UBISOFT_APP_ID || 'f35adcb5-1911-440c-b1c9-48fdc1701c68';
const TIMEOUT = 12000;
const log = (s) => console.log(`[FH_PLAYLIST_PROBE] ${s}`);

function cleanPublic(s) {
  return String(s)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi, '$1 t=<redacted>')
    .replace(/\b\d{12,}\b/g, '<id>')
    .slice(0, 700);
}

async function storedSession() {
  if (process.env.UBISOFT_TICKET) return {
    ticket: process.env.UBISOFT_TICKET,
    sessionId: process.env.UBISOFT_SESSION_ID || '',
  };
  const su = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_ANON_KEY;
  const ss = process.env.SESSION_STORE_SECRET;
  if (su && sk && ss) {
    try {
      const r = await fetch(`${su}/rest/v1/rpc/fh_session_read`, {
        method: 'POST',
        headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_secret: ss }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (r.ok) {
        const b = await r.json();
        if (b?.ticket) return { ticket: b.ticket, sessionId: b.sessionId || '' };
      }
    } catch {}
  }
  const uu = process.env.UPSTASH_REDIS_REST_URL;
  const ut = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (uu && ut) {
    try {
      const r = await fetch(uu, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ut}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', 'ubisoft:session']),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (r.ok) {
        const b = await r.json();
        const x = b?.result ? JSON.parse(b.result) : null;
        if (x?.ticket) return { ticket: x.ticket, sessionId: x.sessionId || '' };
      }
    } catch {}
  }
  return null;
}

function findPlaylistConfig(body) {
  const out = [];
  function walk(v, path = '') {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.slice(0, 200).forEach((x) => walk(x, `${path}[]`));
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (/playlist/i.test(p) && ['string', 'number', 'boolean'].includes(typeof x)) {
        out.push([p, String(x)]);
      }
      walk(x, p);
    }
  }
  walk(body);
  return out.slice(0, 100);
}

function keywordContexts(text) {
  const patterns = /(rank(?:ed|ing)?|leaderboard|skillrating|skill.?rating|matchhistory|match_history|recentmatch|matchmaking)/ig;
  const out = [];
  let m;
  while ((m = patterns.exec(text)) && out.length < 80) {
    const a = Math.max(0, m.index - 90);
    const b = Math.min(text.length, m.index + m[0].length + 160);
    const chunk = text.slice(a, b).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
    out.push(cleanPublic(chunk));
  }
  return [...new Set(out)].slice(0, 50);
}

async function fetchArtifact(label, url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json,text/plain,*/*', Range: 'bytes=0-1048575' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const type = r.headers.get('content-type') || '-';
    const len = r.headers.get('content-length') || '-';
    log(`${label}: status=${r.status} type=${cleanPublic(type)} length=${cleanPublic(len)}`);
    if (!r.ok && r.status !== 206) return null;
    const text = (await r.text()).slice(0, 1_048_576);
    const contexts = keywordContexts(text);
    log(`${label}: bytes_read=${text.length} ranked_contexts=${contexts.length}`);
    contexts.forEach((x, i) => log(`${label}: context-${i + 1}=${x}`));
    try {
      const body = JSON.parse(text);
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).sort().slice(0, 60) : [];
      log(`${label}: json=true topKeys=${keys.join(',') || '-'}`);
    } catch {
      log(`${label}: json=false`);
    }
    return text;
  } catch (e) {
    log(`${label}: network_error=${cleanPublic(e?.name || 'Error')}`);
    return null;
  }
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) {
    log('skipped: not research branch');
    return;
  }

  const session = await storedSession();
  if (!session?.ticket) {
    log('no server-side Ubisoft session; config lookup skipped');
    return;
  }

  const headers = {
    Accept: 'application/json',
    'Ubi-AppId': APP_ID,
    'Ubi-SessionId': session.sessionId || '',
    Authorization: `Ubi_v1 t=${session.ticket}`,
  };

  let config;
  try {
    const r = await fetch(`${UBI}/v1/spaces/${FH_SPACE}/parameters`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    log(`space-parameters: status=${r.status}`);
    if (!r.ok) return;
    config = await r.json();
  } catch (e) {
    log(`space-parameters: network_error=${cleanPublic(e?.name || 'Error')}`);
    return;
  }

  const entries = findPlaylistConfig(config);
  log(`playlist_config_entries=${entries.length}`);
  for (const [path, value] of entries) log(`playlist-config: ${cleanPublic(path)}=${cleanPublic(value)}`);

  const fields = config?.parameters?.['fh-configuration']?.fields || {};
  const host = typeof fields.hn_playlist_bundles_url === 'string'
    ? fields.hn_playlist_bundles_url.replace(/\/$/, '')
    : 'https://playlists-2.forhonor.ubisoft.com';
  const bundle = typeof fields.hn_default_playlist_bundle_name === 'string'
    ? fields.hn_default_playlist_bundle_name
    : null;

  log(`playlist_host=${cleanPublic(host)}`);
  log(`default_bundle_available=${Boolean(bundle)}`);
  if (!bundle) return;
  log(`default_bundle=${cleanPublic(bundle)}`);

  const candidates = [
    `/${bundle}`,
    `/${bundle}.json`,
    `/${bundle}/manifest.json`,
    `/${bundle}/bundle.json`,
    `/${bundle}/playlist.json`,
    `/bundles/${bundle}`,
    `/bundles/${bundle}.json`,
    `/playlists/${bundle}`,
    `/playlists/${bundle}.json`,
    `/fh-playlists-live/${bundle}`,
    `/fh-playlists-live/${bundle}.json`,
    `/fh-playlists-live/${bundle}/manifest.json`,
  ];

  for (let i = 0; i < candidates.length; i++) {
    await fetchArtifact(`bundle-candidate-${i + 1}`, `${host}${candidates[i]}`);
  }
}

main().catch(() => log('unexpected_error=redacted'));
