/**
 * lib/plan/_archived_plan_guard_swallowed_failure.db.test.ts · SWALLOWEDGUARD-1
 * (2026-09-13) · CLAUDE.md Rule 11 — "don't know", "measured zero" and "the
 * read failed" are three facts, never one.
 *
 * ── THE BUG THIS FALSIFIES ──────────────────────────────────────────────────
 *
 * `mutatePlan`'s "1 · resolve the plan" step (ARCHIVEDGUARD-1/2, landed on
 * `fix/archived-plan-guard-race-condition`) checks whether a caller-supplied
 * `opts.planId` is still active before trusting it:
 *
 *     const active = (await client.query<{ id: string }>(
 *       `SELECT id::text AS id FROM training_plans
 *         WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL
 *         LIMIT 1
 *         FOR UPDATE`,
 *       [opts.planId, opts.userUuid],
 *     ).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows[0]?.id ?? null;
 *     if (active) planId = active;
 *     else requestedPlanArchived = true;
 *
 * `.catch(() => ({ rows: [] }))` cannot tell "the query ran and found nothing
 * because the plan is archived / not owned" apart from "the query itself
 * THREW" (a transient DB error, a lock-wait timeout, a network blip — read.ts's
 * own incident was exactly this shape: a hard Postgres type error silently
 * becoming an empty, "honest-looking" result). Both collapse into `active =
 * null` → `requestedPlanArchived = true` — a FALSE "this plan is archived"
 * claim reported as fact about the runner's real data whenever the read
 * merely failed.
 *
 * The fix (this commit) replaces the bare `.catch` with `attempt()`
 * (`lib/db/read.ts`), which forces the caller to branch on `ok` before
 * touching a value, and reports a failed read under its own outcome —
 * `plan_verification_failed` — which REFUSES the mutation without ever
 * claiming the plan is archived, and without letting the write proceed as if
 * the plan were still active.
 *
 * ── WHY `rowOrNull` ALONE WAS NOT ENOUGH FOR THIS CALL SITE ─────────────────
 *
 * `rowOrNull` (used 30 lines below, for the authorship lineage lookup) DOES
 * make failure LOUD (it logs through `attempt` internally) and DOES return a
 * distinguishable `undefined` (not found) vs `null` (failed) — but the moment
 * a caller writes `(await rowOrNull(...))?.id ?? null`, exactly what the
 * lineage lookup does on purpose, both states collapse back into one `null`
 * again. That collapse is an ARGUED, correct exemption for the lineage field
 * (audit-only, "a lineage lookup must never be the thing that fails a
 * rebuild") — but it is precisely the wrong shape for THIS check, whose
 * entire reason for existing is "verify not-archived before allowing a
 * write." So this call site uses `attempt()` directly and branches on `.ok`
 * itself, refusing outright on failure rather than coalescing it into a
 * `?? null`.
 *
 * ── HOW THE THROW IS FORCED, FOR REAL, NOT MOCKED ────────────────────────────
 *
 * Per Rule 13/18 this falsifies a REAL query failure, not a stubbed one:
 * `opts.userUuid` is bound to `$2::uuid` in the exact query above, so passing
 * a string that is not a valid UUID makes Postgres itself throw
 * `invalid input syntax for type uuid` when this statement executes — a
 * genuine, deterministic rejection from `client.query`, the same class of
 * error `lib/db/read.ts`'s own header names as the incident's root cause.
 *
 * ── REACHABILITY ─────────────────────────────────────────────────────────────
 *
 * Same fixture contract as the sibling `_archived_plan_*_guard.db.test.ts`
 * files: `DATABASE_URL` must parse, name a LOOPBACK host, and name
 * `faff_roundtrip_scratch`. Skips and prints why otherwise (Rule 18) rather
 * than reporting clean having looked at nothing.
 *
 *     bash web-v2/scripts/_build_roundtrip_scratch.sh
 *     DATABASE_URL=postgresql://localhost/faff_roundtrip_scratch \
 *       npx vitest run lib/plan/_archived_plan_guard_swallowed_failure.db.test.ts
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ─────────────────────────────────
 *
 * · Any OTHER swallowed-failure site in `mutate.ts` (e.g. the "no planId
 *   supplied" fallback's own `.catch(() => ({ rows: [] }))`, left untouched
 *   by this fix and out of scope here — that fallback answers a different
 *   question, "what plan is active", not "is THIS named plan archived", and
 *   is not gated behind a write the way this check is).
 * · A failure in the `client.query('BEGIN')` step itself, or in the
 *   ledger-write lanes (`land`/`landInTx`) — both already fail soft by a
 *   separate, pre-existing contract (`landDecisionInLedger`'s own try/catch)
 *   and are not this file's claim.
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

const TODAY = '2026-09-13';
const DATE_ISO = '2026-09-15';

/** Not a valid UUID. Binding this to a `$n::uuid` parameter makes Postgres
 *  itself throw `invalid input syntax for type uuid` — a real, deterministic
 *  query failure, not a mocked one. */
