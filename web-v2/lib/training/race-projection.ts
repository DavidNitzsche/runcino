/**
 * lib/training/race-projection.ts — "Projected", read off the race outlook.
 *
 * 2026-09-01 · P0 race-pace brain. This file used to be its own resolver: a
 * three-rung precedence (trajectory → adjusted equivalence → raw equivalence)
 * that every "Projected" surface called with inputs IT had gathered —
 * `computeGoalProjection` here, `loadLatestVdotWithAnchor` there. The rungs
 * were honest, but the INPUTS were a second fitness read (a snapshot table's
 * VDOT, not the canonical threshold capacity) and the trajectory rung sized
 * its gain from the goal. Nine CIM numbers were live at once.
 *
 * Now there is ONE object — `lib/race/race-outlook.ts#RaceOutlook` — and
 * this module is a pure mapping from it to the two-field shape the
 * "Projected" surfaces render. No inputs are gathered here; nothing is
 * computed here. A caller that wants "Projected" resolves the outlook and
 * maps it, so two screens holding the same outlook cannot disagree.
 *
 *   basis 'trajectory'   → `outlook.expectedRaceDay` (race day, this build)
 *   basis 'equivalence'  → `outlook.currentProjection` (today's fitness),
 *                          only when no race-day projection exists
 *                          (no race date, so no runway to project across)
 */
import type { ConfidenceInterval, ConfidenceLabel } from './goal-projection';
import type { RaceOutlook } from '@/lib/race/race-outlook';

/** Which quantity of the outlook produced the number. */
export type RaceProjectionBasis = 'trajectory' | 'equivalence';

export interface RaceProjection {
  /** Seconds, or null when there is nothing honest to show. */
  projectedSec: number | null;
  /** 'trajectory' = race day. 'equivalence' = today's fitness. Null with
   *  `projectedSec` null. Drives copy, never a second number. */
  basis: RaceProjectionBasis | null;
  /** The likely range around `projectedSec`, on the SAME quantity. */
  likelyRangeSec: readonly [number, number] | null;
  /** Kept for callers that render the equivalence's own CI shape. Null on
   *  the trajectory rung — its range is `likelyRangeSec`. */
  confidenceInterval: ConfidenceInterval | null;
  confidenceLabel: ConfidenceLabel | null;
  /** 0..1 · the outlook's own confidence in the number shown. */
  confidence: number | null;
}

const EMPTY: RaceProjection = {
  projectedSec: null, basis: null, likelyRangeSec: null,
  confidenceInterval: null, confidenceLabel: null, confidence: null,
};

/**
 * The single mapping of an outlook to "Projected". Pure.
 */
export function raceProjectionFromOutlook(outlook: RaceOutlook | null | undefined): RaceProjection {
  if (!outlook) return EMPTY;
  const rd = outlook.expectedRaceDay;
  if (rd.expectedSec != null && rd.basis === 'trajectory') {
    return {
      projectedSec: Math.round(rd.expectedSec), basis: 'trajectory',
      likelyRangeSec: rd.likelyRangeSec,
      confidenceInterval: null, confidenceLabel: null,
      confidence: rd.confidence,
    };
  }
  const cp = outlook.currentProjection;
  if (cp.expectedSec != null) {
    return {
      projectedSec: Math.round(cp.expectedSec), basis: 'equivalence',
      likelyRangeSec: cp.likelyRangeSec,
      confidenceInterval: cp.confidenceInterval,
      confidenceLabel: null,
      confidence: cp.confidence,
    };
  }
  return EMPTY;
}

/**
 * The forward-looking coach line under the plate, worded for the quantity it
 * is actually standing next to. `basis` is not decoration: "Today's fitness
 * projects…" is true of the equivalence and false of the race-day number.
 *
 * Returns null when there is nothing forward-looking to say.
 */
export function projectionCoachLine(args: {
  basis: RaceProjectionBasis | null;
  gapSec: number | null;
  /** Formatter for an absolute duration — passed in so this stays pure. */
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
