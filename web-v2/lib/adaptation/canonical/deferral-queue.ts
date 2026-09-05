/**
 * lib/adaptation/canonical/deferral-queue.ts · A DEFERRED PROGRESSION STAYS
 * QUEUED. IT DOES NOT EVAPORATE.
 *
 * The owner's requirement, verbatim:
 *
 *     "A deferred progression must remain queued for the next valid boundary
 *      rather than disappearing."
 *
 * Before this file, arbitration produced a `SuppressionNote` carrying a
 * `reconsiderAtISO` and then the whole proposal was gone. The date was a
 * PROMISE nothing kept: the next evaluation started from scratch, and whether
 * the deferred change ever happened depended entirely on the same evidence
 * happening to clear the same bars again. That is the shape CLAUDE.md Rule 21
 * measured from the other end — 309 production intents, zero upward
 * adaptations — and it is why the queue is a ledger rather than a convenience.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 *
 * It is NOT a second engine and it never decides anything. A queued item is
 * never auto-applied at its boundary, because evidence moves: the runner may
 * have had a bad week, the anchor may already have moved for another reason,
 * the block may have ended. What the queue guarantees is that the proposal is
 * RECONSIDERED against fresh evidence rather than forgotten, and that if it
 * leaves the queue it leaves for a STATED reason that is written down.
 *
 * Three outcomes and no fourth:
 *
 *   CARRIED      · not yet due, or due and still supported. Stays queued.
 *   RECONSIDERED · a fresh evaluation of the same lever exists. The queued item
 *                  hands over to it and expires as SUPERSEDED. The fresh
 *                  proposal is the one that gets arbitrated; the queue's job
 *                  was to make sure the question was asked again.
 *   EXPIRED      · removed, with one of four named reasons and a sentence.
 *
 * ── RULE 11 · WHY "NO FRESH RECORD" IS NOT "NO LONGER SUPPORTED" ───────────
 *
 * A boundary at which the engine produced no record for a lever is not a
 * boundary at which the lever said no. It is a boundary at which nobody asked.
 * Those are different facts and the queue keeps them apart: an item with no
 * fresh record for its lever is CARRIED, never expired. Only a fresh record
 * that actually declines the change expires it, and only evidence that has
 * aged past the lever's own window expires it for staleness.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · WHETHER THE ITEM SHOULD HAVE BEEN QUEUED AT ALL. This file takes decision
 *   records as given. A record that was deferred for the wrong reason is
 *   queued faithfully and re-offered faithfully, and no test here can tell.
 * · WHETHER ANYONE CALLS IT. The queue is pure and in memory: it holds nothing
 *   across a process. Persistence is proposed in `PERSISTENCE` below and is
 *   deliberately NOT implemented here, so a gate over this file proves the
 *   ledger's arithmetic and proves nothing whatsoever about durability across
 *   a deploy. That gap is real and is stated rather than implied.
 * · THE STALENESS WINDOW BEING RIGHT. It reuses the threshold lever's own
 *   evidence window for every lever, which is a stated simplification below,
 *   not a doctrine claim.
 *
 * ── PERSISTENCE · THE PROPOSAL, NOT YET APPLIED ────────────────────────────
 *
 * Two existing homes were considered and both are wrong:
 *
 *   · `training_plans.adaptation_log` stores `{"n": 1, "ts": "..."}`. Rule 21
 *     names it directly: "a log that records that something happened but not
 *     what is not a log." It is also keyed to a plan row, and a queued
 *     deferral has to survive the plan being rebuilt in order to be worth
 *     anything — a rebuild is precisely when a deferred progression is most
 *     likely to be lost.
 *   · `coach_intents` is a RUNNER-FACING surface. A deferral is internal
 *     engine state, and writing one there would put a proposal the runner
 *     never asked for in front of the runner, which is the "forced goal
 *     decision" failure mode CLAUDE.md already rules out for a neighbouring
 *     mechanism.
 *
 * The right home is a table of its own, alongside the shadow log this engine
 * already writes: `canonical_adaptation_deferrals`, keyed on
 * (user_uuid, lever, idempotency_key), carrying the queued item's JSON, its
 * queued_at, its next_boundary_iso, and a nullable (expired_at, expiry_reason,
 * expiry_detail). Same shape, same discipline and the same read-only fences as
 * `lib/adaptation/canonical-shadow/shadow-log-writer.ts`.
 *
 * A migration file is written and DELIBERATELY LEFT UNAPPLIED at
 * `db/migrations/165_canonical_adaptation_deferrals.sql`. Nothing in this
 * repository runs it, nothing reads the table, and no DDL has been executed:
 * per CLAUDE.md's operational boundary, a data or schema write needs the
 * owner's explicit per-statement go. Until then this queue is in memory, which
 * is honest about what it is rather than pretending durability it does not
 * have.
 */
