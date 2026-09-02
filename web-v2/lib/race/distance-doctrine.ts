/**
 * lib/race/distance-doctrine.ts · THE per-distance race-execution tables.
 *
 * 2026-08-17 · doctrine-conformance audit, Tier 2 ("could wreck a race").
 * The audit's dominant finding was one shape repeated ten times: a
 * per-distance research table read at ONE row and applied to every
 * distance, often with a comment that names the source distance and
 * generalises anyway. In this cluster:
 *
 *   · carb load    — the HALF row (7-8 g/kg / 24-36h) shipped to marathoners
 *                    (doctrine: 8-12 g/kg / 36-48h · under-loaded by ~a third)
 *   · fuel rate    — the MARATHON row (75 g/hr) shipped to half-marathoners
 *                    (doctrine: 30-60) and a gel prescribed inside a 20-min 5K
 *                    (doctrine: 0 g/hr)
 *   · warm-up      — the HALF protocol (45 min, 1 mi, 3-4 strides) shipped to
 *                    marathoners (doctrine: 5-10 min, no strides)
 *   · abort HR     — LTHR+3 (the HALF ceiling) shipped to marathoners
 *                    (doctrine: 88-95% LTHR)
 *   · opening arc  — the HALF's +12 s/mi first mile shipped everywhere, and
 *                    five *different* implementations of it across the app,
 *                    with the watch racing flat from the gun while the phone
 *                    prescribed a settle. On race morning they contradicted.
 *
 * This module is the single source. Every number below is a cell of a
 * research table, cited to file and line. Consumers read the table; they do
 * not carry their own copy:
 *
 *   lib/race/execution-plan.ts      · splits, warm-up, triggers, prose
 *   lib/race/pacing.ts              · course-phase effort arc
 *   lib/race/race-detail-pacing.ts  · web pacing blocks + gels
 *   lib/training/fueling.ts         · race target rate + gut-training ramp
 *   lib/watch/build-workout.ts      · the watch's settle phase
 *
 * Pure: no DB, no Date.now(), no I/O.
 *
 * Cite: Research/08-pacing-and-race-week.md §3.1 (:58-64), §3.2-3.5
 *       (:73-134), §6.1 (:271-278), §10.1 (:452-457), §12.1 (:588-595),
 *       §18.1-18.3 (:753-779); Research/10-mobility-warmup.md §Race Warmup
 *       (:110-146); Research/18-fueling-products.md §1 (:13-30),
 *       §10 (:355-361), §11 (:367-376).
 */

import {
  type DistanceCategory,
  DISTANCE_CATEGORIES,
  distanceCategoryOrNull,
} from './distance-category';

/**
 * 2026-08-18 · categorizer unification. This module used to own its own type
 * name AND its own boundaries, one of three sets in the app. Both are now
 * aliases of THE categorizer in ./distance-category.ts.
 */
export type RaceDistanceCategory = DistanceCategory;

/** Every category, in doctrine-table order. Tests iterate this. */
export const RACE_DISTANCE_CATEGORIES: readonly RaceDistanceCategory[] = DISTANCE_CATEGORIES;

/**
 * Bucket a race distance into the row of the doctrine tables.
 *
 * Boundaries sit between the named doctrine distances so decorated/odd
 * distances land on the row whose physiology they actually share: a 15K and a
 * 10-mile race are paced and fuelled as half-marathon-class efforts, a
 * 20-miler as marathon-class. See ./distance-category.ts for which boundaries
 * doctrine fixes and which are convention.
 *
 * NULL when the distance is missing, non-finite or non-positive. This used to
 * return 'hm' — a distance-unknown race then received the half's HR ceiling,
 * warm-up, carb load and caffeine schedule, in the one module whose entire
 * reason for existing is that reading the wrong distance's row wrecks races.
 * lib/race/distance.ts states the codebase rule: "callers must treat null as
 * no distance, never default it."
 */
export function raceDistanceCategory(
  distanceMi: number | null | undefined,
): RaceDistanceCategory | null {
  return distanceCategoryOrNull(distanceMi);
}

// ─────────────────────────────────────────────────────────────────────────
// 1 · Opening allowance · Research/08 §3.1 (:58-64) + §3.2-3.5 (:73-134)
// ─────────────────────────────────────────────────────────────────────────

