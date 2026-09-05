/**
 * lib/plan/adjudication/canonical-demand.ts · THE ONE DOOR.
 *
 * `lib/adaptation/canonical/` is sealed: nothing outside it may import the
 * engine except narrowly enumerated entry points, because that seal is what
 * stops a pure evaluator acquiring a plan write through a side door. Two gates
 * enforce it — `_cannot_mutate.test.ts` guard 4 and
 * `_never_mutates_plan.test.ts` guard 4 — and both caught this directory
 * reaching for the demand model directly.
 *
 * This is the door, in the pattern MILEAGE-RESPONSIVE-1 set for
 * `lib/adaptation/volume-evidence/`: ONE file per directory, so a whole
 * directory's dependence on the canonical engine is auditable in one place
 * rather than scattered across its members.
 *
 * ── WHY THIS DEPENDENCE IS THE RIGHT ONE TO HAVE ───────────────────────────
 *
 * `projectPlanLoad` prices a week as one comparable scalar: weekly miles, plus
 * the long-run surcharge, plus quality minutes. The adjudication layer needs
 * exactly that, because "three stressors versus three stressors" is not a
 * measure of demand and the owner said so:
 *
 *   "A controlled 10K followed immediately by 17 miles may cost more than the
 *    earlier three-stressor week."
 *
 * The alternative to importing it is re-deriving it here, which would be a
 * second opinion about what a week costs and would drift the first time a
 * coefficient moved — the Rule 16 defect this repo has paid for repeatedly
 * (three projected finishes, five threshold owners, four planVersion copies).
 *
 * `projectPlanLoad` is pure, takes plain numbers and returns plain numbers, and
 * lives in a file that already passes the seal's own guards 1-3, so it cannot
 * carry a write regardless of who calls it. The allowlist exists to catch scope
 * creep, not because this symbol is suspected.
 *
 * NOTHING ELSE MAY BE ADDED HERE without an entry in both gates' allowlists.
 */
export { projectPlanLoad, type ProjectedPlanLoad } from '@/lib/adaptation/canonical/plan-load';
