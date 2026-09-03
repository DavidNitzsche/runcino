/**
 * Readiness — composite score.
 *
 *   baseline 70, range 0-100
 *   bands: >85 SHARP · 65-85 READY · 50-65 MODERATE · <50 PULL BACK
 *
 * ── 2026-08-17 · doctrine-conformance audit, clusters 1 and 2 ─────────────
 *
 * The score carried its own weight table (Sleep 28 / HRV 28 / RHR 24) and
 * applied training load as a fifth ADDITIVE pillar worth +5 to −8 points.
 * Both contradict the methodology this score is built on
 * (BuildResearch · D1-recovery-score-methodology.md):
 *
 *   · D1 §"Summary table — recommended input weights for a runner" is
 *     HRV 40%, Sleep 22%, RHR 18%. D1 §2.1 is explicit about the direction
 *     of the error: "Below 40% under-uses the signal". The engine had HRV
 *     and sleep tied, which inverts the fidelity ordering — sleep is one
 *     night's sample, HRV is a seven-day trend, and D1 §"Why these weights"
 *     says weighting a sample above a trend "would be inverting fidelity".
 *
 *   · D1 §2.4 makes load "a 'load context' multiplier in the range
 *     [0.85, 1.10] applied after the biometric composite", and D1
 *     §"Why these weights" gives the reason: as a multiplier "it can't
 *     *create* a score; it can only modulate one". The engine added +5 for a
 *     sweet-spot ACWR, so a runner with no biometric signal at all banked
 *     five points of readiness for having run a normal week.
 *
 * What changed, precisely:
 *
 *   1. The three biometric pillars keep their existing DEVIATION SCALES —
 *      the point at which each pillar is fully dragged or fully lifted is
 *      unchanged — and keep their existing TOTAL authority over the score
 *      (48 points of drag, 34 of lift). Doctrine sets the SPLIT of that
 *      authority, and only the split moved: 40 / 22 / 18.
 *   2. Load is no longer a pillar. It is a multiplier on the composite,
 *      taken from D1 §6 step 4, and the result is capped at the ceiling the
 *      day's own pillars could have produced, so the modifier can lift a
 *      real signal but can never manufacture one.
 *
 * Pillars, after the change:
 *   - HRV          40%  → 7-day median vs 30-day baseline. Full swing at ±36%.
 *   - Sleep        22%  → 7-night avg vs target. Full drag at −2.25h.
 *   - RHR          18%  → 3-day rolling avg vs 30-day baseline. Full swing at ±6 bpm.
 *   - HR Recovery   5%  → most recent vs 30d baseline. ±1 per 2 bpm delta.
 *   - Load         15%  → multiplier ×0.88-1.05, applied AFTER the composite.
 *
 * HR Recovery has no row in D1's table. It is an engine addition (2026-05-30
 * P2 #9) occupying the 5% sub-signal slot D1 §2.6 gives to body-temp
 * deviation, which this app does not compute. Documented as engine-internal
 * rather than dressed up as doctrine.
 *
 * ── 2026-08-17 · owner ruling · the score INFORMS, it never mutates ───────
 *
 * The bands were absolute — >85 SHARP, 65-85 READY, 50-65 MODERATE, <50 PULL
 * BACK — on a number whose pillars are all measured against the runner's OWN
 * baselines. That mismatch is what made the detector misfire. Across 78
 * snapshot days it produced 18 PULL BACK days (23% of all days); the runner
 * trained through 12 of them, and on his lowest score ever recorded (31) he
 * ran 8 miles and then raced a half the projection model called to within two
 * seconds. The band flipped on 29 of 77 day-to-day transitions, mean swing
 * 6.8 points. A flag that fires a quarter of the time and reverses every
 * third day is measuring ordinary life variance in a 41-year-old running a
 * company with two kids, not overreaching.
 *
 * Doctrine agreed all along and the engine had not caught up:
 *
 *   D1 §2.1  "Absolute HRV varies 5–10× between individuals — only
 *            intra-individual trends matter."
 *   D1 §2.8  "Implicitly handled by per-user baselines — the algorithm
 *            normalizes against the individual's own 60-day mean/SD."
 *   D1 §5    days 7-13 the score is provisional and "constrained to 33–66
 *            (no green or red yet)"; a trustworthy score needs 30 days.
 *   D1 §3    "three corroborating signals start to look like evidence."
 *
 * So the BAND is now a read on the runner's own score distribution, not on an
 * absolute scale, and PULL BACK additionally requires the deviation to be
 * sustained and corroborated. See `bandFor` below for the ladder and the
 * expected firing rates.
 *
 * The score has no other job, and as of 2026-09-02 NOTHING ANYWHERE DOES.
 * This paragraph used to end "`readiness_pullback` in lib/plan/adapt.ts still
 * can, and is reported rather than rewired from here" — that is now false. The
 * owner ruled that he decides how ready he is: the trigger, its detector and
 * its `actionsForTrigger` limb are deleted, and the upward ramp's readiness
 * gate is replaced by an ACWR read over `runs`. No readiness reading changes a
 * prescription, caps an intensity or writes a plan row anywhere in the app.
 * The score is a DISPLAY quantity.
 */
import type { CoachState } from '@/lib/topics/types';
import { recoveryCoverage } from './state-presence';
import { sleepTargetForMileage } from './tier-rules';

