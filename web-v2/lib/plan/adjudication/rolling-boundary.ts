/**
 * lib/plan/adjudication/rolling-boundary.ts · THREE DECISIONS, NOT ONE GATE.
 *
 * ── WHY THE SINGLE GATE WAS THE WRONG SHAPE ────────────────────────────────
 *
 * `CIM0921GATE.md` proposed one assessment on 2026-09-20 with eight conditions,
 * and the owner's ruling on reading it was: "Do not use one impossible gate."
 * He is right, and for a reason worth writing down. A single gate has to decide
 * on 09-20 what the week will cost, using evidence that does not exist yet —
 * how the Tuesday tempo is absorbed, and what the Saturday 10K actually turns
 * out to be. It must therefore either guess or refuse, and a gate that refuses
 * is a gate that never fires.
 *
 * Three boundaries each decide with the evidence available AT that moment, and
 * each can only change what is still ahead of it. That is the difference
 * between a forecast and a decision.
 *
 * ── AND WHY STRESSOR COUNT WAS THE WRONG MEASURE ───────────────────────────
 *
 * The gate document's finding was that the week goes "2 to 3 stressors" and so
 * violates `Research/00a`'s one-at-a-time rule. Measured against the engine's
 * own detector it does not: the baseline is the MAXIMUM over the trailing three
 * weeks, and 2026-08-31 already carried three.
 *
 * The owner's response is the correct one and it goes further than the
 * correction: "three stressors versus three stressors is not enough to prove
 * equivalent demand. A controlled 10K followed immediately by 17 miles may cost
 * more than the earlier three-stressor week."
 *
 * So these boundaries compare DEMAND — `projectPlanLoad`'s index, which prices
 * weekly miles, the long-run surcharge and quality minutes together — and not a
 * count of hard days. Measured on the live block, the difference matters:
 *
 *   week        mi   long  qmin   demand   Δ vs trailing-3 max
 *   2026-08-31  46.5  15    102    83.91          —
 *   2026-09-14  46.8  16.5   65    72.38      -13.7%
 *   2026-09-21  55.2  17    110    95.75      +14.1%      ← by mileage: +17.9%
 *   2026-10-26  60    21.5  130   108.28       +9.6%      ← the block's real peak
 *
 * By demand the step is SMALLER than by mileage, because 08-31 already carried
 * 102 quality minutes. And 09-21 is not the block's stress point: the same
 * runner is asked for 108.3 five weeks later.
 *
 * ── WHAT THIS FILE CANNOT DO (Rule 22) ─────────────────────────────────────
 *
 * · It cannot write. It returns the exact mutation each boundary WOULD make.
 * · It cannot see the future. Boundary 1 deliberately does not try to price the
 *   Saturday race; that is boundary 3's job and boundary 3 has the evidence.
 * · It does not decide whether the demand model's coefficients are right. They
 *   are crude and their own header admits it. What it fixes is comparing the
 *   same quantity on both sides (Rule 16), which counting stressors did not.
 *
 * ── 2026-09-06 · BOUNDARY 1 REDESIGNED AS CONTINUOUS CONFIDENCE, NOT A GATE ──
 *
 * The version of this file that shipped 2026-09-05 sized the allowed step as
 * `allowedStepShare * completionRatio` — continuous in completion, per Rule 9,
 * but still gated by a single flat `allowedStepShare`. That constant was a
 * placeholder (`RERAMP_WEEKLY_GROWTH - 1` = 0.10) fighting this file's own
 * illustrative test (0.15), and the two disagreed on the one week that
 * mattered: the 09-21 week's real +14.1% demand step reads PROCEED at 0.15 and
 * REDUCE at 0.10. Two numbers deciding one verdict is a Rule 16 defect wearing
 * a tuning-constant costume, and `RERAMP_WEEKLY_GROWTH` was the wrong citation
 * regardless of which value survived — it prices `Research/22 §14`'s COMEBACK
 * ramp (70% of a pre-absence average, climbing back after a layoff), not
 * ordinary in-block progression for a runner who never left. The owner's
 * ruling, verbatim: "RERAMP_WEEKLY_GROWTH may not own ordinary build-week
 * progression; it answers a different question."
 *
 * The ruling that replaces it: demand growth up to 10% is normally
 * supportable when recent execution and recovery are clean; from 10% to 15%
 * confidence decreases CONTINUOUSLY and the push becomes increasingly
 * conditional; above 15% requires unusually strong athlete-specific support.
 * No abrupt verdict change at 10% or 15%, ever — Rule 9 by name.
 *
 * The bands themselves are not invented for this file. `Research/00a` §"The
 * 10% rule — reconsidered" is the citation: the flat "≤10%/week" rule "is not
 * strongly supported by recent evidence" (an RCT let novices ramp +24% over 8
 * weeks with no elevated injury rate against +10% over 12, and "weekly
 * mileage change correlated weakly with injury" in the same 5,200-runner
 * cohort) — which is doctrine's own argument that 10% is the START of a soft
 * caution zone, not a wall. The same document's ACWR table, four lines above
 * it, is the CI-precedented shape this file borrows: named control points
 * (0.8, 1.3, 1.5) with a continuous response running through them — the exact
 * reading CLAUDE.md Rule 9 already applied to ACWR. And its single-session
 * spike rule (>110% of the prior-30-day longest run → ~64% higher injury
 * risk, >130% → higher still) is doctrine's own template for "above a line,
 * only an exceptional case still proceeds" — the shape ">15% needs unusually
 * strong support" borrows. See `demandGrowthBaseConfidence` and
 * `demandStepConfidence` below for the implementation.
 */

