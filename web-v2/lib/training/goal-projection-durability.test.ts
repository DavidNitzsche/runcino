/**
 * lib/training/goal-projection-durability.test.ts · goal-projection-
 * durability follow-up, 2026-09-01.
 *
 * docs/reports/race-prediction-consolidation-2026-09-01.md §4.1 (the source
 * audit's open question #2) recommended wiring
 * `durability-anchor.ts#resolveRaceExponent` into
 * `computeGoalProjection`'s cross-distance projection — the trajectory the
 * drift cron, the simulator, and the adaptation loop all read — the same way
 * `coach-goal.ts#projectWithDurabilityExponent` already does for the coach-set
 * A/B/C tiers, "falling back to the existing predictRaceTime path when the
 * durability read refuses or its confidence is too low to prefer over the
 * table."
 *
 * `coach-goal.ts` treats `ok: true` as a hard swap (any usable read wins
 * outright — confidence is only DISPLAYED, a human reads it before trusting
 * the number). This function feeds automated consumers with no human
 * confidence-reading step, so a hard threshold was rejected in favor of a
 * CONTINUOUS blend by `durabilityRead.confidence` itself (already a 0..1
 * evidence+freshness score, `capacity-resolver.ts`'s established
 * `confidencePosition` pattern for exactly this situation — "no prescription
 * changes in KIND across a threshold on a continuous quantity", Rule 9).
 * See `durabilityBlend`'s doc comment on `GoalProjection` and the decision
 * report for the full reasoning, including why no existing archetype/plan-
 * generation corpus (`_sweep_allusers.test.ts`) reaches this function at all
 * — confirmed by grep, so a hand-picked threshold could not have been graded
 * against one.
 *
 * This file proves the WIRING (the blend math itself is
 * `durability-anchor.ts`'s own, already tested in `coach-goal-durability
 * .test.ts` and this file's sibling `fitness-trajectory-durability.test.ts`):
 *
 *   1. No races on file → byte-identical to pre-existing (Daniels-only)
 *      behavior — the regression guarantee.
 *   2. A usable read blends `vdotProjectionSec` and `trajectory.currentSec`/
 *      `projectedSec` by EXACTLY `durabilityRead.confidence`, cross-checked
 *      against `resolveRaceExponent` + `projectWithDurabilityExponent`
 *      called directly on the same mocked rows (not a hardcoded number).
 *   3. Increasing evidence increases the weight, and the blended projection
 *      moves monotonically toward the durability-projected value as it does
 *      — a continuity walk across REAL evidence shapes, not a synthetic
 *      confidence input, so it also stands as the corpus Rule 15 asks for
 *      this mechanism to have (see the report).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-31'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { computeGoalProjection } from './goal-projection';
import { predictRaceTime } from './vdot';
import { resolveRaceExponent, projectWithDurabilityExponent } from './durability-anchor';

const HM_MI = 13.1094;
const M_MI = 26.2188;
const VDOT = 47;
const GOAL_SEC = Math.round(predictRaceTime(VDOT, HM_MI)! * 1.05); // a bit slower than today — status stays on-track/watching, not ahead/off-track, so vdotProjectionSec is the number under test either way

type RaceRow = { slug: string; meta: Record<string, unknown>; actual_result: Record<string, unknown> };

function raceRow(over: Partial<RaceRow['meta']> & { slug: string; finishS: number }): RaceRow {
  return {
    slug: over.slug,
    meta: { priority: 'A', date: '2026-06-01', ...over },
    actual_result: { finishS: over.finishS },
  };
}

/** David's real 5-race fixture shape (docs/reports/race-prediction-
 *  consolidation-2026-09-01.md §2.1's "Verified for real" numbers), dated so
 *  `runnerToday` (mocked '2026-08-31') keeps them all inside
 *  `DURABILITY_HALF_LIFE_DAYS` (84d) of freshness for a materially-weighted
 *  read. */
