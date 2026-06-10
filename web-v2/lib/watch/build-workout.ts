/**
 * build-workout.ts
 *
 * Builds the WatchWorkout JSON the watch decodes from applicationContext.
 *
 * Wire contract: docs/coach/WATCH_CONTRACT.md + the watch's Swift struct
 * at legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift.
 *
 * The payload feeds the SAME prescription module the iPhone modal uses
 * (lib/training/prescriptions.ts), so what the watch executes matches
 * what you see on the phone exactly. For repeat blocks (cruise intervals,
 * threshold reps, etc.) the recovery folds out into individual phases:
 *
 *   warmup → work₁ → recovery₁ → work₂ → recovery₂ → ... → workN → cooldown
 *
 * Wire field names ARE NOT the same as the prescription module — watch
 * uses `type` (not `kind`) and a specific haptic enum. Don't free-style
 * the field names; the Swift decoder will refuse them.
 */
import { pool } from '@/lib/db/pool';
import { prescriptionFor, type WorkoutType, type PrescriptionStep } from '@/lib/training/prescriptions';
import { expandSpecToPhases, type ExpandedPhase } from '@/lib/training/expand-spec';
import { parseRaceTime as parseRaceGoalSec } from '@/lib/training/vdot';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import { computeFueling, type WorkoutFuelingType } from '@/lib/training/fueling';

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.faff.run';

// ── Wire-format types (must match Swift WatchPhase/WatchWorkout) ───────

export type WatchPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type WatchHaptic =
  | 'start'
  | 'transition-work'
  | 'transition-recovery'
  | 'transition-cooldown'
  | 'end';
export type WatchRepUnit = 'time' | 'distance';

export interface WatchPhase {
  type: WatchPhaseType;
  label: string;
  durationSec: number;                // required, even for distance reps (estimate)
  targetPaceSPerMi?: number | null;
  tolerancePaceSPerMi?: number | null;
  haptic: WatchHaptic;
  repUnit?: WatchRepUnit;
  distanceMi?: number | null;
  /** HR target for work phases on quality sessions (intervals/threshold/tempo).
   *  Sourced from workout_spec.lthr_bpm → profile.lthr → null.
   *  Null on warmup/recovery/cooldown and on easy/long workouts.
   *  Watch renders this as a reference; floor/ceiling semantics are a face-display decision. */
  hrTargetBpm?: number | null;
  /** 2026-06-08 · True on the long-run HM/M finish segment. Optional on the
   *  wire — old watch builds omit/ignore it (field defaults to false there);
   *  new builds route it to the FINISH face instead of the rep face. */
  isFinishSegment?: boolean;
  /** 2026-06-09 Phase 2 (3.2) · one-line contingency label for this phase
   *  ("HR over 167 and climbing · finish easy, the stimulus is banked").
   *  Optional on the wire — old builds ignore it; new builds render it in
   *  gray under the phase target and use the workout-level `rules` array
   *  for breach detection. Never an instruction to stop · the watch
   *  OFFERS, the runner chooses. */
  ruleLabel?: string | null;
}

export interface WatchWorkout {
  workoutId: string;
  name: string;
  summary: string;
  totalEstimatedMinutes: number;
  phases: WatchPhase[];
  completionEndpoint: string;
  expiresAt: string;
  readinessScore?: number | null;
  readinessLabel?: string | null;
  distanceMi?: number | null;
  paceLabel?: string | null;
  isRace: boolean;
  goalSec?: number | null;
  strategyLabel?: string | null;
  gelsMi?: number[] | null;
  fueling?: { needed: boolean; gels: number; atMins: number[]; gPerHr: number; totalCarbsG: number; isRehearsal: boolean; heatAdjusted: boolean; shortLine: string; why: string } | null;
  hrCeilingBpm?: number | null;
  displayHint?: string | null;
  /** 2026-06-09 Phase 2 (3.2) · contingency rules from workout_spec.rules
   *  (spec-builder composeContingencyRules). Optional + additive on the
   *  wire. Shape: {kind: 'pass'|'bail'|'abort', metric: 'hr'|'pace',
   *  op: '<='|'>', value, scope: 'work'|'finish'|'overall'|'mile-5',
   *  action: string|null, label}. The watch detects breaches and offers
   *  CONTINUE / TAKE THE BAIL; outcomes ride the completion payload's
   *  optional `rule_outcomes`. */
  rules?: Array<Record<string, unknown>> | null;
}

