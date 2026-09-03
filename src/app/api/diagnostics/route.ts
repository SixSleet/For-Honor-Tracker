import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { checkRateLimit, clientKeyFrom } from '@/server/rate-limit';
import { allProviders } from '@/server/providers/registry';
import { searchPlayer } from '@/server/search';
import { readSession, storeBackend } from '@/server/ubisoft-session-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Development / operator diagnostics. Returns the exact upstream calls made
 * for a search, with every response body passed through the redactor first.
 */
/** Constant-time check of the operator token; false whenever none is set. */
function operatorTokenOk(candidate: string | null): boolean {
  if (!env.diagnosticsToken || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.diagnosticsToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!env.diagnosticsEnabled) {
    return NextResponse.json(
      { ok: false, code: 'DISABLED', message: 'Diagnostics are disabled on this deployment.' },
      { status: 404 },
    );
  }

  // Fails closed. This previously skipped the check whenever no token was
  // configured, which left the route wide open on any deployment that enabled
  // diagnostics — the default — without setting one. The comparison is
  // constant-time, matching the other operator routes.
  const url = new URL(request.url);
  if (!operatorTokenOk(url.searchParams.get('token'))) {
    return NextResponse.json(
      { ok: false, code: 'FORBIDDEN', message: 'A valid diagnostics token is required.' },
      { status: 403 },
    );
  }

  const limit = checkRateLimit(`diag:${clientKeyFrom(request.headers)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: 'Slow down.' },
      { status: 429 },
    );
  }

  const providers = allProviders().map((provider) => ({
    ...provider.info,
    enabled: provider.isEnabled(),
    disabledReason: provider.disabledReason(),
  }));

  const storedSession = await readSession();

  const username = url.searchParams.get('username');
  const result = username
    ? await searchPlayer(username, { refresh: true, includeDiagnostics: true })
    : null;

  return NextResponse.json(
    {
      ok: true,
      generatedAt: new Date().toISOString(),
      environment: {
        // Which environment's variables this instance actually received.
        // Vercel scopes them per environment, so a Preview deployment sees
        // nothing that was saved for Production only — worth surfacing, since
        // the symptom is otherwise just a provider that stays mysteriously off.
        vercelEnv: process.env.VERCEL_ENV ?? 'local',
        vercelBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
        diagnosticsEnabled: env.diagnosticsEnabled,
        diagnosticsTokenConfigured: Boolean(env.diagnosticsToken),
        cacheTtlSeconds: env.cacheTtlMs / 1000,
        rateLimitPerMinute: env.rateLimitPerMinute,
        steamApiKeyConfigured: Boolean(env.steamApiKey),
        ubisoftEnabled: env.ubisoft.enabled,
        ubisoftEmailConfigured: Boolean(env.ubisoft.email),
        ubisoftPasswordConfigured: Boolean(env.ubisoft.password),
        ubisoftTicketConfigured: Boolean(env.ubisoft.ticket),
        sessionStore: storeBackend(),
        ubisoftSessionPresent: Boolean(storedSession),
        ubisoftSessionExpiresInSeconds: storedSession
          ? Math.round((storedSession.expiresAt - Date.now()) / 1000)
          : null,
        ubisoftSessionCanAutoRenew: Boolean(storedSession?.rememberMeTicket),
      },
      providers,
      query: username,
      result,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
