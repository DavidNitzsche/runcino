/**
 * Coach — single entry point for every coaching judgment in Runcino.
 *
 * Layer 2 of the architecture in docs/COACH_BUILD_PLAN.md. The
 * application doesn't compute pace strategies, prescribe workouts,
 * write race-morning briefs, or anything similar by itself. It calls
 * a method on this Coach. The Coach internally chooses between two
 * brains:
 *
 *   • Deterministic — read from web/coach/doctrine/*.ts (structured
 *     constants extracted from docs/coaching-research.md). Used for
 *     math, lookups, ACWR, taper percentages, intensity distribution.
 *   • LLM — Claude with web/coach/voice.md + the full research doc
 *     cached as a system prompt. Used only for judgment calls
 *     (race-morning brief, retrospective insight, "this is unusual,
 *     what do we do?"). Each call returns a structured CoachDecision
 *     so the consumer always gets answer + rationale + citations.
 *
 * Stage 0 (this file): interface only — every method throws. Stage 1
 * onward fills the methods in, one at a time, against doctrine and
 * the existing engines (lib/pacing.ts, lib/coach-engine.ts, etc.) it
 * is replacing.
 */
import type { CoachBaseContext, CoachDecision } from './types';

// ── Method-specific input types ──────────────────────────────────────
// Defined inline here so the Coach's API surface stays in one file.

export interface PaceStrategyInput extends CoachBaseContext {
  goalFinishS: number;
  strategy: 'even_effort' | 'even_split' | 'negative_split';
  /** Course-derived inputs (gpx-analysis output). Stage 1 wires them. */
  totalDistanceM: number;
  /** Per-segment grade %s; same shape as CourseAnalysis.gradesPct. */
  segmentGradesPct: number[];
  /** Per-segment distances in meters; same shape as analysis.segDistsM. */
  segmentDistancesM: number[];
  weather?: { tempF: number; windMph?: number };
  toleranceSPerMi?: number;
}

export interface PaceStrategyOutput {
  /** One target pace per segment (s / mile). */
  segmentTargetPaces: number[];
  /** Optional per-segment HR ceilings, when fitness data warrants. */
  segmentHrCeilings?: number[];
  /** Sum of segment paces × distances, in seconds. */
  estimatedFinishS: number;
}

export interface PrescribeWorkoutInput extends CoachBaseContext {
  /** The user's macro-level state (volume, intensity history, recovery
   *  signals, race calendar). Stage 1 wires this from coach-state.ts. */
  state: unknown; // Replaced with CoachState in Stage 1.
}

export interface WorkoutPrescription {
  type: string; // e.g. 'easy', 'threshold', 'long_progression'
  durationMin: number;
  distanceMi?: number;
  paceTargetSPerMi?: { lower: number; upper: number };
  hrZone?: { lower: number; upper: number };
  notes: string;
}

export interface AssessReadinessInput extends CoachBaseContext {
  state: unknown; // Replaced with CoachState in Stage 1.
}

export interface ReadinessAssessment {
  level: 'green' | 'yellow' | 'red';
  /** Sentence the daily card renders verbatim. */
  message: string;
}

export interface TaperDepthInput extends CoachBaseContext {
  daysToRace: number;
  raceDistanceMi: number;
}

export interface FuelingInput extends CoachBaseContext {
  totalDistanceMi: number;
  estimatedFinishS: number;
  weather?: { tempF: number; humidityPct?: number };
  /** From the form's verified-aid-stations workflow. */
  verifiedAidStationMiles: number[];
  carbToleranceDelta?: number; // From CoachCalibration if present
}

export interface FuelingPlan {
  carbTargetGPerHr: number;
  totalCarbsG: number;
  gelCount: number;
  gelSchedule: Array<{ atMi: number; item: string; gelNumber: number }>;
  notes: string;
}

export interface RaceMorningBriefInput extends CoachBaseContext {
  raceName: string;
  raceDate: string;
  goalDisplay: string;
  weather?: { tempF: number; windMph?: number; conditions?: string };
  /** Top-line course summary the brief can reference (peak mile, etc.). */
  courseSummary: string;
}

export interface RetrospectInput extends CoachBaseContext {
  /** The plan as built (mile splits + phase pacing). */
  plan: unknown;
  /** What actually happened (Strava actuals + per-mile splits). */
  actual: unknown;
}

export interface RetrospectiveOutput {
  /** Two-paragraph reflection in the Coach's voice. */
  narrative: string;
  /** Calibration deltas to write back to the user record. Empty if
   *  nothing meaningful changed (no over-correcting on one race). */
  calibrationDelta?: {
    gapMultiplier?: number;
    carbToleranceDelta?: number;
    easyPaceFloorDelta?: number;
  };
}

