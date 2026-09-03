/**
 * _effective_target.test.ts · the execution-target adapter is a READ of the
 * race-pace brain, not a second rule.
 *
 * 2026-09-01 · P0. The old resolver here applied its own 5% band to a
 * projection snapshot. Now `effectiveTargetFromOutlook` passes the outlook's
 * execution target through, and maps its source into the two-valued shape
 * eleven callers read. These tests pin that mapping and the Rule 11 state.
 *
 * ── RULING MOVES ────────────────────────────────────────────────────────────
 *
 * EXECTARGET-1 (2026-09-03). Two assertions moved, and both moved because the
 * behaviour they pinned was removed rather than because they were wrong:
 *
 *   was  a goal inside the range → source 'goal', target === the goal
 *   was  a goal beyond the edge  → target === the forecast range's fast edge
 *   now  every target is the CURRENT PROJECTION, source 'projection', always
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q7: the active execution number is
 * the projection-derived one and the goal never sets it. `source: 'goal'` is
 * now unreachable through this adapter, and the test below asserts THAT rather
 * than pretending the mapping still has two live arms.
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
  it('a goal inside the old range no longer sets the target · Q7', async () => {
    const base = await composeRaceOutlook(fixtureRace({ statedGoalSec: null }), '2026-09-01', fixtureReads());
    const inside = Math.round((base.expectedRaceDay.likelyRangeSec![0] + base.expectedRaceDay.expectedSec!) / 2);
    const o = await composeRaceOutlook(fixtureRace({ statedGoalSec: inside }), '2026-09-01', fixtureReads());
    const r = effectiveTargetFromOutlook(inside, o);
    expect(r.source).toBe('projection');
    expect(r.targetSec).not.toBe(inside);
    expect(r.targetSec).toBe(o.execution.targetSec);
    // The runner's own number is still carried, untouched, beside it.
    expect(r.goalSec).toBe(inside);
    expect(r.projectionSec).toBe(o.expectedRaceDay.expectedSec);
  });
  it('an impossible goal changes the target by nothing at all', async () => {
    const soft = await composeRaceOutlook(fixtureRace({ statedGoalSec: 5 * 3600 }), '2026-09-01', fixtureReads());
    const wild = await composeRaceOutlook(fixtureRace({ statedGoalSec: 2 * 3600 }), '2026-09-01', fixtureReads());
    expect(effectiveTargetFromOutlook(2 * 3600, wild).targetSec)
      .toBe(effectiveTargetFromOutlook(5 * 3600, soft).targetSec);
    const r = effectiveTargetFromOutlook(2 * 3600, wild);
    expect(r.source).toBe('projection');
    expect(r.targetSec).toBe(roundTargetSec(wild.currentProjection.expectedSec!));
    expect(r.goalSec).toBe(7200);
  });
  it('roundTargetSec · 10 s over an hour, 5 s under', () => {
    expect(roundTargetSec(12137)).toBe(12140);
    expect(roundTargetSec(1503)).toBe(1505);
  });
});
