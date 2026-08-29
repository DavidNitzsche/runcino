/**
 * lib/training/goal-projection-ahead.test.ts · AHEAD-1 (2026-08-28)
 *
 * [[feedback_progress_is_the_guiding_light]] (locked 2026-08-25): current
 * fitness is a floor, not a ceiling. Before this fix, computeGoalProjection's
 * status ladder had no rung for "genuinely beating the goal" —
 * `projectionSec` stayed pinned at `goalSec` for status on-track AND
 * watching, so a runner demonstrably faster than their stated goal still saw
 * the goal number staring back, forever, never a faster one. Off-track
 * already let the projection read SHORT of the goal; this closes the
 * symmetric gap on the fast side.
 *
 * [[feedback_no_forced_goal_decisions]]: the coach projects, it never
 * renegotiates a stated goal. `goalSec` must never move — only what the
 * projection REPORTS about it can.
 *
 * Two layers of coverage:
 *   1. `resolveAheadOverride` — the pure decision function that drives the
 *      new rung — exhaustively, no DB.
 *   2. `computeGoalProjection` end-to-end, DB-mocked, for the sustained-
 *      evidence fixture: assert status === 'ahead', projectionSec reflects
 *      the faster evidence-based time (not goalSec), and goalSec itself is
 *      completely untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { computeGoalProjection, resolveAheadOverride, AHEAD_STRONG_PCT } from './goal-projection';
import { predictRaceTime } from './vdot';

// ─────────────────────────────────────────────────────────────────────────
// Layer 1 · resolveAheadOverride — pure, no DB, exhaustive.
// ─────────────────────────────────────────────────────────────────────────

describe('resolveAheadOverride · the AHEAD-1 decision, isolated from the DB', () => {
  // goalSec 9000, vdotProjectionSec 8100 → (9000-8100)/9000 = 10% faster,
  // exactly AHEAD_STRONG_PCT — the same magnitude bar detectRecentRaceDrift
  // calls STRONG in the other direction.
  const base = {
    status: 'on-track' as const,
    vdotProjectionSec: 8100,
    goalSec: 9000,
    overPerformanceSessions: 2, // mirrors computeOverPerformanceBonus's MIN_SESSIONS
  };

  it('promotes a clean on-track read to ahead at exactly the 10% margin with sustained evidence', () => {
    expect(AHEAD_STRONG_PCT).toBe(10);
    expect(resolveAheadOverride(base)).toBe('ahead');
  });

  it('does not fire under the margin (9% faster stays on-track)', () => {
    // (9000 - 8190) / 9000 = 9%
    expect(resolveAheadOverride({ ...base, vdotProjectionSec: 8190 })).toBe('on-track');
  });

  it('does not fire with only 1 corroborating session — mirrors computeOverPerformanceBonus MIN_SESSIONS=2, no fluke single fast day', () => {
    expect(resolveAheadOverride({ ...base, overPerformanceSessions: 1 })).toBe('on-track');
  });

  it('does not fire with 0 corroborating sessions', () => {
    expect(resolveAheadOverride({ ...base, overPerformanceSessions: 0 })).toBe('on-track');
  });

  it('never overrides watching, even with a huge margin and full sustained evidence', () => {
    expect(resolveAheadOverride({ ...base, status: 'watching', vdotProjectionSec: 4500 })).toBe('watching');
  });

  it('never overrides off-track — a real drift signal stays honest, never softened by a stale fast anchor', () => {
    expect(resolveAheadOverride({ ...base, status: 'off-track', vdotProjectionSec: 4500 })).toBe('off-track');
  });

  it('is idempotent on an already-ahead status', () => {
    expect(resolveAheadOverride({ ...base, status: 'ahead' })).toBe('ahead');
  });

  it('no-ops when vdotProjectionSec is null (cold start, no VDOT)', () => {
    expect(resolveAheadOverride({ ...base, vdotProjectionSec: null })).toBe('on-track');
  });

  it('no-ops when goalSec is not positive (defensive)', () => {
    expect(resolveAheadOverride({ ...base, goalSec: 0 })).toBe('on-track');
  });

  it('never returns a status value that mutates goalSec — the function signature carries no way to', () => {
    // Structural guarantee, not just a behavioral one: resolveAheadOverride
    // returns GoalStatus, never touches or echoes goalSec back mutated.
    const result = resolveAheadOverride(base);
    expect(typeof result).toBe('string');
    expect(base.goalSec).toBe(9000); // untouched
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 · computeGoalProjection end-to-end, DB-mocked.
// ─────────────────────────────────────────────────────────────────────────

const USER_UUID = 'ahead-1-test-user';
const DIST_MI = 13.1; // half marathon — keeps SPEC-CENTER's marathon-only
                       // specificity adjustment out of scope, so
                       // vdotProjectionSec is the raw predictRaceTime value.
const VDOT = 50;
const RAW_PROJ_SEC = predictRaceTime(VDOT, DIST_MI)!;
// Comfortably clears the 10% bar (goal is set 1/0.85 ≈ 17.6% slower than
// today's real projection) so float rounding in predictRaceTime can't put
// this fixture on the wrong side of the threshold.
const GOAL_SEC = Math.round(RAW_PROJ_SEC / 0.85);

/** Two controlled, HR-corroborated threshold sessions beating prescribed
 *  pace by well over BEAT_FLOOR (10 s/mi), HR under the mocked LTHR (150) —
 *  the exact shape computeOverPerformanceBonus's MIN_SESSIONS gate requires.
 *  `avg_hr` is the aliased column name unique to that function's query in
 *  goal-projection.ts (verified against no other query in the file). */
