import type { Metadata } from 'next';
import { AchievementBoard } from '@/components/AchievementBoard';
import { FactionSplit } from '@/components/FactionSplit';
import { GameModeCards } from '@/components/GameModeCards';
import { HeroRoster } from '@/components/HeroRoster';
import { PlayerHeader } from '@/components/PlayerHeader';
import { SearchForm } from '@/components/SearchForm';
import { SectionNav } from '@/components/SectionNav';
import { StatPanel } from '@/components/StatPlate';
import type { StatGroup } from '@/shared/types';
import { searchPlayer } from '@/server/search';

export const dynamic = 'force-dynamic';

/** Stat keys already shown in the header strip, so the panels below skip them. */
const HEADER_KEYS = new Set([
  'reputation',
  'kd',
  'win-rate',
  'total-matches',
  'playtime',
  'kills',
  'deaths',
  'assists',
  'faction',
  'displayName',
]);

/**
 * The heading for each way a lookup can fail. It used to read "No player
 * found" whatever happened, which said the wrong thing entirely when the
 * source was simply unreachable — the player exists, we just could not ask.
 */
const FAILURE_HEADINGS: Record<string, string> = {
  INVALID_USERNAME: 'That name will not work',
  PLAYER_NOT_FOUND: 'No player found',
  PROFILE_PRIVATE: 'This profile is private',
  DATA_UNAVAILABLE: 'Nothing to show for this player',
  PROVIDER_UNAVAILABLE: 'Stats are unavailable right now',
  PROVIDER_DISABLED: 'Stats are unavailable right now',
  RATE_LIMITED: 'Too many searches',
  INTERNAL: 'Something went wrong',
};

/** The order a player reads the panels in, rather than the order they arrive. */
const PANEL_ORDER = ['matches-by-type', 'playtime', 'matchmaking', 'faction-war'];

function withoutHeaderStats(group: StatGroup): StatGroup {
  return { ...group, stats: group.stats.filter((stat) => !HEADER_KEYS.has(stat.key)) };
}

interface PageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ refresh?: string }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { username } = await params;
  const { refresh } = await searchParams;
  const name = decodeURIComponent(username);

  // A refresh deliberately bypasses the cache, so the page below is going to
  // fetch regardless. Looking up here as well would make that two upstream
  // calls for one deliberate click, so this path keeps the plain title.
  if (refresh === '1') {
    return {
      title: name,
      description: `Heroes, game modes, combat record and achievements for ${name}.`,
    };
  }

  // This costs nothing extra. Rendering the page performs the same lookup, and
  // searchPlayer caches, so metadata and body share one result — including for
  // a link unfurl, which fetches the page anyway. An earlier version avoided
  // the call and paid for it: a lookup by SteamID64 was titled with the
  // 17-digit id while the page itself showed the player's name.
  const result = await searchPlayer(name).catch(() => null);
  if (!result?.ok) {
    return {
      title: name,
      description: `Heroes, game modes, combat record and achievements for ${name}.`,
    };
  }

  const report = result.data;
  const figure = (key: string) =>
    [report.overview, report.overall, ...report.extraGroups]
      .flatMap((group) => group.stats)
      .find((stat) => stat.key === key);
  const parts = [
    figure('reputation')?.value != null ? `${figure('reputation')?.value} reputation` : null,
    report.heroes.items.length > 0 ? `${report.heroes.items.length} heroes` : null,
    figure('win-rate')?.value != null ? `${figure('win-rate')?.value}% win rate` : null,
    figure('kd')?.value != null ? `${figure('kd')?.value} K/D` : null,
  ].filter((part) => part !== null);

  const title = report.identity.displayName;
  const description =
    parts.length > 0
      ? `${parts.join(' · ')} — the full For Honor record for ${title}.`
      : `Heroes, game modes, combat record and achievements for ${title}.`;

  return { title, description, openGraph: { title: `${title} — For Honor Tracker`, description } };
}

