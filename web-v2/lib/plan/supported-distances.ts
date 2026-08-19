/**
 * lib/plan/supported-distances.ts · which events Faff will write a plan for.
 *
 * ULTRA-OUT-1 (2026-08-19) · the owner's instruction was "lets remove ultra
 * plans and training for now", and this module is the one place that decides
 * it. Two things it is deliberately NOT:
 *
 *   · It is not a categorizer. `distanceCategoryOrNull` still answers 'ultra'
 *     for a 50K, and it must: the app has paid repeatedly for functions that
 *     answered a question they could not answer — `raceDistanceCategory(null)`
 *     returning 'hm', `distanceCategoryOf(0)` returning '5k'. A 50K IS an
 *     ultra. What changes is that the plan engine declines to author for one,
 *     out loud, rather than quietly handing back a marathon.
 *
 *   · It is not a deletion. `Research/22`'s ultra rows, `TIER_TARGETS.ultra`,
 *     `BLOCK_SHAPE.ultra`, the ultra taper depths and long-run caps all stay
 *     exactly where they are. This is "for now": re-opening authorship is
 *     meant to be a change to this file, not an archaeology exercise.
 *
 * WHY THE ENGINE IS NOT READY, concretely. `PLAN_TEMPLATES` carries four ultra
 * rows keyed by EXPERIENCE — beginner / intermediate / advanced /
 * advanced_plus — and every field in them is lifted verbatim from a different
 * ultra DISTANCE in `Research/22`: the beginner row is its 50K, intermediate
 * its 50 Mile, advanced its 100K, advanced_plus its 100 Mile. So the engine
 * reads a first-time 100-miler as "beginner" and hands them a 50K plan, and
 * reads an experienced 50K runner as "advanced" and hands them a 100K. The
 * axis is wrong, not the numbers, which is why this is a gate rather than a
 * tuning pass. See the note on those rows in `plan-templates.ts`.
 *
 * WHERE THE LINE SITS. Past the marathon, not at the 50 km ultra boundary.
 * `DISTANCE_CATEGORY_MAX_MI.m` puts the ultra floor at exactly 50 km, so a
 * 30-mile race categorises as 'm' — but Daniels' VDOT table stops at the
 * marathon (`DANIELS_MAX_VALID_DISTANCE_MI`), so every pace the plan would be
 * built from is already an extrapolation there, and the engine has refused
 * that distance since the 2026-07-07 ultra-honesty audit. Keeping the line
 * where it is means this change removes authorship; it does not quietly grant
 * any that was previously refused.
 */
import { DANIELS_MAX_VALID_DISTANCE_MI } from '@/lib/training/vdot';

/**
 * What the runner is told. One string, so the race path, the no-race goal
 * path and the simulator cannot drift into three different explanations of
 * the same refusal.
 *
 * It says three things on purpose: that the limit is Faff's and not theirs,
 * that nothing they entered was lost, and what happens instead. It does not
 * promise a date.
 */
export const ULTRA_UNSUPPORTED_REASON =
  "Ultra plans aren't built yet. The race is on your calendar; training targets stay anchored to your current fitness.";

/**
 * True when the plan engine will not author for this distance.
 *
 * Callers must REFUSE — surface `ULTRA_UNSUPPORTED_REASON` and leave the
 * runner on the no-plan / maintenance machinery. Never substitute a shorter
 * distance, and never fall through to a category the runner did not enter.
 */
export function planAuthorshipUnsupported(distanceMi: number | null | undefined): boolean {
  return distanceMi != null && Number.isFinite(distanceMi) && distanceMi > DANIELS_MAX_VALID_DISTANCE_MI;
}
