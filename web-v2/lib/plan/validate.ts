/**
 * lib/plan/validate.ts · pre-persist plan integrity gate.
 *
 * Runs after composePlan() (and its maintenance/recovery variants) returns,
 * BEFORE clearActivePlansFor() mutates the DB. A PlanValidationError thrown
 * here means NO write, NO partial plan — the runner's existing plan is untouched.
 *
 * Two distinct purposes served by two distinct checks:
 *
 *   Doctrine caps — enforce training doctrine appropriate for the runner's
 *     context: distance, experience level, and whether this race is a
 *     stepping stone toward a longer upcoming race. Grounded in Daniels /
 *     Pfitzinger; see constraint table below.
 *
 *   Prior-plan comparison — catch data corruption / bad generator inputs
 *     that would produce a plan dramatically shorter than what the runner
 *     was already doing. Independent of doctrine; fires when the new plan's
 *     peak long drops below 80% of the prior plan's peak long.
 *
 * Pure function — no DB, no Date.now(). Caller passes todayISO and all
 * context so tests are fully deterministic.
 */

import type { ComposePlanResult, DistCategory } from './generate';
// #12 follow-up (2026-08-18) · THE categorizer, direct. This used to import
// `distanceCategoryOfPublic` from generate.ts — a second name for the same
// function, re-exported so callers could avoid importing the canonical module,
// which is how the app grew three categorizers. That re-export is gone.
import { distanceCategoryOrNull, UNKNOWN_DISTANCE_REASON } from '@/lib/race/distance-category';
import type { PlanMode } from './goal-tiers';
import { taperFactor, GENERAL_RAMP_CEILING } from './goal-tiers';
import { planDosingFindings, type DosingFinding } from './dosing';

// ── constraint table (doctrine caps) ─────────────────────────────────────────
//
// Long-run caps by context (see longRunCapMi()):
//
//   5K:                                      ≤ 14 mi
//   10K:                                     ≤ 17 mi
//   HM standalone, beginner:                 ≤ 14 mi
//   HM standalone, intermediate/advanced:    ≤ 20 mi
//   HM stepping stone to marathon (≤168 d):  ≤ 22 mi
//   Marathon:                                ≤ 25 mi
//   Ultra:                                   ≤ 32 mi
//
// DOCTRINE-BOOK-9 (2026-08-17) · TWO defects fixed here at once. The table above
// listed six caps (≤10 / ≤13 / ≤16 / ≤22 …) that longRunCapMi STOPPED USING in
// 2026-06-23 (COH-2) — a stale comment nobody re-read because the citation under it
// named a book, and a book citation is not something the gate can open. It also
// cited `Daniels §long-run doctrine`, which is not a section of anything.
//
// The caps are real and grounded: each is the top of that distance's ELITE
// peakLongMiBand in TIER_TARGETS, which Research/22 sets. The validator is a
// backstop behind the builder, so it has to sit at the highest band any tier can
// legitimately reach. Bound by LONGRUN.validator-cap-is-the-elite-band.
//
// Cite: Research/22-plan-templates.md — the per-distance "Peak long run" rows
// Cite: Research/00a-distance-running-training.md §"Long-run rules of thumb"
//       (long-run cap 25-30% of weekly volume — the share ceiling behind these)

interface PlanConstraints {
  longRunWoWMaxPct: number;     // max WoW long-run increase (% of prior week)
  taperDropMinPct: number;      // min taper volume drop vs non-taper peak (%)
  taperDropMaxPct: number;      // MAX taper volume drop vs non-taper peak (%)
}

/**
 * WKRAMP-1 (2026-08-19) · THE ACUTE-TO-CHRONIC RED LINE.
 *
 * Replaces `CONSTRAINTS.weeklyVolWoWMaxPct`, a flat 50%-of-last-week ceiling
 * that was never a research number — it tracked whatever `generate.ts` happened
 * to author, which was steps up to 44% for a beginner marathoner. A guardrail
 * calibrated to the thing it guards is not a guardrail.
 *
 * WHY THE INSTRUMENT CHANGED, NOT JUST THE NUMBER. "This week versus last week"
 * is the wrong question, and it is why the old check needed a hand-written
 * exemption for the week after a cutback. Doctrine deliberately builds dips into
 * a block — "Down weeks | Every 3-4 wk, reduce by 20-30%" — so a week-over-week
 * ratio reads a planned deload as a spike on the way back out, and any ceiling
 * loose enough to permit the rebound is far too loose to catch a real one.
 *
 * Research/00a §"Load metrics" and §"ACWR risk zones" publish the instrument
 * that does ask the right question: acute load (7 days) over chronic load (the
 * 28-day mean), with 0.8-1.3 the sweet spot, 1.3-1.5 caution, and ≥1.5
 * "substantially elevated" injury risk. A dip barely moves a 28-day mean, so
 * the rebound needs no exemption, while a genuine spike shows up whether it
 * arrives in one week or accumulates over three.
 *
 * The validator is a backstop behind the builder, so it sits at the red line
 * (1.5) rather than at the sweet-spot boundary. With `enforceWeeklyRampCeiling`
 * in place the generator's worst archetype across the 11,598-archetype sweep
 * reaches 1.306 — just inside doctrine's caution band, with the backstop a
 * genuine distance above it rather than fitted to it.
 *
 * Not per-distance: doctrine's ACWR table carries no distance dimension.
 *
 * Cite: Research/00a-distance-running-training.md §"ACWR risk zones"
 * Bound by RAMP.acute-chronic-ratio-red-line.
 */
const ACWR_HIGH_RISK = 1.5;

/** Weeks in the chronic window · Research/00a §"Load metrics": "Chronic load
 *  (28-day) | Mean weekly load over last 28 days". The acute week is inside
 *  that window, as the doc's own 7-day/28-day nesting describes. */
const ACWR_CHRONIC_WEEKS = 4;

