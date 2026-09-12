/**
 * lib/brain/proposal/facets.ts · WHAT AN ACTION KIND OWES BEFORE IT IS REAL.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FINDING THIS ANSWERS
 *
 * David, 2026-09-05: "The lane can now carry 21 action kinds, but no engine
 * emits most of them... Do not leave legacy actions as the real operating
 * vocabulary with the generalized schema acting only as a reader."
 *
 * He is describing this repo's signature failure — WIRED, TESTED AND INERT —
 * arriving on the newest thing built. `_action_schema_gate.test.ts` proves all
 * twenty-one kinds map to writes and render a headline. It cannot prove any of
 * them ever HAPPENS, and says so in its own Rule 22 note: "Whether anything ever
 * RAISES these actions. A union nobody constructs is still fully covered here."
 *
 * That is the hole this file fills. A kind is not real because it compiles. It
 * is real when FOURTEEN separate things exist for it, and the ratchet below is
 * the list of the ones that do not, each with an argued reason.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOURTEEN FACETS, AND WHO OWNS EACH
 *
 *   EVIDENCE_SOURCE   a named reader measures the thing it is raised from
 *   GENERATOR         something on a live path constructs it
 *   VALIDATOR         validate.ts refuses an incoherent one
 *   SERIALIZER        serialize.ts round-trips it through jsonb
 *   PROPOSAL_WRITER   a live path can put it in front of the runner
 *   RENDERER          v5-action-render.ts:phoneDirectionOf draws it
 *   EXPLANATION       v5-action-render.ts:actionHeadline says what changes
 *   ACCEPT_EXECUTOR   executor-map.ts names a real apply path
 *   MUTATION          execute.ts:plannedWrites resolves it to writes
 *   LEDGER            ledger-facet.ts classifies it for the record
 *   DECLINE           decline-facet.ts says what the runner's NO means
 *   UNDO              undo.ts states a posture, which may be "no"
 *   WATCH             watch-facet.ts says what the wrist must do
 *   INTEGRATION_TEST  a suite drives the kind end to end
 *
 * ── THE THREE ADDED 2026-09-05, AND WHY EACH WAS A HOLE ────────────────────
 *
 * EVIDENCE_SOURCE. `GENERATOR` answers what SHAPES an action; it does not ask
 * what MEASUREMENT gives the engine the right to raise it. A generator wired to
 * a detector that measures nothing is exactly a card the runner is asked to
 * accept with no evidence behind it, which `lib/brain/objective.ts` forbids and
 * which only the live writer's `describesEvidence` check stood against.
 *
 * PROPOSAL_WRITER. The one that mattered most, and the reason HOLD and
 * SAFETY_STOP were seeded rather than produced. Eleven facets could all be
 * green for a kind that no production path could put on a phone: the writer
 * took `AdaptationAction[]`, and HOLD, REFUSAL and SAFETY_STOP are not members
 * of that TYPE — they are not mutations. Generated, validated, serialized,
 * rendered, executable, ledgered, undoable, and unreachable.
 *
 * DECLINE. Accept had a total executor map, a ledger classification, a watch
 * effect and an undo posture per kind. Decline had `SET status = 'dismissed'`,
 * one statement for twenty-one kinds — Rule 22's asymmetry pointed at the
 * runner's own answer. It let a SAFETY_STOP be dismissed, which is a button
 * that overrides safety.
 *
 * RENDERER and EXPLANATION share a FILE and are separated at RUNTIME, not by
 * grep: one asks whether the card knows which way to draw, the other whether
 * the runner gets a sentence. Deleting either arm breaks both the compile and
 * the runtime assertion, so the shared file costs nothing in detection.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE RATCHET, AND WHY IT IS SELF-VERIFYING
 *
 * `FACET_GAPS` may SHRINK and never grow. A gap whose facet is now present
 * FAILS UNTIL DELETED — that is what stops the list quietly becoming a
 * permanent excuse, which is how `check-palette-sync.sh` ended up naming two
 * files that no longer existed.
 *
 * ADDING A FACET ADDS CELLS, AND THEREFORE ADDS GAPS. That is the one way the
 * total can rise, and it is not a ratchet violation — it is 63 questions nobody
 * was asking. To keep the ratchet meaningful across the change,
 * `ORIGINAL_ELEVEN_FACETS` and `ORIGINAL_ELEVEN_GAP_CEILING` below pin the
 * count on the ORIGINAL matrix, which went 23 → 14 in the same pass. A new
 * facet cannot be used to smuggle a regression on an old one.
 *
 * Four of the fourteen are cross-checked against CODE rather than trusted:
 *
 *   ACCEPT_EXECUTOR  `executorFor` returns `UNIMPLEMENTED` with its own reason,
 *                    and the gate asserts the set of UNIMPLEMENTED kinds is
 *                    EXACTLY the set with an ACCEPT_EXECUTOR gap. Neither can
 *                    move without the other.
 *   GENERATOR        `GENERATOR_REGISTRY` names a module, an exported symbol
 *                    and a LIVE CALLER, and the gate resolves all three against
 *                    the real files. A generator with no live caller is not a
 *                    generator, which is the entire finding.
 *   PROPOSAL_WRITER  `PROPOSAL_WRITER_REGISTRY` is checked the same way, plus a
 *                    cross-check against `write.ts`'s own `WRITER_REFUSES`: a
 *                    kind that writer refuses by name must carry a gap, and a
 *                    kind it carries must not.
 *   EVIDENCE_SOURCE  `EVIDENCE_REGISTRY` names a module and a symbol, both
 *                    resolved against the real files.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS REGISTRY CANNOT FAIL ON (Rule 22)
 *
 * · WHETHER THE FACET IS ANY GOOD. It checks that a renderer exists, never that
 *   the sentence is right; that an executor is named, never that it applies the
 *   change correctly; that a generator runs, never that it should have.
 * · WHETHER THE LIVE CALLER IS ACTUALLY REACHED AT RUNTIME. The check is a
 *   static import edge from a file this registry names. A caller that is itself
 *   dead — a cron nobody schedules, a route nobody calls — passes, and Rule 19
 *   is the standing reminder that green is not deployed.
 * · WHETHER A NAMED EVIDENCE READER WAS ACTUALLY CONSULTED. `EVIDENCE_REGISTRY`
 *   is a DECLARATION, the same kind `DOSE_EVIDENCE_READERS` is, and carries the
 *   same warning: a generator that answers "how much volume was absorbed" with
 *   a count of easy runs passes every assertion here.
 * · A FACET NOBODY THOUGHT OF. Fourteen is a list somebody wrote down. Eleven
 *   was too, and three of the missing ones turned out to matter a great deal.
 * · WHETHER THE GENERATOR EVER PRODUCES THAT KIND IN PRACTICE. It asserts the
 *   module CAN construct it (the literal is there, and the integration test
 *   drives it). Whether the owner's real training ever satisfies the condition
 *   is Rule 21's replay question and needs production history, not a scan.
 */