import { projectPlanLoad, type ProjectedPlanLoad } from './canonical-demand';
import type { ScheduleRequest } from '@/lib/ops/reassessment-scheduler';
import { roundTo } from '@/lib/format/run';

/** One week, priced. */
export interface WeekDemand {
  readonly weekStartISO: string;
  readonly load: ProjectedPlanLoad;
}

export function priceWeek(w: {
  weekStartISO: string; weeklyMi: number; longRunMi: number; qualityMinutes: number;
}): WeekDemand {
  return {
    weekStartISO: w.weekStartISO,
    // The anchor is held at zero: a ceiling is a property of the athlete, not
    // of any proposal, and the same reasoning applies to a baseline.
    load: projectPlanLoad({
      weeklyMi: w.weeklyMi, longRunMi: w.longRunMi,
      qualityMinutes: w.qualityMinutes, thresholdAnchorDeltaSecPerMi: 0,
    }),
  };
}

/**
 * The demand baseline: the HIGHEST of the trailing three weeks.
 *
 * A maximum, not a mean, for the reason CLAUDE.md Rule 8 gives one level up —
 * a cutback, a taper or a race week is not the runner's normal, and a mean
 * lets one of them drag the baseline down and manufacture a finding. A maximum
 * is immune to a dip by construction.
 *
 * Refuses (Rule 11) rather than guessing when every trailing week is a
 * prescribed dip: there is no baseline to read, and that is "do not know".
 */
export type Baseline =
  | { readonly known: true; readonly demandIndex: number; readonly fromWeekISO: string }
  | { readonly known: false; readonly why: string };

