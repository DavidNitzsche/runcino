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
  /** races.meta gun_time / start_time. NULL is the common case — as of
   *  2026-08-21 not one of the 16 race rows in prod carries either key.
   *  The caller used to paper over that with `?? '07:00'` and the distance
   *  with `?? '13.1'`, so the loudest, most trusted push in the product
   *  would have told a marathoner their race went off at 7:00 over 13.1
   *  miles. A push that wakes someone on race morning states only what is
   *  known. */
  gun_time_local?: string | null;   // '7:00'
  uber_pickup_local?: string | null; // '6:25'
  distance?: string | null;          // '13.1' (half) or '26.2'
}

export function renderRaceDay(s: RaceDaySlots): RenderedTemplate {
  const parts: string[] = [];
  if (s.gun_time_local) parts.push(`Gun ${s.gun_time_local}.`);
  if (s.uber_pickup_local) parts.push(`Uber pickup ${s.uber_pickup_local}.`);
  parts.push(s.distance ? `Kit on the chair · ${s.distance} ahead.` : 'Kit on the chair.');
  const body = parts.join(' ');
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
    // "That's fine" was absolution nobody asked for, on the lock screen the
    // night before a race. A miss is STATED, never judged — and grading it
    // favourably is still grading it.
    : 'Shake-out skipped.';
  return {
    category: 'race_eve',
    title: 'RACE TOMORROW',
    body: `${opener} Early to bed. Kit prepped?`,
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
  /** 'easy' | 'long' | 'tempo' | 'intervals' | 'progression' … , 'rest' when
   *  the plan holds a rest day, or NULL when the lookup found nothing.
   *  2026-08-21 · watch/push audit · this used to be a bare string with a
   *  hardcoded 'easy' / '5.0mi' fallback baked into the caller, so a failed
   *  or empty plan lookup told the runner their day was an easy 5 miles
   *  whatever it actually was. A fabricated prescription is worse than a
   *  quieter message: null now renders a line that claims nothing. */
  planned_today_verb: string | null;
  planned_today_distance: string | null; // '6.1mi'
}

export function renderSkipRecovery(s: SkipRecoverySlots): RenderedTemplate {
  const isRest = s.planned_today_verb === 'rest';
  const hasPlan = s.planned_today_verb != null && !isRest;
  // The title leads with TODAY, not with the skip. 'YESTERDAY · SKIPPED' put
  // the runner's miss in caps on the lock screen before offering anything —
  // a verdict, not a coach. The skip stays in the body as the plain fact it
  // is, and the question does the work.
  const title = hasPlan
    ? `TODAY · ${String(s.planned_today_verb).toUpperCase()}${s.planned_today_distance ? ` ${s.planned_today_distance.toUpperCase()}` : ''}`
    : isRest
      ? 'TODAY · REST'
      : 'TODAY';
  const middle = isRest ? ' Nothing to run today.' : '';
  return {
    category: 'skip_recovery',
    title,
    body: `You skipped yesterday.${middle} Still feeling it?`,
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
  /** Running days the PLAN held this week — not 7. 2026-08-21 · watch/push
   *  audit · the caller passed a literal 7, so a four-day-a-week runner who
   *  ran all four of their days was told "4 of 7 days": a clean week
   *  rendered as three misses. Falls back to 7 only when the week held no
   *  plan rows at all, where 7 is the honest denominator for "days". */
  days_total: number;
}

export function renderWeeklyCheckin(s: WeeklyCheckinSlots): RenderedTemplate {
  const actual = s.actual_mi.toFixed(1);
  const planned = s.planned_mi.toFixed(1);
  // A 0.0 denominator (no active plan for the week) is not a target the
  // runner missed — drop the pair rather than render "19.7 / 0.0 MI".
  const title = s.planned_mi > 0
    ? `WEEK DONE · ${actual} / ${planned} MI`
    : `WEEK DONE · ${actual} MI`;
  return {
    category: 'weekly_checkin',
    title,
    body: `${s.days_run} of ${s.days_total} days. How'd it feel?`,
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
    body: 'How is it this morning? Scale of better, same, worse, gone.',
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
    title: `SICK · ${s.days_active} ${dayUnit}`,
    body: 'How is it this morning? Scale of better, same, worse, recovered.',
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
    body: 'Consistency lands.',
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
  // races.meta->>'phase_next' arrives lowercase ('peak block', 'taper'), and
  // the old template dropped it straight after a full stop — "…to AFC. peak
  // block starts Sunday."
  const phase = s.phase_next?.trim();
  const phaseLine = phase
    ? ` ${phase.charAt(0).toUpperCase()}${phase.slice(1)} starts Sunday.`
    : '';
  return {
    // 2026-08-21 · watch/push audit · was 'streak'. It shared the F prefs
    // bucket with streak milestones, whose only call site has been commented
    // out since 2026-06-03 and whose settings row was deleted 2026-08-17 —
    // so the one switch a runner could see was labelled for the dead half
    // and silently governed this one. Its own category, its own gate.
    category: 'race_countdown',
    apns_category_id: 'FAFF_MILESTONE',
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
    // '1 tap to fix' was app voice with a digit opening the sentence.
    body: 'Your Strava token expired. Reconnect to resume syncing.',
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

// ──────────────────────────────────────────────────────────────
// H · YESTERDAY IS UNREAD (0821 watch handoff § 9 · B8)
// ──────────────────────────────────────────────────────────────
//
// "'Yesterday is unread' has one target and an amber kicker, and fires
// once — a second reminder would make it a nag."
//
// The run is IN. What is missing is the runner's own read of it: no RPE,
// no check-in chip, no morning rating. Until that lands, the adapter is
// working off pace and heart rate alone on a session where how it felt is
// the signal that matters, which is why the consequence clause is about
// the week rather than about the notification.
//
// One action, and it is an open, not an answer: judging a run is a screen,
// not a button. Everything the shell cannot route falls to Today (see
// ShellV5.route), which is where the unread run is surfaced, so the
// deeplink is the one that exists rather than one invented for this push.

/** Slots for the session-moved nudge.
 *
 *  The watch board, the `FAFF_SESSION_MOVED` category and the payload's own
 *  `sessionMoved` object all existed before this template did, so the change
 *  reached the lobby and never reached a lock screen. This is the missing
 *  half. */
export interface SessionMovedSlots {
  user_id: string;
  /** YYYY-MM-DD of the day that changed. Anchors the dedup key, so a plan
   *  adapted twice in one day notifies once. */
  date_iso: string;
  /** What the session became, in the plan's own words. "Easy 4 mi". */
  now_label: string;
  /** What it was. Null when the previous shape is unknown — the sentence
   *  then states the change without claiming what it replaced. */
  was_label?: string | null;
  /** Why, in the coach's register and already composed upstream.
   *  "Six hours of sleep". Null drops the clause rather than inventing one. */
  reason?: string | null;
}

/** Session moved · NO ACTION.
 *
 *  The design is explicit that an action appears "only when there genuinely
 *  is one", and there is none here: the session has already changed, the
 *  runner has nothing to approve, and a button would imply otherwise.
 *
 *  That property is exactly what used to stop this reaching a wrist —
 *  `buildApnsBody` set `aps.category` only when a template carried action
 *  buttons, so the one board defined by having none could never route to its
 *  custom long-look. Fixed 2026-08-21; this template depends on that fix.
 */
export function renderSessionMoved(s: SessionMovedSlots): RenderedTemplate {
  // Evidence, then the change. Never a grade: the plan moved, the runner did
  // not fail. Clauses drop rather than guess.
  const consequence = s.was_label
    ? `Today is ${s.now_label} \u00b7 it was ${s.was_label}.`
    : `Today is ${s.now_label}.`;
  return {
    category: 'session_moved',
    title: s.reason ? s.reason : 'Today changed overnight',
    body: consequence,
    // Not time-sensitive: the session has already changed and will still have
    // changed in an hour. An interruption here would be the app raising its
    // voice about its own bookkeeping.
    interruption_level: 'active',
    apns_category_id: 'FAFF_SESSION_MOVED',
    dedup_key: `session-moved:${s.user_id}:${s.date_iso}`,
    // No action_buttons, deliberately. See above.
    data: {
      deeplink: 'faff://today',
      date_iso: s.date_iso,
      kicker_text: 'Session moved',
    },
  };
}

export interface RunUnreadSlots {
  user_id: string;
  /** YYYY-MM-DD of the run · the dedup key's own once-only anchor. */
  run_date_iso: string;
  /** 'long' | 'quality' · what the plan asked for that day. Names the
   *  session in the lede; both read the same underneath. */
  category: 'long' | 'quality';
  /** Canonical miles run. The design's kicker states the dose before it
   *  states the state ("14 mi · still unread"), which is the same
   *  type-then-dose order the complications use. Null drops the clause
   *  rather than guessing it. */
  distance_mi?: number | null;
}

/** "14" · "6.5" · miles for a kicker, never trailing a dead decimal. */
function milesForKicker(mi: number): string {
  const r = Math.round(mi * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function renderRunUnread(s: RunUnreadSlots): RenderedTemplate {
  const mi = s.distance_mi != null && s.distance_mi > 0 ? milesForKicker(s.distance_mi) : null;
  return {
    category: 'run_unread',
    // 2026-08-21 · the design draws this board, so the design's own words
    // are what ship: kicker, lede, consequence, verbatim. It is also the
    // one deliberate break from the CAPS title convention in this file.
    // The deck's rule is "SCREAMING CAPS only on the title, and only when
    // data warrants it" — a nudge about an unjudged run does not warrant
    // it, and shouting at a runner about paperwork is how a switch gets
    // turned off.
    title: s.category === 'long'
      ? 'The long run is in but not judged'
      : 'The session is in but not judged',
    body: "This week's shape waits on it.",
    interruption_level: 'active',
    // FAFF_RUN_UNREAD is registered on the phone (NotificationCategories)
    // and on the watch's long-look. An unregistered id renders the alert
    // with no buttons — the body still opens the app and routes on
    // faff.deeplink, so this degrades to a plain tap rather than to
    // nothing.
    apns_category_id: 'FAFF_RUN_UNREAD',
    // Keyed on the RUN, not on the day this fired. The dispatcher's 24h
    // window is not what makes this fire once; the scheduler's all-time
    // check on this key is (see unreadRunYesterday in the cron).
    dedup_key: `run-unread:${s.user_id}:${s.run_date_iso}`,
    action_buttons: [
      // No authentication_required and no destructive flag: this opens a
      // screen. Whether it opens in the foreground is a UNNotificationAction
      // option declared on the device, not something the payload can say.
      { identifier: 'OPEN_ON_IPHONE', title: 'Open on iPhone' },
    ],
    data: {
      deeplink: 'faff://today',
      run_date_iso: s.run_date_iso,
      // The amber kicker, as TEXT. There is deliberately no colour token
      // beside it: the wrist does not need to be told which hue its own
      // kicker takes, and two fields one rename apart — one holding a
      // colour, one holding words — is how a board ends up drawing the
      // word "AMBER" in amber.
      kicker_text: mi ? `${mi} mi · still unread` : 'Still unread',
    },
  };
}
