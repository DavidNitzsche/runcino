/**
 * MileChip — single mile splits chip from the locked run-detail template.
 *
 * The signature pattern is a top accent stripe rendered with
 * `box-shadow: inset 0 2px 0 <color>` (NOT `border-top`, which produces
 * square corners on a rounded chip).
 *
 * Variants:
 *   - good (default): green accent — easy/on-pace mile
 *   - att:            amber accent — climb / attention mile
 *   - warn:           red accent — over-target / fade mile
 *   - coach:          blue accent — coach-flagged mile
 *
 * The grade label colors itself based on the `gradeKind` prop ("up",
 * "steep", "down", "flat").
 */

import type { ReactNode } from 'react';

export type MileChipVariant = 'good' | 'att' | 'warn' | 'coach';

export type MileGradeKind = 'up' | 'steep' | 'down' | 'flat';

export interface MileChipProps {
  /** Label shown top-left — typically "M1", "M2", ..., "KICK 0.7", etc. */
  label: ReactNode;
  /** Pace value — large display number. */
  pace: ReactNode;
  /** HR + zone string — small mono caption beneath the pace. */
  hr?: ReactNode;
  /** Grade percent (e.g. "+1.6%", "−2.1%"). Rendered top-right. */
  grade?: ReactNode;
  gradeKind?: MileGradeKind;
  variant?: MileChipVariant;
}

const GRADE_CLASS: Record<MileGradeKind, string> = {
  up: 'up',
  steep: 'steep',
  down: 'down',
  flat: 'flat',
};

export function MileChip({
  label,
  pace,
  hr,
  grade,
  gradeKind = 'flat',
  variant = 'good',
}: MileChipProps) {
  const variantClass = variant === 'good' ? '' : ` ${variant}`;
  return (
    <div className={`mile-chip${variantClass}`}>
      <div className="mile-chip-h">
        <span className="label">{label}</span>
        {grade !== undefined && (
          <span className={`grade ${GRADE_CLASS[gradeKind]}`}>{grade}</span>
        )}
      </div>
      <div className="pace">{pace}</div>
      {hr !== undefined && <div className="hr">{hr}</div>}
    </div>
  );
}