export type WatchTodayResponse =
  | { workout: WatchWorkout; message?: undefined }
  | { workout?: undefined; message: string };

// ── Parsers ─────────────────────────────────────────────────────────────

/** "6:47" → 407 · "6:47 /mi" → 407 · null otherwise */
function parsePaceSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+):(\d{2})/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

/** Range like "7:47-8:37 /mi" → { target: midpoint, tolerance: half-range }.
 *  Single value like "6:47" → { target: 407, tolerance: 8 } */
function parsePaceTarget(
  s: string | null | undefined,
  defaultTolerance = 8,
): { targetSec: number | null; toleranceSec: number | null } {
  if (!s) return { targetSec: null, toleranceSec: null };
  const rangeMatch = String(s).match(/(\d+):(\d{2})\s*-\s*(\d+):(\d{2})/);
  if (rangeMatch) {
    const lo = (+rangeMatch[1]) * 60 + (+rangeMatch[2]);
    const hi = (+rangeMatch[3]) * 60 + (+rangeMatch[4]);
    return {
      targetSec: Math.round((lo + hi) / 2),
      toleranceSec: Math.round((hi - lo) / 2),
    };
  }
  const single = parsePaceSec(s);
  if (single != null) return { targetSec: single, toleranceSec: defaultTolerance };
  return { targetSec: null, toleranceSec: null };
}

/** "2:00" → 120 seconds */
function parseDurationSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

// Rough pace estimates by phase type, used for durationSec on distance reps
// when the prescription doesn't carry one explicitly.
function estimatePaceSecPerMi(type: WatchPhaseType, isEasy: boolean): number {
  if (type === 'warmup' || type === 'cooldown' || isEasy) return 9 * 60;
  return 7 * 60;
}

// ── Step → WatchPhase mapping ───────────────────────────────────────────

/** Map a prescription step's label keyword to the watch's phase type. */
function classifyStep(step: PrescriptionStep): WatchPhaseType {
  const l = step.label.toLowerCase();
  if (l.includes('warmup')) return 'warmup';
  if (l.includes('cooldown')) return 'cooldown';
  if (l.includes('recovery')) return 'recovery';
  // 'easy build', 'easy run', 'reps', 'rep', 'tempo', 'race', 'marathon-pace',
  // 'strides', 'today (rest)' all become 'work'
  return 'work';
}

function isEasyStep(step: PrescriptionStep): boolean {
  const l = step.label.toLowerCase();
  return l.includes('easy') || l.includes('warmup') || l.includes('cooldown') || l.includes('recovery');
}

/** Convert one prescription step to one or more WatchPhases.
 *  Repeat blocks (step.recovery present) expand to N reps + (N-1) recoveries. */
function stepToPhases(step: PrescriptionStep, defaultTolerance: number): WatchPhase[] {
  const phaseType = classifyStep(step);
  const easy = isEasyStep(step);
  const { targetSec, toleranceSec } = parsePaceTarget(step.pace_target, defaultTolerance);

  // Repeat block: N reps (with recovery between, skipping after the last rep)
  if (step.recovery && step.reps != null && step.reps > 0) {
    const reps = step.reps;
    const repDistMi = step.rep_distance_mi ?? 1;
    const repPaceSec = targetSec ?? estimatePaceSecPerMi('work', false);
    const repDurSec = Math.round(repPaceSec * repDistMi);
    const recDurSec = parseDurationSec(step.recovery.duration) ?? 120;
    const recPace = parsePaceTarget(step.recovery.pace_target, 30);

    const phases: WatchPhase[] = [];
    for (let i = 0; i < reps; i++) {
      phases.push({
        type: 'work',
        label: `Rep ${i + 1}/${reps}`,
        durationSec: repDurSec,
        targetPaceSPerMi: targetSec,
        tolerancePaceSPerMi: toleranceSec,
        haptic: 'transition-work',
        repUnit: 'distance',
        distanceMi: repDistMi,
      });
      if (i < reps - 1) {
        phases.push({
          type: 'recovery',
          label: `Recovery ${i + 1}/${reps - 1}`,
          durationSec: recDurSec,
          targetPaceSPerMi: recPace.targetSec,
          tolerancePaceSPerMi: recPace.toleranceSec,
          haptic: 'transition-recovery',
          repUnit: 'time',
        });
      }
    }
    return phases;
  }

  // Simple distance step (warmup, cooldown, easy run, tempo, MP finish, race)
  if (step.distance_mi != null && step.distance_mi > 0) {
    const paceSec = targetSec ?? estimatePaceSecPerMi(phaseType, easy);
    const durSec = Math.round(paceSec * step.distance_mi);
    const haptic: WatchHaptic =
      phaseType === 'warmup'   ? 'start'
    : phaseType === 'cooldown' ? 'transition-cooldown'
    :                            'transition-work';
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: toleranceSec,
      haptic,
      repUnit: 'distance',
      distanceMi: step.distance_mi,
    }];
  }

  // Pure duration step (no reps, no distance) — e.g. shakeout strides set
  if (step.duration) {
    const durSec = parseDurationSec(step.duration) ?? 60;
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: toleranceSec,
      haptic: phaseType === 'cooldown' ? 'transition-cooldown' : 'transition-work',
      repUnit: 'time',
    }];
  }

  return [];
}

