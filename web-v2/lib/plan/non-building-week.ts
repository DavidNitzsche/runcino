/**
 * lib/plan/non-building-week.ts · ONE answer to "is the plan deliberately not
 * building this week".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (Rule 16 · one quantity, one name)
 *
 * Two predicates answered it, and they disagreed on RECOVERY:
 *
 *   `lib/training/coaching-thesis.ts`   TAPER, RECOVERY, race week, cutback
 *   `lib/plan/progression-pass.ts`      TAPER,           race week, cutback
 *
 * `weekRowNoStepReason` is the one the levers read — the density pass, and
 * since 2026-09-02 the Adaptation Engine's VOLUME and DURATION levers through
 * `lib/adaptation/load-adaptation-engine.ts`. Its own doc comment calls itself
 * "THE one definition (Rule 16)", and it was missing the phase under which the
 * plan is MOST deliberately not building.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE FLAGS COULD NOT COVER FOR IT
 *
 * A recovery block is a REVERSE TAPER: `RECOVERY_WEEKLY_PCT_OF_BASE` in
 * `lib/plan/goal-tiers.ts` rises every week for every distance. So
 * `is_cutback` — defined in `generate.ts#planWeekFlags` as a >15% drop off the
 * week before — is FALSE on a recovery week that actually rises, and correctly
 * so. Measured on production 2026-09-03, `faff_readonly`: 4 recovery plans, 6
 * weeks, `is_cutback = FALSE` on all six, and `is_peak = TRUE` on FOUR of the
 * six because the argmax of a rising block is always its last week.
 * `pln_eb73331e19230ad9` week 1 (23.0 mi, the week after his A-race half) is
 * flagged the PEAK week of its block.
 *
 * CORRECTION 2026-09-03 · this paragraph said `is_cutback` was false on every
 * recovery week "BY CONSTRUCTION". That is not true, and the sweep in
 * `_recovery_block_flags.test.ts` is what found it: the claim holds for all six
 * production rows and for every block composed at 5, 6 and unset days a week,
 * but NOT at three. A marathon recovery block for a 3-day-a-week runner
 * composes 6 -> 15 -> 12 -> 18 mi, because the run-day cap bites unevenly
 * across the reverse taper's percentages. Week 2 drops 20% off week 1, the
 * >15% rule fires honestly, and the flag outranks the label, so
 * `weekRowNoStepReason` answers CUTBACK rather than RECOVERY there. The week is
 * still correctly NO-STEP, which is the property the levers depend on, so
 * nothing unsafe follows — but the block is not the monotonic reverse taper
 * doctrine describes, and this module may not claim an invariant it does not
 * have (Rule 18 pointed at prose: gate the sentence or delete it). What is
 * gated is the weaker, true statement, in `_recovery_block_flags.test.ts`
 * assertion 2: every recovery week is NO-STEP, and the phase-label rung always
 * reads RECOVERY whatever the flag did.
 *
 * `is_peak` was the separate half, and it WAS a defect on all four rows. Fixed
 * by PEAK-NOT-NONBUILDING-1 in `planWeekFlags`, which reads this module.
 *
 * With no cutback flag and no RECOVERY case, `weekRowNoStepReason` returned
 * null for a post-race recovery week and all three progression levers would
 * have taken a step during it. That did not reach a runner — all four recovery
 * plans are archived and none is active — but it is armed for the next runner
 * who finishes a race, which is every runner.
 *
 * The phase label is the honest carrier and it always was: `plan_phases.label`
 * says RECOVERY, and no flag has to be bent to say it a second way. Writing
 * `is_cutback = TRUE` onto a rising week to make the predicate fire would make
 * the column lie, and `lib/plan/established-cadence.ts` derives the runner's
 * deload CADENCE from the spacing of those flags.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT ANSWER (Rule 22)
 *
 * Whether the FLAGS it is handed are right. It reads `is_cutback` and
 * `is_race_week` as given. A week wrongly flagged a cutback still reads as one
 * here, and nothing in this module can tell. The phase label is the rung that
 * does not depend on a boolean being computed correctly, which is the whole
 * reason RECOVERY belongs on it rather than on a flag.
 */

/**
 * `plan_phases.label` values under which the plan is not building on purpose.
 *
 * Upper case, because the labels are stored upper case and callers normalise.
 * Production holds nine distinct labels (2026-09-03): TAPER 49, BASE 36,
 * RACE_WEEK 27, PEAK 27, BUILD 27, RACE-SPECIFIC 22, QUALITY 22,
 * MAINTENANCE 5, RECOVERY 4.
 *
 * RACE_WEEK is deliberately NOT here. `is_race_week` is its own rung on both
 * callers, it is the flag the reschedule path resolves from the race calendar
 * rather than from a label, and adding the label as a second spelling would be
 * the same duplication this module exists to remove.
 *
 * MAINTENANCE is deliberately NOT here either. A maintenance block is not
 * building toward a race, but it is not a prescribed easing: the runner is
 * training normally and a progression step is a legitimate answer.
 */
export const NON_BUILDING_PHASE_LABELS: ReadonlySet<string> = new Set([
  'TAPER',
  'RECOVERY',
]);

/** True when this phase label is one the plan eases through on purpose.
 *  Null, empty and unknown labels are all false — an absent label is "no
 *  information", never "not building" (Rule 11). */
export function isNonBuildingPhaseLabel(label: string | null | undefined): boolean {
  if (label == null) return false;
  return NON_BUILDING_PHASE_LABELS.has(label.trim().toUpperCase());
}
