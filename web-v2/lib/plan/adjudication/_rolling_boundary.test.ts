/**
 * THE THREE ROLLING BOUNDARIES.
 *
 * WHAT THIS ASSERTS
 *   · Demand, not stressor count, decides. The 09-21 week reads +14.1% by
 *     demand and +17.9% by mileage, and those are different answers to
 *     different questions — only one of them prices the long run and the
 *     quality minutes together.
 *   · The step allowance moves CONTINUOUSLY with completion (Rule 9). A hair's
 *     difference in what the runner completed must not produce a categorically
 *     different plan.
 *   · An unreadable input REFUSES rather than proceeding or reducing, and the
 *     safe direction differs by boundary — which is the point of having three.
 *   · No boundary ever names the long run or a race at boundary 1.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22)
 *   · Whether the demand model's coefficients are right. They are crude and say
 *     so. What is fixed here is comparing the SAME quantity on both sides.
 *   · Whether the grading upstream is correct. `absorbed` and `effort` arrive
 *     already classified; this decides what to do about them.
 *   · Whether anything schedules these. Persisting the three dates is the
 *     reassessment scheduler's job and migration 167 is not applied.
 */
import { describe, it, expect } from 'vitest';
import {
  priceWeek, demandBaseline, boundaryBeforeWeek, boundaryAfterQuality, boundaryAfterRace,
  allowedStepFor, boundariesForWeek,
} from './rolling-boundary';

const never = () => false;

// The owner's real block, as measured 2026-09-05.
const W0831 = priceWeek({ weekStartISO: '2026-08-31', weeklyMi: 46.5, longRunMi: 15, qualityMinutes: 102 });
const W0907 = priceWeek({ weekStartISO: '2026-09-07', weeklyMi: 24.4, longRunMi: 6.2, qualityMinutes: 87 });
const W0914 = priceWeek({ weekStartISO: '2026-09-14', weeklyMi: 46.8, longRunMi: 16.5, qualityMinutes: 65 });
const W0921 = priceWeek({ weekStartISO: '2026-09-21', weeklyMi: 55.2, longRunMi: 17, qualityMinutes: 110 });

describe('rolling boundary · demand is the measure', () => {
  it('prices the owner’s real weeks as measured', () => {
    expect(W0831.load.demandIndex).toBeCloseTo(83.91, 2);
    expect(W0914.load.demandIndex).toBeCloseTo(72.375, 2);
    expect(W0921.load.demandIndex).toBeCloseTo(95.75, 2);
  });

  it('the demand step is SMALLER than the mileage step, and that is the finding', () => {
    const base = demandBaseline([W0831, W0907, W0914], never);
    expect(base.known).toBe(true);
    if (!base.known) return;
    // 08-31 is the baseline, not 09-14 — it carried 102 quality minutes.
    expect(base.fromWeekISO).toBe('2026-08-31');
    const demandStep = W0921.load.demandIndex / base.demandIndex - 1;
    const mileageStep = 55.2 / 46.8 - 1;
    expect(demandStep).toBeCloseTo(0.141, 2);
    expect(mileageStep).toBeCloseTo(0.179, 2);
    expect(demandStep).toBeLessThan(mileageStep);
  });

  it('takes the MAX of the window, so a cutback cannot become the baseline', () => {
    // 09-07 is a 24.4-mile race week. A mean would let it drag the baseline
    // down and manufacture a step that is not there (Rule 8, one level down).
    const base = demandBaseline([W0831, W0907, W0914], never);
    if (!base.known) throw new Error('unreachable');
    expect(base.demandIndex).toBe(W0831.load.demandIndex);
  });

  it('refuses when every trailing week was a prescribed dip', () => {
    const b = demandBaseline([W0907], () => true);
    expect(b.known).toBe(false);
    if (!b.known) expect(b.why).toContain('prescribed dip');
  });
});

