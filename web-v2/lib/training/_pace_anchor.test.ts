/**
 * lib/training/_pace_anchor.test.ts · the one pace-anchor authority.
 *
 * Two writers touch `pace_target_s_per_mi` on the same morning — the 03:00
 * adapter and the 07:30 self-heal. This suite locks the consolidation
 * (2026-08-28):
 *
 *   1 · THE THRESHOLD POLICY is one module. The adapter's exported constants
 *       and the self-heal's are the shared ones, and the ordering doctrine
 *       requires (training 1.0 ≤ race 1.5 ≤ self-heal 2.0) holds.
 *   2 · THE ANCHOR CASCADE is one function, provisional-skip included.
 *   3 · THE DEFERRAL: the self-heal stands down for 24h after an adapter
 *       anchor move, records the skip as a no-op with a reason, and still
 *       fires for a provisional→measured upgrade. The race-authority force
 *       path never consults the deferral at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/plan/mutate', () => ({
  mutatePlan: vi.fn(async (opts: { apply: (c: unknown) => Promise<unknown> }) => {
    const { pool } = await import('@/lib/db/pool');
    const value = await opts.apply(pool);
    return { ok: true, value, violations: [], preExisting: [] };
  }),
}));
vi.mock('@/lib/plan/pace-drop-event', () => ({
  recordPaceZoneEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/plan/lookup', () => ({
  bustPlanLookupCache: vi.fn(),
}));
// REANCHORPROPOSES-1 · the proposal writer asks the day-resolver which future
// days are already run, rather than writing its own date-coincidence query
// (EXECID-SCAN-1). One day is sealed here so the fixture exercises both counts.
vi.mock('@/lib/execution/day-resolver', () => ({
  resolveDateRangeExecutions: vi.fn(async () => new Map([
    ['2026-08-29', { dateISO: '2026-08-29', prescriptions: [{ id: 'wko-1', matchedRun: { id: 'run-1' } }], supplementalRuns: [] }],
  ])),
}));
// REANCHORPROPOSES-1 · both halves of the self-heal price off the canonical
// resolver, so it is stubbed with a fixed, coherent anchor set. The suite is
// about WHICH HALF RUNS, never about the numbers.
vi.mock('@/lib/training/load-prescription-anchors', () => ({
  resolvePrescribedPaceAnchors: vi.fn(async () => ({
    ok: true,
    anchors: {
      thresholdSecPerMi: 420, intervalSecPerMi: 392, repetitionSecPerMi: 356,
      easyCeilingSecPerMi: 492, shakeoutCeilingSecPerMi: 522, marathonSecPerMi: 462,
      basis: { threshold: { vdot: 48.5, confidence: 0.8, sourceMode: 'direct' } },
    },
  })),
}));

import { pool } from '@/lib/db/pool';
import { mutatePlan } from '@/lib/plan/mutate';
import {
  RACE_EVIDENCE_REANCHOR_DELTA,
  TRAINING_LEAD_REANCHOR_DELTA,
  SELF_HEAL_REANCHOR_DELTA,
  ADAPTER_ANCHOR_DEFER_HOURS,
  anchorVdotFromState,
  selfHealShouldDefer,
} from './pace-anchor';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · one threshold policy
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · the threshold policy', () => {
  it('holds the doctrinal ordering · training ≤ race ≤ self-heal', () => {
    expect(TRAINING_LEAD_REANCHOR_DELTA).toBeLessThanOrEqual(RACE_EVIDENCE_REANCHOR_DELTA);
    expect(RACE_EVIDENCE_REANCHOR_DELTA).toBeLessThanOrEqual(SELF_HEAL_REANCHOR_DELTA);
  });

  it('the consolidation changed NO detection threshold · same three values as before', () => {
    // The brief's constraint: consolidate the policy, do not move it. These
    // pins replace the literals the doctrine gate used to grep for.
    expect(TRAINING_LEAD_REANCHOR_DELTA).toBe(1.0);
    expect(RACE_EVIDENCE_REANCHOR_DELTA).toBe(1.5);
    expect(SELF_HEAL_REANCHOR_DELTA).toBe(2.0);
  });

  it('the adapter exports ARE the shared constants (no second policy)', async () => {
    const adapt = await import('@/lib/plan/adapt');
    expect(adapt.REGRESSION_DELTA_THRESHOLD).toBe(RACE_EVIDENCE_REANCHOR_DELTA);
    expect(adapt.TRAINING_LEAD_DELTA_THRESHOLD).toBe(TRAINING_LEAD_REANCHOR_DELTA);
  });

  it('the self-heal export IS the shared constant', async () => {
    const reanchor = await import('@/lib/plan/reanchor-plan');
    expect(reanchor.REANCHOR_VDOT_DELTA).toBe(SELF_HEAL_REANCHOR_DELTA);
  });

  it('the deferral window covers the 03:00 → 07:30 same-morning gap', () => {
    expect(ADAPTER_ANCHOR_DEFER_HOURS).toBeGreaterThanOrEqual(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · one anchor cascade
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2 · anchorVdotFromState', () => {
  it('vdot_last_reviewed wins the cascade', () => {
    expect(anchorVdotFromState('47.2', {
      pace_recompute: { vdot: 44 },
      pace_blend: { season_anchor_vdot: 42 },
      derived_from: { bestRecentVdot: 40 },
    })).toBe(47.2);
  });

  it('falls through reviewed → pace_recompute → pace_blend → derived_from', () => {
    expect(anchorVdotFromState(null, { pace_recompute: { vdot: 44 } })).toBe(44);
    expect(anchorVdotFromState(null, { pace_blend: { season_anchor_vdot: 42 } })).toBe(42);
    expect(anchorVdotFromState(null, { derived_from: { bestRecentVdot: 40 } })).toBe(40);
    expect(anchorVdotFromState(null, {})).toBeNull();
    expect(anchorVdotFromState(null, null)).toBeNull();
  });

  it('COLD-3 · a PROVISIONAL blend anchor is skipped, not read', () => {
    // A mileage-derived VDOT is not fitness; the cascade must fall through to
    // derived_from, which only exists when something was measured.
    expect(anchorVdotFromState(null, {
      pace_blend: { season_anchor_vdot: 40, season_anchor_provisional: true },
      derived_from: { bestRecentVdot: 46 },
    })).toBe(46);
    expect(anchorVdotFromState(null, {
      pace_blend: { season_anchor_vdot: 40, season_anchor_provisional: true },
    })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the deferral decision (pure)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · selfHealShouldDefer', () => {
  it('defers when the adapter moved the anchor inside the window', () => {
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: false, adapterMoveRecent: true })).toBe(true);
  });
  it('proceeds when the adapter did not', () => {
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: false, adapterMoveRecent: false })).toBe(false);
  });
  it('fails CLOSED · an unreadable record defers', () => {
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: false, adapterMoveRecent: null })).toBe(true);
  });
  it('a provisional→measured upgrade NEVER defers · it is strictly more authoritative', () => {
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: true, adapterMoveRecent: true })).toBe(false);
    expect(selfHealShouldDefer({ upgradesProvisionalAnchor: true, adapterMoveRecent: null })).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · reanchorActivePlan honours the deferral, with a RECORDED skip
 * ═══════════════════════════════════════════════════════════════════════ */

