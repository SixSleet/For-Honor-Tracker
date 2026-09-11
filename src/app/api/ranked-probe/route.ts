/**
 * Leaderboard hunt with the game client's own identifiers.
 *
 * Not for main. The game shows Season 0 leaderboards full of data, so a
 * serving endpoint exists; the earlier "no endpoint found" described the
 * search, not Ubisoft. The one thing every prior probe withheld is exactly
 * what distinguishes the game client's request from ours: the
 * application_build_id and sandbox_name the client presents, both of which are
 * in the public fh-configuration this project already reads.
 *
 * The operator authorized adding those two identifiers for this probe. The
 * line still held: NO herologin / EOS / EasyAntiCheat handshake is attempted,
 * and no anti-cheat token is forged. This reuses two configuration strings as
 * request headers alongside the ordinary session ticket — nothing more.
 *
 * Combined with the still-open method question: the Kong gateway routes on
 * method as well as path, so each target is tried as GET and POST, and
 * route-describing response headers (Allow, Access-Control-Allow-Methods) are
 * captured.
 *
 * Output is schema only: statuses, route-describing headers, and error text
 * with ids masked. The log is public.
 */
import { NextResponse } from 'next/server';
import { verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { FOR_HONOR_SPACE_IDS } from '@/server/providers/forhonor-ubisoft-stats';
import { __internal } from '@/server/providers/ubisoft';
import { readSession } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 240;

const PROBE_AUDIENCE = 'for-honor-tracker-ranked-probe';
const { login, authHeaders, forceRefresh, UBI_SERVICES } = __internal;

const ROUTE_HEADERS = ['allow', 'access-control-allow-methods', 'www-authenticate', 'server'];

interface Row {
  target: string;
  method: string;
  withClientIds: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

// The session account is a uplay/PC account, so the PC build id and sandbox
// are the ones that match its ticket in both spaces.
const PLATFORM = 'pc';

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
  const baseHeaders = authHeaders(session);
  const mask = (t: string) => (profileId ? t.split(profileId).join('{id}') : t);

  const rows: Row[] = [];

  for (const spaceId of FOR_HONOR_SPACE_IDS) {
    const short = spaceId.slice(0, 8);

    const r = await fetch(`${UBI_SERVICES}/v1/spaces/${spaceId}/parameters`, {
      headers: baseHeaders,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) continue;
    const body = (await r.json()) as Record<string, unknown>;
    const inner = ((body['parameters'] ?? body) as Record<string, unknown>) ?? {};
    const config = (((inner['fh-configuration'] as Record<string, unknown>)?.['fields'] ??
      {}) as Record<string, string>);

    const plat = PLATFORM;
    const buildId = config[`application_build_id_${plat}`] ?? '';
    const sandbox = config[`sandbox_name_${plat}`] ?? '';

    // The identifiers under the header names Ubisoft title services use for
    // them. Unrecognised headers are ignored, so sending several is harmless.
    const clientHeaders: Record<string, string> = {
      ...baseHeaders,
      'Ubi-AppBuildId': buildId,
      'Ubi-SandboxId': sandbox,
      'Ubi-RequestedPlatformType': plat === 'pc' ? 'uplay' : plat,
    };

    // The ranked-relevant service roots this space advertises.
    const bases: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(config)) {
      if (/(leaderboard|ranking|skillrating)_public_v\d$/.test(key) && value?.startsWith('https://')) {
        bases.push([key, value]);
      }
    }

    async function probe(label: string, url: string, method: string, withIds: boolean) {
      try {
        const response = await fetch(url, {
          method,
          headers: withIds ? clientHeaders : baseHeaders,
          ...(method === 'POST' ? { body: '{}' } : {}),
          signal: AbortSignal.timeout(12_000),
        });
        const text = await response.text();
        const picked: Record<string, string> = {};
        for (const name of ROUTE_HEADERS) {
          const value = response.headers.get(name);
          if (value) picked[name] = value.slice(0, 160);
        }
        rows.push({
          target: `${short}/${label}`,
          method,
          withClientIds: withIds,
          status: response.status,
          ...(Object.keys(picked).length ? { headers: picked } : {}),
          ...(/no Route matched|UnspecifiedError|"errorCode":1003/.test(text)
            ? {}
            : { body: mask(text).slice(0, 300) }),
        });
      } catch (error) {
        rows.push({
          target: `${short}/${label}`,
          method,
          withClientIds: withIds,
          status: 0,
          body: String(error).slice(0, 90),
        });
      }
    }

    for (const [key, base] of bases) {
      for (const suffix of ['', 'leaderboards', `profiles/${profileId}`]) {
        const url = `${base}${suffix}`;
        const label = `${key}${suffix ? '/' + suffix.replace(profileId, '{id}') : ''}`;
        // Each target four ways: {GET,POST} x {plain ticket, ticket+client ids}.
        await probe(label, url, 'GET', false);
        await probe(label, url, 'GET', true);
        await probe(label, url, 'POST', true);
      }
    }
  }

  return NextResponse.json(
    {
      ok: true,
      at: new Date().toISOString(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      tried: rows.length,
      // Everything that is not one of the three known miss shapes, plus any
      // row that carried a route-describing header.
      interesting: rows.filter((r) => r.body || r.headers),
      plainMisses: rows.filter((r) => !r.body && !r.headers).length,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
