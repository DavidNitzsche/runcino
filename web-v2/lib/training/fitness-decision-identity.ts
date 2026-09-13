/**
 * lib/training/fitness-decision-identity.ts · PROPOSAL, NOT WIRED IN.
 *
 * WAVE 2, QUESTION 2 AND 3 · WHAT REPLACES `users.vdot_last_reviewed`'S
 * IDEMPOTENCY FUNCTION, AND HOW EVIDENCE IDENTITY STOPS A DETECTOR RE-FIRING
 * THE SAME DECISION EVERY NIGHT FOREVER.
 *
 * Companion to `for external review/00-master-programme/reviews/
 * wave2-idempotency-proposal-2026-09-13.md`. Nothing here is imported by any
 * live job, cron, route or detector. See `_wave2_no_mutation_scan.test.ts`,
 * which proves that mechanically rather than by this sentence (Rule 20: a
 * header comment asserting an invariant is documentation, not enforcement).
 *
 * ── THE JOB THE OLD STAMP WAS DOING ────────────────────────────────────────
 *
 * `adapt.ts` ~4112 states it in its own words:
 *
 *     "the anchor cascade below reads `vdot_last_reviewed` first, and the
 *      `recompute_paces` limb stamps it after applying — so a credited lead
 *      becomes the anchor it was measured against, the delta collapses to
 *      zero, and the detector cannot re-fire on the same evidence."
 *
 * That is IDEMPOTENCY BY MOVING THE GOALPOST. The detector's firing test is
 * `measured - anchor >= 1.0`; acting on it rewrites `anchor := measured`, so
 * the test is false tomorrow. It is elegant and it has two defects, one old
 * and one new:
 *
 *   · IT CONFLATES TWO QUANTITIES UNDER ONE NAME (Rule 16). The anchor is both
 *     "what we believe about this runner" and "what we have already acted on".
 *     A belief that can only be updated by an adaptation firing is not a
 *     belief, and that is precisely how the column came to read 46.6 for four
 *     months while the runner's evidence read 47.5-47.9.
 *   · THE STAMP IS MECHANICALLY DEAD. Since the 2026-09-02 seam closure,
 *     `recompute_paces` never reaches `applyAdaptations` from any live call
 *     site, so nothing writes the column. The idempotency guarantee has been
 *     absent, not just weakened, for the whole of that period.
 *
 * ── WHAT REPLACES IT ───────────────────────────────────────────────────────
 *
 * Separate the two quantities the stamp fused:
 *
 *   BELIEF   → `resolveThresholdCapacity()`, the Constitution §C owner.
 *              Recomputed at read time, never stamped (Rule 10).
 *   ACTED-ON → a DECISION IDENTITY: a content hash of the evidence the
 *              decision rested on, plus what was decided, checked against the
 *              decision ledger before firing.
 *
 * The belief is then free to move for evidential reasons alone, and "have we
 * already acted on this?" is answered by a record of having acted rather than
 * by a number that had to be corrupted to carry the answer.
 *
 * ── REUSE, NOT REINVENTION ─────────────────────────────────────────────────
 *
 * Three mechanisms already in this codebase do parts of this job, and this
 * file uses all three rather than growing a fourth (Constitution §9):
 *
 *   1 · `idempotencyKeyFor()` (`lib/adaptation/canonical/decision-record.ts`)
 *       — the KEY SHAPE, `athlete · planVersion · evidenceVersion · lever ·
 *       boundary`, and its own load-bearing rule: "Note what is NOT in it:
 *       the timestamp." This file calls that function; it does not restate
 *       the format.
 *   2 · `plan_decision_ledger.idempotency_key` + its PARTIAL UNIQUE INDEX
 *       `(user_uuid, provenance, idempotency_key) WHERE idempotency_key IS
 *       NOT NULL` (migration 166) — the ENFORCEMENT. With
 *       `recordDecisionInTransaction(tx, entry, { onceOnly: true })` a second
 *       transaction carrying the same key inserts nothing, returns
 *       `{ state: 'duplicate' }`, and the caller rolls its own mutation back.
 *       Exactly-once, in the same commit as the plan change. Nothing here
 *       needs to be built.
 *   3 · `plan_lineage_id` — the id that survives a plan rebuild. Migration
 *       166's own header explains why: `clearActivePlansFor` archives the
 *       plan and a rebuild authors a new row, so a key scoped to `plan_id`
 *       forgets everything on every rebuild, which for this runner is 47
 *       plan versions (CLAUDE.md Rule 14).
 *
 * WHAT IS **NOT** REUSED, AND WHY. `lib/adaptation/canonical-shadow/
 * live-input.ts:1016` derives `evidenceVersion` as
 * `runData[runData.length - 1].dateISO` — THE DATE OF THE LAST RUN. For the
 * volume lever, over a week-boundary cadence, that is defensible. For THIS
 * lever it is not, in both directions:
 *
 *   · IT MISSES CHANGES. An old run ageing out of the capacity resolver's
 *     lookback window changes the evidence set and does not change the last
 *     run's date. Measured on the owner's real history below: his current
 *     evidence set spans 2026-07-07 to 2026-09-08, so the oldest member is 63
 *     days old and WILL age out with no new run required.
 *   · IT INVENTS CHANGES IT SHOULD NOT. Any run at all — a recovery jog that
 *     the pace corpus excludes as `LABEL_NON_QUALITY_NO_THRESHOLD_EVIDENCE` —
 *     moves the last-run date and therefore the key, so a decision could be
 *     re-raised on evidence that has not changed at all.
 *
 * The fix is not a new key format. It is a better `evidenceVersion`, computed
 * from the canonical resolver's OWN `evidenceIds` (which are `runs.id::text`,
 * verified against production on 2026-09-13) rather than from a proxy.
 *
 * ── WHY THE MAGNITUDE IS QUANTISED, AND WHY THAT IS NOT A RULE 9 CLIFF ─────
 *
 * Measured on the owner's real history over 45 consecutive days
 * (2026-07-31 → 2026-09-13, read-only replay, see the proposal §2):
 *
 *     evidence set changed        3 times
 *     canonical VDOT              47.8 → 47.9 → 47.5
 *     canonical confidence        0.67 → 0.84, moving on 20 of 45 days
 *     resolvedAt                  changes every single call
 *
 * So `confidence` and `resolvedAt` must NOT be in the key or it changes
 * nightly and the dedup is decorative — the same reason `idempotencyKeyFor`
 * excludes the timestamp. And the RAW vdot must not be either: it moved 47.9
 * → 47.5 partly through the day-to-day continuity cap and freshness
 * weighting, not only through the evidence set, so a raw-vdot key would mint
 * new identities on days when nothing was learned.
 *
 * The magnitude therefore enters the key QUANTISED to
 * `TRAINING_LEAD_REANCHOR_DELTA` (1.0 VDOT) — doctrine's own step, imported
 * rather than re-derived, `Research/01` §"Triggers to retest": "Add 1 VDOT
 * point; re-derive paces". Rule 9 asks whether a hair's difference in input
 * produces a categorically different PLAN. It does not here, and the
 * distinction is worth stating rather than assuming: two canonical readings
 * either side of a bucket edge produce two different KEYS, whose entire
 * consequence is one extra ledger row and one extra evaluation of a decision
 * that was going to be evaluated anyway. No plan differs. Rule 9's signature
 * failure — the fitter runner gets the worse plan — cannot occur through this
 * seam, because this seam cannot reach a plan at all.
 */
