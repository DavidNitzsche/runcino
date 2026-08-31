/**
 * lib/plan/_race_role_card.test.ts · the tune-up race-role CARD, at the
 * route level with the database mocked (same harness idiom as
 * _plan_drift_lifecycle.test.ts: mock the pool, route SQL by shape, drive
 * the cron's POST, assert on the calls that left).
 *
 * The ruling under test (David 2026-08-28): when a tune-up race approaches
 * inside a goal build, the coach RECOMMENDS how to run it and the runner
 * answers. The card is the WHOLE automatic action — a pending proposal,
 * never an auto-apply — and it fires EXACTLY ONCE per race:
 *
 *   · in the [12..15]-day window before the tune-up (a band, so one missed
 *     cron night cannot skip it), deduped on any prior race_role row for
 *     that slug, any status;
 *   · never for a C race (00b prices a C at 0-3 easy days · decided);
 *   · never for a race already carrying an answered meta.plannedRole;
 *   · never outside the window.
 *
 * The live shape: Run Malibu (half, 2026-11-08, B) 28 days before CIM
 * (A marathon, 2026-12-06) → recommended_role 'b_effort', firing Oct 24-27.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — these must precede every import that resolves them.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-10-25'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

vi.mock('@/lib/plan/drift-monitor', () => ({
  detectDrift: vi.fn().mockResolvedValue(null),
  hasPendingProposal: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/plan/goal-gap', () => ({
  computeGoalGap: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/plan/goal-outlook', () => ({
  expireStalePendingProposals: vi.fn().mockResolvedValue(0),
  shouldSurfaceGoalOutlook: vi.fn().mockReturnValue(false),
  resolveGoalOutlookProjection: vi.fn().mockResolvedValue({ projectedSec: null, basis: null }),
  writeGoalOutlookNote: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/race/auto-result', () => ({
  detectAndLogProvisionalResults: vi.fn().mockResolvedValue([]),
}));

// The generator is a 10k-line module; the route pulls distanceMiOf only.
// Real meta rows carry distanceMi, so mirror the real parser's happy path.
vi.mock('@/lib/plan/generate', () => ({
  distanceMiOf: vi.fn((meta: Record<string, unknown>) =>
    typeof meta?.distanceMi === 'number' ? meta.distanceMi : null),
}));

vi.mock('@/lib/plan/auto-rebuild', () => ({
  fireAutoRebuild: vi.fn().mockResolvedValue({ ok: true, newPlanId: 'plan-NEW', proposalId: 7 }),
  resolveGoalTarget: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/plan/adapt', () => ({
  runnerIsCompromised: vi.fn().mockResolvedValue({ compromised: false }),
}));

vi.mock('@/lib/plan/open-block', () => ({
  authorOpenBlock: vi.fn().mockResolvedValue({ ok: false, reason: 'already_pending' }),
}));

vi.mock('@/lib/plan/proposals-state', () => ({
  supersedeProposalsForArchivedPlans: vi.fn().mockResolvedValue(0),
  supersedeIntentsForArchivedPlans: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/lib/notifications/block-started', () => ({
  notifyBlockStarted: vi.fn().mockResolvedValue({ sent: true, reason: 'enqueued' }),
}));

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

/* ══════════════════════════════════════════════════════════════════════════
 * HARNESS
 * ═══════════════════════════════════════════════════════════════════════ */

const UUID = '00000000-0000-0000-0000-000000000042';

const REQ = {
  headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

type Rows = { rows: Record<string, unknown>[]; rowCount: number };
type Router = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const today = runnerToday as any;

let route: Router = async () => ({ rows: [] });
let issued: Array<{ sql: string; params: unknown[] }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  issued = [];
  route = async () => ({ rows: [] });
  today.mockResolvedValue('2026-10-25');
  query.mockImplementation(async (sql: unknown, params?: unknown[]): Promise<Rows> => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = await route(text, params ?? []);
    return { rows: r.rows, rowCount: r.rows.length };
  });
});

