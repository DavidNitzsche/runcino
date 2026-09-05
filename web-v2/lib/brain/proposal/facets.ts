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
 * is real when ELEVEN separate things exist for it, and the ratchet below is
 * the list of the ones that do not, each with an argued reason.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE ELEVEN FACETS, AND WHO OWNS EACH
 *
 *   GENERATOR         something on a live path constructs it
 *   VALIDATOR         validate.ts refuses an incoherent one
 *   SERIALIZER        serialize.ts round-trips it through jsonb
 *   RENDERER          v5-action-render.ts:phoneDirectionOf draws it
 *   EXPLANATION       v5-action-render.ts:actionHeadline says what changes
 *   ACCEPT_EXECUTOR   executor-map.ts names a real apply path
 *   MUTATION          execute.ts:plannedWrites resolves it to writes
 *   LEDGER            ledger-facet.ts classifies it for the record
 *   UNDO              undo.ts states a posture, which may be "no"
 *   WATCH             watch-facet.ts says what the wrist must do
 *   INTEGRATION_TEST  a suite drives the kind end to end
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
 * Two of the eleven are cross-checked against CODE rather than trusted:
 *
 *   ACCEPT_EXECUTOR  `executorFor` returns `UNIMPLEMENTED` with its own reason,
 *                    and the gate asserts the set of UNIMPLEMENTED kinds is
 *                    EXACTLY the set with an ACCEPT_EXECUTOR gap. Neither can
 *                    move without the other.
 *   GENERATOR        `GENERATOR_REGISTRY` names a module, an exported symbol
 *                    and a LIVE CALLER, and the gate resolves all three against
 *                    the real files. A generator with no live caller is not a
 *                    generator, which is the entire finding.
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
 * · A FACET NOBODY THOUGHT OF. Eleven is a list somebody wrote down. A kind
 *   could be complete against all eleven and still be missing something this
 *   file does not know to ask for.
 * · WHETHER THE GENERATOR EVER PRODUCES THAT KIND IN PRACTICE. It asserts the
 *   module CAN construct it (the literal is there, and the integration test
 *   drives it). Whether the owner's real training ever satisfies the condition
 *   is Rule 21's replay question and needs production history, not a scan.
 */

import type { ActionKind } from './action';

export type Facet =
  | 'GENERATOR'
  | 'VALIDATOR'
  | 'SERIALIZER'
  | 'RENDERER'
  | 'EXPLANATION'
  | 'ACCEPT_EXECUTOR'
  | 'MUTATION'
  | 'LEDGER'
  | 'UNDO'
  | 'WATCH'
  | 'INTEGRATION_TEST';

export const ALL_FACETS: readonly Facet[] = [
  'GENERATOR', 'VALIDATOR', 'SERIALIZER', 'RENDERER', 'EXPLANATION',
  'ACCEPT_EXECUTOR', 'MUTATION', 'LEDGER', 'UNDO', 'WATCH', 'INTEGRATION_TEST',
];