/**
 * DOCTRINE-1b (2026-08-17) · THE TAPER BAND HAS TWO ENDS.
 *
 * `taperDropMinPct` only ever asked whether the taper was deep ENOUGH, so a
 * taper that cut 55% off a 5K — nearly double what Research/08 §9.1 allows for
 * that distance — passed clean. Every doctrine band has two ends, and a
 * one-sided validator is how a wrong-row constant survives review: the check
 * that should have caught the flat marathon taper being applied to a 5K was
 * structurally incapable of firing.
 *
 * `taperDropMaxPct` is §9.1's "Volume reduction (peak week)" CEILING per
 * distance. `taperDropMinPct` is the floor on the deepest pre-race taper week,
 * set a few points under what the shared `taperFactor` model produces for that
 * week so ordinary rounding does not trip it, and — per the registry claim
 * TAPER.minimum-volume-drop — never stricter than §9.1's minimum reduction.
 *
 *   Distance | §9.1 reduction | model drop @ wk-2 | floor | ceiling
 *   5K       | 25-35%         | (no pre-race wk)  | 20    | 35
 *   10K      | 30-40%         | 25%               | 22    | 40
 *   HM       | 30-50%         | 29%               | 26    | 50
 *   M        | 40-60%         | 40%               | 36    | 60
 *   Ultra    | 50-70%         | 44%               | 40    | 70
 *
 * HONEST LIMIT: both bounds are evaluated on NON-RACE taper weeks (TAPER-1's
 * exclusion — a race week's `weeklyMi` excludes the race itself and is
 * shakeout-plus-easies, which is race-day logistics rather than a training
 * taper). A 5K's only taper week IS its race week, so for the 5K these bounds
 * do not bind at all; what guards the 5K taper is the doctrine gate's
 * TAPER.depth-per-week claim reading `TAPER_RACE_WEEK_PCT_OF_PEAK` straight out
 * of §9.1.
 *
 * ── WKRAMP-1 (2026-08-19) · `weeklyVolWoWMaxPct` IS GONE FROM THIS TABLE ────
 *
 * It was 50, flat across all five distances, and it was not a research number:
 * swept across 11,598 archetypes, tightening it toward doctrine failed 1480
 * archetypes at 25%, 328 at 35%, 48 at 40%, and only 45%+ came back clean —
 * because `generate.ts` itself authored week-over-week steps as large as 44%,
 * for a first-time marathoner. The constant tracked the generator, not the
 * research.
 *
 * The generator was fixed first (`enforceWeeklyRampCeiling`), and section 6 now
 * asks the question doctrine actually publishes an instrument for — the acute
 * load spike, bounded by `ACWR_HIGH_RISK` above — while the cumulative ramp
 * stays with §3, which already reads `GENERAL_RAMP_CEILING` against the
 * runner's real base. Neither belongs in a per-distance table: doctrine's ramp
 * and ACWR figures carry an experience dimension or none at all, never a
 * distance dimension, which is why the flat row was the tell.
 */
const CONSTRAINTS: Record<DistCategory, PlanConstraints> = {
  '5k':    { longRunWoWMaxPct: 30, taperDropMinPct: 20, taperDropMaxPct: 35 },
  '10k':   { longRunWoWMaxPct: 30, taperDropMinPct: 22, taperDropMaxPct: 40 },
  'hm':    { longRunWoWMaxPct: 30, taperDropMinPct: 26, taperDropMaxPct: 50 },
  'm':     { longRunWoWMaxPct: 30, taperDropMinPct: 36, taperDropMaxPct: 60 },
  // #12 (audit 2026-06-16) · 'ultra' is now its own category (was bucketed as
  // 'm' by generate's old categorizer, which capped the ultra long run at the
  // marathon ceiling). The long-run CAP itself is raised in longRunCapMi below
  // to the ultra peak-long band.
  'ultra': { longRunWoWMaxPct: 30, taperDropMinPct: 40, taperDropMaxPct: 70 },
};

// Context-aware long-run cap. Kept separate from CONSTRAINTS because it
// isn't a single value per distance — it varies by experience + horizon.
function longRunCapMi(cat: DistCategory, ctx: PlanValidationContext): number {
  // 2026-06-23 · COH-2 · the validator cap is the BACKSTOP; the builder already caps the long
  // at the runner's TIER band (TIER_TARGETS[cat][tier].peakLongMiBand[1] · VAR-01). These fixed
  // caps were LOWER than the higher tiers' bands (5K advanced band is 12 but the cap was 10; HM
  // advanced band is 17 but the cap was 16), rejecting legitimate band-reaching longs. Set each
  // to the distance's MAX tier band so the validator never rejects a builder-legit long, while
  // still catching genuine anomalies (a long beyond even the elite band). Cite: Research/22 bands.
  switch (cat) {
    case '5k':    return 14; // elite 5K band top
    case '10k':   return 17; // elite 10K band top
    case 'm':     return 25; // elite M band top
    case 'ultra': return 32; // elite ultra band top (Research/22 §Ultramarathon)
    case 'hm':
      if (ctx.isSteppingStoneToMarathon) return 22; // bridging to a marathon · builder lifts toward the M band
      return ctx.level === 'beginner' ? 14 : 20;     // beginner band ≤12; advanced 17 / elite 20
  }
}

// ── context object ────────────────────────────────────────────────────────────

