/**
 * Faction identity: one accent colour per For Honor faction.
 *
 * Faction is a categorical encoding — five fixed identities, assigned in a
 * fixed order and never cycled — so the palette is held to the rules that
 * apply to any categorical scale rather than picked by eye. These five hues
 * were chosen against the app's dark surface (#111419) and checked with a
 * colour-vision-deficiency validator: all five sit inside one lightness band,
 * clear the chroma floor, hold at least 15 ΔE from each other for normal
 * vision, and keep 3:1 contrast against the surface.
 *
 * One pair — Knights blue against Outlanders magenta — sits at 6.8 ΔE under
 * deuteranopia, inside the band that is only acceptable alongside a second,
 * non-colour cue. That cue is always present here: every place a faction
 * colour appears, the faction's name appears in text beside it. Colour never
 * carries the identity alone.
 *
 * Pure data, no I/O, so it is safe to import from server and client alike.
 */
export interface FactionStyle {
  /** Accent colour, for swatches, bars and hairlines — never for body text. */
  accent: string;
  /** A dim wash of the same hue, for backgrounds. */
  dim: string;
}

const STYLES: Record<string, FactionStyle> = {
  Knights: { accent: '#1a63c6', dim: 'rgba(26, 99, 198, 0.16)' },
  Vikings: { accent: '#089868', dim: 'rgba(8, 152, 104, 0.16)' },
  Samurai: { accent: '#c72c3a', dim: 'rgba(199, 44, 58, 0.16)' },
  'Wu Lin': { accent: '#a99400', dim: 'rgba(169, 148, 0, 0.18)' },
  Outlanders: { accent: '#cb61c4', dim: 'rgba(203, 97, 196, 0.16)' },
};

/** Fixed assignment order, so a faction keeps its hue however the list is filtered. */
export const FACTION_ORDER = ['Knights', 'Vikings', 'Samurai', 'Wu Lin', 'Outlanders'];

const NEUTRAL: FactionStyle = { accent: '#7d8898', dim: 'rgba(125, 136, 152, 0.14)' };

export function factionStyle(faction: string | null | undefined): FactionStyle {
  if (!faction) return NEUTRAL;
  return STYLES[faction] ?? NEUTRAL;
}
