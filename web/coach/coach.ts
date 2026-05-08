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
  /** Days from today until the race (0 = race morning, 100 = far out).
   *  Drives the brief's framing — "what the course wants from your
   *  training" 100 days out vs "first three miles slower than you
   *  want" on race morning. Both use the same Coach voice; the focus
   *  shifts with the time horizon. Defaults to 0 (race morning). */
  daysToRace?: number;
  /** Snapshot of the runner's current training state. When provided,
   *  the brief can comment on whether they're on track for the goal,
   *  whether to keep pushing or hold the line, and how the build is
   *  going. Pulled from CoachState in the API route — caller is
   *  responsible for shaping it; the brief just consumes the
   *  pre-formatted summary lines. */
  trainingContext?: {
    /** Current VDOT-implied race time at this race's distance, in
     *  seconds. Null when no recent race is on file to anchor VDOT. */
    vdotImpliedRaceTimeS: number | null;
    /** VDOT itself, for the brief to reference. */
    vdot: number | null;
    /** Goal time in seconds (parsed from goalDisplay). Compared
     *  against vdotImpliedRaceTimeS to decide "on track" / "ahead" /
     *  "stretch goal". */
    goalTimeS: number | null;
    /** Recent 4w avg weekly mileage. */
    weeklyAvg4w: number;
    /** 8w avg — longer baseline for stability check. */
    weeklyAvg8w: number;
    /** 4w vs prior-4w delta (-0.2 = down 20%, 0.2 = up 20%). */
    deltaPct4v4: number | null;
    /** Longest single run in the last 28 days. Compare against race
     *  distance to gauge long-run readiness. */
    longestLast28Mi: number;
    /** Easy mileage share over last 14 days (0–1). 0.8+ is the
     *  polarized/Daniels target. <0.7 means too much tempo/threshold. */
    easyShare14d: number;
    /** Engine-derived flags. */
    heavyBlockSuspected: boolean;
    rebuildAfterBreak: boolean;
  };
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

  /** Voice paragraph about today's training — what's prescribed, why,
   *  how the runner's trajectory looks, what to focus on. The dashboard
   *  hub's "Coach says" surface. Different from briefRaceMorning (which
   *  anchors on a specific race) — this anchors on TODAY. LLM brain
   *  with deterministic fallback. */
  briefDailyTraining(input: DailyTrainingBriefInput): Promise<CoachDecision<string>>;
}

