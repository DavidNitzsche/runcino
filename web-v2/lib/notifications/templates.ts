/**
 * Notification templates — deterministic, no LLM.
 *
 * Source: docs/2026-05-28-notifications.html (every category section).
 *
 * Brand voice (deck §VOICE FRAME):
 *   - Short. Direct. Plain.
 *   - SCREAMING CAPS only on the title (and only when data warrants it).
 *   - Numbers in tabular form: "19.7 / 43.8 mi", not "about 20".
 *   - No fake urgency. No marketing language.
 *   - Race-day is the one place we go slightly louder.
 *
 * Every template returns the full SendPushArgs body needed by sendPush —
 * including the action_buttons + dedup_key + interruption_level.
 *
 * Tests should hit these directly with crafted state and assert against
 * the rendered title/body. Templates intentionally accept primitives so
 * the test surface is dumb-easy.
 */

import type { ApnsActionButton, NotificationCategory } from './apns';

export interface RenderedTemplate {
  category: NotificationCategory;
  title: string;
  body: string;
  /** APNs `interruption-level`. */
  interruption_level: 'passive' | 'active' | 'time-sensitive';
  /** Rich actions per category (deck §4 RICH NOTIFICATION CATEGORIES). */
  action_buttons?: ApnsActionButton[];
  /** 2026-07-06 · audit P1-25 · optional UNNotificationCategory override.
   *  Most templates omit this and the sender maps their prefs bucket via
   *  apnsCategoryId. A template whose actions differ from its bucket-mates
   *  (sick check's RECOVERED vs niggle check's GONE) sets its own id so
   *  iOS can register a distinct action set. */
  apns_category_id?: string;
  /** Stable dedup key (deck §5 DEDUP + QUIET HOURS). */
  dedup_key: string;
  /** Free-form metadata under `faff`. iOS uses faff.deeplink to route. */
  data: Record<string, unknown>;
  /** OS thread-id for grouping in Notification Center. */
  thread_id?: string;
  /** When true, the scheduler must override quiet hours. */
  bypass_quiet_hours?: boolean;
}

// ──────────────────────────────────────────────────────────────
// A · RACE DAY MORNING (deck §A)
// ──────────────────────────────────────────────────────────────

export interface RaceDaySlots {
  race_id: string;
  race_name: string;        // 'America\'s Finest City'
  race_slug: string;        // 'afc-2026'
  gun_time_local: string;   // '7:00'
  uber_pickup_local?: string | null; // '6:25' or null
  distance: string;         // '13.1' (half) or '26.2'
}

