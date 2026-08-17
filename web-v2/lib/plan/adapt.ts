/**
 * P38 — plan adaptation triggers.
 *
 * Sits next to the v1 algorithmic plan generator (`./generate.ts`).
 * Doesn't replace it; adds a feedback layer that rewrites the next
 * N days when reality diverges from the plan.
 *
 * Detection triggers (all cite Research):
 *
 *   0. TRAINING_GAP (2026-07-06 · phone+watch audit P1-36) — unplanned
 *      layoff detected from days since the last canonical run. Owns the
 *      comeback response and SUPPRESSES missed-workout rescheduling
 *      while active (doctrine: resume the schedule, never cram).
 *      · 4-7 days off  → substitute first upcoming quality with easy
 *      · 8-14 days off → re-entry week at 70% volume, week 2 at 85%,
 *        intensity dropped for the first week
 *      · >14 days off  → propose-only: plan rebuild + VDOT haircut
 *      Cite: Research/22-plan-templates.md §14 Comeback Plans (628-651)
 *      Cite: Research/01-pace-zones-vdot.md:319-320 (layoff VDOT drop)
 *
 *   1. MISSED_KEY_WORKOUT — planned quality (threshold/tempo/intervals/
 *      vo2max) not completed within ±1d, completion measured against
 *      the PRESCRIBED distance (≥60%), not a flat 4mi. Reschedule only
 *      into a verified-clear day within today+1..today+4 (no collision,
 *      no rest day, no long-run day, respects weekly_frequency, never
 *      race week / within 3d of a race); missed work older than 3 days
 *      or with no clear slot is DROPPED with a coach_intents record —
 *      it becomes data, not debt. Missed LONG runs are recorded as data
 *      only, never rescheduled.
 *      Cite: Research/00a-distance-running-training.md §missed-workout-policy  // TODO: no matching heading — content exists but heading not anchored
 *      Cite: Research/22-plan-templates.md §14 (resume schedule; a 70%
 *      volume week still banks the stimulus → ≥60% of a prescription
 *      counts as done, not missed)
 *
 *   2. RHR_SPIKE — 3-day avg RHR > 7 bpm above 14-day baseline.
 *      → Convert next quality day to easy; flag readiness.
 *      Cite: Research/15-wearable-data.md §RHR  // was §RHR-Recovery-Indicators · heading: ## Resting Heart Rate (RHR)
 *
 *   3. SLEEP_CRATER — 2+ nights < 5h.
 *      → Convert next quality day to easy.
 *      Cite: Research/00b-recovery-protocols.md §Sleep  // was §sleep-as-recovery · heading: ### Sleep — The Highest-ROI Recovery Tool
 *
 *   4. VOLUME_OVERSHOOT — last 7d completed volume > 25% above what the
 *      ACTIVE PLAN scheduled for the same trailing window (2026-07-06 ·
 *      P1-55: the old static experience cap contradicted the generator's
 *      own tier bands and shaved compliant runners daily; the plan's own
 *      prescription is the baseline now, the experience cap is only the
 *      no-schedule fallback). One shave per rolling 7 days (cooldown).
 *      → Shave next 7d by 17% (proportional).
 *      Cite: Research/00a-distance-running-training.md §Volume-Progression-Rules  // was §progressive-overload · heading: ### Volume progression rules
 *
 *   5. PR_BANK — recent race finish that implies VDOT jump > 1.5 pts.
 *      → Recompute paces; mark plan_workouts as needing prescription refresh.
 *      Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces  // was §VDOT-recalibrate · heading: ## How to recalibrate paces
 *
 * Output: array of `AdaptationAction`s, each tagged with its source
 * trigger kind (2026-07-06 · P1-37: the cron used to pair actions[i]
 * with triggers[i], but triggers emit 0..2 actions each, so the index
 * walk misrouted anti-stacking downgrades into mislabeled readiness
 * proposals). The caller applies them in a single DB transaction, then
 * bumps the plan's `last_adapted_at` so the coach can see when the
 * plan changed.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore, mileageByDay } from '@/lib/runs/volume';
import type { ExperienceLevel } from '@/lib/coach/profile-state';
import { logSealSkip } from './seal';
import { stripResearchCitations } from './strip-citations';

/**
 * 2026-06-03 · Rule 15 · seal guard for adapter writes.
 *
 * Given a list of plan_workouts IDs, returns the subset whose dates
 * are NOT sealed (no completed run for that date). Sealed IDs are
 * filtered out with a [plan/seal] log line.
 *
 * Used by every UPDATE path in applyAdaptations so the adapter can't
 * retroactively change what the runner was prescribed for a day they
 * already ran. Cite: designs/briefs/backend-rule-completed-days-immutable-2026-06-02.md
 */
async function filterUnsealedWorkouts(
  client: { query: typeof pool.query },
  userUuid: string,
  workoutIds: string[],
  source: string,
): Promise<string[]> {
  if (workoutIds.length === 0) return [];
  // Join workouts to runs by date · row is sealed if a non-merged
  // run row exists for the same date.
  const r = await client.query<{ id: string; sealed: boolean; date_iso: string }>(
    `SELECT pw.id::text AS id, pw.date_iso::text,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $1::uuid
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                 AND NOT (r.data ? 'mergedIntoId')
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.id = ANY($2::text[])`,
    [userUuid, workoutIds],
  ).catch(() => ({ rows: [] as Array<{ id: string; sealed: boolean; date_iso: string }> }));
  const unsealed: string[] = [];
  for (const row of r.rows) {
    if (row.sealed) {
      logSealSkip(source, userUuid, row.date_iso);
    } else {
      unsealed.push(row.id);
    }
  }
  return unsealed;
}

export type AdaptationTriggerKind =
  | 'missed_key_workout'
  | 'rhr_spike'           // retained for back-compat · NOT fired anymore (see readiness_pullback)
  | 'sleep_crater'        // retained for back-compat · NOT fired anymore (see readiness_pullback)
  | 'readiness_pullback'  // 2026-06-01 · multi-signal · supersedes the two above
  | 'volume_overshoot'
  | 'pr_bank'
  | 'niggle_reported'     // Q-04 · active niggle severity threshold
  | 'sick_episode_active' // Q-03 · active illness · propose, never auto
  | 'injury_active'       // Q-08 · active runner_injuries row · propose
  | 'goal_changed'        // runner edited goal time → mark paces stale
  | 'training_gap'        // 2026-07-06 · unplanned layoff · Research/22 §14
  | 'field_test_due'      // 2026-08-17 · no race/test in 42d · Research/01:684-686
  | 'fitness_regression'; // 2026-08-17 · symmetric DOWNWARD re-anchor ·
                          // race result or 28d sustained evidence shows
                          // VDOT < last-reviewed − 1.5 → recompute paces
                          // (auto for race-sourced, propose-first for
                          // training-drift). Cite: Research/01:316-320
                          // ("tempo unexpectedly hard ≥2 sessions → −1 to
                          // −2 VDOT"; layoff rows) + freshness window
                          // (:659-677 · stale anchor is a floor, not a
                          // pace source).

export interface AdaptationTrigger {
  kind: AdaptationTriggerKind;
  severity: 'info' | 'warn' | 'override';
  reason: string;             // human-readable; surfaces in coach prose
  evidence: Record<string, any>;
}

export interface AdaptationAction {
  /** 2026-08-17 · 'field_test' converts one quality day into a 30-minute
   *  threshold field test (type 'tempo', sub_label 'FIELD TEST'), spec
   *  modeled on the tempo shape. Propose-first via partitionActionsForCron. */
  kind: 'reschedule' | 'downgrade' | 'shave' | 'recompute_paces' | 'mark_dirty' | 'mark_upgrade' | 'note' | 'field_test';
  workoutIds?: string[];      // plan_workouts.id targeted
  newType?: string;
  newDate?: string;
  shaveFraction?: number;     // e.g. 0.15 = 15% off the volume
  /** 2026-06-03 · mark_upgrade · per-row distance bumps from adaptive
   *  ramp. Each entry sets plan_workouts.distance_mi = newDistanceMi,
   *  with a SQL guard ensuring distance never decreases (only bumps
   *  UP). Long bump capped at +1mi · weekly total capped at +5mi. */
  bumps?: Array<{ workoutId: string; newDistanceMi: number }>;
  /** 2026-07-06 · P1-37 · provenance tag. Every action carries the
   *  trigger kind that produced it so the cron can split apply-now vs
   *  propose-first per ACTION, never by array-index alignment against
   *  the triggers list (triggers emit 0..2 actions each — index walks
   *  misroute). Optional for wire back-compat (proposal accept route
   *  reconstructs actions without it → treated as apply-now, same
   *  default-to-apply posture as before). */
  sourceTrigger?: AdaptationTriggerKind;
  /** 2026-07-06 · 'note' actions · record-only. Writes a coach_intents
   *  row (reason = noteReason, field = workoutIds[0] ?? noteField) and
   *  mutates NOTHING in plan_workouts. Used for: dropped missed work
   *  (data, not debt), missed-long records, gap-handled markers, and
   *  the >14d rebuild recommendation. */
  noteReason?: string;
  noteField?: string | null;
  noteValue?: Record<string, unknown>;
  /** 2026-07-06 · anti-stacking coupling guard. A downgrade emitted to
   *  offset a reschedule is skipped when that reschedule did not land
   *  (e.g. seal-filtered) — otherwise the offset destroys a quality
   *  day without the added load it was offsetting. */
  onlyIfRescheduledId?: string;
  /** 2026-08-17 · recompute_paces actions · the measured VDOT the plan's
   *  future paces should re-derive from (pr_bank: the new race VDOT;
   *  fitness_regression: the regressed evidence VDOT). null → resolved at
   *  apply time from the latest projection snapshot (goal_changed). */
  newVdot?: number | null;
  why: string;                // for the coach to repeat
}

export interface AdaptationResult {
  triggers: AdaptationTrigger[];
  actions: AdaptationAction[];
  applied: boolean;
}

/**
 * Experience-level volume caps (P33) — FALLBACK ONLY as of 2026-07-06
 * (P1-55). detectVolumeOvershoot now baselines against the ACTIVE
 * PLAN's scheduled volume for the same trailing window; this table is
 * consulted only when the plan has nothing scheduled in the window.
 *
 * Values re-derived from the generator's own tier bands (goal-tiers.ts
 * TIER_TARGETS) so the fallback can never contradict a plan the
 * generator itself prescribed. Mapping (same as adapter-bench.test.ts):
 * beginner→developing, intermediate→intermediate, advanced→advanced,
 * advanced_plus→elite; cap = the level's max peakWeeklyMileageBand top
 * across distances, rounded so cap × 1.25 clears the band:
 *   developing max 55 (ultra)   → 45   (45 × 1.25 = 56.25 ≥ 55)
 *   intermediate max 75 (ultra) → 60   (60 × 1.25 = 75    ≥ 75)
 *   advanced max 100 (ultra)    → 80   (80 × 1.25 = 100   ≥ 100)
 *   elite max 120 (ultra)       → 110  (110 × 1.25 = 137.5 ≥ 120)
 * The old {25, 45, 75, 110} table fired on doctrine-compliant plans:
 * a beginner clamps only DOWN to 'intermediate' tier (goal-tiers.ts
 * classifyGoalTier), whose marathon band is 40-55mi — over the old
 * beginner threshold of 31.25mi for most of a build.
 */
export const EXPERIENCE_CAPS_MI: Record<ExperienceLevel, number> = {
  beginner:      45,
  intermediate:  60,
  advanced:      80,
  advanced_plus: 110,
};

// ── Pure decision core (2026-07-06 · phone+watch audit adapter fixes) ──
// Exported so lib/plan/_adapt_invariants.test.ts can lock the math the
// SQL shell feeds — same test posture as adapter-bench.test.ts.

/** Quality types the missed detector + anti-stacking guard operate on. */
export const QUALITY_TYPES = ['threshold', 'tempo', 'intervals', 'vo2max'] as const;

/** Rows the adapter must never shave or downgrade — race execution is
 *  owned by the race-week machinery, not the volume adapter. Per-finding
 *  context filter (CLAUDE.md locked 2026-05-19 round 4): each adapter
 *  action re-asks the race-calendar question itself. */
export const RACE_PROTECTED_TYPES = ['race', 'race_week_tuneup', 'shakeout'] as const;

/** Signed whole days from `a` to `b` (positive when b is after a).
 *  Noon-anchored → DST-safe, same idiom as isoDaysBefore. */
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/** ISO date `days` after `isoDate` (noon-anchored → DST-safe). */
export function plusDaysISO(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate + 'T12:00:00Z') + days * 86400000)
    .toISOString().slice(0, 10);
}

/** 0=Sun..6=Sat — same convention as plan_workouts.dow and
 *  app/api/today/reschedule. */
export function dowOfISO(isoDate: string): number {
  return new Date(isoDate + 'T12:00:00Z').getUTCDay();
}

const DOW_OF_SHORTCODE: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Workout-relative completion threshold (2026-07-06 · P1-40/P1-54).
 * A run covering ≥60% of the prescribed distance within ±1d counts as
 * done. The old flat ≥4mi gate declared every completed sub-4mi quality
 * session missed (5K-plan intervals are routinely ~3mi — the same
 * population the 2026-06-15 vdotRunFloorMi fix served) and let any 4mi
 * easy jog satisfy an unrelated 8mi tempo.
 * Cite: Research/22-plan-templates.md §14 — a 70%-volume comeback week
 * still banks the stimulus; ≥60% of a prescription is a completed-enough
 * session, not a missed one.
 * No prescribed distance → legacy 4mi fallback.
 */
export function completionThresholdMi(prescribedMi: number | null): number {
  if (prescribedMi == null || !Number.isFinite(prescribedMi) || prescribedMi <= 0) return 4;
  return Math.min(prescribedMi, Math.max(1, prescribedMi * 0.6));
}

/**
 * Staleness expiry (2026-07-06 · P1-38). A workout whose ORIGINAL date
 * is more than 3 days past is never rescheduled — the stimulus window
 * is gone; it becomes data (drop note), not debt. Uses the original
 * date so a row a runner moved forward can't ride indefinitely.
 */
export function isStaleMissed(originalDateISO: string, todayISO: string): boolean {
  return daysBetweenISO(originalDateISO, todayISO) > 3;
}

/** True when `dateISO` is inside a race week ([race-6d, race]) or within
 *  3 days either side of any known race. Task rule: never reschedule
 *  into race week or within 3 days of a race (races via
 *  training_plans.race_id / goal_iso / races table). */
export function dateNearRace(dateISO: string, raceDates: string[]): boolean {
  for (const r of raceDates) {
    if (!r) continue;
    const delta = daysBetweenISO(dateISO, r); // >0 → race is ahead of dateISO
    if (delta >= 0 && delta <= 6) return true; // race week · the 7 days ending at the race
    if (Math.abs(delta) <= 3) return true;     // ±3d buffer (covers post-race recovery too)
  }
  return false;
}

/** Per-candidate-day context for chooseRescheduleDate. Built from
 *  plan_workouts rows by the DB shell in actionsForTrigger. */
export interface RescheduleDayContext {
  /** running rows already on the date (type not in rest/strength) */
  runCount: number;
  /** any quality or long row on the date — adjacency probes read this */
  qualityOrLong: boolean;
  /** a rest row on the date = deliberately placed rest day */
  hasRestRow: boolean;
  /** running rows already in this date's plan week, EXCLUDING the
   *  workout being moved (so a same-week move doesn't double-count).
   *  null → unknown → frequency check skipped. */
  weekRunCount: number | null;
}

/**
 * Reschedule target search (2026-07-06 · P1-35/P1-46/P2-67). Walks
 * today+1..today+4 and returns the first day that passes EVERY guard:
 *   · no existing running workout (collision — the double-booked-day bug)
 *   · not a rest day (plan rest row, or the runner's rest_day dow)
 *   · not the long-run day (settings dow, or plan-inferred)
 *   · no quality/long on the adjacent days (hard/easy spacing —
 *     Research/00a hard-easy principle; the 3-consecutive-tempos bug)
 *   · respects weekly_frequency (moving in must not exceed the week's
 *     run-day budget)
 *   · never race week / within 3 days of a race (dateNearRace)
 * Returns null when no day qualifies → caller DROPS the workout with a
 * coach_intents record (data, not debt).
 */
