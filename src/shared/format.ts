/**
 * One locale for every figure and date on the page.
 *
 * `toLocaleString()` with no locale takes the runtime's, which is Node's on
 * the server and the browser's on the client. Those disagree — 22,460 against
 * 22.460 — and React reports the difference as a hydration mismatch on any
 * visitor whose browser is not set to English. The interface is written in
 * English throughout, so the formatting is pinned to match it.
 */
export const LOCALE = 'en-US';

import type { Stat } from './types';

export function formatStatValue(stat: Stat): string {
  if (stat.value === null || stat.value === undefined) return '—';
  if (typeof stat.value === 'string') return stat.value;
  switch (stat.kind) {
    case 'percent':
      return `${stat.value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}%`;
    case 'duration-minutes':
      return formatHours(stat.value / 60);
    case 'ratio':
      return stat.value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      return stat.value.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  }
}

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${hours.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} h`;
}

export function relativeTime(epochMs: number, now = Date.now()): string {
  const seconds = Math.round((now - epochMs) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
