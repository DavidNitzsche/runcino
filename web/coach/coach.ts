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
import type {
  CoachBaseContext,
  CoachDecision,
  BodySystemsReport,
  BodySystem,
  Trajectory14wk,
  TrajectoryPoint,
  ProofSessionsReport,
  ProofSession,
  RaceFitnessPrediction,
  WeekDeltasReport,
  DayDelta,
  EngineDetailsReport,
  EngineDetail,
  RunReadReport,
  CoachReadReport,
} from './types';
import { callCoachLLM, llmAvailable } from './llm';
import { citationsForWorkoutType, citationsForReadiness } from './citations';
import { composeVoiceLead } from './explanations';
import { coachDaily, type CoachToday } from '../lib/coach-engine';
import type { CoachState } from '../lib/coach-state';
import { acwr, ACWR_LOW, ACWR_HIGH, intensityTarget } from '../lib/coach-principles';
import { computeWeatherSlowdown, formatSlowdownForBrief, type WeatherSlowdownInput } from '../lib/weather-slowdown';
import { gradeAdjustmentFactor } from '../lib/minetti';
import { M_PER_MI } from '../lib/time';
import { TAPER_BY_DISTANCE, RACE_DAY_FUELING } from './doctrine/race_week';
import { TAPER_VOLUME_REDUCTION } from './doctrine/taper';
import { RACE_CARB_TARGETS_G_PER_HR, GLUCOSE_FRUCTOSE_RATIO, HEAT_CARB_BUMP } from './doctrine/fueling';
import { FIRST_MILE_TARGET } from './doctrine/pacing';

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
  /** Phase chip label — context, not verdict. "Post-race recovery",
   *  "Build", "Build · quality", "Peak", "Taper", "Recovery", etc. */
  phaseLabel: string;
  /** ONE multi-sentence body paragraph in the Coach voice that
   *  combines situation + prescription + execution note. The card
   *  renders this verbatim, no toggle, no headings. */
  voiceLead: string;
  /** Whether this is a hard / quality session vs an easy / recovery
   *  day. */
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
  weather?: {
    tempF?: number;
    /** Dewpoint °F. When present, drives a more accurate Td-aware
     *  slowdown calculation (Research/06 §2 + §10). */
    dewpointF?: number;
    windMph?: number;
    conditions?: string;
  };
  /** Top-line course summary the brief can reference (peak mile, etc.). */
  courseSummary: string;
  /** Race-start elevation, feet. Used for altitude slowdown when
   *  >1000 ft (Research/06 §7). Optional — defaults to sea level. */
  elevationFt?: number;
  /** Goal pace in seconds-per-mile, used to convert the slowdown
   *  percentage into a per-mile seconds adjustment for the brief. */
  goalPaceSPerMi?: number;
  /** Race distance in miles. Heat impact scales with race duration —
   *  a half marathon sees roughly half the heat impact of a marathon
   *  in the same conditions because exposure time is half. Required
   *  for the slowdown calc to reflect distance correctly. */
  raceDistanceMi?: number;
  /** Runner ability tier — picks the right Maughan curve. Default
   *  'mid_pack'. Future: derive from VDOT or recent race times. */
  abilityTier?: 'elite' | 'mid_pack' | 'slow';
  /** Whether the runner is altitude-acclimatized (≥3 weeks at race
   *  altitude). Defaults to acute-traveler. */
  altitudeAcclimatized?: boolean;
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

  // ── Stage 7 · UI consumption layer (stubs) ─────────────────────────
  // These methods exist so the May 9 mockups can be wired now. Each
  // currently returns realistic mock data with correct types. Real
  // implementations land alongside their feeding doctrine modules.

  /** 5-row body-systems readiness card (Glycogen / Muscle / Connective
   *  / CNS / Immune) with healed-date estimates. Surfaces on Overview
   *  + Health pages. (Stub Stage 7 — wire to recovery_protocols.) */
  bodySystems(input: BodySystemsInput): Promise<CoachDecision<BodySystemsReport>>;

  /** 14-week PATH-TO-A-RACE trajectory: weekly mileage curve with phase
   *  tints, peak diamond, race marker. Backs /training PATH chart and
   *  /races A-race hero "Build starts" tile. (Stub Stage 7 — wire to
   *  plan_templates.) */
  trajectory14wk(input: Trajectory14wkInput): Promise<CoachDecision<Trajectory14wk>>;

  /** The key proof workouts upcoming in the build — surfaces on the
   *  /training GOAL TRACKING card as "Proof sessions ahead". (Stub
   *  Stage 7 — wire to plan_templates.) */
  proofSessions(input: ProofSessionsInput): Promise<CoachDecision<ProofSessionsReport>>;

  /** GOAL vs FITNESS vs HEADROOM prediction for a specific race.
   *  Surfaces on /races A-race hero. (Stub Stage 7 — wire to
   *  race_prediction.) */
  raceFitnessPrediction(input: RaceFitnessPredictionInput): Promise<CoachDecision<RaceFitnessPrediction>>;

  /** Week strip — per-day deltas (actual vs planned) with chip labels.
   *  Surfaces on Overview WEEK STRIP cards. (Stub Stage 7 — wire to
   *  plan_templates + strava-actuals join.) */
  weekDeltas(input: WeekDeltasInput): Promise<CoachDecision<WeekDeltasReport>>;

  /** The Coach's read on its own engine state — pace zones, long-run
   *  cap, easy-share target, cutback cadence — plus plan-integrity
   *  validation. Surfaces on /profile COACH DETAILS card. (Stub Stage
   *  7 — wire to multi-doctrine.) */
  engineDetails(input: EngineDetailsInput): Promise<CoachDecision<EngineDetailsReport>>;

  /** Coach Read card for a single run's detail view. Voice verdict +
   *  decision deltas (long-run cap unlocked, baseline bumped, etc.).
   *  (Stub Stage 7 — wire to retrospective + state diff.) */
  runRead(input: RunReadInput): Promise<CoachDecision<RunReadReport>>;

  /** Coach Read mini-takeaway under a race recap. One verdict line +
   *  one body sentence. (Stub Stage 7 — wire to retrospective loop.) */
  coachRead(input: CoachReadInput): Promise<CoachDecision<CoachReadReport>>;
}

// ── Stage 7 stub input types ─────────────────────────────────────────

export interface BodySystemsInput extends CoachBaseContext {
  state: CoachState;
}

export interface Trajectory14wkInput extends CoachBaseContext {
  state: CoachState;
  /** Target race name; defaults to the next A race in state. */
  raceName?: string;
  /** Target race date ISO; defaults to state.races.nextA.dateISO. */
  raceDateISO?: string;
}

export interface ProofSessionsInput extends CoachBaseContext {
  state: CoachState;
  raceName?: string;
  raceDateISO?: string;
}

export interface RaceFitnessPredictionInput extends CoachBaseContext {
  state: CoachState;
  raceName: string;
  raceDateISO: string;
  raceDistanceMi: number;
  /** Goal time in seconds. */
  goalTimeS: number;
}

export interface WeekDeltasInput extends CoachBaseContext {
  state: CoachState;
}

export interface EngineDetailsInput extends CoachBaseContext {
  state: CoachState;
}

export interface RunReadInput extends CoachBaseContext {
  /** Activity ID being read. */
  activityId: number;
  /** Quick facts the report renders against. */
  activity: {
    distanceMi: number;
    durationS: number;
    paceSPerMi: number;
    avgHr: number | null;
    name: string;
    plannedDistanceMi: number | null;
    plannedType: string | null;
  };
  state: CoachState;
}

export interface CoachReadInput extends CoachBaseContext {
  /** Race the read is about. */
  raceName: string;
  raceDateISO: string;
  raceDistanceMi: number;
  /** Finish time in seconds. */
  finishTimeS: number;
  /** Was it a PR? Drives the verdict tone. */
  isPR: boolean;
  /** Average pace s/mi. */
  paceSPerMi: number;
  /** Conditions summary, e.g. "58°F · misty · calm". */
  conditionsLabel?: string;
}

// ── Coach implementation ─────────────────────────────────────────────
// Each method either reads from doctrine deterministically or calls the
// LLM brain. As stages land, methods move from stub → real. Stubs throw
// with a clear "Stage N" hint; real methods have full bodies.

class CoachImpl implements Coach {
  private notYet(stage: number, method: string): never {
    throw new Error(`Coach.${method}() lands in Stage ${stage}. See docs/COACH_BUILD_PLAN.md.`);
  }

