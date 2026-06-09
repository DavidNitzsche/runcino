import type { EffortKey, PlannedDay, CompletedRun, ViewKey } from './constants';

export type DriverRow = { name: string; why: string; pct: number; pts: number; dir: 'pos'|'neg' };
export type Readiness = {
  score: number;
  label: string;        // PRIMED / TUNED / EASY ONLY etc.
  baseline: number;
  trend: number[];      // last 7 values 0..100
  trendDays: string[];  // ['THU',...,'WED']
  drivers: DriverRow[];
  coach: string;        // coach line
};

export type FaffSeed = {
  // top bar
  todayISO: string;
  topDate: string;          // "Wednesday, May 28"
  weekOf: string;           // "Week 14 of 26 · Build phase"
  // sidebar profile chip
  user: {
    name: string; city: string; initial: string; pro: boolean;
    // 2026-05-30: real profile fields surfaced for Profile view rows so
    // they don't render hardcoded "Runner" / "renews Dec" strings.
    experienceLevel: string | null;   // 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus'
    /** 2026-06-01 · canonical biological_sex envelope · resolved once
     *  via lib/coach/biological-sex.ts. Gates cycle-related tiles
     *  (CYCLE PHASE, CYCLE · PERFORMANCE on Health). */
    biologicalSex: 'female' | 'male' | 'not_specified';
    subscriptionLabel: string;        // honest single-user-beta default until billing is wired
  };

  // today's view
  week: PlannedDay[];              // 7 days, mon..sun
  todayIdx: number;                // index of "today" in week
  results: Record<number, CompletedRun | undefined>; // by week idx
  readiness: Readiness;
  /** 2026-05-31 · daily morning brief envelope · score + trend + per-pillar
   *  tiles + streaks + movers + confounders. Null when the runner has no
   *  recoverable health-data signal yet (brand-new user before any HK sync). */
  readinessBrief: ReadinessBriefSeed | null;
  /** 2026-06-01 · plan-drift + auto-rebuild proposals. Empty array means
   *  no drift detected + no recent auto-rebuilds. Today view renders 0-5
   *  cards per the source array. */
  planProposals: PlanProposalSeed[];
  /** 2026-06-04 · pending per-workout adapter proposals · "we'd swap
   *  tomorrow's tempo to easy unless you object." Replaces the silent-
   *  overnight-mutation pattern · runner sees + gates via banner.
   *  Empty array = no pending proposals · banner hides. */
  pendingWorkoutProposals?: Array<{
    id: number;
    userUuid: string;
    planWorkoutId: string;
    workoutDateISO: string;
    actionKind: 'downgrade' | 'shave' | 'reschedule';
    actionPayload: {
      newType?: string;
      newDate?: string;
      shaveFraction?: number;
      why?: string;
    };
    reason: string;
    evidence: Record<string, unknown>;
    status: 'pending';
    createdAt: string;
  }>;
  /** 2026-06-01 · backend-owned strength-day recommendation. Mirror of
   *  glance.strengthRecommendation. `recommendedDays` is also threaded
   *  to each PlannedDay.strengthSuggested so the week-strip annotation
   *  is a pure render, not a client-side computation. Null when the
   *  recommender failed to produce a value · TodayView falls back to a
   *  silent "no strength surfaced" state (no annotation, no caption). */
  strengthRecommendation: {
    recommendedDays: string[];
    reason: string;
    habit: 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';
    coachIntent: { severity: 'soft' | 'firm' | 'urgent'; body: string } | null;
  } | null;
  /** 2026-06-01 · weekly reconciliation of recommendedDays against
   *  what was actually logged in strength_sessions (manual + HK +
   *  watch + strava). Backend ships at glance.strengthWeekStatus
   *  (see designs/briefs/strength-hk-web-consumer-brief.md). The
   *  `summary` field is render-ready · the arrays are there if a
   *  tap-to-expand surface is added later. Null when no recommendation
   *  has been produced yet. */
  strengthWeekStatus: {
    weekStartISO: string;
    weekEndISO: string;
    recommended: string[];
    confirmed: Array<{
      date: string;
      sessionId: number | null;
      source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
      durationMin: number | null;
      sessionType: string | null;
    }>;
    skipped: string[];
    bonus: Array<{
      date: string;
      sessionId: number | null;
      source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
      durationMin: number | null;
      sessionType: string | null;
    }>;
    summary: string;
  } | null;
  goalRace: GoalRace | null;
  volumeBars: VolumeBar[];         // 8-week strip
  thisWeekMiles: number;
  weeklyAvg: number;
  form: { fitness: number; fatigue: number; delta: number; label: string; acwr: number | null };

  // train view (26-week plan)
  season: {
    nowIdx: number;
    raceIdx: number;
    miles: number[];   // length = raceIdx (e.g. 26 weeks of mileage)
    maxMi: number;
    /** Real plan_phases rows from training-state. Drives the TrainView's
     *  ramp phase axis + phase-breakdown grid so a 13-week half marathon
     *  plan shows BASE+BUILD (or whatever the plan-builder actually
     *  authored) instead of being shoehorned into BASE/BUILD/PEAK/TAPER. */
    phases: Array<{ label: string; startWeekIdx: number; endWeekIdx: number }>;
    /** Per-week real plan workouts so non-current weeks render the real
     *  plan instead of phase-template fluff. */
    weekDays: Array<Array<{
      /** plan_workouts.id — joins to coach_intents.field for adaptations. */
      id?: string;
      /** ISO YYYY-MM-DD for this planned day. Sourced from
       *  plan_workouts.date_iso. Drives the FULL PLAN MonthCalendar so
       *  every workout lands on its real calendar slot instead of
       *  leaving every cell empty. */
      date?: string;
      dow: string;          // MON / TUE / ...
      type: import('./constants').EffortKey;
      name: string;
      mi: number;
      /** Actual miles logged for this day (0 when not completed). Threaded
       *  from training-state PlanWeek.days.doneMi so the TrainView execution
       *  strip can compute per-week actual totals without a new API call. */
      doneMi?: number;
      paceSec: number | null;
      done: boolean;
      activityId?: string | null;
      /** Actual pace from the matched Strava activity (s/mi). Used by
       *  TrainView's KEY WORKOUTS list to render hit/miss tags. */
      donePaceSec?: number | null;
      doneAvgHr?: number | null;
      /** Per-mile splits — used to extract work-segment pace for quality
       *  workouts (intervals / tempo / threshold) so the influence
       *  comparison isn't burying the rep pace under warmup/recovery miles. */
      doneSplits?: Array<{ paceSec: number | null; hr: number | null }>;
      /** 2026-06-01 · per-day adapter provenance (commit a54c7069).
       *  Populated from training.weeks[].days[].adaptation. Drives the
       *  small downgrade glyph + "was X" strikethrough subline on
       *  FULL PLAN month cells. Same shape as PlannedDay.adaptation. */
      adaptation?: {
        wasAdapted: boolean;
        originalType: string | null;
        originalSubLabel: string | null;
        originalDistanceMi: number | null;
        originalDateIso: string | null;
        reason: string | null;
        adaptedAt: string | null;
        kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
      } | null;
      /** 2026-06-01 · web agent brief · training-trajectory signal per
       *  done quality/long workout. "Did this workout move my fitness
       *  toward the race?" · kind + authored coach-voice copy. Null on
       *  undone days, non-quality types, or insufficient data.
       *  See lib/coach/training-influence.ts. */
      trainingInfluence?: {
        kind: 'on_track' | 'consistent' | 'working' | 'slipping' | 'compromised';
        copy: string;
      } | null;
      /** 2026-06-07 · workout_spec passed through so the FULL PLAN calendar
       *  day-detail panel can render real segment breakdowns (BASE/FINISH
       *  for D1 long runs, WARMUP/TEMPO for quality, etc.) without needing
       *  a separate API call. Null on rest days and pre-backfill rows. */
      workoutSpec?: import('@/lib/faff/types').WorkoutSpec | null;
    }>>;
    /** Closed-loop plan adaptations from coach_intents (P1 #8 — written by
     *  applyAdaptations whenever a readiness/volume signal forced a plan
     *  mutation). TrainView's KEY WORKOUTS list cross-references these so
     *  the runner can see what each DONE quality day triggered. */
    adaptations: Array<{
      workoutId: string;        // plan_workouts.id that was modified
      weekIdx: number;          // resolved from the workout's date
      kind: 'reschedule' | 'downgrade' | 'shave' | 'mark_dirty' | 'overridden' | 'other';
      newType?: string;
      newDate?: string;
      shaveFraction?: number;
      why: string;              // the trigger reason (from value.why)
      ts: string;               // when the adapt was applied (ISO)
      /** 2026-06-01 · web agent brief Option B. True when a later
       *  `plan_adapt_overridden` row exists for the same workoutId ·
       *  the runner has since restored the original. Frontend should
       *  filter out (or annotate) these entries when rendering the
       *  KEY WORKOUTS "← Adapted: ..." line. Override rows themselves
       *  have kind='overridden' and supersededByOverride=false. */
      supersededByOverride: boolean;
    }>;
    /** 2026-06-03 · Rule 11 · horizon-aware planning. Non-null when a
     *  future A/B race within 24 weeks raises the long-run cap above
     *  the current race's tier. Drives the "LONG-RUN CAP · 22mi ·
     *  setting up CIM" chip on TrainView. Cite docs/PLAN_ENGINE_MID_BLOCK_DOCTRINE.md §Rule 11. */
    horizonRaise: {
      fromLongCapMi: number;
      toLongCapMi: number;
      fromLongShare: number;
      toLongShare: number;
      race: { slug: string; name: string; date: string; distanceMi: number };
    } | null;
  };

  // health view
  health: HealthSnapshot;

  // targets view
  prs: PR[];
  races: RaceLite[];
  // Past A/B race with no logged result, surfaced for up to 30 days post-race.
  // Drives the "AFC was 3 days ago — log your result" callout in TargetsView.
  unloggedRaceAlert: { slug: string; name: string; daysSince: number } | null;
  // 2026-05-31: projection trend for the goal race's distance — daily
  // snapshots from projection_snapshots written by the 00:30 cron. Empty
  // array when no goal race / no snapshots recorded yet. Oldest -> newest.
  projectionTrend: Array<{ date: string; projectionSec: number | null; vdot: number | null }>;

  // activity ranges
  activity: ActivityData;

  // profile
  shoes: ShoeRec[];
  // 2026-05-30: today's per-day shoe assignment from day_actions (action='shoe').
  // Server-persisted via /api/today/shoe. If unset, the ShoePicker falls back
  // to the coach recommendation in shoeRecByType (lib/shoe/recommend.ts).
  todayShoeId: number | null;
  // Coach-system shoe recommendation per effort type, computed from the
  // runner's actual garage via recommendShoe(shoes, runType). Empty string
  // when no shoe is tagged for that type — caller falls back to KIT[type]
  // static placeholder.
  shoeRecByType: Record<string, string>;
  connections: ConnectionRow[];

  // 2026-05-31: pending coach_proposals (injury_adjust / illness_adjust)
  // rendered as accept/decline cards on Today. Empty when no proposals
  // are pending. POST targets are /api/coach/proposal/[id]/{accept,decline}.
  pendingProposals: Array<{
    id: number;
    proposal_type: string;
    reason: string;
    suggested: string;
    evidence: Record<string, unknown>;
    created_at: string;
  }>;
};