const SUSTAINED_OVERPERFORMANCE_ROWS = [
  { target_s: 480, work_pace_s: 460, avg_hr: 140 },
  { target_s: 480, work_pace_s: 455, avg_hr: 138 },
];

function mockPool(overPerformanceRows: Array<Record<string, unknown>>): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: unknown) => {
    if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
    // computeOverPerformanceBonus's own LTHR read, and loadNextTestPoints'
    // (both want the same profile row — no HR governor, no "controlled" read).
    if (sql.includes('FROM profile')) {
      return Promise.resolve({ rows: [{ lthr: 150 }] });
    }
    // computeOverPerformanceBonus's main query — `avg_hr` is the unique
    // discriminator (see SUSTAINED_OVERPERFORMANCE_ROWS comment above).
    if (sql.includes('avg_hr')) {
      return Promise.resolve({ rows: overPerformanceRows });
    }
    // Every other detector/loader (races, projection_snapshots, plan_workouts,
    // runs, coach_intents, ...) — empty rows, the documented safe default
    // every one of them treats as "no signal" per this file's own comments.
    return Promise.resolve({ rows: [] });
  });
}

describe('computeGoalProjection · AHEAD-1 end-to-end (DB-mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads status "ahead" with projectionSec at the faster evidence-based time when sustained over-performance clears the goal by 10%+', async () => {
    mockPool(SUSTAINED_OVERPERFORMANCE_ROWS);

    const gp = await computeGoalProjection({
      userUuid: USER_UUID,
      goalSec: GOAL_SEC,
      raceDistanceMi: DIST_MI,
      vdot: VDOT,
      daysToRace: 90,
    });

    expect(gp.status).toBe('ahead');
    // No specificity adjustment applies at this distance/anchor shape, so
    // vdotProjectionSec is the raw current-fitness projection.
    expect(gp.vdotProjectionSec).toBe(RAW_PROJ_SEC);
    expect(gp.projectionSec).toBe(gp.vdotProjectionSec);
    expect(gp.projectionSec).toBeLessThan(GOAL_SEC);
  });

  it('never writes to goalSec — the runner-set number is echoed back byte-identical', async () => {
    mockPool(SUSTAINED_OVERPERFORMANCE_ROWS);

    const gp = await computeGoalProjection({
      userUuid: USER_UUID,
      goalSec: GOAL_SEC,
      raceDistanceMi: DIST_MI,
      vdot: VDOT,
      daysToRace: 90,
    });

    expect(gp.goalSec).toBe(GOAL_SEC);
  });

  it('does NOT fire ahead without sustained evidence (only 1 controlled session) — stays pinned at goal, exactly the pre-fix on-track behavior', async () => {
    mockPool([SUSTAINED_OVERPERFORMANCE_ROWS[0]]); // only 1 session

    const gp = await computeGoalProjection({
      userUuid: USER_UUID,
      goalSec: GOAL_SEC,
      raceDistanceMi: DIST_MI,
      vdot: VDOT,
      daysToRace: 90,
    });

    expect(gp.status).toBe('on-track');
    expect(gp.projectionSec).toBe(GOAL_SEC);
    expect(gp.goalSec).toBe(GOAL_SEC);
  });

  it('does NOT fire ahead with sustained evidence but a goal already within the margin (goal itself is fast, no real edge over it)', async () => {
    mockPool(SUSTAINED_OVERPERFORMANCE_ROWS);

    // A goal only ~3% slower than today's real projection — inside the 10%
    // bar, so the runner is on-pace but not "genuinely, clearly ahead".
    const closeGoalSec = Math.round(RAW_PROJ_SEC / 0.97);

    const gp = await computeGoalProjection({
      userUuid: USER_UUID,
      goalSec: closeGoalSec,
      raceDistanceMi: DIST_MI,
      vdot: VDOT,
      daysToRace: 90,
    });

    expect(gp.status).toBe('on-track');
    expect(gp.projectionSec).toBe(closeGoalSec);
  });
});