const MALFORMED_USER_UUID = 'not-a-real-uuid-at-all';

let RUNNER = '';

async function seedRunner(): Promise<void> {
  RUNNER = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1::uuid, $2, 'not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [RUNNER, `swallowed-failure+${RUNNER.slice(0, 8)}@scratch.local`],
  );
}

/** One plan with one plan_workouts row on DATE_ISO, optionally pre-archived. */
async function seedPlan(opts: { archived: boolean }): Promise<string> {
  const planId = `pln_swguard_${randomUUID().slice(0, 8)}`;
  const phaseId = `phs_${randomUUID().slice(0, 8)}`;
  const weekId = `wk_${randomUUID().slice(0, 8)}`;
  await pool.query(
    `INSERT INTO training_plans (id, user_id, user_uuid, mode, goal_iso, authored_state, archived_iso)
     VALUES ($1, $2::text, $3::uuid, 'race-prep', $4, '{}'::jsonb, ${opts.archived ? 'NOW()' : 'NULL'})`,
    [planId, RUNNER, RUNNER, TODAY],
  );
  await pool.query(
    `INSERT INTO plan_phases (id, plan_id, label, start_week_idx, end_week_idx, rationale, citation)
     VALUES ($1, $2, 'BUILD', 0, 0, 'seeded for the swallowed-failure guard suite', 'test')`,
    [phaseId, planId],
  );
  await pool.query(
    `INSERT INTO plan_weeks (id, plan_id, week_idx, week_start_iso, phase_id, rationale)
     VALUES ($1, $2, 0, $3, $4, 'seeded for the swallowed-failure guard suite')`,
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

/**
 * A literal copy of the PRE-FIX archived-plan-guard resolve step — the exact
 * `.catch(() => ({ rows: [] }))` shape `mutate.ts` carried before this commit.
 * Kept here (not run against a checked-out old commit) for the same reason
 * `_archived_plan_race_guard.db.test.ts` keeps a literal copy of its own
 * target query: `mutatePlan` has no seam to pause or intercept mid-function,
 * so a literal, source-matched reproduction is how a "before" state gets
 * exercised without forking the whole function.
 */
async function oldSwallowingResolve(
  client: PoolClient,
  planId: string,
  userUuidMaybeInvalid: string,
): Promise<string | null> {
  const active = (await client.query<{ id: string }>(
    `SELECT id::text AS id FROM training_plans
      WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL
      LIMIT 1
      FOR UPDATE`,
    [planId, userUuidMaybeInvalid],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows[0]?.id ?? null;
  return active;
}

/** The exact vulnerable call shape a runner-initiated PATCH makes. */
function patchWorkout(userUuid: string, planId: string, newType: string) {
  return mutatePlan<{ rowCount: number }>({
    userUuid,
    authority: 'RUNNER_INITIATED',
    source: 'test/archived-plan-guard-swallowed-failure',
    todayISO: TODAY,
    planId,
    touches: 'structural',
    detail: { date_iso: DATE_ISO, updates: { type: newType } },
    apply: async (tx) => {
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
        `\n[archived-plan-guard-swallowed-failure] SKIPPED · THIS SUITE PROVED NOTHING.\n`
        + `  ${refusals.join('; ')}\n`
        + `  Build the fixture: bash web-v2/scripts/_build_roundtrip_scratch.sh\n`
        + `  Then run with: DATABASE_URL=postgresql://localhost/${SCRATCH_DB}\n\n`,
      );
    }
    expect(typeof REACHABLE).toBe('boolean');
  });
});

describe('SWALLOWEDGUARD-1 · BEFORE · the pre-fix shape cannot tell failure from archived', () => {
  let activePlanId = '';

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    activePlanId = await seedPlan({ archived: false });
  });

  when(
    'a forced query failure (malformed userUuid → real Postgres uuid-cast error) ' +
    'resolves to `null` under the OLD `.catch(() => ({ rows: [] }))` shape — ' +
    'INDISTINGUISHABLE from a genuinely archived/not-owned plan, which is the bug',
    async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const resolvedOnFailure = await oldSwallowingResolve(client, activePlanId, MALFORMED_USER_UUID);
        await client.query('ROLLBACK');

        expect(
          resolvedOnFailure,
          'the pre-fix resolve step returned null on a THROWN query — the exact ' +
          'value it also returns for a genuinely archived plan. A caller reading ' +
          'this null cannot tell "the plan is archived" from "the read failed", ' +
          'and the pre-fix code reports both as `requestedPlanArchived = true`.',
        ).toBeNull();
      } finally {
        client.release();
      }

      // Control: the SAME plan, resolved with a VALID userUuid, correctly comes
      // back active — proving the null above was caused by the forced failure,
      // not by some other seeding mistake.
      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        const resolvedWhenValid = await oldSwallowingResolve(client2, activePlanId, RUNNER);
        await client2.query('ROLLBACK');
        expect(
          resolvedWhenValid,
          'control failed: the seeded plan should resolve as active for a valid userUuid',
        ).toBe(activePlanId);
      } finally {
        client2.release();
      }
    },
  );
});

