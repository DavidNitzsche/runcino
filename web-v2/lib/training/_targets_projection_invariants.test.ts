/**
 * _targets_projection_invariants.test.ts
 *
 * Pins the invariants of the approved Targets-projection fix so a later tweak
 * (a tunable, a rounding change, a refactor) cannot silently regress them. The
 * fix has four legs, split across peer-owned product files; this file exercises
 * the pure-function legs and encodes the cross-file contract they must satisfy:
 *
 *   1. projectFitnessTrajectory gains a `runwayLimited: boolean` — true IFF the
 *      PLANNED (future) gain was clamped by the runway term
 *      (buildWeeks * BASE_BUILD_RATE * exec), not by execution or the plan
 *      ceiling. "Stalled" copy is only honest when this is false.
 *   2. The runway term SCALES with executionQuality — lower exec lowers the
 *      projected gain even when the runway is the binding cap (the pre-fix
 *      runway term omitted exec, so exec could not move a runway-bound gain).
 *   3. `reachable` is computed from UNROUNDED internals — a knife-edge case
 *      whose 0.1-rounded gap reads within the reachable grace does NOT flip
 *      reachable to true.
 *   4. executionQualityFromTestPoints now MOVES for a break: recent missed key
 *      sessions + daysSinceLastRun >= 7 pushes q strictly below the execOk
 *      floor (0.80); a clean week stays >= 0.80. Doctrine: execution/absence
 *      honesty only, NO physiological fitness decay.
 *   5. The accrued-today estimate credits EXECUTED work, not elapsed calendar
 *      time — with zero executed work it never reads faster than the anchor
 *      predictRaceTime(currentVdot). (route.ts owns the wiring; this pins the
 *      pure accrual invariant the wiring must honor.)
 *
 * Contract exports this file depends on (owned by peers, guaranteed by the
 * shared contract — if a name differs, reconcile HERE, it is the only coupling
 * point):
 *   · './fitness-trajectory'  → projectFitnessTrajectory, BASE_BUILD_RATE,
 *                               TAPER_WEEKS, FitnessTrajectory.runwayLimited
 *   · './goal-projection'     → executionQualityFromTestPoints(points,
 *                               missedKeyWorkouts, daysSinceLastRun)
 *   · './vdot'                → predictRaceTime, vdotFromRace
 */
import { describe, it, expect } from 'vitest';
import {
  projectFitnessTrajectory,
  BASE_BUILD_RATE,
  TAPER_WEEKS,
} from './fitness-trajectory';
import { executionQualityFromTestPoints } from './goal-projection';
import type { GoalProjection } from './goal-projection';
import { predictRaceTime } from './vdot';

const HM_MI = 13.1094; // Daniels Half, matches the route's STANDARD_RACES entry

// execOk floor from the shared contract — a full week off must push STRICTLY
// below this; a clean week must stay at or above it. Named once so a future
// re-tune of the threshold changes the assertions in one place.
const EXEC_OK_FLOOR = 0.8;
// reachable grace in fitness-trajectory (0.2 VDOT ≈ 10-12s at HM). Named so the
// knife-edge case in test 3 tracks the real constant, not a magic literal.
const REACHABLE_GRACE_VDOT = 0.2;

/** goalSec that maps (via the Daniels table) to a target VDOT at a distance, so
 *  the goal-gap in each scenario is controlled rather than hand-guessed. */
function secForVdot(vdot: number, distanceMi: number): number {
  const s = predictRaceTime(vdot, distanceMi);
  if (s == null) throw new Error(`predictRaceTime(${vdot}) returned null`);
  return s;
}

