/**
 * lib/plan/_ramp_readiness_bar.test.ts · the bar to ADD load may not be
 * stricter than the bar to CUT it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS, AND WHY IT IS A GATE RATHER THAN A COMMENT
 *
 * `lib/coach/convergence.ts` publishes one ladder for "is this runner's
 * readiness dragging", and every downward path reads it:
 *
 *     <=1 domain   GREEN  · nothing happens
 *      2 domains   AMBER  · the runner is TOLD, the plan is not touched
 *     >=3 domains  RED    · today's quality session may be downgraded
 *
 * `detectRampSignals` gate 1 had its own, private, far stricter rule: the
 * LONGEST streak of ANY SINGLE pillar, blocking at two days. One pillar below
 * its own baseline vetoed every upward bump for as long as it stayed there —
 * three whole domains below the bar a pull-back needs before it may touch the
 * plan. The runner doing better got the weaker response, which is CLAUDE.md
 * Rule 9's signature, and it is why the owner's account could never bump: his
 * sleep pillar has run below baseline continuously since 2026-08-16 while
 * `readiness_snapshots.band` read `ready` on every one of those days.
 *
 * Rule 16 · one quantity, one name. The number lives in `CONVERGENCE` and is
 * READ here rather than restated, so a test that hardcoded both sides could
 * not pass by agreeing with itself.
 *
 * Rule 18 · this was falsified against the unfixed engine first: with
 * `readinessGreen = max(days) < 2`, the one-dragging-pillar case below returns
 * false and the test goes red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-08-30'),
}));

import { pool } from '@/lib/db/pool';
import { CONVERGENCE } from '@/lib/coach/convergence';

const UUID = '00000000-0000-0000-0000-000000000042';
const PLAN = { id: 'pln_test', authoredState: { tier_peak_weekly_band: [70, 85] } };

type Streak = { pillar: string; direction: string; days: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;

/** Answer every read the signal pass makes; only `streaks` varies per case. */
function route(streaks: Streak[]) {
  return async (sql: unknown) => {
    const s = String(sql);
    if (s.includes('readiness_snapshots')) return { rows: [{ streaks }] };
    if (s.includes('owned.is_quality = true')) return { rows: [] };
    if (s.includes('aerobicDecouplingPct')) return { rows: [] };
    if (s.includes('MAX(weekly)')) return { rows: [{ peak_weekly: 40, peak_long: 14 }] };
    if (s.includes('projection_snapshots')) return { rows: [{ vdot: '52' }] };
    return { rows: [] };
  };
}

async function readinessGreenFor(streaks: Streak[]): Promise<boolean> {
  query.mockImplementation(route(streaks));
  const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
  return (await detectRampSignals(UUID, PLAN)).readinessGreen;
}

const below = (pillar: string, days: number): Streak => ({ pillar, direction: 'below', days });

beforeEach(() => { vi.clearAllMocks(); });

describe('adaptive ramp · the readiness bar is the published ladder', () => {
  it('the ladder is where this test reads its number from, not a literal', () => {
    // If the ladder moves, this file moves with it rather than drifting.
    expect(CONVERGENCE.amberMinDomains).toBeGreaterThanOrEqual(2);
  });

  it('no dragging pillar is green', async () => {
    expect(await readinessGreenFor([])).toBe(true);
  });

  it('ONE sustained dragging pillar is still green · the owner`s live case', async () => {
    // Sleep below baseline for a fortnight, band `ready` throughout. Under the
    // old rule this returned false and vetoed every bump indefinitely.
    expect(await readinessGreenFor([below('sleep', 14)])).toBe(true);
  });

  it('a one-day blip does not count as a dragging domain', async () => {
    expect(await readinessGreenFor([below('sleep', 1), below('cardiac', 1)])).toBe(true);
  });

  it('TWO sustained dragging pillars is not green · amber, so no bump', async () => {
    expect(await readinessGreenFor([below('sleep', 14), below('autonomic', 3)])).toBe(false);
  });

  it('three is not green either · the pull-back band', async () => {
    expect(await readinessGreenFor(
      [below('sleep', 14), below('autonomic', 3), below('cardiac', 2)],
    )).toBe(false);
  });

  it('an ABOVE-baseline streak is not dragging, however long', async () => {
    expect(await readinessGreenFor([
      { pillar: 'sleep', direction: 'above', days: 30 },
      { pillar: 'autonomic', direction: 'above', days: 30 },
    ])).toBe(true);
  });

  it('the bump bar is never STRICTER than the bar to touch the plan downward', async () => {
    /* The asymmetry this file exists to forbid, stated as the property rather
     * than as a number. At any count of dragging domains that leaves the
     * pull-back path idle (< redMinDomains), a bump must not be vetoed by
     * readiness alone unless the ladder itself has left green. */
    for (let n = 0; n < CONVERGENCE.redMinDomains; n++) {
      const streaks = Array.from({ length: n }, (_, i) => below(`p${i}`, 5));
      const green = await readinessGreenFor(streaks);
      const ladderSaysGreen = n < CONVERGENCE.amberMinDomains;
      expect(green, `${n} dragging domains · ramp and ladder disagree`).toBe(ladderSaysGreen);
    }
  });
});
