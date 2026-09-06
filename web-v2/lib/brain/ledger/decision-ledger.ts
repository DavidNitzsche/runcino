/**
 * lib/brain/ledger/decision-ledger.ts · THE ONE WRITE PATH INTO
 * `plan_decision_ledger`.
 *
 * `ledger-entry.ts` is the policy — what a decision is, and how its direction is
 * MEASURED rather than declared. This file is the storage and contains no
 * policy of its own, in the same split `canonical-shadow/deferral-store.ts`
 * already uses against `canonical/deferral-queue.ts`.
 *
 * ── IT WRITES ON ITS OWN CONNECTION, ALWAYS ────────────────────────────────
 *
 * Never on the caller's transaction. `mutatePlan` rolls a rejected mutation
 * back, and a ledger row written inside that transaction would be rolled back
 * with it — so the ledger would record every decision EXCEPT the refusals,
 * which are the ones a reader most needs. `recordMutationOutcome` already made
 * this call for `plan_mutation_rejections` and the reasoning is identical.
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
 * · WHETHER THE DECISION WAS RIGHT, or whether the direction it carries is the
 *   coaching answer the runner needed.
 * · WHETHER MIGRATION 166 IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   The probe reports that state rather than throwing, so a green suite says
 *   nothing about the live database (Rule 19: green is not deployed).
 * · A ROW WRITTEN BY SOMETHING ELSE. Nothing else writes this table today; a
 *   psql session is outside any check here.
 */
import { pool } from '@/lib/db/pool';
import { attempt, rowOrNull } from '@/lib/db/read';
import type { LedgerDirection, LedgerEntry, LedgerRunnerResponse } from './ledger-entry';

export const PLAN_DECISION_LEDGER_TABLE = 'plan_decision_ledger';

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

const PROBE_FAILED_WHY =
  'the check for plan_decision_ledger could not be completed, so whether this decision was recorded is '
  + 'UNKNOWN. That is not the same as the migration not having been applied, and it is not a '
  + 'successful write of nothing.';

const ABSENT_WHY =
  `${PLAN_DECISION_LEDGER_TABLE} does not exist on this database, so the decision was made `
  + 'and NOT recorded. Migration 166 has not been applied here. That is not a successful write '
  + 'of nothing.';

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
}): Promise<string> {
  const known = async (planId: string): Promise<string | null> => {
    // A lineage lookup that could not run is not "no lineage on record".
    if ((await ledgerTableExists()) !== 'present') return null;
    // `rowOrNull` keeps the three states apart and LOGS a failure rather than
    // swallowing it (lib/db/read.ts). Both a failed read and a miss fall through
    // to the next rung, and that is the conservative direction on purpose: this
    // plan then opens a NEW lineage rather than silently joining the wrong one.
    // The distinction is preserved where it matters — in the log — because a
    // lineage that quietly restarts every night is a defect, and the log line is
    // how anyone would ever see it.
    const row = await rowOrNull<{ plan_lineage_id: string }>(
      'decision-ledger/lineage',
      pool.query<{ plan_lineage_id: string }>(
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
 * Write one decision.
 *
 * ON CONFLICT is scoped to the partial unique index over a non-null
 * `idempotency_key`, so a nightly pass that runs twice over unchanged evidence
 * refreshes its row instead of doubling the census. A row with no key is a
 * distinct event every time and never collides.
 */
export async function recordDecision(entry: LedgerEntry): Promise<LedgerWrite> {
  const probe = await ledgerTableExists();
  if (probe === null) return { state: 'failed', why: PROBE_FAILED_WHY };
  if (probe === 'absent') return { state: 'table_absent', why: ABSENT_WHY };
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO plan_decision_ledger (
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
         -- LEDGERRESPONDED-1 (2026-09-05) · responded_at is DERIVED FROM
         -- runner_response. It is not NULL.
         --
         -- It WAS the literal NULL, and the CHECK constraint
         -- plan_decision_ledger_response_is_timed says a settled response
         -- carries the moment it settled. So every row written with
         -- runnerResponse ACCEPTED was rejected by the database -- which is
         -- the whole runner-accept lane, the only lane that can currently
         -- produce an upward adaptation. mutatePlan logged
         -- "DECISION NOT RECORDED" to console.error and returned normally, so
         -- the plan mutated and the ledger stayed empty, silently.
         --
         -- That is Rule 21's own defect reproduced inside the mechanism built
         -- to end it: the census of upward adaptations would have read ZERO
         -- forever, and the reason would have been unfindable, because the
         -- rows were never there to explain it. Found by
         -- lib/brain/_threshold_round_trip.db.test.ts on its first end-to-end
         -- run. No per-stage suite could see it: the constraint and the writer
         -- are each correct alone and disagree only in composition.
         $20, $21, $22::jsonb, $23,
         CASE WHEN $23 IN ('ACCEPTED', 'DECLINED', 'EXPIRED') THEN now() ELSE NULL END,
         $24, $25::jsonb,
         $26, $27, $28
       )
       ON CONFLICT (user_uuid, provenance, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO UPDATE SET
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
         at = now()
       RETURNING id::text AS id`,
      [
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
      ],
    );
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