export function demandBaseline(
  trailing: readonly WeekDemand[],
  isPrescribedDip: (weekStartISO: string) => boolean,
): Baseline {
  const window = trailing.slice(-3).filter((w) => w.load.weeklyMi > 0);
  if (window.length === 0) return { known: false, why: 'no trailing weeks to read' };
  if (window.every((w) => isPrescribedDip(w.weekStartISO))) {
    return {
      known: false,
      why: 'every week in the baseline window was a prescribed dip, so there is no normal to '
        + 'measure against',
    };
  }
  let best = window[0];
  for (const w of window) if (w.load.demandIndex > best.load.demandIndex) best = w;
  return { known: true, demandIndex: best.load.demandIndex, fromWeekISO: best.weekStartISO };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BOUNDARIES
 * ═══════════════════════════════════════════════════════════════════════ */

export type BoundaryVerdict = 'PROCEED' | 'REDUCE' | 'REFUSE';

export interface BoundaryDecision {
  readonly verdict: BoundaryVerdict;
  readonly because: string;
  /** The exact change, or null when the answer is to proceed unchanged. */
  readonly mutation: ProposedMutation | null;
}

export interface ProposedMutation {
  readonly planWorkoutId: string;
  readonly dateISO: string;
  readonly change: string;
  readonly newType?: string;
  readonly newDistanceMi?: number;
}

/**
 * The five continuous inputs the ruling names — "training phase, available
 * runway, fatigue, safety and recent absorption remain inputs" — as ONE
 * confidence context, never a second cliff stacked on the first.
 *
 * Every field is [0,1] and every field is a genuine reading or an HONESTLY
 * NEUTRAL placeholder (Rule 11): "don't know" must read as 0.5, not as 1.0
 * (assumed clean) and not as 0.0 (assumed dangerous) — either assumption would
 * be inventing evidence.
 */
export interface DemandStepContext {
  /** "Recent absorption" · how cleanly the runner has actually been landing
   *  what was prescribed across the trailing window — 1.0 if every trailing
   *  week met or exceeded its prescription, decaying toward 0 the more they
   *  fell short. This is the "run of clean weeks" the ruling names. */
  readonly recentExecutionCleanliness: number;
  /** How undiluted the baseline itself is — 1.0 when none of the trailing
   *  weeks were a prescribed dip (taper/race/recovery), lower as more of them
   *  were. `demandBaseline` already refuses outright when ALL of them were;
   *  this is the continuous read of the weeks it did NOT refuse on. */
  readonly baselineFreedomFromDip: number;
  /** "Fatigue, safety" · low ACWR, no recent deterioration, in the ruling's
   *  own phrasing. NOT YET WIRED to a real reader — no ACWR/HRV feed reaches
   *  this file as of 2026-09-06 (see `rolling-boundary-evaluator.ts`'s own
   *  header for the boundary-2 precedent of naming a gap rather than hiding
   *  it). `NEUTRAL_FATIGUE_SAFETY_CLEARANCE` is the honest placeholder until
   *  one exists — 0.5, never 1.0, so an unknown never silently reads as safe. */
  readonly fatigueSafetyClearance: number;
  /** "Training phase" · 1.0 in an ordinary build/base week, 0.0 when the
   *  PROPOSED week is itself a taper or a race week (a volume push has no
   *  business there — that is the phase pushing back, not this file). */
  readonly trainingPhaseOpenness: number;
  /** "Available runway" · how much authored block remains ahead of this week
   *  to make use of a bigger step and absorb it, not just this week in
   *  isolation. Scoped to the currently authored block (weeks still ahead in
   *  `loadPlannedWeeks`'s read) rather than to a race-calendar lookup, which
   *  would be a second, un-audited query this file's own header already
   *  argues against building blind — a stated scoping choice, not a silent
   *  approximation. */
  readonly runwayOpenness: number;
}

/** Rule 11's explicit "don't know", for any `DemandStepContext` field a
 *  caller cannot yet actually read — 0.5, never 1.0 (assumed clean) and never
 *  0.0 (assumed dangerous), because either would be inventing evidence. */
export const NEUTRAL_UNKNOWN_CONTEXT = 0.5;
/** The specific case the ruling names: "fatigue, safety" has no real
 *  ACWR/HRV reader wired into this evaluator as of 2026-09-06. Kept as its
 *  own named constant (same value) so a call site reads as "this dimension
 *  is unbuilt", not as a generic fallback. */
export const NEUTRAL_FATIGUE_SAFETY_CLEARANCE = NEUTRAL_UNKNOWN_CONTEXT;

/**
 * Blends the five continuously — a WEIGHTED MEAN, not a hard AND, so no
 * single flat input can zero out the others in one step (that would just be
 * a differently-shaped cliff). Weights favour what the runner has actually
 * been doing (execution, 0.30) and what condition he is in right now
 * (fatigue/safety, 0.25) over the more structural reads (phase 0.20, runway
 * 0.15, baseline cleanliness 0.10) — sums to 1.0.
 */
export function demandStepContextScore(c: DemandStepContext): number {
  return clamp01(
    clamp01(c.recentExecutionCleanliness) * 0.30
    + clamp01(c.fatigueSafetyClearance) * 0.25
    + clamp01(c.trainingPhaseOpenness) * 0.20
    + clamp01(c.runwayOpenness) * 0.15
    + clamp01(c.baselineFreedomFromDip) * 0.10,
  );
}

/** The 10-15% band's own midpoint · the logistic's centre, not a step. */
const DEMAND_GROWTH_BAND_LOWER = 0.10;
const DEMAND_GROWTH_BAND_UPPER = 0.15;
const DEMAND_GROWTH_BAND_CENTER = (DEMAND_GROWTH_BAND_LOWER + DEMAND_GROWTH_BAND_UPPER) / 2; // 0.125

/**
 * Solved so the logistic reads ~0.85 confidence AT exactly 10% growth and
 * ~0.15 AT exactly 15% — the two edges the ruling names — with everything
 * between and beyond following smoothly and symmetrically from the same
 * curve. `Math.log((1-0.15)/0.15)` is the logit of 0.15; the scale is the
 * distance from the band's edge to its centre divided by that logit, which is
 * what makes both edges land where the ruling puts them from one formula.
 */
const DEMAND_GROWTH_LOGISTIC_SCALE =
  (DEMAND_GROWTH_BAND_UPPER - DEMAND_GROWTH_BAND_CENTER) / Math.log((1 - 0.15) / 0.15);

/**
 * The bare confidence a demand-growth step earns BEFORE any athlete-specific
 * context is applied. Smooth (C-infinity), strictly decreasing for step > 0,
 * ~1.0 well below the band, ~0.85 at 10%, ~0.5 at the band's own midpoint,
 * ~0.15 at 15%, asymptotic toward 0 beyond it — never a step function, and
 * never negative or above 1.
 */
export function demandGrowthBaseConfidence(step: number): number {
  if (!(step > 0)) return 1;
  const z = (step - DEMAND_GROWTH_BAND_CENTER) / DEMAND_GROWTH_LOGISTIC_SCALE;
  return 1 / (1 + Math.exp(z));
}

/**
 * How much of a large step's lost confidence UNUSUALLY STRONG athlete-
 * specific support can still earn back — continuously, never a second cliff.
 *
 * Capped BELOW `DEMAND_STEP_PUSH_CONFIDENCE_FLOOR` (0.45 < 0.5) on purpose,
 * not just below 1: as `step` grows without bound, `demandGrowthBaseConfidence`
 * decays toward 0, so the recovered confidence approaches
 * `CONTEXT_MAX_RECOVERY * score` — and capping that below the PUSH floor means
 * even PERFECT context (`score` = 1) can never wave an arbitrarily large step
 * through on its own. "Unusually strong support" narrows the gap for a step
 * that is merely past the soft band; it does not make an unbounded step size
 * irrelevant. Support earns back real confidence well past 15% (see the test
 * that compares strong vs. weak context at 16-35% growth) — it just never
 * reaches the point where growth itself stops mattering at all.
 */
const CONTEXT_MAX_RECOVERY = 0.45;

/**
 * THE confidence a demand-growth step earns, folding the bare growth curve
 * and the athlete's own context into one number. Still strictly decreasing in
 * `step` for any fixed context (context only ever narrows the gap toward 1,
 * proportionally to how much confidence remains to recover), so the
 * monotonicity Rule 9 demands survives regardless of how supportive the
 * context is.
 */
export function demandStepConfidence(step: number, context: DemandStepContext): number {
  const base = demandGrowthBaseConfidence(step);
  const score = demandStepContextScore(context);
  return clamp01(base + CONTEXT_MAX_RECOVERY * score * (1 - base));
}

/** The bar a step's confidence must clear to PROCEED as an earnable push
 *  rather than being offered a reduction. A control point, per Rule 9's own
 *  reading of ACWR's 1.3/1.5 — the RESPONSE either side of it is continuous
 *  (`demandStepConfidence` itself), this is just where PROCEED vs REDUCE is
 *  read off that continuous line. */
export const DEMAND_STEP_PUSH_CONFIDENCE_FLOOR = 0.5;

/**
 * BOUNDARY 1 · before the week. Assessed the day the week is authored to start.
 *
 * The question: is this week's DEMAND still a reasonable step on what the
 * runner has actually completed?
 *
 * Continuous confidence, per Rule 9 and the owner's 2026-09-06 ruling (see the
 * file header). There is no 10%-or-15% cliff: `demandStepConfidence` reads a
 * single continuous number from the growth step and the runner's own context,
 * and the verdict is where that number crosses `DEMAND_STEP_PUSH_CONFIDENCE
 * _FLOOR` — a hair's difference in growth or in context moves confidence by a
 * hair, never the verdict by a mile.
 */
export function boundaryBeforeWeek(args: {
  readonly proposed: WeekDemand;
  readonly baseline: Baseline;
  /** Rule 11's known/unknown gate ONLY — null means the immediately preceding
   *  week's completion could not be read at all, which refuses outright
   *  regardless of context. Its MAGNITUDE, when known, is deliberately not
   *  re-folded into the confidence math here a second time: the caller
   *  already carries that signal (and the fuller trailing-window trend it
   *  belongs to) inside `context.recentExecutionCleanliness`. Two inputs
   *  computed from the same completion data would be Rule 16's "one
   *  quantity, two names" the moment they were allowed to disagree. */
  readonly completionRatio: number | null;
  readonly context: DemandStepContext;
  readonly targetWorkoutId: string | null;
  readonly targetDateISO: string | null;
}): BoundaryDecision {
  if (!args.baseline.known) {
    return { verdict: 'REFUSE', because: args.baseline.why, mutation: null };
  }
  if (args.completionRatio === null) {
    return {
      verdict: 'REFUSE',
      because: 'the completed volume of the preceding week could not be read, and a step is '
        + 'sized off what he actually did',
      mutation: null,
    };
  }
  const step = args.proposed.load.demandIndex / args.baseline.demandIndex - 1;
  if (step <= 0) {
    return {
      verdict: 'PROCEED',
      because: `demand does not rise on the highest of the trailing three weeks `
        + `(${args.baseline.fromWeekISO})`,
      mutation: null,
    };
  }
  const confidence = demandStepConfidence(step, args.context);
  if (confidence >= DEMAND_STEP_PUSH_CONFIDENCE_FLOOR) {
    return {
      verdict: 'PROCEED',
      because: `demand rises ${pct(step)} on the highest of the trailing three weeks `
        + `(${args.baseline.fromWeekISO}) at ${pct(confidence)} confidence · an earnable push, `
        + `not an automatic one`,
      mutation: null,
    };
  }
  if (args.targetWorkoutId === null || args.targetDateISO === null) {
    return {
      verdict: 'REFUSE',
      because: `demand rises ${pct(step)} on ${args.baseline.fromWeekISO} at only `
        + `${pct(confidence)} confidence (below the ${pct(DEMAND_STEP_PUSH_CONFIDENCE_FLOOR)} bar `
        + 'to earn it), and no session in the week can be reduced without cutting the long run '
        + 'or a race',
      mutation: null,
    };
  }
  return {
    verdict: 'REDUCE',
    because: `demand rises ${pct(step)} on ${args.baseline.fromWeekISO} at only `
      + `${pct(confidence)} confidence · below the ${pct(DEMAND_STEP_PUSH_CONFIDENCE_FLOOR)} bar `
      + 'this completion and context earn',
    mutation: {
      planWorkoutId: args.targetWorkoutId,
      dateISO: args.targetDateISO,
      change: 'convert the largest non-race, non-long quality session to easy',
      newType: 'easy',
    },
  };
}

/**
 * BOUNDARY 2 · after the mid-week quality session.
 *
 * The question the owner set: "If the tempo is poorly absorbed, adjust the
 * weekend rather than pretending Tuesday never occurred."
 *
 * That sentence is the whole design. The alternative — deciding the weekend on
 * 09-20 and never revisiting it — is what makes a single gate dishonest, and
 * dropping the Tuesday session from the record once it has been run is the same
 * error pointed backwards.
 */
export function boundaryAfterQuality(args: {
  readonly absorbed: 'FULL' | 'PARTIAL' | 'POOR' | null;
  readonly weekendLongWorkoutId: string | null;
  readonly weekendLongDateISO: string | null;
  readonly weekendLongMi: number | null;
}): BoundaryDecision {
  if (args.absorbed === null) {
    // Rule 11 · an unread session is not a well-absorbed one. But it is also
    // not evidence of a problem, so this refuses rather than reducing: the
    // weekend stands and boundary 3 still gets its say.
    return {
      verdict: 'REFUSE',
      because: 'the quality session could not be graded, so it says nothing either way about '
        + 'the weekend',
      mutation: null,
    };
  }
  if (args.absorbed !== 'POOR') {
    return {
      verdict: 'PROCEED',
      because: `the quality session graded ${args.absorbed}, so the weekend stands as authored`,
      mutation: null,
    };
  }
  if (args.weekendLongWorkoutId === null || args.weekendLongDateISO === null
    || args.weekendLongMi === null) {
    return {
      verdict: 'REFUSE',
      because: 'the session was poorly absorbed and the weekend long run could not be resolved',
      mutation: null,
    };
  }
  return {
    verdict: 'REDUCE',
    because: 'the mid-week quality session was poorly absorbed, so the weekend is adjusted '
      + 'rather than the Tuesday being treated as though it had not happened',
    mutation: {
      planWorkoutId: args.weekendLongWorkoutId,
      dateISO: args.weekendLongDateISO,
      change: 'shorten the long run to the last supported distance',
      newDistanceMi: roundTo(args.weekendLongMi * 0.85),
    },
  };
}

/**
 * BOUNDARY 3 · after the race, before the long run.
 *
 * The question: what did that race actually COST? A C-effort tune-up and a true
 * race effort are different facts about the same finish line, and the day after
 * is the only moment the answer can still change the long run.
 */
export type RaceEffort = 'CONTROLLED_C' | 'THRESHOLD_LIKE' | 'TRUE_RACE' | 'UNRELIABLE';

export function boundaryAfterRace(args: {
  readonly effort: RaceEffort;
  readonly longWorkoutId: string;
  readonly longDateISO: string;
  readonly longMi: number;
}): BoundaryDecision {
  switch (args.effort) {
    case 'CONTROLLED_C':
      return {
        verdict: 'PROCEED',
        because: 'the race was run as the controlled effort it was prescribed as, so the long '
          + 'run stands',
        mutation: null,
      };
    case 'THRESHOLD_LIKE':
      return {
        verdict: 'REDUCE',
        because: 'the race was run at threshold rather than as a controlled effort, so it cost '
          + 'more than the week was priced for',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run',
          newDistanceMi: roundTo(args.longMi * 0.9),
        },
      };
    case 'TRUE_RACE':
      return {
        verdict: 'REDUCE',
        because: 'the race was a true maximal effort the day before a long run, and '
          + '`Research/00b` prices recovery from that in days rather than hours',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run substantially',
          newDistanceMi: roundTo(args.longMi * 0.75),
        },
      };
    case 'UNRELIABLE':
      // Rule 11 again, and the safe direction differs from boundary 2's. Here
      // the race HAPPENED and only its cost is unknown, so the conservative
      // answer is to ease rather than to stand pat.
      return {
        verdict: 'REDUCE',
        because: 'the race happened and its effort could not be classified; the cost is '
          + 'unknown rather than zero',
        mutation: {
          planWorkoutId: args.longWorkoutId, dateISO: args.longDateISO,
          change: 'shorten the long run',
          newDistanceMi: roundTo(args.longMi * 0.9),
        },
      };
  }
}