export interface PlanValidationContext {
  /** Runner experience level from profile. 'beginner' tightens HM long-run cap. */
  level: 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
  /**
   * True when a marathon-distance (≥20 mi) A/B-priority race exists within
   * ~168 days after the current race. Loosens the HM long-run cap from 14/20 mi
   * to 22 mi — plan is a stepping stone, not a standalone build.
   *
   * DOCTRINE-BOOK-10 (2026-08-17) · was `Pfitzinger ADM §"Bridging from half to
   * full."`, a section title the gate could not open and which nobody here has
   * read. Split honestly into the half that is grounded and the half that is not:
   *
   *   · THE NUMBER is doctrine. 22 mi is the top of Research/22's "Marathon —
   *     Intermediate" peak long run (20-22 mi), i.e. this stops being capped as
   *     a half and starts being capped as the marathon build it feeds.
   *   · THE TRIGGER is ours. No source in Research/ defines a 168-day horizon,
   *     or says a half inside a marathon block should be sized to the marathon.
   *     That is a product decision about which race the plan is really serving.
   *
   * Cite: Research/22-plan-templates.md §"Marathon Plans" (the 20-22 mi row)
   * Cite: Research/22-plan-templates.md §"Multi-Race Year Planning" — races
   *       stacked inside one season are cycles that feed each other
   */
  isSteppingStoneToMarathon: boolean;
  /**
   * Peak long-run distance (mi) from the currently active plan, captured
   * before it is archived. Used for the corruption check: new plan peak
   * must not fall below 80% of prior peak. null = no prior plan (cold start).
   */
  priorPlanPeakLongMi: number | null;
  /** Caller-supplied today (YYYY-MM-DD) — keeps this function pure. */
  todayISO: string;
  /** 2026-06-20 · stated training frequency (profile.weekly_frequency). A
   *  1-day-a-week runner gets a single run — the long/base run, not a separate
   *  quality session — so the quality-coverage rule is skipped at <= 1. */
  trainingDaysPerWeek?: number | null;
  /**
   * Runner's trailing 28-day average weekly mileage, computed from actual runs
   * immediately before generation. Used for peak-vs-trailing ramp check (F13):
   * Used for the peak-vs-trailing ramp check (F13) in section 3 below.
   * null = not enough history to compute (skip the check).
   *
   * DOCTRINE-BOOK-11 (2026-08-17) · THIS COMMENT WAS STALE, AND THE BOOK CITATION
   * UNDER IT IS WHY. It described a flat "trailing × 1.65, a 65% jump ceiling
   * grounded in Pfitzinger's 10%/week escalation doctrine", cited to
   * `§weekly volume escalation` — a section nobody can open. Two things were wrong:
   *
   *   · The constant is GONE. DOCTRINE-7b replaced the flat 1.65 with a
   *     build-length-aware ceiling, `rampBase × min(flatCap, rampPerWeek^buildWeeks
   *     × 1.15)`, precisely because a flat 1.65 rejected any build over ~5 climb
   *     weeks. This is the same stale-comment-under-an-unopenable-citation shape as
   *     the long-run cap table at the top of this file.
   *   · The citation inverted its own source. Research/00a §"The 10% rule —
   *     reconsidered" is the passage saying the 10%/week rule is NOT well supported;
   *     it cannot be the ground for a ramp ceiling built on it.
   *
   * The live ceiling needs no book. `rampPerWeek` reads GENERAL_RAMP_CEILING, the
   * same table the generator ramps to — one doctrinal quantum, one constant — and
   * that table is sourced to Research/00a §"Volume progression rules" and bound by
   * RAMP.general-case-ceiling. Bound here by RAMP.validator-shares-the-generator-ceiling.
   *
   * Cite: Research/00a-distance-running-training.md §"Volume progression rules"
   *       (via GENERAL_RAMP_CEILING — see goal-tiers.ts)
   */
  trailingAvgWeeklyMi: number | null;
  /** 2026-06-23 · GOAL-1 · true when available_days constrain quality to empty by construction
   *  (an adjacent-day pair → spacedQualityDowsFromAvailable returns []). The plan correctly folds to
   *  long + easy only, so the quality-coverage check is skipped (mirrors trainingDaysPerWeek<=1). */
  qualityStrandedByAvailability?: boolean;
  /** 2026-06-23 · CC-2 · onboarding-seeded recent weekly mileage (the cold-start base). Used as the
   *  peak-vs-trailing ramp-check base when trailingAvg is null, so cold-start and Strava agree. */
  recentWeeklyMi?: number | null;
}

// ── advisory sinks ────────────────────────────────────────────────────────────

/**
 * Optional, report-only outputs. Nothing passed here can fail a plan.
 *
 * This file's entire severity model is "anything pushed to `violations` is
 * fatal" — there is no warn level, because until now every check either blocked
 * a write or did not exist.
 */
export interface ValidateOptions {
  /**
   * Receives EVERY Daniels dosing-cap finding in the plan (see `./dosing`),
   * including the ones that are not fatal.
   *
   * DOCTRINE-DOSING-2 (2026-08-18) · this is no longer how the caps are
   * enforced. Enforcement is unconditional at the bottom of
   * `validateComposedPlan`: any finding whose `enforced` flag is set becomes a
   * violation, on every path that writes a plan, whether or not a caller passed
   * this. That change was made because the advisory shape had a defect no
   * argument was needed for — no production caller ever passed the callback, so
   * the check was declared and never ran.
   *
   * What survives here is the REPORT. The percentage caps do not govern a taper
   * or a race week (Research/08 §9.1, and §9.2's own named doses — see
   * `capEnforced`), and those findings are worth a human's eye even though they
   * are not errors. A caller that wants to see them passes this; a caller that
   * only needs the gate does not have to.
   */
  onDosing?: (findings: DosingFinding[]) => void;
}

// ── error type ────────────────────────────────────────────────────────────────

export class PlanValidationError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    const n = violations.length;
    super(
      `Plan validation failed (${n} violation${n === 1 ? '' : 's'}):\n` +
      violations.map(v => `  · ${v}`).join('\n'),
    );
    this.name = 'PlanValidationError';
    this.violations = violations;
  }
}

// ── date helper ───────────────────────────────────────────────────────────────

function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── validator ─────────────────────────────────────────────────────────────────

/**
 * Validate a composed plan before it is written to the DB.
 *
 * Collects ALL violations before throwing (never stops at the first).
 * Throws PlanValidationError; callers should let it propagate — no partial
 * plan should ever be written when this throws.
 *
 * @param result         Output of composePlan / composeMaintenancePlan / composeRecoveryPlan.
 * @param raceDistanceMi Race distance in miles — selects the constraint row.
 * @param mode           'race-prep' enables taper + quality-coverage checks.
 * @param ctx            Runner + session context (experience, horizon, prior plan).
 * @param opts           Advisory sinks. `onDosing` receives Daniels' weekly
 *                       dosing-cap findings; see the note on that option.
 */