import { createHash } from 'node:crypto';
import { idempotencyKeyFor } from '@/lib/adaptation/canonical/decision-record';
import { TRAINING_LEAD_REANCHOR_DELTA } from '@/lib/training/pace-anchor';

/** The two detectors this proposal is about. Named rather than free text so a
 *  typo cannot silently open a second identity space. */
export type FitnessDetector = 'fitness_regression' | 'training_lead';

/** Which way the decision would move the runner. Rule 21's census axis, and
 *  part of the identity: the same evidence set arguing UP and the same
 *  arguing DOWN are two decisions, not one. */
export type FitnessDecisionDirection = 'UP' | 'DOWN';

/**
 * The evidence set's content hash. Sorted and de-duplicated first, so the
 * capacity resolver's iteration order — which is not a documented guarantee —
 * cannot mint a new identity for an unchanged set.
 *
 * Rule 11 · an EMPTY evidence set is not a hash of nothing. `null` is
 * returned, and the caller must branch: a decision resting on no named
 * evidence has no identity to dedup on, and giving it one would be the
 * strongest possible version of this file's own failure mode — a key that
 * collides with every other evidence-free decision, suppressing all of them
 * after the first. `resolveThresholdCapacity` returns an empty `evidenceIds`
 * only on `population_prior`, which is not a basis for an adaptation anyway.
 */
