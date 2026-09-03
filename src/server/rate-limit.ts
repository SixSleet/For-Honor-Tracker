import 'server-only';
import { env } from './env';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED = 5000;

/**
 * Fixed-window per-client limiter. Process-local, like the cache — enough to
 * stop one client hammering upstream APIs from a single instance, which is the
 * abuse this project can actually cause. Not a defence against a distributed
 * flood; Vercel's platform limits sit in front of that.
 */
export function checkRateLimit(clientKey: string): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  const limit = env.rateLimitPerMinute;
  const now = Date.now();
  const existing = windows.get(clientKey);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED) windows.clear();
    windows.set(clientKey, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 60 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
}

/** Derives a client key from proxy headers, falling back to a shared bucket. */
export function clientKeyFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}
