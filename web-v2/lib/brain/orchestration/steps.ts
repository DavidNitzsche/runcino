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
    // OPTIONLANE-1 (2026-09-07) · DELIBERATELY LEFT UNWIRED, and the reason is
    // worth more than the flip would have been.
    //
    // `lib/brain/option-lane.ts` now calls `classifyEvidence` (`lib/evidence/
    // classify-evidence.ts`) for every canonical run in a 28-day window, on the
    // live nightly path — the FIRST production caller that 19-tag record has
    // ever had, and the thing that finally gives `completion.partial` and
    // `completion.overrun` a downstream decision. Measured on the owner's own
    // block: 23 runs classified, 2 partial, 1 overrun, 13 unreadable, and those
    // counts reach the appraisal and the decline sentence.
    //
    // That is NOT this step as declared. This row's owner is
    // `DOSE_EVIDENCE_READERS`, and its blocker — "no production caller
    // assembles them for a runner" — is STILL TRUE WORD FOR WORD. Flipping the
    // state because a DIFFERENT evidence classifier got wired is exactly the
    // borrowed-owner defect this file's own header records being caught at
    // once already ("step 16 pointed at adjudicate.ts, which IS reachable, and
    // the gate correctly complained").
    //
    // What this does surface is a Rule 16 question that predates this change
    // and is not mine to settle: TWO modules answer "classify evidence" — the
    // 19-tag `EvidenceClassification` and the dose-axis readers — and the
    // constitution allows one owner per question. Either they are two
    // questions and this row needs a name that says which one it is, or one of
    // them is the answer and the other should go. Named here rather than
    // resolved by a state flip.
    blocker: 'the readers exist and are unit-tested; no production caller assembles them '
      + 'for a runner.',
  },
  {
    n: 4, name: 'Grade sessions and the week',
    owner: 'lib/adaptation/canonical/stimulus.ts', ownerExports: 'gradeStimulus',
    state: 'WIRED',
    // STIMULUSWIRE-1 (2026-09-06) · this SHADOW claim went stale the same day
    // it was written, and nobody revisited it when the sibling change landed.
    // VOLUMESEAM-1 (2026-09-05) was correct about the volume-evidence lane in
    // isolation, but its "the canonical-shadow live input remains shadow-only"
    // clause stopped being true within the SAME session, when ARBITRATIONWIRE-1
    // (also 2026-09-05, and step 9's own promotion above) put that exact live
    // input on a path that reaches the ledger. Re-traced by hand against the
    // real source, not the graph tool, because `gradeStimulus` is the case Rule
    // 20 warns about: an adjacent symbol having travelled is not the same as
    // THIS one being called, so the chain below is followed one file at a time:
    //
    //   app/api/cron/run-adaptations/route.ts:278-280 dynamically imports and
    //     calls `runAndPersistCanonicalShadowEvaluation`
    //   → lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts:252
    //     calls `buildLiveCanonicalInput(userUuid)`
    //   → lib/adaptation/canonical-shadow/live-input.ts:754, inside
    //     `buildLiveCanonicalInput`, calls `buildGradedSession(...)`
    //   → live-input.ts:455, inside `buildGradedSession`, calls
    //     `gradeStimulus(input)` and takes `.grade` as the session's grade
    //     (live-input.ts:460 `grade: assessment.grade`) — THIS is the step
    //   → that `GradedSession[]` becomes `input.qualitySessions`
    //     (canonical/input.ts:477), consumed by two levers inside
    //     evaluate.ts:168-173 (`evaluateWeeklyVolume({ keySessions: … })`) and
    //     evaluate.ts:186-189 (`evaluateThresholdPace({ sessions: … })`)
    //   → the grade is not passed through unused: levers/threshold-pace.ts:222
    //     weights evidence by it (`q.s.grade === 'FULL' ? 1 : 0.5`) and
    //     levers/weekly-volume.ts:459 filters by it
    //     (`GRADES_THAT_COUNT_AS_EVIDENCE.has(s.grade)`)
    //   → the resulting `LeverVerdict[]` become `evaluation.records`, and
    //     run-live-shadow-evaluation.ts:337 calls
    //     `persistArbitratedProposals(userUuid, evaluation.records)`
    //   → live-arbitration-proposals.ts:167/263 calls `recordDecision(...)`
    //     (step 10's owner), a real write to `plan_decision_ledger`.
    //
    // What this does NOT claim: that every runner has a quality session to
    // grade on every cycle (`qualitySessions` is legitimately empty on an
    // easy-only day, same as any other evidence-shaped step). It claims the
    // grading function sits ON the path from a real cron entry point to a
    // real ledger write, which is the bar steps 1/5/9/12/16 were already held
    // to in this same file.
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
    state: 'WIRED',
    // OPTIONLANE-1 (2026-09-07) · the blocker read "No caller asks it for a
    // full option set on a live lever", and that is precisely what changed.
    //
    // `lib/brain/option-lane.ts#runOptionLane` builds all THREE
    // `OptionAppraisal`s for one live lever (weekly volume on the week a
    // resolved rolling boundary just cleared), appraises each through
    // `athleteEvidenceFor` + `heuristicRankScore`, and calls `rankOptions` on
    // the set. It is reached from `app/api/cron/run-adaptations/route.ts`
    // inside the existing per-runner loop, by a genuine value import, in the
    // same pass that produced the boundary verdict it is deciding about.
    //
    // The answer no longer stops at a log line: the ranked set and its winner
    // are written to `plan_decision_ledger` (step 10) with a DIRECTION, the
    // runner-up is queued on `reassessment_schedule` (step 12) with its reason
    // and a date, and a PUSH becomes a `plan_workout_proposals` card (step 11)
    // the runner can accept. Measured on the owner's own block 2026-09-20:
    // PUSH SUPPORTED 0.95, HOLD SUPPORTED 0.95, PULL_BACK SUPPORTED 0.95, and
    // `rankOptions`' stimulus weighting picked PUSH — the first
    // `direction: 'UP'` decision this ledger has ever held.
    //
    // WHAT THIS DOES NOT CLAIM: `checkPromotion`, `earningGateFor`,
    // `detectStackedStress`, `classifyStep` and `ceilingClaimFrom` in the same
    // module still have no production caller. This row is about `rankOptions`,
    // which is what it names.
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
    state: 'WIRED',
    // SCHEDULERWIRE-1 (2026-09-06) · this SHADOW claim was already stale
    // before this session touched it: step 1's own ORCHESTRATIONWIRE-1 note
    // above asserts "steps 12 and 16 are already WIRED in exactly this
    // state", but the step-12 entry itself was never changed to say so. Two
    // independent, real call chains, both re-traced against the source:
    //
    //   app/api/cron/run-adaptations/route.ts:691 dynamically imports and
    //     calls `scheduleReassessment` from this file directly, inside the
    //     ARBITRATIONWIRE-1 boundary loop (step 9's SUPPORTED-lever deferral
    //     path); and separately
    //   app/api/cron/reassessment-sweep/route.ts:69 imports and calls
    //     `runReassessmentEvaluationSweep`
    //   → lib/ops/reassessment-evaluators.ts:124-127 imports `loadDueItems`,
    //     `resolveReassessment`, `recordAssessmentFailure` from this file as
    //     real values and calls them for the two evaluator kinds
    //     (POST_RACE_RECOVERY_CHECK, RETURN_TO_TRAINING_STAGE).
    //
    // Same posture as steps 1, 5 and 16: migration 167 (`reassessment_
    // schedule`) is drafted and NOT applied to production, so every one of
    // these calls answers `table_absent` today (this file's own
    // `requireTable`/`absent()` machinery, `lib/ops/reassessment-scheduler.ts`
    // lines ~289-328) — a named, visible refusal, not a silent no-op and not
    // a crash. Reachable-and-blocked-on-a-migration is the state this file
    // already treats as WIRED elsewhere; leaving step 12 alone as SHADOW
    // while claiming the opposite one screen up is the exact
    // documentation-drifts-from-the-array failure this file exists to catch.
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
 *
 * AUDIT-2026-09-06 · 12 → 14, and this is a CORRECTION, not new wiring — no
 * production caller was added for either step in this pass. Re-deriving the
 * whole map from the real import graph by hand (per this repo's own standing
 * instruction not to trust a prior session's comment) found two entries that
 * had already drifted from the array on the day they were written:
 *
 *   · Step 4 ("grade sessions") was left SHADOW by VOLUMESEAM-1 on the
 *     argument that "the canonical-shadow live input remains shadow-only."
 *     ARBITRATIONWIRE-1, in the SAME session, put that exact live input
 *     (`live-input.ts`'s `buildGradedSession`, which calls `gradeStimulus`)
 *     on a path that reaches `plan_decision_ledger` via
 *     `persistArbitratedProposals` → `recordDecision` — the update needed to
 *     make step 4 consistent with step 9's own promotion never happened. See
 *     step 4's entry above for the traced chain.
 *   · Step 12 ("schedule reassessment") was left SHADOW despite step 1's own
 *     ORCHESTRATIONWIRE-1 comment, two entries above it in this very file,
 *     already asserting "steps 12 and 16 are already WIRED in exactly this
 *     state" — a claim the array contradicted. Independently re-verified
 *     against the source (not the comment): `run-adaptations/route.ts:691`
 *     and the newly-landed `app/api/cron/reassessment-sweep/route.ts` both
 *     reach `reassessment-scheduler.ts` by genuine value imports. See step
 *     12's entry above for both chains.
 *
 * Both were already reachable before this pass touched anything; the array
 * just hadn't been told. Fixing the declaration to match the code it
 * describes is exactly what `_orchestration.test.ts` exists to force, and
 * this note exists so the NEXT audit does not have to re-derive it from
 * scratch to trust it.
 */
export const WIRED_STEP_PIN = 15;

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
