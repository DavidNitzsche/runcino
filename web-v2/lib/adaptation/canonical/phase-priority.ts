/**
 * lib/adaptation/canonical/phase-priority.ts · WHICH LEVER GOES FIRST, AND WHY,
 * IN THIS PHASE OF THIS BLOCK.
 *
 * ── WHAT THIS REPLACED, AND WHY IT HAD TO GO ───────────────────────────────
 *
 * `arbitration.ts` carried a STATIC global constant:
 *
 *     ARBITRATION_PRIORITY = ['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE']
 *
 * cited, in its own header, to PROGRESSIVE_BASELINE_DOCTRINE.md Q8's
 * "Duration is the primary early lever. Pace moves in smaller increments."
 *
 * Read Q8's own heading: **"Marathon-effort progression in the baseline"**, and
 * the sentence sits under the row **"Early marathon-specific work"**. It is a
 * claim about the EARLY part of a block. The constant applied it to every phase
 * of every block, including the taper — where the same document says the exact
 * opposite: "Taper by removing fatigue, not by completing unfinished
 * development."
 *
 * So one sentence about one phase was governing all of them. That is the same
 * defect shape CLAUDE.md Rule 16 names (one name carrying two quantities) and
 * the same shape `arbitration.ts` fixed for rule 1 the day before: a predicate
 * answering a question it was not asked.
 *
 * ── WHAT PRIORITY DEPENDS ON NOW, AND WHERE EACH INPUT COMES FROM ──────────
 *
 * The owner's list, item by item, with the honest answer for each:
 *
 *   · TRAINING PHASE · `PhaseContext.phase`, authored by the plan generator.
 *     Read, never re-derived. `docs/BRAIN_CONSTITUTION.md` §2H gives "phase
 *     progression" to the Plan Generator; a second derivation here would be a
 *     second owner.
 *   · GOAL EVENT · `RaceCalendar.raceDistance`. It changes what SPECIFICITY
 *     means, and therefore which lever a race-specific phase promotes: a
 *     marathon's specific work is the long run, a 5K's is race pace.
 *   · CURRENT LIMITER · `PhaseContext.limiter`, supplied by the Coaching
 *     Thesis (§2F owns `primary_limiter`). Never inferred here.
 *   · TIME REMAINING · reaches priority THROUGH the phase, because the phase is
 *     what the plan generator derives from time remaining. Reading weeks-to-race
 *     here as well would give this engine a second opinion about when a block
 *     becomes race-specific, and it would put a THRESHOLD ON A CONTINUOUS
 *     QUANTITY back into the ordering, which is exactly Rule 9's cliff. It is
 *     recorded in `readThrough` rather than silently dropped.
 *   · RECENT ADAPTATION · `ProjectedPlanContext.stepsTakenThisCycle`, an
 *     integer count per lever. A lever that has already spent its step this
 *     cycle sorts behind one that has not.
 *   · CURRENT FATIGUE · DELEGATED, and this is the one item not read here.
 *     `input.ts` physically excludes readiness, sleep, HRV, resting HR and TSB
 *     from this engine, and re-deriving "fatigue" from the same weeks the
 *     levers already read would be a second answer to a question the demand
 *     ceiling and each lever's own verdict already answer. Recorded in
 *     `notRead` with that reason, so it is a stated delegation and not an
 *     omission.
 *   · INJURY / ILLNESS STATE · `PhaseContext.safety`, a verdict handed over by
 *     the Safety owner (§2E: "Safety may override other systems"). This engine
 *     DERIVES nothing about it — that would be the "injury or illness
 *     automation" `input.ts` forbids. It consumes a hard stop and refuses.
 *   · SPECIFICITY NEEDS · delivered by phase x goal event, above.
 *   · COMPETING PROPOSALS · the resolved order is applied to the actual verdict
 *     set in `arbitration.ts`, and rule 3 still allows one material lever per
 *     cycle. Ordering only decides WHICH survives, never how many.
 *
 * ── THE TAPER CLAUSE, AND WHY IT IS NOT A SECOND RULE ──────────────────────
 *
 * "Do not mechanically push during a taper merely to satisfy the objective."
 *
 * `lib/brain/objective.ts` already settles this and is not restated here. Its
 * `objectionToChoice` treats `PRESCRIBED_RECOVERY` and `HARD_STOP` as the two
 * bases that outrank a SUPPORTED push, and `declineFor` below returns exactly
 * one of those two for the phases that decline. `phaseDeclineIsAdmissible`
 * runs the decline back through `objectionToChoice` so the admissibility is
 * ASSERTED by the objective's own function rather than asserted by this file
 * agreeing with itself (Rule 18: a check that hardcodes both sides only proves
 * the test agrees with itself).
 *
 * ── RULE 9 · WHY THIS ORDERING HAS NO CLIFF ────────────────────────────────
 *
 * Every input to the ORDER is an enum or an integer count: phase, race
 * distance, limiter, safety posture, steps-taken. There is no continuous
 * quantity for a hair to move, which is Rule 9's strongest answer — the cliff
 * is REMOVED rather than smoothed, exactly as `adapt.ts`'s scheduled-day count
 * removed one instead of interpolating it.
 *
 * A phase boundary IS discrete, and Rule 9 permits that ("a behaviour may be
 * discrete"). What it forbids is a DECISION hinging on a hair. Two properties
 * keep this admissible, and both are asserted:
 *
 *   · The consequence of an order change is which proposal is priced first
 *     against a cumulative week, so the loser is DEFERRED AND QUEUED, never
 *     lost. `deferral-queue.ts` reconsiders it at the next boundary.
 *   · The consequence of a declining phase is DEFER, not DROP, and it carries
 *     `reconsiderAtISO`. A runner who enters a taper does not lose the
 *     threshold evidence he earned; it waits for the race to pass.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · It cannot fail on THE ORDER BEING THE WRONG COACHING ANSWER. Every entry
 *   below is either quoted from a research table or labelled
 *   POLICY_ASSUMPTION, and a test can check that the quote resolves and that
 *   the label is present. Nothing here can check that "the long run before
 *   weekly volume in a marathon's specific phase" produces better marathons.
 * · It cannot fail on THE PHASE BEING MISLABELLED UPSTREAM. `phase` is read
 *   off the authored plan. A race-specific block the generator stamped BASE
 *   is invisible here and belongs to whatever authors the phases.
 * · It cannot fail on THE LIMITER BEING WRONG. The Coaching Thesis owns it;
 *   this file promotes whichever lever the limiter names and has no way to
 *   check the naming.
 * · It cannot fail on THE SAFETY VERDICT BEING LATE. A hard stop that reaches
 *   this engine a day after it should have produces a legal, well-formed,
 *   wrong evaluation, and the only thing that would say so is the Safety
 *   owner's own freshness.
 * · The DISTRIBUTION is deliberately lopsided and that is a finding, not an
 *   accident: two of the seven phases decline every demand increase. Doctrine
 *   licenses it in terms for both (a taper removes fatigue, a recovery block
 *   restores), and the counter-pressure Rule 21 asks for is that FIVE phases
 *   advance and none of the five raises the bar to go up above the bar to come
 *   down: `defersDemandIncrease` is the only suppressing field on this type,
 *   and no phase sets a downward-only equivalent.
 */
