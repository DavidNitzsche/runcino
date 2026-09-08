/**
 * lib/audit/pace-drift-autopropose.ts · DECISION 2 (2026-09-07) — the missing
 * half of `pace-drift-monitor.ts`.
 *
 * ── THE RULING, VERBATIM ────────────────────────────────────────────────────
 *
 * "Do not silently rewrite accepted paces. Implement proposal creation only
 * when the calculated drift changes a runner-visible rounded prescription.
 * If a one-second internal difference produces no displayed or prescribed
 * change, record it as monitored drift without creating runner noise." And:
 * "Any proposal must be: idempotent; tied to the active plan version; carry
 * accepted before-state and proposed after-state; include evidence and
 * explanation; expire or supersede when stale; require runner acceptance."
 *
 * ── ROOT CAUSE, RESTATED FROM `docs/reports/brain-2026-09-07/HANDBACK.md` ──
 *
 * REANCHORPROPOSES-1 turned the nightly self-heal from an automatic write
 * into a propose-then-accept card. `reanchorActivePlan` still gates WHETHER
 * to even attempt a repricing on `shouldReanchor` / `shouldReanchorRacePrep`
 * (VDOT deltas of 1.0-2.0, `lib/training/pace-anchor.ts`) and, on the
 * VDOT-unchanged branch, `anchorsMovedFromStamp`'s `REANCHOR_ANCHOR_DELTA_S_
 * PER_MI = 3` seconds. A ~0.1-0.2 VDOT drift never crosses either gate, so
 * the nightly propose flow never runs for it — not "runs and declines", never
 * attempted. `pace-drift-monitor.ts` sees the resulting gap and alerts; this
 * file is what answers "unexplained, and worth a card" for exactly that gap.
 *
 * ── WHY THIS IS NOT A SECOND PROPOSAL MECHANISM ─────────────────────────────
 *
 * It calls `writeReanchorProposal` (`lib/plan/reanchor-proposal.ts`)
 * directly — the SAME writer `reanchorActivePlan`'s propose branches call.
 * Every property that writer already has, this call inherits for free:
 * idempotent dedup against a pending or recently-dismissed card
 * (`isSameRepricing`, `REPRICE_DISMISSAL_QUIET_DAYS`), the plan id carried in
 * `RepricePayload.planId` (which `explainPaceDrift` already checks against
 * the runner's currently active plan), before/after anchors, evidence and a
 * `reason` string, and an INSERT that never touches `plan_workouts` or
 * `training_plans` — a proposal is not a mutation, and this file writes
 * nothing else. What's new here is only the DECISION of when to call it: the
 * coarse VDOT/seconds gates above are for the unattended nightly self-heal
 * deciding whether fitness moved enough to matter on its own; this is the
 * monitor deciding whether an ALREADY-DETECTED, unexplained disagreement is
 * worth putting in front of the runner at all.
 *
 * ── THE RUNNER-VISIBLE RULE ──────────────────────────────────────────────────
 *
 * `isRunnerVisibleDrift` formats both sides with `fmtPace`
 * (`lib/format/run.ts`), the exact function every pace-displaying surface
 * calls (Today, Block, the watch face payload). `fmtPace` rounds to the
 * nearest whole second before splitting into `M:SS`, so 429 s/mi reads
 * "7:09" and 430 s/mi reads "7:10" — a one-second difference that crosses a
 * rounding boundary the runner would see, and one that does not (e.g. 429.4
 * vs 429.6, both "7:09") would not. Only the former is proposed; the latter
 * is monitored drift, per the ruling above, and is never silently discarded
 * — it is returned as `not_visible` with the raw numbers named, so the cron's
 * own alert can still say a drift exists even where no card was raised.
 *
 * ── ARM, AND WHY IT IS NEVER `canonical-prior` ───────────────────────────────
 *
 * `RepriceArm` is `'race-prep' | 'maintenance' | 'canonical-prior'`. The
 * third arm's accept path (`applyReanchorProposal` → `reanchorOffCanonical
 * Prior(..., 'apply')`) is a NO-OP whenever `authored_state.pace_authoring
 * .source === 'canonical'` — which is exactly the state a plan carrying a
 * live `pace_recompute.anchors` stamp is already in. Raising a
 * `canonical-prior` card against such a plan would produce a proposal the
 * runner could accept and watch do nothing. The arm here always follows the
 * plan's own mode (`race-prep` when `mode === 'race-prep'` or a race is
 * attached, `maintenance` otherwise), exactly as `reanchorActivePlan` decides
 * it, so accept always reaches the real repricing arm.
 *
 * ── `toSource` IS NEVER LAUNDERED TO `measured_vdot` ─────────────────────────
 *
 * The race-prep/maintenance propose branches inside `reanchor-plan.ts` stamp
 * `toSource: 'measured_vdot'` because they are only reached when a fresh
 * `bestRecentVdot` measurement triggered them. Nothing here has that trigger
 * — the monitor is noticing that TODAY's canonical read already disagrees
 * with what is persisted, which may be several nights old. `toSource` is
 * read straight off `anchors.basis.threshold.sourceMode` and `measured` is
 * `sourceMode === 'direct'`, matching `reanchorOffCanonicalPrior`'s own
 * discipline: carry the mode as it is, never claim a measurement that did
 * not happen (Rule 10, GUARD 2's argument against laundering a guess into a
 * measurement — applied here to not laundering a stale-but-canonical read
 * into a fresh one either).
 */
