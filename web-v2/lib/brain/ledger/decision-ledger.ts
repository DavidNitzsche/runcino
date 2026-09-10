/**
 * lib/brain/ledger/decision-ledger.ts · THE ONE WRITE PATH INTO
 * `plan_decision_ledger`.
 *
 * `ledger-entry.ts` is the policy — what a decision is, and how its direction is
 * MEASURED rather than declared. This file is the storage and contains no
 * policy of its own, in the same split `canonical-shadow/deferral-store.ts`
 * already uses against `canonical/deferral-queue.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * LEDGERATOMIC-1 (2026-09-05) · TWO LANES, AND WHICH ONE COVERS WHAT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This file used to write on `pool` and ONLY on `pool`, and its own header
 * argued for that: a ledger row written inside `mutatePlan`'s transaction
 * would roll back with a rejected mutation, so the ledger would record every
 * decision EXCEPT the refusals.
 *
 * That argument is correct about refusals and WRONG about the committed half,
 * and the owner named the consequence exactly:
 *
 *     "A plan mutation and its ledger record must be one atomic outcome. The
 *      system may not: (1) mutate the plan, (2) fail to write the ledger,
 *      (3) log an error, (4) return success."
 *
 * That was the literal behaviour: `mutatePlan` COMMITted, then called this
 * file on a second connection, then `console.error`d a failure and returned
 * `ok: true`. A plan could move with nothing recording that it had.
 *
 * The resolution is not one lane, it is two, split on a real distinction:
 *
 *   ── LANE A · `recordDecisionInTransaction(tx, entry)` ─────────────────
 *   A DECISION THAT ACCOMPANIES A COMMITTED MUTATION. Written on the
 *   caller's own transaction, BEFORE its COMMIT, so the row and the plan
 *   change land or vanish together. A failed insert THROWS — the caller
 *   rolls back and the mutation does not happen. There is no window in
 *   which the plan has moved and the ledger has not, because there is no
 *   moment at which one is durable and the other is not.
 *
 *   ── LANE B · `recordDecision(entry)` ──────────────────────────────────
 *   A DECISION THAT RECORDS A REFUSAL. There is no mutation for it to be
 *   atomic WITH — the transaction has already rolled back, or was never
 *   opened (the authority refusal throws before `pool.connect`). Writing a
 *   refusal on the rolled-back transaction would erase it, which is the
 *   original header's argument and it still holds for exactly this case.
 *   So lane B keeps its own connection and its three-state, never-throws
 *   contract: a ledger outage must not be the thing that takes a runner's
 *   nightly cron down when nothing was going to change anyway.
 *
 * The test that separates them: DID ANYTHING COMMIT? If yes, lane A, and the
 * ledger is a precondition of the commit. If no, lane B, and the ledger is a
 * record of something that did not happen.
 *
 * ── AND THE THIRD STATE, WHICH IS NOT A FAILURE ────────────────────────────
 *
 * `table_absent` is not "the ledger failed", it is "migration 166 has not
 * been applied on this database" — which is production's state today, on
 * purpose, pending the owner's per-statement DDL go. Lane A treats it as the
 * declared pre-migration state and lets the mutation commit; a REQUIRED
 * ledger failure rolls the mutation back, and a table that does not exist yet
 * is not a required ledger failing. Rule 11: absent, failed and written are
 * three facts. The moment the table exists the ledger IS required, with no
 * code change and no flag — `scripts/check-decision-ledger.sh` guard 4 is
 * what holds that, and `_ledger_atomicity.db.test.ts` proves it against a
 * real table.
 *
 * ── RULE 11 · THE WRITE HAS THREE ANSWERS ──────────────────────────────────
 *
 *   WRITTEN       · the row landed. Its id is returned.
 *   TABLE_ABSENT  · migration 166 is not applied on this database. Not an
 *                   error, not a success, and NOT a row.
 *   FAILED        · the write broke. Loud, and never collapsed into either of
 *                   the above.
 *
 * The caller must be able to tell them apart, because "the decision was
 * recorded" and "the decision was made and nothing recorded it" are the two
 * facts this whole feature exists to separate. `mutatePlan` logs the second and
 * third at `console.error` and proceeds — the gate on a plan mutation is the
 * rollback, never the audit row, and a ledger outage must not be the thing that
 * takes a runner's cron down.
 *
 * ── ROWS ARE NEVER DELETED AND NEVER REWRITTEN IN PLACE ────────────────────
 *
 * The only UPDATEs this file issues are the three stamps the table's own CHECK
 * constraints require to arrive with their explanation: a supersession, an
 * undo, and a runner's answer to a proposal. Each carries a guard on the
 * column it is about to set being NULL, so a second pass cannot quietly
 * overwrite the first answer with a later one — "declined on Tuesday" must not
 * become "expired on Friday".
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · WHETHER A DECISION REACHED IT AT ALL. This file records what it is given.
 *   A write path that never calls it is invisible here, and that is exactly
 *   what `scripts/check-decision-ledger.sh` guard 1 exists to catch by scanning
 *   `mutatePlan`'s own exits.
 * · WHETHER THE CALLER PICKED THE RIGHT LANE. Nothing in this file can tell
 *   that a caller handed lane B a decision whose mutation committed — the
 *   executor is the only difference and both are valid shapes. That is guard
 *   4's job in the shell gate (every COMMIT preceded by an in-transaction
 *   write) and GUARD 3's in `_decision_ledger_gate.test.ts`.
 * · A COMMIT THAT NEVER OPENED A TRANSACTION HERE. Lane A is only atomic with
 *   the transaction it is handed. A caller that autocommits its writes on a
 *   pool connection and then calls lane A on that same pool connection gets no
 *   atomicity and no error, because a single-statement autocommit is
 *   indistinguishable from a transaction at this level.
 * · WHETHER THE DECISION WAS RIGHT, or whether the direction it carries is the
 *   coaching answer the runner needed.
 * · WHETHER MIGRATION 166 IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   The probe reports that state rather than throwing, so a green suite says
 *   nothing about the live database (Rule 19: green is not deployed).
 * · A ROW WRITTEN BY SOMETHING ELSE. Nothing else writes this table today; a
 *   psql session is outside any check here.
 */
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import type { LedgerDirection, LedgerEntry, LedgerRunnerResponse } from './ledger-entry';

