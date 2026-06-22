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
  switch (cat) {
    case '5k':    return 10;
    case '10k':   return 13;
    case 'm':     return 22;
    // #12 · ultra long runs go well past the marathon. Cap at the ultra tier's
    // peak-long upper band (32 mi, goal-tiers TIER_TARGETS.ultra) so a legit
    // 50K+ plan isn't rejected against the marathon 22-mi ceiling.
    // Cite: Research/22 §Ultramarathon (peak long 22-32 mi / 5-7 hr on feet).
    case 'ultra': return 32;
    case 'hm':
      if (ctx.isSteppingStoneToMarathon) return 20;
      return ctx.level === 'beginner' ? 14 : 16;
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
  if (ctx.trailingAvgWeeklyMi != null && ctx.trailingAvgWeeklyMi > 0) {
    const peakWeeklyMi = Math.max(0, ...weeks.map(w => w.weeklyMi ?? 0));
    const ceiling = ctx.trailingAvgWeeklyMi * 1.65;
    if (peakWeeklyMi > ceiling) {
      violations.push(
        `Peak weekly volume ${Math.round(peakWeeklyMi)}mi exceeds 1.65× trailing average ` +
        `${Math.round(ctx.trailingAvgWeeklyMi)}mi (ceiling: ${Math.round(ceiling)}mi) — ` +
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
      for (const tw of weeks.filter(w => w.phase === 'TAPER')) {
        if (peakVol > 0) {
          const dropPct = ((peakVol - tw.weeklyMi) / peakVol) * 100;
          if (dropPct < c.taperDropMinPct) {
            violations.push(
              `Taper week ${tw.startISO}: ${tw.weeklyMi}mi is only ${Math.round(dropPct)}% ` +
              `below peak ${peakVol}mi (need ≥${c.taperDropMinPct}% drop)`,
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
    if (prev > 0 && curr > prev * (1 + c.weeklyVolWoWMaxPct / 100)) {
      const pct = Math.round(((curr - prev) / prev) * 100);
      violations.push(
        `Week ${nonRaceWeeks[i].startISO}: volume jumps ${prev}mi → ${curr}mi ` +
        `(${pct}% increase > ${c.weeklyVolWoWMaxPct}% WoW limit)`,
      );
    }
  }

  if (violations.length > 0) throw new PlanValidationError(violations);
}