export function chooseRescheduleDate(opts: {
  todayISO: string;
  /** context for [today .. today+5] (candidates ±1 for adjacency) */
  byDate: Record<string, RescheduleDayContext>;
  longRunDow: number | null;
  restDow: number | null;
  weeklyFrequency: number | null;
  raceDates: string[];
}): string | null {
  const { todayISO, byDate, longRunDow, restDow, weeklyFrequency, raceDates } = opts;
  for (let i = 1; i <= 4; i++) {
    const d = plusDaysISO(todayISO, i);
    const ctx = byDate[d] ?? { runCount: 0, qualityOrLong: false, hasRestRow: false, weekRunCount: null };
    if (ctx.runCount > 0) continue;
    if (ctx.hasRestRow) continue;
    const dow = dowOfISO(d);
    if (longRunDow != null && dow === longRunDow) continue;
    if (restDow != null && dow === restDow) continue;
    const prev = byDate[plusDaysISO(todayISO, i - 1)];
    const next = byDate[plusDaysISO(todayISO, i + 1)];
    if (prev?.qualityOrLong || next?.qualityOrLong) continue;
    if (weeklyFrequency != null && ctx.weekRunCount != null && ctx.weekRunCount + 1 > weeklyFrequency) continue;
    if (dateNearRace(d, raceDates)) continue;
    return d;
  }
  return null;
}

/** Comeback bands per Research/22-plan-templates.md §14 (628-651).
 *  daysOff = consecutive no-run days since the last canonical run
 *  (yesterday inclusive, today exclusive). The doctrine table's
 *  "1-7 days" row is applied from 4 days off up: plans legitimately
 *  schedule up to ~3 consecutive non-running days (rest + spacing), so
 *  gaps of 1-3 days are normal weekly structure, not a layoff — the
 *  missed-workout trigger covers individual skipped sessions there. */
export type GapBand = 'none' | 'easy_swap' | 'shave_70_85' | 'rebuild_propose';
export function classifyGapBand(daysOff: number): GapBand {
  if (!Number.isFinite(daysOff)) return 'none';
  if (daysOff >= 15) return 'rebuild_propose'; // >14d · >2 weeks → rebuild (Research/01:319)
  if (daysOff >= 8) return 'shave_70_85';      // 8-14d · 70%/85% re-entry (Research/22:635)
  if (daysOff >= 4) return 'easy_swap';        // "1-7 days" row, actionable sub-range (Research/22:634)
  return 'none';
}

/** Re-entry shave fractions for the 8-14d band: week 1 → 70% of plan
 *  (shave 0.30), week 2 → 85% (shave 0.15). Research/22:635. */
export const GAP_SHAVE_FRACTIONS: readonly [number, number] = [0.30, 0.15];

const GAP_BAND_RANK: Record<Exclude<GapBand, 'none'>, number> = {
  easy_swap: 1, shave_70_85: 2, rebuild_propose: 3,
};

/**
 * Idempotency across daily crons (task #8): a gap is identified by its
 * lastRunISO. Fire at most once per (gap, band) — a re-run on the same
 * gap and band is a no-op; band ESCALATION (gap kept growing past the
 * next threshold) is allowed to fire once more.
 */
export function gapAlreadyHandled(
  handled: Array<{ lastRunISO?: unknown; band?: unknown }>,
  lastRunISO: string,
  band: Exclude<GapBand, 'none'>,
): boolean {
  for (const h of handled) {
    if (h?.lastRunISO !== lastRunISO) continue;
    const hb = typeof h?.band === 'string' ? (h.band as string) : '';
    const rank = GAP_BAND_RANK[hb as Exclude<GapBand, 'none'>];
    if (rank != null && rank >= GAP_BAND_RANK[band]) return true;
  }
  return false;
}

/** Plan row shape buildGapActions consumes (DB shell maps SQL → this). */
export interface GapPlanRow {
  id: string;
  dateISO: string;
  type: string;
  distanceMi: number | null;
  /** row's plan week is a race week (plan_weeks.is_race_week) */
  inRaceWeek: boolean;
}

/**
 * Comeback actions for a detected training gap. Pure — the DB shell
 * loads the next 14 days of plan rows + race dates and applies output
 * through the standard applyAdaptations machinery (0.5mi shave
 * snapping included).
 *
 *   easy_swap       → downgrade the FIRST upcoming quality to easy,
 *                     nothing else (Research/22:634 "one easy day
 *                     instead of first quality").
 *   shave_70_85     → shave [today, today+6] by 0.30 and
 *                     [today+7, today+13] by 0.15; drop intensity for
 *                     the first week back (Research/22:630-635 "Resume
 *                     at previous schedule, drop intensity for first
 *                     week" + 70%/85% volume rows). ZERO reschedules.
 *   rebuild_propose → notes only, NO plan mutation: recommend rebuild
 *                     with a VDOT haircut (Research/01:319-320 · ≥2wk
 *                     drop 3-5, ≥6wk drop 5-8).
 *
 * Every band emits a 'plan_adapt_gap' marker note keyed on lastRunISO —
 * the idempotency record detectTrainingGap checks on later crons.
 * Race-protected rows (RACE_PROTECTED_TYPES, race-week rows, within 3d
 * of a race) are excluded per the per-finding context-filter rule.
 */
export function buildGapActions(opts: {
  todayISO: string;
  daysOff: number;
  lastRunISO: string;
  upcoming: GapPlanRow[];   // [today, today+13]
  raceDates: string[];
}): AdaptationAction[] {
  const { todayISO, daysOff, lastRunISO, upcoming, raceDates } = opts;
  const band = classifyGapBand(daysOff);
  if (band === 'none') return [];

  const protectedRow = (r: GapPlanRow): boolean =>
    (RACE_PROTECTED_TYPES as readonly string[]).includes(r.type)
    || r.inRaceWeek
    || dateNearRace(r.dateISO, raceDates);

  const actions: AdaptationAction[] = [{
    kind: 'note',
    noteReason: 'plan_adapt_gap',
    noteField: lastRunISO,
    noteValue: { lastRunISO, daysOff, band },
    why: `${daysOff} days without running. Comeback protocol per Research/22 §14.`,
  }];

  if (band === 'easy_swap') {
    const firstQuality = [...upcoming]
      .filter((r) => (QUALITY_TYPES as readonly string[]).includes(r.type) && !protectedRow(r))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))[0];
    if (firstQuality) {
      actions.push({
        kind: 'downgrade',
        workoutIds: [firstQuality.id],
        newType: 'easy',
        why: `${daysOff} days off. First run back is easy, not quality. Research/22 §14: 1-7 days, resume plan, one easy day instead of first quality.`,
      });
    }
    return actions;
  }

  if (band === 'shave_70_85') {
    const week1End = plusDaysISO(todayISO, 6);
    const week1 = upcoming.filter((r) => r.dateISO >= todayISO && r.dateISO <= week1End && !protectedRow(r));
    const week2 = upcoming.filter((r) => r.dateISO > week1End && r.dateISO <= plusDaysISO(todayISO, 13) && !protectedRow(r));
    const shavable = (rows: GapPlanRow[]) => rows
      .filter((r) => r.type !== 'rest' && r.type !== 'strength' && (r.distanceMi ?? 0) >= 1)
      .map((r) => r.id);
    const week1Quality = week1
      .filter((r) => (QUALITY_TYPES as readonly string[]).includes(r.type))
      .map((r) => r.id);
    if (week1Quality.length > 0) {
      actions.push({
        kind: 'downgrade',
        workoutIds: week1Quality,
        newType: 'easy',
        why: 'Drop intensity for the first week back. Research/22 §14.',
      });
    }
    const w1Ids = shavable(week1);
    if (w1Ids.length > 0) {
      actions.push({
        kind: 'shave',
        workoutIds: w1Ids,
        shaveFraction: GAP_SHAVE_FRACTIONS[0],
        why: `Re-entry week at 70% volume after ${daysOff} days off. Research/22 §14.`,
      });
    }
    const w2Ids = shavable(week2);
    if (w2Ids.length > 0) {
      actions.push({
        kind: 'shave',
        workoutIds: w2Ids,
        shaveFraction: GAP_SHAVE_FRACTIONS[1],
        why: 'Week 2 back at 85% volume. Research/22 §14.',
      });
    }
    return actions;
  }

  // rebuild_propose · >14 days off · do NOT auto-modify.
  actions.push({
    kind: 'note',
    noteReason: 'plan_adapt_gap_rebuild',
    noteField: lastRunISO,
    noteValue: {
      lastRunISO,
      daysOff,
      recommendation: 'rebuild',
      vdotHaircut: daysOff >= 42 ? '5-8' : '3-5',
    },
    why: `${daysOff} days off. Plan rebuild recommended with a ${daysOff >= 42 ? '5-8' : '3-5'} point VDOT haircut before resuming. Research/01 recalibration table (layoff ≥2 weeks).`,
  });
  return actions;
}

// ── Post-absence re-ramp (2026-08-17 · RERAMP-1) ───────────────────────
//
// buildGapActions' shave_70_85 band handles the FIRST 14 days back
// (70%/85% of the authored plan). What it never did: rewrite the
// REMAINING weeks' volume. The authored plan's ramp continues as if the
// absence never happened — the audited case: an 8-day absence zeroed
// week 5 and weeks 7-8 still stood at 59.5/64.5 mpw against a runner
// whose pre-absence rolling 4-week average was 39 mpw.
//
// Doctrine · Research/22-plan-templates.md §14:
//   · :635 — 8-14 days off → "70% of pre-layoff volume for 1 wk, 85%
//     for wk 2, full for wk 3" — where "full" means the runner's OWN
//     pre-layoff level, not an authored ramp that banked the missed week.
//   · :648-651 — the moderate-layoff table resumes at ~70-80% of prior
//     volume with the "10% rule strictly enforced" on the climb back.
//
// So: resume anchor = 70% of the pre-absence rolling 4-week average;
// week k of the comeback may hold at most anchor × 1.10^(k-1); any
// future week authored ABOVE its ceiling is shaved down to it. The
// proportional shave keeps every day's share of the week (so the long
// stays capped at its authored ~30% share of the reduced week, and
// easy<long ordering is preserved). Quality returns per the existing
// band rules (week-1 downgrade only) — the re-ramp touches volume, not
// workout types.
//
// Scope: weeks STARTING after the 14-day window buildGapActions already
// owns (its 0.30/0.15 shaves are locked by _adapt_invariants) — the
// re-ramp owns week 3 of the comeback onward. Applied through the same
// seal-guarded 'shave' machinery (applyAdaptations filters sealed rows
// and snaps to 0.5mi), race-protected rows excluded per the per-finding
// context-filter rule.

/** §14 resume anchor · 70% of the pre-absence rolling 4-week average. */
export const RERAMP_RESUME_FRACTION = 0.70;
/** §14 "10% rule strictly enforced" on the climb back. */
export const RERAMP_WEEKLY_GROWTH = 1.10;

export interface ReRampWeek {
  /** Plan-week start date (plan_weeks.week_start_iso). */
  weekStartISO: string;
  rows: GapPlanRow[];
}

/**
 * Weekly ceiling for comeback week k (1-based · k=1 is the week
 * containing the first day back). Pure math, exported for tests.
 */
export function reRampWeeklyCeilingMi(preAbsenceWeeklyMi: number, comebackWeekIdx: number): number {
  if (!(preAbsenceWeeklyMi > 0) || comebackWeekIdx < 1) return 0;
  return preAbsenceWeeklyMi * RERAMP_RESUME_FRACTION
    * Math.pow(RERAMP_WEEKLY_GROWTH, comebackWeekIdx - 1);
}

/**
 * Shave actions rescaling future authored weeks to the comeback ceiling.
 * Pure — the DB shell loads fully-future plan weeks (start > today+13)
 * and the pre-absence rolling 4-week average, and feeds them here.
 */
export function buildReRampActions(opts: {
  todayISO: string;
  daysOff: number;
  lastRunISO: string;
  preAbsenceWeeklyMi: number;
  /** Plan weeks whose start date is AFTER today+13 (weeks 1-2 of the
   *  comeback belong to buildGapActions' 70%/85% shaves). */
  weeks: ReRampWeek[];
  raceDates: string[];
}): AdaptationAction[] {
  const { todayISO, daysOff, preAbsenceWeeklyMi, weeks, raceDates } = opts;
  if (classifyGapBand(daysOff) !== 'shave_70_85') return [];   // ≥8d band owns the re-ramp; >14d is propose-only
  if (!(preAbsenceWeeklyMi >= 5)) return [];                    // no meaningful base signal
  const actions: AdaptationAction[] = [];
  const protectedRow = (r: GapPlanRow): boolean =>
    (RACE_PROTECTED_TYPES as readonly string[]).includes(r.type)
    || r.inRaceWeek
    || dateNearRace(r.dateISO, raceDates);

  for (const wk of weeks) {
    if (!wk?.weekStartISO || wk.weekStartISO <= plusDaysISO(todayISO, 13)) continue;
    const k = Math.floor(daysBetweenISO(todayISO, wk.weekStartISO) / 7) + 1;
    const ceiling = reRampWeeklyCeilingMi(preAbsenceWeeklyMi, k);
    if (!(ceiling > 0)) continue;
    const runRows = wk.rows.filter((r) => r.type !== 'rest' && r.type !== 'strength' && (r.distanceMi ?? 0) > 0);
    const plannedMi = runRows.reduce((s, r) => s + (r.distanceMi ?? 0), 0);
    // Ramp caught up to the authored plan → nothing to shave (5% grace so a
    // rounding-level overage doesn't churn the whole week by half a mile).
    if (plannedMi <= ceiling * 1.05) continue;
    const shavable = runRows.filter((r) => !protectedRow(r) && (r.distanceMi ?? 0) >= 1).map((r) => r.id);
    if (shavable.length === 0) continue;
    // Proportional fraction toward the ceiling, capped at 50% — deeper than
    // half is rebuild territory, not a shave (and the >14d band already
    // routes there as propose-only).
    const fraction = Math.min(0.5, Math.round((1 - ceiling / plannedMi) * 100) / 100);
    if (fraction < 0.05) continue;
    actions.push({
      kind: 'shave',
      workoutIds: shavable,
      shaveFraction: fraction,
      why: `Comeback re-ramp after ${daysOff} days off: week of ${wk.weekStartISO} rescaled from ${Math.round(plannedMi)}mi toward ${Math.round(ceiling)}mi (resume at 70% of the pre-absence 4-week average ${Math.round(preAbsenceWeeklyMi)}mi, then ≤10%/week). Research/22 §14.`,
    });
  }
  return actions;
}

/**
 * Volume-overshoot firing predicate (2026-07-06 · P1-55). Baseline is
 * what the ACTIVE PLAN scheduled for the trailing window when that is
 * meaningful (≥5mi — race-week/taper trailing windows schedule less
 * and are filtered upstream anyway); the experience cap is only the
 * no-schedule fallback. Fires when completed exceeds baseline by >25%.
 */
export function overshootFires(
  completedMi: number,
  scheduledMi: number | null,
  capMi: number,
): boolean {
  const baseline = scheduledMi != null && scheduledMi >= 5 ? scheduledMi : capMi;
  return completedMi > baseline * 1.25;
}

/**
 * Trigger kinds whose actions are PROPOSE-FIRST (runner gates the change
 * from the Today banner) rather than apply-now:
 *   · readiness_pullback — engine opinion about tomorrow (2026-06-04).
 *   · field_test_due — the engine wants to spend a quality day on a
 *     fitness test; the runner can decline (2026-08-17 · Research/01:708
 *     "plan the test as a workout ... and surface why").
 */
export const PROPOSE_FIRST_TRIGGERS: ReadonlySet<AdaptationTriggerKind> =
  new Set<AdaptationTriggerKind>(['readiness_pullback', 'field_test_due']);