export const PLAN_DECISION_LEDGER_TABLE = 'plan_decision_ledger';

/**
 * Anything that can run a statement. `pool` is lane B; a `PoolClient` inside
 * `mutatePlan`'s open transaction is lane A. Structural on purpose, so a test
 * can hand it a stub and prove the rollback path without a live socket.
 */
export type LedgerExecutor = { query: PoolClient['query'] };

/** Rule 11 · three answers, and the caller has to branch to reach the id. */
export type LedgerWrite =
  | { readonly state: 'written'; readonly id: string }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

/**
 * ── MIGRATIONPROBE-1 (2026-09-05) · TWO DEFECTS IN ONE EIGHT-LINE FUNCTION
 *
 * Found while writing the production migration approval packet, which is the
 * right time to find them and nearly too late.
 *
 * 1 · A FAILED PROBE WAS CACHED AS "ABSENT", FOREVER.
 *     `catch { tableExists = false }` collapses "the read failed" into "the
 *     table is not there" — Rule 11, on the one code path whose entire job is
 *     to tell those apart. One connection blip during the first probe and this
 *     process stops recording decisions for its whole life, reporting
 *     `table_absent` — a clean, confident, wrong answer.
 *
 * 2 · A NEGATIVE RESULT WAS CACHED ACROSS THE MIGRATION.
 *     The probe runs once per process. If the code deploys before the DDL —
 *     which the packet explicitly permits, because either order is safe for a
 *     bare CREATE TABLE — every process started in that window answers
 *     `table_absent` until it is restarted, long after the table exists. The
 *     migration would land, the packet would verify, and the ledger would stay
 *     empty with nothing anywhere reporting a fault.
 *
 * The fix for both: only a DEFINITE answer is cached, and only `true` is
 * cached permanently. A definite "not there" is re-probed on a cooldown so the
 * table appearing underneath a running process is noticed without asking the
 * database on every write. A failed probe caches nothing at all.
 */
const ABSENT_REPROBE_MS = 60_000;

/**
 * Rule 11 · three answers, because there are three.
 *
 * `null` rather than an `'unknown'` member on purpose. The swallow scanner
 * classifies a fabricated literal returned from a `catch` as MINTED and demands
 * an argued exemption whose sentence is "absent and failed lead to the same
 * outcome for every consumer, because ___". That sentence is FALSE here — they
 * lead to deliberately different outcomes — so an exemption would have been a
 * lie told to a gate. `null` is the shape the registry itself names as the
 * alternative, and it is what `rowsOrNull` already uses for exactly this.
 */
type TableProbe = 'present' | 'absent' | null;

let tableExists: true | null = null;
let absentUntilMs = 0;

async function ledgerTableExists(): Promise<TableProbe> {
  if (tableExists === true) return 'present';
  if (Date.now() < absentUntilMs) return 'absent';
  const r = await attempt(
    'ledger/table-probe',
    pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.${PLAN_DECISION_LEDGER_TABLE}')::text AS reg`,
    ),
  );
  // The failure is LOGGED by `attempt` and reported as null. Not caught and
  // discarded here — routing through lib/db/read.ts is what the swallow
  // registry names as the alternative to an exemption, and it is right: this
  // caller genuinely can tell the difference.
  if (!r.ok) return null;
  if (r.value.rows[0]?.reg != null) { tableExists = true; return 'present'; }
  // Definite: the database answered and the table is not there. Re-probe
  // later, so a migration applied under a live process is picked up.
  absentUntilMs = Date.now() + ABSENT_REPROBE_MS;
  return 'absent';
}

