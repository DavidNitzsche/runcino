/**
 * lib/coach/workout-title.ts · one-word hero title for the Today card.
 *
 * David's flag 2026-06-02: the Today card hero was rendering the
 * `sub_label` ("4×1 MI @ ...") which truncated awkwardly. Every run
 * should have a one-word title: TEMPO, EASY, INTERVALS, LONG, etc.
 *
 * Single source of truth across web + iPhone + watch so the
 * vocabulary stays consistent. Surfaced on /api/today/purpose as
 * `typeTitle: string`.
 *
 * Locked vocabulary (matches the type field on plan_workouts):
 *
 *   type field      typeTitle    notes
 *   ──────────────  ───────────  ─────────────────────────────────
 *   easy            EASY
 *   recovery        RECOVERY     (separate from EASY · slower pace)
 *   long            LONG
 *   tempo           TEMPO
 *   threshold       THRESHOLD
 *   intervals       INTERVALS
 *   vo2max          INTERVALS    (alias · same shape)
 *   progression     PROGRESSION
 *   fartlek         FARTLEK
 *   shakeout        SHAKEOUT
 *   race            RACE
 *   race_week_tuneup TUNE-UP     (compact for the hero)
 *   rest            REST
 *   cross           CROSS-TRAIN
 *   strength        STRENGTH
 *   unplanned       UNPLANNED
 *
 * Companion to lib/faff/glance-adapter.ts § typeLabel() which produces
 * the 4-char (TMPO / INTS / THRS) for the dense glance · this map
 * produces the wide hero word.
 */

import type { WorkoutType } from './run-purpose';

const TITLE_BY_TYPE: Record<string, string> = {
  easy: 'EASY',
  recovery: 'RECOVERY',
  long: 'LONG',
  tempo: 'TEMPO',
  threshold: 'THRESHOLD',
  intervals: 'INTERVALS',
  vo2max: 'INTERVALS',
  progression: 'PROGRESSION',
  fartlek: 'FARTLEK',
  shakeout: 'SHAKEOUT',
  race: 'RACE',
  race_week_tuneup: 'TUNE-UP',
  rest: 'REST',
  cross: 'CROSS-TRAIN',
  strength: 'STRENGTH',
  unplanned: 'UNPLANNED',
};

/**
 * Returns the one-word title for a workout type · always uppercase ·
 * never null (falls back to UNPLANNED for unknown types so the hero
 * always renders SOMETHING).
 */
export function workoutTypeTitle(type: WorkoutType | string | null | undefined): string {
  if (!type) return 'UNPLANNED';
  const key = String(type).toLowerCase();
  return TITLE_BY_TYPE[key] ?? key.toUpperCase();
}
