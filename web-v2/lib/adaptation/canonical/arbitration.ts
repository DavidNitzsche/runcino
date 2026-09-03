/**
 * lib/adaptation/canonical/arbitration.ts · EVIDENCE IS INDEPENDENT, MUTATIONS
 * ARE NOT.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md`, the governing principle of the whole
 * document:
 *
 *     "Evidence is evaluated separately by lever, but every proposed change
 *      must survive recomposition of the complete plan."
 *
 * And the sentence the engine has to be able to say, which is this file's
 * acceptance test:
 *
 *     "Your threshold evidence supports a faster threshold pace, but this week
 *      already contains enough total demand, so the change is deferred until
 *      the next appropriate boundary."
 *
 *     "That is not one lever improperly suppressing another. It is independent
 *      evidence followed by coherent plan-level arbitration."
 *
 * ── THE FOUR RULES, AND THE ONE THAT IS EASIEST TO GET WRONG ───────────────
 *
 * 1 · A volume or long-run HOLD suppresses changes that materially increase the
 *     same week's total demand.
 * 2 · It does NOT automatically suppress a threshold-pace proposal. The word
 *     doing the work is AUTOMATICALLY: a small pace correction that preserves
 *     the intended stimulus may proceed, and only a MATERIAL demand increase is
 *     caught by rule 1. Implementing rule 1 without rule 2 gives you an engine
 *     where any hold anywhere freezes everything, which the contract names
 *     directly: "Do not let one unrelated HOLD freeze the entire engine."
 * 3 · Prefer ONE material lever per cycle, so the response stays attributable.
 * 4 · Record every suppressed proposal and why.
 *
 * Rule 2 is the one that is easy to get wrong, because rule 1 alone feels
 * safer, and "safer" is how this codebase arrived at zero upward adaptations in
 * 309 production intents. A suppression rule with no exception is a freeze.
 *
 * ── PRIORITY, AND ITS CITATION ─────────────────────────────────────────────
 *
 * When two material proposals compete, workload moves before pace:
 *
 *     "Progress strong capacities mainly through workload before moving their
 *      pace."          — PROGRESSIVE_BASELINE_DOCTRINE.md, governing principles
 *     "Duration is the primary early lever. Pace moves in smaller increments."
 *                      — Q8
 *
 * Weekly volume precedes the long run because Q22 makes the long run's validity
 * DEPEND on weekly volume ("Coherent with weekly volume"), and a dependency
 * settles the order: the quantity that constrains the other moves first.
 *
 * ── RULE 22 · WHAT THIS FILE'S GATE CANNOT FAIL ON ─────────────────────────
 *
 * It cannot fail on the materiality threshold being set wrong. Every test here
 * constructs proposals that are clearly above or clearly below the bar, so a
 * threshold moved by a few tenths of a percent would pass the whole suite while
 * changing which proposals reach a runner. The distribution counts in
 * `_case_distribution.test.ts` are the closest thing to a check on that, and
 * they are a blunt one.
 */
import {
  MATERIAL_SHARE_OF_ORDINARY_STEP,
  MAX_MATERIAL_LEVERS_PER_CYCLE,
  THRESHOLD_ORDINARY_STEP_SEC_PER_MI,
  VOLUME_MAX_STEP_FRAC,
  LONG_RUN_MAX_STEP_MI,
} from './contract-constants';
import type { CanonicalLever } from './input';
import type { SuppressionNote } from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { LeverVerdict } from './levers/shared';
import { projectPlanLoad, demandDeltaShare, type ProjectedPlanLoad } from './plan-load';

/**
 * Workload before pace. Volume before the long run that sits inside it.
 * Cited in the header; the order is not a preference.
 */
export const ARBITRATION_PRIORITY: readonly CanonicalLever[] = [
  'WEEKLY_VOLUME',
  'LONG_RUN',
  'THRESHOLD_PACE',
];

export interface ArbitrationInput {
  readonly verdicts: readonly LeverVerdict[];
  /** The week a proposal would first affect, as authored. */
  readonly baseWeeklyMi: number;
  readonly baseLongRunMi: number;
  readonly baseQualityMinutes: number;
  /** Where a deferred proposal would next be reconsidered. */
  readonly nextBoundaryISO: string | null;
}