describe('SWALLOWEDGUARD-1 · AFTER · the fix REFUSES honestly instead of collapsing the three facts', () => {
  let activePlanId = '';
  let archivedPlanId = '';

  beforeEach(async () => {
    if (!REACHABLE) return;
    await seedRunner();
    activePlanId = await seedPlan({ archived: false });
    archivedPlanId = await seedPlan({ archived: true });
  });

  when(
    'a forced read failure on an otherwise-active plan is refused as ' +
    '`plan_verification_failed` — NEVER `no_plan` (the false "archived" claim) ' +
    'and NEVER applied (the false "active" claim)',
    async () => {
      const res = await patchWorkout(MALFORMED_USER_UUID, activePlanId, 'recovery');

      expect(res.ok, 'a read failure must never be silently treated as a permitted write').toBe(false);
      expect(
        res.outcome,
        'a read failure must be reported under its OWN outcome, distinguishable ' +
        'from the genuinely-archived case (`no_plan`) — collapsing the two back ' +
        'together would recreate the exact bug this fixes',
      ).toBe('plan_verification_failed');

      // The row must be untouched either way: refused, not applied.
      expect(
        await workoutTypeOn(activePlanId),
        'the active plan\'s row was rewritten despite the guard\'s read failing',
      ).toBe('easy');
    },
  );

  when(
    'REGRESSION · a genuinely archived/not-owned plan_id still refuses as ' +
    '`no_plan`, exactly as ARCHIVEDGUARD-1/2 already established',
    async () => {
      const res = await patchWorkout(RUNNER, archivedPlanId, 'recovery');
      expect(res.ok, 'a write to a genuinely archived plan must still be refused').toBe(false);
      expect(
        res.outcome,
        'a genuinely archived plan must still report `no_plan`, not the new ' +
        '`plan_verification_failed` outcome — the two refusals must stay distinct',
      ).toBe('no_plan');
      expect(await workoutTypeOn(archivedPlanId)).toBe('easy');
    },
  );

  when(
    'REGRESSION · a genuinely active plan still succeeds exactly as before',
    async () => {
      const res = await patchWorkout(RUNNER, activePlanId, 'recovery');
      expect(res.ok, 'a legitimate write to the runner\'s own active plan must still work').toBe(true);
      expect(await workoutTypeOn(activePlanId)).toBe('recovery');
    },
  );

  when(
    'the source no longer carries the bare `.catch(() => ({ rows: [] ' +
    "as Array<{ id: string }> }))` swallow on the archived-plan-guard SELECT, " +
    'and now routes it through `attempt(...)` · guards this file against ' +
    'silently drifting from the fix',
    () => {
      const src = readFileSync(join(__dirname, 'mutate.ts'), 'utf8');
      const idx = src.indexOf('WHERE id = $1 AND user_uuid = $2::uuid AND archived_iso IS NULL');
      expect(idx, 'the explicit-planId active-plan check no longer exists at all').toBeGreaterThan(-1);

      const windowBefore = src.slice(Math.max(0, idx - 400), idx);
      expect(
        windowBefore,
        'SWALLOWEDGUARD-1 regressed: the archived-plan-guard query is no longer ' +
        'wrapped in `attempt(...)`, so a thrown read can no longer be told apart ' +
        'from a genuinely archived plan',
      ).toContain('attempt(');

      const windowAfter = src.slice(idx, idx + 300);
      expect(
        windowAfter,
        'SWALLOWEDGUARD-1 regressed: the bare `.catch(() => ({ rows: [] }))` ' +
        'swallow is back on the archived-plan-guard SELECT',
      ).not.toContain(".catch(() => ({ rows: [] as Array<{ id: string }> }))");
    },
  );
});
