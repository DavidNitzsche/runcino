/**
 * lib/training/resolve-current-fitness.ts · PROPOSAL, NOT WIRED IN.
 *
 * See `for external review/00-master-programme/reviews/wave2-pace-brain-proposal-2026-09-13.md`
 * for the full investigation this implements. Summary of what this file is
 * for and what it deliberately does NOT do:
 *
 * ── THE QUESTION ─────────────────────────────────────────────────────────
 *
 * "What is this runner's current fitness VDOT, and how much should anything
 * trust it?" Three things in this codebase can currently answer a version of
 * that question, and Constitution §C is explicit that only one of them is
 * allowed to be authoritative:
 *
 *   1. `users.vdot_last_reviewed` — written exactly once, in
 *      `lib/plan/adapt.ts`'s `applyAdaptations`, only from the
 *      `recompute_paces` branch, post-commit. Since the 2026-09-02 seam
 *      closure (`lib/plan/adaptation-authority.ts`), `recompute_paces` is not
 *      in `PROPOSABLE_KINDS`, so it is diverted to an observational note
 *      before it ever reaches `applyAdaptations` from ANY live call site —
 *      cron (`sealAutomaticActions().apply`) or runner-accept
 *      (`sealAutomaticActions().propose`, which it never enters). The column
 *      is therefore mechanically frozen, not merely stale by policy.
 *   2. `authored_state.pace_recompute.vdot` (and its own fallbacks,
 *      `pace_blend.season_anchor_vdot` / `derived_from.bestRecentVdot`) — a
 *      plan-authoring / last-successful-recompute SNAPSHOT by design; see
 *      `lib/training/pace-anchor.ts`'s own header, which calls it "the
 *      durable fallback anchor" for exactly this reason.
 *   3. `resolveThresholdCapacity()` (`lib/training/capacity-resolver.ts`) —
 *      the canonical Runner Model resolver Constitution §C names by name
 *      ("A feature that needs threshold capacity calls
 *      `getThresholdCapacity()`. It does not calculate threshold itself.").
 *      Confidence-weighted, source-mode-tagged, computed fresh at read time
 *      (Rule 10), never persisted.
 *
 * (1) and (2) are the SAME legacy cascade `anchorVdotFromState()`
 * (`pace-anchor.ts`) walks, extracted verbatim from `lib/plan/adapt.ts`'s
 * `detectFitnessRegression` / `detectTrainingLead` — code that predates
 * `capacity-resolver.ts` and was never migrated to call it (see that file's
 * own "NOT WIRED" list, which does not even mention `adapt.ts` because the
 * migration scope was drawn before this gap was found). Reading (1) before
 * (2) inside that cascade is a real, argued design choice — not an accident
 * — but the argument is about closing an idempotency loop ("the
 * `recompute_paces` limb stamps the reviewed column after applying, so a
 * credited lead becomes its own new anchor and cannot re-fire on the same
 * evidence", `adapt.ts` ~line 4112), not an epistemic claim that a reviewed
 * belief should outrank a fresher one. That loop's other half (the stamp)
 * is dead per the seam finding above, so the ordering argument's premise no
 * longer holds either.
 *
 * ── WHAT THIS RESOLVER DOES ─────────────────────────────────────────────
 *
 * It does NOT pick between (1)/(2) and (3) as if they were three votes.
 * Constitution §C already settled who the canonical owner is. This resolver
 * calls (3) and returns its answer. What it adds is a SAFETY CROSS-CHECK: it
 * also reads the legacy cascade (read-only, never written here) and, if the
 * two disagree by more than a runner-model move can be attributed to normal
 * evidence movement, it REFUSES instead of quietly using the canonical
 * belief anyway — because at that point the disagreement itself is a fact
 * worth a human's attention (is the legacy anchor just stale, as this
 * investigation found it is, or has something else gone wrong), not an
 * implementation detail this resolver should paper over.
 *
 * The disagreement threshold is `SELF_HEAL_REANCHOR_DELTA` (2.0 VDOT),
 * imported from `pace-anchor.ts` rather than re-derived: that constant's own
 * header argues exactly this shape of comparison — "the self-heal has no
 * evidence-kind context ... it acts only on a move too large to be
 * candidate-set jitter" — which is exactly this resolver's position with
 * respect to the legacy anchor. Reusing it keeps one number for one
 * question (CLAUDE.md Rule 16) instead of inventing a sibling.
 *
 * ── WHAT THIS RESOLVER DOES NOT DO (THE 2026-09-02 SEAL, PRESERVED) ──────
 *
 *   · No write, anywhere in this file. Grep it: there is no `UPDATE`, no
 *     `INSERT`, no call to `applyAdaptations`, `sealAutomaticActions`, or
 *     any mutation path.
 *   · No trigger of `recompute_paces` or any other `AdaptationAction`.
 *   · No plan repricing — it never calls `recomputePacesForPlan` or
 *     `applyReanchorProposal`.
 *   · No runner-visible card — it returns a value to a caller, nothing more.
 *   · NOT wired into `adapt.ts`, `run-adaptations`, or any live job. A
 *     caller has to import it deliberately; nothing currently does.
 *
 * ── RULE 11, APPLIED TO THE CROSS-CHECK ITSELF ───────────────────────────
 *
 * "No legacy anchor to compare against" and "the legacy-anchor read failed"
 * are different facts, so `loadLegacySnapshot` returns a three-state
 * `LegacySnapshotProbe` rather than collapsing both to `null`. Both let the
 * canonical belief answer (a failed cross-check must not block the
 * doctrine-designated authority — the posture Rule 23 argues for
 * preconditions generally), but the failed case says so in `provenance`
 * rather than silently reading as "checked, no disagreement".
 */

