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

/**
 * Endpoints from Ubisoft's own URL catalogue worth calling for a For Honor
 * tracker. The catalogue stores a URL TEMPLATE for each, so these need no
 * guessing at all — which is the point, after 594 guessed title-service paths
 * returned exactly zero hits.
 *
 * profilesReputation and profilesProgressionGraph are the interesting pair:
 * both were invisible to the earlier passes because neither name contains
 * "rank", "season" or "leaderboard".
 */
const WANTED = [
  'profilesReputation',
  'profilesProgressionGraph',
  'profilesMeLeaderboard',
  'profilesLeaderboard',
  'spacesLeaderboard',
  'profilesSeasonChallenges',
  'spacesSeasonChallenges',
  'profilesChallenges',
  'profilesMeBattlepassesSeasons',
  'spacesBattlepassesSeasons',
  'profilesStats',
  'allProfilesStats',
  'spacesStats',
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

  // Read the URL templates rather than guessing paths.
  const templates: Record<string, string> = {};
  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const response = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) continue;
    const body = (await response.json()) as Record<string, unknown>;
    const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
    const urls = ((inner['us-sdkClientUrls'] as Record<string, unknown>)?.['fields'] ??
      {}) as Record<string, string>;
    for (const name of WANTED) {
      if (typeof urls[name] === 'string') templates[`${spaceId.slice(0, 8)}/${name}`] = urls[name];
    }
  }

  async function call(label: string, template: string, version: string) {
    // Fill in what we know. Anything still in braces is reported unresolved
    // rather than guessed at.
    // {baseurl_aws} and {version} are resolved, not guessed: the catalogue
    // gives allProfilesStats as {baseurl_aws}/{version}/profiles/stats, and
    // this project already calls that endpoint successfully as
    // https://public-ubiservices.ubi.com/v1/profiles/stats. So the host is
    // UBI_SERVICES and the version is the ordinary v1/v2/v3 ladder.
    const url = template
      .replace(/\{baseurl_aws\}/g, UBI_SERVICES)
      .replace(/\{version\}/g, version)
      .replace(/\{spaceId\}/g, label.startsWith('882ad5b5') ? FOR_HONOR_SPACE_IDS[0]! : FOR_HONOR_SPACE_IDS[1]!)
      .replace(/\{profileId\}/g, profileId)
      .replace(/\{profileIds\}/g, profileId)
      .replace(/\{userId\}/g, profileId);

    if (/\{[^}]+\}/.test(url)) {
      results.push({
        service: label,
        path: template,
        status: null,
        verdict: 'ERROR',
        body: `unresolved placeholder: ${url.match(/\{[^}]+\}/g)?.join(',')}`,
      });
      return;
    }

    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
      const text = await response.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* non-JSON is itself interesting */
      }
      const gatewayMiss = parsed?.['errorCode'] === 1003;
      results.push({
        service: label,
        path: mask(template),
        status: response.status,
        verdict: gatewayMiss ? 'GATEWAY-404' : 'HIT',
        // Response KEYS only, never values — this log is public and these
        // endpoints may return real player data.
        body: parsed
          ? `keys: ${Object.keys(parsed).join(',')}`
          : mask(text).slice(0, 200),
      });
    } catch (error) {
      results.push({ service: label, path: template, status: null, verdict: 'ERROR', body: String(error).slice(0, 100) });
    }
  }

  // Try the version ladder; a 404 on v1 is not the same as the route not
  // existing, as this project already learned with applications v2 -> v3.
  for (const [label, template] of Object.entries(templates)) {
    for (const version of ['v1', 'v2', 'v3']) {
      await call(`${label} ${version}`, template, version);
    }
  }

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      profileIdResolved: Boolean(profileId),
      templatesFound: Object.keys(templates).length,
      tried: results.length,
      gateway404: results.filter((r) => r.verdict === 'GATEWAY-404').length,
      // Anything that is NOT the gateway's plain "no such resource" — those
      // are the ones that went somewhere.
      interesting: results.filter((r) => r.verdict !== 'GATEWAY-404'),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
