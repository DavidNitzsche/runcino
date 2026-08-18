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

/**
 * How many opening weeks of a provisionally-anchored plan run their quality
 * sessions by EFFORT instead of at a fabricated pace.
 *
 * ── THIS IS A DATA-SUFFICIENCY CONVENTION, NOT A PHYSIOLOGICAL CLAIM ────────
 *
 * No passage in `Research/` states how long a runner should train by feel
 * before a pace is trustworthy, and inventing a citation for this number would
 * repeat exactly the defect `conservativeVdotFromMileage` was caught with — a
 * product convention laundered into a research finding, on the same cold-start
 * code path. So it is labelled as what it is, and `CONVENTION.calibration-
 * intro-window` in the doctrine registry enforces the labelling rather than the
 * value.
 *
 * What the value is chosen against: a threshold session is the one workout that
 * yields a clean VDOT read, and every plan this applies to carries at least one
 * per week. Two weeks is therefore the shortest window that gives the runner two
 * independent chances to produce the evidence that ENDS the window — one, plus
 * one for the week life gets in the way — while costing a runner who never
 * produces it only two sessions of an honest effort cue.
 *
 * The window is a ceiling, not a sentence: `reanchorActivePlan` ends it the day
 * a measured read lands, whether that is day three or day thirteen. If no read
 * lands, the plan returns to its provisional pace — which is the honest outcome,
 * because at that point nothing has changed about what we know.
 *
 * Lifted here from `seed-from-onboarding.ts` (2026-08-17) when the race-prep
 * path adopted the same intro, so both seeders read one number.
 */
export const CALIBRATION_INTRO_WEEKS = 2;

/**
 * Workout types whose pace the calibration intro replaces with an effort cue.
 *
 * The generic quality families only. Deliberately excluded:
 *
 *   · `easy` / `long` / `recovery` — the owner scoped this to the QUALITY
 *     sessions. Those bands are wide, HR-capped, and cued conversationally
 *     already; the defect being fixed is a rep pace presented as a target.
 *   · `race` and `race_week_tuneup` — both are priced off the runner's stated
 *     GOAL, not off the provisional fitness anchor, so neither carries the
 *     fabrication. They are also the two types `recomputePacesForPlan` exempts,
 *     for the same reason.
 */
export const EFFORT_CUED_TYPES: ReadonlySet<string> = new Set([
  'threshold', 'intervals', 'tempo', 'vo2max',
]);
