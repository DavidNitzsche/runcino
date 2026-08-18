import { describe, it, expect } from 'vitest';
import {
  previewBlockShape,
  previewMidBlockRacePlacement,
  buildPlaceholderWeekSkeleton,
  type MidBlockRacePlacementInput,
} from './block-preview';
import { sizeBlocks, embedMidBlockRaces, type MidBlockRace } from './generate';
import { addDays, daysBetween } from './core';

const MARATHON_MI = 26.2;
// 2026-08-17 is a Monday — weekStartDow=1 (the default) is then a no-op,
// so date arithmetic in these fixtures is exact and easy to hand-verify.
const MONDAY = '2026-08-17';

describe('previewBlockShape', () => {
  it('full runway (20 weeks, no recovery) does NOT skip BASE', () => {
    const raceDateISO = addDays(MONDAY, 19 * 7); // exactly 20 boundary-snapped weeks out
    const result = previewBlockShape({
      todayISO: MONDAY,
      raceDateISO,
      raceDistanceMi: MARATHON_MI,
    });

    expect(result.provisional).toBe(true);
    expect(result.inRecovery).toBe(false);
    expect(result.totalWeeksForBlock).toBe(20);
    expect(result.totalWeeksToRace).toBe(20);

    const base = result.phases.find((p) => p.label === 'BASE');
    expect(base).toBeDefined();
    expect(base!.weeks).toBeGreaterThan(0);

    // phases sum to totalWeeksForBlock
    const sum = result.phases.reduce((acc, p) => acc + p.weeks, 0);
    expect(sum).toBe(result.totalWeeksForBlock);

    // taper + race-specific always present for a marathon
    expect(result.phases.find((p) => p.label === 'TAPER')?.weeks).toBe(3);
    expect(result.distanceCategory).toBe('m');
  });

  it('short runway (8 weeks, no recovery) SKIPS BASE per the <10-week mid-block rule', () => {
    const raceDateISO = addDays(MONDAY, 7 * 7); // exactly 8 boundary-snapped weeks out
    const result = previewBlockShape({
      todayISO: MONDAY,
      raceDateISO,
      raceDistanceMi: MARATHON_MI,
    });

    expect(result.totalWeeksForBlock).toBe(8);
    expect(result.phases.find((p) => p.label === 'BASE')).toBeUndefined();

    const sum = result.phases.reduce((acc, p) => acc + p.weeks, 0);
    expect(sum).toBe(result.totalWeeksForBlock);
  });

  it('isMidBlock defaults to false and is flagged as a default, not a real signal', () => {
    const raceDateISO = addDays(MONDAY, 19 * 7);
    const result = previewBlockShape({ todayISO: MONDAY, raceDateISO, raceDistanceMi: MARATHON_MI });
    expect(result.assumptions.isMidBlock.value).toBe(false);
    expect(result.assumptions.isMidBlock.sourced).toBe('default');
  });

  it('an explicit isMidBlock override is honored and marked explicit', () => {
    const raceDateISO = addDays(MONDAY, 19 * 7);
    const result = previewBlockShape({
      todayISO: MONDAY, raceDateISO, raceDistanceMi: MARATHON_MI, isMidBlock: true,
    });
    expect(result.assumptions.isMidBlock.value).toBe(true);
    expect(result.assumptions.isMidBlock.sourced).toBe('explicit');
  });

  it('active recovery window shrinks the previewed block vs. the raw runway', () => {
    // Recovery ends 3 boundary-snapped weeks from today; race is 20 weeks
    // from today. The block itself should start the week after recovery
    // ends, so it should get a SHORTER totalWeeksForBlock than totalWeeksToRace.
    const recoveryEndISO = addDays(MONDAY, 2 * 7 + 6); // last day of week 3 (Sun before next Monday)
    const raceDateISO = addDays(MONDAY, 19 * 7);
    const result = previewBlockShape({
      todayISO: MONDAY,
      raceDateISO,
      raceDistanceMi: MARATHON_MI,
      recoveryEndISO,
    });

    expect(result.inRecovery).toBe(true);
    expect(result.recoveryEndISO).toBe(recoveryEndISO);
    expect(result.recoveryWeeksRemaining).toBeGreaterThan(0);
    expect(result.totalWeeksToRace).toBe(20);
    // Block starts the Monday after recovery ends → 3 fewer weeks than the raw runway.
    expect(result.totalWeeksForBlock).toBe(17);
    expect(result.blockStartISO).toBe(addDays(MONDAY, 3 * 7));

    const sum = result.phases.reduce((acc, p) => acc + p.weeks, 0);
    expect(sum).toBe(result.totalWeeksForBlock);
  });

  it('a recovery end date in the past is NOT treated as an active recovery window', () => {
    const raceDateISO = addDays(MONDAY, 19 * 7);
    const result = previewBlockShape({
      todayISO: MONDAY,
      raceDateISO,
      raceDistanceMi: MARATHON_MI,
      recoveryEndISO: addDays(MONDAY, -7), // a week ago
    });
    expect(result.inRecovery).toBe(false);
    expect(result.recoveryEndISO).toBeNull();
    expect(result.recoveryWeeksRemaining).toBe(0);
    expect(result.totalWeeksForBlock).toBe(20);
  });

  // Anti-drift regression: previewBlockShape's phases must always be exactly
  // what generate.ts's real sizeBlocks() produces for the same
  // (totalWeeksForBlock, raceDistanceMi, isMidBlock) inputs — computed here
  // via an INDEPENDENT direct call, not by reusing previewBlockShape's
  // internals. If a future edit ever re-derives BLOCK_SHAPE or the phase
  // arithmetic inside block-preview.ts instead of calling the real function,
  // this test is the one that catches the divergence.
  it('agrees byte-for-byte with a direct sizeBlocks() call for the same inputs (no-drift guard)', () => {
    for (const totalWeeks of [8, 12, 16, 20, 26]) {
      for (const isMidBlock of [false, true]) {
        const raceDateISO = addDays(MONDAY, (totalWeeks - 1) * 7);
        const preview = previewBlockShape({
          todayISO: MONDAY, raceDateISO, raceDistanceMi: MARATHON_MI, isMidBlock,
        });
        const direct = sizeBlocks(preview.totalWeeksForBlock, MARATHON_MI, isMidBlock);
        expect(preview.phases).toEqual(direct.phases);
        expect(preview.totalWeeksForBlock).toBe(direct.totalWeeks);
      }
    }
  });

  it('non-marathon distances resolve the correct BLOCK_SHAPE category (half marathon)', () => {
    const raceDateISO = addDays(MONDAY, 11 * 7); // 12 weeks
    const result = previewBlockShape({
      todayISO: MONDAY, raceDateISO, raceDistanceMi: 13.1,
    });
    expect(result.distanceCategory).toBe('hm');
    expect(result.phases.find((p) => p.label === 'TAPER')?.weeks).toBe(2); // HM taper per BLOCK_SHAPE
  });
});