export interface ArbitratedVerdict {
  readonly verdict: LeverVerdict;
  /** Null when the proposal survived arbitration. */
  readonly suppressedBy: SuppressionNote | null;
  /** Share of projected weekly demand this proposal moves. */
  readonly demandShare: number;
  readonly material: boolean;
}

export interface ArbitrationResult {
  readonly arbitrated: readonly ArbitratedVerdict[];
  readonly baseLoad: ProjectedPlanLoad;
  /** The load projection with every SURVIVING proposal applied together. */
  readonly combinedLoad: ProjectedPlanLoad;
  readonly combinedShare: number;
}

/**
 * Is this proposal material, in the lever's OWN doctrine units?
 *
 * Half the lever's ordinary step, per `MATERIAL_SHARE_OF_ORDINARY_STEP`, whose
 * header explains at length why this is not a share of weekly load. In short: a
 * load index cannot compare half a mile of long run against three seconds per
 * mile of threshold pace without flattening one of them, and flattening the
 * pace lever made the contract's own acceptance sentence unreachable.
 */
function isMaterial(v: LeverVerdict, input: ArbitrationInput): boolean {
  if (v.proposedAfterValue === null) return false;
  const delta = Math.abs(v.proposedAfterValue - v.beforeValue);

  if (v.lever === 'THRESHOLD_PACE') {
    return delta >= THRESHOLD_ORDINARY_STEP_SEC_PER_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;
  }
  if (v.lever === 'WEEKLY_VOLUME') {
    const ordinary = input.baseWeeklyMi * VOLUME_MAX_STEP_FRAC;
    return delta >= ordinary * MATERIAL_SHARE_OF_ORDINARY_STEP;
  }
  return delta >= LONG_RUN_MAX_STEP_MI * MATERIAL_SHARE_OF_ORDINARY_STEP;
}

/** Project the week with exactly one verdict applied. */
function loadWith(input: ArbitrationInput, v: LeverVerdict | null): ProjectedPlanLoad {
  let weekly = input.baseWeeklyMi;
  let long = input.baseLongRunMi;
  let paceDelta = 0;

  if (v && v.proposedAfterValue !== null) {
    if (v.lever === 'WEEKLY_VOLUME') weekly = v.proposedAfterValue;
    if (v.lever === 'LONG_RUN') {
      // A longer long run adds its extra miles to the week as well as carrying
      // its own surcharge. Modelling it as a pure substitution would make the
      // long-run lever look free, which is the opposite of true.
      weekly = weekly + (v.proposedAfterValue - v.beforeValue);
      long = v.proposedAfterValue;
    }
    if (v.lever === 'THRESHOLD_PACE') paceDelta = v.proposedAfterValue - v.beforeValue;
  }

  return projectPlanLoad({
    weeklyMi: weekly,
    longRunMi: long,
    qualityMinutes: input.baseQualityMinutes,
    thresholdAnchorDeltaSecPerMi: paceDelta,
  });
}

