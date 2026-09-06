/**
 * lib/brain/orchestration/canonical-phase.ts · THE ONE DOOR.
 *
 * `lib/adaptation/canonical/` is sealed. Nothing outside it may import the
 * engine except narrowly enumerated entry points, because that seal is what
 * stops a pure evaluator acquiring a plan write through a side door. Two gates
 * enforce it — `_cannot_mutate.test.ts` guard 4 and
 * `_never_mutates_plan.test.ts` guard 4 — and both see `export … from`
 * re-exports, so this file is a declared door and not a laundering of one.
 *
 * ONE file per directory, in the pattern MILEAGE-RESPONSIVE-1 set for
 * `lib/adaptation/volume-evidence/` and ROLLINGBOUNDARY-1 set for
 * `lib/plan/adjudication/`: a whole directory's dependence on the canonical
 * engine is auditable in one place rather than scattered across its members.
 *
 * ── WHY THIS ONE SYMBOL, AND WHY IT IS NOT OPTIONAL ────────────────────────
 *
 * `move-orchestrator.ts` re-prices both weeks a move touches and reports how
 * the week's DEMAND moved. A demand rise means completely different things in
 * two different phases — a taper week is meant to fall, and a build week is
 * meant to climb — so a report that did not know the phase would have to either
 * stay silent about the one fact that gives the number meaning, or coin its own
 * phase vocabulary from `plan_phases.label`.
 *
 * The second is the Rule 16 defect this repo has paid for repeatedly, and it is
 * the exact one PHASEARB-1 already argued when the canonical loader needed the
 * same translation: two readings of "is this a taper" would drift the first
 * time either changed, and the drift would put a taper week into a build
 * ordering while both sides looked individually correct.
 *
 * `phaseFromAuthoredLabel` is a PURE STRING SWITCH with a Rule 11 default of
 * `UNKNOWN`. It reads no plan, opens no pool, writes nothing, and it lives in a
 * file that already passes the seal's guards 1-3, so it cannot carry a plan
 * write regardless of who calls it. The allowlist exists to catch scope creep,
 * not because this symbol is suspected.
 *
 * NOTHING ELSE MAY BE ADDED HERE without an entry in both gates' allowlists.
 */
export { phaseFromAuthoredLabel, type TrainingPhase } from '@/lib/adaptation/canonical/phase-priority';
