/**
 * lib/brain/proposal/evidence-facet.ts · WHERE A KIND'S EVIDENCE COMES FROM.
 *
 * ── WHY THIS IS A FACET AND NOT A COMMENT ──────────────────────────────────
 *
 * `facets.ts`'s `GENERATOR_REGISTRY` answers "what SHAPES this action" — the
 * function that builds the union member and the live path that calls it. It
 * does not answer the question underneath it: what MEASUREMENT gives the engine
 * the right to raise this at all.
 *
 * The two are genuinely different and this repo has already paid for treating
 * them as one. `lib/brain/objective.ts` requires a decline to state a fact, and
 * `writeWorkoutProposals` enforces that on the live path by withholding a
 * load-reducing card whose `why` names a disposition ("safer", "this looks
 * aggressive") rather than a reading. A generator can be perfectly wired to a
 * detector that measures nothing — that is exactly the shape of a card the
 * runner is asked to accept with no evidence behind it, and the ONLY thing
 * standing between the engine and one is a per-kind statement of which reader
 * is supposed to have supplied the number.
 *
 * So each kind names its reader, by MODULE and EXPORTED SYMBOL, and the
 * completeness gate resolves both against the real files. A rename that
 * silently disconnects a lever from its evidence fails there rather than being
 * discovered by a runner reading a card whose "why" is a shrug.
 *
 * ── AND IT IS USED, NOT ONLY ASSERTED ──────────────────────────────────────
 *
 * `evidenceFamilyOf` is stamped onto every row `write.ts` inserts, under
 * `evidence.evidence_family`. The detail sheet reads the evidence blob
 * (`v5-proposals.ts:detailFor`), so "How the anchor is known" style provenance
 * becomes answerable for kinds whose trigger wrote no blob at all — which is
 * every kind the new writer carries, because a HOLD and a SAFETY_STOP have no
 * `AdaptationTrigger` behind them to have written one.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE READER WAS ACTUALLY CONSULTED. This is a DECLARATION, exactly
 *   as `DOSE_EVIDENCE_READERS` in `dose-responsive.ts` is one, and it carries
 *   the same warning: if a generator answers "how much volume was absorbed"
 *   with a count of easy runs, the arithmetic is identical and every assertion
 *   here passes. It proves the reader EXISTS and is NAMED, never that the
 *   number came from it.
 * · WHETHER THE EVIDENCE IS GOOD. Sizing and credibility belong to the
 *   adjudicator and to the readers themselves.
 * · A KIND WHOSE FAMILY IS RIGHT AND WHOSE READER MOVED. The module path and
 *   symbol are checked; the family word is not checkable against anything,
 *   because it is a label this file invents for the report.
 */

import type { ActionKind, BrainAction } from './action';

/**
 * The measurement families this engine actually has.
 *
 * A closed vocabulary on purpose. An open string would let a new kind declare
 * "evidence: heuristics" and pass, which is the shape `describesEvidence`
 * exists to refuse one level up.
 */
export type EvidenceFamily =
  /** Canonical pace anchors, and the belief behind them. */
  | 'PACE_ANCHOR'
  /** The weekly progression gate's verdict on one session's shape. */
  | 'PROGRESSION_GATE'
  /** `detectAdaptations`' triggers: gaps, overshoot, readiness, spacing. */
  | 'DETECTION_PASS'
  /** Demonstrated volume the runner actually absorbed against what was asked. */
  | 'VOLUME_EVIDENCE'
  /** The safety owner's verdict. Never re-derived, only consumed. */
  | 'SAFETY_VERDICT'
  /** The authority seam refusing an unattended action. */
  | 'AUTHORITY_SEAM'
  /** The runner said so. Not a measurement, and labelled as not one. */
  | 'RUNNER_STATED'
  /** An earning gate whose readings are taken on an assessment date. */
  | 'EARNING_GATE';