/** Test-only reset, mirroring `_resetDeferralTableProbeForTests` next door. */
export function _resetLedgerTableProbeForTests(): void {
  tableExists = null;
  absentUntilMs = 0;
}

/**
 * P0PROPOSALFETCH-1 (2026-09-09) · CAN A MUTATING ACCEPT ACTUALLY LAND.
 *
 * A cheap, read-side wrapper over the SAME cached probe `mutatePlan`'s own
 * `landDecisionInTransaction` uses (`ledgerTableExists`, above) — no new
 * query, no new cache, no new cooldown. It exists so a GET route can ask
 * "would an accept through this door work right now" without importing
 * `mutate.ts`'s transactional machinery for a read.
 *
 * `null` (the probe itself failed — Rule 11's third state, not the same fact
 * as the table being absent) reads as AVAILABLE, deliberately optimistic in
 * this one direction: this function only ever feeds an advisory UI hint, and
 * `mutatePlan`'s own live, transactional check is what actually decides
 * whether an accept lands — this can never be the thing that lets an
 * unrecorded mutation through, and it can never be the thing that blocks a
 * legitimate one either. Claiming "this cannot be applied" from a probe that
 * did not actually answer would be a false claim in its own right, not a
 * safe default: the honest state on a failed probe is "we do not know",
 * and the accept endpoint below will say so correctly for itself if the
 * runner taps through. See `loadV5PendingProposals` in
 * `lib/faff/v5-proposals.ts` for the one caller.
 */
export async function isLedgerAvailable(): Promise<boolean> {
  return (await ledgerTableExists()) !== 'absent';
}

const PROBE_FAILED_WHY =
  'the check for plan_decision_ledger could not be completed, so whether this decision was recorded is '
  + 'UNKNOWN. That is not the same as the migration not having been applied, and it is not a '
  + 'successful write of nothing.';

const ABSENT_WHY =
  `${PLAN_DECISION_LEDGER_TABLE} does not exist on this database, so the decision was made `
  + 'and NOT recorded. Migration 166 has not been applied here. That is not a successful write '
  + 'of nothing.';

/**
 * LANE A's probe · runs on the CALLER'S TRANSACTION and never swallows.
 *
 * Deliberately not routed through `attempt`: inside an open transaction a
 * failed statement has already aborted the transaction, so there is no
 * "carry on and report null" branch to take — the only honest answers are
 * "the table is there", "the table is not there", and a throw that the caller
 * turns into a ROLLBACK. Rule 11's third state is the exception here, not a
 * value: it cannot exist, because a probe that failed took the transaction
 * with it.
 *
 * IT HONOURS THE POSITIVE CACHE AND DELIBERATELY NOT THE ABSENT COOLDOWN.
 *
 * A definite `true` is permanent and skips the probe, because a table does not
 * un-exist. A definite `absent` sets `absentUntilMs` for lane B's benefit but is
 * NOT trusted here on the way back: lane B's 60-second cooldown exists to stop
 * separate connections hammering the catalog, and being wrong on that lane costs
 * a missing audit row. Being wrong on THIS lane costs a plan that moved with
 * nothing recording it, and the probe is one catalog lookup on a connection that
 * is already open. The asymmetry is the point, so it is stated rather than left
 * to be inferred from which lines were copied.
 */
async function ledgerTableExistsInTransaction(
  tx: LedgerExecutor,
): Promise<'present' | 'absent'> {
  if (tableExists === true) return 'present';
  const r = await tx.query<{ reg: string | null }>(
    `SELECT to_regclass('public.${PLAN_DECISION_LEDGER_TABLE}')::text AS reg`,
  );
  if (r.rows[0]?.reg != null) { tableExists = true; return 'present'; }
  absentUntilMs = Date.now() + ABSENT_REPROBE_MS;
  return 'absent';
}

/**
 * PLAN LINEAGE · the id that stays the same across every rebuild.
 *
 * Four rungs, in order, and each one is a different fact:
 *
 *   1 · the lineage the ledger already knows for the plan being REPLACED. This
 *       is the rung that makes a chain a chain: rebuild three inherits rebuild
 *       two's lineage, which inherited rebuild one's.
 *   2 · the replaced plan's own id, when the ledger has never seen it. Every
 *       plan authored before this table existed lands here exactly once and
 *       then rung 1 carries it forward.
 *   3 · the lineage the ledger knows for THIS plan, for an in-place mutation
 *       that replaced nothing.
 *   4 · this plan's own id.
 *
 * When there is no plan at all — a `no_plan` outcome, a refusal that never
 * resolved one — the lineage is `orphan:<user uuid>`. The column is NOT NULL on
 * purpose and inventing a plan id here would be worse than saying plainly that
 * this decision belongs to a runner and to no plan. It is greppable, and the
 * prefix cannot collide with a plan id.
 */
