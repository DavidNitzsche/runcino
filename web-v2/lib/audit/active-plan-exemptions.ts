/**
 * lib/audit/active-plan-exemptions.ts · the argued exceptions to ACTIVEPLAN-1.
 *
 * THE BUG CLASS. `clearActivePlansFor` archives a training plan but never
 * deletes its `plan_workouts`. So a query that joins the two tables on nothing
 * but `user_uuid` returns one row per date PER PLAN VERSION. The owner has 47
 * plan rows and exactly one active; `training_plans` carries `archived_iso` and
 * a unique index `training_plans_active_uq` on `user_uuid WHERE archived_iso IS
 * NULL`, so "the active plan" is precisely defined and simply was not asked for.
 *
 * WHAT IT COST, on 2026-08-30, all four found on the same afternoon:
 *
 *   · `recentQualityPerWeek` returned 36 instead of 1-2 — 59 "quality sessions"
 *     counted in one week across 43 plan versions. `densityForWeek` opens with
 *     `recentQ >= desiredDensity`, so Rule 5's quality-density ramp had NEVER
 *     fired for any runner whose plan had ever been rebuilt, which is everyone.
 *   · `recentQualityDistanceMi` became a plan-version-weighted median.
 *   · `detectMidBlock` signal 1 counted prescribed rows across versions, and it
 *     gates whether a runner receives BASE weeks at all.
 *   · The coach log rendered SIX week-close cards for `week:2026-08-17`, with
 *     contradictory planned mileage (17, 35, 3, 25.5, 1.8, 14) — one per
 *     generation.
 *
 * None of it failed anything. Every output was well-formed; only the numbers
 * were fiction. That is why this is a scanner and not a unit test.
 *
 * WHAT COUNTS AS GUARDED. A statement joining `plan_workouts` to
 * `training_plans` must either constrain to the active plan (`archived_iso`) or
 * pin one plan by id. Anything else lands here with a reason, or fails.
 *
 * The allowlist is a RATCHET: it may shrink, never grow, in the same posture as
 * `swallowed-failure-registry.ts`'s `EMPTIED_BASELINE`. An entry whose file no
 * longer trips the scanner is itself a failure, so a fix forces its deletion.
 */

export interface ActivePlanExemption {
  /** Repo-relative path, as the scanner reports it. */
  file: string;
  /** Why reading across archived plans is correct HERE. Not "it is fine". */
  reason: string;
}

/**
 * Seeded 2026-08-30 from the five statements standing after the quality-habit
 * readers were repointed at the runner's own runs. Every reason below was
 * checked against the statement's own direction of error, not assumed.
 */
export const ACTIVE_PLAN_EXEMPTIONS: readonly ActivePlanExemption[] = [
  {
    file: 'lib/plan/drift-monitor.ts',
    reason:
      'NOT EXISTS exclusion. Reading across archived plans can only EXCLUDE MORE ' +
      'days, never invent one, and the file\'s own comment names over-exclusion as ' +
      'the safe direction for a drift detector. Wrong-but-conservative.',
  },
  {
    file: 'lib/training/decoupling-trend.ts',
    reason:
      'Same NOT EXISTS shape and the same safe direction: a run wrongly believed ' +
      'to have been a prescribed quality day is dropped from the decoupling ' +
      'sample. It shrinks the sample; it cannot corrupt a value in it.',
  },
  {
    file: 'lib/plan/adapt.ts',
    reason:
      'Existence test for "did a run land on this plan day", used to decide ' +
      'whether a day is already answered. Duplicated rows across versions ' +
      'collapse to the same boolean, so version count cannot change the answer.',
  },
  {
    file: 'lib/plan/injury-builder.ts',
    reason:
      'LATENT, NOT SAFE — kept deliberately and tracked. Reads the runner\'s own ' +
      'easy/long pace band, ORDER BY date_iso DESC LIMIT 1, across all versions; ' +
      'an archived plan holds future-dated rows and can win. Measured 2026-08-30: ' +
      'identical (582) across every version for this runner, so latent rather than ' +
      'live. Left because reading a HISTORICAL band is arguably the intent here — ' +
      'it wants the pace the runner was trained at, not the pace of the plan that ' +
      'happens to be active. Resolve the intent before changing the query.',
  },
  {
    file: 'scripts/vdot-tuneup-impact.analysis.ts',
    reason:
      'One-off analysis script, not production. Reads tune-up dates across the ' +
      'whole plan history ON PURPOSE, which is what a retrospective wants.',
  },
];
