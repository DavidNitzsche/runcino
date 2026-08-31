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
 * Maintenance weeks hold flat at the runner-stated target with a 0.82×
 * cutback every third week.
 *
 * DOCTRINE-BOOK-12 (2026-08-17) · was `Daniels Running Formula §13 ·
 * "Periodization"`, which the gate could not open. Both halves are in
 * Research/: the every-third-week cadence is the default row of Research/00b
 * §Frequency (bound by CUTBACK.cadence), and the flat maintenance hold is
 * Research/22 §7. The 0.82 DEPTH is a known live violation — an 18% cut
 * against doctrine's 20-30% floor — already recorded against CUTBACK.depth
 * with an `exempt` entry. It is left alone here on purpose: this pass fixes
 * citations, and moving a number to make one fit is the failure mode the
 * gate exists to prevent.
 *
 * Cite: Research/00b-recovery-protocols.md §Frequency ("3 weeks load → 1 week cutback")
 * Cite: Research/00b-recovery-protocols.md §"Depth of Cutback by Mileage Tier" (20-30%)
 * Cite: Research/22-plan-templates.md §"Maintenance Plan"
 * Cite: Research/00a §Volume-Progression-Rules — long-run floor  // was §"The 10% rule, reconsidered" · heading: ### Volume progression rules
 * is 50% of the recent longest training run (or historical longest
 * when no recent data exists).
 */

import { randomBytes } from 'crypto';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from './mutate';

/** Anything that can run a statement — the pool, or a boundary-owned transaction. */
type Queryable = { query: typeof pool.query };
import { runnerToday } from '@/lib/runtime/runner-tz';
import { buildWorkoutSpec, conservativeVdotFromMileage } from './spec-builder';
// LOWVOL-3 (2026-08-19) · the quality day is composed from doctrine's own caps,
// the same helper the race-prep composer uses, rather than a flat share.
import { maxQualityDayMi, type QualityFamily } from './quality-day';
import { atPaceSessionCapMi, INTERVAL_MIN_REPS } from '@/lib/prescription/levers';
import { CALIBRATION_INTRO_WEEKS } from './anchor-provenance';
import {
  tPaceFromVdot, iPaceFromVdot, bestRecentVdot, VDOT_FULL_VALUE_DAYS,
  vdotRunFloorMi, goalDistanceMiFromCode,
} from '@/lib/training/vdot';
import { loadVdotInputs } from '@/lib/training/vdot-inputs';
import {
  loadPrescribedWindows,
  normalTrainingDaySql,
  normalWindowParams,
  representativeDayCount,
  MIN_REPRESENTATIVE_DAYS,
} from '@/lib/training/normal-window';
import { loadSettings } from '@/lib/coach/settings';
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
  /** 2026-06-10 · explicit week-0 start date (YYYY-MM-DD) the runner
   *  picked at onboarding. Clamped to ≥ today. Defaults to today. */
  startDateISO?: string;
  /** 2026-06-15 · plan length in weeks the runner picked in SetGoalSheet
   *  (profile.tt_goal_plan_weeks). Clamped to a sane band. Defaults to
   *  TOTAL_WEEKS (16) for onboarding-seeded plans that don't pick one. */
  planWeeks?: number;
}

interface SeedResult {
  ok: boolean;
  plan_id?: string;
  weeks_generated?: number;
  peak_mpw?: number;
  reason?: string;
}

const TOTAL_WEEKS = 16;        // Maintenance window per canonical builder.
// CALIBRATION_INTRO_WEEKS moved to ./anchor-provenance (2026-08-17 · COLD-4)
// when the race-prep path adopted the same intro. One number, two seeders.
/**
 * LOWVOL-3 (2026-08-19) · a DEFAULT for a runner who reported nothing, not a
 * FLOOR over one who reported something.
 *
 * This was `Math.max(MPW_FLOOR, historyAvg)` — "below 8 mpw, no plan helps" —
 * so a runner who said they run five miles a week was authored eight in week
 * one, a sixty per cent jump on a base they had just stated, before the ramp
 * even started. `Research/00a` §"Volume progression rules" caps a novice's
 * growth at +20-25% over EIGHT weeks; nothing in doctrine licenses 60% in one.
 * The number itself is uncited and stays a CONVENTION — it is what the seeder
 * assumes when the runner told us nothing at all and there is no history to
 * read, and in that case it is a guess either way.
 */