export async function resolvePlanLineage(args: {
  userUuid: string;
  planId: string | null;
  replacedPlanId: string | null;
  /**
   * LEDGERATOMIC-1 · lane A passes its own transaction, so the lineage is read
   * against the SAME snapshot the row is about to be written into. Reading it
   * on `pool` from inside a transaction that has already archived the replaced
   * plan would see a different view of `training_plans` than the writer does.
   */
  on?: LedgerExecutor;
}): Promise<string> {
  const exec: LedgerExecutor = args.on ?? pool;
  const known = async (planId: string): Promise<string | null> => {
    // A lineage lookup that could not run is not "no lineage on record".
    if (args.on) {
      if ((await ledgerTableExistsInTransaction(args.on)) !== 'present') return null;
    } else if ((await ledgerTableExists()) !== 'present') return null;
    // `rowOrNull` keeps the three states apart and LOGS a failure rather than
    // swallowing it (lib/db/read.ts). Both a failed read and a miss fall through
    // to the next rung, and that is the conservative direction on purpose: this
    // plan then opens a NEW lineage rather than silently joining the wrong one.
    // The distinction is preserved where it matters — in the log — because a
    // lineage that quietly restarts every night is a defect, and the log line is
    // how anyone would ever see it.
    const row = await rowOrNull<{ plan_lineage_id: string }>(
      'decision-ledger/lineage',
      exec.query<{ plan_lineage_id: string }>(
        `SELECT plan_lineage_id FROM ${PLAN_DECISION_LEDGER_TABLE}
          WHERE user_uuid = $1::uuid AND plan_id = $2
          ORDER BY at DESC LIMIT 1`,
        [args.userUuid, planId],
      ),
    );
    return row?.plan_lineage_id ?? null;
  };

  if (args.replacedPlanId) {
    return (await known(args.replacedPlanId)) ?? args.replacedPlanId;
  }
  if (args.planId) {
    return (await known(args.planId)) ?? args.planId;
  }
  return `orphan:${args.userUuid}`;
}

/**
 * THE ONE INSERT, shared by both lanes so they cannot drift apart.
 *
 * ON CONFLICT is scoped to the partial unique index over a non-null
 * `idempotency_key`, so a nightly pass that runs twice over unchanged evidence
 * refreshes its row instead of doubling the census. A row with no key is a
 * distinct event every time and never collides.
 *
 * `onceOnly` swaps the refresh for `DO NOTHING`, which turns the unique index
 * into the boundary's EXACTLY-ONCE guard: a second transaction carrying the
 * same key blocks on the index until the first commits, then inserts nothing
 * and returns no row. The caller reads that empty result as "this has already
 * been applied" and rolls its own mutation back. That is the whole of
 * `applyOnce`, and it is only correct because the row and the mutation are in
 * the same transaction — on two connections the second writer could commit its
 * plan change and then discover the duplicate.
 */
function ledgerInsertSql(onceOnly: boolean): string {
  return `INSERT INTO plan_decision_ledger (
         user_uuid, plan_id, plan_lineage_id, replaced_plan_id, plan_version,
         scope, workout_ids, scope_from_iso, scope_to_iso,
         lever, direction,
         evidence, provenance, source_mode,
         before_state, after_state,
         authority, authority_verdict, hold,
         decision, proposal_id, proposal, runner_response, responded_at,
         mutation_outcome, mutation_violations,
         explanation, model_version, idempotency_key
       ) VALUES (
         $1::uuid, $2, $3, $4, $5,
         $6, $7::jsonb, $8::date, $9::date,
         $10, $11,
         $12::jsonb, $13, $14,
         $15::jsonb, $16::jsonb,
         $17, $18, $19::jsonb,
         -- LEDGERRESPONDED-1 (2026-09-05) · responded_at WAS HARD-CODED NULL,
         -- and is now derived in SQL from runner_response.
         --
         -- The migration's own constraint says a response and its moment
         -- arrive together:
         --
         --   CHECK ((COALESCE(runner_response,'PENDING') IN
         --           ('ACCEPTED','DECLINED','EXPIRED')) = (responded_at IS NOT NULL))
         --
         -- so ANY insert carrying a terminal response was rejected outright.
         -- That is the whole runner-accept lane -- the only lane that can
         -- currently produce an upward adaptation. mutatePlan logged
         -- "DECISION NOT RECORDED" to console.error and returned normally, so
         -- the plan mutated and the ledger stayed empty, silently.
         --
         -- Rule 21's own defect, reproduced inside the mechanism built to end
         -- it: the census of upward adaptations would have read ZERO forever,
         -- and the reason would have been unfindable because the rows were
         -- never there to explain it.
         --
         -- Found INDEPENDENTLY BY TWO WORKSTREAMS on the same day, each on its
         -- first end-to-end run against a scratch database -- the threshold
         -- round trip and the V5 accept round trip. Neither could have found it
         -- from a per-stage suite: the constraint and the writer are each
         -- correct alone and disagree only in composition. It had simply never
         -- run, because until this week nothing could accept a proposal.
         --
         -- Stamped in SQL rather than by the caller, so the response and its
         -- time cannot be supplied separately and disagree (Rule 16).
         $20, $21, $22::jsonb, $23,
         CASE WHEN $23 IN ('ACCEPTED', 'DECLINED', 'EXPIRED') THEN now() ELSE NULL END,
         $24, $25::jsonb,
         $26, $27, $28
       )
       ON CONFLICT (user_uuid, provenance, idempotency_key) WHERE idempotency_key IS NOT NULL
       ${onceOnly ? 'DO NOTHING' : `DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         direction = EXCLUDED.direction,
         lever = EXCLUDED.lever,
         evidence = EXCLUDED.evidence,
         before_state = EXCLUDED.before_state,
         after_state = EXCLUDED.after_state,
         decision = EXCLUDED.decision,
         mutation_outcome = EXCLUDED.mutation_outcome,
         mutation_violations = EXCLUDED.mutation_violations,
         explanation = EXCLUDED.explanation,
         at = now()`}
       RETURNING id::text AS id`;
}

