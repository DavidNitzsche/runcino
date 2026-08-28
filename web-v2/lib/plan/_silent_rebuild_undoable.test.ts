/**
 * lib/plan/_silent_rebuild_undoable.test.ts · silent-rebuild is undoable.
 *
 * The defect (registry entry cron/silent-rebuild, pre-2026-08-28): the route
 * called generatePlan directly and wrote NO plan_proposals row — and that row
 * is the only record pairing an archived plan to its replacement, so POST
 * /api/plan/undo returned not_undoable for every rebuild this route
 * performed. It was the one plan writer the runner could not undo.
 *
 * Now it routes through fireAutoRebuild (kind 'silent_rebuild'), which
 * writes the auto_applied pairing row, dedupes double dispatches, and rolls
 * back identical rebuilds as no_change.
 *
 * Same harness idiom as _plan_drift_lifecycle.test.ts: mock the pool, route
 * SQL by shape, drive the route's POST, assert on the calls that left.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/plan/auto-rebuild', () => ({
  fireAutoRebuild: vi.fn(),
}));

import { pool } from '@/lib/db/pool';
import { fireAutoRebuild } from '@/lib/plan/auto-rebuild';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fire = fireAutoRebuild as any;

const UUID = '00000000-0000-0000-0000-000000000042';

function req(body: Record<string, unknown>) {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) },
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let issued: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  issued = [];
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    if (text.includes('SELECT id, race_id FROM training_plans')) {
      return { rows: [{ id: 'plan-OLD', race_id: 'cim-2026' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  fire.mockResolvedValue({ ok: true, newPlanId: 'plan-NEW', proposalId: 42 });
});

async function post(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/cron/silent-rebuild/route');
  const res = await POST(req(body));
  return { status: res.status, body: await res.json() };
}

describe('silent-rebuild routes through fireAutoRebuild', () => {
  it('fires kind silent_rebuild toward the active plan\'s race and returns the pairing row id', async () => {
    const { status, body } = await post({ userUuid: UUID });

    expect(status).toBe(200);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, raceSlug: 'cim-2026', kind: 'silent_rebuild',
      source: 'silent_rebuild_dispatch',
    });
    expect(body).toMatchObject({
      ok: true, prior_plan_id: 'plan-OLD', new_plan_id: 'plan-NEW',
      proposal_id: 42, unchanged: false,
    });
    // The stale-banner ack still runs when a new block landed.
    expect(issued.some((s) => s.sql.includes('UPDATE coach_intents'))).toBe(true);
  });

  it('a no_change rollback acks NOTHING · the prior plan is still the active plan', async () => {
    fire.mockResolvedValue({ ok: true, unchanged: true, proposalId: 43 });
    const { status, body } = await post({ userUuid: UUID });

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, unchanged: true, new_plan_id: null });
    expect(issued.some((s) => s.sql.includes('UPDATE coach_intents'))).toBe(false);
  });

  it('a failed rebuild is a 500 with the reason, not a silent success', async () => {
    fire.mockResolvedValue({ ok: false, reason: 'generator refused' });
    const { status, body } = await post({ userUuid: UUID });

    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, reason: 'generator refused' });
    expect(issued.some((s) => s.sql.includes('UPDATE coach_intents'))).toBe(false);
  });

  it('no active plan and no raceSlug is still a 400 · nothing fires', async () => {
    query.mockImplementation(async (sql: unknown) => {
      issued.push({ sql: String(sql), params: [] });
      return { rows: [], rowCount: 0 };
    });
    const { status } = await post({ userUuid: UUID });
    expect(status).toBe(400);
    expect(fire).not.toHaveBeenCalled();
  });
});