const roleInserts = () =>
  issued.filter((s) => s.sql.includes('INSERT INTO plan_proposals') && s.sql.includes("'race_role'"));

/** Malibu meta as the races table would carry it. */
const MALIBU_META = {
  name: 'Run Malibu', date: '2026-11-08', distanceMi: 13.1, priority: 'B',
};
const CIM_META = {
  name: 'CIM', date: '2026-12-06', distanceMi: 26.2, priority: 'A',
};

function raceRoleRouter(opts: {
  /** null → no active race-prep build. */
  build?: { plan_id: string; race_id: string; race_date: string; race_meta: Record<string, unknown> } | null;
  /** Rows the tune-up window query returns (the SQL already filters). */
  tuneUps?: Array<{ slug: string; meta: Record<string, unknown> }>;
  /** Per-slug: a prior race_role row exists (any status). */
  asked?: (slug: string) => boolean;
}): Router {
  return async (sql, params) => {
    if (sql.includes('UNION') && sql.includes('FROM training_plans')) {
      return { rows: [{ user_uuid: UUID }] };
    }
    if (sql.includes("tp.mode = 'maintenance'")) return { rows: [] };
    if (sql.includes("tp.mode = 'recovery'")) return { rows: [] };
    // The race-role build lookup (race-prep plan JOINed to its target race).
    if (sql.includes("tp.mode = 'race-prep'")) {
      return { rows: opts.build ? [opts.build] : [] };
    }
    // The tune-up window query.
    if (sql.includes("meta->>'plannedRole' IS NULL")) {
      return { rows: opts.tuneUps ?? [] };
    }
    // The per-slug exactly-once dedupe guard.
    if (sql.includes("reasons->>'race_slug'")) {
      const slug = String(params[1] ?? '');
      return { rows: opts.asked?.(slug) ? [{ '?column?': 1 }] : [] };
    }
    // Active-plan lookup for the elapsed branch: keep the plan alive.
    if (sql.includes('MAX(pw.date_iso)')) {
      return {
        rows: [{
          plan_id: 'plan-CIM', race_id: 'cim-2026', race_date: '2026-12-06',
          goal_mode: null, mode: 'race-prep', authored_mode: null,
          mode_label: null, last_workout_iso: '2026-12-06',
        }],
      };
    }
    if (sql.includes('archived_iso IS NULL LIMIT 1')) return { rows: [{ id: 'plan-CIM' }] };
    if (sql.includes('FROM races')) return { rows: [] };
    return { rows: [] };
  };
}

const BUILD = {
  plan_id: 'plan-CIM', race_id: 'cim-2026', race_date: '2026-12-06', race_meta: CIM_META,
};

