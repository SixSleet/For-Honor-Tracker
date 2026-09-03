import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { checkRateLimit, clientKeyFrom } from '@/server/rate-limit';
import { searchPlayer } from '@/server/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time check of the operator token; false whenever none is set. */
function operatorTokenOk(candidate: string | null): boolean {
  if (!env.diagnosticsToken || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.diagnosticsToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const limit = checkRateLimit(clientKeyFrom(request.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        ok: false,
        code: 'RATE_LIMITED',
        message: 'Too many searches from this connection. Please wait a moment and try again.',
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('username');
  const refresh = url.searchParams.get('refresh') === '1';
  // Diagnostics carry the upstream bodies behind a lookup, which include the
  // searched player's handle on every platform their account links — the one
  // thing the report itself deliberately withholds. This is the public player
  // API, so it takes the operator token like every other diagnostic surface,
  // and fails closed when no token is configured.
  const includeDiagnostics =
    url.searchParams.get('diagnostics') === '1' &&
    env.diagnosticsEnabled &&
    operatorTokenOk(url.searchParams.get('token'));

  try {
    const result = await searchPlayer(query ?? '', { refresh, includeDiagnostics });
    const status = result.ok
      ? 200
      : result.code === 'INVALID_USERNAME'
        ? 400
        : result.code === 'PLAYER_NOT_FOUND'
          ? 404
          : result.code === 'PROVIDER_UNAVAILABLE'
            ? 503
            : 500;
    return NextResponse.json(result, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-RateLimit-Remaining': String(limit.remaining) },
    });
  } catch {
    // Never leak an internal stack or upstream detail to the client.
    return NextResponse.json(
      {
        ok: false,
        code: 'INTERNAL',
        message: 'Something went wrong on our side. Please try again.',
      },
      { status: 500 },
    );
  }
}
