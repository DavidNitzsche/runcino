/**
 * lib/race/_race_role_accept.test.ts · the ACCEPT side of the race-role card.
 *
 * Two layers, same file:
 *
 *   1 · ROUTE · POST /api/plan/proposal on a pending race_role proposal is
 *       NOT a rebuild: it delegates to applyRaceRole and marks the proposal
 *       accepted. generatePlan is never called. Dismiss stands pat.
 *
 *   2 · APPLY · applyRaceRole persists the role on the race row FIELD-LEVEL
 *       (jsonb_set on meta.plannedRole · Rule 6, never a full-meta replace)
 *       and patches the surrounding week through mutatePlan: b_effort/race
 *       soften the race week's remaining midweek quality to a sharpener and
 *       keep the post-race window quality-free (00b scale); mp_workout makes
 *       race day the week's MP long and stands the separate long down.
 *
 * Harness idiom per _plan_drift_lifecycle.test.ts: mock the pool, route SQL
 * by shape, assert on the calls that left.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/auth/session', () => ({
  requireUserId: vi.fn().mockResolvedValue('00000000-0000-0000-0000-000000000042'),
}));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-10-26'),
}));

vi.mock('@/lib/plan/generate', () => ({
  generatePlan: vi.fn(),
}));

vi.mock('@/lib/plan/auto-rebuild', () => ({
  resolveGoalTarget: vi.fn().mockResolvedValue(null),
}));

// The boundary: run the caller's apply() against the mocked pool client and
// report success, so the test sees exactly the statements the patch issues.
vi.mock('@/lib/plan/mutate', () => ({
  mutatePlan: vi.fn(),
}));

vi.mock('@/lib/race/race-role-apply', async (importOriginal) =>
  importOriginal<Record<string, unknown>>());

import { pool } from '@/lib/db/pool';
import { generatePlan } from '@/lib/plan/generate';
import { mutatePlan } from '@/lib/plan/mutate';

const UUID = '00000000-0000-0000-0000-000000000042';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boundary = mutatePlan as any;

type Router = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
let route: Router = async () => ({ rows: [] });
let issued: Array<{ sql: string; params: unknown[] }> = [];
/** Statements the patch issues INSIDE the boundary's transaction. */
let txIssued: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  txIssued = [];
  route = async () => ({ rows: [] });
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = await route(text, params ?? []);
    return { rows: r.rows, rowCount: r.rows.length };
  });
  boundary.mockImplementation(async (opts: {
    apply: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> }, planId: string) => Promise<number>;
    planId?: string | null;
  }) => {
    const tx = {
      query: async (sql: string, params?: unknown[]) => {
        txIssued.push({ sql, params: params ?? [] });
        return { rows: [], rowCount: 1 };
      },
    };
    const value = await opts.apply(tx, opts.planId ?? 'plan-CIM');
    return { ok: true, outcome: 'applied', value, violations: [], preExisting: [], resolved: [], planId: opts.planId ?? 'plan-CIM' };
  });
});

const RACE_ROLE_PROPOSAL = {
  id: 61, plan_id: 'plan-CIM', proposal_kind: 'race_role', status: 'pending',
  reasons: {
    race_slug: 'run-malibu-2026', race_name: 'Run Malibu', race_date: '2026-11-08',
    race_category: 'hm', a_race_slug: 'cim-2026', gap_to_a_days: 28,
    recommended_role: 'b_effort',
  },
};

function acceptRouter(opts: {
  proposal?: Record<string, unknown>;
  role?: string;
}): Router {
  const proposal = opts.proposal ?? {
    ...RACE_ROLE_PROPOSAL,
    reasons: { ...RACE_ROLE_PROPOSAL.reasons, recommended_role: opts.role ?? 'b_effort' },
  };
  return async (sql) => {
    if (sql.includes('FROM plan_proposals') && sql.includes('SELECT id, plan_id, proposal_kind, status, reasons')) {
      return { rows: [proposal] };
    }
    if (sql.includes('FROM races') && sql.includes("meta->>'date'")) {
      return { rows: [{ slug: 'run-malibu-2026', date: '2026-11-08', name: 'Run Malibu' }] };
    }
    if (sql.includes('FROM training_plans') && sql.includes('authored_state')) {
      return { rows: [{ id: 'plan-CIM', authored_state: { goal_pace_s_per_mi: 412 } }] };
    }
    return { rows: [] };
  };
}

