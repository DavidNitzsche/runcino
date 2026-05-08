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
import { composeVoiceLead } from './explanations';
import { coachDaily, type CoachToday } from '../lib/coach-engine';
import type { CoachState } from '../lib/coach-state';
import { acwr, ACWR_LOW, ACWR_HIGH, intensityTarget } from '../lib/coach-principles';
import { computeWeatherSlowdown, formatSlowdownForBrief, type WeatherSlowdownInput } from '../lib/weather-slowdown';

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
        })
      : null;
    const slowdownLine = slowdown ? formatSlowdownForBrief(slowdown) : null;

    if (!llmAvailable()) {
      // Deterministic fallback — keeps the page working without an
      // ANTHROPIC_API_KEY. Voice stays close but obviously generic.
      // Now incorporates the computed slowdown number rather than the
      // old "75°F = conservative" handwave.
      const weatherClause = slowdown && slowdown.totalPct >= 0.5
        ? `${Math.round(input.weather!.tempF!)}°F${input.weather!.dewpointF != null ? ` / ${Math.round(input.weather!.dewpointF)}°F dewpoint` : ''} — ${slowdownLine}. Adjust the pace plan accordingly; don't try to muscle through a hot day.`
        : input.weather?.tempF != null
          ? `${Math.round(input.weather.tempF)}°F start — favorable conditions, run the plan as written.`
          : 'Trust the plan.';
      const bailClause = slowdown?.bailFlag === 'cancel'
        ? ` HEADS UP: ${slowdown.bailReason} If conditions hold, the goal becomes finish over time.`
        : slowdown?.bailFlag === 'easy_only'
          ? ` This is a survival-mode day; effort over time.`
          : '';
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
    }

    const weatherLine = input.weather
      ? `Weather: ${input.weather.tempF}°F${input.weather.dewpointF != null ? `, ${input.weather.dewpointF}°F dewpoint` : ''}${input.weather.windMph != null ? `, ${input.weather.windMph} mph wind` : ''}${input.weather.conditions ? `, ${input.weather.conditions}` : ''}.`
      : 'Weather: no specific forecast.';

    // Inject the deterministic slowdown into the LLM context so the
    // model uses a real number rather than guessing at heat impact.
    const slowdownContext = slowdown && slowdown.totalPct >= 0.5
      ? [
          '',
          `COMPUTED WEATHER SLOWDOWN (per Research/06 race-day decision flow):`,
          `  Total adjustment: ${slowdown.totalPct.toFixed(1)}% slower than cool-day goal`,
          slowdown.perMileSecs != null ? `  Per-mile cost: about +${slowdown.perMileSecs} sec/mi` : null,
          ...slowdown.rationale.map(r => `  • ${r}`),
          slowdown.bailFlag ? `  BAIL FLAG: ${slowdown.bailFlag} — ${slowdown.bailReason}` : null,
          '',
          'Use these numbers in the brief. Don\'t guess at heat impact; the calculation is research-anchored.',
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

    return callCoachLLM<string>({
      scope: 'running',
      userPrompt,
      answerSchema: 'a single paragraph (3–6 sentences) of race-morning brief in the Coach voice',
      maxTokens: 600,
    });
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

/** The singleton Coach. Import via `import { coach } from '@/coach/coach'`.
 *  Stage 2 implements `briefRaceMorning`; Stage 3 adds `prescribeWorkout`
 *  + `assessReadiness`; other methods still stub with a clear "Stage N"
 *  error. Each stage flips one or more from stub → real. */
export const coach: Coach = new CoachImpl();