import type { CanonicalLever, RaceCalendar } from './input';
import type { DeclineBasis, DeclineJustification } from '@/lib/brain/objective';
import { objectionToChoice } from '@/lib/brain/objective';

/* ══════════════════════════════════════════════════════════════════════════
 * THE VOCABULARY
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The block phase, in the plan generator's OWN labels.
 *
 * `lib/plan/generate.ts` authors exactly these words — 'BASE', 'QUALITY',
 * 'RACE-SPECIFIC', 'TAPER', 'MAINTENANCE', 'RECOVERY' — into `plan_phases
 * .label`, and `phaseFromAuthoredLabel` below is the one translation. Coining
 * a second phase vocabulary here (the owner's brief says "threshold
 * development" and "marathon preparation") would be Rule 16: one quantity, two
 * names, and the two would drift the first time the generator gained a phase.
 *
 * The mapping to the owner's words, stated once so nobody has to guess:
 *
 *   base                  -> BASE
 *   threshold development -> QUALITY
 *   marathon preparation  -> RACE_SPECIFIC
 *   taper                 -> TAPER
 *   recovery              -> RECOVERY
 *   injury                -> NOT A PHASE. It is `SafetyPosture.HARD_STOP`,
 *                            because it can arrive in any phase and outranks
 *                            all of them.
 */
export type TrainingPhase =
  | 'BASE'
  | 'QUALITY'
  | 'RACE_SPECIFIC'
  | 'TAPER'
  | 'RECOVERY'
  | 'MAINTENANCE'
  /** Rule 11 · the phase could not be read. Not the same as BASE. */
  | 'UNKNOWN';

export const TRAINING_PHASES: readonly TrainingPhase[] = [
  'BASE', 'QUALITY', 'RACE_SPECIFIC', 'TAPER', 'RECOVERY', 'MAINTENANCE', 'UNKNOWN',
];

