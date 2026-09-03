/**
 * Hero reputation, and how far along the cap a given reputation sits.
 *
 * Reputation is For Honor's per-hero prestige level: a hero that reaches the
 * level cap can "reset" for another reputation, up to a maximum. That maximum
 * is a property of the game, not of the player, so a progress rail has to be
 * drawn against it — measuring instead against the player's own best hero
 * makes every roster look complete, because the best hero is 100% by
 * definition however low its reputation actually is.
 */

/**
 * The highest reputation a hero can currently reach.
 *
 * Ubisoft has raised this over the game's life (30 → 40 → … → 80), so it is a
 * single named constant: if a season raises it again, this is the only value
 * to change.
 */
export const MAX_REPUTATION = 80;

/**
 * How full a reputation rail should be drawn, as a whole percentage.
 *
 * Clamped to the cap so a hero that somehow reports above it still renders as
 * a full bar rather than overflowing, and floored at 0 so a missing or
 * negative reputation renders empty rather than as a stray sliver.
 */
export function repPercent(reputation: number | null | undefined): number {
  if (reputation === null || reputation === undefined) return 0;
  if (!Number.isFinite(reputation) || reputation <= 0) return 0;
  return Math.min(100, Math.round((reputation / MAX_REPUTATION) * 100));
}