import { rowOrNull } from '@/lib/db/read';
import { pool } from '@/lib/db/pool';
import { fmtPace, paceDisplayChanges } from '@/lib/format/run';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { anchorVdotFromState } from '@/lib/training/pace-anchor';
import {
  writeReanchorProposal,
  pricedAnchorsOf,
  type RepriceProposalOutcome,
} from '@/lib/plan/reanchor-proposal';
import { repriceSubject, type RepriceArm, type RepriceAnchorMove } from '@/lib/plan/reprice-payload';
import type { PaceDriftFinding } from './pace-drift-monitor';

/** Pure — no formatting decision lives twice (Rule 16). Same function every
 *  pace-displaying surface calls, and since 2026-09-08 that is literally one
 *  function: `paceDisplayChanges` in `lib/format/run.ts`, beside the `fmtPace`
 *  whose rounding decides the answer. `repriceReason` needed the identical
 *  question ("did this anchor actually move, as far as the runner can see")
 *  and a second copy of `fmtPace(a) !== fmtPace(b)` is exactly the drift Rule
 *  16 is about. The name stays here because it says what the DRIFT MONITOR is
 *  asking; the arithmetic lives once. */
export function isRunnerVisibleDrift(persistedSecPerMi: number, liveSecPerMi: number): boolean {
  return paceDisplayChanges(persistedSecPerMi, liveSecPerMi);
}

export type AutoProposeOutcome =
  | {
      status: 'not_visible';
      /** Every unexplained finding this pass, with both raw and formatted
       *  values, so the caller can still report the raw drift as monitored. */
      findings: ReadonlyArray<{
        anchorKey: string;
        persistedSecPerMi: number;
        liveSecPerMi: number;
        persistedDisplay: string | null;
        liveDisplay: string | null;
      }>;
    }
  | { status: 'no_active_plan' }
  | { status: 'anchors_unavailable'; reason: string }
  | { status: 'proposed'; outcome: RepriceProposalOutcome; visibleAnchorKeys: readonly string[] };

/**
 * Names what was measured, in the coach's voice (no em dash, no exclamation —
 * `·` stands in for `—`). Deliberately its own text rather than
 * `repriceReason` (`lib/plan/reanchor-plan.ts`): that helper's non-canonical
 * branch says "A race result" or "Your recent training" moved the anchor,
 * which would misstate what actually happened here — nothing new was run or
 * raced, the canonical resolvers simply disagree with a stamp that has gone
 * stale. `describesEvidence` (`lib/brain/objective.ts`) only requires a
 * concrete, non-dispositional sentence of length >= 12; naming both numbers
 * satisfies that on its own terms.
 *
 * REPRICESUBJECT-1 (2026-09-08) · it names the anchor that actually drifted.
 * This function carried the same defect `repriceReason` did — threshold was
 * hardcoded as the subject, so a pass whose only visible findings were on the
 * easy or shakeout ceiling would print two identical threshold numbers and
 * explain nothing. The subject now comes from the VISIBLE findings themselves,
 * through the same `repriceSubject` the card's own sentence uses.
 */
function driftReason(
  moves: readonly RepriceAnchorMove[],
  toSecPerMi: number | null,
  fromSecPerMi: number | null,
): string {
  const subject = repriceSubject(moves);
  const label = subject?.label ?? 'threshold';
  const to = fmtPace(subject != null ? subject.toSecPerMi : toSecPerMi);
  const from = fmtPace(subject != null ? subject.fromSecPerMi : fromSecPerMi);
  if (to == null || from == null) {
    // No " pace" suffix: three of the six labels already end in the word, and
    // "a different interval pace pace" is how a template betrays itself.
    return `The pace resolvers calculate a different ${label} than this block is currently written at.`;
  }
  return `The canonical pace resolvers put ${label} at ${to} per mile today. This block is still written at ${from} per mile.`;
}

