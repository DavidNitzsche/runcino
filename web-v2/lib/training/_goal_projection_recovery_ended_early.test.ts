/**
 * lib/training/_goal_projection_recovery_ended_early.test.ts · WALKBACK-2
 * follow-up (2026-09-09), independent-review finding.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * WALKBACK-2 threads `RunData.recoveryEndedEarly` through the canonical
 * verdict resolver (`resolveWorkoutVerdict`) so a recovery the runner
 * deliberately ended early no longer drags a session's grade down to
 * `'uneven'`. `postrun/load.ts` — the main post-run recap path — already
 * passes it. The independent reviewer traced every OTHER caller and found
 * ONE that did not: `loadRecentTestPoints` in `goal-projection.ts`, the
 * historical "test point" judge the goal-feasibility projection reads for
 * PAST sessions off `coach_intents`/`plan_workouts`. It called
 * `resolveWorkoutVerdict` with `type`/`spec`/`phases` only, and its own SQL
 * never even SELECTed the column — a canonical verdict field silently
 * disappearing in a second, downstream consumer (Rule 16).
 *
 * The fix (`goal-projection.ts`): SELECT `runs.data->'recoveryEndedEarly'`
 * in the same query that already SELECTs `work_phases` off the SAME row —
 * `postrun/load.ts` reads the identical `data.recoveryEndedEarly` field off
 * the same `runs` table — and pass it through as `recoveryEndedEarly` on the
 * `resolveWorkoutVerdict` call, matching the shape `postrun/load.ts` already
 * uses.
 *
 * ── HOW THE TEST PROVES THE DIFFERENCE ────────────────────────────────────
 *
 * Two work reps against a 400 s/mi target at threshold's ±8 s/mi tolerance:
 * rep 1 lands dead-on (400, individually 'hit'), rep 2 runs comfortably fast
 * (350, individually 'fast') — both LAND the work, so `landed === graded`
 * and the session is 'executed'-eligible. Between them sits one recovery cut
 * to 8s against a 60s model, well outside `RECOVERY_DURATION_TOLERANCE`
 * (±50%) by duration alone — unrecorded, this is indistinguishable from a
 * genuine lapse. Whether `session.verdict` reads `'executed'` or `'uneven'`
 * therefore rests ENTIRELY on whether the recovery is recognised as chosen:
 *
 *   · WITHOUT the field wired through (the pre-fix shape) `recoveriesHonest`
 *     reads `false`, `session.verdict` falls to `'uneven'`, and
 *     `testPointVerdictFor` re-grades off the duration-weighted work MEAN
 *     (750s / 2mi = 375 s/mi) instead of the per-rep ladder — 375 is more
 *     than 8 s/mi under the 400 target, so the mean itself reads `'fast'`.
 *   · WITH the field wired through, the recovery is excluded from the
 *     honesty vote entirely (Rule 11 — a choice is not a lapse, never
 *     forced to "honest" either), `recoveriesHonest` comes back `null` (no
 *     signal), `session.verdict` is `'executed'`, and since NOT every rep
 *     was fast (rep 1 hit dead-on), `testPointVerdictFor`'s `'executed'`
 *     rung returns `'on'` directly — the mean is never consulted.
 *
 * `'fast'` before the fix and `'on'` after it, off the IDENTICAL mocked SQL
 * row — the only variable across the two `it()`s below is the
 * `recovery_ended_early` value the mocked query returns, which only reaches
 * the verdict resolver at all because of this fix. Falsified against the
 * pre-fix shape directly: reverting either the SQL SELECT addition or the
 * `recoveryEndedEarly` line on the `resolveWorkoutVerdict` call (this file's
 * own prior state) makes the "AFTER" case fail with `'fast'` instead of
 * `'on'`, while the "BEFORE" case keeps passing either way — which is
 * exactly the asymmetry a real fix should produce.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ────────────────────────────────────
 *
 * It proves ONE consumer (`loadRecentTestPoints`) forwards the field
 * correctly, off one synthetic row. It does not touch the watch recording
 * path (`_RecoveryEndedEarlyTests.swift`), the wire normalisation
 * (`complete/route.ts`'s tests), or `postrun/load.ts`'s own wiring — that
 * path already threads the field; this file is the one that did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-09-09'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { loadRecentTestPoints } from './goal-projection';

const USER_UUID = 'goal-projection-recovery-ended-early-test-user';

/**
 * Rep 1 lands dead-on target (400 s/mi vs a 400 target, ±8 tolerance) —
 * individually 'hit'. Rep 2 runs comfortably fast (350 s/mi) — individually
 * 'fast'. Both LAND the work, so `landed === graded` and the session is
 * 'executed'-eligible; the recovery between them is the only thing that can
 * still drag it to 'uneven'. Shape matches the `stridesSessionPhases`
 * fixture `_recovery_ended_early.test.ts` already uses for the lower-level
 * `gradeStoredPhases` proof — same raw wire fields, same recovery duration.
 */
