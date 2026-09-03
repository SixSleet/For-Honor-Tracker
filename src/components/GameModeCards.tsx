import type { CSSProperties } from 'react';
import type { GameModeStat } from '@/shared/types';
import { LOCALE } from '@/shared/format';

function isExact(mode: GameModeStat): boolean {
  return !mode.confirmedMinimum;
}

/** A win rate is only meaningful when both figures are exact counts. */
function rate(mode: GameModeStat): number | null {
  if (!isExact(mode) || !mode.matches || mode.wins === null) return null;
  return Math.round((mode.wins / mode.matches) * 1000) / 10;
}

function count(value: number | null, minimum: boolean): string {
  if (value === null) return '—';
  return `${minimum ? '≥' : ''}${value.toLocaleString(LOCALE)}`;
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <dt className="tile-label">{label}</dt>
      <dd
        className="numeral truncate text-sm"
        style={{ color: value === '—' ? 'var(--color-ink-faint)' : (tone ?? 'var(--color-ink)') }}
      >
        {value}
      </dd>
    </div>
  );
}

function ModeCard({ mode, share }: { mode: GameModeStat; share: number | null }) {
  const exact = isExact(mode);
  const pct = rate(mode);
  const wins = mode.wins ?? 0;
  const losses = mode.losses ?? 0;
  const total = wins + losses;

  return (
    <li className="card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-ink">{mode.mode}</h3>
        {pct !== null ? <span className="numeral text-lg text-ink">{pct}%</span> : null}
      </div>

      {/* The bar is drawn only where both halves are real counts. Drawing it
          from a lower bound would show a mode as 100% won on the strength of
          a single achievement. */}
      {exact && total > 0 ? (
        <div className="split-bar mt-2" role="presentation">
          <span className="won" style={{ width: `${(wins / total) * 100}%` }} />
          <span className="lost" style={{ width: `${(losses / total) * 100}%` }} />
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Figure label="Won" value={count(mode.wins, !exact)} tone="var(--color-good)" />
        <Figure label="Lost" value={count(mode.losses, false)} />
        <Figure label="Played" value={count(mode.matches, !exact)} />
      </dl>

      {exact && share !== null ? (
        <p className="mt-2 text-[11px] text-ink-faint">{share}% of matches with a mode breakdown</p>
      ) : null}

      {mode.evidence && mode.evidence.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {mode.evidence.join(' · ')}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Per-mode record.
 *
 * Two kinds of row sit here and they are kept apart rather than blended.
 * Ubisoft reports exact counts for Duel and Dominion only; everything else is
 * a lower bound proven by a Steam achievement — "won at least 20 Brawls",
 * with no idea of the real total. Mixing them would let a mode with one
 * proven win read as a perfect record.
 */
export function GameModeCards({ items }: { items: GameModeStat[] }) {
  const exactModes = items.filter(isExact).sort((a, b) => (b.matches ?? 0) - (a.matches ?? 0));
  const provenModes = items.filter((mode) => !isExact(mode)).sort((a, b) => a.mode.localeCompare(b.mode));

  // The share is of the matches that actually have a mode breakdown, not of
  // every match the player has ever played — those are different totals.
  const breakdownTotal = exactModes.reduce((sum, mode) => sum + (mode.matches ?? 0), 0);
  const shareOf = (mode: GameModeStat): number | null =>
    breakdownTotal > 0 && mode.matches !== null
      ? Math.round((mode.matches / breakdownTotal) * 100)
      : null;

  return (
    <div className="p-3">
      <ul
        className="grid gap-2"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' } as CSSProperties}
      >
        {exactModes.map((mode) => (
          <ModeCard key={mode.mode} mode={mode} share={shareOf(mode)} />
        ))}
      </ul>

      {provenModes.length > 0 ? (
        <>
          <p className="mt-4 mb-2 text-[11px] leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">At least this much</span> — Ubisoft publishes no
            figures for these modes, so what is shown is the most a Steam achievement proves. The
            real totals are higher.
          </p>
          <ul
            className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' } as CSSProperties}
          >
            {provenModes.map((mode) => (
              <ModeCard key={mode.mode} mode={mode} share={null} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