export function renderRaceDay(s: RaceDaySlots): RenderedTemplate {
  const body = s.uber_pickup_local
    ? `Gun ${s.gun_time_local}. Uber pickup ${s.uber_pickup_local}. kit on the chair · ${s.distance} ahead.`
    : `Gun ${s.gun_time_local}. kit on the chair · ${s.distance} ahead.`;
  return {
    category: 'race_day',
    title: `RACE DAY · ${s.race_name.toUpperCase()}`,
    body,
    interruption_level: 'time-sensitive',
    dedup_key: `race-day:${s.race_id}`,
    thread_id: `race-${s.race_id}`,
    bypass_quiet_hours: true,
    action_buttons: [
      { identifier: 'OPEN_RACE', title: 'OPEN FAFF' },
    ],
    data: {
      deeplink: `faff://races/${s.race_slug}`,
      race_id: s.race_id,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// B · RACE EVE (deck §B)
// ──────────────────────────────────────────────────────────────

export interface RaceEveSlots {
  race_id: string;
  race_slug: string;
  shakeout_done: boolean;
}

export function renderRaceEve(s: RaceEveSlots): RenderedTemplate {
  const opener = s.shakeout_done
    ? 'Light shake-out done.'
    : 'Shake-out skipped — that\'s fine.';
  return {
    category: 'race_eve',
    title: 'RACE TOMORROW',
    body: `${opener} Early to bed. kit prepped?`,
    interruption_level: 'active',
    dedup_key: `race-eve:${s.race_id}`,
    thread_id: `race-${s.race_id}`,
    action_buttons: [
      { identifier: 'OPEN_CHECKLIST', title: 'OPEN CHECKLIST' },
    ],
    data: {
      deeplink: `faff://races/${s.race_slug}/checklist`,
      race_id: s.race_id,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// B2 · SLEEP BANKING (Phase 2 · 3.4 · Research/08 §sleep-banking)
//
// Race-week bedtime nudge, T-7 → T-2 at ~21:00 runner-local. Rides
// the existing `race_eve` category deliberately: it is race-week
// evening messaging, the iOS app already registers FAFF_RACE_EVE,
// and the runner's race_eve toggle governs it — no new prefs column,
// no unregistered-category fallback. Dedup per night.
// ──────────────────────────────────────────────────────────────

export interface SleepBankingSlots {
  race_id: string;
  race_slug: string;
  race_name: string;
  days_to_race: number;
  /** YYYY-MM-DD of tonight (runner-local) · dedup key component. */
  tonight_iso: string;
}

export function renderSleepBanking(s: SleepBankingSlots): RenderedTemplate {
  const body = s.days_to_race === 2
    ? `Tonight is the night that counts. 8.5 hours · race-eve sleep matters less than this one.`
    : `${s.days_to_race} days out. Target 8 to 8.5 hours · sleep is the only training left that works now.`;
  return {
    category: 'race_eve',
    title: 'SLEEP BANKING',
    body,
    interruption_level: 'active',
    dedup_key: `sleep-banking:${s.race_id}:${s.tonight_iso}`,
    thread_id: `race-${s.race_id}`,
    action_buttons: [],
    data: {
      deeplink: `faff://health`,
      race_id: s.race_id,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// C · SKIP RECOVERY (deck §C)
// ──────────────────────────────────────────────────────────────

export interface SkipRecoverySlots {
  user_id: string;
  date_iso: string;          // YYYY-MM-DD of TODAY (the day the runner might run)
  planned_today_verb: string; // 'easy' | 'long' | 'tempo' | 'intervals' | 'progression'
  planned_today_distance: string; // '6.1mi' or '5.0mi'
}

export function renderSkipRecovery(s: SkipRecoverySlots): RenderedTemplate {
  return {
    category: 'skip_recovery',
    title: 'YESTERDAY · SKIPPED',
    body: `Today is ${s.planned_today_verb} ${s.planned_today_distance}. still feeling it?`,
    interruption_level: 'active',
    dedup_key: `skip-recovery:${s.user_id}:${s.date_iso}`,
    action_buttons: [
      { identifier: 'READY',          title: 'READY' },
      { identifier: 'STILL_SKIPPING', title: 'STILL SKIPPING' },
    ],
    data: {
      deeplink: 'faff://today',
      date_iso: s.date_iso,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// D · WEEKLY CHECK-IN (deck §D)
// ──────────────────────────────────────────────────────────────

export interface WeeklyCheckinSlots {
  user_id: string;
  /** YYYY-MM-DD of the first day of the runner's TRAINING week — the day
   *  after their long_run_day, same boundary /api/plan/week uses. Was
   *  documented as ISO Monday; that split a Saturday-long runner's week
   *  in two (2026-07-06 audit P2 · week-boundary finding). */
  week_start_iso: string;
  actual_mi: number;
  planned_mi: number;
  days_run: number;
  days_total: number;     // typically 7
}

export function renderWeeklyCheckin(s: WeeklyCheckinSlots): RenderedTemplate {
  const actual = s.actual_mi.toFixed(1);
  const planned = s.planned_mi.toFixed(1);
  return {
    category: 'weekly_checkin',
    title: `WEEK DONE · ${actual} / ${planned} MI`,
    body: `${s.days_run} of ${s.days_total} days. how'd it feel?`,
    interruption_level: 'active',
    dedup_key: `weekly-checkin:${s.user_id}:${s.week_start_iso}`,
    action_buttons: [
      { identifier: 'SOLID',   title: 'SOLID' },
      { identifier: 'TIRED',   title: 'TIRED' },
      { identifier: 'WRECKED', title: 'WRECKED', destructive: true },
    ],
    data: {
      deeplink: 'faff://plan',
      week_start_iso: s.week_start_iso,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// E · NIGGLE / SICK CHECK (deck §E)
// ──────────────────────────────────────────────────────────────

export interface NiggleCheckSlots {
  user_id: string;
  niggle_id: number;
  date_iso: string;
  body_part: string;     // 'hamstring' | 'calf' | ...
  days_active: number;   // ≥ 1
}

export function renderNiggleCheck(s: NiggleCheckSlots): RenderedTemplate {
  const dayUnit = s.days_active === 1 ? 'DAY' : 'DAYS';
  return {
    category: 'niggle_sick',
    title: `${s.body_part.toUpperCase()} · ${s.days_active} ${dayUnit}`,
    body: 'How is it this morning? scale of better, same, worse, gone.',
    interruption_level: 'active',
    dedup_key: `niggle-check:${s.niggle_id}:${s.date_iso}`,
    action_buttons: [
      { identifier: 'BETTER', title: 'BETTER' },
      { identifier: 'SAME',   title: 'SAME' },
      { identifier: 'WORSE',  title: 'WORSE', destructive: true },
      { identifier: 'GONE',   title: 'GONE' },
    ],
    data: {
      deeplink: 'faff://today',
      niggle_id: s.niggle_id,
    },
  };
}

export interface SickCheckSlots {
  user_id: string;
  episode_id: number;
  date_iso: string;
  days_active: number;
}

export function renderSickCheck(s: SickCheckSlots): RenderedTemplate {
  const dayUnit = s.days_active === 1 ? 'DAY' : 'DAYS';
  return {
    category: 'niggle_sick',
    title: `SICK · ${dayUnit === 'DAY' ? '' : ''}${s.days_active} ${dayUnit}`.trim(),
    body: 'How is it this morning? scale of better, same, worse, recovered.',
    interruption_level: 'active',
    // 2026-07-06 · audit P1-25 · sick check emits its OWN iOS category.
    // It shares the niggle_sick prefs bucket, but FAFF_NIGGLE's registered
    // actions are BETTER/SAME/WORSE/GONE — RECOVERED never rendered, and
    // GONE (the only "I'm well" option shown) misrouted to the niggle
    // path. Wave 2 native registers FAFF_SICK with BETTER/SAME/WORSE/
    // RECOVERED in NotificationCategories.swift. On builds that haven't
    // registered FAFF_SICK yet, iOS shows the alert without action
    // buttons (safe degradation — tap opens the app) instead of showing
    // the wrong niggle actions.
    apns_category_id: 'FAFF_SICK',
    dedup_key: `sick-check:${s.episode_id}:${s.date_iso}`,
    action_buttons: [
      { identifier: 'BETTER',    title: 'BETTER' },
      { identifier: 'SAME',      title: 'SAME' },
      { identifier: 'WORSE',     title: 'WORSE', destructive: true },
      { identifier: 'RECOVERED', title: 'RECOVERED' },
    ],
    data: {
      deeplink: 'faff://today',
      episode_id: s.episode_id,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// F · STREAK / MILESTONE (deck §F)
// ──────────────────────────────────────────────────────────────

export interface StreakMilestoneSlots {
  user_id: string;
  streak_days: number;       // 7 | 14 | 30 | 100
  is_longest_ever: boolean;
}

export function renderStreakMilestone(s: StreakMilestoneSlots): RenderedTemplate {
  const tail = s.is_longest_ever ? ' · LONGEST YET' : '';
  return {
    category: 'streak',
    title: `${s.streak_days} DAY STREAK${tail}`,
    body: 'consistency lands.',
    interruption_level: 'passive',
    dedup_key: `milestone:streak:${s.streak_days}:${s.user_id}`,
    // Soft beat · no action (deck §F ACTION).
    data: {
      deeplink: 'faff://today',
      streak_days: s.streak_days,
    },
  };
}

export interface RaceCountdownSlots {
  user_id: string;
  race_id: string;
  race_slug: string;
  race_name: string;
  weeks_to_race: number;       // 12 | 10 | 8 | 6 | 4 | 2
  phase_next?: string | null;  // 'peak block' | 'taper' | etc.
}

export function renderRaceCountdown(s: RaceCountdownSlots): RenderedTemplate {
  const phaseLine = s.phase_next
    ? ` ${s.phase_next} starts Sunday.`
    : '';
  return {
    category: 'streak',  // shares the F bucket; the deck calls it "milestone family"
    title: `${s.weeks_to_race} WEEKS · ${s.race_name.toUpperCase()}`,
    body: `${s.weeks_to_race} weeks to ${s.race_name}.${phaseLine}`,
    interruption_level: 'passive',
    dedup_key: `milestone:race-countdown:${s.race_id}:${s.weeks_to_race}`,
    thread_id: `race-${s.race_id}`,
    data: {
      deeplink: `faff://races/${s.race_slug}`,
      race_id: s.race_id,
      weeks_to_race: s.weeks_to_race,
    },
  };
}

// ──────────────────────────────────────────────────────────────
// G · STRAVA RECONNECT (deck §G)
// ──────────────────────────────────────────────────────────────

export interface StravaReconnectSlots {
  user_id: string;
  date_iso: string;
}

export function renderStravaReconnect(s: StravaReconnectSlots): RenderedTemplate {
  return {
    category: 'strava_reconnect',
    title: 'STRAVA STOPPED SYNCING',
    body: 'Token expired. 1 tap to fix.',
    interruption_level: 'active',
    dedup_key: `strava-reconnect:${s.user_id}:${s.date_iso}`,
    action_buttons: [
      // Per deck §G HIG NOTE — reconnect deep-link requires unlock (OAuth).
      { identifier: 'RECONNECT', title: 'RECONNECT', authentication_required: true },
    ],
    data: {
      deeplink: 'faff://settings/integrations/strava/reconnect',
    },
  };
}