export interface ReadinessBreakdown {
  score: number | null;         // 0-100; null when all pillar inputs have no signal (cold start)
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'unknown';
  label: string;                // 'SHARP' / 'READY' / 'MODERATE' / 'PULL BACK' / 'UNKNOWN'
  inputs: ReadinessInput[];
  /**
   * COLD-5 (2026-08-17) · how much of the recovery picture this score is
   * actually backed by · 0..1, from `recoveryCoverage` in state-presence.ts.
   *
   * Honesty here used to be binary: `score: null` when ALL FOUR biometrics
   * were absent, and a confident two-digit number the moment any ONE of them
   * arrived — with nothing on the shape to say which. A runner with RHR alone
   * (20 of the 75 recovery weight) read exactly like a fully instrumented one.
   *
   * `recoveryCoverage` was written for this in the 2026-06-05 multi-tenant
   * audit and then called by nothing but its own test for two months. Its
   * reading: 1.0 fully instrumented · 0.6+ trustworthy · 0.4 or below LIMITED,
   * render with subdued chrome and a "limited signal" caption · 0.0 cold start,
   * which is the `score: null` case.
   *
   * LOAD is deliberately excluded. It is a modifier, not a pillar — a
   * Strava-only runner has load and no idea how rested they are.
   */
  coverage: number;
  /**
   * What the band was judged against. Null when the runner has no personal
   * baseline yet, which is itself the reason the band stays quiet.
   */
  personal: {
    /** The runner's own rolling normal, rounded for copy. */
    normal: number;
    /** Spread of his own scores · one SD, floored at 1. */
    spread: number;
    /** How far today sits from his normal, in SDs. */
    z: number;
    /** Days of history the normal was built from. */
    days: number;
  } | null;
}

/**
 * The runner's own recent scores, oldest → newest, EXCLUDING today.
 * Everything the band needs to know what "normal" looks like for him.
 */
export interface ReadinessBandBaseline {
  recent: Array<number | null | undefined>;
}

export interface ReadinessInput {
  key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
  label: string;          // 'SLEEP · 22%'
  /**
   * Signed points this input moved the score. For the four biometric pillars
   * that is the pillar's own contribution; for `load` — a multiplier since
   * 2026-08-17 — it is the points the multiplier moved the finished
   * composite, so every consumer still reads one comparable number.
   */
  weight: number;
  observedV: string;      // '6.7h' / '71ms' / etc
  observedSub: string;    // 'vs 7.5h target' / '+27%' / etc
  meaning: string;        // one-sentence interpretation of YOUR value
}

const BASELINE = 70;

/**
 * Doctrine weights · BuildResearch · D1-recovery-score-methodology.md,
 * §"Summary table — recommended input weights for a runner".
 *
 * Exported so the doctrine gate can read them, and so `readiness-brief`
 * renders the same percentages the score actually applies (it used to carry
 * its own copy of the table, which is how a display can drift from a score).
 */
export const READINESS_WEIGHTS = {
  hrv: 0.40,
  sleep: 0.22,
  rhr: 0.18,
  /** Modifier, not a pillar · see loadContextMultiplier. */
  load: 0.15,
  /** Engine-internal · D1 has no HR-recovery row. */
  hr_recovery: 0.05,
} as const;

/**
 * Points of drag and lift the biometric pillars share out between them, per
 * 1.0 of weight. These two numbers carry the pre-audit engine's total
 * authority forward unchanged — sleep + HRV + RHR could drag 48 points and
 * lift 34 across a summed weight of 0.80 — so the number the runner has been
 * reading keeps its scale. Doctrine sets how that authority is SPLIT, which
 * is the only thing the audit found wrong.
 */
const PILLAR_DRAG_PER_WEIGHT = 60;      // 48 / 0.80
const PILLAR_LIFT_PER_WEIGHT = 42.5;    // 34 / 0.80

/**
 * Deviation at which a pillar is fully dragged / fully lifted. Taken from
 * the pre-audit engine's own clamps so re-weighting does not silently
 * re-scale what counts as a big HRV drop or a short night:
 *   sleep  −18 pts at 2 pts per 0.25 h → 2.25 h short;  +10 → 1.25 h over
 *   HRV    ±18 pts at 1 pt per 2%      → ±36%
 *   RHR    −12 pts at 2 pts per bpm    → +6 bpm;        +6 at 1 pt per bpm → −6 bpm
 */
const FULL_DEVIATION = {
  sleepShortH: 2.25,
  sleepSurplusH: 1.25,
  hrvPct: 36,
  rhrBpm: 6,
} as const;

/** Signed points a pillar contributes, from a normalised deviation in [-1, 1]. */
function pillarPoints(deviation: number, weight: number): number {
  const d = Math.max(-1, Math.min(1, deviation));
  return d < 0 ? d * PILLAR_DRAG_PER_WEIGHT * weight : d * PILLAR_LIFT_PER_WEIGHT * weight;
}

/** The most a pillar could lift the score on a day it has signal. */
function pillarMaxLift(weight: number): number {
  return Math.round(PILLAR_LIFT_PER_WEIGHT * weight);
}

/** Engine-internal HR-recovery cap · ±5, unchanged from 2026-05-30. */
const HR_RECOVERY_CAP = 5;

// ── Personal banding · the 2026-08-17 owner ruling ────────────────────────

/**
 * Days of prior scores before the band is judged personally. D1 §5: "a useful
 * score requires 14 days of HRV + RHR data; a trustworthy score requires 30."
 * Below this the band cannot go red or green at all — the same progressive
 * disclosure the methodology prescribes for the first two weeks.
 */
export const BASELINE_MIN_DAYS = 14;

/** How far back the rolling normal looks. D1 §5's "establishing" window. */
export const BASELINE_WINDOW_DAYS = 28;

/**
 * The ladder, in standard deviations of the runner's own score distribution.
 *
 * Expected firing rates on a roughly normal spread — the number that made
 * this change necessary is the 23% the absolute cuts were producing:
 *
 *   sharp      z >= +1.5   ~6.7% of days
 *   moderate   z <= -1.0   ~13.6% of days (the band between -1.0 and -2.0)
 *   pull-back  z <= -2.0   ~2.3% of days BEFORE the two gates below,
 *                          and ~0-1 days in 78 after them
 *
 * -2.0 is not arbitrary: D1 §6 clamps every input z to ±2, so ±2 SD is the
 * edge of what the methodology treats as a meaningful reading at all.
 */
