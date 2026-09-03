import type { Stat, StatGroup } from '@/shared/types';
import { formatStatValue } from '@/shared/format';

/** One figure: a small label over a large tabular number. */
export function StatPlate({ stat }: { stat: Stat }) {
  const empty = stat.value === null || stat.value === undefined;
  return (
    <div className="tile">
      {/* Labels wrap rather than truncate. In a narrow column half of them
          were being cut to "DEATHS PER MA…" and "MAX RENOWN R…", which is
          worse than a second line. */}
      <dt className="tile-label">{stat.label}</dt>
      <dd className={`numeral mt-1 truncate text-lg ${empty ? 'text-ink-faint' : 'text-ink'}`}>
        {stat.minimum && !empty ? <span className="text-ink-faint">≥</span> : null}
        {formatStatValue(stat)}
      </dd>
      {stat.note ? (
        <p className="mt-1 text-[11px] leading-snug text-ink-faint">{stat.note}</p>
      ) : null}
    </div>
  );
}

/**
 * A titled panel of figures.
 *
 * Stats the source did not report are dropped rather than rendered as an empty
 * tile: a grid of dashes reads as a broken page, and "we have no number for
 * this" is better said once, under the panel, than repeated in every cell.
 */
export function StatPanel({
  group,
  minColumnWidth = '8.5rem',
  id,
}: {
  group: StatGroup;
  minColumnWidth?: string;
  id?: string;
}) {
  const present = group.stats.filter((stat) => stat.value !== null && stat.value !== undefined);
  const missing = group.stats.filter((stat) => stat.value === null || stat.value === undefined);
  if (present.length === 0) return null;

  return (
    <section className="panel" id={id}>
      <header>
        <h2 className="text-sm font-semibold text-ink">{group.label}</h2>
        <span className="numeral text-xs text-ink-faint">{present.length}</span>
      </header>
      <dl
        className="grid"
        // auto-fit rather than auto-fill: an unfilled track collapses, so a
        // panel with five figures in a four-wide grid does not render a
        // bordered empty box beside the last one.
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minColumnWidth}, 1fr))` }}
      >
        {present.map((stat) => (
          <StatPlate key={stat.key} stat={stat} />
        ))}
      </dl>
      {group.explanation || missing.length > 0 ? (
        <div className="space-y-1 border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
          {group.explanation ? <p>{group.explanation}</p> : null}
          {missing.length > 0 ? (
            <p>Not reported for this player: {missing.map((stat) => stat.label).join(', ')}.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
