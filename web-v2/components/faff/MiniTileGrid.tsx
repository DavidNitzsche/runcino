'use client';

/**
 * MiniTileGrid · the 2×N grid of status-dot tiles inside Sibling.
 * Spec: design/components/MiniTileGrid.md
 *
 * Tile count is 4 or 6 only · enforced softly in dev. The dot color is
 * a status judgement (green/amber/over band); the value color is an
 * emphasis cue (sometimes mirrors the dot, sometimes doesn't — e.g. a
 * 100% Z2 tile gets both green dot and green value, doubling the alarm).
 */

import type {
  MiniTile,
  SetupStepTile,
  DotColor,
  ValueColor,
} from '@/lib/faff/types';
import styles from './MiniTileGrid.module.css';

export interface MiniTileGridProps {
  /**
   * Tiles in the grid. Most states pass a homogeneous `MiniTile[]`. The
   * `new_user` Sibling passes a mixed array — `SetupStepTile` for the
   * required/optional setup steps and a plain `MiniTile` for the trailing
   * informational "what's next" tile (per design/resolver/states.md §11
   * simplified-onboarding scope). The discrimination is structural:
   * `isSetupStepTile()` below checks for the `stepIndex` field.
   */
  tiles: Array<MiniTile | SetupStepTile>;
  /**
   * Optional · last tile carries an action (Tomorrow proposal, niggle
   * detail, race-week shakeout link). When set, the matching tile renders
   * with the amber accent border per spec.
   */
  actionTileIndex?: number;
}

const DOT_COLOR_CLASS: Record<DotColor, string> = {
  green: styles.dotGreen,
  amber: styles.dotAmber,
  over: styles.dotOver,
  dist: styles.dotDist,
  none: styles.dotNone,
};

const VALUE_COLOR_CLASS: Record<NonNullable<ValueColor>, string> = {
  default: styles.valueDefault,
  amber: styles.valueAmber,
  green: styles.valueGreen,
  over: styles.valueOver,
  race: styles.valueRace,
  dist: styles.valueDist,
};

function isSetupStepTile(t: MiniTile | SetupStepTile): t is SetupStepTile {
  return 'stepIndex' in t;
}

export function MiniTileGrid({ tiles, actionTileIndex }: MiniTileGridProps) {
  if (process.env.NODE_ENV !== 'production') {
    if (tiles.length !== 4 && tiles.length !== 6) {
      console.warn(
        `[MiniTileGrid] received ${tiles.length} tiles — spec allows 4 or 6 only (the 2-column grid only looks right at even counts).`,
      );
    }
  }

  return (
    <div className={styles.grid} role="list">
      {tiles.map((tile, i) => {
        const stepTile = isSetupStepTile(tile) ? tile : null;
        const isActionTile = actionTileIndex === i;
        const isInactiveStep = stepTile !== null && !stepTile.isActive && !stepTile.isCompleted;
        return (
          <div
            key={i}
            role="listitem"
            className={[
              styles.tile,
              isActionTile ? styles.tileAction : '',
              isInactiveStep ? styles.tileInactive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-step-index={stepTile?.stepIndex}
            data-completed={stepTile?.isCompleted ? 'true' : undefined}
            data-active={stepTile?.isActive ? 'true' : undefined}
          >
            {tile.dot !== 'none' && (
              <span className={[styles.dot, DOT_COLOR_CLASS[tile.dot]].join(' ')} aria-hidden />
            )}
            <div className={styles.label}>{tile.label}</div>
            <div className={styles.valueRow}>
              <span
                className={[
                  styles.value,
                  'tabular',
                  VALUE_COLOR_CLASS[tile.valueColor ?? 'default'],
                ].join(' ')}
              >
                {tile.value}
              </span>
              {tile.valueUnit && <span className={styles.valueUnit}>{tile.valueUnit}</span>}
            </div>
            <div
              className={styles.meta}
              // Engine writes the `<strong>` placement; safe because the
              // string comes from a server-side template (deterministic,
              // no LLM, no user input). If runner-authored input ever
              // lands here, swap for a sanitizer.
              dangerouslySetInnerHTML={renderMeta(tile.meta, tile.metaStrong)}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Engine sometimes flags a single strong word inside `meta` via the
 * `metaStrong` field. Wrap that substring in `<strong>` for emphasis;
 * the strong styling is set in the CSS module per spec. If the substring
 * isn't found we render meta plain.
 */
function renderMeta(meta: string, metaStrong?: string): { __html: string } {
  const safeMeta = escapeHtml(meta);
  if (!metaStrong) return { __html: safeMeta };
  const safeStrong = escapeHtml(metaStrong);
  // Replace the first occurrence only — same rule as CoachVoice inline
  // stat substitution (the engine guarantees uniqueness; we defend
  // against bugs by not double-styling).
  const safeStrongEscaped = safeStrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    __html: safeMeta.replace(new RegExp(safeStrongEscaped), `<strong>${safeStrong}</strong>`),
  };
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
