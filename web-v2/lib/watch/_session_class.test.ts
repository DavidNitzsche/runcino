/**
 * One classification, four decisions.
 *
 * `buildWatchWorkout` used to answer "what kind of session is this" four
 * separate times with four non-matching type lists. `race_week_tuneup` was in
 * none of them, and it is live in the plan: a 5×400m at T pace reached the
 * wrist with a ±20 s/mi band instead of ±8, no HR target, no ceiling, and an
 * easy-run fuelling plan. PaceDrift.swift then derives hardDrift =
 * max(15, 20+5), so the rep can never turn red.
 */

import { describe, it, expect } from 'vitest';
import { classifySession } from './build-workout';

describe('the types the old lists forgot', () => {
  it('a race-week tune-up is threshold work, not an easy run', () => {
    // Live in the plan on 2026-09-15 and 2026-09-22 as 5×400m @ T pace,
    // carrying spec kind 'threshold'.
    expect(classifySession('race_week_tuneup', { kind: 'threshold' })).toBe('threshold');
  });

  it('and is classified correctly even with no spec at all', () => {
    expect(classifySession('race_week_tuneup', null)).toBe('threshold');
  });

  it('vo2max is interval work', () => {
    expect(classifySession('vo2max', null)).toBe('interval');
  });

  it('fartlek and progression are quality, not easy', () => {
    expect(classifySession('fartlek', null)).toBe('threshold');
    expect(classifySession('progression', null)).toBe('threshold');
  });
});

describe('the spec is authored truth, except where it cannot express the answer', () => {
  it('a race stays a race even though its spec stashes as long', () => {
    // WorkoutSpec has no 'race' member, so race day carries kind 'long'.
    // Asking the spec first would pace race day as a long run.
    expect(classifySession('race', { kind: 'long' })).toBe('race');
  });

  it('the spec overrides a stale type', () => {
    expect(classifySession('easy', { kind: 'threshold' })).toBe('threshold');
  });

  it('rest is rest', () => {
    expect(classifySession('rest', null)).toBe('rest');
  });
});

describe('the four decisions can no longer disagree', () => {
  const QUALITY = ['threshold', 'tempo', 'intervals', 'vo2max', 'race_week_tuneup', 'fartlek', 'progression'];
  const AEROBIC = ['easy', 'recovery', 'shakeout', 'long'];

  it('every quality type lands in a quality class', () => {
    for (const t of QUALITY) {
      expect(['threshold', 'interval']).toContain(classifySession(t, null));
    }
  });

  it('no aerobic type is misread as quality', () => {
    for (const t of AEROBIC) {
      expect(['easy', 'long']).toContain(classifySession(t, null));
    }
  });

  it('an unknown type degrades to other rather than to quality', () => {
    // Falling into a quality class would ship a tight band and an HR target
    // for something nobody classified — the safe default is the loose one.
    expect(classifySession('some_future_type', null)).toBe('other');
  });
});