export interface DailyTrainingBriefInput extends CoachBaseContext {
  /** Full runner state — same input prescribeWorkout takes. */
  state: CoachState;
  /** Today's prescription (already computed by coachDaily) so the
   *  brief talks about the actual workout, not a re-derivation.
   *  Named `prescription` to avoid colliding with CoachBaseContext.today
   *  (which is the ISO date string). */
  prescription: CoachToday;
  /** Optional VDOT snapshot for the brief to reference. Null when
   *  no recent race anchors VDOT. */
  vdot: {
    vdot: number;
    tier: string;
    freshness: 'fresh' | 'stale_soon' | 'stale' | 'expired';
    daysAgo: number;
    sourceName: string;
  } | null;
  /** Whether the engine is recommending a deliberate VDOT test. */
  vdotTestPrompt: boolean;
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
          raceDistanceMi: input.raceDistanceMi,
        })
      : null;
    const slowdownLine = slowdown ? formatSlowdownForBrief(slowdown) : null;

    if (!llmAvailable()) {
      // Deterministic fallback — keeps the page working without an
      // ANTHROPIC_API_KEY. Voice stays close but obviously generic.
      // The slowdown is informational (vs cool baseline), not a
      // mandate to slow down — the runner's goal usually already
      // accounts for typical race-day conditions for that course.
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
      // Branch the deterministic fallback by the same horizon the LLM
      // path uses, so a deploy without ANTHROPIC_API_KEY still surfaces
      // sensibly different copy 100 days out vs race morning.
      const fallbackDays = input.daysToRace ?? 0;
      // One-liner training read for the fallback. Less nuanced than
      // the LLM build, but still says something useful when training
      // state is available.
      const trainingLine = (() => {
        const t = input.trainingContext;
        if (!t) return '';
        if (t.vdot != null && t.vdotImpliedRaceTimeS != null && t.goalTimeS != null) {
          const deltaS = t.vdotImpliedRaceTimeS - t.goalTimeS;
          if (Math.abs(deltaS) < 60) return ' Current fitness is right on the goal — keep building.';
          if (deltaS < -180)         return ' Current fitness is well under the goal time — there\'s headroom to push.';
          if (deltaS < -60)          return ' Current fitness has modest headroom on the goal.';
          if (deltaS < 180)          return ' The goal is a stretch from here — the rest of the build needs to land.';
          return ' The goal is ambitious from current fitness — needs serious build or a goal revisit.';
        }
        if (t.heavyBlockSuspected) return ' Recent block has been heavy — don\'t add load.';
        if (t.rebuildAfterBreak)   return ' Coming back from a break — handle gently.';
        return '';
      })();
      const fallbackAnswer = (() => {
        if (fallbackDays > 21) {
          // Course brief — far out. No taper, no forecast in play.
          return `${input.raceName} is ${fallbackDays} days out. ${input.courseSummary}${trainingLine} Build toward what this course rewards — terrain-specific work where it matters most, easy mileage everywhere else. Forecast and fueling specifics will sharpen up as the race gets closer.`;
        }
        if (fallbackDays > 7) {
          // Approach — strategic, training is being finalized.
          return `${input.raceName} is ${fallbackDays} days out. ${input.courseSummary}${trainingLine} You're finishing the build. Sharpen the work that matches this course; taper hasn't started yet. Last year's weather is a reasonable baseline — anything sharper comes when NOAA publishes a forecast around race week.`;
        }
        if (fallbackDays > 0) {
          // Race week — taper, weather forecast available.
          return `Race week. ${fallbackDays} day${fallbackDays === 1 ? '' : 's'} out. Legs may feel weird; that's normal taper.${trainingLine} ${weatherClause} Lock in sleep, carbs, and your kit. Don't go chasing fitness this week.`;
        }
        // Race morning — current behavior.
        return `Morning. The training is done.${trainingLine} ${weatherClause} First three miles slower than you want. Whatever you feel right now is nerves, not fitness — let them sit. Run your race.`;
      })();

      return {
        answer: fallbackAnswer,
        rationale: slowdown
          ? `Weather slowdown computed: ${slowdown.totalPct.toFixed(1)}% (${slowdown.rationale.join('; ') || 'neutral conditions'}).`
          : `Deterministic ${fallbackDays > 21 ? 'course brief' : fallbackDays > 7 ? 'approach brief' : fallbackDays > 0 ? 'race-week brief' : 'race-morning brief'}. No LLM available.`,
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

    // Brief horizon picks the framing. The Coach voice is the same
    // across all four modes; the focus shifts so the brief is useful
    // every time the runner opens the race page, not just on race
    // morning. Lifted out of the prompt so adding a new mode is a
    // one-line table edit, not a string surgery.
    const days = input.daysToRace ?? 0;
    const horizon = days <= 0   ? 'morning'
                  : days <= 7   ? 'race_week'
                  : days <= 21  ? 'approach'
                                : 'course';

    const horizonInstructions: Record<typeof horizon, string> = {
      morning: [
        'HORIZON: race morning. The runner is reading this over coffee, hours before the start.',
        'Acknowledge real conditions using the computed slowdown number when provided, give pace-band guidance for the opening miles, mention fuel timing for THIS race, and end with a single line of focus.',
        'One short paragraph.',
      ].join(' '),
      race_week: [
        `HORIZON: race week (${days} day${days === 1 ? '' : 's'} to go).`,
        'The runner is in taper. Talk about taper sanity (legs feel weird, this is normal), what to lock in this week (sleep, carbs, dress rehearsal), and the weather window if it\'s informative. Refer to the forecast as a forecast, not as today\'s conditions.',
        'Do NOT prescribe specific opening-mile paces or gel timing — those land in the race-morning brief. Keep this strategic, not tactical.',
        'One short paragraph.',
      ].join(' '),
      approach: [
        `HORIZON: approach (${days} days out).`,
        'The runner is finishing the build, sharpening into peak. Talk about how the course shapes what the last weeks of training should look like — where the race will be won or lost, what kind of runner this course rewards, the one or two specifics to dial in. Reference last year\'s weather as a baseline expectation, not a forecast.',
        'Do NOT prescribe race-morning pacing or fueling. Strategic horizon, not tactical.',
        'One short paragraph.',
      ].join(' '),
      course: [
        `HORIZON: course brief (${days} days out — the race is far away).`,
        'The runner is far enough out that taper and forecast aren\'t actionable. Talk about the COURSE: what kind of runner it wants, where the race is decided, the one or two terrain features that matter. If you mention weather, frame it as historical norms (e.g., "last year was 64°F at the gun — typical for August in San Diego"), never as a forecast.',
        'Do NOT prescribe pacing, fueling, or first-three-miles tactics. This is education and orientation, not race-day execution.',
        'One short paragraph.',
      ].join(' '),
    };

    // Format the training-state read so the brief can reflect "are
    // you on track for the goal." VDOT vs goal is the load-bearing
    // signal: if VDOT-implied race time is faster than goal, the
    // runner has headroom and the brief should encourage; if slower,
    // the goal is a stretch and the brief should anchor expectations.
    const trainingRead = (() => {
      const t = input.trainingContext;
      if (!t) return '';
      const lines: string[] = ['', 'CURRENT TRAINING STATE (use this to talk about whether they\'re on track):'];
      // VDOT vs goal — the most important signal.
      if (t.vdot != null && t.vdotImpliedRaceTimeS != null && t.goalTimeS != null) {
        const deltaS = t.vdotImpliedRaceTimeS - t.goalTimeS;
        const deltaMin = Math.abs(deltaS / 60);
        const fmt = (s: number) => {
          const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
          return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
        };
        let verdict = '';
        if (Math.abs(deltaS) < 60)        verdict = 'right on the goal — current fitness lines up with target.';
        else if (deltaS < -180)           verdict = `current fitness is ${deltaMin.toFixed(0)} min FASTER than goal — runner has real headroom; the goal is conservative.`;
        else if (deltaS < -60)            verdict = `current fitness is ${deltaMin.toFixed(0)} min faster than goal — modest headroom.`;
        else if (deltaS < 180)            verdict = `current fitness is ${deltaMin.toFixed(0)} min slower than goal — the goal is a stretch but reachable with the rest of the build.`;
        else                              verdict = `current fitness is ${deltaMin.toFixed(0)} min slower than goal — the goal is ambitious; runner needs serious build OR the goal needs revisiting.`;
        lines.push(`  VDOT ${t.vdot.toFixed(1)} → race-equivalent ${fmt(t.vdotImpliedRaceTimeS)} at this distance vs goal ${fmt(t.goalTimeS)}. ${verdict}`);
      } else if (t.vdot != null) {
        lines.push(`  VDOT ${t.vdot.toFixed(1)} (no goal time set, so no on-track verdict).`);
      } else {
        lines.push('  No recent race on file → no VDOT anchor. Don\'t make claims about whether they\'re on track for the goal.');
      }
      // Volume picture.
      const volumeNote = t.deltaPct4v4 == null
        ? `Recent volume: ${t.weeklyAvg4w} mi/week (4w avg). 8w baseline: ${t.weeklyAvg8w} mi.`
        : t.deltaPct4v4 > 0.15
        ? `Volume building: ${t.weeklyAvg4w} mi/wk recent vs ${t.weeklyAvg8w} mi 8w baseline (up ${(t.deltaPct4v4 * 100).toFixed(0)}%).`
        : t.deltaPct4v4 < -0.15
        ? `Volume rebuilding from a dip: ${t.weeklyAvg4w} mi/wk recent vs ${t.weeklyAvg8w} mi 8w baseline (down ${(Math.abs(t.deltaPct4v4) * 100).toFixed(0)}%).`
        : `Volume steady: ${t.weeklyAvg4w} mi/wk holding around the ${t.weeklyAvg8w} mi 8w baseline.`;
      lines.push(`  ${volumeNote}`);
      lines.push(`  Longest run last 28d: ${t.longestLast28Mi.toFixed(1)} mi.`);
      lines.push(`  Easy/quality balance: ${(t.easyShare14d * 100).toFixed(0)}% easy${t.easyShare14d < 0.7 ? ' (low — runner is grinding too much tempo)' : t.easyShare14d > 0.85 ? ' (very polarized)' : ''}.`);
      if (t.heavyBlockSuspected) lines.push('  HEAVY BLOCK FLAG: recent stretch has been hard. Don\'t add load.');
      if (t.rebuildAfterBreak) lines.push('  REBUILD FLAG: coming back from a break — handle gently.');
      return lines.join('\n');
    })();

    const userPrompt = [
      `Write a race brief for ${input.raceName} on ${input.raceDate}.`,
      `Goal: ${input.goalDisplay}.`,
      `Course: ${input.courseSummary}`,
      weatherLine,
      slowdownContext,
      trainingRead,
      '',
      horizonInstructions[horizon],
      '',
      'When training context is provided, weave the on-track read into the brief naturally — not as a separate sentence labeled "Training," but as an honest call (e.g. "you\'ve got real headroom — keep building," or "the goal is a stretch from here," or "right where you need to be"). Don\'t parrot the numbers; use them.',
      '',
      'Voice rules apply across all horizons: plain language, no §-numbers in the body, no jargon-without-translation, no hedge words, no false urgency.',
    ].join('\n');

    return callCoachLLM<string>({
      scope: 'running',
      userPrompt,
      answerSchema: `a single paragraph (3–6 sentences) of ${horizon === 'morning' ? 'race-morning' : horizon === 'race_week' ? 'race-week' : horizon === 'approach' ? 'approach' : 'course'} brief in the Coach voice`,
      maxTokens: 600,
    });
  }

  // ── Daily training brief ───────────────────────────────────────────
  // Voice paragraph for the dashboard hub. Different from briefRaceMorning
  // (which anchors on a race) — this anchors on TODAY, talks about the
  // prescribed workout, the runner's trajectory, and the next focus.
  async briefDailyTraining(input: DailyTrainingBriefInput): Promise<CoachDecision<string>> {
    const t = input.prescription.today;
    const phase = input.prescription.phase;
    const state = input.state;
    const nextRace = state.races.nextA;
    const daysToA = nextRace?.daysAway ?? null;

    if (!llmAvailable()) {
      // Deterministic fallback — assembles a serviceable paragraph
      // from the structured pieces, no LLM. Less colorful than the
      // real Coach voice but stays in tone.
      const parts: string[] = [];
      // Lead with the workout.
      const dist = t.distanceMi > 0 ? `${t.distanceMi.toFixed(1)} mi` : '';
      parts.push(`${t.label || t.type.replace(/_/g, ' ')}${dist ? ` · ${dist}` : ''}.`);
      // VDOT test override gets its own framing.
      if (t.type === 'vdot_test_5k') {
        parts.push('We need a fresh fitness anchor — every pace prescription downstream of this trial gets sharper after we have the result.');
      } else if (input.vdotTestPrompt && !input.vdot) {
        parts.push('No recent race on file — once you anchor a VDOT, the Coach can prescribe paces with real precision.');
      } else if (input.vdot && input.vdot.freshness === 'expired') {
        parts.push('Your VDOT signal is stale — Coach is planning a 5K time trial on the next quality day.');
      }
      // Volume note.
      const volNote = state.volume.deltaPct4v4 == null
        ? `Recent volume: ${state.volume.weeklyAvg4w} mi/wk.`
        : state.volume.deltaPct4v4 > 0.15
        ? `Volume building (${state.volume.weeklyAvg4w} mi/wk recent vs ${state.volume.weeklyAvg8w} 8w baseline).`
        : state.volume.deltaPct4v4 < -0.15
        ? `Volume rebuilding from a dip.`
        : `Volume steady around ${state.volume.weeklyAvg4w} mi/wk.`;
      parts.push(volNote);
      // Race horizon.
      if (nextRace && daysToA != null) {
        if (daysToA === 0)         parts.push(`${nextRace.name} is today.`);
        else if (daysToA <= 7)     parts.push(`${nextRace.name} in ${daysToA} day${daysToA === 1 ? '' : 's'} — taper week.`);
        else if (daysToA <= 28)    parts.push(`${nextRace.name} in ${daysToA} days — peak block.`);
        else                       parts.push(`${nextRace.name} in ${daysToA} days; build is on track.`);
      }
      return {
        answer: parts.join(' '),
        rationale: `Deterministic daily-brief assembly. Phase: ${phase}.`,
        citations: [
          { doc: 'Research/01-pace-zones-vdot.md', section: '§VDOT context', snippet: 'Daniels VDOT lookup + 4-tier interpretation.' },
        ],
        brain: 'deterministic',
      };
    }

    // LLM path — give the model the runner's full picture, ask for
    // a single short paragraph in voice. Same voice rules as the
    // race brief.
    const vdotLine = input.vdot
      ? `VDOT ${input.vdot.vdot.toFixed(1)} (${input.vdot.tier}, ${input.vdot.freshness.replace('_', ' ')}, anchored on ${input.vdot.sourceName} ${input.vdot.daysAgo} days ago)`
      : 'No current VDOT — runner hasn\'t logged a recent race.';
    const volLine = state.volume.deltaPct4v4 == null
      ? `${state.volume.weeklyAvg4w} mi/wk recent (no 4v4 delta)`
      : state.volume.deltaPct4v4 > 0.15
      ? `volume building: ${state.volume.weeklyAvg4w} mi/wk recent vs ${state.volume.weeklyAvg8w} 8w baseline (+${(state.volume.deltaPct4v4 * 100).toFixed(0)}%)`
      : state.volume.deltaPct4v4 < -0.15
      ? `volume rebuilding: ${state.volume.weeklyAvg4w} mi/wk recent vs ${state.volume.weeklyAvg8w} 8w baseline (-${(Math.abs(state.volume.deltaPct4v4) * 100).toFixed(0)}%)`
      : `volume steady at ${state.volume.weeklyAvg4w} mi/wk`;
    const raceLine = nextRace && daysToA != null
      ? `Next A race: ${nextRace.name} in ${daysToA} days (${nextRace.distanceMi.toFixed(1)} mi). Goal: ${nextRace.goalDisplay ?? 'unset'}.`
      : 'No A race in window.';
    const flagLines: string[] = [];
    if (state.flags.heavyBlockSuspected) flagLines.push('HEAVY BLOCK FLAG — recent stretch has been heavy.');
    if (state.flags.rebuildAfterBreak) flagLines.push('REBUILD FLAG — coming back from a break.');
    if (input.vdotTestPrompt) flagLines.push('VDOT TEST FLAG — Coach is planning a 5K time trial; surface why it matters.');

    const userPrompt = [
      `Write today's training brief for the runner. Date: ${input.prescription.generatedAt.slice(0, 10)}.`,
      ``,
      `TODAY'S WORKOUT:`,
      `  Type: ${t.label || t.type}`,
      `  Distance: ${t.distanceMi > 0 ? `${t.distanceMi.toFixed(1)} mi` : 'rest day'}`,
      `  Description: ${t.description}`,
      ``,
      `TRAINING STATE:`,
      `  Phase: ${phase}`,
      `  ${vdotLine}`,
      `  ${volLine}`,
      `  Longest run last 28d: ${state.volume.longestLast28Mi.toFixed(1)} mi`,
      `  Easy/quality balance: ${(state.intensity.easyShare14d * 100).toFixed(0)}% easy`,
      ...flagLines.map(f => `  ${f}`),
      ``,
      `RACE CALENDAR:`,
      `  ${raceLine}`,
      ``,
      'Write ONE short paragraph (3-5 sentences) addressing the runner directly. Talk about today\'s session — what it is, why it makes sense for where they are, what to feel/aim for. Weave in trajectory ("you\'re building well", "the goal is in reach", "we need to anchor a VDOT before we can prescribe sharper paces") naturally. End with a single line of focus or reminder.',
      ``,
      'Voice rules: plain language, no §-numbers, no jargon-without-translation, no hedge words, no false urgency. Don\'t parrot the numbers — use them. Don\'t label the brief as "Daily Brief" or open with "Today\'s training:" — just speak.',
    ].join('\n');

    return callCoachLLM<string>({
      scope: 'running',
      userPrompt,
      answerSchema: 'a single paragraph (3-5 sentences) of daily training brief in the Coach voice',
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
