/**
 * Tests for the 2026-07-06 notification-stack wire fixes (audit
 * P1-15 / P1-23 / P1-24 / P1-25 · treadmill-strength-notif finder).
 *
 * Contract under test:
 *   1. buildApnsBody (apns.ts) — dedup_key + notification_id land in the
 *      faff dict; apns_category_id overrides the bucket mapping; a
 *      template's free-form data can never shadow the routing keys.
 *   2. Templates — every template carries a dedup_key; the sick check
 *      renders RECOVERED and emits FAFF_SICK; the niggle check stays on
 *      the FAFF_NIGGLE bucket mapping.
 *   3. trainingWeekWindow (week-window.ts) — the training week ENDS on
 *      long_run_day (one SoT with /api/plan/week, locked 2026-06-16),
 *      not ISO Monday.
 *   4. Prefs wire tolerance (prefs.ts) — the iPhone's 7-key dialect
 *      translates to canonical keys and round-trips through the alias
 *      view. Canonical is the server shape; the alias layer dies when
 *      Wave 2 native adopts it.
 */

import { describe, it, expect } from 'vitest';
import { buildApnsBody, apnsCategoryId, type SendPushArgs } from './apns';
import {
  renderRaceDay,
  renderRaceEve,
  renderSleepBanking,
  renderSkipRecovery,
  renderWeeklyCheckin,
  renderNiggleCheck,
  renderSickCheck,
  renderStreakMilestone,
  renderRaceCountdown,
  renderStravaReconnect,
} from './templates';
import { trainingWeekWindow } from './week-window';
import {
  DEFAULT_PREFS,
  translatePhonePrefKeys,
  phoneAliasView,
  PHONE_PREF_ALIASES,
  type NotificationPrefs,
} from './prefs';

// ──────────────────────────────────────────────────────────────
// 1. buildApnsBody — faff routing keys (P1-25)
// ──────────────────────────────────────────────────────────────

const baseArgs: SendPushArgs = {
  device_token: 'tok',
  category: 'niggle_sick',
  title: 'SICK · 3 DAYS',
  body: 'How is it this morning?',
  action_buttons: [{ identifier: 'RECOVERED', title: 'RECOVERED' }],
};

