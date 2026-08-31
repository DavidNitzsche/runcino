/**
 * _training_lead_e2e.test.ts · TRAINING-LEAD-1 (2026-08-25).
 *
 * The question the owner actually asked: "I train well for weeks with no race.
 * What does my prescribed pace do?"
 *
 * This walks the whole chain the `training_lead` trigger sets off, with the
 * real functions at every hop and no database:
 *
 *   nailed sessions
 *     → bestRecentVdot            (the capped training read)
 *     → measuredProgressFraction  (recompute-paces.ts · the evidence gate)
 *     → blendedTPaceForWeek       (the per-week threshold anchor)
 *     → marathonPaceSPerMi        (the MP session on a future unsealed week)
 *     → achievableRaceTarget      (the prescribed race-day target)
 *
 * `recomputePacesForPlan` is the function that performs these hops against the
 * database; every number it derives comes from the calls below, at the same
 * `vdotNow`. Driving the pure chain proves the arithmetic without asserting
 * anything about a live plan row.
 */
import { describe, it, expect } from 'vitest';
import { bestRecentVdot, tPaceFromVdot, vdotFromRace } from '@/lib/training/vdot';
import { measuredProgressFraction, blendedTPaceForWeek, maxSeasonalVdotGain } from './recompute-paces';
import { marathonPaceSPerMi } from './spec-builder';
import { achievableRaceTarget } from '@/lib/training/achievable-target';
import { trainingLeadFires } from './adapt';

const TODAY = '2026-10-12';
const GOAL_SEC = 10800;          // 3:00:00 at CIM
const DIST = 26.22;
const TOTAL_WEEKS = 14;
const AUTHORING_VDOT = 44.1;     // AFC half, 1:41:53

const AFC = [{
  slug: 'afc', name: 'AFC Half', date: '2026-08-17', priority: 'A',
  distance_mi: 13.1, finish_seconds: 6113,
}];

function nailed(weeks: number, paceSPerMi: number) {
  const runs: Array<Record<string, unknown>> = [];
  for (let w = 0; w < weeks; w++) {
    for (const off of [3, 6]) {
      runs.push({
        id: `t${w}-${off}`,
        date: new Date(Date.parse(TODAY + 'T12:00:00Z') - ((w * 7) + off) * 86400000)
          .toISOString().slice(0, 10),
        workout_type: 'threshold', distance_mi: 5,
        finish_seconds: Math.round(5 * paceSPerMi),
        avg_hr: 168, max_hr: 188, zone: 'threshold',
      });
    }
  }
  return runs;
}