export interface OpeningAllowanceRow {
  /** The §3.1 first-mile band vs goal pace, s/mi [lo, hi]. */
  firstMileBandSPerMi: readonly [number, number];
  /** What we prescribe inside that band, s/mi. */
  firstMileSPerMi: number;
  /** The §3.2-3.5 "early miles" band vs goal pace, s/mi [lo, hi]. */
  earlyBandSPerMi: readonly [number, number];
  /** What we prescribe for the early block, s/mi. */
  earlySPerMi: number;
  /** The early block runs from mile 1 through this mile mark. */
  earlyThroughMi: number;
  citation: string;
}

/**
 * Research/08 §3.1 (:58-64) · first mile vs goal pace:
 *
 *   5K −2 to +5 · 10K +5 to +10 · HM +10 to +15 · M +10 to +20
 *   (hilly M +30 to +45 on the opening descent — see the note below)
 *
 * and the early-block continuation from the per-distance templates:
 *
 *   5K   §3.2 (:73-76)   mile 1 at GP within 1-2 s, mile 2 hold GP → no early block
 *   10K  §3.3 (:89-92)   0-2 km GP+5-10, then at GP → no early block past mile 1
 *   HM   §3.4 (:102-105) miles 2-3 at GP +5-10
 *   M    §3.5 (:114-118) miles 1-10 at GP +5-10 ("10-10-10")
 *
 * Why the marathon takes the BOTTOM of its early band (+5, not the +8
 * midpoint): the plan is arithmetically honest — the seconds conceded early
 * are repaid over the remainder so the cumulative still lands on the goal.
 * At +8 through mile 10 the repayment forces a 2.2% negative split; §4.3
 * (:189) calls 1-2% the realistic stretch and 3%+ evidence the first half
 * was too slow. +5 lands the split at ~1.2% for every distance. The
 * conformance suite asserts that band, per category.
 *
 * Ultra has no row in §3.1. Rather than invent one, it takes the
 * conservative end of the marathon band (+20) — the slowest cited opener —
 * and the marathon early block.
 *
 * Hilly marathon (+30 to +45, :64) is NOT wired: the composers see net
 * elevation, not the opening-descent grade the row is keyed to, and a
 * constant wired to nothing is its own defect class. Deferred with the
 * course-geometry work (lib/race/pacing.ts already prices real grades).
 */
export const RACE_OPENING_ALLOWANCE: Readonly<Record<RaceDistanceCategory, OpeningAllowanceRow>> = {
  '5k': {
    firstMileBandSPerMi: [-2, 5], firstMileSPerMi: 2,
    earlyBandSPerMi: [0, 0], earlySPerMi: 0, earlyThroughMi: 1,
    citation: 'Research/08 §3.1 (:60) + §3.2 (:73-76) — "hit goal pace within 1-2 sec"',  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  },
  '10k': {
    firstMileBandSPerMi: [5, 10], firstMileSPerMi: 7,
    earlyBandSPerMi: [0, 0], earlySPerMi: 0, earlyThroughMi: 1,
    citation: 'Research/08 §3.1 (:61) + §3.3 (:89-92) — 0-2 km GP+5-10, then at GP',  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  },
  'hm': {
    firstMileBandSPerMi: [10, 15], firstMileSPerMi: 12,
    earlyBandSPerMi: [5, 10], earlySPerMi: 6, earlyThroughMi: 3,
    citation: 'Research/08 §3.1 (:62) + §3.4 (:102-105)',
  },
  'm': {
    firstMileBandSPerMi: [10, 20], firstMileSPerMi: 15,
    earlyBandSPerMi: [5, 10], earlySPerMi: 5, earlyThroughMi: 10,
    citation: 'Research/08 §3.1 (:63) + §3.5 (:114-118) "10-10-10" + §4.3 (:189) split cap',
  },
  'ultra': {
    firstMileBandSPerMi: [10, 20], firstMileSPerMi: 20,
    earlyBandSPerMi: [5, 10], earlySPerMi: 5, earlyThroughMi: 10,
    citation: 'Research/08 §3.1 (:63) — no ultra row; the marathon band\'s conservative end',  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  },
};

/** Null when the distance is unknown · there is no row to hand back. */
export function openingAllowance(distanceMi: number | null | undefined): OpeningAllowanceRow | null {
  const cat = raceDistanceCategory(distanceMi);
  return cat == null ? null : RACE_OPENING_ALLOWANCE[cat];
}

/**
 * Seconds-per-mile over goal pace at a position in the race.
 * `atMi` is miles completed (0 = the gun, 1 = the mile-1 marker).
 */
export function openingAllowanceAtMi(distanceMi: number | null | undefined, atMi: number): number | null {
  const row = openingAllowance(distanceMi);
  if (row == null) return null;
  if (atMi < 1) return row.firstMileSPerMi;
  if (atMi < row.earlyThroughMi) return row.earlySPerMi;
  return 0;
}

