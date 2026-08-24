/**
 * lib/faff/_race_plate.test.ts — a race already run is not projected.
 *
 * `app/api/v5/race/[slug]/route.ts` computed `projected` from today's VDOT and
 * `gap` from that projection for EVERY race, though it already read
 * `race.is_past` a few lines down for the result section. Opening a race from
 * last weekend on the phone showed:
 *
 *   · Goal 1:38:00 · Projected ~1:36:12 · Gap −1:48   (a projection, after)
 *   · "Today's fitness projects 1:48 behind the goal. That can still close."
 *   · A PACE PLAN for a race already run.
 *
 * The falsifier below is David's own AFC Half — run 2026-08-17, finished
 * 1:41:53 — opened a week later.
 */
import { describe, it, expect } from 'vitest';
import { racePlateFor } from './race-plate';

const AFC_GOAL = 1 * 3600 + 38 * 60;        // 1:38:00
const AFC_FINISH = 1 * 3600 + 41 * 60 + 53; // 1:41:53
const PROJECTED = 1 * 3600 + 36 * 60 + 12;  // what today's VDOT would say

describe('racePlateFor · a past race', () => {
  const past = racePlateFor({
    isPast: true, goalSec: AFC_GOAL, finishSec: AFC_FINISH, projectedSec: PROJECTED,
  });

  it('never shows a projection for a race already run', () => {
    expect(past.middleSec).not.toBe(PROJECTED);
  });

  it('shows what the runner actually ran', () => {
    expect(past.middleSec).toBe(AFC_FINISH);
  });

  it('marks the finish as measured, not modelled', () => {
    // Rule one, the other way round: a real finish time wearing the amber
    // tilde claims a read is an estimate.
    expect(past.middleModelled).toBe(false);
  });

  it('measures the gap against what was run, not what was projected', () => {
    expect(past.gapSec).toBe(AFC_FINISH - AFC_GOAL); // +3:53, behind
    expect(past.gapSec).not.toBe(PROJECTED - AFC_GOAL);
    expect(past.gapModelled).toBe(false);
  });

  it('suppresses the forward-looking coach line and pace plan', () => {
    expect(past.showsForwardLooking).toBe(false);
  });

  it('offers no projection and no gap when the race has no logged result', () => {
    // A DNS, or a result not entered yet. Nothing honest to put there.
    const dns = racePlateFor({
      isPast: true, goalSec: AFC_GOAL, finishSec: null, projectedSec: PROJECTED,
    });
    expect(dns.middleSec).toBeNull();
    expect(dns.gapSec).toBeNull();
    expect(dns.showsForwardLooking).toBe(false);
  });
});

describe('racePlateFor · an upcoming race is unchanged', () => {
  const upcoming = racePlateFor({
    isPast: false, goalSec: AFC_GOAL, finishSec: null, projectedSec: PROJECTED,
  });

  it('projects off fitness and marks it modelled', () => {
    expect(upcoming.middleSec).toBe(PROJECTED);
    expect(upcoming.middleModelled).toBe(true);
  });

  it('gaps the projection against the goal, marked modelled', () => {
    expect(upcoming.gapSec).toBe(PROJECTED - AFC_GOAL);
    expect(upcoming.gapModelled).toBe(true);
  });

  it('still shows the coach line and the pace plan', () => {
    expect(upcoming.showsForwardLooking).toBe(true);
  });

  it('offers no gap when no goal was ever set', () => {
    // The add-a-race form calls goal time "Optional".
    const noGoal = racePlateFor({
      isPast: false, goalSec: null, finishSec: null, projectedSec: PROJECTED,
    });
    expect(noGoal.gapSec).toBeNull();
    expect(noGoal.middleSec).toBe(PROJECTED);
  });
});
