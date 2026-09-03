/*
 * Privacy-safe build-time endpoint discovery following Claude's operator-path
 * probe work on fix/stats-accuracy.
 *
 * Never logs usernames, profile ids, tickets, session ids, or response values.
 * It prints only route labels, HTTP behavior, JSON key names, and sanitized
 * error/resource metadata. All requests are read-only except the title login
 * handshake, which only asks Ubisoft to authenticate the already-owned session.
 */

const BRANCH = 'chatgpt-follow-claude-endpoints';
const UBI = 'https://public-ubiservices.ubi.com';
const SPACE = 'c2294cd6-bd01-4f19-81e9-4e5d32cb763a';
const GAME_APP = '3b27ede8-3ff9-435d-a264-e2de2ccbb2ce';
const BUILD = 'CERT_PC_70.713_C9831255_D485915_S20473';
const SANDBOX = 'HERO_PC_LNCH_A';
const TIMEOUT = 10000;

const log = (s) => console.log(`[FH_CLAUDE_FOLLOW] ${s}`);
const clean = (value) => String(value ?? '-')
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5]?[0-9a-f]{3}-[89ab]?[0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
  .replace(/\b\d{12,}\b/g, '<id>')
  .replace(/(Ubi_v1|rm_v1)\s+t=[^\s&"']+/gi, '$1 t=<redacted>')
  .replace(/Bearer\s+[^\s&"']+/gi, 'Bearer <redacted>')
  .slice(0, 350);

async function storedSession() {
  if (process.env.UBISOFT_TICKET) {
    return {
      ticket: process.env.UBISOFT_TICKET,
      sessionId: process.env.UBISOFT_SESSION_ID || '',
      profileId: null,
      expiresAt: null,
      source: 'env',
    };
  }

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
        const body = await r.json();
        if (body?.ticket) return { ...body, source: 'supabase' };
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
        const body = await r.json();
        const session = body?.result ? JSON.parse(body.result) : null;
        if (session?.ticket) return { ...session, source: 'upstash' };
      }
    } catch {}
  }
  return null;
}

function jsonShape(text) {
  try {
    const body = JSON.parse(text);
    const topKeys = body && typeof body === 'object' && !Array.isArray(body)
      ? Object.keys(body).sort().slice(0, 40)
      : [];
    const paths = new Set();
    const walk = (v, path = '', depth = 0) => {
      if (depth > 3 || v == null) return;
      if (Array.isArray(v)) {
        if (v[0] !== undefined) walk(v[0], `${path}[]`, depth + 1);
        return;
      }
      if (typeof v !== 'object') return;
      for (const key of Object.keys(v).sort().slice(0, 60)) {
        const p = path ? `${path}.${key}` : key;
        paths.add(p);
        walk(v[key], p, depth + 1);
      }
    };
    walk(body);
    return { body, topKeys, paths: [...paths].slice(0, 100) };
  } catch {
    return { body: null, topKeys: [], paths: [] };
  }
}

async function request(label, url, headers, method = 'GET', body = undefined) {
  try {
    const r = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const text = await r.text();
    const shape = jsonShape(text);
    log(`${label}: method=${method} status=${r.status} allow=${clean(r.headers.get('allow'))} keys=${shape.topKeys.join(',') || '-'}`);
    if (shape.body && !r.ok) {
      log(`${label}: errorCode=${clean(shape.body.errorCode)} context=${clean(shape.body.errorContext)} resource=${clean(shape.body.resource)} message=${clean(shape.body.message)}`);
    }
    if (r.ok && shape.paths.length) log(`${label}: schema=${shape.paths.join('|')}`);
    return { status: r.status, ok: r.ok, text, body: shape.body };
  } catch (error) {
    log(`${label}: network_error=${clean(error?.name || 'Error')}`);
    return null;
  }
}

async function main() {
  if (process.env.VERCEL && process.env.VERCEL_GIT_COMMIT_REF !== BRANCH) {
    log('skipped: not research branch');
    return;
  }

  const session = await storedSession();
  const fresh = !session?.expiresAt || Number(session.expiresAt) > Date.now();
  log(`session_available=${Boolean(session?.ticket)} fresh=${Boolean(session?.ticket && fresh)} source=${session?.source || 'none'} profile_available=${Boolean(session?.profileId)}`);
  if (!session?.ticket || !fresh) return;

  const baseHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Ubi-AppId': GAME_APP,
    'X-Platform-AppId': GAME_APP,
    'Ubi-AppBuildId': BUILD,
    'Ubi-Populations': SANDBOX,
    'Ubi-SandboxId': SANDBOX,
    'Ubi-LocaleCode': 'en-US',
    'Ubi-SessionId': session.sessionId || '',
    Authorization: `Ubi_v1 t=${session.ticket}`,
    ...(session.profileId ? { 'Ubi-ProfileId': session.profileId } : {}),
  };

  // Confirm only as a boolean that the operator session actually owns a For
  // Honor space; no profile or application identifiers are emitted.
  if (session.profileId) {
    const owned = await request(
      'self-gamesplayed',
      `${UBI}/v1/profiles/gamesplayed?profileIds=${encodeURIComponent(session.profileId)}`,
      baseHeaders,
    );
    let ownsForHonor = false;
    if (owned?.ok && owned.body) {
      const games = owned.body.gamesPlayed ?? [];
      ownsForHonor = Array.isArray(games) && games.some((g) => g?.spaceId === SPACE);
    }
    log(`self_for_honor_owned=${ownsForHonor}`);
  }

  const roots = {
    ranking1: `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v1/`,
    ranking2: `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroranking/public/v2/`,
    leaderboard: `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/heroleaderboard/public/v1/`,
    skill: `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/skillrating/public/v1/`,
    login: `${UBI}/v1/spaces/${SPACE}/title/hero/hero-live/herologin/public/v1/`,
  };

  // Existing routes tend to return 401 before validating parameters, while a
  // nonexistent resource is 404. This lets us map the route surface without
  // needing to guess response values.
  const discovery = [
    ['r1-player', roots.ranking1 + 'player'],
    ['r1-players', roots.ranking1 + 'players'],
    ['r1-rank', roots.ranking1 + 'rank'],
    ['r1-ranks', roots.ranking1 + 'ranks'],
    ['r1-ranking', roots.ranking1 + 'ranking'],
    ['r1-rankings', roots.ranking1 + 'rankings'],
    ['r1-leaderboard', roots.ranking1 + 'leaderboard'],
    ['r1-season', roots.ranking1 + 'season'],
    ['r1-seasons', roots.ranking1 + 'seasons'],
    ['r1-division', roots.ranking1 + 'division'],
    ['r1-divisions', roots.ranking1 + 'divisions'],
    ['r1-placement', roots.ranking1 + 'placement'],
    ['r1-progress', roots.ranking1 + 'progress'],
    ['r1-profile', roots.ranking1 + 'profile'],
    ['r2-player', roots.ranking2 + 'player'],
    ['r2-players', roots.ranking2 + 'players'],
    ['r2-ranking', roots.ranking2 + 'ranking'],
    ['r2-leaderboard', roots.ranking2 + 'leaderboard'],
    ['r2-season', roots.ranking2 + 'season'],
    ['lb-player', roots.leaderboard + 'player'],
    ['lb-players', roots.leaderboard + 'players'],
    ['lb-leaderboard', roots.leaderboard + 'leaderboard'],
    ['lb-entries', roots.leaderboard + 'entries'],
    ['lb-top', roots.leaderboard + 'top'],
    ['lb-season', roots.leaderboard + 'season'],
    ['skill-player', roots.skill + 'player'],
    ['skill-players', roots.skill + 'players'],
    ['skill-rating', roots.skill + 'rating'],
    ['skill-ratings', roots.skill + 'ratings'],
    ['skill-skill', roots.skill + 'skill'],
    ['skill-skills', roots.skill + 'skills'],
    ['skill-mmr', roots.skill + 'mmr'],
    ['login-login', roots.login + 'login'],
    ['login-session', roots.login + 'session'],
    ['login-token', roots.login + 'token'],
  ];

  for (const [label, url] of discovery) await request(label, url, baseHeaders);

  // Parameter shapes on the one already-proven title route. Profile values are
  // used internally but never logged because labels, not URLs, are printed.
  const self = session.profileId ? encodeURIComponent(session.profileId) : '';
  const player = roots.ranking1 + 'player';
  const variants = [
    ['player-skillfamily', '?skillFamily=1'],
    ['player-playlist', '?playlistId=22'],
    ['player-skillfamily-playlist', '?skillFamily=1&playlistId=22'],
    ['player-profile', self ? `?profileId=${self}` : null],
    ['player-profiles', self ? `?profileIds=${self}` : null],
    ['player-profile-skillfamily', self ? `?profileId=${self}&skillFamily=1` : null],
    ['player-profile-playlist', self ? `?profileId=${self}&playlistId=22` : null],
    ['player-profile-ranked', self ? `?profileId=${self}&skillFamily=1&playlistId=22` : null],
  ];
  for (const [label, suffix] of variants) if (suffix) await request(label, player + suffix, baseHeaders);

  // Title-login behavior with the full game header context. POST is an auth
  // handshake only; it does not alter player/game state.
  await request('title-login-get', roots.login + 'login', baseHeaders, 'GET');
  await request('title-login-post-empty', roots.login + 'login', baseHeaders, 'POST', '{}');
  if (session.profileId) {
    await request(
      'title-login-post-profile',
      roots.login + 'login',
      baseHeaders,
      'POST',
      JSON.stringify({ profileId: session.profileId }),
    );
  }
}

main().catch((error) => log(`unexpected_error=${clean(error?.name || 'Error')}`));
