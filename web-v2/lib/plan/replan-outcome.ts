/**
 * lib/plan/replan-outcome.ts · one resolver for "what does an
 * `AutoRebuildResult` mean to a runner-facing PATCH response."
 *
 * REBUILDTRUTH-1 (2026-09-05, `/api/profile/route.ts`) and its
 * `/api/settings/route.ts` sibling (2026-09-09, item 8 of
 * `docs/audit-2026-09-08-full-status-master-report.md` §10a): both PATCH
 * handlers used to compute `replanned = !!r.ok`, which reads TRUE for two
 * outcomes where no plan was actually replaced —
 *
 *   · `deduped_within_Ns`  — nothing ran at all (a burst of rapid PATCHes)
 *   · `unchanged`          — the rebuild ran and was rolled back, because the
 *                            block it produced was the block the runner
 *                            already had (`auto-rebuild.ts` distinguishes
 *                            this precisely so a notice card never points at
 *                            a `new_plan_id` equal to the plan the runner was
 *                            already on)
 *
 * — exactly as much as for a genuine replan. `newPlanId` is the honest
 * discriminator and is already on `AutoRebuildResult` (absent on both of the
 * above, present on a real replan). This is the ONE place that reads it
 * (Rule 16 — one quantity, one name), so the two routes cannot drift back
 * into two different answers to "did this PATCH replan the runner's plan."
 *
 * A thrown rebuild (network blip, `generatePlan` exception) is Rule 11's
 * third fact, not a quiet "no change": the caller must pass a `reason`
 * string on that path (both routes' `.catch` already stamp
 * `"the rebuild threw: <message>"`) so `replanReason` names the failure
 * instead of reading as an ordinary "nothing to do."
 */
import type { AutoRebuildResult } from '@/lib/plan/auto-rebuild';

export type ReplanStatus = 'replanned' | 'no_change' | 'not_replanned' | 'not_attempted';

export interface ReplanOutcome {
  replanned: boolean;
  replanStatus: ReplanStatus;
  replanReason: string | null;
}

/** The outcome when no plan-shaping field changed — the rebuild was never attempted. */
export const REPLAN_NOT_ATTEMPTED: ReplanOutcome = {
  replanned: false,
  replanStatus: 'not_attempted',
  replanReason: null,
};

export function resolveReplanOutcome(r: AutoRebuildResult): ReplanOutcome {
  const newPlanId = r.newPlanId ?? null;
  const replanned = Boolean(r.ok && newPlanId);
  const replanStatus: ReplanStatus = replanned
    ? 'replanned'
    : r.ok ? 'no_change' : 'not_replanned';
  const replanReason = replanned ? null : (r.reason ?? 'the rebuild produced no new plan');
  return { replanned, replanStatus, replanReason };
}
