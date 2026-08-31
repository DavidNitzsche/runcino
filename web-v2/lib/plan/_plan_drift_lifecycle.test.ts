/**
 * lib/plan/_plan_drift_lifecycle.test.ts · the plan-lifecycle dead-ends,
 * closed 2026-08-28, and the guards that keep them closed.
 *
 * Four rulings under test, at the route level with the database mocked:
 *
 *   1 · RECOVERY → BUILD AUTO-APPLIES. The recovery-complete transition is
 *       doctrine-driven and non-optional (David 2026-08-28) — it fires
 *       `fireAutoRebuild` with an undo path and a morning coach note, instead
 *       of raising a card. The evidence: 0 of 40 engine-raised cards ever
 *       answered, 39 expired (quoted in app/api/plan/undo/route.ts). It fires
 *       EXACTLY ONCE per transition (24h + standing-pending dedupe), and a
 *       runner who undid this block gets a card, not a re-imposition.
 *
 *   2 · A RACE-ANCHORED ELAPSED PLAN RE-AUTHORS. The plan_elapsed branch was
 *       gated on `!race_id`, so a maintenance hold block that ran out of days
 *       with its race still ahead was re-authored by NOTHING (the doctrine
 *       registry's `no-ceiling-on-a-long-hold` exemption argued from exactly
 *       this strand — closed 2026-08-28, when the hold block was capped at
 *       HOLD_BLOCK_MAX_WEEKS on the strength of this branch). Race still
 *       ahead → rebuild toward it, whether the build window has opened
 *       (race-prep next) or not (the next capped hold); race date null or
 *       past → the un-anchored goal-target handoff.
 *
 *   3 · NO AUTO-AUTHORED BUILD OVER AN INJURED RUNNER. Injury-return plans are
 *       mode='maintenance', race_id=NULL (injury-builder), so when one elapsed
 *       the old branch auto-authored a goal build over an injured runner. A
 *       compromised runner — or a plan stamped mode_label='injury-return' —
 *       gets a pending card instead.
 *
 *   4 · GOAL-GAP NEVER SURFACES ITS REBUILD CARD OVER A COMPROMISED RUNNER
 *       (2026-08-31). The widening-projection guard used to default a failed
 *       compromised-check read to `compromised: false`, so a database blip
 *       could surface "rebuild to close the gap?" built on the exact
 *       evidence — illness/injury — the guard's own comment says
 *       contaminates that projection. Now routed through the shared
 *       `runnerIsCompromisedFailClosed` wrapper (also sites 2 and 3 above),
 *       so a genuine compromised read and an unreadable one suppress the
 *       card identically.
 *
 * Same harness idiom as _guard_fail_closed.test.ts: mock the pool, route SQL
 * by shape, drive the route's POST, and assert on the calls that left.
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

// The generator is a 10k-line module; the route only pulls distanceMiOf.
vi.mock('@/lib/plan/generate', () => ({
  distanceMiOf: vi.fn().mockReturnValue(26.2),
}));

vi.mock('@/lib/plan/auto-rebuild', () => ({
  fireAutoRebuild: vi.fn(),
  resolveGoalTarget: vi.fn(),
}));

vi.mock('@/lib/plan/adapt', () => ({
  runnerIsCompromisedFailClosed: vi.fn(),
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
import { fireAutoRebuild, resolveGoalTarget } from '@/lib/plan/auto-rebuild';
import { runnerIsCompromisedFailClosed } from '@/lib/plan/adapt';
import { notifyBlockStarted } from '@/lib/notifications/block-started';
import { computeGoalGap } from '@/lib/plan/goal-gap';

/* ══════════════════════════════════════════════════════════════════════════
 * HARNESS
 * ═══════════════════════════════════════════════════════════════════════ */

const UUID = '00000000-0000-0000-0000-000000000042';
const TODAY = '2026-08-28';

const REQ = {
  headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

type Rows = { rows: Record<string, unknown>[]; rowCount: number };
type Router = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fire = fireAutoRebuild as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goalTarget = resolveGoalTarget as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const compromised = runnerIsCompromisedFailClosed as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const blockNote = notifyBlockStarted as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goalGap = computeGoalGap as any;

let route: Router = async () => ({ rows: [] });
let issued: Array<{ sql: string; params: unknown[] }> = [];

function setRouter(r: Router): void { route = r; }

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  issued = [];
  route = async () => ({ rows: [] });
  query.mockImplementation(async (sql: unknown, params?: unknown[]): Promise<Rows> => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    const r = await route(text, params ?? []);
    // The route's dedupe guards read `.rowCount`, not `.rows`.
    return { rows: r.rows, rowCount: r.rows.length };
  });
  compromised.mockResolvedValue({ compromised: false });
  goalTarget.mockResolvedValue(null);
  fire.mockResolvedValue({ ok: true, newPlanId: 'plan-NEW', proposalId: 7 });
  goalGap.mockResolvedValue(null);
});