/**
 * The Safety owner's verdict, CARRIED not derived.
 *
 * `docs/BRAIN_CONSTITUTION.md` §2E: "Safety may override other systems. Other
 * systems may not override Safety." `lib/brain/objective.ts` says the same in
 * `OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP`.
 *
 * Two members only. There is no 'CAUTION' here on purpose: a graded safety
 * signal that this engine interpreted would be it making a safety judgement,
 * which is the ownership violation. Either ordinary training logic may proceed
 * or it may not.
 */
export type SafetyPosture = 'NORMAL' | 'HARD_STOP';

/**
 * What the Coaching Thesis says is currently holding this runner back.
 *
 * §2F owns `primary_limiter`. This engine reads the name and promotes the
 * lever that addresses it; it never computes one.
 */
export type CurrentLimiter =
  | 'DURABILITY'
  | 'THRESHOLD'
  | 'SPECIFICITY'
  | 'VOLUME_TOLERANCE'
  /** Measured: nothing is currently the binding limiter. */
  | 'NONE'
  /** Rule 11 · no thesis has answered. Not the same as NONE. */
  | 'UNKNOWN';

/** What the phase is FOR, in one word. */
export type PhasePosture =
  /** Ordinary training. Upward proposals may proceed. */
  | 'ADVANCE'
  /** Freshness dominates. Useful intensity is preserved, nothing is added. */
  | 'PRESERVE'
  /** Restoration dominates. */
  | 'RESTORE'
  /** A safety hard stop. Nothing proceeds. */
  | 'STOP';

/**
 * Where a priority came from.
 *
 * The owner's requirement, verbatim: "Cite each phase's priority to
 * `Research/` or label it POLICY_ASSUMPTION at the constant. Do not dress a
 * chosen order as physiology."
 */
export interface PriorityCitation {
  readonly provenance: 'RESEARCH' | 'DOCTRINE' | 'POLICY_ASSUMPTION';
  /** The file, or '' for a policy assumption. */
  readonly doc: string;
  /** A VERBATIM anchor string in that file. Never a line number (Rule 7). */
  readonly anchor: string;
  /** What it says, in its own words where it is a quotation. */
  readonly says: string;
}

