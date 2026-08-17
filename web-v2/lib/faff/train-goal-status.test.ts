/**
 * Train and Goal state ONE verdict in ONE vocabulary.
 *
 * The live defect this locks: on 2026-08-17 Train's PROJECTION card read
 * "3:31:48 PROJECTED FINISH TODAY · 32 min behind" while the Goal page read
 * "PROJECTED 3:19:04 · BEHIND 19:04". Both numbers were defensible —
 * today's fitness vs the race-day trajectory — but each carried its own
 * verdict wording, so a runner reading two pages got two answers.
 *
 * The fix is not to delete one number. It is: ONE verdict, from
 * lib/faff/goal-status, fed identical inputs on both pages; and the two
 * NUMBERS labelled as the distinct facts they are.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGoalStatus } from './goal-status';

/** Drop block and line comments so source guards assert on code alone. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const TRAIN = join(__dirname, '../../components/faff-app/views/TrainView.tsx');
const TARGETS = join(__dirname, '../../components/faff-app/views/TargetsView.tsx');

/** The owner's live numbers on 2026-08-17. */
const GOAL_SEC = 3 * 3600;            // 3:00:00
const TODAY_FITNESS_SEC = 3 * 3600 + 31 * 60 + 48;  // 3:31:48
const RACE_DAY_SEC = 3 * 3600 + 19 * 60 + 4;        // 3:19:04

const liveTrajectory = {
  gapSec: RACE_DAY_SEC - GOAL_SEC,    // 1144 = 19:04
  gapVdot: 2.1,
  reachable: false,
  aheadOfGoal: false,
};

describe('the shared resolver on the live inputs', () => {
  const read = resolveGoalStatus({
    trajectory: liveTrajectory,
    goalSec: GOAL_SEC,
    projectionSec: TODAY_FITNESS_SEC,
  });

  it('produces the one verdict both pages must show', () => {
    expect(read).not.toBeNull();
    expect(read!.label).toBe('BEHIND · 19:04');
  });

  it('is driven by the race-day trajectory, not today\'s fitness', () => {
    // 3:31:48 vs goal is 31:48. The verdict must not quote that number.
    expect(read!.gapLabel).toBe('19:04');
    expect(read!.gapLabel).not.toBe('31:48');
  });

  it('gives the same answer whichever page asks, given the same inputs', () => {
    const asTargets = resolveGoalStatus({
      trajectory: liveTrajectory, goalSec: GOAL_SEC, projectionSec: TODAY_FITNESS_SEC,
    });
    const asTrain = resolveGoalStatus({
      trajectory: liveTrajectory, goalSec: GOAL_SEC, projectionSec: TODAY_FITNESS_SEC,
    });
    expect(asTrain).toEqual(asTargets);
  });

  it('never softens an unclosable gap on one page only', () => {
    const renegotiating = resolveGoalStatus({
      trajectory: { ...liveTrajectory, reachable: true, gapVdot: 0.2 },
      goalSec: GOAL_SEC,
      projectionSec: TODAY_FITNESS_SEC,
      unclosable: true,
    });
    expect(renegotiating!.word).toBe('BEHIND');
  });
});

describe('TrainView has adopted the shared vocabulary', () => {
  // Code only · the fix comments quote the retired wording deliberately.
  const src = stripComments(readFileSync(TRAIN, 'utf8'));

  it('imports the shared resolver and chip', () => {
    expect(src).toMatch(/resolveGoalStatus/);
    expect(src).toMatch(/from '@\/lib\/faff\/goal-status'/);
    expect(src).toMatch(/import \{ StatusChip \}/);
  });

  it('feeds the resolver the same four inputs TargetsView feeds it', () => {
    const targets = readFileSync(TARGETS, 'utf8');
    for (const key of ['trajectory:', 'goalSec:', 'projectionSec:', 'unclosable:']) {
      expect(src).toContain(key);
      expect(targets).toContain(key);
    }
    // Both must read the pending renegotiation, or one page can call an
    // unclosable gap "watching" while the other calls it BEHIND.
    for (const s of [src, targets]) {
      expect(s).toMatch(/goal_renegotiation/);
    }
  });

  it('no longer writes its own verdict from goal.delta', () => {
    expect(src).not.toMatch(/chipLabel\s*=\s*isWatching\s*\?\s*'watching'\s*:\s*goal\.delta/);
  });

  it('labels the two numbers as two distinct facts', () => {
    // Today's-fitness number is named as such, and the race-day number is
    // named separately — neither presents as "the" projection.
    expect(src).toMatch(/FROM TODAY'S FITNESS/);
    expect(src).toMatch(/On race day/);
    expect(src).not.toMatch(/PROJECTED FINISH TODAY/);
  });
});