import type { ActionKind } from './action';

export type Facet =
  | 'EVIDENCE_SOURCE'
  | 'GENERATOR'
  | 'VALIDATOR'
  | 'SERIALIZER'
  | 'PROPOSAL_WRITER'
  | 'RENDERER'
  | 'EXPLANATION'
  | 'ACCEPT_EXECUTOR'
  | 'MUTATION'
  | 'LEDGER'
  | 'DECLINE'
  | 'UNDO'
  | 'WATCH'
  | 'INTEGRATION_TEST';

export const ALL_FACETS: readonly Facet[] = [
  'EVIDENCE_SOURCE', 'GENERATOR', 'VALIDATOR', 'SERIALIZER', 'PROPOSAL_WRITER',
  'RENDERER', 'EXPLANATION', 'ACCEPT_EXECUTOR', 'MUTATION', 'LEDGER',
  'DECLINE', 'UNDO', 'WATCH', 'INTEGRATION_TEST',
];

/**
 * The eleven this matrix had before 2026-09-05, and the number of gaps standing
 * against them when the fourteen landed.
 *
 * This is the ratchet that survives the widening. Adding a facet legitimately
 * adds gaps; it must not be able to hide a regression on a facet that was
 * already being watched. The count went 23 → 14 in the pass that added the
 * three, and this line may only ever be lowered.
 */
export const ORIGINAL_ELEVEN_FACETS: readonly Facet[] = [
  'GENERATOR', 'VALIDATOR', 'SERIALIZER', 'RENDERER', 'EXPLANATION',
  'ACCEPT_EXECUTOR', 'MUTATION', 'LEDGER', 'UNDO', 'WATCH', 'INTEGRATION_TEST',
];
export const ORIGINAL_ELEVEN_GAP_CEILING = 14;

/** The file that owns each facet, repo-relative from `web-v2/`. */
export const FACET_OWNER_FILE: Readonly<Record<Facet, string>> = {
  EVIDENCE_SOURCE: 'lib/brain/proposal/evidence-facet.ts',
  GENERATOR: 'lib/brain/proposal/generate',
  VALIDATOR: 'lib/brain/proposal/validate.ts',
  SERIALIZER: 'lib/brain/proposal/serialize.ts',
  PROPOSAL_WRITER: 'lib/brain/proposal/write.ts',
  RENDERER: 'lib/faff/v5-action-render.ts',
  EXPLANATION: 'lib/faff/v5-action-render.ts',
  ACCEPT_EXECUTOR: 'lib/brain/proposal/executor-map.ts',
  MUTATION: 'lib/brain/proposal/execute.ts',
  LEDGER: 'lib/brain/proposal/ledger-facet.ts',
  DECLINE: 'lib/brain/proposal/decline-facet.ts',
  UNDO: 'lib/brain/proposal/undo.ts',
  WATCH: 'lib/brain/proposal/watch-facet.ts',
  INTEGRATION_TEST: 'lib/brain/proposal/_action_completeness.test.ts',
};

/* ══════════════════════════════════════════════════════════════════════════
 * WHO EMITS WHAT
 * ═══════════════════════════════════════════════════════════════════════ */

export interface GeneratorRef {
  /** Repo-relative from `web-v2/`. Must exist. */
  readonly module: string;
  /** An exported function in that module that can construct this kind. */
  readonly symbol: string;
  /**
   * The file that CALLS `symbol`. Named, not inferred.
   *
   * Separate from `liveCaller` because of a hole found by falsifying this gate:
   * the first cut asked only whether ANY file in the live caller's import graph
   * called the symbol, so deleting the call from the writer that actually
   * matters PASSED — a sibling module in the same graph happened to call it too.
   * Naming the call site makes the falsification bite.
   */
  readonly callSite: string;
  /**
   * A ROUTE OR CRON whose import graph reaches the call site.
   *
   * This is the load-bearing field. A generator with no live caller is exactly
   * the "wired, tested and inert" shape, and a registry that only named the
   * module would have certified one. It is deliberately an entry point rather
   * than another library file, so "live" means something a request or a
   * schedule can actually reach.
   */
  readonly liveCaller: string;
  /** What actually causes this kind to be emitted, in one line. */
  readonly when: string;
}

/**
 * The generator for each kind, or null when there is none.
 *
 * A null here MUST have a matching `GENERATOR` entry in `FACET_GAPS`, and the
 * gate asserts both directions.
 */
