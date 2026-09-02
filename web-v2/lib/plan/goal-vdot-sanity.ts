/**
 * lib/plan/goal-vdot-sanity.ts · THE NARROW QUESTION, HONESTLY NAMED.
 *
 * WHAT THIS ANSWERS, EXACTLY ONE THING:
 *
 *   "Does the VDOT the stated goal time demands sit more than
 *    `GOAL_VDOT_SANITY_BAND` above the runner's currently-resolved threshold
 *    capacity?"
 *
 * That is a TYPO-AND-ABSURDITY screen on a number the runner typed. It is not
 * a feasibility verdict, and it must never be rendered as one.
 *
 * WHY IT WAS RENAMED (2026-09-02). This shipped as `authored_state.goal_realism`
 * with a boolean field called `flag`, and the name promised the whole question.
 * On 2026-09-02 the owner's block recorded `goal_realism.flag = false` — read
 * by any human as "the goal is realistic" — at the same instant the canonical
 * Goal Feasibility owner returned `unlikely_currently` with a 19:42 gap. Both
 * were arithmetically correct. They were answering different questions, and
 * only one of them had a name that said so. His ruling: "If the flag answers a
 * narrower question than its name implies, rename it."
 *
 * THE CANONICAL OWNER OF FEASIBILITY IS NOT THIS FILE. Constitution §L
 * (`docs/BRAIN_CONSTITUTION.md`) assigns "how does the runner's goal compare
 * with the current race outlook?" to Goal Feasibility, whose implementation is
 * `lib/race/race-outlook.ts` §7 — it consumes the projection AND its likely
 * range AND expected race day, and returns COMFORTABLE / REALISTIC /
 * AGGRESSIVE / UNLIKELY_CURRENTLY. Any surface answering "is my goal
 * realistic" reads THAT.
 *
 * WHAT THIS FILE STRUCTURALLY CANNOT SEE, and therefore cannot mean:
 *
 *   · REMAINING TRAINING TIME. `totalWeeks` is not an input. A 3:00 goal
 *     52 weeks out and the same goal 2 days out produce the identical answer.
 *   · UNCERTAINTY. The capacity's confidence and the projection's likely range
 *     are not inputs. The band is a fixed multiple, not a confidence interval.
 *   · DURABILITY / RACE-DAY DECAY. The band compares a Daniels-equivalence
 *     VDOT against a threshold-derived VDOT. The runner's own endurance
 *     exponent, which is what actually decides a marathon, is not in it.
 *
 * So a `false` here means ONLY "the typed goal is inside the sanity band".
 * It does not mean currently demonstrated, and it does not mean achievable by
 * race day. `GOAL_VDOT_SANITY_BAND` is deliberately wider than
 * `MAX_BLOCK_GAIN_VDOT` for most runners — see the constant's own note — so a
 * goal can sit inside the band and still be beyond anything the engine models
 * a build delivering.
 *
 * IT PRICES NOTHING. This is the one remaining legitimate `vdotFromRace(goal)`
 * at authoring. No pace, no distance, no week and no goal is written from it.
 * `_goal_vdot_sanity_gate.test.ts` holds that.
 */
import { vdotFromRace, predictRaceTime } from '../training/vdot';
import { isProvisionalAnchor, type AnchorSource } from './anchor-provenance';

/**
 * The sanity band, as a multiple of current threshold capacity.
 *
 * NOT DOCTRINE-DERIVED, and deliberately said out loud rather than left to
 * look like it is. 1.15 is a screening tolerance chosen when this was written
 * as a typo guard. For scale, at a threshold capacity of 47.8 the band tolerates
 * 7.17 VDOT points of ambition, while `MAX_BLOCK_GAIN_VDOT` — the largest
 * single-block gain the engine will model, sized off `Research/01`'s own
 * layoff row — is 5.0. The band is therefore WIDER than the biggest build the
 * engine believes in, which is exactly why a `false` cannot be read as
 * "reachable by race day". `_goal_vdot_sanity_gate.test.ts` asserts that
 * relationship rather than trusting this paragraph.
 */
export const GOAL_VDOT_SANITY_BAND = 1.15;

