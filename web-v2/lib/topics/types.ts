/**
 * Topic kinds — the typed schema for every coach card in the deck.
 *
 * Each kind has:
 *   1. A Zod schema validating its payload shape
 *   2. A `prereqs(state)` function that returns true iff the topic can render
 *      given the current state. If false, the topic is dropped from the
 *      briefing response BEFORE it reaches the LLM. This is the truth
 *      contract — topics never surface without their required data.
 *
 * Canonical reference: docs/coach/mockups/deck-v1-2026-05-25.html
 */
import { z } from 'zod';

/* ────────────────────────── State snapshot ────────────────────────── */

/**
 * What the prereq functions see. Loaded by lib/coach/state-loader.ts on
 * every briefing fetch. Any field can be null — prereqs MUST handle nulls
 * (a missing value means "we don't know" and the topic should defer).
 */
export interface CoachState {
  today: string;                // ISO date (server local)
  user_id: string;

  profile: {
    full_name: string | null;
    sex: string | null;
    age: number | null;
    city: string | null;
    height_cm: number | null;
    experience_level: 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus' | null;
  } | null;

  latest_activity: {
    id: string;
    date: string;
    mi: number;
    pace: string | null;
    timeMoving: string | null;
    hr: number | null;
    cadence: number | null;
    tempF: number | null;
    name: string | null;
  } | null;

  // Last 7 days of runs — used to PREVENT coach hallucination. The LLM may
  // ONLY reference runs that appear here.
  recentRuns: Array<{
    date: string;
    type: string | null;
    mi: number;
    pace: string | null;
    hr: number | null;
    name: string | null;
    source: string | null;
  }>;

  weekDone: number;
  weekPlanned: number | null;
  phaseLabel: string | null;
  currentWeekDays: Array<{
    date: string; dow: number; type: string; mi: number; label: string | null;
  }>;

  /** TODAY's planned workout from the active plan. Distinct from
   *  nextWorkout (which is the next FUTURE day). Without this in state,
   *  the LLM has no anchor for what today actually is and tends to
   *  hallucinate today as a continuation of yesterday. */
  todayWorkout: {
    date: string; dow: number; type: string; mi: number; label: string | null;
  } | null;

  nextWorkout: {
    date: string; dow: number; type: string; mi: number; label: string | null;
  } | null;

  nextARace: {
    // Race name may be null — race rows in the DB don't enforce a name
    // and the shared loadNextARace returns the raw value. 2026-05-27
    // build fix: aligning the field nullability with the source of
    // truth instead of breaking the type round-trip in state-loader.
    slug: string; name: string | null; date: string; goal: string | null;
    days_to_race: number;
  } | null;

  sleep7Avg: number | null;
  sleep7Deficit: number;
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  // 2026-06-01 · biological sex + cycle phase (iPhone 0fa7d55a shipped
  // menstrual cycle ingest). Used in readiness.ts to subtract a small
  // ms allowance from hrvBaseline in the luteal phase per Research/13.
  // Null for non-female users + female users who haven't opted in.
  biologicalSex: 'female' | 'male' | 'not_specified';
  cyclePhase: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  cadenceBaseline: number | null;

  // P2 #9 (2026-05-30): Apple Watch heart-rate recovery, 1 minute after
  // workout end. Drops > ~30 bpm is well-conditioned cardio; < 15 bpm is
  // a yellow flag. Pulled from health_samples.sample_type='hr_recovery'.
  // Feeds a small (5%) weight in readiness; null when no recent sample.
  hrRecoveryCurrent: number | null;
  hrRecoveryBaseline: number | null;

  // Acute:Chronic load — distance-based. acute7 = avg daily mi over last 7d,
  // chronic28 = avg daily mi over last 28d. Ratio = acute7 / chronic28.
  // Drives the LOAD pillar of readiness (Gabbett ACWR).
  loadAcute7: number | null;       // mi/day, last 7 days
  loadChronic28: number | null;    // mi/day, last 28 days
  loadAcwr: number | null;         // acute7 / chronic28

  // Recent check-ins (last 7 days) — informs voice tone next briefing
  recentCheckIns: Array<{ ts: string; rating: 'solid' | 'tired' | 'wrecked' }>;

  /** P-OPTION-C 2026-05-27 — most recent unresolved niggle (body issue
   *  the runner flagged via free text) in the last 7 days. Surfaced
   *  as a HARD FACT in the coach orientation so it can't be ignored.
   *  Resolved when a later check-in marks it resolved or 5+ days pass
   *  without re-mention. */
  activeNiggle: {
    body_part: string;
    severity: 'mild' | 'moderate' | 'flare' | null;
    description: string;
    first_logged_ts: string;
    days_ago: number;
  } | null;

