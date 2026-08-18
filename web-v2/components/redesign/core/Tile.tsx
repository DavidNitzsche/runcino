import type { CSSProperties, ReactNode } from 'react';

/**
 * components/redesign/core/Tile.tsx
 *
 * Ported from the outside-studio redesign handoff
 * (designs/design-review-0818/components/core/Tile.jsx + .d.ts), 2026-08-18.
 * Faithful port: same tokens, same tone/pad/radius tables. The .d.ts omits
 * `flat` but the .jsx reads it (nested panels use flat so depth doesn't
 * compound) — kept here since Today's "How it went" / "Why today" tiles
 * are real consumers of that prop in the wider component library.
 */

export type TileTone = 'base' | 'raised' | 'bare';
export type TilePad = 'sm' | 'md' | 'lg';
export type TileRadius = 'm' | 'l' | 'xl' | '2xl';

export interface TileProps {
  children?: ReactNode;
  /** base sits on the page. raised sits on a base tile. bare is a tile-shaped region with no fill. */
  tone?: TileTone;
  pad?: TilePad;
  radius?: TileRadius;
  /** Nested panels use flat so depth does not compound into mush. */
  flat?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

const BG: Record<TileTone, string> = {
  base: 'var(--material-tile)',
  raised: 'var(--material-tile-raised)',
  bare: 'transparent',
};
const PAD: Record<TilePad, string> = {
  sm: 'var(--sp-6)',
  md: 'var(--tile-pad)',
  lg: 'var(--tile-pad-lg)',
};
const RADIUS: Record<TileRadius, string> = {
  m: 'var(--radius-m)',
  l: 'var(--radius-l)',
  xl: 'var(--radius-xl)',
  '2xl': 'var(--radius-2xl)',
};

/**
 * The container. A milled panel: material fill with a vertical fall-off, a one-pixel
 * edge light along the top, and real ambient depth underneath. Never a border, ever.
 * Nested panels use flat, so depth does not compound into mush.
 */
export function Tile({ children, tone = 'base', pad = 'md', radius = 'xl', flat = false, style, onClick }: TileProps) {
  const shadow = tone === 'bare' ? 'none' : flat ? 'var(--elevation-flat)' : 'var(--elevation-raised)';
  return (
    <div
      onClick={onClick}
      style={{
        background: BG[tone],
        padding: PAD[pad],
        borderRadius: RADIUS[radius],
        boxShadow: shadow,
        position: 'relative',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
