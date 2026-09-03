/**
 * MPCONTRACT-1 · the six marathon paces, and the seam between the block and
 * race day.
 *
 * The numbers below are the owner's own, read off the live resolvers at the
 * 2026-08-30 authoring instant, so this file is a statement about a real case
 * rather than about a fixture someone chose to make the arithmetic work.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It is a pure-function test and cannot see the plan. It cannot tell whether
 * the block actually AUTHORED the session whose pace it prices — the seam is
 * only as good as the `lastRehearsalSecPerMi` its caller passes, and a caller
 * that passes the INTENDED dose instead of the authored one would pass here and
 * be wrong (`_mp_doctrine.test.ts` reads composed plans for exactly that
 * reason). It cannot see the HR ceiling's correctness: the ceiling is passed in
 * from the canonical HR owner and this file only checks that it is carried. It
 * has no opinion about whether the pace resolver's band is right — if
 * `marathonRangeSecPerMi` is wrong, every number here is wrong and green. And
 * it cannot catch a SURFACE that stops calling this contract and computes its
 * own marathon pace; that needs a source scan, which is
 * `MPCONTRACT.no-second-marathon-target` in the doctrine registry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  marathonPaceContract,
  marathonEffortPrescription,
  marathonSeam,
  MARATHON_EFFORT_LADDER_T,
  MARATHON_PACE_BAND_S_PER_MI,
  CONDITIONAL_UPSIDE_CRITERIA,
} from './marathon-pace-contract';

/** The owner's live quantities, 2026-08-30. */
const OWNER = {
  goalPace: 412,                       // 3:00:00 → 6:52/mi
  currentProjectionPace: 467,          // 3:23:53 → 7:47/mi
  currentProjectionRange: [453, 481] as const,   // 3:17:46 - 3:30:00
  trainingPoint: 472,                  // 7:52/mi
  trainingBand: [460, 488] as const,   // 7:40 - 8:08
  forecastPace: 458,                   // 3:19:57 → 7:38/mi
  forecastFinish: 11997,
  upsidePace: 443,                     // 3:13:24 → 7:23/mi
  upsideFinish: 11604,
};

function ownerContract() {
  return marathonPaceContract({
    aspirationalGoalSecPerMi: OWNER.goalPace,
    currentProjectionSecPerMi: OWNER.currentProjectionPace,
    currentProjectionRangeSecPerMi: OWNER.currentProjectionRange,
    trainingPrescriptionSecPerMi: OWNER.trainingPoint,
    trainingBandSecPerMi: OWNER.trainingBand,
    blockForecast: {
      paceSecPerMi: OWNER.forecastPace, finishSec: OWNER.forecastFinish, confidence: 0.23,
      assumption: 'population improvement rate over 11 build weeks',
    },
    upsidePaceSecPerMi: OWNER.upsidePace,
    upsideFinishSec: OWNER.upsideFinish,
  });
}

describe('MPCONTRACT-1 · the quantities stay apart', () => {
  it('the goal never reaches the active target · Q7', () => {
    const c = ownerContract();
    // The defect: `stated_goal_clamped_to_range_edge` made 7:22 the prescription
    // because the goal was faster than everything. Nothing in this contract can
    // do that — the goal is carried and never spent.
    expect(c.aspirationalGoalSecPerMi).toBe(OWNER.goalPace);
    expect(c.currentProjectionSecPerMi).toBe(OWNER.currentProjectionPace);
    expect(c.currentProjectionSecPerMi).not.toBe(c.aspirationalGoalSecPerMi);
    // "Do not average the projection and goal to manufacture a compromise
    // target." A midpoint would be 439/mi; the active number is the projection.
    expect(c.currentProjectionSecPerMi).not.toBe(Math.round((OWNER.goalPace + OWNER.currentProjectionPace) / 2));
  });

  it('the conditional upside is named, faster than the active target, and carries its criteria', () => {
    const c = ownerContract();
    expect(c.conditionalUpside).not.toBeNull();
    expect(c.conditionalUpside!.paceSecPerMi).toBe(OWNER.upsidePace);
    expect(c.conditionalUpside!.paceSecPerMi).toBeLessThan(c.currentProjectionSecPerMi!);
    expect(c.conditionalUpside!.criteria).toEqual(CONDITIONAL_UPSIDE_CRITERIA);
    expect(CONDITIONAL_UPSIDE_CRITERIA.length).toBeGreaterThanOrEqual(4);
  });

  it('an "upside" that is not faster than the active target is refused, not renamed', () => {
    const c = marathonPaceContract({
      ...{
        aspirationalGoalSecPerMi: OWNER.goalPace,
        currentProjectionSecPerMi: 440,
        currentProjectionRangeSecPerMi: OWNER.currentProjectionRange,
        trainingPrescriptionSecPerMi: OWNER.trainingPoint,
        trainingBandSecPerMi: OWNER.trainingBand,
        blockForecast: null,
      },
      upsidePaceSecPerMi: 450, upsideFinishSec: 11800,
    });
    expect(c.conditionalUpside).toBeNull();
  });

  it('a missing band is not a zero-width band · Rule 11', () => {
    const c = marathonPaceContract({
      aspirationalGoalSecPerMi: null, currentProjectionSecPerMi: null,
      currentProjectionRangeSecPerMi: null,
      trainingPrescriptionSecPerMi: 472, trainingBandSecPerMi: null,
      blockForecast: null, upsidePaceSecPerMi: null, upsideFinishSec: null,
    });
    expect(c.trainingBandSecPerMi).toEqual([472, 472]);
    // With no headroom the ladder cannot move, at any position.
    for (const t of [0, 0.5, 1]) {
      expect(marathonEffortPrescription({ contract: c, ladderT: t, hrCeilingBpm: null, mpMi: 6 }).paceSecPerMi).toBe(472);
    }
  });
});

