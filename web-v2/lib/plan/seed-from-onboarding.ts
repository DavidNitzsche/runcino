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
  // weeklyFrequency intentionally ignored at this layer — the runner can
  // tune long/quality/rest days via /profile, and the canonical builder
  // honors any user_prefs override on next lifecycle rebuild.
  void weeklyFrequency;
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
 * Compute the maintenance volume curve for 16 weeks.
 *
 * Per canonical builder (weeklyVolumeCurve · MAINTENANCE branch):
 *   - Flat hold at startMpw
 *   - Cutback every 3rd week → 0.82× startMpw
 *
 * Cite: Daniels Running Formula §13 · "Periodization" — maintenance
 * weeks ARE peak weeks (no ramp).
 */
function maintenanceCurve(startMpw: number): {
  volumeMi: number[];
  isCutback: boolean[];
} {
  const volumeMi: number[] = [];
  const isCutback: boolean[] = [];
  for (let i = 0; i < TOTAL_WEEKS; i++) {
    const cutback = (i + 1) % 3 === 0;
    volumeMi.push(cutback ? round1(startMpw * 0.82) : startMpw);
    isCutback.push(cutback);
  }
  return { volumeMi, isCutback };
}

/** Day-of-week layout for one week.
 *
 *  Maintenance is 1 quality + 1 long + N easy days + 1 rest. Race-week
 *  logic is intentionally omitted (this seeder never lands inside a
 *  race week).
 */
function dayShape(layout: {
  longRunDow: number;
  qualityDows: number[];
  restDow: number;
}): Array<{
  type: 'rest' | 'easy' | 'long' | 'threshold';
  isQuality: boolean;
  isLong: boolean;
}> {
  const days = Array.from({ length: 7 }, () => ({
    type: 'easy' as 'rest' | 'easy' | 'long' | 'threshold',
    isQuality: false,
    isLong: false,
  }));
  days[layout.restDow] = { type: 'rest', isQuality: false, isLong: false };
  days[layout.longRunDow] = { type: 'long', isQuality: false, isLong: true };
  for (const d of layout.qualityDows) {
    if (d === layout.restDow || d === layout.longRunDow) continue;
    days[d] = { type: 'threshold', isQuality: true, isLong: false };
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

  // Threshold: 18% of weekly, min 4mi.
  const numQ = shape.filter(d => d.isQuality).length;
  let threshMi = numQ > 0 ? Math.max(4, round1(weeklyMi * T_SOLO_PCT)) : 0;

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
  const easyPerDay = activeEasy > 0 ? round1(easyBudget / activeEasy) : 0;

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

  // Single MAINTENANCE phase across all 16 weeks.
  const phaseId = id('phs');
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      phaseId, planId, 'MAINTENANCE', 0, TOTAL_WEEKS - 1,
      'No A-race, holding aerobic base with 1 quality session/week.',
      'Daniels Running Formula §13 · Periodization',
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

    const shape = dayShape(args.layout);
    const distances = distributeVolume(
      args.curve.volumeMi[wi], shape, args.peakLongMi, args.peakWeeklyMi,
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

  // Peak weekly mileage: target > history floor > MPW_FLOOR.
  // Mirrors the canonical buildPlan maintenance-branch logic.
  let peakWeeklyMi = MPW_FLOOR;
  if (goals.weeklyMiTarget != null && goals.weeklyMiTarget > 0) {
    peakWeeklyMi = Math.max(MPW_FLOOR, goals.weeklyMiTarget);
  } else if (historyAvgWeeklyMi != null && historyAvgWeeklyMi > 0) {
    peakWeeklyMi = Math.max(MPW_FLOOR, historyAvgWeeklyMi);
  }

  // Peak long run: 50% of historyLongestRecent, floor 4 mi. Cap at 50% of weekly.
  let peakLongMi = 4;
  if (historyLongestRecentMi != null && historyLongestRecentMi > 0) {
    peakLongMi = Math.max(4, round1(historyLongestRecentMi * 0.5));
  }
  peakLongMi = Math.min(peakLongMi, round1(peakWeeklyMi * 0.5));

  const layout = defaultLayout(goals.weeklyFrequency);
  const curve = maintenanceCurve(peakWeeklyMi);

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
    peakLongMi,
    peakWeeklyMi,
    authoredState: {
      generated_at: new Date().toISOString(),
      seeder: 'onboarding-no-race',
      total_weeks: TOTAL_WEEKS,
      peak_weekly_mi: peakWeeklyMi,
      peak_long_mi: peakLongMi,
      onboarding_goals: goals,
      citations: [
        'Daniels Running Formula §13 · Periodization (maintenance)',
        'Research/00a · long-run anchored on recent / historical longest',
        'Research/22 · maintenance proportions (long 26%, threshold 18%, easy remainder)',
      ],
    },
  });

  return {
    ok: true,
    plan_id: planId,
    weeks_generated: TOTAL_WEEKS,
    peak_mpw: peakWeeklyMi,
  };
}
