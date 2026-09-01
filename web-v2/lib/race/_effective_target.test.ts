/**
 * _effective_target.test.ts · the execution-target adapter is a READ of the
 * race-pace brain, not a second rule.
 *
 * 2026-09-01 · P0. The old resolver here applied its own 5% band to a
 * projection snapshot. Now `effectiveTargetFromOutlook` passes the outlook's
 * execution target through, and maps its source into the two-valued shape
 * eleven callers read. These tests pin that mapping and the Rule 11 state.
 */
import { describe, it, expect } from 'vitest';
import { effectiveTargetFromOutlook, roundTargetSec } from './effective-race-target';
import { composeRaceOutlook } from './race-outlook';
import { fixtureReads, fixtureRace } from './_race_outlook_fixture';

describe('effectiveTargetFromOutlook', () => {
  it('no outlook → the goal, source goal, outlook null (Rule 11: could not read)', () => {
    const r = effectiveTargetFromOutlook(10800, null);
    expect(r).toMatchObject({ targetSec: 10800, source: 'goal', goalSec: 10800, projectionSec: null, outlook: null });
  });
  it('goal inside the likely range → the goal, source goal', async () => {
    const base = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), '2026-09-01', fixtureReads());
    const inside = Math.round((base.expectedRaceDay.likelyRangeSec![0] + base.expectedRaceDay.expectedSec!) / 2);
    const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: inside }), '2026-09-01', fixtureReads());
    const r = effectiveTargetFromOutlook(inside, o);
    expect(r.source).toBe('goal');
    expect(r.targetSec).toBe(inside);
    expect(r.projectionSec).toBe(o.expectedRaceDay.expectedSec);
  });
  it('goal beyond the fast edge → the edge, source projection, goal kept as the stretch', async () => {
    const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: 2 * 3600 }), '2026-09-01', fixtureReads());
    const r = effectiveTargetFromOutlook(2 * 3600, o);
    expect(r.source).toBe('projection');
    expect(r.targetSec).toBe(roundTargetSec(o.expectedRaceDay.likelyRangeSec![0]));
    expect(r.goalSec).toBe(7200);
  });
  it('roundTargetSec · 10 s over an hour, 5 s under', () => {
    expect(roundTargetSec(12137)).toBe(12140);
    expect(roundTargetSec(1503)).toBe(1505);
  });
});
