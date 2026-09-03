import 'server-only';
import type {
  PlatformId,
  PlayerReport,
  ProviderInfo,
  StatGroup,
} from '@/shared/types';
import { env, ubisoftConfigured } from '../env';
import { parseJson, tracedFetch, type TraceCollector } from '../http';
import { redactBody } from '../redact';
import { readSession, writeSession } from '../ubisoft-session-store';
import {
  FOR_HONOR_SPACE_IDS,
  heroFactsFromStatCard,
  mapForHonorStats,
  mergeSpaceStats,
  platformProfiles,
  lastPlayedFromStatCard,
  type PlatformProfiles,
  type RawPlatformProfile,
  type RawStats,
  type StatCardEntry,
} from './forhonor-ubisoft-stats';
import { fetchForHonorAchievements } from './steam';
import { ProviderError, type DataProvider } from './types';

const UBI_SERVICES = 'https://public-ubiservices.ubi.com';

const info: ProviderInfo = {
  id: 'ubisoft',
  label: 'Ubisoft Connect (authenticated)',
  description:
    'Ubisoft public-ubiservices. Every player-scoped endpoint requires a session ticket, so this provider only runs when an operator has supplied their own Ubisoft account credentials.',
  docsUrl: 'https://github.com/SixSleet/For-Honor-Tracker#readme',
};

interface Session {
  ticket: string;
  sessionId: string;
  profileId: string;
  expiresAt: number;
}

interface SessionResponse {
  ticket?: string;
  sessionId?: string;
  profileId?: string;
  expiration?: string;
  rememberMeTicket?: string;
}

/** Per-instance cache in front of the shared store, to avoid a round-trip per request. */
let cachedSession: Session | null = null;

/**
 * Returns a usable session for reaching player endpoints, in priority order:
 *
 *  1. A ticket set directly via env (single-operator convenience).
 *  2. The shared stored session — refreshed via Ubisoft's remember-me
 *     mechanism when it is close to expiring. This is what lets the site
 *     serve every visitor with no login: the operator seeds a session once,
 *     and it renews itself from then on.
 *  3. A credential login, only as a last resort (usually bot-blocked).
 *
 * Visitors never authenticate. This is entirely operator-side.
 */
// Renew this far ahead of expiry so a live request never races a dying ticket.
const RENEW_MARGIN_MS = 5 * 60_000;

async function login(trace: TraceCollector): Promise<Session> {
  if (cachedSession && cachedSession.expiresAt > Date.now() + RENEW_MARGIN_MS) return cachedSession;

  // 1. Direct env ticket.
  if (env.ubisoft.ticket) {
    cachedSession = {
      ticket: env.ubisoft.ticket,
      sessionId: env.ubisoft.sessionId ?? '',
      profileId: '',
      expiresAt: Date.now() + 2 * 3600_000,
    };
    return cachedSession;
  }

  // 2. Shared stored session, kept alive by sliding renewal.
  const stored = await readSession();
  if (stored) {
    const fresh = stored.expiresAt > Date.now() + RENEW_MARGIN_MS;
    if (fresh) {
      cachedSession = {
        ticket: stored.ticket,
        sessionId: stored.sessionId,
        profileId: stored.profileId,
        expiresAt: stored.expiresAt,
      };
      return cachedSession;
    }
    // Primary renewal: a still-valid ticket mints a fresh one, with no
    // password and no remember-me — so a session seeded from a single browser
    // ticket slides forward on its own indefinitely, as long as it renews
    // within each window.
    const slid = await refreshWithTicket(stored.ticket, stored.sessionId, stored.rememberMeTicket, trace);
    if (slid) {
      cachedSession = slid;
      return cachedSession;
    }
    // Fallback: remember-me, if one was captured.
    if (stored.rememberMeTicket) {
      const refreshed = await refreshWithRememberMe(stored.rememberMeTicket, trace);
      if (refreshed) {
        cachedSession = refreshed;
        return cachedSession;
      }
    }
    // Could not renew at all — surface an actionable "re-seed" message.
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'The Ubisoft session has expired and could not be renewed automatically.',
      'Re-seed it: paste a fresh ticket to /api/ubisoft-session (or run the seed script).',
    );
  }

  // 3. Credential login (expected to be bot-blocked from most hosts).
  return credentialLogin(trace);
}

