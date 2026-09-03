'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import type { HeroStat } from '@/shared/types';
import { FACTION_ORDER, factionStyle } from '@/shared/faction';
import { LOCALE } from '@/shared/format';

type SortKey = 'reputation' | 'level' | 'time' | 'matches' | 'recent' | 'name';
type View = 'grid' | 'list';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'reputation', label: 'Reputation' },
  { key: 'recent', label: 'Recently played' },
  { key: 'matches', label: 'Matches' },
  { key: 'time', label: 'Hours' },
  { key: 'level', label: 'Level' },
  { key: 'name', label: 'A–Z' },
];

function compare(sort: SortKey, a: HeroStat, b: HeroStat): number {
  switch (sort) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'level':
      return (b.level ?? 0) - (a.level ?? 0);
    case 'time':
      return (b.timePlayedHours ?? 0) - (a.timePlayedHours ?? 0);
    case 'matches':
      return (b.matches ?? 0) - (a.matches ?? 0);
    case 'recent':
      return (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0);
    default:
      return (
        (b.reputation ?? 0) - (a.reputation ?? 0) ||
        (b.timePlayedHours ?? 0) - (a.timePlayedHours ?? 0)
      );
  }
}

function hours(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value >= 100 ? `${Math.round(value)}h` : `${value}h`;
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString(LOCALE);
}