export function validateComposedPlan(
  result: ComposePlanResult,
  raceDistanceMi: number,
  mode: PlanMode,
  ctx: PlanValidationContext,
  opts?: ValidateOptions,
): void {
  // The categorizer never guesses: an unknown distance is null, not a half
  // marathon. A plan cannot be validated against a doctrine row we cannot
  // identify, so this refuses rather than checking it against the wrong one —
  // the same call this function's own violations make everywhere else.
  const cat = distanceCategoryOrNull(raceDistanceMi);
  if (cat == null) {
    throw new PlanValidationError([
      `${UNKNOWN_DISTANCE_REASON} (got ${String(raceDistanceMi)}); cannot validate a plan against an unknown event`,
    ]);
  }
  const c = CONSTRAINTS[cat];
  const { weeks } = result;
  const violations: string[] = [];

  // ── TRAVEL-1 (2026-08-28) · per-finding travel context ────────────────────
  // The composer's travel pass (lib/plan/travel-windows.ts) can ease a long
  // run or a quality session on a declared travel day when the week has no
  // clean seat, and it records every such day in authored_state.travel_shaped.
  // Three findings below read week volume or quality presence, and each one
  // applies this context ITSELF (CLAUDE.md §"Per-finding context filters"): a
  // taper week that dips because the runner is away is describing the trip,
  // not a taper defect, and a travel week that folded its quality is the
  // same accepted fold as AWAY-1 / qualityStrandedByAvailability. Plans with
  // no travel windows carry no travel_shaped key → every check byte-identical.
  const travelShaped: Array<{ date: string; action: string }> = (() => {
    const raw = (result.authoredState as Record<string, unknown> | undefined)?.['travel_shaped'];
    return Array.isArray(raw)
      ? raw.filter((x): x is { date: string; action: string } =>
          !!x && typeof (x as { date?: unknown }).date === 'string'
          && typeof (x as { action?: unknown }).action === 'string')
      : [];
  })();
  const weekTravelEased = (w: { startISO: string }, actions: string[]): boolean =>
    travelShaped.some((t) => actions.includes(t.action)
      && t.date >= w.startISO && t.date <= addDays(w.startISO, 6));

  // ── 0. vols / weeklyMi coherence (VOLS-SNAP) ─────────────────────────────
  // composed.vols is the volume-curve series a consumer receives alongside each week's weeklyMi.
  // finalize reconciles weeklyMi to the realized day-sum (VOL-1) but never touches vols; both the
  // prod path (generate.ts:3098) and the sim (sim-inputs.ts) re-snapshot vols from weeklyMi right
  // before validating, so the two series MUST agree. A raw composePlan has them equal (both the curve
  // budget); they only diverge when finalize ran and the re-snapshot was skipped — a stale curve up to
  // 33mi off that no other check catches (validate.ts otherwise never reads .vols).
  if (Array.isArray(result.vols)) {
    for (let i = 0; i < Math.min(result.vols.length, weeks.length); i++) {
      if (Math.abs(result.vols[i] - weeks[i].weeklyMi) > 0.5) {
        violations.push(
          `Week ${weeks[i].startISO}: vols[${i}]=${result.vols[i]}mi disagrees with weeklyMi=${weeks[i].weeklyMi}mi ` +
          `— volume-curve series not re-snapshotted after finalize`,
        );
      }
    }
  }

  // ── 1. Long run peak (doctrine cap) ──────────────────────────────────────
  // 2026-06-10 persona-suite fix: the RACE-DAY row is authored with
  // isLong:true at full race distance (layoutWeek race branch) — it is
  // the race, not a training long run, and counting it made EVERY
  // marathon plan read "peak 26.2mi exceeds 22mi". The doctrine caps
  // (Daniels/Pfitzinger long-run progression) govern TRAINING longs;
  // exclude type 'race' here and in the WoW series below.
  const cap = longRunCapMi(cat, ctx);
  let longPeak = 0;
  for (const week of weeks) {
    for (const day of week.days) {
      if (day.isLong && day.type !== 'race' && day.distanceMi > longPeak) longPeak = day.distanceMi;
    }
  }
  // 2026-06-21 · the long-run cap is a RACE-PREP concept (don't over-distance
  // the long beyond what the upcoming race needs). In maintenance/recovery the
  // long is BASE-anchored (recentLongMi × tier longPctOfPeak), so a marathoner
  // holding fitness toward a far-off 5K legitimately runs a 14mi long that the
  // 5K's 10mi cap would reject — blocking the whole DB write and leaving the
  // runner with a saved race and ZERO plans (round-2 dead-end). Only enforce
  // the cap when building TO the race.
  if (mode === 'race-prep' && longPeak > cap) {
    const ctxNote = cat === 'hm'
      ? ctx.isSteppingStoneToMarathon
        ? ' (HM stepping-stone cap)'
        : ctx.level === 'beginner'
          ? ' (HM beginner cap)'
          : ' (HM experienced cap)'
      : '';
    violations.push(
      `Long run peak ${longPeak}mi exceeds ${cap}mi limit for ${cat.toUpperCase()}${ctxNote}`,
    );
  }

  // ── 2. Prior-plan comparison (corruption check) ───────────────────────────
  // Independent of doctrine caps. Fires when the new plan's peak long is
  // dramatically lower than the prior plan's peak — signals bad inputs or
  // a volume-signal bug, not a doctrine violation.
  // 2026-06-21 · round-4 · recovery mode IS supposed to be far shorter than
  // the race plan it follows (a post-marathon recovery long is ~8-10mi vs the
  // prior plan's 20mi peak → 10 < 0.80 × 20 = 16 → false-positive violation).
  // Same gating rationale as sections 1 + 6: the corruption signal is only
  // meaningful when building TO a race; skip it for maintenance and recovery.
  if (mode === 'race-prep' && ctx.priorPlanPeakLongMi != null && ctx.priorPlanPeakLongMi > 0) {
    const floor = ctx.priorPlanPeakLongMi * 0.80;
    if (longPeak < floor) {
      violations.push(
        `Corruption check: new plan peak long ${longPeak}mi < 80% of prior plan peak ` +
        `${ctx.priorPlanPeakLongMi}mi — likely bad input data (run-history gap, VDOT signal loss)`,
      );
    }
  }

  // ── 3. Peak vs trailing volume ramp (F13) ────────────────────────────────
  // Catches plans whose peak weekly volume is unreachably high relative to
  // what the runner has actually been doing. A 65% ceiling gives room for
  // the ramp progression within the plan but blocks "jump from 25 mi/wk
  // training to 50 mi/wk peak" plans that will break the runner regardless
  // of how well the intervening weeks are structured.
  // RACE-PREP only — the peak-vs-trailing check is about the BUILD ramp; maintenance/recovery hold
  // near current volume (no ramp), so applying it there false-rejected a far-race runner's 4-week
  // maintenance block (matches the §4 taper + §6 WoW race-prep gating).
  // CC-2 (2026-06-23) · check against the best available base — the Strava trailing avg OR the
  // onboarding-seeded recentWeeklyMi. Previously this gated on trailingAvg ONLY, so a cold-start
  // signup (trailing null) skipped the ramp check entirely while the SAME runner, once Strava-
  // connected (trailing set), was refused — the plan vanished on connect (bucket-0 marathon). Using
  // max(seeded, trailing) makes cold and Strava AGREE (both cleanly refuse an infeasible ramp, e.g.
  // a 3mpw marathon, up front). The ceiling is BUILD-LENGTH-AWARE — base × 1.10^buildWeeks (×1.15
  // deload/realized margin, 8× anomaly cap) — tracking the curve's own ≤10%/week ramp doctrine
  // (Pfitzinger); a flat 1.65× rejected any build >5 climb weeks. The per-week WoW check (§6) still
  // bounds each step. Race-prep only — maintenance/recovery hold near current volume (no ramp).
  // BRK-2/CC2-1 (2026-06-23) · the volume curve floors its OWN start at max(6, base), so a base-3
  // beginner's safe ramp legitimately clears 3 — checking against the raw 3 false-rejected 10K/HALF/
  // marathon plans (saved-goal-no-plan dead-end). Match the curve's floor, CONDITIONALLY (base≥6 and
  // absent-base stay byte-identical; an unconditional max(6,…) breaks 5 validate fixtures).
  const rawRampBase = Math.max(ctx.recentWeeklyMi ?? 0, ctx.trailingAvgWeeklyMi ?? 0);
  const rampBase = (rawRampBase > 0 && rawRampBase < 6) ? 6 : rawRampBase;
  if (mode === 'race-prep' && rampBase > 0) {
    const peakWeeklyMi = Math.max(0, ...weeks.map(w => w.weeklyMi ?? 0));
    const buildWeeks = weeks.filter(w => w.phase !== 'TAPER' && !w.isRaceWeek).length;
    // VCP-2 (2026-06-23) · the flat 8× anomaly backstop collides with ULTRA: a 100K needs a 50+ peak from a
    // small base (6×8=48 < 50) and the composer is STRUCTURALLY forced to author it. Ultra plans are long +
    // ramp big, so let the build-length curve govern (1.10^buildWeeks) with a higher backstop; non-ultra
    // keeps 8×. (Mirrors longRunCapMi already being raised per distance.)
    const flatCap = cat === 'ultra' ? 20.0 : 8.0;
    // DOCTRINE-7b (2026-08-17) · THE SAME 10% RULE, GENERALISED A SECOND TIME.
    //
    // This ceiling was `1.10^buildWeeks`, tracking what the generator's ramp used
    // to be. When the generator's general-case ramp was re-sourced (see
    // goal-tiers.ts GENERAL_RAMP_CEILING — Research/00a §"Volume progression
    // rules", trained 15%/wk, novice 20%/wk, against §"The 10% rule —
    // reconsidered" which says the 10% figure is not well supported), this
    // validator kept the old number and began rejecting plans the generator was
    // now correctly authoring: 48 beginner archetypes in the all-user sweep,
    // every one a low-base runner on a short runway.
    //
    // "One doctrinal quantum, N disagreeing constants" is a named drift pattern
    // and the fix for it is to have ONE constant. Both sites now read the same
    // table, keyed to the same experience level, so they cannot diverge again.
    const rampPerWeek = GENERAL_RAMP_CEILING[ctx.level ?? 'intermediate'];
    const ceiling = rampBase * Math.min(flatCap, Math.pow(rampPerWeek, Math.max(1, buildWeeks)) * 1.15);
    // VCP-1 (2026-06-23) · allow a small absolute slack so a peak the composer floored to a clean whole mile
    // that lands a fraction over the exponential ceiling (15.0 vs 14.79) isn't rejected on a display-equal
    // boundary — a genuine multi-mile overshoot still fires. Mirrors the §6 WoW small-absolute exemption.
    if (peakWeeklyMi > ceiling + Math.max(0.5, ceiling * 0.03)) {
      violations.push(
        `Peak weekly volume ${Math.round(peakWeeklyMi)}mi exceeds the ${buildWeeks}-week safe-ramp ceiling ` +
        `${Math.round(ceiling)}mi (base ${Math.round(rampBase)}mi) — plan ramp is unsupported by current fitness`,
      );
    }
  }

  // ── 4. Long run week-over-week increase ───────────────────────────────────
  // (race-day rows excluded — see section 1 note.)
  const longByWeek = weeks.map(w =>
    Math.max(0, ...w.days.filter(d => d.isLong && d.type !== 'race').map(d => d.distanceMi)),
  );
  for (let i = 1; i < longByWeek.length; i++) {
    const prev = longByWeek[i - 1];
    const curr = longByWeek[i];
    // CUTBACK-LONG-1 (2026-08-28) · the week after a PLANNED cutback measures
    // its jump against the last load week's long, bridging over the deload.
    // Doctrine builds the dip on purpose — the cutback long now drops 20-30%
    // per Research/00b's tier table — so a plain ratio reads the planned
    // rebound as a spike (a 25% dip returns at +33% > the 30% limit). Same
    // reasoning as §6's move to ACWR: the rebound to a level the block already
    // held is not a ramp. A jump BEYOND the bridged level still fires — the
    // limit is applied to the pre-cutback long instead of being waived.
    // Consecutive cutbacks cannot occur (cadence is every 3rd or 4th week),
    // so `i - 2` is always a load week when `i - 1` is a curve deload.
    if (weeks[i - 1]?.isCutback && !weeks[i - 1]?.isRaceWeek) {
      const bridge = longByWeek[i - 2] ?? 0;
      if (bridge > 0 && curr <= bridge * (1 + c.longRunWoWMaxPct / 100)) continue;
    }
    if (prev > 0 && curr > prev * (1 + c.longRunWoWMaxPct / 100)) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      violations.push(
        `Week ${i}: long run jumps ${prev}mi → ${curr}mi (${pct}% increase > ${c.longRunWoWMaxPct}% WoW limit)`,
      );
    }
  }

  // ── 4. Taper present and deep enough (race-prep only) ─────────────────────
  if (mode === 'race-prep') {
    const hasTaperPhase = result.blocks.phases.some(p => p.label === 'TAPER');
    if (!hasTaperPhase) {
      violations.push('No TAPER phase in plan blocks — plan will not taper before race');
    } else {
      const nonTaperNonRace = weeks.filter(w => w.phase !== 'TAPER' && !w.isRaceWeek);
      const peakVol = nonTaperNonRace.length > 0
        ? Math.max(...nonTaperNonRace.map(w => w.weeklyMi))
        : 0;
      // TAPER-1 (2026-06-23) · exclude the race week from the deepest-taper computation.
      // The race-week VOL-1 value (~14-18mi: shakeout + tune-up + 2-3 short easies) is always
      // far below any taperDropMinPct threshold, so including it made `deepest` trivially small
      // and `deepestDrop` always ≥45%, masking training taper weeks that barely reduce at all.
      // The race week is minimal pre-race activity, not a training taper stimulus — exclude it.
      const taperW = weeks.filter(w => w.phase === 'TAPER' && !w.isRaceWeek);
      // SHORT-TAPER-1 (2026-06-23): for very short plans, sizeBlocks phases_total can exceed
      // totalWeeks (phases overflow). The only TAPER-labeled week becomes the race week, so
      // taperW=[] and all depth/monotone checks silently skip — a marathon/HM with zero pre-race
      // taper passes undetected. 5K/10K legitimately have taperWeeks=1 which IS the race week
      // (no non-race taper needed); only enforce for HM (≥13mi, needs 1) and marathon/ultra (≥20mi, needs 2).
      const minNonRaceTaperWks = raceDistanceMi >= 20 ? 2 : raceDistanceMi >= 13 ? 1 : 0;
      if (taperW.length < minNonRaceTaperWks) {
        violations.push(
          `Too few pre-race taper weeks: got ${taperW.length} non-race TAPER week(s), ` +
          `need ≥${minNonRaceTaperWks} for ${raceDistanceMi >= 20 ? 'marathon/ultra' : 'half-marathon'} — ` +
          `plan is too short or phase phasing overflowed (increase plan length)`,
        );
      }
      if (peakVol > 0 && taperW.length > 0) {
        // Research/08 §9.2 · the taper is PROGRESSIVE (80-90% → 60-70% → 40-50% of peak), NOT a flat
        // ≥30% on every week — the first taper week legitimately drops only ~10-20%. Require (a) the
        // taper BOTTOMS deep enough (deepest week ≥ taperDropMinPct below peak), (b) no taper week
        // sits above peak, (c) it descends (each taper week ≤ the prior).
        const deepest = Math.min(...taperW.map(w => w.weeklyMi));
        const deepestDrop = ((peakVol - deepest) / peakVol) * 100;
        if (deepestDrop < c.taperDropMinPct) {
          violations.push(
            `Taper bottoms at ${deepest}mi, only ${Math.round(deepestDrop)}% below peak ${peakVol}mi ` +
            `(need ≥${c.taperDropMinPct}% by race) — taper too shallow`,
          );
        }
        // DOCTRINE-1b · the OTHER end of the band. Research/08 §9.1 states a
        // volume reduction RANGE per distance; a taper deeper than the range's
        // ceiling is not a safer taper, it is detraining before a race. This is
        // the check that was structurally missing — it is what would have caught
        // the marathon's 0.45 factor being applied to a 5K.
        //
        // TRAVEL-1 · measured over the weeks the TAPER authored, not the weeks
        // travel eased: a taper week whose long run was eased because the
        // runner is away (authored_state.travel_shaped · long_eased) dips
        // below the authored curve by declared circumstance, and reading that
        // dip as "detraining by design" would refuse the exact plan the
        // runner asked for. Weeks travel did not touch are still held to the
        // full band; if EVERY taper week was travel-eased there is no
        // authored depth left to grade and the too-deep check stands down
        // (the too-shallow check above still ran against the deepest week,
        // where travel can only help).
        const authoredTaperW = taperW.filter(w => !weekTravelEased(w, ['long_eased']));
        if (authoredTaperW.length > 0) {
          const authoredDeepest = Math.min(...authoredTaperW.map(w => w.weeklyMi));
          const authoredDrop = ((peakVol - authoredDeepest) / peakVol) * 100;
          if (authoredDrop > c.taperDropMaxPct) {
            violations.push(
              `Taper bottoms at ${authoredDeepest}mi, ${Math.round(authoredDrop)}% below peak ${peakVol}mi ` +
              `(max ${c.taperDropMaxPct}% for this distance, Research/08 §9.1) — taper too deep`,
            );
          }
        }
        // DOCTRINE-1b · and each pre-race taper week against the shared model
        // the generator used, so a layout or reconciliation pass cannot quietly
        // flatten the descent that volumeCurve authored. taperW is ordered
        // chronologically and the race week is excluded, so the last entry is
        // always two weeks out.
        for (let i = 0; i < taperW.length; i++) {
          const wksLeft = taperW.length - i + 1;   // +1 · the race week is not in taperW
          const expected = peakVol * taperFactor(cat, wksLeft);
          if (taperW[i].weeklyMi > expected * 1.15 + 0.5) {
            violations.push(
              `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi vs the doctrine target ` +
              `${Math.round(expected * 10) / 10}mi at ${wksLeft} weeks out (Research/08 §9.1) — taper week too shallow`,
            );
          }
        }
        for (let i = 0; i < taperW.length; i++) {
          if (taperW[i].weeklyMi > peakVol * 1.02) {
            violations.push(
              `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi is ABOVE peak ${peakVol}mi — taper must reduce volume`,
            );
          }
          // TRAVEL-1 · a prior taper week that dipped because travel eased its
          // long run is not the descent reference — the week after it returns
          // to the authored curve, which reads as a "rise" only against the
          // dip. Bridge to the last non-travel-eased taper week (the same
          // shape as CUTBACK-LONG-1's bridge over a planned deload); when
          // every earlier taper week was travel-eased, the descent has no
          // authored reference and the pair is skipped.
          if (i > 0 && taperW[i].weeklyMi > taperW[i - 1].weeklyMi * 1.05) {
            const ref = [...taperW.slice(0, i)].reverse()
              .find(w => !weekTravelEased(w, ['long_eased']));
            if (!ref || taperW[i].weeklyMi > ref.weeklyMi * 1.05) {
              if (ref && ref !== taperW[i - 1]) {
                violations.push(
                  `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi rises above the last authored taper week ` +
                  `${ref.weeklyMi}mi — taper must descend`,
                );
              } else if (ref) {
                violations.push(
                  `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi rises above the prior taper week ` +
                  `${taperW[i - 1].weeklyMi}mi — taper must descend`,
                );
              }
            }
          }
        }
      }
    }
  }

  // ── 5. Quality coverage in quality phases ─────────────────────────────────
  // Weeks that are entirely in the past are skipped. Sealed completed workouts
  // cannot be retroactively fixed by the generator; a week where the quality
  // session was already run (even as easy due to adaptation) must not fail
  // this check — the prescription was set and served its purpose.
  const qualityPhases = new Set(['QUALITY', 'RACE-SPECIFIC']);
  for (const week of weeks) {
    if (!qualityPhases.has(week.phase) || week.isRaceWeek) continue;
    // Past week: last day (startISO + 6) is before today → sealed, skip.
    if (addDays(week.startISO, 6) < ctx.todayISO) continue;
    // 1-day-a-week runners get a single run (the long/base run), not a separate
    // quality session — they can't have both. Skip the requirement for them.
    if (ctx.trainingDaysPerWeek != null && ctx.trainingDaysPerWeek <= 1) continue;
    // NOQ-mode (GOAL-1) · when available_days strand quality by construction (e.g. two adjacent days →
    // spacedQualityDowsFromAvailable returns []), the composer correctly folds to long + easy only
    // (Research/00a:754 · 48h between hard sessions). Accept that fold — mirrors the trainingDaysPerWeek<=1
    // allowance — instead of rejecting the ONLY doctrinally-safe plan and leaving the runner with NO plan.
    if (ctx.qualityStrandedByAvailability) continue;
    // AWAY-1 (2026-08-19) · A WEEK THE RUNNER IS AWAY FOR IS NOT A WEEK THAT
    // LOST ITS QUALITY SESSION.
    //
    // A week whose days are all prescribed as rest is a recorded absence, and
    // "every quality-phase week requires at least one" has nothing to say about
    // a week with no running in it. Without this, the only way to record a
    // holiday was to introduce a violation and be rolled back for it — which is
    // what `/api/plan/change`'s travel scenario runs into, through
    // `lib/plan/mutate.ts`, on the one request whose entire content is "these
    // days are not happening".
    //
    // TWO CONDITIONS, AND THE FIRST ONE IS THE LOAD-BEARING ONE. The week must
    // still HAVE its days. A week with no rows at all is not an absence, it is
    // a hole — rows deleted, or a write that lost them — and that is a bug this
    // check is one of the few things positioned to catch. `_mutation_boundary
    // .test.ts` holds exactly that case.
    //
    // Deliberately "no running at all", not "not much": a reduced week still has
    // to carry its quality, which is what Research/00b's cutback notes say in
    // as many words ("keep one quality session", "one true quality session
    // only"). Inert for authoring either way — the generator never writes an
    // empty week, and `_sweep_allusers.test.ts` fails an `EMPTY_WEEK` outright.
    if (week.days.length > 0 && !(week.weeklyMi > 0)) continue;
    // TRAVEL-1 · a week whose quality was eased onto easy legs because every
    // clean seat was inside a declared travel window is the same accepted
    // fold as the two allowances above: the miles are still there, the
    // intensity was moved off travel days on purpose (Research/12 "avoid
    // hard efforts"), and the fold is on the plan's own record
    // (authored_state.travel_shaped). A week travel merely RELOCATED quality
    // within still carries it, so this only fires on the recorded ease.
    if (weekTravelEased(week, ['quality_eased'])) continue;
    if (!week.days.some(d => d.isQuality)) {
      violations.push(
        `Week ${week.startISO} (${week.phase}): no quality sessions prescribed — ` +
        `every quality-phase week requires at least one`,
      );
    }
  }

  // ── 6. Weekly volume arc (no week > 150% of prior) ────────────────────────
  // 2026-06-21 · the WoW build ceiling is a RACE-PREP concept (a safe ramp TO
  // the race). A RECOVERY block deliberately rebuilds from a deep cutback
  // (e.g. 30%→55% of peak = 83% WoW by design) and MAINTENANCE holds a flat
  // base; applying the race-prep 50% ceiling to them rejected a just-finished
  // marathoner's mandatory recovery plan and left them with ZERO plans (round-2
  // CRITICAL). Only enforce the build ceiling when building to the race —
  // matching the section-4 taper check, which is already race-prep-only.
  //
  // WKRAMP-1 (2026-08-19) · THE STEP AND THE REBOUND ARE DIFFERENT QUESTIONS,
  // AND ONLY ONE OF THEM WAS BEING ASKED.
  //
  // This was a single flat 50%-of-last-week ceiling, and 50 was not a research
  // number: it was whatever the generator happened to author. Swept across
  // 11,598 archetypes, tightening it toward doctrine rejected plans in bulk
  // (25% → 1480 firm failures) because `generate.ts` itself authored steps up to
  // 44%. A guardrail calibrated to the thing it guards is not a guardrail. The
  // generator is fixed (see `enforceWeeklyRampCeiling`) and this check now asks
  // the question doctrine actually publishes an instrument for.
  //
  //   · this week against the 28-day mean — the instrument Research/00a
  //     §"Load metrics" and §"ACWR risk zones" actually publish for the
  //     question "is this week too big for what I have been doing". It catches
  //     a spike whether it lands in one week or accumulates over three, and a
  //     planned deload barely moves a four-week mean, so unlike the old
  //     week-over-week ratio it needs no cutback exemption. The ceiling is
  //     `ACWR_HIGH_RISK`, the ≥1.5 "substantially elevated" row: a validator is
  //     a backstop and belongs at the red line, not at the sweet-spot boundary.
  //
  // WHY THIS DOES NOT ALSO MIRROR THE GENERATOR'S PEAK-RELATIVE RAMP RULE.
  // `enforceWeeklyRampCeiling` caps every authored week at the block's peak
  // times `GENERAL_RAMP_CEILING`, and re-asserting that here was the obvious
  // move. It is the wrong one, because this function is not only a generation
  // gate — `lib/plan/mutate.ts` runs it differentially over every adapter
  // write, blocking a mutation that INTRODUCES a violation. A peak-relative
  // test is not stable under mutation: shaving one mile off week 1 lowers the
  // peak and can tip a week five weeks later past the ceiling, so an ordinary
  // "runner cut a run short" write would be refused for a ramp it did not
  // author. The cumulative case is already covered, and covered better, by §3
  // above — `rampBase × rampPerWeek^buildWeeks`, reading the same
  // GENERAL_RAMP_CEILING against the runner's actual base rather than against
  // one extreme week inside the plan. So: §3 bounds the ramp over the block,
  // this bounds the acute spike, and the peak-relative rule lives where the
  // plan is authored and there is no differential semantics to trip over.
  //
  // The small-absolute exemption (2026-06-23) is unchanged: at very low volume
  // a %-jump is misleading — a 6mi→9mi step is +50% but only +3mi, a safe ramp
  // for a cold-start beginner — so a jump of 4mi or less is never flagged.
  // `enforceWeeklyRampCeiling` applies the identical exemption, so the
  // generator and the validator agree about which jumps are too small to name.
  const nonRaceWeeks = weeks.filter(w => !w.isRaceWeek);
  for (let i = 1; mode === 'race-prep' && i < nonRaceWeeks.length; i++) {
    const prev = nonRaceWeeks[i - 1].weeklyMi ?? 0;
    const curr = nonRaceWeeks[i].weeklyMi ?? 0;
    if (!(prev > 0) || curr - prev <= 4) continue;
    const window = nonRaceWeeks
      .slice(Math.max(0, i - (ACWR_CHRONIC_WEEKS - 1)), i + 1)
      .map(w => w.weeklyMi ?? 0);
    const chronic = window.reduce((s, v) => s + v, 0) / window.length;
    if (chronic > 0 && curr / chronic > ACWR_HIGH_RISK) {
      violations.push(
        `Week ${nonRaceWeeks[i].startISO}: ${curr}mi against a ${chronic.toFixed(1)}mi ` +
        `${ACWR_CHRONIC_WEEKS}-week mean is an acute:chronic ratio of ` +
        `${(curr / chronic).toFixed(2)} — doctrine's high-risk line is ${ACWR_HIGH_RISK}`,
      );
    }
  }

  // ── 7. SP-7 · long-primacy (all modes) ───────────────────────────────────
  // The long must be the week's longest run. A clustered week or an easy≥long
  // inversion passes every other check but is structurally wrong. Tolerant of a
  // ≤0.15mi rep-floor residual (a quality day's rounded reps can tie within a hair).
  // Skip race weeks (the "long" may be a shakeout, the race is separate) + sealed past weeks.
  for (const week of weeks) {
    if (week.isRaceWeek) continue;
    if (addDays(week.startISO, 6) < ctx.todayISO) continue;
    const longMi = Math.max(0, ...week.days.filter(d => d.isLong && d.type !== 'race').map(d => d.distanceMi));
    if (longMi <= 0) continue;
    for (const d of week.days) {
      if (d.isLong || d.type === 'race' || d.type === 'rest') continue;
      if (d.distanceMi > longMi + 0.15) {
        violations.push(
          `Week ${week.startISO} (${week.phase}): ${d.type} ${d.distanceMi}mi exceeds the long ${longMi}mi — ` +
          `the long must be the week's longest run`,
        );
      }
    }
  }

  // ── 8. SP-7 · race-week chronology (race-prep) ────────────────────────────
  // No running prescription may fall AFTER race day (composePlan's SP-4 guard
  // already prevents it; this is the regression net).
  // FIX (2026-06-24): compare chronological position relative to the week's
  // start day, not raw DOW integers. When the week starts mid-week (e.g. a
  // Wednesday start because today is Tuesday), Sunday (dow 0) wraps around to
  // position 4 in the week, so days with dow 3/4/5/6 (Wed-Sat) come BEFORE it
  // in calendar order — raw `d.dow > raceDay.dow` would flag them incorrectly.
  if (mode === 'race-prep') {
    for (const week of weeks) {
      if (!week.isRaceWeek) continue;
      const raceDay = week.days.find(d => d.type === 'race');
      if (!raceDay) continue;
      // Determine the week-start DOW so we can compute chronological position.
      const weekStartDow = new Date(week.startISO + 'T12:00:00Z').getUTCDay();
      const pos = (dow: number) => (dow - weekStartDow + 7) % 7;
      const racePosInWeek = pos(raceDay.dow);
      for (const d of week.days) {
        const isPrescription = d.type !== 'race' && d.type !== 'rest' && d.distanceMi > 0;
        if (isPrescription && pos(d.dow) > racePosInWeek) {
          violations.push(
            `Week ${week.startISO} (race week): ${d.type} on dow ${d.dow} is dated AFTER the race ` +
            `(dow ${raceDay.dow}) — no prescription may fall after race day`,
          );
        }
      }
    }
  }

  // ── 9. SP-7 · stimulus-gap adjacency (race-prep) ──────────────────────────
  // Hard days spaced per Research/00b:55-60 (intervals/VO2max → 2 easy days after;
  // threshold/tempo/long → 1). Skip race weeks (taper structure differs), sealed past
  // weeks, and OVER-CONSTRAINED weeks where the required recovery exceeds the available
  // days (e.g. two VO2max sessions in a ≤6-day week) — the composer does best-achievable
  // there (B3) and the violation is mathematically unavoidable, not a bug.
  // VAL-1 (2026-06-23) · extend stimulus-gap §9 to maintenance mode. The maintenance composer places
  // a single quality session per week, so a gap violation is possible only if qualityDows puts quality
  // adjacent to the long. The over-constrained skip guard (requiredTotal > 7 - hard.length) still applies.
  // Recovery has no quality sessions and trivially passes. 'race-prep' keeps its existing check unchanged.
  if (mode === 'race-prep' || mode === 'maintenance') {
    // FARTLEK-GAP-1 (2026-06-23) · after MAINT-FARTLEK-SPEC, fartlek sessions are type='easy' + isQuality=true.
    // isQuality=true means they enter the hard[] array; the old reqGap returned 1 for any non-interval type,
    // so Saturday-fartlek → Sunday-long (0 easy days between) tripped a false PlanValidationError. Research/00b:55-60
    // gap doctrine applies to threshold and interval sessions — not to aerobic-zone fartlek (easy run with 1-minute
    // pickups). A fartlek is compatible with adjacent long runs and needs no recovery gap. Return 0 for easy.
    const reqGap = (t: string): number => (t === 'intervals' ? 2 : t === 'easy' ? 0 : 1);
    for (const week of weeks) {
      if (week.isRaceWeek) continue;
      if (addDays(week.startISO, 6) < ctx.todayISO) continue;
      const hard = week.days
        .filter(d => (d.isQuality || d.isLong) && d.type !== 'race' && d.type !== 'shakeout' && d.type !== 'race_week_tuneup')
        .map(d => ({ dow: d.dow, type: d.type, g: reqGap(d.type) }))
        .sort((a, b) => a.dow - b.dow);
      if (hard.length < 2) continue;
      const requiredTotal = hard.reduce((s, h) => s + h.g, 0);
      if (requiredTotal > 7 - hard.length) continue; // over-constrained → best-achievable, don't flag
      for (let i = 0; i < hard.length; i++) {
        const cur = hard[i]; const nxt = hard[(i + 1) % hard.length];
        const between = ((nxt.dow - cur.dow + 7) % 7) - 1;
        if (between < cur.g) {
          violations.push(
            `Week ${week.startISO} (${week.phase}): ${cur.type}@${cur.dow} → ${nxt.type}@${nxt.dow} ` +
            `only ${between} easy day(s), needs ${cur.g} (Research/00b:55-60)`,
          );
        }
      }
    }
  }

  // ── 10. Daniels' dosing caps · FATAL (DOCTRINE-DOSING-2, 2026-08-18) ─────
  //
  // This ran as an advisory callback for one day. The reasoning then was that
  // enforcing it would re-prescribe existing plans and that was the owner's
  // call; he made it — "if my plan has a chance of breaking rules, then we need
  // to insert something into the code that would never allow that."
  //
  // So it is computed UNCONDITIONALLY now, not when a caller opts in. The
  // advisory shape had a second failure mode nobody had to argue about: no
  // production caller ever passed `onDosing`, so the check existed and never
  // ran. A gate that has to be requested is not a gate.
  //
  // `enforced` is the finding's own answer to "may the engine author this"
  // (see `capEnforced` in ./dosing): absolute ceilings bind in every week,
  // percentage caps bind on training weeks. A taper deliberately holds
  // intensity while volume falls (Research/08 §9.1) and §9.2 prescribes its
  // sessions by name at doses outside the percentage, so enforcing the
  // percentage there would forbid the taper doctrine mandates. Those findings
  // are still REPORTED through `onDosing` — CLAUDE.md §"Per-finding context
  // filters" — they are simply not fatal.
  //
  // Nothing should ever reach here. `layoutWeek` sizes every session against
  // this same budget and `applyDosingCaps` reconciles after every pass that
  // moves mileage; the whole 180-archetype corpus authors zero enforced
  // breaches. This is the assertion that it stays that way, on every path that
  // writes a plan.
  const dosing = planDosingFindings(weeks);
  if (opts?.onDosing) opts.onDosing(dosing);
  for (const f of dosing) {
    if (!f.enforced) continue;
    violations.push(`Week ${f.weekStartISO ?? '?'} (${f.phase ?? '?'}): ${f.message}`);
  }

  if (violations.length > 0) throw new PlanValidationError(violations);
}
