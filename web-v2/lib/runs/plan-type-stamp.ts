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

/**
 * WATCHMATCH-1 (2026-09-11) · the ONE candidate-selection algorithm every
 * completion-write path uses to decide which of a day's several
 * prescriptions (if any) a completed activity satisfies.
 *
 * `/api/ingest/workout` (EXECIDENT-2, 2026-09-04) already applied this exact
 * band-plus-refusal shape, inlined at its own call site. `/api/watch/
 * workouts/complete` — the app's own live tracker for watch, phone-GPS and
 * treadmill sessions, and the PRIMARY, tier-5 canonical writer — carried a
 * SEPARATE, never-imported copy of the OLD symmetric `[0.7, 1.3]` band and
 * picked whichever candidate's distance was numerically closest when more
 * than one fit, silently. Confirmed live: docs/audit-2026-09-10-brain-
 * adaptation-forensic-audit-v2-CORRECTED.md §7 — "the asymmetric fix only
 * reached the secondary ingest route... the exact bug class OVERRUN-MATCH-1
 * was built to fix is still live on the dominant write path." Both routes
 * now call this one function so the two can never again drift into two
 * different bands or two different ambiguity postures.
 *
 * Rule 11: "zero matches" and "two-or-more plausible matches" are different
 * facts, not degrees of the same uncertainty. Zero is a definite, positive
 * answer (this run satisfies none of today's prescriptions) and is returned
 * as `{ ok: true, value: null }`. Two or more is a refusal to guess between
 * live prescriptions — `{ ok: false, refusal }` — mirroring the discriminated-
 * union contract `lib/training/normal-window.ts`'s `NormalReading<T>` uses
 * for the identical reason: the refusal branch carries no `value` field, so
 * `result.value` does not compile until the caller has branched on `ok`.
 */
export interface PlanDayCandidate {
  id: string;
  distanceMi: number | null;
}

export interface PlanDayMatchRefusal {
  code: 'ambiguous-plan-day-match';
  /** Coach-log/audit safe, never shown to the runner verbatim. */
  message: string;
  dateISO: string;
  actualMi: number;
  /** Every candidate id that plausibly matched — logged so a future manual-
   *  resolution surface (none exists yet, 2026-09-11) has something to
   *  resolve rather than re-deriving the ambiguity from scratch. */
  candidateIds: string[];
}

export type PlanDayMatch<T> =
  | { ok: true; value: T | null }
  | { ok: false; refusal: PlanDayMatchRefusal };

/**
 * Select the one plan-day candidate `actualMi` matches within
 * `distanceMatchesPlan`'s asymmetric band, or refuse when more than one
 * candidate plausibly fits.
 */
export function selectMatchingPlanDay<T extends PlanDayCandidate>(
  dateISO: string,
  actualMi: number,
  candidates: readonly T[],
): PlanDayMatch<T> {
  const matches = candidates.filter((c) => distanceMatchesPlan(actualMi, c.distanceMi));
  if (matches.length <= 1) {
    return { ok: true, value: matches[0] ?? null };
  }
  return {
    ok: false,
    refusal: {
      code: 'ambiguous-plan-day-match',
      message: `${matches.length} prescriptions on ${dateISO} fit ${actualMi}mi within `
        + 'the overrun band; refusing to guess which one this run satisfies.',
      dateISO,
      actualMi,
      candidateIds: matches.map((c) => c.id),
    },
  };
}
