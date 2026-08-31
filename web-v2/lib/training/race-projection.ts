/**
 * lib/training/race-projection.ts — ONE answer to "what will I run".
 *
 * THE DECISION: "Projected" is where THIS BUILD lands the runner ON RACE DAY.
 * It is not "what could I run today". Every surface that prints the word
 * resolves it here, so no two screens can hold different numbers.
 *
 * ── why this file exists ──────────────────────────────────────────────────
 *
 * The Races list and the race detail screen answered the same question with
 * two different models, one tap apart. On the owner's own account, 2026-08-30,
 * CIM 2026-12-06, goal 3:00:00, VDOT 44.1 anchored to the AFC half:
 *
 *   Races list  → Projected 3:22:17 · Gap +22:17   (execution-scaled trajectory)
 *   CIM detail  → Projected 3:31:48 · Gap +31:48   (raw current-fitness equivalence)
 *
 * Same race, same goal, same label, 9m31s apart. The list resolved through
 * `computeGoalProjection().trajectory`; the detail called `predictRaceTime`
 * directly and never learned about the trajectory at all.
 *
 * The identical split was found and settled once already, on the projected-
 * finish TREND card in the same route — headline 3:22:17 sitting over bars
 * plotted at 3:31:48 (see the B6 note in app/api/v5/races/route.ts). The
 * answer there was the trajectory, for the reason David gave on 2026-08-26
 * ([[feedback_progress_is_the_guiding_light]], [[feedback_execution_is_the_lever]]):
 * a frozen current-fitness lookup is why the number sat still for months
 * while the runner trained. This file applies that same resolution to the
 * stat plate, and makes it a shared function so the drift cannot come back.
 *
 * ── the precedence, and why every rung is honest ──────────────────────────
 *
 * 1. `trajectory.projectedSec` — current fitness plus the planned build,
 *    scaled by how the runner is actually executing it, carried to race day.
 *    This IS the quantity. Null at cold start (no VDOT) or unknown race date.
 *
 * 2. `vdotProjectionSec` — today's equivalence, after Research/02 §13.1's
 *    +5% one-sided marathon-specificity adjustment where it applies.
 *
 * 3. the raw equivalence `predictRaceTime(vdot, distanceMi)`.
 *
 * Rungs 2 and 3 are a DIFFERENT quantity from rung 1 — today, not race day —
 * and they are fallbacks, not peers. `basis` says which rung answered so a
 * caller's prose can stay true to the number beside it: the detail screen's
 * coach line used to open "Today's fitness projects…", which was correct for
 * the raw equivalence it was printing and would have become a lie the moment
 * the number became the trajectory. Callers read `basis`; they never re-derive.
 *
 * Rung 3 is only reachable when `computeGoalProjection` itself failed or was
 * never called, because rung 2 is computed from the same VDOT and is never
 * null when rung 3 is not. Note `assessGoal().currentEquivalentSec` — which
 * the Races list used to interleave here as a fourth rung — is
 * `Math.round(predictRaceTime(currentVdot, distanceMi))`, byte-identical to
 * rung 3 (lib/training/goal-assessment.ts:266). It was never a distinct
 * quantity and is not one here.
 */
import { predictRaceTime } from './vdot';
import type { ConfidenceInterval, ConfidenceLabel } from './goal-projection';

/** Which rung of the precedence produced the number. */
export type RaceProjectionBasis = 'trajectory' | 'equivalence';

export interface RaceProjectionInput {
  /** The result of `computeGoalProjection`, or null when it was not called
   *  (no goal, no distance, no race date) or it failed. */
  goalProjection: {
    trajectory?: { projectedSec?: number | null } | null;
    vdotProjectionSec?: number | null;
    /** 2026-09-01 · `computeGoalProjection` already computes this AROUND
     *  `vdotProjectionSec` (see that field's own doc comment) — it used to
     *  be discarded before reaching this resolver (race-prediction-
     *  external-review-2026-08-31.md §5: "every live 'Projected' figure ...
     *  is a bare point estimate"). Threaded through so a caller CAN render
     *  a likely range next to the number, on the rung it actually describes
     *  — see `RaceProjection.confidenceInterval`'s own doc for the honesty
     *  boundary this stops at. */
    confidenceInterval?: ConfidenceInterval | null;
    /** Same rung as `confidenceInterval` · HIGH/MEDIUM/LOW. */
    confidenceLabel?: ConfidenceLabel | null;
  } | null;
  /** Latest VDOT read. Null at cold start. */
  vdot: number | null;
  /** Race distance in miles. Null/0 when the race carries no distance. */
  distanceMi: number | null;
}

