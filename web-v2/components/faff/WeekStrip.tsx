'use client';

/**
 * WeekStrip · the THIS WEEK header + 7 day cards with accent bars.
 * Spec: design/components/WeekStrip.md
 *
 * Renders 7 day cards regardless of viewport — never collapses to a
 * scrolling carousel (per spec, the arc must be readable in one
 * glance). Future days fade to 0.5 opacity; today gets a white
 * outline; completed days get a small check badge.
 *
 * Card content is two-line per Round 4 (locked 2026-05-28):
 *   line 1 · mileage (Inter 700wt tabular)  — `plannedDistance` ("—" on rest)
 *   line 2 · type label (Inter 700wt caps)  — `plannedTypeLabel` (closed vocab)
 * The legacy single-line freeform `plannedLabel` field is no longer rendered
 * (see WeekStrip.md "Note on the prior `plannedLabel?` field" + the
 * @deprecated note on the shared/types.ts WeekStripPayload).
 */

import type { WeekStripPayload, WorkoutType } from '@/lib/faff/types';
import styles from './WeekStrip.module.css';

export interface WeekStripProps {
  payload: WeekStripPayload;
  /** Optional `BUILD WK 6 of 8` style subtitle */
  phaseLabel?: string;
}

const DOW_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

const ACCENT_VAR: Partial<Record<WorkoutType, string>> = {
  easy: 'var(--green)',
  quality: 'var(--goal)',
  long: 'var(--dist)',
  rest: 'var(--rest)',
  cross: 'var(--learn)',
  race: 'var(--race)',
  // recovery / shakeout / strength fall back to muted line color
};

/**
 * Day-card state · the 5 enum per WeekStrip.md §"Day-card states (the 5)".
 * Client-derived from the 4 payload signals — no `status` field on the wire
 * format (single source of truth lives in the spec's truth table).
 */
type DayCardState = 'done' | 'today' | 'planned' | 'missed' | 'rest';

/**
 * Truth table resolver · maps (isToday, isFuture, completedRunId, plannedType)
 * → DayCardState. Order matters: rest short-circuits first (a planned rest
 * never "misses"), then done (a completed run is done regardless of past/today),
 * then today, then the past/future split. The same lookup runs on iOS per the
 * Design spec (handoff 2026-05-28-design-to-project-lead-weekstrip-missed.md).
 */
function resolveDayState(d: WeekStripPayload['days'][number]): DayCardState {
  if (d.plannedType === 'rest') return 'rest';
  if (d.completedRunId !== null) return 'done';
  if (d.isToday) return 'today';
  if (d.isFuture) return 'planned';
  // past + not today + no completion + not rest → missed
  return 'missed';
}

export function WeekStrip({ payload, phaseLabel }: WeekStripProps) {
  if (payload.days.length === 0) {
    // Empty / setup state — server has no week yet.
    // Per design/pages/today.md, the placeholder copy is "Plan begins after
    // setup" (post-2026-05-28 onboarding simplification · the step count
    // is no longer a fixed reference now that scope is 2-3 steps).
    return (
      <section className={styles.empty} aria-label="Plan begins after setup">
        <span className={styles.label}>PLAN BEGINS AFTER SETUP</span>
      </section>
    );
  }

  const { plannedMi, completedMi } = payload.totals;

  return (
    <section className={styles.strip} aria-label="This week">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.label}>THIS WEEK</span>
          {phaseLabel && <span className={styles.phaseLabel}>{phaseLabel}</span>}
        </div>
        <div className={`${styles.total} tabular`}>
          {fmt(completedMi)} / {fmt(plannedMi)} mi
        </div>
      </header>

      <div className={styles.row} role="list">
        {payload.days.map((d) => {
          const accent = ACCENT_VAR[d.plannedType ?? 'easy'] ?? 'var(--line)';
          const state = resolveDayState(d);
          // Top line · mileage. Rest + cross days carry `—` rather than a
          // number so the 7-day vertical rhythm stays consistent (per
          // WeekStrip.md §"Type label vocabulary" — REST + CROSS rows
          // both render mileage as `—`). Future days with no plan yet
          // also fall back to `—`.
          const mileageText =
            d.plannedType === 'rest' ||
            d.plannedType === 'cross' ||
            d.plannedDistance == null ||
            d.plannedDistance === 0
              ? '—'
              : fmt(d.plannedDistance);
          return (
            <div
              key={d.date}
              role="listitem"
              className={[
                styles.day,
                state === 'today' ? styles.dayToday : '',
                state === 'planned' ? styles.dayFuture : '',
                state === 'missed' ? styles.dayMissed : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={d.isToday ? 'date' : undefined}
            >
              <span className={styles.accent} style={{ background: accent }} aria-hidden />
              <span className={styles.dow}>{DOW_LABELS[d.dow]}</span>
              <span className={`${styles.mileage} tabular`}>{mileageText}</span>
              {/* Bottom line · caps-tracked type label from the closed
                  4-char vocabulary (EASY · INTS · TMPO · THRS · FART ·
                  QUAL · LONG · REST · XTRN · RACE · —) — locked 2026-05-28
                  per WeekStrip.md. Backend derives + emits; client never
                  parses. */}
              <span className={styles.typeLabel}>{d.plannedTypeLabel || '—'}</span>
              {state === 'done' && (
                <span className={styles.check} aria-label="Completed">
                  ✓
                </span>
              )}
              {state === 'missed' && (
                <span className={styles.missedGlyph} aria-label="Missed">
                  —
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}
