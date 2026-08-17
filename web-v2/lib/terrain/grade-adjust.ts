/**
 * lib/terrain/grade-adjust.ts · THE grade adjustment. One pure function,
 * one set of doctrine-bound constants, every pace-judging consumer routed
 * through it.
 *
 * ── THE RULE THAT MATTERS MOST ─────────────────────────────────────────────
 *
 *   GRADE-ADJUSTED PACE IS FOR JUDGING EFFORT. IT IS NEVER WHAT THE RUNNER RAN.
 *
 * A runner who covered 6 miles in 52:54 ran 8:49/mi. That number is a fact and
 * it is the only number any surface may print as "pace". If those 6 miles
 * carried 570 ft of climb, the EFFORT was worth about 8:20/mi on the flat —
 * and that is the number the coach compares against a target, feeds to a
 * fitness estimate, or uses to decide whether a session was hit.
 *
 * Two different jobs, two different numbers, and they must never be swapped:
 *
 *   · displayed pace  = distance / time. Real. Shown. Never adjusted.
 *   · adjusted pace   = what that effort was worth on flat ground. Compared,
 *                       never displayed as "your pace". Where it is surfaced
 *                       at all, it is LABELLED (see `adjustmentLabel`).
 *
 * Inflating a runner's displayed pace because they ran up a hill is lying to
 * them about what happened. Judging them against a flat target when they ran
 * up a hill is lying to them about what it meant. This module exists so the
 * app can stop doing the second without ever starting the first.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────
 *
 * Uphill cost. `Research/11-course-specific-training.md`
 * §"Mechanical Effects of Uphill Running":
 *
 *     "Energy cost rises ~3.3% per 1% of grade up to ~10–15%."
 *
 * So a continuous grade of g percent multiplies the pace a given effort
 * produces by (1 + 0.033·g). This is the coefficient `lib/race/pacing.ts`
 * already uses for course-aware race splits — the same physiology, applied to
 * a run that has already happened instead of one being planned.
 *
 * Downhill giveback. `Research/01-pace-zones-vdot.md` §"Hills (Grade-Adjusted
 * Pace)":
 *
 *     "Downhills give back roughly 60–70% of the loss for the same grade."
 *
 * Descending is NOT the mirror image of climbing. Gravity returns most of the
 * work but braking, eccentric quad loading and stride disruption eat the rest,
 * so a 3% descent does not refund what a 3% climb charged. We take 0.65, the
 * midpoint of doctrine's own band; `DOCTRINE_REGISTRY['TERRAIN.descent-
 * giveback']` parses "60–70%" out of the doc at run time and fails if the
 * constant ever leaves it.
 *
 * THE ASYMMETRY IS THE WHOLE POINT. With a symmetric coefficient a rolling
 * loop would net to exactly zero and hills would be invisible to the engine —
 * which is the bug being fixed, not a simplification of it.
 *
 * ── WHY LINEAR, AND NOT MINETTI ────────────────────────────────────────────
 *
 * `Research/01` also carries the Minetti energy-cost polynomial and a lookup
 * table derived from it. Those imply roughly 5% per 1% of grade — noticeably
 * steeper than the 3.3% in `Research/11` and the 3% in `Research/01`'s own
 * treadmill section. The doctrine is not self-consistent here, and this is
 * recorded rather than papered over. We take 3.3% because:
 *
 *   · it is the number the app already uses correctly for race pacing, so the
 *     planned course and the executed run now agree instead of disagreeing;
 *   · it is the most conservative of the three, and a grade adjustment that
 *     errs small tells a runner less than the truth rather than more than it.
 *
 * A linear cost has a property worth having: the total time a climb costs
 * depends ONLY on total vertical, not on how that vertical is distributed.
 * One mile at 4% and four miles at 1% cost the same, because they are the same
 * 211 feet. That is what lets `runGradeAdjustment` produce an honest number
 * from a run that reports total gain and nothing else.
 *
 * ── HEAT AND GRADE COMPOSE, THEY DO NOT DOUBLE-COUNT ───────────────────────
 *
 * `Research/01` §"Combined conditions":
 *
 *     "Add adjustments multiplicatively, not additively"
 *     final_pace = base_pace × (1 + heat_adj) × (1 + altitude_adj) × hill_factor
 *
 * `composeEffortFactor` is the single place that stacking happens. Any consumer
 * that judges a run in both heat and hills calls it once and gets one number.
 * Two independent adjustment paths that each "helpfully" account for the day
 * is how a hot hilly run gets forgiven twice.
 */