import {
  resolveThresholdCapacity,
  type ThresholdCapacityEstimate,
  type SourceMode,
  type CapacityReasonCode,
} from '@/lib/training/capacity-resolver';
import {
  anchorVdotFromState,
  SELF_HEAL_REANCHOR_DELTA,
} from '@/lib/training/pace-anchor';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { pool } from '@/lib/db/pool';

/** The canonical belief's contribution, carried through unchanged so a
 *  caller (or a human reading a refusal) can see the full estimate, not just
 *  the number. */
export interface CanonicalBeliefInput {
  /** Null only for a below-table runner (`ThresholdCapacityEstimate.vdot`'s
   *  own contract) — see `INCOMPARABLE_BELOW_TABLE` below. */
  vdot: number | null;
  paceSecPerMi: number;
  confidence: number;
  sourceMode: SourceMode;
  reasons: CapacityReasonCode[];
  evidenceIds: string[];
  resolvedAt: string;
}

/** The legacy cascade's answer, read-only, for comparison ONLY. Never the
 *  resolver's own answer. */
export interface LegacySnapshotInput {
  /** `users.vdot_last_reviewed`, raw. */
  reviewedVdot: number | null;
  /** `authored_state.pace_recompute.vdot`, raw — the plan-authoring /
   *  last-recompute snapshot `pace-anchor.ts` calls "the durable fallback
   *  anchor". */
  authoredStateVdot: number | null;
  /** `anchorVdotFromState(reviewedVdot, authoredState)` — the literal value
   *  `detectFitnessRegression` / `detectTrainingLead` would use tonight.
   *  This is the number compared against the canonical belief, not the two
   *  fields above individually — they are carried for provenance only. */
  cascadeVdot: number | null;
}

export type LegacySnapshotProbe =
  | { status: 'ok'; snapshot: LegacySnapshotInput }
  /** No active (unarchived) plan for this user — legitimately nothing to
   *  cross-check, not a failure. */
  | { status: 'none' }
  /** The read itself errored. Rule 11: not the same fact as `'none'`. */
  | { status: 'failed' };

