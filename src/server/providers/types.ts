import 'server-only';
import type { ApiErrorCode, PlayerIdentity, PlayerReport, ProviderInfo } from '@/shared/types';
import type { TraceCollector } from '../http';

/**
 * The seam between the tracker and whoever is supplying the data.
 *
 * The UI and the API routes depend on this interface, never on a specific
 * upstream service. Ubisoft's endpoints have already changed once during this
 * project's investigation; the point of this indirection is that replacing a
 * provider is a file, not a rewrite.
 */
export interface DataProvider {
  readonly info: ProviderInfo;

  /** Whether this provider is configured and willing to serve requests. */
  isEnabled(): boolean;

  /** Why it is not enabled, for the UI and diagnostics. */
  disabledReason(): string | null;

  /** True when `query` looks like something this provider can resolve. */
  canHandle(query: string): boolean;

  /** Resolves a user-supplied name to an identity, or null if not found. */
  getPlayerByUsername(username: string, trace: TraceCollector): Promise<PlayerIdentity | null>;

  /** Builds the full report for a resolved identity. */
  getPlayerReport(identity: PlayerIdentity, trace: TraceCollector): Promise<PlayerReport>;
}

/** A provider-thrown failure that maps to a specific user-facing message. */
export class ProviderError extends Error {
  readonly code: ApiErrorCode;
  readonly hint?: string;

  constructor(code: ApiErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.hint = hint;
  }
}