export const BAND_Z = {
  sharp: 1.5,
  moderate: -1.0,
  pullBack: -2.0,
} as const;

/**
 * PULL BACK needs more than one bad number. Two extra gates, both from the
 * methodology rather than from taste:
 *
 *   SUSTAINED · yesterday must also have sat at or below the same cut.
 *     D1 §2.2 on RHR: "≥+5 bpm for TWO DAYS"; §2.6 on temp: "a 3-day
 *     persistent deviation is a real signal". One night is noise everywhere
 *     in the document.
 *
 *   CORROBORATED · at least two INDEPENDENT pillars must be dragging.
 *     D1 §3: "three corroborating signals start to look like evidence", and
 *     §2.2 warns RHR alone misses ~30% of cases. A single pillar having a bad
 *     morning is not a body in trouble.
 *
 *     Independent is load-bearing, not decorative. The count is over
 *     `CORROBORATING_KEYS` (sleep · hrv · rhr), NOT every biometric pillar:
 *     `hr_recovery` reads the same cardiac system as `rhr`, so counting both
 *     would let one elevated heart rate corroborate itself and clear this
 *     bar alone. Same ruling, same reasoning, and the same five-domain
 *     taxonomy as `lib/coach/convergence.ts`.
 */
export const PULLBACK_MIN_DRAGGING_PILLARS = 2;

/** Mean and SD of the runner's own recent scores · null when too few. */
function personalNormal(baseline: ReadinessBandBaseline | undefined): { mean: number; sd: number; days: number } | null {
  const scores = (baseline?.recent ?? [])
    .filter((s): s is number => typeof s === 'number' && isFinite(s))
    .slice(-BASELINE_WINDOW_DAYS);
  if (scores.length < BASELINE_MIN_DAYS) return null;
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length;
  // Floor the spread at 1 point · a runner whose scores never move must not
  // divide by zero into an infinite z.
  return { mean, sd: Math.max(1, Math.sqrt(variance)), days: scores.length };
}

/**
 * Training-load context multiplier · BuildResearch · D1 §6 step 4, verbatim
 * bands, and D1 §2.4's stated range [0.85, 1.10].
 *
 * Doctrine's own third branch reads
 *   `elif 0.8 <= ACWR <= 1.3 and ATL < CTL * 0.8: load_mod = 1.05`
 * which cannot be satisfied when ACWR is defined as ATL/CTL from a single
 * source, as it is here (acute7 / chronic28) — `ATL < 0.8 × CTL` IS
 * `ACWR < 0.8`. Rather than ship a branch wired to nothing (the audit's
 * drift pattern #9), the engine implements what §2.4 says that branch is
 * for — "bonus when ATL drops in a planned taper" — at the freshness
 * threshold the same doctrine uses, Research/15's ACWR < 0.8. The
 * contradiction in D1's pseudocode is reported as a corpus defect.
 */
export const LOAD_CONTEXT_MULTIPLIER = {
  spike: 0.88,
  elevated: 0.95,
  neutral: 1.00,
  fresh: 1.05,
} as const;

/**
 * The multiplier as a CURVE rather than a stop-light · Rule 9 (2026-08-30).
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * This was four `if`s on Gabbett's zone edges, so the response stepped 0.05 at
 * ACWR 1.3 and 0.07 at 1.5. A runner at 1.300 kept his whole score; a runner at
 * 1.301 lost 5% of it. ACWR is a ratio of two rolling averages — it moves that
 * far when one easy run lands on the far side of midnight — so this is a hair
 * of input deciding a categorically different readout.
 *
 * ── Why interpolating is doctrine, not a softening of it ──────────────────
 *
 * The cited numbers do not move. 0.8, 1.3 and 1.5 are still the abscissae and
 * D1 §6's four multipliers are still the ordinates; nothing here invents a
 * value. What changes is that the response runs THROUGH the edges instead of
 * stepping AT them, which is what `Research/15-wearable-data.md` §"Acute:
 * Chronic Workload Ratio (ACWR)" demands in the paragraph directly beneath the
 * zone table:
 *
 *   "treat ACWR as a directional sanity check, not a stop-light ... A ratio
 *    jumping from 0.9 to 1.6 in a week is a flag worth examining; a ratio of
 *    1.4 in itself is not a verdict."
 *
 * A step function is precisely a stop-light, and the old code handed 1.4 the
 * full elevated penalty — a verdict on the one number the doc names as not
 * being one. The same section carries the Impellizzeri critique ("argues
 * against using ACWR as a deterministic injury predictor"), which is the same
 * instruction in stronger terms.
 *
 * ── The control points ────────────────────────────────────────────────────
 *
 *   0.6  fresh     the taper bonus fully realised · D1 §2.4
 *   0.8  neutral   floor of Research/15's sweet spot
 *   1.3  neutral   top of the sweet spot · nothing pulls the score inside it
 *   1.5  elevated  the caution band, fully traversed, at the danger edge
 *   1.7  spike     one caution-band width (1.5-1.3) past the danger edge
 *
 * The WHOLE sweet spot 0.8-1.3 stays flat neutral, which is the property the
 * 2026-08-17 audit fixed and this must not undo: a runner may not bank points
 * for having run an ordinary week. So the bonus lives strictly below 0.8, and
 * the two abscissae not printed in the table — 0.6 and 1.7 — are each one
 * caution-band width (1.5-1.3 = 0.2) outside the sweet spot's own edges,
 * derived from the table rather than chosen. 0.6 is already this repo's
 * canonical planned-freshness sample, in both READINESS.load-is-a-multiplier
 * and _readiness_doctrine.test.ts.
 *
 * Flat outside the ends, so the range stays inside D1 §2.4's [0.85, 1.10].
 */