// ── Pace label helpers ──────────────────────────────────────────────────

function paceLabelFor(t: string): string {
  switch (t) {
    case 'easy':       return 'E';
    case 'long':       return 'L';
    case 'tempo':      return 'M';
    case 'threshold':  return 'T';
    case 'intervals':  return 'I';
    case 'race':       return 'R';
    case 'shakeout':   return 'E';
    default:           return '';
  }
}

function labelFor(t: string): string {
  switch (t) {
    case 'easy':       return 'Easy';
    case 'long':       return 'Long';
    case 'tempo':      return 'Tempo';
    case 'threshold':  return 'Threshold';
    case 'intervals':  return 'Intervals';
    case 'race':       return 'Race';
    case 'shakeout':   return 'Shakeout';
    default:           return t.charAt(0).toUpperCase() + t.slice(1);
  }
}

// ── Profile helpers ─────────────────────────────────────────────────────

// 2026-06-03 · parseRaceGoalSec used to live inline here as a local
// fork · removed because it mis-parsed "1:30" as 90 seconds (MM:SS)
// instead of 5400 (H:MM). Now uses parseRaceTime from vdot.ts (imported
// at module top) which has the heuristic fix.

function distanceMiFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const l = String(label).toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k'))  return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

// ── Main entrypoint ─────────────────────────────────────────────────────

