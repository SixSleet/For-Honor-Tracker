'use client';

import { useMemo, useState } from 'react';
import type { Achievement } from '@/shared/types';
import { formatDate } from '@/shared/format';

type SortKey = 'rarity' | 'recent' | 'name';
type Filter = 'all' | 'unlocked' | 'locked';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unlocked', label: 'Unlocked' },
  { key: 'locked', label: 'Locked' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'rarity', label: 'Rarest first' },
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'A–Z' },
];

/**
 * How rare an achievement is, in words. The raw percentage is exact but hard
 * to feel; the word gives it a scale, and the number stays beside it.
 */
function rarity(percent: number | undefined): { label: string; color: string } | null {
  if (typeof percent !== 'number') return null;
  if (percent < 2) return { label: 'Very rare', color: 'var(--color-accent)' };
  if (percent < 6) return { label: 'Rare', color: 'var(--color-warn)' };
  if (percent < 15) return { label: 'Uncommon', color: 'var(--color-ink-dim)' };
  return { label: 'Common', color: 'var(--color-ink-faint)' };
}

export function AchievementBoard({ items }: { items: Achievement[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('rarity');
  const [filter, setFilter] = useState<Filter>('all');

  const unlockedCount = items.filter((item) => item.unlocked).length;
  const pct = items.length > 0 ? Math.round((unlockedCount / items.length) * 100) : 0;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (filter === 'unlocked' && !item.unlocked) return false;
      if (filter === 'locked' && item.unlocked) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        (item.description ?? '').toLowerCase().includes(needle)
      );
    });

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'recent':
          return (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0);
        default:
          return (a.globalPercent ?? 101) - (b.globalPercent ?? 101);
      }
    });
  }, [items, query, sort, filter]);

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search achievements"
            aria-label="Search achievements"
            className="field min-w-0 flex-1 px-3 py-1.5 text-sm sm:max-w-56"
          />
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter achievements">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="chip"
                aria-pressed={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Sort achievements">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                className="chip"
                aria-pressed={sort === option.key}
                onClick={() => setSort(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overall progress, since a list of 60 rows does not show it. */}
        <div className="flex items-center gap-3">
          <div
            className="meter flex-1"
            style={{ '--value': `${pct}%`, '--accent': 'var(--color-good)' } as React.CSSProperties}
          >
            <span />
          </div>
          <span className="numeral shrink-0 text-xs text-ink-dim" aria-live="polite">
            {unlockedCount} of {items.length} unlocked · {pct}%
          </span>
        </div>
      </div>

      <ul className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visible.map((item) => {
          const rare = rarity(item.globalPercent);
          return (
            <li
              key={item.apiName}
              className={`card flex gap-3 p-3 ${item.unlocked ? '' : 'opacity-60'}`}
            >
              {item.iconUrl ? (
                // Steam serves these from its own CDN; a plain img avoids
                // routing every icon through the optimizer on a free plan.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.iconUrl}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  className={`h-11 w-11 shrink-0 rounded-lg object-cover ${
                    item.unlocked ? '' : 'grayscale'
                  }`}
                />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-lg bg-surface-3" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-medium text-ink">{item.name}</h3>
                  {rare ? (
                    <span
                      className="numeral shrink-0 text-[11px]"
                      style={{ color: rare.color }}
                      title={`${item.globalPercent?.toFixed(1)}% of players have this`}
                    >
                      {rare.label}
                    </span>
                  ) : null}
                </div>
                {item.description ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">
                    {item.description}
                  </p>
                ) : null}
                <p className="mt-1 text-[11px] text-ink-faint">
                  {item.unlocked
                    ? item.unlockedAt
                      ? `Unlocked ${formatDate(item.unlockedAt)}`
                      : 'Unlocked'
                    : 'Not unlocked'}
                  {typeof item.globalPercent === 'number'
                    ? ` · ${item.globalPercent.toFixed(1)}% of players`
                    : ''}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-dim">Nothing matches that filter.</p>
      ) : null}
    </div>
  );
}
