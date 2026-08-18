import { describe, it, expect } from 'vitest';
import { previewBlockShape } from './block-preview';
import { sizeBlocks } from './generate';
import { addDays } from './core';

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