/** Everything a future unsealed week is prescribed at, from one `vdotNow`. */
function prescribedAt(vdotNow: number) {
  const goalVdot = vdotFromRace(GOAL_SEC, DIST);
  const measured = measuredProgressFraction(AUTHORING_VDOT, vdotNow, goalVdot);
  const currentT = tPaceFromVdot(vdotNow)!;
  const goalTraw = Math.round(GOAL_SEC / DIST) - 18;
  const floorT = tPaceFromVdot(vdotNow + maxSeasonalVdotGain(TOTAL_WEEKS, DIST))!;
  const goalT = Math.max(goalTraw, floorT);
  const weekT = blendedTPaceForWeek({
    currentT, goalT, weekIdx: 6, phase: 'RACE-SPECIFIC',
    buildWeeks: 11, measuredProgressFraction: measured,
  })!;
  const mp = marathonPaceSPerMi({ tPaceSec: weekT, easyAnchorTSec: currentT });
  const race = achievableRaceTarget({
    goalSec: GOAL_SEC, currentVdot: vdotNow, raceDistanceMi: DIST, totalWeeks: TOTAL_WEEKS,
  })!;
  return { measured, currentT, weekT, mp, raceTargetSec: race.targetSec, racePace: race.paceSPerMi };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/mi`;
const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;

describe('six weeks of great training, no race', () => {
  const stalled = prescribedAt(AUTHORING_VDOT);
  const creditedVdot = bestRecentVdot(
    AFC as never, TODAY, 180, nailed(6, 425) as never, 4).best!.vdot;
  const credited = prescribedAt(creditedVdot);

  it('prints the before and after', () => {
    const rows = [
      ['', 'BEFORE (nothing fired)', 'AFTER (training_lead)'],
      // 2026-08-30 · was hardcoded `AUTHORING_VDOT + 1`, which printed the
      // retired race ceiling rather than what the run actually resolved.
      ['anchor VDOT', AUTHORING_VDOT.toFixed(1), creditedVdot.toFixed(1)],
      ['measuredProgressFraction', String(stalled.measured), credited.measured!.toFixed(3)],
      ['week T-pace', mmss(stalled.weekT), mmss(credited.weekT)],
      ['MP session (T+18)', mmss(stalled.mp), mmss(credited.mp)],
      ['prescribed race target', hms(stalled.raceTargetSec), hms(credited.raceTargetSec)],
      ['race pace', mmss(stalled.racePace), mmss(credited.racePace)],
    ];
    console.log('\n' + rows.map((r) => r[0].padEnd(26) + String(r[1]).padEnd(24) + r[2]).join('\n'));
  });

  it('the evidence gate moves off zero', () => {
    expect(stalled.measured).toBe(0);
    expect(credited.measured!).toBeGreaterThan(0);
  });

  it('the week\'s threshold anchor tightens', () => {
    expect(credited.weekT).toBeLessThan(stalled.weekT);
  });

  it('the MP session on a future unsealed week tightens', () => {
    expect(credited.mp).toBeLessThan(stalled.mp);
  });

  it('the prescribed race target tightens, and never overtakes the goal', () => {
    expect(credited.raceTargetSec).toBeLessThan(stalled.raceTargetSec);
    // 2026-08-30 · was `toBeGreaterThan(GOAL_SEC)`, on the reasoning that "one
    // training point does not close a 9.4-point gap". With the race ceiling
    // retired the move is no longer one point — this fixture is twelve
    // sessions at VDOT-48.4 threshold pace — so on THIS corpus the projection
    // does reach the goal and `achievableRaceTarget` clamps it there.
    //
    // The honesty property is what matters and it is unchanged: the target may
    // equal the goal, and must never claim to beat it. A target faster than
    // the goal would be the engine renegotiating a stated goal upward, which
    // is the one thing it may never do.
    expect(credited.raceTargetSec).toBeGreaterThanOrEqual(GOAL_SEC);
  });

  it('every move is bounded · by the evidence and the seasonal gain ceiling', () => {
    // The old bounds here were constants in seconds (mp < 20 s/mi, target < 5
    // min) that only ever held because the race ceiling capped the read at +1.
    // They were the retired rule restated in a different unit. The bounds that
    // actually exist are named instead:
    //
    //  · the ANCHOR's threshold can never be faster than the threshold the
    //    sessions were actually run at, and
    //  · the anchor itself can never exceed what the corpus corroborated plus
    //    the doctrinal +1 lead.
    //
    // Deliberately NOT asserted on `weekT`: that is a FUTURE race-specific
    // week's prescription, and `blendedTPaceForWeek` is supposed to run ahead
    // of current fitness toward the goal. Pinning it here would be asserting
    // that the plan may not progress, which is the opposite of the rule this
    // change serves.
    //
    // And deliberately NOT on the race target against `maxSeasonalVdotGain`:
    // `achievableRaceTarget` clamps to `prescriptionFloorSec(ceiling,
    // GOAL_OPTIMISM_TOLERANCE)`, so a goal inside its tolerance band is
    // returned as the runner's own goal by design (Rule 9). That band is that
    // function's business and `achievable-target`'s own suite owns it; the
    // over-promise guard that belongs HERE is that the target never gets
    // FASTER than the goal, which the test above asserts.
    expect(credited.currentT).toBeGreaterThanOrEqual(425 - 1);
    const r = bestRecentVdot(AFC as never, TODAY, 180, nailed(6, 425) as never, 4);
    expect(r.corpus.ok).toBe(true);
    if (!r.corpus.ok) return;
    expect(r.best!.vdot).toBeLessThanOrEqual(r.corpus.vdot + 1.0 + 1e-9);
  });

  it('two weeks of the same evidence already qualifies', () => {
    const twoWk = bestRecentVdot(AFC as never, TODAY, 180, nailed(3, 425) as never, 4).best!.vdot;
    expect(trainingLeadFires(AUTHORING_VDOT, twoWk)).toBe(true);
    expect(prescribedAt(twoWk).mp).toBeLessThan(stalled.mp);
  });

  it('mediocre training changes nothing', () => {
    // Sessions run at his CURRENT threshold pace imply no lead at all.
    const flat = bestRecentVdot(AFC as never, TODAY, 180, nailed(6, 462) as never, 4).best!.vdot;
    expect(trainingLeadFires(AUTHORING_VDOT, flat)).toBe(false);
    expect(prescribedAt(flat).mp).toBe(stalled.mp);
  });
});
