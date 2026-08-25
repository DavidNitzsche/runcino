/**
 * lib/plan/_guard_fail_closed.test.ts · a guard that cannot see must assume
 * the thing it guards against has already happened.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE BUG CLASS
 *
 * A dedupe or authorisation guard reads the database to answer one question:
 * "has this already been done / is this allowed?" Wrap that read in
 * `.catch(() => ({ rows: [] }))` and a transient failure answers "no, nothing
 * on record" — which the caller reads as "not done yet, go ahead". The failure
 * becomes a LICENCE. It fires the action again, and again on the next tick,
 * because nothing downstream is unique.
 *
 * Every guard below now answers the safe way when it cannot see. This file is
 * what stops that being quietly undone: each site gets its read REJECTED and
 * must still produce skip / hold / no-fire, and each site also gets a
 * success-path case so a guard cannot pass by simply refusing everything.
 *
 * Sibling reading · lib/db/read.ts (why a failure is not an answer),
 * lib/audit/_swallow_scan.test.ts (the tree-wide ratchet on this shape).
 * ───────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted — these must precede every import that resolves them.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

vi.mock('@/lib/runtime/runner-tz', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runnerToday: vi.fn().mockResolvedValue('2026-08-25'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

vi.mock('@/lib/notifications/prefs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadNotificationPrefs: vi.fn(),
}));

vi.mock('@/lib/runs/merge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  autoMergeRecent: vi.fn().mockResolvedValue({ totalChanged: 0 }),
}));

vi.mock('@/lib/runs/flag-census', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  computeFlagCensus: vi.fn(),
}));

vi.mock('@/lib/ops/alerts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  raiseAlert: vi.fn().mockResolvedValue(undefined),
}));

import { pool } from '@/lib/db/pool';
import { rowsOrNull } from '@/lib/db/read';
import { loadNotificationPrefs, DEFAULT_PREFS } from '@/lib/notifications/prefs';
import { computeFlagCensus } from '@/lib/runs/flag-census';
import { raiseAlert } from '@/lib/ops/alerts';

/* ══════════════════════════════════════════════════════════════════════════
 * HARNESS
 * ═══════════════════════════════════════════════════════════════════════ */

const UUID = '00000000-0000-0000-0000-000000000042';

/** Every guard this file exercises. The floor at the bottom counts them. */
const EXERCISED_GUARDS = new Set<string>();
function exercised(id: string): void { EXERCISED_GUARDS.add(id); }

/** A rejection that looks like the real thing · SQLSTATE and all. */
function dbFailure(): Error {
  return Object.assign(new Error('operator does not exist: text >= timestamp with time zone'), {
    code: '42883',
  });
}

type Rows = { rows: Record<string, unknown>[] };
type Router = (sql: string, params: unknown[]) => Promise<Rows>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
let route: Router = async () => ({ rows: [] });
/** Every statement the code under test issued, in order. */
let issued: string[] = [];

function setRouter(r: Router): void { route = r; }

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
  route = async () => ({ rows: [] });
  query.mockImplementation((sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push(text);
    return route(text, params ?? []);
  });
});

const sawStatement = (needle: string): number =>
  issued.filter((s) => s.includes(needle)).length;

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 1a · app/api/cron/notifications/route.ts · enqueueIfFresh
 *
 * The SELECT is the only duplicate protection there is:
 * notifications_pending_dedup_idx is a plain btree and the INSERT has no
 * ON CONFLICT. Fail open here and a runner gets the same push once per tick
 * across an hours-wide catchment window.
 * ═══════════════════════════════════════════════════════════════════════ */