  // Logged coach intents not yet acknowledged in voice — voice may mention once
  pendingIntents: Array<{ reason: string; field: string; value: string | number }>;

  // Shoes (active only)
  shoes: Array<{
    id: string; name: string; mileage: number; cap: number; pctUsed: number;
    isRaceShoe: boolean;
  }>;

  /** 2026-06-03 · Today screen post-run pivot · iPhone forward-compat
   *  decoded these on iOS already (Decodable lenient defaults). When
   *  the iPhone calls /api/glance / state-loader and sees
   *  todayRunDone === true, it swaps the morning readiness ring for the
   *  recovery brief view at GET /api/coach/recovery-brief.
   *
   *  todayRunDone · TRUE when any run > 1mi on today's date exists in
   *    runs.data (deduped, NOT (data ? 'mergedIntoId')).
   *  todayRunLong · TRUE when todayRunDone === TRUE AND today's planned
   *    workout type='long' AND actual mi ≥ 0.80 × prescribed long mi.
   *
   *  Hard rule (iPhone enforces): once todayRunDone flips true within
   *  a day it stays true until midnight rolls · no morning-mode bounce. */
  todayRunDone: boolean;
  todayRunLong: boolean;

  /** 2026-06-03 · adaptive coach voice band (lib/coach/voice-band.ts).
   *  Drives copy verbosity + hedging across morning brief / pre-run
   *  cue / post-run recap. Three bands:
   *    · calibration · soft, hedged paces, ±15s bands
   *    · guided      · concrete prescriptions with soft override
   *    · challenge   · direct, no hedging
   *  Null on state-load failure · consumers fall back to 'guided'
   *  which is the safest default. */
  voiceBand: import('@/lib/coach/voice-band').VoiceBandReason | null;
}

/* ────────────────────────── Topic payloads ────────────────────────── */

export const RunRecapPayload = z.object({
  activity_id: z.string().nullable().optional(),   // routes to /runs/[id]
  distance_mi: z.number(),
  pace: z.string().nullable(),
  time_moving: z.string().nullable(),
  hr: z.number().nullable(),
  cadence: z.number().nullable(),
  weather_chip: z.string().nullable(),
});

export const SleepDeficitPayload = z.object({
  avg_h_7n: z.number(),
  deficit_h_7n: z.number(),
  last_night_h: z.number().nullable(),
  direction: z.enum(['improving', 'stable', 'declining', 'short']),
});

export const NextWorkoutPayload = z.object({
  dow: z.string(),
  type: z.string(),
  label: z.string().nullable(),
  mi: z.number(),
});

export const RaceHorizonPayload = z.object({
  race_name: z.string(),
  race_date: z.string(),
  days_to_race: z.number(),
  tone: z.enum(['building', 'sharpening', 'race_week']),
  goal: z.string().nullable(),
});

export const CadenceExperimentPayload = z.object({
  baseline_spm: z.number(),
  target_spm_low: z.number(),
  target_spm_high: z.number(),
  rationale: z.string(),
});

export const ProfileGapPayload = z.object({
  field: z.string(),
  why: z.string(),
});

export const FunFactPayload = z.object({
  term: z.string(),
  body: z.string(),
  link_slug: z.string(),
});

export const WatchListPayload = z.object({
  items: z.array(z.object({
    label: z.string(),
    status: z.enum(['amber', 'red']),
    note: z.string(),
  })),
});

// 2026-05-27 P-RIGHT-RAIL-TOPICS — new topic kinds so the right rail
// can surface a card for everything the coach talks about in voice.
//
// niggle: the runner has an active body issue (calf tight, etc.) the
// coach is tracking. Card surfaces the body part + severity + days
// since first logged + a "RESOLVED" affordance.
export const NigglePayload = z.object({
  body_part: z.string(),
  severity: z.enum(['mild', 'moderate', 'flare']).nullable(),
  description: z.string(),
  days_ago: z.number(),
});

// load_ramp: ACWR + spike-line context. Shows where the runner sits
// in the Gabbett band: detraining / building / sweet-spot / elevated /
// spike. Visual: horizontal scale with a marker.
export const LoadRampPayload = z.object({
  acwr: z.number(),
  acute_mi_per_day: z.number(),
  chronic_mi_per_day: z.number(),
  band: z.enum(['detraining', 'building', 'sweet_spot', 'elevated', 'spike']),
});

// weekly_volume: done / projected / planned. Mirrors the strip header
// but as a standalone card the coach can reference.
export const WeeklyVolumePayload = z.object({
  done_mi: z.number(),
  projected_mi: z.number(),
  planned_mi: z.number(),
  phase_label: z.string().nullable(),
});

