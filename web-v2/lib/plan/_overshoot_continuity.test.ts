/**
 * _overshoot_continuity.test.ts · CONTINUOUS-OVERSHOOT-1 · Rule 9 · the
 * overshoot bar does not fall off a cliff at 5 scheduled miles.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `overshootFires` picked its baseline with
 *
 *   const prescribed = scheduledMi != null && scheduledMi >= 5 ? scheduledMi : capMi;
 *
 * `scheduled_mi` arrives from `COALESCE(SUM(pw.distance_mi), 0)` and is
 * therefore NEVER null — 0 means "no plan covers this window". So that `>= 5`
 * was a MILEAGE THRESHOLD standing in for a DATA-PRESENCE QUESTION, and it put
 * a cliff on a continuous quantity: with the beginner cap of 45 and no chronic
 * floor, a window scheduling 4.9 mi was judged against 45 mi and one scheduling
 * 5.0 mi against 5 mi. The bar fell FORTY MILES for a tenth of a mile of
 * schedule — and it fell in the perverse direction, so the plan that asked for
 * slightly more got the runner cut.
 *
 * Reachable on the one window every new plan has: the first, where the trailing
 * seven days overlap the plan's start by a day or two and the scheduled sum is
 * a single short easy run.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 *
 * Ask the data question directly. `scheduledDays > 0` says a plan covers this
 * window; then the baseline is `max(scheduledMi, chronic)`, which is continuous
 * and monotone in `scheduledMi` with no threshold on it at all. The cliff is
 * removed rather than relocated, because the decision now rests on a discrete,
 * honest fact instead of a proxy for one.
 *
 * A caller that cannot answer `scheduledDays` keeps the old proxy, so the
 * pre-Rule-9 behaviour is byte-identical for them — which is what keeps the
 * existing invariant tests meaningful.
 *
 * Rule 18: falsified against the unfixed engine before landing — the walk
 * reported a 40.0 mi jump in the baseline, and a firing flip, for 0.1 mi of
 * scheduled volume.
 */
import { describe, it, expect } from 'vitest';
import {
  overshootFires,
  overshootBaseline,
  MEANINGFUL_SCHEDULE_MI,
  EXPERIENCE_CAPS_MI,
} from './adapt';

const CAP = EXPERIENCE_CAPS_MI.beginner;

/** A window a plan genuinely covers · the case the proxy got wrong. */
const covered = (scheduledDays = 3) => ({ scheduledDays });

describe('CONTINUOUS-OVERSHOOT-1 · the walk reaches the boundary it is aimed at', () => {
  it('liveness · the sweep spans both sides of the old 5 mi proxy', () => {
    expect(MEANINGFUL_SCHEDULE_MI).toBe(5);
    expect(CAP).toBeGreaterThan(MEANINGFUL_SCHEDULE_MI * 2);
    // Without the data answer, the proxy is still in force — that is the
    // compatibility path, and it must still be reachable.
    expect(overshootBaseline(4.9, CAP, {}).baseline).toBe(CAP);
    expect(overshootBaseline(5.0, CAP, {}).baseline).toBe(5);
  });
});

describe('CONTINUOUS-OVERSHOOT-1 · no step in the baseline across 5 mi', () => {
  const STEP = 0.1;

  it('the baseline is CONTINUOUS in scheduled volume', () => {
    let prev = overshootBaseline(0, CAP, covered()).baseline;
    let worst = 0;
    let worstAt = 0;
    for (let s = STEP; s <= 20; s += STEP) {
      const mi = Math.round(s * 10) / 10;
      const cur = overshootBaseline(mi, CAP, covered()).baseline;
      if (Math.abs(cur - prev) > worst) { worst = Math.abs(cur - prev); worstAt = mi; }
      prev = cur;
    }
    expect(
      worst,
      `overshoot baseline jumped ${worst.toFixed(1)} mi at ${worstAt.toFixed(1)} mi scheduled`,
    ).toBeLessThanOrEqual(STEP + 1e-9);
  });

  it('a plan that scheduled MORE never lowers the bar', () => {
    let prev = overshootBaseline(0, CAP, covered()).baseline;
    for (let s = STEP; s <= 20; s += STEP) {
      const mi = Math.round(s * 10) / 10;
      const cur = overshootBaseline(mi, CAP, covered()).baseline;
      expect(
        cur,
        `bar FELL from ${prev.toFixed(1)} to ${cur.toFixed(1)} as the schedule reached ${mi} mi`,
      ).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
  });

  it('the FIRING never flips on a hair of scheduled volume', () => {
    for (const completed of [6, 8, 10, 15, 30, 60]) {
      let prev = overshootFires(completed, 0, CAP, covered());
      for (let s = STEP; s <= 20; s += STEP) {
        const mi = Math.round(s * 10) / 10;
        const cur = overshootFires(completed, mi, CAP, covered());
        // Firing may only ever turn OFF as the schedule grows, never on.
        if (cur && !prev) {
          throw new Error(
            `overshoot STARTED firing as the schedule grew to ${mi} mi ` +
            `(completed ${completed} mi) · the plan that asked for more got the cut`,
          );
        }
        prev = cur;
      }
    }
  });
});

describe('CONTINUOUS-OVERSHOOT-1 · the intent the proxy was protecting survives', () => {
  it('no plan covering the window → the experience cap, not a zero bar', () => {
    // The pinned invariant: nothing scheduled means no prescription to
    // overshoot, so the population cap is the only claim available.
    expect(overshootBaseline(0, CAP, { scheduledDays: 0 }).baseline).toBe(CAP);
    expect(overshootBaseline(0, CAP, { scheduledDays: 0 }).usedSchedule).toBe(false);
    expect(overshootFires(60, 0, CAP, { scheduledDays: 0 })).toBe(true);   // 60 > 56.25
    expect(overshootFires(50, 0, CAP, { scheduledDays: 0 })).toBe(false);  // 50 <= 56.25
  });

  it('a covered window uses the plan, floored by the runner’s own chronic load', () => {
    expect(overshootBaseline(3, CAP, { ...covered(), chronicWeeklyMi: 40 }).baseline).toBe(40);
    expect(overshootBaseline(3, CAP, covered()).baseline).toBe(3);
    expect(overshootBaseline(50, CAP, { ...covered(), chronicWeeklyMi: 40 }).baseline).toBe(50);
  });

  it('a recovery block is still silenced outright', () => {
    expect(overshootFires(90, 3, CAP, { ...covered(), recoveryBlock: true })).toBe(false);
  });

  it('an omitted scheduledDays is byte-identical to the pre-Rule-9 proxy', () => {
    for (const done of [10, 30, 55, 60, 120]) {
      for (const sched of [null, 0, 2, 4.9, 5, 17, 42, 50]) {
        const legacy = (() => {
          const prescribed = sched != null && sched >= 5 ? sched : CAP;
          return done > Math.max(prescribed, 0) * 1.25;
        })();
        expect(overshootFires(done, sched, CAP), `done=${done} sched=${sched}`).toBe(legacy);
      }
    }
  });
});