export async function buildWatchToday(
  userId: string,
  /** Override "today" for testing/smoke. Defaults to PT-adjusted now. */
  overrideDate?: string,
): Promise<WatchTodayResponse> {
  // 2026-06-06 · Audit C C6 · runner timezone (profile.timezone), not the
  // deprecated -7h Pacific hack. The hack is correct only for Pacific-PDT;
  // web coach-state migrated to runnerToday on 2026-06-03, watch/iPhone
  // (this builder) had not. Fixes "today's workout" for every non-Pacific user.
  const today = overrideDate ?? await runnerToday(userId);

  // 1. Find today's plan workout
  const plan = (await pool.query(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!plan) return { message: "No active plan." };

  const wo = (await pool.query(
    `SELECT date_iso, dow, type, distance_mi, sub_label, workout_spec, pace_target_s_per_mi
       FROM plan_workouts
      WHERE plan_id = $1 AND date_iso = $2::text
      LIMIT 1`,
    [plan.id, today]
  )).rows[0];

  if (!wo) return { message: "Nothing on the calendar today." };
  if (wo.type === 'rest') return { message: "Rest day. Recover hard." };

  const distanceMi = Number(wo.distance_mi) || 0;
  if (distanceMi <= 0) return { message: "Rest day. Recover hard." };

  // 2. Pull profile inputs for the prescription (LTHR + race goal)
  const prof = (await pool.query(
    `SELECT lthr, hrmax FROM profile
      WHERE user_uuid = $1
      ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = prof?.lthr ?? null;
  const maxHr = prof?.hrmax ? Number(prof.hrmax) : null;

  const raceRow = (await pool.query(
    `SELECT meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' = 'A'
        AND meta->>'goalDisplay' IS NOT NULL
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date') ASC LIMIT 1`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const goal_seconds = raceRow ? parseRaceGoalSec(raceRow.meta?.goalDisplay) : null;
  const goal_distance_mi = raceRow
    ? (Number(raceRow.meta?.distanceMi) || distanceMiFromLabel(raceRow.meta?.distanceLabel))
    : null;

  // 3. Weekly mileage — MUST match the iPhone modal exactly, otherwise the
  // watch shows a different number of reps than the modal does. The modal
  // uses a per-day proxy `Math.max(day.plannedMi * 6, 25)` (it doesn't have
  // a cheap way to sum the whole week). We do the same here so the two
  // surfaces agree. We also read the real summed week as a floor, in case
  // the proxy under-counts (e.g. tomorrow is a recovery day in a hot week).
  const todayDow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = todayDow === 0 ? 6 : todayDow - 1;
  const weeklyMiRow = (await pool.query(
    `SELECT SUM(distance_mi)::numeric AS mi FROM plan_workouts
      WHERE plan_id = $1
        AND date_iso::date BETWEEN ($2::date - $3::int) AND ($2::date - $3::int + 6)`,
    [plan.id, today, daysSinceMonday]
  ).catch(() => ({ rows: [{ mi: 30 }] }))).rows[0];
  const realWeeklyMi = Number(weeklyMiRow?.mi) || 30;
  const proxyWeeklyMi = Math.max(distanceMi * 6, 25);
  // Use whichever is HIGHER — matches the modal when modal's proxy wins,
  // and matches reality when the real week is denser than 6×today.
  const weeklyMi = Math.max(realWeeklyMi, proxyWeeklyMi);

  // 4. Generate the same prescription the iPhone modal uses · used as
  //    a fallback (and to source the headline / pacing strings when
  //    workout_spec is absent).
  const prescription = prescriptionFor(
    wo.type as WorkoutType,
    weeklyMi,
    { lthr, goal_seconds, goal_distance_mi },
    distanceMi,
  );

  // Tolerance defaults per workout type (tighter for threshold/intervals).
  const defaultTolerance =
    wo.type === 'threshold' || wo.type === 'intervals' ? 8
  : wo.type === 'tempo' || wo.type === 'race'          ? 12
  :                                                      20;

  // 5. Expand to phases · PREFER workout_spec (authored truth) over
  //    prescriptionFor() (generic template). Per iPhone agent's
  //    2026-06-02 brief · workout_spec is the single source of truth.
  //    When the spec is absent (pre-migration rows, easy/rest days
  //    without quality structure), fall back to the prescription
  //    template so older plans + simple types still render.
  const phases: WatchPhase[] = [];
  // Easy-pace fallback · derive from goal pace if available (goal +
  // 60-90 s/mi is standard easy pace) · default to 9:00/mi.
  const easyPaceFallback = goal_seconds && goal_distance_mi
    ? Math.round(goal_seconds / goal_distance_mi) + 90
    : 540;
  const expanded = wo.workout_spec
    ? expandSpecToPhases({
        spec: wo.workout_spec,
        totalMi: distanceMi,
        easyPaceSec: easyPaceFallback,
        recoveryPaceSec: 540,
        toleranceSec: defaultTolerance,
        workPhaseLabel: wo.type === 'race'     ? 'Race effort'
                      : wo.type === 'shakeout' ? 'Shakeout'
                      : undefined,
      })
    : null;
  // HR target for work phases on quality sessions: prefer spec-embedded HR field
  // (snapshot from plan generation) → fall back to live profile lthr → null.
  // Field precedence: intervals/threshold → lthr_bpm; tempo → hr_target_bpm.
  // Both fields are present in the spec depending on type (spec-builder.ts emits
  // lthr_bpm for threshold/intervals, hr_target_bpm for tempo). COALESCE both
  // so the watch matches what glance-adapter, seed, and recap already read.
  // Gated to intervals/threshold/tempo so easy/long work phases never show a
  // quality HR target (those sessions use hrCeilingBpm at the workout level).
  const specHrBpm = wo.workout_spec
    ? (Number((wo.workout_spec as Record<string, unknown>)?.lthr_bpm) ||
       Number((wo.workout_spec as Record<string, unknown>)?.hr_target_bpm) || null)
    : null;
  const isQualityWorkout = wo.type === 'intervals' || wo.type === 'vo2max' || wo.type === 'threshold' || wo.type === 'tempo';
  const isIntervalWorkout = wo.type === 'intervals' || wo.type === 'vo2max';
  const rawHrTarget = isQualityWorkout ? (specHrBpm ?? lthr ?? null) : null;
  // %HRmax fallback when LTHR absent (Friel conservative). Already the final
  // target — must NOT receive the 1.05× interval uplift that LTHR sources use.
  const maxHrFallback: number | null = !rawHrTarget && isQualityWorkout && maxHr
    ? isIntervalWorkout   ? Math.round(maxHr * 0.95)
    : wo.type === 'tempo' ? Math.round(maxHr * 0.87)
    : null
    : null;
  const workHrTargetBpm = rawHrTarget != null
    ? (isIntervalWorkout ? Math.round(rawHrTarget * 1.05) : rawHrTarget)
    : maxHrFallback;

  if (expanded && expanded.length > 0) {
    // workout_spec drove the phase list · convert ExpandedPhase →
    // WatchPhase (same shape, just need to add haptic + repUnit + hrTargetBpm).
    for (const p of expanded) {
      phases.push({
        type: p.type,
        label: p.label,
        durationSec: p.durationSec ?? Math.round((p.distanceMi ?? 0) * (p.targetPaceSPerMi ?? 540)),
        targetPaceSPerMi: p.targetPaceSPerMi ?? null,
        tolerancePaceSPerMi: p.tolerancePaceSPerMi ?? null,
        haptic: p.type === 'warmup'   ? 'start'
              : p.type === 'recovery' ? 'transition-recovery'
              : p.type === 'cooldown' ? 'transition-cooldown'
              :                         'transition-work',
        repUnit: p.distanceMi != null ? 'distance' : 'time',
        distanceMi: p.distanceMi ?? null,
        hrTargetBpm: p.type === 'work' ? workHrTargetBpm : null,
        // Emit ONLY when true so non-finish phases omit it on the wire
        // (JSON.stringify drops undefined) — keeps the optional-field contract.
        isFinishSegment: p.isFinishSegment ? true : undefined,
      });
    }
  } else {
    // Fallback · workout_spec absent or unrecognized kind.
    for (const step of prescription.steps) {
      phases.push(...stepToPhases(step, defaultTolerance));
    }
  }
  if (phases.length === 0) {
    // Last-resort fallback: single open work phase covering the planned distance
    phases.push({
      type: 'work',
      label: prescription.headline,
      durationSec: Math.round(distanceMi * 9 * 60),
      targetPaceSPerMi: null, tolerancePaceSPerMi: null,
      haptic: 'start', repUnit: 'distance', distanceMi,
    });
  }

  // 6. Patch haptics: first phase = 'start', last phase = 'transition-cooldown'
  //    (the engine treats the last cooldown as the wind-down marker)
  if (phases.length > 0) {
    phases[0].haptic = 'start';
    const last = phases[phases.length - 1];
    if (last.type === 'cooldown') last.haptic = 'transition-cooldown';
  }

  // 7. Workout-level fields
  const totalSec = phases.reduce((s, p) => s + p.durationSec, 0);
  const totalEstimatedMinutes = Math.round(totalSec / 60);
  // 2026-06-07 · Audit D / D1 · long runs with an HM/M finish segment
  // suppress the easy HR ceiling + foreground pace. The finish is run at
  // race pace (HR well above the 89%-LTHR easy ceiling), so a workout-level
  // ceiling would red-alert through the entire finish — coaching the
  // opposite of the prescription. The easy build is run by feel.
  const longHasFinish = wo.type === 'long'
    && wo.workout_spec != null
    && Number((wo.workout_spec as Record<string, unknown>)?.finish_mi) > 0;
  // HR ceiling only for easy/long where staying aerobic is the discipline
  const hrCeilingBpm = (wo.type === 'easy' || wo.type === 'long') && !longHasFinish
    ? lthr  ? Math.round(lthr * 0.89)   // top of Z2 in Friel zones
    : maxHr ? Math.round(maxHr * 0.78)  // %HRmax fallback when LTHR absent
    : null
    : null;

  const summary = `${distanceMi.toFixed(1)} mi · ${prescription.headline}`;

  const workout: WatchWorkout = {
    workoutId: `${userId}-${today}`,
    name: wo.sub_label || labelFor(wo.type),
    summary,
    totalEstimatedMinutes,
    phases,
    completionEndpoint: `${DEFAULT_BASE_URL}/api/watch/workouts/complete`,
    // 2026-06-02 · Flag 6 from watch audit · sliding 14h window from
    // issue time. Replaces the end-of-day-UTC stamp that clipped
    // runners starting workouts near midnight UTC even when they
    // were inside the real "today" window. Watch agent enforces this
    // on start (refuses + re-fetches when stale). Covers:
    //   · early-AM (issued 6PM → valid until 8AM next-day)
    //   · late-PM (issued 8AM → valid until 10PM same-day)
    // 14h covers both extremes. Doctrine:
    //   designs/briefs/backend-response-to-watch-2026-06-02.md
    //
    // 2026-06-09 · race-killer F5 — RACE payloads get end-of-day validity
    // instead. The 14h guard exists to stop *yesterday's training run*
    // recording against today's plan; on race morning it inverts into
    // "phone dead at the corral + last sync > 14h → watch refuses to
    // start THE RACE" (WorkoutRootView.swift:51). A race workout is
    // pinned to its calendar date, so the stale-day risk the guard
    // covers doesn't exist — validity through end-of-day-+8h closes the
    // corral-refusal hole without re-opening Flag 6 for training days.
    //
    // 2026-06-09 · RK-2 · no fractional seconds in either form: deployed
    // watch builds parse expiresAt with a default ISO8601DateFormatter,
    // which rejects ".000Z" — the gate had never fired on fractional
    // stamps, making F5's expiry (and Flag 6 itself) dead on arrival.
    expiresAt: (wo.type === 'race'
      ? new Date(Date.parse(today + 'T23:59:59Z') + 8 * 3600 * 1000).toISOString()
      : new Date(Date.now() + 14 * 3600 * 1000).toISOString()
    ).replace(/\.\d{3}Z$/, 'Z'),
    distanceMi,
    paceLabel: paceLabelFor(wo.type),
    isRace: wo.type === 'race',
    hrCeilingBpm,
    // Long runs foreground HR (the easy-aerobic discipline) — EXCEPT when
    // they carry an HM/M finish, where pace is the target (D1).
    displayHint: wo.type === 'long'  ? (longHasFinish ? 'pace' : 'hr')
             : wo.type === 'tempo' ? 'tempo'
             : null,
  };

  // 2026-06-09 Phase 2 (3.2) · thread contingency rules from the spec.
  // Workout-level array for breach detection + the bail label pinned on
  // the phases it scopes to (work phases for quality, the finish segment
  // for longs). Optional + additive on the wire · old builds ignore both.
  const specRules = Array.isArray((wo.workout_spec as Record<string, unknown> | null)?.rules)
    ? ((wo.workout_spec as Record<string, unknown>).rules as Array<Record<string, unknown>>)
    : null;
  if (specRules && specRules.length > 0) {
    workout.rules = specRules;
    const bail = specRules.find((r) => r.kind === 'bail');
    if (bail) {
      for (const p of workout.phases) {
        if (bail.scope === 'work' && p.type === 'work' && !p.isFinishSegment) {
          p.ruleLabel = String(bail.label);
        } else if (bail.scope === 'finish' && p.isFinishSegment) {
          p.ruleLabel = String(bail.label);
        }
      }
    }
  }

  // 2026-06-09 · race-killers F3 + F16 — make the race payload race-ready.
  if (wo.type === 'race') {
    // The goal belongs to THE race this plan targets (plan.race_id), not
    // "the next priority-A race" loaded above for prescription templates —
    // on a B-race day those diverge and the watch would pace the wrong race.
    const planRace = plan.race_id
      ? (await pool.query<{ meta: Record<string, unknown> | null }>(
          `SELECT meta FROM races WHERE user_uuid = $1 AND slug = $2 LIMIT 1`,
          [userId, String(plan.race_id)],
        ).catch(() => ({ rows: [] }))).rows[0]
      : null;
    const raceMeta = (planRace?.meta ?? raceRow?.meta ?? null) as Record<string, unknown> | null;
    const raceGoalSec = raceMeta ? parseRaceGoalSec(raceMeta.goalDisplay as string) : null;
    const raceDistMi = raceMeta
      ? (Number(raceMeta.distanceMi) || distanceMiFromLabel(raceMeta.distanceLabel as string | null) || distanceMi)
      : distanceMi;

    // F3 · the race face's pace target is the runner's stated GOAL pace,
    // not the spec band midpoint. Race rows stash kind:'long' with a
    // T-anchored band (e.g. AFC: lo 397 / hi 412 → expandLong mid = 405
    // = 6:45/mi — 7 s/mi faster than the 1:30 goal and ~29 s/mi faster
    // than fitness pace). A runner obeying "on target" at the midpoint
    // through an early descent blows up late.
    //
    // When the course library carries an authored phase profile, go one
    // better: expand the race into one work phase PER COURSE PHASE with
    // grade-adjusted targets (lib/race/pacing.ts · cite Research/11
    // §grade-cost). The watch's existing phase machinery renders this
    // with zero watch-side changes — per-phase target on LiveRaceFace,
    // strip segments per course phase, haptic at each terrain change.
    // Fallback: single work phase at flat goal pace. A deliberately
    // multi-phase race SPEC (none exist today) is left untouched.
    const specWorkPhases = workout.phases.filter((p) => p.type === 'work');
    if (raceGoalSec && specWorkPhases.length === 1 && Math.abs(raceDistMi - distanceMi) < 0.5) {
      let coursePhases: WatchPhase[] | null = null;
      try {
        const courseSlug = String(raceMeta?.courseSlug ?? plan.race_id ?? '');
        const geoRow = courseSlug
          ? (await pool.query<{ geometry_json: unknown }>(
              `SELECT geometry_json FROM course_library WHERE slug = $1 LIMIT 1`,
              [courseSlug],
            ).catch(() => ({ rows: [] }))).rows[0]
          : null;
        const pacing = buildRacePacing({
          goalSec: raceGoalSec,
          distanceMi,
          geometry: (geoRow?.geometry_json ?? null) as CourseGeometryInput | null,
        });
        if (pacing.source === 'course' && pacing.phases && pacing.phases.length > 1) {
          coursePhases = pacing.phases.map((ph, i) => ({
            type: 'work' as const,
            label: ph.label,
            distanceMi: Number((ph.end_mi - ph.start_mi).toFixed(2)),
            durationSec: Math.round((ph.end_mi - ph.start_mi) * ph.pace_s_per_mi),
            targetPaceSPerMi: ph.pace_s_per_mi,
            tolerancePaceSPerMi: 12,
            haptic: i === 0 ? ('start' as const) : ('transition-work' as const),
            repUnit: 'distance' as const,
            hrTargetBpm: null,
          }));
        }
      } catch { /* course pacing is additive — flat goal pace below */ }

      if (coursePhases) {
        workout.phases = coursePhases;
      } else {
        const race = specWorkPhases[0];
        race.targetPaceSPerMi = Math.round(raceGoalSec / raceDistMi);
        race.tolerancePaceSPerMi = Math.min(race.tolerancePaceSPerMi ?? 12, 12);
        if (race.distanceMi) {
          race.durationSec = Math.round(race.distanceMi * (race.targetPaceSPerMi ?? 0));
        }
      }
      workout.totalEstimatedMinutes = Math.round(
        workout.phases.reduce((s, p) => s + p.durationSec, 0) / 60,
      );
    }

    // F16 · goal delta — the watch's LiveRaceFace goal-delta row and the
    // IdleView goal line (WorkoutEngine.swift:297, IdleView.swift:70)
    // decode goalSec but the server never sent it. Independent of the
    // pace targets so the delta renders even when course pacing is off.
    if (raceGoalSec) workout.goalSec = raceGoalSec;

    // F16 · gel cues — WorkoutEngine.swift:764 fires distance-anchored
    // race-day gel alerts off gelsMi; never sent before. Source is the
    // authored spec's fuel_mi, dropping cues inside the final 2 miles
    // (the generator emits fixed spacing — AFC's spec says [5, 9, 13],
    // and a gel at mile 13.0 of 13.1 is a cue nobody can use).
    const fuelMi = Array.isArray((wo.workout_spec as Record<string, unknown> | null)?.fuel_mi)
      ? ((wo.workout_spec as Record<string, unknown>).fuel_mi as unknown[])
          .map(Number)
          .filter((m) => Number.isFinite(m) && m >= 2 && m <= distanceMi - 2)
      : [];
    if (fuelMi.length > 0) workout.gelsMi = fuelMi;

    // RK-1 · strategy line for the race face — goal + B-target in one
    // glance. Sourced from the same plan-race meta as goalSec.
    const goalDisp = (raceMeta?.goalDisplay as string | undefined) ?? null;
    const safeDisp = (raceMeta?.goalSafeDisplay as string | undefined) ?? null;
    workout.strategyLabel = goalDisp
      ? (safeDisp ? `${goalDisp} goal · ${safeDisp} safe` : `${goalDisp} goal`)
      : null;

    // RK-1 · gel fallback for races whose authored spec carries no
    // fuel_mi: convert the research-doctrine fueling plan (time-anchored)
    // to course miles via goal pace. Spec-authored positions win when
    // present (above).
    if (workout.gelsMi == null && raceGoalSec) {
      try {
        const fuelRow = (await pool.query<{
          fuel_brand: string | null;
          fuel_gel_carbs_g: number | null;
          fuel_target_g_per_hr: number | null;
        }>(
          `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] }))).rows[0];
        const fuel = computeFueling({
          durationEstMin: Math.round(raceGoalSec / 60),
          distanceMi: raceDistMi,
          workoutType: 'race',
          tempF: null,
          daysToARace: 0,
          raceFuelTargetGPerHr: fuelRow?.fuel_target_g_per_hr ?? null,
          gelCarbsG: fuelRow?.fuel_gel_carbs_g ?? null,
          gelLabel: fuelRow?.fuel_brand ?? null,
        });
        if (fuel.needed && raceDistMi > 0) {
          const paceMinPerMi = (raceGoalSec / 60) / raceDistMi;
          const gels = fuel.atMins
            .map((m) => Math.round((m / paceMinPerMi) * 10) / 10)
            .filter((mi) => mi >= 2 && mi <= raceDistMi - 2);
          if (gels.length > 0) workout.gelsMi = gels;
        }
      } catch { /* gel fallback is additive */ }
    }
  }

  // 7b. RK-1 — training-run fueling. The model declared `fueling` since
  // the watch shipped, but the server never assigned it: the 30/60/90-min
  // gel haptics (WorkoutEngine.swift:628) were dead on every real long
  // run (sim fixtures set them, masking the gap). Race day is handled
  // above via gelsMi — the engine ignores time-anchored fueling there.
  // Best-effort: never fail the payload over fueling math.
  if (wo.type !== 'race') {
    try {
      const fuelingType: WorkoutFuelingType =
        wo.type === 'long' ? 'long'
        : wo.type === 'threshold' || wo.type === 'tempo' || wo.type === 'intervals' ? 'quality'
        : wo.type === 'rest' ? 'rest'
        : 'easy';

      // Runner product prefs — same source as the iPhone brief, so the
      // watch quotes the same product line ("2 Maurten 100s").
      const fuelRow = (await pool.query<{
        fuel_brand: string | null;
        fuel_gel_carbs_g: number | null;
        fuel_target_g_per_hr: number | null;
      }>(
        `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] }))).rows[0];

      const daysToARace = raceRow?.meta?.date
        ? Math.max(0, Math.round((Date.parse(raceRow.meta.date + 'T12:00:00Z') - Date.now()) / 86400000))
        : null;

      const fuel = computeFueling({
        durationEstMin: totalEstimatedMinutes,
        distanceMi,
        workoutType: fuelingType,
        tempF: null, // forecast wiring is the weather-cron fix's job (M-15)
        daysToARace,
        raceFuelTargetGPerHr: fuelRow?.fuel_target_g_per_hr ?? null,
        gelCarbsG: fuelRow?.fuel_gel_carbs_g ?? null,
        gelLabel: fuelRow?.fuel_brand ?? null,
      });

      if (fuel.needed) {
        // Time-anchored prompts (haptic at each atMins). The watch's
        // WatchFueling decode is strict — every field present.
        workout.fueling = {
          needed: fuel.needed,
          gels: fuel.gels,
          atMins: fuel.atMins,
          gPerHr: fuel.gPerHr,
          totalCarbsG: fuel.carbsTotalG,
          isRehearsal: fuel.isRehearsal,
          heatAdjusted: fuel.heatAdjusted,
          shortLine: fuel.shortLine,
          why: fuel.why,
        };
      }
    } catch {
      /* fueling is additive — a failure must not cost the workout push */
    }
  }

  // P27.5 — populate readiness on the watch payload. Before this the
  // model declared readinessScore/Label fields but the server never
  // sent them, so the watch face fell through to a hardcoded fixture.
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { computeReadiness } = await import('@/lib/coach/readiness');
    const state = await loadCoachState(userId);
    const r = computeReadiness(state);
    // Math.round: readiness pillars carry float weights and the deployed
    // watch decodes readinessScore as a strict Int — a fractional score
    // fails the WHOLE WatchWorkout decode and the watch silently keeps
    // yesterday's session (M-13).
    workout.readinessScore = r.score != null ? Math.round(r.score) : null;
    workout.readinessLabel = r.label ?? r.band ?? null;
  } catch {
    /* don't fail the watch payload over readiness — best effort only */
  }

  return { workout };
}