/**
 * Cron split (2026-07-06 · P1-37). Partition on each action's OWN
 * sourceTrigger tag — never on index alignment with the triggers
 * array. Untagged actions default to apply-now (same safer-than-
 * dropping posture the old comment claimed but the index walk broke).
 */
export function partitionActionsForCron(actions: AdaptationAction[]): {
  applyNow: AdaptationAction[];
  proposeFirst: AdaptationAction[];
} {
  const applyNow: AdaptationAction[] = [];
  const proposeFirst: AdaptationAction[] = [];
  for (const a of actions) {
    (a.sourceTrigger != null && PROPOSE_FIRST_TRIGGERS.has(a.sourceTrigger) ? proposeFirst : applyNow).push(a);
  }
  return { applyNow, proposeFirst };
}

/** Run all detectors against today's state, return triggers + actions. */
export async function detectAdaptations(userId: string): Promise<AdaptationResult> {
  const triggers: AdaptationTrigger[] = [];

  // 0. Training gap (2026-07-06 · P1-36). Runs FIRST: when an unplanned
  //    layoff is active the comeback protocol owns the response and
  //    missed-workout rescheduling is suppressed — Research/22 §14 says
  //    resume the schedule (graded), never cram the missed work back in.
  const gap = await detectTrainingGap(userId);
  if (gap) triggers.push(gap);

  // Suppress missed-workout handling while a gap is active OR was
  // handled within the last 7 days (the re-entry window): sessions
  // missed during/around the gap are covered by the comeback response,
  // and re-detecting them would reschedule quality into a week the gap
  // handler just shaved. After the window, anything left is >3 days
  // stale and drops as data.
  const inGapReentry = gap != null || await hasRecentGapIntent(userId, 7);

  // 1. Missed key workout
  if (!inGapReentry) {
    const missed = await detectMissedKeyWorkout(userId);
    if (missed) triggers.push(missed);
  }

  // 2. Readiness pullback · multi-signal composite (Research/15 + /00b).
  //    Replaces the single-signal RHR + sleep detectors below as of
  //    2026-06-01 · David's feedback: "I want it to read all the
  //    information it needs. I don't know about a number Sunday at
  //    5:50 AM making a call for Tuesday." Now reads the readiness
  //    brief (5 pillars · Plews HRV · 3-day streak persistence ·
  //    composite score) AND acts only on TODAY's workout.
  const readinessPullback = await detectReadinessPullback(userId);
  if (readinessPullback) triggers.push(readinessPullback);

  // OLD detectors retained as dead code (function bodies kept for
  // reference) but NOT pushed to triggers. Removing entirely would
  // break test fixtures + tracked-issue analytics; the union type
  // still includes the kinds so prior coach_intents rows resolve.

  // 4. Volume overshoot
  const overshoot = await detectVolumeOvershoot(userId);
  if (overshoot) triggers.push(overshoot);

  // 5. Niggle reported (Q-04 default: graduated severity response)
  const niggle = await detectNiggleReported(userId);
  if (niggle) triggers.push(niggle);

  // 6. Sick episode active (Q-03 default: propose, don't auto-modify)
  const sick = await detectSickEpisodeActive(userId);
  if (sick) triggers.push(sick);

  // 7. Active injury (Q-08 default: propose INJURY-mode adjustments)
  const injury = await detectInjuryActive(userId);
  if (injury) triggers.push(injury);

  // 8. PR_BANK · new race finish that implies VDOT jump > 1.5 pts
  const prBank = await detectPrBank(userId);
  if (prBank) triggers.push(prBank);

  // 8b. FITNESS_REGRESSION (2026-08-17) · the downward mirror of PR_BANK.
  //     Race result or 28d sustained training evidence showing VDOT more
  //     than 1.5 pts BELOW the reviewed anchor → re-anchor paces down
  //     (auto for race-sourced, propose-first for training drift).
  //     Skipped when pr_bank fired — the two are evidence-exclusive and
  //     the upward recompute already re-anchors everything.
  if (!prBank) {
    const regression = await detectFitnessRegression(userId);
    if (regression) triggers.push(regression);
  }

  // 9. GOAL_CHANGED · runner accepted adaptive-VDOT bump (manual override)
  //    OR edited their goal_race_time. Both signal "paces need re-derive".
  const goalChanged = await detectGoalChanged(userId);
  if (goalChanged) triggers.push(goalChanged);

  // 10. FIELD_TEST_DUE (2026-08-17) · no race result and no field test in
  //     42 days → propose converting one upcoming quality day to a
  //     30-minute threshold field test. Research/01:679-686 ("reassess
  //     fitness every 4-6 weeks ... ≥6 weeks since last race or test →
  //     schedule a 5K time trial or 30-min TT"). Per-finding context
  //     filters (CLAUDE.md): suppressed during comeback re-entry and
  //     while illness/injury/serious-niggle responses are active — a
  //     compromised runner's test result would be noise, and the body
  //     needs the recovery, not a time trial.
  if (!inGapReentry && !sick && !injury && !(niggle && niggle.severity === 'override')) {
    const fieldTest = await detectFieldTestDue(userId);
    if (fieldTest) triggers.push(fieldTest);
  }

  const actions: AdaptationAction[] = [];
  for (const t of triggers) {
    // 2026-07-06 · P1-37 · tag every action with its source trigger so
    // downstream consumers (cron apply/propose split, proposals writer)
    // never have to reconstruct provenance by array index.
    for (const a of await actionsForTrigger(userId, t)) {
      actions.push({ ...a, sourceTrigger: t.kind });
    }
  }

  return { triggers, actions, applied: false };
}

/** True when a plan_adapt_gap marker was written within the last
 *  `days` days — the comeback re-entry window is still active. */
async function hasRecentGapIntent(userId: string, days: number): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason = 'plan_adapt_gap'
        AND ts >= NOW() - make_interval(days => $2::int)
      LIMIT 1`,
    [userId, days],
  ).catch(() => ({ rows: [] as unknown[] }));
  return r.rows.length > 0;
}

/** Apply the actions to plan_workouts in a single transaction.
 *
 *  P1 #8 (2026-05-30): also writes a coach_intents row per applied action
 *  so the closed-loop history exists — every readiness/volume-driven plan
 *  mutation is recorded with its trigger reason. The next briefing voice
 *  reads pending intents (acknowledged_at IS NULL) so the coach can
 *  acknowledge the change once and move on.
 */
export async function applyAdaptations(userId: string, actions: AdaptationAction[]): Promise<number> {
  if (actions.length === 0) return 0;
  // 2026-08-17 · citation scrub at the WRITE site. `why` is the one
  // string the runner reads (coach_intents.value.why → adaptation-info
  // → "How it changed" surfaces); Research/ refs stay in code comments
  // and the plan_proposals citation field, never in the runner's copy.
  actions = actions.map((a) => ({ ...a, why: stripResearchCitations(a.why) }));
  let touched = 0;
  // 2026-07-06 · reschedules that actually landed in THIS call — the
  // anti-stacking downgrade (onlyIfRescheduledId) is skipped when its
  // paired reschedule was seal-filtered, so an offset can't destroy a
  // quality day without the added load it was offsetting.
  const landedReschedules = new Set<string>();
  // 2026-08-17 · recompute_paces · stamp users.vdot_last_reviewed AFTER
  // commit (see the recompute_paces limb for why it can't run in-txn).
  let postCommitVdotReviewed: number | null = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of actions) {
      // Map action kind → coach_intents reason. Prefix with plan_adapt_
      // so the briefing voice can detect any prescription-mutation row by
      // a single string-prefix scan in the LLM context.
      const reason =
        a.kind === 'reschedule' ? 'plan_adapt_reschedule'
        : a.kind === 'downgrade' ? 'plan_adapt_downgrade'
        : a.kind === 'shave'     ? 'plan_adapt_shave'
        : a.kind === 'mark_dirty' ? 'plan_adapt_mark_dirty'
        : a.kind === 'recompute_paces' ? 'plan_adapt_recompute_paces'
        : a.kind === 'mark_upgrade' ? 'plan_adapt_upgrade'
        : a.kind === 'field_test' ? 'plan_adapt_field_test'
        : a.kind === 'note'      ? (a.noteReason ?? 'plan_adapt_note')
        : 'plan_adapt_other';

      // 2026-07-06 · 'note' actions are record-only: write the intent,
      // mutate nothing, bump nothing. Not seal-filtered — recording that
      // a workout was missed/dropped is history, not a prescription
      // change for a completed day. Handled before the seal filter.
      if (a.kind === 'note') {
        const targets = a.workoutIds && a.workoutIds.length > 0
          ? a.workoutIds
          : [a.noteField ?? ''];
        for (const f of targets) {
          await writeIntent(client, userId, reason, f, {
            ...(a.noteValue ?? {}), why: a.why,
          });
        }
        continue;
      }

      // 2026-06-03 · Rule 15 · filter sealed (completed-day) workouts
      // out of every action before iterating · the adapter cannot
      // retroactively change what was prescribed for a day the runner
      // already ran. Cite: §Rule 15.
      const wids = a.workoutIds ?? a.bumps?.map((b) => b.workoutId) ?? [];
      const unsealedIds = await filterUnsealedWorkouts(client, userId, wids, `adapt/${a.kind}`);
      const unsealedSet = new Set(unsealedIds);

      if (a.kind === 'reschedule' && a.newDate && a.workoutIds) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          // 2026-07-06 · P1-35/P2-64 · a reschedule is a full move, not
          // a bare date_iso poke: re-resolve week_id from the plan_weeks
          // row covering the new date (same lookup app/api/today/
          // reschedule uses), recompute dow, and stamp original_date_iso
          // on first move so the row's provenance — and the staleness
          // clock — anchor to the authored date.
          await client.query(
            `UPDATE plan_workouts pw
                SET date_iso = $1,
                    dow = $3,
                    week_id = COALESCE(
                      (SELECT w.id FROM plan_weeks w
                        WHERE w.plan_id = pw.plan_id
                          AND w.week_start_iso <= $1
                          AND to_char((w.week_start_iso::date + interval '7 days'), 'YYYY-MM-DD') > $1
                        LIMIT 1),
                      pw.week_id),
                    original_date_iso = COALESCE(pw.original_date_iso, pw.date_iso)
              WHERE pw.id = $2`,
            [a.newDate, wid, dowOfISO(a.newDate)]
          );
          landedReschedules.add(wid);
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, newDate: a.newDate, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'downgrade' && a.newType && a.workoutIds) {
        // 2026-07-06 · anti-stacking coupling guard (see field doc).
        if (a.onlyIfRescheduledId && !landedReschedules.has(a.onlyIfRescheduledId)) {
          console.log(`[applyAdaptations] skip downgrade — paired reschedule ${a.onlyIfRescheduledId} did not land`);
          continue;
        }
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          // 2026-06-01 · type is source of truth (web agent brief
          // plan-type-column-alignment-brief.md · Option A). When we
          // downgrade a quality workout to easy/recovery/rest, we MUST
          // clear the trailing fields too · otherwise the row reads
          // "type=easy but sub_label='Cruise Intervals' + pace=T-pace
          // + is_quality=true" and every downstream consumer (chip
          // color, hero gradient, strength placement, coach mode
          // resolver) gets contradictory signals.
          //
          // Coherent downgrade · clear sub_label · clear pace target ·
          // set is_quality=false (easy/recovery/rest are never quality)
          // · clear is_long if downgrading FROM long.
          const newType = a.newType;
          const clearsQuality = ['easy', 'recovery', 'rest'].includes(newType);
          if (clearsQuality) {
            // 2026-06-03 · iPhone agent Tier 3.e brief · write a NEW
            // spec for the downgraded type instead of NULL. The
            // expandSpecToPhases() helper needs SOMETHING to work
            // with; NULL forces the prescriptionFor() fallback path
            // and re-fragments the read pipeline.
            //
            // Easy + recovery share a minimal shape (kind only · the
            // expander's easyPaceFallback fills in pace from runner
            // history at read time). Rest gets null spec since rest
            // days don't expand to phases.
            const newSpec = newType === 'rest'
              ? null
              : { kind: newType };  // easy or recovery
            await client.query(
              `UPDATE plan_workouts
                  SET type = $1,
                      original_sub_label = COALESCE(original_sub_label, sub_label),
                      sub_label = $3,
                      pace_target_s_per_mi = NULL,
                      is_quality = false,
                      is_long = (CASE WHEN $1 = 'long' THEN is_long ELSE false END),
                      workout_spec = $4::jsonb
                WHERE id = $2`,
              [
                newType,
                wid,
                newType === 'rest' ? 'REST' : newType.toUpperCase(),
                newSpec ? JSON.stringify(newSpec) : null,
              ]
            );
          } else {
            // Lateral move between quality kinds (rare · e.g. threshold
            // → tempo) · just update type, leave the rest.
            await client.query(
              `UPDATE plan_workouts SET type = $1 WHERE id = $2`,
              [newType, wid]
            );
          }
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, newType: a.newType, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'shave' && a.workoutIds && a.shaveFraction) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          // 2026-06-01 · round to nearest 0.5 mi instead of 1-decimal.
          // ROUND(x, 1) produced 5.8 / 4.2 type values that read as
          // arbitrary noise · runners think in half-mile increments.
          // Multiply by 2, round to integer, divide by 2 = snap to
          // 0.5. Skip the shave entirely if it would produce 0 (a
          // 0.4mi shake-out becomes 0.0 after a 17% shave · keep it).
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = GREATEST(
                  0.5,
                  ROUND((distance_mi * (1 - $1::numeric)) * 2)::numeric / 2
                )
              WHERE id = $2
                AND distance_mi >= 1.0`,
            [a.shaveFraction, wid]
          );
          // 2026-06-04 · rebuild spec + sub_label after the distance
          // mutation. Without this, label says "5 mi @ T" while the
          // row is actually shaved to 4mi · the spec says one thing,
          // the chip says another (David's "is it 5 of 4 miles of the
          // tempo?" QC).
          await rebuildWorkoutDerivations(client, userId, wid);
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, shaveFraction: a.shaveFraction, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'mark_upgrade' && a.bumps && a.bumps.length > 0) {
        // 2026-06-03 · adaptive ramp · push UP when signals green.
        // Per David: "if the runner and the weeks are solid, distance
        // up is OK." SQL guard `distance_mi < $1` makes this strictly
        // additive · never accidentally cuts a row.
        for (const b of a.bumps) {
          if (!unsealedSet.has(b.workoutId)) continue;
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = $1
              WHERE id = $2
                AND distance_mi < $1`,
            [b.newDistanceMi, b.workoutId],
          );
          // 2026-06-04 · same rebuild as shave · prevent label drift
          // when distance changes.
          await rebuildWorkoutDerivations(client, userId, b.workoutId);
          await writeIntent(client, userId, 'plan_adapt_upgrade', b.workoutId, {
            kind: 'mark_upgrade', newDistanceMi: b.newDistanceMi, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'field_test' && a.workoutIds) {
        // 2026-08-17 · convert a quality day to the 30-minute threshold
        // field test (Research/01:700-703 · protocol 2: "30-minute time
        // trial — surfaces threshold pace directly; last 20 min average
        // pace ≈ LT pace"). Spec modeled on the tempo shape (kind
        // 'tempo': warmup_mi / tempo_distance_mi / tempo_pace_s_per_mi /
        // cooldown_mi) so every downstream expander renders it like an
        // ordinary tempo with a FIELD TEST label.
        //
        // COMPLETION FOLLOW-UP (not built here): the watch's tempo
        // completion analysis already computes the work segment's average
        // pace. A follow-up reader should take the test's last-20-min avg
        // pace as T (Research/01:701-702), back-derive VDOT via
        // vdotFromTpace, and feed it into the vdot evidence chain
        // (loadVdotInputs / bestRecentVdot) so the test result refreshes
        // the pace anchors without manual entry.
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          const row = (await client.query<{
            distance_mi: string | null;
            pace_target_s_per_mi: string | null;
            race_id: string | null;
          }>(
            `SELECT pw.distance_mi::text, pw.pace_target_s_per_mi::text, tp.race_id
               FROM plan_workouts pw
               JOIN training_plans tp ON tp.id = pw.plan_id
              WHERE pw.id = $1 AND tp.user_uuid = $2::uuid AND tp.archived_iso IS NULL
              LIMIT 1`,
            [wid, userId],
          )).rows[0];
          if (!row) continue;
          // Pace anchor · the row's own quality pace target when sane,
          // else the goal-derived T (same fallback rebuildWorkoutDerivations
          // uses). May be null → degraded path: type/label/notes only, the
          // read pipeline's prescription fallback fills the rest.
          const rowPace = row.pace_target_s_per_mi != null ? Number(row.pace_target_s_per_mi) : null;
          const tPace = (rowPace != null && rowPace >= 240 && rowPace <= 960)
            ? rowPace
            : await deriveTPaceSecForRebuild(client, userId, row.race_id);
          const notes = 'Field test. 1 mi easy warm-up, then 30 minutes at a hard, even effort · the fastest pace you could hold for about an hour. 1 mi easy cool-down. The last 20 minutes tell us your current threshold; paces recalibrate from it.';
          if (tPace != null) {
            const coreMi = Math.round((1800 / tPace) * 10) / 10;
            const totalMi = Math.round((coreMi + 2) * 2) / 2;
            const spec = {
              kind: 'tempo',
              warmup_mi: 1,
              tempo_distance_mi: coreMi,
              tempo_pace_s_per_mi: tPace,
              cooldown_mi: 1,
              hr_target_bpm: null,
              field_test: true,
              duration_target_s: 1800,
            };
            await client.query(
              `UPDATE plan_workouts
                  SET type = 'tempo',
                      original_sub_label = COALESCE(original_sub_label, sub_label),
                      sub_label = 'FIELD TEST',
                      is_quality = true,
                      is_long = false,
                      distance_mi = $2,
                      pace_target_s_per_mi = $3,
                      workout_spec = $4::jsonb,
                      notes = $5
                WHERE id = $1`,
              [wid, totalMi, tPace, JSON.stringify(spec), notes],
            );
          } else {
            await client.query(
              `UPDATE plan_workouts
                  SET type = 'tempo',
                      original_sub_label = COALESCE(original_sub_label, sub_label),
                      sub_label = 'FIELD TEST',
                      is_quality = true,
                      is_long = false,
                      notes = $2
                WHERE id = $1`,
              [wid, notes],
            );
          }
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'recompute_paces') {
        // 2026-08-17 · coaching-loop reconciliation · a REAL pace rewrite
        // (replaces the dead mark_dirty limb, which appended a
        // '[paces stale - recompute]' string to notes that no reader
        // consumed). Resolves the measured VDOT (action.newVdot from the
        // trigger evidence, else the latest projection snapshot), then
        // rewrites every FUTURE unsealed workout's pace_target +
        // workout_spec on this transaction's client — seal guard lives
        // inside recomputePacesForPlan (same Rule 15 predicate as
        // filterUnsealedWorkouts). users.vdot_last_reviewed is stamped
        // POST-COMMIT (a failed statement inside an open transaction
        // aborts the whole txn in Postgres, and legacy schemas may lack
        // the column — the durable fallback anchor is authored_state.
        // pace_recompute.vdot which recomputePacesForPlan writes).
        // Cite: Research/01 §Recalibrate-Paces.
        let vdotNow = a.newVdot ?? null;
        if (vdotNow == null) {
          const { loadLatestVdotForUser } = await import('@/lib/training/projection-snapshots');
          vdotNow = await loadLatestVdotForUser(userId).catch(() => null);
        }
        const planRow = (await client.query<{ id: string }>(
          `SELECT id FROM training_plans
            WHERE user_uuid = $1 AND archived_iso IS NULL
            ORDER BY authored_iso DESC LIMIT 1`,
          [userId],
        )).rows[0];
        if (vdotNow != null && planRow) {
          const { recomputePacesForPlan } = await import('./recompute-paces');
          const res = await recomputePacesForPlan(planRow.id, vdotNow, {
            source: `adapt/${a.sourceTrigger ?? 'recompute_paces'}`,
            client,
          });
          await writeIntent(client, userId, reason, planRow.id, {
            kind: a.kind, why: a.why, vdot: vdotNow,
            workouts_updated: res?.workoutsUpdated ?? 0,
            workouts_sealed: res?.workoutsSealed ?? 0,
            measured_progress_fraction: res?.measuredProgressFraction ?? null,
          });
          if ((res?.workoutsUpdated ?? 0) > 0) touched++;
          postCommitVdotReviewed = vdotNow;
        }
      }
    }
    // Stamp the plan. last_adapted_at = "cron evaluated" (run-adaptations
    // also bumps it on no-op runs, so it does NOT mean anything changed).
    // 2026-06-06 · Audit C C3 (Option C) · record an actual change only
    // when touched > 0 by appending to adaptation_log. Consumers derive
    // "last changed" = max(adaptation_log.ts); also fixes the empty-log
    // finding (no schema change).
    await client.query(
      `UPDATE training_plans SET last_adapted_at = NOW()
        WHERE user_uuid = $1 AND archived_iso IS NULL`,
      [userId]
    );
    if (touched > 0) {
      await client.query(
        `UPDATE training_plans
            SET adaptation_log = COALESCE(adaptation_log, '[]'::jsonb)
              || jsonb_build_object('ts', NOW(), 'n', $2::int)
          WHERE user_uuid = $1 AND archived_iso IS NULL`,
        [userId, touched]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // Post-commit · stamp the reviewed VDOT so pr_bank / fitness_regression
  // measure future deltas against it. .catch: legacy schemas may lack the
  // column — authored_state.pace_recompute.vdot (written in-txn above) is
  // the durable fallback anchor either way.
  if (postCommitVdotReviewed != null) {
    await pool.query(
      `UPDATE users SET vdot_last_reviewed = $2 WHERE id = $1`,
      [userId, postCommitVdotReviewed],
    ).catch(() => null);
  }
  return touched;
}

/** Insert a coach_intents row for the given adaptation action. The next
 *  briefing voice picks this up via the pending-intents index so the
 *  coach can acknowledge the change. Value is JSON-stringified so it
 *  fits the text column without schema change. */
async function writeIntent(
  client: { query: (q: string, p: unknown[]) => Promise<unknown> },
  userId: string,
  reason: string,
  workoutId: string,
  value: Record<string, unknown>,
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, $2, $3, $4)`,
      [userId, reason, workoutId, JSON.stringify(value)]
    );
  } catch (e: unknown) {
    // Don't roll back the whole adaptation for an intents-log failure;
    // the plan change is more important than the audit row.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[applyAdaptations] writeIntent failed:', msg);
  }
}