const NOTIF_REQ = {
  headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** Only category A (race day) is armed, so exactly one guard is under test. */
function armRaceDayOnly(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (loadNotificationPrefs as any).mockResolvedValue({
    ...DEFAULT_PREFS,
    master_enabled: true,
    race_day_enabled: true,
    // Late enough that today's wake instant is still in the future, so the
    // staleness skip cannot make this test's coverage depend on the clock.
    race_day_wake_time: '23:59',
    race_eve_enabled: false,
    weekly_checkin_enabled: false,
    niggle_sick_enabled: false,
    race_countdown_enabled: false,
    run_unread_enabled: false,
  });
}

function notificationsRouter(dedupe: 'reject' | 'empty'): Router {
  return async (sql) => {
    if (sql.includes('INSERT INTO notifications_pending')) return { rows: [] };
    if (sql.includes('dedup_key = $1')) {
      if (dedupe === 'reject') throw dbFailure();
      return { rows: [] };
    }
    if (sql.includes('FROM notifications_pending')) return { rows: [] };  // drain
    if (sql.includes('FROM device_tokens')) {
      return { rows: [{ user_id: UUID, tz: 'America/Los_Angeles' }] };
    }
    if (sql.includes('FROM races')) {
      return { rows: [{ slug: 'test-race', meta: { name: 'Test Race' } }] };
    }
    return { rows: [] };
  };
}

describe('1a · notifications enqueue dedupe', () => {
  it('a rejected dedupe read enqueues NOTHING', async () => {
    process.env.CRON_SECRET = 'test-secret';
    armRaceDayOnly();
    setRouter(notificationsRouter('reject'));

    const { POST } = await import('@/app/api/cron/notifications/route');
    const body = await (await POST(NOTIF_REQ)).json();

    // The guard was actually reached, and it refused.
    expect(sawStatement('dedup_key = $1')).toBeGreaterThan(0);
    expect(sawStatement('INSERT INTO notifications_pending')).toBe(0);
    expect(body.enqueued_b).toBe(0);
    // Refusing by crashing the scheduler would also enqueue nothing. It has
    // to refuse by DECIDING, so the rest of the tick still runs.
    expect(body.errors).toEqual([]);
    exercised('cron/notifications/route.ts::enqueueIfFresh');
  });

  it('success path unchanged · an honestly-empty dedupe still enqueues', async () => {
    process.env.CRON_SECRET = 'test-secret';
    armRaceDayOnly();
    setRouter(notificationsRouter('empty'));

    const { POST } = await import('@/app/api/cron/notifications/route');
    const body = await (await POST(NOTIF_REQ)).json();

    expect(sawStatement('INSERT INTO notifications_pending')).toBeGreaterThan(0);
    expect(body.enqueued_b).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 1b · lib/plan/workout-proposals.ts · pending-proposal dedupe
 *
 * Fail open and the runner opens Today to the same decision card two and
 * three times, with no unique key on plan_workout_id to catch it.
 * ═══════════════════════════════════════════════════════════════════════ */

const PROPOSAL_ACTIONS = [{
  kind: 'shave',
  workoutIds: ['w-1'],
  shaveFraction: 0.2,
  why: 'Readiness pull-back.',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}] as any;
const PROPOSAL_TRIGGERS = [{
  kind: 'readiness_pullback',
  reason: 'HRV below baseline two days running.',
  evidence: {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}] as any;

function proposalRouter(dedupe: 'reject' | 'empty'): Router {
  return async (sql) => {
    if (sql.includes('INSERT INTO plan_workout_proposals')) return { rows: [] };
    if (sql.includes('FROM plan_workout_proposals')) {
      if (dedupe === 'reject') throw dbFailure();
      return { rows: [] };
    }
    if (sql.includes('FROM plan_workouts')) return { rows: [{ date_iso: '2026-12-31' }] };
    return { rows: [] };
  };
}

describe('1b · workout-proposal dedupe', () => {
  it('a rejected dedupe read writes NO proposal', async () => {
    setRouter(proposalRouter('reject'));
    const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');

    const count = await writeWorkoutProposals(UUID, PROPOSAL_ACTIONS, PROPOSAL_TRIGGERS);

    expect(sawStatement('FROM plan_workout_proposals')).toBeGreaterThan(0);
    expect(sawStatement('INSERT INTO plan_workout_proposals')).toBe(0);
    expect(count).toBe(0);
    exercised('plan/workout-proposals.ts::writeWorkoutProposals');
  });

  it('success path unchanged · no pending row still writes the proposal', async () => {
    setRouter(proposalRouter('empty'));
    const { writeWorkoutProposals } = await import('@/lib/plan/workout-proposals');

    const count = await writeWorkoutProposals(UUID, PROPOSAL_ACTIONS, PROPOSAL_TRIGGERS);

    expect(sawStatement('INSERT INTO plan_workout_proposals')).toBe(1);
    expect(count).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 1c · lib/coach/coach-log.ts · entryExists
 *
 * coach_intents has no unique index on (user, reason, field). This SELECT is
 * the whole idempotency of the coach log, and the daily pass re-asks every
 * morning · fail open once and the duplicate line is permanent.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1c · coach-log idempotency', () => {
  it('a rejected read answers "already logged"', async () => {
    setRouter(async (sql) => {
      if (sql.includes('FROM coach_intents')) throw dbFailure();
      return { rows: [] };
    });
    const { entryExists } = await import('@/lib/coach/coach-log');

    await expect(entryExists(UUID, 'coach_log_first', 'longest_run:2026-08-25')).resolves.toBe(true);
    exercised('coach/coach-log.ts::entryExists');
  });

  it('success path unchanged · honestly-absent reads false, present reads true', async () => {
    const { entryExists } = await import('@/lib/coach/coach-log');

    setRouter(async () => ({ rows: [] }));
    await expect(entryExists(UUID, 'coach_log_first', 'k')).resolves.toBe(false);

    setRouter(async () => ({ rows: [{ '?column?': 1 }] }));
    await expect(entryExists(UUID, 'coach_log_first', 'k')).resolves.toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 1d · app/api/cron/dedupe-runs/route.ts · flag-census baseline
 *
 * The subtle one. A failed read of the PREVIOUS census used to fall through
 * to the else-branch, which STORES TONIGHT'S COUNT AS THE NEW BASELINE. So a
 * blip on the night a load-bearing flag was wiped did not merely miss one
 * alarm · it recorded the lowered count as normal and made the drop
 * undetectable on every later night.
 * ═══════════════════════════════════════════════════════════════════════ */

const CENSUS = {
  userUuid: UUID,
  flaggedTotal: 9,
  loadBearing: 3,
  loadBearingMi: 20.5,
  loadBearingIds: ['a', 'b', 'c'],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const alertCalls = (): any[] => (raiseAlert as any).mock.calls.map((c: unknown[]) => c[0]);

const DEDUPE_REQ = {
  headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('1d · dedupe-runs flag-census baseline', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (computeFlagCensus as any).mockResolvedValue(CENSUS);
  });

  it('a rejected baseline read neither compares nor overwrites the baseline', async () => {
    setRouter(async (sql) => {
      if (sql.includes('FROM ops_alerts')) throw dbFailure();
      if (sql.includes('FROM runs')) return { rows: [{ user_uuid: UUID }] };
      return { rows: [] };
    });
    const { POST } = await import('@/app/api/cron/dedupe-runs/route');
    await POST(DEDUPE_REQ);

    const alerts = alertCalls();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metadata.censusReadFailed).toBe(true);
    // The read that finds the baseline keys on metadata->>'userUuid'. An alert
    // carrying that key IS a baseline write, whatever its severity says — so
    // no alert raised on a failed read may carry one.
    for (const a of alerts) {
      expect(a.metadata?.userUuid, 'a failed read must not mint a new baseline row').toBeUndefined();
      expect(a.metadata?.loadBearingIds).toBeUndefined();
    }
    exercised('cron/dedupe-runs/route.ts::flagCensusBaseline');
  });

  it('success path unchanged · a real DROP against a readable baseline still alerts', async () => {
    setRouter(async (sql) => {
      if (sql.includes('FROM ops_alerts')) {
        return { rows: [{ metadata: { userUuid: UUID, loadBearing: 5, loadBearingIds: ['a', 'b', 'c', 'd', 'e'] } }] };
      }
      if (sql.includes('FROM runs')) return { rows: [{ user_uuid: UUID }] };
      return { rows: [] };
    });
    const { POST } = await import('@/app/api/cron/dedupe-runs/route');
    await POST(DEDUPE_REQ);

    const alerts = alertCalls();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('error');
    expect(alerts[0].metadata.previous).toBe(5);
    expect(alerts[0].metadata.lostIds).toEqual(['d', 'e']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 2 · lib/plan/adaptive-ramp.ts · three reads that AUTHORISE MORE LOAD
 *
 * readinessGreen, lastLongClean and belowTierUpper are three of the five
 * gates that let the engine push the runner's long run and weekly total UP.
 * Each used to turn a database error into permission. The lastBump cooldown
 * in the same file has failed closed since 2026-08-24; these now agree with
 * their neighbour.
 * ═══════════════════════════════════════════════════════════════════════ */

const ACTIVE_PLAN = {
  id: 'plan-1',
  authoredState: {
    tier_peak_weekly_band: [30, 50],
    tier_peak_long_band: [12, 20],
  } as Record<string, unknown>,
};

type RampFailure = 'readiness' | 'long' | 'peak' | null;

function rampRouter(failing: RampFailure): Router {
  return async (sql) => {
    if (sql.includes('readiness_snapshots')) {
      if (failing === 'readiness') throw dbFailure();
      return { rows: [{ streaks: [] }] };
    }
    // Order matters · both quality and long read FROM runs.
    if (sql.includes("(data->>'type') = 'long'")) {
      if (failing === 'long') throw dbFailure();
      return { rows: [{ decoupling: 2.0 }] };
    }
    if (sql.includes("IN ('threshold'")) {
      return { rows: [{ pace_delta_bpm: 2 }, { pace_delta_bpm: 3 }] };
    }
    if (sql.includes('plan_workouts')) {
      if (failing === 'peak') throw dbFailure();
      return { rows: [{ peak_weekly: 30, peak_long: 12 }] };
    }
    if (sql.includes('coach_intents')) return { rows: [] };
    return { rows: [] };
  };
}

describe('2 · adaptive ramp · a DB error is not permission to add mileage', () => {
  it('success path unchanged · all five gates green when every read answers', async () => {
    setRouter(rampRouter(null));
    const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
    const s = await detectRampSignals(UUID, ACTIVE_PLAN);

    expect(s.readinessGreen).toBe(true);
    expect(s.lastLongClean).toBe(true);
    expect(s.belowTierUpper).toBe(true);
    expect(s.noBumpRecent).toBe(true);
  });

  it('readiness read rejects → readinessGreen is FALSE, not "no streaks"', async () => {
    setRouter(rampRouter('readiness'));
    const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
    const s = await detectRampSignals(UUID, ACTIVE_PLAN);

    expect(s.readinessGreen).toBe(false);
    exercised('plan/adaptive-ramp.ts::readinessGreen');
  });

  it('long-run read rejects → lastLongClean is FALSE, no benefit of the doubt', async () => {
    setRouter(rampRouter('long'));
    const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
    const s = await detectRampSignals(UUID, ACTIVE_PLAN);

    expect(s.lastLongClean).toBe(false);
    exercised('plan/adaptive-ramp.ts::lastLongClean');
  });

  it('peak read rejects → belowTierUpper is FALSE, not full headroom', async () => {
    setRouter(rampRouter('peak'));
    const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
    const s = await detectRampSignals(UUID, ACTIVE_PLAN);

    expect(s.belowTierUpper).toBe(false);
    exercised('plan/adaptive-ramp.ts::belowTierUpper');
  });

  it('no single failed read can leave all five gates green', async () => {
    const { detectRampSignals } = await import('@/lib/plan/adaptive-ramp');
    for (const failing of ['readiness', 'long', 'peak'] as RampFailure[]) {
      setRouter(rampRouter(failing));
      const s = await detectRampSignals(UUID, ACTIVE_PLAN);
      const allGreen = s.readinessGreen && s.lastQualityOnPace && s.lastLongClean
        && s.belowTierUpper && s.noBumpRecent;
      expect(allGreen, `a rejected ${failing} read still authorised a bump`).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ORACLE, AND A DEFECT PLANTED FOR IT TO CATCH
 *
 * Every site above is judged by one question: with the read REJECTED, does
 * the guard answer "safe"? If this file's oracle could not tell the fixed
 * shape from the broken one, the six passing tests above would prove nothing.
 * So here is the shape those sites used to have, reproduced inline, and the
 * assertion that the oracle FAILS it.
 * ═══════════════════════════════════════════════════════════════════════ */

/** true = skip / hold / already-done · the only safe answer under failure. */
type GuardVerdict = 'SAFE' | 'FIRES';

async function oracle(guard: () => Promise<boolean>): Promise<GuardVerdict> {
  return (await guard()) ? 'SAFE' : 'FIRES';
}

describe('the oracle can tell the difference', () => {
  /** The exact shape the sweep removed: swallow the error, report nothing found. */
  async function failOpen(): Promise<boolean> {
    const r = await Promise.reject(dbFailure())
      .catch(() => ({ rows: [] as unknown[] })) as { rows: unknown[] };
    return r.rows.length > 0;
  }

  /** The shape the sweep installed: null is a failure, and a failure holds. */
  async function failClosed(): Promise<boolean> {
    const rows = await rowsOrNull(
      'planted-defect fixture',
      Promise.reject(dbFailure()) as Promise<{ rows: Record<string, unknown>[] }>,
    );
    return rows === null ? true : rows.length > 0;
  }

  it('FAILS the planted fail-open guard', async () => {
    await expect(oracle(failOpen)).resolves.toBe('FIRES');
  });

  it('PASSES the fail-closed guard', async () => {
    await expect(oracle(failClosed)).resolves.toBe('SAFE');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE FLOOR
 *
 * A test that silently stops covering a site is the same bug one level up:
 * absence reported as an answer. So the count is asserted, not assumed.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('floor · every site is still covered', () => {
  it('exercised seven guards across five files', () => {
    // The sweep numbered its work 1a, 1b, 1c, 1d and 2 — five line items —
    // but item 2 is THREE separate reads in adaptive-ramp.ts, so the honest
    // count of guards under test is seven. If you remove a site, delete its
    // entry here in the same commit and say why; do not lower the number to
    // make the suite green.
    expect(
      [...EXERCISED_GUARDS].sort().join('\n'),
      'a site stopped exercising its guard',
    ).toBe([
      'coach/coach-log.ts::entryExists',
      'cron/dedupe-runs/route.ts::flagCensusBaseline',
      'cron/notifications/route.ts::enqueueIfFresh',
      'plan/adaptive-ramp.ts::belowTierUpper',
      'plan/adaptive-ramp.ts::lastLongClean',
      'plan/adaptive-ramp.ts::readinessGreen',
      'plan/workout-proposals.ts::writeWorkoutProposals',
    ].join('\n'));
    expect(EXERCISED_GUARDS.size).toBe(7);
    expect(new Set([...EXERCISED_GUARDS].map((g) => g.split('::')[0])).size).toBe(5);
  });
});