/**
 * Slides the session forward: a still-valid ticket is exchanged for a fresh
 * one at POST /v3/profiles/sessions, authenticated by the ticket itself.
 *
 * Verified live: this needs no password and no remember-me ticket, and is not
 * fronted by the bot check (only the initial credential/anonymous login is).
 * So a session seeded from one browser-captured ticket renews itself
 * indefinitely, as long as each refresh lands before the current ticket
 * expires — which on-request renewal and the daily cron both ensure.
 *
 * Carries the remember-me ticket forward untouched as a secondary fallback.
 */
async function refreshWithTicket(
  currentTicket: string,
  currentSessionId: string,
  rememberMeTicket: string | null,
  trace: TraceCollector,
): Promise<Session | null> {
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Slide session (refresh via current ticket)',
      url: `${UBI_SERVICES}/v3/profiles/sessions`,
      method: 'POST',
      headers: {
        'Ubi-AppId': env.ubisoft.appId,
        'Ubi-SessionId': currentSessionId,
        'Content-Type': 'application/json',
        Authorization: `Ubi_v1 t=${currentTicket}`,
      },
      body: JSON.stringify({ rememberMe: true }),
    },
    trace,
  );
  if (!response.ok) return null;

  const body = parseJson<SessionResponse>(response.text);
  if (!body?.ticket) return null;

  const expiresAt = body.expiration ? Date.parse(body.expiration) : Date.now() + 2 * 3600_000;
  const next: Session = {
    ticket: body.ticket,
    sessionId: body.sessionId ?? currentSessionId,
    profileId: body.profileId ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 2 * 3600_000,
  };
  await writeSession({
    ...next,
    rememberMeTicket: body.rememberMeTicket ?? rememberMeTicket,
    updatedAt: Date.now(),
  });
  return next;
}

/**
 * Mints a new ticket from a remember-me ticket — Ubisoft's own "stay signed
 * in" flow. Kept as a secondary fallback behind sliding renewal.
 */
async function refreshWithRememberMe(
  rememberMeTicket: string,
  trace: TraceCollector,
): Promise<Session | null> {
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Refresh session (remember-me)',
      url: `${UBI_SERVICES}/v3/profiles/sessions`,
      method: 'POST',
      headers: {
        'Ubi-AppId': env.ubisoft.appId,
        'Content-Type': 'application/json',
        Authorization: `rm_v1 t=${rememberMeTicket}`,
      },
      body: JSON.stringify({ rememberMe: true }),
    },
    trace,
  );
  if (!response.ok) return null;

  const body = parseJson<SessionResponse>(response.text);
  if (!body?.ticket) return null;

  const expiresAt = body.expiration ? Date.parse(body.expiration) : Date.now() + 2 * 3600_000;
  const next: Session = {
    ticket: body.ticket,
    sessionId: body.sessionId ?? '',
    profileId: body.profileId ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 2 * 3600_000,
  };
  await writeSession({
    ...next,
    // Ubisoft may or may not rotate the remember-me ticket; keep the newest.
    rememberMeTicket: body.rememberMeTicket ?? rememberMeTicket,
    updatedAt: Date.now(),
  });
  return next;
}

/**
 * The scheduled/manual maintenance refresh. Reads the shared session, renews
 * it via remember-me, and reports a health verdict the caller can act on
 * (alert on failure). Never throws — it always returns a status.
 */
export type RefreshOutcome =
  | { ok: true; renewed: boolean; expiresInSeconds: number; canAutoRenew: boolean }
  | { ok: false; reason: string; needsReseed: boolean };

async function forceRefresh(trace: TraceCollector): Promise<RefreshOutcome> {
  const stored = await readSession();
  if (!stored) {
    return { ok: false, reason: 'No session has been seeded yet.', needsReseed: true };
  }

  const stillFresh = stored.expiresAt > Date.now() + 10 * 60_000;

  // Primary: slide the session forward using the current ticket (no
  // remember-me required). Fallback: remember-me if present.
  try {
    const slid = await refreshWithTicket(
      stored.ticket,
      stored.sessionId,
      stored.rememberMeTicket,
      trace,
    );
    if (slid) {
      cachedSession = slid;
      return {
        ok: true,
        renewed: true,
        expiresInSeconds: Math.round((slid.expiresAt - Date.now()) / 1000),
        canAutoRenew: true,
      };
    }
    if (stored.rememberMeTicket) {
      const refreshed = await refreshWithRememberMe(stored.rememberMeTicket, trace);
      if (refreshed) {
        cachedSession = refreshed;
        return {
          ok: true,
          renewed: true,
          expiresInSeconds: Math.round((refreshed.expiresAt - Date.now()) / 1000),
          canAutoRenew: true,
        };
      }
    }
  } catch {
    // Fall through to the failure verdict below.
  }

  // Renewal failed. If the current ticket is still valid for a while, this is
  // not yet urgent; otherwise a re-seed is needed.
  return stillFresh
    ? {
        ok: true,
        renewed: false,
        expiresInSeconds: Math.round((stored.expiresAt - Date.now()) / 1000),
        canAutoRenew: true,
      }
    : {
        ok: false,
        reason: 'Remember-me renewal was refused (likely a bot check or an expired remember-me ticket).',
        needsReseed: true,
      };
}