/**
 * Rebuild workout_spec + sub_label + pace_target_s_per_mi after a
 * distance mutation (shave / mark_upgrade). Without this the row
 * carries a stale label like "5 mi @ T" while distance_mi has been
 * shaved to 4 · spec, label, and the chip rendered on the planned-day
 * card disagree on the same workout.
 *
 * 2026-06-04 · David's QC: "is it 5 of 4 miles of the tempo?" The
 * shave path was bumping distance_mi via SQL without touching spec or
 * sub_label, so subLabelFromSpec on the stale spec produced "5 mi"
 * while the row was actually 4. Fix: after any distance-touching
 * UPDATE, re-derive spec from (type, current distance, T-pace from
 * the active race goal) and re-derive sub_label from the rebuilt
 * spec.
 *
 * Cite: subLabelFromSpec contract · only tempo/threshold/intervals
 * carry full label info in spec; easy/long/recovery/rest are no-ops
 * here (subLabelFromSpec returns null and we leave sub_label alone).
 *
 * Non-fatal: any failure (missing T-pace, missing race, build error)
 * logs and returns without throwing. The caller's UPDATE already
 * landed · we'd rather have a stale label than abort the whole
 * adaptation transaction over a derivation glitch.
 */
async function rebuildWorkoutDerivations(
  client: { query: typeof pool.query },
  userId: string,
  workoutId: string,
): Promise<void> {
  try {
    // 1. Read the workout's current type + distance + race_id.
    const row = (await client.query<{
      type: string;
      distance_mi: string | null;
      race_id: string | null;
      sub_label: string | null;
    }>(
      `SELECT pw.type, pw.distance_mi::text, pw.sub_label, tp.race_id
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE pw.id = $1
          AND tp.user_uuid = $2::uuid
          AND tp.archived_iso IS NULL
        LIMIT 1`,
      [workoutId, userId],
    )).rows[0];

    if (!row) return;
    const type = row.type;
    const distanceMi = row.distance_mi != null ? Number(row.distance_mi) : null;

    // Only quality types carry full label info in their spec. Easy /
    // recovery / long / rest get their labels at generation time and
    // subLabelFromSpec returns null for them · skip the rebuild so we
    // don't accidentally wipe a meaningful sub_label.
    if (!['tempo', 'threshold', 'intervals'].includes(type)) return;
    if (distanceMi == null || distanceMi <= 0) return;

    // 2. Derive T-pace from the active race goal. No goal · skip ·
    //    we'd produce a spec with no pace anchor, which is worse
    //    than the existing stale-but-consistent spec.
    const tPaceSec = await deriveTPaceSecForRebuild(client, userId, row.race_id);
    if (tPaceSec == null) return;

    // 3. Build the fresh spec from (type, current distance, T-pace).
    //    Pass null lthr/maxHr · the rebuild scope is label drift, not
    //    HR-cap accuracy. The next briefing/render will re-load HR
    //    anchors through the standard pipeline.
    const { buildWorkoutSpec } = await import('./spec-builder');
    //    DOCTRINE-VOCAB-1 (2026-08-17) · pass the row's CURRENT sub_label as the
    //    prescription. It was passing null, so a rebuild re-derived the spec from
    //    (type, distance) alone and spec-builder fell back to its generic
    //    defaults — 4×1mi at T for anything typed `threshold`. A shave therefore
    //    silently turned "6×90s hills @ 5K-10K effort" or "5×2K · descend MP → T"
    //    into a plain cruise-interval set, and then overwrote the sub_label to
    //    match, so nothing downstream could tell the workout had been replaced.
    //    Re-reading the prescription keeps the workout's identity and re-sizes it
    //    to the shaved distance, which is what this function was written to do.
    const { spec, paceTargetSPerMi } = buildWorkoutSpec(
      type,
      distanceMi,
      tPaceSec,
      null,
      row.sub_label,
      null,
    );
    if (!spec) return;

    // 4. Derive the fresh sub_label from the rebuilt spec.
    const { subLabelFromSpec } = await import('@/lib/training/expand-spec');
    const derivedLabel = subLabelFromSpec(
      spec as Parameters<typeof subLabelFromSpec>[0],
    );

    // 5. UPDATE the row. Only overwrite sub_label when we got a fresh
    //    one from the spec · COALESCE preserves the existing label
    //    when subLabelFromSpec returned null (shouldn't happen for
    //    the three types we gate on, but defensive).
    await client.query(
      `UPDATE plan_workouts
          SET workout_spec = $1::jsonb,
              sub_label = COALESCE($2, sub_label),
              pace_target_s_per_mi = COALESCE($3, pace_target_s_per_mi)
        WHERE id = $4`,
      [JSON.stringify(spec), derivedLabel, paceTargetSPerMi, workoutId],
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      '[applyAdaptations] rebuildWorkoutDerivations failed for', workoutId, ':', msg,
    );
  }
}

/**
 * Mirror of /api/plan/restore's deriveTPaceSec helper. Lives here so
 * adapt.ts doesn't take a cross-module dependency on a route file.
 * Returns null when no goal time is set or no race is linked · caller
 * skips the rebuild (the stale spec stays · better than wiping pace
 * info we can't reconstruct).
 */
async function deriveTPaceSecForRebuild(
  client: { query: typeof pool.query },
  userId: string,
  raceId: string | null,
): Promise<number | null> {
  if (!raceId) return null;
  try {
    const { tPaceFromGoal } = await import('./spec-builder');
    const race = (await client.query<{ meta: any; plan: any }>(
      `SELECT meta, plan FROM races
        WHERE user_uuid = $1::uuid AND slug = $2
        LIMIT 1`,
      [userId, raceId],
    )).rows[0];
    if (!race) return null;
    const goalSec = Number(race.plan?.goal?.finish_time_s);
    const goalDistanceMi = Number(race.meta?.distanceMi);
    const fromGoal = tPaceFromGoal(goalSec, goalDistanceMi);
    return fromGoal ?? null;
  } catch {
    return null;
  }
}

// ── Detectors ──────────────────────────────────────────────────────────

/** Per-candidate record the missed detector hands to the action builder. */
interface MissedCandidate {
  workout_id: string;
  planned_date: string;
  type: string;
  distance_mi: number | null;
}

async function detectMissedKeyWorkout(userId: string): Promise<AdaptationTrigger | null> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  // 2026-07-06 rewrite (P1-38/P1-39/P1-40) · walk EVERY quality + long
  // row in the lookback, not LIMIT 1, and classify each:
  //   · fresh quality (original date ≤3d past)  → rescheduable (one per pass)
  //   · stale quality (original date >3d past)  → drop as data
  //   · long (any age)                          → data only, never rescheduled
  // Rows the adapter already handled — rescheduled (chain-drag guard,
  // P1-5/P1-38), dropped, or noted — are excluded via their
  // coach_intents record, so a pass can never re-detect its own output.
  const candidates = (await pool.query<{
    id: string; date: string; type: string;
    distance_mi: string | null; original_date_iso: string | null;
  }>(
    `SELECT pw.id, pw.date_iso::date::text AS date, pw.type,
            pw.distance_mi::text AS distance_mi,
            pw.original_date_iso
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
        AND pw.date_iso::date BETWEEN $2::date - 7 AND $2::date - 1
        AND NOT EXISTS (
              SELECT 1 FROM coach_intents ci
               WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                 AND ci.field = pw.id
                 AND ci.reason IN ('plan_adapt_reschedule',
                                   'plan_adapt_drop_missed',
                                   'plan_adapt_missed_noted')
            )
      ORDER BY pw.date_iso::date DESC`,
    [userId, today]
  )).rows;
  if (candidates.length === 0) return null;

  // Completion gate (2026-07-06 · P1-40/P1-54) · workout-relative, not a
  // flat 4mi: a single canonical run ≥ completionThresholdMi(prescribed)
  // within ±1d counts as done. Per-RUN max, not day-sum — two 3mi jogs
  // don't add up to an 8mi tempo.
  // Phase B · one canonical dedup. A dupe in the window would otherwise
  // wrongly mark a completed key workout as done twice / missed never.
  const canonicalIds = await getCanonicalRunIds(userId, isoDaysBefore(today, 8), today);
  const maxRunByDay = new Map<string, number>();
  if (canonicalIds.length > 0) {
    const runRows = (await pool.query<{ d: string; mi: string }>(
      `SELECT (data->>'date') AS d, (data->>'distanceMi') AS mi
         FROM runs
        WHERE user_uuid = $1 AND id = ANY($2::bigint[])`,
      [userId, canonicalIds]
    )).rows;
    for (const r of runRows) {
      if (!r.d) continue;
      const mi = Number(r.mi) || 0;
      if (mi > (maxRunByDay.get(r.d) ?? 0)) maxRunByDay.set(r.d, mi);
    }
  }
  const completedNear = (dateISO: string, thresholdMi: number): boolean => {
    for (const off of [-1, 0, 1]) {
      if ((maxRunByDay.get(plusDaysISO(dateISO, off)) ?? 0) >= thresholdMi) return true;
    }
    return false;
  };

  const longMisses: MissedCandidate[] = [];
  const drops: MissedCandidate[] = [];
  const rescheduable: MissedCandidate[] = [];
  for (const c of candidates) {
    const distanceMi = c.distance_mi != null ? Number(c.distance_mi) : null;
    if (completedNear(c.date, completionThresholdMi(distanceMi))) continue;
    const rec: MissedCandidate = {
      workout_id: c.id, planned_date: c.date, type: c.type, distance_mi: distanceMi,
    };
    if (c.type === 'long') {
      // P1-39 · missed long runs are DATA, never rescheduled — the long
      // is not crammable; it feeds the layoff/volume picture instead.
      longMisses.push(rec);
    } else if (isStaleMissed(c.original_date_iso ?? c.date, today)) {
      // P1-38 · staleness expiry · >3 days past its ORIGINAL date.
      drops.push(rec);
    } else {
      rescheduable.push(rec);
    }
  }
  if (longMisses.length === 0 && drops.length === 0 && rescheduable.length === 0) return null;

  // One reschedule per pass, the most recent miss. Older fresh misses
  // drop as data — reinserting two quality sessions into one week is
  // exactly the stacking the doctrine forbids.
  const primary = rescheduable[0] ?? null;
  for (const extra of rescheduable.slice(1)) drops.push(extra);

  const reason = primary
    ? `${primary.type} on ${primary.planned_date} appears uncompleted.`
    : `${drops.length + longMisses.length} planned session${drops.length + longMisses.length === 1 ? '' : 's'} passed uncompleted. Recorded, not rescheduled.`;
  return {
    kind: 'missed_key_workout',
    severity: 'warn',
    reason,
    evidence: {
      // primary rescheduable (legacy field names preserved for consumers)
      workout_id: primary?.workout_id ?? null,
      planned_date: primary?.planned_date ?? null,
      type: primary?.type ?? null,
      distance_mi: primary?.distance_mi ?? null,
      drops,
      long_misses: longMisses,
    },
  };
}