export type CurrentFitnessRefusalReason =
  /** The canonical belief and the legacy cascade disagree by more than
   *  `SELF_HEAL_REANCHOR_DELTA` VDOT — a real coaching question, not an
   *  implementation detail this resolver should pick a side on. */
  | 'BELIEF_SNAPSHOT_DISAGREEMENT'
  /** The canonical belief has no VDOT to report (a below-table runner —
   *  `ThresholdCapacityEstimate.vdot === null`). This resolver answers the
   *  VDOT question specifically; a below-table runner's real pace still
   *  exists (`paceSecPerMi`) but has no equivalent on this scale, so a VDOT
   *  comparison against the legacy anchor cannot be made honestly either
   *  way. */
  | 'INCOMPARABLE_BELOW_TABLE';

export interface CurrentFitnessProvenance {
  canonicalBelief: CanonicalBeliefInput;
  legacyProbe: LegacySnapshotProbe;
  /** `canonicalBelief.vdot - legacySnapshot.cascadeVdot`. Null whenever
   *  either side is unavailable or incomparable. */
  deltaVdot: number | null;
  /** `SELF_HEAL_REANCHOR_DELTA`, carried so a caller does not have to import
   *  a second module to explain the refusal. */
  disagreementThresholdVdot: number;
}

export type CurrentFitnessRead =
  | {
      ok: true;
      vdot: number;
      paceSecPerMi: number;
      confidence: number;
      sourceMode: SourceMode;
      provenance: CurrentFitnessProvenance;
    }
  | {
      ok: false;
      reason: CurrentFitnessRefusalReason;
      detail: string;
      provenance: CurrentFitnessProvenance;
    };

/**
 * Pure · the decision, given both sides already resolved. Split out from the
 * DB-fetching wrapper below so the decision itself is testable without a
 * database — same split `pace-anchor.ts` uses for `selfHealShouldDefer` vs
 * `adapterMovedAnchorWithin`.
 */
export function decideCurrentFitness(
  canonical: CanonicalBeliefInput,
  legacyProbe: LegacySnapshotProbe,
): CurrentFitnessRead {
  const legacyVdot = legacyProbe.status === 'ok' ? legacyProbe.snapshot.cascadeVdot : null;

  const provenanceBase = (deltaVdot: number | null): CurrentFitnessProvenance => ({
    canonicalBelief: canonical,
    legacyProbe,
    deltaVdot,
    disagreementThresholdVdot: SELF_HEAL_REANCHOR_DELTA,
  });

  if (canonical.vdot == null) {
    const detail = legacyVdot != null
      ? `The canonical belief has no VDOT (below-table pace, ${canonical.paceSecPerMi}s/mi). ` +
        `The legacy anchor cascade reads ${legacyVdot.toFixed(1)}, but a below-table pace has no ` +
        `honest VDOT equivalent to compare it against — refusing rather than fabricating one.`
      : 'The canonical belief has no VDOT (below-table pace) and no legacy anchor exists either.';
    return { ok: false, reason: 'INCOMPARABLE_BELOW_TABLE', detail, provenance: provenanceBase(null) };
  }

  if (legacyVdot == null) {
    // Nothing to cross-check against (no legacy anchor, or the probe read
    // failed — either way there is no second number to disagree with).
    // The canonical belief answers on its own authority, per Constitution
    // §C: it does not need the legacy cascade's agreement to be correct.
    return {
      ok: true,
      vdot: canonical.vdot,
      paceSecPerMi: canonical.paceSecPerMi,
      confidence: canonical.confidence,
      sourceMode: canonical.sourceMode,
      provenance: provenanceBase(null),
    };
  }

  const delta = canonical.vdot - legacyVdot;
  if (Math.abs(delta) > SELF_HEAL_REANCHOR_DELTA) {
    const detail =
      `The canonical belief (${canonical.vdot.toFixed(1)}, ${canonical.sourceMode}, ` +
      `confidence ${canonical.confidence.toFixed(2)}) and the legacy anchor cascade ` +
      `(${legacyVdot.toFixed(1)}) disagree by ${delta.toFixed(1)} VDOT, more than the ` +
      `${SELF_HEAL_REANCHOR_DELTA.toFixed(1)}-point context-free move threshold. Picking one over ` +
      `the other here is a coaching decision, not an implementation detail — refusing rather than ` +
      `guessing. See provenance for both readings.`;
    return { ok: false, reason: 'BELIEF_SNAPSHOT_DISAGREEMENT', detail, provenance: provenanceBase(delta) };
  }

  return {
    ok: true,
    vdot: canonical.vdot,
    paceSecPerMi: canonical.paceSecPerMi,
    confidence: canonical.confidence,
    sourceMode: canonical.sourceMode,
    provenance: provenanceBase(delta),
  };
}

