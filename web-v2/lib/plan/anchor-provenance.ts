/**
 * lib/plan/anchor-provenance.ts · COLD-3 (2026-08-17)
 *
 * Where a persisted VDOT anchor actually came from, and the one predicate that
 * decides whether a reader may treat it as fitness.
 *
 * `conservativeVdotFromMileage` turns a self-reported weekly-mileage bucket into
 * an asserted race performance — a 30 mi/wk answer becomes VDOT 40. That number
 * was persisted as `authored_state.pace_blend.season_anchor_vdot` carrying no
 * mark at all, so once written it was indistinguishable from a race result.
 * Three readers consumed it as demonstrated fitness:
 *
 *   · `adapt.ts` § detectFitnessRegression — compares the anchor to the first
 *     real measurement and reports the difference as fitness LOST
 *   · `recompute-paces.ts` § recomputePacesForPlan — grades measured progress
 *     against the fabricated starting point, and re-derives it when absent
 *   · `generate.ts` § generatePlan — inherits it into every rebuild, forever
 *
 * Deliberately dependency-free (no imports) so the writer (`generate.ts`) and
 * the readers can all reach it without an import cycle — `generate.ts` already
 * imports `recompute-paces.ts`.
 *
 * Doctrine: Design/adaptive-progression-engine.md §A — the fitness model is
 * evidence-only, and "non-evidence leaks" names `conservativeVdotFromMileage`
 * as one by construction. A provisional anchor may still SIZE a plan; it may
 * never be read back as a statement about the runner.
 */

/** Where a VDOT anchor came from. */
export type AnchorSource = 'measured_vdot' | 'below_table_anchor' | 'provisional_mileage';

/**
 * True when an anchor of this provenance must not be read as fitness.
 * Accepts `unknown` so readers can pass a raw jsonb field straight in.
 */
export function isProvisionalAnchor(source: unknown): boolean {
  return source === 'provisional_mileage';
}

/**
 * The single check a reader runs against a persisted `pace_blend` before
 * believing its `season_anchor_vdot`. Reads BOTH the source string and the
 * explicit boolean so either alone is sufficient, and treats a `pace_blend`
 * with neither (every plan authored before this commit) as non-provisional —
 * those all predate the mileage fallback reaching this column.
 */
export function paceBlendAnchorIsProvisional(paceBlend: unknown): boolean {
  if (paceBlend == null || typeof paceBlend !== 'object') return false;
  const pb = paceBlend as Record<string, unknown>;
  return isProvisionalAnchor(pb.season_anchor_source) || pb.season_anchor_provisional === true;
}
