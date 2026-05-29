/**
 * plan-types · pure types for the plan-as-artifact architecture.
 *
 * Per docs/PLAN_ARCHITECTURE.md §Core entities. All shapes here are
 * persistence-safe (no runtime imports), so both the server-side
 * plan-builder/plan-adapter AND client-side renderers can import them.
 */

import type { CoachState } from '../lib/coach-state';

export type PlanMode = 'race-prep' | 'maintenance';

export type WorkoutType =
  | 'rest'
  | 'easy'
  | 'long'
  | 'threshold'
  | 'interval'
  | 'mp'
  | 'race'
  | 'shakeout'
  | 'recovery'
  | 'race_week_tuneup';

export type PhaseLabel =
  | 'BASE'
  | 'BUILD'
  | 'PEAK'
  | 'TAPER'
  | 'RACE_WEEK'
  | 'MAINTENANCE';

export type TriggerKind =
  | 'checkin-yellow'
  | 'checkin-red'
  | 'volume-crater'
  | 'rebuild-after-break'
  | 'injury-return'
  | 'b-race-in-window'
  | 'heat-disruption'
  | 'illness'
  | 'bad-race-result'
  | 'good-race-result'
  | 'vdot-upgrade-dampening'
  | 'positive-drift'
  | 'quality-execution-advance'
  | 'quality-execution-retreat'
  /** Runner explicitly clicked "Skip Today" on the hero card. Ground
   *  truth, not a fuzzy signal. Cite Research/00b §Decision Matrix
   *  (a missed quality day is a recovery signal). */
  | 'runner-skip';

export interface SignalSnapshot {
  /** Minimal slice of the state at trigger time, used for audit. */
  todayISO: string;
  poorDaysCount?: number;
  last7Mi?: number;
  weeklyAvg4w?: number;
  rebuildAfterBreak?: boolean;
  injuryReturning?: boolean;
  bRaceDateISO?: string | null;
  raceDistanceMi?: number;
  raceDeltaSPerMi?: number;
  vdotDelta?: number;
}

// 'seen' = an applied change the runner has dismissed from the "Coach
// updated your plan" card. Persisted server-side so a dismissal on one
// device (e.g. iPhone) carries to the web and never re-surfaces.
export type MutationStatus = 'applied' | 'proposed' | 'declined' | 'seen';

export interface PlanMutation {
  id: string;
  ts: string;
  reason: string;
  citation: string;
  trigger: TriggerKind;
  signalSnapshot: SignalSnapshot;
  changedFields: Partial<PlanWorkout>;
  /** 'applied' = auto-applied (default). 'proposed' = a big change awaiting
   *  the runner's approve/skip (the workout is NOT changed until approved).
   *  'declined' = the runner skipped it. */
  status?: MutationStatus;
}

export interface PlanWorkout {
  id: string;
  dateISO: string;
  dow: number;
  type: WorkoutType;
  distanceMi: number;
  paceTargetSPerMi: number | null;
  durationMin: number | null;
  isQuality: boolean;
  isLong: boolean;
  hasStrength: boolean;
  notes: string;
  /** Short display label override, e.g. 'Long Run · HM Finish' for HM-specific weeks.
   *  Null means use the default label for the workout type. */
  subLabel?: string | null;
  /** Structured per-workout spec used by WorkoutBreakdown (/runs/[id]) and
   *  the Poster A3 breakdown rows on /today. Type-dependent shape; null
   *  when the builder had no VDOT to anchor pace targets (callers fall
   *  back to the existing label-only render). See migration 120 for the
   *  JSON schema. */
  workoutSpec?: WorkoutSpec | null;
  /** As-planned snapshot frozen at authoring time. */
  originalDateISO: string;
  originalType: WorkoutType;
  originalDistanceMi: number;
  mutations: PlanMutation[];
}

/** Structured workout spec · type-dependent shape mirroring the JSONB
 *  column on `plan_workouts.workout_spec` (migration 120). All numeric
 *  pace values are seconds-per-mile per Daniels Running Formula §VDOT
 *  table conventions. HR caps cite the runner's LTHR-derived ceilings
 *  (Research/notes/lthr-auto-derivation.md). */
export type WorkoutSpec =
  | WorkoutSpecEasy
  | WorkoutSpecLong
  | WorkoutSpecThreshold
  | WorkoutSpecTempo
  | WorkoutSpecIntervals
  | WorkoutSpecFartlek
  | WorkoutSpecProgression
  | WorkoutSpecRecovery
  | WorkoutSpecMP;

/** Easy days (Daniels E pace) · pace band + HR ceiling + optional fuel cues. */
export interface WorkoutSpecEasy {
  kind: 'easy';
  pace_target_s_per_mi_lo: number;
  pace_target_s_per_mi_hi: number;
  hr_cap_bpm: number | null;
  fuel_mi?: number[];
}

