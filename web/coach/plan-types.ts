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
  | 'recovery';

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
  | 'positive-drift';

export interface SignalSnapshot {
  /** Minimal slice of the state at trigger time — used for audit. */
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

export interface PlanMutation {
  id: string;
  ts: string;
  reason: string;
  citation: string;
  trigger: TriggerKind;
  signalSnapshot: SignalSnapshot;
  changedFields: Partial<PlanWorkout>;
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
  notes: string;
  /** As-planned snapshot frozen at authoring time. */
  originalDateISO: string;
  originalType: WorkoutType;
  originalDistanceMi: number;
  mutations: PlanMutation[];
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
   *  significantly — triggers a transparent rewrite on next load. */
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

/** Helper — pick the inputs that drive authoring out of CoachState.
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