/**
 * TRAINING_GAP (2026-07-06 · P1-36) · layoff/comeback detector.
 *
 * Gap = consecutive no-run days since the last canonical run
 * (getCanonicalRunIds dedup via mileageByDay — an unflagged dupe can't
 * fake a run, a merged row can't hide one). daysOff counts yesterday
 * back to the day after the last run; today is excluded because the
 * cron fires at 00:15 PT, before anyone has run.
 *
 * Bands (classifyGapBand · Research/22-plan-templates.md §14 lines
 * 628-651 + Research/01-pace-zones-vdot.md:319-320):
 *   4-7 daysOff   → easy_swap        (resume plan, first quality → easy)
 *   8-14 daysOff  → shave_70_85      (70% week 1, 85% week 2, no intensity wk 1)
 *   >14 daysOff   → rebuild_propose  (propose-only · rebuild + VDOT haircut)
 *
 * Idempotent across daily crons: fires at most once per (gap, band) —
 * the applied actions write a 'plan_adapt_gap' marker keyed on
 * lastRunISO, and this detector skips when a marker for the same gap
 * at the same-or-higher band exists (gapAlreadyHandled). Band
 * escalation (the gap keeps growing) fires once more.
 *
 * Cold start: zero canonical runs in the 60d lookback → return null.
 * A brand-new runner who hasn't started isn't "returning from layoff";
 * that's calibration territory (generate.ts), not the adapter's.
 */
