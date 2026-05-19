/**
 * shoe-picker · pick the user's preferred shoe for a planned workout
 * type, when the choice is unambiguous.
 *
 * Used by the Strava sync pass to auto-assign a shoe to a freshly
 * synced activity that the user hasn't tagged yet. The rule is
 * deliberately conservative: when more than one active shoe matches a
 * run type and the user hasn't flagged a clear preference among them,
 * we leave shoe_id NULL and let the user pick. Better to make the
 * user tap once than to silently log miles against the wrong shoe.
 *
 * Source: ported from `claude/build-runcino-app-OIRJr` commit
 *   29887d6 ("feat(sync): shoe-picker with preferred-wins +
 *   ambiguity bailout") — adapted to main's module layout. The dev
 *   branch's plan-match.ts dependency is inlined here as
 *   `runTypeForWorkout` since plan-match doesn't exist on main.
 *
 * Matching:
 *   1. Active (retired=false) shoes whose run_types includes the
 *      workout's mapped shoe-RunType (e.g. plan "easy" → 'easy';
 *      plan "threshold" → 'tempo' via runTypeForWorkout).
 *   2. If `preferred=true` shoes exist in that filtered set, narrow
 *      to those. The user explicitly flagged them, so they win.
 *   3. If exactly one candidate remains → assign.
 *   4. If 0 → fall back to active shoes tagged 'as_needed' (also
 *      under the preferred-narrowing rule).
 *   5. Still ambiguous (>1) → null. Ambiguity is the user's call.
 *
 * Recovery rollup: a 'recovery' (or 'general_aerobic') workout type
 * also accepts shoes tagged 'easy' — recovery days run on easy shoes
 * when the rotation doesn't carry a dedicated recovery pair.
 */

import { listShoes } from './shoe-store';
import type { RunType, Shoe } from './shoe-utils';

/** Map a synthetic-plan workout type to a shoe RunType. Mirror of
 *  the function on dev's plan-match.ts, inlined here so this module
 *  is self-contained on main. */
export function runTypeForWorkout(type: string): RunType {
  switch (type) {
    case 'race':      return 'race';
    case 'long':      return 'long';
    case 'recovery':  return 'recovery';
    case 'shakeout':  return 'recovery';
    case 'easy':      return 'easy';
    case 'threshold': return 'tempo';
    case 'mp':        return 'tempo';
    case 'quality':   return 'tempo';   // synthetic-plan label
    case 'interval':  return 'intervals';
    case 'intervals': return 'intervals';
    default:          return 'as_needed';
  }
}

/** RunTypes the shoe needs to cover this workout. Most workout types
 *  map to a single shoe RunType, but 'recovery' rolls up to include
 *  'easy' so a single-shoe-per-purpose rotation still gets matched. */
function eligibleShoeRunTypes(workoutType: string): RunType[] {
  if (workoutType === 'recovery' || workoutType === 'general_aerobic' || workoutType === 'shakeout') {
    return ['recovery', 'easy'];
  }
  return [runTypeForWorkout(workoutType)];
}

/** Find the user's preferred shoe for the given workout type, or null
 *  when no shoe matches OR multiple match with no clear preference.
 *  The _userId arg is reserved for future multi-tenant filtering —
 *  listShoes() on main is currently single-tenant. */
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