export default async function PlayerPage({ params, searchParams }: PageProps) {
  const { username } = await params;
  const { refresh } = await searchParams;
  const name = decodeURIComponent(username);
  const result = await searchPlayer(name, { refresh: refresh === '1' });

  if (!result.ok) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-20 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {FAILURE_HEADINGS[result.code] ?? 'Something went wrong'}
        </h1>
        <div className="card mt-5 p-6">
          <p className="text-sm leading-relaxed text-ink">{result.message}</p>
          {result.hint ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-dim">{result.hint}</p>
          ) : null}
        </div>
        <div className="mt-8">
          <p className="tile-label mb-3">
            {result.code === 'PLAYER_NOT_FOUND' ? 'Try another name' : 'Try again'}
          </p>
          <SearchForm initialValue={name} size="compact" />
        </div>
      </div>
    );
  }

  const report = result.data;

  const combat = withoutHeaderStats(report.overall);
  const account = withoutHeaderStats(report.overview);
  const ranked = [...report.extraGroups].sort(
    (a, b) =>
      (PANEL_ORDER.indexOf(a.key) + 1 || PANEL_ORDER.length + 1) -
      (PANEL_ORDER.indexOf(b.key) + 1 || PANEL_ORDER.length + 1),
  );

  const hasHeroes = report.heroes.items.length > 0;
  // The faction split is measured in hours, so a roster with no recorded time
  // has nothing to split. Checked here as well as inside the component, or the
  // jump link would point at an empty panel.
  const hasFactionSplit = report.heroes.items.some((hero) => (hero.timePlayedHours ?? 0) > 0);
  const hasModes = report.gameModes.items.length > 0;
  const hasAchievements = report.achievements.items.length > 0;

  const sections = [
    hasModes ? { id: 'modes', label: 'Game modes', count: report.gameModes.items.length } : null,
    hasFactionSplit ? { id: 'factions', label: 'Factions' } : null,
    { id: 'combat', label: 'Combat' },
    hasHeroes ? { id: 'heroes', label: 'Heroes', count: report.heroes.items.length } : null,
    hasAchievements
      ? { id: 'achievements', label: 'Achievements', count: report.achievements.items.length }
      : null,
  ].filter((section) => section !== null);

  return (
    // A wide canvas: the dashboard splits into columns on a large screen so
    // the roster and the figures sit side by side instead of one long scroll.
    <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6">
      <div className="mb-5 max-w-2xl">
        <SearchForm initialValue={name} size="compact" />
      </div>

      <PlayerHeader report={report} username={name} />

      {report.notices.length > 0 ? (
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {report.notices.map((notice) => (
            <li
              key={notice}
              className="card border-l-2 border-l-warn p-3 text-xs leading-relaxed text-ink-dim"
            >
              {notice}
            </li>
          ))}
        </ul>
      ) : null}

      <SectionNav items={sections} />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        {/* Left: the roster, which is the biggest block and benefits most
            from the extra width. */}
        {hasHeroes ? (
          <section className="panel" id="heroes">
            <header>
              <h2 className="text-sm font-semibold text-ink">Heroes</h2>
              <span className="numeral text-xs text-ink-faint">
                {report.heroes.items.length} played
              </span>
            </header>
            <HeroRoster items={report.heroes.items} />
            <p className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
              Reputation, level, hours and matches are exact figures from Ubisoft. A hero can take a
              while to appear here after release.
            </p>
          </section>
        ) : null}

        {/* Right: every figure, in reading order. On a phone this simply
            follows the roster. */}
        <div className="grid gap-4">
          {hasModes ? (
            <section className="panel" id="modes">
              <header>
                <h2 className="text-sm font-semibold text-ink">Game modes</h2>
                <span className="numeral text-xs text-ink-faint">
                  {report.gameModes.items.length}
                </span>
              </header>
              <GameModeCards items={report.gameModes.items} />
              {report.gameModes.explanation ? (
                <p className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
                  {report.gameModes.explanation}
                </p>
              ) : null}
            </section>
          ) : null}

          {hasFactionSplit ? (
            <section className="panel" id="factions">
              <header>
                <h2 className="text-sm font-semibold text-ink">Factions</h2>
                <span className="text-xs text-ink-faint">By hero time</span>
              </header>
              <FactionSplit items={report.heroes.items} />
            </section>
          ) : null}

          <StatPanel group={combat} id="combat" />
          {ranked.map((group) => (
            <StatPanel key={group.key} group={group} />
          ))}
          <StatPanel group={account} />
        </div>
      </div>

      {hasAchievements ? (
        <section className="panel mt-4" id="achievements">
          <header>
            <h2 className="text-sm font-semibold text-ink">Achievements</h2>
            {report.achievements.totalCount > 0 ? (
              <span className="numeral text-xs text-ink-faint">
                {report.achievements.unlockedCount} / {report.achievements.totalCount}
              </span>
            ) : null}
          </header>
          <AchievementBoard items={report.achievements.items} />
          {report.achievements.explanation ? (
            <p className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
              {report.achievements.explanation}
            </p>
          ) : null}
        </section>
      ) : report.achievements.explanation ? (
        // The one absence worth stating. Achievements come from the Steam
        // account Ubisoft says is linked, so when there is no link — or the
        // profile is private — the section would otherwise just be missing,
        // and a reader cannot tell that from a player who has none.
        <section className="panel mt-4">
          <header>
            <h2 className="text-sm font-semibold text-ink">Achievements</h2>
          </header>
          <p className="px-4 py-3 text-sm leading-relaxed text-ink-dim">
            {report.achievements.explanation}
          </p>
        </section>
      ) : null}

    </div>
  );
}
