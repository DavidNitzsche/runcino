/**
 * lib/runs/plan-type-stamp.ts · the ONE place that decides whether a
 * device-ingested run's distance is close enough to a day's prescription to
 * inherit that prescription's `type` (feeding `data.workoutType` /
 * `workoutTypeSource: 'plan'`, the LEGACY tier `lib/execution/day-resolver
 * .ts` trusts).
 *
 * OVERRUN-MATCH-1 (2026-09-04). The band used to be symmetric, ±30%, and a
 * real easy day paid for it: prescribed 4.5 mi, run 6.18 mi (+37%), one
 * hair past the 5.85 mi ceiling — so the run got no type stamp at all and
 * `day-resolver.ts` filed it as SUPPLEMENTAL, a stranger to the very
 * session it was. David, watching it live: "Mondays run did match it just
 * went longer."
 *
 * The two directions are not the same signal. A run materially SHORTER
 * than prescribed is plausibly a different session (a bail, an unplanned
 * rest-day jog) — CLAUDE.md's own mission statement is explicit that the
 * app must recognize a runner who "pushes forward" and the plan "has to
 * push us more and more" in return; treating a longer easy day as a
 * stranger to its own prescription is the opposite of that. So the floor
 * stays tight (-30%, unchanged) and the ceiling opens wide (+100%, double
 * the prescription) — generous enough to cover a runner adding real
 * distance onto an easy day without opening the door to an unrelated, much
 * longer effort (a marathon is still nowhere near 2x a 4.5 mi easy day)
 * landing on the wrong prescription.
 *
 * Extracted out of `app/api/ingest/workout/route.ts` so this exact band —
 * the thing that broke — is unit-testable on its own, not only reachable
 * through a full ingest POST. See `_plan_type_stamp.test.ts`.
 */

/** Multiplier band around a day's prescribed distance a run's actual
 *  distance must fall within to inherit that day's plan `type`. */
const PLANNED_DISTANCE_FLOOR_MULT = 0.7;
const PLANNED_DISTANCE_CEILING_MULT = 2.0;

/**
 * True when `actualMi` is close enough to `plannedMi` that the run can be
 * trusted to be THAT prescription, not a different session that happens to
 * share a calendar date. A `plannedMi` of null or non-positive has no
 * distance to compare against — every distance matches (e.g. an "as
 * prescribed" workout with no authored mileage).
 */
export function distanceMatchesPlan(actualMi: number, plannedMi: number | null): boolean {
  if (plannedMi == null || plannedMi <= 0) return true;
  return actualMi >= plannedMi * PLANNED_DISTANCE_FLOOR_MULT
    && actualMi <= plannedMi * PLANNED_DISTANCE_CEILING_MULT;
}
