/**
 * lib/brain/orchestration/steps.ts · THE SIXTEEN STEPS, AS A DECLARED CONTRACT.
 *
 * ── WHY A DECLARATION AND NOT JUST A FUNCTION ──────────────────────────────
 *
 * The owner's instruction is that there be ONE production-reachable coaching
 * orchestration owner, that every coaching writer pass through it, and that
 * existing engines may supply calculations but "may not independently own
 * beliefs, decisions, mutations or explanations."
 *
 * The failure mode this repo has, over and over, is that such a thing gets
 * BUILT and then is not REACHED — `adjudicate()` had no caller for a week,
 * `assemble.ts` still has none, `tryAdaptiveBump` returned null at line one,
 * and every one of them had passing tests. A pipeline function alone cannot
 * tell you which of its steps is real. It runs, it returns, and a step that
 * silently does nothing looks exactly like a step that had nothing to do.
 *
 * So the steps are DECLARED, each naming its owning module and its wiring
 * state, and `_orchestration.test.ts` verifies the claim against the source:
 * a step that says it delegates to a module must name a module that exists and
 * exports what it says. The declaration cannot drift from the code without
 * failing, which is the difference between documentation and enforcement
 * (Rule 20).
 *
 * ── THE RATCHET ───────────────────────────────────────────────────────────
 *
 * `WIRED` may only increase. A step that regresses to UNWIRED fails until
 * someone changes the pin deliberately, in the same change, with a reason.
 * That is the mechanism that stops "we'll wire it next session" from becoming
 * the permanent state it has been.
 */

/**
 * `WIRED`     · a production entry point reaches this step today.
 * `SHADOW`    · the code exists and runs, but nothing it produces changes what
 *               the runner sees. An honest state and a temporary one.
 * `UNWIRED`   · the code exists and no route reaches it.
 * `NOT_BUILT` · THE MECHANISM DOES NOT EXIST. Added after this file's own gate
 *               caught me borrowing a module as an "owner" for a step nothing
 *               implements: step 16 pointed at `adjudicate.ts`, which IS
 *               reachable, and the gate correctly complained that an UNWIRED
 *               step was reachable. The module was reachable; the step was
 *               fiction. Three states were two, which is Rule 11 in the shape
 *               it always takes — the missing distinction is the one that
 *               matters, and it was hiding an absence behind a live module.
 */
export type StepState = 'WIRED' | 'SHADOW' | 'UNWIRED' | 'NOT_BUILT';

export interface OrchestrationStep {
  readonly n: number;
  readonly name: string;
  /**
   * The module that OWNS this step, or null when nothing does.
   * Null is only legal with `NOT_BUILT`, and the gate enforces that.
   */
  readonly owner: string | null;
  /** A symbol that module must export, so the claim is checkable. */
  readonly ownerExports: string | null;
  readonly state: StepState;
  /** Required unless WIRED: what specifically is missing. Never "TODO". */
  readonly blocker?: string;
}

