/**
 * lib/brain/mutation/authority.ts · ONE AUTHORITY BOUNDARY.
 *
 * David, 2026-09-05: "AUTOMATIC_ADAPTATION_AUTHORITY=false is meaningless if
 * reanchorActivePlan can bypass it and rewrite 76 workouts."
 *
 * He is right, and it is verified: `lib/plan/reanchor-plan.ts` never consulted
 * the seam, and it is called from `app/api/cron/snapshot-projections/route.ts`,
 * an unattended scheduled job. On 2026-09-02 it moved VDOT 46.3 to 47.7 and
 * rewrote 76 workouts on a live plan while the flag said no automatic coaching
 * adaptation was permitted.
 *
 * CLOSED 2026-09-05 (REANCHORPROPOSES-1). The first fix classified that writer
 * as `COACHING_ADAPTATION` and handed it a named hold, which let it go on
 * writing — his verdict: "a hold that continues writing is an exemption with
 * better paperwork." The self-heal now PROPOSES; the plan moves under
 * `RUNNER_ACCEPTED`, on his tap. No `hold` is passed anywhere in the pace
 * layer, and `lib/plan/_reanchor_proposes.test.ts` fails if one returns.
 *
 * ── THE CONSOLIDATION, AND WHY IT IS NOT A NEW LAYER ───────────────────────
 *
 * `lib/plan/mutate.ts` has been the transactional door in front of
 * `plan_workouts` since it was written. Its own header says so: "This module is
 * the single door." What it did NOT do was ask who was knocking. It validated
 * the RESULT and never the AUTHORITY.
 *
 * So this is not a second door beside it. It is the question the existing door
 * failed to ask, and `MutatePlanOptions.authority` is now REQUIRED, which is
 * what forces every caller to classify itself rather than inherit a default.
 *
 * ── THE FIVE CLASSES ───────────────────────────────────────────────────────
 *
 * The classification is the whole mechanism. A write that cannot say which of
 * these it is does not get to happen.
 */
import { AUTOMATIC_ADAPTATION_AUTHORITY } from '@/lib/plan/adaptation-authority';

export type AuthorityClass =
  /**
   * The runner asked for this, in the app, now. A tap, an edit, a move.
   * Always permitted: it is his plan.
   */
  | 'RUNNER_INITIATED'
  /**
   * The runner accepted a proposal the engine raised. Also always permitted,
   * and it is the destination the whole adaptation loop is built toward: the
   * engine decides, the runner consents, the plan changes.
   */
  | 'RUNNER_ACCEPTED'
  /**
   * Automatic bookkeeping that does not change the TRAINING: sealing a past
   * week, stamping a lifecycle fact, refreshing a race row's own metadata.
   *
   * Permitted, and deliberately narrow. David: "Lifecycle bookkeeping must be
   * explicitly defined and logged, not waved through as an exemption." So a
   * LIFECYCLE write must name what bookkeeping it is doing, and if it changes
   * a prescription's demand it is not lifecycle, whatever it calls itself.
   */
  | 'LIFECYCLE'
  /**
   * The engine changing the runner's training on its own judgement. THIS is
   * what the seam governs, and while `AUTOMATIC_ADAPTATION_AUTHORITY` is false
   * it is REFUSED. The engine may still calculate, persist a decision and
   * raise a proposal; it may not write the plan.
   */
  | 'COACHING_ADAPTATION'
  /**
   * Creating a plan that did not exist. Not a change to training, because
   * there was no training to change. Authoring has its own gate in
   * `validateComposedPlan`.
   */
  | 'AUTHORSHIP';

export interface AuthorityVerdict {
  readonly permitted: boolean;
  /** Why, in one sentence, for the ledger and for a log line. */
  readonly because: string;
  /**
   * What the caller should do INSTEAD when refused. Never empty on a refusal:
   * a boundary that only says no teaches the next author nothing, and the
   * whole point of refusing a coaching adaptation is that it becomes a
   * proposal rather than disappearing.
   */
  readonly insteadDo: string | null;
}

/**
 * May a write of this class happen right now?
 *
 * The only class the seam governs is `COACHING_ADAPTATION`. That is deliberate
 * and it is the distinction the previous seam blurred: `tryAdaptiveBump` asked
 * "may I mutate at all", which is why a runner-consented change and an
 * unattended one were the same question.
 */
export function mutationIsPermitted(authority: AuthorityClass): AuthorityVerdict {
  switch (authority) {
    case 'RUNNER_INITIATED':
      return { permitted: true, because: 'the runner asked for this', insteadDo: null };
    case 'RUNNER_ACCEPTED':
      return { permitted: true, because: 'the runner accepted a proposal', insteadDo: null };
    case 'AUTHORSHIP':
      return { permitted: true, because: 'a plan is being created, not changed', insteadDo: null };
    case 'LIFECYCLE':
      return {
        permitted: true,
        because: 'automatic bookkeeping that does not change prescribed training',
        insteadDo: null,
      };
    case 'COACHING_ADAPTATION':
      if (AUTOMATIC_ADAPTATION_AUTHORITY as boolean) {
        return { permitted: true, because: 'automatic coaching authority is open', insteadDo: null };
      }
      return {
        permitted: false,
        because: 'automatic coaching adaptation is sealed, so the engine may not write the plan',
        insteadDo: 'persist the decision and raise a runner-visible proposal, then apply it '
          + 'under RUNNER_ACCEPTED when he accepts',
      };
  }
}

/**
 * A LIFECYCLE write that changes prescribed demand is not lifecycle.
 *
 * This exists because "lifecycle" is the label an unattended coaching change
 * reaches for when it needs to get past a gate, and the owner named that risk
 * directly. The check is deliberately crude: it asks whether the write touched
 * the quantities a runner actually experiences. It cannot catch a caller that
 * lies about what it touched, and says so rather than pretending otherwise.
 */
export const DEMAND_BEARING_COLUMNS: readonly string[] = [
  'distance_mi', 'duration_min', 'pace_target_s_per_mi', 'type', 'is_quality',
  'is_long', 'workout_spec', 'date_iso',
];

export function lifecycleClaimIsHonest(
  columnsTouched: readonly string[],
): { readonly ok: boolean; readonly why: string } {
  const demand = columnsTouched.filter((c) => DEMAND_BEARING_COLUMNS.includes(c));
  if (demand.length === 0) {
    return { ok: true, why: 'touched no column the runner experiences as training' };
  }
  return {
    ok: false,
    why: `claimed LIFECYCLE while writing ${demand.join(', ')}, which the runner experiences as `
      + 'a change to his training. That is a coaching adaptation and the seam governs it.',
  };
}
