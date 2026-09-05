/**
 * lib/adaptation/canonical-shadow/deferral-store.ts · A DEFERRED PROGRESSION
 * SURVIVES A PROCESS RESTART.
 *
 * `lib/adaptation/canonical/deferral-queue.ts` is the LEDGER'S ARITHMETIC —
 * pure, in memory, and honest in its own header about what that leaves open:
 *
 *     "The queue is pure and in memory: it holds nothing across a process.
 *      Persistence is proposed in `PERSISTENCE` below and is deliberately NOT
 *      implemented here, so a gate over this file proves the ledger's
 *      arithmetic and proves nothing whatsoever about durability across a
 *      deploy. That gap is real and is stated rather than implied."
 *
 * This file closes that gap. It is the ONLY thing that reads or writes
 * `canonical_adaptation_deferrals`, and it contains no policy: which items are
 * carried, which expire and why is entirely `reconsiderAtBoundary`'s answer,
 * and this file records it.
 *
 * ── STILL SHADOW-ONLY. THIS IS A LEDGER, NOT AN AUTHORITY ──────────────────
 *
 * Persisting a deferral does not make it applicable. Nothing in this file
 * writes a plan row, nothing reads this table to change training, and
 * `AUTOMATIC_ADAPTATION_AUTHORITY` is untouched. A queued item is never
 * auto-applied at its boundary — the queue's guarantee is that the QUESTION IS
 * ASKED AGAINST FRESH EVIDENCE rather than forgotten, which is precisely the
 * failure CLAUDE.md Rule 21 measured from the other end: 309 production
 * adaptations, zero upward.
 *
 * ── RULE 11 · THE READ HAS THREE ANSWERS AND SO DOES THIS FILE ─────────────
 *
 * `loadLiveQueue` returns a `Measured<QueuedDeferral[]>`:
 *
 *   READ    · these are the live items. An EMPTY array is a measured empty
 *             queue and is a different fact from the two below.
 *   ABSENT  · the table does not exist on this database (migration 165 is not
 *             applied). Not an error and not an empty queue.
 *   FAILED  · the read broke. Loud, and NOT collapsed into "no deferrals" —
 *             that collapse is exactly how a deferred progression would
 *             disappear while every log said the system was healthy, which is
 *             the whole failure this feature exists to prevent.
 *
 * The caller must not enqueue against a queue it could not read. Doing so
 * would write a "fresh" deferral over an identity whose live row it never saw,
 * and the honest posture is to skip the persistence step and say so.
 *
 * ── ROWS ARE NEVER DELETED ─────────────────────────────────────────────────
 *
 * An item leaving the queue is stamped `expired_at` + `expiry_reason` +
 * `expiry_detail`, which the table's own CHECK constraint requires together.
 * The live queue is `expired_at IS NULL`, and the unique index enforcing one
 * live item per identity is PARTIAL on that predicate, so the history
 * accumulates underneath instead of being overwritten by the next re-queue.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · WHETHER THE ITEM SHOULD HAVE BEEN QUEUED. Inherited from the queue's own
 *   Rule 22 note: this file records what arbitration decided and cannot tell a
 *   correctly-deferred progression from a wrongly-deferred one.
 * · A ROW WRITTEN BY SOMETHING ELSE. Nothing else writes this table today, and
 *   `_never_mutates_plan.test.ts` guard 1 keeps that true for this directory,
 *   but a psql session or a future module is outside any check here.
 * · WHETHER THE MIGRATION IS APPLIED TO PRODUCTION. It is not, deliberately.
 *   The table probe reports that state rather than failing, so a green suite
 *   here says nothing about whether a deferral would actually persist on the
 *   live database (Rule 19: green is not deployed).
 */
import type {
  ExpiredDeferral,
  QueuedDeferral,
} from '@/lib/adaptation/canonical/deferral-queue';
import type { CanonicalLever, Measured } from '@/lib/adaptation/canonical/input';
import { roQuery } from './read-only-db';
import { writeDeferral, CANONICAL_ADAPTATION_DEFERRALS_TABLE } from './deferral-writer';

/* `measured` / `absent` / `failed` are re-declared here rather than imported
 * from the engine. They are three-line tagged-union constructors, and
 * importing them would need a fourth entry on `_cannot_mutate.test.ts` guard
 * 4's allowlist for a file whose whole job is writing a table — a grant a
 * reviewer would have to think about, bought for nothing. The TYPE is
 * imported, so the shape cannot drift. */
const ok = <T>(value: T): Measured<T> => ({ ok: true, value });
const noTable = <T>(what: string): Measured<T> => ({ ok: false, why: { kind: 'ABSENT', what } });
const broke = <T>(what: string): Measured<T> => ({ ok: false, why: { kind: 'FAILED', what } });

interface DeferralRow {
  plan_version: string;
  evidence_version: string;
  lever: string;
  before_value: string | number;
  proposed_after_value: string | number;
  magnitude: QueuedDeferral['magnitude'];
  evidence: QueuedDeferral['evidence'];
  newest_evidence_iso: string | null;
  reason: string;
  reason_detail: string;
  queued_at_iso: string;
  next_boundary_iso: string | null;
  idempotency_key: string;
}