/** Feet in a mile. */
const FT_PER_MILE = 5280;

/**
 * Feet of vertical that make up one grade-percent-mile — i.e. one mile run at
 * a sustained 1% grade climbs this much. The unit that makes the linear model
 * distribution-independent: `gainFt / FT_PER_GRADE_PCT_MILE` is the number of
 * "1%-grade miles" a run contained, however the climbing was arranged.
 */
const FT_PER_GRADE_PCT_MILE = FT_PER_MILE / 100; // 52.8

/**
 * Pace cost per 1% of uphill grade, as a fraction.
 *
 * Cite: `Research/11-course-specific-training.md` §"Mechanical Effects of
 * Uphill Running" — "Energy cost rises ~3.3% per 1% of grade up to ~10–15%."
 *
 * Watched by `DOCTRINE_REGISTRY['TERRAIN.grade-cost-per-pct']`.
 */
export const GRADE_COST_PER_PCT = 0.033;

/**
 * Fraction of the equivalent uphill cost that a descent of the same grade
 * gives back.
 *
 * Cite: `Research/01-pace-zones-vdot.md` §"Hills (Grade-Adjusted Pace)" —
 * "Downhills give back roughly 60–70% of the loss for the same grade."
 * 0.65 is the midpoint of that band.
 *
 * Watched by `DOCTRINE_REGISTRY['TERRAIN.descent-giveback']`.
 */
export const DESCENT_GIVEBACK_FRACTION = 0.65;

/**
 * Grade beyond which the linear model is no longer claimed to hold, in
 * percent. Doctrine states the 3.3%/1% relation "up to ~10–15%"; we clamp at
 * the top of that band so absurd inputs (a bad barometer, a mis-entered
 * incline) cannot produce an unbounded adjustment.
 *
 * Watched by `DOCTRINE_REGISTRY['TERRAIN.grade-model-ceiling']`.
 */
export const GRADE_MODEL_MAX_PCT = 15;

/**
 * Treadmill incline that reproduces outdoor flat running, in percent.
 *
 * Cite: `Research/01-pace-zones-vdot.md` §"The 1% incline rule and its limits"
 * — "1% ≈ outdoor flat". A belt at 0% is metabolically EASIER than outdoor
 * flat because there is no air resistance to overcome; 1% restores it.
 *
 * The consequence that matters: a treadmill run at 1% is a FLAT run, not a 1%
 * climb. Feeding its incline into the outdoor grade model would credit the
 * runner for work that is really just the air they are not running through.
 *
 * Watched by `DOCTRINE_REGISTRY['TERRAIN.treadmill-air-resistance-grade']`.
 */
export const TREADMILL_AIR_RESISTANCE_GRADE_PCT = 1;

/**
 * Pace cost per 1% of treadmill belt grade, as a fraction — measured relative
 * to the same belt speed on the flat, which is a different reference frame
 * from outdoor grade and therefore a different constant.
 *
 * Cite: `Research/01-pace-zones-vdot.md` §"General incline → outdoor pace
 * conversion" — "Each 1% of treadmill grade adds ~3% to metabolic cost
 * relative to flat at the same belt speed."
 *
 * Watched by `DOCTRINE_REGISTRY['TERRAIN.treadmill-cost-per-pct']`.
 */