const MPW_DEFAULT = 8;
/** Long run % of weekly · inside Research/00a §"Volume progression rules"
 *  "Long-run cap | ≤25-30% of weekly volume". */
const LONG_PCT    = 0.26;

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

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const dowOf = (k: string): number => Math.max(0, DAY_KEYS.indexOf(k as typeof DAY_KEYS[number]));

/**
 * Day-of-week layout from the runner's SAVED preferences (long-run day, rest
 * day, quality days). The no-race seeder used to HARDCODE Sat-long / Mon-rest /
 * Tue-quality and ignore the runner's picks entirely — so a runner who chose
 * "Friday long, Saturday rest" got Saturday long + Monday rest (Justin's bug).
 * This mirrors the race generator (generate.ts), which has always honored these
 * via loadSettings. loadSettings supplies sane defaults (sun-long / sat-rest /
 * tue+thu-quality) when the runner left them unset.
 *
 * Maintenance is 1 quality/wk by canonical doctrine (Daniels §13) — take the
 * runner's first quality pick, spaced off the long + rest days. dayShape()
 * applies the weeklyFrequency cap on top.
 */
export function layoutFromPrefs(prefs: {
  long_run_day: string; rest_day: string; quality_days: string[];
}): { longRunDow: number; qualityDows: number[]; restDow: number } {
  const longRunDow = dowOf(prefs.long_run_day);
  const restDow = dowOf(prefs.rest_day);
  let qualityDows = (prefs.quality_days?.length ? prefs.quality_days : ['tue'])
    .map(dowOf)
    .filter((d) => d !== longRunDow && d !== restDow)
    .slice(0, 1);
  if (qualityDows.length === 0) {
    // Every quality pick collided with long/rest — fall back to a day spaced
    // from both (prefer mid-week).
    const c = [2, 3, 4, 1, 5, 0, 6].find((d) => d !== longRunDow && d !== restDow);
    qualityDows = [c ?? 2];
  }
  return { longRunDow, qualityDows, restDow };
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
 * Cite: Research/00b-recovery-protocols.md §Frequency — "3 weeks load → 1 week
 * cutback" is the default row; bound by CUTBACK.cadence.
 * Cite: Research/00a-distance-running-training.md §Volume-Progression-Rules (≤10% per week).
 */
function buildProgressiveCurve(startMpw: number, targetMpw: number, totalWeeks: number = TOTAL_WEEKS): {
  volumeMi: number[];
  isCutback: boolean[];
} {
  const volumeMi: number[] = [];
  const isCutback: boolean[] = [];
  let current = Math.min(startMpw, targetMpw);
  for (let i = 0; i < totalWeeks; i++) {
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
export function goalQualityType(
  ttDistance: TTDistance | null,
  weekIdx: number,
  calibrating = false,
  /**
   * LOWVOL-3 (2026-08-19) · the week's own volume. A VO2max session is a REP
   * SET — `Research/04` §6.1 gives every §6 workout a rep-count band and the
   * smallest lower bound in the column is `INTERVAL_MIN_REPS`, and the document
   * describes no continuous form of one. A week whose I allowance (Daniels'
   * 8%, via `atPaceSessionCapMi`) cannot fund that many reps has no §6 session
   * available to it, so it runs the threshold form instead — which does have a
   * legitimate small shape, §5.3's cruise intervals down to a single mile.
   * Omit and the historical behaviour stands.
   */
  weeklyMi?: number | null,
): QualityKind {
  // Calibration intro (cold start, no measured fitness): a gentle, effort-cued
  // threshold — which surfaces a clean VDOT read via the zone-aware path — in
  // place of max-VO2 intervals at a fabricated pace. The daily re-anchor swaps
  // in the real I-pace intervals the moment that read lands. Same threshold a
  // no-goal consistency runner already gets in week 0, so it's not novel load.
  if (calibrating && weekIdx < CALIBRATION_INTRO_WEEKS) return 'threshold';
  const wantsIntervals = ttDistance === '1mi' || ttDistance === '5k'
    || (ttDistance === '10k' && weekIdx % 2 === 1);
  if (!wantsIntervals) return 'threshold';
  if (weeklyMi != null && weeklyMi > 0 && !weekAffordsIntervalSet(weeklyMi)) return 'threshold';
  return 'intervals';
}

/** 1000 m, the rep this seeder's VO2 session has always been written at. */
const SEED_INTERVAL_REP_MI = 0.62;

/** True when the week's I allowance funds doctrine's minimum §6 rep set. */
function weekAffordsIntervalSet(weeklyMi: number): boolean {
  return Math.floor(atPaceSessionCapMi(weeklyMi, 'interval') / SEED_INTERVAL_REP_MI) >= INTERVAL_MIN_REPS;
}

/**
 * LOWVOL-3 · the rep count the week can actually pay for, and the label that
 * declares it.
 *
 * The seeder used to write `'5 × 1000m @ I · 2 min jog'` and
 * `'Cruise Intervals'` as fixed strings. `buildWorkoutSpec` PARSES the label,
 * so the first one prescribed 3.1 miles at I-pace on every week regardless of
 * size — 31% of a 10 mi/wk week against Daniels' 8% — and the second parsed to
 * nothing and fell through to the builder's own 4×1 mi default. Deriving the
 * count from `atPaceSessionCapMi` and stating it in the label is the same
 * repair `DOCTRINE-DOSING-2` made to the maintenance threshold in generate.ts:
 * the number the runner reads, the number the watch runs, and the number the
 * dosing gate checks all become one expression.
 */
function qualitySubLabel(kind: QualityKind, weeklyMi: number): string {
  if (kind === 'intervals') {
    const reps = Math.max(
      INTERVAL_MIN_REPS,
      Math.min(8, Math.floor(atPaceSessionCapMi(weeklyMi, 'interval') / SEED_INTERVAL_REP_MI)),
    );
    return `${reps} × 1000m @ I · 2 min jog`;
  }
  // §5.3 cruise intervals · "3-6 × 1 mi with 1 min jog", floored at one real
  // mile so a small week gets a true single mile at T rather than a fiction.
  const reps = Math.max(1, Math.min(6, Math.floor(atPaceSessionCapMi(weeklyMi, 'threshold'))));
  return `${reps}×1mi @ T pace · 60s jog`;
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
  calibrating = false,
  weeklyMi?: number | null,
): Array<{
  type: DayKind;
  isQuality: boolean;
  isLong: boolean;
}> {
  const qualityType = goalQualityType(ttDistance, weekIdx, calibrating, weeklyMi);
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
    // LOWVOL-3 · the rep count lives on the label, derived from the week's own
    // threshold allowance. Restating it here made the prose a third copy of a
    // number the other two derive.
    return 'Threshold session, comfortably hard. Cruise intervals at T pace with a short jog between. The aerobic ceiling is the long-term project.';
  }
  if (type === 'intervals') {
    return 'VO2 intervals at 5K effort with a jog between. Short and hard, even splits from the first rep. This is the top-end speed your goal is built on.';
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

  // ── LOWVOL-3 (2026-08-19) · THE QUALITY DAY IS DOSED, NOT A FLAT SHARE ────
  //
  // This was `Math.max(3, round1(weeklyMi * T_SOLO_PCT))` with T_SOLO_PCT =
  // 0.18, and the absolute floor overrode the percentage at exactly the volumes
  // the percentage was protecting. On a 10 mi/wk week it authored a 3-mile
  // threshold day — thirty per cent of the week — against `Research/01`'s
  // ten. The floor/cap collision is the same shape `SP-6` fixed for the
  // maintenance long and `DOCTRINE-DOSING-2` fixed for the race-prep tempo; it
  // survived here because this seeder sizes its own days.
  //
  // T_SOLO_PCT itself was uncited. It is gone: the day is now composed by
  // `composeQualityDay` off the family's own at-pace cap — Daniels' share of
  // the week (T ≤10%, I ≤8%) and `Research/04` §5.1/§6.1's session band,
  // whichever binds first — plus §5.3's warm-up and cool-down, which are EASY
  // miles and were never the hard budget's to spend. Capped at the long run so
  // the week keeps long-primacy.
  const numQ = shape.filter(d => d.isQuality).length;
  const qualityFamily: QualityFamily =
    shape.some((d) => d.isQuality && d.type === 'intervals') ? 'interval' : 'threshold';
  let threshMi = numQ > 0
    ? maxQualityDayMi({
        family: qualityFamily,
        weeklyMi,
        paceSPerMi: null,
        ceilingMi: longMi > 0 ? longMi : null,
      })
    : 0;

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
  return distances;
}

// ─────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────

async function clearActivePlansFor(userId: string, tx: Queryable = pool): Promise<void> {
  await tx.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE user_uuid = $1 AND archived_iso IS NULL`,
    [userId],
  );
  // See generate.ts:clearActivePlansFor — a still-pending proposal against
  // whatever just got archived here is stale the moment this commits.
  const { supersedeProposalsForArchivedPlans } = await import('./proposals-state');
  await supersedeProposalsForArchivedPlans(tx, userId);
  // Plan mutation → invalidate memoized lookup.
  (await import('./lookup')).bustPlanLookupCache(userId);
}

async function persistMaintenancePlan(args: {
  /** Transaction the plan mutation boundary owns. Every write below runs on
   *  it, so the whole seed lands atomically or not at all. */
  tx: Queryable;
  userId: string;
  startMonday: string;
  goalISO: string;
  curve: { volumeMi: number[]; isCutback: boolean[] };
  layout: { longRunDow: number; qualityDows: number[]; restDow: number };
  weeklyFrequency: WeeklyFrequency | null;
  ttDistance: TTDistance | null;
  totalWeeks: number;
  peakLongMi: number;
  peakWeeklyMi: number;
  /** 2026-08-17 · COLD-2 · the runner's CURRENT weekly base (self-reported
   *  history, or derived from their runs) — NOT the target they are ramping
   *  toward. Anchors the provisional pace estimate when no measured VDOT
   *  exists. */
  currentWeeklyMi: number;
  /** 2026-06-15 · measured current-fitness VDOT from the runner's recent runs
   *  (goal-relative floor). Null when nothing qualified → fall back to the
   *  conservative mileage estimate. Anchors pace specs, not volume. */
  anchorVdot: number | null;
  /** 2026-06-15 · cold start (no measured VDOT). Eases the first
   *  CALIBRATION_INTRO_WEEKS in with effort-cued threshold instead of
   *  fabricated-pace VO2 intervals; the daily re-anchor commits the real
   *  build once a read lands. */
  calibrating: boolean;
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
  // Anchor paces on MEASURED current fitness when the runner's recent runs
  // gave us one (args.anchorVdot, goal-relative floor applied upstream); only
  // fall back to the conservative mileage estimate when nothing qualified.
  // Per CLAUDE.md "Engine must match research": VDOT comes from a measured
  // effort (Research/01 §field-test), not fabricated from weekly mileage —
  // the mileage estimate is a last-resort provisional, flagged as such.
  // 2026-08-17 · COLD-2 · the provisional estimate reads the runner's CURRENT
  // base, not `peakWeeklyMi` — which is the aspiration they are ramping toward
  // (`goals.weeklyMiTarget`). Anchoring on the target handed a runner who said
  // "I run 10 mi/wk, I want to reach 45" a VDOT-47 pace set on day one, roughly
  // 2:30/mi of threshold ahead of anything they have run. The ramp destination
  // is a volume plan; it is not evidence of fitness.
  const anchorVdot = args.anchorVdot ?? conservativeVdotFromMileage(args.currentWeeklyMi);
  const anchorSource = args.anchorVdot != null ? 'measured_run' : 'provisional_mileage';
  const tPaceSec = tPaceFromVdot(anchorVdot) ?? 480;
  // True Daniels I-pace for a goal BUILD (5K/10K quality = VO2 intervals).
  // Scales with fitness, unlike spec-builder's T−18 cruise default. Null for
  // no-goal maintenance (quality there is threshold, never intervals).
  const iPaceSec = args.ttDistance ? iPaceFromVdot(anchorVdot) : null;

  await args.tx.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, race_id, goal_iso, authored_state)
     VALUES ($1, 'me', $2, 'maintenance', NULL, $3, $4)`,
    [planId, args.userId, args.goalISO,
     JSON.stringify({
       ...args.authoredState,
       anchorVdot, anchorSource,
       provisionalVdot: anchorVdot,  // back-compat key (now measured when available)
       tPaceSec, iPaceSec,
       calibrating: args.calibrating,
     })],
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
  await args.tx.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      phaseId, planId, phaseLabel, 0, args.totalWeeks - 1,
      phaseRationale,
      'Daniels Running Formula §13 · Periodization + §"5K-10K training"',
    ],
  );

  for (let wi = 0; wi < args.totalWeeks; wi++) {
    const weekStartISO = addDays(args.startMonday, wi * 7);
    const weekId = id('wk');
    const isCutback = args.curve.isCutback[wi];
    await args.tx.query(
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

    // Use this week's volume as both weeklyMi and peakWeeklyMi so the long
    // run is a fixed proportion of the week (not scaled down relative to a
    // far-off peak the runner hasn't reached yet).
    const thisWeekMi = args.curve.volumeMi[wi];
    const shape = dayShape(args.layout, args.weeklyFrequency, args.ttDistance, wi, args.calibrating, thisWeekMi);
    const distances = distributeVolume(
      thisWeekMi, shape, args.peakLongMi, thisWeekMi,
    );

    // 2026-06-10 · "get them running on day one." Onboarding anchors week
    // 0 at today; if the join day lands on a rest day, relocate an easy
    // run onto it (stolen from the easy day furthest out) so a fresh,
    // eager runner isn't met with rest days before their first run. The
    // long + quality days and the weekly count are untouched.
    if (wi === 0) {
      const anchorDow = new Date(args.startMonday + 'T12:00:00Z').getUTCDay();
      if (distances[anchorDow] === 0) {
        const easyDows = [0, 1, 2, 3, 4, 5, 6].filter((dw) => shape[dw].type === 'easy' && distances[dw] > 0);
        if (easyDows.length) {
          const off = (dw: number) => (dw - anchorDow + 7) % 7;
          const donor = easyDows.reduce((a, b) => (off(b) > off(a) ? b : a));
          distances[anchorDow] = distances[donor];
          shape[anchorDow] = { type: 'easy', isQuality: false, isLong: false };
          distances[donor] = 0;
          shape[donor] = { type: 'rest', isQuality: false, isLong: false };
        }
      }
    }

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
        // LOWVOL-3 · derived from the week's own at-pace allowance, and READ
        // BACK by buildWorkoutSpec below. See `qualitySubLabel`.
        : effectiveType === 'threshold' || effectiveType === 'intervals'
          ? qualitySubLabel(effectiveType, thisWeekMi)
        : null;
      const wkoId = id('wko');
      // Spec per row · rest returns {spec:null} which the CHECK exempts.
      // LOWVOL-3 · the label is the PRESCRIPTION, and is parsed as one. It was
      // passed as `undefined`, so the rep counts the label advertised and the
      // rep counts the spec built were two independent numbers that happened to
      // agree only while both were hard-coded. Now the dosed count in the label
      // is the count the spec carries and the watch runs.
      const { spec, paceTargetSPerMi } = buildWorkoutSpec(
        effectiveType, distances[jsDow], tPaceSec, /* lthr */ null,
        /* prescription */ subLabel, /* maxHr */ null, /* goalPaceSPerMi */ null,
        /* iPaceSec */ iPaceSec,
      );
      await args.tx.query(
        `INSERT INTO plan_workouts (id, plan_id, week_id, date_iso, dow, type, distance_mi,
                                    pace_target_s_per_mi, workout_spec,
                                    is_quality, is_long, notes, sub_label,
                                    original_date_iso, original_type, original_distance_mi, user_uuid)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $4, $6, $7, $14)`,
        [
          wkoId, planId, weekId, dateISO, jsDow, effectiveType, distances[jsDow],
          paceTargetSPerMi, spec ? JSON.stringify(spec) : null,
          pick.isQuality, pick.isLong, notesFor(effectiveType, isCutback), subLabel,
          args.userId,
        ],
      );
    }
  }
  return planId;
}

/**
 * Cold-start fallback when the runner skipped self-reported history: derive
 * recent weekly mileage + longest run from their ACTUAL runs (last 8 weeks).
 * Same connected-data principle as the VDOT floor — use what we have instead of
 * dropping to the bare MPW floor. Null only when there's genuinely no run data.
 */
async function deriveRunHistory(
  userId: string,
  cutoffISO: string,
  todayISO: string,
): Promise<{
  avgWeeklyMi: number | null;
  longestMi: number | null;
}> {
  // RULE 8 (2026-08-30) · both numbers this returns are habit claims that go
  // straight into the first plan — `avgWeeklyMi` sets the start of the volume
  // ramp and `longestMi` sets the long-run floor. Rule 8's table names both
  // failures by name: a block opened at 31 mi/wk off a 43.5 mi/wk runner, and
  // a long-run ramp anchored to a 13.5 mi taper long instead of his 18.0.
  //
  // The divisor moves with the exclusion. It was a hardcoded `/ 8.0` — the
  // nominal eight weeks — which is the shape clause 1 of the rule forbids:
  // dropping the taper days from the numerator while leaving them in the
  // denominator reports the taper as a collapse rather than as absent.
  //
  // Not swallowed to "no windows". A failed read would put this straight back
  // on the contaminated window, which is the whole defect; the caller already
  // handles a null history by falling to the self-report chips and then the
  // MPW floor, which is the honest answer when we cannot say.
  const nonNormal = await loadPrescribedWindows(userId, todayISO);
  const representativeDays = representativeDayCount(cutoffISO, todayISO, nonNormal);
  if (representativeDays < MIN_REPRESENTATIVE_DAYS) return { avgWeeklyMi: null, longestMi: null };
  const { lo, hi } = normalWindowParams(nonNormal);
  const r = (await pool.query<{ total: string | null; longest: string | null }>(
    `SELECT ROUND(SUM((data->>'distanceMi')::numeric), 1) AS total,
            ROUND(MAX((data->>'distanceMi')::numeric), 1) AS longest
       FROM runs
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
        AND ${normalTrainingDaySql(
          `COALESCE(data->>'date', LEFT(data->>'startLocal',10))`, 3, 4,
        )}`,
    [userId, cutoffISO, lo, hi],
  ).catch(() => ({ rows: [] as Array<{ total: string | null; longest: string | null }> }))).rows[0];
  const total = r?.total != null ? Number(r.total) : null;
  const avgWeeklyMi = total != null && total > 0
    ? Math.round((total / (representativeDays / 7)) * 10) / 10
    : null;
  return {
    avgWeeklyMi,
    longestMi: r?.longest != null && Number(r.longest) > 0 ? Number(r.longest) : null,
  };
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
 *  Cite: Research/22-plan-templates.md §"Maintenance Plan" · holding fitness
 *  between cycles, flat rather than progressive (DOCTRINE-BOOK-13, 2026-08-17 ·
 *  was `Daniels §13 "Periodization"`, unopenable by the gate).
 *  Cite: Research/00a · long-run anchored on recent / historical longest.
 */
export async function seedMaintenancePlanFromOnboarding(
  input: SeedInput,
): Promise<SeedResult> {
  const { userId, goals } = input;
  const today = await runnerToday(userId);

  // History anchors the START of the volume ramp + the long-run floor. Prefer
  // the runner's self-reported chips; when they skipped them, DERIVE from their
  // actual runs (last 8 weeks) rather than dropping to the bare MPW floor —
  // same connected-data principle as the VDOT read.
  const sr = midpoints(goals);
  const derived = await deriveRunHistory(userId, addDays(today, -56), today);
  const historyAvgWeeklyMi = sr.historyAvgWeeklyMi ?? derived.avgWeeklyMi;
  const historyLongestRecentMi = sr.historyLongestRecentMi ?? derived.longestMi;
  const historySource = sr.historyAvgWeeklyMi != null ? 'self_report'
    : derived.avgWeeklyMi != null ? 'derived_runs' : 'none';

  // Start at the runner's CURRENT mileage, build toward their target.
  // Old logic used weeklyMiTarget as the starting point (flat from day 1 at
  // goal mileage), which is wrong for new runners who say "I run 10mi/week
  // but want to reach 25." They get a 25mi week on day 1.
  // LOWVOL-3 · a stated base is the base. The default only fills silence.
  const startWeeklyMi = historyAvgWeeklyMi != null && historyAvgWeeklyMi > 0
    ? historyAvgWeeklyMi
    : MPW_DEFAULT;
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

  // Honor the runner's chosen long-run / rest / quality days (loadSettings
  // defaults them when unset) — same as the race generator. Was hardcoded.
  const prefs = await loadSettings(userId);
  const layout = layoutFromPrefs(prefs);
  // Plan length: the runner's SetGoalSheet pick (input.planWeeks), clamped to a
  // sane band; else the default 16-week window.
  const totalWeeks = input.planWeeks && input.planWeeks >= 4 && input.planWeeks <= 52
    ? Math.round(input.planWeeks) : TOTAL_WEEKS;
  const curve = buildProgressiveCurve(startWeeklyMi, targetWeeklyMi, totalWeeks);

  // 2026-06-10 · anchor week 0 at the runner's chosen start day
  // (startDateISO, clamped to ≥ today), else today. Not the Monday before
  // — a mid-week onboarder shouldn't see runs dated before they existed
  // (David). The persist loop places workouts by each date's calendar
  // weekday, so the long run still lands on the preferred day; the first
  // week is just a full 7 days from the start day. (today resolved at the top.)
  const startMonday = (input.startDateISO && input.startDateISO >= today) ? input.startDateISO : today;
  // last day = start + totalWeeks*7 - 1.
  const goalISO = addDays(startMonday, totalWeeks * 7 - 1);

  // 2026-06-15 · root the plan in REAL fitness when the data exists. HealthKit
  // / Strava history is usually already synced by the time onboarding
  // completes (a watch runner has months of runs). Read it through the
  // canonical VDOT loader with a GOAL-RELATIVE floor — a 5K-goal runner's
  // ~3.1mi quality efforts qualify (vdotRunFloorMi → 3.0) where the flat 4mi
  // floor used to reject every one of them, leaving the plan anchored on a
  // VDOT fabricated from weekly mileage. Best-effort: a read failure (or no
  // qualifying run) falls back to the conservative estimate inside persist —
  // it never blocks onboarding. Once the floor is fixed, the daily projection
  // cron also starts computing this runner's VDOT, so live paces self-heal.
  // Cite: Research/01 §field-test (a solo 5K IS a VDOT input) · CLAUDE.md
  // "Engine must match research".
  let anchorVdot: number | null = null;
  try {
    const runFloorMi = vdotRunFloorMi(goalDistanceMiFromCode(goals.ttDistance));
    const { raceCandidates, runCandidates } = await loadVdotInputs(userId, today);
    const { best } = bestRecentVdot(raceCandidates, today, VDOT_FULL_VALUE_DAYS, runCandidates, runFloorMi);
    anchorVdot = best?.vdot ?? null;
  } catch {
    anchorVdot = null;
  }

  // Routed through the plan mutation boundary (lib/plan/mutate.ts) as an
  // 'authorship' mutation. This is the onboarding seeder: it creates the
  // runner's first plan, so there is no before-state to diff. The boundary
  // reads the PERSISTED plan back and validates it, report-only — refusing a
  // first plan would leave a brand-new signup with nothing at all.
  //
  // It also gives archive + create + every insert a single transaction; they
  // were unbatched `pool.query` calls before.
  const seedBoundary = await mutatePlan<string>({
    userUuid: userId,
    source: 'seed-from-onboarding',
    todayISO: today,
    touches: 'authorship',
    planIdFromResult: (v) => v,
    detail: { total_weeks: totalWeeks, tt_distance: goals.ttDistance ?? null },
    apply: async (tx) => {
  await clearActivePlansFor(userId, tx);
  const planId = await persistMaintenancePlan({
    tx,
    userId,
    startMonday,
    goalISO,
    curve,
    layout,
    weeklyFrequency: goals.weeklyFrequency,
    ttDistance: goals.ttDistance,
    totalWeeks,
    peakLongMi,
    peakWeeklyMi: targetWeeklyMi,
    currentWeeklyMi: startWeeklyMi, // COLD-2 · pace anchors on the base, not the target
    anchorVdot,
    // Cold start (no measured read) → calibration intro; the daily re-anchor
    // commits the real build once the runner's first honest effort reads.
    calibrating: anchorVdot == null,
    authoredState: {
      generated_at: new Date().toISOString(),
      seeder: 'onboarding-no-race',
      // A TT goal makes this a goal BUILD (VO2/threshold targeted at the
      // distance); without one it's an aerobic maintenance hold.
      intent: goals.ttDistance ? `${goals.ttDistance}-build` : 'consistency-maintenance',
      total_weeks: totalWeeks,
      start_weekly_mi: startWeeklyMi,
      peak_weekly_mi: targetWeeklyMi,
      peak_long_mi: peakLongMi,
      history_source: historySource,  // self_report | derived_runs | none
      onboarding_goals: goals,
      citations: [
        'Daniels Running Formula §13 · Periodization + §"5K-10K training" (I-pace intervals = 5K driver)',
        'Research/00a · long-run anchored on recent / historical longest + ≤10% progression rule',
        'Research/22 · quality mix by goal distance (5K VO2-dominant, 10K balanced, no-goal aerobic)',
      ],
    },
  });
      return planId;
    },
  });
  if (!seedBoundary.ok || !seedBoundary.planId) {
    return { ok: false, reason: 'onboarding seed refused by the plan mutation boundary' };
  }

  return {
    ok: true,
    plan_id: seedBoundary.planId,
    weeks_generated: totalWeeks,
    peak_mpw: targetWeeklyMi,
  };
}