  // ── Stage 5 · adjustForReality ─────────────────────────────────────
  // Decide whether today's prescribed workout should change based on
  // recent signals (missed runs, ACWR, sleep debt, HRV trend). Walks the
  // INCOMPLETE_RECOVERY decision matrix from Research/00b — counts how
  // many quantitative signals are firing and maps that count to one of
  // four actions: continue · defer 24-48h · 3-5d cutback · full cutback.
  //
  // The mapping from "action" to a modified WorkoutPrescription:
  //   continue        → same workout, changed=false
  //   defer 24-48h    → drop quality, keep distance (today becomes easy)
  //   3-5d cutback    → recovery jog at 50% distance, no quality
  //   full cutback    → rest, with a "stop training, see medical" note
  //
  // @research Research/00b §Warning Signs of Incomplete Recovery
  //           — Decision Matrix · Quantitative Signals
  //           Research/00a §13.1 ACWR sweet spot 0.8-1.3
  async adjustForReality(input: AdjustForRealityInput): Promise<CoachDecision<AdjustedPlan>> {
    const { signals, scheduledWorkout } = input;

    // Count quantitative signals firing right now. Per
    // INCOMPLETE_RECOVERY_QUANTITATIVE_SIGNALS thresholds (Research/00b).
    const fired: Array<{ signal: string; reason: string }> = [];

    // ACWR danger zone — > 1.5 is the documented injury-risk threshold.
    // Sweet spot is 0.8-1.3 per HSS 2024 marathon research.
    if (signals.acwr > 1.5) {
      fired.push({ signal: 'ACWR', reason: `ACWR ${signals.acwr.toFixed(2)} above 1.5 danger zone` });
    }

    // 5+ days since last run = rebuild territory, not just a deload.
    if (signals.daysSinceLastRun >= 5) {
      fired.push({ signal: 'daysSinceLastRun', reason: `${signals.daysSinceLastRun} days since last run — rebuilding` });
    }

    // 3+ missed runs in 7 days = adherence pattern, not a one-off.
    if (signals.missedRunsLast7d >= 3) {
      fired.push({ signal: 'missedRuns', reason: `${signals.missedRunsLast7d} missed runs in the last 7 days` });
    }

    // Sleep debt threshold: >90 min (≈1.5h) over a week. Per Research/00b
    // sleep efficiency cumulative deficit warning.
    if (signals.sleepDebtMin != null && signals.sleepDebtMin > 90) {
      fired.push({ signal: 'sleepDebt', reason: `${Math.round(signals.sleepDebtMin / 60 * 10) / 10}h sleep debt` });
    }

    // HRV >1 SD below baseline = quantitative recovery signal per
    // Research/00b. We accept a percent-delta input; treat -10% as
    // roughly equivalent to >1 SD drop for a typical RMSSD value.
    if (signals.hrvBaselineDelta != null && signals.hrvBaselineDelta < -10) {
      fired.push({ signal: 'hrv', reason: `HRV ${signals.hrvBaselineDelta.toFixed(0)}% below baseline` });
    }

    const count = fired.length;

    // ── Decision matrix · INCOMPLETE_RECOVERY_DECISION_MATRIX ─────
    // 0-1 → continue · 2 → defer quality · 3+ → cutback.
    // The 5+ days-since-last-run case overrides — that's rebuild,
    // not a "skip today" call.
    if (signals.daysSinceLastRun >= 5) {
      const recoveryMi = Math.max(2.5, Math.min(5.0, scheduledWorkout.distanceMi * 0.5));
      return {
        answer: {
          workout: {
            ...scheduledWorkout,
            type: 'recovery',
            label: 'Recovery jog · returning',
            distanceMi: Math.round(recoveryMi * 10) / 10,
            isQuality: false,
            isLong: false,
            paceTargetSPerMi: null,
            hrZone: 1,
            phaseLabel: 'REBUILD',
            voiceLead: `${signals.daysSinceLastRun} days since your last run — body needs a re-entry, not the prescribed session. Short and very easy today. Build the week back from here.`,
          },
          changed: true,
        },
        rationale: `Rebuild after gap: ${fired.map((f) => f.reason).join('; ')}`,
        citations: [{ doc: 'Research/00b-recovery.md', section: '§Warning Signs of Incomplete Recovery' }],
        brain: 'deterministic',
      };
    }

    if (count <= 1) {
      return {
        answer: { workout: scheduledWorkout, changed: false },
        rationale: count === 0
          ? 'No incomplete-recovery signals firing — today as scheduled.'
          : `One signal firing (${fired[0]!.reason}). Below the defer threshold; continuing as planned.`,
        citations: [{ doc: 'Research/00b-recovery.md', section: '§Warning Signs of Incomplete Recovery' }],
        brain: 'deterministic',
      };
    }

    if (count === 2) {
      // Defer 24-48h on quality. Keep distance, drop intensity.
      if (scheduledWorkout.isQuality) {
        return {
          answer: {
            workout: {
              ...scheduledWorkout,
              type: 'general_aerobic',
              label: `Easy ${scheduledWorkout.distanceMi.toFixed(1)} mi (deferred quality)`,
              isQuality: false,
              paceTargetSPerMi: null,
              hrZone: 2,
              voiceLead: `Two recovery signals firing — ${fired.map((f) => f.reason).join(' and ')}. Keep the volume, drop the intensity today. Re-attempt quality in 24-48h once signals settle.`,
            },
            changed: true,
          },
          rationale: `Defer quality: ${fired.map((f) => f.signal).join(' + ')} both firing`,
          citations: [{ doc: 'Research/00b-recovery.md', section: '§Decision Matrix · 2 quantitative → defer 24-48h' }],
        brain: 'deterministic',
        };
      }
      // Today is already easy — nothing to defer. Continue.
      return {
        answer: { workout: scheduledWorkout, changed: false },
        rationale: `Two signals firing but today is already easy. Continuing as planned.`,
        citations: [{ doc: 'Research/00b-recovery.md', section: '§Warning Signs of Incomplete Recovery' }],
        brain: 'deterministic',
      };
    }

    // count >= 3 → cutback. 50% volume, no quality.
    const cutbackMi = Math.max(0, Math.round(scheduledWorkout.distanceMi * 0.5 * 10) / 10);
    return {
      answer: {
        workout: {
          ...scheduledWorkout,
          type: cutbackMi > 0 ? 'recovery' : 'rest',
          label: cutbackMi > 0 ? `Recovery jog · ${cutbackMi} mi (cutback)` : 'Rest day (cutback)',
          distanceMi: cutbackMi,
          isQuality: false,
          isLong: false,
          paceTargetSPerMi: null,
          hrZone: cutbackMi > 0 ? 1 : null,
          voiceLead: `${count} recovery signals firing simultaneously: ${fired.map((f) => f.reason).join('; ')}. Doctrine says 3+ signals warrants a 3-5 day cutback. Today is the start — 50% volume, no quality. If signals persist past 2 weeks, escalate to a medical/coach review.`,
        },
        changed: true,
      },
      rationale: `Cutback prescribed: ${count} quantitative signals firing`,
      citations: [{ doc: 'Research/00b-recovery.md', section: '§Decision Matrix · 3+ quantitative → 3-5d cutback' }],
      brain: 'deterministic',
    };
  }

