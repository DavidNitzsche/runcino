/**
 * seed-from-onboarding · maintenance-plan seeder for the no-race path.
 *
 * Mirrors the maintenance branch of `legacy/web/coach/plan-builder.ts`
 * (the canonical authoring engine — see CLAUDE.md "Engine must match
 * research") for the specific case where the runner picked "No specific
 * race" during Lilian onboarding (migration 118) and is being given
 * their first plan as part of /api/onboarding/complete.
 *
 * Why a parallel implementation: the canonical plan-builder lives in
 * legacy/web and pulls in the full CoachState aggregator + VDOT
 * resolver + doctrine modules — that dep tree isn't compiled into the
 * web-v2 Next build (legacy is reachable via the iPhone / Watch path
 * through plan-lifecycle, but not via Next routes here). Phase 28
 * extends both: the canonical buildPlan reads `OnboardingGoals`, and
 * this thin web-v2 seeder constructs the same shape, applies the same
 * rules, and writes directly into the plan tables.
 *
 * What it does NOT do:
 *  - VDOT-derived pace target injection (no race result + no Daniels
 *    table at this layer; the iPhone briefing pulls paces from CoachState
 *    once Strava data lands and the plan-lifecycle rebuilds via the
 *    canonical buildPlan).
 *  - Strength scheduling (the canonical builder owns adaptive slot
 *    selection; this seeder leaves hasStrength false and lets the next
 *    rebuild thread it in).
 *  - Workout-spec JSONB rows (migration 120 spec emission is a
 *    canonical-builder responsibility).
 *
 * The runner gets a usable plan immediately, and the next lifecycle
 * rebuild from the canonical buildPlan upgrades it with full doctrine.
 *
 * Cite: Daniels Running Formula §13 · "Periodization" — maintenance
 * weeks hold flat at the runner-stated target with a 0.82× cutback
 * every third week.
 * Cite: Research/00a §Volume-Progression-Rules — long-run floor  // was §"The 10% rule, reconsidered" · heading: ### Volume progression rules
 * is 50% of the recent longest training run (or historical longest
 * when no recent data exists).
 */

import { randomBytes } from 'crypto';
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { buildWorkoutSpec, conservativeVdotFromMileage } from './spec-builder';
import { tPaceFromVdot } from '@/lib/training/vdot';
import {
  HIST_AVG_MIDPOINTS,
  HIST_LONG_MIDPOINTS,
  type HistAvg,
  type HistLong,
  type HistYears,
  type TTDistance,
  type WeeklyMileage,
  type WeeklyFrequency,
} from '@/lib/onboarding/state';

/**
 * Shape captured by the no-race onboarding flow. Mirrors the canonical
 * `OnboardingGoals` interface in legacy/web/coach/plan-builder.ts —
 * keep the two in sync if either evolves.
 */
export interface OnboardingGoals {
  ttDistance: TTDistance | null;
  ttTimeBucket: string | null;
  weeklyMiTarget: WeeklyMileage | null;
  weeklyFrequency: WeeklyFrequency | null;
  historyAvg: HistAvg | null;
  historyLong: HistLong | null;
  historyYears: HistYears | null;
}

interface SeedInput {
  userId: string;
  goals: OnboardingGoals;
}

interface SeedResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  peak_mpw?: number;
  reason?: string;
}

const TOTAL_WEEKS = 16;        // Maintenance window per canonical builder.
const MPW_FLOOR   = 8;         // Below 8 mpw, no plan helps; floor at 8.
const LONG_PCT    = 0.26;      // Long run % of weekly (canonical builder).
const T_SOLO_PCT  = 0.18;      // Threshold (1 quality/wk · maintenance).

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

function mondayOf(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const shift = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, shift);
}

