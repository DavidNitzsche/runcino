/**
 * shoe-picker · pick the user's preferred shoe for a planned workout
 * type, when the choice is unambiguous.
 *
 * Used by the Strava sync pass to auto-assign a shoe to a freshly
 * synced activity that the user hasn't tagged yet. The rule is
 * deliberately conservative: when more than one active shoe matches a
 * run type and the user hasn't flagged a clear preference among them,
 * we leave shoe_id NULL and let the user pick. Better to make the user
 * tap once than to silently log miles against the wrong shoe.
 *
 * Matching:
 *   1. Active (retired=false) shoes whose run_types includes the
 *      workout's mapped shoe-RunType (e.g. plan "easy" → 'easy';
 *      plan "threshold" → 'tempo' via runTypeForWorkout).
 *   2. If `preferred=true` shoes exist in that filtered set, narrow to
 *      those. The user explicitly flagged them, so they win.
 *   3. If exactly one candidate remains → assign.
 *   4. If 0 → fall back to active shoes tagged 'as_needed' (also under
 *      the preferred-narrowing rule).
 *   5. Still ambiguous (>1) → null. Ambiguity is the user's call.
 *
 * Recovery rollup: a 'recovery' (or 'general_aerobic') workout type
 * also accepts shoes tagged 'easy' — recovery days run on easy shoes
 * when the rotation doesn't carry a dedicated recovery pair.
 */

import { listShoes, type RunType, type Shoe } from './shoe-store';
import { runTypeForWorkout } from './plan-match';
import type { WorkoutType } from '../coach/plan-types';

/** RunTypes the shoe needs to cover this workout. Most workout types
 *  map to a single shoe RunType, but 'recovery' rolls up to include
 *  'easy' so a single-shoe-per-purpose rotation still gets matched. */
function eligibleShoeRunTypes(workoutType: string): RunType[] {
  if (workoutType === 'recovery' || workoutType === 'general_aerobic' || workoutType === 'shakeout') {
    return ['recovery', 'easy'];
  }
  // Reuse the plan-match mapping for everything else (easy, long,
  // threshold/mp → tempo, interval → intervals, race, rest → as_needed).
  // Cast: callers may pass freeform strings; unknown types fall through
  // to runTypeForWorkout's default ('as_needed').
  const mapped = runTypeForWorkout(workoutType as WorkoutType);
  return [mapped];
}

/** Find the user's preferred shoe for the given workout type, or null
 *  when no shoe matches OR multiple match with no clear preference. */
export async function pickShoeForWorkout(
  _userId: string,
  workoutType: string,
): Promise<number | null> {
  const shoes = await listShoes();
  return pickFromShoes(shoes, workoutType);
}

/** Pure variant — same logic against a caller-supplied shoe list.
 *  Exposed for tests + for callers that already loaded the rotation. */
export function pickFromShoes(shoes: Shoe[], workoutType: string): number | null {
  const eligibleTypes = eligibleShoeRunTypes(workoutType);
  const active = shoes.filter(s => !s.retired);

  const matchesTypes = (s: Shoe) =>
    s.run_types.some(rt => eligibleTypes.includes(rt));

  let candidates = active.filter(matchesTypes);

  if (candidates.length === 0) {
    // Fall back to 'as_needed' shoes — the user's catch-all rotation
    // entry. Same preferred-narrowing + ambiguity rules apply.
    candidates = active.filter(s => s.run_types.includes('as_needed'));
    if (candidates.length === 0) return null;
  }

  // If any preferred shoes exist among the candidates, narrow to them.
  const preferred = candidates.filter(s => s.preferred);
  if (preferred.length > 0) candidates = preferred;

  if (candidates.length === 1) return candidates[0].id;
  return null;
}