export const TREADMILL_COST_PER_PCT = 0.03;

// ── The one pure function ───────────────────────────────────────────────────

/**
 * Pace multiplier for a sustained grade. THIS IS THE FUNCTION; everything else
 * in this module is an aggregation over it or a wrapper around it.
 *
 * Returns the factor by which a given effort's pace changes on that grade:
 *
 *   · `> 1` uphill  — the same effort produces a slower pace
 *   · `= 1` at 0%   — no-op, exactly, by construction
 *   · `< 1` downhill — the same effort produces a faster pace
 *
 * Two uses, in opposite directions, and getting them backwards is the classic
 * way to ship an adjustment that makes every judgement worse:
 *
 *   hill-adjusted TARGET = flat target  ×  gradeFactor(g)   (slower uphill)
 *   flat-equivalent GAP  = observed pace ÷ gradeFactor(g)   (faster uphill)
 *
 * `Research/01`'s prose states these two the other way round while its own
 * table states them this way (an 8:00 base at +2% is listed as +48 sec, i.e.
 * 480 × 1.10 — target × factor). The table is self-consistent with its sec/mi
 * column, so the table is what we follow. Noted here because the prose reads
 * like a licence to divide when you should multiply.
 *
 * @param gradePct  Mean grade over the segment, in percent. Positive uphill.
 * @param surface   'outdoor' uses the outdoor coefficient. 'treadmill' uses
 *                  the belt coefficient and expects a grade that has ALREADY
 *                  had the air-resistance offset applied — see
 *                  `treadmillEffectiveGradePct`.
 */
export function gradeFactor(
  gradePct: number,
  surface: 'outdoor' | 'treadmill' = 'outdoor',
): number {
  if (!Number.isFinite(gradePct) || gradePct === 0) return 1;
  const perPct = surface === 'treadmill' ? TREADMILL_COST_PER_PCT : GRADE_COST_PER_PCT;
  const clamped = Math.max(-GRADE_MODEL_MAX_PCT, Math.min(GRADE_MODEL_MAX_PCT, gradePct));
  return clamped > 0
    ? 1 + perPct * clamped
    : 1 - perPct * DESCENT_GIVEBACK_FRACTION * -clamped;
}

/**
 * What a pace observed on `gradePct` was worth on the flat. Faster than the
 * observed pace uphill, slower downhill.
 *
 * FOR JUDGING ONLY. Never render this as the runner's pace.
 */
export function gradeAdjustedPaceSPerMi(
  observedPaceSPerMi: number,
  gradePct: number,
  surface: 'outdoor' | 'treadmill' = 'outdoor',
): number {
  if (!(observedPaceSPerMi > 0)) return observedPaceSPerMi;
  return observedPaceSPerMi / gradeFactor(gradePct, surface);
}

/**
 * What a flat target becomes on `gradePct` — the pace the runner should
 * actually be seeing on their watch. Slower uphill, faster downhill.
 */
export function terrainAdjustedTargetSPerMi(
  flatTargetSPerMi: number,
  gradePct: number,
  surface: 'outdoor' | 'treadmill' = 'outdoor',
): number {
  if (!(flatTargetSPerMi > 0)) return flatTargetSPerMi;
  return flatTargetSPerMi * gradeFactor(gradePct, surface);
}

/**
 * The belt grade that actually costs something, after removing the incline
 * that is only standing in for air resistance.
 *
 * 1% belt ≈ outdoor flat, so a run at 1% has an effective grade of 0 and gets
 * no adjustment at all. A run at 0% is metabolically a shade EASIER than
 * outdoor flat; doctrine puts that at "0–10 sec/mi gift on slow paces" and
 * hedges it as speed-dependent, so we decline to invent a penalty from it and
 * floor the effective grade at zero. The conservative reading: a flat belt is
 * treated as flat ground, not as a downhill.
 */
