/**
 * Regression · the session-moved template gets a sender, gated on a REAL change.
 *
 * THE DEFECT (2026-08-24). `renderSessionMoved` shipped on 2026-08-23 in
 * 718fec78 together with `session_moved_enabled`, the prefs field and the
 * `FAFF_SESSION_MOVED` APNs mapping, and NO CALLER. It was the only one of
 * twelve templates with zero senders, so the runner has had a default-ON
 * toggle in Settings that could never produce a notification.
 *
 * THE OWNER'S RULING. "Wire it to real adaptations. It fires when today's
 * session ACTUALLY changed overnight — gated on the label genuinely differing,
 * not on the adapter merely having run."
 *
 * The gate under test is therefore a pure before/after label diff, which is
 * why it lives in a pure function: no device, no APNs, no push. The first case
 * below is the one that proves the ruling — an adapter pass that ran and
 * touched rows, leaving the runner's day reading exactly as before, sends
 * nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  sessionLabel,
  sessionChangeKey,
  sessionGenuinelyChanged,
  type SessionSnapshot,
} from './session-moved';
import { renderSessionMoved } from './templates';
import { DEFAULT_PREFS, categoryEnabled } from './prefs';
import { apnsCategoryId } from './apns';

const snap = (
  type: string, distanceMi: number | null, subLabel: string | null = null, id = 'wko_1',
): SessionSnapshot => ({
  workoutId: id,
  type,
  subLabel,
  distanceMi,
  label: sessionLabel({ type, distanceMi })!,
  changeKey: sessionChangeKey({ type, subLabel, distanceMi })!,
});

describe('session moved · the template has a sender at all', () => {
  // THE ORIGINAL DEFECT, asserted structurally. Every other case in this file
  // passes against the pre-fix tree too, because they exercise a module that
  // did not exist there. THIS one is the regression: on 2026-08-23 the
  // template, the toggle, the prefs field and the APNs mapping all shipped and
  // `app/api/cron/run-adaptations/route.ts` had no session_moved branch, so a
  // default-ON switch in Settings drove nothing at all.
  const REPO = path.resolve(__dirname, '..', '..');
  const CRON = path.join(REPO, 'app', 'api', 'cron', 'run-adaptations', 'route.ts');

  it('the adaptation cron actually calls it', () => {
    const src = fs.readFileSync(CRON, 'utf8');
    expect(src).toContain('notifications/session-moved');
    expect(src).toContain('notifySessionMoved');
  });

  it('the gate is wired around the apply · a before AND an after snapshot', () => {
    const src = fs.readFileSync(CRON, 'utf8');
    const before = src.indexOf('snapshotSession');
    // AUTHORITY (2026-09-05) · matched on the CALL, not its full argument
    // list. This pinned `applyAdaptations(uid, applyNow)` exactly, so adding
    // the required `authority` parameter turned the marker into -1 and the
    // ordering assertion compared against a not-found. The intent is that one
    // snapshot sits either side of the mutation, and that intent survives a
    // signature change; the literal did not.
    const apply = src.indexOf('applyAdaptations(uid,');
    const after = src.lastIndexOf('snapshotSession');
    expect(before).toBeGreaterThan(-1);
    expect(after).toBeGreaterThan(before);
    // One snapshot each side of the mutation, or the diff proves nothing.
    expect(before).toBeLessThan(apply);
    expect(after).toBeGreaterThan(apply);
  });

  it('the Settings row no longer promises a readiness-driven change', () => {
    // readiness went propose-first on 2026-06-04 · it asks in a banner and
    // never moves a session behind the runner's back, so the shipped subtitle
    // "When readiness changed today's session overnight" described something
    // that cannot happen.
    const settings = fs.readFileSync(
      path.join(REPO, 'components', 'faff-app', 'toolkit', 'Settings.tsx'), 'utf8',
    );
    const row = settings
      .split('\n')
      .find((l) => l.includes("key: 'session_moved_enabled'"));
    expect(row, 'the session_moved settings row must still exist').toBeTruthy();
    expect(row!).not.toMatch(/When readiness changed/);
  });
});

describe('session moved · the gate is a real label change, never "the adapter ran"', () => {
  it('THE RULING · an adapter pass that left the day reading the same sends nothing', () => {
    // Same shape, different row id — a reschedule that swapped one easy 4 for
    // another. `applyAdaptations` returns a non-zero touched count and
    // `AdaptationInfo.wasAdapted` is true, and neither of those may fire a
    // push, because the runner cannot see any difference.
    const before = snap('easy', 4, null, 'wko_a');
    const after = snap('easy', 4, null, 'wko_b');
    expect(sessionGenuinelyChanged(before, after)).toBe(false);
  });

  it('a dose change fires', () => {
    expect(sessionGenuinelyChanged(snap('easy', 6), snap('easy', 4))).toBe(true);
  });

  it('a type change fires', () => {
    expect(sessionGenuinelyChanged(snap('tempo', 6), snap('easy', 6))).toBe(true);
  });

  it('a sub-label change fires even when type and distance hold', () => {
    expect(sessionGenuinelyChanged(
      snap('threshold', 6, 'Cruise intervals'),
      snap('threshold', 6, '4x1mi at T'),
    )).toBe(true);
  });

  it('a session appearing, or leaving the day entirely, both fire', () => {
    expect(sessionGenuinelyChanged(null, snap('easy', 4))).toBe(true);
    expect(sessionGenuinelyChanged(snap('easy', 4), null)).toBe(true);
  });

  it('a rest day that stays a rest day is not news', () => {
    expect(sessionGenuinelyChanged(snap('rest', 0), snap('rest', null))).toBe(false);
    expect(sessionGenuinelyChanged(null, null)).toBe(false);
  });

  it('sub-0.05mi float noise does not fire · numeric round-trips are not changes', () => {
    // plan_workouts.distance_mi is numeric and comes back as a string; the
    // label formats to one decimal, so a 4.0 that round-trips as 4.001 reads
    // identical. Same epsilon posture as adaptation-info's composeInfo.
    expect(sessionGenuinelyChanged(snap('easy', 4.0), snap('easy', 4.001))).toBe(false);
  });

  it('the printed label is type plus distance · never the raw sub-label', () => {
    // CAUGHT IN THE DRY RUN, against live plans. Real sub_label values are
    // whole prescriptions: appending the distance to one produces
    // "1.5 mi WU · 3 mi @ T · 1.5 mi CD 6.0 mi" on a lock screen, shouting
    // and stating the distance twice. The push names the shape; the detail is
    // one tap away behind the template's faff://today deeplink.
    expect(sessionLabel({ type: 'threshold', distanceMi: 6 })).toBe('Threshold 6.0 mi');
    expect(sessionLabel({ type: 'easy', distanceMi: 4 })).toBe('Easy 4.0 mi');
    expect(sessionLabel({ type: 'rest', distanceMi: 0 })).toBe('Rest');
    // No distance is a name on its own, never "Easy 0.0 mi".
    expect(sessionLabel({ type: 'easy', distanceMi: null })).toBe('Easy');
    expect(sessionLabel(null)).toBeNull();
    // The two live sub-labels that exposed this must never reach the wire.
    for (const sub of ['1.5 mi WU · 3 mi @ T · 1.5 mi CD', 'EASY · 6×20s strides']) {
      const s = snap('threshold', 6, sub);
      expect(s.label).toBe('Threshold 6.0 mi');
      expect(s.label).not.toContain(sub);
    }
  });

  it('a sub-label-only change fires but drops the was-clause · never "X · it was X"', () => {
    const before = snap('threshold', 6, '4x1mi at T');
    const after = snap('threshold', 6, '3x2mi at T');
    expect(sessionGenuinelyChanged(before, after)).toBe(true);
    // Labels are equal, so the sender passes was_label: null and the body
    // states the day once instead of contradicting itself.
    expect(before.label).toBe(after.label);
    const tpl = renderSessionMoved({
      user_id: 'u1', date_iso: '2026-08-25', now_label: after.label,
      was_label: before.label !== after.label ? before.label : null,
      reason: 'Easing the dose after two held sessions',
    });
    expect(tpl.body).toBe('Today is Threshold 6.0 mi.');
    expect(tpl.body).not.toMatch(/it was Threshold 6\.0 mi/);
  });
});

describe('session moved · the payload the sender produces', () => {
  it('names both shapes and carries the adapter\'s own reason as the title', () => {
    const tpl = renderSessionMoved({
      user_id: 'u1',
      date_iso: '2026-08-25',
      now_label: 'Easy 4.0 mi',
      was_label: 'Tempo 6.0 mi',
      reason: 'Three days of short sleep and a raised resting heart rate',
    });
    expect(tpl.title).toBe('Three days of short sleep and a raised resting heart rate');
    expect(tpl.body).toBe('Today is Easy 4.0 mi · it was Tempo 6.0 mi.');
    // Dedup is anchored on the DAY, so a plan adapted twice in one evening
    // notifies once.
    expect(tpl.dedup_key).toBe('session-moved:u1:2026-08-25');
    expect(tpl.category).toBe('session_moved');
    expect(tpl.apns_category_id).toBe('FAFF_SESSION_MOVED');
    // No action buttons · the session has already changed, there is nothing
    // to approve, and a button would imply otherwise.
    expect(tpl.action_buttons ?? []).toHaveLength(0);
  });

  it('RULE 2 · the copy never asserts a cause of its own', () => {
    // The sender can fire on an event-driven change (a niggle, a missed key
    // workout, a volume week) that no convergence produced, so the template
    // must not manufacture one. With no reason on file the title states the
    // fact and diagnoses nothing.
    const tpl = renderSessionMoved({
      user_id: 'u1', date_iso: '2026-08-25', now_label: 'Easy 4.0 mi', was_label: null, reason: null,
    });
    expect(tpl.title).toBe('Today changed overnight');
    expect(tpl.body).toBe('Today is Easy 4.0 mi.');
    // Coach voice · no hype, no exclamation, no emoji, no em dash.
    for (const s of [tpl.title, tpl.body]) {
      expect(s).not.toMatch(/[!—]/);
      expect(s).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('the category is reachable end to end · prefs gate and APNs bucket both know it', () => {
    // The toggle exists and defaults on; if either of these regresses the
    // sender is wired to a category the dispatcher silently drops.
    expect(DEFAULT_PREFS.session_moved_enabled).toBe(true);
    expect(categoryEnabled(DEFAULT_PREFS, 'session_moved')).toBe(true);
    expect(categoryEnabled({ ...DEFAULT_PREFS, session_moved_enabled: false }, 'session_moved'))
      .toBe(false);
    expect(apnsCategoryId('session_moved')).toBe('FAFF_SESSION_MOVED');
  });
});
