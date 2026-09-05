/**
 * lib/plan/_fixture-goal-tpace.ts · A FIXTURE INPUT. NOT A CAPACITY BELIEF.
 *
 * ── WHAT THIS REPLACED, AND WHY IT IS NOT IN `spec-builder.ts` ANY MORE ─────
 *
 * `spec-builder.ts` exported `tPaceFromGoal(goalSeconds, goalDistanceMi)` for
 * eleven months. It took the runner's STATED GOAL and returned a threshold
 * pace, and `docs/BRAIN_CONSTITUTION.md` §4 lists that exact edge — "Goal Time
 * → Fitness directly" — as a forbidden side door, while
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §6 requires the
 * separation to be structural rather than conventional.
 *
 * Measured live on the owner's account, 2026-09-05, against the canonical
 * `resolveThresholdCapacity`: goal-derived **394 s/mi** (6:34/mi) from a 3:00
 * CIM goal, canonical **430 s/mi** (7:10/mi) from his own corroborated
 * threshold corpus. Thirty-six seconds per mile of aspiration, priced as if it
 * were fitness.
 *
 * Its last production caller (`adapt.ts`'s single-row rebuild) now reads
 * `resolvePrescribedPaceAnchors`, so the function was DELETED from the
 * production module rather than left with a "don't call this" comment —
 * §4 of the enforcement brief is explicit that a deprecated path someone can
 * still import is not a deprecated path.
 *
 * ── WHY THE MATH SURVIVES HERE ──────────────────────────────────────────────
 *
 * Thirty-seven test files build a synthetic archetype by handing `composePlan`
 * a plan-wide `tPaceSec`, and they derive that number from the archetype's own
 * goal because that is the only fitness fact a hand-written fixture has. That
 * is a legitimate use: the fixture is ASSERTING "this archetype's threshold is
 * X", not inferring a real runner's capacity from an aspiration. The name says
 * so, the leading underscore keeps it beside the other `_fixture` modules
 * (`lib/race/_race_outlook_fixture.ts` is the same convention), and
 * `lib/training/_threshold_owner_scan.test.ts` fails the build if any
 * non-test module imports it.
 *
 * ── NO DOCTRINE NUMBERS LIVE IN THIS FILE ───────────────────────────────────
 *
 * The distance-tier offsets are NOT re-typed here. This delegates to
 * `tPaceFromAnchorPace`, which already carries the identical table
 * (`Research/01-pace-zones-vdot.md` §"Pace conversion from a race time") and
 * has since P1-56 — `vdot.ts`'s own comment said so: "same numbers, same
 * citation, applied to a measured anchor instead of a target". Deleting the
 * goal-anchored copy leaves exactly one copy of the table, which is what
 * Constitution §5 asks for.
 *
 * Identical to the deleted `tPaceFromGoal` on every input a fixture supplies:
 * that function rounded the goal pace and then added an integer offset; this
 * one adds the offset and then rounds. `round(x) + n === round(x + n)` for
 * integer `n`, and the offsets (-18, -5, +8, +15) and the ultra cutoff
 * (>= 31 mi → null) are the same values.
 *
 * ONE DELIBERATE DIFFERENCE, stated rather than discovered later: a goal time
 * UNDER 60 SECONDS now returns null, because `anchorPaceFrom` refuses it. The
 * old function would happily price a 30-second marathon. No archetype in the
 * corpus supplies one and nothing should; a fixture that starts getting null
 * back has asserted a threshold off a goal that is not a time.
 *
 * `_threshold_owner_scan.test.ts` pins the equality across all four tiers and
 * both null cases, so a change to either side is caught.
 */
import { anchorPaceFrom, tPaceFromAnchorPace } from '@/lib/training/vdot';

/**
 * A synthetic archetype's plan-wide threshold pace, asserted from the goal the
 * fixture invented. Null when the fixture supplies no goal, and null at ultra
 * distance, exactly as the deleted production function did.
 *
 * NEVER call this from production code. A real runner's threshold is
 * `resolveThresholdCapacity` (Runner Model) and their prescribed threshold is
 * `resolvePrescribedPaceAnchors().anchors.thresholdSecPerMi` (Pace
 * Prescription). Neither can see a goal, by construction.
 */
export function fixtureTPaceFromGoalPace(
  goalSeconds: number | null | undefined,
  goalDistanceMi: number | null | undefined,
): number | null {
  if (!goalSeconds || !goalDistanceMi) return null;
  // Through `anchorPaceFrom` rather than a hand-built object literal, so this
  // file never names two members of the pace family itself — the shape
  // `check-derived-consistency.sh` flags, and which it flagged here on the
  // first run. One constructor, one offset table, no arithmetic of its own.
  return tPaceFromAnchorPace(anchorPaceFrom(goalSeconds, goalDistanceMi));
}
