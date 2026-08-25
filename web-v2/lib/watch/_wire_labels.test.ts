/**
 * WATCH-TYPE-1 · what the wrist calls the session.
 *
 * `classifySession` was converged in 2026-08-17 so the FOUR internal decisions
 * (tolerance, HR target, HR ceiling, fuelling) stopped disagreeing about what a
 * session is. Three answers on the WIRE were left switching on the raw
 * `plan_workouts.type` column, and the raw column carries at least five values
 * the switches did not name:
 *
 *   · `paceLabel`  → "" for race_week_tuneup / fartlek / progression / vo2max.
 *     Not inert: `WatchLobbyAdapter.ramp` (WatchRouterV5.swift) reads this tag
 *     to decide the session's identity across the whole product and defaults to
 *     `.easy`, and `isThreshold` reads it to decide whether a block earns the
 *     average-pace row it is judged by.
 *   · the session NAME → "Race_week_tuneup", straight off the column.
 *   · `prescriptionFor` → the `default` arm, "No workout scheduled", which the
 *     `summary` string prints verbatim on a real prescribed session.
 *
 * All three now narrow through `narrowToPrescriptionType`, which is the same
 * narrowing the phone uses — so the two surfaces cannot name a session
 * differently.
 */

import { describe, it, expect } from 'vitest';
import { paceLabelFor, labelFor } from './build-workout';
import { narrowToPrescriptionType } from '@/lib/training/prescriptions';

describe('the zone tag the lobby routes on', () => {
  it('the four types that used to return the empty string now carry their zone', () => {
    // "" → WatchLobbyAdapter.ramp's default arm → .easy. A VO2max session and
    // a race-week tune-up both arrived on the wrist wearing the easy ramp.
    expect(paceLabelFor('race_week_tuneup')).toBe('T');
    expect(paceLabelFor('fartlek')).toBe('T');
    expect(paceLabelFor('progression')).toBe('T');
    expect(paceLabelFor('vo2max')).toBe('I');
  });

  it('a recovery run is easy, and says so', () => {
    expect(paceLabelFor('recovery')).toBe('E');
  });

  it('every type the old switch already answered is unchanged', () => {
    // The fix must be additive. These are the nine the raw switch named.
    expect(paceLabelFor('easy')).toBe('E');
    expect(paceLabelFor('long')).toBe('L');
    expect(paceLabelFor('tempo')).toBe('T');
    expect(paceLabelFor('threshold')).toBe('T');
    expect(paceLabelFor('intervals')).toBe('I');
    expect(paceLabelFor('race')).toBe('R');
    expect(paceLabelFor('shakeout')).toBe('E');
    expect(paceLabelFor('rest')).toBe('');
  });

  it('a quality session never reads as easy on the wire', () => {
    // The property that matters, stated as a property: the lobby's ramp reads
    // T / I / R as quality and everything else as easy-or-long. No session the
    // engine calls quality may fall to the easy side of that.
    for (const t of ['threshold', 'tempo', 'intervals', 'vo2max', 'fartlek',
                     'progression', 'race_week_tuneup', 'track', 'interval']) {
      expect(['T', 'I', 'R']).toContain(paceLabelFor(t));
    }
  });
});

describe('the name on the wrist when the row carries no sub_label', () => {
  it('a tune-up is not announced as a database column', () => {
    expect(labelFor('race_week_tuneup')).toBe('Tune-up');
  });

  it('the other unnamed types read as prose', () => {
    expect(labelFor('fartlek')).toBe('Fartlek');
    expect(labelFor('progression')).toBe('Progression');
    expect(labelFor('recovery')).toBe('Recovery');
    expect(labelFor('vo2max')).toBe('Intervals');
  });

  it('an unknown type still loses its underscores rather than keeping them', () => {
    // The default arm is the last line of defence, not a place to give up.
    expect(labelFor('some_new_type')).toBe('Some new type');
  });

  it('the named types are unchanged', () => {
    expect(labelFor('easy')).toBe('Easy');
    expect(labelFor('long')).toBe('Long');
    expect(labelFor('intervals')).toBe('Intervals');
    expect(labelFor('race')).toBe('Race');
  });
});

describe('the prescription the summary line is built from', () => {
  it('no type the generator emits reaches the "No workout scheduled" arm', () => {
    // `summary` is `${miles} mi · ${prescription.headline}`, printed on every
    // payload. Before this, a race-week tune-up read "5.0 mi · No workout
    // scheduled" on the wrist, and with no workout_spec to expand, that
    // headline also became the only phase's label.
    const emitted = [
      'easy', 'long', 'tempo', 'threshold', 'intervals', 'race', 'shakeout',
      'recovery', 'race_week_tuneup', 'fartlek', 'progression', 'vo2max',
    ];
    const implemented = new Set([
      'easy', 'long', 'tempo', 'threshold', 'intervals', 'race', 'shakeout',
      'rest', 'unplanned',
    ]);
    for (const t of emitted) {
      expect(implemented.has(narrowToPrescriptionType(t))).toBe(true);
    }
  });
});
