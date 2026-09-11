/**
 * Leaderboard hunt, take two: methods and headers, not more path guesses.
 *
 * Not for main. The user reports the game itself now shows Season 0
 * leaderboards full of data, so a serving endpoint exists and the previous
 * conclusion — "no endpoint found" — was a statement about the search, not
 * about Ubisoft. Two blind spots in that search are worth more than another
 * list of guessed paths:
 *
 * 1. Every probe so far was a GET. Kong sits in front of the title services
 *    and matches routes on method as well as path — its error says "no Route
 *    matched with those values", and the method is one of those values. A
 *    route that only accepts POST would answer a GET the same way a missing
 *    route does. Leaderboard and query services commonly take POST with a
 *    body, and this project has already seen one Ubisoft route mention "a
 *    property in the request body".
 *
 * 2. No response headers were ever read. A 405 carries `Allow`, a CORS
 *    preflight carries `Access-Control-Allow-Methods`, and either one names
 *    the verbs a route accepts without any guessing.
 *
 * So: OPTIONS and POST against the service roots and a few collection paths,
 * capturing headers throughout. A POST that answers "missing required
 * property" would describe the contract directly.
 *
 * Still the ordinary session ticket and nothing else — the build id and
 * sandbox name sit in the same configuration and are deliberately not sent.
 *
 * Output is schema only: statuses, route-describing header values, and error
 * text with ids masked. The log is public.
 */
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

/** Headers that describe a route rather than an individual response. */
const INTERESTING_HEADERS = [
  'allow',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'x-kong-route-id',
  'server',
  'www-authenticate',
];

interface Row {
  target: string;
  method: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

export async function GET(request: Request) {
  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const verdict = await verifyGithubActionsToken(presented, { audience: PROBE_AUDIENCE });
  if (!verdict.ok) return NextResponse.json({ ok: false, reason: verdict.reason }, { status: 401 });

  const trace = newTraceCollector();
  if (!(await readSession())) {
    return NextResponse.json({ ok: false, reason: 'No session here.' }, { status: 503 });
  }
  await forceRefresh(trace);
  const session = await login(trace);
  const profileId = session.profileId || (await readSession())?.profileId || '';
  const headers = authHeaders(session);
  const mask = (t: string) => (profileId ? t.split(profileId).join('{id}') : t);

  // Service roots from each space's own configuration.
  const bases: Array<[string, string]> = [];
  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const r = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) continue;
    const body = (await r.json()) as Record<string, unknown>;
    const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
    const config = (((inner['fh-configuration'] as Record<string, unknown>)?.['fields'] ??
      {}) as Record<string, string>);
    for (const [key, value] of Object.entries(config)) {
      if (/(leaderboard|ranking|skillrating)_public_v\d$/.test(key) && value?.startsWith('https://')) {
        bases.push([`${spaceId.slice(0, 8)}/${key}`, value]);
      }
    }
    // The SDK's own space leaderboard route, which answered a gateway 404 to GET.
    bases.push([
      `${spaceId.slice(0, 8)}/sdkSpacesLeaderboard`,
      `${UBI_SERVICES}/v1/spaces/${spaceId}/leaderboards/`,
    ]);
  }

  const rows: Row[] = [];

  async function probe(label: string, url: string, method: string, body?: string) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(12_000),
      });
      const text = await response.text();
      const picked: Record<string, string> = {};
      for (const name of INTERESTING_HEADERS) {
        const value = response.headers.get(name);
        if (value) picked[name] = value.slice(0, 160);
      }
      rows.push({
        target: label,
        method,
        status: response.status,
        ...(Object.keys(picked).length ? { headers: picked } : {}),
        // Only when the answer is not one of the three known miss shapes.
        ...(/no Route matched|UnspecifiedError|"errorCode":1003/.test(text)
          ? {}
          : { body: mask(text).slice(0, 300) }),
      });
    } catch (error) {
      rows.push({ target: label, method, status: 0, body: String(error).slice(0, 90) });
    }
  }

  for (const [label, base] of bases) {
    for (const suffix of ['', 'leaderboards', 'ranks']) {
      const url = `${base}${suffix}`;
      const name = `${label}${suffix ? '/' + suffix : ''}`;
      await probe(name, url, 'OPTIONS');
      await probe(name, url, 'POST', '{}');
    }
  }

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      basesProbed: bases.length,
      // Everything that is not one of the three known miss shapes, plus every
      // row that carried a route-describing header.
      interesting: rows.filter((r) => r.body || r.headers),
      plainMisses: rows.filter((r) => !r.body && !r.headers).length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