function round1(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Default quality / long / rest days when the runner hasn't set
 * user_prefs yet. Mirrors `DEFAULT_QUALITY_DOWS` / `DEFAULT_LONG_RUN_DOW`
 * / `DEFAULT_REST_DOW` from legacy/web/lib/coach-state.ts:
 *   long: Saturday (dow 6)
 *   quality: Tue (2) for 1 q/wk, Tue + Thu (2, 4) for 2 q/wk
 *   rest: Monday (dow 1)
 *
 * weeklyFrequency hint:
 *   3 days/wk → 1 quality + 1 long + 1 easy
 *   4 days/wk → 1 quality + 1 long + 2 easy
 *   5 days/wk → 2 quality + 1 long + 2 easy
 *   6 days/wk → 2 quality + 1 long + 3 easy
 *
 * Maintenance is 1 quality/wk by canonical doctrine (Daniels §13) — so
 * for now we cap at 1 quality day even when the runner picks 5 / 6 days.
 * The extra days become easy mileage.
 */
function defaultLayout(weeklyFrequency: WeeklyFrequency | null): {
  longRunDow: number;
  qualityDows: number[];
  restDow: number;
} {
  return {
    longRunDow: 6,                  // Saturday
    qualityDows: [2],               // Tuesday (single quality, maintenance)
    restDow: 1,                     // Monday
  };
  void weeklyFrequency; // layout only sets anchor days; dayShape() applies the cap
}

/** Translate a runner-supplied OnboardingGoals into the
 *  HIST_AVG_MIDPOINTS / HIST_LONG_MIDPOINTS numeric values the seeder
 *  uses for cold-start volume + long-run floors. */
function midpoints(goals: OnboardingGoals): {
  historyAvgWeeklyMi: number | null;
  historyLongestRecentMi: number | null;
} {
  return {
    historyAvgWeeklyMi: goals.historyAvg
      ? HIST_AVG_MIDPOINTS[goals.historyAvg]
      : null,
    historyLongestRecentMi: goals.historyLong
      ? HIST_LONG_MIDPOINTS[goals.historyLong]
      : null,
  };
}

/**
 * Build the 16-week volume curve.
 *
 * For a new runner whose start ≠ target: ramp ~10% per non-cutback week
 * until reaching targetMpw, then hold flat. Cutback every 3rd week at
 * 0.82× current level (Daniels §13 · cutback week doctrine). This
 * replaces the old flat-from-target approach that dropped brand-new
 * runners into their goal mileage on day 1.
 *
 * Cite: Daniels Running Formula §13 · Periodization + Research/00a
 * §Volume-Progression-Rules (≤10% per week).
 */
function buildProgressiveCurve(startMpw: number, targetMpw: number): {
  volumeMi: number[];
  isCutback: boolean[];
} {
  const volumeMi: number[] = [];
  const isCutback: boolean[] = [];
  let current = Math.min(startMpw, targetMpw);
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const cutback = (i + 1) % 3 === 0;
    if (cutback) {
      volumeMi.push(round1(current * 0.82));
      isCutback.push(true);
      // Resume from the pre-cutback level (cutback doesn't reset progress).
    } else {
      volumeMi.push(round1(current));
      isCutback.push(false);
      if (current < targetMpw) {
        current = Math.min(targetMpw, round1(current * 1.10));
      }
    }
  }
  return { volumeMi, isCutback };
}

type QualityKind = 'threshold' | 'intervals';
type DayKind = 'rest' | 'easy' | 'long' | QualityKind;

/** Quality type for the runner's GOAL distance. A runner with an active
 *  time goal needs the energy system that distance races on — so the
 *  quality session targets it instead of generic aerobic threshold:
 *    · 1mi / 5K → VO2max intervals (I-pace) · the primary stimulus that
 *      actually raises 5K speed (Daniels Running Formula §"5K-10K
 *      training": I-pace intervals are THE 5K driver).
 *    · 10K → threshold-dominant with alternating VO2 touches
 *      (Research/22 §quality-mix-by-distance · 10K is balanced).
 *    · no TT goal (pure consistency) → threshold · holding aerobic
 *      fitness with no speed goal is the correct maintenance shape.
 *
 *  Before this, the no-race seeder hardcoded `threshold` for everyone —
 *  so "get faster at a 5K" produced an aerobic hold plan with ZERO speed
 *  work. The goal was captured and then ignored. */