export type GoalVdotSanity = {
  /**
   * TRUE when the stated goal demands more than `GOAL_VDOT_SANITY_BAND` ×
   * current threshold capacity. Named for the predicate, not for the
   * conclusion a reader might want to draw from it.
   */
  beyondSanityBand: boolean;
  /** FALSE when there is no measured capacity to screen against. Rule 11:
   *  this is a third state, not a negative verdict. */
  assessable: boolean;
  /** Provenance of the capacity this was screened against. */
  basis: AnchorSource;
  /**
   * The VDOT the goal demands. ALWAYS PRESENT (Rule 11) — `null` means and
   * only means "the goal time falls outside the Daniels [30,85] table", never
   * "we did not bother to record it". The predecessor `goal_realism` omitted
   * this key on the not-flagged branch while computing it, so one absence
   * carried two facts.
   */
  goalVdot: number | null;
  /** The threshold capacity screened against. `null` when not assessable. */
  anchorVdot: number | null;
  /**
   * Rule 9 · the CONTINUOUS quantity the boolean is a step function of:
   * `goalVdot − anchorVdot × BAND`. Positive means beyond the band. Publishing
   * it means a consumer can grade continuously instead of reading a cliff, and
   * a reader can see how far from the edge a given runner sits. `null`
   * whenever the boolean is not assessable or the goal is off-table.
   */
  bandExcessVdot: number | null;
  /** The band in force, recorded so a persisted row is readable after the
   *  constant moves (Rule 10 · a persisted derivation carries its anchor). */
  band: number;
};

/**
 * Screen a stated goal against demonstrated threshold capacity.
 *
 * `currentVdot` MUST be the canonical threshold capacity's derived VDOT
 * (Constitution §C, `resolveThresholdCapacity`). Do not pass a goal-derived,
 * plan-derived or projected VDOT: the whole point is that one side of this
 * comparison is evidence and the other is ambition.
 */
export function assessGoalVdotSanity(args: {
  goalSec: number | null | undefined;
  raceDistanceMi: number;
  currentVdot: number | null | undefined;
  /** The capacity's source mode, for provenance and for the refusal branch. */
  anchorSource: AnchorSource;
}): GoalVdotSanity {
  const { goalSec, raceDistanceMi, currentVdot, anchorSource } = args;
  const goalVdot = goalSec != null ? vdotFromRace(goalSec, raceDistanceMi) : null;

  // Rule 11 · a provisional anchor or a capacity off the Daniels table is
  // "cannot say", which is a different fact from "the goal is fine".
  if (isProvisionalAnchor(anchorSource) || currentVdot == null) {
    return {
      beyondSanityBand: false,
      assessable: false,
      basis: anchorSource,
      goalVdot,
      anchorVdot: null,
      bandExcessVdot: null,
      band: GOAL_VDOT_SANITY_BAND,
    };
  }

  const edge = currentVdot * GOAL_VDOT_SANITY_BAND;

  // DIRECTION-AWARE (inherited from GOAL-3, 2026-06-23, and still required).
  // `vdotFromRace` returns null OFF THE TOP of the table as well as off the
  // bottom, so the MOST absurd goals produce a null goalVdot. Falling through
  // to `goalVdot != null && ...` would have marked those as inside the band —
  // the screen inverting for exactly the inputs it exists to catch. When the
  // goal is off-table, compare TIMES instead: faster than what current fitness
  // predicts means off the top, which is beyond any band.
  const beyond = goalVdot != null
    ? goalVdot > edge
    : (() => {
        if (goalSec == null) return false;
        const predicted = predictRaceTime(currentVdot, raceDistanceMi);
        return predicted != null && goalSec < predicted;
      })();

  return {
    beyondSanityBand: beyond,
    assessable: true,
    basis: anchorSource,
    goalVdot,
    anchorVdot: currentVdot,
    bandExcessVdot: goalVdot != null ? Math.round((goalVdot - edge) * 1000) / 1000 : null,
    band: GOAL_VDOT_SANITY_BAND,
  };
}

/**
 * The legacy `authored_state.goal_realism` shape, read forward.
 *
 * Plans authored before 2026-09-02 carry the old key and the old field names,
 * and the owner's live CIM block is one of them. A reader must not have to
 * know which vintage it is holding — and per Rule 10 it must not read the
 * frozen boolean as current either, because the anchor it was struck against
 * is re-anchored in place by `reanchor-plan.ts` while this struct is left
 * untouched. Callers that hold the live anchor should RECOMPUTE with
 * `assessGoalVdotSanity` and use this only when they cannot.
 */
export function goalVdotSanityFromLegacyRecord(raw: Record<string, unknown> | null | undefined): GoalVdotSanity | null {
  if (!raw) return null;
  const assessable = typeof raw.assessable === 'boolean' ? raw.assessable : null;
  if (assessable == null) return null;
  const goalVdot = typeof raw.goalVdot === 'number' ? raw.goalVdot : null;
  const anchorVdot = assessable && typeof raw.estimatedCurrentVdot === 'number'
    ? raw.estimatedCurrentVdot
    : null;
  const band = typeof raw.band === 'number' ? raw.band : GOAL_VDOT_SANITY_BAND;
  const beyond = raw.beyondSanityBand === true || raw.flag === true;
  return {
    beyondSanityBand: assessable && beyond,
    assessable,
    basis: (raw.basis as AnchorSource) ?? 'provisional_mileage',
    goalVdot,
    anchorVdot,
    bandExcessVdot: goalVdot != null && anchorVdot != null
      ? Math.round((goalVdot - anchorVdot * band) * 1000) / 1000
      : null,
    band,
  };
}
