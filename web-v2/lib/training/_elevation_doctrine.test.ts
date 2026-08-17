/**
 * ELEVATION · one model, and every consumer must agree with it.
 *
 * The defect this locks out (2026-08-17 doctrine-conformance audit): the app
 * priced terrain three ways and they disagreed by 3-6x.
 *
 *   lib/race/pacing.ts          1 + 0.033 per 1% grade — correct, cited to
 *                               Research/11 §"Mechanical Effects of Uphill
 *                               Running" ("Energy cost rises ~3.3% per 1% of
 *                               grade up to ~10–15%").
 *   lib/training/course-impact  +10 s/mi per 100 ft/mi net climb, −7 for a
 *                               drop, +2 "gross fatigue tax", times an
 *                               invented pace scaler, cited to a Daniels
 *                               section this repo does not have.
 *
 * The light one fed the Targets projection, so the app systematically
 * under-read hilly goal races. Big Sur — 2140 ft gross gain, +260 ft net,
 * marathon at 6:51/mi — came out at 59 seconds of course cost. The cited
 * model puts it at 308.
 *
 * The registry (ELEVATION.* in lib/doctrine/registry.ts) reads 3.3% and the
 * 10-30 / 5-15 / 20 s/mi pacing bands out of Research/11 at run time. This
 * file is the cross-surface half: one input, one number, every consumer.
 */
import { describe, it, expect } from 'vitest';
import {
  GRADE_COST_PER_PCT,
  GRADE_LINEAR_LIMIT_PCT,
  CLIMB_COST_PER_FT_PER_PACE_S,
  DESCENT_RECOVERY_FRACTION,
  MAX_DESCENT_CREDIT_S_PER_MI,
  gradePaceMultiplier,
  courseElevationCostSec,
} from './elevation-model';
import { computeCourseImpact } from './course-impact';
import { buildRacePacing } from '@/lib/race/pacing';

const CITE_COST = 'Research/11 §"Mechanical Effects of Uphill Running" · "Energy cost rises ~3.3% per 1% of grade up to ~10–15%"';
const CITE_PACING = 'Research/11 §"Pacing Rule for Hilly Courses" · climbs +10-30 s/mi, descents −5-15, cap at −20';

// David's goal marathon pace, and Big Sur as course_library carries it.
const GOAL_PACE_S = 411;              // 6:51/mi
const BIG_SUR = { distanceMi: 26.2, gainFt: 2140, netFt: 260 };

describe('ELEVATION-1 · the cited coefficient, and only it', () => {
  it('uphill costs 3.3% of pace per 1% of grade', () => {
    expect(GRADE_COST_PER_PCT, CITE_COST).toBe(0.033);
    expect(gradePaceMultiplier(1, 480), CITE_COST).toBeCloseTo(1.033, 6);
    expect(gradePaceMultiplier(3, 480), CITE_COST).toBeCloseTo(1.099, 6);
  });

  it('the linear band stops where doctrine says it stops', () => {
    // "up to ~10–15%" · the engine clamps at the conservative end, so a 20%
    // wall is priced as a 10% one rather than extrapolated off the evidence.
    expect(GRADE_LINEAR_LIMIT_PCT, CITE_COST).toBe(10);
    expect(gradePaceMultiplier(20, 480)).toBe(gradePaceMultiplier(GRADE_LINEAR_LIMIT_PCT, 480));
  });

  it('the per-foot form is grade-free · that is what makes it usable on a course row', () => {
    // A mile at g% climbs 52.8·g ft and costs pace × 0.033·g seconds, so the
    // cost per foot is the same whatever g is. Verified against the direct
    // grade form at three different grades.
    for (const grade of [1, 2, 5]) {
      const perMileCost = GOAL_PACE_S * (gradePaceMultiplier(grade, GOAL_PACE_S) - 1);
      const feetClimbed = 52.8 * grade;
      expect(perMileCost / feetClimbed).toBeCloseTo(CLIMB_COST_PER_FT_PER_PACE_S * GOAL_PACE_S, 6);
    }
  });

  it('a descent gives back about half of what the climb took, capped', () => {
    expect(DESCENT_RECOVERY_FRACTION, `${CITE_PACING} · midpoints 10 back against 20 paid`).toBe(0.5);
    expect(MAX_DESCENT_CREDIT_S_PER_MI, `${CITE_PACING} · "shave 5–15 s/mi"`).toBe(15);
    // A steep descent is capped, not extrapolated · quad damage is repaid.
    const steep = gradePaceMultiplier(-8, 480);
    expect(480 - 480 * steep, CITE_PACING).toBeLessThanOrEqual(MAX_DESCENT_CREDIT_S_PER_MI + 1e-9);
  });

  it('the cost is a FRACTION of pace, so a faster runner pays fewer seconds', () => {
    const elite = courseElevationCostSec({ ...BIG_SUR, flatPaceSPerMi: 300 })!;
    const midpack = courseElevationCostSec({ ...BIG_SUR, flatPaceSPerMi: 540 })!;
    expect(elite, CITE_COST).toBeLessThan(midpack);
    // And the ratio is exactly the pace ratio · no hand-tuned scaler.
    expect(elite / midpack).toBeCloseTo(300 / 540, 6);
  });
});