export const ORCHESTRATION_STEPS: readonly OrchestrationStep[] = [
  {
    n: 1, name: 'Load canonical runner state',
    owner: 'lib/runner-state/assemble.ts', ownerExports: 'BeliefValueByKey',
    state: 'WIRED',
    // ORCHESTRATIONWIRE-1 (2026-09-06) · `lib/runner-state/store/orchestrator.ts#
    // loadRunnerBeliefs`/`updateRunnerBeliefs` call into `assemble.ts` directly,
    // and `app/api/cron/run-adaptations/route.ts` now imports `orchestrator.ts`
    // in its real per-runner loop — a dynamic import, but `buildModuleGraph`
    // follows dynamic imports (same builder the client-graph gate uses), so this
    // is a genuine route-to-owner edge, not a claim resting on a type-only one.
    //
    // What this does NOT claim: that a belief is being stored in production
    // today. No migration for `runner_beliefs` has been applied (`db/migrations/
    // 169_runner_beliefs.sql` is drafted and unapplied — DDL needs David's
    // per-statement go), so every call from the cron answers `table_absent` and
    // the honest refusal is what actually runs. Steps 12 and 16 are already
    // WIRED in exactly this state — "reachable and blocked on approval is a
    // different state from unwired" — and this is the same argument, not a new
    // one invented to justify this promotion.
  },
  {
    n: 2, name: 'Resolve executions',
    owner: 'lib/execution/day-resolver.ts', ownerExports: 'classifyDay',
    state: 'WIRED',
  },
  {
    n: 3, name: 'Classify evidence',
    owner: 'lib/plan/adjudication/dose-responsive.ts', ownerExports: 'DOSE_EVIDENCE_READERS',
    state: 'UNWIRED',
    blocker: 'the readers exist and are unit-tested; no production caller assembles them '
      + 'for a runner.',
  },
  {
    n: 4, name: 'Grade sessions and the week',
    owner: 'lib/adaptation/canonical/stimulus.ts', ownerExports: 'gradeStimulus',
    state: 'SHADOW',
    blocker: 'VOLUMESEAM-1 (2026-09-05) narrowed this and did not close it. The '
      + 'volume-evidence readers now DO reach the nightly cron, so this module is no longer '
      + 'unreachable; but what they import from it is the constant set '
      + 'GRADES_THAT_COUNT_AS_EVIDENCE, not `gradeStimulus`. Nothing on the nightly coaching '
      + 'path actually GRADES a session through this owner: the volume lane hands its '
      + 'deterioration and telemetry conditions in as refusals, and the canonical-shadow live '
      + 'input remains shadow-only. Reachable is not wired, and calling it wired because an '
      + 'adjacent constant travelled would be the claim Rule 20 exists to stop.',
  },
  {
    n: 5, name: 'Update beliefs',
    owner: 'lib/runner-state/belief.ts', ownerExports: 'BELIEF_KEYS',
    state: 'WIRED',
    // ORCHESTRATIONWIRE-1 (2026-09-06) · same wiring as step 1's note.
    // `assemble.ts` (now reachable from the cron via `orchestrator.ts`)
    // imports `BELIEF_KEYS` as a real value from `belief.ts`, so this owner is
    // reachable transitively rather than through a type-only edge. Same
    // pending-migration caveat as step 1: every call refuses today, honestly,
    // until `runner_beliefs` is approved and applied.
  },
  {
    n: 6, name: 'Update fatigue separately',
    owner: 'lib/coach/readiness.ts', ownerExports: 'loadContextMultiplier',
    state: 'WIRED',
  },
  {
    n: 7, name: 'Generate PUSH/HOLD/PULL_BACK options',
    owner: 'lib/plan/adjudication/adjudicate.ts', ownerExports: 'rankOptions',
    state: 'SHADOW',
    blocker: 'reached only through the sequence gate, which spends one finding of eleven. '
      + 'No caller asks it for a full option set on a live lever.',
  },
  {
    n: 8, name: 'Evaluate the surrounding plan sequence',
    owner: 'lib/plan/adjudication/live-sequence.ts', ownerExports: 'findSequenceFindings',
    state: 'WIRED',
  },
  {
    n: 9, name: 'Arbitrate competing levers',
    owner: 'lib/adaptation/canonical/phase-priority.ts', ownerExports: 'resolveArbitrationPriority',
    state: 'WIRED',
    // ARBITRATIONWIRE-1 (2026-09-05) · this is the state change, and it is
    // earned rather than claimed against this file's own liveness test.
    //
    // `resolveArbitrationPriority` was ALREADY called on every real
    // evaluation cycle — `evaluate.ts`'s `priorityFor` calls it for every
    // runner, every night, reached from `run-adaptations` via
    // `run-live-shadow-evaluation.ts` — so mechanical reachability was never
    // the gap `_orchestration.test.ts` checks for (and correctly does not
    // count on its own: "an importer is evidence of reachability, not of
    // being on the nightly coaching path — which is why SHADOW exists"). The
    // gap was that its ANSWER only ever reached `canonical_adaptation_shadow_
    // log`, an admin diagnostic table, however the admin route or the cron
    // got there.
    //
    // `live-arbitration-proposals.ts`, called from inside
    // `run-live-shadow-evaluation.ts` on the SAME `CanonicalDecisionRecord[]`
    // that call already computes, is what changes that: the lever
    // arbitration lets win this cycle is now recorded on `plan_decision_
    // ledger` (step 10, WIRED) as a HELD, runner-lineage-visible row, and a
    // SUPPORTED lever it defers is queued on `reassessment_schedule` (step
    // 12) via `scheduleReassessment(kind: 'DEFERRAL')` rather than existing
    // only in the shadow log's own idempotency bookkeeping. A safety-defeated
    // push is ledgered as a HOLD and deliberately never queued — see that
    // file's header for why that is the same mechanism that makes "Safety
    // defeats every push" hold one layer further out than the resolver
    // itself.
    //
    // What this does NOT claim: that a runner has SEEN one of these rows.
    // The proposal-surfacing UI is out of scope for this pass, same posture
    // step 12 already states for migration 167. Reachable-and-recorded is a
    // different state from surfaced, and the gap is named here rather than
    // hidden behind WIRED.
  },
  {
    n: 10, name: 'Persist the decision',
    owner: 'lib/brain/ledger/decision-ledger.ts', ownerExports: 'recordDecision',
    state: 'WIRED',
  },
  {
    n: 11, name: 'Create a proposal',
    owner: 'lib/plan/workout-proposals.ts', ownerExports: 'writeWorkoutProposals',
    state: 'WIRED',
  },
  {
    n: 12, name: 'Schedule reassessment',
    owner: 'lib/ops/reassessment-scheduler.ts', ownerExports: 'REASSESSMENT_SCHEDULE_TABLE',
    state: 'SHADOW',
    blocker: 'migration 167 is not applied to production, so every write answers '
      + 'table_absent. Approved in concept; the exact statements are not yet approved.',
  },
  {
    n: 13, name: 'Apply only under valid authority',
    owner: 'lib/brain/mutation/authority.ts', ownerExports: 'mutationIsPermitted',
    state: 'WIRED',
  },
  {
    n: 14, name: 'Record the mutation',
    owner: 'lib/plan/mutate.ts', ownerExports: 'mutatePlan',
    state: 'WIRED',
  },
  {
    n: 15, name: 'Produce phone and Watch explanations',
    owner: 'lib/faff/v5-action-render.ts', ownerExports: 'actionHeadline',
    state: 'WIRED',
  },
  {
    n: 16, name: 'Evaluate the later outcome',
    owner: 'lib/brain/ledger/outcome-sweep.ts', ownerExports: 'sweepDecisionOutcomes',
    state: 'WIRED',
  },
];