/** The bound parameters, in the column order above. One definition, two lanes. */
function ledgerInsertParams(entry: LedgerEntry): unknown[] {
  return [
    entry.userUuid, entry.planId, entry.planLineageId, entry.replacedPlanId, entry.planVersion,
    entry.scope, JSON.stringify(entry.workoutIds), entry.scopeFromISO, entry.scopeToISO,
    entry.lever, entry.direction,
    JSON.stringify(entry.evidence), entry.provenance, entry.sourceMode,
    entry.beforeState == null ? null : JSON.stringify(entry.beforeState),
    entry.afterState == null ? null : JSON.stringify(entry.afterState),
    entry.authority, entry.authorityVerdict,
    entry.hold == null ? null : JSON.stringify(entry.hold),
    entry.decision, entry.proposalId,
    entry.proposal == null ? null : JSON.stringify(entry.proposal),
    entry.runnerResponse,
    entry.mutationOutcome, JSON.stringify(entry.mutationViolations),
    entry.explanation, entry.modelVersion, entry.idempotencyKey,
  ];
}

/**
 * LANE B · WRITE A DECISION THAT RECORDS A REFUSAL, ON THIS FILE'S OWN
 * CONNECTION.
 *
 * There is no mutation for this row to be atomic with: the caller has already
 * rolled back, or never opened a transaction at all. Writing it on the caller's
 * rolled-back transaction would erase the refusal, which is the one decision a
 * reader most needs — an engine that never pushes and a runner who never earned
 * it look identical without it (Rule 21).
 *
 * Three answers, never throws. A ledger outage must not take down a nightly
 * cron whose mutation was not going to happen anyway.
 *
 * DO NOT CALL THIS AFTER A COMMIT. `recordDecisionInTransaction` is the lane
 * for a decision whose mutation lands, and `scripts/check-decision-ledger.sh`
 * guard 4 fails the build if a COMMIT in `mutatePlan` is not preceded by one.
 */
export async function recordDecision(entry: LedgerEntry): Promise<LedgerWrite> {
  const probe = await ledgerTableExists();
  if (probe === null) return { state: 'failed', why: PROBE_FAILED_WHY };
  if (probe === 'absent') return { state: 'table_absent', why: ABSENT_WHY };
  try {
    const r = await pool.query<{ id: string }>(ledgerInsertSql(false), ledgerInsertParams(entry));
    const id = r.rows[0]?.id;
    if (!id) {
      return {
        state: 'failed',
        why: 'the insert returned no id, so nothing can be said to have been recorded',
      };
    }
    return { state: 'written', id };
  } catch (e) {
    return {
      state: 'failed',
      why: `recording the decision failed: ${e instanceof Error ? e.message : String(e)}. `
        + 'The decision still happened; nothing recorded it.',
    };
  }
}

/**
 * LANE A's answers. Note what is NOT here: there is no `failed`.
 *
 * A failed insert on the caller's transaction THROWS, because the only correct
 * response to it is the caller's ROLLBACK and a returned `failed` would let a
 * caller ignore it — which is precisely the four-step sequence the owner ruled
 * out ("mutate the plan, fail to write the ledger, log an error, return
 * success"). Making it a throw removes the option.
 */
export type LedgerTxWrite =
  | { readonly state: 'written'; readonly id: string }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'duplicate'; readonly why: string };

export const LEDGER_ONCE_WITHOUT_TABLE =
  'this mutation asked for exactly-once application, and the guarantee rests on '
  + `${PLAN_DECISION_LEDGER_TABLE}'s unique index, which does not exist on this database. `
  + 'Migration 166 has not been applied here. Applying anyway would silently downgrade an '
  + 'exactly-once accept to an at-least-once one, which is a missing input quietly disabling a '
  + 'safety mechanism (Rule 11), so the mutation is refused instead.';