import { THRESHOLD_EVIDENCE_WINDOW_DAYS } from './contract-constants';
import type {
  CanonicalDecisionRecord,
  DeferralRule,
  IncludedEvidence,
  Magnitude,
} from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { CanonicalLever } from './input';
import { daysBetween } from './levers/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * THE QUEUED ITEM
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One deferred progression, carrying everything needed to re-ask the question
 * later without the original evaluation still being in memory.
 *
 * Rule 21: "every adaptation writes what it did, in which direction, and on
 * what evidence." A deferral is an adaptation that did not happen yet, and it
 * carries the same account for the same reason.
 */
export interface QueuedDeferral {
  /** `athlete · lever · idempotency key`. Stable across re-queues. */
  readonly queueId: string;
  readonly athleteId: string;
  readonly planVersion: string;
  readonly evidenceVersion: string;
  readonly lever: CanonicalLever;

  /** The proposal, exactly as the lever made it. */
  readonly beforeValue: number;
  readonly proposedAfterValue: number;
  readonly magnitude: Magnitude;

  /** The evidence that justified it, so a reader can judge it later. */
  readonly evidence: readonly IncludedEvidence[];
  /** The newest supporting observation. What staleness is measured from. */
  readonly newestEvidenceISO: string | null;

  /** Why it was deferred, as a code and as the sentence the runner would read. */
  readonly reason: DeferralRule;
  readonly reasonDetail: string;

  readonly queuedAtISO: string;
  /** The boundary at which it is due to be reconsidered. */
  readonly nextBoundaryISO: string | null;
  readonly idempotencyKey: string;
}

/** Why an item left the queue. Never "it just went away". */
export type DeferralExpiryReason =
  /** The newest supporting observation aged past the evidence window. */
  | 'EVIDENCE_WENT_STALE'
  /** A fresh evaluation of the same lever proposed at least as much. */
  | 'SUPERSEDED_BY_LARGER_PROPOSAL'
  /**
   * A fresh evaluation of the same lever still supports a change, but a
   * SMALLER one. Kept apart from the larger case on purpose: "the evidence
   * grew" and "the evidence softened" are two different facts about the runner
   * and collapsing them would lose the one worth reading (Rule 11's shape,
   * applied to an expiry reason rather than to an input).
   */
  | 'SUPERSEDED_BY_A_SMALLER_PROPOSAL'
  /** A fresh evaluation of the same lever no longer supports the change. */
  | 'FRESH_EVIDENCE_NO_LONGER_SUPPORTS_IT'
  /** The block this belonged to is over. A queued mile has nowhere to land. */
  | 'BLOCK_ENDED'
  /** The plan was rebuilt, so the before-value the proposal moved is gone. */
  | 'PLAN_VERSION_CHANGED';

export interface ExpiredDeferral {
  readonly item: QueuedDeferral;
  readonly expiredAtISO: string;
  readonly expiry: DeferralExpiryReason;
  readonly detail: string;
}

/**
 * Everything a boundary did to the queue. Returned rather than mutated, so a
 * caller cannot lose an expiry by forgetting to read one.
 */
export interface ReconsiderationResult {
  /** The queue after this boundary. */
  readonly carried: readonly QueuedDeferral[];
  /** Items removed, each with its stated reason. */
  readonly expired: readonly ExpiredDeferral[];
  /**
   * Items that were due at this boundary and were re-offered to the engine.
   * Every one of these appears in EITHER `carried` or `expired`; nothing is
   * only here.
   */
  readonly reconsidered: readonly QueuedDeferral[];
}

/**
 * How long a queued item's evidence stays worth re-offering.
 *
 * Reuses the threshold lever's own evidence window rather than inventing a
 * number, for every lever. That is a SIMPLIFICATION and is named as one: the
 * volume lever's window is three consecutive weeks and the long run's is its
 * two most recent, and neither is expressed in days. Twenty-eight days is the
 * longest window any lever in this engine looks back over, so an item older
 * than that cannot be supported by evidence any lever would still admit — which
 * makes this the conservative direction for a queue whose failure mode is
 * re-offering something stale.
 */