function goalQualityType(ttDistance: TTDistance | null, weekIdx: number): QualityKind {
  if (ttDistance === '1mi' || ttDistance === '5k') return 'intervals';
  if (ttDistance === '10k') return weekIdx % 2 === 1 ? 'intervals' : 'threshold';
  return 'threshold';
}

/** Day-of-week layout for one week.
 *
 *  Maintenance is 1 quality + 1 long + N easy days + rest. weeklyFrequency
 *  caps total running days: frequency - mandatory(long + quality) = easy
 *  slots; remaining days become rest. This is the fix for the original
 *  "intentionally ignored" note — ignoring frequency meant a 3-day runner
 *  got a 6-day plan. The quality day's TYPE is goal-driven (goalQualityType).
 */
function dayShape(
  layout: { longRunDow: number; qualityDows: number[]; restDow: number },
  weeklyFrequency: WeeklyFrequency | null,
  ttDistance: TTDistance | null,
  weekIdx: number,
): Array<{
  type: DayKind;
  isQuality: boolean;
  isLong: boolean;
}> {
  const qualityType = goalQualityType(ttDistance, weekIdx);
  const days = Array.from({ length: 7 }, () => ({
    type: 'easy' as DayKind,
    isQuality: false,
    isLong: false,
  }));
  days[layout.restDow] = { type: 'rest', isQuality: false, isLong: false };
  days[layout.longRunDow] = { type: 'long', isQuality: false, isLong: true };
  for (const d of layout.qualityDows) {
    if (d === layout.restDow || d === layout.longRunDow) continue;
    days[d] = { type: qualityType, isQuality: true, isLong: false };
  }
  // Respect weeklyFrequency: limit easy days, converting excess to rest.
  if (weeklyFrequency != null) {
    const mandatoryRunDays = 1  // long
      + layout.qualityDows.filter(d => d !== layout.restDow && d !== layout.longRunDow).length;
    const maxEasyDays = Math.max(0, weeklyFrequency - mandatoryRunDays);
    let easyCount = 0;
    for (let i = 0; i < 7; i++) {
      if (days[i].type === 'easy') {
        easyCount < maxEasyDays ? easyCount++ : (days[i] = { type: 'rest', isQuality: false, isLong: false });
      }
    }
  }
  return days;
}

/** Per-workout notes mirroring the canonical builder's maintenance
 *  tone (warm, direct, doctrine-grounded). */
function notesFor(type: string, isCutback: boolean): string {
  if (type === 'rest') {
    return 'Full rest. The adaptation happens when you\'re not moving. Let the work land.';
  }
  if (type === 'long') {
    if (isCutback) {
      return 'Cutback long run, shorter, easier, no workout within it. Let the body absorb the last block of work.';
    }
    return 'Long run at easy conversational pace. Duration builds durability; pace is irrelevant today.';
  }
  if (type === 'threshold') {
    return 'Threshold session, comfortably hard. 4–6 × 1K at T pace with 60s jog. The aerobic ceiling is the long-term project.';
  }
  if (type === 'intervals') {
    return 'VO2 intervals. 5 × 1000m at 5K effort, 2 min jog between. Short and hard, even splits. This is the top-end speed your goal is built on.';
  }
  if (isCutback) {
    return 'Cutback easy, shorter, slower, no agenda. Move blood through the legs and get out of the way of recovery.';
  }
  return 'Easy run. Conversational pace. If you can\'t hold a sentence, you\'re running someone else\'s workout.';
}

/** Drop a single weekly volume target across the day-of-week shape.
 *
 *  Canonical builder proportions:
 *    Long      → 26% of weekly
 *    Threshold → 18% (solo quality day)
 *    Easy      → remainder, split across active easy days
 *  Long ≤ 50% of weekly hard cap.
 */