export type GoalRace = {
  slug: string; name: string; date: string;     // ISO
  daysAway: number;
  goal: string;        // e.g. "1:30:00"
  projected: string;   // e.g. "1:29:45"
  onTrack: boolean;
  delta: string;       // e.g. "15 sec ahead"
  phaseLabel: string;  // "Build phase · wk 14 / 26"
  goalPct: number;     // 0..100 for progress bar
  location: string | null;  // e.g. "San Diego, CA"  — null if not on record
  // 2026-05-31: numeric distance for projection-trend lookups against
  // projection_snapshots (which keys by distance_mi). Null when the goal
  // race row hasn't been resolved to a real distance yet.
  distanceMi: number | null;

  // ─── 2026-06-04 · plan-trusts-itself doctrine ───
  /** Status from goal-projection · gates the "math is honest" panel.
   *  ON TRACK · plan is on pace · panel collapses to "the plan is the path".
   *  WATCHING · soft drift signals · panel says "next quality run tells us more".
   *  OFF TRACK · clear evidence · full gap-panel + B-target framing.
   *  Optional for back-compat with older seed envelopes (treated as ON TRACK). */
  goalStatus?: 'on-track' | 'watching' | 'off-track';
  /** Drift signals firing right now · each with weight + plain-English detail
   *  + raw evidence numbers. Empty array when ON TRACK. */
  driftSignals?: Array<{
    kind: 'recent_race' | 'vdot_trend' | 'aerobic_decoupling'
      | 'tempo_pace_drift' | 'plan_adapter_downgrades' | 'missed_key_workouts';
    weight: 'strong' | 'medium' | 'weak';
    detail: string;
    evidence: Record<string, number | string | null>;
  }>;
  /** Raw current-VDOT projection (always computed) · shown as a
   *  diagnostic chip alongside the plan-trusted projection. The runner
   *  can see what their CURRENT fitness says alongside what the plan
   *  is targeting · transparency without prescription. Null when no
   *  recent race / VDOT-yielding run. */
  vdotProjectionSec?: number | null;
  /** 2026-06-08 · statistical band around the current-fitness projection
   *  (vdotProjectionSec) · Research/02 §13.7, status-scaled. lo = faster
   *  edge, hi = slower edge, both seconds. Null at cold-start. Renders as
   *  a range on the ProjectionBand current-fitness marker. */
  confidenceInterval?: {
    lo: number;
    hi: number;
    pct: number;
    method: 'observed-cv' | 'research-span';
  } | null;
  /** 2026-06-08 · goal-attainment confidence (HIGH/MEDIUM/LOW) · answers
   *  "solidly or barely." Renders under the goal time. Null at cold-start. */
  confidenceLabel?: {
    tier: 'high' | 'medium' | 'low';
    word: 'HIGH' | 'MEDIUM' | 'LOW';
    descriptor: string;
    detail: string;
    evidence: Record<string, number | string>;
  } | null;
  /** One-line plain-English summary of the projection state · renders
   *  under the gauge. */
  projectionSummary?: string;
  /** 2026-06-04 · next 1-3 quality workouts on the plan · "next test
   *  points" that will inform the projection. */
  nextTestPoints?: Array<{
    dateISO: string;
    type: string;
    label: string;
    distanceMi: number | null;
  }>;
  /** 2026-06-04 · past 1-3 completed quality runs · "recent test
   *  points" with heat-adjusted verdict so the runner can see what
   *  the quality work actually landed at.  Paired with nextTestPoints
   *  in the redesigned ON THE PATH section. */
  recentTestPoints?: Array<{
    dateISO: string;
    type: string;
    label: string;
    distanceMi: number | null;
    actualPace: string | null;
    verdict: 'on' | 'fast' | 'slow' | null;
  }>;
  /** 2026-06-04 · "what changes the status" copy · pair of conditions
   *  derived from current signals. Tells the runner what would move
   *  the gauge without being prescriptive. */
  transitions?: {
    toBetter: string | null;
    toWorse: string | null;
  };

  // ─── GapPanel chunks · per-race, per-runner adjusters ───
  // Targets the four placeholder chunks in views/GapPanel.tsx with
  // honest backend numbers. See designs/briefs/targets-gap-panel-
  // backend-brief.md §2 for the contract per chunk + fallback rules.

  // 2.2 · Course chunk · elevation impact in seconds.
  // Null when course_library has no elevation data (stub) · the panel
  // hides the Course chunk gracefully in that case. 0 means the course
  // is a non-factor (net-downhill credit floored at 0) — the doctrine
  // drawer surfaces the upside in copy instead of a negative chunk.
  courseImpactSec?: number | null;
  /** Course-library provenance for the doctrine drawer. */
  courseSource?: 'editorial' | 'crowd' | 'stub' | null;
  /** Per-mile gross gain — surfaced in the doctrine drawer for context
   *  ("16 ft/mi · essentially flat"). */
  courseElevGainFtPerMi?: number;

  // 2.1 · Conditions chunk · race-day weather impact in seconds.
  // Null when no forecast (>16d out) AND no climate-normals fallback hit
  // (e.g. foreign race we haven't editorialized). Panel hides the chunk.
  conditionsImpactSec?: number | null;
  conditionsSource?: 'forecast' | 'climate' | null;

  // 2.3 · Execution chunk · runner-specific pacing buffer in seconds.
  // Always populated · 30s default when fewer than 2 qualifying runs
  // exist in the runner's recent window. source flips from 'default' →
  // 'observed' as soon as the runner accumulates eligible races/tempos.
  executionBufferSec?: number;
  executionSource?: 'observed' | 'default';

  // 2.4 · Hit list · cheapest 2-3 levers to move the projection.
  // Empty array when the gap is small / mostly held — panel hides the
  // hit-list section in that case.
  levers?: Array<{
    icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
    kind: 'tune_up_race' | 'threshold_block' | 'vo2_block' | 'cooler_corral'
        | 'goal_pace_block' | 'hold_fitness' | 'set_b_target' | 'sharpen';
    title: string;
    detail: string;
    projectedTime: string;
    deltaSec: number;       // negative = faster than current projection
    controllability: 'Trainable' | 'Logistics' | 'Smart';
    linkTo?: string;
    lvtag: string;
  }>;
};
/** 2026-06-01 · plan-drift + auto-rebuild proposals · the autonomous
 *  plan-adaptation surface. Today view renders these as accept-or-
 *  dismiss cards (status='pending') or as "we just rebuilt your plan
 *  because X" notifications (status='auto_applied'). */