export const GENERATOR_REGISTRY: Readonly<Record<ActionKind, GeneratorRef | null>> = {
  PACE_CHANGE: {
    module: 'lib/brain/proposal/generate/from-reprice.ts',
    symbol: 'actionFromReprice',
    callSite: 'lib/plan/reanchor-proposal.ts',
    liveCaller: 'app/api/cron/snapshot-projections/route.ts',
    when: 'the daily re-anchor finds the block priced off a stale anchor and raises a repricing card; '
      + 'each moved anchor becomes a PACE_CHANGE part',
  },
  DISTANCE_CHANGE: {
    module: 'lib/brain/proposal/generate/from-adaptation.ts',
    symbol: 'actionFromAdaptation',
    callSite: 'lib/plan/workout-proposals.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'a shave (volume overshoot, training gap, readiness) or a mark_upgrade (adaptive ramp) '
      + 'reaches the proposal writer',
  },
  DURATION_CHANGE: {
    module: 'lib/brain/proposal/generate/from-progression.ts',
    symbol: 'actionFromProgression',
    callSite: 'lib/brain/proposal/generate/from-adaptation.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate resolves a longer or shorter rep on a quality session',
  },
  REPETITION_CHANGE: {
    module: 'lib/brain/proposal/generate/from-progression.ts',
    symbol: 'actionFromProgression',
    callSite: 'lib/brain/proposal/generate/from-adaptation.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate moves the rep count',
  },
  RECOVERY_INTERVAL_CHANGE: {
    module: 'lib/brain/proposal/generate/from-progression.ts',
    symbol: 'actionFromProgression',
    callSite: 'lib/brain/proposal/generate/from-adaptation.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate tightens or lengthens the jog between reps',
  },
  QUALITY_DOSE_CHANGE: {
    module: 'lib/brain/proposal/generate/from-progression.ts',
    symbol: 'actionFromProgression',
    callSite: 'lib/brain/proposal/generate/from-adaptation.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate moves total minutes at pace',
  },
  /* CLOSED 2026-09-06 (LONGRUNSTRUCTURE-1). The blocker named here was never
   * effort — it was that no reader answered whether a race-pace finish had
   * been EARNED, and `resolveWeekProgression`'s `SessionFamily` never walks a
   * long run for the placeholder `long_run_duration` arm in
   * `from-progression.ts` to reach. `lib/brain/proposal/evidence/
   * long-run-structure.ts` is that reader — Research/04 §4.3's structure and
   * §4.5's numeric finish band, read against completion and late-fade checks
   * on the same two most recent long runs the distance lever
   * (`evaluateLongRun`) grades. NOT the same CODE as that lever: the first cut
   * imported `assessDeterioration`/`qualifiesAsLongRunEvidence` straight from
   * `lib/adaptation/canonical/**`, and `_cannot_mutate.test.ts` /
   * `_never_mutates_plan.test.ts` / `_move_readjudication.test.ts`'s "lib/brain
   * reaches the canonical engine through ONE file" all correctly failed on it
   * — `lib/brain/**` may reach that engine only through
   * `lib/brain/orchestration/canonical-phase.ts`, which exports exactly one
   * function. The evidence file's own header explains the independent,
   * simpler re-implementation this became instead, built from
   * `lib/runs/run-shape.ts` primitives with the same doctrine citations.
   * `from-long-run-structure.ts` translates the verdict and
   * `action-proposal-lane.ts`'s new third section is the live caller. The
   * PROPOSAL_WRITER gap below is untouched: `write.ts` still refuses this kind
   * under the 2026-09-02 reshape ruling, which is a decision about SHOWING the
   * card and has nothing to do with whether real evidence now sits behind
   * it. */
  LONG_RUN_STRUCTURE_CHANGE: {
    module: 'lib/brain/proposal/generate/from-long-run-structure.ts',
    symbol: 'actionFromLongRunStructure',
    callSite: 'lib/plan/action-proposal-lane.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the long-run structure reader finds the last two long runs completed and held together late, '
      + 'with no race-pace segment already on the upcoming one',
  },
  WORKOUT_TYPE_CHANGE: {
    module: 'lib/brain/proposal/generate/from-adaptation.ts',
    symbol: 'actionFromAdaptation',
    callSite: 'lib/plan/workout-proposals.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'a downgrade turns a quality session into an easy, recovery or rest day',
  },
  ADD_WORKOUT: null,
  REMOVE_WORKOUT: null,
  FREQUENCY_CHANGE: null,
  RESCHEDULE: {
    module: 'lib/brain/proposal/generate/from-adaptation.ts',
    symbol: 'actionFromAdaptation',
    callSite: 'lib/plan/workout-proposals.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'a training gap or a missed session moves a day',
  },
  COORDINATED: {
    module: 'lib/brain/proposal/generate/from-reprice.ts',
    symbol: 'actionFromReprice',
    callSite: 'lib/plan/reanchor-proposal.ts',
    liveCaller: 'app/api/cron/snapshot-projections/route.ts',
    when: 'the daily re-anchor raises one card for the whole remaining block',
  },
  RACE_TARGET_CHANGE: null,
  TAPER_CHANGE: null,
  RECOVERY_CHANGE: null,
  CONDITIONAL: null,
  FIELD_TEST: {
    module: 'lib/brain/proposal/generate/from-adaptation.ts',
    symbol: 'actionFromAdaptation',
    callSite: 'lib/plan/workout-proposals.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'no race or test in 42 days turns one quality session into a timed effort',
  },
  HOLD: {
    module: 'lib/brain/proposal/generate/from-progression.ts',
    symbol: 'actionFromProgression',
    callSite: 'lib/brain/proposal/generate/from-adaptation.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate looks at a session and decides not to move it',
  },
  /* DURATIONOFFER-1 (2026-09-12) · unlike HOLD above, this kind is not what
   * `actionFromProgression` itself produces (it emits `DURATION_CHANGE`) —
   * this lane's own `firstDurationAccelerate` is the true translation edge,
   * re-labelling an ACCELERATE-on-interval_duration `DURATION_CHANGE` into the
   * non-mutating offer kind before it ever reaches `writeActionProposal`. Named
   * honestly here rather than pointing at `from-progression.ts` the way HOLD
   * does, since HOLD IS that function's direct output and this is not
   * (Rule 19 — point at the real edge, not the nearest plausible one). */
  DURATION_PROGRESS_OFFER: {
    module: 'lib/plan/action-proposal-lane.ts',
    symbol: 'firstDurationAccelerate',
    callSite: 'lib/plan/action-proposal-lane.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the weekly progression gate ACCELERATEs a session\'s interval duration, evidence band '
      + 'is strong, the runner is not compromised, and the day is unsealed',
  },
  REFUSAL: {
    module: 'lib/brain/proposal/generate/from-seal.ts',
    symbol: 'refusalFromSeal',
    callSite: 'lib/plan/adaptation-authority.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the adaptation seam refuses a plan-mutating action an unattended job produced',
  },
  /* ── CLOSED 2026-09-05 (ACTIONCOMPLETE-2) ────────────────────────────────
   *
   * The generator was complete and deliberately unwired, waiting on "a caller
   * that is another slice's to write". It still is another slice's: this does
   * NOT re-derive a verdict, does not read the injury tables, and does not
   * compose a sentence about an injury. `runActionProposalLane` calls
   * `resolveSafety` — the one canonical safety owner's own entry point — and
   * hands the resolution to `safetyStopFrom` whole. The ownership boundary the
   * old gap protected is intact; what changed is that a verdict already being
   * produced now reaches the runner as a decision rather than dying in a
   * function nobody called. */
  SAFETY_STOP: {
    module: 'lib/brain/proposal/generate/from-safety.ts',
    symbol: 'safetyStopFrom',
    callSite: 'lib/plan/action-proposal-lane.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the canonical safety owner returns a STOP verdict for the runner, which the lane turns '
      + 'into a card and never re-derives',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
 * WHO CAN PUT IT IN FRONT OF THE RUNNER
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A writer that inserts a `plan_workout_proposals` row carrying this kind.
 *
 * Same four fields as `GeneratorRef` and checked the same way, because the
 * question is the same shape: a writer with no live caller is a door nobody
 * opens, and this facet exists precisely because eleven green cells could
 * coexist with a kind no production path could show anyone.
 */
export interface WriterRef {
  readonly module: string;
  readonly symbol: string;
  readonly callSite: string;
  readonly liveCaller: string;
  /** How this kind reaches the row, in one line. */
  readonly how: string;
}

export const PROPOSAL_WRITER_REGISTRY: Readonly<Record<ActionKind, WriterRef | null>> = {
  /* A repricing is ONE card for the whole block, and its PACE_CHANGE parts
   * travel inside the stored COORDINATED action rather than as rows of their
   * own. That is the writer for both, and offering seventy-seven cards would be
   * a worse product than offering none. */
  PACE_CHANGE: REPRICE_WRITER('as a part inside the coordinated repricing card'),
  COORDINATED: REPRICE_WRITER('as the card itself, one decision for the whole remaining block'),

  DISTANCE_CHANGE: ADAPTATION_WRITER('a shave or a mark_upgrade becomes a per-workout card'),
  WORKOUT_TYPE_CHANGE: ADAPTATION_WRITER('a downgrade becomes a per-workout card'),
  RESCHEDULE: ADAPTATION_WRITER('a move becomes a per-workout card'),
  FIELD_TEST: ADAPTATION_WRITER('a due field test becomes a per-workout card'),

  /* ── THE TWO THIS FACET WAS ADDED FOR ─────────────────────────────────── */
  HOLD: ACTION_WRITER('the progression gate held a session and the lane raises one notice card'),
  SAFETY_STOP: ACTION_WRITER('the safety owner returned STOP and the lane raises a notice card'),
  DURATION_PROGRESS_OFFER: ACTION_WRITER(
    'the progression gate accelerated a session\'s interval duration and the lane raises an offer '
    + 'card, record-only',
  ),

  DURATION_CHANGE: null,
  REPETITION_CHANGE: null,
  RECOVERY_INTERVAL_CHANGE: null,
  QUALITY_DOSE_CHANGE: null,
  LONG_RUN_STRUCTURE_CHANGE: null,
  ADD_WORKOUT: null,
  REMOVE_WORKOUT: null,
  FREQUENCY_CHANGE: null,
  RACE_TARGET_CHANGE: null,
  TAPER_CHANGE: null,
  RECOVERY_CHANGE: null,
  CONDITIONAL: null,
  REFUSAL: null,
};

function REPRICE_WRITER(how: string): WriterRef {
  return {
    module: 'lib/plan/reanchor-proposal.ts',
    symbol: 'writeReanchorProposal',
    callSite: 'lib/plan/reanchor-plan.ts',
    liveCaller: 'app/api/cron/snapshot-projections/route.ts',
    how,
  };
}

function ADAPTATION_WRITER(how: string): WriterRef {
  return {
    module: 'lib/plan/workout-proposals.ts',
    symbol: 'writeWorkoutProposals',
    callSite: 'app/api/cron/run-adaptations/route.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    how,
  };
}

function ACTION_WRITER(how: string): WriterRef {
  return {
    module: 'lib/brain/proposal/write.ts',
    symbol: 'writeActionProposal',
    callSite: 'lib/plan/action-proposal-lane.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    how,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE RATCHET
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The reshape ruling, written once and cited five times (Rule 17).
 *
 * A function declaration so it is hoisted above the literal that uses it, and a
 * constant so the five entries cannot drift apart about what the ruling said.
 */
const RESHAPE_GAP =
  'THE OWNER RULED ON THIS LEVER BY NAME. His 2026-09-02 instruction — "too many independent levers '
  + 'can soften, RESHAPE, re-phase, refuse, or automatically mutate the plan; remove their decision '
  + 'authority" — is why PROPOSABLE_KINDS withholds `reshape`, and write.ts refuses the five '
  + 'session-geometry kinds for the same reason rather than becoming the side door around a '
  + 'doctrine-cited guard. Every other facet for this kind is present: it is generated, validated, '
  + 'rendered, executed, ledgered and (since UNDOCOMPLETE-1) undoable. What is missing is his word, '
  + 'and all five close together when he gives it.';

export interface FacetGap {
  readonly kind: ActionKind;
  readonly facet: Facet;
  /**
   * WHY it is missing and WHAT would close it. "Not built yet" is not a reason.
   * An entry whose facet is now present fails until it is deleted.
   */
  readonly because: string;
}

/**
 * EVERY KIND × FACET THAT IS GENUINELY ABSENT.
 *
 * 294 cells (21 kinds × 14 facets). The ones below are the holes, and the gate
 * proves the rest are filled rather than taking this list's word for it.
 *
 * THIS LIST MAY SHRINK. IT MAY NEVER GROW — see `ORIGINAL_ELEVEN_GAP_CEILING`
 * above for how that survives a facet being added.
 */
export const FACET_GAPS: readonly FacetGap[] = [
  /* ══════════════════════════════════════════════════════════════════════
   * THE SINGLE-SESSION COMPOSITION CLUSTER
   *
   * ADD_WORKOUT, REMOVE_WORKOUT and FREQUENCY_CHANGE are one blocked thing
   * wearing three names, and they close together or not at all. The blocker is
   * exact and is not effort: a `plan_workouts` row needs a `plan_id`, a
   * `week_id`, a `dow` and a `workout_spec`, and the last of those is authored
   * by `composePlan` AGAINST THE WHOLE WEEK. There is no single-session entry
   * point into the composer, and writing a partial spec anywhere else would be
   * a second, worse authoring path beside it — the duplication
   * BRAIN_CONSTITUTION rejects a PR for.
   *
   * The downward half of each would work today, and is deliberately not
   * shipped alone: an engine that can lower a runner's frequency and never
   * raise it is precisely the asymmetry Rule 21 measures.
   * ═══════════════════════════════════════════════════════════════════════ */
  {
    kind: 'ADD_WORKOUT', facet: 'GENERATOR',
    because:
      'Nothing in the engine adds a session. Every upward lever it has resizes a day that already '
      + 'exists — tryAdaptiveBump raises distance on existing rows, the progression gate raises dose '
      + 'inside an existing session. RE-CHECKED 2026-09-05 (round 2): the mechanical half of the old '
      + 'claim is stale — `generate.ts`\'s `specForComposedDay`/`persistedDayShape` (extracted '
      + '2026-08-24) ARE a single-day, composer-authored spec entry point; nothing here still needs '
      + 'a whole-week recompose to author one row. RE-CHECKED AGAIN 2026-09-06: the EVIDENCE_SOURCE '
      + 'half below is now ALSO closed — `derivedTrainingDaysPerWeek` answers "how many days a week '
      + 'does he actually run" and is exported and registered. What remains is narrower than either '
      + 'prior note claimed: no live caller invokes the composer\'s single-day entry point outside '
      + '`composePlan` itself, and nothing compares the now-available reading against the plan\'s '
      + 'currently scheduled non-rest days to DECIDE a day should be added — that comparison, plus the '
      + 'entry-point wiring, is what would close this and the ACCEPT_EXECUTOR/UNDO gaps below with it.',
  },
  {
    kind: 'ADD_WORKOUT', facet: 'PROPOSAL_WRITER',
    because:
      'There is nothing to write. With no generator, no writer can carry the kind, and inventing a '
      + 'writer for an action nothing constructs would be a module with no caller — the exact shape '
      + 'the orphan gate exists to catch. Closes with the generator above.',
  },
  {
    kind: 'ADD_WORKOUT', facet: 'ACCEPT_EXECUTOR',
    because:
      'executor-map.ts returns UNIMPLEMENTED and states why: a row inserted without a workout_spec '
      + 'renders as a blank card on the phone and ships nothing to the wrist, and authoring a partial '
      + 'one here would be a second, worse authoring path beside composePlan. Cross-checked: the gate '
      + 'fails if executorFor stops saying UNIMPLEMENTED while this entry stands.',
  },
  {
    kind: 'ADD_WORKOUT', facet: 'UNDO',
    because:
      'undo.ts returns not_undoable, correctly: the inserted row has no id until it is written, and '
      + 'RowBefore is empty on an add by construction. Closing this means the accept path recording '
      + 'the id it wrote, which is a change to what a proposal stores rather than to this pure '
      + 'inverse. Stated in undo.ts rather than silently returning an empty write list.',
  },

  {
    kind: 'REMOVE_WORKOUT', facet: 'GENERATOR',
    because:
      'The engine never deletes a session. It DOWNGRADES to rest, which keeps the row and its history '
      + 'and is what adapt.ts clearsQuality does. That is a deliberate difference and probably the '
      + 'right one: a deleted row loses original_type, the provenance chip and the day the runner can '
      + 'still see he was meant to run. This kind exists for a frequency reduction that genuinely '
      + 'removes days, and nothing produces one — see FREQUENCY_CHANGE below.',
  },
  {
    kind: 'REMOVE_WORKOUT', facet: 'EVIDENCE_SOURCE',
    because:
      'Nothing measures "this day should not exist". Every reduction reader in this engine answers a '
      + 'question about a session that stays — how far, how hard, what type — because NEVER-DELETE-1 '
      + 'means the answer is never removal. Closing this would mean a reader whose output the '
      + 'executor below is forbidden to act on, which is a worse state than the current one.',
  },
  {
    kind: 'REMOVE_WORKOUT', facet: 'PROPOSAL_WRITER',
    because:
      'Nothing constructs the kind and its executor is refused by doctrine, so a writer for it would '
      + 'raise a card the accept path is required to reject. That is the "button that does nothing" '
      + 'failure this whole matrix exists to prevent, arrived at deliberately.',
  },
  {
    kind: 'REMOVE_WORKOUT', facet: 'ACCEPT_EXECUTOR',
    because:
      'REFUSED BY DOCTRINE, not unbuilt, and this one should probably never close. NEVER-DELETE-1 '
      + '(lib/plan/_move_never_deletes.test.ts) fails any path that deletes a plan workout, and it '
      + 'caught the first cut of accept.ts doing exactly that within one test run. The reason is '
      + 'good: a deleted row loses original_type, the provenance chip and the day the runner can '
      + 'still see he was meant to run. The honest apply path for emptying a day is '
      + 'WORKOUT_TYPE_CHANGE to rest, which is generated, executed and undoable. Cross-checked: '
      + 'executorFor returns UNIMPLEMENTED and applyWritePlan throws on a delete rather than '
      + 'issuing the statement.',
  },

  {
    kind: 'FREQUENCY_CHANGE', facet: 'GENERATOR',
    because:
      'profile.weekly_frequency is read at AUTHORING and never re-decided by an adaptation pass. '
      + 'Rule 11 records what that cost once already: the column is NULL for 8 of 16 production '
      + 'profiles and the null silently disabled thirteen mechanisms. CLOSED 2026-09-06: '
      + '`derivedTrainingDaysPerWeek` now answers the EVIDENCE_SOURCE half (see EVIDENCE_REGISTRY) — '
      + 'the same Rule-8-filtered reading ADD_WORKOUT cites. What remains is a mid-block DECISION '
      + 'nobody owns yet: comparing that reading against the plan\'s currently authored day count and '
      + 'turning a mismatch into adds or removes is a WEEK-shaped decision, so it belongs to whoever '
      + 'owns weekly demand rather than to the per-workout pass, and it closes together with '
      + 'ADD_WORKOUT\'s own GENERATOR gap since the upward half of this lever is realised as adds.',
  },
  {
    kind: 'FREQUENCY_CHANGE', facet: 'PROPOSAL_WRITER',
    because:
      'Nothing constructs the kind, and its executor is unimplemented in the upward direction, so a '
      + 'writer would be able to raise only a card that removes days. Shipping the downward half '
      + 'alone is the asymmetry Rule 21 measures, and it is refused here as it is at the executor.',
  },
  {
    kind: 'FREQUENCY_CHANGE', facet: 'ACCEPT_EXECUTOR',
    because:
      'executor-map.ts returns UNIMPLEMENTED. The remove half would work today and the add half '
      + 'cannot (see ADD_WORKOUT), and shipping only the downward half of a lever is the exact '
      + 'asymmetry Rule 21 measures: an engine that can lower a runner frequency and never raise it. '
      + 'Held whole rather than landed half. Cross-checked against executorFor in both directions.',
  },
  {
    kind: 'FREQUENCY_CHANGE', facet: 'UNDO',
    because:
      'undo.ts returns not_undoable: a frequency change is realised as adds and removes, so its '
      + 'inverse is those entries inverse rather than a single write. It closes when ADD_WORKOUT and '
      + 'REMOVE_WORKOUT do, not before.',
  },

  /* ══════════════════════════════════════════════════════════════════════
   * THE RESHAPE RULING · five kinds, one owner decision
   *
   * All five are GENERATED, VALIDATED, RENDERED, EXECUTED, LEDGERED and — as of
   * UNDOCOMPLETE-1 — UNDOABLE. What no writer may do is put one in front of the
   * runner, and that is not a missing feature. `PROPOSABLE_KINDS` withholds
   * `reshape` citing the owner's 2026-09-02 ruling by name, and CLAUDE.md is
   * explicit that a doctrine-cited guard is not weakened to make room for new
   * work. `write.ts` refuses all five out loud for the same reason rather than
   * becoming the side door around it.
   *
   * A proposal arguably has no decision authority, since the runner decides.
   * The ruling names the lever anyway, so the question is written down rather
   * than resolved by whoever touched the file last. ALL FIVE CLOSE TOGETHER, on
   * his word.
   * ═══════════════════════════════════════════════════════════════════════ */
  {
    kind: 'DURATION_CHANGE', facet: 'PROPOSAL_WRITER',
    because: RESHAPE_GAP,
  },
  {
    kind: 'REPETITION_CHANGE', facet: 'PROPOSAL_WRITER',
    because: RESHAPE_GAP,
  },
  {
    kind: 'RECOVERY_INTERVAL_CHANGE', facet: 'PROPOSAL_WRITER',
    because: RESHAPE_GAP,
  },
  {
    kind: 'QUALITY_DOSE_CHANGE', facet: 'PROPOSAL_WRITER',
    because: RESHAPE_GAP,
  },
  {
    kind: 'LONG_RUN_STRUCTURE_CHANGE', facet: 'PROPOSAL_WRITER',
    because: RESHAPE_GAP,
  },

  /* ── SAFETY_STOP · not a gap in the ordinary sense, and permanent ──────── */
  {
    kind: 'SAFETY_STOP', facet: 'UNDO',
    because:
      'DELIBERATE AND PERMANENT. A stop lifts when the SIGNAL that raised it clears, never because '
      + 'the runner tapped Undo. An undoable safety stop is a button that overrides safety, which is '
      + 'the one thing the whole authority boundary exists to make impossible. Listed as a gap on '
      + 'purpose, and the RATCHET is the guard rather than this sentence: the day undo.ts starts '
      + 'reversing a SAFETY_STOP, the staleness check fails this entry and someone has to argue the '
      + 'change instead of shipping it quietly. Do not close it to tidy the list. Its sibling on the '
      + 'other side of the same rule is NOT a gap: DECLINE is present and answers NOT_DECLINABLE, '
      + 'because refusing out loud is a behaviour and refusing to have one is not.',
  },

  /* ── LONG_RUN_STRUCTURE_CHANGE GENERATOR + EVIDENCE_SOURCE ────────────────
   * CLOSED 2026-09-06 (LONGRUNSTRUCTURE-1) — see GENERATOR_REGISTRY above for
   * the module/reader and the argued reason. The PROPOSAL_WRITER gap for this
   * kind stands unchanged, above, under the reshape ruling. */

  /* ── RACE_TARGET_CHANGE ────────────────────────────────────────────────── */
  {
    kind: 'RACE_TARGET_CHANGE', facet: 'GENERATOR',
    because:
      'DELIBERATELY UNGENERATED, and this one must stay that way unless the owner says otherwise. '
      + 'CLAUDE.md Rule 20 records the exact defect: a cron raised a card in his production account '
      + 'reading "Set the revised target to race off the fitness you have", with an accept action that '
      + 'PATCHed his 3:00:00 CIM goal down to 3:31:48. His standing rule is that the coach projects '
      + 'and never renegotiates a stated goal. So the KIND exists for a runner-initiated target edit, '
      + 'and no engine may emit one. If a generator ever appears here it needs his explicit go, not a '
      + 'deleted gap entry.',
  },
  {
    kind: 'RACE_TARGET_CHANGE', facet: 'PROPOSAL_WRITER',
    because:
      'The same standing rule, enforced a second time and on purpose. write.ts names this kind in '
      + 'WRITER_REFUSES with the ruling attached, so even a generator appearing by accident could not '
      + 'put a goal renegotiation on his phone. Two independent refusals for one rule is not '
      + 'duplication here: the defect it prevents reached production once, and Rule 20 says to fix '
      + 'the gap rather than the instance.',
  },

  /* ── TAPER_CHANGE and RECOVERY_CHANGE · authored, not adapted ──────────── */
  {
    kind: 'TAPER_CHANGE', facet: 'GENERATOR',
    because:
      'The taper is authored, not adapted: BLOCK_SHAPE[cat].taperWeeks is fixed at compose time and '
      + 'TAPER.trajectory-build-weeks pins it to doctrine in CI. No detection pass reshapes a taper, '
      + 'and the one time the engine changed one it was a rebuild rather than an adaptation. Closing '
      + 'this means an owner for in-block taper depth, which today is the plan composer.',
  },
  {
    kind: 'TAPER_CHANGE', facet: 'EVIDENCE_SOURCE',
    because:
      'RE-VERIFIED 2026-09-06: the depth table itself is real and citable — `Research/08` §9.1\'s '
      + '"Volume reduction (peak week)" column (25-70% by distance) and §9.2\'s marathon per-week bands '
      + '(80-90% / 60-70% / 40-50% of peak) — so this is not a doctrine gap, it is an ADAPTIVE-reader '
      + 'gap: nothing in this engine reads a runner and answers "this taper should sit deeper in that '
      + 'band than authored". The two candidate inputs for such a reader both fail the same test '
      + 'tonight: `weekly-demand.ts`\'s observational demand index states in its own header that it '
      + '"must not be wired into a plan mutation" per `docs/PLAN_SIMPLIFICATION_DOCTRINE.md`, and '
      + 'whether a runner-gated PROPOSAL crosses that line is exactly the kind of authority-model '
      + 'question the 2026-09-05 directive says is not this auditor\'s to resolve unilaterally; and '
      + 'Rule 8 forbids measuring "how did the taper feel" from inside the taper window itself, so a '
      + 'freshness-across-tapers reader would need a signal this engine does not currently gather. '
      + 'Inventing one to close this cell would be exactly the "no physiology option-menus" violation '
      + 'CLAUDE.md warns against.',
  },
  {
    kind: 'TAPER_CHANGE', facet: 'PROPOSAL_WRITER',
    because:
      'Nothing constructs the kind, so no writer can carry it and one built for it would be a module '
      + 'with no caller. Closes with the generator, which closes with an owner for in-block taper '
      + 'depth.',
  },

  {
    kind: 'RECOVERY_CHANGE', facet: 'GENERATOR',
    because:
      'Three live things look like candidates and none of them is one. A downgrade to rest or '
      + 'recovery is a WORKOUT_TYPE_CHANGE (it writes type, not a note) and is already generated. '
      + 'The training_gap comeback protocol is a set of DISTANCE_CHANGEs. The jog between reps is '
      + 'RECOVERY_INTERVAL_CHANGE, a different kind, and IS generated. What RECOVERY_CHANGE describes '
      + 'is a change to the recovery WINDOW — an added rest day, a deepened post-race block — and no '
      + 'detector produces one, because post-race recovery is sized at authoring by '
      + 'postRaceRecoveryWeeks and never revisited. Closing this is the natural home for the Rule 17 '
      + 'defect the gap protocol still has: a nine-day layoff currently produces N separate "Ease '
      + 'Thursday" cards and no sentence saying the next two weeks come back at 70 then 85 percent.',
  },
  {
    kind: 'RECOVERY_CHANGE', facet: 'EVIDENCE_SOURCE',
    because:
      'postRaceRecoveryWeeks sizes the window from the race distance and priority at authoring time, '
      + 'and nothing re-reads the runner to ask whether it was enough. RE-CHECKED 2026-09-06 against '
      + '`lib/adaptation/canonical/deterioration.ts`, the sibling workstream\'s in-flight "subsequent '
      + 'recovery" work named as a possible feed for this reader: as of tonight it exports exactly one '
      + 'family of signal — `assessDeterioration`/`paHrDecouplingFrac`, Pa:HR decoupling WITHIN one '
      + 'session\'s own thirds — and nothing about how a runner\'s readiness moves ACROSS the days '
      + 'after a hard effort. That is a different question (single-session execution quality vs. a '
      + 'multi-day recovery TRAJECTORY) and building the latter by re-purposing the former would be '
      + 'exactly the kind of measurement substitution Rule 16 forbids. `docs/'
      + 'PLAN_SIMPLIFICATION_DOCTRINE.md` also removed decision authority from sleep, HRV and resting '
      + 'HR app-wide, which narrows what a real reader could even be built from to the readiness '
      + 'layer\'s existing calendar-and-training-load signals — a real reader may still be buildable '
      + 'there, but it is a new, not-yet-scoped aggregation across a window, not a wiring change, and '
      + 'not something to build from the wrong existing primitive to move this cell.',
  },
  {
    kind: 'RECOVERY_CHANGE', facet: 'PROPOSAL_WRITER',
    because:
      'Nothing constructs the kind, so no writer can carry it and one built for it would be a module '
      + 'with no caller. Closes with the generator, which closes with an owner for the recovery '
      + 'window.',
  },

  /* ── CONDITIONAL ───────────────────────────────────────────────────────── */
  {
    kind: 'CONDITIONAL', facet: 'GENERATOR',
    because:
      'The evaluator half exists and is unwired for a reason already argued and already ratcheted: '
      + 'lib/plan/adjudication/dose-responsive.ts is in MODULE_ORPHANS because nothing anywhere '
      + 'AUTHORS a DoseResponsivePrescription on a live path — resolveDose can grade a gate and no '
      + 'production code states one. Emitting CONDITIONALs before that exists would put promises on '
      + 'the runner phone that nothing keeps, which is precisely the failure Rule 23 names: "the date '
      + 'was a PROMISE nothing kept". The re-take machinery is no longer the blocker — '
      + 'reassessment_schedule (migration 167) and sweepReassessments run nightly from this same '
      + 'cron — so what remains is a coaching author for the prescription itself.',
  },
  {
    kind: 'CONDITIONAL', facet: 'PROPOSAL_WRITER',
    because:
      'Nothing constructs the kind. A CONDITIONAL card also carries an obligation the other kinds do '
      + 'not: the runner is shown what would earn a dose, so something must actually re-take the '
      + 'gate on the assessment date and tell him the answer. Raising one before that loop is closed '
      + 'is the promise-nothing-keeps failure, on the surface built to explain a decision.',
  },

  /* ── REFUSAL · generated and recorded, deliberately not a card ─────────── */
  {
    kind: 'REFUSAL', facet: 'PROPOSAL_WRITER',
    because:
      'DELIBERATE. The seam already records every refusal as a coach_intents row under '
      + 'SEALED_ACTION_INTENT_REASON, carrying the action and its direction, which is what Rule 21 '
      + 'needs to count what the seam has been stopping. A CARD would say "the engine was not '
      + 'permitted to change this" — engine bookkeeping about an authority setting the runner did '
      + 'not choose and cannot answer, which fails the UX doctrine test: it changes nothing about '
      + 'what he should understand or do next. write.ts CAN carry the kind, so this is a decision '
      + 'about what to raise rather than a missing capability, and closing it means deciding a '
      + 'refusal is worth his attention.',
  },
];

/**
 * THE KINDS WHOSE PROPOSAL_WRITER GAP IS A RULING, NOT AN ABSENCE.
 *
 * The distinction this exists to make, and the hole a falsification found:
 *
 *   MOST PROPOSAL_WRITER gaps are absences. ADD_WORKOUT has no writer because
 *   nothing constructs an ADD_WORKOUT; there is nothing for a writer to refuse
 *   and building one would be a module with no caller.
 *
 *   THESE SIX ARE DIFFERENT. Every one of them IS constructible — five are
 *   generated today by the progression pass — and the only thing standing
 *   between them and a card on the runner's phone is `write.ts` naming them in
 *   `WRITER_REFUSES`. Delete that name and the writer carries them silently,
 *   the ratchet stays consistent (no generator is registered, the gap stands),
 *   and a doctrine-cited ruling has been routed around with nothing failing.
 *
 * That is exactly what happened in falsification 18: removing
 * `QUALITY_DOSE_CHANGE` from `WRITER_REFUSES` PASSED the whole suite. So the
 * two lists are pinned to each other, set-for-set, in both directions.
 */
export const WRITER_MUST_REFUSE: readonly ActionKind[] = [
  // The 2026-09-02 reshape ruling. Constructible, generated, and withheld.
  'DURATION_CHANGE', 'REPETITION_CHANGE', 'RECOVERY_INTERVAL_CHANGE',
  'QUALITY_DOSE_CHANGE', 'LONG_RUN_STRUCTURE_CHANGE',
  // The coach projects and never renegotiates a stated goal (Rule 20).
  'RACE_TARGET_CHANGE',
];

/** Is this cell a declared gap? */
export function facetGapFor(kind: ActionKind, facet: Facet): FacetGap | null {
  return FACET_GAPS.find((g) => g.kind === kind && g.facet === facet) ?? null;
}

/**
 * The completeness score, for a report.
 *
 * Deliberately a COUNT and not a percentage: 95 percent complete reads like a
 * grade, and a kind missing its executor is not 91 percent usable, it is a card
 * the runner taps that does nothing.
 */
export function facetCoverage(kinds: readonly ActionKind[]): {
  readonly cells: number;
  readonly present: number;
  readonly gaps: number;
} {
  const cells = kinds.length * ALL_FACETS.length;
  const gaps = FACET_GAPS.filter((g) => kinds.includes(g.kind)).length;
  return { cells, present: cells - gaps, gaps };
}