export const LOAD_CONTEXT_CURVE: ReadonlyArray<readonly [acwr: number, multiplier: number]> = [
  [0.6, LOAD_CONTEXT_MULTIPLIER.fresh],
  [0.8, LOAD_CONTEXT_MULTIPLIER.neutral],
  [1.3, LOAD_CONTEXT_MULTIPLIER.neutral],
  [1.5, LOAD_CONTEXT_MULTIPLIER.elevated],
  [1.7, LOAD_CONTEXT_MULTIPLIER.spike],
];

export function loadContextMultiplier(
  acwr: number | null | undefined,
  acute7: number | null | undefined,
  chronic28: number | null | undefined,
): number {
  if (acwr == null || !isFinite(acwr)) return LOAD_CONTEXT_MULTIPLIER.neutral;

  const first = LOAD_CONTEXT_CURVE[0];
  const last = LOAD_CONTEXT_CURVE[LOAD_CONTEXT_CURVE.length - 1];
  let mult: number;
  if (acwr <= first[0]) {
    mult = first[1];
  } else if (acwr >= last[0]) {
    mult = last[1];
  } else {
    mult = last[1];
    for (let i = 0; i < LOAD_CONTEXT_CURVE.length - 1; i++) {
      const [x0, y0] = LOAD_CONTEXT_CURVE[i];
      const [x1, y1] = LOAD_CONTEXT_CURVE[i + 1];
      if (acwr >= x0 && acwr <= x1) {
        mult = x1 === x0 ? y1 : y0 + ((y1 - y0) * (acwr - x0)) / (x1 - x0);
        break;
      }
    }
  }

  // The ATL-under-CTL guard, unchanged in intent: a high ratio whose acute load
  // is not actually above chronic is not a spike, so the penalty is capped at
  // the elevated value rather than running on to the spike floor.
  const atlOverCtl = acute7 != null && chronic28 != null ? acute7 > chronic28 : acwr > 1;
  if (!atlOverCtl) return Math.max(mult, LOAD_CONTEXT_MULTIPLIER.elevated);
  return mult;
}

/**
 * The sleep target · ONE definition, doctrine's own.
 *
 * ── 2026-08-19 · sleep-target reconciliation ─────────────────────────────
 *
 * There were FIVE sleep targets in this codebase and only one of them was
 * bound to the research:
 *
 *   tier-rules.ts     SLEEP_TARGET_BY_MPW   7.5 / 8 / 8.5 / 9 by mileage  ← bound
 *   readiness.ts      this function          7.5 / 8 / 8.5 by ACWR
 *   recovery-brief.ts SLEEP_TARGET_STANDARD  flat 8.5, long-run 9.25
 *   recovery-phase.ts TARGET_H               hardcoded 7.5
 *   sleep-coaching.ts TARGET_H / TREND_AVG_H 7.0 / 6.5
 *
 * A runner could be told he was half an hour OVER target on one surface and
 * two hours UNDER it on another, on the same night's sleep.
 *
 * WHAT DOCTRINE ACTUALLY SAYS, and where this function was wrong. Research/00b
 * §"Recovery Scaled to Weekly Mileage" opens "Recovery requirements scale with
 * absolute training load" and then gives four per-mileage tables. ABSOLUTE
 * training load is mileage. This function took those tables' numbers — 7.5,
 * 8.0, 8.5 — and keyed them off the acute:chronic RATIO instead, which is a
 * different quantity entirely: a runner holding a steady 70 mpw has an ACWR of
 * 1.0 and was handed the 20-40 mpw target, while a runner ramping from 15 to
 * 25 mpw got the 60-80 mpw one. The numbers were doctrine's; the axis was not.
 *
 * So the target is now `sleepTargetForMileage` from tier-rules.ts — the one
 * implementation that reads the four bands out of their own tables at run time
 * (registry claim TIER.sleep-floor-rises-with-mileage), and the one every
 * other sleep consumer now calls too.
 *
 * WHAT WAS LOST: the ACWR sensitivity. Nothing in Research/00b supports it,
 * and the mileage axis it replaces is what the doc actually indexes on. A
 * runner in a genuine load spike is already served — the spike raises his
 * chronic mileage, which raises his target, on doctrine's own axis.
 *
 * Lives here (the score module) rather than in readiness-brief because the
 * SCORE must use the same target the displayed baseline label does. Before the
 * 2026-06-16 fix the score hardcoded 7.5h while the brief's label showed a
 * different one, so a 7.8h sleeper read "+0.3h vs target" next to a baseline
 * implying "-0.7h short". That coupling is preserved; only the axis moved.
 */
export function computeDynamicSleepTarget(weeklyMpw: number | null | undefined): number {
  return sleepTargetForMileage(weeklyMpw);
}

/**
 * The runner's habitual weekly mileage, for the sleep target and anything else
 * that scales recovery to load.
 *
 * CHRONIC, not acute. Research/00b scales the recovery requirement to what the
 * runner HABITUALLY does, and `loadChronic28` is that; `loadAcute7` is this
 * week, which on a cutback week would drop his sleep target exactly when he is
 * absorbing the block. Falls back to acute only when there is no chronic leg
 * yet, and to null when there is neither — `sleepTargetForMileage` then returns
 * the entry row, which is doctrine's lightest guidance.
 */
export function weeklyMpwFor(state: Pick<CoachState, 'loadChronic28' | 'loadAcute7'>): number | null {
  const perDay = state.loadChronic28 ?? state.loadAcute7;
  return perDay != null && isFinite(perDay) ? perDay * 7 : null;
}