/**
 * LANE A · WRITE A DECISION THAT ACCOMPANIES A COMMITTED MUTATION, ON THE
 * CALLER'S OWN TRANSACTION, BEFORE ITS COMMIT.
 *
 * The row and the plan change become durable in the same commit or neither
 * does. There is no interval in which one exists and the other does not, so
 * there is nothing to reconcile, no outbox to drain and no window for a process
 * to die in.
 *
 * Three outcomes, and the caller must branch on all three:
 *
 *   written      · commit. The plan change and its record land together.
 *   table_absent · commit. Migration 166 is not applied on this database, which
 *                  is a declared state and not a ledger failure. The caller
 *                  says so out loud; it does not pretend a row was written.
 *   duplicate    · ROLL BACK. `onceOnly` only. This idempotency key already
 *                  carries a row, so this mutation has already been applied.
 *
 * Anything else throws, and a throw inside an open transaction is already
 * fatal to it — Postgres puts the transaction in the aborted state, so a
 * subsequent COMMIT is a ROLLBACK whether the caller cooperates or not. The
 * caller cooperating is what turns that into an honest returned outcome rather
 * than a silent no-op.
 */
export async function recordDecisionInTransaction(
  tx: LedgerExecutor,
  entry: LedgerEntry,
  opts: { onceOnly?: boolean } = {},
): Promise<LedgerTxWrite> {
  const onceOnly = opts.onceOnly === true;
  if (onceOnly && (entry.idempotencyKey == null || entry.idempotencyKey.length === 0)) {
    throw new Error(
      'exactly-once application was requested with no idempotency key. The unique index is '
      + 'PARTIAL over a non-null key, so without one there is nothing for a second attempt to '
      + 'collide with and the guarantee would be a comment rather than a constraint.',
    );
  }
  const probe = await ledgerTableExistsInTransaction(tx);
  if (probe === 'absent') {
    if (onceOnly) throw new Error(LEDGER_ONCE_WITHOUT_TABLE);
    return { state: 'table_absent', why: ABSENT_WHY };
  }
  const r = await tx.query<{ id: string }>(ledgerInsertSql(onceOnly), ledgerInsertParams(entry));
  const id = r.rows[0]?.id;
  if (!id) {
    if (onceOnly) {
      return {
        state: 'duplicate',
        why: `a decision with idempotency key '${entry.idempotencyKey}' from '${entry.provenance}' `
          + 'is already recorded for this runner, so this is a repeat of a mutation that has '
          + 'already been applied. Nothing was written a second time.',
      };
    }
    // Not reachable through DO UPDATE, which always returns the row it touched.
    // Reaching it means the statement's shape changed underneath this function,
    // and proceeding to COMMIT on that basis is exactly the loss this lane
    // exists to make impossible.
    throw new Error(
      'the ledger insert returned no id and this was not an exactly-once write, so whether the '
      + 'decision was recorded is unknown. The mutation must not commit on an unknown.',
    );
  }
  return { state: 'written', id };
}

/**
 * A decision that a later one replaced. Never a rewrite of what it said.
 *
 * The `superseded_at IS NULL` guard means a second pass is a no-op rather than
 * a re-pointing: the FIRST thing that superseded a decision is the fact worth
 * keeping, and overwriting it would lose the order the chain happened in.
 */
