/**
 * regen-policy.ts — single source of truth for coach briefing regeneration.
 *
 * Encodes which surfaces regen on which events, and at what cadence.
 * Replaces hand-coded surface lists scattered across cache.ts +
 * refresh-briefings/route.ts.
 *
 * Design philosophy:
 *   - TODAY is always warm (user opens it every morning, ground truth surface).
 *   - HEALTH is event-driven on HK signal samples (debounced).
 *   - TRAINING / RACES / PROFILE only regen on mutations that touch their data.
 *     A run ingest does NOT regen /races or /profile coach voice.
 *   - The 14-day "touched gate" stays: if a surface hasn't been visited in 14
 *     days, the daily warm cron skips it (don't burn LLM on dormant pages).
 *
 * Cost model:
 *   - Today regen on every relevant event ≈ $0.05/event
 *   - Other surfaces capped to daily + on direct mutation
 *   - Worst-case daily cost for a typical-user beta ~$0.20–0.30
 *   - Without this policy (regen-everything-on-every-event): $4–5/day
 *
 * Audit 2026-05-27.
 */

/** All LLM-backed surfaces in the app. Keep in sync with PROMPTS in
 *  coach/prompts/index.ts. */
export type Surface =
  | 'today'
  | 'training'
  | 'races'
  | 'race-detail'
  | 'health'
  | 'profile';

/**
 * Events that can trigger a cache bust. Each one corresponds to a real
 * mutation hook in the app (a route handler or cron). New mutations should
 * declare which surfaces they affect HERE first, then call
 * bustSurfacesForEvent() — so this file stays the SOURCE OF TRUTH.
 */
export type RegenEvent =
  | 'run_ingest'        // /api/watch/workouts/complete, /api/gpx/import, etc.
  | 'check_in'          // /api/checkin
  | 'plan_swap'         // /api/plan/workout, /api/plan/generate
  | 'profile_edit'      // /api/profile
  | 'race_crud'         // /api/race
  | 'shoe_crud'         // /api/shoe
  | 'hk_signal_sample'  // /api/ingest/health (sleep_hours / resting_hr / hrv / hr_recovery)
  | 'day_rollover'      // daily 00:05 PT cron
  | 'keep_warm_tick';   // 15min DB-only warm (no LLM)

/**
 * Surfaces each event invalidates. Driven by audit 2026-05-27:
 *
 * - run_ingest:    today (run is THE event for today). Training cares
 *                  about week mileage so include it. Races/profile/health
 *                  unchanged by a single run.
 * - check_in:      today (chip just got tapped), training (recovery framing),
 *                  health (subjective input). Profile/races/race-detail
 *                  unchanged.
 * - plan_swap:     today (plan changed under it), training (plan is the page).
 *                  Race-detail if the swap touches race-week. Profile shows
 *                  next-race summary so include it.
 * - profile_edit:  profile (obviously), today + training (zones changed,
 *                  paces shift). Races inherit nothing from profile change.
 * - race_crud:     races (page is the calendar), race-detail (slug-specific),
 *                  today (nextARace string in lead), profile (race-summary).
 * - shoe_crud:     today only (shoe recs sometimes lead). Profile shows the
 *                  rotation but it re-loads from state-loader, not the LLM
 *                  brief.
 * - hk_signal_sample:  today (readiness recompute), health (THE page for it).
 *                  Training inherits nothing same-day from a single sleep row.
 * - day_rollover:  today (planned workout changed), training (week shape),
 *                  race-detail (countdown moved). Health/profile static.
 */
export const REGEN_MAP: Record<RegenEvent, readonly Surface[]> = {
  run_ingest:       ['today', 'training'],
  check_in:         ['today', 'training', 'health'],
  plan_swap:        ['today', 'training', 'race-detail', 'profile'],
  profile_edit:     ['today', 'training', 'profile'],
  race_crud:        ['today', 'races', 'race-detail', 'profile'],
  shoe_crud:        ['today'],
  hk_signal_sample: ['today', 'health'],
  day_rollover:     ['today', 'training', 'race-detail'],
  keep_warm_tick:   [],  // DB pool warm only; no LLM regen.
} as const;

/**
 * Recommended max-stale window per surface. The daily refresh-briefings
 * cron uses this to decide which surfaces to LLM-regenerate at 00:05 PT.
 *
 * - today: 0 (always fresh, regen daily + on every signal event)
 * - training: 24h (mostly static through the day; regen overnight)
 * - races: 24h
 * - race-detail: 24h (countdown matters)
 * - health: 12h (HK arrivals during the day handle the rest via debounced bust)
 * - profile: 7d (anchors / gear change rarely)
 *
 * The 14-day "touched gate" still applies. A surface not visited in 14 days
 * does NOT consume LLM cycles regardless of its max-stale window.
 */
export const MAX_STALE_HOURS: Record<Surface, number> = {
  today:        0,
  training:    24,
  races:       24,
  'race-detail': 24,
  health:      12,
  profile:    7 * 24,
};

/**
 * Compute the set of surfaces a given event should bust.
 * Use this in mutation endpoints instead of hard-coding lists.
 */
export function surfacesForEvent(event: RegenEvent): readonly Surface[] {
  return REGEN_MAP[event];
}

/** True if this surface is expected to LLM-regen on the daily cron. */
export function surfaceWarmsDaily(surface: Surface): boolean {
  // Always warm today + today:ios. Other surfaces only if they've been
  // touched recently (refresh-briefings handles the 14-day touched gate).
  return surface === 'today';
}
