/**
 * Between-blocks state selection · deck Decision 3.
 *
 * David's live state on 2026-08-17 is the anchor case: a 2-week post-race
 * recovery block (Aug 17 to 30) with CIM on Dec 6. THE WORK must say so
 * instead of rendering an empty test-point list.
 */
import { describe, it, expect } from 'vitest';
import { resolveBlockState } from './block-state';

const CIM = { name: 'California International Marathon', dateISO: '2026-12-06' };

describe('resolveBlockState · David 2026-08-17 · post-race recovery block', () => {
  const state = resolveBlockState({
    planMode: 'recovery',
    planFirstDayISO: '2026-08-17',
    planLastDayISO: '2026-08-30',
    todayISO: '2026-08-17',
    goalRace: CIM,
  });

  it('is between blocks · a recovery block is a bridge, not the block', () => {
    expect(state.betweenBlocks).toBe(true);
    expect(state.reason).toBe('recovery');
  });

  it('names the window it is in', () => {
    expect(state.windowStartISO).toBe('2026-08-17');
    expect(state.windowEndISO).toBe('2026-08-30');
  });

  it('opens the next block the day after the window closes', () => {
    expect(state.nextBlockOpensISO).toBe('2026-08-31');
  });

  it('states how far out the goal race is when the block opens', () => {
    // Aug 31 to Dec 6 is 97 days · 13 whole weeks.
    expect(state.weeksOutAtOpen).toBe(13);
    expect(state.goalName).toBe(CIM.name);
    expect(state.goalDateISO).toBe('2026-12-06');
  });
});

describe('resolveBlockState · the other between-blocks reasons', () => {
  it('no active plan at all', () => {
    const s = resolveBlockState({ planMode: null, todayISO: '2026-08-17', goalRace: CIM });
    expect(s.betweenBlocks).toBe(true);
    expect(s.reason).toBe('no-plan');
    expect(s.nextBlockOpensISO).toBeNull();
    expect(s.weeksOutAtOpen).toBeNull();
  });

  it('a race-prep plan whose last prescribed day has passed', () => {
    const s = resolveBlockState({
      planMode: 'race-prep',
      planFirstDayISO: '2026-05-01',
      planLastDayISO: '2026-08-16',
      todayISO: '2026-08-17',
      goalRace: CIM,
    });
    expect(s.betweenBlocks).toBe(true);
    expect(s.reason).toBe('block-over');
    expect(s.nextBlockOpensISO).toBe('2026-08-17');
    // Only a recovery window is a window the runner is living inside.
    expect(s.windowStartISO).toBeNull();
    expect(s.windowEndISO).toBeNull();
  });
});

describe('resolveBlockState · inside a block', () => {
  it('a live race-prep plan is not between blocks', () => {
    const s = resolveBlockState({
      planMode: 'race-prep',
      planFirstDayISO: '2026-08-31',
      planLastDayISO: '2026-12-06',
      todayISO: '2026-09-20',
      goalRace: CIM,
    });
    expect(s.betweenBlocks).toBe(false);
    expect(s.reason).toBeNull();
  });

  it('a maintenance plan is a real block · it is doing work, just not race work', () => {
    const s = resolveBlockState({
      planMode: 'maintenance',
      planFirstDayISO: '2026-08-01',
      planLastDayISO: '2026-10-01',
      todayISO: '2026-08-17',
      goalRace: null,
    });
    expect(s.betweenBlocks).toBe(false);
  });

  it('today ON the last prescribed day is still inside the block', () => {
    const s = resolveBlockState({
      planMode: 'race-prep',
      planFirstDayISO: '2026-05-01',
      planLastDayISO: '2026-08-17',
      todayISO: '2026-08-17',
      goalRace: CIM,
    });
    expect(s.betweenBlocks).toBe(false);
  });
});

describe('resolveBlockState · degrades honestly', () => {
  it('no goal race · still names the state, states no weeks-out', () => {
    const s = resolveBlockState({
      planMode: 'recovery',
      planFirstDayISO: '2026-08-17',
      planLastDayISO: '2026-08-30',
      todayISO: '2026-08-17',
      goalRace: null,
    });
    expect(s.betweenBlocks).toBe(true);
    expect(s.weeksOutAtOpen).toBeNull();
    expect(s.goalName).toBeNull();
  });

  it('a goal race BEFORE the block opens yields no weeks-out rather than a negative', () => {
    const s = resolveBlockState({
      planMode: 'recovery',
      planFirstDayISO: '2026-08-17',
      planLastDayISO: '2026-08-30',
      todayISO: '2026-08-17',
      goalRace: { name: 'Something soon', dateISO: '2026-08-20' },
    });
    expect(s.weeksOutAtOpen).toBeNull();
  });

  it('mode casing and whitespace do not change the read', () => {
    const s = resolveBlockState({
      planMode: '  Recovery ',
      planFirstDayISO: '2026-08-17',
      planLastDayISO: '2026-08-30',
      todayISO: '2026-08-17',
      goalRace: CIM,
    });
    expect(s.reason).toBe('recovery');
  });
});
