import type { CSSProperties, ReactElement, SVGProps } from 'react';

/**
 * Console symbols for the platform chips.
 *
 * Drawn here rather than pulled from an icon package: the page loads no
 * third-party CSS or scripts, and two glyphs are not worth a dependency. They
 * are geometry, not traced logos — the PlayStation mark is the four face
 * buttons in their controller arrangement, the Xbox mark is the ringed X —
 * both drawn in `currentColor` so a chip tints them with its own text colour.
 */

interface MarkProps {
  className?: string;
  style?: CSSProperties;
}

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  // Light enough that the small shapes stay open: at 1.9 the face buttons
  // filled in solid and the cluster read as four dots.
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

/** Triangle, circle, cross and square, laid out as they sit on the pad. */
function PlayStationMark({ className, style }: MarkProps) {
  return (
    <svg {...base} className={className} style={style}>
      <path d="M12 1.7 15.2 7.2H8.8Z" />
      <circle cx="18.8" cy="12" r="3.1" />
      <path d="M9.4 16.5 14.6 21.7M14.6 16.5 9.4 21.7" />
      <rect x="2.1" y="8.9" width="6.2" height="6.2" rx="0.9" />
    </svg>
  );
}

/**
 * The ringed X, its strokes bowed out from centre as the real mark's are. The
 * ring is drawn a little inside the box so this glyph does not outweigh the
 * PlayStation cluster beside it, which is mostly open space.
 */
function XboxMark({ className, style }: MarkProps) {
  return (
    <svg {...base} className={className} style={style}>
      <circle cx="12" cy="12" r="8.9" />
      <path d="M7.9 7.2Q10.4 12 16.1 16.8" />
      <path d="M16.1 7.2Q13.6 12 7.9 16.8" />
    </svg>
  );
}

const MARKS: Record<string, (props: MarkProps) => ReactElement> = {
  psn: PlayStationMark,
  xbl: XboxMark,
};

/**
 * The symbol for a platform, or nothing when we have not drawn one. Callers
 * render the platform's name either way, so a missing symbol costs no meaning.
 */
export function PlatformMark({ platform, className, style }: MarkProps & { platform: string }) {
  const Mark = MARKS[platform];
  return Mark ? <Mark className={className} style={style} /> : null;
}