export interface EvidenceRef {
  readonly family: EvidenceFamily;
  /** Repo-relative from `web-v2/`. Must exist. */
  readonly module: string;
  /** An exported symbol in that module that produces the reading. */
  readonly symbol: string;
  /** What it measures, in one line. */
  readonly measures: string;
}

/**
 * The evidence behind each kind, or null when nothing measures it yet.
 *
 * A null MUST have a matching `EVIDENCE_SOURCE` entry in `FACET_GAPS`, and the
 * completeness gate asserts both directions — so a kind cannot quietly acquire
 * a reader without the ratchet shrinking, and a ratchet entry cannot stand
 * while a reader is named.
 */
export const EVIDENCE_REGISTRY: Readonly<Record<ActionKind, EvidenceRef | null>> = {
  PACE_CHANGE: {
    family: 'PACE_ANCHOR',
    module: 'lib/plan/reanchor-proposal.ts',
    symbol: 'anchorMovesBetween',
    measures: 'the distance between the anchors the block was priced at and the anchors the '
      + 'runner\'s evidence now supports, per anchor rather than as one mean',
  },
  DISTANCE_CHANGE: {
    family: 'DETECTION_PASS',
    module: 'lib/plan/adapt.ts',
    symbol: 'detectAdaptations',
    measures: 'volume overshoot, a training gap, a readiness pull-back, or the adaptive ramp '
      + 'finding headroom for a bump',
  },
  DURATION_CHANGE: PROGRESSION('the rep length the weekly gate resolved for this session'),
  DURATION_PROGRESS_OFFER: PROGRESSION(
    'the rep length the weekly gate resolved to ACCELERATE for this session, offered to the '
    + 'runner rather than applied',
  ),
  REPETITION_CHANGE: PROGRESSION('the rep count the weekly gate resolved for this session'),
  RECOVERY_INTERVAL_CHANGE: PROGRESSION('the jog between reps the weekly gate resolved'),
  QUALITY_DOSE_CHANGE: PROGRESSION('total minutes at pace, as the weekly gate resolved them'),
  /* CLOSED 2026-09-06 (LONGRUNSTRUCTURE-1). A verdict on the long run's own
   * SHAPE — completion and late-session fade on the last two long runs — which
   * is the same conceptual question `PROGRESSION_GATE` already names for the
   * three quality families, on a different session type the quality gate
   * cannot reach. Built independently of the distance lever's own bar
   * (`lib/adaptation/canonical/levers/long-run.ts`) rather than importing it:
   * `lib/brain/**` may reach `lib/adaptation/canonical/**` only through
   * `lib/brain/orchestration/canonical-phase.ts`, so this reader restates the
   * same doctrine numbers by value instead — see the module's own header. */
  LONG_RUN_STRUCTURE_CHANGE: {
    family: 'PROGRESSION_GATE',
    module: 'lib/brain/proposal/evidence/long-run-structure.ts',
    symbol: 'resolveLongRunStructureEvidence',
    measures: 'whether the last two long runs were completed and held their effort to the finish, '
      + 'and whether the upcoming one already carries a race-pace segment',
  },
  WORKOUT_TYPE_CHANGE: {
    family: 'DETECTION_PASS',
    module: 'lib/plan/adapt.ts',
    symbol: 'detectAdaptations',
    measures: 'a readiness or fatigue reading that says this session should not be quality today',
  },
  /* CLOSED 2026-09-06 (ADDFREQ-EVIDENCE-1). `derivedTrainingDaysPerWeek` was
   * already the canonical, Rule-8-filtered answer to "how many days a week is
   * this runner actually absorbing" — the rank-3-over-16-weeks reader
   * `lib/runner-state/ownership.ts`'s RUN_FREQUENCY_TOLERANCE entry names as
   * canonical for exactly this question, live on the authoring path since
   * 2026-08-30 and simply never exported for a proposal reader to cite. This
   * closes the EVIDENCE_SOURCE gap only: nothing yet compares this reading
   * against what the plan currently schedules and turns the gap into a
   * session (the GENERATOR gap, below and in `facets.ts`, is the composer-
   * wiring blocker and is unaffected by this). */
  ADD_WORKOUT: {
    family: 'VOLUME_EVIDENCE',
    module: 'lib/plan/generate.ts',
    symbol: 'derivedTrainingDaysPerWeek',
    measures: 'the rank-3 highest distinct-run-day count over the last 16 seven-day blocks — a '
      + 'Rule 8-filtered ceiling on how many days a week this runner actually runs',
  },
  REMOVE_WORKOUT: null,
  FREQUENCY_CHANGE: {
    family: 'VOLUME_EVIDENCE',
    module: 'lib/plan/generate.ts',
    symbol: 'derivedTrainingDaysPerWeek',
    measures: 'the rank-3 highest distinct-run-day count over the last 16 seven-day blocks — the same '
      + 'reading ADD_WORKOUT cites, compared against the plan\'s currently authored day count',
  },
  RESCHEDULE: {
    family: 'DETECTION_PASS',
    module: 'lib/plan/adapt.ts',
    symbol: 'detectAdaptations',
    measures: 'a missed session or a spacing conflict between the long run and a quality day',
  },
  COORDINATED: {
    family: 'PACE_ANCHOR',
    module: 'lib/plan/reanchor-proposal.ts',
    symbol: 'meanAnchorDelta',
    measures: 'the net direction of every anchor that moved, across the whole remaining block',
  },
  RACE_TARGET_CHANGE: {
    /* NOT a measurement, and labelled so. The coach projects and never
     * renegotiates a stated goal; the only thing that may move a target is the
     * runner saying so. That is why the GENERATOR for this kind is a permanent
     * ratchet entry and this row names no detector. */
    family: 'RUNNER_STATED',
    module: 'lib/brain/objective.ts',
    symbol: 'describesEvidence',
    measures: 'nothing. The target is the runner\'s statement, and the only check that applies '
      + 'is that whatever is said about it names a fact',
  },
  TAPER_CHANGE: null,
  RECOVERY_CHANGE: null,
  CONDITIONAL: {
    family: 'EARNING_GATE',
    module: 'lib/plan/adjudication/dose-responsive.ts',
    symbol: 'resolveDose',
    measures: 'whether the readings taken on the assessment date satisfy the requirements the '
      + 'gate stated when the decision was deferred',
  },
  FIELD_TEST: {
    family: 'DETECTION_PASS',
    module: 'lib/plan/adapt.ts',
    symbol: 'fieldTestGate',
    measures: 'how long it has been since a race or a timed effort re-anchored the paces',
  },
  HOLD: PROGRESSION('the shape the gate resolved, unchanged, and the reason it did not move'),
  REFUSAL: {
    family: 'AUTHORITY_SEAM',
    module: 'lib/plan/adaptation-authority.ts',
    symbol: 'sealAutomaticActions',
    measures: 'which plan-mutating actions an unattended job produced while automatic authority '
      + 'was closed',
  },
  SAFETY_STOP: {
    family: 'SAFETY_VERDICT',
    module: 'lib/safety/load-safety.ts',
    symbol: 'resolveSafety',
    measures: 'injury, illness and niggle state, as the one canonical safety owner reads them',
  },
};

/** The family behind an action, for the row's evidence blob. Null when none. */
export function evidenceFamilyOf(action: BrainAction): EvidenceFamily | null {
  return EVIDENCE_REGISTRY[action.kind]?.family ?? null;
}

/**
 * The four session-geometry kinds and HOLD all come from one gate, so the ref
 * is built once rather than typed five times. A function declaration is used
 * so it is hoisted above the registry literal that calls it.
 */
function PROGRESSION(measures: string): EvidenceRef {
  return {
    family: 'PROGRESSION_GATE',
    module: 'lib/plan/progression-pass.ts',
    symbol: 'resolveWeekProgression',
    measures,
  };
}
