/**
 * lib/plan/_archived_plan_race_guard.db.test.ts · ARCHIVEDGUARD-2 (2026-09-12)
 * · closes the review gap left open by ARCHIVEDGUARD-1 (`8ff90216f`).
 *
 * ── THE GAP THIS FALSIFIES ───────────────────────────────────────────────────
 *
 * ARCHIVEDGUARD-1 made `mutatePlan`'s "1 · resolve the plan" step check
 * `archived_iso IS NULL` before trusting a caller-supplied `opts.planId`. That
 * check and the actual write in `apply` are two separate statements inside one
 * plain `BEGIN` (default READ COMMITTED, no row lock held in between). So the
 * guarantee only covered a race already resolved BEFORE the check ran — a
 * concurrent `clearActivePlansFor` (generate.ts / seed-from-onboarding.ts)
 * archiving the SAME plan and committing in the window between this SELECT and
 * `apply`'s write would sail through completely undetected: the check had
 * already said "active" and nothing ever re-asked.
 *
 * The fix (this commit) adds `FOR UPDATE` to that SELECT. `clearActivePlansFor`
 * archives with a plain `UPDATE training_plans SET archived_iso = ... WHERE
 * ... archived_iso IS NULL` in both its implementations — an UPDATE always
 * takes an implicit row lock on every row it modifies, so it was ALREADY a
 * compatible lock-taker and needed no change of its own; verified by reading
 * both `clearActivePlansFor` bodies (generate.ts:13365, seed-from-onboarding
 * .ts:499) rather than assumed.
 *
 * ── WHAT IS A REAL RACE REPRODUCTION HERE, AND WHAT IS NOT ──────────────────
 *
 * Tests 1 and 2 drive the exact locking primitive `mutate.ts` now uses with
 * TWO independently-controlled live connections, in an EXPLICITLY forced
 * order — this is a genuine reproduction of the race, not a hopeful timing
 * window: "does the archiver block" is proven by racing it against a bounded
 * delay (Promise.race), not by asserting a specific wall-clock duration, so it
 * is deterministic and not flaky. `mutatePlan` itself has no seam to pause
 * between its own SELECT and its own `apply()`, so these two tests replicate
 * the literal SQL text mutate.ts runs (see the comment on each query) rather
 * than calling `mutatePlan` — that is a real limitation, named rather than
 * hidden, and test 4 guards against the copy drifting from the source.
 *
 * Test 3 goes through the REAL `mutatePlan()` boundary. It adds a small
 * test-only delay inside `apply()` (mutate.ts itself is untouched) to widen
 * the resolve-to-write window enough to fire the archiver reliably INSIDE
 * it, then asserts the two transactions finish in the order the lock
 * demands (mutation, then archiver) — not a loose "either outcome is
 * consistent" check. That looser version was tried first and shown to be
 * non-diagnostic: it kept passing even with `FOR UPDATE` removed, so it is
 * not in this file. The stagger (fire the archiver 50ms in, long after a
 * local `FOR UPDATE` SELECT has certainly already run) removes the only
 * remaining source of flakiness — which of the two transactions' first
 * statement reaches the server first.
 *
 * ── REACHABILITY ─────────────────────────────────────────────────────────────
 *
 * Same fixture contract as `_archived_plan_mutation_guard.db.test.ts` and
 * `_ledger_atomicity.db.test.ts`: `DATABASE_URL` must parse, name a LOOPBACK
 * host, and name `faff_roundtrip_scratch`. Skips and prints why otherwise
 * (Rule 18) rather than reporting clean having looked at nothing.
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_archived_plan_race_guard.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · The `opts.workoutId` resolution path and the "no planId supplied"
 *   fallback path in `mutate.ts` — neither was given a row lock by this
 *   change. Same scope exclusion as `_archived_plan_mutation_guard.db.test.ts`
 *   §Rule 22, for the same reason: this fix is scoped to the explicit-planId
 *   path ARCHIVEDGUARD-1 touched.
 * · Any race that is NOT "archive lands mid-transaction" — e.g. two
 *   concurrent structural mutations to the same still-active plan. That is a
 *   different hazard (covered, for the idempotency-key case, by
 *   `_ledger_atomicity.db.test.ts` test 6) and is not this file's claim.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '@/lib/db/pool';
import { mutatePlan } from './mutate';
import type { PoolClient } from 'pg';

const SCRATCH_DB = 'faff_roundtrip_scratch';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

function scratchVerdict(url: string | undefined, label: string): string | null {
  if (!url) return `${label} is not set`;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return `${label} is not a parseable URL`; }
  if (!LOOPBACK.has(parsed.hostname)) {
    return `${label} points at host '${parsed.hostname}', which is not loopback`;
  }
  const db = parsed.pathname.replace(/^\//, '');
  if (db !== SCRATCH_DB) return `${label} names database '${db}', not '${SCRATCH_DB}'`;
  return null;
}

const refusals = [scratchVerdict(process.env.DATABASE_URL, 'DATABASE_URL')]
  .filter((x): x is string => x !== null);
const REACHABLE = refusals.length === 0;
const when = REACHABLE ? it : it.skip;

const TODAY = '2026-09-12';
const DATE_ISO = '2026-09-14';

let RUNNER = '';

function delay(ms: number): Promise<'TIMEOUT'> {
  return new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), ms));
}

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `archived-race-guard+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

/** One active plan with one plan_workouts row on DATE_ISO. */
async function seedActivePlan(): Promise<string> {
  const planId = `pln_arcrace_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb, NULL)`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the archived-plan-race-guard suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the archived-plan-race-guard suite')`,
    [weekId, planId, TODAY, phaseId],
  );
  await pool.query(
    `INSERT INTO plan_workouts
       (id, plan_id, week_id, date_iso, dow, type, distance_mi,
        is_quality, is_long, notes, pace_target_s_per_mi, workout_spec)
     VALUES ($1, $2, $3, $4, 1, 'easy', 6, false, false, '', 500, '{"kind":"easy"}'::jsonb)`,
    [`pw_${randomUUID().slice(0, 8)}`, planId, weekId, DATE_ISO],
  );
  return planId;
}