/**
 * Given the unexplained findings `pace-drift-monitor.ts` already produced for
 * ONE plan, decide whether any of them is runner-visible and, if so, raise
 * the coordinated reprice proposal through the existing writer.
 *
 * Writes nothing when no finding is visible. Never calls `mutatePlan` or any
 * plan-row writer — the only possible write is `writeReanchorProposal`'s own
 * `plan_workout_proposals` INSERT, which the runner must accept before
 * anything prescribed changes.
 */
export async function autoProposeForUnexplainedDrift(
  userUuid: string,
  planId: string,
  todayISO: string,
  unexplainedFindings: readonly PaceDriftFinding[],
): Promise<AutoProposeOutcome> {
  const decorated = unexplainedFindings.map((f) => ({
    anchorKey: f.anchorKey,
    persistedSecPerMi: f.persistedSecPerMi,
    liveSecPerMi: f.liveSecPerMi,
    persistedDisplay: fmtPace(f.persistedSecPerMi),
    liveDisplay: fmtPace(f.liveSecPerMi),
    visible: isRunnerVisibleDrift(f.persistedSecPerMi, f.liveSecPerMi),
  }));
  const visible = decorated.filter((f) => f.visible);
  if (visible.length === 0) {
    return { status: 'not_visible', findings: decorated };
  }

  // Rule 11 · a failed read of the plan row is not "no active plan". `rowOrNull`
  // distinguishes them; `undefined` (no row matched) is the only case this
  // function treats as `no_active_plan`.
  const planRow = await rowOrNull<{
    mode: string | null;
    race_id: string | null;
    authored_state: Record<string, unknown> | null;
  }>(
    'audit/pace-drift-autopropose · active plan',
    pool.query(
      `SELECT mode, race_id, authored_state FROM training_plans
        WHERE id = $1 AND user_uuid = $2 AND archived_iso IS NULL`,
      [planId, userUuid],
    ),
  );
  if (planRow == null) return { status: 'no_active_plan' };

  const anchorRead = await resolvePrescribedPaceAnchors(userUuid, todayISO);
  if (!anchorRead.ok) {
    return { status: 'anchors_unavailable', reason: `${anchorRead.reason} · ${anchorRead.detail}` };
  }
  const anchors = anchorRead.anchors;
  const isRacePrep = planRow.mode === 'race-prep' || planRow.race_id != null;
  const arm: RepriceArm = isRacePrep ? 'race-prep' : 'maintenance';
  const priced = pricedAnchorsOf(planRow.authored_state);
  const sourceMode = anchors.basis.threshold.sourceMode;
  const pricedThreshold = priced?.threshold_s_per_mi != null ? Number(priced.threshold_s_per_mi) : null;

  const outcome = await writeReanchorProposal({
    userUuid,
    planId,
    arm,
    todayISO,
    fromVdot: anchorVdotFromState(null, planRow.authored_state),
    toVdot: anchors.basis.threshold.vdot,
    toSource: sourceMode,
    measured: sourceMode === 'direct',
    pricedAnchors: priced,
    liveAnchors: anchors,
    /* The VISIBLE findings are what triggered this pass, so they are what the
     * sentence is entitled to talk about — persisted row on the left, live
     * resolver on the right, exactly as `RepriceAnchorMove` reads. Threshold
     * stays as the fallback pair for the case where no finding is nameable. */
    reason: driftReason(
      visible.map((f): RepriceAnchorMove => ({
        key: f.anchorKey,
        fromSecPerMi: f.persistedSecPerMi,
        toSecPerMi: f.liveSecPerMi,
      })),
      anchors.thresholdSecPerMi,
      pricedThreshold,
    ),
    evidence: {
      detector: 'pace-drift-monitor',
      visible_findings: visible.map((f) => ({
        anchor_key: f.anchorKey,
        persisted_s_per_mi: f.persistedSecPerMi,
        live_s_per_mi: f.liveSecPerMi,
        persisted_display: f.persistedDisplay,
        live_display: f.liveDisplay,
      })),
      anchor_source: sourceMode,
      anchor_confidence: anchors.basis.threshold.confidence,
    },
  });

  return { status: 'proposed', outcome, visibleAnchorKeys: visible.map((f) => f.anchorKey) };
}