async function credentialLogin(trace: TraceCollector): Promise<Session> {
  const email = env.ubisoft.email;
  const password = env.ubisoft.password;
  if (!email || !password) {
    throw new ProviderError(
      'PROVIDER_DISABLED',
      'The Ubisoft provider has no seeded session, no env ticket, and no credentials.',
    );
  }

  const basic = Buffer.from(`${email}:${password}`, 'utf8').toString('base64');
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Create session (POST /v3/profiles/sessions)',
      url: `${UBI_SERVICES}/v3/profiles/sessions`,
      method: 'POST',
      headers: {
        'Ubi-AppId': env.ubisoft.appId,
        'Content-Type': 'application/json',
        Authorization: `Basic ${basic}`,
      },
      body: JSON.stringify({ rememberMe: true }),
    },
    trace,
  );

  // Ubisoft fronts this endpoint with DataDome bot protection. A challenge is
  // an access control: this project reports it and stops, rather than trying
  // to solve or evade it.
  if (response.status === 403 && /captcha-delivery|datadome/i.test(response.text)) {
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      "Ubisoft's login is returning a bot-protection challenge, so the server cannot log in directly.",
      'Seed a session instead: run the login script from a normal connection and let it POST the ticket to /api/ubisoft-session. See the README.',
    );
  }
  if (response.status === 401) {
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'Ubisoft rejected the configured tracker credentials.',
      'Check UBISOFT_EMAIL and UBISOFT_PASSWORD. Accounts with two-factor authentication cannot be used this way.',
    );
  }
  if (response.status === 429) {
    throw new ProviderError(
      'PROVIDER_UNAVAILABLE',
      'Ubisoft is rate-limiting this tracker. Please try again later.',
    );
  }
  if (!response.ok) {
    throw new ProviderError('PROVIDER_UNAVAILABLE', 'Ubisoft did not return a session.');
  }

  const body = parseJson<SessionResponse>(response.text);
  if (!body?.ticket) {
    throw new ProviderError('PROVIDER_UNAVAILABLE', 'Ubisoft returned a session without a ticket.');
  }

  const expiresAt = body.expiration ? Date.parse(body.expiration) : Date.now() + 2 * 3600_000;
  cachedSession = {
    ticket: body.ticket,
    sessionId: body.sessionId ?? '',
    profileId: body.profileId ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 2 * 3600_000,
  };
  await writeSession({
    ...cachedSession,
    rememberMeTicket: body.rememberMeTicket ?? null,
    updatedAt: Date.now(),
  });
  return cachedSession;
}

/** Wraps a caller-supplied ticket as a Session, without touching the login. */
function sessionFromTicket(ticket: string, sessionId = ''): Session {
  return { ticket, sessionId, profileId: '', expiresAt: Date.now() + 2 * 3600_000 };
}

/** Drops the per-instance cache — used after a 401 so the next call refreshes. */
function invalidateCachedSession(): void {
  cachedSession = null;
}

function authHeaders(current: Session): Record<string, string> {
  return {
    'Ubi-AppId': env.ubisoft.appId,
    'Ubi-SessionId': current.sessionId,
    'Ubi-LocaleCode': 'en-US',
    'Content-Type': 'application/json',
    Authorization: `Ubi_v1 t=${current.ticket}`,
  };
}

/** Platforms a Ubisoft account name can exist on, in search order. */
const PLATFORMS = ['uplay', 'steam', 'psn', 'xbl'] as const;

const PLATFORM_TO_ID: Record<string, PlatformId> = {
  uplay: 'uplay',
  steam: 'steam',
  psn: 'psn',
  xbl: 'xbl',
};

interface ProfileSearchResponse {
  profiles?: Array<{
    profileId: string;
    userId: string;
    platformType: string;
    idOnPlatform: string;
    nameOnPlatform: string;
  }>;
}