function distributeVolume(
  weeklyMi: number,
  shape: ReturnType<typeof dayShape>,
  peakLongMi: number,
  peakWeeklyMi: number,
): number[] {
  // Long run scaled by current vs peak; capped at peakLongMi.
  let longMi = round1(
    Math.min(peakLongMi, peakLongMi * Math.min(1, weeklyMi / Math.max(1, peakWeeklyMi))),
  );
  // Hard cap: long ≤ 50% of weekly.
  longMi = Math.min(longMi, round1(weeklyMi * 0.50));

  // Threshold: 18% of weekly, min 3mi (was 4 — floor at 4 over-allocated
  // quality on low-volume weeks, leaving almost nothing for easy days).
  const numQ = shape.filter(d => d.isQuality).length;
  let threshMi = numQ > 0 ? Math.max(3, round1(weeklyMi * T_SOLO_PCT)) : 0;

  // Easy days budget = whatever's left.
  const usedMi = longMi + threshMi;
  const easyBudget = Math.max(0, weeklyMi - usedMi);
  const easySlotIdxs = shape
    .map((d, i) => (!d.isQuality && !d.isLong && d.type === 'easy' ? i : -1))
    .filter(i => i >= 0);
  const minEasy = 3;
  const activeEasy = easyBudget >= minEasy
    ? Math.min(easySlotIdxs.length, Math.max(1, Math.floor(easyBudget / minEasy)))
    : easySlotIdxs.length > 0 ? 1 : 0;
  // Cap individual easy runs at 12 mi so the single easy slot on a
  // 3-day/week plan doesn't absorb an unreasonable budget at high volume.
  const easyPerDay = activeEasy > 0 ? Math.min(12, round1(easyBudget / activeEasy)) : 0;

  const distances = new Array(7).fill(0);
  for (let i = 0; i < 7; i++) {
    const d = shape[i];
    if (d.type === 'rest') continue;
    if (d.isLong) { distances[i] = longMi; continue; }
    if (d.isQuality) { distances[i] = threshMi; continue; }
    const easyIdx = easySlotIdxs.indexOf(i);
    distances[i] = easyIdx < activeEasy ? easyPerDay : 0;
  }
  // Silence unused-LONG_PCT lint (kept for parity with canonical builder).
  void LONG_PCT;
  return distances;
}

// ─────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────

async function clearActivePlansFor(userId: string): Promise<void> {
  await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId],
  );
  // Plan mutation → invalidate memoized lookup.
  (await import('./lookup')).bustPlanLookupCache(userId);
}