export const DEFERRAL_EVIDENCE_STALE_AFTER_DAYS = THRESHOLD_EVIDENCE_WINDOW_DAYS;

/* ══════════════════════════════════════════════════════════════════════════
 * ENQUEUE
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Deferrals that represent a real progression waiting for a boundary.
 *
 * `ALREADY_RAISED_ON_THIS_EVIDENCE` is deliberately NOT queued. It is not a
 * deferral at all: the proposal was already raised, and queueing it would raise
 * it a second time on the same evidence, which is precisely what the
 * idempotency key exists to prevent.
 */
const QUEUEABLE_REASONS: ReadonlySet<DeferralRule> = new Set<DeferralRule>([
  'WEEK_AT_DEMAND_CEILING',
  'ONE_MATERIAL_LEVER_PER_CYCLE',
  'ARBITRATED_AT_WEEKLY_BOUNDARY',
]);

export const queueIdFor = (athleteId: string, lever: CanonicalLever, key: string): string =>
  `${athleteId} · ${lever} · ${key}`;

/**
 * Turn one evaluation's records into queue entries.
 *
 * Only MOVING, SUPPRESSED records qualify: a HOLD proposed nothing, and an
 * unsuppressed proposal is being applied rather than deferred. An item already
 * in the queue for the same `queueId` is REPLACED by the fresher account rather
 * than duplicated, so re-evaluating the same evidence at successive boundaries
 * does not grow the queue.
 */
export function enqueueDeferrals(
  queue: readonly QueuedDeferral[],
  records: readonly CanonicalDecisionRecord[],
): readonly QueuedDeferral[] {
  const byId = new Map(queue.map((q) => [q.queueId, q]));

  for (const r of records) {
    const note = r.suppressedBy;
    if (note === null) continue;
    if (NON_MOVING_DECISIONS.has(r.decision)) continue;
    if (r.proposedAfterValue === null || r.magnitude === null) continue;
    if (!QUEUEABLE_REASONS.has(note.rule)) continue;

    const queueId = queueIdFor(r.athleteId, r.lever, r.idempotencyKey);
    byId.set(queueId, {
      queueId,
      athleteId: r.athleteId,
      planVersion: r.planVersion,
      evidenceVersion: r.evidenceVersion,
      lever: r.lever,
      beforeValue: r.beforeValue,
      proposedAfterValue: r.proposedAfterValue,
      magnitude: r.magnitude,
      evidence: r.evidenceIncluded,
      newestEvidenceISO: newestOf(r.evidenceIncluded),
      reason: note.rule,
      reasonDetail: note.detail,
      queuedAtISO: r.evaluatedAtISO.slice(0, 10),
      nextBoundaryISO: note.reconsiderAtISO,
      idempotencyKey: r.idempotencyKey,
    });
  }

  return [...byId.values()];
}

function newestOf(evidence: readonly IncludedEvidence[]): string | null {
  let newest: string | null = null;
  for (const e of evidence) {
    if (newest === null || e.dateISO > newest) newest = e.dateISO;
  }
  return newest;
}

/* ══════════════════════════════════════════════════════════════════════════
 * RECONSIDER
 * ═══════════════════════════════════════════════════════════════════════ */

export interface ReconsiderInput {
  readonly queue: readonly QueuedDeferral[];
  /** The boundary being evaluated. */
  readonly atISO: string;
  /**
   * The records this boundary's evaluation produced, if it has run. Empty when
   * nothing was evaluated, which per Rule 11 is "nobody asked", not "declined".
   */
  readonly freshRecords: readonly CanonicalDecisionRecord[];
  /** The plan version currently in force. A rebuild expires queued items. */
  readonly currentPlanVersion: string;
  /**
   * When the block a proposal belongs to has ended. Null when it has not. A
   * queued mile has nowhere to land once the block is over.
   */
  readonly blockEndedISO: string | null;
}

/**
 * Walk the queue at a boundary. Pure: the input queue is not modified.
 *
 * Order matters and is deliberate. Structural expiries (plan rebuilt, block
 * over) are checked before evidential ones, because a proposal against a plan
 * that no longer exists cannot be judged on evidence at all.
 */
