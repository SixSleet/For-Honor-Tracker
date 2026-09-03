import 'server-only';
import type { ApiResult, PlayerReport } from '@/shared/types';
import { cache, cacheKey } from './cache';
import { env } from './env';
import { newTraceCollector } from './http';
import { candidatesFor } from './providers/registry';
import { ProviderError } from './providers/types';
import { validateUsername } from '@/shared/validation';

/**
 * Resolves a username through each candidate provider in turn and returns the
 * first complete report. Providers that fail are recorded in the trace and
 * skipped rather than failing the whole search, so one broken upstream does
 * not hide a working one.
 */
export async function searchPlayer(
  rawQuery: string,
  options: { refresh?: boolean; includeDiagnostics?: boolean } = {},
): Promise<ApiResult<PlayerReport>> {
  const validated = validateUsername(rawQuery);
  if (!validated.ok) {
    return { ok: false, code: 'INVALID_USERNAME', message: validated.message };
  }
  const query = validated.value;
  const trace = newTraceCollector();
  const withDiagnostics = <T extends ApiResult<PlayerReport>>(result: T): T =>
    options.includeDiagnostics && env.diagnosticsEnabled
      ? ({ ...result, diagnostics: trace.traces } as T)
      : result;

  const key = cacheKey('report', query);
  if (!options.refresh) {
    const hit = cache.get<PlayerReport>(key);
    if (hit) {
      return withDiagnostics({
        ok: true,
        data: { ...hit.value, cached: true, fetchedAt: hit.value.fetchedAt },
      });
    }
  }

  const providers = candidatesFor(query);
  if (providers.length === 0) {
    return withDiagnostics({
      ok: false,
      code: 'PROVIDER_DISABLED',
      message: 'The tracker is temporarily unavailable. Please try again shortly.',
    });
  }

  let lastError: ProviderError | null = null;

  /** Providers that searched and genuinely found nobody, rather than breaking. */
  const searchedCleanly: string[] = [];

  // A provider that finds the player but returns nothing about them is not a
  // better answer than the next provider — it just gets there first. Such a
  // report is held back and used only if nobody else has anything.
  let thinReport: PlayerReport | null = null;

  for (const provider of providers) {
    try {
      const identity = await provider.getPlayerByUsername(query, trace);
      searchedCleanly.push(provider.info.id);
      if (!identity) continue;
      const report = await provider.getPlayerReport(identity, trace);
      if (!hasAnything(report)) {
        thinReport = thinReport ?? report;
        continue;
      }
      cache.set(key, report);
      return withDiagnostics({ ok: true, data: report });
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : // Transport failures are already recorded in the trace.
            new ProviderError(
              'PROVIDER_UNAVAILABLE',
              'The data provider is temporarily unavailable. Please try again later.',
            );
      lastError = providerError;
    }
  }

  // Everyone who had something came up empty, so serve the empty report we
  // held back rather than claiming the player does not exist.
  if (thinReport) {
    cache.set(key, thinReport);
    return withDiagnostics({ ok: true, data: thinReport });
  }

  // Nothing searched successfully, so this is an outage, not a missing player.
  // The provider's own message can name internal configuration, so a plain,
  // visitor-safe message is returned instead of the raw provider text.
  if (searchedCleanly.length === 0 && lastError) {
    return withDiagnostics({
      ok: false,
      code: lastError.code,
      message: 'Stats are temporarily unavailable. Please try again in a little while.',
    });
  }

  return withDiagnostics({
    ok: false,
    code: 'PLAYER_NOT_FOUND',
    message: "We couldn't find a player with that username.",
    hint: buildNotFoundHint(),
  });
}

/** Whether a report carries any figure at all about the player. */
function hasAnything(report: PlayerReport): boolean {
  return (
    report.heroes.items.length > 0 ||
    report.gameModes.items.length > 0 ||
    report.achievements.items.length > 0 ||
    report.overall.stats.some((stat) => stat.value !== null && stat.value !== undefined) ||
    report.extraGroups.some((group) =>
      group.stats.some((stat) => stat.value !== null && stat.value !== undefined),
    )
  );
}

/**
 * A short, friendly next step for the player. Deliberately non-technical: it
 * never names providers, endpoints or internal errors — just how to get the
 * spelling right.
 */
function buildNotFoundHint(): string {
  return 'Double-check the spelling — the name must match exactly as it appears in game, including capital letters.';
}