/**
 * READ-ONLY. Mirrors the exact query `detectFitnessRegression` /
 * `detectTrainingLead` (`lib/plan/adapt.ts`) use to build the legacy anchor,
 * so this cross-check cannot silently disagree with the live detectors about
 * what the legacy anchor even is. No write of any kind.
 */
async function loadLegacySnapshot(userId: string): Promise<LegacySnapshotProbe> {
  try {
    const row = (
      await pool.query<{ reviewed: string | null; authored_state: Record<string, unknown> | null }>(
        `SELECT (SELECT vdot_last_reviewed::numeric::text FROM users WHERE id = $1::uuid) AS reviewed,
                tp.authored_state
           FROM training_plans tp
          WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL
          ORDER BY tp.authored_iso DESC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!row) return { status: 'none' };

    const reviewedVdot = row.reviewed != null ? Number(row.reviewed) : null;
    const st = (row.authored_state ?? {}) as Record<string, any>;
    const authoredStateVdot = st.pace_recompute?.vdot != null ? Number(st.pace_recompute.vdot) : null;
    const cascadeVdot = anchorVdotFromState(row.reviewed, row.authored_state);

    return { status: 'ok', snapshot: { reviewedVdot, authoredStateVdot, cascadeVdot } };
  } catch {
    // Rule 11: a failed read is not "no anchor exists". Reported as its own
    // status so `decideCurrentFitness`'s caller can tell the difference —
    // both let the canonical belief answer, but only `'none'` means the
    // cross-check genuinely found nothing to disagree with.
    return { status: 'failed' };
  }
}

/**
 * THE canonical current-fitness VDOT resolver. Read-only, not persisted,
 * not wired into any live job — see the file header.
 *
 * Callers that currently read `users.vdot_last_reviewed` or
 * `authored_state.pace_recompute.vdot` directly to answer "what is this
 * runner's current fitness" should migrate to this function. Callers that
 * need the FULL threshold capacity estimate (pace, confidence, evidence)
 * rather than just a VDOT scalar should call `resolveThresholdCapacity`
 * directly, as this function does — that resolver is still the sole owner;
 * this file adds the legacy cross-check, nothing else.
 */
export async function resolveCurrentFitnessVdot(
  userId: string,
  todayISO?: string,
): Promise<CurrentFitnessRead> {
  const today = todayISO ?? (await runnerToday(userId));
  const [estimate, legacyProbe] = await Promise.all([
    resolveThresholdCapacity(userId, today),
    loadLegacySnapshot(userId),
  ]);
  const canonical = canonicalBeliefFromEstimate(estimate);
  return decideCurrentFitness(canonical, legacyProbe);
}

/** Project the fields this resolver needs out of the full capacity
 *  estimate, so `decideCurrentFitness` stays testable against a small
 *  fixture rather than a full `ThresholdCapacityEstimate`. */
function canonicalBeliefFromEstimate(estimate: ThresholdCapacityEstimate): CanonicalBeliefInput {
  return {
    vdot: estimate.vdot,
    paceSecPerMi: estimate.paceSecPerMi,
    confidence: estimate.confidence,
    sourceMode: estimate.sourceMode,
    reasons: estimate.reasons,
    evidenceIds: estimate.evidenceIds,
    resolvedAt: estimate.resolvedAt,
  };
}