export function reconsiderAtBoundary(input: ReconsiderInput): ReconsiderationResult {
  const carried: QueuedDeferral[] = [];
  const expired: ExpiredDeferral[] = [];
  const reconsidered: QueuedDeferral[] = [];
  const at = input.atISO.slice(0, 10);

  const freshByLever = new Map<CanonicalLever, CanonicalDecisionRecord>();
  for (const r of input.freshRecords) freshByLever.set(r.lever, r);

  for (const item of input.queue) {
    const expire = (expiry: DeferralExpiryReason, detail: string): void => {
      expired.push({ item, expiredAtISO: at, expiry, detail });
    };

    /* ── Structural · the thing the proposal was against is gone ─────────── */

    if (item.planVersion !== input.currentPlanVersion) {
      expire(
        'PLAN_VERSION_CHANGED',
        `The plan was rebuilt from ${item.planVersion} to ${input.currentPlanVersion}. `
        + `The ${item.beforeValue} this change moved from is no longer what is prescribed, so the `
        + 'proposal is retired rather than applied to a week it was never measured against.',
      );
      continue;
    }

    if (input.blockEndedISO !== null && at >= input.blockEndedISO.slice(0, 10)) {
      expire(
        'BLOCK_ENDED',
        `The block ended on ${input.blockEndedISO.slice(0, 10)}. A change queued for a later `
        + 'week in that block has nowhere left to land, so it is retired here rather than '
        + 'carried into a block it was not evidence for.',
      );
      continue;
    }

    /* ── Not due yet · carried untouched, and not reconsidered ───────────── */

    const due = item.nextBoundaryISO === null || at >= item.nextBoundaryISO.slice(0, 10);
    if (!due) {
      carried.push(item);
      continue;
    }

    reconsidered.push(item);

    /* ── Evidential · has the evidence aged out ──────────────────────────── */

    if (item.newestEvidenceISO !== null) {
      const age = daysBetween(at, item.newestEvidenceISO);
      if (age > DEFERRAL_EVIDENCE_STALE_AFTER_DAYS) {
        expire(
          'EVIDENCE_WENT_STALE',
          `The newest session supporting this change ran on ${item.newestEvidenceISO}, `
          + `${age} days ago, past the ${DEFERRAL_EVIDENCE_STALE_AFTER_DAYS}-day evidence window. `
          + 'It is retired rather than applied on training the engine would no longer admit.',
        );
        continue;
      }
    }

    /* ── Against fresh evidence · never auto-applied ─────────────────────── */

    const fresh = freshByLever.get(item.lever);
    if (fresh === undefined) {
      // Rule 11 · no record for this lever is "nobody asked", not "declined".
      carried.push(item);
      continue;
    }

    if (NON_MOVING_DECISIONS.has(fresh.decision) || fresh.proposedAfterValue === null) {
      expire(
        'FRESH_EVIDENCE_NO_LONGER_SUPPORTS_IT',
        `Re-asked at ${at}, the ${labelOf(item.lever)} lever returned ${fresh.decision}. `
        + 'The change was not applied on the strength of evidence that has since been '
        + 'superseded by a fresh look.',
      );
      continue;
    }

    // A fresh proposal exists. It is the one that gets arbitrated, so the queued
    // item hands over rather than competing with it. This is the case the
    // owner's requirement is really about: the question got asked again.
    //
    // Which way it moved is recorded, because "the evidence grew" and "the
    // evidence softened" are two different facts about the runner. Magnitudes
    // are compared by absolute size, since a faster threshold pace is a smaller
    // number of seconds while a longer run is a larger number of miles, and
    // both records are already known to point the direction their decision
    // names (`INV_DIRECTION_MATCHES_DECISION`).
    const freshMove = Math.abs(fresh.proposedAfterValue - fresh.beforeValue);
    const queuedMove = Math.abs(item.proposedAfterValue - item.beforeValue);
    const grew = freshMove >= queuedMove;
    expire(
      grew ? 'SUPERSEDED_BY_LARGER_PROPOSAL' : 'SUPERSEDED_BY_A_SMALLER_PROPOSAL',
      `Re-asked at ${at}, the ${labelOf(item.lever)} lever proposed `
      + `${fresh.proposedAfterValue} against this queued ${item.proposedAfterValue}. `
      + `The fresh proposal moves ${grew ? 'at least as far' : 'less far'} on current evidence, `
      + 'so it replaces the queued one and is arbitrated on its own account.',
    );
  }

  return { carried, expired, reconsidered };
}

function labelOf(l: CanonicalLever): string {
  if (l === 'THRESHOLD_PACE') return 'threshold pace';
  if (l === 'WEEKLY_VOLUME') return 'weekly volume';
  return 'long run';
}