type Router = (sql: string, params: unknown[]) => { rows: Record<string, unknown>[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
let issued: Array<{ sql: string; params: unknown[] }> = [];
let route: Router = () => ({ rows: [] });

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  route = () => ({ rows: [] });
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = route(text, params ?? []);
    return { rows: r.rows, rowCount: r.rows.length };
  });
});

const UUID = '00000000-0000-0000-0000-000000000042';

function maintenancePlanRouter(opts: {
  anchorSource: string | null;
  adapterMovedRecently: boolean;
}): Router {
  return (sql) => {
    if (sql.includes('FROM training_plans')) {
      return { rows: [{
        id: 'plan-1', mode: 'maintenance', race_id: null,
        authored_state: {
          anchorSource: opts.anchorSource,
          anchorVdot: 50,
          // REANCHORPROPOSES-1 · the Rule 10 stamp. Without a from-side the
          // proposal writer REFUSES (it cannot say what would change), so a
          // fixture with no anchors would exercise the refusal branch and
          // report it as coverage of the propose branch — Rule 15's shape.
          pace_anchors: {
            threshold_s_per_mi: 430, interval_s_per_mi: 401, repetition_s_per_mi: 365,
            easy_ceiling_s_per_mi: 502, shakeout_ceiling_s_per_mi: 532, marathon_s_per_mi: 472,
          },
        },
      }] };
    }
    if (sql.includes("reason = 'plan_adapt_recompute_paces'")) {
      return { rows: opts.adapterMovedRecently ? [{ '?column?': 1 }] : [] };
    }
    // The proposal writer's prescription-side read. The SEALED side is the
    // day-resolver's, stubbed above — this writer issues no `runs` query.
    if (sql.includes('FROM plan_workouts pw') && sql.includes('date_iso >=')) {
      return { rows: [
        { id: 'wko-1', date_iso: '2026-08-29' },
        { id: 'wko-2', date_iso: '2026-08-31' },
        { id: 'wko-3', date_iso: '2026-09-02' },
      ] };
    }
    if (sql.includes('INSERT INTO plan_workout_proposals')) {
      return { rows: [{ id: 900 }] };
    }
    // Maintenance arm's future-workouts read, the existing-reprice read and
    // every write: empty is fine.
    return { rows: [] };
  };
}

