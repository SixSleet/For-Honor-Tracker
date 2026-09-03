import 'server-only';
import { env } from './env';

/**
 * Where the shared Ubisoft session lives.
 *
 * A public tracker runs across many short-lived serverless instances, so the
 * session cannot live in a module variable — every cold start would be logged
 * out, and the login is exactly the step that is bot-walled. It is stored once
 * and shared by every instance instead.
 *
 * Two backends, chosen automatically:
 *   - Upstash Redis over its REST API when UPSTASH_REDIS_REST_URL /
 *     _TOKEN are set. Free tier, no extra dependency (plain fetch). This is
 *     what makes the session survive across instances and restarts.
 *   - An in-memory fallback otherwise, so local development works with no
 *     setup. It does not survive a restart, which is fine for one machine.
 *
 * The stored value is a session the operator seeded and the server refreshes.
 * It never contains an account password — only the tickets Ubisoft issues.
 */

export interface StoredUbisoftSession {
  ticket: string;
  sessionId: string;
  profileId: string;
  /** Epoch millis the ticket stops being valid. */
  expiresAt: number;
  /** Ubisoft's remember-me ticket, used to mint a new ticket without a login. */
  rememberMeTicket: string | null;
  /** Epoch millis the session was last written. */
  updatedAt: number;
}

const KEY = 'ubisoft:session';

const supabaseConfigured = Boolean(
  env.supabase.url && env.supabase.anonKey && env.supabase.storeSecret,
);
const upstashConfigured = Boolean(env.upstash.url && env.upstash.token);

let memory: StoredUbisoftSession | null = null;

/**
 * Calls a secret-gated Postgres function over Supabase's REST (PostgREST) RPC.
 *
 * The session row lives in a private schema that the publishable/anon key
 * cannot touch directly; only these SECURITY DEFINER functions can, and only
 * when handed the store secret. So the anon key alone — even if it leaked —
 * cannot read or change the stored ticket.
 */
async function supabaseRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${env.supabase.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: env.supabase.anonKey as string,
      Authorization: `Bearer ${env.supabase.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_secret: env.supabase.storeSecret, ...args }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Supabase ${fn} failed: ${response.status}`);
  }
  // Void functions (write / clear) come back as 204 with no body; only the
  // read returns JSON. Parse only when there is something to parse.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function upstash(command: unknown[]): Promise<unknown> {
  const response = await fetch(env.upstash.url as string, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.upstash.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Upstash ${command[0]} failed: ${response.status}`);
  }
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(`Upstash error: ${body.error}`);
  return body.result;
}

export async function readSession(): Promise<StoredUbisoftSession | null> {
  if (supabaseConfigured) {
    try {
      const value = await supabaseRpc<StoredUbisoftSession | null>('fh_session_read', {});
      return value ?? null;
    } catch {
      return memory;
    }
  }
  if (upstashConfigured) {
    try {
      const raw = (await upstash(['GET', KEY])) as string | null;
      return raw ? (JSON.parse(raw) as StoredUbisoftSession) : null;
    } catch {
      return memory;
    }
  }
  return memory;
}

export async function writeSession(session: StoredUbisoftSession): Promise<void> {
  memory = session;
  if (supabaseConfigured) {
    try {
      await supabaseRpc('fh_session_write', { p_value: session });
    } catch {
      // Memory copy still holds; a later write will retry.
    }
    return;
  }
  if (upstashConfigured) {
    try {
      // Expire the Redis key a little after the ticket, so a dead session does
      // not linger and mislead. Refresh writes a new one well before then.
      const ttlSeconds = Math.max(60, Math.round((session.expiresAt - Date.now()) / 1000) + 3600);
      await upstash(['SET', KEY, JSON.stringify(session), 'EX', String(ttlSeconds)]);
    } catch {
      // Memory copy still holds; a later write will retry.
    }
  }
}

export async function clearSession(): Promise<void> {
  memory = null;
  if (supabaseConfigured) {
    try {
      await supabaseRpc('fh_session_clear', {});
    } catch {
      // Non-fatal.
    }
    return;
  }
  if (upstashConfigured) {
    try {
      await upstash(['DEL', KEY]);
    } catch {
      // Non-fatal.
    }
  }
}

export function storeBackend(): 'supabase' | 'upstash' | 'memory' {
  if (supabaseConfigured) return 'supabase';
  if (upstashConfigured) return 'upstash';
  return 'memory';
}