export type PlanProposalSeed = {
  id: number;
  planId: string | null;
  /** 2026-06-02 · alias for planId on auto_applied rows · the OLD plan
   *  id (the diff page's `?from=` value). Same column · clearer name
   *  for the diff page reader. */
  previousPlanId: string | null;
  newPlanId: string | null;
  kind: 'volume_drift' | 'vdot_drift' | 'staleness'
      | 'race_date_changed' | 'goal_time_changed'
      | 'a_race_added' | 'a_race_removed';
  status: 'pending' | 'auto_applied' | 'accepted' | 'dismissed' | 'superseded';
  source: string;
  reasons: Record<string, unknown>;
  message: string;
  severity: number | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type VolumeBar = { mi: number; label: string; current: boolean };
export type PR = { k: string; v: string; date: string };

// 2026-05-31 · ReadinessBrief envelope · the morning brief structure
// the design agent renders. Composed by lib/coach/readiness-brief.ts.
// Doctrine-grounded · see designs/briefs/readiness-brief-backend-landed.md.
export type ReadinessBriefSeed = {
  date: string;                 // YYYY-MM-DD
  score: number;
  band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data' | 'unknown';
  label: string;                // 'READY'
  headline: string;             // one-line plain-language framing
  oneLineMover: string | null;  // "HRV down 8 pts vs yesterday"
  /** 2026-06-03 · concrete "what should I DO today" line from the
   *  prescription engine. Null on cold-start.
   *  · intent · structured intent for downstream post-run comparison:
   *      'cut' / 'plan' / 'send' / 'rest'
   *  · targetMinutes / targetMiles · rough quantity the prescription
   *      suggests · drives the post-run reflection's "you followed
   *      the call" vs "ran more than the cut" framing. */
  prescription: {
    action: string;
    why: string;
    intent: 'cut' | 'plan' | 'send' | 'rest';
    targetMinutes: number | null;
    targetMiles: number | null;
  } | null;
  scoreTrend: Array<{ date: string; score: number; band: string }>;
  pillars: Array<{
    key: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hr_recovery';
    label: string;
    weightPct: number;
    observedValue: string;
    observedSub: string;
    baseline: string;
    band: 'sharp' | 'ready' | 'moderate' | 'pull-back' | 'no-data' | 'unknown';
    weightContribution: number;
    meaning: string;
    confounders: Array<{ pillar: string; explanation: string; likely: boolean; categoryTag?: string }>;
    trend: Array<{ date: string; value: number }>;
    citation: string;
  }>;
  streaks: Array<{
    pillar: string;
    direction: 'above' | 'below';
    days: number;
    startDate: string;
    /** 5-10 word collapsed banner copy · default state. */
    short: string;
    /** Full coach-voice paragraph · revealed on tap. */
    meaning: string;
  }>;
  movers: Array<{ pillar: string; deltaPts: number; label: string }>;
  subjectiveOverride: {
    subjectiveScore: number;
    objectiveScore: number;
    deltaAbs: number;
    advice: string;
  } | null;
  /** 2026-06-01 · today's subjective check-in state · drives Section 8. */
  subjectiveCheckin: {
    answeredAt: string | null;
    rating: number | null;
    answered: boolean;
  };
  /** 2026-06-01 · cold-start envelope · only populated when band='no-data'. */
  coldStart: {
    nightsLogged: number;
    nightsNeeded: number;
    note: string;
    healthConnected: boolean;
  } | null;
  /** 2026-06-01 · authored 14-day trend paragraph · null when < 4 days. */
  trendNote: string | null;
  /** 2026-06-01 · BASELINE / NET / TODAY · single source of truth. */
  composition: {
    baseline: number;
    net: number;
    today: number;
  } | null;
  watchTomorrow: string[];
  /** 2026-06-03 · WHAT TO DO panel · prioritized data-grounded actions.
   *  Replaces WATCHING TOMORROW on the Health page web surface (iPhone
   *  still reads watchTomorrow for back-compat). Max 3 entries · returns
   *  a single ON COURSE entry when nothing triggers. See
   *  lib/coach/health-actions.ts for trigger rules. */
  actions: Array<{
    signal: 'sick' | 'niggle' | 'compound' | 'hrv_low_streak' | 'rhr_high_streak'
      | 'sleep_deficit' | 'hrv_cv_destabilizing' | 'wrist_temp_elevated'
      | 'load_spike' | 'load_caution' | 'load_detraining'
      | 'tsb_overreach' | 'tsb_race_ready' | 'plan_adapted' | 'on_course';
    priority: 'urgent' | 'high' | 'medium' | 'low' | 'on-course';
    action: string;
    cite: string;
  }>;
  /** 2026-06-03 · transparency line · "what would trigger an adapt".
   *  Tier-aware (advanced sees 5-day streak thresholds, beginner sees
   *  3-day). Renders below the action chips as a small italic note ·
   *  shows progress toward each soft trigger + reminds of hard rules.
   *  Optional for back-compat with older brief envelopes. */
  actionsThreshold?: string;
  /** 2026-06-01 · Phase 2.3 · daily projection-vs-goal card.
   *  Composed from goal-gap engine + simulator. Status-aware headline,
   *  confidence band, what-closes-it actions, A/B/C alternatives when
   *  the gap isn't closing. Null when no active plan + goal (cold start).
   *  See docs/PLAN_ENGINE_ARCHITECTURE.md §Phase 2.3.
   *
   *  status:
   *    · closing    · trajectory moving toward goal · encouragement
   *    · static     · trajectory stable · "what we need to see next week"
   *    · widening   · trajectory moving away · adapter shifts emphasis
   *    · unclosable · gap too wide for remaining weeks · renegotiation
   *
   *  alternativeRanges:
   *    Populated when status != 'closing' · A=stretch, B=current, C=safe.
   *
   *  daysToRenegotiate:
   *    null  · no renegotiation needed (status='closing' or has time)
   *    >0    · countdown until the renegotiation card surfaces
   *    0     · renegotiation card should render NOW. POST new goal to
   *            PATCH /api/race/[slug] { goalSec, source: 'renegotiate' }.
   */
  gapReport: {
    headline: string;
    trajectorySec: number;
    goalSec: number;
    gapSec: number;
    status: 'closing' | 'static' | 'widening' | 'unclosable';
    confidenceBand: {
      p25Sec: number;
      medianSec: number;
      p75Sec: number;
    } | null;
    whatClosesIt: string[];
    alternativeRanges: {
      a: { sec: number; label: string };
      b: { sec: number; label: string };
      c: { sec: number; label: string };
    } | null;
    weeksRemaining: number;
    daysToRenegotiate: number | null;
    riskFlags: string[];
  } | null;
  /** 2026-06-01 · Power move #1 · engine-authored 2-3 sentence
   *  synthesis paragraph. THE STORY card on Health reads this · falls
   *  back to trendNote / headline when null. Backend composer at
   *  lib/coach/synthesis.ts. */
  synthesis: string | null;
  /** 2026-06-01 · Power move #9 · predictive forecasts. FORECASTS
   *  sub-section under WATCHING TOMORROW renders these as small chips.
   *  Empty array means no slopes met the prediction threshold. Backend
   *  composer at lib/coach/forecasts.ts · matches that file's Forecast
   *  shape exactly so values pass through without transformation. */
  forecasts: Array<{
    pillar: 'sleep' | 'hrv' | 'rhr' | 'load' | 'hrv_cv' | 'wrist_temp';
    daysUntilBandChange: number | null;
    projectedBand: string;
    message: string;
    confidence: 'high' | 'medium' | 'low';
    /** 2026-06-03 · 'good' when trajectory leads to a better state,
     *  'bad' when it leads to worse. Frontend colors the FORECAST chip
     *  green vs yellow/red so the runner can tell at a glance which
     *  forecasts are positive vs warning. Optional for back-compat
     *  with older seed envelopes; defaults to 'bad' if absent (the
     *  conservative read). */
    direction?: 'good' | 'bad';
  }>;
};
export type RaceLite = { slug: string; name: string; meta: string; tag: 'A RACE'|'TUNE-UP'|'PAST'; days: string };

// 2026-06-01 · Power moves sidecar fields. All optional · null when
// not enough signal exists for the helper to compute. Design agent
// reads these straight off seed.health.<field>. See
// designs/briefs/health-page-power-moves-v2.md for the contract.
export type HealthSnapshot = {
  readiness: Readiness;
  body: HealthMetric[];
  form: HealthMetric[];
  /** 2026-06-01 · Health page redesign · sleep architecture verdict
   *  threaded from lib/coach/health-state.ts. The architecture line in
   *  the SLEEP STAGES section reads this · stable/mixed/unstable maps
   *  to a sentence that mentions the deep/REM fractions inline. Null
   *  when fewer than 4 nights of stage data have synced. */
  sleepArchitectureVerdict: 'stable' | 'mixed' | 'unstable' | null;
  // Power moves Wave 2 · aerobic engine trajectory across the block.
  aerobicFitness?: {
    currentDriftPct: number;
    blockStartDriftPct: number;
    weeksTracked: number;
    runsCount: number;
    direction: 'improving' | 'flat' | 'declining';
    summary: string;
    series: { date: string; driftPct: number }[];
    /** 2026-06-03 · zone for current drift % · Research/15. */
    currentZone?: 'race-ready' | 'building' | 'developing' | 'early-base';
    /** 2026-06-03 · static explanation of what aerobic decoupling IS. */
    whatItIs?: string;
  } | null;
  // Power moves Wave 2 · heat acclimatization.
  heatAcclim?: {
    daysInWindow: number;
    avgTempF: number;
    rhrTrend: 'rising' | 'plateauing' | 'falling' | null;
    expectedHRPenaltyBpm: number;
    daysToFullAcclim: number;
    message: string;
  } | null;
  // Power moves #15 · post-session recovery tracker.
  // 2026-06-01 · brief response · percentRecovered + pctRecovered are
  // nullable (null when data is missing). dataInsufficient is the
  // single gate for "is the recovery story honest yet?" ·
  // nextQualityGreenLight is null when dataInsufficient.
  recoveryPhase?: {
    anchor: {
      runId: string;
      date: string;
      type: 'race' | 'long' | 'intervals' | 'tempo' | 'threshold';
      label: string;
      distanceMi: number;
      movingTimeS: number;
    };
    daysSince: number;
    expectedDaysToRecover: number;
    percentRecovered: number | null;
    dataInsufficient: boolean;
    pillars: Array<{
      key: 'hrv' | 'rhr' | 'sleep' | 'hr_recovery' | 'wrist_temp' | 'resp_rate';
      label: string;
      day0Value: number | null;
      currentValue: number | null;
      baselineValue: number | null;
      pctRecovered: number | null;
      /** 2026-06-03 · plain-English delta line replacing "% back" copy.
       *  Examples: "20ms below baseline", "1 bpm off baseline",
       *  "1.4h short of target", "at baseline". Empty when no data. */
      statusLine?: string;
      /** 2026-06-03 · severity band for the status line color.
       *  good = within tolerance · watch = mild deficit ·
       *  bad = significant deficit · no-data = comparison unavailable. */
      severity?: 'good' | 'watch' | 'bad' | 'no-data';
    }>;
    muscleSignals: {
      cadenceSpm: number | null;
      cadenceDelta: number | null;
      gctMs: number | null;
      gctDelta: number | null;
      strideM: number | null;
      strideDelta: number | null;
      runPowerW: number | null;
      runPowerDelta: number | null;
      summary: string;
    } | null;
    nextQualityGreenLight: {
      date: string;
      daysOut: number;
      reason: string;
    } | null;
    message: string;
    /** 2026-06-03 · static doctrine reference for the expected window
     *  ("Typical window for a 13–15mi long run: 2 days · Pfitzinger").
     *  Optional for back-compat · readers without the field render
     *  no doctrine line. */
    expectedWindowDoctrine?: string;
  } | null;
  // Power moves Wave 4 · block-over-block comparison.
  blockComparison?: {
    currentBlock: { label: string; weeks: number; avgSleepH: number | null; avgHrvMs: number | null; avgRhrBpm: number | null };
    referenceBlock: { label: string; weeks: number; avgSleepH: number | null; avgHrvMs: number | null; avgRhrBpm: number | null };
    deltas: { sleepH: number | null; hrvMs: number | null; rhrBpm: number | null };
    message: string;
  } | null;
  // Power moves Wave 4 · day-of-week patterns.
  dowPatterns?: {
    sleep: Array<{ dow: number; label: string; avg: number | null }>;
    hrv: Array<{ dow: number; label: string; avg: number | null }>;
    rhr: Array<{ dow: number; label: string; avg: number | null }>;
    insights: string[];
  } | null;
  // Power moves Wave 4 · cycle phase performance (female-gated).
  cyclePerformance?: {
    follicular: { runCount: number; avgPaceSPerMi: number | null; avgHrBpm: number | null; topQuartileRate: number };
    ovulatory:  { runCount: number; avgPaceSPerMi: number | null; avgHrBpm: number | null; topQuartileRate: number };
    luteal:     { runCount: number; avgPaceSPerMi: number | null; avgHrBpm: number | null; topQuartileRate: number };
    menstrual:  { runCount: number; avgPaceSPerMi: number | null; avgHrBpm: number | null; topQuartileRate: number };
    insights: string[];
  } | null;
  // Power moves Wave 4 · quality predictors.
  qualityPredictors?: {
    topPredictor: {
      metric: string;
      threshold: number;
      unit: string;
      correlation: number;
      message: string;
    };
    allCorrelations: Array<{ metric: string; correlation: number }>;
  } | null;
};
export type HealthMetric = {
  k: string;            // 'hrv', 'rhr', 'sleep', etc.
  label: string;        // 'HRV', 'RESTING HR'
  unit: string;
  current: number;
  target?: number;
  band?: [number, number];
  dom: [number, number];
  series: number[];     // 30 points
  status: 'good'|'warn'|'neutral';
  decimals?: number;
  clock?: boolean;
  /**
   * 2026-06-03 · honest empty-state flag. True when there is no source
   * data for this metric (watch wasn't worn, signal never tracked, etc.).
   * Consumers should render "—" / empty state, NOT a number. `current`
   * stays at 0 for shape stability · do not display it when noData=true.
   * Backward-compatible · existing consumers ignore the flag and see 0.
   */
  noData?: boolean;
  /**
   * 2026-06-03 · target-source labeling. The `target` field can mean three
   * different things: a runner-specific rolling baseline, a literature-
   * derived universal (e.g. cadence 170 spm), or a 7-day average. The
   * tile caption changes by source so the runner knows what they're
   * comparing against. Defaults to 'target' for back-compat (old tiles
   * read as research-target). Options:
   *   · 'baseline' → "baseline 60ms" · runner-specific 30d rolling
   *   · 'target'   → "target 75min"  · research-derived universal
   *   · 'avg7'     → "7d avg 1800kcal" · runner-specific 7-night window
   */
  targetKind?: 'baseline' | 'target' | 'avg7';
};

export type ActivityData = {
  ranges: Record<'month'|'year'|'all', ActivityRange>;
  recent: RecentRun[];
};
export type HeatCell = {
  lv: 0 | 1 | 2 | 3 | 4;          // bin: 0=rest, 1=<4mi, 2=<8mi, 3=<14mi, 4=14mi+
  date: string;                    // ISO YYYY-MM-DD
  mi: number;                      // total miles that day (0 = rest)
  label: string;                   // friendly label e.g. "12.0 mi · Tempo Run" or "Rest"
  runId?: string;                  // first run on that day (for click → modal)
};
export type ActivityRange = {
  eyebrow: string; big: string; sub: string;
  totals: [string,string][];
  volT: string; volS: string;
  vol: { l: string; v: number }[];
  mix: [string, string, number][];   // ['easy','Easy',48]
  recs: { k: string; v: string; c: string; t: string }[];
  heat: HeatCell[][];                // 18 cols × 7 rows
  heatLabels: string[];              // ['JAN','FEB','MAR','APR','MAY']
  facts: { i: string; v: string; c: string }[];
};
export type RecentRun = {
  date: string; effort: string; color: string;
  name: string; meta: string; badge?: 'NAILED IT'|'SOLID'|'LONGEST'|'PR';
  slug?: string;
};

export type ShoeRec = { id?: number; brand?: string; model?: string; nm: string; role: string; roles: string[]; preferred: boolean; mi: number; max: number };
export type ConnectionRow = { id: string; nm: string; sub: string; bg: string; gl: string; on: boolean; lastSyncIso?: string | null };
export type { ViewKey, EffortKey, PlannedDay, CompletedRun };