/**
 * Finds every For Honor space to query for a profile.
 *
 * `/v1/profiles/gamesplayed` returns `{ gamesPlayed: [{ spaceId, … }] }` with
 * no game names, so a name regex can't work (an earlier version's bug). For
 * Honor's spaces are known (codename "Hero", confirmed live).
 *
 * This returns ALL of the known spaces the profile has played rather than just
 * the first. For Honor keeps a per-platform space and a crossplay one, and a
 * player who predates crossplay has stats in both — but only one of them is
 * still being written to. Taking the first match meant silently reading a
 * frozen snapshot when a live one existed alongside it, so the caller picks
 * between them on freshness instead.
 */
async function discoverForHonorSpaceIds(
  current: Session,
  profileId: string,
  trace: TraceCollector,
): Promise<{ spaceIds: string[]; applicationIds: string[] }> {
  if (env.ubisoft.forHonorSpaceId) {
    return { spaceIds: [env.ubisoft.forHonorSpaceId], applicationIds: [] };
  }

  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Discover For Honor space (GET /v1/profiles/gamesplayed)',
      url: `${UBI_SERVICES}/v1/profiles/gamesplayed?profileIds=${encodeURIComponent(profileId)}`,
      headers: authHeaders(current),
    },
    trace,
  );

  if (response.ok) {
    // The same response also names the applications behind each space — one
    // per platform the player owns the game on. Those ids are what the
    // play-history endpoint is keyed by, so they are collected here rather
    // than costing a second call later.
    const body = parseJson<{
      gamesPlayed?: Array<{ spaceId?: string; applications?: Array<{ applicationId?: string }> }>;
    }>(response.text);
    const games = body?.gamesPlayed ?? [];
    const owned = new Set(games.map((game) => game.spaceId));
    const matches = FOR_HONOR_SPACE_IDS.filter((id) => owned.has(id));
    const applicationIds = [
      ...new Set(
        games
          .filter((game) => game.spaceId && FOR_HONOR_SPACE_IDS.includes(game.spaceId))
          .flatMap((game) => game.applications ?? [])
          .map((application) => application.applicationId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (matches.length > 0) return { spaceIds: matches, applicationIds };
    // The profile has games but none is a known For Honor space.
    if (owned.size > 0) return { spaceIds: [], applicationIds: [] };
  }

  // Could not read games played — try every known space anyway; the stats call
  // simply returns nothing for a space the player does not own.
  return { spaceIds: [...FOR_HONOR_SPACE_IDS], applicationIds: [] };
}

/**
 * How many separate sessions the player has launched For Honor for.
 *
 * `gamesplayed` returns nulls for every play-history field, but the same
 * numbers are populated on `/v2/profiles/{id}/applications` when it is asked
 * for specific application ids. That is where the session count lives — a
 * figure nothing else on the page carries, and the one that makes average
 * session length computable.
 */
async function fetchSessionCount(
  current: Session,
  profileId: string,
  applicationIds: string[],
  trace: TraceCollector,
): Promise<number | null> {
  if (applicationIds.length === 0) return null;
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Play history (GET /v2/profiles/{id}/applications)',
      url: `${UBI_SERVICES}/v2/profiles/${encodeURIComponent(profileId)}/applications?applicationIds=${applicationIds.map(encodeURIComponent).join(',')}`,
      headers: authHeaders(current),
    },
    trace,
  );
  if (!response.ok) return null;
  const body = parseJson<{ applications?: Array<{ sessionsPlayed?: number }> }>(response.text);
  let total = 0;
  let seen = false;
  for (const application of body?.applications ?? []) {
    if (typeof application.sessionsPlayed === 'number' && application.sessionsPlayed >= 0) {
      total += application.sessionsPlayed;
      seen = true;
    }
  }
  return seen ? total : null;
}

/**
 * Scores how current a stats snapshot is, so the freshest space wins.
 *
 * `MetaGameSeason` is the season the snapshot was last written in, which is the
 * most direct signal of staleness. Total reputation breaks ties (and covers a
 * snapshot with no season field): a live space can only have accumulated more
 * play than a frozen one.
 */
function snapshotFreshness(stats: RawStats | null): number {
  if (!stats) return -1;
  const read = (key: string): number => {
    const value = Number(stats[key]?.value);
    return Number.isFinite(value) ? value : 0;
  };
  return read('MetaGameSeason') * 1_000_000 + read('Reputation');
}

async function fetchProfileStats(
  current: Session,
  profileId: string,
  spaceId: string,
  trace: TraceCollector,
): Promise<RawStats | null> {
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'For Honor statistics (GET /v1/profiles/stats)',
      url: `${UBI_SERVICES}/v1/profiles/stats?spaceId=${encodeURIComponent(spaceId)}&profileIds=${encodeURIComponent(profileId)}`,
      headers: authHeaders(current),
    },
    trace,
  );
  if (!response.ok) return null;
  const body = parseJson<{ profiles?: Array<{ profileId: string; stats?: RawStats }> }>(
    response.text,
  );
  return body?.profiles?.find((profile) => profile.profileId === profileId)?.stats ?? null;
}

