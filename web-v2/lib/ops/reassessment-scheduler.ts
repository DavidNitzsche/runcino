/**
 * lib/ops/reassessment-scheduler.ts · THE ONE DURABLE SCHEDULER, AND THE
 * PLACE EVERY PROMISE THE ENGINE MAKES IS KEPT.
 *
 * Seven kinds of promise, one table (`reassessment_schedule`, migration 167):
 * a deferral, an earning gate, a conditional dose, a post-race recovery check,
 * a return-to-training stage, a proposal expiration, and a failed evaluation
 * that must be retried.
 *
 * Before this, the only one of the seven that survived a process was the
 * deferral, and only on a scratch database. The rest were `reconsiderAtISO`
 * fields on in-memory objects — a PROMISE NOTHING KEPT, in
 * `deferral-queue.ts`'s own words about the shape it replaced: "the next
 * evaluation started from scratch, and whether the deferred change ever
 * happened depended entirely on the same evidence happening to clear the same
 * bars again."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLAUDE.md RULE 23 IS THE GOVERNING RULE. HERE IS EACH CLAUSE, AND WHERE IT
 * IS ACTUALLY IMPLEMENTED — not where it is intended.
 *
 * 1 · "A job guarantees its own preconditions."
 *
 *     `sweepReassessments` assumes NOTHING about any other job having run. It
 *     reads the table, it computes due-ness from a date it is given, and every
 *     item states its OWN `requiredEvidence` which its evaluator re-derives at
 *     assessment time. Where it cannot ensure a precondition — the table not
 *     existing on this database — it REFUSES LOUDLY and says which, rather
 *     than returning an empty sweep that looks exactly like a healthy one.
 *
 * 2 · "Lateness must be harmless."
 *
 *     Due-ness is `assess_on_iso <= today`. Never a clock hour, never "the
 *     hour after the other job". A sweep that runs twelve hours late — which,
 *     measured, is the normal case for this repo's GitHub Actions cron — sees
 *     exactly the same due set and does exactly the same thing. A sweep that
 *     runs twice does the work once, because the live identity is unique on
 *     `(user_uuid, kind, idempotency_key)` and every transition is guarded on
 *     the state it is transitioning FROM.
 *
 * 3 · "A job that does not run must be NOTICED."
 *
 *     Two independent halves, because either alone has a hole:
 *
 *       · THE SWEEP NOT RUNNING. It is not a new cron. It runs inside
 *         `/api/cron/run-adaptations`, which `lib/ops/cron-ledger.ts` already
 *         registers, already due-gates and already raises `cron_stale` for.
 *         That is a deliberate choice and it is cron-ledger's own argument,
 *         quoted from its `EXCLUDED_FROM_TICK` list: "another schedule is
 *         another thing that can silently stop firing."
 *       · AN ITEM NOT BEING ASSESSED. A sweep that runs and quietly leaves an
 *         item sitting past its date is the failure with the cron ledger green,
 *         so items carry `overdue_after_iso` and the sweep raises
 *         `reassessment_overdue` on `ops_alerts` for anything past it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A FAILED EVALUATION IS A STATE, NOT AN ABSENCE (Rule 11)
 *
 * `attempts`, `last_error`, `last_attempt_at` and `next_retry_at` exist because
 * an item never assessed, an item assessed and carried, and an item whose
 * assessment BROKE are three different facts. The third collapsing into the
 * first is exactly how a deferred progression disappears while every log says
 * the system is healthy — the failure this whole feature exists to prevent.
 *
 * Past `MAX_ATTEMPTS` an item becomes `FAILED`, which is terminal, carries its
 * last error by the table's own CHECK, and raises an alert. It does NOT
 * silently keep retrying forever and it does NOT silently vanish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DECIDES NOTHING. THIS IS A SCHEDULER, NOT AN ENGINE.
 *
 * Nothing in this file writes a plan row, and `AUTOMATIC_ADAPTATION_AUTHORITY`
 * is untouched. Promoting an item to DUE means "ask the question again against
 * fresh evidence"; it never means "apply what was queued". A queued mile is
 * re-offered, never auto-landed, for the reason `deferral-queue.ts` gives:
 * evidence moves, and the runner may have had a bad week since.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON
 *
 * · WHETHER AN ITEM SHOULD HAVE BEEN SCHEDULED AT ALL. Inherited from
 *   `deferral-queue.ts`'s own note: this file records what a caller decided and
 *   cannot tell a correctly-deferred progression from a wrongly-deferred one.
 * · WHETHER THE EVALUATOR ACTUALLY RE-ASKS THE QUESTION. The sweep promotes an
 *   item to DUE. Whether the owning engine then reads the due queue and answers
 *   is that engine's contract, not this one's.
 * · A ROW WRITTEN BY SOMETHING ELSE — a psql session, a future module.
 * · WHETHER MIGRATION 167 IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   The probe reports that state rather than throwing, so a green suite here
 *   says nothing at all about the live database (Rule 19).
 * · THE ALERT ACTUALLY REACHING A HUMAN. It lands on `ops_alerts`. Whether
 *   anybody reads `ops_alerts` is outside every check in this repo.
 */
