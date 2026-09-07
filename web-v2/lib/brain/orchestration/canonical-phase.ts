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
 *
 * ── OPTIONLANE-1 (2026-09-07) · TWO MORE SYMBOLS, AND THE ARGUMENT FOR EACH ─
 *
 * `lib/brain/option-lane.ts` needs step 9's arbitration for a decision it
 * makes in `lib/brain`, and its first cut imported
 * `@/lib/adaptation/canonical/phase-priority` directly. The seal check caught
 * it immediately and correctly — that was a SECOND DOOR, which is the whole
 * thing this file exists to prevent. Routing it here rather than adding an
 * exemption is the intended remedy, and it keeps the property the gate
 * actually asserts: one auditable file for the whole directory's dependence.
 *
 * `resolveArbitrationPriority` · step 9's canonical owner, per
 * `orchestration/steps.ts`. It is PURE by the same standard as
 * `phaseFromAuthoredLabel`: it takes a `PriorityContext` of five plain values
 * and returns a `ResolvedPriority`. It reads no plan, opens no pool, and
 * writes nothing — `_forbidden_inputs.test.ts` already scans its inputs, and
 * `phase-priority.ts` passes the seal's guards 1-3, so it cannot carry a plan
 * write regardless of who calls it. The alternative was a second arbitrator
 * inside `lib/brain`, which `docs/BRAIN_CONSTITUTION.md` forbids outright.
 *
 * `CanonicalLever` · a TYPE ONLY, and the vocabulary the resolution above is
 * expressed in. Re-exported so a caller can name what came back without
 * reaching past this file for the word to say it with. A type carries no
 * runtime edge at all.
 *
 * Both are re-exported rather than re-implemented for the reason the header
 * above already gives about `phaseFromAuthoredLabel`: two readings of one
 * question drift the first time either changes, and here the drift would put
 * a taper week into a build ordering while both sides looked correct.
 */
export { phaseFromAuthoredLabel, type TrainingPhase } from '@/lib/adaptation/canonical/phase-priority';
export { resolveArbitrationPriority } from '@/lib/adaptation/canonical/phase-priority';
export type { PriorityContext, ResolvedPriority } from '@/lib/adaptation/canonical/phase-priority';
export type { CanonicalLever } from '@/lib/adaptation/canonical/input';