let tableExists: boolean | null = null;

/** Probed once per process, mirroring `run-live-shadow-evaluation.ts`'s own
 *  posture for the shadow log. */
async function deferralTableExists(): Promise<boolean> {
  if (tableExists != null) return tableExists;
  try {
    const r = await roQuery<{ reg: string | null }>(
      `SELECT to_regclass('public.${CANONICAL_ADAPTATION_DEFERRALS_TABLE}')::text AS reg`,
    );
    tableExists = r.rows[0]?.reg != null;
  } catch {
    tableExists = false;
  }
  return tableExists;
}

/** Test-only reset, mirroring `_resetTableProbeForTests` next door. */
export function _resetDeferralTableProbeForTests(): void {
  tableExists = null;
}

const asNum = (v: string | number): number => (typeof v === 'number' ? v : Number(v));
const asDate = (v: string | null): string | null => (v === null ? null : v.slice(0, 10));

/** Rows are stored flat; the queue reads a `QueuedDeferral`. One mapping. */
function rowToItem(athleteId: string, r: DeferralRow): QueuedDeferral {
  return {
    queueId: `${athleteId} · ${r.lever} · ${r.idempotency_key}`,
    athleteId,
    planVersion: r.plan_version,
    evidenceVersion: r.evidence_version,
    lever: r.lever as CanonicalLever,
    beforeValue: asNum(r.before_value),
    proposedAfterValue: asNum(r.proposed_after_value),
    magnitude: r.magnitude,
    evidence: r.evidence,
    newestEvidenceISO: asDate(r.newest_evidence_iso),
    reason: r.reason as QueuedDeferral['reason'],
    reasonDetail: r.reason_detail,
    queuedAtISO: r.queued_at_iso.slice(0, 10),
    nextBoundaryISO: asDate(r.next_boundary_iso),
    idempotencyKey: r.idempotency_key,
  };
}

/**
 * THIS ATHLETE'S LIVE QUEUE.
 *
 * Rule 14 · the population is stated: this user by uuid, live rows only
 * (`expired_at IS NULL`), oldest boundary first so a reader sees what is due
 * next. Never "all deferrals" and never filtered on anything but the uuid.
 */
export async function loadLiveQueue(userUuid: string): Promise<Measured<QueuedDeferral[]>> {
  if (!(await deferralTableExists())) {
    return noTable(
      `${CANONICAL_ADAPTATION_DEFERRALS_TABLE} does not exist on this database, so no queue `
      + 'could be read. Migration 165 has not been applied here. That is not an empty queue.',
    );
  }
  // The table name is written LITERALLY in the SELECT below rather than through
  // the constant, for the same reason `run-live-shadow-evaluation.ts` writes
  // its INSERT literally: the source scanners — `writesIn`, and
  // `_generated_content_gate.test.ts`'s reader discovery — read SOURCE TEXT and
  // cannot see through a template interpolation. An interpolated name makes
  // this layer's only read of its own authored columns invisible to the gate
  // that exists to notice unread authored content. The assertion keeps the
  // literal from drifting away from the constant the writer is fenced to.
  if (CANONICAL_ADAPTATION_DEFERRALS_TABLE !== 'canonical_adaptation_deferrals') {
    throw new Error(
      'CANONICAL_ADAPTATION_DEFERRALS_TABLE no longer matches the literal table name in this '
      + 'SELECT — keep them in sync, never edit just one of the two.',
    );
  }
  try {
    const r = await roQuery<DeferralRow>(
      `SELECT plan_version, evidence_version, lever,
              before_value, proposed_after_value, magnitude,
              evidence, newest_evidence_iso::text AS newest_evidence_iso,
              reason, reason_detail,
              queued_at_iso::text AS queued_at_iso,
              next_boundary_iso::text AS next_boundary_iso,
              idempotency_key
         FROM canonical_adaptation_deferrals
        WHERE user_uuid = $1::uuid
          AND expired_at IS NULL
        ORDER BY next_boundary_iso NULLS FIRST, queued_at_iso`,
      [userUuid],
    );
    return ok(r.rows.map((row) => rowToItem(userUuid, row)));
  } catch (e) {
    return broke(
      `reading the deferral queue failed: ${e instanceof Error ? e.message : String(e)}. `
      + 'That is not the same as having no deferrals, and nothing was enqueued on the '
      + 'strength of it.',
    );
  }
}

/**
 * Write one item into the live queue, or refresh the row already standing for
 * its identity.
 *
 * ON CONFLICT is scoped to the PARTIAL unique index, so it collides with a
 * LIVE row and never with an expired one — re-queueing an identity that was
 * once retired inserts a new live row and leaves the expiry history intact.
 */
