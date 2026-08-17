/**
 * The volume ramp may not imply a race it does not reach.
 *
 * The live defect this locks: on 2026-08-17 the ramp drew the 2-week
 * post-race recovery block followed immediately by a checkered RACE bar,
 * under a header reading "WEEKLY VOLUME · TO RACE DAY" — so the 13-week
 * CIM build between them was invisible and the chart said "recovery, then
 * race" for a race 111 days out. It also swallowed week 2 of the recovery
 * block entirely, because the race bar was drawn in that week's place.
 */
import { describe, it, expect } from 'vitest';
import { resolveBlockState } from './block-state';
import { resolveRampScope } from './ramp-scope';

const GOAL = { name: 'California International Marathon', dateISO: '2026-12-06' };

/** The owner's live state · day 1 of a 2-week recovery block. */
const recoveryBlock = resolveBlockState({
  planMode: 'recovery',
  planFirstDayISO: '2026-08-17',
  planLastDayISO: '2026-08-30',
  todayISO: '2026-08-17',
  goalRace: GOAL,
});

/** A real goal build that does end at the race. */
const goalBlock = resolveBlockState({
  planMode: 'race',
  planFirstDayISO: '2026-08-31',
  planLastDayISO: '2026-12-06',
  todayISO: '2026-09-20',
  goalRace: GOAL,
});

describe('recovery block with a distant race', () => {
  // 2-week plan → miles.length 2 → raceIdx 1.
  const scope = resolveRampScope({ blockState: recoveryBlock, raceIdx: 1, goalName: GOAL.name });

  it('knows the block does not run to the race', () => {
    expect(scope.blockRunsToRace).toBe(false);
  });

  it('draws no race bar', () => {
    expect(scope.showRaceBar).toBe(false);
  });

  it('stops claiming TO RACE DAY', () => {
    expect(scope.label).not.toMatch(/TO RACE DAY/);
    expect(scope.label).toBe('WEEKLY VOLUME · RECOVERY BLOCK');
  });

  it('pushes the race index out of range so no real week is swallowed', () => {
    // The bar map skips `i === rampRaceIdx`. With raceIdx 1 that used to
    // delete week 2 of the recovery block. rampRaceIdx must not collide
    // with any real week index (0..1).
    expect(scope.rampRaceIdx).toBe(2);
    for (let i = 0; i <= 1; i++) expect(scope.rampRaceIdx).not.toBe(i);
  });

  it('hands off with the window, the opening date and how far out the race is', () => {
    expect(scope.handoff).not.toBeNull();
    expect(scope.handoff).toMatchObject({
      windowStartISO: '2026-08-17',
      windowEndISO: '2026-08-30',
      opensISO: '2026-08-31',
      weeksOutAtOpen: 13,
      goalName: GOAL.name,
    });
  });

  it('states the same facts the Goal page states', () => {
    // Goal page: "Recovery window Aug 17 to Aug 30 · California
    // International block opens Aug 31, 13 weeks out".
    const h = scope.handoff!;
    expect(h.windowStartISO).toBe(recoveryBlock.windowStartISO);
    expect(h.windowEndISO).toBe(recoveryBlock.windowEndISO);
    expect(h.opensISO).toBe(recoveryBlock.nextBlockOpensISO);
    expect(h.weeksOutAtOpen).toBe(recoveryBlock.weeksOutAtOpen);
  });
});

describe('a block that does run to the race', () => {
  const scope = resolveRampScope({ blockState: goalBlock, raceIdx: 13, goalName: GOAL.name });

  it('keeps the race bar and the to-race-day framing', () => {
    expect(scope.blockRunsToRace).toBe(true);
    expect(scope.showRaceBar).toBe(true);
    expect(scope.label).toBe('WEEKLY VOLUME · TO RACE DAY');
  });

  it('treats the last plan week as race week', () => {
    expect(scope.rampRaceIdx).toBe(13);
  });

  it('has nothing to hand off to', () => {
    expect(scope.handoff).toBeNull();
  });
});

describe('a plan that has run out entirely', () => {
  const dead = resolveBlockState({
    planMode: 'race',
    planFirstDayISO: '2026-05-01',
    planLastDayISO: '2026-08-01',
    todayISO: '2026-08-17',
    goalRace: GOAL,
  });
  const scope = resolveRampScope({ blockState: dead, raceIdx: 12, goalName: GOAL.name });

  it('scopes to the current block rather than claiming race day', () => {
    expect(dead.reason).toBe('block-over');
    expect(scope.blockRunsToRace).toBe(false);
    expect(scope.showRaceBar).toBe(false);
    expect(scope.label).toBe('WEEKLY VOLUME · CURRENT BLOCK');
  });
});

describe('no goal race at all', () => {
  const noGoal = resolveBlockState({
    planMode: 'recovery',
    planFirstDayISO: '2026-08-17',
    planLastDayISO: '2026-08-30',
    todayISO: '2026-08-17',
    goalRace: null,
  });
  const scope = resolveRampScope({ blockState: noGoal, raceIdx: 1, goalName: null });

  it('still scopes the ramp honestly', () => {
    expect(scope.showRaceBar).toBe(false);
    expect(scope.label).toBe('WEEKLY VOLUME · RECOVERY BLOCK');
  });

  it('captions the window without inventing a race to point at', () => {
    expect(scope.handoff?.goalName).toBeNull();
    expect(scope.handoff?.weeksOutAtOpen).toBeNull();
  });
});