describe('boundary 1 · before the week', () => {
  const base = demandBaseline([W0831, W0907, W0914], never);
  const call = (completionRatio: number | null, allowed = 0.15) => boundaryBeforeWeek({
    proposed: W0921, baseline: base, completionRatio, allowedStepShare: allowed,
    targetWorkoutId: 'pw_tempo', targetDateISO: '2026-09-22',
  });

  it('proceeds when the step is inside what the completed week supports', () => {
    expect(call(1.0).verdict).toBe('PROCEED');
  });

  it('reduces when it is not, and names a session that is not the long run', () => {
    const d = call(0.5);
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.planWorkoutId).toBe('pw_tempo');
    expect(d.mutation?.newType).toBe('easy');
  });

  it('the ALLOWANCE moves continuously and monotonically · no cliff (Rule 9)', () => {
    /* Walks the quantity, not the verdict. My first version of this test walked
     * the VERDICT and asserted it flipped at most once — and a hard threshold
     * satisfies that too, so replacing the continuous line with
     * `completionRatio >= 0.95 ? share : 0` PASSED. Falsifying it is what
     * found that, and it is the exact failure Rule 9's audit describes: both
     * sides of a cliff are legal, so sampling points cannot see one.
     *
     * The derivative is what has to be bounded. A 1% change in what he
     * completed may not move the allowance by more than about 1% of the share. */
    const SHARE = 0.15;
    let prev = allowedStepFor(0.50, SHARE);
    for (let r = 0.51; r <= 1.0001; r += 0.01) {
      const cur = allowedStepFor(Number(r.toFixed(2)), SHARE);
      const jump = Math.abs(cur - prev);
      expect(jump, `the allowance jumped ${jump.toFixed(4)} for a 1% change in completion at `
        + `r=${r.toFixed(2)} — that is a cliff, and both sides of it are legal plans`)
        .toBeLessThan(SHARE * 0.02);
      expect(cur, 'completing more must never allow less').toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    // And it still spans a real range, or the check above is satisfied by a
    // constant that ignores completion entirely.
    expect(allowedStepFor(1.0, SHARE) - allowedStepFor(0.5, SHARE)).toBeGreaterThan(0.05);
  });

  it('the verdict still turns over across the range', () => {
    expect(call(0.5).verdict).toBe('REDUCE');
    expect(call(1.0).verdict).toBe('PROCEED');
  });

  it('refuses on an unreadable completion rather than assuming it was met', () => {
    const d = call(null);
    expect(d.verdict).toBe('REFUSE');
    expect(d.mutation).toBeNull();
  });

  it('refuses rather than cutting the long run when nothing else can give', () => {
    const d = boundaryBeforeWeek({
      proposed: W0921, baseline: base, completionRatio: 0.5, allowedStepShare: 0.15,
      targetWorkoutId: null, targetDateISO: null,
    });
    expect(d.verdict).toBe('REFUSE');
    expect(d.because).toContain('long run');
  });
});

describe('boundary 2 · after the mid-week quality session', () => {
  const weekend = { weekendLongWorkoutId: 'pw_long', weekendLongDateISO: '2026-09-27', weekendLongMi: 17 };

  it('adjusts the WEEKEND when the tempo was poorly absorbed', () => {
    const d = boundaryAfterQuality({ absorbed: 'POOR', ...weekend });
    expect(d.verdict).toBe('REDUCE');
    expect(d.mutation?.planWorkoutId).toBe('pw_long');
    expect(d.mutation?.newDistanceMi).toBe(14.5);
    expect(d.because).toContain('rather than the Tuesday being treated as though it had not happened');
  });

  it('leaves the weekend alone when it was absorbed', () => {
    expect(boundaryAfterQuality({ absorbed: 'FULL', ...weekend }).verdict).toBe('PROCEED');
    expect(boundaryAfterQuality({ absorbed: 'PARTIAL', ...weekend }).verdict).toBe('PROCEED');
  });

  it('an ungraded session is not a well-absorbed one, and not a problem either', () => {
    const d = boundaryAfterQuality({ absorbed: null, ...weekend });
    expect(d.verdict).toBe('REFUSE');
    expect(d.mutation).toBeNull();
  });
});