import { pool } from '@/lib/db/pool';
import { raiseAlert } from '@/lib/ops/alerts';

export const REASSESSMENT_SCHEDULE_TABLE = 'reassessment_schedule';

/* ══════════════════════════════════════════════════════════════════════════
 * THE SEVEN KINDS · these mirror the CHECK constraint in migration 167 exactly,
 * and `_reassessment_scheduler.test.ts` asserts they still do.
 * ═══════════════════════════════════════════════════════════════════════ */

export type ReassessmentKind =
  /** A progression arbitration put off to the next valid boundary. */
  | 'DEFERRAL'
  /** A change the runner must demonstrate something before it is offered. */
  | 'EARNING_GATE'
  /** A dose that applies only while a condition holds. */
  | 'CONDITIONAL_DOSE'
  /** Is this runner ready to train normally again after a race. */
  | 'POST_RACE_RECOVERY_CHECK'
  /** The next rung of an injury or illness return ladder. */
  | 'RETURN_TO_TRAINING_STAGE'
  /** An unanswered proposal that must not stand forever. */
  | 'PROPOSAL_EXPIRATION'
  /** An assessment that broke and must be retried. */
  | 'FAILED_EVALUATION';

export const REASSESSMENT_KINDS: readonly ReassessmentKind[] = [
  'DEFERRAL', 'EARNING_GATE', 'CONDITIONAL_DOSE', 'POST_RACE_RECOVERY_CHECK',
  'RETURN_TO_TRAINING_STAGE', 'PROPOSAL_EXPIRATION', 'FAILED_EVALUATION',
];

export type ReassessmentStatus =
  | 'PENDING' | 'DUE' | 'RESOLVED' | 'EXPIRED' | 'FAILED' | 'ABANDONED';

export const LIVE_STATUSES: readonly ReassessmentStatus[] = ['PENDING', 'DUE'];
export const TERMINAL_STATUSES: readonly ReassessmentStatus[] =
  ['RESOLVED', 'EXPIRED', 'FAILED', 'ABANDONED'];

/**
 * How many times an assessment may break before the item is FAILED rather than
 * retried again.
 *
 * Five, not "forever". An item that has failed five times is not a transient
 * network blip and pretending otherwise is how a broken evaluator stays
 * invisible: the queue looks busy, nothing is wrong in any log, and the promise
 * is never kept. Five attempts under the backoff below spans roughly a day and
 * a half, which is longer than any outage this app has actually had.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Backoff before the next retry: 2^attempts hours, capped at a day.
 *
 * Capped, because an uncapped exponential is a silent disappearance with extra
 * steps — the eighth retry of a daily job is scheduled past the end of the
 * training block it belongs to.
 */