// ── 1 · runwayLimited reflects a time-limited (not runner-limited) goal ───────
describe('projectFitnessTrajectory · runwayLimited', () => {
  it('short runway + large goal gap + clean execution → runwayLimited === true', () => {
    // VDOT 40 runner, goal needs ~44.5, only 5 weeks out (buildWeeks 3), nailing
    // the plan. The goal gap (4.5) and the generous plan ceiling both dwarf the
    // runway cap (3 * 0.35 * 1.0 = 1.05), so the runway is the binding term.
    const traj = projectFitnessTrajectory({
      currentVdot: 40,
      goalSec: secForVdot(44.5, HM_MI),
      raceDistanceMi: HM_MI,
      weeksToRace: 5,
      executionQuality: 1.0,
      plannedTargetVdot: 46, // plan ceiling far above the runway cap → not the limiter
    });
    expect(traj).not.toBeNull();
    expect(traj!.runwayLimited).toBe(true);
    // The runway physically cannot close a 4.5 gap in 3 weeks → not reachable.
    expect(traj!.reachable).toBe(false);
    // Gain is bounded by buildWeeks * rate * exec, not by the 4.5 goal gap.
    const expectedRunwayCap = traj!.buildWeeks * BASE_BUILD_RATE * 1.0;
    expect(traj!.projectedGainVdot).toBeLessThanOrEqual(expectedRunwayCap + 0.05);
  });

  it('long runway + clean execution + reachable goal → runwayLimited === false', () => {
    // VDOT 44 runner, small 1.0 goal gap, 16 weeks out. The runway cap
    // (14 * 0.35 = 4.9) far exceeds the 1.0 gap the goal needs, so the gain is
    // limited by the goal/execution, NOT by time remaining.
    const traj = projectFitnessTrajectory({
      currentVdot: 44,
      goalSec: secForVdot(45, HM_MI),
      raceDistanceMi: HM_MI,
      weeksToRace: 16,
      executionQuality: 1.0,
      plannedTargetVdot: 46,
    });
    expect(traj).not.toBeNull();
    expect(traj!.runwayLimited).toBe(false);
    expect(traj!.reachable).toBe(true);
  });
});

// ── 2 · the runway cap scales with executionQuality ──────────────────────────
describe('projectFitnessTrajectory · runway cap scales with executionQuality', () => {
  it('lower exec → lower projectedGainVdot even when the runway is the binding cap', () => {
    // Same short-runway, large-gap scenario at two execution levels. Because the
    // fixed runway term is buildWeeks * BASE_BUILD_RATE * exec, halving exec must
    // halve the runway-bound gain. (Pre-fix the runway term omitted exec, so both
    // levels produced the identical runway-bound gain — this test pins the fix.)
    const base = {
      currentVdot: 40,
      goalSec: secForVdot(45, HM_MI),
      raceDistanceMi: HM_MI,
      weeksToRace: 8, // buildWeeks 6
      plannedTargetVdot: 46, // ceiling above the runway cap → runway binds
    };
    const clean = projectFitnessTrajectory({ ...base, executionQuality: 1.0 })!;
    const broken = projectFitnessTrajectory({ ...base, executionQuality: 0.5 })!;

    // Both are runway-limited (goal gap 5 and plan ceiling both exceed the cap).
    expect(clean.runwayLimited).toBe(true);
    expect(broken.runwayLimited).toBe(true);

    // The lever moves: worse execution → strictly smaller projected gain.
    expect(broken.projectedGainVdot).toBeLessThan(clean.projectedGainVdot);

    // And each tracks its own runway cap (buildWeeks * rate * exec).
    const cap = (exec: number) => (base.weeksToRace - TAPER_WEEKS) * BASE_BUILD_RATE * exec;
    expect(clean.projectedGainVdot).toBeLessThanOrEqual(cap(1.0) + 0.05);
    expect(broken.projectedGainVdot).toBeLessThanOrEqual(cap(0.5) + 0.05);
  });
});

// ── 3 · reachable/verdict from unrounded internals (no rounding flip) ─────────
describe('projectFitnessTrajectory · reachable uses unrounded internals', () => {
  it('a gap that 0.1-rounds INTO the grace does not flip reachable to true', () => {
    // Construct a knife-edge: the plan ceiling caps the gain at exactly 0.76
    // (currentVdot 44 → plannedTargetVdot 44.76), goal VDOT 45. The honest,
    // UNROUNDED gap is 45 - 44.76 = 0.24 (> the 0.2 grace → NOT reachable). But
    // the 0.1-rounded projected VDOT (44.8) yields a rounded gap of 0.2, which a
    // naive `roundedGap <= grace` check would read as reachable. Long runway +
    // clean exec so neither runway nor execution is the limiter — the plan
    // ceiling is, isolating the rounding behavior.
    const traj = projectFitnessTrajectory({
      currentVdot: 44,
      goalSec: secForVdot(45, HM_MI),
      raceDistanceMi: HM_MI,
      weeksToRace: 20, // buildWeeks 18, runway cap 6.3 — does not bind
      executionQuality: 1.0,
      plannedTargetVdot: 44.76, // plan ceiling caps the gain at 0.76 exactly
    })!;

    // The 0.1-rounded gap (reconstructed from the rounded projectedVdot field)
    // reads WITHIN the reachable grace...
    const roundedGap = Math.round((traj.goalVdot! - traj.projectedVdot) * 10) / 10;
    expect(roundedGap).toBeLessThanOrEqual(REACHABLE_GRACE_VDOT);

    // ...yet the honest (unrounded) verdict does NOT flip to reachable.
    expect(traj.reachable).toBe(false);

    // Sanity: the gain really was pinned by the plan ceiling, not the runway.
    expect(traj.runwayLimited).toBe(false);
    expect(traj.projectedGainVdot).toBeCloseTo(0.76, 1);
  });
});

