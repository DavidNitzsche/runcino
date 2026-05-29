/**
 * StatTrio · 2- or 3-stat row used as a headline-stats strip inside a
 * Poster or directly under the page band. Bebas/Oswald display value
 * over a small caps label. Tabular nums on every value.
 *
 * Mirror: Faff/apps/web/src/components/races/StatTrio.tsx (re-export).
 * Adapted from Faff/apps/web/src/components/StatTrio.tsx.
 */

import type { CSSProperties } from 'react';
import type { BCardValueColor } from './BCard';

export interface Stat {
  value: string;
  label: string;
  valueColor?: BCardValueColor;
}

export interface StatTrioProps {
  stats: Stat[];
  /** `poster` (default, 36px) sits inside a hero poster. `compact` (24px)
   *  embeds inside BCards. */
  size?: 'poster' | 'compact';
}

const VALUE_COLOR: Record<BCardValueColor, string> = {
  default: 'var(--ink)',
  amber:   'var(--color-attention, #F3AD38)',
  green:   'var(--color-success, #3EBD41)',
  over:    'var(--color-warning, #FC4D64)',
  race:    'var(--race, #FF5722)',
  dist:    'var(--color-corporate, #27B4E0)',
  learn:   'var(--color-xp, #9013FE)',
};

export function StatTrio({ stats, size = 'poster' }: StatTrioProps) {
  if (stats.length === 0) return null;
  const visible = stats.slice(0, 3);
  const isPoster = size === 'poster';
  const valueSize = isPoster ? 38 : 24;
  const labelSize = isPoster ? 10.5 : 9.5;
  const gap = isPoster ? 32 : 18;

  const wrapStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
    gap,
    alignItems: 'baseline',
  };

  return (
    <div className="stat-trio" data-size={size} style={wrapStyle}>
      {visible.map((stat, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="tabular" style={{
            fontFamily: 'var(--font-display, var(--f-display))',
            fontSize: valueSize,
            fontWeight: 700,
            letterSpacing: '-.015em',
            lineHeight: 0.92,
            color: VALUE_COLOR[stat.valueColor ?? 'default'],
            fontVariantNumeric: 'tabular-nums',
          }}>{stat.value}</span>
          <span style={{
            fontFamily: 'var(--font-data, var(--f-data))',
            fontSize: labelSize,
            fontWeight: 700,
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            color: 'var(--mute)',
          }}>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
