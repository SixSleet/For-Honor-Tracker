/**
 * Pure query parsing for the Steam provider. Kept free of server-only imports
 * so it can be unit tested directly.
 */

const STEAM_ID_64 = /^7656119\d{10}$/;

export interface SteamTarget {
  kind: 'id' | 'vanity';
  value: string;
}

/** Pulls a vanity name or SteamID64 out of whatever the user typed. */
export function normalizeQuery(query: string): SteamTarget | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const urlMatch = /steamcommunity\.com\/(id|profiles)\/([^/?#\s]+)/i.exec(trimmed);
  if (urlMatch) {
    const value = decodeURIComponent(urlMatch[2]);
    return urlMatch[1].toLowerCase() === 'profiles'
      ? { kind: 'id', value }
      : { kind: 'vanity', value };
  }

  if (STEAM_ID_64.test(trimmed)) return { kind: 'id', value: trimmed };
  if (/^[A-Za-z0-9_-]{2,32}$/.test(trimmed)) return { kind: 'vanity', value: trimmed };
  return null;
}

export function profileXmlUrl(target: SteamTarget, suffix = ''): string {
  const segment = target.kind === 'id' ? 'profiles' : 'id';
  return `https://steamcommunity.com/${segment}/${encodeURIComponent(target.value)}${suffix}?xml=1`;
}