export interface AdjustForRealityInput extends CoachBaseContext {
  /** Days since last run, missed sessions in the past 7 days, current
   *  ACWR, recent sleep/HRV signals if present. */
  signals: {
    daysSinceLastRun: number;
    missedRunsLast7d: number;
    acwr: number;
    sleepDebtMin?: number;
    hrvBaselineDelta?: number;
  };
  /** The currently scheduled workout the user would have done today. */
  scheduledWorkout: WorkoutPrescription;
}

export interface AdjustedPlan {
  workout: WorkoutPrescription;
  /** True if we actually changed the plan; false if today's session
   *  stays as-is and the message is just commentary. */
  changed: boolean;
}

// ── The Coach ────────────────────────────────────────────────────────

export interface Coach {
  /** Build the per-segment target paces for a race. Replaces the
   *  current direct calls into lib/pacing.ts. (Wired Stage 1.) */
  paceStrategy(input: PaceStrategyInput): Promise<CoachDecision<PaceStrategyOutput>>;

  /** Today's run for a given user state. Replaces direct calls into
   *  lib/coach-engine.ts. (Wired Stage 3.) */
  prescribeWorkout(input: PrescribeWorkoutInput): Promise<CoachDecision<WorkoutPrescription>>;

  /** Green/yellow/red readiness signal for the daily card. Mostly a
   *  deterministic computation off ACWR + recent intensity + sleep
   *  signals. (Wired Stage 3.) */
  assessReadiness(input: AssessReadinessInput): Promise<CoachDecision<ReadinessAssessment>>;

  /** Volume-reduction percentage from the doctrine taper curve.
   *  (Wired Stage 1.) */
  taperDepth(input: TaperDepthInput): Promise<CoachDecision<number>>;

  /** Carb target + gel placement for a race. Replaces direct calls
   *  into lib/fueling-claude.ts. (Wired Stage 1.) */
  fuelingFor(input: FuelingInput): Promise<CoachDecision<FuelingPlan>>;

  /** Pre-race brief in the Coach's voice. LLM brain. (Wired Stage 2 —
   *  this is the first user-visible "the coach is alive" surface.) */
  briefRaceMorning(input: RaceMorningBriefInput): Promise<CoachDecision<string>>;

  /** Two-paragraph post-race reflection + a calibration delta the
   *  Coach is confident enough about to apply to the user record.
   *  LLM brain. (Wired Stage 4.) */
  retrospect(input: RetrospectInput): Promise<CoachDecision<RetrospectiveOutput>>;

  /** Look at recent signals (missed runs, sleep debt, ACWR spike,
   *  illness flag) and decide whether today's scheduled workout still
   *  makes sense. (Wired Stage 5.) */
  adjustForReality(input: AdjustForRealityInput): Promise<CoachDecision<AdjustedPlan>>;
}

// ── Stage-0 stub implementation ──────────────────────────────────────
// Every method throws a clear "implemented in Stage N" error. This lets
// us compile and import the Coach throughout the app starting now;
// real callers don't get added until Stage 1+, when each method gets
// a working body.

class StubCoach implements Coach {
  private notYet(stage: number, method: string): never {
    throw new Error(`Coach.${method}() lands in Stage ${stage}. See docs/COACH_BUILD_PLAN.md.`);
  }
  paceStrategy(): Promise<CoachDecision<PaceStrategyOutput>> { return this.notYet(1, 'paceStrategy'); }
  prescribeWorkout(): Promise<CoachDecision<WorkoutPrescription>> { return this.notYet(3, 'prescribeWorkout'); }
  assessReadiness(): Promise<CoachDecision<ReadinessAssessment>> { return this.notYet(3, 'assessReadiness'); }
  taperDepth(): Promise<CoachDecision<number>> { return this.notYet(1, 'taperDepth'); }
  fuelingFor(): Promise<CoachDecision<FuelingPlan>> { return this.notYet(1, 'fuelingFor'); }
  briefRaceMorning(): Promise<CoachDecision<string>> { return this.notYet(2, 'briefRaceMorning'); }
  retrospect(): Promise<CoachDecision<RetrospectiveOutput>> { return this.notYet(4, 'retrospect'); }
  adjustForReality(): Promise<CoachDecision<AdjustedPlan>> { return this.notYet(5, 'adjustForReality'); }
}

/** The singleton Coach. Import via `import { coach } from '@/coach/coach'`.
 *  Stage 0 returns a stub that throws on every call; Stage 1 swaps it for
 *  a real implementation backed by doctrine + the LLM brain. */
export const coach: Coach = new StubCoach();