/**
 * Ubisoft's stat card for the game — the panel its own Connect overlay shows.
 *
 * Worth a request of its own even though it repeats stats already fetched: it
 * carries Ubisoft's player-facing label for every stat, including one per hero
 * ("Warden Reputation", "Jiang Jun Reputation"), plus each stat's first and
 * last write. That is the only authoritative source for what Ubisoft's hero
 * codenames actually mean, and — through the last write — the only source for
 * when a player last played. The first write is not a player fact: it is when
 * Ubisoft created the counter, identical on every account.
 *
 * Requires Ubi-LocaleCode; without it Ubisoft answers 400 before even checking
 * the ticket.
 */
async function fetchStatsCard(
  current: Session,
  profileId: string,
  spaceId: string,
  trace: TraceCollector,
): Promise<StatCardEntry[]> {
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Ubisoft Connect stat card (GET /v1/profiles/{id}/statscard)',
      url: `${UBI_SERVICES}/v1/profiles/${encodeURIComponent(profileId)}/statscard?spaceId=${encodeURIComponent(spaceId)}`,
      headers: { ...authHeaders(current), 'Ubi-LocaleCode': 'en-US' },
    },
    trace,
  );
  if (!response.ok) return [];

  const body = parseJson<{ Statscards?: StatCardEntry[]; statscards?: StatCardEntry[] }>(
    response.text,
  );
  return body?.Statscards ?? body?.statscards ?? [];
}

/**
 * The platforms an account plays on, from the profiles that share its userId.
 * The reading of that response — which handles are shown and which are not —
 * lives in the pure mapper beside this one, where it is tested directly.
 */
async function fetchPlatforms(
  current: Session,
  profileId: string,
  trace: TraceCollector,
): Promise<PlatformProfiles> {
  const response = await tracedFetch(
    {
      provider: info.id,
      label: 'Linked platforms (GET /v2/profiles?userId=)',
      url: `${UBI_SERVICES}/v2/profiles?userId=${encodeURIComponent(profileId)}`,
      headers: authHeaders(current),
    },
    trace,
  );
  if (!response.ok) return { links: [], steamId64: null, accountName: null };
  const body = parseJson<{ profiles?: RawPlatformProfile[] }>(response.text);
  return platformProfiles(body?.profiles ?? []);
}

/**
 * Ubisoft's avatar CDN, which serves a picture per profile id at a fixed path.
 * Confirmed live: 200 for a real profile. It is checked rather than assumed —
 * a URL that 404s would render as a broken image on every page.
 */
async function fetchAvatarUrl(profileId: string): Promise<string | undefined> {
  const url = `https://ubisoft-avatars.akamaized.net/${encodeURIComponent(profileId)}/default_256_256.png`;
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store' });
    return response.ok ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Internals exposed for the one-shot authenticated probe route. Ubisoft's
 * login sits behind bot protection and is rate limited per account, so the
 * probe reuses this session rather than logging in again.
 */
/**
 * Operator-only: ask Ubisoft for stat names by name, and report which of them
 * it actually holds for a profile.
 *
 * /v1/profiles/stats returns a fixed default set — 186 keys for a long-lived
 * account — and that set is all this provider has ever seen. Ubisoft's stat
 * service also accepts an explicit `statNames` list, and a name it knows but
 * does not include by default will only ever appear if it is asked for. There
 * is no catalogue of those names, so the only way to find one is to ask for a
 * candidate and see whether a value comes back.
 *
 * This exists so that decoding more of For Honor's dictionary is a matter of
 * running a probe rather than guessing. It never runs on a visitor's lookup:
 * it is reachable only through the token-gated diagnostics route, and it only
 * ever reads, one profile at a time.
 */
async function probeStatNames(
  profileId: string,
  names: string[],
  trace: TraceCollector,
): Promise<Array<{ spaceId: string; found: Record<string, string>; missing: string[] }>> {
  const current = await login(trace);
  const results: Array<{ spaceId: string; found: Record<string, string>; missing: string[] }> = [];

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const response = await tracedFetch(
      {
        provider: info.id,
        label: `Probe stat names on ${spaceId.slice(0, 8)} (GET /v1/profiles/stats?statNames=)`,
        url:
          `${UBI_SERVICES}/v1/profiles/stats?spaceId=${encodeURIComponent(spaceId)}` +
          `&profileIds=${encodeURIComponent(profileId)}` +
          `&statNames=${encodeURIComponent(names.join(','))}`,
        headers: authHeaders(current),
      },
      trace,
    );
    if (!response.ok) {
      results.push({ spaceId, found: {}, missing: names });
      continue;
    }
    const stats =
      parseJson<{ profiles?: Array<{ profileId: string; stats?: RawStats }> }>(response.text)
        ?.profiles?.find((profile) => profile.profileId === profileId)?.stats ?? {};
    const found: Record<string, string> = {};
    for (const [key, entry] of Object.entries(stats)) {
      if (entry?.value !== undefined && entry.value !== null && entry.value !== '') {
        found[key] = String(entry.value);
      }
    }
    results.push({
      spaceId,
      found,
      missing: names.filter((name) => !(name in found)),
    });
  }
  return results;
}

