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
    hrmax: number | null;       // best-known max HR (manual > LTHR-derived > observed)
    lthr: number | null;        // Friel LTHR — primary zone anchor (Research/03 §6)
    rhr: number | null;
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
    slug: string; name: string; date: string; goal: string | null;
    days_to_race: number;
  } | null;

  sleep7Avg: number | null;
  sleep7Deficit: number;
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  cadenceBaseline: number | null;

  // Recent check-ins (last 7 days) — informs voice tone next briefing
  recentCheckIns: Array<{ ts: string; rating: 'solid' | 'tired' | 'wrecked' }>;

  // Logged coach intents not yet acknowledged in voice — voice may mention once
  pendingIntents: Array<{ reason: string; field: string; value: string | number }>;

  // Shoes (active only)
  shoes: Array<{
    id: string; name: string; mileage: number; cap: number; pctUsed: number;
    isRaceShoe: boolean;
  }>;
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

/* ────────────────────────── Topic registry ────────────────────────── */

export type Topic =
  | { kind: 'run_recap';           payload: z.infer<typeof RunRecapPayload>;           coach_note: string | null }
  | { kind: 'sleep_deficit';       payload: z.infer<typeof SleepDeficitPayload>;       coach_note: string | null }
  | { kind: 'next_workout';        payload: z.infer<typeof NextWorkoutPayload>;        coach_note: string | null }
  | { kind: 'race_horizon';        payload: z.infer<typeof RaceHorizonPayload>;        coach_note: string | null }
  | { kind: 'cadence_experiment';  payload: z.infer<typeof CadenceExperimentPayload>;  coach_note: string | null }
  | { kind: 'profile_gap';         payload: z.infer<typeof ProfileGapPayload>;         coach_note: null }
  | { kind: 'fun_fact';            payload: z.infer<typeof FunFactPayload>;            coach_note: null }
  | { kind: 'watch_list';          payload: z.infer<typeof WatchListPayload>;          coach_note: string | null };

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
};

/**
 * Filter a candidate list of topic kinds by prereqs.
 * Returns only the kinds whose prereqs are satisfied for the current state.
 */
export function eligibleKinds(state: CoachState, candidates: TopicKind[]): TopicKind[] {
  return candidates.filter((k) => TopicPrereqs[k](state));
}
