import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { notifyOperator } from '@/server/alert';
import { env } from '@/server/env';
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
 * enough, so the schedule that actually keeps the session alive is an external
 * hourly pinger. Two callers, therefore, and two ways to authorize:
 *
 *   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 *   - An external pinger fetches a plain URL, so it sends `?token=<secret>`.
 *
 * The query form deliberately accepts CRON_SECRET as well as DIAGNOSTICS_TOKEN.
 * A URL handed to a third-party scheduler lives in that service's settings and
 * its request logs, so it should carry the least dangerous secret that will do
 * the job: CRON_SECRET authorizes nothing but this idempotent refresh, whereas
 * DIAGNOSTICS_TOKEN also authorizes seeding and clearing the session. Use
 * CRON_SECRET for anything long-lived; the diagnostics token stays accepted
 * only for a one-off manual run.
 *
 * The operator is pinged (if ALERT_WEBHOOK_URL is set) ONLY when a re-seed is
 * genuinely required. A healthy run is silent.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const queryToken = new URL(request.url).searchParams.get('token');
  const authorized =
    secretOk(bearer(authHeader), env.cronSecret) ||
    secretOk(queryToken, env.cronSecret) ||
    secretOk(queryToken, env.diagnosticsToken);

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