describe('ELEVATION-2 · cross-surface agreement · one course, one answer', () => {
  it('the Targets course chunk is the shared model, floored at zero', () => {
    const goalSec = Math.round(GOAL_PACE_S * BIG_SUR.distanceMi);
    const chunk = computeCourseImpact({
      distanceMi: BIG_SUR.distanceMi,
      goalSec,
      elevationGainFt: BIG_SUR.gainFt,
      netElevationFt: BIG_SUR.netFt,
    }, 'editorial');
    const model = courseElevationCostSec({
      distanceMi: BIG_SUR.distanceMi,
      flatPaceSPerMi: goalSec / BIG_SUR.distanceMi,
      gainFt: BIG_SUR.gainFt,
      netFt: BIG_SUR.netFt,
    })!;
    expect(chunk.seconds, 'the projection must not re-derive elevation').toBe(Math.max(0, Math.round(model)));
  });

  it('Big Sur reads like Big Sur · 308 s, not 59', () => {
    const goalSec = Math.round(GOAL_PACE_S * BIG_SUR.distanceMi);
    const chunk = computeCourseImpact({
      distanceMi: BIG_SUR.distanceMi,
      goalSec,
      elevationGainFt: BIG_SUR.gainFt,
      netElevationFt: BIG_SUR.netFt,
    }, 'editorial');
    // The pre-audit model returned 59 s for this course. Anything in that
    // neighbourhood means the light model is back.
    expect(chunk.seconds!, `${CITE_COST} · 2140 ft of climbing is minutes, not one minute`)
      .toBeGreaterThan(240);
    expect(chunk.seconds!).toBeLessThan(400);
  });

  it('the race-splits model uses the same coefficient the course chunk does', () => {
    // Two synthetic 6-mile courses, identical except for the grade on the
    // first half. Dividing one phase ratio by the other cancels the opening
    // allowance (Research/08 §3.1, a separate doctrine that pacing.ts also
    // layers on) and leaves the terrain coefficient on its own.
    const split = (gradePct: number) => {
      const p = buildRacePacing({
        goalSec: 6 * GOAL_PACE_S,
        distanceMi: 6,
        geometry: {
          facts: { distance_mi: 6 },
          phases: [
            { label: 'first', start_mi: 0, end_mi: 3, expected_mean_grade_pct: gradePct },
            { label: 'second', start_mi: 3, end_mi: 6, expected_mean_grade_pct: 0 },
          ],
        },
      });
      expect(p.source).toBe('course');
      const [a, b] = p.phases!;
      return a.pace_s_per_mi / b.pace_s_per_mi;
    };
    const terrainOnly = split(2) / split(0);
    expect(
      terrainOnly,
      `${CITE_COST} · the splits engine and the course chunk must not price a hill differently`,
    ).toBeCloseTo(gradePaceMultiplier(2, GOAL_PACE_S), 2);
  });

  it('there is exactly one place the coefficient is written down', () => {
    // A grep-style guard on the shape that produced the three models: any
    // consumer redefining its own per-grade or per-100-ft constant.
    const files = [
      'lib/race/pacing.ts',
      'lib/training/course-impact.ts',
    ];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      expect(
        /const\s+\w*GRADE_COST\w*\s*=/.test(src) || /S_PER_MI_PER_100FT\s*=/.test(src),
        `${rel} defines its own elevation coefficient · there is one model, in lib/training/elevation-model.ts`,
      ).toBe(false);
    }
  });
});

describe('ELEVATION-3 · degenerate inputs stay honest', () => {
  it('a stub course with no elevation data returns null, never zero', () => {
    expect(courseElevationCostSec({ distanceMi: 26.2, flatPaceSPerMi: 411, gainFt: null, netFt: null })).toBeNull();
    const chunk = computeCourseImpact({ distanceMi: 26.2, goalSec: 10768, elevationGainFt: null, netElevationFt: null });
    expect(chunk.seconds, 'no data hides the chunk · it does not claim a flat course').toBeNull();
  });

  it('a net-downhill course is a credit in the model and a floor-at-zero on the panel', () => {
    const signed = courseElevationCostSec({ distanceMi: 26.2, flatPaceSPerMi: 411, gainFt: 300, netFt: -1000 })!;
    expect(signed, CITE_PACING).toBeLessThan(0);
    const chunk = computeCourseImpact({ distanceMi: 26.2, goalSec: 10768, elevationGainFt: 300, netElevationFt: -1000 });
    expect(chunk.seconds, "the brief's UX call · surface the upside in words, not a negative chunk").toBe(0);
  });
});