  // ── Stage 4 · retrospect ──────────────────────────────────────────
  // Post-race reflection. Parses the plan and actual to find the key
  // deltas — finish-time gap, pacing pattern (positive/even/negative
  // split), how the actual unfolded against the goal — and renders a
  // two-paragraph reflection in the Coach voice.
  //
  // Calibration deltas are conservative by design: we only emit a
  // delta when the evidence is strong enough to NOT be a one-race
  // fluke. Doctrine warns against over-correcting on a single race.
  //
  // @research Research/01 §VDOT calibration windows
  //           Research/00b §Single-race over-correction caution
  async retrospect(input: RetrospectInput): Promise<CoachDecision<RetrospectiveOutput>> {
    const summary = summarizeRetrospect(input.plan, input.actual);

    const paras: string[] = [];

    // Paragraph 1 — the race verdict.
    if (summary.goalDeltaS == null) {
      paras.push(
        `Race in the books. Without a goal time on file I can read the splits but not measure against intent — log the goal next time and the verdict gets sharper.`,
      );
    } else {
      const off = Math.abs(summary.goalDeltaS);
      const dir = summary.goalDeltaS > 0 ? 'over' : 'under';
      const offDisplay = off >= 60 ? `${Math.round(off / 60)} min ${off % 60}s` : `${Math.round(off)}s`;
      if (off <= 30) {
        paras.push(`Goal-line execution — finished ${offDisplay} ${dir} the target. Plan held. The kind of race that calibrates everything else; the engine is exactly where the model predicted.`);
      } else if (summary.goalDeltaS > 0 && off > 30) {
        const cause = summary.splitPattern === 'positive_split'
          ? 'Positive split — second half slowed past the budget.'
          : summary.splitPattern === 'even'
          ? 'Pacing held even but the goal was ahead of current fitness.'
          : 'Mixed pacing with a tough back half.';
        paras.push(`Off goal by ${offDisplay} on the slow side. ${cause} Not a redo-the-plan situation on its own — race day adds friction the engine never sees. Log it, hold the build, see what the next mid-cycle test says.`);
      } else {
        paras.push(`Beat goal by ${offDisplay} — fitness is ahead of where the engine had it placed. ${summary.splitPattern === 'negative_split' ? 'Negative split too, which means the floor is still rising.' : 'Execution clean.'} The plan was conservative; the next build can lean harder.`);
      }
    }

    // Paragraph 2 — pacing pattern + what changes.
    const pacingNote = (() => {
      switch (summary.splitPattern) {
        case 'positive_split':
          return 'Pacing went out hot. The cost showed up in the back half — that\'s usually a goal-pace miscalibration or aid-station discipline, not a fitness ceiling. Two options next time: dial the first-mile target back 5-8 s/mi, or commit to even-effort GAP on hills.';
        case 'negative_split':
          return 'Built into the second half — the gold standard for goal-pace races. Validates that the engine has more room than the goal implied. Next build can hold the same volume but stretch quality reps by a third.';
        case 'even':
          return 'Even-effort pacing across the course — the plan executed exactly as designed. Course shape didn\'t catch you off guard. Repeat the same pacing strategy template at the next A.';
        default:
          return 'Pacing was uneven enough that no clean pattern emerges. Worth reviewing the splits against the elevation chart before drawing structural conclusions.';
      }
    })();
    paras.push(pacingNote);

    // Conservative calibration delta. Single-race over-correction is
    // a documented anti-pattern; emit a delta only on very strong
    // evidence (clear PR pace or clear blown race AND consistent
    // pattern). Otherwise leave the user record alone.
    let calibrationDelta: RetrospectiveOutput['calibrationDelta'] | undefined;
    if (summary.goalDeltaS != null) {
      const offPct = Math.abs(summary.goalDeltaS) / summary.goalFinishS;
      if (summary.goalDeltaS < 0 && offPct > 0.015 && summary.splitPattern === 'negative_split') {
        // Beat goal by >1.5% with a negative split — bump up the
        // engine's pace expectation by 1.5%.
        calibrationDelta = { easyPaceFloorDelta: -summary.actualPaceSPerMi * 0.015 };
      } else if (summary.goalDeltaS > 0 && offPct > 0.04 && summary.splitPattern === 'positive_split') {
        // Off goal by >4% with a positive split — engine over-estimated.
        // Lift the easy-pace floor by 2%.
        calibrationDelta = { easyPaceFloorDelta: summary.actualPaceSPerMi * 0.02 };
      }
    }

    return {
      answer: {
        narrative: paras.join('\n\n'),
        calibrationDelta,
      },
      rationale: `Retrospect from ${summary.actualPaceSPerMi.toFixed(0)} s/mi avg pace, ${summary.splitPattern} split, ${summary.goalDeltaS == null ? 'no goal logged' : `${summary.goalDeltaS > 0 ? '+' : ''}${Math.round(summary.goalDeltaS)}s vs goal`}.`,
      citations: [
        { doc: 'Research/01-fitness.md', section: '§VDOT calibration windows' },
        { doc: 'Research/00b-recovery.md', section: '§Single-race over-correction caution' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 1 · Pace strategy ────────────────────────────────────────
  // Builds per-segment paces from a goal time + course shape using the
  // Minetti grade-adjustment factor (doctrine /Research/01 §Hills via
  // engine-side minetti.ts). The "even effort" strategy holds physical
  // cost constant across grade; pace becomes a function of segment GAF.
  //
  // Even-split prescribes a single flat pace everywhere. Negative-split
  // adds 5 s/mi to the first half then solves the second half to hit
  // the goal total. The first-mile target offset comes from the
  // doctrine FIRST_MILE_TARGET table.
  //
  // @research Research/01 §Daniels training paces · pace prescription
  //           Research/08 §3 First-mile pacing + distance templates
  //           Research/08 §6.1 HR ceilings by distance
  async paceStrategy(input: PaceStrategyInput): Promise<CoachDecision<PaceStrategyOutput>> {
    const { goalFinishS, strategy, totalDistanceM, segmentGradesPct, segmentDistancesM } = input;
    if (segmentGradesPct.length !== segmentDistancesM.length || segmentGradesPct.length === 0) {
      throw new Error('paceStrategy: segmentGradesPct and segmentDistancesM must be the same non-empty length.');
    }

    const totalMi = totalDistanceM / M_PER_MI;
    const flatPace = goalFinishS / totalMi; // s/mi if held flat

    const gafs = segmentGradesPct.map(gradeAdjustmentFactor);
    const segMi = segmentDistancesM.map(m => m / M_PER_MI);

    let segmentTargetPaces: number[];

    if (strategy === 'even_split') {
      // Flat target everywhere. Effort varies with grade; the runner
      // bleeds time on climbs and gains it on descents. Useful only
      // for very flat courses.
      segmentTargetPaces = segMi.map(() => flatPace);
    } else if (strategy === 'even_effort') {
      // Hold cost (Minetti GAF) constant; pace adapts to grade. Sum
      // of (mi × pace) must equal goalFinishS, so we scale:
      //   pace_i = flatPace × GAF_i × k
      //   k = goalFinishS / (flatPace × Σ (mi_i × GAF_i))
      const sumWeighted = segMi.reduce((s, mi, i) => s + mi * gafs[i], 0);
      const k = goalFinishS / (flatPace * sumWeighted);
      segmentTargetPaces = segMi.map((_, i) => flatPace * gafs[i] * k);
    } else if (strategy === 'negative_split') {
      // First half slower (flatPace + 5 s/mi); second half solved to
      // hit the total. Both halves keep even-effort GAF treatment.
      let cum = 0;
      const halfMi = totalMi / 2;
      const firstIdx: number[] = [];
      const secondIdx: number[] = [];
      for (let i = 0; i < segMi.length; i++) {
        if (cum + segMi[i] / 2 < halfMi) firstIdx.push(i);
        else secondIdx.push(i);
        cum += segMi[i];
      }
      const firstFlat = flatPace + 5;
      const firstSumW = firstIdx.reduce((s, i) => s + segMi[i] * gafs[i], 0);
      const firstMi = firstIdx.reduce((s, i) => s + segMi[i], 0);
      const kFirst = firstSumW > 0 ? firstFlat * firstMi / (firstFlat * firstSumW) : 1;
      const paces = new Array<number>(segMi.length).fill(flatPace);
      for (const i of firstIdx) paces[i] = firstFlat * gafs[i] * kFirst;
      const firstTime = firstIdx.reduce((s, i) => s + segMi[i] * paces[i], 0);
      const remainingTime = goalFinishS - firstTime;
      const secondMi = secondIdx.reduce((s, i) => s + segMi[i], 0);
      const secondFlat = secondMi > 0 ? remainingTime / secondMi : flatPace;
      const secondSumW = secondIdx.reduce((s, i) => s + segMi[i] * gafs[i], 0);
      const kSecond = secondSumW > 0 ? remainingTime / (secondFlat * secondSumW) : 1;
      for (const i of secondIdx) paces[i] = secondFlat * gafs[i] * kSecond;
      segmentTargetPaces = paces;
    } else {
      throw new Error(`paceStrategy: unknown strategy "${String(strategy)}"`);
    }

    // Quick rationale referencing the first-mile doctrine. We don't
    // know the race distance bucket for sure, so we pick by miles.
    const distMi = totalMi;
    const distanceBucket: 'marathon' | 'half' | '10K' | '5K' =
      distMi >= 24 ? 'marathon'
      : distMi >= 12 ? 'half'
      : distMi >= 5 ? '10K'
      : '5K';
    const firstMile = FIRST_MILE_TARGET.value[distanceBucket];
    const estimatedFinishS = segMi.reduce((s, mi, i) => s + mi * segmentTargetPaces[i], 0);

    return {
      answer: {
        segmentTargetPaces,
        estimatedFinishS,
      },
      rationale: `${strategy.replace('_', ' ')} — first mile target GP +${firstMile.offsetVsGpSPerMiLow}–${firstMile.offsetVsGpSPerMiHigh} sec/mi (${firstMile.rationale}).`,
      explanation: `Course is ${distMi.toFixed(1)} mi at goal pace ${formatPace(flatPace)}/mi (flat). Per-segment paces follow Minetti energy cost so effort stays constant — climbs slower, descents faster — while the time totals to your goal.`,
      citations: [
        { doc: 'Research/01-pace-zones-vdot.md', section: '§Daniels training paces', snippet: 'Pace prescription per race velocity' },
        { doc: 'Research/08-pacing-and-race-week.md', section: '§3', snippet: 'First-mile pacing offsets by distance' },
        { doc: 'Research/08-pacing-and-race-week.md', section: '§6.1', snippet: 'HR ceilings by distance — backstop, not target' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 1 · Taper depth ──────────────────────────────────────────
  // Returns the % volume reduction the runner should apply for a given
  // race distance × days-to-race. Reads directly from the doctrine
  // TAPER_BY_DISTANCE table (Research/08 §9.1) blended with the legacy
  // TAPER_VOLUME_REDUCTION constant (40–60% from peak for marathon).
  //
  // The percentage is interpolated linearly inside the doctrine band:
  //   days-out > taperDaysHigh  →  0% reduction (still in build)
  //   days-out ≤ taperDaysLow   →  volumeReductionPctHigh (deepest)
  //   in between                →  scale linearly
  //
  // @research Research/08 §9.1 Taper duration by distance
  //           Research/08 §9.2 Marathon 3-week taper structure
  //           legacy doctrine §14 (taper.ts)
  async taperDepth(input: TaperDepthInput): Promise<CoachDecision<number>> {
    const { daysToRace, raceDistanceMi } = input;
    const bucket: 'marathon' | 'half' | '10K' | '5K' =
      raceDistanceMi >= 24 ? 'marathon'
      : raceDistanceMi >= 12 ? 'half'
      : raceDistanceMi >= 7 ? '10K'
      : '5K';
    const band = TAPER_BY_DISTANCE.value[bucket];

    let reductionPct: number;
    if (daysToRace <= 0) {
      reductionPct = band.volumeReductionPctHigh;
    } else if (daysToRace >= band.taperDaysHigh) {
      // Not yet in taper.
      reductionPct = 0;
    } else if (daysToRace <= band.taperDaysLow) {
      // Inside the deepest window.
      reductionPct = band.volumeReductionPctHigh;
    } else {
      // Linearly scale from low (no taper) at taperDaysHigh to high (deep taper) at taperDaysLow.
      const t = (band.taperDaysHigh - daysToRace) / Math.max(1, band.taperDaysHigh - band.taperDaysLow);
      reductionPct = band.volumeReductionPctLow + t * (band.volumeReductionPctHigh - band.volumeReductionPctLow);
    }

    const sensitivity = input.calibration?.taperSensitivity ?? 1.0;
    const adjusted = Math.min(80, Math.max(0, reductionPct * sensitivity));

    const peakLeg = TAPER_VOLUME_REDUCTION.value;
    return {
      answer: Math.round(adjusted),
      rationale: daysToRace >= band.taperDaysHigh
        ? `${daysToRace} days out — still in build phase. No taper reduction yet.`
        : `${daysToRace} days out — ${bucket} taper window is ${band.taperDaysLow}-${band.taperDaysHigh} days. Cut ${Math.round(adjusted)}% from peak volume, largest cuts to easy mileage; preserve quality through the taper.`,
      explanation: `Tapers run ${band.volumeReductionPctLow}-${band.volumeReductionPctHigh}% volume reduction for a ${bucket}. Run frequency stays near ${peakLeg.frequencyPctOfNormal}% so the body keeps its rhythm; the cuts go to easy miles, not to the sharpening work.`,
      citations: [
        { doc: 'Research/08-pacing-and-race-week.md', section: '§9.1 Taper duration by distance', snippet: '5K 5-7d / 10K 7-10d / Half 10-14d / Marathon 14-21d. Volume reduction 25-70%.' },
        { doc: 'Research/08-pacing-and-race-week.md', section: '§9.2 Marathon taper structure', snippet: '3-week marathon taper: 80-90% / 60-70% / 40-50% of peak by week' },
        { doc: 'docs/coaching-research.md', section: '§14', snippet: '40 to 60 percent reduction from peak; largest cuts to easy mileage' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 1 · Fueling plan ─────────────────────────────────────────
  // Distance-aware carb target + gel schedule. The hot-day bump kicks
  // in above 65°F per the doctrine HEAT_CARB_BUMP. Gels are placed at
  // even time intervals across the race, then snapped to the user's
  // verified aid-station miles so absorption lands where they have
  // water to wash it down.
  //
  // @research Research/08 §10.5 Race-day fueling plan (carbs/h × distance)
  //           coaching-research §7.1 60-90 g/h baseline; 80-100 default
  //           coaching-research §7.1 glucose:fructose ratio switchpoint at 90 g/h
  async fuelingFor(input: FuelingInput): Promise<CoachDecision<FuelingPlan>> {
    const { totalDistanceMi, estimatedFinishS, weather, verifiedAidStationMiles, carbToleranceDelta } = input;

    const bucket: 'marathon' | 'half' | '10K' | '5K' =
      totalDistanceMi >= 24 ? 'marathon'
      : totalDistanceMi >= 12 ? 'half'
      : totalDistanceMi >= 7 ? '10K'
      : '5K';
    const distanceBand = RACE_DAY_FUELING.value.carbsPerHourByDistance[bucket];
    const baseline = RACE_CARB_TARGETS_G_PER_HR.value;

    // For races where the doctrine says "none" (5K/10K), short-circuit
    // with a minimal plan that still surfaces the no-fuel guidance.
    if (distanceBand.carbsGPerHrHigh === 0) {
      return {
        answer: {
          carbTargetGPerHr: 0,
          totalCarbsG: 0,
          gelCount: 0,
          gelSchedule: [],
          notes: `${bucket} races are too short to fuel mid-race. Top off with a pre-race gel ~15 min before the gun.`,
        },
        rationale: `${bucket} doesn't need in-race fuel — too short for the gut window to matter.`,
        citations: [
          { doc: 'Research/08-pacing-and-race-week.md', section: '§10.5', snippet: '5K/10K: no in-race fueling' },
        ],
        brain: 'deterministic',
      };
    }

    // Use the middle of the band by default, lifted to the planning
    // target (80-100 g/h) for marathon, where the wall is the limiter.
    const bandMid = (distanceBand.carbsGPerHrLow + distanceBand.carbsGPerHrHigh) / 2;
    let carbTarget = bucket === 'marathon'
      ? Math.max(baseline.defaultLow, Math.min(baseline.defaultHigh, bandMid))
      : bandMid;

    // Heat adjustment.
    if (weather?.tempF != null && weather.tempF > HEAT_CARB_BUMP.value.ifTempFAbove) {
      carbTarget += HEAT_CARB_BUMP.value.bumpGPerHr;
    }
    // Per-user calibration (Stage 4 retrospective).
    if (carbToleranceDelta != null) carbTarget += carbToleranceDelta;
    carbTarget = Math.max(0, Math.round(carbTarget));

    const hours = estimatedFinishS / 3600;
    const totalCarbsG = Math.round(carbTarget * hours);
    // Default to Maurten 100 (25 g/gel). Halve it to keep dosing
    // flexible — the actual product mix is a UI choice.
    const gelCarbsG = 25;
    const gelCount = Math.max(1, Math.ceil(totalCarbsG / gelCarbsG));

    // Even time-spaced anchors, then snap to nearest verified aid
    // station within 1 mile.
    const idealMiles: number[] = [];
    for (let i = 1; i <= gelCount; i++) {
      idealMiles.push((i / (gelCount + 1)) * totalDistanceMi);
    }
    const snapMiles = verifiedAidStationMiles ?? [];
    const gelSchedule = idealMiles.map((ideal, idx) => {
      let bestMi = ideal;
      let bestDelta = Infinity;
      for (const s of snapMiles) {
        if (s <= 0.5 || s >= totalDistanceMi - 0.5) continue;
        const d = Math.abs(s - ideal);
        if (d < 1.0 && d < bestDelta) {
          bestDelta = d;
          bestMi = s;
        }
      }
      return {
        atMi: Math.round(bestMi * 10) / 10,
        item: `Gel #${idx + 1} (${gelCarbsG} g)`,
        gelNumber: idx + 1,
      };
    });

    const overSwitchpoint = carbTarget > GLUCOSE_FRUCTOSE_RATIO.value.switchpointGPerHr;
    const ratioNote = overSwitchpoint
      ? `At ${carbTarget} g/h, use a 1:0.8 glucose:fructose blend — single-source glucose alone hits the gut ceiling near 60 g/h.`
      : `At ${carbTarget} g/h, standard 2:1 glucose:fructose gels work.`;
    const heatNote = weather?.tempF != null && weather.tempF > HEAT_CARB_BUMP.value.ifTempFAbove
      ? ` Heat bump applied (+${HEAT_CARB_BUMP.value.bumpGPerHr} g/h above ${HEAT_CARB_BUMP.value.ifTempFAbove}°F).`
      : '';

    return {
      answer: {
        carbTargetGPerHr: carbTarget,
        totalCarbsG: gelCount * gelCarbsG,
        gelCount,
        gelSchedule,
        notes: `${gelCount} × ${gelCarbsG} g = ${gelCount * gelCarbsG} g total. ${ratioNote}${heatNote}`,
      },
      rationale: `${carbTarget} g/h target for the ${bucket}. ${gelCount} gels at ~30-min intervals, snapped to aid stations so absorption lands with water.`,
      explanation: `Marathon doctrine plans around 80-100 g/h; 60 is the floor. ${ratioNote}${heatNote}`,
      citations: [
        { doc: 'Research/08-pacing-and-race-week.md', section: '§10.5', snippet: 'Carbs/h by distance: HM 30-60; Marathon 60-90; Ultra 90-120' },
        { doc: 'docs/coaching-research.md', section: '§7.1', snippet: '60-90 g/h baseline; planning around 80-100 g/h is reasonable for most marathoners' },
        { doc: 'docs/coaching-research.md', section: '§7.1', snippet: 'At 90 g/h or below, 2:1 (glucose:fructose) is ideal. Above, switch to 1:0.8.' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 7 stubs · UI consumption layer ───────────────────────────
  // These return mock data so the May 9 mockups can be wired before
  // their feeding engines exist. Real implementations land later.

  // STUB · STAGE 7 · TODO: wire to recovery_protocols.ts (§Tissue Healing Timelines)
  // MOCKUP REF: designs/overview-2026-05-09.html:895-961 (BODY SYSTEMS card)
  // MOCKUP REF: designs/health-2026-05-09.html (Body Systems detail)
  async bodySystems(input: BodySystemsInput): Promise<CoachDecision<BodySystemsReport>> {
    const recentRace = input.state.races.recent[0] ?? null;
    const daysSince = recentRace?.daysAgo ?? 6;
    // Mock anchors are the heuristic baselines the mockup shows: a
    // half-marathon 6 days ago. UI just wants realistic values.
    const today = new Date(input.today + 'T12:00:00Z');
    const addDays = (n: number) => {
      const d = new Date(today); d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    const systems: BodySystem[] = [
      {
        id: 'glycogen', label: 'Glycogen', windowLabel: '24-72h',
        state: 'done', readiness: 1.0,
        healedByISO: addDays(-1), daysToHealed: 0,
      },
      {
        id: 'muscle', label: 'Muscle fibers', windowLabel: '5-10d',
        state: 'done', readiness: 0.90,
        healedByISO: addDays(4), daysToHealed: 4,
      },
      {
        id: 'connective', label: 'Connective', windowLabel: '2-4wk',
        state: 'building', readiness: 0.42,
        healedByISO: addDays(15), daysToHealed: 15,
      },
      {
        id: 'cns', label: 'CNS / hormonal', windowLabel: '2-4wk',
        state: 'building', readiness: 0.55,
        healedByISO: addDays(15), daysToHealed: 15,
      },
      {
        id: 'immune', label: 'Immune', windowLabel: '1-3wk',
        state: 'building', readiness: 0.75,
        healedByISO: addDays(8), daysToHealed: 8,
      },
    ];
    // Quality returns when the slowest still-building system finishes.
    const slowestDays = Math.max(...systems.map(s => s.daysToHealed));
    const qualityReturnsISO = addDays(slowestDays);

    return {
      answer: {
        daysSincePeakStress: daysSince,
        contextLabel: daysSince < 14 ? 'REBUILDING' : 'RECOVERED',
        systems,
        qualityReturnsISO,
        rationale: `${daysSince} days post-${recentRace ? recentRace.name : 'last hard effort'}. Glycogen and muscle are back; connective and CNS still in repair. Quality work returns when the slowest system tops out — about ${slowestDays} days.`,
      },
      rationale: `${daysSince} days post-stressor. ${systems.filter(s => s.state === 'done').length}/${systems.length} systems healed.`,
      citations: [
        { doc: 'Research/00b-recovery-protocols.md', section: '§Tissue Healing Timelines', snippet: 'Per-system recovery windows: glycogen 24-72h, muscle fibers 5-10d, connective 2-4wk, CNS/hormonal 2-4wk, immune 1-3wk' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to plan_templates.ts + race goal
  // MOCKUP REF: designs/training-2026-05-09.html:502-606 (PATH TO AFC chart)
  // MOCKUP REF: designs/races-2026-05-09.html (BUILD STARTS tile)
  async trajectory14wk(input: Trajectory14wkInput): Promise<CoachDecision<Trajectory14wk>> {
    const nextA = input.state.races.nextA;
    const raceName = input.raceName ?? nextA?.name ?? 'AFC Half';
    const raceDateISO = input.raceDateISO ?? nextA?.date ?? input.today;
    const today = new Date(input.today + 'T12:00:00Z');
    const raceDate = new Date(raceDateISO + 'T12:00:00Z');
    const daysToRace = Math.max(0, Math.round((raceDate.getTime() - today.getTime()) / 86_400_000));
    const totalWeeks = 14;

    // Build a curve like the mockup: ~30 mi peaking at 44, with a
    // cutback every 3 weeks and a 3-week taper at the end.
    const addWeeks = (n: number) => {
      const d = new Date(today); d.setUTCDate(d.getUTCDate() + n * 7);
      return d.toISOString().slice(0, 10);
    };

    const plannedSeries = [
      // past (4 weeks) — for context only
      20, 24, 14, 8,
      // base wk1 (today)
      14,
      // build wk 2-10
      19, 24, 18, 28, 32, 26, 36, 40, 42,
      // peak
      44, 42,
      // taper
      32, 18,
    ];
    const actualSeries: Array<number | null> = [21, 23.5, 14, 8.1, null]; // past + this week null until done
    while (actualSeries.length < plannedSeries.length) actualSeries.push(null);

    const points: TrajectoryPoint[] = plannedSeries.map((mi, i) => {
      const weekOffset = i - 4; // 0 = this week
      let phase: TrajectoryPoint['phase'];
      if (i < 4) phase = 'past';
      else if (i < 5) phase = 'base';
      else if (i < 13) phase = 'build';
      else if (i < 15) phase = 'peak';
      else phase = 'taper';
      const isPeak = i === 13;
      const isRaceWeek = i === plannedSeries.length - 1;
      return {
        weekStartISO: addWeeks(weekOffset),
        label: isPeak ? 'PEAK' : isRaceWeek ? 'RACE' : `WK ${i - 3}`,
        plannedMi: mi,
        actualMi: actualSeries[i],
        phase,
        isPeak,
        isRaceWeek,
      };
    });

    return {
      answer: {
        raceName,
        raceDateISO,
        totalWeeks,
        daysToRace,
        points,
        summary: {
          totalBuildMi: 402,
          peakWeekMi: 44,
          longRunMaxMi: 14,
          qualityDays: 28,
          racePaceMi: 52,
          cutbacks: 3,
        },
        rationale: `${daysToRace} days · 5 phases · peaks at 44 mi/wk`,
      },
      rationale: `${totalWeeks}-week build to ${raceName}, peaking at 44 mi/wk three weeks out.`,
      citations: [
        { doc: 'Research/22-plan-templates.md', section: '§Plan skeletons', snippet: '14-week half-marathon build skeleton' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to plan_templates.ts (quality session catalog)
  // MOCKUP REF: designs/training-2026-05-09.html:277-322 (PROOF SESSIONS card)
  async proofSessions(input: ProofSessionsInput): Promise<CoachDecision<ProofSessionsReport>> {
    const nextA = input.state.races.nextA;
    const raceName = input.raceName ?? nextA?.name ?? 'AFC Half';
    const today = new Date(input.today + 'T12:00:00Z');
    const addDays = (n: number) => {
      const d = new Date(today); d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    const sessions: ProofSession[] = [
      {
        dateISO: addDays(15),
        label: 'First T tempo',
        structure: '4 × 1MI @ T',
        phaseTag: 'BUILD-WK 2',
        targetPaceDisplay: '7:00/MI',
        priority: 'milestone',
      },
      {
        dateISO: addDays(34),
        label: 'First HMP miles',
        structure: '3 × 2MI @ HMP',
        phaseTag: 'BUILD-WK 5',
        targetPaceDisplay: '7:15/MI',
        priority: 'milestone',
      },
      {
        dateISO: addDays(42),
        label: 'Mission Bay 10K',
        structure: 'B-RACE TUNE-UP',
        phaseTag: 'FITNESS CHECK',
        targetPaceDisplay: '6:46/MI',
        priority: 'race',
      },
      {
        dateISO: addDays(62),
        label: 'Race-pace 8mi',
        structure: 'CONTINUOUS @ HMP',
        phaseTag: 'PEAK-WK 1',
        targetPaceDisplay: '7:15/MI',
        priority: 'milestone',
      },
    ];

    return {
      answer: {
        raceName,
        totalProofs: sessions.length,
        buildLengthWk: 14,
        sessions,
        latestCompleted: {
          dateISO: addDays(-18),
          label: '3 × 1mi @ T pace',
          summary: '6:55 avg (target 7:00). HR 167 avg, sustainable.',
          onTarget: true,
        },
      },
      rationale: `${sessions.length} proof sessions across the ${14}-week build to ${raceName}.`,
      citations: [
        { doc: 'Research/22-plan-templates.md', section: '§Plan skeletons', snippet: 'Key quality sessions per phase' },
        { doc: 'Research/04-workout-vocabulary.md', section: '§Threshold + tempo', snippet: 'T pace workout dosing' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to race_prediction.ts (VDOT × course correction)
  // MOCKUP REF: designs/races-2026-05-09.html:168-188 (A-race hero quad)
  // MOCKUP REF: designs/overview-2026-05-09.html (UP-NEXT B-race chip)
  async raceFitnessPrediction(input: RaceFitnessPredictionInput): Promise<CoachDecision<RaceFitnessPrediction>> {
    const { raceName, raceDateISO, raceDistanceMi, goalTimeS } = input;
    // Mock VDOT-derived prediction — 2% faster than goal pace.
    const goalPace = goalTimeS / raceDistanceMi;
    const predictedPace = goalPace * 0.98;
    const predictedTimeS = predictedPace * raceDistanceMi;
    const headroomSPerMi = goalPace - predictedPace;
    const vdot = 49.2;
    const stretchPace = goalPace * 0.95;
    const stretchTimeS = stretchPace * raceDistanceMi;

    return {
      answer: {
        raceName,
        raceDateISO,
        raceDistanceMi,
        goalTimeS,
        goalDisplay: formatTime(goalTimeS),
        goalPaceSPerMi: goalPace,
        predictedTimeS,
        predictedDisplay: formatTime(predictedTimeS),
        predictedPaceSPerMi: predictedPace,
        vdot,
        headroomSPerMi,
        confidence: headroomSPerMi > 10 ? 'high' : headroomSPerMi > 0 ? 'medium' : 'low',
        stretchDisplay: formatTime(stretchTimeS),
        rationale: `Fitness predicts ${formatTime(predictedTimeS)} — ${Math.round(headroomSPerMi)} sec/mi of headroom against goal.`,
      },
      rationale: `Predicted ${formatTime(predictedTimeS)} on VDOT ${vdot}; goal ${formatTime(goalTimeS)}.`,
      citations: [
        { doc: 'Research/02-race-time-prediction.md', section: '§Riegel + course adjustments', snippet: 'Race time prediction from VDOT with distance + terrain corrections' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 7 · weekDeltas (real data) ────────────────────────────
  // Per-day planned-vs-actual for the current Mon→Sun week.
  //
  //   planned   ← coach engine simulateNext30Days() output, filtered
  //               to dates in this week. The engine already knows the
  //               runner's tier, phase, post-race recovery state, and
  //               rest-day cadence — same numbers shown on /training.
  //   actual    ← state.volume.last7Days (real Strava activities by
  //               date). Future dates have no actual yet; we leave
  //               actualMi null so the UI doesn't render a DONE pill.
  //
  // The projection adds remaining-week planned to logged-so-far and
  // biases by the observed over/under-plan trend on completed days.
  // MOCKUP REF: designs/overview-2026-05-09.html:629-650 (WEEK STRIP day cards)
  async weekDeltas(input: WeekDeltasInput): Promise<CoachDecision<WeekDeltasReport>> {
    const today = new Date(input.today + 'T12:00:00Z');
    const dow = today.getUTCDay(); // 0 = Sun
    const monOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today); monday.setUTCDate(monday.getUTCDate() + monOffset);
    const mondayISO = monday.toISOString().slice(0, 10);

    // Run the coach engine once for its real weekShape (this week's
    // Mon→Sun plan). Index by ISO date for lookup.
    const coachOutput = coachDaily(input.state);
    const plannedByDate = new Map<string, number>();
    for (const d of coachOutput.weekShape) {
      plannedByDate.set(d.date, d.distanceMi);
    }

    // Actuals from real Strava activities (already populated in state
    // by gatherCoachState). Index by date.
    const actualByDate = new Map<string, number>();
    for (const d of input.state.volume.last7Days) {
      actualByDate.set(d.date, d.miles);
    }

    const dayNames = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
    const todayISO = input.today;
    const days: DayDelta[] = dayNames.map((label, i) => {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
      const dateISO = d.toISOString().slice(0, 10);
      const isFuture = dateISO > todayISO;
      const p = plannedByDate.get(dateISO) ?? 0;
      // Future dates never have actuals — never query the actuals map.
      const a = isFuture ? null : (actualByDate.get(dateISO) ?? (dateISO === todayISO ? null : 0));
      const delta = a == null ? null : a - p;
      let pin: string | null = null;
      let severity: DayDelta['severity'] = null;
      if (delta != null) {
        if (Math.abs(delta) < 0.3) { pin = 'ON PLAN'; severity = 'good'; }
        else if (delta > 0) { pin = `+${delta.toFixed(1)} vs plan`; severity = 'over'; }
        else { pin = `${delta.toFixed(1)} vs plan`; severity = 'warn'; }
      }
      return {
        dateISO,
        dayLabel: label,
        plannedMi: p,
        actualMi: a,
        deltaMi: delta,
        pinLabel: pin,
        severity,
      };
    });

    const plannedWeekMi = days.reduce((s, d) => s + d.plannedMi, 0);
    const loggedWeekMi = days.reduce<number>((s, d) => s + (d.actualMi ?? 0), 0);
    // Naive projection: actuals so far + planned for remaining days, plus
    // the observed over-plan trend on completed days.
    const completedDelta = days.filter(d => d.deltaMi != null).reduce((s, d) => s + (d.deltaMi ?? 0), 0);
    const remainingPlanned = days.filter(d => d.actualMi == null).reduce((s, d) => s + d.plannedMi, 0);
    const projectedWeekMi = Math.round((loggedWeekMi + remainingPlanned + completedDelta * 0.3) * 10) / 10;
    const netDeltaMi = projectedWeekMi - plannedWeekMi;

    return {
      answer: {
        weekStartISO: mondayISO,
        plannedWeekMi,
        loggedWeekMi,
        projectedWeekMi,
        netDeltaMi,
        days,
        rationale: netDeltaMi > 0
          ? `Projecting ${projectedWeekMi.toFixed(1)} mi · +${netDeltaMi.toFixed(1)} over plan.`
          : `On track for ${projectedWeekMi.toFixed(1)} mi.`,
      },
      rationale: `Week projecting ${projectedWeekMi.toFixed(1)} mi vs ${plannedWeekMi.toFixed(1)} planned.`,
      citations: [
        { doc: 'Research/22-plan-templates.md', section: '§Week structure', snippet: 'Weekly volume tracking with projected overshoot detection' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to multi-doctrine (pace_zones, plan_templates, training)
  // MOCKUP REF: designs/profile-2026-05-09.html:605-686 (COACH DETAILS card)
  async engineDetails(input: EngineDetailsInput): Promise<CoachDecision<EngineDetailsReport>> {
    // Mock — pulls in the four cards shown in the profile mockup.
    void input.state;
    const details: EngineDetail[] = [
      {
        id: 'pace_zones',
        label: 'YOUR PACE ZONES',
        valueDisplay: 'From VDOT 49.2',
        explanation: 'The Coach prescribes every run inside one of these 5 pace bands.',
        sourceLabel: 'VDOT 49.2',
        doctrineModule: 'pace_zones',
      },
      {
        id: 'long_run_cap',
        label: 'NEXT WEEK\'S LONG-RUN LIMIT',
        valueDisplay: '8.2 MI',
        explanation: 'The Coach won\'t prescribe a long run over 8.2 mi next week — keeps the jump safe. Your longest run in the last 28 days was 7.4 mi; Coach caps the next at +10% to prevent spikes.',
        sourceLabel: '+10% rule',
        doctrineModule: 'training',
      },
      {
        id: 'easy_share',
        label: 'EASY-PACE TARGET',
        valueDisplay: '≥80%',
        explanation: 'At least 80% of your weekly miles should be at easy pace. You\'re at 92%. Polarized training: lots of easy + a little hard beats lots of moderate. Reduces injury, builds aerobic engine.',
        sourceLabel: 'Polarized 80/20',
        doctrineModule: 'training',
      },
      {
        id: 'cutback_cadence',
        label: 'RECOVERY WEEK CADENCE',
        valueDisplay: 'Every 3 WKS',
        explanation: 'Every 3rd week the Coach drops volume −20% so the body can absorb training. At your mileage tier (low band, 20-40 mi/wk), 3-week blocks balance stimulus and recovery without losing fitness.',
        sourceLabel: '3-week cycle',
        doctrineModule: 'plan_templates',
      },
    ];
    return {
      answer: {
        details,
        planIntegrity: {
          rulesPassed: 12,
          rulesTotal: 12,
          allPassing: true,
          summary: 'All 12 doctrine rules pass against current plan. No regressions detected.',
        },
      },
      rationale: 'Engine state surface: 4 user-facing rules + plan integrity validation.',
      citations: [
        { doc: 'Research/00a-distance-running-training.md', section: '§Polarized', snippet: '80/20 easy/hard share' },
        { doc: 'Research/01-pace-zones-vdot.md', section: '§Pace zones', snippet: 'VDOT-anchored pace bands' },
        { doc: 'Research/22-plan-templates.md', section: '§Cutbacks', snippet: 'Every-3-week cutback cadence' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to retrospective + Coach state diff
  // MOCKUP REF: designs/_template-detail-2026-05-09.html:449-477 (COACH READ card on run detail)
  async runRead(input: RunReadInput): Promise<CoachDecision<RunReadReport>> {
    const { activity } = input;
    const plannedMi = activity.plannedDistanceMi ?? 0;
    const deltaMi = activity.distanceMi - plannedMi;
    const overshootFlag = deltaMi > 2 && (activity.avgHr == null || activity.avgHr < 145);
    return {
      answer: {
        verdict: overshootFlag ? 'Recovery run, but you absorbed more.' : 'Steady aerobic work — stayed inside the plan.',
        body: overshootFlag
          ? `Ran +${deltaMi.toFixed(1)} mi over plan at controlled effort. HR stayed Z1–Z2 the whole way. Coach bumped baseline +12%, lifted long-run cap to 8.2 mi.`
          : `Held the prescribed pace and effort. No changes to plan.`,
        unlockPin: overshootFlag ? '+12% BASELINE UNLOCKED' : null,
        deltas: overshootFlag
          ? [
              { label: 'VOL / WK', wasDisplay: '14', nowDisplay: '17 mi' },
              { label: 'LONG RUN CAP', wasDisplay: '7.4', nowDisplay: '8.2 mi' },
            ]
          : [],
      },
      rationale: overshootFlag ? '+12% baseline unlocked.' : 'No state change.',
      citations: [
        { doc: 'Research/00a-distance-running-training.md', section: '§Progressive overload', snippet: '+10% rule for weekly volume jumps' },
      ],
      brain: 'deterministic',
    };
  }

  // STUB · STAGE 7 · TODO: wire to retrospective loop (post-race verdict)
  // MOCKUP REF: designs/races-2026-05-09.html:235-239 (COACH READ recap)
  // MOCKUP REF: designs/_template-detail-2026-05-09.html (race detail Coach Read)
  async coachRead(input: CoachReadInput): Promise<CoachDecision<CoachReadReport>> {
    const { raceName, paceSPerMi, isPR } = input;
    const pin = isPR ? 'PR' : 'ON TRACK';
    return {
      answer: {
        verdict: isPR
          ? `${raceName} PR — aerobic engine confirmed.`
          : `${raceName} — solid effort, no surprises.`,
        body: `Sustained ${formatPace(paceSPerMi)}/mi avg with no late fade. Aerobic engine confirmed for the next build — fitness on track for the goal.`,
        pin,
      },
      rationale: isPR ? `PR confirmed. Aerobic base proven.` : `Effort logged.`,
      citations: [
        { doc: 'Research/02-race-time-prediction.md', section: '§Negative splits + late-race fade', snippet: 'A flat or negative-split race confirms aerobic readiness' },
      ],
      brain: 'deterministic',
    };
  }

  // ── Stage 3 · Daily prescription ───────────────────────────────────
  // Wraps the existing coachDaily() engine. The engine's output is
  // already deterministic and well-tested; we attach citations and a
  // voice-cleaned rationale so the daily card on /training has the
  // same audit trail as race-morning brief.
  async prescribeWorkout(input: PrescribeWorkoutInput): Promise<CoachDecision<WorkoutPrescription>> {
    const today = coachDaily(input.state);
    const t = today.today;
    const isLong = t.type.startsWith('long_');
    const isQuality = today.alerts.some(a => a.severity === 'rest') ? false : isHardWorkoutType(t.type);
    const paceBand = t.paceTargetSPerMi
      ? { lower: t.paceTargetSPerMi.lowS, upper: t.paceTargetSPerMi.highS }
      : null;
    const phaseLabel = composePhaseLabel(today.phase, today.mode, isQuality, input.state);
    const voiceLead = composeVoiceLead({
      workoutType: t.type,
      label: t.label,
      distanceMi: t.distanceMi,
      paceBand: t.paceTargetSPerMi,
      isLong,
      state: input.state,
    });
    return {
      answer: {
        type: t.type,
        label: t.label,
        distanceMi: t.distanceMi,
        paceTargetSPerMi: paceBand,
        hrZone: t.hrZone,
        phaseLabel,
        voiceLead,
        isQuality,
        isLong,
        coachToday: today,
      },
      rationale: today.rationale,
      explanation: voiceLead,
      citations: citationsForWorkoutType(t.type),
      brain: 'deterministic',
    };
  }

  // ── Stage 3 · Readiness ────────────────────────────────────────────
  // Pure deterministic. Sweet-spot logic (doctrine §13.1) drives the
  // band, with one important context check first: if the runner just
  // raced or is in a heavy-block recovery, the load drop is INTENTIONAL,
  // not a sign of a slack week. The Coach should reflect that.
  async assessReadiness(input: AssessReadinessInput): Promise<CoachDecision<ReadinessAssessment>> {
    const s = input.state;
    const ratio = acwr(s);
    const phase = (s.races.nextA != null && s.races.inWindow.some(r => r.priority === 'A')) ? 'BUILD' : 'BASE_MAINTENANCE';
    const target = intensityTarget(phase as Parameters<typeof intensityTarget>[0]);
    const easy = s.intensity.easyShare14d;
    const missedRunsSignal = s.recovery.daysSinceLastRun >= 3;
    const recentRace = s.races.recent[0] ?? null;
    const inRaceRecovery = recentRace != null && recentRace.daysAgo <= 14;
    const heavyBlock = s.flags.heavyBlockSuspected;

    let level: 'green' | 'yellow' | 'red' = 'green';
    let reason = '';

    // ── Recovery context first — overrides ratio drift signals.
    if (heavyBlock || inRaceRecovery) {
      level = 'green';
      if (heavyBlock) {
        reason = `Recovery is the work right now. You've stacked races — letting the body absorb them is what turns racing into fitness.`;
      } else if (recentRace) {
        reason = `${recentRace.daysAgo} day${recentRace.daysAgo === 1 ? '' : 's'} since ${recentRace.name}. The volume drop is by design — let the legs come back when they're ready.`;
      }
    }
    // ── Then the ratio bands (only fire when no recovery context).
    else if (ratio != null && ratio > 1.5) {
      level = 'red';
      reason = `Recent volume is way above your normal — last 7 days are ${Math.round(ratio * 100)}% of your usual weekly average. Today's a pull-back day.`;
    } else if (ratio != null && ratio < 0.5) {
      level = 'red';
      reason = `Last 7 days are ${Math.round(ratio * 100)}% of your usual — too far off to call you ready. Easy run today, see how the legs feel.`;
    } else if (ratio != null && ratio > ACWR_HIGH) {
      level = 'yellow';
      reason = `Volume's been running hot — last 7 days are ${Math.round(ratio * 100)}% of your normal. Hold the easy days honestly, don't pile on hard work.`;
    } else if (ratio != null && ratio < ACWR_LOW) {
      level = 'yellow';
      reason = `Mileage was light last week — about ${Math.round(ratio * 100)}% of your usual. Ease back in, don't try to make it up in one day.`;
    } else if (easy > 0 && easy < target.easyShareMin) {
      level = 'yellow';
      reason = `Easy runs have been drifting too fast — only ${Math.round(easy * 100)}% of the last 14 days were truly easy. Run today's first mile by feel, then add 30 seconds.`;
    } else if (missedRunsSignal) {
      level = 'yellow';
      reason = `${s.recovery.daysSinceLastRun} days since the last run. You're not falling apart — get out the door, easy pace, get some miles.`;
    } else {
      level = 'green';
      reason = `The legs look ready. Trust today's plan.`;
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
    // Compute the deterministic weather slowdown — this runs whether
    // or not the LLM is available, and feeds both the fallback voice
    // and the LLM context. Single source of numeric truth (per
    // Research/06 §10 race-day decision flow).
    const slowdown = input.weather?.tempF != null
      ? computeWeatherSlowdown({
          tairF: input.weather.tempF,
          dewpointF: input.weather.dewpointF,
          windMph: input.weather.windMph,
          elevationFt: input.elevationFt,
          altitudeAcclimatized: input.altitudeAcclimatized,
          runnerPaceSPerMi: input.goalPaceSPerMi,
          abilityTier: input.abilityTier ?? 'mid_pack',
          raceDistanceMi: input.raceDistanceMi,
        })
      : null;
    const slowdownLine = slowdown ? formatSlowdownForBrief(slowdown) : null;

    // Inner helper — the deterministic brief. Used when the LLM is
    // unavailable (no key) OR when it's available but throws (529
    // overloaded, network blip, etc). Same voice, just generic.
    const buildDeterministic = (): CoachDecision<string> => {
      const tempStr = input.weather?.tempF != null
        ? `${Math.round(input.weather.tempF)}°F${input.weather.dewpointF != null ? ` / ${Math.round(input.weather.dewpointF)}°F dewpoint` : ''}`
        : null;
      // Tier the conditions into framing bands. Below ~1.5% the
      // adjustment is inside pacing variability — call it "typical
      // for the course" rather than a real callout. 1.5-3% reads as
      // "modest cost, hold your line." 3%+ is real, slow the start.
      // Bail flags override entirely.
      const weatherClause = (() => {
        if (!slowdown || tempStr == null) {
          return input.weather?.tempF != null
            ? `${tempStr} start — run the plan as written.`
            : 'Trust the plan.';
        }
        if (slowdown.bailFlag === 'cancel') {
          return `${tempStr} — ${slowdownLine}. HEADS UP: ${slowdown.bailReason} If conditions hold, the goal becomes finish over time, not your time goal.`;
        }
        if (slowdown.bailFlag === 'easy_only' || slowdown.totalPct >= 5) {
          return `${tempStr} — ${slowdownLine}. The conditions are real today; running goal pace is fighting biology. Drop into effort-mode early and let the time fall where it falls.`;
        }
        if (slowdown.totalPct >= 3) {
          return `${tempStr} — ${slowdownLine}. Modest cost vs a cool baseline; first three miles slower than you want, then lock in.`;
        }
        if (slowdown.totalPct >= 1.5) {
          return `${tempStr} — ${slowdownLine}. Inside what your goal already factors in if you've raced this course before. Hold the line.`;
        }
        // <1.5%: informational only — don't make the runner second-guess.
        return `${tempStr} — typical race-day conditions for the course. Goal pace stands.`;
      })();
      const bailClause = '';
      return {
        answer: `Morning. The training is done. ${weatherClause}${bailClause} First three miles slower than you want. Whatever you feel right now is nerves, not fitness — let them sit. Run your race.`,
        rationale: slowdown
          ? `Weather slowdown computed: ${slowdown.totalPct.toFixed(1)}% (${slowdown.rationale.join('; ') || 'neutral conditions'}).`
          : 'Conservative start + trust-the-plan default. No weather forecast provided.',
        citations: [
          { doc: 'Research/06-weather-adjustments.md', section: '§10', snippet: 'race-day recalibration combines heat + altitude + wind into a single per-mile target' },
          { doc: 'Research/08-pacing-and-race-week.md', section: '§3.5', snippet: 'first miles 1-3 at GP+10-20 sec/mi for marathon — every fast plan dies in the opening miles' },
        ],
        brain: 'deterministic',
      };
    };

    if (!llmAvailable()) {
      return buildDeterministic();
    }

    const weatherLine = input.weather
      ? `Weather: ${input.weather.tempF}°F${input.weather.dewpointF != null ? `, ${input.weather.dewpointF}°F dewpoint` : ''}${input.weather.windMph != null ? `, ${input.weather.windMph} mph wind` : ''}${input.weather.conditions ? `, ${input.weather.conditions}` : ''}.`
      : 'Weather: no specific forecast.';

    // Inject the deterministic slowdown into the LLM context so the
    // model uses a real number rather than guessing at heat impact.
    // FRAMING: the slowdown is the cost vs a cool-baseline goal, NOT
    // a mandate that the runner must slow down. A goal time set for
    // a specific race usually already accounts for that course's
    // typical race-day conditions.
    const slowdownContext = slowdown && slowdown.totalPct >= 0.5
      ? [
          '',
          `COMPUTED WEATHER SLOWDOWN (per Research/06 race-day decision flow):`,
          `  Total adjustment: ${slowdown.totalPct.toFixed(1)}% slower than a hypothetical cool-baseline race`,
          slowdown.perMileSecs != null ? `  Per-mile cost vs cool baseline: about +${slowdown.perMileSecs} sec/mi` : null,
          ...slowdown.rationale.map(r => `  • ${r}`),
          slowdown.bailFlag ? `  BAIL FLAG: ${slowdown.bailFlag} — ${slowdown.bailReason}` : null,
          '',
          'INTERPRETATION GUIDE for the brief:',
          '  - <1.5%: noise band. Mention the temp + "typical for the course." Goal pace stands.',
          '  - 1.5-3%: modest cost. If runner has raced this course before, the goal probably accounts for it.',
          '  - 3-5%: real cost. First miles conservative; runner may need to flex 5-10 sec/mi off goal.',
          '  - 5%+ or any bail flag: conditions exceed typical. Goal becomes finish-strong, not time.',
          '',
          'Use these numbers in the brief. Don\'t guess at heat impact; the calculation is research-anchored. Frame the slowdown as informational — the runner\'s goal time was almost certainly set with the course\'s typical conditions in mind, so do NOT instruct them to add the slowdown to their goal pace unless conditions are clearly above typical.',
        ].filter((s): s is string => s != null).join('\n')
      : '';

    const userPrompt = [
      `Write a race-morning brief for ${input.raceName} on ${input.raceDate}.`,
      `Goal: ${input.goalDisplay}.`,
      `Course: ${input.courseSummary}`,
      weatherLine,
      slowdownContext,
      '',
      'The brief is what the runner reads over coffee. One short paragraph. Voice rules apply (plain language, no §-numbers in the rationale, no jargon-without-translation). Acknowledge real conditions with the computed slowdown number when one is provided, give pace-band guidance for the opening miles, mention fuel timing, and end with a single line of focus.',
    ].join('\n');

    try {
      return await callCoachLLM<string>({
        scope: 'running',
        userPrompt,
        answerSchema: 'a single paragraph (3–6 sentences) of race-morning brief in the Coach voice',
        maxTokens: 600,
      });
    } catch (e) {
      // LLM hiccup (529 overloaded, network blip, key revoked, etc).
      // Fall through to the deterministic brief so the page still works.
      // Logged so the operator can spot a pattern, but the runner just
      // sees the generic voice — not a raw error.
      console.warn('[coach.briefRaceMorning] LLM failed, falling back to deterministic:', e instanceof Error ? e.message : e);
      return buildDeterministic();
    }
  }
}

/** Plain-English phase label for the corner chip on the daily card.
 *  Surfaces TRAINING CONTEXT (not a readiness verdict). The chip shows
 *  alongside today's prescription so the user can see, at a glance,
 *  why today looks the way it does. */
function composePhaseLabel(
  phase: string,
  mode: 'race' | 'base',
  isQuality: boolean,
  state: CoachState,
): string {
  // State-driven overrides — these read truer than the underlying phase.
  if (state.flags.heavyBlockSuspected) return 'Recovery';
  if (state.flags.rebuildAfterBreak) return 'Rebuilding';
  // Phase-driven defaults.
  switch (phase) {
    case 'POST_RACE': return 'Post-race recovery';
    case 'REBUILD':   return 'Rebuilding';
    case 'TAPER':     return 'Taper';
    case 'PEAK':      return isQuality ? 'Peak · quality' : 'Peak';
    case 'BUILD':     return isQuality ? 'Build · quality' : 'Build';
    case 'BASE':      return 'Base';
    case 'BASE_MAINTENANCE': return mode === 'base' ? 'Maintenance' : 'Base';
    default:          return mode === 'race' ? 'Build' : 'Base';
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

/** Format s/mi as "M:SS" pace string. Used by paceStrategy + coachRead. */
function formatPace(sPerMi: number): string {
  if (!isFinite(sPerMi) || sPerMi <= 0) return '—';
  const mm = Math.floor(sPerMi / 60);
  const ss = Math.round(sPerMi - mm * 60);
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

/** Format duration in seconds as "H:MM:SS". Used by raceFitnessPrediction. */
function formatTime(s: number): string {
  if (!isFinite(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const sec = Math.round(s - h * 3600 - m * 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Best-effort summary of a race retrospect input. Both `plan` and
 *  `actual` are typed `unknown` so this does runtime-safe extraction:
 *  it reads named numeric fields if present, returns a defaulted-out
 *  summary otherwise. Conservative — never throws, never crashes the
 *  Coach if the caller hands in malformed data. */
function summarizeRetrospect(plan: unknown, actual: unknown): {
  goalFinishS: number;
  actualFinishS: number;
  goalDeltaS: number | null;
  actualPaceSPerMi: number;
  splitPattern: 'positive_split' | 'negative_split' | 'even' | 'unclear';
} {
  const planObj = (plan && typeof plan === 'object') ? plan as Record<string, unknown> : {};
  const actualObj = (actual && typeof actual === 'object') ? actual as Record<string, unknown> : {};

  const goalFinishS = numOrZero(planObj.goalFinishS) || numOrZero(planObj.goalSeconds);
  const actualFinishS = numOrZero(actualObj.finishS) || numOrZero(actualObj.elapsedS) || numOrZero(actualObj.finishSeconds);
  const totalMi = numOrZero(planObj.distanceMi) || numOrZero(actualObj.distanceMi) || 13.1;
  const actualPaceSPerMi = actualFinishS > 0 ? actualFinishS / totalMi : 0;

  const goalDeltaS = (goalFinishS > 0 && actualFinishS > 0) ? actualFinishS - goalFinishS : null;

  // Detect pacing pattern from per-mile splits when present. Compare
  // first-half avg pace to second-half avg pace.
  const splits = Array.isArray(actualObj.miles) ? actualObj.miles as unknown[] : [];
  let splitPattern: 'positive_split' | 'negative_split' | 'even' | 'unclear' = 'unclear';
  if (splits.length >= 6) {
    const halfIdx = Math.floor(splits.length / 2);
    const paces = splits.map((m) => {
      if (!m || typeof m !== 'object') return null;
      const obj = m as Record<string, unknown>;
      return numOrZero(obj.paceSPerMi) || null;
    }).filter((p): p is number => p != null && p > 0);
    if (paces.length >= 6) {
      const firstAvg = avg(paces.slice(0, halfIdx));
      const secondAvg = avg(paces.slice(halfIdx));
      const driftPct = (secondAvg - firstAvg) / firstAvg;
      if (driftPct > 0.025) splitPattern = 'positive_split';
      else if (driftPct < -0.015) splitPattern = 'negative_split';
      else splitPattern = 'even';
    }
  }

  return { goalFinishS, actualFinishS, goalDeltaS, actualPaceSPerMi, splitPattern };
}

function numOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** The singleton Coach. Import via `import { coach } from '@/coach/coach'`.
 *  Stage 2 implements `briefRaceMorning`; Stage 3 adds `prescribeWorkout`
 *  + `assessReadiness`; Stage 4 wires `retrospect`; Stage 5 wires
 *  `adjustForReality`. Each stage flips one or more from stub → real. */
export const coach: Coach = new CoachImpl();
