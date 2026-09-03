import type { CSSProperties } from 'react';
import type { PlatformLink, PlayerReport, Stat } from '@/shared/types';
import { formatStatValue, relativeTime, LOCALE } from '@/shared/format';
import { factionStyle } from '@/shared/faction';
import { PlatformMark } from './PlatformMark';
import { RefreshButton } from './RefreshButton';

/**
 * Find a mapped stat by key anywhere in the report.
 *
 * Every group is searched, including the provider's extra ones: the headline
 * figures are chosen by key, and a stat moving between sections must not
 * silently blank a tile. Win rate did exactly that when it moved into the
 * matches section.
 */
function pick(report: PlayerReport, key: string): Stat | undefined {
  const groups = [report.overview, report.overall, ...report.extraGroups];
  for (const group of groups) {
    const found = group.stats.find((stat) => stat.key === key);
    if (found) return found;
  }
  return undefined;
}

function value(stat: Stat | undefined): string {
  return stat ? formatStatValue(stat) : '—';
}

interface Tile {
  label: string;
  value: string;
  note?: string;
  /** 0–100 fill for the rail under the value, when a fraction is meaningful. */
  meter?: number | null;
  accent?: string;
}

/**
 * The identity band and headline figures — everything a player looks up first,
 * in one strip above the detail panels.
 */
export function PlayerHeader({ report, username }: { report: PlayerReport; username: string }) {
  const { identity } = report;
  const faction = pick(report, 'faction')?.value;
  const fstyle = factionStyle(typeof faction === 'string' ? faction : null);

  const topHero = report.heroes.items[0] ?? null;
  const topHeroStyle = factionStyle(topHero?.faction ?? null);

  const rep = pick(report, 'reputation');
  const kd = pick(report, 'kd');
  const winRate = pick(report, 'win-rate');
  const matches = pick(report, 'total-matches');
  const hours = pick(report, 'playtime');
  const kills = pick(report, 'kills');
  const deaths = pick(report, 'deaths');
  const assists = pick(report, 'assists');

  const pct = (stat: Stat | undefined) =>
    stat && typeof stat.value === 'number' ? Math.max(0, Math.min(100, stat.value)) : null;
  // A K/D of 2.0 fills the rail — a common ceiling that keeps the bar readable.
  const kdPct =
    kd && typeof kd.value === 'number' ? Math.max(0, Math.min(100, (kd.value / 2) * 100)) : null;

  const tiles: Tile[] = [
    { label: 'Reputation', value: value(rep), accent: 'var(--color-accent)' },
    {
      label: 'Win rate',
      value: value(winRate),
      meter: pct(winRate),
      note: winRate?.note,
      accent: 'var(--color-good)',
    },
    { label: 'K / D', value: value(kd), meter: kdPct, accent: 'var(--color-accent)' },
    { label: 'Matches', value: value(matches) },
    { label: 'Hours', value: hours?.value != null ? `${value(hours)} h` : '—' },
    { label: 'Kills', value: value(kills) },
    { label: 'Deaths', value: value(deaths) },
    { label: 'Assists', value: value(assists) },
  ];

  const initial = identity.displayName.slice(0, 1).toUpperCase();

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="relative h-16 w-16 shrink-0 sm:h-[4.5rem] sm:w-[4.5rem]">
          {/* The lettered stand-in sits behind the picture, so a portrait that
              fails to load leaves an initial rather than a broken image. */}
          <div
            className="absolute inset-0 flex items-center justify-center rounded-xl border text-2xl font-semibold text-ink-dim"
            style={{ borderColor: fstyle.accent, background: fstyle.dim }}
          >
            {initial}
          </div>
          {identity.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={identity.avatarUrl}
              alt=""
              width={96}
              height={96}
              className="absolute inset-0 h-full w-full rounded-xl border object-cover"
              style={{ borderColor: fstyle.accent }}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-3xl">
              {identity.displayName}
            </h1>
            {typeof faction === 'string' ? (
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-ink"
                style={{ borderColor: fstyle.accent, background: fstyle.dim }}
              >
                <span className="swatch" style={{ background: fstyle.accent }} aria-hidden />
                {faction}
              </span>
            ) : null}
            {platformChips(report.platforms).map((link) => (
              <PlatformChip key={link.id} link={link} />
            ))}
          </div>

          {/* When they last played, and when we last looked. There is no
              "playing since" here: Ubisoft's stat card only dates when it
              created each counter, which is the same pre-release date for
              every account, so it says nothing about this player. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-dim">
            {report.lastPlayedAt ? (
              <span
                title={`The last time the source recorded any activity on this account: ${new Date(
                  report.lastPlayedAt,
                ).toLocaleString(LOCALE)}`}
              >
                Last played{' '}
                <span className="text-ink">{relativeTime(report.lastPlayedAt)}</span>
              </span>
            ) : null}
            <span className="text-ink-faint">
              Checked {relativeTime(report.fetchedAt)}
              {report.cached ? ' · cached' : ''}
              {report.season ? ` · season ${report.season} data` : ''}
            </span>
          </div>
        </div>

        {/* The top hero rides in the identity band rather than taking a row of
            its own, so the figures below start higher up the page. */}
        {topHero ? (
          <div
            className="flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2"
            style={{ borderColor: topHeroStyle.accent, background: topHeroStyle.dim }}
          >
            {topHero.portraitUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={topHero.portraitUrl}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 shrink-0 rounded-lg object-cover"
                style={{ background: 'var(--color-surface-3)' }}
              />
            ) : null}
            <div className="min-w-0">
              <p className="tile-label">Most played</p>
              <p className="truncate text-sm font-semibold text-ink">{topHero.name}</p>
              <p className="numeral text-xs font-medium text-ink-dim">
                {topHero.reputation ?? '—'} rep
                {topHero.timePlayedHours != null ? ` · ${Math.round(topHero.timePlayedHours)}h` : ''}
              </p>
            </div>
          </div>
        ) : null}

        <RefreshButton username={username} />
      </div>

      {/* Headline figures: two across on a phone, eight on a desktop, so the
          whole summary is one glance wide instead of a scroll. */}
      <dl className="grid grid-cols-2 border-t border-line sm:grid-cols-4 lg:grid-cols-8">
        {tiles.map((tile) => (
          <div key={tile.label} className="tile">
            <dt className="tile-label">{tile.label}</dt>
            <dd
              className="numeral mt-1 truncate text-xl"
              style={{ color: tile.value === '—' ? 'var(--color-ink-faint)' : 'var(--color-ink)' }}
            >
              {tile.value}
            </dd>
            {tile.meter != null ? (
              <div
                className="meter mt-2"
                style={{ '--value': `${tile.meter}%`, '--accent': tile.accent } as CSSProperties}
              >
                <span />
              </div>
            ) : null}
            {tile.note ? (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{tile.note}</p>
            ) : null}
          </div>
        ))}
      </dl>

      {identity.profileUrl ? (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">
          <a
            href={identity.profileUrl}
            rel="noopener noreferrer nofollow"
            target="_blank"
            className="text-accent-bright underline underline-offset-4"
          >
            Source profile
          </a>
        </p>
      ) : null}
    </section>
  );
}