/**
 * Shared clamp, EXPORTED so callers building a `DemandStepContext` from real
 * reads (the evaluator's job) can clamp their own inputs with the same
 * function this file uses internally, rather than a second copy of `n < 0 ? 0
 * : n > 1 ? 1 : n` drifting from this one.
 *
 * `allowedStepFor` — the single flat `allowedStepShare * completionRatio`
 * gate this file used through 2026-09-05 — is REMOVED, not deprecated
 * alongside the new model. It was the exact "one number decides" shape the
 * owner's 2026-09-06 ruling replaces (see the file header); keeping it as an
 * unused export would be the "// legacy, don't use" comment
 * `DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` forbids, one document
 * removed.
 */
export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/* ══════════════════════════════════════════════════════════════════════════
 * PERSISTING THE THREE · so a boundary is a commitment, not a plan to remember
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The three boundaries for one week, as durable scheduler rows.
 *
 * Written as requests rather than as writes, for the same reason the boundaries
 * return mutations rather than applying them: nothing here has authority. The
 * caller schedules them.
 *
 * Rule 23 shapes the dates. Each `assessOnISO` is the last day the answer can
 * still change the thing it is about — assessing a week's size on the day it
 * starts, or a long run's size after it has been run, is a decision that
 * arrives too late to be one. `overdueAfterISO` is one day later, so a boundary
 * that silently never fires RAISES rather than passing unnoticed. Lateness must
 * be harmless, and a boundary that never ran must be NOTICED.
 *
 * `idempotencyKey` is the week plus the boundary, so the nightly sweep can
 * re-request these every night and get one row each. A scheduler that grows a
 * duplicate per tick is a scheduler nobody can read.
 */