export function treadmillEffectiveGradePct(inclinePct: number): number {
  if (!Number.isFinite(inclinePct)) return 0;
  return Math.max(0, inclinePct - TREADMILL_AIR_RESISTANCE_GRADE_PCT);
}

// ── Composition · heat × grade, exactly once ────────────────────────────────

export interface EffortFactorInput {
  /**
   * Heat slowdown as a PERCENT, the shape `judgeWeather()` already returns
   * (`WeatherJudgment.slowdownPct`). 0 / null / undefined = neutral.
   *
   * Pass the value that the calling surface would otherwise have applied on
   * its own. The point of this function is that heat gets applied HERE and
   * nowhere else in the same judgement.
   */
  heatSlowdownPct?: number | null;
  /**
   * Terrain factor from `gradeFactor()`, or 1 when the run has no usable
   * terrain signal. Not a grade — a factor, so treadmill and outdoor
   * callers pass the same kind of thing.
   */
  gradeFactor?: number | null;
}

export interface EffortFactor {
  /** The single multiplier. flat-and-cool target × this = today's target. */
  factor: number;
  /** The heat leg, `1 + heatSlowdownPct/100`. */
  heat: number;
  /** The terrain leg. */
  grade: number;
}

/**
 * Stack the environmental adjustments into ONE factor.
 *
 * Cite: `Research/01-pace-zones-vdot.md` §"Combined conditions" — "Add
 * adjustments multiplicatively, not additively", with the stated form
 * `final_pace = base_pace × (1 + heat_adj) × ... × hill_factor`.
 *
 * Multiplicative stacking is order-independent and idempotent in the sense
 * that matters: there is exactly one product, so a caller cannot accidentally
 * apply heat in one branch and heat-plus-grade in another and end up
 * forgiving the same 4% twice. If you find yourself multiplying a target by a
 * heat number outside this function, that is the double-count starting.
 */
export function composeEffortFactor(input: EffortFactorInput): EffortFactor {
  const heatPct = Number.isFinite(input.heatSlowdownPct as number)
    ? (input.heatSlowdownPct as number)
    : 0;
  const heat = 1 + heatPct / 100;
  const grade = Number.isFinite(input.gradeFactor as number) && (input.gradeFactor as number) > 0
    ? (input.gradeFactor as number)
    : 1;
  return { factor: heat * grade, heat, grade };
}

// ── Whole-run aggregation ───────────────────────────────────────────────────

/** Where a run's terrain numbers came from, and how much to trust them. */
export type TerrainBasis =
  /** Per-mile elevation deltas: real gain AND real loss. Best case. */
  | 'splits'
  /** Total gain only, route returns to its start, so loss is taken as gain. */
  | 'gain-loop-assumed'
  /** Treadmill with a recorded belt incline. */
  | 'treadmill-incline'
  /** Treadmill with no incline recorded — the effort behind the pace is unknown. */
  | 'treadmill-incline-unknown'
  /** No usable elevation signal at all. Adjustment is a no-op. */
  | 'none';

export interface RunGradeInput {
  distanceMi: number;
  /** Elapsed/moving seconds for the distance. */
  durationSec: number;
  /** Total climb, feet. Null when unknown. */
  gainFt?: number | null;
  /**
   * Total descent, feet, as a POSITIVE number. Null when unknown — which is
   * the common case, because most sources report gain and nothing else.
   */
  lossFt?: number | null;
  /**
   * True when the route ends where it started. Lets an unknown loss be taken
   * as equal to the gain instead of being guessed at. A point-to-point run
   * with unknown loss gets `closedLoop: false` and a deliberately cautious
   * read — see the note in `runGradeAdjustment`.
   */
  closedLoop?: boolean | null;
  surface?: 'outdoor' | 'treadmill';
  /** Mean belt incline in percent, for treadmill runs. Null when not recorded. */
  treadmillInclinePct?: number | null;
}

