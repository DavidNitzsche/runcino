/**
 * _race_course_context.test.ts · RP-4 / RP-5 · Q26'S CHAIN, MEASURED.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 *   · Whether the elevation NUMBERS are right. `resolveCourseElevation` owns
 *     provenance and trust; this reads what it produces.
 *   · Whether a course-specific TARGET exists. It does not, and this gate
 *     asserts the absence is DECLARED (`applied_to_target: false`) rather than
 *     asserting the link is built. Building it belongs to `race-outlook.ts`.
 *   · Real course_library geometry. The pacing fixtures below are synthetic
 *     phase profiles, so a defect in a specific stored course is invisible
 *     here. `_probe_course.test.ts` is the read-only harness for that.
 *   · Whether the drift check is WIRED. That is `_v5_race_route_shape.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { raceCourseContext, raceCourseContextPayload, pacingPlanDriftSec, pacingDriftToleranceSec } from './race-course-context';
import { buildRacePacing } from './pacing';
import { DESCENT_GIVEBACK_FRACTION } from '@/lib/terrain/grade-adjust';
import type { ResolvedCourseElevation } from './course-elevation';

/** The owner's CIM, as `resolveCourseElevation` actually returned it when
 *  probed read-only 2026-09-02 against the live 10,050-point GPS trace. */
const CIM: ResolvedCourseElevation = {
  elevationGainFt: 723,
  netElevationFt: -304,
  lossFt: 1041,
  provenance: 'measured',
  confidence: 'high',
  conflict: {
    status: 'SOURCE_CONFLICT',
    curatedGainFt: 100, measuredGainFt: 723, curatedNetFt: -340, measuredNetFt: -304,
    detail: 'gross gain: curated 100 ft vs measured 723 ft',
  },
  geometry: null,
  algorithmVersion: 'elevation_hysteresis_v1',
};

const CIM_MI = 26.22;
/** The owner's live execution pace on CIM, 2026-09-02. */
const CIM_PACE = 466;

describe('RP-4 · the course, described honestly', () => {
  it('LIVENESS · the CIM fixture produces a context, not a null', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE });
    expect(c, 'a fully-populated resolve produced no context').not.toBeNull();
    expect(c!.gainFt).toBe(723);
  });

  it('gross descent is derived from gain and net, never invented', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.lossFt).toBe(723 - -304); // 1027
    expect(c.netFt).toBe(-304);
  });

  it('THE COUNTERINTUITIVE PART · CIM is net downhill and still costs time', () => {
    // Q26: "The downhill adjustment should be modest and evidence-bounded. It
    // must not create a materially more aggressive race plan merely because
    // CIM is net downhill." The canonical giveback is 0.50, so 723 ft up
    // against 1027 ft down is still a net climb in cost terms.
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.netFt!).toBeLessThan(0);
    expect(c.adjustmentSec, 'a net-downhill course priced as a time gift is the defect Q26 names').toBeGreaterThan(0);
    expect(c.meaning).toContain('about half');
  });

  it('Rule 17 · the figures and the meaning are separate strings', () => {
    // The v5 detail already prints gain and net as elevation footnotes. If the
    // meaning carried them too the runner would read the same numbers twice on
    // one screen, and Rule 17 yields on the rendered text.
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.sentence).toContain('723 ft');
    expect(c.meaning, 'the meaning must not restate the footnotes').not.toContain('723');
  });

  it('an untrustworthy profile keeps its figures and loses its interpretation', () => {
    const c = raceCourseContext({
      resolved: { ...CIM, confidence: 'low', conflict: null },
      distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE,
    })!;
    expect(c.sentence).toContain('723 ft');
    expect(c.meaning, 'an interpretation is an argument; a measurement is not').toBeNull();
  });

  it('the coefficient it used is the ONE canonical one', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.model.descentGivebackFraction).toBe(DESCENT_GIVEBACK_FRACTION);
    expect(DESCENT_GIVEBACK_FRACTION).toBe(0.5);
  });

  it('a source disagreement is stated, not swallowed', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.conflictNote).toContain('curated 100 ft vs measured 723 ft');
  });

  it('RP-5 · the absence of a course-adjusted target is DECLARED, never implied', () => {
    const p = raceCourseContextPayload(raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE }))!;
    expect(p.applied_to_target, 'a surface must never be able to read this as a course-adjusted number').toBe(false);
  });

  it('THE TRUST GATE · a low-confidence trace reports feet but refuses seconds', () => {
    // `course-elevation.ts` lets a LOW-confidence trace through when there is
    // no curated row — the common case for a self-added race — and low there
    // is self-refuting ("too coarse for gross gain"). Feet are a measurement;
    // seconds are an argument from it.
    const c = raceCourseContext({
      resolved: { ...CIM, confidence: 'low', conflict: null },
      distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE,
    })!;
    expect(c.gainFt, 'the measurement is still reported').toBe(723);
    expect(c.adjustmentSec, 'Rule 11 · a refusal is null, never a zero anyone could spend').toBeNull();
  });

  it('and a high-confidence trace does produce seconds · the gate is not simply always off', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })!;
    expect(c.adjustmentSec).not.toBeNull();
  });

  it('Rule 11 · no elevation data at all is a refusal, not a flat course', () => {
    expect(raceCourseContext({
      resolved: { ...CIM, elevationGainFt: null, netElevationFt: null, lossFt: null, provenance: 'unknown', confidence: 'unknown', conflict: null },
      distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE,
    })).toBeNull();
    expect(raceCourseContext({ resolved: null, distanceMi: CIM_MI, flatPaceSecPerMi: CIM_PACE })).toBeNull();
  });

  it('no execution pace means no adjustment, and the profile is still described', () => {
    const c = raceCourseContext({ resolved: CIM, distanceMi: CIM_MI, flatPaceSecPerMi: null })!;
    expect(c.adjustmentSec).toBeNull();
    expect(c.sentence).toContain('723 ft');
    expect(c.meaning).toBeNull();
  });
});

