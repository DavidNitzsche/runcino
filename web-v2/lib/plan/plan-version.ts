/**
 * lib/plan/plan-version.ts · THE PLAN VERSION STRING, ONCE.
 *
 * `planVersion` identifies a plan AND its mutation generation. The client
 * caches days against it, and — as of the action schema — a pending proposal
 * records it so that accepting a three-day-old card cannot write over a plan
 * that has been rebuilt underneath it.
 *
 * It was constructed independently in four places: `week-loader.ts`,
 * `plan-snapshot.ts`, the v5 Today route, and (about to be) the proposal
 * staleness check. All four agreed, which is the dangerous kind of duplication
 * — nothing would have failed on the day one of them stopped agreeing, and
 * CLAUDE.md Rule 16 is explicit that one quantity gets one name and one
 * resolver.
 *
 * The two fields are both load-bearing. `id` alone misses an in-place
 * adaptation (same plan, new prescription); `last_adapted_at` alone misses a
 * full rebuild that lands in the same second. PLANVERSION-1 stamps the second
 * field in exactly one place — `mutatePlan`'s `stampAdapted` — and
 * `check-planversion-ratchet.sh` is the gate that keeps it that way.
 */

/** The row shape every caller already has in hand. */
export interface PlanVersionSource {
  readonly id: string;
  readonly last_adapted_at: Date | string | null;
}

/**
 * `${id}:${last_adapted_at}`, with a literal `none` when the plan has never
 * been adapted — NOT an empty string, so "never adapted" and "field missing"
 * stay distinguishable in a log (Rule 11).
 */
export function planVersionOf(plan: PlanVersionSource): string {
  const stamp = plan.last_adapted_at;
  if (stamp === null || stamp === undefined) return `${plan.id}:none`;
  return `${plan.id}:${stamp instanceof Date ? stamp.toISOString() : String(stamp)}`;
}

/** Null plan, null version. A caller with no plan has no version to compare. */
export function planVersionOrNull(plan: PlanVersionSource | null | undefined): string | null {
  return plan ? planVersionOf(plan) : null;
}