const sawInsert = (needle: string): number =>
  issued.filter((s) => s.sql.includes('INSERT INTO plan_proposals') && s.sql.includes(needle)).length;

/** One active plan row, in the shape the cron's two lifecycle lookups read. */
type PlanRow = {
  plan_id: string; race_id: string | null; race_date: string | null;
  goal_mode: string | null; mode: string | null; authored_mode: string | null;
  mode_label: string | null; last_workout_iso: string | null;
};

function lifecycleRouter(opts: {
  plan: PlanRow | null;
  /** Standing recovery_complete rows for the dedupe guard. */
  recoveryDeduped?: () => boolean;
}): Router {
  return async (sql) => {
    // Population: one runner.
    if (sql.includes('UNION') && sql.includes('FROM training_plans')) {
      return { rows: [{ user_uuid: UUID }] };
    }
    // Maintenance→race-prep transition lookup: none under test here.
    if (sql.includes("tp.mode = 'maintenance'")) return { rows: [] };
    // Recovery-complete lookup (queried fresh, recovery-mode only).
    if (sql.includes("tp.mode = 'recovery'")) {
      const p = opts.plan;
      const isRecovery = p != null && (p.mode === 'recovery' || p.authored_mode === 'recovery');
      return { rows: isRecovery && p ? [p] : [] };
    }
    // Active-plan lookup (the one that computes last_workout_iso).
    if (sql.includes('MAX(pw.date_iso)')) {
      return { rows: opts.plan ? [opts.plan] : [] };
    }
    // Dedupe guards.
    if (sql.includes("proposal_kind = 'recovery_complete'")) {
      return { rows: opts.recoveryDeduped?.() ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes("proposal_kind = 'plan_elapsed'")) return { rows: [] };
    if (sql.includes("proposal_kind = 'race_graduate'")) return { rows: [] };
    // Graduate next-A-race lookup / open-block race lookups.
    if (sql.includes('FROM races')) return { rows: [] };
    // Open-block "still active" probe: whatever plan we injected is active.
    if (sql.includes('archived_iso IS NULL LIMIT 1')) {
      return { rows: opts.plan ? [{ id: opts.plan.plan_id }] : [] };
    }
    return { rows: [] };
  };
}

async function runCron(): Promise<Record<string, unknown>> {
  const { POST } = await import('@/app/api/cron/plan-drift/route');
  return await (await POST(REQ)).json();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · recovery_complete auto-applies, once, with the coach note
 * ═══════════════════════════════════════════════════════════════════════ */

const RECOVERY_PLAN: PlanRow = {
  plan_id: 'plan-REC', race_id: 'cim-2026', race_date: '2026-12-06',
  goal_mode: null, mode: 'recovery', authored_mode: 'recovery',
  mode_label: null, last_workout_iso: '2026-08-27',
};

describe('1 · recovery → next block', () => {
  it('auto-fires the rebuild toward the race, and enqueues the coach note', async () => {
    setRouter(lifecycleRouter({ plan: RECOVERY_PLAN }));
    const body = await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, raceSlug: 'cim-2026', kind: 'recovery_complete',
      source: 'recovery_complete_cron',
    });
    // The pending-card shape is the FALLBACK, not the outcome here.
    expect(sawInsert("'recovery_complete'")).toBe(0);
    expect(blockNote).toHaveBeenCalledTimes(1);
    expect(blockNote.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, raceSlug: 'cim-2026', newPlanId: 'plan-NEW',
    });
    expect(body.errors).toBe(0);
  });

  it('fires EXACTLY ONCE · a standing proposal row inside the dedupe window blocks a re-fire', async () => {
    // Tick 1: nothing on record. Tick 2: the row tick 1 wrote is visible.
    let fired = false;
    setRouter(lifecycleRouter({ plan: RECOVERY_PLAN, recoveryDeduped: () => fired }));
    await runCron();
    fired = true;
    await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(blockNote).toHaveBeenCalledTimes(1);
  });

  it("a runner who UNDID this block gets a pending card, not a re-imposition", async () => {
    fire.mockResolvedValue({
      ok: true, unchanged: true, refusedReason: 'undone_by_runner', proposalId: 9,
    });
    setRouter(lifecycleRouter({ plan: RECOVERY_PLAN }));
    await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(sawInsert("'recovery_complete'")).toBe(1);
    const insert = issued.find((s) => s.sql.includes("'recovery_complete'") && s.sql.includes('INSERT'));
    expect(String(insert?.params[2])).toContain('undone_by_runner');
    // No block landed, so no "your build starts today" note may fire.
    expect(blockNote).not.toHaveBeenCalled();
  });

  it('a compromised runner is never auto-built over · card instead', async () => {
    compromised.mockResolvedValue({ compromised: true, reason: 'injury' });
    setRouter(lifecycleRouter({ plan: RECOVERY_PLAN }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
    expect(sawInsert("'recovery_complete'")).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · a race-anchored elapsed plan re-authors
 * ═══════════════════════════════════════════════════════════════════════ */

const HOLD_PLAN: PlanRow = {
  plan_id: 'plan-HOLD', race_id: 'cim-2026', race_date: '2026-12-06',
  goal_mode: null, mode: 'maintenance', authored_mode: null,
  mode_label: null, last_workout_iso: '2026-08-20',
};

describe('2 · plan_elapsed · race-anchored', () => {
  it('an elapsed hold block with its race still ahead rebuilds TOWARD that race', async () => {
    setRouter(lifecycleRouter({ plan: HOLD_PLAN }));
    await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, raceSlug: 'cim-2026', kind: 'plan_elapsed', source: 'plan_elapsed_cron',
    });
    expect(fire.mock.calls[0][0].goalTarget).toBeUndefined();
  });

  it('a CAPPED hold that elapses with its race still outside the build window is authored its next block', async () => {
    // MAINT-LENGTH-1 (2026-08-28) · the chain the 16-week cap stands on. A
    // runner ~30 weeks out gets a 16-week hold (HOLD_BLOCK_MAX_WEEKS); the
    // race is STILL outside its build window when that hold runs out of days,
    // and this branch must re-author toward the race anyway — pickPlanMode
    // inside the rebuild makes the next block another hold. If this handoff
    // ever re-grew a race-proximity condition, the cap would strand exactly
    // the runner it was sized for.
    setRouter(lifecycleRouter({ plan: { ...HOLD_PLAN, race_id: 'cim-2027', race_date: '2027-06-06' } }));
    await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0]).toMatchObject({
      userUuid: UUID, raceSlug: 'cim-2027', kind: 'plan_elapsed', source: 'plan_elapsed_cron',
    });
    expect(fire.mock.calls[0][0].goalTarget).toBeUndefined();
  });

  it('race date NULL is a dead anchor · falls through to the goal-target handoff', async () => {
    goalTarget.mockResolvedValue({ distanceMi: 26.2, goalSec: 10800, raceDateISO: '2026-12-20' });
    setRouter(lifecycleRouter({ plan: { ...HOLD_PLAN, race_date: null } }));
    await runCron();

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire.mock.calls[0][0]).toMatchObject({ kind: 'plan_elapsed' });
    expect(fire.mock.calls[0][0].raceSlug).toBeUndefined();
    expect(fire.mock.calls[0][0].goalTarget).toMatchObject({ distanceMi: 26.2 });
  });

  it('a plan with days left is left alone', async () => {
    setRouter(lifecycleRouter({ plan: { ...HOLD_PLAN, last_workout_iso: '2026-09-15' } }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
    expect(sawInsert("'plan_elapsed'")).toBe(0);
  });

  it('race day itself is nobody\'s rebuild · the runner is racing', async () => {
    setRouter(lifecycleRouter({ plan: { ...HOLD_PLAN, race_date: TODAY } }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the injury guard on auto-authoring
 * ═══════════════════════════════════════════════════════════════════════ */

const INJURY_RETURN_PLAN: PlanRow = {
  plan_id: 'plan-INJ', race_id: null, race_date: null,
  goal_mode: null, mode: 'maintenance', authored_mode: null,
  mode_label: 'injury-return', last_workout_iso: '2026-08-20',
};

describe('3 · plan_elapsed · injury guard', () => {
  it('an elapsed injury-return plan does NOT auto-author · pending card instead', async () => {
    // Belt and braces: the injury row may already be cleared, so the
    // compromised predicate alone would wave this through. The plan's own
    // mode_label must be enough.
    compromised.mockResolvedValue({ compromised: false });
    goalTarget.mockResolvedValue({ distanceMi: 26.2, goalSec: null, raceDateISO: '2026-12-20' });
    setRouter(lifecycleRouter({ plan: INJURY_RETURN_PLAN }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
    expect(sawInsert("'plan_elapsed'")).toBe(1);
    const insert = issued.find((s) => s.sql.includes("'plan_elapsed'") && s.sql.includes('INSERT'));
    expect(insert?.sql).toContain("'pending'");
    expect(String(insert?.params[2])).toContain('injury_return_plan');
  });

  it('a compromised runner on ANY elapsed plan proposes rather than prescribes', async () => {
    compromised.mockResolvedValue({ compromised: true, reason: 'niggle' });
    setRouter(lifecycleRouter({ plan: HOLD_PLAN }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
    expect(sawInsert("'plan_elapsed'")).toBe(1);
  });

  it('the guard fails CLOSED · an unreadable state proposes, never authors', async () => {
    compromised.mockRejectedValue(new Error('connection terminated'));
    setRouter(lifecycleRouter({ plan: HOLD_PLAN }));
    await runCron();

    expect(fire).not.toHaveBeenCalled();
    expect(sawInsert("'plan_elapsed'")).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · goal-gap rebuild suppression · site 4 of runnerIsCompromisedFailClosed
 *
 * 2026-08-31 · closed a real direction bug: this site defaulted a failed
 * compromised-check read to `compromised: false` and no comment explaining
 * why, so a database blip while illness/injury/gap-reentry status was
 * unreadable let the cron surface a "rebuild to close the gap?" card built on
 * the exact evidence the comment above the guard says illness/injury
 * contaminates (the widening projection itself). Both a genuine compromised
 * read AND an unreadable one must suppress the card the same way — neither
 * is allowed to fire it.
 * ═══════════════════════════════════════════════════════════════════════ */

// mode:'maintenance' + a future last_workout_iso keeps the plan_elapsed and
// recovery-complete lifecycle sections silent, so only the goal-gap branch
// under test can call the compromised guard or write a proposal.
const GOAL_GAP_PLAN: PlanRow = {
  plan_id: 'plan-GG', race_id: 'cim-2026', race_date: '2026-12-06',
  goal_mode: null, mode: 'maintenance', authored_mode: null,
  mode_label: null, last_workout_iso: '2026-09-15',
};

const WIDENING_GOAL_GAP = {
  status: 'widening', consecutiveWideningDays: 3,
  raceDateISO: '2026-12-06', raceSlug: 'cim-2026',
  trajectorySec: 11500, goalSec: 10800, gapSec: 700,
  weeksRemaining: 12, whatClosesIt: null, citation: null,
};

describe('4 · goal-gap · compromised runner suppresses the rebuild card', () => {
  it('a compromised runner never sees the "rebuild to close the gap?" card', async () => {
    compromised.mockResolvedValue({ compromised: true, reason: 'illness' });
    goalGap.mockResolvedValue(WIDENING_GOAL_GAP);
    setRouter(lifecycleRouter({ plan: GOAL_GAP_PLAN }));
    const body = await runCron();

    expect(sawInsert("'goal_gap_widening'")).toBe(0);
    expect(fire).not.toHaveBeenCalled();
    expect(body.errors).toBe(0);
    // Rule 16 (2026-08-25) · the suppression must still be legible in the
    // cron's own report, not just silently skip the runner.
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].goal_gap_suppressed_compromised).toBe(1);
  });

  it('the guard fails CLOSED · an unreadable state suppresses too, never surfaces the card', async () => {
    compromised.mockRejectedValue(new Error('connection terminated'));
    goalGap.mockResolvedValue(WIDENING_GOAL_GAP);
    setRouter(lifecycleRouter({ plan: GOAL_GAP_PLAN }));
    const body = await runCron();

    expect(sawInsert("'goal_gap_widening'")).toBe(0);
    expect(fire).not.toHaveBeenCalled();
    expect(body.errors).toBe(0);
    const results = body.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0].goal_gap_suppressed_compromised).toBe(1);
  });

  it('success path unchanged · a genuinely uncompromised runner still gets the card', async () => {
    compromised.mockResolvedValue({ compromised: false });
    goalGap.mockResolvedValue(WIDENING_GOAL_GAP);
    setRouter(lifecycleRouter({ plan: GOAL_GAP_PLAN }));
    await runCron();

    expect(sawInsert("'goal_gap_widening'")).toBe(1);
  });
});