describe('previewMidBlockRacePlacement', () => {
  // 20-week no-recovery marathon block starting MONDAY, so blockStartISO ===
  // MONDAY and weekIdx = floor(daysBetween(MONDAY, race.date) / 7) is easy
  // to hand-verify.
  const raceDateISO = addDays(MONDAY, 19 * 7);
  const baseInput: MidBlockRacePlacementInput = {
    todayISO: MONDAY,
    raceDateISO,
    raceDistanceMi: MARATHON_MI,
    midBlockRaces: [],
  };

  it('a B race that falls inside the block is placed in the correct week', () => {
    // 5 full weeks after block start → weekIdx 5 (0-indexed).
    const raceDate = addDays(MONDAY, 5 * 7 + 3); // Thursday of week index 5
    const tuneUp: MidBlockRace = {
      slug: 'santa-monica-10k', name: 'Santa Monica 10K', date: raceDate,
      distanceMi: 6.2, goalPaceSec: null, priority: 'B',
    };
    const result = previewMidBlockRacePlacement({ ...baseInput, midBlockRaces: [tuneUp] });

    expect(result.embeddedRaces).toHaveLength(1);
    expect(result.embeddedRaces[0].slug).toBe('santa-monica-10k');
    expect(result.embeddedRaces[0].weekIdx).toBe(5);
    expect(result.embeddedRaces[0].priority).toBe('B');
    expect(result.embeddedRaces[0].distanceMi).toBe(6.2);
  });

  it('a C race that falls inside the block is placed in the correct week', () => {
    const raceDate = addDays(MONDAY, 9 * 7 + 1); // week index 9
    const tuneUp: MidBlockRace = {
      slug: 'dodgers-5k', name: 'Dodgers 5K', date: raceDate,
      distanceMi: 3.1, goalPaceSec: null, priority: 'C',
    };
    const result = previewMidBlockRacePlacement({ ...baseInput, midBlockRaces: [tuneUp] });

    expect(result.embeddedRaces).toHaveLength(1);
    expect(result.embeddedRaces[0].weekIdx).toBe(9);
    expect(result.embeddedRaces[0].priority).toBe('C');
  });

  it('a race ON the target race date is excluded (mirrors embedMidBlockRaces\' own race.date >= raceDateISO check)', () => {
    const onTargetDate: MidBlockRace = {
      slug: 'same-day', name: 'Same Day', date: raceDateISO,
      distanceMi: 6.2, goalPaceSec: null, priority: 'B',
    };
    const result = previewMidBlockRacePlacement({ ...baseInput, midBlockRaces: [onTargetDate] });
    expect(result.embeddedRaces).toHaveLength(0);
  });

  it('a race AFTER the target race date is excluded', () => {
    const afterTarget: MidBlockRace = {
      slug: 'after', name: 'After Target', date: addDays(raceDateISO, 7),
      distanceMi: 6.2, goalPaceSec: null, priority: 'C',
    };
    const result = previewMidBlockRacePlacement({ ...baseInput, midBlockRaces: [afterTarget] });
    expect(result.embeddedRaces).toHaveLength(0);
  });

  it('a race BEFORE the block window (still inside an active recovery period) is excluded', () => {
    // Recovery runs 3 weeks; block starts 3 weeks from MONDAY. A candidate
    // race dated inside the recovery window (before blockStartISO) falls
    // outside embedMidBlockRaces' own [0, totalDays) offset window.
    const recoveryEndISO = addDays(MONDAY, 2 * 7 + 6);
    const raceInRecovery: MidBlockRace = {
      slug: 'during-recovery', name: 'During Recovery', date: addDays(MONDAY, 5),
      distanceMi: 6.2, goalPaceSec: null, priority: 'C',
    };
    const result = previewMidBlockRacePlacement({
      ...baseInput, recoveryEndISO, midBlockRaces: [raceInRecovery],
    });
    expect(result.embeddedRaces).toHaveLength(0);
  });

  it('reports weekIdx purely from calendar arithmetic against blockStartISO, independent of the placeholder skeleton', () => {
    const raceDate = addDays(MONDAY, 12 * 7 + 2);
    const tuneUp: MidBlockRace = {
      slug: 'run-malibu-half', name: 'Run Malibu Half', date: raceDate,
      distanceMi: 13.1, goalPaceSec: null, priority: 'B',
    };
    const result = previewMidBlockRacePlacement({ ...baseInput, midBlockRaces: [tuneUp] });
    const expectedWeekIdx = Math.floor(daysBetween(result.blockStartISO, raceDate) / 7);
    expect(result.embeddedRaces[0].weekIdx).toBe(expectedWeekIdx);
    expect(expectedWeekIdx).toBe(12);
  });

  // Anti-drift regression: previewMidBlockRacePlacement must produce EXACTLY
  // what a direct call to the real embedMidBlockRaces produces against the
  // same placeholder skeleton — computed here via an INDEPENDENT direct call
  // to buildPlaceholderWeekSkeleton + embedMidBlockRaces, not by reusing
  // previewMidBlockRacePlacement's internals. If a future edit ever
  // reimplements any part of embedMidBlockRaces' placement/mini-taper/
  // frequency-cap logic inside block-preview.ts instead of calling the real
  // function, this test is the one that catches the divergence.
  it('agrees byte-for-byte with a direct buildPlaceholderWeekSkeleton + embedMidBlockRaces call (no-drift guard)', () => {
    const races: MidBlockRace[] = [
      { slug: 'santa-monica-10k', name: 'Santa Monica 10K', date: addDays(MONDAY, 4 * 7 + 6), distanceMi: 6.2, goalPaceSec: null, priority: 'B' },
      { slug: 'dodgers', name: 'Dodgers', date: addDays(MONDAY, 5 * 7 + 5), distanceMi: 3.1, goalPaceSec: null, priority: 'C' },
      { slug: 'run-malibu-half', name: 'Run Malibu Half', date: addDays(MONDAY, 12 * 7 + 6), distanceMi: 13.1, goalPaceSec: 480, priority: 'B' },
    ];
    const input: MidBlockRacePlacementInput = { ...baseInput, midBlockRaces: races };
    const preview = previewMidBlockRacePlacement(input);

    const shape = previewBlockShape(input);
    const weekStartDow = 1; // DEFAULT_WEEK_START_DOW (Monday) — same default previewBlockShape used above
    const longRunDow = (weekStartDow + 6) % 7;
    const { weeks, vols } = buildPlaceholderWeekSkeleton({
      blockStartISO: shape.blockStartISO,
      weekStartDow,
      longRunDow,
      restDow: 6,
      qualityDows: [2, 4],
      totalWeeksForBlock: shape.totalWeeksForBlock,
      phases: shape.phases,
    });
    const direct = embedMidBlockRaces(weeks, vols, {
      startMondayISO: shape.blockStartISO,
      raceDateISO: input.raceDateISO,
      midBlockRaces: races,
      trainingDaysPerWeek: null,
    });

    expect(preview.embeddedRaces).toEqual(direct);
  });

  it('honors explicit restDow/qualityDows/trainingDaysPerWeek and marks them explicit', () => {
    const result = previewMidBlockRacePlacement({
      ...baseInput, restDow: 0, qualityDows: [1, 3, 5], trainingDaysPerWeek: 5,
    });
    expect(result.skeletonAssumptions.restDow).toEqual({ value: 0, sourced: 'explicit' });
    expect(result.skeletonAssumptions.qualityDows).toEqual({ value: [1, 3, 5], sourced: 'explicit' });
    expect(result.skeletonAssumptions.trainingDaysPerWeek).toEqual({ value: 5, sourced: 'explicit' });
  });

  it('defaults restDow/qualityDows/trainingDaysPerWeek and marks them default', () => {
    const result = previewMidBlockRacePlacement(baseInput);
    expect(result.skeletonAssumptions.restDow).toEqual({ value: 6, sourced: 'default' });
    expect(result.skeletonAssumptions.qualityDows).toEqual({ value: [2, 4], sourced: 'default' });
    expect(result.skeletonAssumptions.trainingDaysPerWeek).toEqual({ value: null, sourced: 'default' });
  });

  it('still returns the underlying phase-shape preview fields (extends previewBlockShape)', () => {
    const result = previewMidBlockRacePlacement(baseInput);
    expect(result.provisional).toBe(true);
    expect(result.totalWeeksForBlock).toBe(20);
    expect(result.phases.reduce((s, p) => s + p.weeks, 0)).toBe(result.totalWeeksForBlock);
  });
});
