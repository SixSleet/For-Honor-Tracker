/**
 * Research probe: find the live sub-paths of For Honor's own title services.
 *
 * Not for main. Runs on this branch's Vercel PREVIEW deployment, driven by the
 * workflow beside it, because the container this was written in cannot reach
 * ubi.com at all.
 *
 * The previous run established the thing that makes this worth doing: the
 * title services named in fh-configuration (heroranking, heroleaderboard,
 * skillrating, playerstats2, …) are LIVE and answer an ordinary session
 * ticket. They are not behind game-client impersonation, contrary to this
 * project's standing note. What is missing is their routes.
 *
 * Their 404 is an oracle. The UbiServices gateway answers an unknown path with
 *   {"errorCode":1003,"message":"Resource '<url>' not found."}
 * whereas the title service itself answers with
 *   {"resource":"<its own root>","errorCode":"UnspecifiedError",
 *    "message":"<the part it could not route>","serverUtcTime":...}
 * So a reply in the second shape means "reached the service, wrong path", and
 * ANYTHING ELSE — a 200, a 400 complaining about parameters, a 401, a 403 —
 * means the path exists. That distinction is the whole result, so this reports
 * candidates as UNMATCHED or as a HIT with the body.
 *
 * Everything is asked with the ordinary session ticket and NOTHING else. The
 * configuration also hands over application_build_id_* and sandbox_name_*,
 * which is what the game client presents; deliberately not sent. A 401 asking
 * for them is a real answer and the end of this line of enquiry.
 *
 * Output is schema only — paths, statuses and service error text. The log is
 * public, so no stat values and no ids: the profile id is masked to {id}.
 */
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

/** Sub-paths to try under each service root. `{id}` becomes the profile id. */
const CANDIDATES = [
  // Things that would confirm routing outright.
  'health',
  'status',
  'version',
  'config',
  'configuration',
  // Ranking / rating shapes.
  'ranking',
  'rankings',
  'rank',
  'ranks',
  'skillrating',
  'skill',
  'mmr',
  'rating',
  'ratings',
  // Season shapes — Season 0 is what prompted all of this.
  'seasons',
  'season',
  'season/current',
  'currentseason',
  'seasons/current',
  // Player-scoped shapes.
  'profiles/{id}',
  'profiles/{id}/ranking',
  'profiles/{id}/rank',
  'profiles/{id}/season',
  'profiles/{id}/stats',
  'players/{id}/ranking',
  'ranking/profiles/{id}',
  'rankings/{id}',
  'leaderboard',
  'leaderboards',
  'leaderboard/profiles/{id}',
  'stats',
  'stats/{id}',
  'playerstats',
];

interface Result {
  service: string;
  path: string;
  status: number | null;
  /** UNMATCHED means the service answered with its own not-found shape. */
  verdict: 'UNMATCHED' | 'GATEWAY-404' | 'NO-ROUTE' | 'HIT' | 'ERROR';
  body?: string;
}

export async function GET(request: Request) {
  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const verdict = await verifyGithubActionsToken(presented, { audience: PROBE_AUDIENCE });
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });
  }

  const trace = newTraceCollector();
  if (!(await readSession())) {
    return NextResponse.json({ ok: false, reason: 'No session on this deployment.' }, { status: 503 });
  }

  // Sliding the session forward is what yields the ticket's own profile id;
  // the stored session carries an empty one by design.
  await forceRefresh(trace);
  const session = await login(trace);
  const stored = await readSession();
  const profileId = session.profileId || stored?.profileId || '';
  const headers = authHeaders(session);

  const mask = (text: string) => (profileId ? text.split(profileId).join('{id}') : text);

  // Read each space's configuration for the public title-service roots.
  const services: Record<string, string> = {};
  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const response = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) continue;
    const body = (await response.json()) as Record<string, unknown>;
    const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
    const config = ((inner['fh-configuration'] as Record<string, unknown>)?.['fields'] ??
      {}) as Record<string, string>;
    for (const [key, value] of Object.entries(config)) {
      if (/_public_v\d$/.test(key) && typeof value === 'string' && value.startsWith('https://')) {
        services[`${spaceId.slice(0, 8)}/${key}`] = value;
      }
    }
  }

  const results: Result[] = [];

  async function probe(service: string, base: string, sub: string) {
    const url = `${base}${sub.replace('{id}', profileId)}`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
      const text = await response.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* non-JSON is itself interesting */
      }

      // The service's own not-found shape: a string errorCode plus the root it
      // recognised. Anything else means the path went somewhere.
      const serviceMiss =
        parsed?.['errorCode'] === 'UnspecifiedError' && typeof parsed?.['resource'] === 'string';
      const gatewayMiss = parsed?.['errorCode'] === 1003;
      // Kong sits in front of the title services and has its own miss shape.
      // The last run classified these as hits, which they are not — they mean
      // the service root itself is not routed.
      const kongMiss = parsed?.['message'] === 'no Route matched with those values';
      const miss = serviceMiss || gatewayMiss || kongMiss;

      results.push({
        service,
        path: sub,
        status: response.status,
        verdict: serviceMiss
          ? 'UNMATCHED'
          : gatewayMiss
            ? 'GATEWAY-404'
            : kongMiss
              ? 'NO-ROUTE'
              : 'HIT',
        ...(miss ? {} : { body: mask(text).slice(0, 300) }),
      });
    } catch (error) {
      results.push({ service, path: sub, status: null, verdict: 'ERROR', body: String(error).slice(0, 100) });
    }
  }

  // heroranking answered with resource ".../heroranking/public" — so its
  // route root is /public, and the "/v1/" in the configured URL is part of the
  // remainder it could not match. Probe both: under the configured base, and
  // under the root the service itself names.
  const bases: Array<[string, string]> = [];
  for (const [service, base] of Object.entries(services)) {
    // Only the services that could plausibly carry ranked data, to stay inside
    // the function's time budget.
    if (!/ranking|leaderboard|skillrating|playerstats/.test(service)) continue;
    bases.push([service, base]);
    const stripped = base.replace(/v\d\/$/, '');
    if (stripped !== base) bases.push([`${service} (no version)`, stripped]);
  }

  for (const [service, base] of bases) {
    for (let i = 0; i < CANDIDATES.length; i += 12) {
      await Promise.all(CANDIDATES.slice(i, i + 12).map((sub) => probe(service, base, sub)));
    }
  }

  const hits = results.filter((r) => r.verdict === 'HIT' || r.verdict === 'ERROR');
  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      profileIdResolved: Boolean(profileId),
      servicesFound: Object.keys(services).length,
      tried: results.length,
      unmatched: results.filter((r) => r.verdict === 'UNMATCHED').length,
      gateway404: results.filter((r) => r.verdict === 'GATEWAY-404').length,
      noRoute: results.filter((r) => r.verdict === 'NO-ROUTE').length,
      servicesProbed: [...new Set(results.map((r) => r.service))],
      // Only the interesting ones are listed; the rest are counted above.
      hits,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