// long_run_horizon: countdown to the next long run on the calendar.
// Card shows day-of-week, miles, sub_label, days-away.
export const LongRunHorizonPayload = z.object({
  date: z.string(),                  // ISO date
  dow: z.string(),                   // "Sunday"
  mi: z.number(),
  label: z.string().nullable(),
  days_away: z.number(),
});

/* ────────────────────────── Topic registry ────────────────────────── */

export type Topic =
  | { kind: 'run_recap';           payload: z.infer<typeof RunRecapPayload>;           coach_note: string | null }
  | { kind: 'sleep_deficit';       payload: z.infer<typeof SleepDeficitPayload>;       coach_note: string | null }
  | { kind: 'next_workout';        payload: z.infer<typeof NextWorkoutPayload>;        coach_note: string | null }
  | { kind: 'race_horizon';        payload: z.infer<typeof RaceHorizonPayload>;        coach_note: string | null }
  | { kind: 'cadence_experiment';  payload: z.infer<typeof CadenceExperimentPayload>;  coach_note: string | null }
  | { kind: 'profile_gap';         payload: z.infer<typeof ProfileGapPayload>;         coach_note: null }
  | { kind: 'fun_fact';            payload: z.infer<typeof FunFactPayload>;            coach_note: null }
  | { kind: 'watch_list';          payload: z.infer<typeof WatchListPayload>;          coach_note: string | null }
  | { kind: 'niggle';              payload: z.infer<typeof NigglePayload>;             coach_note: string | null }
  | { kind: 'load_ramp';           payload: z.infer<typeof LoadRampPayload>;           coach_note: string | null }
  | { kind: 'weekly_volume';       payload: z.infer<typeof WeeklyVolumePayload>;       coach_note: string | null }
  | { kind: 'long_run_horizon';    payload: z.infer<typeof LongRunHorizonPayload>;     coach_note: string | null };

export type TopicKind = Topic['kind'];

/* ────────────────────────── Prereq functions ────────────────────────── */

/**
 * Each prereq fn returns true iff the topic can legally surface given state.
 * If false, the topic is dropped before the LLM ever sees it.
 *
 * Rule: prereqs are factual, not editorial. Editorial "should this surface"
 * decisions belong to the surface router (lib/coach/router.ts), not here.
 */
export const TopicPrereqs: Record<TopicKind, (s: CoachState) => boolean> = {
  // Needs a recent run to recap.
  run_recap: (s) => s.latest_activity !== null,

  // Needs at least 5 nights of sleep data and a target deficit.
  sleep_deficit: (s) => s.sleep7Avg !== null && s.sleep7Deficit >= 1.5,

  // Needs an upcoming planned workout.
  next_workout: (s) => s.nextWorkout !== null,

  // Needs an A-race on the calendar.
  race_horizon: (s) => s.nextARace !== null,

  // The big one: cannot prescribe cadence target without height.
  // This is the canonical truth-contract example.
  cadence_experiment: (s) =>
    s.profile?.height_cm !== null && s.profile?.height_cm !== undefined &&
    s.cadenceBaseline !== null,

  // Surfaces only if there's a profile field missing that downstream features need.
  profile_gap: (s) => s.profile?.height_cm === null,

  // Always eligible; the surface router decides when to include.
  fun_fact: () => true,

  // Surfaces when watch-list signals exist (RHR + sleep deficit, etc.).
  watch_list: (s) => {
    const rhrElevated = s.rhrCurrent != null && s.rhrBaseline != null &&
                        (s.rhrCurrent - s.rhrBaseline) >= 5;
    const sleepShort  = s.sleep7Deficit >= 3.0;
    return rhrElevated || sleepShort;
  },

  // P-RIGHT-RAIL-TOPICS 2026-05-27
  niggle: (s) => s.activeNiggle != null,
  load_ramp: (s) => s.loadAcwr != null && s.loadAcute7 != null && s.loadChronic28 != null,
  weekly_volume: (s) => s.weekDone != null && s.weekPlanned != null && s.weekPlanned > 0,
  long_run_horizon: (s) => {
    // Eligible when there's a long run scheduled in this week's plan
    // ahead of (or on) today.
    const today = s.today;
    return (s.currentWeekDays ?? []).some(
      (d: any) => d.date >= today && d.type === 'long' && d.mi > 0
    );
  },
};

/**
 * Filter a candidate list of topic kinds by prereqs.
 * Returns only the kinds whose prereqs are satisfied for the current state.
 */
export function eligibleKinds(state: CoachState, candidates: TopicKind[]): TopicKind[] {
  return candidates.filter((k) => TopicPrereqs[k](state));
}