/**
 * The colour each console is known by, lightened until it carries against the
 * page's dark surfaces — the stock brand values are far too dark to read here.
 * Only the symbol wears it; the handle beside it stays in the page's ink.
 */
const PLATFORM_ACCENT: Record<string, string> = {
  psn: '#5ea8f2',
  xbl: '#5fbf47',
};

/** Platforms the player has a name on come first — they say the most. */
function platformChips(links: PlatformLink[] | undefined): PlatformLink[] {
  return [...(links ?? [])].sort((a, b) => Number(Boolean(b.handle)) - Number(Boolean(a.handle)));
}

/**
 * One platform: its symbol and the name the player goes by there, or just the
 * platform's name where we have no handle to show.
 *
 * The symbol is decorative, so the platform is also named in text for anyone
 * who cannot see it — visibly when there is no handle, and to a screen reader
 * and on hover when the handle has taken the space.
 */
function PlatformChip({ link }: { link: PlatformLink }) {
  const accent = PLATFORM_ACCENT[link.id];
  if (!link.handle) {
    return (
      <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-ink-dim">
        {link.label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex min-w-0 shrink items-center gap-1.5 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-2.5 text-xs"
      title={`${link.label}: ${link.handle}`}
    >
      <PlatformMark
        platform={link.id}
        className="h-4 w-4 shrink-0"
        {...(accent ? { style: { color: accent } } : {})}
      />
      <span className="sr-only">{link.label}</span>
      <span className="truncate font-medium text-ink">{link.handle}</span>
    </span>
  );
}