export interface RaceOpeningPlan {
  category: RaceDistanceCategory;
  /** Unrounded goal pace, s/mi. */
  goalPaceSPerMi: number;
  firstMileAllowanceSPerMi: number;
  earlyAllowanceSPerMi: number;
  /** Last mile mark of the early block (1 = no early block). */
  earlyThroughMi: number;
  /** Miles covered by the opening (settle + early). */
  openingMi: number;
  /** Seconds conceded across the opening, total. */
  giveBackSec: number;
  /** Miles the give-back is repaid over. */
  repayMi: number;
  /** Per-mile repayment applied after the opening, s/mi. */
  repayPerMi: number;
  /** Prescribed pace for mile 1, s/mi (unrounded). */
  settlePaceSPerMi: number;
  /** Prescribed pace for the early block, s/mi (unrounded). */
  earlyPaceSPerMi: number;
  /** Prescribed pace after the opening, s/mi (unrounded). */
  repaidPaceSPerMi: number;
  citation: string;
}

/**
 * THE opening model. One call, one answer, every surface.
 *
 * The give-back is repaid across the remainder so the cumulative lands on
 * the goal exactly (Research/08 §4.3 :182-189 — a controlled even/slight
 * negative split; the resulting split sits inside the cited 1-2% band for
 * every distance, asserted in _race_doctrine.test.ts).
 */
export function raceOpeningPlan(
  args: { goalSec: number; distanceMi: number | null | undefined },
): RaceOpeningPlan | null {
  const { goalSec, distanceMi } = args;
  const cat = raceDistanceCategory(distanceMi);
  if (cat == null || distanceMi == null || !(goalSec > 0)) return null;
  const row = RACE_OPENING_ALLOWANCE[cat];
  const goalPace = goalSec / distanceMi;

  const settleMi = Math.min(1, distanceMi);
  const openingMi = Math.min(distanceMi, Math.max(settleMi, row.earlyThroughMi));
  const earlyMi = Math.max(0, openingMi - settleMi);
  const giveBackSec = settleMi * row.firstMileSPerMi + earlyMi * row.earlySPerMi;
  const repayMi = Math.max(0.1, distanceMi - openingMi);
  const repayPerMi = giveBackSec / repayMi;

  return {
    category: cat,
    goalPaceSPerMi: goalPace,
    firstMileAllowanceSPerMi: row.firstMileSPerMi,
    earlyAllowanceSPerMi: row.earlySPerMi,
    earlyThroughMi: row.earlyThroughMi,
    openingMi,
    giveBackSec,
    repayMi,
    repayPerMi,
    settlePaceSPerMi: goalPace + row.firstMileSPerMi,
    earlyPaceSPerMi: goalPace + row.earlySPerMi,
    repaidPaceSPerMi: goalPace - repayPerMi,
    citation: row.citation,
  };
}

/**
 * Mean seconds-per-mile adjustment vs goal pace across [startMi, endMi):
 * the opening allowance minus the repayment, integrated over the span.
 *
 * This is how a phase- or block-based surface (course pacing, the web
 * pacing blocks) samples the SAME model the per-mile split card uses,
 * instead of carrying its own arc.
 */
export function openingAdjustmentOverSpan(
  plan: RaceOpeningPlan,
  startMi: number,
  endMi: number,
): number {
  const len = endMi - startMi;
  if (!(len > 0)) return 0;
  const settleEnd = Math.min(1, plan.openingMi);
  const overlap = (a0: number, a1: number) => Math.max(0, Math.min(endMi, a1) - Math.max(startMi, a0));
  const seconds =
    overlap(0, settleEnd) * plan.firstMileAllowanceSPerMi +
    overlap(settleEnd, plan.openingMi) * plan.earlyAllowanceSPerMi -
    overlap(plan.openingMi, Infinity) * plan.repayPerMi;
  return seconds / len;
}

export interface RaceOpeningSegment {
  label: string;
  startMi: number;
  endMi: number;
  distanceMi: number;
  /** Rounded target pace for the segment, s/mi. */
  paceSPerMi: number;
  /**
   * The same pace unrounded. Σ(distanceMi · pacePreciseSPerMi) is exactly
   * goalSec; the rounded column carries a few seconds of residue across a
   * marathon. A consumer that integrates cumulative split times off these
   * segments (lib/race/pacing.ts) has to use this one or its FINISH
   * checkpoint drifts off the target it was built from.
   */
  pacePreciseSPerMi: number;
  durationSec: number;
}