describe('RP-5 · Q26 · the split plan reproduces the target it was given', () => {
  /**
   * "The split plan may redistribute effort for climbing and descending, but
   * its total must reproduce the course-adjusted target. Never adjust the
   * overall target and then apply another net course benefit inside the
   * splits."
   *
   * `lib/race/pacing.ts` asserts this in its own header. Rule 20: a header
   * comment asserting an invariant is documentation, not enforcement.
   */
  const NET_DOWNHILL_COURSE = {
    facts: { distance_mi: 26.22 },
    phases: [
      { label: 'Dam drop', start_mi: 0, end_mi: 2, expected_mean_grade_pct: -1.8 },
      { label: 'Rollers', start_mi: 2, end_mi: 7, expected_mean_grade_pct: 0.6 },
      { label: 'Hills', start_mi: 7, end_mi: 9.5, expected_mean_grade_pct: 0.2 },
      { label: 'Descent', start_mi: 9.5, end_mi: 10.9, expected_mean_grade_pct: -1.4 },
      { label: 'Valley', start_mi: 10.9, end_mi: 26.22, expected_mean_grade_pct: -0.2 },
    ],
  };

  it('a NET DOWNHILL course does not buy itself a second benefit inside the splits', () => {
    const target = Math.round(CIM_PACE * CIM_MI);
    const p = buildRacePacing({ goalSec: target, distanceMi: CIM_MI, geometry: NET_DOWNHILL_COURSE });
    expect(p.phases, 'no phases means nothing was measured').not.toBeNull();
    const drift = pacingPlanDriftSec(p.phases, target)!;
    expect(Math.abs(drift), `phase integral drifted ${drift}s from the ${target}s target`)
      .toBeLessThanOrEqual(pacingDriftToleranceSec(CIM_MI));
    // And the redistribution really happened — a check that passes because
    // every phase is identical proves nothing (Rule 18).
    const paces = new Set(p.phases!.map((x) => x.pace_s_per_mi));
    expect(paces.size, 'the plan did not redistribute at all').toBeGreaterThan(1);
  });

  it('a course with no profile still sums to its target', () => {
    const target = 6109;
    const p = buildRacePacing({ goalSec: target, distanceMi: 13.11, geometry: null });
    const drift = pacingPlanDriftSec(p.phases, target)!;
    expect(Math.abs(drift)).toBeLessThanOrEqual(pacingDriftToleranceSec(13.11));
  });

  it('FALSIFICATION · a plan carrying a hidden net benefit IS caught', () => {
    const target = Math.round(CIM_PACE * CIM_MI);
    // Every phase 20 s/mi quicker than the target pace: the exact shape of
    // "adjust the target, then apply another net course benefit in the splits".
    const cheating = [{ start_mi: 0, end_mi: CIM_MI, pace_s_per_mi: CIM_PACE - 20 }];
    const drift = pacingPlanDriftSec(cheating, target)!;
    expect(drift).toBeLessThan(0);
    expect(Math.abs(drift), 'the tolerance is wide enough to hide a real second adjustment')
      .toBeGreaterThan(pacingDriftToleranceSec(CIM_MI));
  });

  it('the tolerance is rounding-sized, not a licence', () => {
    // At most one second per mile, which is what whole-second-per-mile phase
    // rounding can accumulate to. On CIM that is 27s against a 12219s target,
    // or 0.2%.
    expect(pacingDriftToleranceSec(CIM_MI)).toBeLessThanOrEqual(Math.ceil(CIM_MI));
    expect(pacingDriftToleranceSec(CIM_MI) / (CIM_PACE * CIM_MI)).toBeLessThan(0.005);
  });

  it('Rule 11 · no phases is null, not a zero drift', () => {
    expect(pacingPlanDriftSec(null, 12219)).toBeNull();
    expect(pacingPlanDriftSec([], 12219)).toBeNull();
  });
});