export interface RaceProjection {
  /** Seconds, or null when there is nothing honest to show. */
  projectedSec: number | null;
  /** 'trajectory' = race day. 'equivalence' = today's fitness. Null with
   *  `projectedSec` null. Drives copy, never a second number. */
  basis: RaceProjectionBasis | null;
  /** A likely range around `projectedSec`, when one is honestly available.
   *
   *  2026-09-01 (docs/reports/race-prediction-consolidation-2026-09-01.md,
   *  answering external-review-2026-08-31.md §5's "every live 'Projected'
   *  figure is a bare point estimate" finding). ALWAYS null when `basis ===
   *  'trajectory'`: `computeGoalProjection`'s `confidenceInterval` is
   *  computed AROUND `vdotProjectionSec` (today's equivalence), not around
   *  the execution-scaled trajectory — attaching it to a trajectory number
   *  would print a range that describes a different quantity than the
   *  point estimate beside it, the exact mislabeling Rule 16 forbids. A
   *  trajectory-specific band is real, wanted follow-up work (open question
   *  in the external review, §5 + Q4) and is NOT built here — this resolver
   *  only ever surfaces a range it can honestly attribute to the number it
   *  is next to. Non-null only when `basis === 'equivalence'` AND the
   *  caller's `goalProjection.confidenceInterval` was itself non-null. */
  confidenceInterval: ConfidenceInterval | null;
  /** Same honesty boundary as `confidenceInterval` — null whenever that is. */
  confidenceLabel: ConfidenceLabel | null;
}

/**
 * The single resolution of "Projected". Pure — every input is passed in, so
 * two callers holding the same inputs cannot get different answers, and the
 * regression test can assert exactly that.
 */
export function resolveRaceProjection(input: RaceProjectionInput): RaceProjection {
  const { goalProjection, vdot, distanceMi } = input;

  const trajectorySec = goalProjection?.trajectory?.projectedSec ?? null;
  if (trajectorySec != null && Number.isFinite(trajectorySec)) {
    // No confidence interval here — see RaceProjection.confidenceInterval's
    // doc for why a trajectory number never carries the equivalence's band.
    return {
      projectedSec: Math.round(trajectorySec), basis: 'trajectory',
      confidenceInterval: null, confidenceLabel: null,
    };
  }

  const adjustedSec = goalProjection?.vdotProjectionSec ?? null;
  if (adjustedSec != null && Number.isFinite(adjustedSec)) {
    return {
      projectedSec: Math.round(adjustedSec), basis: 'equivalence',
      confidenceInterval: goalProjection?.confidenceInterval ?? null,
      confidenceLabel: goalProjection?.confidenceLabel ?? null,
    };
  }

  if (vdot != null && vdot > 0 && distanceMi != null && distanceMi > 0) {
    const raw = predictRaceTime(vdot, distanceMi);
    if (raw != null && Number.isFinite(raw)) {
      // Rung 3 has no computed band of its own (computeGoalProjection was
      // never called, or produced neither of the rungs above) — still
      // 'equivalence', but honestly no range to attach.
      return {
        projectedSec: Math.round(raw), basis: 'equivalence',
        confidenceInterval: null, confidenceLabel: null,
      };
    }
  }

  return { projectedSec: null, basis: null, confidenceInterval: null, confidenceLabel: null };
}

/**
 * The forward-looking coach line under the plate, worded for the quantity it
 * is actually standing next to.
 *
 * `basis` is not decoration. The sentence "Today's fitness projects 31:48
 * behind" was true of the raw equivalence and false of the trajectory, and
 * printing it over a trajectory number is the same defect class as the two
 * screens disagreeing — prose asserting a basis the number does not have.
 *
 * Returns null when there is nothing forward-looking to say (a race already
 * run, or no gap to speak of).
 */
export function projectionCoachLine(args: {
  basis: RaceProjectionBasis | null;
  gapSec: number | null;
  /** Formatter for an absolute duration — passed in so this stays pure.
   *  `formatRaceTime` is nullable in its signature; a null formatting of a
   *  real gap has no sentence to appear in, so the line is withheld. */
  formatGap: (sec: number) => string | null;
}): string | null {
  const { basis, gapSec, formatGap } = args;
  if (basis == null || gapSec == null) return null;

  if (gapSec <= 0) {
    return basis === 'trajectory'
      ? `This build projects the goal covered with room. Race it as planned.`
      : `Today's fitness covers the goal with room. Race it as planned.`;
  }

  const gap = formatGap(Math.abs(gapSec));
  if (!gap) return null;

  return basis === 'trajectory'
    ? `This build projects ${gap} behind the goal. That can still close.`
    : `Today's fitness projects ${gap} behind the goal. That can still close.`;
}
