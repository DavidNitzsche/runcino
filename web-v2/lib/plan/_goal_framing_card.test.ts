/**
 * lib/plan/_goal_framing_card.test.ts · the "time or effort?" framing CARD,
 * at the route level with the database mocked (same harness idiom as
 * _race_role_card.test.ts / _plan_drift_lifecycle.test.ts: mock the pool,
 * route SQL by shape, drive the cron's POST, assert on the calls that left).
 *
 * The ruling under test (David 2026-08-28): when the coach-goal engine hits
 * its one genuine judgment call — a ROLLING course (Research/02 §13.2's
 * Hilly tier, 19-57 ft/mi gross), where a hill-adjusted time target and an
 * effort-only framing are both defensible — the APP asks the runner. The
 * pending card is the WHOLE automatic action, and the graded default stands
 * while it goes unanswered. It fires EXACTLY ONCE per race:
 *
 *   · once the race is ≤28 days out (the ~4-week entry, or the next cron
 *     night for a race added closer), inside the active plan's window,
 *     deduped on any prior race_goal_framing row for that slug, any status;
 *   · never for a C race, a race with a stated goal, or a race already
 *     carrying an answered meta.goalFraming;
 *   · never for a flat or steep course, and never off untrusted elevation.
 *
 * The live shape: Santa Monica 10K (202 ft gain ≈ 32 ft/mi, B priority,
 * 2026-09-13, no stated goal) inside the CIM build → the ask, with the
 * graded default named in the copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — these must precede every import that resolves them.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
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
import { GOAL_FRAMING_FIRE_WINDOW_DAYS } from '@/lib/race/goal-framing';

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
  today.mockResolvedValue('2026-08-28');
  query.mockImplementation(async (sql: unknown, params?: unknown[]): Promise<Rows> => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = await route(text, params ?? []);
    return { rows: r.rows, rowCount: r.rows.length };
  });
});

const framingInserts = () =>
  issued.filter((s) => s.sql.includes('INSERT INTO plan_proposals') && s.sql.includes("'race_goal_framing'"));

/** Santa Monica meta as the races table would carry it: no stated goal, no
 *  answered framing (the SQL filters both; the meta simply lacks them). */
const SANTA_MONICA_META = {
  name: 'Santa Monica', date: '2026-09-13', distanceMi: 6.21371,
  priority: 'B', distanceLabel: '10k',
};

