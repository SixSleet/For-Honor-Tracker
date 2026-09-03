/** Server-only configuration. Never import this from a client component. */

import 'server-only';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  steamApiKey: process.env.STEAM_API_KEY?.trim() || null,

  ubisoft: {
    enabled: bool(process.env.UBISOFT_ENABLED, false),
    email: process.env.UBISOFT_EMAIL?.trim() || null,
    password: process.env.UBISOFT_PASSWORD || null,
    appId: process.env.UBISOFT_APP_ID?.trim() || 'f35adcb5-1911-440c-b1c9-48fdc1701c68',
    forHonorSpaceId: process.env.UBISOFT_FORHONOR_SPACE_ID?.trim() || null,
    // A session ticket captured from a real, already-authenticated Ubisoft
    // Connect browser session. This is how the API is reached without the
    // server performing a login: the official client passed the bot check, we
    // reuse the token it holds. Tickets are short-lived (~2-4h), so this is
    // primarily for verification and single-operator use.
    ticket: process.env.UBISOFT_TICKET?.trim() || null,
    sessionId: process.env.UBISOFT_SESSION_ID?.trim() || null,
  },

  // On by default, including in production: the site header links to
  // /diagnostics, and every retained body passes through the redactor before
  // it is returned. Set DIAGNOSTICS_ENABLED=false to hide it.
  diagnosticsEnabled: bool(process.env.DIAGNOSTICS_ENABLED, true),
  diagnosticsToken: process.env.DIAGNOSTICS_TOKEN?.trim() || null,

  cacheTtlMs: int(process.env.CACHE_TTL_SECONDS, 600) * 1000,
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 20),

  // Shared session store for the Ubisoft provider, in preference order:
  // Supabase (secret-gated RPC), then Upstash Redis, then per-instance memory.
  supabase: {
    url: process.env.SUPABASE_URL?.trim() || null,
    anonKey: process.env.SUPABASE_ANON_KEY?.trim() || null,
    storeSecret: process.env.SESSION_STORE_SECRET?.trim() || null,
  },
  upstash: {
    url: process.env.UPSTASH_REDIS_REST_URL?.trim() || null,
    token: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || null,
  },

  // Secret Vercel Cron presents (Authorization: Bearer <CRON_SECRET>) when it
  // calls the scheduled refresh. Also accepted for a manual refresh trigger.
  cronSecret: process.env.CRON_SECRET?.trim() || null,

  // Optional webhook (Discord/Slack-compatible) pinged only when the session
  // cannot renew and a re-seed is genuinely needed. Silence means healthy.
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL?.trim() || null,
} as const;

/**
 * True when the Ubisoft provider has any way to obtain a session:
 *   - a captured ticket in the env, or
 *   - a shared session store (Upstash) that a seeded session can live in, or
 *   - account credentials to attempt a login with.
 *
 * The store case is what supports the zero-login-for-visitors model: the
 * provider is "enabled" because a seeded session may be present; if none has
 * been seeded yet, the lookup returns an actionable "seed a session" message.
 */
export function ubisoftConfigured(): boolean {
  if (!env.ubisoft.enabled) return false;
  if (env.ubisoft.ticket) return true;
  if (env.supabase.url && env.supabase.anonKey && env.supabase.storeSecret) return true;
  if (env.upstash.url && env.upstash.token) return true;
  return Boolean(env.ubisoft.email) && Boolean(env.ubisoft.password);
}
