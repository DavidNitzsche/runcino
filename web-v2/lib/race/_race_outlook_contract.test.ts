/**
 * _race_outlook_contract.test.ts · THE race-pace brain's contract.
 *
 * What this gate cannot fail on (Rule 22): a consumer that stops calling the
 * outlook (that is `_race_projection.test.ts`'s source scan), and the truth
 * of the canonical reads themselves (Runner Model / Durability own those).
 * Everything below drives `composeRaceOutlook` with fixture reads.
 *
 * Falsified 2026-09-01 against a deliberately broken compose (goal used as
 * the improvement, target allowed past the fast edge): both named failures.
 */
import { describe, it, expect } from 'vitest';
import { composeRaceOutlook, raceOutlookInvariants, roundRaceTargetSec } from './race-outlook';
import { fixtureReads, fixtureRace } from './_race_outlook_fixture';

const TODAY = '2026-09-01';

async function outlookFor(goalSec: number | null, opts = {}) {
  return composeRaceOutlook(fixtureRace({ statedGoalSec: goalSec }), TODAY, fixtureReads(opts));
}

describe('RaceOutlook · the four quantities are distinct and named', () => {
  it('stated goal is echoed, never edited', async () => {
    const o = await outlookFor(3 * 3600);
    expect(o.statedGoal.sec).toBe(10800);
  });
  it('training prescription (marathon pace now) is the canonical anchor, not the execution pace', async () => {
    const o = await outlookFor(3 * 3600);
    expect(o.trainingPrescription.source).toBe('canonical_anchors');
    expect(o.trainingPrescription.kind).toBe('marathon_specific');
    expect(o.trainingPrescription.paceSecPerMi).not.toBe(o.execution.paceSecPerMi);
  });
  it('expected race day is current projection plus the expected gain, never slower than current', async () => {
    const o = await outlookFor(3 * 3600);
    expect(o.currentProjection.expectedSec).not.toBeNull();
    expect(o.expectedRaceDay.expectedSec).not.toBeNull();
    expect(o.expectedRaceDay.expectedSec!).toBeLessThanOrEqual(o.currentProjection.expectedSec!);
    expect(o.expectedRaceDay.basis).toBe('trajectory');
    expect(raceOutlookInvariants(o)).toEqual([]);
  });
});

describe('RaceOutlook · the goal is never evidence', () => {
  it('a soft goal and an impossible goal earn the same expected improvement and the same expected race day', async () => {
    const soft = await outlookFor(4 * 3600);
    const hard = await outlookFor(2 * 3600 + 30 * 60);
    expect(soft.expectedImprovement.gainVdot).toBeCloseTo(hard.expectedImprovement.gainVdot, 6);
    expect(soft.expectedRaceDay.expectedSec).toBe(hard.expectedRaceDay.expectedSec);
    expect(soft.currentProjection.expectedSec).toBe(hard.currentProjection.expectedSec);
  });
  it('no goal at all still projects, and the execution target IS the expected race day', async () => {
    const o = await outlookFor(null);
    expect(o.execution.source).toBe('expected_race_day');
    expect(o.execution.targetSec).toBe(roundRaceTargetSec(o.expectedRaceDay.expectedSec!));
    expect(o.coachSet).not.toBeNull();
    expect(o.coachSet!.aSec).toBeLessThan(o.coachSet!.bSec);
    expect(o.coachSet!.bSec).toBeLessThan(o.coachSet!.cSec);
  });
});

