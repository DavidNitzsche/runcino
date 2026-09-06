/**
 * lib/runner-state/store/schema.ts · THE DURABLE SHAPE OF `runner_beliefs`,
 * AND THE GUARD THAT KEEPS IT OFF PRODUCTION TONIGHT.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Steps 1 and 7 of `lib/brain/orchestration/steps.ts`'s sixteen-step
 * orchestrator — "load canonical runner state" and "update beliefs" — are
 * unwired because there is no belief STORE: `belief.ts` is a shape with no
 * table behind it, `ownership.ts` and `quantity-owners.ts` are surveys of who
 * ANSWERS each question, and none of the three persists an answer anywhere. A
 * plan rebuild archives `training_plans` and starts a fresh row; nothing today
 * carries a belief across that boundary.
 *
 * This file is the schema only. It contains no coaching logic, no belief
 * computation and no owner call — that is `loaders.ts`. It is deliberately
 * `CREATE TABLE IF NOT EXISTS`, run by the caller against whichever database
 * it is pointed at, and it is the caller's job — never this function's — to
 * make sure that database is a scratch database. `assertScratchDatabase`
 * below is the one check this file DOES make, because Rule 18 says a check
 * that could touch production and doesn't happen to is not a guarantee.
 *
 * ── WHY ONE APPEND-ONLY TABLE AND NOT AN UPSERT ────────────────────────────
 *
 * `plan_decision_ledger` (Rule 6, and its own LEDGERATOMIC-1 header) already
 * settled this shape for a sibling problem: rows are never deleted and never
 * rewritten in place, because an append-only table cannot lose a belief to a
 * race between a reader and a writer, and "what did we believe on that
 * Tuesday" is itself a question worth being able to answer later. So
 * `runner_beliefs` has ONE write path (`INSERT`, `write.ts`) and the CURRENT
 * belief is defined as the newest row per `(user_uuid, registry, belief_key)`
 * — `read.ts`'s `readLatestBelief`. There is no `UPDATE` anywhere in this
 * directory.
 *
 * ── WHY `plan_lineage_id` AND NOT `plan_id` IS THE KEY THAT SURVIVES A REBUILD ─
 *
 * A plan rebuild changes `training_plans.id`. It does not change the runner.
 * `lib/brain/ledger/decision-ledger.ts#resolvePlanLineage` already solved
 * exactly this for the decision ledger — a lineage id that a REPLACED plan
 * hands forward to its successor, so a chain of rebuilds carries one id from
 * the first plan to the last — and this file REUSES that function
 * (`lineage.ts` is the thin wrapper) rather than re-deriving the chase.
 * `plan_lineage_id` is NOT NULL for the same reason the ledger's column is
 * NOT NULL: a belief with no plan at all still belongs to a runner, and
 * `orphan:<user uuid>` says so plainly instead of inventing a plan id.
 *
 * ── WHAT IS DELIBERATELY A JSONB BLOB AND WHY ──────────────────────────────
 *
 * `belief.ts`'s `Belief<T>` is generic over `T`, and different beliefs hold
 * numbers, ranges, phase labels and safety verdicts. A relational column per
 * possible `T` would either lose the type or require a table per belief key,
 * and `ownership.ts`'s own header rule applies here too: "no numbers, no
 * thresholds, no physiology" belongs in a registry — a stored VALUE belongs in
 * a value column, typed loosely enough to hold whatever the owner returned.
 * `reading_value`, `supporting`, `contradicting`, `tension`, `recency`,
 * `moves_up_on`, `moves_down_on`, `never_moves_on` are jsonb for this reason.
 * Everything the GATE inspects without touching the value — confidence,
 * source mode, rule8Side, the owner reference, the three timestamps, the
 * refusal flag — is a real typed column, so a query can ask "how many beliefs
 * are absent" without touching a single byte of jsonb.
 */
import type { PoolClient } from 'pg';

export const RUNNER_BELIEFS_TABLE = 'runner_beliefs';

/**
 * Names this file will NEVER run DDL against, whatever `DATABASE_URL` says.
 * Kept in code (not only in a script) because `ensureBeliefStoreSchema` is a
 * function other code can call, and a function that can be called from
 * anywhere must carry its own guard rather than trust every future caller to
 * remember the shell-script convention `_ledger_atomicity.db.test.ts` and
 * siblings use.
 */
const FORBIDDEN_DATABASE_NAMES = new Set(['faff', 'railway', 'postgres']);

