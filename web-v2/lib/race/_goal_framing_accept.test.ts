/**
 * lib/race/_goal_framing_accept.test.ts · the ANSWER side of the
 * race_goal_framing card, at the route level with the database mocked
 * (harness idiom per _race_role_accept.test.ts: mock the pool, route SQL by
 * shape, drive POST /api/plan/proposal, assert on the calls that left).
 *
 * The contract (David 2026-08-28, GOALFRAME-1):
 *
 *   · ACCEPT keeps the graded time targets → races.meta.goalFraming = 'time'
 *   · DISMISS is an ANSWER, not a shrug → races.meta.goalFraming = 'effort'
 *   · either way the write is ONE field-level jsonb_set (Rule 6 — races.meta
 *     has many writers; a full-meta replace would erase siblings), scoped to
 *     the caller's user_uuid, and NOTHING rebuilds: generatePlan is never
 *     called, no plan row moves, the framing is compute-on-read.
 *   · a vanished race row resolves the card (dismissed, race_missing)
 *     rather than stranding it pending forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/auth/session', () => ({
  requireUserId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000042'),
}));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
}));

vi.mock('@/lib/plan/generate', () => ({
  generatePlan: vi.fn(),
}));

vi.mock('@/lib/plan/auto-rebuild', () => ({
  resolveGoalTarget: vi.fn().mockResolvedValue(null),
}));

import { pool } from '@/lib/db/pool';
import { generatePlan } from '@/lib/plan/generate';

const UUID = '00000000-0000-0000-0000-000000000042';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;

type Router = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>;
let route: Router = async () => ({ rows: [] });
let issued: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  route = async () => ({ rows: [] });
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = await route(text, params ?? []);
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  });
});

const PROPOSAL = {
  id: 41,
  plan_id: null,
  proposal_kind: 'race_goal_framing',
  status: 'pending',
  reasons: {
    race_slug: 'santa-monica-10k-2026-09-13',
    race_name: 'Santa Monica',
    default_framing: 'time',
  },
};

function framingRouter(opts: {
  proposal?: Record<string, unknown> | null;
  /** rowCount the races UPDATE reports (0 = race row gone). */
  raceRows?: number;
}): Router {
  return async (sql) => {
    if (sql.includes('FROM plan_proposals') && sql.includes('WHERE id = $1')) {
      return { rows: opts.proposal === null ? [] : [opts.proposal ?? PROPOSAL] };
    }
    if (sql.includes('UPDATE races')) {
      return { rows: [], rowCount: opts.raceRows ?? 1 };
    }
    return { rows: [] };
  };
}

async function post(body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/plan/proposal/route');
  const req = {
    json: async () => body,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
}

const raceUpdates = () => issued.filter((s) => s.sql.includes('UPDATE races'));
const proposalUpdates = () => issued.filter((s) => s.sql.includes('UPDATE plan_proposals'));

describe('accept · RACE THE NUMBER', () => {
  it("persists goalFraming = 'time' field-level and resolves the card accepted", async () => {
    route = framingRouter({});
    const { status, json } = await post({ id: 41, action: 'accept' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 'accepted', goalFraming: 'time' });

    const updates = raceUpdates();
    expect(updates.length).toBe(1);
    // Rule 6 · field-level jsonb_set on goalFraming, never a full-meta SET.
    expect(updates[0].sql).toContain("jsonb_set(meta, '{goalFraming}'");
    expect(updates[0].sql).not.toMatch(/SET\s+meta\s*=\s*\$/i);
    // Scoped to the caller and the slug from the proposal's own reasons.
    expect(updates[0].sql).toContain('user_uuid = $1');
    expect(updates[0].params).toEqual([UUID, 'santa-monica-10k-2026-09-13', 'time']);

    const resolved = proposalUpdates().find((s) => s.sql.includes("'accepted'") || s.params.includes('accepted'));
    expect(resolved).toBeDefined();
    expect(resolved!.params).toContain('accepted');
    expect(resolved!.params).toContain('time');

    // NOT a rebuild. Nothing plans, nothing generates.
    expect(generatePlan).not.toHaveBeenCalled();
  });
});

describe('dismiss · KEEP IT ON EFFORT (an answer, not a shrug)', () => {
  it("persists goalFraming = 'effort' and resolves the card dismissed", async () => {
    route = framingRouter({});
    const { status, json } = await post({ id: 41, action: 'dismiss' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, status: 'dismissed', goalFraming: 'effort' });

    const updates = raceUpdates();
    expect(updates.length).toBe(1);
    expect(updates[0].sql).toContain("jsonb_set(meta, '{goalFraming}'");
    expect(updates[0].params).toEqual([UUID, 'santa-monica-10k-2026-09-13', 'effort']);

    const resolved = proposalUpdates().find((s) => s.params.includes('dismissed'));
    expect(resolved).toBeDefined();
    expect(resolved!.params).toContain('effort');
    expect(generatePlan).not.toHaveBeenCalled();
  });
});

describe('edges', () => {
  it('race row gone → the card resolves dismissed with race_missing, never strands pending', async () => {
    route = framingRouter({ raceRows: 0 });
    const { status, json } = await post({ id: 41, action: 'accept' });
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: false, status: 'dismissed', reason: 'race_missing' });
    const resolved = proposalUpdates().find((s) => s.sql.includes('race_missing'));
    expect(resolved).toBeDefined();
    expect(generatePlan).not.toHaveBeenCalled();
  });

  it('a proposal missing race_slug → 500, nothing written to the race', async () => {
    route = framingRouter({ proposal: { ...PROPOSAL, reasons: {} } });
    const { status } = await post({ id: 41, action: 'accept' });
    expect(status).toBe(500);
    expect(raceUpdates().length).toBe(0);
  });

  it('an already-resolved card → 409 through the generic guard, nothing written', async () => {
    route = framingRouter({ proposal: { ...PROPOSAL, status: 'accepted' } });
    const { status } = await post({ id: 41, action: 'accept' });
    expect(status).toBe(409);
    expect(raceUpdates().length).toBe(0);
  });
});