describe('MPCONTRACT-1 · the workout prescription · Q8 + Q30', () => {
  it('the three ladder rungs land inside the ruling’s own bands', () => {
    const c = ownerContract();
    const at = (t: number) => marathonEffortPrescription({ contract: c, ladderT: t, hrCeilingBpm: 158, mpMi: 8 }).paceSecPerMi;
    // "Early marathon-specific work | 7:50-7:55/mi"
    expect(at(MARATHON_EFFORT_LADDER_T.early)).toBeGreaterThanOrEqual(470);
    expect(at(MARATHON_EFFORT_LADDER_T.early)).toBeLessThanOrEqual(475);
    // "Middle progression | ~7:45-7:50/mi"
    expect(at(MARATHON_EFFORT_LADDER_T.middle)).toBeGreaterThanOrEqual(465);
    expect(at(MARATHON_EFFORT_LADDER_T.middle)).toBeLessThanOrEqual(470);
    // "Later peak-specific work | ~7:38-7:45/mi"
    expect(at(MARATHON_EFFORT_LADDER_T.later)).toBeGreaterThanOrEqual(458);
    expect(at(MARATHON_EFFORT_LADDER_T.later)).toBeLessThanOrEqual(465);
  });

  it('the ladder never walks past the runner’s own published band', () => {
    const c = ownerContract();
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const p = marathonEffortPrescription({ contract: c, ladderT: t, hrCeilingBpm: null, mpMi: 6 }).paceSecPerMi;
      expect(p).toBeGreaterThanOrEqual(c.trainingBandSecPerMi[0]);
      expect(p).toBeLessThanOrEqual(c.trainingBandSecPerMi[1]);
    }
    // And it never approaches the goal, whatever the goal is.
    const wild = marathonPaceContract({
      aspirationalGoalSecPerMi: 300, currentProjectionSecPerMi: OWNER.currentProjectionPace,
      currentProjectionRangeSecPerMi: OWNER.currentProjectionRange,
      trainingPrescriptionSecPerMi: OWNER.trainingPoint, trainingBandSecPerMi: OWNER.trainingBand,
      blockForecast: null, upsidePaceSecPerMi: null, upsideFinishSec: null,
    });
    expect(marathonEffortPrescription({ contract: wild, ladderT: 1, hrCeilingBpm: null, mpMi: 8 }).paceSecPerMi)
      .toBe(marathonEffortPrescription({ contract: ownerContract(), ladderT: 1, hrCeilingBpm: null, mpMi: 8 }).paceSecPerMi);
  });

  it('moves continuously and monotonically in t · Rule 9', () => {
    const c = ownerContract();
    let prev: number | null = null;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const p = marathonEffortPrescription({ contract: c, ladderT: t, hrCeilingBpm: null, mpMi: 6 }).paceSecPerMi;
      if (prev != null) {
        expect(p, 'the ladder got slower as t grew').toBeLessThanOrEqual(prev);
        expect(prev - p, 'a 0.01 step of t moved the pace more than a second').toBeLessThanOrEqual(1);
      }
      prev = p;
    }
  });

  it('carries a range, an HR ceiling, an assumption, a fallback and disagreement guidance · Q30', () => {
    const p = marathonEffortPrescription({ contract: ownerContract(), ladderT: 0.5, hrCeilingBpm: 158, mpMi: 8 });
    expect(p.rangeSecPerMi[1] - p.rangeSecPerMi[0]).toBe(2 * MARATHON_PACE_BAND_S_PER_MI);
    expect(p.rangeSecPerMi[0]).toBeLessThan(p.paceSecPerMi);
    expect(p.hrCeilingBpm).toBe(158);
    expect(p.assumption.length).toBeGreaterThan(20);
    // "Do not hardcode 160 bpm" — the ceiling is whatever the caller resolved.
    expect(p.guidance).toContain('158');
    expect(p.guidance.toLowerCase()).toContain('heat');
    expect(p.guidance.toLowerCase()).toContain('protect the effort');
    // The fallback is today's supported effort, which needs no forecast.
    expect(p.fallbackSecPerMi).toBe(OWNER.trainingPoint);
    expect(p.rehearses).toBe('forecast_development');
    const early = marathonEffortPrescription({ contract: ownerContract(), ladderT: 0, hrCeilingBpm: 158, mpMi: 4 });
    expect(early.rehearses).toBe('current_capability');
    expect(early.assumption.toLowerCase()).toContain('none');
  });

  it('a degenerate band whose fast edge is slower than the point can only hold', () => {
    const c = marathonPaceContract({
      aspirationalGoalSecPerMi: null, currentProjectionSecPerMi: null, currentProjectionRangeSecPerMi: null,
      trainingPrescriptionSecPerMi: 460, trainingBandSecPerMi: [470, 490],
      blockForecast: null, upsidePaceSecPerMi: null, upsideFinishSec: null,
    });
    expect(marathonEffortPrescription({ contract: c, ladderT: 1, hrCeilingBpm: null, mpMi: 8 }).paceSecPerMi).toBe(460);
  });
});

