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
import { callCoachLLM, llmAvailable } from './llm';
import { citationsForWorkoutType, citationsForReadiness } from './citations';
import { coachDaily, type CoachToday } from '../lib/coach-engine';
import type { CoachState } from '../lib/coach-state';
import { acwr, ACWR_LOW, ACWR_HIGH, intensityTarget } from '../lib/coach-principles';

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
  state: CoachState;
}

export interface WorkoutPrescription {
  /** Workout-type slug. Maps 1:1 to lib/coach-engine.WorkoutType. */
  type: string;
  /** Display label, e.g. "Easy 6 mi", "Threshold intervals", "Rest". */
  label: string;
  /** Distance in miles, if applicable. 0 for rest days. */
  distanceMi: number;
  /** Pace band in s/mi, if applicable. */
  paceTargetSPerMi?: { lower: number; upper: number } | null;
  /** HR zone (1-5), if available. */
  hrZone?: number | null;
  /** Description of the session — voice-cleaned single sentence. */
  description: string;
  /** Whether this is a hard / quality session vs an easy / recovery
   *  day. The card uses this to show the right chip. */
  isQuality: boolean;
  /** Whether today's run is the long run for the week. */
  isLong: boolean;
  /** The Coach's deterministic engine output, exposed for callers
   *  that want richer data (week shape, alerts, mode/phase). */
  coachToday: CoachToday;
}

export interface AssessReadinessInput extends CoachBaseContext {
  state: CoachState;
}

export interface ReadinessAssessment {
  level: 'green' | 'yellow' | 'red';
  /** Sentence the daily card renders verbatim — Coach voice. */
  message: string;
  /** Numeric ACWR for the indicator strip; null if not enough data. */
  acwr: number | null;
  /** 14-day easy-share fraction (0–1); null if no recent intensity data. */
  easyShare: number | null;
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
  /** Any field can be omitted when the runner hasn't pasted a forecast. */
  weather?: { tempF?: number; windMph?: number; conditions?: string };
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

// ── Coach implementation ─────────────────────────────────────────────
// Each method either reads from doctrine deterministically or calls the
// LLM brain. As stages land, methods move from stub → real. Stubs throw
// with a clear "Stage N" hint; real methods have full bodies.

class CoachImpl implements Coach {
  private notYet(stage: number, method: string): never {
    throw new Error(`Coach.${method}() lands in Stage ${stage}. See docs/COACH_BUILD_PLAN.md.`);
  }

  paceStrategy(): Promise<CoachDecision<PaceStrategyOutput>> { return this.notYet(1, 'paceStrategy'); }
  taperDepth(): Promise<CoachDecision<number>> { return this.notYet(1, 'taperDepth'); }
  fuelingFor(): Promise<CoachDecision<FuelingPlan>> { return this.notYet(1, 'fuelingFor'); }
  retrospect(): Promise<CoachDecision<RetrospectiveOutput>> { return this.notYet(4, 'retrospect'); }
  adjustForReality(): Promise<CoachDecision<AdjustedPlan>> { return this.notYet(5, 'adjustForReality'); }

  // ── Stage 3 · Daily prescription ───────────────────────────────────
  // Wraps the existing coachDaily() engine. The engine's output is
  // already deterministic and well-tested; we attach citations and a
  // voice-cleaned rationale so the daily card on /training has the
  // same audit trail as race-morning brief.
  async prescribeWorkout(input: PrescribeWorkoutInput): Promise<CoachDecision<WorkoutPrescription>> {
    const today = coachDaily(input.state);
    const t = today.today;
    return {
      answer: {
        type: t.type,
        label: t.label,
        distanceMi: t.distanceMi,
        paceTargetSPerMi: t.paceTargetSPerMi
          ? { lower: t.paceTargetSPerMi.lowS, upper: t.paceTargetSPerMi.highS }
          : null,
        hrZone: t.hrZone,
        description: t.description,
        isQuality: today.alerts.some(a => a.severity === 'rest') ? false : isHardWorkoutType(t.type),
        isLong: t.type.startsWith('long_'),
        coachToday: today,
      },
      rationale: today.rationale,
      citations: citationsForWorkoutType(t.type),
      brain: 'deterministic',
    };
  }