async function postAccept(action = 'accept', id = 61): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/plan/proposal/route');
  const req = {
    json: async () => ({ id, action }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · route · accept is a role application, not a rebuild
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · POST /api/plan/proposal · race_role', () => {
  it('accept applies the role and marks the proposal accepted · generatePlan never runs', async () => {
    route = acceptRouter({ role: 'b_effort' });
    const { status, body } = await postAccept();

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: 'accepted', role: 'b_effort' });
    expect(generatePlan).not.toHaveBeenCalled();

    // The role landed on the race row, field-level (Rule 6: jsonb_set, never
    // a whole-meta replace).
    const metaWrite = issued.find((s) => s.sql.includes('UPDATE races'));
    expect(metaWrite).toBeDefined();
    expect(metaWrite!.sql).toContain("jsonb_set(meta, '{plannedRole}'");
    expect(metaWrite!.sql).not.toMatch(/SET\s+meta\s*=\s*\$\d/);
    expect(metaWrite!.params).toContain('b_effort');

    // The proposal terminal state.
    const accepted = issued.find((s) => s.sql.includes("status = 'accepted'"));
    expect(accepted).toBeDefined();
    expect(accepted!.params).toContain('b_effort');

    // And the week patch went through the mutation boundary.
    expect(boundary).toHaveBeenCalledTimes(1);
    expect(boundary.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, planId: 'plan-CIM', touches: 'structural',
    });
  });

  it('dismiss stands pat · no role write, no boundary, no rebuild', async () => {
    route = acceptRouter({});
    const { status, body } = await postAccept('dismiss');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: 'dismissed' });
    expect(issued.some((s) => s.sql.includes('UPDATE races'))).toBe(false);
    expect(boundary).not.toHaveBeenCalled();
    expect(generatePlan).not.toHaveBeenCalled();
  });

  it('a failed patch leaves the proposal pending and reports the failure', async () => {
    boundary.mockResolvedValue({
      ok: false, outcome: 'rejected', value: null,
      violations: ['week 10: no quality in a QUALITY-phase week'],
      preExisting: [], resolved: [], planId: 'plan-CIM',
    });
    route = acceptRouter({});
    const { status, body } = await postAccept();
    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, status: 'pending' });
    const failNote = issued.find((s) => s.sql.includes('accept_attempt_failed'));
    expect(failNote).toBeDefined();
    expect(issued.some((s) => s.sql.includes("status = 'accepted'"))).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · the week patch, per role
 * ═══════════════════════════════════════════════════════════════════════ */

/** The coaching copy rides in bound parameters, so search sql AND params. */
const findStmt = (needle: string) =>
  txIssued.find((s) => s.sql.includes(needle) || s.params.some((p) => typeof p === 'string' && p.includes(needle)));

describe('2 · the patch the boundary carries', () => {
  it('b_effort · sharpener before, quality-free window after (7 days per 00b B scale)', async () => {
    route = acceptRouter({ role: 'b_effort' });
    await postAccept();

    const sharpener = findStmt('SHARPENER');
    expect(sharpener).toBeDefined();
    // The pre-race window: the six days before race day.
    expect(sharpener!.params).toContain('2026-11-02');
    expect(sharpener!.params).toContain('2026-11-08');

    const postWindow = findStmt('Post-race recovery after');
    expect(postWindow).toBeDefined();
    // 00b B-race half scale: 7 days quality-free → window end Nov 15.
    expect(postWindow!.params).toContain('2026-11-15');

    const raceDay = findStmt('RACE · B EFFORT');
    expect(raceDay).toBeDefined();
    expect(raceDay!.sql).toContain("type = 'race'");
  });

  it('race (honest) · the post-race window takes the A-effort floor (10 days)', async () => {
    route = acceptRouter({ role: 'race' });
    await postAccept();
    const postWindow = findStmt('Post-race recovery after');
    expect(postWindow).toBeDefined();
    expect(postWindow!.params).toContain('2026-11-18');
  });

  it('mp_workout · race day becomes the MP long at the plan goal pace; the separate long stands down', async () => {
    route = acceptRouter({ role: 'mp_workout' });
    await postAccept();

    const mpDay = findStmt('RACE · MP LONG');
    expect(mpDay).toBeDefined();
    expect(mpDay!.sql).toContain('is_long = true');
    // MP = the plan's own goal pace (authored_state.goal_pace_s_per_mi).
    expect(mpDay!.params).toContain(412);

    const longDown = findStmt("is this week's long run");
    expect(longDown).toBeDefined();

    // No race-recovery window for a workout · just next-day spacing.
    expect(findStmt('Post-race recovery after')).toBeUndefined();
    const dayAfter = findStmt('day after');
    expect(dayAfter).toBeDefined();
    expect(dayAfter!.params).toContain('2026-11-09');
  });

  it('every patch statement is bounded to the future · no sealed-day rewrites', async () => {
    route = acceptRouter({ role: 'b_effort' });
    await postAccept();
    for (const s of txIssued) {
      expect(s.sql, s.sql).toMatch(/date_iso\s*(>|>=)\s*\$\d/);
      expect(s.params).toContain('2026-10-26');
    }
  });
});
