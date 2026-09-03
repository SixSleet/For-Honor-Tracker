import 'server-only';
import { env } from './env';

interface Entry<T> {
  value: T;
  expiresAt: number;
  storedAt: number;
}

/**
 * Process-local TTL cache with a hard size cap.
 *
 * Serverless instances are ephemeral and not shared, so this is a best-effort
 * shield against repeated identical lookups rather than a durable store. That
 * is deliberate: it keeps the project free to run with no database. Swap in
 * Redis behind this same interface if you ever need cross-instance caching.
 *
 * Only public player data is cached here. Session tickets are held separately
 * by the Ubisoft provider and are never written to this cache.
 */
class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  private readonly maxEntries = 500;

  get<T>(key: string): { value: T; storedAt: number } | null {
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    // Refresh recency for the LRU eviction below.
    this.store.delete(key);
    this.store.set(key, entry);
    return { value: entry.value, storedAt: entry.storedAt };
  }

  set<T>(key: string, value: T, ttlMs = env.cacheTtlMs): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    const now = Date.now();
    this.store.set(key, { value, expiresAt: now + ttlMs, storedAt: now });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

export const cache = new TtlCache();

export function cacheKey(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).toLowerCase()).join(':');
}