export function fitnessEvidenceFingerprint(evidenceIds: readonly string[]): string | null {
  const unique = [...new Set(evidenceIds.filter((id) => id != null && id.length > 0))].sort();
  if (unique.length === 0) return null;
  // The count is hashed alongside the ids so a set and a strict subset that
  // happen to concatenate identically cannot collide. ` ` cannot appear
  // in a `runs.id::text`, so it is a safe separator.
  const payload = `${unique.length} ${unique.join(' ')}`;
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/**
 * Doctrine's own step, as a bucket index. `Math.round` rather than `floor`, so
 * the bucket is centred on the doctrine value rather than offset by half a
 * step from it.
 */
export function quantiseVdotMagnitude(deltaVdot: number): number {
  return Math.round(deltaVdot / TRAINING_LEAD_REANCHOR_DELTA);
}

export interface FitnessDecisionIdentityInput {
  readonly userUuid: string;
  /**
   * `plan_decision_ledger.plan_lineage_id`, NOT `plan_id`. A key scoped to the
   * plan id forgets every decision on every rebuild, and the owner's account
   * has 47 plan versions (Rule 14). Resolve it with
   * `resolvePlanLineage()` — do not re-derive it here.
   */
  readonly planLineageId: string;
  /**
   * Which detector asked. Carried for the ledger row's `explanation` and for
   * the caller's own logging — DELIBERATELY NOT IN THE KEY. See
   * `fitnessDecisionIdentity`'s note on exclusivity.
   */
  readonly detector: FitnessDetector;
  /**
   * Which way this would move the runner. Carried for
   * `plan_decision_ledger.direction` (Rule 21's census axis) — also
   * DELIBERATELY NOT IN THE KEY.
   */
  readonly direction: FitnessDecisionDirection;
  /** `ThresholdCapacityEstimate.evidenceIds`, verbatim. */
  readonly evidenceIds: readonly string[];
  /** `canonicalVdot - anchorVdot`, signed, unquantised. Quantised in here. */
  readonly deltaVdot: number;
}

export type FitnessDecisionIdentity =
  | { readonly kind: 'identified'; readonly key: string; readonly evidenceFingerprint: string }
  /** Rule 11 · no evidence is not an identity. Never a key. */
  | { readonly kind: 'no_evidence'; readonly why: string };

/**
 * THE KEY. Built through `idempotencyKeyFor` so the format lives in one place
 * (Rule 16) and this lever's keys sort and read the same as the canonical
 * adaptation lane's. Every slot is filled with a value that is TRUE of this
 * decision — no cast, no widened enum, no sentinel:
 *
 *   `lever: 'THRESHOLD_PACE'`      it is the threshold-pace lever.
 *   `boundary: 'SESSION_COMPLETED'` `input.ts` defines that member as the one
 *       that "updates evidence and asks whether a lever has new information",
 *       against `WEEKLY_BOUNDARY`'s "arbitrates plan-level change". That is
 *       exactly what a nightly fitness read does, and it lines this proposal
 *       up with the canonical lane's cadence rule — a moving verdict reached
 *       here is recorded and deferred to the weekly boundary, which is also
 *       the posture §6 of the proposal recommends for these two detectors.
 *   `planVersion: planLineageId`   survives the rebuild (Rule 14).
 *
 * ── WHY THE DETECTOR AND THE DIRECTION ARE **NOT** IN THE KEY ──────────────
 *
 * They were, in the first draft, on the reasoning that "the same evidence
 * arguing UP and the same arguing DOWN are two decisions". That reasoning is
 * wrong here and the codebase already says so. `detectAdaptations` runs
 * `detectTrainingLead` only when neither `pr_bank` nor `fitness_regression`
 * fired — the detectors are MUTUALLY EXCLUSIVE by construction, and
 * `adapt.ts` ~4103 calls that exclusivity out by name as the double-counting
 * guard. So one evidence set, one lever, one boundary admits AT MOST ONE
 * threshold-pace decision, and a key that separated the directions would
 * licence exactly the incoherence Rule 16 forbids: the same evidence
 * recorded as both a push and a pull-back, each individually defensible and
 * together nonsense. Keeping them out of the key makes the exclusivity a
 * property of the identity rather than a property of one caller's control
 * flow. Both fields stay on the INPUT, because the ledger row needs
 * `direction` for Rule 21's census and `explanation` for the human.
 *
 * ── WHY THE QUANTISED MAGNITUDE **IS** IN THE KEY ──────────────────────────
 *
 * The evidence set alone does not determine the delta: the delta is
 * `canonical − anchor`, and the anchor is the other operand. An anchor that
 * genuinely moved a doctrine step against unchanged evidence is a new
 * question, and the detector should be allowed to ask it. Quantising to
 * `TRAINING_LEAD_REANCHOR_DELTA` is what stops the sub-step wobble measured
 * on the owner's real history (47.8 → 47.9, no evidence change) from minting
 * a new identity for a question nobody asked.
 */
export function fitnessDecisionIdentity(
  input: FitnessDecisionIdentityInput,
): FitnessDecisionIdentity {
  const fingerprint = fitnessEvidenceFingerprint(input.evidenceIds);
  if (fingerprint == null) {
    return {
      kind: 'no_evidence',
      why:
        'the canonical belief named no evidence, so there is nothing to identify this decision '
        + 'by. A key here would collide with every other evidence-free decision and suppress all '
        + 'of them after the first, which is worse than firing twice.',
    };
  }
  const bucket = quantiseVdotMagnitude(input.deltaVdot);
  const key = idempotencyKeyFor({
    athleteId: input.userUuid,
    planVersion: input.planLineageId,
    evidenceVersion: `${fingerprint}@${bucket}`,
    lever: 'THRESHOLD_PACE',
    boundary: 'SESSION_COMPLETED',
  });
  return { kind: 'identified', key, evidenceFingerprint: fingerprint };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DEDUP CHECK
 *
 * Rule 11, three ways. "This has already fired", "this has not fired", and
 * "the ledger could not tell me" are three facts, and the third is the one
 * that has cost this project the most. The ledger's own `LedgerWrite` /
 * `LedgerHistory` types already model exactly these three; this mirrors them
 * rather than inventing a fourth vocabulary.
 * ═══════════════════════════════════════════════════════════════════════ */

/** What the ledger says about a key. Shaped to be produced by a thin adapter
 *  over `plan_decision_ledger`, and by a fake in tests. */
export type LedgerKeyProbe =
  | { readonly state: 'absent' }
  | { readonly state: 'present'; readonly recordedAtISO: string; readonly undone: boolean }
  /** Migration 166 not applied on this database. VERIFIED TRUE OF PRODUCTION
   *  on 2026-09-13: `SELECT to_regclass('public.plan_decision_ledger')`
   *  returns NULL. Not the same fact as `'absent'` (Rule 11), and the
   *  difference decides whether a detector may fire at all. */
  | { readonly state: 'table_absent'; readonly why: string }
  | { readonly state: 'failed'; readonly why: string };

export type FireVerdict =
  | { readonly fire: true; readonly key: string; readonly why: string }
  | { readonly fire: false; readonly reason: FireRefusal; readonly why: string };

export type FireRefusal =
  /** The identical evidence already produced this decision. The one case this
   *  whole mechanism exists for. */
  | 'ALREADY_DECIDED_ON_THIS_EVIDENCE'
  /** No evidence named, so no identity, so no honest dedup. */
  | 'NO_EVIDENCE_TO_IDENTIFY'
  /** The ledger table does not exist. NOT a permission to fire: without the
   *  unique index the exactly-once guarantee is a comment rather than a
   *  constraint, and Rule 11 forbids a missing input silently disabling a
   *  safety mechanism. `decision-ledger.ts` takes exactly this posture in
   *  `LEDGER_ONCE_WITHOUT_TABLE`, and this reuses its argument rather than
   *  inventing a softer one. */
  | 'IDEMPOTENCY_UNAVAILABLE_TABLE_ABSENT'
  /** The ledger read failed. Same posture, different fact. */
  | 'IDEMPOTENCY_UNAVAILABLE_READ_FAILED';

/**
 * PURE. Given an identity and what the ledger says about it, may this decision
 * fire tonight?
 *
 * ── AN UNDONE DECISION MAY FIRE AGAIN, AND THAT IS DELIBERATE ──────────────
 *
 * A row with `undone_at` set records a decision the runner or the engine
 * REVERSED. Treating it as "already decided" would mean an undo permanently
 * silences the detector on that evidence — the runner declines once and the
 * coach never raises it again, which is not restraint, it is amnesia in the
 * shape of politeness. `directionCensus()` already excludes undone rows for
 * the same reason. Note the cost honestly: a runner who undoes and never
 * changes their training will see the decision re-raised. That is a
 * PROPOSAL-EXPIRY question (`lib/brain/proposal/staleness.ts` owns it), not
 * an identity question, and solving it here would be a second answer to
 * someone else's row in the Constitution's table.
 *
 * ── WHAT THIS FUNCTION CANNOT FAIL ON (Rule 22) ────────────────────────────
 *
 * · WHETHER THE DECISION IS RIGHT. It only asks whether it is NEW.
 * · WHETHER THE EVIDENCE IDS ARE THE RIGHT ONES. It hashes what it is given.
 *   A capacity resolver that started reporting the wrong provenance would
 *   produce stable, confident, wrong keys and nothing here could tell.
 * · A LEDGER ROW WRITTEN BY SOMETHING ELSE under the same key.
 * · WHETHER THE CALLER ACTUALLY WRITES THE ROW AFTER FIRING. This returns a
 *   verdict; only `recordDecisionInTransaction(..., { onceOnly: true })`
 *   makes it binding, and only because the row and the mutation share one
 *   transaction. A caller that fires and never records will re-fire forever
 *   and this function will keep saying yes, correctly.
 */
export function shouldFireOnThisEvidence(
  identity: FitnessDecisionIdentity,
  probe: LedgerKeyProbe,
): FireVerdict {
  if (identity.kind === 'no_evidence') {
    return { fire: false, reason: 'NO_EVIDENCE_TO_IDENTIFY', why: identity.why };
  }
  switch (probe.state) {
    case 'table_absent':
      return {
        fire: false,
        reason: 'IDEMPOTENCY_UNAVAILABLE_TABLE_ABSENT',
        why:
          `${probe.why} Firing anyway would downgrade an exactly-once decision to an `
          + 'at-least-once one, which is a missing input quietly disabling a safety mechanism '
          + '(Rule 11), so the decision is withheld instead.',
      };
    case 'failed':
      return {
        fire: false,
        reason: 'IDEMPOTENCY_UNAVAILABLE_READ_FAILED',
        why:
          `${probe.why} "The ledger could not answer" is not "this has never fired" — the two `
          + 'differ by exactly the decision this check exists to prevent.',
      };
    case 'present':
      if (!probe.undone) {
        return {
          fire: false,
          reason: 'ALREADY_DECIDED_ON_THIS_EVIDENCE',
          why:
            `this exact evidence produced this exact decision at ${probe.recordedAtISO}. `
            + 'Re-reading the same training does not make it a new finding.',
        };
      }
      return {
        fire: true,
        key: identity.key,
        why:
          `a decision on this evidence was recorded at ${probe.recordedAtISO} and later UNDONE. `
          + 'A reversal is not a standing decision, so the evidence is answerable again.',
      };
    case 'absent':
      return {
        fire: true,
        key: identity.key,
        why: 'no standing decision is recorded against this evidence and this direction.',
      };
  }
}