function framingRouter(opts: {
  /** null → no active plan / no plan window. */
  planWindow?: { plan_id: string; last_workout_iso: string | null } | null;
  /** Rows the candidate query returns (the SQL already filters). */
  candidates?: Array<{
    slug: string; meta: Record<string, unknown>;
    course_geometry?: unknown; geometry_json?: unknown;
    lib_gain_ft?: number | null; lib_net_ft?: number | null;
  }>;
  /** Per-slug: a prior race_goal_framing row exists (any status). */
  asked?: (slug: string) => boolean;
}): Router {
  return async (sql, params) => {
    if (sql.includes('UNION') && sql.includes('FROM training_plans')) {
      return { rows: [{ user_uuid: UUID }] };
    }
    if (sql.includes("tp.mode = 'maintenance'")) return { rows: [] };
    if (sql.includes("tp.mode = 'recovery'")) return { rows: [] };
    if (sql.includes("tp.mode = 'race-prep'")) return { rows: [] };
    // The framing plan-window read: the ONLY MAX(pw.date_iso) query with no
    // races join.
    if (sql.includes('MAX(pw.date_iso)') && !sql.includes('races rc')) {
      return { rows: opts.planWindow ? [opts.planWindow] : [] };
    }
    // The framing candidate query.
    if (sql.includes("meta->>'goalFraming' IS NULL")) {
      return {
        rows: (opts.candidates ?? []).map((c) => ({
          slug: c.slug, meta: c.meta,
          course_geometry: c.course_geometry ?? null,
          geometry_json: c.geometry_json ?? null,
          lib_gain_ft: c.lib_gain_ft ?? null,
          lib_net_ft: c.lib_net_ft ?? null,
        })),
      };
    }
    // The per-slug exactly-once dedupe guard.
    if (sql.includes("proposal_kind = 'race_goal_framing'") && sql.includes("reasons->>'race_slug'")) {
      const slug = String(params[1] ?? '');
      return { rows: opts.asked?.(slug) ? [{ '?column?': 1 }] : [] };
    }
    // race_role dedupe guard (different kind) · nothing pending.
    if (sql.includes("reasons->>'race_slug'")) return { rows: [] };
    // Lifecycle active-plan lookup: keep the plan alive and un-elapsed.
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

const WINDOW = { plan_id: 'plan-CIM', last_workout_iso: '2026-12-06' };

async function runCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/plan-drift/route');
  return await (await POST(REQ)).json();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · the Santa Monica shape · fires once, graded default named
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · the card fires for a rolling-band race, once, with the ask', () => {
  it('Santa Monica 16 days out, 202 ft curated gain → ONE pending race_goal_framing card', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'santa-monica-10k-2026-09-13', meta: SANTA_MONICA_META, lib_gain_ft: 202 }],
    });
    const body = await runCron();

    const inserts = framingInserts();
    expect(inserts.length).toBe(1);
    expect(inserts[0].sql).toContain("'pending'");
    expect(inserts[0].sql).toContain("'goal_framing_cron'");
    // plan_id NULL by design: the question is about the RACE, so a
    // mid-window rebuild sweeping plan-pointing pending proposals must not
    // kill the one card the per-slug dedupe will never re-fire.
    expect(inserts[0].params[1]).toBeNull();
    const reasons = JSON.parse(String(inserts[0].params[2]));
    expect(reasons).toMatchObject({
      race_slug: 'santa-monica-10k-2026-09-13',
      race_name: 'Santa Monica',
      race_date: '2026-09-13',
      gain_ft: 202,
      gain_provenance: 'editorial',
      days_to_race: 16,
      default_framing: 'time',
      card_title: 'Santa Monica 10k. Time or effort?',
      accept_verb: 'RACE THE NUMBER',
      keep_verb: 'KEEP IT ON EFFORT',
    });
    expect(reasons.gain_ft_per_mi).toBeCloseTo(32.5, 1);
    expect(String(reasons.message)).toContain('202 ft of climb');
    expect(String(reasons.message)).toContain('Leave this and the graded numbers stand');
    expect(body.errors).toBe(0);
  });

  it('fires EXACTLY ONCE · a prior race_goal_framing row for the slug (any status) blocks a re-fire', async () => {
    let asked = false;
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'santa-monica-10k-2026-09-13', meta: SANTA_MONICA_META, lib_gain_ft: 202 }],
      asked: () => asked,
    });
    await runCron();
    expect(framingInserts().length).toBe(1);
    asked = true;
    issued = [];
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('the dedupe guard fails CLOSED · an unreadable guard writes nothing', async () => {
    const base = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'santa-monica-10k-2026-09-13', meta: SANTA_MONICA_META, lib_gain_ft: 202 }],
    });
    route = async (sql, params) => {
      if (sql.includes("proposal_kind = 'race_goal_framing'") && sql.includes("reasons->>'race_slug'")) {
        throw new Error('connection terminated');
      }
      return base(sql, params);
    };
    const body = await runCron();
    expect(framingInserts().length).toBe(0);
    // A failed guard is a skip, not a crash: the pass keeps going.
    expect(body.errors).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · who never gets the ask
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2 · never fires', () => {
  it('a flat course · 80 ft over a 10K is under the 19 ft/mi floor', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'flat-10k', meta: { ...SANTA_MONICA_META, name: 'Flat 10K' }, lib_gain_ft: 80 }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('a steep course · 500 ft over a 10K is past the 57 ft/mi Mountain floor (effort already refused the number)', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'steep-10k', meta: { ...SANTA_MONICA_META, name: 'Steep 10K' }, lib_gain_ft: 500 }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('a C race · the loop refuses even if the row reaches it', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{
        slug: 'parkrun',
        meta: { ...SANTA_MONICA_META, name: 'Parkrun', priority: 'C' },
        lib_gain_ft: 202,
      }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('a stated goal · the loop refuses even if the row reaches it', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{
        slug: 'santa-monica-10k-2026-09-13',
        meta: { ...SANTA_MONICA_META, goal: '45:00' },
        lib_gain_ft: 202,
      }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('an answered framing · the loop refuses even if the row reaches it', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{
        slug: 'santa-monica-10k-2026-09-13',
        meta: { ...SANTA_MONICA_META, goalFraming: 'effort' },
        lib_gain_ft: 202,
      }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('no elevation data at all · nothing to price, no ask', async () => {
    route = framingRouter({
      planWindow: WINDOW,
      candidates: [{ slug: 'mystery-10k', meta: { ...SANTA_MONICA_META, name: 'Mystery 10K' } }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
  });

  it('the SQL filters C races, stated goals, and answered framings at the source', async () => {
    route = framingRouter({ planWindow: WINDOW, candidates: [] });
    await runCron();
    const windowQ = issued.find((s) => s.sql.includes("meta->>'goalFraming' IS NULL"));
    expect(windowQ).toBeDefined();
    expect(windowQ!.sql).toContain("COALESCE(r.meta->>'priority', 'A') <> 'C'");
    expect(windowQ!.sql).toContain("NULLIF(r.meta->>'goalDisplay', '')");
    expect(windowQ!.sql).toContain("NULLIF(r.meta->>'goal', '')");
  });

  it('no active plan window → the candidate query is never even issued', async () => {
    route = framingRouter({
      planWindow: null,
      candidates: [{ slug: 'santa-monica-10k-2026-09-13', meta: SANTA_MONICA_META, lib_gain_ft: 202 }],
    });
    await runCron();
    expect(framingInserts().length).toBe(0);
    expect(issued.find((s) => s.sql.includes("meta->>'goalFraming' IS NULL"))).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the window · ≤28 days, parameterized into the SQL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · the fire window', () => {
  it('the 28-day bound and the plan window ride into the query as parameters', async () => {
    route = framingRouter({ planWindow: WINDOW, candidates: [] });
    await runCron();
    const windowQ = issued.find((s) => s.sql.includes("meta->>'goalFraming' IS NULL"))!;
    expect(GOAL_FRAMING_FIRE_WINDOW_DAYS).toBe(28);
    expect(windowQ.params).toContain(GOAL_FRAMING_FIRE_WINDOW_DAYS);
    expect(windowQ.params).toContain('2026-12-06'); // the plan's last prescribed day
    expect(windowQ.sql).toContain("(r.meta->>'date')::date - $2::date <= $4");
  });
});