describe('boundary 3 · after the race, before the long run', () => {
  const long = { longWorkoutId: 'pw_long', longDateISO: '2026-09-27', longMi: 17 };

  it('a controlled C effort costs what it was priced at', () => {
    expect(boundaryAfterRace({ effort: 'CONTROLLED_C', ...long }).verdict).toBe('PROCEED');
  });

  it('grades the reduction by what the race actually cost', () => {
    const t = boundaryAfterRace({ effort: 'THRESHOLD_LIKE', ...long });
    const r = boundaryAfterRace({ effort: 'TRUE_RACE', ...long });
    expect(t.mutation?.newDistanceMi).toBe(15.3);
    expect(r.mutation?.newDistanceMi).toBe(12.8);
    // A true race must never cost LESS than a threshold effort.
    expect(r.mutation!.newDistanceMi!).toBeLessThan(t.mutation!.newDistanceMi!);
  });

  it('an unclassifiable race eases, because the cost is unknown and not zero', () => {
    // The safe direction differs from boundary 2's, deliberately: there the
    // session might not have happened, here it certainly did.
    const d = boundaryAfterRace({ effort: 'UNRELIABLE', ...long });
    expect(d.verdict).toBe('REDUCE');
    expect(d.because).toContain('unknown rather than zero');
  });
});

describe('rolling boundary · the three are durable commitments', () => {
  const reqs = boundariesForWeek({
    userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
    planId: 'pln_7636bcc0a201bf2d', planVersion: 'pln_7636bcc0a201bf2d:none',
    weekStartISO: '2026-09-21',
    assessBeforeISO: '2026-09-20',
    assessAfterQualityISO: '2026-09-23',
    assessAfterRaceISO: '2026-09-27',
    todayISO: '2026-09-05',
  });

  it('schedules exactly three, on the three dates', () => {
    expect(reqs).toHaveLength(3);
    expect(reqs.map((r) => r.assessOnISO)).toEqual(['2026-09-20', '2026-09-23', '2026-09-27']);
  });

  it('every boundary is assessed while it can still change the thing it is about', () => {
    // Rule 23: a decision that arrives after the session it governs is not a
    // decision. Boundary 1 precedes the week; 2 precedes the weekend; 3
    // precedes the long run.
    for (const r of reqs) expect(r.assessOnISO < '2026-09-28').toBe(true);
    expect(reqs[0].assessOnISO < '2026-09-21').toBe(true);
  });

  it('a boundary that never fires is NOTICED, not passed over', () => {
    for (const r of reqs) {
      expect(r.overdueAfterISO, `${r.reasonCode} can go missing silently`).toBeTruthy();
      expect(r.overdueAfterISO! > r.assessOnISO).toBe(true);
    }
  });

  it('re-requesting nightly yields one row each, not one per tick', () => {
    const again = boundariesForWeek({
      userUuid: '0645f40c-951d-4ccc-b86e-9979cd26c795',
      planId: 'pln_7636bcc0a201bf2d', planVersion: 'pln_7636bcc0a201bf2d:none',
      weekStartISO: '2026-09-21',
      assessBeforeISO: '2026-09-20', assessAfterQualityISO: '2026-09-23',
      assessAfterRaceISO: '2026-09-27',
      todayISO: '2026-09-06',   // a different night
    });
    expect(again.map((r) => r.idempotencyKey)).toEqual(reqs.map((r) => r.idempotencyKey));
    expect(new Set(reqs.map((r) => r.idempotencyKey)).size).toBe(3);
  });

  it('each says what it is for, in words a person can act on', () => {
    for (const r of reqs) {
      expect(r.reasonDetail.length).toBeGreaterThan(40);
      expect(r.reasonDetail).not.toMatch(/TODO|later/i);
    }
    expect(reqs[1].reasonDetail).toContain('rather than pretending Tuesday never occurred');
  });
});
