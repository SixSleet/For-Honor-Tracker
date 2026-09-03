import 'server-only';
import type { DataProvider } from './types';
import { steamProvider } from './steam';
import { ubisoftProvider } from './ubisoft';

/**
 * Resolution order.
 *
 * Ubisoft is first *when it is enabled*, because it is the authoritative
 * source for For Honor and an operator who has configured it wants it used.
 * It is disabled unless credentials are supplied, in which case Steam — the
 * only provider confirmed to work without privileged access — leads instead.
 */
const providers: DataProvider[] = [ubisoftProvider, steamProvider];

export function allProviders(): DataProvider[] {
  return providers;
}

export function enabledProviders(): DataProvider[] {
  return providers.filter((provider) => provider.isEnabled());
}

export function providerById(id: string): DataProvider | undefined {
  return providers.find((provider) => provider.info.id === id);
}

/**
 * Providers that should be tried for a query, most specific first. A provider
 * that says it can handle the query is preferred over one that merely could.
 */
export function candidatesFor(query: string): DataProvider[] {
  const enabled = enabledProviders();
  const specific = enabled.filter((provider) => provider.canHandle(query));
  const rest = enabled.filter((provider) => !specific.includes(provider));
  return [...specific, ...rest];
}
