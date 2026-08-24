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
  // 2026-08-17 · race-lifecycle · /api/today/purpose emits type
  // 'post_race' in the window right after a goal race when no plan row
  // exists yet (result not logged / next block not generated). Not a
  // plan_workouts type — a today-state. Native decodes purpose.type as
  // a plain String and renders typeTitle verbatim, so the new wire
  // value is additive-safe.
  post_race: 'RACE DONE',
};

/**
 * Returns the one-word title for a workout type · always uppercase ·
 * never null (falls back to UNPLANNED for unknown types so the hero
 * always renders SOMETHING).
 */
export function workoutTypeTitle(type: WorkoutType | string | null | undefined): string {
  if (!type) return 'UNPLANNED';
  const key = String(type).toLowerCase();
  const mapped = TITLE_BY_TYPE[key];
  if (mapped) return mapped;

  // AN UNMAPPED TYPE MUST NOT REACH THE GLASS AS A RAW ENUM.
  //
  // The fallback used to be `key.toUpperCase()`, which is how a plan type
  // headlined a screen in 44pt Archivo as `RACE_WEEK_TUNEUP` — the token
  // itself, underscores and all, in the display register. The map has covered
  // that particular type since, but the fallback is the actual defect and it
  // was still waiting for the next type nobody remembered to add here.
  //
  // Underscores become spaces so the worst case is a clumsy phrase rather than
  // something that reads as a leaked database value. `check-enum-register.sh`
  // fails the build when a type the plan can emit has no entry above, so this
  // is a floor, never a substitute for the map.
  return key.replace(/_/g, ' ').toUpperCase();
}

/** The vocabulary this map covers. Exported so gates can enumerate it. */
export const TITLED_WORKOUT_TYPES: readonly string[] = Object.keys(TITLE_BY_TYPE);