/** "3d", "5mo", "2y" — compact enough to sit in a card corner. */
function ago(epochMs: number | null | undefined): string | null {
  if (!epochMs) return null;
  const days = Math.floor((Date.now() - epochMs) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30.4);
  if (months < 24) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function fullDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Portrait, or a lettered stand-in behind it when the image cannot load. */
function Portrait({ hero, size }: { hero: HeroStat; size: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {/* The letter is text, so it wears a text colour rather than the faction
          accent: at this size the accent hues sit below 4.5:1 on their own
          wash, and the swatch beside the name already carries the faction. */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center rounded-lg text-sm font-semibold text-ink-dim"
        style={{ background: factionStyle(hero.faction).dim }}
      >
        {hero.name.slice(0, 1)}
      </span>
      {hero.portraitUrl ? (
        // Portraits come from object storage; a plain img keeps them off the
        // image optimizer's quota on a free plan.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={hero.portraitUrl}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          className="absolute inset-0 h-full w-full rounded-lg object-cover"
        />
      ) : null}
    </span>
  );
}

/** One labelled figure inside a hero card or row. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={`numeral truncate text-sm ${value === '—' ? 'text-ink-faint' : 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

export function HeroRoster({ items }: { items: HeroStat[] }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('reputation');
  const [faction, setFaction] = useState<string | null>(null);
  const [view, setView] = useState<View>('grid');

  // Faction tabs come from the data, in the palette's fixed order, so a
  // faction keeps its colour however the roster is filtered.
  const factions = useMemo(() => {
    const tally = new Map<string, number>();
    for (const hero of items) {
      const key = hero.faction ?? 'Unknown';
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    return [...tally.entries()].sort(
      (a, b) => FACTION_ORDER.indexOf(a[0]) - FACTION_ORDER.indexOf(b[0]) || b[1] - a[1],
    );
  }, [items]);

  const anyLastPlayed = items.some((hero) => hero.lastPlayedAt);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((hero) => {
      if (faction && (hero.faction ?? 'Unknown') !== faction) return false;
      if (!needle) return true;
      return (
        hero.name.toLowerCase().includes(needle) ||
        (hero.faction ?? '').toLowerCase().includes(needle)
      );
    });
    return [...filtered].sort((a, b) => compare(sort, a, b));
  }, [items, query, sort, faction]);

  // The rep rail is relative to this player's own best hero, so it reads as
  // "how far up your roster" rather than against an invented cap.
  const topRep = Math.max(...items.map((hero) => hero.reputation ?? 0), 1);
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, hero) => ({
          hours: acc.hours + (hero.timePlayedHours ?? 0),
          matches: acc.matches + (hero.matches ?? 0),
          rep: acc.rep + (hero.reputation ?? 0),
        }),
        { hours: 0, matches: 0, rep: 0 },
      ),
    [rows],
  );

  const sorts = anyLastPlayed ? SORTS : SORTS.filter((option) => option.key !== 'recent');

  return (
    <div>
      {/* Controls sit above the roster, never behind a scroll. */}
      <div className="flex flex-col gap-3 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search heroes"
            aria-label="Search heroes"
            className="field min-w-0 flex-1 px-3 py-1.5 text-sm sm:max-w-56"
          />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sort heroes by">
            {sorts.map((option) => (
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
          <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="Roster layout">
            <button type="button" className="chip" aria-pressed={view === 'grid'} onClick={() => setView('grid')}>
              Cards
            </button>
            <button type="button" className="chip" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              List
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="chip" aria-pressed={faction === null} onClick={() => setFaction(null)}>
            All <span className="numeral text-ink-faint">{items.length}</span>
          </button>
          {factions.map(([name, total]) => (
            <button
              key={name}
              type="button"
              className="chip"
              aria-pressed={faction === name}
              style={{ '--accent': factionStyle(name).accent } as CSSProperties}
              onClick={() => setFaction(faction === name ? null : name)}
            >
              <span className="swatch" style={{ background: factionStyle(name).accent }} aria-hidden />
              {name} <span className="numeral text-ink-faint">{total}</span>
            </button>
          ))}
          <span className="numeral ml-auto text-[11px] font-medium text-ink-faint">
            {rows.length} shown · {totals.rep.toLocaleString(LOCALE)} rep ·{' '}
            {Math.round(totals.hours).toLocaleString(LOCALE)}h · {totals.matches.toLocaleString(LOCALE)} matches
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-ink-dim">No heroes match that search.</p>
      ) : view === 'grid' ? (
        // Cards reflow to the available width at every breakpoint, so the
        // roster never needs a sideways scroll to read a hero's numbers.
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] gap-2 p-3 sm:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]">
          {rows.map((hero) => {
            const style = factionStyle(hero.faction);
            const repPct = Math.round(((hero.reputation ?? 0) / topRep) * 100);
            const last = ago(hero.lastPlayedAt);
            return (
              <li key={hero.name} className="hero-card p-3">
                <div className="flex items-center gap-2.5">
                  <Portrait hero={hero} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink" title={hero.name}>
                      {hero.name}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-dim">
                      <span className="swatch" style={{ background: style.accent }} aria-hidden />
                      {hero.faction ?? 'Unknown'}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-baseline justify-between gap-2">
                  <span className="tile-label">Reputation</span>
                  <span className="numeral text-lg text-ink">
                    {hero.reputation ?? <span className="text-ink-faint">—</span>}
                  </span>
                </div>
                <div
                  className="meter mt-1.5"
                  style={{ '--value': `${repPct}%`, '--accent': style.accent } as CSSProperties}
                >
                  <span />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-2.5">
                  <Figure label="Level" value={hero.level === null ? '—' : String(hero.level)} />
                  <Figure label="Hours" value={hours(hero.timePlayedHours)} />
                  <Figure label="Games" value={count(hero.matches)} />
                </div>

                {last ? (
                  <p
                    className="mt-2 text-[11px] text-ink-faint"
                    title={`Last played ${fullDate(hero.lastPlayedAt as number)}`}
                  >
                    Played {last}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        // A grid, not a table: on narrow screens the least important columns
        // fold onto a second line rather than off the right edge.
        <ul className="divide-y divide-line">
          {rows.map((hero) => {
            const style = factionStyle(hero.faction);
            const repPct = Math.round(((hero.reputation ?? 0) / topRep) * 100);
            const last = ago(hero.lastPlayedAt);
            return (
              <li
                key={hero.name}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 transition-colors hover:bg-surface-2 sm:grid-cols-[auto_minmax(0,1fr)_repeat(4,minmax(3.5rem,auto))_minmax(4.5rem,auto)]"
              >
                <Portrait hero={hero} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{hero.name}</p>
                  <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-dim">
                    <span className="swatch" style={{ background: style.accent }} aria-hidden />
                    {hero.faction ?? 'Unknown'}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2 sm:col-start-3">
                  <div
                    className="meter hidden w-14 sm:block"
                    style={{ '--value': `${repPct}%`, '--accent': style.accent } as CSSProperties}
                  >
                    <span />
                  </div>
                  <Figure label="Rep" value={hero.reputation === null ? '—' : String(hero.reputation)} />
                </div>
                <div className="col-span-3 grid grid-cols-4 gap-2 border-t border-line pt-2 sm:col-span-1 sm:contents sm:border-0 sm:pt-0">
                  <Figure label="Level" value={hero.level === null ? '—' : String(hero.level)} />
                  <Figure label="Hours" value={hours(hero.timePlayedHours)} />
                  <Figure label="Games" value={count(hero.matches)} />
                  <Figure label="Played" value={last ?? '—'} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