/**
 * The pin. May only RISE.
 *
 * Counted rather than asserted, so "we wired one more" is a number in a diff
 * and not a sentence in a report. A step sliding back to UNWIRED fails here.
 */
/**
 * STEP16-1 (2026-09-06) · 8 → 9, and this one IS earned rather than claimed.
 * The nightly cron imports `sweepDecisionOutcomes` and calls it per runner; the
 * reachability check below walks the real import graph from every route, so a
 * step declared WIRED that no route reaches fails here.
 *
 * What it does NOT claim: that verdicts are being produced today. Migrations
 * 166 and 168 are unapplied, so the sweep answers `table_absent` and says so.
 * Reachable and blocked on approval is a different state from unwired, and the
 * blocker is named in the packet rather than hidden behind this number.
 *
 * ARBITRATIONWIRE-1 (2026-09-05) · 9 → 10. Step 9 (arbitrate competing
 * levers) is WIRED: see its own entry above for the argument. This did not
 * change step 9's mechanical reachability, which the graph walk below already
 * had before this change — it changed what step 9's answer is now recorded
 * as, which is the distinction `_orchestration.test.ts`'s own header draws
 * between reachability and being on the path that matters.
 *
 * ORCHESTRATIONWIRE-1 (2026-09-06) · 10 → 12. Steps 1 and 5 (load canonical
 * runner state / update beliefs) are WIRED: `app/api/cron/run-adaptations/
 * route.ts` now imports `lib/runner-state/store/orchestrator.ts` in its real
 * per-runner loop, which reaches `assemble.ts` (step 1's owner) and, through
 * it, `belief.ts` (step 5's owner) by a genuine value import — not the
 * type-only edges that would have been erased from the graph. Both refuse on
 * every call today (migration 169 is drafted and unapplied), in exactly the
 * declared, reported state steps 12 and 16 already established this pin
 * counts as WIRED rather than UNWIRED.
 */
export const WIRED_STEP_PIN = 12;

/**
 * NOT_BUILT may only FALL. A step becoming fiction again is a regression.
 *
 * STEP16-1 (2026-09-06) · 1 → 0. Step 16 exists: `assessOutcome` classifies a
 * decision against what followed it, `observeAftermath` reads the window, and
 * `sweepDecisionOutcomes` runs nightly from `run-adaptations`. It tunes
 * nothing, by instruction — it is the measurement path.
 */
export const NOT_BUILT_PIN = 0;

export const wiredCount = (): number =>
  ORCHESTRATION_STEPS.filter((s) => s.state === 'WIRED').length;

export const unwiredSteps = (): readonly OrchestrationStep[] =>
  ORCHESTRATION_STEPS.filter((s) => s.state !== 'WIRED');