// ── 4 · executionQualityFromTestPoints moves for a real break ────────────────
describe('executionQualityFromTestPoints · a break lowers execution quality', () => {
  const tp = (
    verdict: 'on' | 'fast' | 'slow' | null,
    dateISO = '2026-07-01',
  ): GoalProjection['recentTestPoints'][number] => ({
    dateISO,
    type: 'tempo',
    label: 'tempo',
    distanceMi: 4,
    actualPace: '7:00',
    verdict,
    verdictBasis: null,
  });

  it('a clean week (sessions landing on target, ran recently) stays >= 0.80', () => {
    // All-on verdicts, no missed key workouts, ran 2 days ago → execOk.
    const q = executionQualityFromTestPoints(
      [tp('on', '2026-07-11'), tp('on', '2026-07-08'), tp('on', '2026-07-05')],
      /* missedKeyWorkouts */ false,
      /* daysSinceLastRun */ 2,
    );
    expect(q).toBeGreaterThanOrEqual(EXEC_OK_FLOOR);
  });

  it('a modeled 7-day break (missed key sessions + 7 days off) drops q below 0.80', () => {
    // Recent missed key sessions AND a week without running: the two-part break
    // signal from the contract. Must push strictly below the execOk floor so a
    // full week off can never read as still-executing.
    const points: GoalProjection['recentTestPoints'] = [
      tp('slow', '2026-07-05'),
      tp('on', '2026-07-01'),
    ];
    const broken = executionQualityFromTestPoints(points, /* missedKeyWorkouts */ true, /* daysSinceLastRun */ 7);
    expect(broken).toBeLessThan(EXEC_OK_FLOOR);
    expect(broken).toBeGreaterThanOrEqual(0); // stays in range [0,1]
    expect(broken).toBeLessThanOrEqual(1);

    // Isolate the daysSinceLastRun term: identical verdicts + missed flag, but a
    // fresh run today vs a 7-day gap. The break must read STRICTLY lower — the
    // day-gap moves q on its own, it is not just the missed-workout penalty.
    const sameButRecent = executionQualityFromTestPoints(points, /* missedKeyWorkouts */ true, /* daysSinceLastRun */ 1);
    expect(broken).toBeLessThan(sameButRecent);
  });

  it('missed sessions weigh by DATE, not front-loaded — returning to training recovers execution', () => {
    // Regression for the 34% bug: a runner who missed a stretch then CAME BACK
    // (real case: missed 07-05/07-07, completed 07-09/07-12, ran today) must
    // NOT read as barely-training. The misses are OLDER than the comeback runs,
    // so they must weigh LESS, not be jammed to the top of the recency window.
    const comeback = executionQualityFromTestPoints(
      [tp('on', '2026-07-12'), tp('on', '2026-07-09'), tp('on', '2026-06-27')],
      /* missedKeyWorkouts */ false,
      /* daysSinceLastRun */ 0,
      /* recentMissedKeyDates (older than the comeback) */ ['2026-07-07', '2026-07-05'],
    );
    // Same two misses, but NEWER than the completed sessions (the runner just
    // stopped): this SHOULD read off-track.
    const stopped = executionQualityFromTestPoints(
      [tp('on', '2026-07-05'), tp('on', '2026-07-01'), tp('on', '2026-06-27')],
      /* missedKeyWorkouts */ false,
      /* daysSinceLastRun */ 0,
      /* recentMissedKeyDates (newer than the completed work) */ ['2026-07-12', '2026-07-09'],
    );
    expect(comeback).toBeGreaterThan(stopped);       // date ordering must matter
    expect(comeback).toBeGreaterThanOrEqual(0.6);    // two OLD misses + a solid comeback is not a collapse
    expect(stopped).toBeLessThan(EXEC_OK_FLOOR);      // stopping recently does read off-track
  });

  it('extended inactivity alone (no missed-flag, no verdicts) decays q by the day-gap', () => {
    // Absence helper, isolated: same empty verdict set and same missedKeyWorkouts
    // = false, differing ONLY in daysSinceLastRun. A long layoff must read
    // strictly lower than a fresh runner — inactivity decays execution on its
    // own (a pre-fix signature that ignored the day-gap would tie these).
    const fresh = executionQualityFromTestPoints([], /* missedKeyWorkouts */ false, /* daysSinceLastRun */ 1);
    const layoff = executionQualityFromTestPoints([], /* missedKeyWorkouts */ false, /* daysSinceLastRun */ 10);
    expect(layoff).toBeLessThan(fresh);
    expect(layoff).toBeLessThan(EXEC_OK_FLOOR);
  });
});