async function workoutTypeOn(planId: string): Promise<string | undefined> {
  const r = await pool.query<{ type: string }>(
    `SELECT type FROM plan_workouts WHERE plan_id = $1 AND date_iso = $2::text`,
    [planId, DATE_ISO],
  );
  return r.rows[0]?.type;
}

async function archivedIsoOf(planId: string): Promise<string | null> {
  const r = await pool.query<{ archived_iso: string | null }>(
    `SELECT archived_iso::text AS archived_iso FROM training_plans WHERE id = $1`,
    [planId],
  );
  return r.rows[0]?.archived_iso ?? null;
}

/**
 * The literal locking query `mutate.ts`'s "1 · resolve the plan" step now
 * runs for an explicit `opts.planId` (ARCHIVEDGUARD-2). Kept identical to the
 * source on purpose — test 4 below asserts the source still contains this
 * exact shape, so the two cannot silently drift apart.
 */
async function resolveActiveForUpdate(
  client: PoolClient,
  planId: string,
  userUuid: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM training_plans
      WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL
      LIMIT 1
      FOR UPDATE`,
    [planId, userUuid],
  );
  return res.rows[0]?.id ?? null;
}

/** The exact archiving statement both `clearActivePlansFor` implementations
 *  run (generate.ts:13365, seed-from-onboarding.ts:499) — a plain UPDATE,
 *  which is already a compatible lock-taker with `FOR UPDATE` above. */
async function archivePlan(planId: string): Promise<number> {
  const res = await pool.query(
    `UPDATE training_plans SET archived_iso = NOW()
      WHERE id = $1 AND archived_iso IS NULL`,
    [planId],
  );
  return res.rowCount ?? 0;
}

/** The exact vulnerable call shape `api/plan/workout/route.ts`'s PATCH makes,
 *  same as `_archived_plan_mutation_guard.db.test.ts`'s `patchWorkout`. An
 *  optional `applyDelayMs` sleeps INSIDE `apply()`, before the write — this is
 *  test-only instrumentation (mutate.ts itself is untouched) that widens the
 *  window between "1 · resolve the plan" and the actual write long enough to
 *  make the interleaving in test 3 deterministic instead of a timing gamble. */
function patchWorkout(planId: string, newType: string, applyDelayMs = 0) {
  return mutatePlan<{ rowCount: number }>({
    userUuid: RUNNER,
    authority: 'RUNNER_INITIATED',
    source: 'test/archived-plan-race-guard',
    todayISO: TODAY,
    planId,
    touches: 'structural',
    detail: { date_iso: DATE_ISO, updates: { type: newType } },
    apply: async (tx) => {
      if (applyDelayMs > 0) await new Promise((r) => setTimeout(r, applyDelayMs));
      const res = await tx.query(
        `UPDATE plan_workouts SET type = $3
           WHERE plan_id = $1 AND date_iso = $2::text`,
        [planId, DATE_ISO, newType],
      );
      return { rowCount: res.rowCount ?? 0 };
    },
  });
}

const LIVENESS_TITLE = REACHABLE
  ? 'the scratch database was reachable · every assertion below actually ran'
  : `SKIPPED · THIS SUITE PROVED NOTHING · ${refusals.join('; ')}`;

describe('liveness · did this suite look at anything', () => {
  it(LIVENESS_TITLE, () => {
    if (!REACHABLE) {
      process.stderr.write(
        `\n[archived-plan-race-guard] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

describe('ARCHIVEDGUARD-2 · the resolve-then-write window is closed by a row lock', () => {
  let planId = '';

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    planId = await seedActivePlan();
  });

  when(
    '1 · a held FOR UPDATE lock blocks a concurrent archive until the holder ' +
    'commits, and the write lands before the archive',
    async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // The resolve step runs first and takes the lock — the plan reads as
        // active.
        const resolved = await resolveActiveForUpdate(client, planId, RUNNER);
        expect(resolved, 'the plan should resolve as active before any race').toBe(planId);

        // Fire the archiver concurrently. It must NOT be able to complete
        // while `client`'s transaction still holds the row lock — that is
        // the entire guarantee this fix adds. Proven by racing it against a
        // bounded delay rather than asserting a specific duration, so this
        // is deterministic, not a timing gamble.
        const archiving = archivePlan(planId);
        const raceResult = await Promise.race([archiving, delay(400)]);
        expect(
          raceResult,
          'the archiver completed WHILE the resolving transaction still held ' +
          'the row — the FOR UPDATE lock is not actually blocking it',
        ).toBe('TIMEOUT');

        // Now do the write the boundary's `apply()` would do, and commit —
        // exactly mirroring "transaction A proceeds to write" from a
        // resolve that already holds the lock.
        await client.query(
          `UPDATE plan_workouts SET type = $2 WHERE plan_id = $1 AND date_iso = $3::text`,
          [planId, 'recovery', DATE_ISO],
        );
        await client.query('COMMIT');

        // Releasing the lock lets the archiver proceed. Bound the wait so a
        // genuine regression (permanent block/deadlock) fails fast instead
        // of hanging the suite.
        const archivedRows = await Promise.race([
          archiving,
          delay(5_000).then(() => { throw new Error('archiver never unblocked after COMMIT'); }),
        ]);
        expect(archivedRows).toBe(1);
      } finally {
        client.release();
      }

      expect(
        await workoutTypeOn(planId),
        'the write that started while the plan was genuinely active must land',
      ).toBe('recovery');
      expect(
        await archivedIsoOf(planId),
        'the archive that was only ever blocked, never refused, must still land afterward',
      ).not.toBeNull();
    },
  );

  when(
    '2 · when the archive commits FIRST, the locked resolve query correctly ' +
    'sees the plan as archived and returns no row',
    async () => {
      const archivedRows = await archivePlan(planId);
      expect(archivedRows, 'the archiver must actually have archived the seeded plan').toBe(1);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resolved = await resolveActiveForUpdate(client, planId, RUNNER);
        expect(
          resolved,
          'a plan archived before this transaction\'s resolve query ran must ' +
          'never resolve as active — this is the case ARCHIVEDGUARD-1 already ' +
          'covered, kept here as the control case for test 1',
        ).toBeNull();
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  );

  when(
    '3 · through the real mutatePlan() boundary, an archiver that fires ' +
    'INSIDE the resolve-to-write window is forced to wait for the mutation ' +
    'to finish, never the other way around',
    async () => {
      // This is the deterministic, order-sensitive version of the race —
      // NOT the loose invariant-only check this test used to be. That
      // earlier version was falsified against itself first: it asserted
      // only "if ok, the write landed; if refused, it didn't", which is
      // trivially true whether or not the resolve step ever took a lock
      // (confirmed by temporarily removing `FOR UPDATE` from mutate.ts and
      // re-running this file — that version of test 3 kept passing while
      // test 4 correctly caught the regression). A real falsifier has to
      // pin the ORDER the two transactions actually complete in, not just
      // the pairing of outcome-to-row-value.
      //
      // `patchWorkout`'s `apply()` sleeps 300ms before its write, widening
      // the resolve-to-write window. The archiver is fired 50ms in — long
      // after the resolve step has certainly already run (a local FOR
      // UPDATE SELECT completes in low single-digit ms), but 250ms before
      // the mutation's own write. Under the fix, the resolve step's lock is
      // still held for that whole 300ms, so the archiver's UPDATE (which
      // needs to modify that same row) cannot complete until the mutation
      // transaction ends — the archiver MUST finish after the mutation.
      // Without the lock (the unfixed shape), the archiver has nothing to
      // wait on and finishes almost immediately, well before the mutation's
      // delayed write — the archiver finishes BEFORE the mutation.
      const order: Array<'mutation' | 'archive'> = [];

      const mutation = patchWorkout(planId, 'recovery', 300).then((r) => {
        order.push('mutation');
        return r;
      });
      const archiving = delay(50).then(() => archivePlan(planId)).then((n) => {
        order.push('archive');
        return n;
      });

      const [mutationResult, archivedRows] = await Promise.all([mutation, archiving]);

      expect(archivedRows, 'the archiver must actually have archived the seeded plan').toBe(1);
      expect(
        mutationResult.ok,
        'the mutation resolved+locked the plan before the archiver could touch ' +
        'it, so its write must succeed — the archiver is what waits, not the ' +
        'mutation',
      ).toBe(true);
      expect(
        order,
        'the archiver completed BEFORE the mutation whose resolve step was ' +
        'supposed to hold a lock on the same row for the whole 300ms window — ' +
        'the FOR UPDATE lock is not actually serializing the two transactions',
      ).toEqual(['mutation', 'archive']);
      expect(await workoutTypeOn(planId)).toBe('recovery');
    },
  );

  when(
    '4 · the source still carries FOR UPDATE on the explicit-planId resolve ' +
    '· guards this test file against silently drifting from the fix',
    () => {
      const src = readFileSync(
        join(__dirname, 'mutate.ts'),
        'utf8',
      );
      const idx = src.indexOf('WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL');
      expect(idx, 'the explicit-planId active-plan check no longer exists at all').toBeGreaterThan(-1);
      const windowAfter = src.slice(idx, idx + 200);
      expect(
        windowAfter,
        'ARCHIVEDGUARD-2 regressed: the explicit-planId resolve query no ' +
        'longer takes a row lock, so tests 1-3 above are now testing a ' +
        'query that does not match production',
      ).toContain('FOR UPDATE');
    },
  );
});