describe('4 · reanchorActivePlan deferral', () => {
  it('stands down for 24h after an adapter recompute, and says so', async () => {
    route = maintenancePlanRouter({ anchorSource: 'measured_run', adapterMovedRecently: true });
    const { reanchorActivePlan, isReanchorDeferral } = await import('@/lib/plan/reanchor-plan');
    const out = await reanchorActivePlan(UUID, 53, '2026-08-28');

    // A recorded no-op with a reason — never null, never a rewrite.
    expect(out).not.toBeNull();
    expect(isReanchorDeferral(out)).toBe(true);
    if (isReanchorDeferral(out)) {
      expect(out.reason).toBe('deferred_to_adapter_recompute');
      expect(out.planId).toBe('plan-1');
    }
    expect(mutatePlan).not.toHaveBeenCalled();
  });

  it('a provisional→measured upgrade still fires the same morning · as a CARD', async () => {
    route = maintenancePlanRouter({ anchorSource: null, adapterMovedRecently: true });
    const { reanchorActivePlan, isReanchorDeferral, isReanchorProposed } =
      await import('@/lib/plan/reanchor-plan');
    const out = await reanchorActivePlan(UUID, 46, '2026-08-28');

    expect(isReanchorDeferral(out)).toBe(false);
    expect(out).not.toBeNull();
    // REANCHORPROPOSES-1 · this used to assert `clearedProvisional` and
    // `mutatePlan` called once. Both were assertions that the UNATTENDED path
    // writes the plan, which is the thing that was wrong.
    expect(isReanchorProposed(out)).toBe(true);
    if (isReanchorProposed(out)) {
      expect(out.outcome.status).toBe('written');
      expect(out.arm).toBe('maintenance');
      if (out.outcome.status === 'written') {
        // The card hangs on the earliest day that is NOT already run, and it
        // counts both sides. `wko-1` carries a matched run, so it is sealed.
        expect(out.outcome.payload.workoutsAffected).toBe(2);
        expect(out.outcome.payload.workoutsSealed).toBe(1);
        // A faster anchor set reads NEGATIVE seconds per mile.
        expect(out.outcome.payload.meanAnchorDeltaSecPerMi).toBeLessThan(0);
      }
    }
    expect(issued.some((s) => s.sql.includes('INSERT INTO plan_workout_proposals'))).toBe(true);
    // The deferral question is not even asked for an upgrade.
    expect(issued.some((s) => s.sql.includes('plan_adapt_recompute_paces'))).toBe(false);
    expect(mutatePlan).not.toHaveBeenCalled();
  });

  it('with no adapter move on record, a real fitness shift raises a card and writes NO plan row', async () => {
    route = maintenancePlanRouter({ anchorSource: 'measured_run', adapterMovedRecently: false });
    const { reanchorActivePlan, isReanchorDeferral, isReanchorProposed } =
      await import('@/lib/plan/reanchor-plan');
    const out = await reanchorActivePlan(UUID, 53, '2026-08-28'); // Δ3 ≥ 2.0

    expect(isReanchorDeferral(out)).toBe(false);
    expect(isReanchorProposed(out)).toBe(true);
    expect(
      issued.some((s) => /UPDATE plan_workouts/i.test(s.sql)),
      'the unattended self-heal wrote a plan row. That is the defect this conversion removed.',
    ).toBe(false);
    expect(mutatePlan).not.toHaveBeenCalled();
  });

  it('the race-authority FORCE path never consults the deferral', async () => {
    route = maintenancePlanRouter({ anchorSource: 'measured_run', adapterMovedRecently: true });
    const { forceReanchorActivePlan } = await import('@/lib/plan/reanchor-plan');
    const out = await forceReanchorActivePlan(UUID, 47, '2026-08-28');

    // The runner's confirmed answer applies unconditionally.
    expect(out).not.toBeNull();
    expect(issued.some((s) => s.sql.includes('plan_adapt_recompute_paces'))).toBe(false);
    expect(mutatePlan).toHaveBeenCalledTimes(1);
  });
});