async function detectTrainingGap(userId: string): Promise<AdaptationTrigger | null> {
  const today = await runnerToday(userId);
  const byDay = await mileageByDay(userId, isoDaysBefore(today, 60), today)
    .catch(() => new Map<string, { mi: number; canonicalIds: string[] }>());
  let lastRunISO: string | null = null;
  for (const [day, v] of byDay) {
    if (v.mi > 0 && (lastRunISO === null || day > lastRunISO)) lastRunISO = day;
  }
  if (!lastRunISO) return null;

  const daysOff = daysBetweenISO(lastRunISO, today) - 1;
  const band = classifyGapBand(daysOff);
  if (band === 'none') return null;

  // Idempotency · read prior gap markers (60d window covers any gap the
  // 60d run-lookback can produce) and skip if this (gap, band) — or a
  // higher band on the same gap — was already handled.
  const priorRows = (await pool.query<{ value: string | null }>(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason = 'plan_adapt_gap'
        AND ts >= NOW() - INTERVAL '60 days'`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ value: string | null }> }))).rows;
  const handled: Array<{ lastRunISO?: unknown; band?: unknown }> = [];
  for (const row of priorRows) {
    try {
      const v = row.value ? JSON.parse(row.value) : null;
      if (v && typeof v === 'object') handled.push(v);
    } catch { /* malformed marker → ignore */ }
  }
  if (gapAlreadyHandled(handled, lastRunISO, band)) return null;

  const reason =
    band === 'rebuild_propose'
      ? `No running for ${daysOff} days. Plan rebuild recommended before resuming.`
      : band === 'shave_70_85'
        ? `No running for ${daysOff} days. Re-entry weeks reduced to 70% then 85%.`
        : `No running for ${daysOff} days. First quality back becomes easy.`;
  return {
    kind: 'training_gap',
    severity: band === 'rebuild_propose' ? 'override' : 'warn',
    reason,
    evidence: { last_run_iso: lastRunISO, days_off: daysOff, band },
  };
}

/**
 * Multi-signal readiness check via the readiness brief (2026-06-01).
 *
 * Replaces detectRhrSpike + detectSleepCrater + any other single-pillar
 * heuristic. Reads the full brief (5 pillars + Plews HRV + 3-day streak
 * persistence) and fires ONLY when:
 *
 *   · band === 'pull-back' (composite score < 50 · multiple pillars
 *     simultaneously degraded · per Research/15 §Recovery-Scores)  // was §interpretation · heading: ## Recovery Scores > ### Interpretation rules
 *
 *   OR
 *
 *   · ≥1 active streak (per Research/15 Plews approach · 3-day
 *     persistence is the actionable signal · single-day swings are
 *     noise)
 *
 * Severity ladder:
 *   · 'override' when band='pull-back' OR ≥2 active streaks
 *   · 'warn'      when ≥1 streak only
 *
 * The action handler (see actionsForTrigger) targets only TODAY's
 * workout · never reaches forward 2+ days to decide a future quality
 * day from yesterday's data.
 */
async function detectReadinessPullback(userId: string): Promise<AdaptationTrigger | null> {
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { loadReadinessBrief } = await import('@/lib/coach/readiness-brief');
    const { tierRulesFor, HARD_RULES } = await import('@/lib/coach/tier-rules');
    const state = await loadCoachState(userId);
    if (!state) return null;
    const brief = await loadReadinessBrief(userId, state);
    if (!brief) return null;

    // 2026-06-03 · tier-aware thresholds. Same rules as the Health
    // page WHAT TO DO panel (lib/coach/health-actions.ts) · plan and
    // panel must agree. Per David: "I think the plan adjustments and
    // flags should be dependent on the level of the runner. So
    // advanced maybe let the runner push through things more?"
    //
    // Advanced runners require:
    //   · sustained pull-back (3+ consecutive days < 40), OR
    //   · streak ≥ 5 days, OR
    //   · 2+ simultaneous streaks ≥ 5 days each
    // Beginners/intermediate: 2+ days pull-back OR streak ≥ 3 days.
    //
    // HARD RULES (always fire regardless of tier):
    //   · 7-day sustained pull-back · trumps any tier setting
    //   · We don't gate the streak detector itself · it still emits
    //     3-day streaks for the streaks panel. Just the plan-adjust
    //     trigger waits for the tier threshold before downgrading.
    const tier = state.profile?.experience_level ?? null;
    const rules = tierRulesFor(tier);

    const streaks = brief.streaks ?? [];
    const scoreTrend = brief.scoreTrend ?? [];
    const recentScores = scoreTrend.slice(-rules.pullbackConsecutiveDays).map((s) => s.score);
    const sustainedPullBack = recentScores.length >= rules.pullbackConsecutiveDays
      && recentScores.every((s) => s < 40);

    // 7-day hard rule · pull-back sustained that long forces an
    // adaptation regardless of tier.
    const last7Scores = scoreTrend.slice(-HARD_RULES.pullbackForcedAck).map((s) => s.score);
    const forcedByHardRule = last7Scores.length === HARD_RULES.pullbackForcedAck
      && last7Scores.every((s) => s < 40);

    // Streaks gated by tier minimum AND by pillar.
    //
    // 2026-06-04 · SLEEP streaks excluded from plan-adapt triggers
    // (David's "why did my plan change in the middle of the night???").
    // Sleep is a BEHAVIORAL lever the runner controls · short sleep
    // weeks are life, not fitness drift. Plan adapts to what the body
    // shows in response to TRAINING (HRV / RHR / hr_recovery / load),
    // not to lifestyle inputs. Sleep still surfaces in the streaks
    // panel + WHAT TO DO actions (where it's a behavioral nudge, not
    // an auto-downgrade trigger).
    //
    // The bar for "plan should change" is objective body response,
    // not behavioral input. A runner sleeping poorly for a week
    // doesn't need their quality session moved · they need a heads-up
    // about the sleep itself. Their body will tell us via HRV/RHR if
    // it's actually compromising training.
    const adapterRelevantPillars = new Set(['hrv', 'rhr', 'hr_recovery', 'load']);
    const tierStreaks = streaks.filter((s) =>
      s.days >= rules.streakDaysMin && adapterRelevantPillars.has(s.pillar)
    );
    const hasTieredStreak = tierStreaks.length > 0;

    // 2026-08-17 · SUBJECTIVE pillar (coach-experience pass). A WRECKED-
    // equivalent POST-RUN read (RPE ≥ 8 / rating 'wrecked' / body chip
    // 'cooked') on a day that was PLANNED EASY joins the objective
    // evidence — extending the Saw et al. subjective-override doctrine
    // readiness-brief.ts already applies to the morning prescription
    // (composePrescription, "subjective wins on the day") into the
    // adapter read. An easy day should not wreck the runner; when it
    // does, the runner's own report is evidence the objective pillars
    // may not show until tomorrow. Same propose-first banner as every
    // pullback action (PROPOSE_FIRST_TRIGGERS) — the runner gates it.
    // Quality/long days are excluded on purpose: those are ALLOWED to
    // read hard. See lib/coach/acknowledge.ts subjectivePullbackSignal.
    let subjectiveFired = false;
    let subjectiveReason: string | null = null;
    let subjectiveDetail: Record<string, unknown> | null = null;
    try {
      const { loadYesterdaySignals, subjectivePullbackSignal } = await import('@/lib/coach/acknowledge');
      const sub = subjectivePullbackSignal(await loadYesterdaySignals(userId));
      subjectiveFired = sub.fired;
      subjectiveReason = sub.reason;
      subjectiveDetail = sub.detail as Record<string, unknown> | null;
    } catch { /* best-effort · objective pillars still decide */ }

    if (!sustainedPullBack && !hasTieredStreak && !forcedByHardRule && !subjectiveFired) return null;

    // Reason · what TRULY tripped, in plain English.
    const reasonParts: string[] = [];
    if (tierStreaks.length > 0) {
      const s = tierStreaks[0];
      reasonParts.push(`${s.pillar.toUpperCase()} ${s.direction} ${s.days} days running`);
    }
    if (forcedByHardRule) {
      reasonParts.push(`pull-back band sustained ${HARD_RULES.pullbackForcedAck} days (hard rule)`);
    } else if (sustainedPullBack) {
      reasonParts.push(`pull-back band sustained ${recentScores.length} days · score ${brief.score}/100`);
    }
    if (subjectiveFired && subjectiveReason) {
      reasonParts.push(subjectiveReason);
    }

    // Severity ladder: hard-rule sustained pull-back OR 2+ tier-streaks → override.
    // Single tier-streak OR shorter sustained pull-back → warn (softer adjust).
    // Subjective + any objective signal agreeing → override (the two
    // disagree-free case is exactly when Saw et al. say act); subjective
    // alone → warn (propose-first · runner gates it anyway).
    const severity: 'warn' | 'override' = (
      forcedByHardRule
      || tierStreaks.length >= 2
      || (sustainedPullBack && tierStreaks.length >= 1)
      || (subjectiveFired && (hasTieredStreak || sustainedPullBack))
    )
      ? 'override'
      : 'warn';

    return {
      kind: 'readiness_pullback',
      severity,
      reason: `Readiness pullback · ${reasonParts.join(' + ')}.`,
      evidence: {
        score: brief.score,
        band: brief.band,
        tier: tier ?? 'intermediate',
        streaks: tierStreaks.map((s) => ({ pillar: s.pillar, direction: s.direction, days: s.days })),
        sustainedPullBackDays: sustainedPullBack ? recentScores.length : 0,
        forcedByHardRule,
        subjective: subjectiveFired ? (subjectiveDetail ?? {}) : null,
        headline: brief.headline,
      },
    };
  } catch (e) {
    console.warn('[adapt] detectReadinessPullback failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function detectRhrSpike(userId: string): Promise<AdaptationTrigger | null> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  const r = (await pool.query(
    `WITH recent AS (
       SELECT AVG(value) AS avg3 FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND sample_date >= $2::date - 3
     ), baseline AS (
       SELECT AVG(value) AS avg14 FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND sample_date BETWEEN $2::date - 17 AND $2::date - 4
     )
     SELECT recent.avg3, baseline.avg14,
            recent.avg3 - baseline.avg14 AS delta
       FROM recent, baseline`,
    [userId, today]
  )).rows[0];
  if (!r || r.avg3 == null || r.avg14 == null) return null;
  const delta = Number(r.delta);
  if (delta >= 7) {
    return {
      kind: 'rhr_spike',
      severity: delta >= 10 ? 'override' : 'warn',
      reason: `Resting HR averaging ${Math.round(Number(r.avg3))} bpm, ${Math.round(delta)} above 14-day baseline.`,
      evidence: { avg3: Number(r.avg3), avg14: Number(r.avg14), delta },
    };
  }
  return null;
}

async function detectSleepCrater(userId: string): Promise<AdaptationTrigger | null> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  const r = (await pool.query(
    `SELECT COUNT(*) AS bad_nights
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
        AND sample_date >= $2::date - 3
        AND value < 5`,
    [userId, today]
  )).rows[0];
  const n = Number(r?.bad_nights ?? 0);
  if (n >= 2) {
    return {
      kind: 'sleep_crater',
      severity: 'override',
      reason: `${n} nights < 5h sleep in the last 3 days.`,
      evidence: { bad_nights: n },
    };
  }
  return null;
}

/**
 * Q-04 default · NIGGLE_REPORTED triggers when an active niggle (cleared_at
 * IS NULL) crosses severity thresholds. Graduated response per
 * Research/05-injury-return-protocols.md §1.2-Pain-Monitoring-Rules:  // was §Pain-Stop-Rules · heading: ### 1.2 Pain Monitoring Rules
 *   - severity 5-6 → 'warn' · downgrade next quality day to easy
 *   - severity ≥ 7 → 'override' · suspend running for ~48h
 *
 * Cite: Research/05-injury-return-protocols.md §1.2-Pain-Monitoring-Rules (5/10
 *       interrupts the planned session; 7/10 rests the area).  // was §Pain-Stop-Rules · heading: ### 1.2 Pain Monitoring Rules
 */
async function detectNiggleReported(userId: string): Promise<AdaptationTrigger | null> {
  // Post-126: niggles uses canonical user_uuid. user_id (also uuid) kept
  // for backward compat — COALESCE so unbackfilled rows still match.
  const r = (await pool.query(
    `SELECT id, body_part, side, severity, status, logged_at::text AS logged_at
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY severity DESC, logged_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const severity = Number(r.severity);
  if (severity < 5) return null;
  return {
    kind: 'niggle_reported',
    severity: severity >= 7 ? 'override' : 'warn',
    reason: severity >= 7
      ? `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Suspend running 48h.`
      : `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Downgrade next quality day.`,
    evidence: { niggle_id: r.id, body_part: r.body_part, side: r.side, severity, status: r.status },
  };
}

/**
 * Q-03 default · SICK_EPISODE_ACTIVE triggers when sick_episodes.cleared_at
 * IS NULL. By doctrine we DO NOT auto-modify the plan for illness — runner
 * agency matters. The trigger fires; actionsForTrigger writes a
 * coach_proposals row that the runner accepts/rejects from the UI.
 *
 * Cite: Research/05-injury-return-protocols.md §illness-return (above-the-
 *       neck cold = run easy; below-the-neck OR fever = no running).
 *       // TODO: no matching heading in Research/05 — illness protocol content not anchored
 */
async function detectSickEpisodeActive(userId: string): Promise<AdaptationTrigger | null> {
  // Post-126: sick_episodes uses canonical user_uuid.
  const r = (await pool.query(
    `SELECT id, symptoms, has_fever, started, logged_at::text AS logged_at
       FROM sick_episodes
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  return {
    kind: 'sick_episode_active',
    severity: r.has_fever ? 'override' : 'warn',
    reason: r.has_fever
      ? 'Active illness with fever. Suspend running entirely until cleared.'
      : 'Active illness reported. Above-the-neck symptoms: easy running only.',
    evidence: {
      episode_id: r.id,
      has_fever: !!r.has_fever,
      symptoms: r.symptoms,
      started: r.started,
    },
  };
}

/**
 * Q-08 default · INJURY_ACTIVE triggers when `runner_injuries.resolved_date
 * IS NULL`. Like SICK_EPISODE_ACTIVE, this is a propose-only trigger —
 * the runner accepts/rejects the modified plan from the UI. Severity:
 * 'override' if severity in (moderate, major); 'warn' if 'minor'.
 *
 * Cite: Research/05-injury-return-protocols.md §General-Principles
 *       (pain ≥ 5/10 stops the session; structured return phases).
 */
async function detectInjuryActive(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query(
    `SELECT id, site, severity, return_protocol, start_date::text AS start_date
       FROM runner_injuries
      WHERE user_uuid = $1 AND resolved_date IS NULL
      ORDER BY start_date DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const severe = r.severity === 'moderate' || r.severity === 'major';
  return {
    kind: 'injury_active',
    severity: severe ? 'override' : 'warn',
    reason: severe
      ? `Active ${r.site} injury (${r.severity}). Switch to INJURY-mode walk-run + cross-train.`
      : `Active ${r.site} injury (minor). Drop quality; easy mileage only with daily pain check.`,
    evidence: {
      injury_id: r.id,
      site: r.site,
      severity: r.severity,
      return_protocol: r.return_protocol,
      start_date: r.start_date,
    },
  };
}

/**
 * GOAL_CHANGED · runner edited their goal time OR accepted an adaptive-
 * VDOT bump (vdot_manual_override set). Either way, the active plan's
 * pace targets were derived from old numbers and need recompute.
 *
 * Detection:
 *   - users.vdot_manual_override_at within last 24h, OR
 *   - profile.goal_race_time changed within last 24h (we don't track
 *     change history, so we approximate via profile.updated_at vs the
 *     active plan's authored_iso — if profile was edited AFTER the plan
 *     was authored, the goal likely changed since)
 *
 * Action: mark next 14d plan_workouts as paces-stale (same as PR_BANK).
 *
 * Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces  // was §VDOT-recalibrate · heading: ## How to recalibrate paces (pace derivation
 *       from goal time / VDOT changes invalidate prior prescriptions).
 */
async function detectGoalChanged(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query<{
    vdot_override_at: string | null;
    profile_updated_at: string | null;
    plan_authored_at: string | null;
  }>(
    `SELECT u.vdot_manual_override_at::text AS vdot_override_at,
            p.updated_at::text             AS profile_updated_at,
            tp.authored_iso::text          AS plan_authored_at
       FROM users u
       LEFT JOIN profile p ON p.user_uuid = u.id
       LEFT JOIN training_plans tp
              ON tp.user_uuid = u.id AND tp.archived_iso IS NULL
      WHERE u.id = $1
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;

  const now = Date.now();
  const vdotOverrideAt = r.vdot_override_at ? Date.parse(r.vdot_override_at) : 0;
  const profileUpdatedAt = r.profile_updated_at ? Date.parse(r.profile_updated_at) : 0;
  const planAuthoredAt = r.plan_authored_at ? Date.parse(r.plan_authored_at) : 0;

  const vdotChangedRecent = vdotOverrideAt > 0 && (now - vdotOverrideAt) < 24 * 3600 * 1000;
  const profileChangedAfterPlan = profileUpdatedAt > planAuthoredAt && (now - profileUpdatedAt) < 24 * 3600 * 1000;

  if (!vdotChangedRecent && !profileChangedAfterPlan) return null;

  return {
    kind: 'goal_changed',
    severity: 'info',
    reason: vdotChangedRecent
      ? 'VDOT override applied. Plan paces derive from old VDOT; recompute next 14d.'
      : 'Profile updated after plan authored. Plan paces may be stale.',
    evidence: {
      vdot_override_at: r.vdot_override_at,
      profile_updated_at: r.profile_updated_at,
      plan_authored_at: r.plan_authored_at,
    },
  };
}

/**
 * PR_BANK · recent race finish whose VDOT exceeds users.vdot_last_reviewed
 * by > 1.5 pts. Action: mark next 14d plan_workouts as paces-stale so the
 * runner's prescription gets recomputed off the new VDOT before the next
 * quality session. Cite: Research/01-pace-zones-vdot.md §Recalibrate-Paces  // was §VDOT-recalibrate · heading: ## How to recalibrate paces.
 */
async function detectPrBank(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query<{
    new_vdot: number | null;
    old_vdot: number | null;
    slug: string | null;
    raced_at: string | null;
  }>(
    `WITH last_review AS (
       SELECT vdot_last_reviewed::numeric AS old_vdot FROM users WHERE id = $1
     )
     SELECT u.old_vdot
       FROM last_review u`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || r.old_vdot == null) return null;

  // Find races in last 14d, A/B priority, with a finishS — derive VDOT
  // and compare to old_vdot.
  const recent = (await pool.query<{
    slug: string;
    date: string;
    distance_mi: string | null;
    finish_s: string | null;
  }>(
    `SELECT slug,
            meta->>'date' AS date,
            (meta->>'distanceMi')::numeric::text AS distance_mi,
            actual_result->>'finishS' AS finish_s
       FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'date')::date >= $2::date - 14
        AND (meta->>'date')::date < $2::date
        AND actual_result->>'finishS' IS NOT NULL
      ORDER BY (meta->>'date') DESC LIMIT 3`,
    [userId, await runnerToday(userId)],
  ).catch(() => ({ rows: [] }))).rows;
  if (recent.length === 0) return null;

  // Lazy-import vdotFromRace; same file group, no cycle.
  const { vdotFromRace } = await import('../training/vdot');
  let bestNewVdot = 0;
  let bestSlug = '';
  let bestDate = '';
  for (const raceRow of recent) {
    const fs = raceRow.finish_s ? Number(raceRow.finish_s) : 0;
    const mi = raceRow.distance_mi ? Number(raceRow.distance_mi) : 0;
    const v = fs > 0 && mi > 0 ? vdotFromRace(fs, mi) : null;
    if (v != null && v > bestNewVdot) {
      bestNewVdot = v;
      bestSlug = raceRow.slug;
      bestDate = raceRow.date;
    }
  }
  const oldVdot = Number(r.old_vdot);
  const delta = bestNewVdot - oldVdot;
  if (delta <= 1.5) return null;
  return {
    kind: 'pr_bank',
    severity: 'info',
    reason: `New race fitness · VDOT ${bestNewVdot.toFixed(1)} vs prior ${oldVdot.toFixed(1)} (+${delta.toFixed(1)}). Paces need recompute.`,
    evidence: {
      new_vdot: bestNewVdot,
      old_vdot: oldVdot,
      delta,
      race_slug: bestSlug,
      raced_at: bestDate,
    },
  };
}

/**
 * FIELD_TEST_DUE (2026-08-17) · fitness-signal staleness detector.
 *
 * Doctrine · Research/01-pace-zones-vdot.md:
 *   · :679-681 — "Daniels recommends reassessing fitness every 4-6 weeks
 *     during a build ... when [natural test opportunities] don't,
 *     prescribe a deliberate test."
 *   · :684-686 — trigger table: "≥6 weeks since last race or test →
 *     Schedule a 5K time trial or 30-min TT."
 *   · :700-703 — protocol 2: "30-minute time trial — surfaces threshold
 *     pace directly (last 20 min average pace ≈ LT pace)."
 *   · :708-710 — "plan the test as a *workout* in the runner's week
 *     (replacing a quality session, not added on top)."
 *
 * Fires when ALL of:
 *   · no race RESULT within the last 42 days
 *   · no field test (sub_label 'FIELD TEST') completed/scheduled within
 *     42 days back or 7 days forward, and no field-test proposal (any
 *     status) written within 42 days — a declined test is respected for
 *     the whole window, never re-nagged
 *   · a convertible quality slot exists in the next 7 days
 *   · no A race within the next 21 days (test load doesn't belong in a
 *     taper), and no race at all within the next 14 days (the race IS
 *     the natural test · :680-681)
 *   · the active plan is ≥14 days old (a fresh plan's paces were just
 *     calibrated from onboarding/measured inputs)
 *
 * Propose-first (PROPOSE_FIRST_TRIGGERS): the runner can decline.
 */

/** Pure gate evaluation for the field-test detector · exported so the
 *  gating windows are locked by tests independent of the SQL shell.
 *  Truthy blocker fields are the raw MAX()/MIN() reads from the shell. */
export function fieldTestGate(g: {
  /** most recent race result date within [today-42, today] · null = none */
  recentResultISO: string | null;
  /** most recent FIELD TEST row date within [today-42, today+7] */
  recentTestISO: string | null;
  /** any field_test proposal (any status) written within 42d */
  recentProposalAt: string | null;
  /** any plan_adapt_field_test intent within 42d */
  recentIntentAt: string | null;
  /** earliest race of any priority within [today, today+14] */
  upcomingRaceISO: string | null;
  /** earliest A race within [today, today+21] */
  upcomingARaceISO: string | null;
  /** active plan age in days · null = no active plan */
  planAgeDays: number | null;
}): { ok: boolean; blockedBy: string | null } {
  if (g.recentResultISO) return { ok: false, blockedBy: 'recent_race_result' };
  if (g.recentTestISO) return { ok: false, blockedBy: 'recent_field_test' };
  if (g.recentProposalAt) return { ok: false, blockedBy: 'recent_proposal' };
  if (g.recentIntentAt) return { ok: false, blockedBy: 'recent_intent' };
  if (g.upcomingRaceISO) return { ok: false, blockedBy: 'race_within_14d' };
  if (g.upcomingARaceISO) return { ok: false, blockedBy: 'a_race_within_21d' };
  if (g.planAgeDays == null || !Number.isFinite(g.planAgeDays) || g.planAgeDays < 14) {
    return { ok: false, blockedBy: 'plan_too_fresh' };
  }
  return { ok: true, blockedBy: null };
}

async function detectFieldTestDue(userId: string): Promise<AdaptationTrigger | null> {
  const today = await runnerToday(userId);
  try {
    const gate = (await pool.query<{
      recent_result: string | null;
      recent_test: string | null;
      recent_proposal: string | null;
      recent_intent: string | null;
      upcoming_race_14: string | null;
      upcoming_a_21: string | null;
      plan_age_days: string | null;
    }>(
      `SELECT
         (SELECT MAX(meta->>'date') FROM races
           WHERE user_uuid = $1::uuid
             AND actual_result->>'finishS' IS NOT NULL
             AND (meta->>'date')::date >= $2::date - 42
             AND (meta->>'date')::date <= $2::date)          AS recent_result,
         (SELECT MAX(pw.date_iso::text) FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1 AND pw.sub_label = 'FIELD TEST'
            AND pw.date_iso::date BETWEEN $2::date - 42 AND $2::date + 7) AS recent_test,
         (SELECT MAX(created_at::text) FROM plan_workout_proposals
           WHERE user_uuid = $1::uuid AND action_kind = 'field_test'
             AND created_at >= NOW() - INTERVAL '42 days')   AS recent_proposal,
         (SELECT MAX(ts::text) FROM coach_intents
           WHERE COALESCE(user_uuid, user_id) = $1::uuid
             AND reason = 'plan_adapt_field_test'
             AND ts >= NOW() - INTERVAL '42 days')           AS recent_intent,
         (SELECT MIN(meta->>'date') FROM races
           WHERE user_uuid = $1::uuid
             AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 14) AS upcoming_race_14,
         (SELECT MIN(meta->>'date') FROM races
           WHERE user_uuid = $1::uuid AND meta->>'priority' = 'A'
             AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 21) AS upcoming_a_21,
         (SELECT ($2::date - MAX(authored_iso::date))::text FROM training_plans
           WHERE user_uuid = $1 AND archived_iso IS NULL)    AS plan_age_days`,
      [userId, today],
    )).rows[0];
    if (!gate) return null;
    const gateResult = fieldTestGate({
      recentResultISO: gate.recent_result,
      recentTestISO: gate.recent_test,
      recentProposalAt: gate.recent_proposal,
      recentIntentAt: gate.recent_intent,
      upcomingRaceISO: gate.upcoming_race_14,
      upcomingARaceISO: gate.upcoming_a_21,
      planAgeDays: gate.plan_age_days != null ? Number(gate.plan_age_days) : null,
    });
    if (!gateResult.ok) return null;

    // Convertible quality slot in the next 7 days · earliest wins. Race-week
    // rows excluded (per-finding context filter — race machinery owns them).
    const slot = (await pool.query<{ id: string; date: string; type: string; distance_mi: string | null }>(
      `SELECT pw.id, pw.date_iso::date::text AS date, pw.type, pw.distance_mi::text AS distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
         LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.type IN ('threshold','tempo','intervals','vo2max')
          AND pw.date_iso::date BETWEEN $2::date + 1 AND $2::date + 7
          AND COALESCE(wk.is_race_week, false) = false
        ORDER BY pw.date_iso::date ASC LIMIT 1`,
      [userId, today],
    )).rows[0];
    if (!slot) return null;

    return {
      kind: 'field_test_due',
      severity: 'info',
      reason: `No race or field test in the last 6 weeks. Pace anchors are going stale. Convert ${slot.date}'s quality session to a 30-minute threshold field test to lock in current fitness.`,
      evidence: {
        workout_id: slot.id,
        planned_date: slot.date,
        planned_type: slot.type,
        planned_distance_mi: slot.distance_mi != null ? Number(slot.distance_mi) : null,
        citation: 'Research/01-pace-zones-vdot.md:684-686 + :700-703',
      },
    };
  } catch (e) {
    console.warn('[adapt] detectFieldTestDue failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ── FITNESS_REGRESSION · symmetric downward re-anchor (2026-08-17) ─────

/** Same magnitude as pr_bank's upward gate · Research/01:316-317 puts a
 *  single "tempo unexpectedly hard" signal at −1 to −2 VDOT, so 1.5 is
 *  one honest evidence step in either direction. Exported for the
 *  invariants suite. */
export const REGRESSION_DELTA_THRESHOLD = 1.5;

/** Pure firing predicate · fires when evidence VDOT sits more than the
 *  threshold BELOW the last-reviewed anchor. Exported for tests. */
export function fitnessRegressionFires(
  oldVdot: number | null | undefined,
  evidenceVdot: number | null | undefined,
): boolean {
  if (oldVdot == null || evidenceVdot == null) return false;
  if (!Number.isFinite(oldVdot) || !Number.isFinite(evidenceVdot)) return false;
  return evidenceVdot - oldVdot < -REGRESSION_DELTA_THRESHOLD;
}

/**
 * FITNESS_REGRESSION · the missing mirror of PR_BANK. pr_bank only ever
 * fired on delta > +1.5, so a runner whose fitness DROPPED kept getting
 * paces anchored to the stale (faster) VDOT — the exact "prescribing
 * paces the runner cannot run" failure the honest-paces doctrine forbids.
 *
 * Evidence, in priority order:
 *   1. RACE · best A/B race finish in the last 14d whose derived VDOT is
 *      < anchor − 1.5. Auto-applies (David: "watch time IS the result").
 *      Cite: Research/01:311 (new race result → update VDOT from race —
 *      the row doesn't say "only if faster").
 *   2. TRAINING DRIFT · 28 days of projection snapshots (the measured
 *      bestRecentVdot chain) whose BEST reading is < anchor − 1.5, with
 *      ≥8 snapshot days so one bad week can't re-anchor a season.
 *      Propose-first (a rebuild the runner gates).
 *      Cite: Research/01:316-317 (−1 to −2 on sustained hard-tempo
 *      evidence) + :659-677 (freshness window · the old anchor is a
 *      floor, prompt a re-read, don't keep prescribing off it).
 *
 * Anchor cascade: users.vdot_last_reviewed → the active plan's
 * pace_recompute.vdot → pace_blend.season_anchor_vdot → derived_from.
 * bestRecentVdot (so the detector works even on schemas where
 * vdot_last_reviewed was never populated — which is why pr_bank has been
 * dormant for most runners).
 *
 * Per-finding context filter (CLAUDE.md round 4): suppressed within 7
 * days BEFORE a race — taper conservation legitimately reads slow, and
 * race-week pacing belongs to the race machinery, not a re-anchor.
 */
async function detectFitnessRegression(userId: string): Promise<AdaptationTrigger | null> {
  const today = await runnerToday(userId);

  // Race within the next 7 days → suppress (taper/race-week filter).
  const upcoming = await pool.query(
    `SELECT 1 FROM races
      WHERE user_uuid = $1::uuid
        AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 7
      LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as unknown[] }));
  if (upcoming.rows.length > 0) return null;

  // Anchor VDOT · reviewed column first, then the active plan's
  // authored_state fallbacks (see cascade note above).
  const anchorRow = (await pool.query<{ reviewed: string | null; authored_state: Record<string, unknown> | null }>(
    `SELECT (SELECT vdot_last_reviewed::numeric::text FROM users WHERE id = $1::uuid) AS reviewed,
            tp.authored_state
       FROM training_plans tp
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
      ORDER BY tp.authored_iso DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!anchorRow) return null;
  const st = (anchorRow.authored_state ?? {}) as Record<string, any>;
  const oldVdot: number | null =
    (anchorRow.reviewed != null ? Number(anchorRow.reviewed) : null)
    ?? (st.pace_recompute?.vdot != null ? Number(st.pace_recompute.vdot) : null)
    ?? (st.pace_blend?.season_anchor_vdot != null ? Number(st.pace_blend.season_anchor_vdot) : null)
    ?? (st.derived_from?.bestRecentVdot != null ? Number(st.derived_from.bestRecentVdot) : null);
  if (oldVdot == null || !Number.isFinite(oldVdot)) return null;

  const { vdotFromRace } = await import('../training/vdot');

  // 1. RACE evidence · best A/B finish in last 14d.
  const recent = (await pool.query<{
    slug: string; date: string; distance_mi: string | null; finish_s: string | null;
  }>(
    `SELECT slug,
            meta->>'date' AS date,
            (meta->>'distanceMi')::numeric::text AS distance_mi,
            actual_result->>'finishS' AS finish_s
       FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'date')::date >= $2::date - 14
        AND (meta->>'date')::date < $2::date
        AND actual_result->>'finishS' IS NOT NULL
      ORDER BY (meta->>'date') DESC LIMIT 3`,
    [userId, today],
  ).catch(() => ({ rows: [] }))).rows;
  let bestRaceVdot: number | null = null;
  let bestSlug = '';
  let bestDate = '';
  for (const raceRow of recent) {
    const fs = raceRow.finish_s ? Number(raceRow.finish_s) : 0;
    const mi = raceRow.distance_mi ? Number(raceRow.distance_mi) : 0;
    const v = fs > 0 && mi > 0 ? vdotFromRace(fs, mi) : null;
    if (v != null && (bestRaceVdot == null || v > bestRaceVdot)) {
      bestRaceVdot = v; bestSlug = raceRow.slug; bestDate = raceRow.date;
    }
  }
  if (bestRaceVdot != null && fitnessRegressionFires(oldVdot, bestRaceVdot)) {
    const delta = bestRaceVdot - oldVdot;
    return {
      kind: 'fitness_regression',
      severity: 'warn',
      reason: `Race read slower than the plan's anchor · VDOT ${bestRaceVdot.toFixed(1)} vs ${oldVdot.toFixed(1)} (${delta.toFixed(1)}). Paces re-anchor to the result.`,
      evidence: {
        source: 'race',
        new_vdot: bestRaceVdot,
        old_vdot: oldVdot,
        delta,
        race_slug: bestSlug,
        raced_at: bestDate,
      },
    };
  }

  // 2. TRAINING DRIFT · 28d of projection snapshots, best reading still
  //    below the anchor by more than the threshold, ≥8 snapshot days.
  const drift = (await pool.query<{ n: string; best: string | null }>(
    `SELECT COUNT(DISTINCT snapshot_date)::text AS n,
            MAX(vdot)::numeric::text AS best
       FROM projection_snapshots
      WHERE user_uuid = $1::uuid
        AND snapshot_date >= $2::date - 28
        AND vdot IS NOT NULL`,
    [userId, today],
  ).catch(() => ({ rows: [] }))).rows[0];
  const nDays = drift?.n != null ? Number(drift.n) : 0;
  const best28 = drift?.best != null ? Number(drift.best) : null;
  if (nDays >= 8 && best28 != null && fitnessRegressionFires(oldVdot, best28)) {
    const delta = best28 - oldVdot;
    return {
      kind: 'fitness_regression',
      severity: 'warn',
      reason: `28 days of training evidence reads VDOT ${best28.toFixed(1)} vs the plan's ${oldVdot.toFixed(1)} anchor (${delta.toFixed(1)}). Recommend re-anchoring paces to current fitness.`,
      evidence: {
        source: 'training_drift',
        new_vdot: best28,
        old_vdot: oldVdot,
        delta,
        snapshot_days: nDays,
      },
    };
  }
  return null;
}

async function detectVolumeOvershoot(userId: string): Promise<AdaptationTrigger | null> {
  const today = await runnerToday(userId);

  // 2026-07-06 · P1-55 · shave cooldown. The trigger reads COMPLETED
  // trailing volume, which stays elevated for days after a big week, so
  // without a cooldown each daily cron re-shaved the same overshoot
  // (worst live plans: 45-88 downgraded/shaved rows). One shave per
  // rolling 7 days, whatever its source (a gap re-entry shave counts —
  // the week is already reduced; don't cut it twice).
  const cooled = await pool.query(
    `SELECT 1 FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND reason = 'plan_adapt_shave'
        AND ts >= NOW() - INTERVAL '7 days'
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as unknown[] }));
  if (cooled.rows.length > 0) return null;

  // Per-finding context filter (CLAUDE.md locked 2026-05-19 round 4):
  // a race inside the trailing window legitimately spikes completed
  // volume (race + WU/CD on top of the week) — that's not an overshoot
  // to punish the recovery week for.
  const raced = await pool.query(
    `SELECT 1 FROM races
      WHERE user_uuid = $1::uuid
        AND (meta->>'date')::date BETWEEN $2::date - 7 AND $2::date
      LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as unknown[] }));
  if (raced.rows.length > 0) return null;

  // Last 7d completed volume vs what the ACTIVE PLAN scheduled for the
  // same trailing window (2026-07-06 · P1-55 · the plan's own
  // prescription is the baseline; the static experience cap contradicted
  // the generator's tier bands and fired on compliant runners).
  // 2026-06-02 · smart-dedup at 0.1 mi (was MAX-per-day · undercounted
  // legit same-day doubles). See lib/runs/volume.ts for the rule.
  const r = (await pool.query(
    `WITH dedup AS (
       SELECT (data->>'date')::date AS d,
              ROUND((data->>'distanceMi')::numeric, 1) AS bucket,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - 7
        GROUP BY 1, 2
     ), vol AS (
       SELECT COALESCE(SUM(mi), 0) AS mi FROM dedup
     ), sched AS (
       SELECT COALESCE(SUM(pw.distance_mi), 0) AS mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
          AND pw.date_iso::date BETWEEN $2::date - 7 AND $2::date - 1
          AND pw.type NOT IN ('rest', 'strength')
     ), p AS (
       SELECT experience_level FROM profile WHERE user_uuid = $1
     )
     SELECT vol.mi, sched.mi AS scheduled_mi, p.experience_level FROM vol, sched, p`,
    [userId, today]
  )).rows[0];
  if (!r) return null;
  const lvl = (r.experience_level ?? 'intermediate') as ExperienceLevel;
  const cap = EXPERIENCE_CAPS_MI[lvl];
  if (!cap) return null;
  const mi = Number(r.mi);
  const scheduledMi = r.scheduled_mi != null ? Number(r.scheduled_mi) : null;
  if (overshootFires(mi, scheduledMi, cap)) {
    const baseline = scheduledMi != null && scheduledMi >= 5 ? scheduledMi : cap;
    const baselineLabel = scheduledMi != null && scheduledMi >= 5
      ? `${Math.round(baseline)}mi scheduled`
      : `${lvl} cap ${cap}mi`;
    return {
      kind: 'volume_overshoot',
      severity: 'warn',
      reason: `Last 7d ${Math.round(mi)}mi exceeds ${baselineLabel} by >25%.`,
      evidence: { last7d_mi: mi, scheduled_7d_mi: scheduledMi, baseline_mi: baseline, cap, level: lvl },
    };
  }
  return null;
}

// ── Action builders ─────────────────────────────────────────────────────

async function actionsForTrigger(userId: string, t: AdaptationTrigger): Promise<AdaptationAction[]> {
  // 2026-06-03 · runner TZ used by every case below.
  const today = await runnerToday(userId);
  switch (t.kind) {
    case 'missed_key_workout': {
      // 2026-07-06 rewrite (P1-35/P1-38/P1-39/P1-46/P2-64/P2-67).
      const out: AdaptationAction[] = [];
      const ev = t.evidence as {
        workout_id: string | null; planned_date: string | null;
        type: string | null; distance_mi: number | null;
        drops?: MissedCandidate[]; long_misses?: MissedCandidate[];
      };

      // Data-only records first · stale/dropped quality and missed longs
      // become coach_intents rows (data, not debt). The intent record is
      // also what stops the detector re-emitting them tomorrow.
      for (const d of ev.drops ?? []) {
        out.push({
          kind: 'note',
          noteReason: 'plan_adapt_drop_missed',
          workoutIds: [d.workout_id],
          noteValue: { planned_date: d.planned_date, type: d.type, distance_mi: d.distance_mi },
          why: `${d.type} on ${d.planned_date} was missed and is past its window. Dropped, not rescheduled.`,
        });
      }
      for (const l of ev.long_misses ?? []) {
        out.push({
          kind: 'note',
          noteReason: 'plan_adapt_missed_noted',
          workoutIds: [l.workout_id],
          noteValue: { planned_date: l.planned_date, type: l.type, distance_mi: l.distance_mi },
          why: `Long run on ${l.planned_date} was missed. Recorded for the volume picture; long runs are never crammed back in.`,
        });
      }

      if (!ev.workout_id) return out;

      // ── Reschedule target search (chooseRescheduleDate guards) ──
      // Load the surrounding plan geometry once: rows [today-6, today+11]
      // cover per-day collision/adjacency context for candidates
      // today+1..today+4 AND full plan-week run counts for the frequency
      // check (a candidate's week can start up to 6 days earlier).
      const geo = (await pool.query<{
        id: string; date: string; type: string; dow: number | null;
        is_quality: boolean | null; is_long: boolean | null; plan_id: string;
      }>(
        `SELECT pw.id, pw.date_iso::date::text AS date, pw.type, pw.dow,
                pw.is_quality, pw.is_long, pw.plan_id
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
            AND pw.date_iso::date BETWEEN $2::date - 6 AND $2::date + 11`,
        [userId, today]
      )).rows;
      const planId = geo[0]?.plan_id ?? null;

      // Plan weeks covering the window → week window per candidate date.
      const weeks = planId ? (await pool.query<{ id: string; week_start_iso: string }>(
        `SELECT id, week_start_iso FROM plan_weeks
          WHERE plan_id = $1
            AND week_start_iso::date BETWEEN $2::date - 12 AND $2::date + 11`,
        [planId, today]
      )).rows : [];
      const weekStartFor = (dateISO: string): string | null => {
        for (const w of weeks) {
          if (w.week_start_iso <= dateISO && plusDaysISO(w.week_start_iso, 7) > dateISO) return w.week_start_iso;
        }
        return null;
      };

      const isRunRow = (ty: string) => ty !== 'rest' && ty !== 'strength';
      const byDate: Record<string, RescheduleDayContext> = {};
      for (let i = 0; i <= 5; i++) {
        const d = plusDaysISO(today, i);
        const rows = geo.filter((g) => g.date === d);
        const ws = weekStartFor(d);
        const weekRunCount = ws == null ? null : geo.filter((g) =>
          g.id !== ev.workout_id
          && isRunRow(g.type)
          && g.date >= ws && g.date < plusDaysISO(ws, 7)
        ).length;
        byDate[d] = {
          runCount: rows.filter((g) => isRunRow(g.type)).length,
          qualityOrLong: rows.some((g) =>
            g.is_quality === true || g.is_long === true || g.type === 'long'
            || (QUALITY_TYPES as readonly string[]).includes(g.type)),
          hasRestRow: rows.some((g) => g.type === 'rest'),
          weekRunCount,
        };
      }

      // Race dates · training_plans.race_id → races.meta.date, goal_iso
      // (goal-mode time trial), any other upcoming race row, plus race
      // rows materialized inside the plan itself (belt and braces).
      const raceRows = (await pool.query<{ date: string | null }>(
        `SELECT meta->>'date' AS date FROM races
          WHERE user_uuid = $1::uuid
            AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 60`,
        [userId, today]
      ).catch(() => ({ rows: [] as Array<{ date: string | null }> }))).rows;
      const goalIso = (await pool.query<{ goal_iso: string | null }>(
        `SELECT goal_iso FROM training_plans
          WHERE user_uuid = $1 AND archived_iso IS NULL LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] as Array<{ goal_iso: string | null }> }))).rows[0]?.goal_iso ?? null;
      const raceDates = [
        ...raceRows.map((r) => r.date).filter((d): d is string => !!d),
        ...(goalIso ? [goalIso.slice(0, 10)] : []),
        ...geo.filter((g) => (RACE_PROTECTED_TYPES as readonly string[]).includes(g.type)).map((g) => g.date),
      ];

      // Long-run day · plan rows are truer than the settings default
      // (David's settings are unset → default 'sun'; a runner whose plan
      // longs sit on Saturday would get the wrong block otherwise).
      const longDowCounts = new Map<number, number>();
      for (const g of geo) {
        if (g.type === 'long' || g.is_long === true) {
          const dw = g.dow ?? dowOfISO(g.date);
          longDowCounts.set(dw, (longDowCounts.get(dw) ?? 0) + 1);
        }
      }
      let longRunDow: number | null = null;
      for (const [dw, n] of longDowCounts) {
        if (longRunDow === null || n > (longDowCounts.get(longRunDow) ?? 0)) longRunDow = dw;
      }
      let restDow: number | null = null;
      let weeklyFrequency: number | null = null;
      try {
        const { loadSettings } = await import('@/lib/coach/settings');
        const settings = await loadSettings(userId);
        if (longRunDow === null) longRunDow = DOW_OF_SHORTCODE[settings.long_run_day] ?? null;
        restDow = DOW_OF_SHORTCODE[settings.rest_day] ?? null;
      } catch { /* settings unavailable → dow prefs skipped; plan rows still guard */ }
      try {
        const freqRow = (await pool.query<{ weekly_frequency: number | null }>(
          `SELECT weekly_frequency FROM profile WHERE user_uuid = $1::uuid LIMIT 1`,
          [userId]
        )).rows[0];
        weeklyFrequency = freqRow?.weekly_frequency ?? null;
      } catch { /* frequency unknown → check skipped */ }

      const target = chooseRescheduleDate({
        todayISO: today, byDate, longRunDow, restDow, weeklyFrequency, raceDates,
      });

      if (!target) {
        // No clear day in today+1..today+4 → the workout becomes data,
        // not debt (P1-35 fix note: never stack it somewhere it doesn't fit).
        out.push({
          kind: 'note',
          noteReason: 'plan_adapt_drop_missed',
          workoutIds: [ev.workout_id],
          noteValue: {
            planned_date: ev.planned_date, type: ev.type,
            distance_mi: ev.distance_mi, no_slot: true,
          },
          why: `${ev.type} on ${ev.planned_date} was missed and no clear day exists this week. Dropped, not rescheduled.`,
        });
        return out;
      }

      out.push({
        kind: 'reschedule',
        workoutIds: [ev.workout_id],
        newDate: target,
        why: `Reschedule missed quality day to ${target} (first clear day).`,
      });

      // Anti-stacking · the reschedule ADDS a quality day to the week, so
      // the next authored key steps down to easy. 2026-07-06 (P1-38) ·
      // never target the moved row itself, and never a row the adapter
      // previously rescheduled (self-cannibalization guard): destroying a
      // rescued session while keeping its volume was strictly worse than
      // doing nothing.
      const nextKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max')
             AND pw.date_iso::date BETWEEN $2::date AND $2::date + 7
             AND pw.id <> $3
             AND NOT EXISTS (
                   SELECT 1 FROM coach_intents ci
                    WHERE COALESCE(ci.user_uuid, ci.user_id) = $1::uuid
                      AND ci.field = pw.id
                      AND ci.reason = 'plan_adapt_reschedule'
                 )
           ORDER BY pw.date_iso::date ASC LIMIT 1`,
        [userId, today, ev.workout_id]
      )).rows[0];
      if (nextKey) {
        out.push({
          kind: 'downgrade',
          workoutIds: [nextKey.id],
          newType: 'easy',
          onlyIfRescheduledId: ev.workout_id,
          why: 'Avoid stacking two quality days; downgrade upcoming key to easy.',
        });
      }
      return out;
    }
    case 'training_gap': {
      // 2026-07-06 · P1-36 · comeback protocol. Load the next 14 days of
      // plan rows (with race-week flags) + race dates, hand to the pure
      // builder. Cite: Research/22-plan-templates.md §14 (628-651),
      // Research/01-pace-zones-vdot.md:319-320.
      const rows = (await pool.query<{
        id: string; date: string; type: string;
        distance_mi: string | null; in_race_week: boolean;
      }>(
        `SELECT pw.id, pw.date_iso::date::text AS date, pw.type,
                pw.distance_mi::text AS distance_mi,
                COALESCE(wk.is_race_week, false) AS in_race_week
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
           LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
          WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
            AND pw.date_iso::date BETWEEN $2::date AND $2::date + 13`,
        [userId, today]
      )).rows;
      const raceRows = (await pool.query<{ date: string | null }>(
        `SELECT meta->>'date' AS date FROM races
          WHERE user_uuid = $1::uuid
            AND (meta->>'date')::date BETWEEN $2::date AND $2::date + 30`,
        [userId, today]
      ).catch(() => ({ rows: [] as Array<{ date: string | null }> }))).rows;
      const daysOff = Number(t.evidence.days_off ?? 0);
      const lastRunISO = String(t.evidence.last_run_iso ?? '');
      const raceDates = raceRows.map((r) => r.date).filter((d): d is string => !!d);
      const gapActions = buildGapActions({
        todayISO: today,
        daysOff,
        lastRunISO,
        upcoming: rows.map((r) => ({
          id: r.id,
          dateISO: r.date,
          type: r.type,
          distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
          inRaceWeek: r.in_race_week === true,
        })),
        raceDates,
      });

      // 2026-08-17 · RERAMP-1 · after an 8-14 day absence, rescale the
      // REMAINING authored weeks (start > today+13) to the comeback
      // ceiling: 70% of the pre-absence rolling 4-week average, then
      // ≤10%/week (Research/22 §14 :635 + :648-651). buildGapActions
      // owns the first 14 days; this owns the rest of the runway. Rides
      // the same trigger → same (gap, band) idempotency marker, and
      // applies through the same seal-guarded shave machinery.
      if (classifyGapBand(daysOff) === 'shave_70_85' && lastRunISO) {
        try {
          const preByDay = await mileageByDay(userId, isoDaysBefore(lastRunISO, 27), lastRunISO);
          let preMi = 0;
          for (const [, v] of preByDay) preMi += v.mi;
          const preAbsenceWeeklyMi = preMi / 4;
          const futureRows = (await pool.query<{
            id: string; date: string; type: string; distance_mi: string | null;
            in_race_week: boolean; week_start_iso: string | null;
          }>(
            `SELECT pw.id, pw.date_iso::date::text AS date, pw.type,
                    pw.distance_mi::text AS distance_mi,
                    COALESCE(wk.is_race_week, false) AS in_race_week,
                    wk.week_start_iso::text AS week_start_iso
               FROM plan_workouts pw
               JOIN training_plans tp ON tp.id = pw.plan_id
               LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
              WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
                AND wk.week_start_iso::date > $2::date + 13
                AND wk.week_start_iso::date <= $2::date + 62`,
            [userId, today]
          )).rows;
          const byWeek = new Map<string, ReRampWeek>();
          for (const r of futureRows) {
            if (!r.week_start_iso) continue;
            const ws = r.week_start_iso.slice(0, 10);
            const bucket = byWeek.get(ws) ?? { weekStartISO: ws, rows: [] };
            bucket.rows.push({
              id: r.id,
              dateISO: r.date,
              type: r.type,
              distanceMi: r.distance_mi != null ? Number(r.distance_mi) : null,
              inRaceWeek: r.in_race_week === true,
            });
            byWeek.set(ws, bucket);
          }
          gapActions.push(...buildReRampActions({
            todayISO: today,
            daysOff,
            lastRunISO,
            preAbsenceWeeklyMi,
            weeks: [...byWeek.values()].sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO)),
            raceDates,
          }));
        } catch (e) {
          // Non-fatal: the first-14-day comeback response still applies.
          console.warn('[adapt] re-ramp skipped:', e instanceof Error ? e.message : String(e));
        }
      }
      return gapActions;
    }
    case 'readiness_pullback': {
      // 2026-06-01 · just-in-time window. Only act on TODAY's workout.
      // The runner has another 24-72h to recover before any future
      // quality day · don't pre-emptively flatten Tuesday from Sunday's
      // data. If today's signals are still bad tomorrow, tomorrow's
      // adapter run sees that and acts on tomorrow.
      //
      // Doctrine · David, 2026-06-01: "I don't know about a number
      // Sunday at 5:50 AM making a call for Tuesday. That doesn't
      // seem right." Right · just-in-time decisions only, and only
      // when the multi-signal brief says so (not a single RHR spike).
      const todayKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
             AND pw.date_iso = $2::text
           LIMIT 1`,
        [userId, today]
      )).rows[0];
      if (!todayKey) return [];
      return [{
        kind: 'downgrade',
        workoutIds: [todayKey.id],
        newType: 'easy',
        why: t.reason,
      }];
    }
    case 'rhr_spike':
    case 'sleep_crater': {
      // DEPRECATED · these trigger kinds are no longer emitted by
      // detectAdaptations (2026-06-01 · superseded by readiness_pullback).
      // Case retained so any in-flight coach_intents rows from the old
      // path still resolve cleanly. If somehow re-emitted, applies the
      // SAME just-in-time window as readiness_pullback.
      const todayKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
             AND pw.date_iso = $2::text
           LIMIT 1`,
        [userId, today]
      )).rows[0];
      if (!todayKey) return [];
      return [{
        kind: 'downgrade',
        workoutIds: [todayKey.id],
        newType: 'easy',
        why: t.reason,
      }];
    }
    case 'volume_overshoot': {
      // 2026-07-06 · race-protected rows excluded (per-finding context
      // filter): race execution, tune-ups, shakeouts, and race-week rows
      // belong to the race machinery, never to a volume shave.
      const next7 = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
            LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.date_iso::date BETWEEN $2::date AND $2::date + 7
             AND pw.type NOT IN ('rest', 'strength', 'race', 'race_week_tuneup', 'shakeout')
             AND COALESCE(wk.is_race_week, false) = false`,
        [userId, today]
      )).rows;
      if (next7.length === 0) return [];
      const baselineWhy = t.evidence.scheduled_7d_mi != null && Number(t.evidence.scheduled_7d_mi) >= 5
        ? `${Math.round(Number(t.evidence.scheduled_7d_mi))}mi scheduled`
        : `${t.evidence.level} cap`;
      return [{
        kind: 'shave',
        workoutIds: next7.map((r: any) => r.id),
        shaveFraction: 0.17,
        why: `Volume ${Math.round(t.evidence.last7d_mi)}mi exceeded ${baselineWhy}. Shave next 7 days 17%.`,
      }];
    }
    case 'pr_bank':
    case 'goal_changed': {
      // 2026-08-17 · coaching-loop reconciliation · both signals say
      // "paces stale; recompute" — and now that MEANS a recompute. The
      // old mark_dirty limb appended a '[paces stale - recompute]' string
      // to notes that nothing ever read; the action is now a real
      // recompute_paces (applyAdaptations → recomputePacesForPlan), which
      // rewrites future unsealed rows' pace_target + workout_spec from
      // the measured VDOT and stamps users.vdot_last_reviewed so the
      // detector doesn't re-fire daily for the whole 14d race window.
      // Cite: Research/01 §Recalibrate-Paces ("update VDOT from race →
      // re-derive zones").
      // 2026-08-17 · coach-experience pass · the why is runner-facing
      // (adaptation-info + the coach's log surface it): say what
      // happened to THEM, not what the engine did to itself.
      const why = t.kind === 'pr_bank'
        ? `New race fitness · VDOT ${Number(t.evidence.new_vdot ?? 0).toFixed(1)} · your paces just moved.`
        : 'Your goal changed · plan paces re-anchored to it.';
      return [{
        kind: 'recompute_paces',
        newVdot: t.kind === 'pr_bank' && t.evidence.new_vdot != null
          ? Number(t.evidence.new_vdot)
          : null,  // goal_changed → latest snapshot VDOT at apply time
        why,
      }];
    }
    case 'fitness_regression': {
      // 2026-08-17 · symmetric downward re-anchor. Per David: "watch time
      // IS the result" — race-sourced evidence auto-applies (same posture
      // as pr_bank's upward path); training-drift evidence proposes first
      // (a rebuild the runner gates · POST /api/plan/proposal accept →
      // generatePlan re-anchors at measured fitness). Honest-paces
      // doctrine: the plan must never keep prescribing paces the runner
      // has demonstrably lost. Cite: Research/01:316-320.
      if (t.evidence.source === 'race') {
        return [{
          kind: 'recompute_paces',
          newVdot: t.evidence.new_vdot != null ? Number(t.evidence.new_vdot) : null,
          why: t.reason,
        }];
      }
      // training_drift → propose-first (plan_proposals · pending). Accept
      // rebuilds the plan (route: POST /api/plan/proposal), which
      // re-anchors currentT at measured fitness AND re-gates the weekly
      // blend on measured progress (generatePlan 2026-08-17). Deduped on
      // an existing pending row so the daily cron doesn't pile them up.
      try {
        const planRow = (await pool.query<{ id: string }>(
          `SELECT id FROM training_plans
            WHERE user_uuid = $1 AND archived_iso IS NULL
            ORDER BY authored_iso DESC LIMIT 1`,
          [userId],
        ).catch(() => ({ rows: [] }))).rows[0];
        if (planRow) {
          const dup = (await pool.query(
            `SELECT 1 FROM plan_proposals
              WHERE user_uuid = $1 AND proposal_kind = 'pace_reanchor'
                AND (status = 'pending'
                     OR (status = 'dismissed' AND resolved_at >= NOW() - interval '14 days'))
              LIMIT 1`,
            [userId],
          ).catch(() => ({ rows: [] as unknown[] }))).rows[0];
          if (!dup) {
            await pool.query(
              `INSERT INTO plan_proposals
                 (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at)
               VALUES ($1, $2, 'pace_reanchor', $3::jsonb, 'pending', 'adapt_cron', NOW())`,
              [userId, planRow.id, JSON.stringify({
                message: t.reason,
                new_vdot: t.evidence.new_vdot ?? null,
                old_vdot: t.evidence.old_vdot ?? null,
                delta: t.evidence.delta ?? null,
                evidence_source: 'training_drift',
                citation: 'Research/01-pace-zones-vdot.md §Recalibrate-Paces',
              })],
            );
          }
        }
      } catch {
        // Proposal write failure is non-fatal · the drift monitor's
        // vdot_drift check remains the backstop.
      }
      return [];
    }
    case 'niggle_reported': {
      // Q-04 default. ≥7/10 → 48h suspension (downgrade next 2d to rest);
      // 5-6/10 → downgrade next quality day to easy.
      const severity = Number(t.evidence.severity ?? 0);
      // 2026-06-03 · runner TZ via $2::date · was inline CURRENT_DATE which
      // shifted at server-UTC midnight. The horizon ternary still selects
      // 2 days (preserving existing behavior; bug-for-bug per the original).
      const where = severity >= 7
        ? `pw.date_iso::date BETWEEN $2::date AND $2::date + 2`
        : `pw.type IN ('threshold','tempo','intervals','vo2max','long')
            AND pw.date_iso::date BETWEEN $2::date AND $2::date + 2`;
      const rows = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL AND ${where}
           ORDER BY pw.date_iso::date ASC`,
        [userId, today]
      )).rows;
      if (rows.length === 0) return [];
      return [{
        kind: 'downgrade',
        workoutIds: rows.map((r: any) => r.id),
        newType: severity >= 7 ? 'rest' : 'easy',
        why: t.reason,
      }];
    }
    case 'field_test_due': {
      // 2026-08-17 · one action targeting the detected quality slot. The
      // conversion itself happens in applyAdaptations' 'field_test'
      // handler — after the runner accepts the proposal (propose-first
      // via PROPOSE_FIRST_TRIGGERS).
      const wid = t.evidence.workout_id as string | undefined;
      if (!wid) return [];
      return [{
        kind: 'field_test',
        workoutIds: [wid],
        why: t.reason,
      }];
    }
    case 'sick_episode_active': {
      // Q-03 default — propose, never auto-modify. Writes a coach_proposals
      // row that the runner accepts/rejects from the UI. Returns no actions
      // so applyAdaptations doesn't mutate plan_workouts.
      try {
        await pool.query(
          `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
           VALUES ($1, $1::text, 'illness_adjust', $2::jsonb, 'pending', NOW())
           ON CONFLICT DO NOTHING`,
          [userId, JSON.stringify({
            reason: t.reason,
            evidence: t.evidence,
            suggested:
              t.severity === 'override'
                ? 'Suspend all running until cleared. Cross-train if symptoms allow.'
                : 'Drop all quality. Run easy for 3-5 days; reassess.',
          })],
        );
      } catch {
        // Proposal write failure is non-fatal; runner still sees the
        // niggle/sick UI surface even without a proposal row.
      }
      return [];
    }
    case 'injury_active': {
      // Q-08 default — same propose-only pattern as illness. Walk-run +
      // cross-train suggestion comes from Research/05; the runner
      // accepts in the UI.
      try {
        await pool.query(
          `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
           VALUES ($1, $1::text, 'injury_adjust', $2::jsonb, 'pending', NOW())
           ON CONFLICT DO NOTHING`,
          [userId, JSON.stringify({
            reason: t.reason,
            evidence: t.evidence,
            suggested:
              t.severity === 'override'
                ? 'Walk-run scaffold + cross-train. Pain-monitor in-session, 24h, location. Suspend running ≥ 5/10 pain.'
                : 'Easy mileage only; daily pain check before each session. Drop quality. Reassess after 7 days.',
          })],
        );
      } catch {
        // Non-fatal — runner still sees the injury UI surface.
      }
      return [];
    }
    default:
      return [];
  }
}
