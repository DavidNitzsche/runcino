/**
 * lib/faff/key-workout-state.ts · the state badge on a KEY WORKOUTS row.
 *
 * ── The defect ───────────────────────────────────────────────────────
 * TrainView derived the badge once per WEEK, from the week index alone:
 *
 *     const state = isPast ? 'DONE' : isNow ? 'NOW' : '';
 *
 * then stamped that one value onto every quality workout inside the week.
 * A week in the past therefore made every one of its key workouts DONE,
 * whether the runner ran them or not.
 *
 * The list then filtered `!m.done` to keep the rolling window pointed at
 * upcoming work — which meant the ONLY past rows that ever reached the
 * screen were the ones the runner did NOT complete. Every past row the
 * runner could see was a missed session wearing a DONE badge. The two
 * bugs hid each other: the derivation was wrong for completed workouts
 * too, but those were filtered out before anyone could notice.
 *
 * This is worse than cosmetic. A runner scanning KEY WORKOUTS for what
 * they have and have not done reads a completed block; the plan says the
 * threshold work happened. Nothing else on the page contradicts it.
 *
 * ── The fix ──────────────────────────────────────────────────────────
 * The badge describes ONE workout, so it is derived per workout, from
 * that workout's own `done` flag, with the week index supplying only the
 * past/now/future frame. A past workout that was not completed is MISSED.
 *
 * Pure and synchronous.
 */

export type KeyWorkoutState = 'DONE' | 'MISSED' | 'NOW' | 'RACE' | '';

/**
 * Colour for the MISSED badge.
 *
 * `#8A90A0` — the neutral grey this file's surface already uses for the
 * `compromised` influence kind ("downgraded, not the runner's fault") and
 * as the fallback workout dot. It sits in the design brief's neutral
 * register (§Neutrals, "Text/secondary"), NOT in the locked ten semantic
 * accents.
 *
 * That is the point. `#FC4D64` (Off/warn) is the brief's alarm hue, spoken
 * for by "behind goal, off-track, warning signal" — a status the app is
 * asserting about the runner's trajectory. A missed session is not a
 * status, it is a record: this workout was on the plan and it did not
 * happen. The plan adapter has already had its say about what that means
 * for the block, and the influence line on the same row carries the
 * coaching read. Painting the badge red would make the row argue with
 * itself and would put an alarm on a fact, which is app voice, not coach
 * voice. Grey states it and moves on.
 */
export const MISSED_COLOR = '#8A90A0';

/**
 * Badge for one key workout.
 *
 * @param weekIdx  index of the workout's plan week
 * @param nowIdx   index of the current plan week
 * @param done     did the runner complete THIS workout
 */
export function keyWorkoutState(
  weekIdx: number,
  nowIdx: number,
  done: boolean,
): KeyWorkoutState {
  // The flag is the fact, in every frame. A workout the runner ran is
  // DONE whether the plan expected it this week, last week, or next.
  if (done) return 'DONE';
  // Not run, and its week is behind us: it did not happen.
  if (weekIdx < nowIdx) return 'MISSED';
  // The current week is still live — an incomplete quality day in it has
  // not been missed, it is today's or later this week's work.
  if (weekIdx === nowIdx) return 'NOW';
  return '';
}