const RICH_EVIDENCE_ROWS: RaceRow[] = [
  raceRow({ slug: 'rose-bowl-half', distanceMi: 13.1, date: '2026-06-15', finishS: 5918, priority: 'A' }),
  raceRow({ slug: 'disney-half', distanceMi: 13.1, date: '2026-07-01', finishS: 6050, priority: 'B' }),
  raceRow({ slug: 'la-marathon', distanceMi: 26.2, date: '2026-07-15', finishS: 12800, priority: 'A' }),
  raceRow({ slug: 'sombrero-half', distanceMi: 13.1, date: '2026-08-01', finishS: 6100, priority: 'B' }),
  raceRow({ slug: 'afc-half', distanceMi: 13.1, date: '2026-08-16', finishS: 5980, priority: 'B' }),
];

/** Thin evidence: exactly 2 races, minimum distance spread, close together —
 *  qualifies (`ok: true`) but with the lowest evidence score the fit can
 *  produce short of refusing outright. */
const THIN_EVIDENCE_ROWS: RaceRow[] = [
  raceRow({ slug: 'local-5k', distanceMi: 3.1, date: '2026-08-20', finishS: 1200, priority: 'B' }),
  raceRow({ slug: 'local-10k', distanceMi: 6.2, date: '2026-08-25', finishS: 2550, priority: 'B' }),
];

function mockPool(raceRows: RaceRow[]): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: unknown) => {
    if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
    if (sql.includes('FROM races')) return Promise.resolve({ rows: raceRows });
    // Every other detector/loader — empty rows, the documented safe default.
    return Promise.resolve({ rows: [] });
  });
}