export type ScratchVerdict =
  | { readonly ok: true; readonly database: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The pure half of the check — no query, just the verdict, so it can be
 * falsified without a second live database standing in for "production".
 * `_belief_store.test.ts` drives this directly with both a loopback scratch
 * name (passes) and a forbidden name that is technically loopback too
 * (fails), which is the case a naive "loopback is safe" check would miss.
 */
export function evaluateScratchVerdict(db: string, hostIsLoopback: boolean): ScratchVerdict {
  if (!hostIsLoopback) {
    return { ok: false, reason: `server address is not loopback (db=${db})` };
  }
  if (FORBIDDEN_DATABASE_NAMES.has(db.toLowerCase())) {
    return { ok: false, reason: `database name '${db}' is on the production forbidden list` };
  }
  return { ok: true, database: db };
}

/**
 * Refuses to proceed unless the connection is loopback AND the database name
 * does not look like production. This cannot prove "this is scratch" — no
 * function can, from inside a single connection, without a passlist of every
 * legitimate scratch name that will ever exist — but it CAN prove "this is not
 * obviously production", which is the one thing Rule 18 requires this file to
 * check rather than assume. `_belief_store.db.test.ts` proves the live query
 * against the real scratch database; `_belief_store.test.ts` falsifies
 * `evaluateScratchVerdict` itself in both directions with no connection at all.
 */
export async function assertScratchDatabase(
  exec: Pick<PoolClient, 'query'>,
): Promise<ScratchVerdict> {
  const r = await exec.query<{ db: string; host_is_loopback: boolean }>(
    `SELECT current_database() AS db,
            inet_server_addr() IS NULL
              OR inet_server_addr() = '127.0.0.1'
              OR inet_server_addr() = '::1' AS host_is_loopback`,
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'could not read current_database()' };
  return evaluateScratchVerdict(row.db, row.host_is_loopback);
}

/**
 * `CREATE TABLE IF NOT EXISTS` · idempotent, additive, no DDL that could touch
 * an existing row. Never called by application code — only by test setup and
 * by a scratch-database bootstrap script — and it re-runs
 * `assertScratchDatabase` itself rather than trusting the caller checked,
 * because the caller checking and this function checking is exactly the
 * belt-and-suspenders Rule 18 asks for on anything that can execute DDL.
 */
export async function ensureBeliefStoreSchema(exec: Pick<PoolClient, 'query'>): Promise<void> {
  const verdict = await assertScratchDatabase(exec);
  if (!verdict.ok) {
    throw new Error(
      `ensureBeliefStoreSchema refused: ${verdict.reason}. This function may `
      + 'only run DDL against a scratch database.',
    );
  }
  await exec.query(`
    CREATE TABLE IF NOT EXISTS ${RUNNER_BELIEFS_TABLE} (
      id                 bigserial PRIMARY KEY,
      user_uuid          uuid NOT NULL,
      -- 'BELIEF' keys into belief.ts's BeliefKey vocabulary (a runner FACT).
      -- 'QUANTITY' keys into quantity-owners.ts's QuantityId vocabulary (a
      -- PRESCRIPTION ceiling derived from one or more BELIEF rows). Never
      -- conflated: a query that wants "does this runner's threshold pace
      -- belief exist" and one that wants "what is this week's threshold dose
      -- ceiling" ask different registries on purpose.
      registry           text NOT NULL CHECK (registry IN ('BELIEF', 'QUANTITY')),
      belief_key         text NOT NULL,
      -- Rule 10 · the anchor. What this reading was computed FROM, so a row
      -- read back later carries the physiological/plan basis it was derived
      -- against rather than presenting a bare number as timeless.
      plan_lineage_id    text NOT NULL,
      -- Rule 11 · three facts, never one. reading_ok = false means an
      -- honestly-stated ABSENT or FAILED, carried in reading_absent_reason.
      -- It is a CHECK, not a convention: a row cannot claim both.
      reading_ok         boolean NOT NULL,
      reading_value      jsonb,
      reading_absent_reason jsonb,
      CHECK (
        (reading_ok = true  AND reading_value IS NOT NULL AND reading_absent_reason IS NULL) OR
        (reading_ok = false AND reading_value IS NULL AND reading_absent_reason IS NOT NULL)
      ),
      confidence         double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      source_mode        text,
      supporting         jsonb NOT NULL DEFAULT '[]'::jsonb,
      contradicting      jsonb NOT NULL DEFAULT '[]'::jsonb,
      tension            jsonb,
      recency            jsonb,
      rule8_side         text NOT NULL CHECK (rule8_side IN ('HABIT', 'ABSORBED_LOAD', 'NEITHER')),
      moves_up_on        jsonb NOT NULL DEFAULT '[]'::jsonb,
      moves_down_on      jsonb NOT NULL DEFAULT '[]'::jsonb,
      never_moves_on     jsonb NOT NULL DEFAULT '[]'::jsonb,
      owner_module       text NOT NULL,
      owner_symbol       text NOT NULL,
      owner_answers      text NOT NULL,
      -- Rule 10 · when the underlying owner resolved this, which may be
      -- earlier than stored_at when a loader batches several beliefs off
      -- one shared resolution.
      computed_at        timestamptz NOT NULL,
      model_version      text NOT NULL,
      stored_at          timestamptz NOT NULL DEFAULT now()
    )
  `);
  // The read path is always "newest row for this runner+key" — one index
  // carries every query this directory issues.
  await exec.query(`
    CREATE INDEX IF NOT EXISTS runner_beliefs_latest_idx
      ON ${RUNNER_BELIEFS_TABLE} (user_uuid, registry, belief_key, stored_at DESC)
  `);
  // The rebuild-survival query below groups by lineage, never by plan_id.
  await exec.query(`
    CREATE INDEX IF NOT EXISTS runner_beliefs_lineage_idx
      ON ${RUNNER_BELIEFS_TABLE} (user_uuid, plan_lineage_id)
  `);
}
