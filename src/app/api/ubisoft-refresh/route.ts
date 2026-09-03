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

function bearerOk(header: string | null, expected: string): boolean {
  const token = header?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * Scheduled maintenance for the shared Ubisoft session — the piece that lets a
 * once-seeded session keep serving everyone with no login and no periodic
 * hand-holding.
 *
 * Vercel Cron calls this on a schedule (it presents Authorization: Bearer
 * CRON_SECRET). Each run renews the session via remember-me, extending its
 * life, and writes it back to the shared store. On-request renewal already
 * covers the short 2-hour ticket; this proactive pass keeps the long-lived
 * remember-me ticket exercised so it does not lapse from disuse, and catches
 * trouble early.
 *
 * The operator is pinged (if ALERT_WEBHOOK_URL is set) ONLY when a re-seed is
 * genuinely required. A healthy run is silent.
 */
export async function GET(request: Request) {
  // Accept the Vercel Cron secret, or the diagnostics token for a manual run.
  const authHeader = request.headers.get('authorization');
  const queryToken = new URL(request.url).searchParams.get('token');
  const authorized =
    (env.cronSecret && bearerOk(authHeader, env.cronSecret)) ||
    (env.diagnosticsToken &&
      queryToken !== null &&
      queryToken.length === env.diagnosticsToken.length &&
      timingSafeEqual(Buffer.from(queryToken), Buffer.from(env.diagnosticsToken)));

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