export interface RunGradeAdjustment {
  /** Real pace. distance / time. Show THIS to the runner. */
  displayedPaceSPerMi: number | null;
  /**
   * Flat-equivalent pace for the same effort. Compare against targets with
   * THIS. Equal to `displayedPaceSPerMi` whenever the terrain signal is
   * missing or the run was flat.
   */
  adjustedPaceSPerMi: number | null;
  /**
   * `adjustedPaceSPerMi − displayedPaceSPerMi`, seconds per mile. Negative
   * means the terrain was costing the runner time (net climb); positive means
   * the terrain was giving it to them (net descent).
   */
  deltaSPerMi: number;
  /** The single multiplier the terrain applied to this run's pace. */
  factor: number;
  /**
   * Mean grade over the run in percent, or null when the run is treadmill /
   * has no signal. Reported for copy, not used for anything else — the
   * aggregation works in vertical feet, not in a mean grade.
   */
  meanGradePct: number | null;
  basis: TerrainBasis;
  surface: 'outdoor' | 'treadmill';
  /**
   * True when the adjustment is big enough to be worth telling anyone about.
   * Below this, terrain is noise and mentioning it is clutter.
   */
  material: boolean;
  gainFt: number | null;
  lossFt: number | null;
}

/**
 * Seconds per mile below which a terrain adjustment is not worth surfacing or
 * acting on. Roughly the width of GPS pace noise on a single mile; an
 * adjustment smaller than the measurement error it corrects is decoration.
 */
export const MATERIAL_ADJUSTMENT_S_PER_MI = 4;

/**
 * Grade-adjust a completed run.
 *
 * The linear model makes the whole-run arithmetic exact in total vertical
 * rather than approximate in mean grade:
 *
 *   climb cost   = pace × 0.033 × (gainFt / 52.8)   seconds, over the whole run
 *   descent gift = pace × 0.033 × 0.65 × (lossFt / 52.8)
 *   flat-equivalent time = actual time − climb cost + descent gift
 *
 * Note what this does NOT do: it does not average the gain over the distance
 * and call that "the grade". A 6-mile loop with 570 ft of gain is not a 1.8%
 * climb — it is roughly three miles up and three miles down, and the up and
 * the down do not cancel. Working in vertical feet gets that right without
 * needing to know where the hills were.
 *
 * When the loss is unknown and the route is a loop, loss is taken as equal to
 * gain, which is true by definition for a closed loop. When the route is
 * point-to-point and the loss is unknown, the same assumption is made but the
 * basis says so — a net-downhill point-to-point read this way will be
 * UNDER-corrected, never over-corrected, because any real excess descent is
 * simply not counted. Under-correcting is the safe direction: it leaves a
 * downhill run looking a little too good rather than inventing a penalty from
 * elevation nobody measured.
 */
