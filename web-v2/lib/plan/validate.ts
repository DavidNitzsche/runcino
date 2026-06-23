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
import { distanceCategoryOfPublic } from './generate';
import type { PlanMode } from './goal-tiers';

// ── constraint table (doctrine caps) ─────────────────────────────────────────
//
// Long-run caps by context (see longRunCapMi()):
//
//   HM standalone, beginner:                 ≤ 14 mi
//   HM standalone, intermediate/advanced:    ≤ 16 mi
//   HM stepping stone to marathon (≤168 d):  ≤ 20 mi
//   Marathon (standalone or any):            ≤ 22 mi
//   10K:                                     ≤ 13 mi
//   5K:                                      ≤ 10 mi
//
// Cite: Daniels "Running Formula" §long-run doctrine; Pfitzinger
//       "Advanced Marathoning" §"Bridging from half to full" (horizon raise).

interface PlanConstraints {
  longRunWoWMaxPct: number;     // max WoW long-run increase (% of prior week)
  taperDropMinPct: number;      // min taper volume drop vs non-taper peak (%)
  weeklyVolWoWMaxPct: number;   // max WoW weekly total volume increase (%)
}

const CONSTRAINTS: Record<DistCategory, PlanConstraints> = {
  '5k':    { longRunWoWMaxPct: 30, taperDropMinPct: 20, weeklyVolWoWMaxPct: 50 },
  '10k':   { longRunWoWMaxPct: 30, taperDropMinPct: 25, weeklyVolWoWMaxPct: 50 },
  'hm':    { longRunWoWMaxPct: 30, taperDropMinPct: 30, weeklyVolWoWMaxPct: 50 },
  'm':     { longRunWoWMaxPct: 30, taperDropMinPct: 30, weeklyVolWoWMaxPct: 50 },
  // #12 (audit 2026-06-16) · 'ultra' is now its own category (was bucketed as
  // 'm' by generate's old categorizer, which capped the ultra long run at the
  // marathon ceiling). Same WoW/taper caps as the marathon; the long-run CAP
  // itself is raised in longRunCapMi below to the ultra peak-long band.
  'ultra': { longRunWoWMaxPct: 30, taperDropMinPct: 30, weeklyVolWoWMaxPct: 50 },
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
   * ~168 days after the current race. Loosens HM long-run cap from 14/16 mi
   * to 20 mi — plan is a stepping stone, not a standalone build.
   * Cite: Pfitzinger "Advanced Marathoning" §"Bridging from half to full."
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
   * plan peak weekly volume must not exceed trailing × 1.65, a 65% jump ceiling
   * grounded in Pfitzinger's 10%/week escalation doctrine and race-prep ramp
   * literature. null = not enough history to compute (skip the check).
   * Cite: Pfitzinger "Advanced Marathoning" §weekly volume escalation.
   */
  trailingAvgWeeklyMi: number | null;
  /** 2026-06-23 · GOAL-1 · true when available_days constrain quality to empty by construction
   *  (an adjacent-day pair → spacedQualityDowsFromAvailable returns []). The plan correctly folds to
   *  long + easy only, so the quality-coverage check is skipped (mirrors trainingDaysPerWeek<=1). */
  qualityStrandedByAvailability?: boolean;
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
 */
export function validateComposedPlan(
  result: ComposePlanResult,
  raceDistanceMi: number,
  mode: PlanMode,
  ctx: PlanValidationContext,
): void {
  const cat = distanceCategoryOfPublic(raceDistanceMi);
  const c = CONSTRAINTS[cat];
  const { weeks } = result;
  const violations: string[] = [];

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
  if (mode === 'race-prep' && ctx.trailingAvgWeeklyMi != null && ctx.trailingAvgWeeklyMi > 0) {
    const peakWeeklyMi = Math.max(0, ...weeks.map(w => w.weeklyMi ?? 0));
    // 2026-06-23 · the ceiling must be BUILD-LENGTH-AWARE, not a flat 1.65×. The volume curve ramps
    // at ≤10%/week (Pfitzinger escalation doctrine), so a plan that ramps SAFELY over N build weeks
    // legitimately reaches trailing × 1.10^N — and the flat 1.65× rejected any build longer than ~5
    // climb weeks (1.10^5 = 1.61), denying a plan to ~1,800 Strava-connected runners whose every
    // week was a safe ≤10% step. Track the doctrine: ceiling = trailing × 1.10^buildWeeks (× a 1.15
    // margin for deload/realized noise), capped at 8× as a gross-anomaly backstop. The per-week WoW
    // check (§6) still bounds each individual step.
    const buildWeeks = weeks.filter(w => w.phase !== 'TAPER' && !w.isRaceWeek).length;
    const ceiling = ctx.trailingAvgWeeklyMi * Math.min(8.0, Math.pow(1.10, Math.max(1, buildWeeks)) * 1.15);
    if (peakWeeklyMi > ceiling) {
      violations.push(
        `Peak weekly volume ${Math.round(peakWeeklyMi)}mi exceeds the ${buildWeeks}-week safe-ramp ceiling ` +
        `${Math.round(ceiling)}mi (trailing ${Math.round(ctx.trailingAvgWeeklyMi)}mi) — ` +
        `plan ramp is unsupported by current fitness`,
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
      const taperW = weeks.filter(w => w.phase === 'TAPER');
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
        for (let i = 0; i < taperW.length; i++) {
          if (taperW[i].weeklyMi > peakVol * 1.02) {
            violations.push(
              `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi is ABOVE peak ${peakVol}mi — taper must reduce volume`,
            );
          }
          if (i > 0 && taperW[i].weeklyMi > taperW[i - 1].weeklyMi * 1.05) {
            violations.push(
              `Taper week ${taperW[i].startISO}: ${taperW[i].weeklyMi}mi rises above the prior taper week ` +
              `${taperW[i - 1].weeklyMi}mi — taper must descend`,
            );
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
  const nonRaceWeeks = weeks.filter(w => !w.isRaceWeek);
  for (let i = 1; mode === 'race-prep' && i < nonRaceWeeks.length; i++) {
    const prev = nonRaceWeeks[i - 1].weeklyMi;
    const curr = nonRaceWeeks[i].weeklyMi;
    // 2026-06-23 · small-absolute exemption: at very low volume the %-jump is misleading — a
    // 6mi→9mi step is +50% but only +3mi, a safe ramp for a cold-start beginner. Flag only when
    // the jump exceeds the % ceiling AND is more than 4mi in absolute terms (mirrors the taper
    // rule's shift from %-only to a calibrated check).
    if (prev > 0 && curr > prev * (1 + c.weeklyVolWoWMaxPct / 100) && curr - prev > 4) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      violations.push(
        `Week ${nonRaceWeeks[i].startISO}: volume jumps ${prev}mi → ${curr}mi ` +
        `(${pct}% increase > ${c.weeklyVolWoWMaxPct}% WoW limit)`,
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
  if (mode === 'race-prep') {
    for (const week of weeks) {
      if (!week.isRaceWeek) continue;
      const raceDay = week.days.find(d => d.type === 'race');
      if (!raceDay) continue;
      for (const d of week.days) {
        const isPrescription = d.type !== 'race' && d.type !== 'rest' && d.distanceMi > 0;
        if (isPrescription && d.dow > raceDay.dow) {
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
  if (mode === 'race-prep') {
    const reqGap = (t: string): number => (t === 'intervals' ? 2 : 1);
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

  if (violations.length > 0) throw new PlanValidationError(violations);
}