/**
 * Operator-only: try candidate endpoint paths against Ubisoft's public service
 * and report what each one answers.
 *
 * The provider reads five endpoints. Whether the service exposes anything else
 * useful for this game is not documented anywhere, so the only way to find out
 * is to ask and read the status: 404 means the route does not exist, 401/403
 * means it exists but this session may not have it, 200 means there is
 * something there worth decoding.
 *
 * Deliberately narrow, because a "fetch any URL" helper behind a token is an
 * SSRF waiting to happen:
 *
 *   - callers pass a *path*, never a URL, and it is always joined onto
 *     public-ubiservices.ubi.com — no other host is reachable;
 *   - GET only, so nothing can be created or changed;
 *   - {profileId} and {spaceId} are substituted rather than free-typed;
 *   - responses come back through the same redactor as every other trace.
 */
async function probePaths(
  profileId: string,
  paths: string[],
  trace: TraceCollector,
): Promise<Array<{ path: string; status: number | null; ok: boolean; snippet: string }>> {
  const current = await login(trace);
  const results: Array<{ path: string; status: number | null; ok: boolean; snippet: string }> = [];

  for (const template of paths) {
    // A path, never a URL: anything that tries to escape the host is refused
    // rather than quietly rewritten into a request somewhere else.
    if (!template.startsWith('/') || template.startsWith('//') || template.includes('..')) {
      results.push({ path: template, status: null, ok: false, snippet: 'rejected: not a relative path' });
      continue;
    }
    const path = template
      .replaceAll('{profileId}', encodeURIComponent(profileId))
      .replaceAll('{spaceId}', encodeURIComponent(FOR_HONOR_SPACE_IDS[1]));
    try {
      const response = await tracedFetch(
        {
          provider: info.id,
          label: `Probe path ${template}`,
          url: `${UBI_SERVICES}${path}`,
          headers: authHeaders(current),
          timeoutMs: 8000,
        },
        trace,
      );
      results.push({
        path,
        status: response.status,
        ok: response.ok,
        // Redacted like every other trace body. 300 characters was too short
        // to read a response worth discovering, and an unredacted snippet
        // would have been a hole in exactly the claim this probe makes.
        snippet: redactBody(response.text, 4000),
      });
    } catch (error) {
      results.push({
        path,
        status: null,
        ok: false,
        snippet: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export const __internal = {
  login,
  authHeaders,
  sessionFromTicket,
  invalidateCachedSession,
  forceRefresh,
  probeStatNames,
  probePaths,
  UBI_SERVICES,
  PLATFORMS,
  info,
};

export const ubisoftProvider: DataProvider = {
  info,

  isEnabled() {
    return ubisoftConfigured();
  },

  disabledReason() {
    if (ubisoftConfigured()) return null;
    if (!env.ubisoft.enabled) {
      return 'Off by default. Ubisoft has no anonymous access to player data, so this provider needs a Ubisoft account you own. To turn it on, set UBISOFT_ENABLED=true, UBISOFT_EMAIL and UBISOFT_PASSWORD as server-side environment variables — never in the browser. Read the Ubisoft section of the README first: the login may be met with a bot-protection challenge, which this project reports rather than circumvents, and using one account this way may breach Ubisoft\u2019s Terms of Use.';
    }
    return 'UBISOFT_ENABLED is set, but there is no way to authenticate. Either supply UBISOFT_TICKET (a session ticket from an already-logged-in Ubisoft Connect browser session — the reliable route, since the server cannot pass the login bot check itself) or UBISOFT_EMAIL and UBISOFT_PASSWORD.';
  },

  canHandle(query) {
    // Ubisoft Connect names: 3-15 chars, letters/digits/._- (dot and dash not
    // at the edges). Kept permissive; the API is the real authority.
    return /^[A-Za-z0-9][A-Za-z0-9._-]{1,28}[A-Za-z0-9]$/.test(query.trim());
  },

  async getPlayerByUsername(username, trace) {
    const current = await login(trace);
    const name = username.trim();

    // A player may exist under this name on any linked platform. Ubisoft
    // Connect is checked first because that is what the search box asks for.
    for (const platformType of PLATFORMS) {
      const response = await tracedFetch(
        {
          provider: info.id,
          label: `Search profile by name on ${platformType} (GET /v2/profiles)`,
          url: `${UBI_SERVICES}/v2/profiles?platformType=${platformType}&nameOnPlatform=${encodeURIComponent(name)}`,
          headers: authHeaders(current),
        },
        trace,
      );

      if (response.status === 401) {
        // The ticket died mid-flight; drop the cache so the next attempt
        // refreshes via remember-me from the shared store.
        invalidateCachedSession();
        throw new ProviderError(
          'PROVIDER_UNAVAILABLE',
          'The Ubisoft session expired. Please retry the search.',
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          'PROVIDER_UNAVAILABLE',
          'Ubisoft is rate-limiting this tracker. Please try again in a few minutes.',
        );
      }
      if (response.status === 404) continue;
      if (!response.ok) continue;

      const profile = parseJson<ProfileSearchResponse>(response.text)?.profiles?.[0];
      if (!profile) continue;

      // Ubisoft keeps one profile per platform and one account behind them
      // all, and the game's stats hang off the account, not the platform
      // profile. A search that matched on Steam, PSN or Xbox therefore has to
      // resolve to `userId` — the account — or the stats lookup runs against a
      // profile that owns no game and returns an empty report. Confirmed live:
      // searching a SteamID64 found the right person and showed nothing.
      return {
        id: profile.userId || profile.profileId,
        displayName: profile.nameOnPlatform,
        platform: (PLATFORM_TO_ID[platformType] ?? 'uplay') as PlatformId,
      };
    }

    return null;
  },

  async getPlayerReport(identity, trace): Promise<PlayerReport> {
    const current = await login(trace);
    const notices: string[] = [];
    const { spaceIds, applicationIds } = await discoverForHonorSpaceIds(current, identity.id, trace);

    if (spaceIds.length === 0) {
      notices.push('We couldn\u2019t find For Honor on this account.');
    }

    // A player who predates crossplay has stats in both the per-platform and
    // the crossplay space, but only one of them is still being written to.
    // Read every space they own and keep the freshest \u2014 measured by the season
    // the snapshot reports, then by how much play it accounts for. Picking the
    // first space instead meant serving a frozen snapshot while a live one sat
    // beside it.
    const candidates = await Promise.all(
      spaceIds.map(async (spaceId) => ({
        spaceId,
        stats: await fetchProfileStats(current, identity.id, spaceId, trace),
      })),
    );

    const ranked = candidates
      .filter((candidate) => candidate.stats && Object.keys(candidate.stats).length > 0)
      .sort((a, b) => snapshotFreshness(b.stats) - snapshotFreshness(a.stats));
    const freshest = ranked[0];
    // The freshest snapshot wins, but the others can still contribute anything
    // it does not carry — see mergeSpaceStats.
    const rawStats =
      ranked.length > 0 ? mergeSpaceStats(ranked.map((entry) => entry.stats as RawStats)) : null;

    const hasStats = Boolean(rawStats && Object.keys(rawStats).length > 0);

    // Three more sources, all fetched together so they cost one round trip:
    // the stat card (Ubisoft's own hero names, and first/last played), the
    // platforms the account plays on, and whether an avatar exists.
    const [statCard, platforms, avatarUrl, sessions] = await Promise.all([
      freshest ? fetchStatsCard(current, identity.id, freshest.spaceId, trace) : Promise.resolve([] as StatCardEntry[]),
      fetchPlatforms(current, identity.id, trace),
      fetchAvatarUrl(identity.id),
      fetchSessionCount(current, identity.id, applicationIds, trace),
    ]);
    const heroFacts = heroFactsFromStatCard(statCard);
    const lastPlayedAt = lastPlayedFromStatCard(statCard);

    // Ubisoft has no achievement data of its own for For Honor, but it does
    // say which Steam account this one is linked to — and Steam publishes
    // For Honor achievements for any public profile without a key. That join
    // is the only way a player searched by their Ubisoft name can see them.
    const achievements = platforms.steamId64
      ? await fetchForHonorAchievements(platforms.steamId64, trace)
      : null;


    if (!hasStats && spaceIds.length > 0) {
      notices.push('No For Honor stats are available for this player yet.');
    }

    // Map Ubisoft's real For Honor vocabulary (confirmed live) into display
    // stats. Known hero codenames become in-game names; unknown ones are shown
    // readably from the codename, never guessed.
    const mapped = hasStats
      ? mapForHonorStats(rawStats as RawStats, heroFacts, sessions)
      : { season: null, overview: [], overall: [], heroes: [], gameModes: [], extraGroups: [], undecoded: 0 };

    // Ubisoft's stats service writes on its own schedule and can lag live
    // play. This used to be a blanket warning on every report, which is both
    // vaguer and less useful than the fact now beside it: the stat card gives
    // the exact moment Ubisoft last wrote these figures, and the page states
    // it. The warning is kept only for a report that has no such timestamp,
    // where a reader would otherwise have nothing to judge freshness by.
    if (hasStats && lastPlayedAt === null) {
      notices.push(
        'Ubisoft updates these figures on its own schedule, so very recent play may not be counted yet.',
      );
    }

    // The name the player is known by, resolved once and used everywhere.
    const displayName = platforms.accountName || identity.displayName;

    const extraGroups: StatGroup[] = [...mapped.extraGroups];

    // Say plainly that some values are not covered, rather than printing rows
    // whose names are generated from Ubisoft's key spelling and mean nothing.
    if (mapped.undecoded > 0) {
      notices.push(
        `Ubisoft returns ${mapped.undecoded} further value${mapped.undecoded === 1 ? '' : 's'} for this player that we can\u2019t label clearly yet, so they are not shown.`,
      );
    }

    return {
      identity: {
        ...identity,
        displayName,
        ...(avatarUrl ? { avatarUrl } : {}),
      },
      provider: info,
      fetchedAt: Date.now(),
      cached: false,
      lastPlayedAt,
      platforms: platforms.links,
      season: mapped.season,
      overview: {
        key: 'overview',
        label: 'Story mode',
        availability: 'confirmed',
        explanation: undefined,
        stats: hasStats
          ? [
              ...mapped.overview,
              {
                key: 'displayName',
                label: 'Ubisoft name',
                value: displayName,
                kind: 'text',
              },
            ]
          : [
              { key: 'platform', label: 'Platform', value: 'Ubisoft Connect', kind: 'text' },
              { key: 'name', label: 'Player', value: displayName, kind: 'text' },
            ],
      },
      overall: {
        key: 'overall',
        label: 'Combat record',
        availability: hasStats ? 'confirmed' : 'unavailable',
        explanation: hasStats
          ? undefined
          : 'Ubisoft returned no statistics for this profile and space.',
        stats: mapped.overall,
      },
      extraGroups,
      heroes: {
        availability: hasStats && mapped.heroes.length > 0 ? 'confirmed' : 'unavailable',
        explanation:
          hasStats && mapped.heroes.length > 0
            ? 'Reputation, level and time played per hero, straight from Ubisoft. Search and sort below.'
            : 'No per-hero data was returned for this profile.',
        items: mapped.heroes,
      },
      gameModes: {
        availability: mapped.gameModes.length > 0 ? 'confirmed' : 'unavailable',
        explanation:
          mapped.gameModes.length > 0
            ? undefined
            : 'Ubisoft breaks matches down by mode for Duel and Dominion only, and returned neither for this player.',
        items: mapped.gameModes,
      },
      matches: {
        availability: 'dead',
        explanation:
          'The official For Honor match-history site (game-forhonor.ubisoft.com) has been decommissioned. No replacement endpoint was found.',
        items: [],
      },
      achievements: {
        availability: achievements?.readable ? 'confirmed' : 'unavailable',
        explanation: achievements?.readable
          ? 'From this account\u2019s linked Steam profile, which publishes For Honor achievements.'
          : platforms.steamId64
            ? achievements?.privacyState && achievements.privacyState !== 'public'
              ? 'This account has a Steam profile linked, but Steam reports its game details as not public, so achievements are hidden. Only the player can change that.'
              : 'This account has a Steam profile linked, but no For Honor achievements could be read from it.'
            : 'Ubisoft publishes no achievement data for For Honor, and this account has no Steam profile linked to read them from.',
        items: achievements?.items ?? [],
        unlockedCount: achievements?.unlockedCount ?? 0,
        totalCount: achievements?.totalCount ?? 0,
      },
      notices,
    };
  },
};