export function runGradeAdjustment(input: RunGradeInput): RunGradeAdjustment {
  const distMi = Number(input.distanceMi);
  const durSec = Number(input.durationSec);
  const surface = input.surface === 'treadmill' ? 'treadmill' : 'outdoor';
  const paceSPerMi = distMi > 0 && durSec > 0 ? durSec / distMi : null;

  const flat = (basis: TerrainBasis): RunGradeAdjustment => ({
    displayedPaceSPerMi: paceSPerMi,
    adjustedPaceSPerMi: paceSPerMi,
    deltaSPerMi: 0,
    factor: 1,
    meanGradePct: surface === 'treadmill' ? null : 0,
    basis,
    surface,
    material: false,
    gainFt: null,
    lossFt: null,
  });

  if (paceSPerMi == null) return flat('none');

  // ── Treadmill ────────────────────────────────────────────────────────────
  // A treadmill run has no terrain. It has a belt angle, and that angle is
  // either recorded or it is not. It NEVER borrows an outdoor elevation
  // number, and it never contributes phantom vertical: the elevGainFt these
  // rows carry is back-computed from the same incline we are reading here, so
  // consuming both would count the incline twice.
  if (surface === 'treadmill') {
    // `Number.isFinite`, NOT `Number(...)` then a finiteness test: Number(null)
    // is 0, which would turn "we do not know what the belt was set to" into
    // "the belt was flat" — the exact assumption the brief forbids.
    const incline = input.treadmillInclinePct;
    if (!Number.isFinite(incline as number)) return flat('treadmill-incline-unknown');
    const effective = treadmillEffectiveGradePct(incline as number);
    const factor = gradeFactor(effective, 'treadmill');
    const adjusted = paceSPerMi / factor;
    const delta = adjusted - paceSPerMi;
    return {
      displayedPaceSPerMi: paceSPerMi,
      adjustedPaceSPerMi: adjusted,
      deltaSPerMi: delta,
      factor,
      meanGradePct: effective,
      basis: 'treadmill-incline',
      surface,
      material: Math.abs(delta) >= MATERIAL_ADJUSTMENT_S_PER_MI,
      gainFt: null,
      lossFt: null,
    };
  }

  // ── Outdoor ──────────────────────────────────────────────────────────────
  const gainFt = Number.isFinite(input.gainFt as number) && (input.gainFt as number) > 0
    ? (input.gainFt as number)
    : null;
  const lossKnown = Number.isFinite(input.lossFt as number) && (input.lossFt as number) >= 0;
  const lossFt = lossKnown ? (input.lossFt as number) : gainFt;
  if (gainFt == null && !lossKnown) return flat('none');

  const basis: TerrainBasis = lossKnown ? 'splits' : 'gain-loop-assumed';
  const climbUnits = (gainFt ?? 0) / FT_PER_GRADE_PCT_MILE;   // grade-percent-miles up
  const descUnits = (lossFt ?? 0) / FT_PER_GRADE_PCT_MILE;    // grade-percent-miles down

  // Clamp the run's average steepness to the model's stated validity ceiling.
  // Expressed in the same vertical units so the clamp is on the physics, not
  // on a derived mean: distMi × GRADE_MODEL_MAX_PCT is the most 1%-grade-miles
  // a run of this length can credibly contain in one direction.
  const unitCeiling = distMi * GRADE_MODEL_MAX_PCT;
  const up = Math.min(climbUnits, unitCeiling);
  const down = Math.min(descUnits, unitCeiling);

  const costSec = paceSPerMi * GRADE_COST_PER_PCT * up;
  const giftSec = paceSPerMi * GRADE_COST_PER_PCT * DESCENT_GIVEBACK_FRACTION * down;
  const actualSec = paceSPerMi * distMi;
  const flatSec = actualSec - costSec + giftSec;
  const adjusted = flatSec / distMi;
  const delta = adjusted - paceSPerMi;

  return {
    displayedPaceSPerMi: paceSPerMi,
    adjustedPaceSPerMi: adjusted,
    deltaSPerMi: delta,
    factor: adjusted > 0 ? paceSPerMi / adjusted : 1,
    // Net grade over the run — signed, and genuinely just for copy.
    meanGradePct: distMi > 0 ? (((gainFt ?? 0) - (lossFt ?? 0)) / (distMi * FT_PER_MILE)) * 100 : null,
    basis,
    surface,
    material: Math.abs(delta) >= MATERIAL_ADJUSTMENT_S_PER_MI,
    gainFt,
    lossFt: lossKnown ? (input.lossFt as number) : null,
  };
}

/**
 * How an adjusted figure must be labelled wherever it appears next to a real
 * one. Short by design — the design brief caps banner and label length — and
 * never rendered without the real pace beside it.
 */
export function adjustmentLabel(a: RunGradeAdjustment): string | null {
  if (!a.material || a.adjustedPaceSPerMi == null) return null;
  if (a.surface === 'treadmill') return 'incline-adjusted';
  return a.deltaSPerMi < 0 ? 'hill-adjusted' : 'descent-adjusted';
}
