import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { notifyOperator } from '@/server/alert';
import { env } from '@/server/env';
import { REFRESH_AUDIENCE, verifyGithubActionsToken } from '@/server/github-oidc';
import { newTraceCollector } from '@/server/http';
import { __internal } from '@/server/providers/ubisoft';
import { storeBackend } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const { forceRefresh } = __internal;

/** Constant-time compare that does not leak the expected value's length. */
function secretOk(candidate: string | null, expected: string | null): boolean {
  if (!expected || candidate === null) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function bearer(header: string | null): string | null {
  if (!header) return null;
  return header.replace(/^Bearer\s+/i, '');
}

/**
 * Scheduled maintenance for the shared Ubisoft session — the piece that lets a
 * once-seeded session keep serving everyone with no login and no periodic
 * hand-holding.
 *
 * Each run slides the session forward and writes it back to the shared store.
 * The ticket Ubisoft issues lasts about two hours, so this has to run more
 * often than that or the session lapses and the site falls back to Steam data
 * until someone re-seeds by hand. That is exactly how it went down once.
 *
 * Vercel Cron on the Hobby plan will only run this daily, which is not often
 * enough, so the schedule that actually keeps the session alive is the GitHub
 * Actions workflow in .github/workflows/. Three ways to authorize, therefore:
 *
 *   - A GitHub Actions OIDC token, signed by GitHub and naming the repository
 *     the run belongs to. This is the one the every-30-minutes schedule uses,
 *     and it needs nothing configured on either side: no secret is generated,
 *     copied, pasted or rotated, so there is nothing to set up wrong and
 *     nothing to expire. See github-oidc.ts.
 *   - `Authorization: Bearer <CRON_SECRET>`, which is what Vercel Cron sends.
 *   - `?token=<CRON_SECRET>` or `?token=<DIAGNOSTICS_TOKEN>`, for an external
 *     pinger or a one-off manual run. Prefer CRON_SECRET for anything
 *     long-lived: a URL handed to a third-party scheduler lives in that
 *     service's settings and its request logs, and CRON_SECRET authorizes
 *     nothing but this idempotent refresh, whereas DIAGNOSTICS_TOKEN also
 *     authorizes seeding and clearing the session.
 *
 * Every one of these is optional. If none is configured the route simply
 * refuses everything, which is the right failure: it is better for the refresh
 * to stop than for anyone passing by to be able to drive it, since each call
 * spends a real request against Ubisoft on the operator's own account.
 *
 * The operator is pinged (if ALERT_WEBHOOK_URL is set) ONLY when a re-seed is
 * genuinely required. A healthy run is silent.
 */
export async function GET(request: Request) {
  const presented = bearer(request.headers.get('authorization'));
  const queryToken = new URL(request.url).searchParams.get('token');

  let authorized =
    secretOk(presented, env.cronSecret) ||
    secretOk(queryToken, env.cronSecret) ||
    secretOk(queryToken, env.diagnosticsToken);

  // A JWT is the GitHub Actions case. Only try that reading when the token
  // actually looks like one, so an ordinary wrong secret is still rejected
  // immediately rather than costing a round trip to GitHub.
  if (!authorized && presented && presented.split('.').length === 3) {
    const verdict = await verifyGithubActionsToken(presented, { audience: REFRESH_AUDIENCE });
    authorized = verdict.ok;
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, message: 'Unauthorized.' }, { status: 401 });
  }

  const trace = newTraceCollector();
  const outcome = await forceRefresh(trace);

  if (!outcome.ok && outcome.needsReseed) {
    await notifyOperator(
      `Ubisoft session needs re-seeding: ${outcome.reason} Run the seed script again — the site is serving Steam data in the meantime.`,
    );
  }

  return NextResponse.json(
    { at: new Date().toISOString(), backend: storeBackend(), ...outcome },
    { status: outcome.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