describe('MPCONTRACT-1 · the seam', () => {
  it('the OLD execution target was not carried by the block · this is the defect', () => {
    // 7:46 rehearsed against a 7:22 target: 24 s/mi, five band-widths.
    const s = marathonSeam({ lastRehearsalSecPerMi: 466, executionSecPerMi: 443 });
    expect(s.credible).toBe(false);
    expect(s.gapSecPerMi).toBe(23);
    expect(s.reason).toContain('not carried by the training');
  });

  it('the NEW active target is carried by the block', () => {
    // The ladder's last supported rehearsal is the middle rung (7:46) and the
    // active target is the current projection (7:47).
    const s = marathonSeam({ lastRehearsalSecPerMi: 466, executionSecPerMi: OWNER.currentProjectionPace });
    expect(s.credible).toBe(true);
    expect(s.gapSecPerMi).toBeLessThanOrEqual(0);
  });

  it('one pace band of gap is credible and one second more is not', () => {
    expect(marathonSeam({ lastRehearsalSecPerMi: 470, executionSecPerMi: 470 - MARATHON_PACE_BAND_S_PER_MI }).credible).toBe(true);
    expect(marathonSeam({ lastRehearsalSecPerMi: 470, executionSecPerMi: 470 - MARATHON_PACE_BAND_S_PER_MI - 1 }).credible).toBe(false);
  });

  it('no rehearsal and no target are different facts, and neither is credible · Rule 11', () => {
    const a = marathonSeam({ lastRehearsalSecPerMi: null, executionSecPerMi: 460 });
    const b = marathonSeam({ lastRehearsalSecPerMi: 460, executionSecPerMi: null });
    expect(a.credible).toBe(false);
    expect(b.credible).toBe(false);
    expect(a.reason).not.toBe(b.reason);
    expect(a.gapSecPerMi).toBeNull();
  });
});

describe('MPCONTRACT-1 · liveness and isolation', () => {
  it('this module reaches no database at any depth · Rule 19/20', () => {
    // The header claims it; this checks it, rather than the sentence standing
    // alone. One hop is enough because the only import is a sibling pure module.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/training/marathon-pace-contract.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.filter((i) => !i.startsWith('node:')), 'the contract grew a runtime import').toEqual([]);
    expect(src).not.toContain('@/lib/db');
  });

  it('the ladder positions are the three the ruling names, in order', () => {
    const ts = Object.values(MARATHON_EFFORT_LADDER_T);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(ts[0]).toBe(0);
    expect(ts[ts.length - 1]).toBe(1);
    expect(new Set(ts).size).toBe(ts.length);
  });
});