export function boundariesForWeek(args: {
  readonly userUuid: string;
  readonly planId: string;
  readonly planVersion: string;
  readonly weekStartISO: string;
  /** The day before the week begins. Boundary 1. */
  readonly assessBeforeISO: string;
  /** The morning after the mid-week quality session. Boundary 2. */
  readonly assessAfterQualityISO: string;
  /** The morning after the race, before the long run. Boundary 3. */
  readonly assessAfterRaceISO: string;
  readonly todayISO: string;
}): readonly ScheduleRequest[] {
  const base = {
    userUuid: args.userUuid,
    planId: args.planId,
    planVersion: args.planVersion,
    queuedAtISO: args.todayISO,
  } as const;

  return [
    {
      ...base,
      kind: 'EARNING_GATE',
      reasonCode: 'week_demand_step',
      reasonDetail: 'Does the completed preceding week support the demand step this week asks '
        + 'for? Read continuously, not as a pass mark.',
      assessOnISO: args.assessBeforeISO,
      overdueAfterISO: nextDay(args.assessBeforeISO),
      lever: 'WEEKLY_VOLUME',
      idempotencyKey: `rolling:${args.weekStartISO}:before`,
      payload: { boundary: 1, weekStartISO: args.weekStartISO },
    },
    {
      ...base,
      kind: 'CONDITIONAL_DOSE',
      reasonCode: 'weekend_after_quality',
      reasonDetail: 'If the mid-week quality session was poorly absorbed, adjust the weekend '
        + 'rather than pretending Tuesday never occurred.',
      assessOnISO: args.assessAfterQualityISO,
      overdueAfterISO: nextDay(args.assessAfterQualityISO),
      lever: 'LONG_RUN',
      idempotencyKey: `rolling:${args.weekStartISO}:after-quality`,
      payload: { boundary: 2, weekStartISO: args.weekStartISO },
    },
    {
      ...base,
      kind: 'CONDITIONAL_DOSE',
      reasonCode: 'long_run_after_race',
      reasonDetail: 'Classify what the race actually cost: controlled, threshold-like, a true '
        + 'race, or unreadable. Size the long run to that rather than to the label it was '
        + 'prescribed under.',
      assessOnISO: args.assessAfterRaceISO,
      overdueAfterISO: nextDay(args.assessAfterRaceISO),
      lever: 'LONG_RUN',
      idempotencyKey: `rolling:${args.weekStartISO}:after-race`,
      payload: { boundary: 3, weekStartISO: args.weekStartISO },
    },
  ];
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Where the three boundaries fall for a given week, read off its own sessions.
 *
 * Generalised deliberately. The 2026-09-21 week is the one that prompted this,
 * but a rule written for one week of one runner is the feature-specific
 * override the Constitution forbids, and it would go stale the moment he moved
 * a session. Every week has a day before it, a first quality session, and
 * either a race or a long run; those are the three moments at which new
 * evidence exists and the rest of the week can still change.
 *
 * Returns null when the week has nothing to assess — no quality and no long
 * run is an easy week, and scheduling three assessments for it would be noise.
 */
export function boundaryDatesForWeek(week: {
  readonly weekStartISO: string;
  readonly rows: readonly {
    readonly dateISO: string; readonly stressor: string | null;
  }[];
}): {
  readonly assessBeforeISO: string;
  readonly assessAfterQualityISO: string;
  readonly assessAfterRaceISO: string;
} | null {
  const sorted = [...week.rows].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const quality = sorted.find(
    (r) => r.stressor != null && r.stressor !== 'race' && !r.stressor.includes('long'),
  );
  const race = sorted.find((r) => r.stressor === 'race');
  const long = [...sorted].reverse().find((r) => r.stressor?.includes('long'));
  if (!quality && !race && !long) return null;

  // The last row that can still be changed by each answer, and no later.
  const anchorForThird = race ?? long ?? quality;
  const anchorForSecond = quality ?? race ?? long;
  if (!anchorForThird || !anchorForSecond) return null;

  return {
    assessBeforeISO: prevDay(week.weekStartISO),
    assessAfterQualityISO: nextDay(anchorForSecond.dateISO),
    assessAfterRaceISO: nextDay(anchorForThird.dateISO),
  };
}

function prevDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