/**
 * 2026-06-16 · #19 · luteal-phase HRV baseline allowance.
 *
 * THE 5ms SHIFT IS A CONVENTION, NOT A RESEARCH FINDING (corrected 2026-08-18,
 * doctrine sweep). This comment used to cite "Luteal HRV runs 5-10ms lower ·
 * Research/13 §1-Menstrual-Cycle-and-Training" — no doctrine file in this repo
 * carries a 5-10ms (or any millisecond) HRV figure. What Research/13 §1.3
 * actually says, in its cycle-tracking-methods table: wearable HRV "trends
 * with phase" but the "signal [is] often swamped by training/sleep noise" —
 * real evidence for a QUALITATIVE shift and, if anything, a caution against
 * quantifying it precisely, not grounds for a specific millisecond number.
 * Same fabricated-precision shape as CONVENTION.fitness-response-model and
 * CONVENTION.trajectory-build-rate, a third instance found in the same sweep.
 *
 * Subtract 5ms from the baseline a luteal female is compared against — only
 * when biologicalSex === 'female' AND cyclePhase === 'luteal'. Floored at 1
 * so the bar can never go non-positive. For everyone else the baseline is
 * unchanged. The number stays (removing it entirely would be worse: it would
 * silently re-flag every luteal-phase HRV dip as "below baseline," which is
 * the exact false-alarm doctrine's qualitative direction warns against) but
 * it is a bounded, tunable allowance, not a cited quantity.
 *
 * Lives here (the score module, alongside computeReadiness which applies
 * the same shift inline) so EVERY HRV-vs-baseline comparator can import
 * one canonical implementation — the streak detector, the [N/M] threshold
 * line, and recovery-phase. Per CLAUDE.md per-finding context filters,
 * the luteal adjustment must propagate to every HRV consumer, not just
 * the score. Without this a luteal female reads "at baseline" on the
 * score pillar while STREAKS / the recovery tile flag the same HRV below
 * baseline. A 5ms shift on a ~60ms baseline ≈ 8.3% — enough to flip a
 * borderline reading.
 */
export function lutealAdjustedHrvBaseline(
  baseline: number,
  biologicalSex: CoachState['biologicalSex'] | undefined,
  cyclePhase: CoachState['cyclePhase'] | undefined,
): number {
  return biologicalSex === 'female' && cyclePhase === 'luteal'
    ? Math.max(1, baseline - 5)
    : baseline;
}

