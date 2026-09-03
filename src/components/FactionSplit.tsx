import type { HeroStat } from '@/shared/types';
import { FACTION_ORDER, factionStyle } from '@/shared/faction';
import { LOCALE } from '@/shared/format';

interface Row {
  faction: string;
  heroes: number;
  reputation: number;
  hours: number;
  share: number;
}

/**
 * How a player's time is split across the four factions and the Outlanders.
 *
 * Nothing new is fetched for this: it is the per-hero figures already on the
 * page, added up the way a player actually thinks about their roster. The
 * roster alone answers "which hero", but not "am I a Viking player" — which is
 * the question the faction colours on every card invite.
 */
export function FactionSplit({ items }: { items: HeroStat[] }) {
  const tally = new Map<string, Row>();
  for (const hero of items) {
    const faction = hero.faction ?? 'Unknown';
    const row =
      tally.get(faction) ??
      { faction, heroes: 0, reputation: 0, hours: 0, share: 0 };
    row.heroes += 1;
    row.reputation += hero.reputation ?? 0;
    row.hours += hero.timePlayedHours ?? 0;
    tally.set(faction, row);
  }

  const rows = [...tally.values()];
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  if (rows.length === 0 || totalHours === 0) return null;
  for (const row of rows) row.share = (row.hours / totalHours) * 100;

  // Ranked by time, which is what "my faction" means in practice.
  rows.sort((a, b) => b.hours - a.hours);
  const top = rows[0];

  return (
    <div className="p-3">
      {/* One bar, split to scale, so the whole roster reads at a glance. */}
      <div className="flex h-2.5 gap-0.5 overflow-hidden" role="presentation">
        {[...rows]
          .sort((a, b) => FACTION_ORDER.indexOf(a.faction) - FACTION_ORDER.indexOf(b.faction))
          .map((row) => (
            <span
              key={row.faction}
              className="rounded-full"
              style={{ width: `${row.share}%`, background: factionStyle(row.faction).accent }}
            />
          ))}
      </div>

      <p className="mt-2.5 text-xs text-ink-dim">
        Mostly a <span className="font-semibold text-ink">{top.faction}</span> player —{' '}
        <span className="numeral">{Math.round(top.share)}%</span> of their hero time.
      </p>

      <ul className="mt-3 divide-y divide-line">
        {rows.map((row) => (
          <li key={row.faction} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="swatch"
                style={{ background: factionStyle(row.faction).accent }}
                aria-hidden
              />
              <span className="truncate text-sm text-ink">{row.faction}</span>
              <span className="numeral shrink-0 text-xs text-ink-faint">
                {row.heroes} {row.heroes === 1 ? 'hero' : 'heroes'}
              </span>
            </div>
            <div className="numeral flex shrink-0 items-baseline gap-3 text-xs text-ink-dim">
              <span title="Reputation earned across this faction's heroes">
                {row.reputation.toLocaleString(LOCALE)} rep
              </span>
              <span title="Hours played on this faction's heroes">
                {Math.round(row.hours).toLocaleString(LOCALE)}h
              </span>
              <span className="w-9 text-right text-ink">{Math.round(row.share)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