async function runCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/plan-drift/route');
  return await (await POST(REQ)).json();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · the Malibu shape · fires once, with the B-effort recommendation
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · the card fires in the window, once, with the recommendation', () => {
  it('Malibu 14 days out inside the CIM build → ONE pending race_role card, b_effort', async () => {
    route = raceRoleRouter({
      build: BUILD,
      tuneUps: [{ slug: 'run-malibu-2026', meta: MALIBU_META }],
    });
    const body = await runCron();

    const inserts = roleInserts();
    expect(inserts.length).toBe(1);
    expect(inserts[0].sql).toContain("'pending'");
    expect(inserts[0].sql).toContain("'race_role_cron'");
    // plan_id NULL by design: the card is about the RACE, so a mid-window
    // rebuild (which supersedes plan-pointing pending proposals) must not
    // kill it — the per-slug dedupe would then block a re-fire forever.
    expect(inserts[0].params[1]).toBeNull();
    const reasons = JSON.parse(String(inserts[0].params[2]));
    expect(reasons).toMatchObject({
      race_slug: 'run-malibu-2026',
      race_name: 'Run Malibu',
      race_category: 'hm',
      a_race_slug: 'cim-2026',
      gap_to_a_days: 28,
      days_to_race: 14,
      recommended_role: 'b_effort',
      accept_verb: 'RUN IT AT B EFFORT',
      card_title: 'Run Malibu, four weeks out',
    });
    expect(String(reasons.message)).toContain('Race it at B effort');
    expect(String(reasons.message)).toContain('Leave this and the plan stands as authored');
    expect(body.errors).toBe(0);
  });

  it('fires EXACTLY ONCE · a prior race_role row for the slug (any status) blocks a re-fire', async () => {
    let asked = false;
    route = raceRoleRouter({
      build: BUILD,
      tuneUps: [{ slug: 'run-malibu-2026', meta: MALIBU_META }],
      asked: () => asked,
    });
    await runCron();
    expect(roleInserts().length).toBe(1);
    asked = true;
    issued = [];
    await runCron();
    expect(roleInserts().length).toBe(0);
  });

  it('the dedupe guard fails CLOSED · an unreadable guard writes nothing', async () => {
    const base = raceRoleRouter({
      build: BUILD,
      tuneUps: [{ slug: 'run-malibu-2026', meta: MALIBU_META }],
    });
    route = async (sql, params) => {
      if (sql.includes("reasons->>'race_slug'")) throw new Error('connection terminated');
      return base(sql, params);
    };
    const body = await runCron();
    expect(roleInserts().length).toBe(0);
    // A failed guard is a skip, not a crash: the pass keeps going.
    expect(body.errors).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · who never gets a card
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2 · never fires', () => {
  it('a C race · the matrix refuses even if the row reaches the loop', async () => {
    route = raceRoleRouter({
      build: BUILD,
      tuneUps: [{ slug: 'parkrun', meta: { name: 'Parkrun', date: '2026-11-08', distanceMi: 3.1, priority: 'C' } }],
    });
    await runCron();
    expect(roleInserts().length).toBe(0);
  });

  it('the SQL window query filters C races and answered roles out at the source', async () => {
    route = raceRoleRouter({ build: BUILD, tuneUps: [] });
    await runCron();
    const windowQ = issued.find((s) => s.sql.includes("meta->>'plannedRole' IS NULL"));
    expect(windowQ).toBeDefined();
    expect(windowQ!.sql).toContain("meta->>'priority' = 'B'");
  });

  it('no active race-prep build → no card', async () => {
    route = raceRoleRouter({ build: null, tuneUps: [{ slug: 'run-malibu-2026', meta: MALIBU_META }] });
    await runCron();
    expect(roleInserts().length).toBe(0);
  });

  it('a marathon-distance B race is not a tune-up · no card', async () => {
    route = raceRoleRouter({
      build: BUILD,
      tuneUps: [{ slug: 'some-marathon', meta: { name: 'Some Marathon', date: '2026-11-08', distanceMi: 26.2, priority: 'B' } }],
    });
    await runCron();
    expect(roleInserts().length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the window · [12..15] days, parameterized into the SQL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · the fire window', () => {
  it('the window bounds ride into the query as parameters (12 and 15)', async () => {
    route = raceRoleRouter({ build: BUILD, tuneUps: [] });
    await runCron();
    const windowQ = issued.find((s) => s.sql.includes("meta->>'plannedRole' IS NULL"))!;
    expect(windowQ.params).toContain(12);
    expect(windowQ.params).toContain(15);
    expect(windowQ.sql).toContain('BETWEEN $4 AND $5');
  });

  it('Oct 24 through Oct 27 are all inside the band for a Nov 8 race', async () => {
    // The SQL does the filtering in prod; here the assertion is that the
    // window arithmetic the card records (days_to_race) matches each night.
    for (const [day, expected] of [['2026-10-24', 15], ['2026-10-27', 12]] as const) {
      vi.resetModules();
      issued = [];
      today.mockResolvedValue(day);
      route = raceRoleRouter({
        build: BUILD,
        tuneUps: [{ slug: 'run-malibu-2026', meta: MALIBU_META }],
      });
      await runCron();
      const inserts = roleInserts();
      expect(inserts.length, day).toBe(1);
      expect(JSON.parse(String(inserts[0].params[2])).days_to_race).toBe(expected);
    }
  });
});