describe('buildApnsBody', () => {
  it('includes dedup_key and notification_id in the faff dict', () => {
    const { faff } = buildApnsBody({
      ...baseArgs,
      dedup_key: 'sick-check:42:2026-07-06',
      notification_id: 917,
      data: { deeplink: 'faff://today', episode_id: 42 },
    });
    expect(faff.dedup_key).toBe('sick-check:42:2026-07-06');
    expect(faff.notification_id).toBe(917);
    expect(faff.kind).toBe('niggle_sick');
    expect(faff.deeplink).toBe('faff://today');
  });

  it('omits routing keys when the dispatcher did not set them (pre-fix pending rows)', () => {
    const { faff } = buildApnsBody({ ...baseArgs, data: { deeplink: 'faff://today' } });
    expect('dedup_key' in faff).toBe(false);
    expect('notification_id' in faff).toBe(false);
  });

  it('data spread cannot shadow dedup_key or notification_id', () => {
    const { faff } = buildApnsBody({
      ...baseArgs,
      dedup_key: 'sick-check:42:2026-07-06',
      notification_id: 5,
      data: { dedup_key: 'spoofed', notification_id: -1 },
    });
    expect(faff.dedup_key).toBe('sick-check:42:2026-07-06');
    expect(faff.notification_id).toBe(5);
  });

  it('apns_category_id overrides the bucket mapping; absent → bucket id', () => {
    const withOverride = buildApnsBody({ ...baseArgs, apns_category_id: 'FAFF_SICK' });
    expect(withOverride.aps.category).toBe('FAFF_SICK');
    const without = buildApnsBody(baseArgs);
    expect(without.aps.category).toBe(apnsCategoryId('niggle_sick')); // FAFF_NIGGLE
  });

  it('sets no aps.category when there are no action buttons', () => {
    const { aps } = buildApnsBody({ ...baseArgs, action_buttons: [] });
    expect('category' in aps).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// 2. Templates — dedup_key everywhere + FAFF_SICK split (P1-25)
// ──────────────────────────────────────────────────────────────

describe('templates', () => {
  const all = [
    renderRaceDay({ race_id: 'r', race_name: 'AFC', race_slug: 'afc', gun_time_local: '7:00', distance: '13.1' }),
    renderRaceEve({ race_id: 'r', race_slug: 'afc', shakeout_done: true }),
    renderSleepBanking({ race_id: 'r', race_slug: 'afc', race_name: 'AFC', days_to_race: 3, tonight_iso: '2026-08-13' }),
    renderSkipRecovery({ user_id: 'u', date_iso: '2026-07-06', planned_today_verb: 'easy', planned_today_distance: '5.0mi' }),
    renderWeeklyCheckin({ user_id: 'u', week_start_iso: '2026-06-29', actual_mi: 40, planned_mi: 43, days_run: 6, days_total: 7 }),
    renderNiggleCheck({ user_id: 'u', niggle_id: 7, date_iso: '2026-07-06', body_part: 'calf', days_active: 2 }),
    renderSickCheck({ user_id: 'u', episode_id: 9, date_iso: '2026-07-06', days_active: 3 }),
    renderStreakMilestone({ user_id: 'u', streak_days: 30, is_longest_ever: false }),
    renderRaceCountdown({ user_id: 'u', race_id: 'r', race_slug: 'afc', race_name: 'AFC', weeks_to_race: 6 }),
    renderStravaReconnect({ user_id: 'u', date_iso: '2026-07-06' }),
  ];

  it('every template carries a non-empty dedup_key', () => {
    for (const tpl of all) {
      expect(tpl.dedup_key, tpl.title).toBeTruthy();
      expect(typeof tpl.dedup_key).toBe('string');
    }
  });

  it('sick check renders RECOVERED and emits FAFF_SICK', () => {
    const sick = renderSickCheck({ user_id: 'u', episode_id: 9, date_iso: '2026-07-06', days_active: 3 });
    const ids = (sick.action_buttons ?? []).map((b) => b.identifier);
    expect(ids).toContain('RECOVERED');
    expect(ids).not.toContain('GONE'); // GONE is the niggle resolution, misroutes for sick
    expect(sick.apns_category_id).toBe('FAFF_SICK');
    expect(sick.dedup_key.startsWith('sick-check:')).toBe(true); // ack route prefix contract
  });

  it('niggle check stays on the bucket mapping (FAFF_NIGGLE) with GONE', () => {
    const nig = renderNiggleCheck({ user_id: 'u', niggle_id: 7, date_iso: '2026-07-06', body_part: 'calf', days_active: 2 });
    expect(nig.apns_category_id).toBeUndefined();
    const ids = (nig.action_buttons ?? []).map((b) => b.identifier);
    expect(ids).toContain('GONE');
    expect(ids).not.toContain('RECOVERED');
    expect(nig.dedup_key.startsWith('niggle-check:')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────
// 3. trainingWeekWindow — long-run-day boundary (P1-24 / week P2)
// ──────────────────────────────────────────────────────────────

describe('trainingWeekWindow', () => {
  it('Sunday-long runner (David): week is Mon–Sun, check-in day window ends today', () => {
    // 2026-07-05 is a Sunday · long_run_day=sun (dow 0)
    const w = trainingWeekWindow('2026-07-05', 0, 0);
    expect(w.week_start_iso).toBe('2026-06-29'); // Monday
    expect(w.week_end_iso).toBe('2026-07-05');   // the long-run Sunday itself
  });

  it('Saturday-long runner: week is Sun–Sat, NOT ISO Monday-anchored', () => {
    // 2026-07-04 is a Saturday · long_run_day=sat (dow 6)
    const w = trainingWeekWindow('2026-07-04', 6, 6);
    expect(w.week_start_iso).toBe('2026-06-28'); // Sunday
    expect(w.week_end_iso).toBe('2026-07-04');   // the long-run Saturday
  });

  it('mid-week date maps into the containing week', () => {
    // Wednesday 2026-07-01 (dow 3) for a Sunday-long runner → Mon Jun 29 – Sun Jul 5
    const w = trainingWeekWindow('2026-07-01', 3, 0);
    expect(w.week_start_iso).toBe('2026-06-29');
    expect(w.week_end_iso).toBe('2026-07-05');
  });

  it('week start lands on the day AFTER the long run for every long-run day', () => {
    for (let longRunDow = 0; longRunDow < 7; longRunDow++) {
      // evaluate ON the long-run day (dow === longRunDow), any fixed date
      // with a known dow: 2026-07-06 is a Monday (dow 1). Shift the date
      // so its dow matches longRunDow.
      const base = Date.parse('2026-07-06T12:00:00Z'); // Monday
      const shift = (longRunDow - 1 + 7) % 7;
      const dateISO = new Date(base + shift * 86400000).toISOString().slice(0, 10);
      const w = trainingWeekWindow(dateISO, longRunDow, longRunDow);
      expect(w.week_end_iso).toBe(dateISO); // fires on long-run day → window ends today
      const span = (Date.parse(w.week_end_iso) - Date.parse(w.week_start_iso)) / 86400000;
      expect(span).toBe(6); // 7 inclusive days
    }
  });
});

// ──────────────────────────────────────────────────────────────
// 4. Prefs wire tolerance (P1-15)
// ──────────────────────────────────────────────────────────────

describe('prefs wire tolerance', () => {
  const phoneBody = {
    readiness_enabled: false,
    workout_reminder_enabled: false,
    recap_enabled: true,
    race_countdown_enabled: false,
    streak_enabled: true,
    adaptation_enabled: false,
    reconnect_enabled: true,
  };

  it('translates the full iPhone PATCH body without leaving unknown keys', () => {
    const t = translatePhonePrefKeys({ ...phoneBody });
    expect(t.niggle_sick_enabled).toBe(false);      // readiness
    expect(t.skip_recovery_enabled).toBe(false);    // workout_reminder
    expect(t.weekly_checkin_enabled).toBe(true);    // recap
    expect(t.race_eve_enabled).toBe(false);         // race_countdown
    expect(t.strava_reconnect_enabled).toBe(true);  // reconnect
    expect(t.streak_enabled).toBe(true);            // shared key
    expect(t.adaptation_enabled).toBe(false);       // passthrough
    // no phone alias key survives translation
    for (const phoneKey of Object.keys(PHONE_PREF_ALIASES)) {
      expect(phoneKey in t, phoneKey).toBe(false);
    }
  });

  it('never maps a phone key onto race_day_enabled (deck §SETTINGS · RACE-DAY LOCK)', () => {
    const t = translatePhonePrefKeys({ ...phoneBody });
    expect('race_day_enabled' in t).toBe(false);
    expect(Object.values(PHONE_PREF_ALIASES)).not.toContain('race_day_enabled');
  });

  it('explicit canonical key wins over its phone alias in the same body', () => {
    const t = translatePhonePrefKeys({ readiness_enabled: false, niggle_sick_enabled: true });
    expect(t.niggle_sick_enabled).toBe(true);
  });

  it('canonical-shaped bodies pass through untouched', () => {
    const body = { master_enabled: false, quiet_hours_start: '23:00' };
    expect(translatePhonePrefKeys(body)).toEqual(body);
  });

  it('phoneAliasView derives the phone shape from canonical prefs (GET emits both)', () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_PREFS,
      niggle_sick_enabled: false,
      skip_recovery_enabled: false,
      race_eve_enabled: false,
    };
    const view = phoneAliasView(prefs, { adaptation_enabled: false });
    expect(view.readiness_enabled).toBe(false);
    expect(view.workout_reminder_enabled).toBe(false);
    expect(view.race_countdown_enabled).toBe(false);
    expect(view.recap_enabled).toBe(true);
    expect(view.reconnect_enabled).toBe(true);
    expect(view.adaptation_enabled).toBe(false);
  });

  it('phone PATCH → canonical → alias view round-trips every toggle', () => {
    const t = translatePhonePrefKeys({ ...phoneBody });
    const prefs = { ...DEFAULT_PREFS, ...t } as NotificationPrefs;
    const view = phoneAliasView(prefs, t);
    for (const [k, v] of Object.entries(phoneBody)) {
      if (k === 'streak_enabled') { expect(prefs.streak_enabled).toBe(v); continue; }
      expect(view[k], k).toBe(v);
    }
  });
});
