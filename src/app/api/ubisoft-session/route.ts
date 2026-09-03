import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { checkRateLimit, clientKeyFrom } from '@/server/rate-limit';
import {
  clearSession,
  readSession,
  storeBackend,
  writeSession,
} from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Length-independent comparison, so the token cannot be guessed by timing. */
function tokenOk(candidate: string | null): boolean {
  if (!env.diagnosticsToken || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.diagnosticsToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Seeds and inspects the shared Ubisoft session that the whole site runs on.
 *
 * This is the operator-only setup step behind the zero-login-for-visitors
 * model. A session is captured once, from a real logged-in Ubisoft session on
 * a normal connection (the login script does this and can POST straight here),
 * and every visitor lookup then reuses it. The server renews it via
 * remember-me, so this typically only ever runs once.
 *
 * GET  — report whether a session is present and how long it has left. Never
 *        returns the ticket itself.
 * POST — store a session { ticket, sessionId, rememberMeTicket, expiration }.
 * DELETE — clear it.
 *
 * All three require the DIAGNOSTICS_TOKEN shared secret.
 */
export async function GET(request: Request) {
  if (!tokenOk(new URL(request.url).searchParams.get('token'))) {
    return NextResponse.json({ ok: false, message: 'A valid token is required.' }, { status: 403 });
  }

  const session = await readSession();
  return NextResponse.json(
    {
      ok: true,
      backend: storeBackend(),
      present: Boolean(session),
      // Booleans and timings only — never the secret material.
      hasRememberMeTicket: Boolean(session?.rememberMeTicket),
      expiresInSeconds: session ? Math.round((session.expiresAt - Date.now()) / 1000) : null,
      updatedAt: session ? new Date(session.updatedAt).toISOString() : null,
      note:
        storeBackend() === 'memory'
          ? 'No shared store configured. A seeded session survives only on this one instance and is lost on restart. Set UPSTASH_REDIS_REST_URL / _TOKEN for a durable, multi-instance session.'
          : undefined,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: Request) {
  if (!tokenOk(new URL(request.url).searchParams.get('token'))) {
    return NextResponse.json({ ok: false, message: 'A valid token is required.' }, { status: 403 });
  }

  const limit = checkRateLimit(`ubiseed:${clientKeyFrom(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, message: 'Slow down.' }, { status: 429 });
  }

  let payload: {
    ticket?: string;
    sessionId?: string;
    profileId?: string;
    rememberMeTicket?: string;
    expiration?: string;
    expiresInSeconds?: number;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Body must be JSON.' }, { status: 400 });
  }

  if (!payload.ticket) {
    return NextResponse.json(
      { ok: false, message: 'A "ticket" field is required.' },
      { status: 400 },
    );
  }

  const expiresAt = payload.expiration
    ? Date.parse(payload.expiration)
    : payload.expiresInSeconds
      ? Date.now() + payload.expiresInSeconds * 1000
      : Date.now() + 2 * 3600_000;

  await writeSession({
    ticket: payload.ticket,
    sessionId: payload.sessionId ?? '',
    profileId: payload.profileId ?? '',
    rememberMeTicket: payload.rememberMeTicket ?? null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 2 * 3600_000,
    updatedAt: Date.now(),
  });

  return NextResponse.json(
    {
      ok: true,
      backend: storeBackend(),
      hasRememberMeTicket: Boolean(payload.rememberMeTicket),
      message:
        'Session seeded. It renews itself by sliding the ticket forward before each expiry — no remember-me needed — so visitors need no login.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE(request: Request) {
  if (!tokenOk(new URL(request.url).searchParams.get('token'))) {
    return NextResponse.json({ ok: false, message: 'A valid token is required.' }, { status: 403 });
  }
  await clearSession();
  return NextResponse.json({ ok: true, message: 'Session cleared.' });
}