export async function markSuperseded(
  id: string,
  supersededBy: string,
): Promise<{ ok: boolean; why: string }> {
  const probe = await ledgerTableExists();
  if (probe !== 'present') {
    return { ok: false, why: probe === null ? PROBE_FAILED_WHY : ABSENT_WHY };
  }
  try {
    const r = await pool.query(
      `UPDATE plan_decision_ledger
          SET superseded_by = $2::uuid, superseded_at = now()
        WHERE id = $1::uuid AND superseded_at IS NULL`,
      [id, supersededBy],
    );
    return r.rowCount === 1
      ? { ok: true, why: 'superseded' }
      : { ok: false, why: 'no live row for that id — it was already superseded, or never existed' };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

/** A decision the runner or the engine reversed. The reason is required by the
 *  table's own CHECK, so a reasonless undo cannot be written from anywhere. */
export async function markUndone(
  id: string,
  reason: string,
): Promise<{ ok: boolean; why: string }> {
  const probe = await ledgerTableExists();
  if (probe !== 'present') {
    return { ok: false, why: probe === null ? PROBE_FAILED_WHY : ABSENT_WHY };
  }
  if (reason.trim().length === 0) {
    return { ok: false, why: 'an undo states a reason; the table refuses one without' };
  }
  try {
    const r = await pool.query(
      `UPDATE plan_decision_ledger
          SET undone_at = now(), undo_reason = $2
        WHERE id = $1::uuid AND undone_at IS NULL`,
      [id, reason],
    );
    return r.rowCount === 1
      ? { ok: true, why: 'undone' }
      : { ok: false, why: 'no live row for that id — it was already undone, or never existed' };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * LANE A's undo · the stamp on the SAME transaction that reverses the plan.
 *
 * An undo is two facts that must not come apart: the plan goes back, and the
 * decision that moved it is marked reversed. Written on separate connections
 * they can, and the two halves fail in opposite directions — a plan reverted
 * with its decision still reading live, or a decision marked undone over a plan
 * that never moved back. Both are worse than either change alone.
 *
 * THROWS when the row is not there to undo, or has already been undone. That is
 * not pedantry: a reversal that reverses nothing means the caller is undoing a
 * decision it has misidentified, and committing the plan change on that basis
 * would put a reversal in the ledger against the wrong row.
 */
export async function markUndoneInTransaction(
  tx: LedgerExecutor,
  id: string,
  reason: string,
): Promise<void> {
  if (reason.trim().length === 0) {
    throw new Error('an undo states a reason; the table refuses one without');
  }
  const probe = await ledgerTableExistsInTransaction(tx);
  if (probe === 'absent') {
    throw new Error(
      `an undo was requested against ${PLAN_DECISION_LEDGER_TABLE}, which does not exist on this `
      + 'database. Migration 166 has not been applied here, so there is no row to mark reversed '
      + 'and the plan change that would have accompanied it must not commit alone.',
    );
  }
  const r = await tx.query(
    `UPDATE plan_decision_ledger
        SET undone_at = now(), undo_reason = $2
      WHERE id = $1::uuid AND undone_at IS NULL`,
    [id, reason],
  );
  if (r.rowCount !== 1) {
    throw new Error(
      `no live ledger row for id ${id} — it was already undone, or never existed. The plan `
      + 'reversal that would have accompanied this stamp has been rolled back with it.',
    );
  }
}

/**
 * UNDOTRACK-1 (2026-09-09) · the row a per-workout undo must stamp.
 *
 * `markUndoneInTransaction` was fully built, unit-tested, and wired through
 * `mutate.ts`'s `ledger.undoes` option since migration 166 — and had exactly
 * one caller anywhere in the codebase before this: `mutate.ts` itself,
 * defining the plumbing. No production write site ever populated
 * `ledger.undoes`, `lib/brain/proposal/undo-apply.ts` (the ONLY production
 * per-workout undo path — confirmed by tracing `POST
 * /api/plan/workout-proposals/[id]/undo` end to end) included. Every
 * accept-then-undo round trip left the original `ACCEPTED` row live forever,
 * which is what let `directionCensus()` (Rule 21's own push-count metric)
 * keep counting a reversed decision as a standing push.
 *
 * This is the lookup `applyUndo` needs before it can populate `undoes`: the
 * live (`undone_at IS NULL`) `ACCEPTED` row `accept.ts` wrote for this exact
 * proposal. `rowOrNull` keeps the three Rule 11 facts apart for the caller —
 * a row (undo it), `undefined` (genuinely no accepted ledger row for this
 * proposal — e.g. it was accepted before migration 166 landed, or the ledger
 * was down at accept time; the undo still proceeds, just without a ledger
 * row to stamp, exactly as it always has for that case), and `null` (the
 * lookup itself failed — already logged by `rowOrNull`, and `applyUndo`
 * proceeds the same as the `undefined` case rather than blocking a reversal
 * the runner asked for on a read this file cannot make more reliable than
 * the write it precedes).
 */
export async function findLiveAcceptedLedgerRow(
  userUuid: string,
  proposalId: string,
): Promise<{ id: string } | null | undefined> {
  const probe = await ledgerTableExists();
  // 'absent' is genuine absence (no table → no accepted row can exist);
  // `null` (the probe itself failed) is a genuine failure, not the same fact.
  if (probe === 'absent') return undefined;
  if (probe === null) return null;
  return rowOrNull<{ id: string }>(
    'brain/ledger.findLiveAcceptedLedgerRow',
    pool.query<{ id: string }>(
      `SELECT id::text AS id
         FROM plan_decision_ledger
        WHERE user_uuid = $1::uuid AND proposal_id = $2
          AND runner_response = 'ACCEPTED' AND undone_at IS NULL
        ORDER BY at DESC LIMIT 1`,
      [userUuid, proposalId],
    ),
  );
}

/**
 * The runner's answer to a proposal.
 *
 * Guarded on `runner_response = 'PENDING'`, so an accept cannot overwrite a
 * decline and an expiry cannot overwrite either. A proposal is answered once.
 */
export async function recordRunnerResponse(
  id: string,
  response: Exclude<LedgerRunnerResponse, 'PENDING'>,
): Promise<{ ok: boolean; why: string }> {
  const probe = await ledgerTableExists();
  if (probe !== 'present') {
    return { ok: false, why: probe === null ? PROBE_FAILED_WHY : ABSENT_WHY };
  }
  try {
    const r = await pool.query(
      `UPDATE plan_decision_ledger
          SET runner_response = $2, responded_at = now()
        WHERE id = $1::uuid AND runner_response = 'PENDING'`,
      [id, response],
    );
    return r.rowCount === 1
      ? { ok: true, why: `recorded ${response}` }
      : { ok: false, why: 'no pending proposal for that id — it was already answered' };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * THE RUNNER'S RECENT COACHING HISTORY, AS THE LEDGER HOLDS IT.
 *
 * Rule 14 · the population is stated: this runner by uuid, newest first. NOT
 * scoped to the current plan, deliberately — the whole point of
 * `plan_lineage_id` is that a rebuild does not end a runner's history, and a
 * reader scoped to the current plan would reintroduce exactly the amnesia
 * `training_plans.adaptation_log` already suffers.
 *
 * The columns it reads are the ones a person needs to judge a decision without
 * opening the code: what happened (`explanation`), who did it (`provenance`),
 * and what it rested on (`evidence`).
 */
export interface LedgerRow {
  readonly id: string;
  readonly at: string;
  readonly planId: string | null;
  readonly planLineageId: string;
  readonly lever: string;
  readonly direction: LedgerDirection;
  readonly decision: string;
  readonly authority: string;
  readonly authorityVerdict: string;
  readonly mutationOutcome: string | null;
  readonly scope: string;
  readonly provenance: string;
  readonly explanation: string;
  readonly evidence: unknown;
  readonly modelVersion: string;
  readonly supersededAt: string | null;
  readonly undoneAt: string | null;
  readonly undoReason: string | null;
}

export type LedgerHistory =
  | { readonly state: 'read'; readonly rows: LedgerRow[] }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

export async function loadRecentDecisions(
  userUuid: string,
  limit = 50,
): Promise<LedgerHistory> {
  const probe = await ledgerTableExists();
  if (probe === null) return { state: 'failed', why: PROBE_FAILED_WHY };
  if (probe === 'absent') return { state: 'table_absent', why: ABSENT_WHY };
  try {
    const r = await pool.query<{
      id: string; at: string; plan_id: string | null; plan_lineage_id: string;
      lever: string; direction: string; decision: string;
      authority: string; authority_verdict: string; mutation_outcome: string | null;
      scope: string; provenance: string; explanation: string; evidence: unknown;
      model_version: string; superseded_at: string | null;
      undone_at: string | null; undo_reason: string | null;
    }>(
      `SELECT id::text AS id, at::text AS at, plan_id, plan_lineage_id,
              lever, direction, decision,
              authority, authority_verdict, mutation_outcome,
              scope, provenance, explanation, evidence, model_version,
              superseded_at::text AS superseded_at,
              undone_at::text AS undone_at, undo_reason
         FROM plan_decision_ledger
        WHERE user_uuid = $1::uuid
        ORDER BY at DESC
        LIMIT $2`,
      [userUuid, limit],
    );
    return {
      state: 'read',
      rows: r.rows.map((row) => ({
        id: row.id,
        at: row.at,
        planId: row.plan_id,
        planLineageId: row.plan_lineage_id,
        lever: row.lever,
        direction: row.direction as LedgerDirection,
        decision: row.decision,
        authority: row.authority,
        authorityVerdict: row.authority_verdict,
        mutationOutcome: row.mutation_outcome,
        scope: row.scope,
        provenance: row.provenance,
        explanation: row.explanation,
        evidence: row.evidence,
        modelVersion: row.model_version,
        supersededAt: row.superseded_at,
        undoneAt: row.undone_at,
        undoReason: row.undo_reason,
      })),
    };
  } catch (e) {
    return {
      state: 'failed',
      why: `reading the decision ledger failed: ${e instanceof Error ? e.message : String(e)}. `
        + 'That is not an empty history.',
    };
  }
}

/**
 * RULE 21'S CENSUS, from the engine's own log, in one query.
 *
 *     "The number of UPWARD adaptations is ZERO ... establishing the zero
 *      required querying `coach_intents` sideways."
 *
 * Undone rows are excluded: a decision that was reversed did not push the
 * runner, and counting it as an upward adaptation would be the flattering
 * reading of the exact number this exists to keep honest.
 *
 * Rule 11 · the return is a Measured-shaped three-state, not a zeroed record.
 * A census of zero because the table is absent and a census of zero because the
 * engine has never pushed are OPPOSITE FACTS, and the second is the finding.
 */
export type DirectionCensus =
  | { readonly state: 'measured'; readonly counts: Record<LedgerDirection, number> }
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

export async function directionCensus(userUuid: string): Promise<DirectionCensus> {
  const probe = await ledgerTableExists();
  if (probe === null) return { state: 'failed', why: PROBE_FAILED_WHY };
  if (probe === 'absent') return { state: 'table_absent', why: ABSENT_WHY };
  try {
    const r = await pool.query<{ direction: string; n: string }>(
      `SELECT direction, count(*)::text AS n
         FROM plan_decision_ledger
        WHERE user_uuid = $1::uuid AND undone_at IS NULL
        GROUP BY direction`,
      [userUuid],
    );
    const counts: Record<LedgerDirection, number> = { UP: 0, DOWN: 0, NEUTRAL: 0, UNKNOWN: 0 };
    for (const row of r.rows) {
      if (row.direction in counts) counts[row.direction as LedgerDirection] = Number(row.n);
    }
    return { state: 'measured', counts };
  } catch (e) {
    return {
      state: 'failed',
      why: `the census read failed: ${e instanceof Error ? e.message : String(e)}. `
        + 'That is not a census of zero.',
    };
  }
}
