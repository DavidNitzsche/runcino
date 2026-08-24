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
 *      view; dualShapePrefsBody carries every phone struct key so the
 *      routes' TOP-LEVEL spread satisfies the phone's whole-body
 *      tolerant decode (adversarial review 2026-07-06 issue 1) and a
 *      full-struct phone PATCH can't clobber web-side disables.
 *      Canonical is the server shape; the alias layer dies when Wave 2
 *      native adopts it.
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
  renderRunUnread,
  type RenderedTemplate,
} from './templates';
import { trainingWeekWindow } from './week-window';
import {
  DEFAULT_PREFS,
  categoryEnabled,
  translatePhonePrefKeys,
  phoneAliasView,
  dualShapePrefsBody,
  PHONE_PREF_ALIASES,
  PHONE_PASSTHROUGH_KEYS,
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

  it('sets aps.category even with no action buttons', () => {
    // 2026-08-21 · this assertion used to be its own inverse. The category
    // is what names the BOARD, not what draws the buttons, so gating it on
    // action_buttons meant every deliberately actionless notification
    // ("Session moved", "Race tomorrow") could never reach the custom
    // long-look the design draws for it.
    const { aps } = buildApnsBody({ ...baseArgs, action_buttons: [] });
    expect(aps.category).toBe(apnsCategoryId('niggle_sick'));
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
    expect(t.strava_reconnect_enabled).toBe(true);  // reconnect
    expect(t.streak_enabled).toBe(true);            // shared key
    expect(t.adaptation_enabled).toBe(false);       // passthrough
    // 2026-08-21 · race_countdown_enabled is now a CANONICAL key (it gates
    // the Sunday countdown push in its own right), not an alias onto
    // race_eve_enabled. It passes through untouched, and translation must
    // NOT write race_eve_enabled off the back of it — that is what would
    // silently flip the race-eve toggle.
    expect(t.race_countdown_enabled).toBe(false);
    expect('race_eve_enabled' in t).toBe(false);
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
    expect(view.recap_enabled).toBe(true);
    expect(view.reconnect_enabled).toBe(true);
    expect(view.adaptation_enabled).toBe(false);
    // race_countdown_enabled is canonical now, so the alias view must not
    // derive it. dualShapePrefsBody spreads this view AFTER the canonical
    // prefs; a derived key here would overwrite the runner's real setting
    // with race_eve's on the way back out.
    expect('race_countdown_enabled' in view).toBe(false);
  });

  it('phone PATCH → canonical → alias view round-trips every toggle', () => {
    const t = translatePhonePrefKeys({ ...phoneBody });
    const prefs = { ...DEFAULT_PREFS, ...t } as NotificationPrefs;
    const view = phoneAliasView(prefs, t);
    for (const [k, v] of Object.entries(phoneBody)) {
      // Canonical keys land on prefs directly; only true aliases round-trip
      // through the derived view.
      if (k === 'streak_enabled') { expect(prefs.streak_enabled).toBe(v); continue; }
      if (k === 'race_countdown_enabled') { expect(prefs.race_countdown_enabled).toBe(v); continue; }
      expect(view[k], k).toBe(v);
    }
  });

  // ── dualShapePrefsBody · adversarial review 2026-07-06 issue 1 ──
  // The phone decodes the WHOLE GET/PATCH response body with a per-key
  // tolerant init (missing key → true), so the alias keys must exist at
  // the TOP LEVEL of the response, not only nested under `prefs`. The
  // routes emit { ...dualShapePrefsBody(...), prefs: dualShapePrefsBody(...) };
  // these tests pin the contract that makes the top-level spread correct.

  it('dualShapePrefsBody carries EVERY phone key the tolerant Swift init decodes', () => {
    const prefs: NotificationPrefs = {
      ...DEFAULT_PREFS,
      niggle_sick_enabled: false,
      weekly_checkin_enabled: false,
    };
    const dual = dualShapePrefsBody(prefs, { adaptation_enabled: false });
    // All 7 iPhone struct keys present — a missing key decodes as TRUE on
    // the phone (G_Settings.swift init(from:)) and then a full-struct
    // PATCH writes that stale true back, clobbering web-side disables.
    const phoneStructKeys = [
      ...Object.keys(PHONE_PREF_ALIASES),
      ...PHONE_PASSTHROUGH_KEYS,
      'streak_enabled',
    ];
    for (const k of phoneStructKeys) {
      expect(k in dual, k).toBe(true);
      expect(typeof dual[k], k).toBe('boolean');
    }
    // and the disabled categories read false through their aliases
    expect(dual.readiness_enabled).toBe(false); // niggle_sick
    expect(dual.recap_enabled).toBe(false);     // weekly_checkin
    expect(dual.adaptation_enabled).toBe(false);
    // canonical keys ride along untouched for web/Wave-2 native
    expect(dual.niggle_sick_enabled).toBe(false);
    expect(dual.master_enabled).toBe(true);
    expect(dual.quiet_hours_start).toBe(DEFAULT_PREFS.quiet_hours_start);
  });

  it('web-disabled → GET dual body → full-struct phone PATCH does NOT re-enable (clobber path closed)', () => {
    // 1. David disables the weekly check-in on web (canonical write).
    const stored: NotificationPrefs = { ...DEFAULT_PREFS, weekly_checkin_enabled: false };
    // 2. Phone GETs; its tolerant decode reads the TOP-LEVEL keys of the
    //    dual body — simulate by picking exactly the 7 struct keys with
    //    the phone's missing-key→true default.
    const dual = dualShapePrefsBody(stored, stored as unknown as Record<string, unknown>);
    const phoneStruct: Record<string, boolean> = {};
    for (const k of [...Object.keys(PHONE_PREF_ALIASES), ...PHONE_PASSTHROUGH_KEYS, 'streak_enabled']) {
      phoneStruct[k] = typeof dual[k] === 'boolean' ? (dual[k] as boolean) : true;
    }
    expect(phoneStruct.recap_enabled).toBe(false); // the phone SEES the disable
    // 3. Phone toggles readiness off and PATCHes the FULL struct back.
    phoneStruct.readiness_enabled = false;
    const t = translatePhonePrefKeys(phoneStruct);
    const after = { ...stored, ...t } as NotificationPrefs;
    // weekly check-in stays OFF — pre-fix the phone displayed all-true
    // and this PATCH silently flipped it back on.
    expect(after.weekly_checkin_enabled).toBe(false);
    expect(after.niggle_sick_enabled).toBe(false);
  });

  it('dual body has no `prefs`/`ok` key of its own, so response envelope keys cannot be shadowed', () => {
    const dual = dualShapePrefsBody(DEFAULT_PREFS, {});
    expect('prefs' in dual).toBe(false);
    expect('ok' in dual).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// 5. Coach voice + category gating · 2026-08-21 watch/push audit
//
// Every one of these pins something that was WRONG in prod before this
// audit, not a behaviour we merely hope holds.
// ──────────────────────────────────────────────────────────────

describe('coach voice', () => {
  // Same corpus as the `templates` describe above, plus the variants a real
  // runner can actually hit (no plan row, rest day, a phase-carrying
  // countdown) — the old fixtures only ever rendered the happy path, which
  // is why a hardcoded "easy 5.0mi" survived so long.
  const corpus: RenderedTemplate[] = [
    renderRaceDay({ race_id: 'r', race_name: 'AFC', race_slug: 'afc', gun_time_local: '7:00', uber_pickup_local: '6:25', distance: '13.1' }),
    renderRaceEve({ race_id: 'r', race_slug: 'afc', shakeout_done: false }),
    renderSleepBanking({ race_id: 'r', race_slug: 'afc', race_name: 'AFC', days_to_race: 2, tonight_iso: '2026-08-13' }),
    renderSkipRecovery({ user_id: 'u', date_iso: '2026-07-06', planned_today_verb: 'intervals', planned_today_distance: '6.1mi' }),
    renderSkipRecovery({ user_id: 'u', date_iso: '2026-07-06', planned_today_verb: 'rest', planned_today_distance: null }),
    renderSkipRecovery({ user_id: 'u', date_iso: '2026-07-06', planned_today_verb: null, planned_today_distance: null }),
    renderWeeklyCheckin({ user_id: 'u', week_start_iso: '2026-06-29', actual_mi: 19.7, planned_mi: 43.8, days_run: 4, days_total: 4 }),
    renderWeeklyCheckin({ user_id: 'u', week_start_iso: '2026-06-29', actual_mi: 19.7, planned_mi: 0, days_run: 3, days_total: 7 }),
    renderNiggleCheck({ user_id: 'u', niggle_id: 7, date_iso: '2026-07-06', body_part: 'calf', days_active: 1 }),
    renderSickCheck({ user_id: 'u', episode_id: 9, date_iso: '2026-07-06', days_active: 1 }),
    renderRaceCountdown({ user_id: 'u', race_id: 'r', race_slug: 'afc', race_name: 'AFC', weeks_to_race: 6, phase_next: 'peak block' }),
    renderStravaReconnect({ user_id: 'u', date_iso: '2026-07-06' }),
  ];

  it('no template shouts, jokes in emoji, or uses an em dash', () => {
    // CLAUDE.md "Coach voice": short, direct, no hype, no exclamation marks,
    // no emoji, no em dashes.
    const emoji = /\p{Extended_Pictographic}/u;
    for (const tpl of corpus) {
      const text = `${tpl.title} ${tpl.body}`;
      expect(text, tpl.title).not.toContain('!');
      expect(text, tpl.title).not.toContain('—'); // em dash
      expect(emoji.test(text), tpl.title).toBe(false);
    }
  });

  it('every rendered sentence starts with a capital', () => {
    // renderRaceCountdown dropped races.meta->>'phase_next' (lowercase in the
    // DB) straight after a full stop: "…6 weeks to AFC. peak block starts
    // Sunday."
    for (const tpl of corpus) {
      for (const sentence of tpl.body.split(/(?<=\.)\s+/)) {
        const first = sentence.trim().charAt(0);
        if (!first || !/\p{L}/u.test(first)) continue; // digits/symbols open fine
        expect(first, `${tpl.title} :: ${sentence}`).toBe(first.toUpperCase());
      }
    }
  });

  it('the skip nudge never opens by naming the miss', () => {
    // Was title 'YESTERDAY · SKIPPED' — the runner's miss in caps on the lock
    // screen, ahead of anything useful. Never scold.
    for (const tpl of corpus.filter((t) => t.category === 'skip_recovery')) {
      expect(tpl.title.startsWith('TODAY')).toBe(true);
    }
  });
});

describe('skip recovery invents nothing about today', () => {
  it('a missing plan row renders no prescription', () => {
    // The caller used to fall back to a hardcoded easy / 5.0mi, so this push
    // told every runner their day was an easy five whatever it actually was.
    const tpl = renderSkipRecovery({
      user_id: 'u', date_iso: '2026-07-06',
      planned_today_verb: null, planned_today_distance: null,
    });
    expect(tpl.title).toBe('TODAY');
    expect(tpl.body).not.toMatch(/mi\b/);
    expect(tpl.body).not.toMatch(/easy/i);
  });

  it('a rest day says rest, and asks for nothing', () => {
    const tpl = renderSkipRecovery({
      user_id: 'u', date_iso: '2026-07-06',
      planned_today_verb: 'rest', planned_today_distance: null,
    });
    expect(tpl.title).toBe('TODAY · REST');
    expect(tpl.body).toContain('Nothing to run today.');
  });

  it('a real plan row is named exactly', () => {
    const tpl = renderSkipRecovery({
      user_id: 'u', date_iso: '2026-07-06',
      planned_today_verb: 'intervals', planned_today_distance: '6.1mi',
    });
    expect(tpl.title).toBe('TODAY · INTERVALS 6.1MI');
  });
});

describe('weekly check-in counts against the plan, not the calendar', () => {
  it('a complete four-day week reads 4 of 4', () => {
    // Was a hardcoded days_total of 7: a four-day runner who ran all four was
    // shown "4 of 7 days" — a clean week rendered as three misses.
    const tpl = renderWeeklyCheckin({
      user_id: 'u', week_start_iso: '2026-06-29',
      actual_mi: 31.2, planned_mi: 31.0, days_run: 4, days_total: 4,
    });
    expect(tpl.body.startsWith('4 of 4 days.')).toBe(true);
  });

  it('drops the pair when no plan governed the week', () => {
    const tpl = renderWeeklyCheckin({
      user_id: 'u', week_start_iso: '2026-06-29',
      actual_mi: 19.7, planned_mi: 0, days_run: 3, days_total: 7,
    });
    expect(tpl.title).toBe('WEEK DONE · 19.7 MI');
    expect(tpl.title).not.toContain('0.0');
  });
});

describe('category gating', () => {
  it('race countdown has its own category and its own switch', () => {
    // It rode the 'streak' bucket, so the only switch a runner could see was
    // labelled "Streak milestones" — a category whose sole call site has been
    // commented out since 2026-06-03.
    const tpl = renderRaceCountdown({
      user_id: 'u', race_id: 'r', race_slug: 'afc', race_name: 'AFC', weeks_to_race: 6,
    });
    expect(tpl.category).toBe('race_countdown');
    // Keeps the registered, action-less iOS category so no device changes.
    expect(tpl.apns_category_id).toBe('FAFF_MILESTONE');
    expect(apnsCategoryId('race_countdown')).toBe('FAFF_MILESTONE');

    const off = { ...DEFAULT_PREFS, race_countdown_enabled: false };
    expect(categoryEnabled(off, 'race_countdown')).toBe(false);
    // Turning the countdown off must not take streak (or anything else) with it.
    expect(categoryEnabled(off, 'streak')).toBe(true);

    const streakOff = { ...DEFAULT_PREFS, streak_enabled: false };
    expect(categoryEnabled(streakOff, 'race_countdown')).toBe(true);
  });

  it('every category a template can emit is gateable, and the master kills all', () => {
    const cats = new Set(
      [
        renderRaceDay({ race_id: 'r', race_name: 'AFC', race_slug: 'afc', gun_time_local: '7:00', distance: '13.1' }),
        renderRaceEve({ race_id: 'r', race_slug: 'afc', shakeout_done: true }),
        renderSleepBanking({ race_id: 'r', race_slug: 'afc', race_name: 'AFC', days_to_race: 3, tonight_iso: '2026-08-13' }),
        renderSkipRecovery({ user_id: 'u', date_iso: '2026-07-06', planned_today_verb: 'easy', planned_today_distance: '5.0mi' }),
        renderWeeklyCheckin({ user_id: 'u', week_start_iso: '2026-06-29', actual_mi: 40, planned_mi: 43, days_run: 6, days_total: 6 }),
        renderNiggleCheck({ user_id: 'u', niggle_id: 7, date_iso: '2026-07-06', body_part: 'calf', days_active: 2 }),
        renderSickCheck({ user_id: 'u', episode_id: 9, date_iso: '2026-07-06', days_active: 3 }),
        renderStreakMilestone({ user_id: 'u', streak_days: 30, is_longest_ever: false }),
        renderRaceCountdown({ user_id: 'u', race_id: 'r', race_slug: 'afc', race_name: 'AFC', weeks_to_race: 6 }),
        renderStravaReconnect({ user_id: 'u', date_iso: '2026-07-06' }),
        renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long', distance_mi: 14 }),
      ].map((t) => t.category),
    );
    for (const c of cats) {
      // A category nothing can switch off is a category the runner cannot
      // decline. Flipping its own flag must silence it.
      const key = `${c}_enabled` as keyof typeof DEFAULT_PREFS;
      expect(key in DEFAULT_PREFS, c).toBe(true);
      expect(categoryEnabled({ ...DEFAULT_PREFS, [key]: false }, c), c).toBe(false);
      expect(categoryEnabled({ ...DEFAULT_PREFS, master_enabled: false }, c), c).toBe(false);
    }
  });
});

describe('race day states only what is known', () => {
  it('omits the gun time and the distance when the race row has neither', () => {
    // Not one of the 16 race rows in prod carries meta.gun_time or
    // meta.start_time, and the caller defaulted to '07:00' / '13.1' — so the
    // loudest push in the product would have told a marathoner their race
    // went off at 7:00 over 13.1 miles.
    const tpl = renderRaceDay({
      race_id: 'r', race_slug: 'cim', race_name: 'CIM',
      gun_time_local: null, distance: null,
    });
    expect(tpl.body).toBe('Kit on the chair.');
    expect(tpl.body).not.toContain('7:00');
    expect(tpl.body).not.toContain('13.1');
  });

  it('states everything it does know', () => {
    const tpl = renderRaceDay({
      race_id: 'r', race_slug: 'cim', race_name: 'CIM',
      gun_time_local: '7:00', uber_pickup_local: '6:25', distance: '26.2',
    });
    expect(tpl.body).toBe('Gun 7:00. Uber pickup 6:25. Kit on the chair · 26.2 ahead.');
    // Race day is the one push allowed to wake the runner.
    expect(tpl.bypass_quiet_hours).toBe(true);
    expect(tpl.interruption_level).toBe('time-sensitive');
  });
});

// ──────────────────────────────────────────────────────────────
// 0821 watch handoff § 9 · B8 · "yesterday is unread"
// ──────────────────────────────────────────────────────────────

describe('yesterday is unread · one target, one firing', () => {
  it('keys the dedup on the RUN, not on the day it fired', () => {
    // This is what makes "fires once" mean once. A key carrying today's
    // date would roll over every midnight, and the design's whole
    // instruction about this notification is that a second one is a nag.
    const a = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long', distance_mi: 14 });
    const b = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'quality', distance_mi: 8 });
    expect(a.dedup_key).toBe('run-unread:u:2026-08-20');
    expect(b.dedup_key).toBe(a.dedup_key);
  });

  it('offers exactly one action, and it opens rather than answers', () => {
    const t = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long', distance_mi: 14 });
    expect(t.action_buttons).toHaveLength(1);
    expect(t.action_buttons![0].identifier).toBe('OPEN_ON_IPHONE');
    expect(t.action_buttons![0].title).toBe('Open on iPhone');
    expect(t.action_buttons![0].destructive).toBeUndefined();
    // Judging a run is a screen. An action that answered here would be
    // asking the runner to grade a session from a lock screen.
    expect(t.data.deeplink).toBe('faff://today');
  });

  it('carries its own iOS category, and buildApnsBody emits it', () => {
    const t = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long', distance_mi: 14 });
    expect(t.apns_category_id).toBe(apnsCategoryId('run_unread'));
    const body = buildApnsBody({
      device_token: 'tok', category: t.category, title: t.title, body: t.body,
      action_buttons: t.action_buttons, apns_category_id: t.apns_category_id,
      data: t.data, dedup_key: t.dedup_key,
    } as SendPushArgs);
    expect(body.aps.category).toBe('FAFF_RUN_UNREAD');
  });

  it('ships the design\'s own kicker, lede and consequence', () => {
    const long = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long', distance_mi: 14 });
    const quality = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'quality', distance_mi: 8.4 });
    expect(long.data.kicker_text).toBe('14 mi · still unread');
    expect(quality.data.kicker_text).toBe('8.4 mi · still unread');
    expect(long.title).toBe('The long run is in but not judged');
    expect(quality.title).toBe('The session is in but not judged');
    for (const t of [long, quality]) {
      expect(t.body).toBe("This week's shape waits on it.");
      expect(t.body).not.toMatch(/!/);
      expect(t.body).not.toMatch(/[\u2014\u2013]/);   // no em or en dash
      expect(t.interruption_level).toBe('active');
      expect(t.bypass_quiet_hours).toBeFalsy();       // nothing here is worth a wake-up
      // The kicker is TEXT. A colour token here is how a board draws the
      // word "AMBER" in amber.
      expect('kicker' in t.data).toBe(false);
    }
  });

  it('drops the dose from the kicker rather than guessing it', () => {
    const t = renderRunUnread({ user_id: 'u', run_date_iso: '2026-08-20', category: 'long' });
    expect(t.data.kicker_text).toBe('Still unread');
  });
});