export async function upsertDeferral(userUuid: string, item: QueuedDeferral): Promise<void> {
  await writeDeferral(
    `INSERT INTO canonical_adaptation_deferrals (
       user_uuid, plan_version, evidence_version, lever,
       before_value, proposed_after_value, magnitude,
       evidence, newest_evidence_iso,
       reason, reason_detail, queued_at_iso, next_boundary_iso, idempotency_key
     ) VALUES (
       $1::uuid, $2, $3, $4,
       $5, $6, $7::jsonb,
       $8::jsonb, $9::date,
       $10, $11, $12::date, $13::date, $14
     )
     ON CONFLICT (user_uuid, lever, idempotency_key) WHERE expired_at IS NULL
     DO UPDATE SET
       plan_version = EXCLUDED.plan_version,
       evidence_version = EXCLUDED.evidence_version,
       before_value = EXCLUDED.before_value,
       proposed_after_value = EXCLUDED.proposed_after_value,
       magnitude = EXCLUDED.magnitude,
       evidence = EXCLUDED.evidence,
       newest_evidence_iso = EXCLUDED.newest_evidence_iso,
       reason = EXCLUDED.reason,
       reason_detail = EXCLUDED.reason_detail,
       next_boundary_iso = EXCLUDED.next_boundary_iso,
       updated_at = now()`,
    [
      userUuid, item.planVersion, item.evidenceVersion, item.lever,
      item.beforeValue, item.proposedAfterValue, JSON.stringify(item.magnitude),
      JSON.stringify(item.evidence), item.newestEvidenceISO,
      item.reason, item.reasonDetail, item.queuedAtISO, item.nextBoundaryISO,
      item.idempotencyKey,
    ],
  );
}

/**
 * Retire one item, with its stated reason. Never a DELETE.
 *
 * The WHERE clause carries `expired_at IS NULL` so retiring an already-retired
 * item is a no-op rather than a rewrite of the first expiry — "it was retired
 * when the block ended" must not be quietly replaced by "it was retired
 * because its evidence went stale" on a later pass.
 */
export async function expireDeferral(userUuid: string, ex: ExpiredDeferral): Promise<void> {
  await writeDeferral(
    `UPDATE canonical_adaptation_deferrals
        SET expired_at = now(),
            expiry_reason = $4,
            expiry_detail = $5,
            updated_at = now()
      WHERE user_uuid = $1::uuid
        AND lever = $2
        AND idempotency_key = $3
        AND expired_at IS NULL`,
    [userUuid, ex.item.lever, ex.item.idempotencyKey, ex.expiry, ex.detail],
  );
}

/**
 * What one boundary did to the durable queue.
 *
 * `written` and `retired` are counts of rows actually changed; `refusal` is
 * non-null when NOTHING was attempted, which is the state a caller must be
 * able to tell apart from "nothing needed doing" (Rule 11).
 */
export interface DeferralPersistenceResult {
  readonly written: number;
  readonly retired: number;
  readonly refusal: string | null;
  readonly detail: string;
}

/**
 * Persist one boundary's outcome: retire what expired, then write what stands.
 *
 * ORDER MATTERS AND IS DELIBERATE. Expiries go first, so an item that expired
 * and was immediately re-queued on fresher evidence — the SUPERSEDED case,
 * which is the common one — frees its live identity before the new row claims
 * it. Writing first would collide with the row about to be retired.
 */
export async function persistQueueAtBoundary(
  userUuid: string,
  outcome: { carried: readonly QueuedDeferral[]; expired: readonly ExpiredDeferral[] },
): Promise<DeferralPersistenceResult> {
  if (!(await deferralTableExists())) {
    return {
      written: 0, retired: 0,
      refusal: 'table-absent',
      detail:
        `${CANONICAL_ADAPTATION_DEFERRALS_TABLE} does not exist on this database (migration `
        + '165 not applied here), so the queue was computed but not persisted. It is in '
        + 'memory only for this process, exactly as it was before this feature landed.',
    };
  }
  let retired = 0;
  let written = 0;
  const problems: string[] = [];

  for (const ex of outcome.expired) {
    try { await expireDeferral(userUuid, ex); retired += 1; } catch (e) {
      problems.push(`expire ${ex.item.lever}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const item of outcome.carried) {
    try { await upsertDeferral(userUuid, item); written += 1; } catch (e) {
      problems.push(`queue ${item.lever}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // NOT swallowed, and written as two explicit returns rather than a ternary
  // over `problems.length`. A queue that HALF-persisted is a different fact
  // from one that persisted, and the count is the evidence for which — exactly
  // the shape `check-coercion.sh` exists to keep out of a boundary, even where
  // the quantity is a failure count rather than a measurement of the runner.
  if (problems.length > 0) {
    return {
      written,
      retired,
      refusal: 'partial-failure',
      detail:
        `${retired} retired and ${written} queued, with ${problems.length} failure(s): `
        + problems.join('; '),
    };
  }
  return {
    written,
    retired,
    refusal: null,
    detail: `${retired} retired and ${written} queued.`,
  };
}
