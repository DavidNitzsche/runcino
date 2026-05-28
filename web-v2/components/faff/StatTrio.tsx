'use client';

/**
 * StatTrio · the 2- or 3-stat row anchored to the bottom of a Poster.
 * Spec: design/components/StatTrio.md
 *
 * Tabular-nums on every numeric value · per-stat color override via
 * `valueColor` (lighter tints on dark gradients — see spec §"Render spec"
 * for the rationale: --goal is too saturated against a gradient, so
 * StatTrio scopes a lighter amber/green/red/race/dist set).
 */

import type { Stat, ValueColor } from '@/lib/faff/types';
import styles from './StatTrio.module.css';

export interface StatTrioProps {
  stats: Stat[];
  /**
   * Visual scale. `poster` is the default at 36px (used inside the hero
   * Poster). `compact` shrinks to 24px for embedded usages (e.g. inside
   * BCards on plan/me).
   */
  size?: 'poster' | 'compact';
}

const VALUE_COLOR_CLASS: Record<NonNullable<ValueColor>, string> = {
  default: styles.valueDefault,
  amber: styles.valueAmber,
  green: styles.valueGreen,
  over: styles.valueOver,
  race: styles.valueRace,
  dist: styles.valueDist,
};

export function StatTrio({ stats, size = 'poster' }: StatTrioProps) {
  if (stats.length === 0) return null;
  if (stats.length > 3) {
    // Hard constraint per spec · 2 or 3 stats only. Render the first 3
    // and log so the engine catches drift. Production: render first 3
    // without warning to avoid leaking a console message to the runner.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[StatTrio] received ${stats.length} stats — spec allows 2 or 3 only. Rendering first 3.`,
      );
    }
  }

  const visible = stats.slice(0, 3);

  return (
    <div
      className={`${styles.row} ${size === 'compact' ? styles.compact : ''}`.trim()}
      data-size={size}
    >
      {visible.map((stat, i) => (
        <div key={i} className={styles.stat}>
          <span
            className={`${styles.value} tabular ${VALUE_COLOR_CLASS[stat.valueColor ?? 'default']}`}
          >
            {stat.value}
          </span>
          <span className={styles.label}>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