export function retryDelayMs(attempts: number): number {
  const hours = Math.min(2 ** Math.max(0, attempts), 24);
  return hours * 3600_000;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE ITEM
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ScheduledReassessment {
  readonly id: string;
  readonly userUuid: string;
  readonly kind: ReassessmentKind;

  /** Why it is queued: the code and the sentence a person would read. */
  readonly reasonCode: string;
  readonly reasonDetail: string;

  /** The date it is due. Due-ness is a DATE, so lateness is harmless. */
  readonly assessOnISO: string;
  /** Past this it is a defect rather than a queue. Null = no deadline. */
  readonly overdueAfterISO: string | null;

  /** What must be true before this can be answered. Re-derived, never assumed. */
  readonly requiredEvidence: readonly unknown[];
  /** What supported it when it was queued. */
  readonly evidence: readonly unknown[];
  readonly newestEvidenceISO: string | null;

  readonly planId: string | null;
  readonly planLineageId: string | null;
  readonly planVersion: string;
  readonly evidenceVersion: string | null;
  readonly modelVersion: string | null;

  readonly lever: string | null;
  readonly beforeValue: number | null;
  readonly proposedAfterValue: number | null;
  readonly magnitude: unknown | null;
  readonly payload: Record<string, unknown>;

  readonly status: ReassessmentStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly lastAttemptAt: string | null;
  readonly nextRetryAt: string | null;

  readonly resultingDecision: string | null;
  readonly resultingDecisionDetail: string | null;
  readonly resultingLedgerId: string | null;
  readonly resolvedAt: string | null;
  readonly originLedgerId: string | null;

  readonly idempotencyKey: string;
  readonly queuedAtISO: string;
}

/** What a caller supplies to queue one. Everything else has a default. */
export interface ScheduleRequest {
  readonly userUuid: string;
  readonly kind: ReassessmentKind;
  readonly reasonCode: string;
  readonly reasonDetail: string;
  readonly assessOnISO: string;
  readonly overdueAfterISO?: string | null;
  readonly requiredEvidence?: readonly unknown[];
  readonly evidence?: readonly unknown[];
  readonly newestEvidenceISO?: string | null;
  readonly planId?: string | null;
  readonly planLineageId?: string | null;
  readonly planVersion: string;
  readonly evidenceVersion?: string | null;
  readonly modelVersion?: string | null;
  readonly lever?: string | null;
  readonly beforeValue?: number | null;
  readonly proposedAfterValue?: number | null;
  readonly magnitude?: unknown | null;
  readonly payload?: Record<string, unknown>;
  readonly originLedgerId?: string | null;
  readonly idempotencyKey: string;
  readonly queuedAtISO: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 11 · EVERY READ AND EVERY WRITE HAS THREE ANSWERS
 * ═══════════════════════════════════════════════════════════════════════ */

export type SchedulerResult<T> =
  | { readonly state: 'ok'; readonly value: T }
  /** Migration 167 is not applied here. Not an empty queue, not an error. */
  | { readonly state: 'table_absent'; readonly why: string }
  /** The statement broke. Loud, and never collapsed into an empty queue. */
  | { readonly state: 'failed'; readonly why: string };

const ok = <T>(value: T): SchedulerResult<T> => ({ state: 'ok', value });

let tableExists: boolean | null = null;

async function scheduleTableExists(): Promise<boolean> {
  if (tableExists != null) return tableExists;
  try {
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.${REASSESSMENT_SCHEDULE_TABLE}')::text AS reg`,
    );
    tableExists = r.rows[0]?.reg != null;
  } catch {
    tableExists = false;
  }
  return tableExists;
}

export function _resetScheduleTableProbeForTests(): void {
  tableExists = null;
}

const ABSENT_WHY =
  `${REASSESSMENT_SCHEDULE_TABLE} does not exist on this database, so the schedule was `
  + 'computed and NOT persisted. Migration 167 has not been applied here. That is not an '
  + 'empty queue and it is not a successful write of nothing.';

const absent = <T>(): SchedulerResult<T> => ({ state: 'table_absent', why: ABSENT_WHY });
const broke = <T>(what: string, e: unknown): SchedulerResult<T> => ({
  state: 'failed',
  why: `${what}: ${e instanceof Error ? e.message : String(e)}. That is not an empty queue.`,
});

/* ══════════════════════════════════════════════════════════════════════════
 * READING
 * ═══════════════════════════════════════════════════════════════════════ */

const SELECT_COLUMNS = `
  id::text AS id, user_uuid::text AS user_uuid, kind,
  reason_code, reason_detail,
  assess_on_iso::text AS assess_on_iso, overdue_after_iso::text AS overdue_after_iso,
  required_evidence, evidence, newest_evidence_iso::text AS newest_evidence_iso,
  plan_id, plan_lineage_id, plan_version, evidence_version, model_version,
  lever, before_value::float8 AS before_value,
  proposed_after_value::float8 AS proposed_after_value, magnitude, payload,
  status, attempts,
  last_error, last_attempt_at::text AS last_attempt_at, next_retry_at::text AS next_retry_at,
  resulting_decision, resulting_decision_detail,
  resulting_ledger_id::text AS resulting_ledger_id, resolved_at::text AS resolved_at,
  origin_ledger_id::text AS origin_ledger_id,
  idempotency_key, queued_at_iso::text AS queued_at_iso`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToItem(r: any): ScheduledReassessment {
  return {
    id: r.id,
    userUuid: r.user_uuid,
    kind: r.kind as ReassessmentKind,
    reasonCode: r.reason_code,
    reasonDetail: r.reason_detail,
    assessOnISO: String(r.assess_on_iso).slice(0, 10),
    overdueAfterISO: r.overdue_after_iso ? String(r.overdue_after_iso).slice(0, 10) : null,
    requiredEvidence: r.required_evidence ?? [],
    evidence: r.evidence ?? [],
    newestEvidenceISO: r.newest_evidence_iso ? String(r.newest_evidence_iso).slice(0, 10) : null,
    planId: r.plan_id ?? null,
    planLineageId: r.plan_lineage_id ?? null,
    planVersion: r.plan_version,
    evidenceVersion: r.evidence_version ?? null,
    modelVersion: r.model_version ?? null,
    lever: r.lever ?? null,
    beforeValue: r.before_value ?? null,
    proposedAfterValue: r.proposed_after_value ?? null,
    magnitude: r.magnitude ?? null,
    payload: r.payload ?? {},
    status: r.status as ReassessmentStatus,
    attempts: Number(r.attempts ?? 0),
    lastError: r.last_error ?? null,
    lastAttemptAt: r.last_attempt_at ?? null,
    nextRetryAt: r.next_retry_at ?? null,
    resultingDecision: r.resulting_decision ?? null,
    resultingDecisionDetail: r.resulting_decision_detail ?? null,
    resultingLedgerId: r.resulting_ledger_id ?? null,
    resolvedAt: r.resolved_at ?? null,
    originLedgerId: r.origin_ledger_id ?? null,
    idempotencyKey: r.idempotency_key,
    queuedAtISO: String(r.queued_at_iso).slice(0, 10),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * ONE RUNNER'S LIVE QUEUE.
 *
 * Rule 14 · the population is stated: this user by uuid, live statuses only,
 * oldest assessment date first so a reader sees what is due next. Never "all
 * items" and never filtered on anything but the uuid and the status.
 */
export async function loadLiveQueue(
  userUuid: string,
  kind?: ReassessmentKind,
): Promise<SchedulerResult<ScheduledReassessment[]>> {
  if (!(await scheduleTableExists())) return absent();
  try {
    const r = await pool.query(
      `SELECT ${SELECT_COLUMNS}
         FROM reassessment_schedule
        WHERE user_uuid = $1::uuid
          AND status IN ('PENDING', 'DUE')
          AND ($2::text IS NULL OR kind = $2::text)
        ORDER BY assess_on_iso NULLS FIRST, queued_at_iso`,
      [userUuid, kind ?? null],
    );
    return ok(r.rows.map(rowToItem));
  } catch (e) {
    return broke('reading the reassessment queue failed', e);
  }
}

/**
 * EVERYTHING DUE, ACROSS EVERY RUNNER.
 *
 * `assess_on_iso <= today` and not held back by a retry backoff. The date is
 * passed in rather than read from the clock so the same sweep is reproducible
 * in a test and, more importantly, so lateness cannot change the answer.
 */
export async function loadDueItems(
  todayISO: string,
  limit = 500,
): Promise<SchedulerResult<ScheduledReassessment[]>> {
  if (!(await scheduleTableExists())) return absent();
  try {
    const r = await pool.query(
      `SELECT ${SELECT_COLUMNS}
         FROM reassessment_schedule
        WHERE status IN ('PENDING', 'DUE')
          AND assess_on_iso <= $1::date
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY assess_on_iso, user_uuid
        LIMIT $2`,
      [todayISO, limit],
    );
    return ok(r.rows.map(rowToItem));
  } catch (e) {
    return broke('reading the due set failed', e);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * WRITING · every transition is guarded on the state it moves FROM, so a
 * double sweep does the work once and a later pass can never quietly rewrite
 * an earlier answer.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Queue one item, or refresh the one already standing for its identity.
 *
 * ON CONFLICT is scoped to the PARTIAL unique index, so it collides with a LIVE
 * row and never with a terminal one — re-queueing an identity that was once
 * resolved inserts a NEW live row and leaves the resolution history intact.
 * (Migration 165's header argues this at length; 167 inherits the argument.)
 *
 * `attempts`, `last_error` and `next_retry_at` are deliberately NOT reset by a
 * refresh. A re-queue over the same identity is the same promise restated, and
 * zeroing its failure count would hide an evaluator that has been breaking on
 * it every night.
 */
export async function scheduleReassessment(
  req: ScheduleRequest,
): Promise<SchedulerResult<string>> {
  if (!(await scheduleTableExists())) return absent();
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO reassessment_schedule (
         user_uuid, kind, reason_code, reason_detail,
         assess_on_iso, overdue_after_iso,
         required_evidence, evidence, newest_evidence_iso,
         plan_id, plan_lineage_id, plan_version, evidence_version, model_version,
         lever, before_value, proposed_after_value, magnitude, payload,
         origin_ledger_id, idempotency_key, queued_at_iso
       ) VALUES (
         $1::uuid, $2, $3, $4,
         $5::date, $6::date,
         $7::jsonb, $8::jsonb, $9::date,
         $10, $11, $12, $13, $14,
         $15, $16, $17, $18::jsonb, $19::jsonb,
         $20::uuid, $21, $22::date
       )
       ON CONFLICT (user_uuid, kind, idempotency_key) WHERE status IN ('PENDING', 'DUE')
       DO UPDATE SET
         reason_code = EXCLUDED.reason_code,
         reason_detail = EXCLUDED.reason_detail,
         assess_on_iso = EXCLUDED.assess_on_iso,
         overdue_after_iso = EXCLUDED.overdue_after_iso,
         required_evidence = EXCLUDED.required_evidence,
         evidence = EXCLUDED.evidence,
         newest_evidence_iso = EXCLUDED.newest_evidence_iso,
         plan_id = EXCLUDED.plan_id,
         plan_lineage_id = EXCLUDED.plan_lineage_id,
         plan_version = EXCLUDED.plan_version,
         evidence_version = EXCLUDED.evidence_version,
         model_version = EXCLUDED.model_version,
         lever = EXCLUDED.lever,
         before_value = EXCLUDED.before_value,
         proposed_after_value = EXCLUDED.proposed_after_value,
         magnitude = EXCLUDED.magnitude,
         payload = EXCLUDED.payload,
         updated_at = now()
       RETURNING id::text AS id`,
      [
        req.userUuid, req.kind, req.reasonCode, req.reasonDetail,
        req.assessOnISO, req.overdueAfterISO ?? null,
        JSON.stringify(req.requiredEvidence ?? []), JSON.stringify(req.evidence ?? []),
        req.newestEvidenceISO ?? null,
        req.planId ?? null, req.planLineageId ?? null, req.planVersion,
        req.evidenceVersion ?? null, req.modelVersion ?? null,
        req.lever ?? null, req.beforeValue ?? null, req.proposedAfterValue ?? null,
        req.magnitude == null ? null : JSON.stringify(req.magnitude),
        JSON.stringify(req.payload ?? {}),
        req.originLedgerId ?? null, req.idempotencyKey, req.queuedAtISO,
      ],
    );
    const id = r.rows[0]?.id;
    if (!id) return { state: 'failed', why: 'the insert returned no id, so nothing is queued' };
    return ok(id);
  } catch (e) {
    return broke(`queueing a ${req.kind} failed`, e);
  }
}

/**
 * Retire one item with its stated outcome. NEVER a DELETE.
 *
 * The `status IN ('PENDING','DUE')` guard means resolving an already-resolved
 * item is a no-op rather than a rewrite of the first resolution — "retired
 * because the block ended" must not be quietly replaced by "retired because its
 * evidence went stale" on a later pass.
 */
export async function resolveReassessment(args: {
  id: string;
  status: 'RESOLVED' | 'EXPIRED' | 'FAILED' | 'ABANDONED';
  decision: string;
  detail: string;
  ledgerId?: string | null;
}): Promise<SchedulerResult<boolean>> {
  if (!(await scheduleTableExists())) return absent();
  if (args.detail.trim().length === 0) {
    return {
      state: 'failed',
      why: 'an item that leaves the queue states why; the table refuses one without a detail',
    };
  }
  try {
    const r = await pool.query(
      `UPDATE reassessment_schedule
          SET status = $2,
              resulting_decision = $3,
              resulting_decision_detail = $4,
              resulting_ledger_id = $5::uuid,
              resolved_at = now(),
              updated_at = now()
        WHERE id = $1::uuid AND status IN ('PENDING', 'DUE')`,
      [args.id, args.status, args.decision, args.detail, args.ledgerId ?? null],
    );
    return ok(r.rowCount === 1);
  } catch (e) {
    return broke('resolving a scheduled item failed', e);
  }
}

/** Promote a PENDING item whose date has arrived. Idempotent by its guard. */
export async function markDue(id: string): Promise<SchedulerResult<boolean>> {
  if (!(await scheduleTableExists())) return absent();
  try {
    const r = await pool.query(
      `UPDATE reassessment_schedule
          SET status = 'DUE', updated_at = now()
        WHERE id = $1::uuid AND status = 'PENDING'`,
      [id],
    );
    return ok(r.rowCount === 1);
  } catch (e) {
    return broke('promoting a scheduled item to due failed', e);
  }
}

/**
 * AN ASSESSMENT BROKE. Record it; do not lose it.
 *
 * Increments `attempts`, stores the error verbatim, and sets the next retry.
 * Past `MAX_ATTEMPTS` the item becomes FAILED — terminal, loud, and carrying
 * its error by the table's own CHECK — rather than retrying forever or
 * disappearing. The three outcomes are distinguishable by the caller, which is
 * the point: "retried", "given up on" and "nothing happened" are three facts.
 */
export async function recordAssessmentFailure(
  id: string,
  error: string,
): Promise<SchedulerResult<'retrying' | 'failed' | 'not_live'>> {
  if (!(await scheduleTableExists())) return absent();
  const message = error.trim().length > 0 ? error : 'the evaluator failed and reported no message';
  try {
    const cur = await pool.query<{ attempts: number }>(
      `SELECT attempts FROM reassessment_schedule
        WHERE id = $1::uuid AND status IN ('PENDING', 'DUE')`,
      [id],
    );
    const row = cur.rows[0];
    if (!row) return ok('not_live');
    const attempts = Number(row.attempts) + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE reassessment_schedule
            SET attempts = $2, last_error = $3, last_attempt_at = now(),
                next_retry_at = NULL,
                status = 'FAILED',
                resulting_decision = 'ASSESSMENT_FAILED',
                resulting_decision_detail = $4,
                resolved_at = now(), updated_at = now()
          WHERE id = $1::uuid AND status IN ('PENDING', 'DUE')`,
        [
          id, attempts, message,
          `assessment failed ${attempts} times, which is the retry budget. Last error: ${message}`,
        ],
      );
      return ok('failed');
    }

    await pool.query(
      `UPDATE reassessment_schedule
          SET attempts = $2, last_error = $3, last_attempt_at = now(),
              next_retry_at = now() + ($4::bigint * interval '1 millisecond'),
              updated_at = now()
        WHERE id = $1::uuid AND status IN ('PENDING', 'DUE')`,
      [id, attempts, message, String(retryDelayMs(attempts))],
    );
    return ok('retrying');
  } catch (e) {
    return broke('recording an assessment failure failed', e);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE SWEEP
 * ═══════════════════════════════════════════════════════════════════════ */

export interface SweepReport {
  /** How many items the sweep looked at. Zero is a measurement, not a skip. */
  readonly examined: number;
  readonly promoted: number;
  readonly expired: number;
  readonly overdue: number;
  /**
   * Non-null when NOTHING was attempted. The state a caller must be able to
   * tell apart from "nothing needed doing" (Rule 11).
   */
  readonly refusal: string | null;
  readonly detail: string;
}

/**
 * ONE PASS OVER THE DURABLE SCHEDULE.
 *
 * It does three things and decides nothing:
 *
 *   1 · promotes items whose date has arrived from PENDING to DUE, so the
 *       owning engine's next read finds them.
 *   2 · expires PROPOSAL_EXPIRATION items past their `overdue_after_iso`. A
 *       proposal that stands forever is a decision the runner never made being
 *       treated as one he did, which is the "forced goal decision" failure
 *       CLAUDE.md rules out. Only this kind is auto-expired: everything else
 *       past its deadline is a DEFECT to raise, not a promise to quietly drop.
 *   3 · raises `reassessment_overdue` for everything else past its deadline.
 *
 * Lateness is harmless (clause 2 of Rule 23): it takes `todayISO` and compares
 * dates, so the twelve-hours-late run this repo's cron actually produces does
 * exactly what the on-time run would have.
 */
export async function sweepReassessments(todayISO: string): Promise<SweepReport> {
  const due = await loadDueItems(todayISO);
  if (due.state !== 'ok') {
    // Rule 23 · ensure the precondition or REFUSE LOUDLY. An empty sweep and a
    // sweep that could not read are the same shape and opposite facts, and
    // reporting the second as the first is how this whole class of bug hides.
    return {
      examined: 0, promoted: 0, expired: 0, overdue: 0,
      refusal: due.state,
      detail: due.why,
    };
  }

  let promoted = 0;
  let expired = 0;
  let overdue = 0;
  const problems: string[] = [];

  for (const item of due.value) {
    const isOverdue = item.overdueAfterISO != null && item.overdueAfterISO < todayISO;

    if (isOverdue && item.kind === 'PROPOSAL_EXPIRATION') {
      const r = await resolveReassessment({
        id: item.id,
        status: 'EXPIRED',
        decision: 'PROPOSAL_EXPIRED_UNANSWERED',
        detail:
          `the proposal was raised on ${item.queuedAtISO} and had not been answered by `
          + `${item.overdueAfterISO}, so it no longer stands. It was not applied.`,
      });
      if (r.state === 'ok' && r.value) expired += 1;
      else if (r.state !== 'ok') problems.push(`expire ${item.id}: ${r.why}`);
      continue;
    }

    if (isOverdue) {
      overdue += 1;
      try {
        await raiseAlert({
          kind: 'reassessment_overdue',
          severity: 'warn',
          source: `reassessment-scheduler/${item.kind}`,
          message:
            `a ${item.kind} for this runner was due on ${item.assessOnISO} and is past its `
            + `deadline of ${item.overdueAfterISO}. It has been attempted ${item.attempts} `
            + `time(s)${item.lastError ? `; last error: ${item.lastError}` : ''}. `
            + `Reason it was queued: ${item.reasonDetail}`,
          metadata: {
            user_uuid: item.userUuid,
            item_id: item.id,
            kind: item.kind,
            reason_code: item.reasonCode,
            assess_on_iso: item.assessOnISO,
            overdue_after_iso: item.overdueAfterISO,
            attempts: item.attempts,
          },
        });
      } catch (e) {
        problems.push(`alert ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (item.status === 'PENDING') {
      const r = await markDue(item.id);
      if (r.state === 'ok' && r.value) promoted += 1;
      else if (r.state !== 'ok') problems.push(`promote ${item.id}: ${r.why}`);
    }
  }

  // A sweep that half-worked is a different fact from one that worked, and the
  // counts are the evidence for which. Two explicit returns rather than a
  // ternary, the same shape `persistQueueAtBoundary` already uses.
  if (problems.length > 0) {
    return {
      examined: due.value.length, promoted, expired, overdue,
      refusal: 'partial-failure',
      detail:
        `${promoted} promoted, ${expired} expired, ${overdue} overdue, with `
        + `${problems.length} failure(s): ${problems.join('; ')}`,
    };
  }
  return {
    examined: due.value.length, promoted, expired, overdue,
    refusal: null,
    detail: `${due.value.length} examined · ${promoted} promoted · ${expired} expired · `
      + `${overdue} overdue`,
  };
}