export function arbitrate(input: ArbitrationInput): ArbitrationResult {
  const baseLoad = loadWith(input, null);

  /* ── Materiality, one proposal at a time ───────────────────────────────── */

  const scored = input.verdicts.map((verdict) => {
    const moves = !NON_MOVING_DECISIONS.has(verdict.decision);
    const share = moves ? demandDeltaShare(baseLoad, loadWith(input, verdict)) : 0;
    return {
      verdict,
      demandShare: Math.round(share * 10_000) / 10_000,
      material: moves && isMaterial(verdict, input),
    };
  });

  /* ── Rule 1 · a LOAD hold suppresses material demand increases ─────────── */

  // A LOAD lever that held or regressed. Its INDEX in the priority order is
  // what matters, for the reason below.
  const held = scored.find(
    (s) =>
      (s.verdict.lever === 'WEEKLY_VOLUME' || s.verdict.lever === 'LONG_RUN')
      && (s.verdict.decision === 'HOLD' || s.verdict.decision === 'REGRESS'),
  );
  const loadLeverHeld = held !== undefined;
  const heldLever = held?.verdict.lever ?? 'PLAN_LOAD';
  const heldRank = held ? ARBITRATION_PRIORITY.indexOf(held.verdict.lever) : Infinity;

  const out: ArbitratedVerdict[] = [];
  let materialAccepted = 0;

  // Priority order, so which proposal survives is deterministic and cited.
  const ordered = [...scored].sort(
    (a, b) =>
      ARBITRATION_PRIORITY.indexOf(a.verdict.lever) - ARBITRATION_PRIORITY.indexOf(b.verdict.lever),
  );

  for (const s of ordered) {
    const moves = !NON_MOVING_DECISIONS.has(s.verdict.decision);

    // A verdict that proposes nothing cannot be suppressed. It is already the
    // engine's answer, and recording it as "suppressed" would be a lie.
    if (!moves) {
      out.push({ ...s, suppressedBy: null });
      continue;
    }

    // Rule 1 and rule 2 together. Two conjuncts stop a hold from freezing the
    // engine, and both were put here by a test that caught a real deadlock.
    //
    // `s.material` is rule 2: a small pace correction proceeds.
    //
    // `rank > heldRank` is the DEPENDENCY DIRECTION, and it is the one that
    // matters more. Suppression flows DOWN the priority order, never up. The
    // long run's own contract makes it depend on weekly volume ("Coherent with
    // weekly volume"), so a long-run HOLD must not veto a weekly-volume
    // increase. Without this, the engine deadlocks in a way that is easy to
    // reach and hard to see: the long run holds BECAUSE the week is too small
    // to carry it, that hold suppresses the volume increase, and the volume
    // increase was the only thing that could have released the long run. The
    // plan can then never grow, which is precisely the disposition Rule 21
    // measured, arrived at from a different direction.
    const increasesDemand = s.demandShare > 0;
    const rank = ARBITRATION_PRIORITY.indexOf(s.verdict.lever);
    if (loadLeverHeld && increasesDemand && s.material
      && s.verdict.lever !== heldLever && rank > heldRank) {
      out.push({
        ...s,
        suppressedBy: {
          by: heldLever,
          detail:
            `The ${label(s.verdict.lever)} evidence supports this change, but this week already `
            + 'contains enough total demand, so the change is deferred until the next '
            + 'appropriate boundary.',
          reconsiderAtISO: input.nextBoundaryISO,
        },
      });
      continue;
    }

    // Rule 3 · one material lever per cycle, so the response stays attributable.
    if (s.material) {
      if (materialAccepted >= MAX_MATERIAL_LEVERS_PER_CYCLE) {
        out.push({
          ...s,
          suppressedBy: {
            by: 'PLAN_LOAD',
            detail:
              'Another lever is already making a material change this cycle. Making both at '
              + 'once would leave the response impossible to attribute, so this one is '
              + 'deferred until the next appropriate boundary.',
            reconsiderAtISO: input.nextBoundaryISO,
          },
        });
        continue;
      }
      materialAccepted += 1;
    }

    out.push({ ...s, suppressedBy: null });
  }

  /* ── The combined projection of everything that survived ───────────────── */

  const surviving = out.filter((o) => o.suppressedBy === null).map((o) => o.verdict);
  let weekly = input.baseWeeklyMi;
  let long = input.baseLongRunMi;
  let paceDelta = 0;
  for (const v of surviving) {
    if (v.proposedAfterValue === null) continue;
    if (v.lever === 'WEEKLY_VOLUME') weekly = v.proposedAfterValue;
    if (v.lever === 'LONG_RUN') {
      weekly = weekly + (v.proposedAfterValue - v.beforeValue);
      long = v.proposedAfterValue;
    }
    if (v.lever === 'THRESHOLD_PACE') paceDelta = v.proposedAfterValue - v.beforeValue;
  }
  const combinedLoad = projectPlanLoad({
    weeklyMi: weekly,
    longRunMi: long,
    qualityMinutes: input.baseQualityMinutes,
    thresholdAnchorDeltaSecPerMi: paceDelta,
  });

  // Restore the caller's original ordering so a reader sees the levers in the
  // order they were evaluated, not the order they were arbitrated in.
  const byLever = new Map(out.map((o) => [o.verdict.lever, o]));
  const arbitrated = input.verdicts.map((v) => byLever.get(v.lever)!);

  return {
    arbitrated,
    baseLoad,
    combinedLoad,
    combinedShare: Math.round(demandDeltaShare(baseLoad, combinedLoad) * 10_000) / 10_000,
  };
}

function label(l: CanonicalLever): string {
  if (l === 'THRESHOLD_PACE') return 'threshold';
  if (l === 'WEEKLY_VOLUME') return 'weekly volume';
  return 'long run';
}