const PHASES_WITH_SHORT_RECOVERY = [
  { index: 0, type: 'warmup', label: 'Warm-up', actualDurationSec: 300,
    actualDistanceMi: 0.6, completed: true, paceShape: 'ceiling',
    targetPaceSPerMi: 600, actualPaceSPerMi: 580 },
  { index: 1, type: 'work', label: 'Rep 1', actualDurationSec: 400,
    actualDistanceMi: 1, completed: true, paceShape: 'window',
    targetPaceSPerMi: 400, tolerancePaceSPerMi: 8, actualPaceSPerMi: 400 },
  // Cut to 8s against a 60s model — well outside RECOVERY_DURATION_TOLERANCE
  // (±50%) by duration alone. Real account shape (2026-09-09): 8-43s
  // against 60s, all ended deliberately via "End interval."
  { index: 2, type: 'recovery', label: 'Walk back', actualDurationSec: 8,
    targetDurationSec: 60, completed: false },
  { index: 3, type: 'work', label: 'Rep 2', actualDurationSec: 350,
    actualDistanceMi: 1, completed: true, paceShape: 'window',
    targetPaceSPerMi: 400, tolerancePaceSPerMi: 8, actualPaceSPerMi: 350 },
  { index: 4, type: 'cooldown', label: 'Cool-down', actualDurationSec: 300,
    actualDistanceMi: 0.6, completed: true, paceShape: 'ceiling',
    targetPaceSPerMi: 600, actualPaceSPerMi: 590 },
];

/**
 * One `loadRecentTestPoints` row, mocked at the SQL boundary. `recoveryEndedEarly`
 * stands in for the new `recovery_ended_early` column this fix adds to the
 * SELECT — `null` (or absent) is what every row looked like before WALKBACK-2
 * shipped; `[{ phaseIndex: 2 }]` is the recorded-as-chosen shape.
 */
function mockRow(recoveryEndedEarly: unknown): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: unknown) => {
    if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
    // The unique discriminator for `loadRecentTestPoints`' own query — no
    // other query in goal-projection.ts selects `work_phases`.
    if (sql.includes('AS work_phases')) {
      return Promise.resolve({
        rows: [{
          date_iso: '2026-09-01',
          type: 'tempo',
          sub_label: 'TEMPO',
          distance_mi: 3,
          pace_target_s: 400,
          distance_actual: '3',
          duration_s: '1358',
          weather: null,
          work_pace_s: null,
          work_phases: PHASES_WITH_SHORT_RECOVERY,
          recovery_ended_early: recoveryEndedEarly,
          workout_spec: {},
          splits: null,
          splits_unreliable: null,
        }],
      });
    }
    // Every other query this call chain touches (resolvePrescribedPaceAnchors's
    // capacity-resolver fan-out, profile, races, ...) — empty rows, the same
    // documented "no signal" default every one of them already treats safely,
    // and irrelevant here since rung 1 of judgeTestPointExecution (the
    // canonical grade) short-circuits before any of that would matter.
    return Promise.resolve({ rows: [] });
  });
}

describe('loadRecentTestPoints · WALKBACK-2 follow-up (recoveryEndedEarly threaded through)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no recoveryEndedEarly record for the recovery · the unrecorded short recovery drags the verdict to the work MEAN, which reads "fast" (this is the pre-fix shape and must still be reachable, since a genuine lapse must still hold)', async () => {
    mockRow(null);
    const points = await loadRecentTestPoints(USER_UUID, 1);
    expect(points).toHaveLength(1);
    expect(points[0].verdict).toBe('fast');
  });

  it('THE FIX · the SAME phases, with the recovery recorded as chosen (phaseIndex 2) · grades off the per-rep ladder ("on"), never the mean', async () => {
    mockRow([{ phaseIndex: 2 }]);
    const points = await loadRecentTestPoints(USER_UUID, 1);
    expect(points).toHaveLength(1);
    // session.verdict is now 'executed' (recoveriesHonest excluded, not
    // forced true) and NOT every rep was fast (rep 1 hit dead-on target),
    // so testPointVerdictFor's 'executed' rung returns 'on' directly —
    // never falling to the duration-weighted mean the first case hit.
    expect(points[0].verdict).toBe('on');
  });
});