export function computeReadiness(
  state: CoachState,
  // 2026-06-16 · #16 · explicit override lets the brief pass its already-
  // computed dynamicSleepTarget (identical value, avoids a recompute).
  // When omitted, derive the load-scaled target from state.loadAcwr so
  // the score and the baseline label always agree, on every surface.
  sleepTargetOverride?: number,
  // 2026-08-17 · the runner's own recent scores. Supplied, the band is a read
  // on HIS distribution; omitted, the band stays deliberately quiet (no
  // PULL BACK, no SHARP) because an absolute cut on a personally-baselined
  // number is the miscalibration this ruling removed.
  baseline?: ReadinessBandBaseline,
): ReadinessBreakdown {
  let score = BASELINE;
  const inputs: ReadinessInput[] = [];
  // 2026-08-19 · the target is keyed on the runner's habitual MILEAGE, which
  // is the axis Research/00b indexes on, not on the acute:chronic ratio. See
  // computeDynamicSleepTarget for what was wrong and what it cost.
  const sleepTarget = sleepTargetOverride ?? computeDynamicSleepTarget(weeklyMpwFor(state));
  // Ceiling the day's own pillars could reach · load may modulate the score
  // up to here and no further (D1: the modifier "can't create a score").
  let pillarCeiling = BASELINE;

  // SLEEP (22%)
  if (state.sleep7Avg != null) {
    const target = sleepTarget;
    const delta = state.sleep7Avg - target;
    const debt = Math.max(0, -delta * 7); // approx weekly debt
    const w = Math.round(pillarPoints(
      delta >= 0 ? delta / FULL_DEVIATION.sleepSurplusH : delta / FULL_DEVIATION.sleepShortH,
      READINESS_WEIGHTS.sleep,
    ));
    score += w;
    pillarCeiling += pillarMaxLift(READINESS_WEIGHTS.sleep);
    const meaning = delta >= 0
      // 2026-06-16 · #16 · name the actual (possibly load-scaled) target,
      // not a hardcoded 7.5h, so the prose agrees with the scored delta.
      ? `At or above your ${target.toFixed(1)}h target. Strong recovery base.`
      : debt >= 7
        // 2026-06-26 · surface the gap concretely (nightly shortfall + the
        // actual target) and end on what to do, not "cost compounds".
        ? `About ${(-delta).toFixed(1)}h under your ${target.toFixed(1)}h target each night · roughly ${debt.toFixed(0)}h of debt this week. A couple of 8h nights pulls it back.`
        : debt >= 3
          ? `Around ${debt.toFixed(0)}h short of your ${target.toFixed(1)}h target this week. Watch for fatigue creep.`
          : `A touch under your ${target.toFixed(1)}h target. Nothing concerning yet.`;
    inputs.push({
      key: 'sleep', label: 'SLEEP · 22%', weight: w,
      // Tag the value as the 7-night average so it doesn't read as "last night".
      observedV: `${state.sleep7Avg.toFixed(1)}h · 7-night avg`,
      // 2026-06-03 · dropped "vs 7.5h target" tail · the pillar's
      // baseline field also says "target 7.5h" so showing both gave
      // the runner "-1.4h vs 7.5h target · target 7.5h" with the
      // target value duplicated. Now just shows the signed delta ·
      // baseline carries the target.
      observedSub: delta >= 0 ? `+${delta.toFixed(1)}h vs target` : `${delta.toFixed(1)}h vs target`,
      meaning,
    });
  } else {
    inputs.push({ key: 'sleep', label: 'SLEEP · 22%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No sleep data yet. Wear the watch overnight.' });
  }

  // HRV (40%) — the highest-fidelity pillar per D1 §2.1.
  if (state.hrvCurrent != null && state.hrvBaseline != null && state.hrvBaseline > 0) {
    // 2026-06-01 · Luteal-phase adjustment. See lutealAdjustedHrvBaseline
    // above for the honest citation: Research/13 grounds the SHAPE (HRV
    // "trends with phase," signal noisy) not the 5ms figure, which is a
    // bounded convention · subtract 5ms from the baseline so the runner
    // isn't penalized for biology. Only applies when biologicalSex ===
    // 'female' AND cyclePhase === 'luteal'.
    // For non-female users or non-luteal phases, baseline is unchanged.
    // 2026-06-16 · #19 · now via the shared lutealAdjustedHrvBaseline so
    // the score, the streak detector, the threshold line, and recovery-
    // phase all apply byte-identical luteal logic (can't drift apart).
    const lutealAdjusted = lutealAdjustedHrvBaseline(state.hrvBaseline, state.biologicalSex, state.cyclePhase);
    const pct = ((state.hrvCurrent - lutealAdjusted) / lutealAdjusted) * 100;
    // Full swing at ±36% off baseline, weighted at D1's 40%.
    // 2026-06-26 · deadband · within ±5% the HRV reads "at baseline · no
    // recovery flag" (the meaning band below). Noise-level drift then neither
    // drags nor lifts the score, and the metric stays out of the iPhone
    // "X dragging" headline (which filters weight < 0). Only a deviation that
    // actually means something gets weighted. Boundary matches the copy band.
    const w = (pct >= -5 && pct < 5)
      ? 0
      : Math.round(pillarPoints(pct / FULL_DEVIATION.hrvPct, READINESS_WEIGHTS.hrv));
    score += w;
    pillarCeiling += pillarMaxLift(READINESS_WEIGHTS.hrv);
    const lutealNote = state.cyclePhase === 'luteal'
      ? ' Baseline adjusted for luteal phase.'
      : '';
    // Frame every verdict on the 7-DAY window so it can't read as a
    // contradiction of the Health tab's single-day HRV reading (today can
    // bounce back to baseline while the week's trend still sits low).
    // 2026-06-26 · name the baseline number in the prose (the tile's
    // observedSub isn't shown on iPhone), and end on what it means for today.
    const hrvBase = Math.round(state.hrvBaseline);
    // RULE TWO · this is ONE domain's tile. The ladder in
    // `lib/coach/convergence.ts` is explicit: one domain dragging changes
    // nothing, two are worth saying, three may touch the session. A pillar
    // tile that says "green light for hard work" or "ease off" has skipped
    // straight to the third rung on the strength of the first. The tile
    // reports its own reading against its own baseline; what that means for
    // the session is the composer's call, and only once three domains agree.
    const meaning = (pct >= 15
      ? `Well above your ${hrvBase}ms baseline. Highest the week has read.`
      : pct >= 5
        ? `Above your ${hrvBase}ms baseline. Recovered and ready.`
        : pct >= -5
          ? `Right on your ${hrvBase}ms baseline. No recovery flag · train as planned.`
          : pct >= -15
            ? `Below your ${hrvBase}ms baseline. Could be stress, sleep, or building load. Watch tomorrow.`
            : `Well below your ${hrvBase}ms baseline. The week has run low throughout.`) + lutealNote;
    inputs.push({
      key: 'hrv', label: 'HRV · 40%', weight: w,
      // G3 (2026-06-09) · health-state now feeds the 7-day MEDIAN
      // (outlier-immune after the Jun 8 partial-night incident).
      observedV: `${state.hrvCurrent}ms · 7d median`,
      // State both numbers, no delta. Same rule the coach voice follows.
      observedSub: state.cyclePhase === 'luteal'
        ? `baseline ${state.hrvBaseline}ms · luteal-adjusted ${lutealAdjusted}ms`
        : `baseline ${state.hrvBaseline}ms`,
      meaning,
    });
  } else {
    inputs.push({ key: 'hrv', label: 'HRV · 40%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No HRV data yet. Needs a few overnights of watch wear.' });
  }

  // RHR (18%) — D1 §2.2: "A confirmer, not a primary driver."
  if (state.rhrCurrent != null && state.rhrBaseline != null) {
    const delta = state.rhrCurrent - state.rhrBaseline;
    // Full swing at ±6 bpm off baseline, weighted at D1's 18%.
    // 2026-06-26 · deadband · -2 < delta <= 1 bpm reads "right on baseline · no
    // signal" (the meaning band below). A sub-1bpm rise is noise · don't dock
    // readiness or surface it in the "X dragging" headline. Only a real
    // rise/drop gets weighted. Boundary matches the copy band.
    const w = (delta > -2 && delta <= 1)
      ? 0
      : Math.round(pillarPoints(-delta / FULL_DEVIATION.rhrBpm, READINESS_WEIGHTS.rhr));
    score += w;
    pillarCeiling += pillarMaxLift(READINESS_WEIGHTS.rhr);
    // 2026-06-26 · name the baseline bpm in the prose (observedSub isn't shown
    // on iPhone) so "at baseline" is verifiable at a glance.
    const rhrBase = Math.round(state.rhrBaseline);
    const meaning = delta <= -2
      ? `Below your ${rhrBase} bpm baseline. Sign of strong fitness adaptation.`
      : delta <= 1
        ? `Right on your ${rhrBase} bpm baseline. No fatigue or illness signal.`
        : delta <= 4
          ? `A few beats above your ${rhrBase} bpm baseline. Could be sleep, dehydration, or a volume bump. One day is fine · watch for a streak.`
          // RULE TWO · cardiac is one domain. "Ease the load" is a session
          // change prescribed off a single number, which the convergence
          // ladder puts three domains away. The tile names what it read and
          // what would make the reading firmer; the load call is not its own.
          : `Notably above your ${rhrBase} bpm baseline. Worth a second reading tomorrow before it means anything.`;
    inputs.push({
      key: 'rhr', label: 'RHR · 18%', weight: w,
      observedV: `${state.rhrCurrent} bpm · 3d avg`,
      observedSub: `baseline ${state.rhrBaseline} bpm`,
      meaning,
    });
  } else {
    inputs.push({ key: 'rhr', label: 'RHR · 18%', weight: 0, observedV: 'no data', observedSub: '', meaning: 'No resting HR data yet.' });
  }

  // LOAD (15%) — Gabbett's Acute:Chronic Workload Ratio (ACWR), applied as a
  // MULTIPLIER on the finished biometric composite, never as a pillar.
  //
  //   acute7    = avg daily mi over last 7 days
  //   chronic28 = avg daily mi over last 28 days
  //   ratio     = acute7 / chronic28
  //
  // BuildResearch · D1 §2.4: "a 'load context' multiplier in the range
  // [0.85, 1.10] applied after the biometric composite". D1 §"Why these
  // weights": as a multiplier "it can't *create* a score; it can only
  // modulate one". Before 2026-08-17 this was +5 / +2 / 0 / −3 / −8 added
  // straight to the score, so a sweet-spot ACWR handed a runner five points
  // of readiness that no biometric had earned.
  //
  // The multiplier is resolved here (so the copy can name the band) and
  // applied below, after HR recovery, on the whole composite.
  const loadMult = loadContextMultiplier(state.loadAcwr, state.loadAcute7, state.loadChronic28);
  const loadIdx = inputs.length;
  if (state.loadAcwr != null && state.loadAcute7 != null && state.loadChronic28 != null) {
    const r = state.loadAcwr;
    // 2026-05-27: descriptive only — what the ratio IS, not what to DO
    // about it. The coach decides prescription. Otherwise this card and
    // the coach voice openly contradict (David flagged it: "why is it
    // telling me to back off but the coach isn't?").
    // 2026-06-26 · low load (ACWR < 0.8) is framed as freshness, not a drag ·
    // David's call. Under the multiplier it is D1's taper bonus, ×1.05.
    const acuteWk = state.loadAcute7 * 7;   // mi/day → mi/week
    const baseWk = state.loadChronic28 * 7;
    // 2026-08-30 · Rule 9. The multiplier is now a curve, so the sentence is
    // driven by the trim it ACTUALLY applies rather than by the band the ratio
    // fell in. Branching on the band while interpolating the number is how a
    // tile ends up reading "Elevated ramp · trims the score 0%".
    const trimPct = Math.round((1 - loadMult) * 100);
    const meaning = r < 0.8
      ? `${acuteWk.toFixed(0)}mi this week vs your ~${baseWk.toFixed(0)}mi base. Fresh legs, low fatigue · fine for a cutback. Only a worry if it stays here for weeks.`
      : trimPct <= 0
        // Two things left this tile. A researcher's surname is a citation,
        // and a citation belongs in the code and the doctrine registry, not
        // in a sentence a runner reads at 6am — nothing else the coach says
        // names its source. And "Coach factors this into today's
        // prescription" is the app talking about itself in the third person
        // while also promising a session change off one domain, which the
        // convergence ladder puts two domains away.
        ? `${acuteWk.toFixed(0)}mi this week against your ~${baseWk.toFixed(0)}mi base. In the range the ramp is meant to sit in · the ratio is not pulling the score either way.`
        : r <= 1.5
          ? `${acuteWk.toFixed(0)}mi this week runs above your ~${baseWk.toFixed(0)}mi base. Elevated ramp · trims the score ${trimPct}%.`
          : `${acuteWk.toFixed(0)}mi this week against a ~${baseWk.toFixed(0)}mi base is the injury-risk band. Trims the score ${trimPct}%.`;
    const acwrWord = r < 0.8 ? 'Fresh' : r < 1.0 ? 'Building' : r <= 1.3 ? 'In range'
      : r < 1.5 ? 'Elevated' : 'High';
    inputs.push({
      // `weight` is patched below to the points the multiplier actually moved
      // the score, so every consumer that reads a pillar contribution keeps
      // reading a real, signed number.
      key: 'load', label: 'LOAD · 15%', weight: 0,
      observedV: `${acwrWord} · ${r.toFixed(2)} ACWR`,
      observedSub: `this week ${state.loadAcute7.toFixed(1)} · month avg ${state.loadChronic28.toFixed(1)} mi/day`,
      meaning,
    });
  } else {
    // Insufficient history — Gabbett needs ≥3 runs in 28 days to mean anything.
    inputs.push({
      key: 'load', label: 'LOAD · 15%', weight: 0,
      observedV: 'building history',
      observedSub: '',
      meaning: 'Acute:Chronic load ratio needs at least 3 runs in the last 28 days to be meaningful.',
    });
  }

  // HR RECOVERY (5%) — 60s post-workout HR drop from the Apple Watch.
  // Sevenfit literature pegs ~30 bpm as well-conditioned, ~20 average,
  // < 15 a yellow flag. We compare today's reading to the 30-day baseline:
  // a faster-than-baseline drop is a small lift, a slower drop is a small drag.
  // Weight cap ±5 keeps it appropriately minor — readiness isn't the place
  // to weigh one workout's recovery beat.
  if (state.hrRecoveryCurrent != null && state.hrRecoveryBaseline != null) {
    const delta = state.hrRecoveryCurrent - state.hrRecoveryBaseline;
    // ±1 per 2 bpm delta vs baseline, cap ±5.
    const w = Math.max(-HR_RECOVERY_CAP, Math.min(HR_RECOVERY_CAP, Math.round(delta / 2)));
    score += w;
    pillarCeiling += HR_RECOVERY_CAP;
    const meaning = delta >= 6
      ? `Faster than your baseline. Strong cardio recovery signal · the engine is rebounding well.`
      : delta >= 2
        ? `Slightly above your baseline. Recovery system is on.`
        : delta >= -2
          ? `At your baseline. Steady cardio recovery.`
          : delta >= -6
            ? `Below your baseline. Could be a hard recent session, sleep deficit, or heat · single-day dip is fine.`
            : `Well below your baseline. Cardiac recovery is sluggish. Watch tomorrow.`;
    inputs.push({
      key: 'hr_recovery', label: 'HR RECOVERY · 5%', weight: w,
      observedV: `${state.hrRecoveryCurrent} bpm drop`,
      observedSub: `baseline ${state.hrRecoveryBaseline} bpm`,
      meaning,
    });
  } else {
    inputs.push({
      key: 'hr_recovery', label: 'HR RECOVERY · 5%', weight: 0,
      observedV: 'no data',
      observedSub: '',
      meaning: 'HR recovery comes from Apple Watch post-workout. Will appear once a few sessions are in.',
    });
  }

  // Item 14: when every pillar has no real signal (brand-new user, Health
  // data not yet synced), return null score + 'unknown' band so the UI can
  // show "—" instead of 70/READY which reads as a confident endorsement.
  //
  // 2026-08-17 · LOAD no longer counts toward "we have signal". It is a
  // modifier, and D1 §"Why these weights" is explicit that a modifier cannot
  // create a score — a runner with run history but no biometrics is a
  // cold-start runner, which is already how readiness-brief classifies him.
  const BIOMETRIC_KEYS = new Set<ReadinessInput['key']>(['sleep', 'hrv', 'rhr', 'hr_recovery']);
  /**
   * The pillars that may CORROBORATE each other — one vote per independent
   * physiological domain.
   *
   * ── 2026-08-21 · web audit · rule two, the double count ─────────────────
   *
   * `draggingPillars` below used to count `BIOMETRIC_KEYS`, which includes
   * `hr_recovery`. HR recovery and RHR are the same cardiac system read by
   * the same sensor — `lib/coach/convergence.ts` says so in as many words
   * and deliberately refuses HR recovery a domain of its own:
   *
   *     "HR RECOVERY IS DELIBERATELY NOT A SIXTH DOMAIN. It is the same
   *      cardiac system RHR measures, from the same sensor ... Admitting it
   *      would let one elevated heart rate count twice and reach the
   *      convergence bar on its own."
   *
   * That is exactly what happened here. One elevated heart rate drags `rhr`
   * AND `hr_recovery`, `draggingPillars` reads 2, `corroborated` is true,
   * and the runner lands in the PULL BACK band — the band that
   * `readiness-brief.ts` turns into "Skip today's quality" — on a single
   * bad morning in a single domain. The gate whose whole job was to stop
   * one number changing a session was counting one number twice.
   *
   * HR recovery keeps its 5% weight on the SCORE (it is real signal) and
   * still counts toward `hasBiometricSignal` (a watch reading is a reading).
   * It just does not get a second vote on corroboration.
   */
  const CORROBORATING_KEYS = new Set<ReadinessInput['key']>(['sleep', 'hrv', 'rhr']);
  const hasBiometricSignal = inputs.some(
    (i) => BIOMETRIC_KEYS.has(i.key) && i.observedV !== 'no data' && i.observedV !== 'building history',
  );
  const coverage = recoveryCoverage(state);
  if (!hasBiometricSignal) {
    // COLD-5 · the LOAD input is dropped from an UNKNOWN reading. It is the
    // one pillar that can still carry a string here (a runner with runs and no
    // watch), and it was shipping verdict words — "High · 3.96 ACWR" — inside
    // a breakdown whose own answer is "we cannot say". The ratio itself is
    // fixed upstream (lib/coach/acwr.ts: that 3.96 was the cold-start
    // identity), but a load verdict has no business riding along in a payload
    // that exists to say the readiness picture is empty. Consumers that want
    // load read it off CoachState directly.
    return {
      score: null,
      band: 'unknown',
      label: 'UNKNOWN',
      inputs: inputs.filter((i) => i.key !== 'load'),
      coverage,
      personal: null,
    };
  }

  // ── Load context, applied AFTER the composite (D1 §6 step 4) ─────────────
  // Bounded above by the ceiling the day's own pillars could have reached, so
  // a taper bonus can lift a real reading but never invent one.
  const composite = score;
  score = Math.max(0, Math.min(100, Math.min(composite * loadMult, pillarCeiling)));
  inputs[loadIdx] = { ...inputs[loadIdx], weight: Math.round(score - composite) };
  score = Math.round(score);

  // ── The band · read against the runner's own normal ──────────────────────
  const normal = personalNormal(baseline);
  const draggingPillars = inputs.filter((i) => CORROBORATING_KEYS.has(i.key) && i.weight < 0).length;
  let band: ReadinessBreakdown['band'];
  let personal: ReadinessBreakdown['personal'] = null;

  if (normal == null) {
    // No personal normal yet. D1 §5's provisional state: the score shows, the
    // verdict does not. Silence is the default, so neither edge is reachable.
    band = score >= 65 ? 'ready' : 'moderate';
  } else {
    const z = (score - normal.mean) / normal.sd;
    personal = {
      normal: Math.round(normal.mean),
      spread: Math.round(normal.sd * 10) / 10,
      z: Math.round(z * 100) / 100,
      days: normal.days,
    };
    const cut = normal.mean + BAND_Z.pullBack * normal.sd;
    const priorScores = (baseline?.recent ?? []).filter(
      (s): s is number => typeof s === 'number' && isFinite(s),
    );
    const yesterday = priorScores[priorScores.length - 1];
    const sustained = yesterday != null && yesterday <= cut;
    const corroborated = draggingPillars >= PULLBACK_MIN_DRAGGING_PILLARS;

    if (z >= BAND_Z.sharp) band = 'sharp';
    else if (z <= BAND_Z.pullBack && sustained && corroborated) band = 'pull-back';
    else if (z <= BAND_Z.moderate) band = 'moderate';
    else band = 'ready';
  }

  const label = band === 'sharp' ? 'SHARP'
    : band === 'ready' ? 'READY'
    : band === 'moderate' ? 'MODERATE'
                          : 'PULL BACK';

  return { score, band, label, inputs, coverage, personal };
}