async function persistMaintenancePlan(args: {
  userId: string;
  startMonday: string;
  goalISO: string;
  curve: { volumeMi: number[]; isCutback: boolean[] };
  layout: { longRunDow: number; qualityDows: number[]; restDow: number };
  weeklyFrequency: WeeklyFrequency | null;
  ttDistance: TTDistance | null;
  peakLongMi: number;
  peakWeeklyMi: number;
  authoredState: Record<string, unknown>;
}): Promise<string> {
  const planId = id('pln');

  // 2026-06-10 · plan_workouts now carries the `workout_spec_required`
  // CHECK (every running row needs a spec — only rest/cross/strength are
  // exempt). The seeder predates the constraint and inserted spec-less
  // rows, so EVERY no-race onboarding's plan seed failed. Anchor the
  // specs on the same cited cold-start heuristic the race generator
  // uses: conservative VDOT from reported weekly mileage → T pace.
  // No LTHR/maxHr exists for a brand-new runner, so HR caps stay null
  // (spec-builder never invents an HR number). 480 = 8:00/mi default
  // per tPaceFromGoal's documented contract.
  const provisionalVdot = conservativeVdotFromMileage(args.peakWeeklyMi);
  const tPaceSec = tPaceFromVdot(provisionalVdot) ?? 480;

  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'maintenance', NULL, $3, $4)`,
    [planId, args.userId, args.goalISO,
     JSON.stringify({ ...args.authoredState, provisionalVdot, tPaceSec })],
  );

  // Single phase across all 16 weeks. A TT-goal runner is on a BUILD
  // toward that distance (VO2/threshold targeted); a no-goal runner is
  // on an aerobic maintenance hold. The label reflects which.
  const phaseLabel = args.ttDistance
    ? `${args.ttDistance === '1mi' ? '1 MILE' : args.ttDistance.toUpperCase()} BUILD`
    : 'MAINTENANCE';
  const phaseRationale = args.ttDistance
    ? `Building toward your ${args.ttDistance === '1mi' ? '1-mile' : args.ttDistance.toUpperCase()} goal · 1 targeted quality session/week + aerobic base.`
    : 'No A-race, holding aerobic base with 1 quality session/week.';
  const phaseId = id('phs');
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      phaseId, planId, phaseLabel, 0, TOTAL_WEEKS - 1,
      phaseRationale,
      'Daniels Running Formula §13 · Periodization + §"5K-10K training"',
    ],
  );

  for (let wi = 0; wi < TOTAL_WEEKS; wi++) {
    const weekStartISO = addDays(args.startMonday, wi * 7);
    const weekId = id('wk');
    const isCutback = args.curve.isCutback[wi];
    await pool.query(
      `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id,
                                is_cutback, is_peak, is_race_week, rationale)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, FALSE, $7)`,
      [
        weekId, planId, wi, weekStartISO, phaseId, isCutback,
        isCutback
          ? 'Cutback week, volume drops ~18% so the last block of work can land.'
          : 'Maintenance week, aerobic base + 1 quality session.',
      ],
    );

    const shape = dayShape(args.layout, args.weeklyFrequency, args.ttDistance, wi);
    // Use this week's volume as both weeklyMi and peakWeeklyMi so the long
    // run is a fixed proportion of the week (not scaled down relative to a
    // far-off peak the runner hasn't reached yet).
    const thisWeekMi = args.curve.volumeMi[wi];
    const distances = distributeVolume(
      thisWeekMi, shape, args.peakLongMi, thisWeekMi,
    );

    for (let offset = 0; offset < 7; offset++) {
      const dateISO = addDays(weekStartISO, offset);
      const jsDow = new Date(dateISO + 'T12:00:00Z').getUTCDay();
      const pick = shape[jsDow];
      // Drop an easy day to rest when its budget got 0.
      const effectiveType =
        pick.type === 'easy' && distances[jsDow] === 0
          ? 'rest'
          : pick.type;
      const subLabel =
        effectiveType === 'long' && !isCutback ? null
        : effectiveType === 'long' && isCutback ? 'Long Run · Cutback'
        : effectiveType === 'threshold' ? 'Cruise Intervals'
        : effectiveType === 'intervals' ? '5 × 1000m @ I · 2 min jog'
        : null;
      const wkoId = id('wko');
      // Spec per row · rest returns {spec:null} which the CHECK exempts.
      const { spec, paceTargetSPerMi } = buildWorkoutSpec(
        effectiveType, distances[jsDow], tPaceSec, /* lthr */ null,
      );
      await pool.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    pace_target_s_per_mi, workout_spec,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $4, $6, $7)`,
        [
          wkoId, planId, weekId, dateISO, jsDow, effectiveType, distances[jsDow],
          paceTargetSPerMi, spec ? JSON.stringify(spec) : null,
          pick.isQuality, pick.isLong, notesFor(effectiveType, isCutback), subLabel,
        ],
      );
    }
  }
  return planId;
}

// ─────────────────────────────────────────────────────────────────
// Public entrypoint
// ─────────────────────────────────────────────────────────────────

