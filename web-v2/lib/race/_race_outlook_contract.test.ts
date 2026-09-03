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
 *
 * ── RULING MOVES ────────────────────────────────────────────────────────────
 *
 * EXECTARGET-1 (2026-09-03). Three assertions in this file MOVED, and they are
 * recorded here rather than quietly re-baselined, because they asserted the
 * defect:
 *
 *   was  execution.source === 'expected_race_day'                 (no goal)
 *   was  execution.source === 'stated_goal_within_range'          (goal inside)
 *   was  execution.source === 'stated_goal_clamped_to_range_edge' (goal beyond)
 *   now  execution.source === 'current_evidence'                  (all three)
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q7, locked 2026-09-03: the active
 * execution number is the PROJECTION-derived one, and "3:13:30 must not be
 * labelled the current execution target merely because it is the fast edge of
 * a wide range." On the owner's CIM that edge carried confidence 0.23 and told
 * him to race 7:22/mi while the whole block rehearsed 7:52.
 *
 * These three failing before the change and passing after IS the falsification
 * for EXECTARGET-1: the gates encoded the behaviour that was removed, and they
 * named it precisely when the removal landed.
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
  it('no goal at all still projects, and the execution target IS today’s evidence', async () => {
    const o = await outlookFor(null);
    expect(o.execution.source).toBe('current_evidence');
    expect(o.execution.targetSec).toBe(roundRaceTargetSec(o.currentProjection.expectedSec!));
    // The forecast survives as a forecast, and is faster than the target — that
    // difference is the block's intent, and it is what the upside is drawn from.
    expect(o.expectedRaceDay.expectedSec!).toBeLessThan(o.currentProjection.expectedSec!);
    // ROW-CONTRACT-1 (2026-09-02) · the outlook's own A/B/C ladder is GONE, and
    // this assertion is now that it stays gone. It was a second producer of a
    // quantity `lib/race/coach-goal.ts` already owns, 40 seconds apart from it
    // on the owner's Santa Monica row, and read by nothing.
    expect('coachSet' in (o as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('RaceOutlook · execution target · the goal never reaches it · Q7', () => {
  it('the target is the SAME number whatever the goal says', async () => {
    // The strongest form of "the goal is not evidence": walk the goal from
    // comfortable to absurd and the prescription does not move at all.
    const none = await outlookFor(null);
    const soft = await outlookFor(4 * 3600);
    const hard = await outlookFor(2 * 3600 + 20 * 60);
    expect(soft.execution.targetSec).toBe(none.execution.targetSec);
    expect(hard.execution.targetSec).toBe(none.execution.targetSec);
    expect(hard.execution.source).toBe('current_evidence');
    // ...and each still echoes the runner's own number, untouched.
    expect(hard.statedGoal.sec).toBe(2 * 3600 + 20 * 60);
    expect(hard.goalFeasibility.status).toBe('unlikely_currently');
  });

  it('the target is never the goal and never a compromise between goal and projection', async () => {
    // "Do not average the projection and goal to manufacture a compromise
    // target." Both failure modes named, on a goal well inside the old range.
    const base = await outlookFor(null);
    const inside = Math.round((base.expectedRaceDay.likelyRangeSec![0] + base.expectedRaceDay.expectedSec!) / 2);
    const o = await outlookFor(inside);
    expect(o.execution.targetSec).not.toBe(inside);
    const midpoint = Math.round((inside + o.currentProjection.expectedSec!) / 2);
    expect(o.execution.targetSec).not.toBe(midpoint);
    expect(o.execution.targetSec).toBe(roundRaceTargetSec(o.currentProjection.expectedSec!));
  });

  it('the forecast’s fast edge survives as a conditional upside with criteria · Q7 layer four', async () => {
    const o = await outlookFor(2 * 3600 + 20 * 60);
    expect(o.conditionalUpside).not.toBeNull();
    expect(o.conditionalUpside!.targetSec).toBeLessThan(o.execution.targetSec!);
    expect(o.conditionalUpside!.criteria.length).toBeGreaterThanOrEqual(4);
    // It is an UPSIDE, not a prescription: it changes nothing about what he is
    // told to run, and it does not move with the goal either.
    const soft = await outlookFor(5 * 3600);
    expect(soft.conditionalUpside!.targetSec).toBe(o.conditionalUpside!.targetSec);
  });

  it('the seam reports whether the block rehearses the pace the day asks for', async () => {
    // No plan to read is a refusal that says so, not a silent pass (Rule 11).
    const none = await outlookFor(3 * 3600);
    expect(none.blockSeam!.credible).toBe(false);
    expect(none.blockSeam!.reason).toContain('no marathon-effort session');
    const target = none.execution.paceSecPerMi!;
    // A plan whose last rehearsal is at the target IS credible.
    const carried = await composeRaceOutlook(
      fixtureRace({ statedGoalSec: 3 * 3600 }), TODAY,
      fixtureReads({ plannedLastRehearsalPaceSecPerMi: target }),
    );
    expect(carried.blockSeam!.credible).toBe(true);
    // A plan 30 s/mi slower than the day asks for is NOT — which is the exact
    // shape of the defect this whole change exists for.
    const adrift = await composeRaceOutlook(
      fixtureRace({ statedGoalSec: 3 * 3600 }), TODAY,
      fixtureReads({ plannedLastRehearsalPaceSecPerMi: target + 30 }),
    );
    expect(adrift.blockSeam!.credible).toBe(false);
    expect(adrift.blockSeam!.reason).toContain('not carried by the training');
  });

  it('Rule 9 · the execution target is FLAT as the goal walks across the old edge', async () => {
    // The cliff this walk was written for cannot exist any more, because the
    // decision the goal used to hinge on is gone. A flat line is the strongest
    // continuity result available, and the walk is kept to prove it stays flat.
    const base = await outlookFor(null);
    const edge = base.expectedRaceDay.likelyRangeSec![0];
    let prev: number | null = null;
    let worstJump = 0;
    for (let g = Math.round(edge) - 40; g <= Math.round(edge) + 40; g += 1) {
      const t = (await outlookFor(g)).execution.targetSec!;
      if (prev != null) worstJump = Math.max(worstJump, Math.abs(t - prev));
      prev = t;
    }
    expect(worstJump).toBe(0);
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