/** The file that owns each facet, repo-relative from `web-v2/`. */
export const FACET_OWNER_FILE: Readonly<Record<Facet, string>> = {
  GENERATOR: 'lib/brain/proposal/generate',
  VALIDATOR: 'lib/brain/proposal/validate.ts',
  SERIALIZER: 'lib/brain/proposal/serialize.ts',
  RENDERER: 'lib/faff/v5-action-render.ts',
  EXPLANATION: 'lib/faff/v5-action-render.ts',
  ACCEPT_EXECUTOR: 'lib/brain/proposal/executor-map.ts',
  MUTATION: 'lib/brain/proposal/execute.ts',
  LEDGER: 'lib/brain/proposal/ledger-facet.ts',
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
  LONG_RUN_STRUCTURE_CHANGE: null,
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
  REFUSAL: {
    module: 'lib/brain/proposal/generate/from-seal.ts',
    symbol: 'refusalFromSeal',
    callSite: 'lib/plan/adaptation-authority.ts',
    liveCaller: 'app/api/cron/run-adaptations/route.ts',
    when: 'the adaptation seam refuses a plan-mutating action an unattended job produced',
  },
  SAFETY_STOP: null,
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE RATCHET
 * ═══════════════════════════════════════════════════════════════════════ */

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
 * 231 cells (21 kinds × 11 facets). The ones below are the holes, and the gate
 * proves the other 220 are filled rather than taking this list's word for it.
 *
 * THIS LIST MAY SHRINK. IT MAY NEVER GROW.
 */
export const FACET_GAPS: readonly FacetGap[] = [
  /* ── ADD_WORKOUT ───────────────────────────────────────────────────────── */
  {
    kind: 'ADD_WORKOUT', facet: 'GENERATOR',
    because:
      'Nothing in the engine adds a session. Every upward lever it has resizes a day that already '
      + 'exists — tryAdaptiveBump raises distance on existing rows, the progression gate raises dose '
      + 'inside an existing session — because adding one needs a week, a day-of-week and a '
      + 'composer-authored workout_spec. Closed by giving the composer a single-session entry point '
      + 'that authors a spec for one day, at which point the ACCEPT_EXECUTOR and UNDO gaps below '
      + 'close with it.',
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

  /* ── THE FOUR SESSION-GEOMETRY KINDS · one shared UNDO reason ──────────── */
  //
  // All four are GENERATED, VALIDATED, RENDERED, EXECUTED and LEDGERED. What
  // none of them can do is come back, and the reason is one fact stated four
  // times because the ratchet is per cell: the shape they replaced lives in
  // `workout_spec` and `sub_label`, `RowBefore` records neither, and reversing
  // only the note would leave the chip disagreeing with the row — which is the
  // "is it 5 or 4 miles" defect that motivated the spec rebuild in the first
  // place. ALL FOUR CLOSE TOGETHER, by recording the prior shape on the
  // proposal, which is a schema-version change to `RowBefore`.
  {
    kind: 'DURATION_CHANGE', facet: 'UNDO',
    because: 'the prior session shape is not recorded on RowBefore; see the shared note above this entry',
  },
  {
    kind: 'REPETITION_CHANGE', facet: 'UNDO',
    because: 'the prior session shape is not recorded on RowBefore; see the shared note above this entry',
  },
  {
    kind: 'RECOVERY_INTERVAL_CHANGE', facet: 'UNDO',
    because: 'the prior session shape is not recorded on RowBefore; see the shared note above this entry',
  },
  {
    kind: 'QUALITY_DOSE_CHANGE', facet: 'UNDO',
    because: 'the prior session shape is not recorded on RowBefore; see the shared note above this entry',
  },
  {
    kind: 'FIELD_TEST', facet: 'UNDO',
    because:
      'a field test REPLACES the session it lands on — type, spec and sub_label — and the proposal '
      + 'records none of that. Same fix as the four above, and the same schema-version change.',
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
      + 'change instead of shipping it quietly. Do not close it to tidy the list.',
  },

  /* ── LONG_RUN_STRUCTURE_CHANGE ─────────────────────────────────────────── */
  {
    kind: 'LONG_RUN_STRUCTURE_CHANGE', facet: 'GENERATOR',
    because:
      'The progression pass is the only thing in the engine that reshapes a session, and its '
      + 'SessionFamily is exactly threshold | interval | repetition — it never walks a long run. So '
      + 'ProgressionLever contains long_run_duration and nothing pulls it, which is Rule 15 in one '
      + 'line: a lever no corpus can reach is untested however many archetypes pass. '
      + 'from-progression.ts carries the arm anyway so a future pass that DOES resolve the lever gets '
      + 'the right kind rather than falling through to a quality dose. Closed by giving the long run '
      + 'its own progression target, which is a real coaching feature (last-N-at-MP, progressive '
      + 'finish) and not a wiring change.',
  },
  {
    kind: 'LONG_RUN_STRUCTURE_CHANGE', facet: 'UNDO',
    because:
      'undo.ts returns not_undoable for the same reason as every other session-shape kind: the shape '
      + 'it replaced lives in workout_spec and sub_label, RowBefore records neither, and putting back '
      + 'only the sentence would leave the label disagreeing with the prescription.',
  },

  /* ── REMOVE_WORKOUT ────────────────────────────────────────────────────── */
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

  /* ── FREQUENCY_CHANGE ──────────────────────────────────────────────────── */
  {
    kind: 'FREQUENCY_CHANGE', facet: 'GENERATOR',
    because:
      'profile.weekly_frequency is read at AUTHORING and never re-decided by an adaptation pass. '
      + 'Rule 11 records what that cost once already: the column is NULL for 8 of 16 production '
      + 'profiles and the null silently disabled thirteen mechanisms. Changing a runner frequency '
      + 'mid-block is a real lever nobody owns yet, and it is a WEEK-shaped decision, so it belongs '
      + 'to whoever owns weekly demand rather than to the per-workout pass.',
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

  /* ── TAPER_CHANGE ──────────────────────────────────────────────────────── */
  {
    kind: 'TAPER_CHANGE', facet: 'GENERATOR',
    because:
      'The taper is authored, not adapted: BLOCK_SHAPE[cat].taperWeeks is fixed at compose time and '
      + 'TAPER.trajectory-build-weeks pins it to doctrine in CI. No detection pass reshapes a taper, '
      + 'and the one time the engine changed one it was a rebuild rather than an adaptation. Closing '
      + 'this means an owner for in-block taper depth, which today is the plan composer.',
  },
  {
    kind: 'TAPER_CHANGE', facet: 'UNDO',
    because:
      'undo.ts returns not_undoable: both TAPER_CHANGE and RECOVERY_CHANGE write only notes, and '
      + 'RowBefore does not record notes, so reversing would BLANK the sentence rather than restore '
      + 'it. Closed by adding notes to RowBefore, which is a schema-version change and would touch '
      + 'every stored payload.',
  },

  /* ── RECOVERY_CHANGE ───────────────────────────────────────────────────── */
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
    kind: 'RECOVERY_CHANGE', facet: 'UNDO',
    because: 'Same reason as TAPER_CHANGE above: notes are written and notes are not recorded in RowBefore.',
  },

  /* ── CONDITIONAL ───────────────────────────────────────────────────────── */
  {
    kind: 'CONDITIONAL', facet: 'GENERATOR',
    because:
      'The evaluator half exists and is unwired for a reason already argued and already ratcheted: '
      + 'lib/plan/adjudication/dose-responsive.ts is in MODULE_ORPHANS because nothing anywhere '
      + 'EVALUATES an EarningGate on its assessment date, and wiring one means deciding WHERE a gate '
      + 'is re-taken and WHO supplies the readings. Emitting CONDITIONALs before that exists would '
      + 'put promises on the runner phone that nothing keeps, which is precisely the failure Rule 23 '
      + 'names: "the date was a PROMISE nothing kept". This gap closes with that one, not before.',
  },

  /* ── SAFETY_STOP ───────────────────────────────────────────────────────── */
  {
    kind: 'SAFETY_STOP', facet: 'GENERATOR',
    because:
      'The generator EXISTS and is complete — lib/brain/proposal/generate/from-safety.ts takes a '
      + 'SafetyResolution as an input and never re-derives one, per BRAIN_CONSTITUTION giving Safety '
      + 'exactly one owner. What it has no live caller, because the canonical safety-state wiring '
      + '(injury, illness, niggle into lib/plan/adjudication/live-input.ts) is in flight in a separate '
      + 'slice and editing those sources here would create the second answer the constitution '
      + 'forbids. The two halves meet at safetyStopFrom({ resolution }): the safety slice supplies '
      + 'the verdict, this supplies the action. Delete this entry the moment a live path calls it.',
  },
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
