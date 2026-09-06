/**
 * lib/runner-state/store/lineage.ts · THE ONE PLACE THE BELIEF STORE ASKS
 * "WHICH PLAN LINEAGE IS THIS RUNNER ON RIGHT NOW."
 *
 * `lib/brain/ledger/decision-ledger.ts#resolvePlanLineage` already solved plan
 * lineage for `plan_decision_ledger`: four rungs — the lineage the ledger
 * already knows for a REPLACED plan, the replaced plan's own id when the
 * ledger has never seen it, the lineage the ledger knows for THIS plan, and
 * this plan's own id, with `orphan:<user uuid>` when there is no plan at all.
 * That IS the pattern the task brief points at ("reuse its lineage-resolution
 * pattern, don't reinvent it"), so this file calls it rather than
 * re-implementing the chase.
 *
 * What THIS file adds is the one thing the ledger's function does not do:
 * resolve WHICH plan a runner's CURRENT belief update is about, since a
 * belief update (unlike a ledger entry) is not always triggered by a plan
 * mutation and so has no `planId` / `replacedPlanId` handed to it by a caller.
 * The rule is Rule 14's — name the population explicitly — applied to "the
 * active plan": `training_plans WHERE user_uuid = $1 AND archived_iso IS
 * NULL`, the same predicate `app/api/race/route.ts` and the adaptation engine
 * already use for "the plan this runner is currently on."
 *
 * ── WHY `replacedPlanId` IS ALWAYS THE MOST RECENTLY ARCHIVED PLAN ──────────
 *
 * `lib/plan/mutate.ts#buildLedgerEntry` only ever passes `replacedPlanId` at
 * the EXACT moment a rebuild happens — it has the old plan's id in hand from
 * the mutation it is recording. A belief update has no such moment; it runs
 * on a schedule, not on a rebuild event. So this file always looks up the
 * most recently ARCHIVED plan for this runner and offers it as
 * `replacedPlanId` on every call, rebuild or not.
 *
 * This is safe, not merely convenient, because of what `resolvePlanLineage`
 * actually does with it: `known(replacedPlanId)` reads the LATEST ledger row
 * already stamped for that archived plan's id, which does not change once
 * the plan is archived (nothing writes new rows against an old plan id).
 * So offering it on every call — the day after a rebuild or a hundred days
 * into the same plan's life — resolves to the exact same lineage every time;
 * it is idempotent, not a moving target. `_belief_store.db.test.ts`'s rebuild
 * proof drives this across a real archive-and-replace and asserts the chain.
 *
 * The one gap this does not close: if an intermediate plan was archived
 * WITHOUT EVER being recorded in `plan_decision_ledger` (no mutation, no
 * belief update ran while it was active), its own lineage was never chained
 * forward and `known()` returns null for it, restarting the chain at that
 * plan's own id. Named rather than hidden: production's ledger is written on
 * every ordinary plan mutation (LEDGERATOMIC-1), so this requires a plan that
 * was rebuilt twice with nothing at all happening to it in between.
 */
import { resolvePlanLineage } from '@/lib/brain/ledger/decision-ledger';
import type { LedgerExecutor } from '@/lib/brain/ledger/decision-ledger';

export interface RunnerPlanContext {
  /** Null when the runner has no unarchived plan right now. */
  readonly activePlanId: string | null;
  readonly planLineageId: string;
}

/**
 * Resolve the plan lineage a belief stamped RIGHT NOW should carry.
 *
 * `exec` must be the SAME transaction/connection the belief write will use
 * when one is available, for the identical reason `resolvePlanLineage`'s own
 * doc comment gives: reading lineage on a different connection than the one
 * about to write risks a different snapshot of `training_plans` /
 * `plan_decision_ledger` than the writer sees. A read-only belief LOAD (step
 * 1) may pass the bare pool; a belief WRITE that is itself tied to a plan
 * mutation should pass that mutation's own transaction.
 */
export async function resolveRunnerLineage(
  exec: LedgerExecutor,
  userUuid: string,
): Promise<RunnerPlanContext> {
  const active = await exec.query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  );
  const activePlanId = active.rows[0]?.id ?? null;

  const archived = await exec.query<{ id: string }>(
    `SELECT id FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NOT NULL
      ORDER BY archived_iso DESC LIMIT 1`,
    [userUuid],
  );
  const mostRecentlyArchivedPlanId = archived.rows[0]?.id ?? null;

  const planLineageId = await resolvePlanLineage({
    userUuid,
    planId: activePlanId,
    replacedPlanId: mostRecentlyArchivedPlanId,
    on: exec,
  });
  return { activePlanId, planLineageId };
}