/** Long runs (Daniels E pace; longer & with optional MP segment). */
export interface WorkoutSpecLong {
  kind: 'long';
  pace_target_s_per_mi_lo: number;
  pace_target_s_per_mi_hi: number;
  hr_cap_bpm: number | null;
  fuel_mi: number[];
}

/** Threshold rep workouts (Daniels T pace, cruise intervals).
 *  Research/04 §5.3 · 3-6 × 1 mi with 1 min jog, or 5 × 1K. */
export interface WorkoutSpecThreshold {
  kind: 'threshold';
  warmup_mi: number;
  rep_count: number;
  /** Use exactly ONE of rep_distance_m or rep_distance_mi (the other is undefined). */
  rep_distance_m?: number;
  rep_distance_mi?: number;
  rep_pace_s_per_mi: number;
  rep_rest_s: number;
  cooldown_mi: number;
  lthr_bpm: number | null;
}

/** Continuous tempo (Daniels §5.2 · 20–40 min at T effort). */
export interface WorkoutSpecTempo {
  kind: 'tempo';
  warmup_mi: number;
  tempo_distance_mi: number;
  tempo_pace_s_per_mi: number;
  cooldown_mi: number;
  hr_target_bpm: number | null;
}

/** VO2max intervals (Daniels I pace · Research/04 §6). */
export interface WorkoutSpecIntervals {
  kind: 'intervals';
  warmup_mi: number;
  rep_count: number;
  rep_distance_m?: number;
  rep_distance_mi?: number;
  rep_pace_s_per_mi: number;
  rep_rest_s: number;
  cooldown_mi: number;
  lthr_bpm: number | null;
}

/** Fartlek · time-on-pace surge segments. */
export interface WorkoutSpecFartlek {
  kind: 'fartlek';
  warmup_mi: number;
  segments: Array<{ pace_s_per_mi: number; duration_s: number }>;
  cooldown_mi: number;
}

/** Progression long run · E → T pace fade-in. Research/22 §3. */
export interface WorkoutSpecProgression {
  kind: 'progression';
  warmup_mi: number;
  prog_distance_mi: number;
  prog_start_s_per_mi: number;
  prog_end_s_per_mi: number;
  cooldown_mi: number;
  hr_cap_bpm: number | null;
}

/** Recovery shake-outs (below-E, blood-flow only). */
export interface WorkoutSpecRecovery {
  kind: 'recovery';
  pace_target_s_per_mi_lo: number;
  pace_target_s_per_mi_hi: number;
  hr_cap_bpm: number | null;
}

/** Marathon-pace blocks (Daniels M pace). */
export interface WorkoutSpecMP {
  kind: 'mp';
  warmup_mi: number;
  mp_distance_mi: number;
  mp_pace_s_per_mi: number;
  cooldown_mi: number;
  hr_target_bpm: number | null;
}

export interface PlanPhase {
  id: string;
  label: PhaseLabel;
  startWeekIdx: number;
  endWeekIdx: number;
  rationale: string;
  citation: string;
}

export interface PlanWeek {
  id: string;
  weekIdx: number;
  weekStartISO: string;
  phaseId: string;
  isCutback: boolean;
  isPeak: boolean;
  isRaceWeek: boolean;
  rationale: string;
  workouts: PlanWorkout[];
}

export interface CoachStateSnapshot {
  /** Snapshot of just the inputs that influenced the authoring. */
  weeklyAvg4w: number;
  weeklyAvg8w: number;
  longestTrainingRunLast28Mi: number;
  level: 'beginner' | 'intermediate' | 'advanced';
  longRunDow: number;
  qualityDows: number[];
  restDow: number;
  /** Builder algorithm version. Bump when the authoring logic changes
   *  significantly, triggers a transparent rewrite on next load. */
  builderVersion?: number;
}

export interface Plan {
  id: string;
  userId: string;
  mode: PlanMode;
  raceId: string | null;
  /** Race day (race-prep mode) OR plan-end date (maintenance mode). */
  goalISO: string;
  authoredISO: string;
  authoredFromState: CoachStateSnapshot;
  phases: PlanPhase[];
  weeks: PlanWeek[];
  /** Set when archived; otherwise null. */
  archivedISO: string | null;
}

/** Helper, pick the inputs that drive authoring out of CoachState.
 *  Pass builderVersion from plan-builder so stored snapshots carry the
 *  version that produced them. */
export function snapshotFromState(
  state: CoachState,
  level: 'beginner' | 'intermediate' | 'advanced',
  builderVersion?: number,
): CoachStateSnapshot {
  return {
    weeklyAvg4w: state.volume.weeklyAvg4w,
    weeklyAvg8w: state.volume.weeklyAvg8w,
    longestTrainingRunLast28Mi: state.volume.longestTrainingRunLast28Mi,
    level,
    longRunDow: state.prefs.longRunDow,
    qualityDows: state.prefs.qualityDows,
    restDow: state.prefs.restDow ?? 1,
    builderVersion,
  };
}