/**
 * Author the runner's first maintenance plan from the onboarding goals.
 *
 * Order of operations:
 *   1. Translate chip values to numeric inputs.
 *   2. Pick a peak weekly mileage (weeklyMiTarget OR history floor OR 8).
 *   3. Pick a peak long (50% of historyLong OR 4).
 *   4. Build the 16-week flat maintenance curve (cutback every 3rd week).
 *   5. Archive any prior active plan, persist the new one.
 *
 *   Cold-start: nothing supplied → 8 mpw floor, 4 mi peak long.
 *
 *  Cite: Daniels Running Formula §13 · "Periodization" · maintenance.
 *  Cite: Research/00a · long-run anchored on recent / historical longest.
 */
export async function seedMaintenancePlanFromOnboarding(
  input: SeedInput,
): Promise<SeedResult> {
  const { userId, goals } = input;

  const { historyAvgWeeklyMi, historyLongestRecentMi } = midpoints(goals);

  // Start at the runner's CURRENT mileage, build toward their target.
  // Old logic used weeklyMiTarget as the starting point (flat from day 1 at
  // goal mileage), which is wrong for new runners who say "I run 10mi/week
  // but want to reach 25." They get a 25mi week on day 1.
  const startWeeklyMi = Math.max(
    MPW_FLOOR,
    historyAvgWeeklyMi != null && historyAvgWeeklyMi > 0 ? historyAvgWeeklyMi : MPW_FLOOR,
  );
  const targetWeeklyMi = Math.max(
    startWeeklyMi,
    goals.weeklyMiTarget != null && goals.weeklyMiTarget > 0 ? goals.weeklyMiTarget : startWeeklyMi,
  );

  // Peak long: 26% of the TARGET weekly (canonical long-run proportion)
  // OR the runner's historical longest, whichever is larger. This lets
  // the long run scale with the target rather than being perpetually
  // capped at the runner's current fitness, which would push all the
  // late-plan volume onto a single easy day.
  const histLongFloor = historyLongestRecentMi != null && historyLongestRecentMi > 0
    ? historyLongestRecentMi : 4;
  let peakLongMi = Math.max(histLongFloor, round1(targetWeeklyMi * LONG_PCT));
  peakLongMi = Math.min(peakLongMi, round1(targetWeeklyMi * 0.45));

  const layout = defaultLayout(goals.weeklyFrequency);
  const curve = buildProgressiveCurve(startWeeklyMi, targetWeeklyMi);

  const startMonday = mondayOf(await runnerToday(userId));
  // 16 weeks · last day = startMonday + 16*7 - 1.
  const goalISO = addDays(startMonday, TOTAL_WEEKS * 7 - 1);

  await clearActivePlansFor(userId);
  const planId = await persistMaintenancePlan({
    userId,
    startMonday,
    goalISO,
    curve,
    layout,
    weeklyFrequency: goals.weeklyFrequency,
    ttDistance: goals.ttDistance,
    peakLongMi,
    peakWeeklyMi: targetWeeklyMi,
    authoredState: {
      generated_at: new Date().toISOString(),
      seeder: 'onboarding-no-race',
      // A TT goal makes this a goal BUILD (VO2/threshold targeted at the
      // distance); without one it's an aerobic maintenance hold.
      intent: goals.ttDistance ? `${goals.ttDistance}-build` : 'consistency-maintenance',
      total_weeks: TOTAL_WEEKS,
      start_weekly_mi: startWeeklyMi,
      peak_weekly_mi: targetWeeklyMi,
      peak_long_mi: peakLongMi,
      onboarding_goals: goals,
      citations: [
        'Daniels Running Formula §13 · Periodization + §"5K-10K training" (I-pace intervals = 5K driver)',
        'Research/00a · long-run anchored on recent / historical longest + ≤10% progression rule',
        'Research/22 · quality mix by goal distance (5K VO2-dominant, 10K balanced, no-goal aerobic)',
      ],
    },
  });

  return {
    ok: true,
    plan_id: planId,
    weeks_generated: TOTAL_WEEKS,
    peak_mpw: targetWeeklyMi,
  };
}