/**
 * The opening model as executable segments — settle, (early), remainder.
 *
 * The watch consumes this (lib/watch/build-workout.ts) so the wrist and the
 * phone prescribe the same opening. Before this the watch handed the runner
 * flat goal pace from the gun while the phone's split card said settle:
 * two surfaces, one runner, opposite instructions on race morning.
 */
export function raceOpeningSegments(
  args: { goalSec: number; distanceMi: number | null | undefined },
): RaceOpeningSegment[] {
  const { goalSec, distanceMi } = args;
  if (!(goalSec > 0) || distanceMi == null || !(distanceMi > 0)) return [];
  const plan = raceOpeningPlan(args);
  // Distance outside every doctrine row → no segments. Consumers already treat
  // an empty list as "no opening model", which is the honest answer.
  if (plan == null) return [];
  const settleEnd = Math.min(1, distanceMi);
  const out: RaceOpeningSegment[] = [];

  const push = (label: string, startMi: number, endMi: number, pace: number) => {
    const d = Number((endMi - startMi).toFixed(3));
    if (d <= 0.01) return;
    out.push({
      label, startMi, endMi, distanceMi: d,
      paceSPerMi: Math.round(pace),
      pacePreciseSPerMi: pace,
      durationSec: Math.round(d * pace),
    });
  };

  push('Settle', 0, settleEnd, plan.settlePaceSPerMi);
  if (plan.openingMi > settleEnd) push('Find rhythm', settleEnd, plan.openingMi, plan.earlyPaceSPerMi);
  push('Goal pace', plan.openingMi, distanceMi, plan.repaidPaceSPerMi);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// 2 · Mid-race checkpoint + HR ceilings · Research/08 §6.1 (:271-278)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Where the mid-race abort check sits, as a fraction of race distance.
 *
 * §2.2 (:44) names the fourth 5-km segment (15-20 km, i.e. 36-47% of a
 * marathon) as the most prognostic; §6.2 (:291) puts the marathon's
 * calibration check at the first 10K (38%); §18.3 (:777) reassesses "at the
 * next 5K". A fixed mile-5 checkpoint is dead inside a 5K and arrives at
 * 19% of a marathon — too early to mean anything either way.
 */
export const RACE_CHECKPOINT_FRACTION = 0.38;

/** Checkpoint mile for a race, ≥1 and always inside the course. */
export function raceCheckpointMi(distanceMi: number): number {
  if (!(distanceMi > 0)) return 1;
  return Math.max(1, Math.min(Math.round(distanceMi * RACE_CHECKPOINT_FRACTION), Math.floor(distanceMi)));
}

/**
 * Research/08 §6.1 (:271-276) — race HR ceilings, [lo, hi] as a fraction.
 *
 * | Distance | %HRmax  | %LTHR   |
 * | 5K       | 95-100  | 105-110 |
 * | 10K      | 92-96   | 100-105 |
 * | Half     | 88-92   | 96-100  |
 * | Marathon | 80-88   | 88-95   |
 *
 * The table stops at the marathon. Ultra takes the marathon row — the
 * slowest cited ceiling — rather than an invented one; as an ABORT trigger
 * that is permissive, never dangerous.
 */
export const RACE_HR_PCT_LTHR: Readonly<Record<RaceDistanceCategory, readonly [number, number]>> = {
  '5k': [1.05, 1.10],
  '10k': [1.00, 1.05],
  'hm': [0.96, 1.00],
  'm': [0.88, 0.95],
  'ultra': [0.88, 0.95],
};

export const RACE_HR_PCT_MAX: Readonly<Record<RaceDistanceCategory, readonly [number, number]>> = {
  '5k': [0.95, 1.00],
  '10k': [0.92, 0.96],
  'hm': [0.88, 0.92],
  'm': [0.80, 0.88],
  'ultra': [0.80, 0.88],
};

/**
 * "Clearly above the band" margin on the LTHR-derived abort trigger, bpm.
 * The ceiling itself is a guide (§6.1 :269 — drift adds 3-5 bpm/hour); the
 * trigger has to clear sensor noise before it tells a runner to abandon the
 * A goal.
 */
export const RACE_HR_TRIGGER_MARGIN_BPM = 3;

/**
 * Mid-race abort HR for the distance. LTHR anchors when present (the
 * table's %LTHR column); %HRmax is the fallback column, not a different
 * model. Null when the runner has neither anchor.
 */
export function raceAbortHrBpm(args: {
  distanceMi: number;
  lthr?: number | null;
  maxHr?: number | null;
}): number | null {
  const cat = raceDistanceCategory(args.distanceMi);
  if (cat == null) return null;
  if (args.lthr != null && args.lthr > 0) {
    return Math.round(args.lthr * RACE_HR_PCT_LTHR[cat][1]) + RACE_HR_TRIGGER_MARGIN_BPM;
  }
  if (args.maxHr != null && args.maxHr > 0) {
    return Math.round(args.maxHr * RACE_HR_PCT_MAX[cat][1]);
  }
  return null;
}

/**
 * Pace-adrift abort fraction. §18.2 (:767) prices "going out 5+ sec/mile
 * too fast" as a blow-up; §2.2's CV table (:35-42) puts a sub-3 amateur at
 * 5-8% segment variability. 5% of goal pace is the same quantum at every
 * distance — a flat +23 s/mi was 5.6% of a half's pace and 7% of a 5K's.
 */
export const RACE_PACE_ABORT_FRACTION = 0.05;

/**
 * B2 (2026-09-02) · THE ONE DERIVATION OF THE RACE ROW'S PACE-ADRIFT ABORT.
 *
 * The rule is a function of ONE quantity — the pace the runner was told to
 * race at — and that quantity has exactly one owner
 * (`race-outlook.execution.paceSecPerMi`). Before this existed, `spec-builder`
 * built the rule at authoring off the authoring seed and
 * `race-row-refresh` rewrote the row's pace WITHOUT rewriting the rule, so
 * the owner's CIM row shipped `target 443 s/mi` beside `abort if slower than
 * 458 s/mi` — 458 being 1.05 × 436, the authoring seed the brain had already
 * replaced. The runner read a target and an abort anchored to two different
 * numbers on one row.
 *
 * Both writers now call this. Rule 16: one quantity, one derivation.
 * Cite: `Research/08` §18.2 / §2.2 via `RACE_PACE_ABORT_FRACTION` above.
 */
export interface RacePaceAbortRule {
  kind: 'abort';
  metric: 'pace';
  op: '>';
  value: number;
  scope: string;
  action: 'switch_to_b_goal';
  label: string;
}

export function racePaceAbortRule(args: {
  /** Race distance, miles. Drives the checkpoint mile. */
  distanceMi: number | null | undefined;
  /** The prescribed race-day pace, s/mi. */
  targetPaceSecPerMi: number | null | undefined;
}): RacePaceAbortRule | null {
  // Rule 11 · BOTH inputs are refused rather than defaulted. A rule with no
  // anchor is not a conservative rule, it is an invented one — and the
  // distance half mattered: this branch used to fall back to a literal
  // "Mile 5" when the distance was missing, which put a 5K's checkpoint at a
  // mile it never reaches and a marathon's a fifth of the way in. The same
  // shape `raceCheckpointMi` was introduced to remove.
  const target = args.targetPaceSecPerMi;
  const distanceMi = args.distanceMi;
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return null;
  if (typeof distanceMi !== 'number' || !Number.isFinite(distanceMi) || distanceMi <= 0) return null;
  const checkpointMi = raceCheckpointMi(distanceMi);
  const abortPace = Math.round(target * (1 + RACE_PACE_ABORT_FRACTION));
  return {
    kind: 'abort',
    metric: 'pace',
    op: '>',
    value: abortPace,
    scope: `mile-${checkpointMi}`,
    action: 'switch_to_b_goal',
    label: `Mile ${checkpointMi} check: pace slower than ${Math.floor(abortPace / 60)}:${String(abortPace % 60).padStart(2, '0')}/mi · switch to the B plan`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 3 · Warm-up · Research/08 §12.1 (:588-595) + Research/10 (:110-146)
// ─────────────────────────────────────────────────────────────────────────

export interface WarmupProtocol {
  /** §12.1 total-time band, minutes. */
  totalMinBand: readonly [number, number];
  /** 'jog' for 5K-HM, 'walk' for marathon and beyond. */
  mode: 'jog' | 'walk';
  /** Prescribed easy-jog (or walk) minutes. */
  easyMin: number;
  /** Easy-jog distance band in miles, null when the row prescribes time. */
  easyMiBand: readonly [number, number] | null;
  /** Dynamic drills / mobility block, minutes (0 = none). */
  drillsMin: number;
  /** §12.1 stride-count band [lo, hi]. */
  stridesBand: readonly [number, number];
  /** What we prescribe (Research/10 :133 overrides §12.1 for the marathon). */
  strides: number;
  /** Pace the strides are run at. */
  stridesPace: string;
  /** Minutes before the gun the runner is in the corral / done warming up. */
  corralMinBeforeGun: number;
  citation: string;
}

/**
 * Research/08 §12.1 (:588-593) — "the shorter the race, the longer the warmup":
 *
 * | Race | Total     | Protocol                                            |
 * | 5K   | 15-25 min | 2-3 mi easy + drills + 4-6 strides, last at 3K pace |
 * | 10K  | 15-20 min | 1.5-2.5 mi easy + drills + 4-6 strides at 10K pace  |
 * | Half | 10-15 min | 0.5-1.5 mi easy + drills + 3-4 strides at HMP       |
 * | M    | 5-10 min  | walk 5-10 or jog 3-5 + 2-3 strides; first 3 km warms |
 *
 * Research/10 (:133) is the more specific warm-up source and overrides the
 * marathon stride count: "Marathon warmup (minimal, 5-10 min) … No strides.
 * First 1-3 mi of race serve as warmup. Conserve glycogen." Research/10
 * (:141-146) also gives the volume ladder (5K = 100%, M = 15-20%, ultra =
 * 10% "walk to start"), which is where the ultra row comes from.
 *
 * The timeline is built backwards from `corralMinBeforeGun`, so the whole
 * protocol lands in the §12.1 band instead of the old 45-minutes-out,
 * every-distance-identical block.
 */
export const RACE_WARMUP: Readonly<Record<RaceDistanceCategory, WarmupProtocol>> = {
  '5k': {
    totalMinBand: [15, 25], mode: 'jog', easyMin: 14, easyMiBand: [2, 3],
    drillsMin: 5, stridesBand: [4, 6], strides: 5, stridesPace: '3K-mile pace',
    corralMinBeforeGun: 5,
    citation: 'Research/08 §12.1 (:590) + Research/10 (:112-120)',
  },
  '10k': {
    totalMinBand: [15, 20], mode: 'jog', easyMin: 10, easyMiBand: [1.5, 2.5],
    drillsMin: 5, stridesBand: [4, 6], strides: 4, stridesPace: '10K pace',
    corralMinBeforeGun: 5,
    citation: 'Research/08 §12.1 (:591) + Research/10 (:122-124)',
  },
  'hm': {
    totalMinBand: [10, 15], mode: 'jog', easyMin: 7, easyMiBand: [0.5, 1.5],
    drillsMin: 3, stridesBand: [3, 4], strides: 3, stridesPace: 'half-marathon pace',
    corralMinBeforeGun: 15,
    citation: 'Research/08 §12.1 (:592) + Research/10 (:126-128)',
  },
  'm': {
    totalMinBand: [5, 10], mode: 'walk', easyMin: 7, easyMiBand: null,
    drillsMin: 3, stridesBand: [0, 2], strides: 0, stridesPace: '',
    corralMinBeforeGun: 15,
    citation: 'Research/08 §12.1 (:593) + Research/10 (:130-133) "No strides"',
  },
  'ultra': {
    totalMinBand: [5, 10], mode: 'walk', easyMin: 7, easyMiBand: null,
    drillsMin: 3, stridesBand: [0, 0], strides: 0, stridesPace: '',
    corralMinBeforeGun: 15,
    citation: 'Research/10 (:141-146) — ultra warm-up is 10% of 5K: walk to start',  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  },
};

/** Null when the distance is unknown · there is no protocol to hand back. */
export function raceWarmup(distanceMi: number | null | undefined): WarmupProtocol | null {
  const cat = raceDistanceCategory(distanceMi);
  return cat == null ? null : RACE_WARMUP[cat];
}

/** Minutes the stride block occupies · ~1 min per stride with recovery. */
export function warmupStridesBlockMin(row: WarmupProtocol): number {
  return row.strides > 0 ? Math.max(2, row.strides) : 0;
}

/** Total prescribed warm-up minutes · must land in `totalMinBand`. */
export function warmupTotalMin(row: WarmupProtocol): number {
  return row.easyMin + row.drillsMin + warmupStridesBlockMin(row);
}

// ─────────────────────────────────────────────────────────────────────────
// 4 · Race-week + race-day nutrition
//     Research/08 §10.1 (:452-457) · Research/18 §10 (:355-361), §11 (:367-376)
// ─────────────────────────────────────────────────────────────────────────

export interface CarbLoadRow {
  /** g/kg/day band. */
  gPerKgBand: readonly [number, number];
  /** Hours before the gun the load runs over; null when no load is needed. */
  hoursBand: readonly [number, number] | null;
  /** False for races under ~90 min — normal training nutrition suffices. */
  needsLoad: boolean;
  citation: string;
}

/**
 * Research/08 §10.1 (:452-457) — carb loading BY DISTANCE:
 *
 * | 5K, 10K   | Normal training carbs (5-7 g/kg/day) |
 * | Half      | 7-8 g/kg/day for 24-36 h             |
 * | Marathon  | 8-12 g/kg/day for 36-48 h            |
 * | Ultra 50K+| 8-12 g/kg/day for 48-72 h            |
 *
 * :450 gates the whole protocol on races over 90 min. :770 caps it: over
 * 12 g/kg is GI distress and water weight, not glycogen.
 */
export const RACE_CARB_LOAD: Readonly<Record<RaceDistanceCategory, CarbLoadRow>> = {
  '5k': { gPerKgBand: [5, 7], hoursBand: null, needsLoad: false, citation: 'Research/08 §10.1 (:454)' },
  '10k': { gPerKgBand: [5, 7], hoursBand: null, needsLoad: false, citation: 'Research/08 §10.1 (:454)' },
  'hm': { gPerKgBand: [7, 8], hoursBand: [24, 36], needsLoad: true, citation: 'Research/08 §10.1 (:455)' },
  'm': { gPerKgBand: [8, 12], hoursBand: [36, 48], needsLoad: true, citation: 'Research/08 §10.1 (:456)' },
  'ultra': { gPerKgBand: [8, 12], hoursBand: [48, 72], needsLoad: true, citation: 'Research/08 §10.1 (:457)' },
};

/** Null when the distance is unknown · there is no load to prescribe. */
export function raceCarbLoad(distanceMi: number | null | undefined): CarbLoadRow | null {
  const cat = raceDistanceCategory(distanceMi);
  return cat == null ? null : RACE_CARB_LOAD[cat];
}

/** Research/18 §10 (:355-361) — pre-race meal carbohydrate, g/kg, ~3 h out. */
export const RACE_PRERACE_MEAL_G_PER_KG: Readonly<Record<RaceDistanceCategory, readonly [number, number]>> = {
  '5k': [1, 1],
  '10k': [1.5, 1.5],
  'hm': [2, 2],
  'm': [3, 4],
  'ultra': [3, 4],
};

export interface RaceCarbRateRow {
  /** §11 CHO/hr band, g/hr. */
  bandGPerHr: readonly [number, number];
  /** What we prescribe inside it, g/hr. */
  targetGPerHr: number;
  citation: string;
}

/**
 * Research/18 §11 (:367-376) — during-race CHO/hr BY DISTANCE:
 *
 * | 5K   | 0 (mouth-rinse OK)      |
 * | 10K  | 0-30 (last third only)  |
 * | Half | 30-60                   |
 * | M    | 60-90                   |
 * | 50K+ | 60-90                   |
 *
 * The half's prescription is the midpoint (45), not the top: §1 (:27) makes
 * 60 g/hr "the threshold above which single-source glucose causes GI
 * distress in most runners". The marathon's 75 is the 60-90 midpoint — the
 * number the app used to hand EVERY distance, correct only on this row.
 */
export const RACE_CARB_G_PER_HR: Readonly<Record<RaceDistanceCategory, RaceCarbRateRow>> = {
  '5k': { bandGPerHr: [0, 0], targetGPerHr: 0, citation: 'Research/18 §11 (:369) — 5K: 0 g/hr' },  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  '10k': { bandGPerHr: [0, 30], targetGPerHr: 0, citation: 'Research/18 §11 (:370) — 10K: 0-30, last third only' },  // ok: citation strings quoting Research doc text; developer-facing provenance, never rendered at a runner
  'hm': { bandGPerHr: [30, 60], targetGPerHr: 45, citation: 'Research/18 §11 (:371) + §1 (:27) GI threshold' },
  'm': { bandGPerHr: [60, 90], targetGPerHr: 75, citation: 'Research/18 §11 (:372)' },
  'ultra': { bandGPerHr: [60, 90], targetGPerHr: 75, citation: 'Research/18 §11 (:373)' },
};

/**
 * Research/18 §1 (:13-19) — CHO/hr by DURATION. The distance table above is
 * keyed to each row's typical duration (:367); a race that runs long for
 * its distance (a 3-hour half) is governed by the duration table instead.
 * Both tables are floors, so the prescription is the higher of the two.
 *
 * Values are band midpoints: 1-2.5 h → 30-60 → 45; 2.5-3 h → 60-90 → 75.
 * Over 3 h the table reads 90-120 but requires a trained gut, so we hold at
 * 75 and let the runner's own entered rate go higher.
 */
export function durationCarbFloorGPerHr(goalSec: number | null | undefined): number {
  if (goalSec == null || !(goalSec > 0)) return 0;
  const hr = goalSec / 3600;
  if (hr < 1.25) return 0;      // <45 min none; 45-75 min mouth-rinse / small amounts
  if (hr < 2.5) return 45;      // 1-2.5 h → 30-60 g/hr
  return 75;                    // 2.5 h+ → 60-90 g/hr
}

export interface RaceCarbTarget {
  targetGPerHr: number;
  bandGPerHr: readonly [number, number];
  /** True when the doctrine prescribes NO on-course carbohydrate. */
  isZero: boolean;
  citation: string;
}

/**
 * The race's on-course carb target: the distance row, floor-raised by the
 * duration row. `goalSec` optional — distance alone when the duration is
 * not known (e.g. sizing a training-run gut-rehearsal ramp).
 */
export function raceCarbsPerHourTarget(
  distanceMi: number | null | undefined,
  goalSec?: number | null,
): RaceCarbTarget | null {
  const cat = raceDistanceCategory(distanceMi);
  if (cat == null) return null;
  const row = RACE_CARB_G_PER_HR[cat];
  const floor = durationCarbFloorGPerHr(goalSec);
  const target = Math.max(row.targetGPerHr, floor);
  return {
    targetGPerHr: target,
    bandGPerHr: row.bandGPerHr,
    isZero: target <= 0,
    citation: floor > row.targetGPerHr
      ? `${row.citation} + Research/18 §1 (:17-18) duration floor`
      : row.citation,
  };
}

/**
 * The honest fallback when the race distance is unknown: the §1 DURATION
 * table alone, which needs no distance. Prescribing by duration is not a
 * guess — it is the other half of the same doctrine. What it must never do is
 * silently borrow a distance row, which is what the old 'hm' default did.
 */
export function durationOnlyCarbTarget(goalSec: number | null | undefined): RaceCarbTarget {
  const rate = durationCarbFloorGPerHr(goalSec);
  return {
    targetGPerHr: rate,
    bandGPerHr: [rate, rate],
    isZero: rate <= 0,
    citation: 'Research/18 §1 (:13-19) duration table · race distance unknown, no distance row applied',
  };
}

/**
 * Research/18 §11 (:369-372) — in-race caffeine, as fractions of race
 * distance:
 *
 *   5K / 10K   pre-race only, nothing on course
 *   Half       pre + 1 caffeinated gel mid-race
 *   Marathon   200 mg pre + 100 mg @ mi 13 + 100 mg @ mi 20 (0.50 / 0.76)
 *   Ultra      200 mg pre + 50-100 mg/hr — hourly, not positional
 */
export const RACE_CAFFEINE_FRACTIONS: Readonly<Record<RaceDistanceCategory, readonly number[]>> = {
  '5k': [],
  '10k': [],
  'hm': [0.5],
  'm': [13 / 26.2, 20 / 26.2],
  'ultra': [],
};

/** Ultra caffeine is hourly (§11 :373), not positional. Minutes between hits. */
export const ULTRA_CAFFEINE_INTERVAL_MIN = 60;

/**
 * Which scheduled fuel stops carry caffeine. Positional for HM/M; hourly
 * from the first hour for ultras; none for 5K/10K (pre-race only).
 */
export function caffeineStopIndexes(args: {
  distanceMi: number | null | undefined;
  /** Mile position of each scheduled stop, in order. */
  stopsMi: number[];
  /** Elapsed minutes at each stop (same order, same length). */
  stopsMin?: number[];
}): Set<number> {
  const cat = raceDistanceCategory(args.distanceMi);
  const out = new Set<number>();
  // Distance unknown → no positional schedule to derive. Prescribe nothing
  // rather than hand out the half's mid-race gel to an unknown event.
  if (cat == null || args.stopsMi.length === 0) return out;

  if (cat === 'ultra') {
    const mins = args.stopsMin ?? [];
    let last = 0;
    mins.forEach((m, i) => {
      if (m >= ULTRA_CAFFEINE_INTERVAL_MIN && m - last >= ULTRA_CAFFEINE_INTERVAL_MIN) {
        out.add(i);
        last = m;
      }
    });
    return out;
  }

  for (const frac of RACE_CAFFEINE_FRACTIONS[cat]) {
    const targetMi = frac * (args.distanceMi ?? 0);
    let best = -1;
    let bestGap = Infinity;
    args.stopsMi.forEach((mi, i) => {
      const gap = Math.abs(mi - targetMi);
      if (gap < bestGap && !out.has(i)) { bestGap = gap; best = i; }
    });
    if (best >= 0) out.add(best);
  }
  return out;
}