describe('RaceOutlook · execution target · the goal pulls no further than the likely range\'s fast edge', () => {
  it('a goal inside the range is raced as stated', async () => {
    const base = await outlookFor(null);
    const inside = Math.round((base.expectedRaceDay.likelyRangeSec![0] + base.expectedRaceDay.expectedSec!) / 2);
    const o = await outlookFor(inside);
    expect(o.execution.source).toBe('stated_goal_within_range');
    expect(o.execution.targetSec).toBe(inside);
  });
  it('a goal beyond the fast edge is clamped TO the edge, and the goal stays the goal', async () => {
    const base = await outlookFor(null);
    const edge = base.expectedRaceDay.likelyRangeSec![0];
    const o = await outlookFor(Math.round(edge * 0.8));
    expect(o.execution.source).toBe('stated_goal_clamped_to_range_edge');
    expect(o.execution.targetSec).toBe(roundRaceTargetSec(edge));
    expect(o.statedGoal.sec).toBe(Math.round(edge * 0.8));
    expect(o.goalFeasibility.status).toBe('unlikely_currently');
  });
  it('Rule 9 · the execution target is continuous and monotone as the goal crosses the edge', async () => {
    const base = await outlookFor(null);
    const edge = base.expectedRaceDay.likelyRangeSec![0];
    let prev: number | null = null;
    let worstJump = 0; let worstInversion = 0;
    for (let g = Math.round(edge) - 40; g <= Math.round(edge) + 40; g += 1) {
      const t = (await outlookFor(g)).execution.targetSec!;
      if (prev != null) {
        worstJump = Math.max(worstJump, Math.abs(t - prev));
        worstInversion = Math.max(worstInversion, prev - t);
      }
      prev = t;
    }
    expect(worstJump).toBeLessThanOrEqual(10);
    expect(worstInversion).toBeLessThanOrEqual(0);
  });
});

describe('RaceOutlook · refusals are typed, never numbers', () => {
  it('no equivalence → no projection, no target, feasibility unavailable', async () => {
    const o = await composeRaceOutlook(fixtureRace(), TODAY, fixtureReads({ equivalenceAt: async () => null }));
    expect(o.currentProjection.expectedSec).toBeNull();
    expect(o.expectedRaceDay.expectedSec).toBeNull();
    expect(o.execution.targetSec).toBeNull();
    expect(o.execution.source).toBe('unavailable');
    expect(o.goalFeasibility.status).toBe('unavailable');
  });
  it('no race date → no runway → expected race day falls back to the current projection by name', async () => {
    const o = await composeRaceOutlook(fixtureRace({ dateISO: null }), TODAY, fixtureReads());
    expect(o.expectedImprovement.basis).toBe('no_runway');
    expect(o.expectedRaceDay.basis).toBe('current_projection');
  });
});

describe('RaceOutlook · race-day HR is its own evidence', () => {
  it('a marathon carries an expected range, an early ceiling and a checkpoint abort figure', async () => {
    const o = await outlookFor(3 * 3600);
    expect(o.execution.hr).not.toBeNull();
    const hr = o.execution.hr!;
    expect(hr.expectedRangeBpm[0]).toBeLessThan(hr.expectedRangeBpm[1]);
    expect(hr.earlyCeilingBpm).toBeLessThanOrEqual(hr.expectedRangeBpm[1]);
    expect(hr.checkpointAbortBpm).toBeGreaterThan(hr.expectedRangeBpm[1]);
    expect(hr.informationalOnly).toBe(true); // no comparable efforts on the fixture
  });
  it('no LTHR → no HR guidance, not a made-up band', async () => {
    const o = await composeRaceOutlook(fixtureRace(), TODAY, fixtureReads({ lthrBpm: null }));
    expect(o.execution.hr).toBeNull();
  });
});

describe('RaceOutlook · the bridge is derived step by step', () => {
  it('six steps, each with evidence and a change trigger', async () => {
    const o = await outlookFor(3 * 3600);
    expect(o.bridge.map((b) => b.step)).toEqual([
      'current_capacity', 'current_projection', 'training_prescription',
      'expected_improvement', 'expected_race_day', 'execution_target',
    ]);
    for (const b of o.bridge) {
      expect(b.evidence.length).toBeGreaterThan(0);
      expect(b.changeTrigger.length).toBeGreaterThan(10);
    }
    expect(o.bridge[4].valueSec).toBe(o.expectedRaceDay.expectedSec);
    expect(o.bridge[5].valueSec).toBe(o.execution.targetSec);
  });
});