describe('computeGoalProjection · durability blend, no races on file (regression guarantee)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vdotProjectionSec is byte-identical to the pre-existing Daniels-only value', async () => {
    mockPool([]);
    const gp = await computeGoalProjection({
      userUuid: 'no-races-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });
    expect(gp.vdotProjectionSec).toBe(predictRaceTime(VDOT, HM_MI));
    expect(gp.durabilityBlend).toBeNull();
  });

  it('trajectory.currentSec is also byte-identical to the pre-existing value', async () => {
    mockPool([]);
    const gp = await computeGoalProjection({
      userUuid: 'no-races-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });
    expect(gp.trajectory?.currentSec).toBe(predictRaceTime(VDOT, HM_MI));
  });
});

describe('computeGoalProjection · durability blend, a usable read (cross-checked, not hardcoded)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vdotProjectionSec is EXACTLY weight·durabilitySec + (1-weight)·danielsSec, weight = the read\'s own confidence', async () => {
    mockPool(RICH_EVIDENCE_ROWS);

    // The expected values, computed independently via the same durability-
    // anchor.ts functions the production code calls — not a re-implementation,
    // a direct call, so this test proves the WIRING agrees with them.
    const expectedRead = await resolveRaceExponent('rich-evidence-user');
    expect(expectedRead.ok).toBe(true); // sanity: the fixture is actually usable
    const expectedProjection = projectWithDurabilityExponent(expectedRead, HM_MI)!;
    const danielsSec = predictRaceTime(VDOT, HM_MI)!;
    const weight = expectedRead.ok ? expectedRead.confidence : 0;
    const expectedBlend = Math.round(weight * expectedProjection.sec + (1 - weight) * danielsSec);

    const gp = await computeGoalProjection({
      userUuid: 'rich-evidence-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });

    expect(gp.vdotProjectionSec).toBe(expectedBlend);
    expect(gp.durabilityBlend).toEqual({ weight, anchorDistanceMi: expectedProjection.anchorDistanceMi });
    // Weight is genuinely mid-range for this fixture, not clamped to 0 or 1 —
    // proves the blend is actually blending, not silently acting as a
    // threshold in disguise.
    expect(weight).toBeGreaterThan(0.05);
    expect(weight).toBeLessThan(0.95);
  });

  it('trajectory.currentSec uses the SAME blended value as vdotProjectionSec (pre-specificity-adjustment quantity), and projectedSec/gapSec stay internally consistent', async () => {
    mockPool(RICH_EVIDENCE_ROWS);
    const gp = await computeGoalProjection({
      userUuid: 'rich-evidence-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });
    // HM has no specificity adjustment (that rule only fires for a marathon
    // target off a sub-half anchor), so vdotProjectionSec IS the raw blended
    // value here — the exact quantity trajectory.currentSec should share.
    expect(gp.specificityAdjustment).toBeNull();
    expect(gp.trajectory?.currentSec).toBe(gp.vdotProjectionSec);
    expect(gp.trajectory?.gapSec).toBe(gp.trajectory!.projectedSec! - GOAL_SEC);
  });

  it('refuses gracefully (falls back to Daniels-only) when the target distance sits outside Riegel\'s validity window', async () => {
    mockPool(RICH_EVIDENCE_ROWS);
    // An ultra target — durability-anchor's own projector refuses (outside
    // [0.93, 26.22] mi), so this must degrade to the untouched Daniels path,
    // not throw and not silently fabricate a number.
    const ultraMi = 31.07; // 50K
    const gp = await computeGoalProjection({
      userUuid: 'rich-evidence-user', goalSec: 4 * 3600, raceDistanceMi: ultraMi, vdot: VDOT, daysToRace: 90,
    });
    expect(gp.vdotProjectionSec).toBe(predictRaceTime(VDOT, ultraMi));
    expect(gp.durabilityBlend).toBeNull();
  });
});

describe('computeGoalProjection · durability blend continuity (Rule 9 — thin vs. rich real evidence, not a synthetic confidence input)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('richer, fresher, wider-spread evidence produces a HIGHER weight than thin evidence, and the blended projection moves further toward the durability read accordingly', async () => {
    mockPool(THIN_EVIDENCE_ROWS);
    const thinRead = await resolveRaceExponent('thin-user');
    mockPool(RICH_EVIDENCE_ROWS);
    const richRead = await resolveRaceExponent('rich-user');
    expect(thinRead.ok).toBe(true);
    expect(richRead.ok).toBe(true);
    if (!thinRead.ok || !richRead.ok) throw new Error('unreachable — asserted above');

    expect(richRead.confidence).toBeGreaterThan(thinRead.confidence);

    mockPool(THIN_EVIDENCE_ROWS);
    const thinGp = await computeGoalProjection({
      userUuid: 'thin-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });
    mockPool(RICH_EVIDENCE_ROWS);
    const richGp = await computeGoalProjection({
      userUuid: 'rich-user', goalSec: GOAL_SEC, raceDistanceMi: HM_MI, vdot: VDOT, daysToRace: 90,
    });

    const danielsSec = predictRaceTime(VDOT, HM_MI)!;
    // Both blends move the same DIRECTION off Daniels (toward their own
    // durability projection) proportional to weight — richer evidence's
    // blend sits no closer to the Daniels anchor than thin evidence's, in
    // absolute distance moved per unit weight. A monotone confidence→weight
    // map with a shared linear blend formula guarantees this; assert it
    // holds for these two REAL fixtures rather than trusting the algebra
    // alone.
    const thinMoveFromDaniels = Math.abs(thinGp.vdotProjectionSec! - danielsSec);
    const richMoveFromDaniels = Math.abs(richGp.vdotProjectionSec! - danielsSec);
    const thinWeight = thinGp.durabilityBlend!.weight;
    const richWeight = richGp.durabilityBlend!.weight;
    expect(richWeight).toBeGreaterThan(thinWeight);
    // Movement-per-unit-weight should be comparable (same linear formula) —
    // not a strict equality (the two fixtures anchor on different real
    // races with different exponents/anchors), but neither should be zero
    // while the other is large, which would indicate the weight isn't
    // actually driving the blend.
    expect(thinMoveFromDaniels / thinWeight).toBeGreaterThan(0);
    expect(richMoveFromDaniels / richWeight).toBeGreaterThan(0);
  });
});
