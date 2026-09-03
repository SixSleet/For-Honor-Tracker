import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/server/env';
import { checkRateLimit, clientKeyFrom } from '@/server/rate-limit';
import { allProviders } from '@/server/providers/registry';
import { newTraceCollector } from '@/server/http';
import { ubisoftProvider, __internal as ubisoftInternal } from '@/server/providers/ubisoft';
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

  // Optional stat-name probe. Ubisoft's stats endpoint returns a fixed default
  // set, but also honours an explicit statNames list, so a stat it knows and
  // does not return by default can only be found by asking for it. Off unless
  // asked for, one profile at a time, and read-only.
  const probeNames = (url.searchParams.get('probeStats') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 60);
  let statProbe: unknown = null;
  if (username && probeNames.length > 0) {
    const probeTrace = newTraceCollector();
    try {
      const identity = await ubisoftProvider.getPlayerByUsername(username, probeTrace);
      statProbe = identity
        ? {
            profileId: identity.id,
            requested: probeNames,
            spaces: await ubisoftInternal.probeStatNames(identity.id, probeNames, probeTrace),
          }
        : { error: 'No Ubisoft profile matched that username.' };
    } catch (error) {
      statProbe = { error: error instanceof Error ? error.message : String(error) };
    }
    // Surface the probe's own requests. Without them a rejected request — too
    // many names in one query, say — is indistinguishable from every name
    // being absent, which is the one mistake a probe must not invite.
    statProbe = {
      ...(statProbe as Record<string, unknown>),
      requests: probeTrace.traces.map((entry) => ({
        label: entry.label,
        status: entry.status,
        ok: entry.ok,
        error: entry.error ?? null,
        responseSnippet: entry.responseSnippet?.slice(0, 400) ?? '',
      })),
    };
  }

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
      statProbe,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