// ── 5 · accrued-today credits executed work, never elapsed calendar time ─────
describe('accrued-today invariant · never faster than the anchor without executed work', () => {
  // Mirror of the clamped accrual the route composes for `trajectoryAccruedSec`
  // (app/api/targets/projection/route.ts). The doctrine fix: the accrued VDOT
  // credits the EXECUTED fraction of planned work, never the calendar-elapsed
  // fraction — so when executed work is absent the accrued time equals (never
  // beats) the anchor predictRaceTime(currentVdot). Pinned here as a pure
  // invariant; the route wiring must honor it.
  const accruedSec = (
    currentVdot: number,
    projectedGainVdot: number,
    executedFraction: number,
    distanceMi: number,
  ): number => {
    const f = Math.min(1, Math.max(0, executedFraction)); // clamp to [0,1]
    const accruedVdot = currentVdot + Math.max(0, projectedGainVdot) * f;
    const s = predictRaceTime(accruedVdot, distanceMi);
    if (s == null) throw new Error('predictRaceTime returned null');
    return s;
  };

  it('with zero executed work the accrued time equals the anchor (not faster)', () => {
    // Real trajectory with a modeled future gain, but the runner has executed
    // NONE of it yet. predictRaceTime is monotonic decreasing in VDOT (faster =
    // fewer seconds), so "not faster than the anchor" means accruedSec >= anchorSec.
    const currentVdot = 45;
    const traj = projectFitnessTrajectory({
      currentVdot,
      goalSec: secForVdot(48, HM_MI),
      raceDistanceMi: HM_MI,
      weeksToRace: 12,
      executionQuality: 0.7,
      plannedTargetVdot: 49,
    })!;
    expect(traj.projectedGainVdot).toBeGreaterThan(0); // there IS a modeled gain to (not) credit

    const anchorSec = predictRaceTime(currentVdot, HM_MI)!;
    const noWorkSec = accruedSec(currentVdot, traj.projectedGainVdot, 0, HM_MI);
    // Equal to the anchor — the modeled gain does NOT leak in without executed work.
    expect(noWorkSec).toBe(anchorSec);
    // And never reads FASTER than the anchor (the bug the clamp closes).
    expect(noWorkSec).toBeGreaterThanOrEqual(anchorSec);
  });

  it('accrued credits work monotonically — more executed work reads faster, and only executed work', () => {
    const currentVdot = 45;
    const gain = 3.0; // modeled future gain
    const anchorSec = predictRaceTime(currentVdot, HM_MI)!;

    const none = accruedSec(currentVdot, gain, 0.0, HM_MI);
    const half = accruedSec(currentVdot, gain, 0.5, HM_MI);
    const full = accruedSec(currentVdot, gain, 1.0, HM_MI);

    // Executed work earns a faster projection; absence of it does not.
    expect(none).toBe(anchorSec);      // zero executed → anchor exactly
    expect(half).toBeLessThan(none);   // some executed → faster than anchor
    expect(full).toBeLessThan(half);   // all executed → fastest
    // The accrued estimate depends ONLY on executed fraction — the function has
    // no calendar-time input, so elapsed weeks cannot inflate it.
  });
});