export interface PhasePolicy {
  readonly phase: TrainingPhase;
  /** Highest priority first. Total over the three levers. */
  readonly order: readonly CanonicalLever[];
  readonly posture: PhasePosture;
  /**
   * Every proposal that RAISES the projected week's demand is deferred under
   * this phase. The only suppressing field on this type (Rule 21 / Rule 22:
   * there is deliberately no downward-only twin).
   */
  readonly defersDemandIncrease: boolean;
  /**
   * The threshold anchor does not move in EITHER direction under this phase.
   * TAPER only, and it is symmetric on purpose: Q8's taper row asks to
   * "preserve the most recently supported effort", which a slower anchor
   * breaks just as surely as a faster one.
   */
  readonly freezesThresholdAnchor: boolean;
  /** The basis a decline under this phase carries. Null when it declines nothing. */
  readonly declineBasis: DeclineBasis | null;
  readonly citation: PriorityCitation;
  readonly why: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE TABLE  ·  one row per phase, each cited or labelled
 * ═══════════════════════════════════════════════════════════════════════ */

/** The phase-neutral order, and the two sentences that make it phase-neutral. */
const WORKLOAD_BEFORE_PACE: PriorityCitation = {
  provenance: 'DOCTRINE',
  doc: 'docs/PROGRESSIVE_BASELINE_DOCTRINE.md',
  anchor: 'Progress strong capacities mainly through',
  says: 'Progress strong capacities mainly through workload before moving their pace. '
    + 'Weekly volume precedes the long run because the contract makes the long run\'s '
    + 'validity depend on it ("Coherent with weekly volume"), and a dependency settles '
    + 'the order: the quantity that constrains the other moves first.',
};

const ORDER_LOAD_FIRST: readonly CanonicalLever[] = ['WEEKLY_VOLUME', 'LONG_RUN', 'THRESHOLD_PACE'];
const ORDER_THRESHOLD_MIDDLE: readonly CanonicalLever[] = ['WEEKLY_VOLUME', 'THRESHOLD_PACE', 'LONG_RUN'];
const ORDER_LONG_RUN_FIRST: readonly CanonicalLever[] = ['LONG_RUN', 'WEEKLY_VOLUME', 'THRESHOLD_PACE'];
const ORDER_PACE_FIRST: readonly CanonicalLever[] = ['THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN'];

/**
 * The base table, before the goal event and the limiter are applied.
 *
 * RACE_SPECIFIC's `order` here is the marathon/half reading; `orderFor` swaps
 * it for a 5K or a 10K, where race-specific means race pace rather than the
 * long run. The row carries the endurance reading because that is the one its
 * citation is about.
 */
export const PHASE_POLICY: Readonly<Record<TrainingPhase, PhasePolicy>> = {
  BASE: {
    phase: 'BASE',
    order: ORDER_LOAD_FIRST,
    posture: 'ADVANCE',
    defersDemandIncrease: false,
    freezesThresholdAnchor: false,
    declineBasis: null,
    citation: {
      provenance: 'RESEARCH',
      doc: 'Research/00a-distance-running-training.md',
      anchor: '| Base / aerobic conditioning | 8–16 wk | Easy mileage, long runs, strides | High, peak | Low |',
      says: 'The base phase\'s emphasis is easy mileage and long runs, its volume is high '
        + 'and peaking, and its intensity is LOW. The two load levers are what the phase is '
        + 'for; the threshold anchor is not.',
    },
    why: 'Easy volume and the long run are what a base phase develops. A faster threshold '
      + 'anchor is not the stimulus this phase exists to deliver, so it is arbitrated last.',
  },

  QUALITY: {
    phase: 'QUALITY',
    order: ORDER_THRESHOLD_MIDDLE,
    posture: 'ADVANCE',
    defersDemandIncrease: false,
    freezesThresholdAnchor: false,
    declineBasis: null,
    citation: {
      provenance: 'RESEARCH',
      doc: 'Research/00a-distance-running-training.md',
      anchor: '| Fundamental | 4–6 wk | Long tempos extended, then quickened; medium-long aerobic runs | Steady long runs, modest progression |',
      says: 'In the fundamental period the tempo work is extended and then quickened while '
        + 'the long run stays steady with only modest progression. Threshold therefore rises '
        + 'ABOVE the long run in this phase, and stays BELOW weekly volume, which is the '
        + 'substrate the quality sits on.',
    },
    why: 'A threshold-development phase is defined by the threshold stimulus, so the pace '
      + 'anchor is arbitrated before the long run. It stays behind weekly volume because the '
      + 'long run\'s own coherence check is priced against the week, and because doctrine\'s '
      + 'workload-before-pace principle is not suspended by the phase, only re-ranked within it.',
  },

  RACE_SPECIFIC: {
    phase: 'RACE_SPECIFIC',
    order: ORDER_LONG_RUN_FIRST,
    posture: 'ADVANCE',
    defersDemandIncrease: false,
    freezesThresholdAnchor: false,
    declineBasis: null,
    citation: {
      provenance: 'RESEARCH',
      doc: 'Research/00a-distance-running-training.md',
      anchor: '| Specific | 6–8 wk | Workouts simulate race demands at 95–105% of goal race pace | Long runs incorporate long blocks at goal pace + recovery between at 90–95% |',
      says: 'In the specific period the long run carries the race-specific work. For an '
        + 'endurance event the long run is therefore the session the week is built around, '
        + 'and it is arbitrated first so the week\'s headroom is spent on specificity.',
    },
    why: 'The specific phase makes the long run the race rehearsal. Ordering it first does '
      + 'not weaken the "coherent with weekly volume" dependency: that is checked inside the '
      + 'long-run lever itself, on every evaluation, whatever the order.',
  },

  TAPER: {
    phase: 'TAPER',
    // Nothing advances here, so the order decides nothing. It is kept at the
    // phase-neutral one rather than left undefined, because a partial order
    // would make the sort unstable and a reader would have to work out that
    // it does not matter.
    order: ORDER_LOAD_FIRST,
    posture: 'PRESERVE',
    defersDemandIncrease: true,
    freezesThresholdAnchor: true,
    declineBasis: 'PRESCRIBED_RECOVERY',
    citation: {
      provenance: 'RESEARCH',
      doc: 'Research/00a-distance-running-training.md',
      anchor: '| Taper | 1–3 wk | Reduced volume, intensity preserved | Low | Race-pace touches |',
      says: 'A taper reduces volume and PRESERVES intensity. Preserving is not raising: '
        + 'doctrine adds "Taper by removing fatigue, not by completing unfinished '
        + 'development", and for the anchor specifically, "preserve the most recently '
        + 'supported effort; no large new pace jump".',
    },
    why: 'Freshness dominates. Every proposal that raises the week\'s demand is deferred to '
      + 'after the race, and the threshold anchor is frozen in both directions, because '
      + 'preserving the most recently supported effort is broken by a slower anchor as much '
      + 'as by a faster one.',
  },

  RECOVERY: {
    phase: 'RECOVERY',
    order: ORDER_LOAD_FIRST,
    posture: 'RESTORE',
    defersDemandIncrease: true,
    // A REGRESS is restoration and is admitted, so the anchor is NOT frozen.
    freezesThresholdAnchor: false,
    declineBasis: 'PRESCRIBED_RECOVERY',
    citation: {
      provenance: 'RESEARCH',
      doc: 'Research/00b-recovery-protocols.md',
      anchor: '### Recovery by Distance',
      says: 'Post-race recovery is stated as a count of "total recovery days (no quality)" '
        + 'per distance. A block whose prescription is "no quality" cannot be the block in '
        + 'which the engine adds demand.',
    },
    why: 'Restoration dominates. Upward proposals wait; a downward one is the phase doing '
      + 'its job and proceeds.',
  },

  MAINTENANCE: {
    phase: 'MAINTENANCE',
    order: ORDER_LOAD_FIRST,
    posture: 'ADVANCE',
    defersDemandIncrease: false,
    freezesThresholdAnchor: false,
    declineBasis: null,
    citation: {
      provenance: 'POLICY_ASSUMPTION',
      doc: '',
      anchor: '',
      says: 'POLICY_ASSUMPTION. No research section in this repository governs the lever '
        + 'ordering of a maintenance block, because "maintenance" is this app\'s own word for '
        + 'a plan with no race in view rather than a periodisation phase. The phase-neutral '
        + 'order is used and labelled as chosen, not as physiology.',
    },
    why: 'No race is in view, so no phase-specific specificity claim applies. The '
      + 'phase-neutral workload-before-pace order stands, as a chosen default.',
  },

  UNKNOWN: {
    phase: 'UNKNOWN',
    order: ORDER_LOAD_FIRST,
    posture: 'ADVANCE',
    defersDemandIncrease: false,
    freezesThresholdAnchor: false,
    declineBasis: null,
    citation: WORKLOAD_BEFORE_PACE,
    why: 'Rule 11 · the phase could not be read, and an unreadable phase is not a base '
      + 'phase. The phase-neutral order is used, the unknown is recorded on the resolution '
      + 'so a reader sees it, and no phase-specific promotion or decline is applied — '
      + 'because applying one would mean acting on a phase nobody read.',
  },
};

/**
 * The lever a limiter names.
 *
 * `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`, §"Hold is a real, frequent,
 * correct state": "The adaptation brain asks: what is the current limiter? ...
 * Then chooses ONE lever." This is that mapping, and nothing more: the limiter
 * PROMOTES its lever to the front of the phase order, it does not authorise a
 * change the lever's own evidence contract has not.
 *
 * SPECIFICITY maps to the long run because that is where race specificity
 * lives for the endurance events this engine's long-run lever governs;
 * `orderFor` re-reads it against the goal event for a 5K or a 10K, where
 * specificity is race pace.
 */
const LIMITER_LEVER: Readonly<Record<CurrentLimiter, CanonicalLever | null>> = {
  DURABILITY: 'LONG_RUN',
  THRESHOLD: 'THRESHOLD_PACE',
  SPECIFICITY: 'LONG_RUN',
  VOLUME_TOLERANCE: 'WEEKLY_VOLUME',
  NONE: null,
  UNKNOWN: null,
};

/**
 * Events whose race-specific work is the long run rather than race pace.
 *
 * `Research/00a` §"Periodization choice by athlete and event" separates
 * "Marathon, intermediate-advanced | Linear or Canova" from "5K/10K
 * track-trained | Linear (Lydiard) or block", and the Lydiard sharpening row
 * is "Race-pace simulation, time trials". For a 5K the race pace IS the
 * specific stimulus; for a marathon the long run is.
 */
const ENDURANCE_SPECIFIC_EVENTS: ReadonlySet<RaceCalendar['raceDistance']> =
  new Set<RaceCalendar['raceDistance']>(['HALF', 'MARATHON']);

const SHORT_EVENT_SPECIFICITY: PriorityCitation = {
  provenance: 'RESEARCH',
  doc: 'Research/00a-distance-running-training.md',
  anchor: '| Sharpening / coordination | 3–4 wk | Race-pace simulation, time trials | Moderate-low | Race-pace |',
  says: 'For a 5K or a 10K the sharpening period is race-pace simulation, and race pace for '
    + 'those events sits at or above threshold. Specificity therefore promotes the pace '
    + 'anchor, not the long run.',
};

/* ══════════════════════════════════════════════════════════════════════════
 * THE RESOLUTION
 * ═══════════════════════════════════════════════════════════════════════ */

/** Everything priority is allowed to depend on. */
export interface PriorityContext {
  readonly phase: TrainingPhase;
  readonly raceDistance: RaceCalendar['raceDistance'];
  readonly limiter: CurrentLimiter;
  readonly safety: SafetyPosture;
  /** Upward steps already taken this cutback cycle, per lever. */
  readonly stepsTakenThisCycle: Readonly<Record<CanonicalLever, number>>;
}

export interface ResolvedPriority {
  readonly order: readonly CanonicalLever[];
  readonly phase: TrainingPhase;
  readonly posture: PhasePosture;
  readonly defersDemandIncrease: boolean;
  readonly freezesThresholdAnchor: boolean;
  readonly declineBasis: DeclineBasis | null;
  /** Every citation that contributed, in the order it was applied. */
  readonly citations: readonly PriorityCitation[];
  /** The POLICY_ASSUMPTION subset, called out because the owner asked for it. */
  readonly policyAssumptions: readonly string[];
  /** Rule 11 · what could not be read, named. */
  readonly unknowns: readonly string[];
  /** Inputs deliberately delegated to another owner, with the reason. */
  readonly notRead: readonly string[];
  /** Inputs that reach priority through another field rather than directly. */
  readonly readThrough: readonly string[];
  readonly why: string;
}

/** The base order for a phase and a goal event, before the limiter. */
function orderFor(
  phase: TrainingPhase,
  raceDistance: RaceCalendar['raceDistance'],
): { order: readonly CanonicalLever[]; extra: PriorityCitation | null } {
  const policy = PHASE_POLICY[phase];
  if (phase !== 'RACE_SPECIFIC') return { order: policy.order, extra: null };
  if (ENDURANCE_SPECIFIC_EVENTS.has(raceDistance)) return { order: policy.order, extra: null };
  return { order: ORDER_PACE_FIRST, extra: SHORT_EVENT_SPECIFICITY };
}

/** The lever the limiter promotes, once the goal event has been read. */
function limiterLever(
  limiter: CurrentLimiter,
  raceDistance: RaceCalendar['raceDistance'],
): CanonicalLever | null {
  const base = LIMITER_LEVER[limiter];
  if (base === null) return null;
  if (limiter === 'SPECIFICITY' && !ENDURANCE_SPECIFIC_EVENTS.has(raceDistance)) {
    return 'THRESHOLD_PACE';
  }
  return base;
}

/**
 * Move one lever to the front, keeping everything else in its existing order.
 *
 * A STABLE promotion, not a re-sort. That matters for Rule 9: the levers that
 * were not promoted keep their relative order exactly, so the only thing a
 * limiter can change is which single lever leads.
 */
function promote(
  order: readonly CanonicalLever[],
  lever: CanonicalLever,
): readonly CanonicalLever[] {
  return [lever, ...order.filter((l) => l !== lever)];
}

/**
 * Demote levers that have already spent their step this cutback cycle.
 *
 * A STABLE partition on an integer count: everything at zero keeps its order,
 * everything above zero keeps its order, and the first group leads. The
 * contract's "one upward step per cutback cycle" is still enforced by the
 * levers themselves; this only decides who is asked first when two are
 * competing, so a lever that has already moved does not take the week's
 * headroom from one that has not.
 */
function demoteSpent(
  order: readonly CanonicalLever[],
  steps: Readonly<Record<CanonicalLever, number>>,
): readonly CanonicalLever[] {
  const fresh = order.filter((l) => (steps[l] ?? 0) <= 0);
  const spent = order.filter((l) => (steps[l] ?? 0) > 0);
  return [...fresh, ...spent];
}

/**
 * THE ONE RESOLVER. `arbitration.ts` calls this and nothing else.
 *
 * The composition is LEXICOGRAPHIC and every step is discrete:
 *
 *   1 · safety   · a hard stop overrides everything and stops the resolution
 *   2 · phase    · the authored phase's cited order
 *   3 · event    · specificity re-read for a short event
 *   4 · limiter  · the named lever promoted, but never inside a declining phase
 *   5 · recent   · a lever that has spent its step this cycle sorts last
 */
export function resolveArbitrationPriority(ctx: PriorityContext): ResolvedPriority {
  const policyAssumptions: string[] = [];
  const unknowns: string[] = [];
  const citations: PriorityCitation[] = [];

  const notRead: readonly string[] = [
    // The forbidden vocabulary is named in this file's PROSE and nowhere in its
    // code, because `_forbidden_inputs.test.ts` scans the code and is right to.
    // See `input.ts`'s header for the ten inputs by name.
    'Current fatigue as a daily wearable or subjective signal. This engine\'s input type has '
    + 'nowhere to put one, deliberately, and the exclusion list is stated by name in '
    + 'input.ts. What the runner is currently absorbing reaches arbitration through the '
    + 'demand ceiling and through each lever\'s own verdict, and a second reading here would '
    + 'be a second answer to a question those two already own.',
  ];
  const readThrough: readonly string[] = [
    'Time remaining, which reaches priority through the authored phase. The plan generator '
    + 'derives the phase from the runway; re-reading weeks-to-race here would be a second '
    + 'opinion about when a block turns race-specific, and it would put a threshold on a '
    + 'continuous quantity back into the ordering.',
    'Recent adaptation, read as stepsTakenThisCycle, an integer count per lever.',
    'Competing proposals, which are the verdict set the resolved order is applied to.',
  ];

  /* ── 1 · SAFETY ─────────────────────────────────────────────────────────
   *
   * A hard stop is not a phase and does not re-rank anything. It stops the
   * engine from advancing at all, and the resolution says so rather than
   * producing an ordering nobody will use.
   */
  if (ctx.safety === 'HARD_STOP') {
    const cite: PriorityCitation = {
      provenance: 'DOCTRINE',
      doc: 'docs/BRAIN_CONSTITUTION.md',
      anchor: 'SAFETY > TRAINING OPTIMIZATION',
      says: 'Safety may override other systems. Other systems may not override Safety. '
        + 'lib/brain/objective.ts states the same as OBJECTIVE_NEVER_OVERRIDES_A_HARD_STOP.',
    };
    return {
      order: PHASE_POLICY.UNKNOWN.order,
      phase: ctx.phase,
      posture: 'STOP',
      defersDemandIncrease: true,
      freezesThresholdAnchor: true,
      declineBasis: 'HARD_STOP',
      citations: [cite],
      policyAssumptions: [],
      unknowns: [],
      notRead,
      readThrough,
      why: 'The Safety owner has raised a hard stop. Nothing this engine could propose '
        + 'outranks it, so every lever is deferred and none is applied. The evidence is '
        + 'recorded and waits for Safety to lift the stop, which is Safety\'s call and not '
        + 'a date this engine can schedule.',
    };
  }

  /* ── 2 and 3 · PHASE, then the goal event ──────────────────────────────── */

  const policy = PHASE_POLICY[ctx.phase];
  citations.push(policy.citation);
  if (policy.citation.provenance === 'POLICY_ASSUMPTION') {
    policyAssumptions.push(`The ${ctx.phase} lever order is a policy assumption. ${policy.citation.says}`);
  }
  if (ctx.phase === 'UNKNOWN') {
    unknowns.push(
      'The training phase of this block could not be read. It is not being treated as a base '
      + 'phase: the phase-neutral order is used, and no phase-specific promotion or decline '
      + 'was applied.',
    );
  }

  const { order: phaseOrder, extra } = orderFor(ctx.phase, ctx.raceDistance);
  if (extra !== null) citations.push(extra);

  /* ── 4 · THE LIMITER ────────────────────────────────────────────────────
   *
   * Never inside a declining phase. Promoting the limiter's lever in a taper
   * would be the engine deciding which thing to push while doctrine is telling
   * it not to push at all, which is the "mechanically push during a taper"
   * failure wearing a coaching justification.
   */
  const advancing = policy.posture === 'ADVANCE';
  const promoted = advancing ? limiterLever(ctx.limiter, ctx.raceDistance) : null;
  let order = promoted === null ? phaseOrder : promote(phaseOrder, promoted);

  if (ctx.limiter === 'UNKNOWN') {
    unknowns.push(
      'No coaching thesis has named a current limiter, so no lever was promoted for one. '
      + 'That is an absence and not a finding that nothing is limiting him.',
    );
  }
  if (promoted !== null) {
    citations.push({
      provenance: 'DOCTRINE',
      doc: 'docs/ADAPTATION_PROGRESSION_DOCTRINE.md',
      anchor: 'What is the current limiter?',
      says: 'The adaptation brain asks what the current limiter is, and then chooses ONE '
        + 'lever. The limiter promotes its lever to the front of the phase order; it does '
        + 'not authorise a change the lever\'s own evidence contract has not.',
    });
  }

  /* ── 5 · RECENT ADAPTATION ──────────────────────────────────────────────── */

  const before = order;
  order = demoteSpent(order, ctx.stepsTakenThisCycle);
  if (before.join() !== order.join()) {
    citations.push({
      provenance: 'DOCTRINE',
      doc: 'docs/ADAPTATION_ENGINE_CONTRACT.md',
      anchor: 'one upward step per cutback cycle',
      says: 'A lever that has already taken its step this cutback cycle is asked after one '
        + 'that has not, so it does not spend the week\'s headroom twice. The cap itself is '
        + 'enforced by the lever, not by this ordering.',
    });
  }

  return {
    order,
    phase: ctx.phase,
    posture: policy.posture,
    defersDemandIncrease: policy.defersDemandIncrease,
    freezesThresholdAnchor: policy.freezesThresholdAnchor,
    declineBasis: policy.declineBasis,
    citations,
    policyAssumptions,
    unknowns,
    notRead,
    readThrough,
    why: `${policy.why} Order: ${order.join(' then ')}.`,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE DECLINE  ·  routed through lib/brain/objective, never restated
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Does this phase decline THIS proposal, and on what basis?
 *
 * Null means the phase declines nothing here and ordinary arbitration
 * continues. A justification means the phase is declining, and it is the same
 * `DeclineJustification` shape `lib/brain/objective.ts` adjudicates — so the
 * decline is answerable by the objective rather than by a second rule written
 * here.
 */
export function phaseDeclineFor(args: {
  readonly priority: ResolvedPriority;
  readonly lever: CanonicalLever;
  /** True when applying this proposal raises the projected week's demand. */
  readonly increasesDemand: boolean;
  /** True when the proposal moves anything at all. */
  readonly moves: boolean;
}): DeclineJustification | null {
  const { priority, lever, increasesDemand, moves } = args;
  if (!moves) return null;
  if (priority.declineBasis === null) return null;

  if (priority.posture === 'STOP') {
    return {
      basis: 'HARD_STOP',
      because: 'the Safety owner has raised a hard stop on this runner, and a hard stop '
        + 'outranks every capacity finding this engine can produce',
      wouldAdvanceIf: 'Safety lifts the stop. That is Safety\'s judgement, not a date this '
        + 'engine can schedule against.',
    };
  }

  const frozenAnchor = priority.freezesThresholdAnchor && lever === 'THRESHOLD_PACE';
  if (!increasesDemand && !frozenAnchor) return null;

  return {
    basis: 'PRESCRIBED_RECOVERY',
    because: frozenAnchor && !increasesDemand
      ? `the block is in its ${phaseWord(priority.phase)} and the threshold anchor is held at `
        + 'the most recently supported effort, which a slower anchor breaks as surely as a '
        + 'faster one'
      : `the block is in its ${phaseWord(priority.phase)}, which is prescribed to `
        + `${priority.posture === 'RESTORE' ? 'restore' : 'remove fatigue'} rather than to `
        + 'complete unfinished development',
    wouldAdvanceIf: 'the block leaves this phase. The evidence is recorded and the proposal '
      + 'is queued for the next boundary rather than dropped.',
  };
}

const phaseWord = (p: TrainingPhase): string =>
  p === 'TAPER' ? 'taper' : p === 'RECOVERY' ? 'recovery block' : p.toLowerCase().replace(/_/g, ' ');

/**
 * Is a phase decline ADMISSIBLE against the governing objective?
 *
 * Runs the decline back through `objectionToChoice` with the strongest possible
 * push evidence — SUPPORTED — because that is the only case where the objective
 * has anything to say. An empty string is the pass; a sentence is the
 * objective's own objection, and a caller that produced it has invented a
 * decline the objective does not permit.
 *
 * This exists so the taper clause is enforced by the objective's function
 * rather than by this file asserting that it agrees with itself (Rule 18).
 */
export function phaseDeclineObjection(justification: DeclineJustification): string | null {
  return objectionToChoice({
    chosen: 'HOLD',
    pushEvidence: 'SUPPORTED',
    declines: new Map([['HOLD', justification]]),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * READING THE PHASE OFF AN AUTHORED PLAN
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The plan generator's own label, translated once.
 *
 * `lib/plan/generate.ts` writes 'BASE', 'QUALITY', 'RACE-SPECIFIC', 'TAPER',
 * 'MAINTENANCE' and 'RECOVERY' into `plan_phases.label`. Rule 11: anything
 * else — including null, an empty string and a label a future generator adds —
 * is UNKNOWN, never a default phase.
 */
export function phaseFromAuthoredLabel(label: string | null | undefined): TrainingPhase {
  const t = String(label ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  switch (t) {
    case 'BASE': return 'BASE';
    case 'QUALITY': return 'QUALITY';
    case 'RACE_SPECIFIC': return 'RACE_SPECIFIC';
    case 'TAPER': return 'TAPER';
    case 'RECOVERY': return 'RECOVERY';
    case 'MAINTENANCE': return 'MAINTENANCE';
    default: return 'UNKNOWN';
  }
}