  // ── Stage 3 · Readiness ────────────────────────────────────────────
  // Pure deterministic. ACWR sweet-spot 0.8–1.3 (doctrine §13.1) drives
  // the level; easy-share and recent missed-runs nudge it.
  // Sleep / HRV signals are reserved for Stage 5 once HealthKit lands.
  async assessReadiness(input: AssessReadinessInput): Promise<CoachDecision<ReadinessAssessment>> {
    const s = input.state;
    const ratio = acwr(s);
    const phase = (s.races.nextA != null && s.races.inWindow.some(r => r.priority === 'A')) ? 'BUILD' : 'BASE_MAINTENANCE';
    const target = intensityTarget(phase as Parameters<typeof intensityTarget>[0]);
    const easy = s.intensity.easyShare14d;
    const missedRunsSignal = s.recovery.daysSinceLastRun >= 3;

    let level: 'green' | 'yellow' | 'red' = 'green';
    let reason = '';
    if (ratio != null && (ratio < 0.5 || ratio > 1.5)) {
      level = 'red';
      reason = ratio > 1.5
        ? `Acute load is way over chronic — your last 7 days are ${Math.round(ratio * 100)}% of your baseline. We dial back today.`
        : `Last 7 days are ${Math.round(ratio * 100)}% of baseline — too quiet to call you ready.`;
    } else if (ratio != null && (ratio < ACWR_LOW || ratio > ACWR_HIGH)) {
      level = 'yellow';
      reason = ratio > ACWR_HIGH
        ? `Recent volume is running hot. Hold the easy days honestly and don't pile on quality.`
        : `Coming off a quiet week — ease back in, don't try to make it up in one day.`;
    } else if (easy > 0 && easy < target.easyShareMin) {
      level = 'yellow';
      reason = `Easy runs are drifting too fast — last 14 days only ${Math.round(easy * 100)}% truly easy. The discipline of running easy honestly is harder than the threshold day.`;
    } else if (missedRunsSignal) {
      level = 'yellow';
      reason = `${s.recovery.daysSinceLastRun} days since the last run. You're not falling apart — get out the door, easy pace, get some miles.`;
    } else {
      level = 'green';
      reason = ratio != null
        ? `Load is in the sweet spot (${ratio.toFixed(2)}× baseline) and easy share is honest. Trust today's plan.`
        : `Looking ready. Trust today's plan.`;
    }

    return {
      answer: {
        level,
        message: reason,
        acwr: ratio,
        easyShare: easy > 0 ? easy : null,
      },
      rationale: reason,
      citations: citationsForReadiness(level),
      brain: 'deterministic',
    };
  }

  // ── Stage 2 · Race-morning brief ───────────────────────────────────
  // First user-visible LLM surface. Pre-race, the Coach writes a short
  // paragraph in voice — what to do in the first three miles, weather
  // adjustments, fueling reminders, what NOT to chase. Citations point
  // back at coaching-research §3, §5, §7, §11, §14 depending on what
  // the brief leans on.
  async briefRaceMorning(input: RaceMorningBriefInput): Promise<CoachDecision<string>> {
    if (!llmAvailable()) {
      // Deterministic fallback — keeps the page working without an
      // ANTHROPIC_API_KEY. Voice stays close but obviously generic.
      return {
        answer: `Morning. The training is done. ${input.weather?.tempF != null
          ? `${Math.round(input.weather.tempF)}°F start — ${input.weather.tempF > 75 ? 'start conservative, the heat will catch up' : input.weather.tempF < 50 ? 'cool and favorable, don\'t overdress' : 'comfortable conditions, run the plan'}.`
          : 'Trust the plan.'} First three miles slower than you want. Whatever you feel right now is nerves, not fitness — let them sit. Run your race.`,
        rationale: 'Conservative start + trust-the-plan default. No LLM available.',
        citations: [
          { doc: 'docs/coaching-research.md', section: '§14', snippet: 'in the final two weeks, the fitness is built. The job is to arrive at the start line rested without losing edge.' },
        ],
        brain: 'deterministic',
      };
    }

    const weatherLine = input.weather
      ? `Weather: ${input.weather.tempF}°F${input.weather.windMph != null ? `, ${input.weather.windMph} mph wind` : ''}${input.weather.conditions ? `, ${input.weather.conditions}` : ''}.`
      : 'Weather: no specific forecast.';

    const userPrompt = [
      `Write a race-morning brief for ${input.raceName} on ${input.raceDate}.`,
      `Goal: ${input.goalDisplay}.`,
      `Course: ${input.courseSummary}`,
      weatherLine,
      '',
      'The brief is what the runner reads over coffee. One short paragraph. Voice rules apply (plain language, no §-numbers in the rationale, no jargon-without-translation). Acknowledge real conditions, give pace-band guidance for the opening miles, mention fuel timing, and end with a single line of focus.',
    ].join('\n');

    return callCoachLLM<string>({
      scope: 'running',
      userPrompt,
      answerSchema: 'a single paragraph (3–6 sentences) of race-morning brief in the Coach voice',
      maxTokens: 600,
    });
  }
}

/** Canonical "hard" workout types — used by prescribeWorkout to decide
 *  whether to flag today as quality on the card. Mirrors lib/coach-
 *  workouts.ts's notion of intensity but kept here so the Coach layer
 *  doesn't depend on engine internals. */
function isHardWorkoutType(type: string): boolean {
  return (
    type.includes('threshold') ||
    type === 'vo2' ||
    type === 'sub_threshold' ||
    type === 'tempo_continuous' ||
    type.startsWith('marathon_specific') ||
    type === 'long_progression' ||
    type === 'long_mp_block' ||
    type === 'long_fast_finish'
  );
}

/** The singleton Coach. Import via `import { coach } from '@/coach/coach'`.
 *  Stage 2 implements `briefRaceMorning`; Stage 3 adds `prescribeWorkout`
 *  + `assessReadiness`; other methods still stub with a clear "Stage N"
 *  error. Each stage flips one or more from stub → real. */
export const coach: Coach = new CoachImpl();
