/**
 * lib/plan/adjudication/dose-responsive.ts · A FUTURE DOSE THAT CAN STILL BE EARNED.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * David asked for a dose-responsive taper, then widened it in the same breath:
 * it has to be a GENERAL system, not a rule for one date. The shape he asked
 * for, seven parts, and every one of them is a field or a method below:
 *
 *   1 · the current safe prescription          `defaultDose`
 *   2 · the higher earned option               `earnedDose`
 *   3 · the evidence required to earn it       `earn`
 *   4 · a reassessment date                    `assessOnISO`
 *   5 · a fallback if evidence is incomplete   `onIncompleteEvidence`
 *   6 · a maximum permitted change             `cap`
 *   7 · a runner-facing explanation, BOTH
 *       when it changes and when it does not   `DoseVerdict.say`
 *
 * ── WHAT IS ACTUALLY NEW HERE ──────────────────────────────────────────────
 *
 * `contract.ts` already carries `EarningGate`, and `adjudicate.ts` already
 * builds one. What neither carries is an EVALUATOR: a gate today is a promise
 * with nobody scheduled to keep it. `checkPromotion` verifies that a
 * CONDITIONAL decision HAS a gate and never asks what happens on the assessment
 * date. So `DoseEarningGate extends EarningGate` rather than replacing it
 * (Rule 16: there is one gate shape in this codebase and this is not a second
 * one), and `resolveDose` is the half that was missing.
 *
 * The second new thing is the AXIS. Every adaptation path that exists today
 * moves PACE: `recompute-paces.ts` behind the threshold anchor,
 * `levers/threshold-pace.ts` inside the canonical engine. A pace-only engine
 * cannot answer "should the marathon-pace block be four miles or eight", which
 * is `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`'s point in one line:
 *
 *   "Rep count, rep duration, recovery length, continuous-vs-broken work,
 *    where quality appears within a long run · all separate levers from pace
 *    or volume."
 *
 * So the axes here are distance, quality dose, repetitions, rep duration and
 * recovery length. Pace is deliberately NOT one of them: it has an owner, and
 * adding a second answer to an owned question is what `BRAIN_CONSTITUTION.md`
 * rejects a PR for.
 *
 * ── THIS MODULE READS NOTHING ──────────────────────────────────────────────
 *
 * It is pure, opens no database and defines no reader. Every quantity it
 * consumes arrives as a `Measured<number>` produced by a reader that already
 * exists, and `DOSE_EVIDENCE_READERS` names which one, by module and symbol, so
 * `_dose_responsive.test.ts` can prove each still exists. The adapters at the
 * bottom of this file convert those readers' OUTPUT types into
 * `Measured<number>`; none of them measures anything itself.
 *
 * ── RULE 22 · WHAT THIS FILE AND ITS GATES CANNOT FAIL ON ──────────────────
 *
 * They cannot fail on the DOSES being wrong. `defaultDose`, `earnedDose` and
 * every threshold in `earn` arrive from the caller with a citation attached,
 * and this module checks their SHAPE (ordered, inside the cap, reachable),
 * never their physiology. A prescription that offers to take a runner from 5
 * miles at marathon pace to 15 passes every assertion here as long as the
 * caller labels it. `_malibu_dose_trace.test.ts` is where the numbers are
 * checked, and it checks them by parsing the cited `Research/` rows at run
 * time rather than by restating them.
 *
 * They cannot fail on the READINGS being the right readings. If a caller
 * answers the requirement "sessions that count as evidence" with a count of
 * easy runs, the arithmetic is identical and every test passes. `reader` on
 * each requirement is the only defence and it is a declaration, not a proof.
 *
 * They cannot fail on a requirement being UNREACHABLE IN PRACTICE. Rule 21's
 * standard is "compute what the runner would have had to do, then check whether
 * any week they have actually run would have". `auditSymmetry` catches a gate
 * that cannot move anything at all, and `_malibu_dose_trace.test.ts` runs the
 * owner's real weeks through one gate. Neither generalises: a threshold set two
 * miles above anything he has ever done reads as a legal gate here.
 *
 * They are ONE-SIDED in one specific way, stated because Rule 22 is about
 * naming this rather than discovering it later: `auditSymmetry` compares the
 * bar to go UP against the bar to come DOWN and fires when up is harder. It
 * does NOT fire when down is harder. That direction was left alone on purpose,
 * because a reduction that is hard to trigger is a coaching defect and not a
 * safety one, and because Rule 22's own measurement of this repository found
 * twenty-nine test files that know how to hold a runner back against two that
 * know how to accelerate one. If that balance ever inverts, this asymmetry
 * becomes the wrong one and should be made two-sided.
 */
import type {
  Attributed, DoctrineCitation, EarningGate, EarningRequirement,
} from './contract';
// ── EVERY IMPORT FROM THE CANONICAL ENGINE IS TYPE-ONLY, ON PURPOSE ───────
//
// `lib/adaptation/canonical/` is walled: `_cannot_mutate.test.ts` guard 4
// refuses any VALUE import from outside that directory unless the exact
// (file, module, symbols) triple is enumerated in its allowlist, and the two
// files enumerated there are the shadow runner and its loader. This module is
// plan authoring, not adaptation, so it takes the TYPES and constructs the
// values itself rather than asking for a grant.
//
// That is not a second definition of anything. `Measured<T>` still has
// exactly one declaration and it is the one imported here, and `Readability`
// arrives embedded in it, so a change to either shape stops the object
// literals in `reading` below from compiling rather than diverging quietly.
// That is the check behind this paragraph (Rule 20: gate the claim or delete
// the sentence). What the wall costs is three lines of object literal, and
// what it buys is that this module holds no runtime edge into the adaptation
// engine at all.
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { StimulusGrade } from '@/lib/adaptation/canonical/stimulus';
import type { DeteriorationPattern } from '@/lib/adaptation/canonical/deterioration';
import type { HrTraceVerdict } from '@/lib/adaptation/canonical/hr-trace-credibility';
import type { NormalReading } from '@/lib/training/normal-window';
// Type-only, so no runtime edge is created into a module that opens the pool.
import type { ExecutionMatch } from '@/lib/execution/day-resolver';

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · THE AXES  ·  what a dose-responsive prescription is allowed to resize
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The quantity a prescription resizes.
 *
 * PACE IS ABSENT AND THAT IS THE POINT. Pace has an owner
 * (`lib/adaptation/canonical/levers/threshold-pace.ts` proposes it,
 * `recompute-paces.ts` applies it) and `BRAIN_CONSTITUTION.md` allows one
 * canonical owner per question. These five are the axes that owner cannot
 * reach, which is why a plan whose only adaptive lever was pace could raise a
 * runner's target speed and never once change what he was asked to DO.
 */
export type DoseAxis =
  /** Total distance of one session, miles. */
  | 'SESSION_DISTANCE_MI'
  /** At-pace miles inside one session · a marathon-pace block, a tempo block. */
  | 'QUALITY_DOSE_MI'
  /** How many repetitions. */
  | 'REPETITIONS'
  /** How long each repetition runs, minutes. */
  | 'REP_DURATION_MIN'
  /** How long the jog between repetitions runs, seconds. */
  | 'RECOVERY_JOG_S';

export const DOSE_AXES: readonly DoseAxis[] = [
  'SESSION_DISTANCE_MI', 'QUALITY_DOSE_MI', 'REPETITIONS',
  'REP_DURATION_MIN', 'RECOVERY_JOG_S',
] as const;

/**
 * What the adaptation-doctrine state machine calls the thing being progressed.
 *
 * `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` §"State machine" lists PACE,
 * VOLUME, DURATION, DENSITY, SPECIFICITY, RECOVERY and SCHEDULE. PACE, RECOVERY
 * and SCHEDULE are other owners' targets and are not repeated here, for the
 * same reason `DoseAxis` has no pace member.
 */
export type DoseTarget = 'VOLUME' | 'DURATION' | 'DENSITY' | 'SPECIFICITY';

/** Fixed properties of an axis: its unit, its direction, and its grain. */
export interface DoseAxisShape {
  readonly unit: string;
  /**
   * Which way is HARDER. Four of the five axes get harder as the number rises;
   * a recovery jog gets harder as it shrinks. Every comparison in this module
   * goes through this field rather than assuming a sign, because an engine that
   * assumes bigger-is-harder silently inverts its own safety cap on the one
   * axis where that is false.
   */
  readonly harderIs: 'HIGHER' | 'LOWER';
  /**
   * The smallest change a runner can actually be handed on this axis.
   *
   * This is the reason Rule 9 is satisfied rather than dodged. A dose is a
   * discrete thing, so the RESOLVED value steps; what may not step is the
   * DECISION. `resolveDose` interpolates continuously and then rounds to this
   * grain, which bounds any single hair of evidence to at most one grain of
   * dose. `_dose_responsive_continuity.test.ts` walks the evidence and asserts
   * exactly that bound.
   */
  readonly grain: number;
}

export const DOSE_AXIS_SHAPE: Readonly<Record<DoseAxis, DoseAxisShape>> = {
  SESSION_DISTANCE_MI: { unit: 'mi', harderIs: 'HIGHER', grain: 0.5 },
  QUALITY_DOSE_MI: { unit: 'mi', harderIs: 'HIGHER', grain: 0.5 },
  REPETITIONS: { unit: 'reps', harderIs: 'HIGHER', grain: 1 },
  REP_DURATION_MIN: { unit: 'min', harderIs: 'HIGHER', grain: 1 },
  RECOVERY_JOG_S: { unit: 's', harderIs: 'LOWER', grain: 15 },
};

/**
 * Constructors for the imported `Measured<number>`.
 *
 * Named `reading` rather than re-using `measured` / `absent` / `failed` so no
 * reader thinks this is a second copy of those functions competing with the
 * canonical ones. It is a bridge across an architectural wall, and the type it
 * builds is the canonical type.
 *
 * There is no `READ` member. `Readability` carries one, and a refusal that
 * claims to have been read is not a state this module can legitimately
 * produce; `readOne` still handles it defensively on the way in, because a
 * caller may hand one over.
 */
export const reading = {
  of: (value: number): Measured<number> => ({ ok: true, value }),
  absent: (what: string): Measured<number> => ({ ok: false, why: { kind: 'ABSENT', what } }),
  failed: (what: string): Measured<number> => ({ ok: false, why: { kind: 'FAILED', what } }),
} as const;

/** True when `a` is the harder of the two values on this axis. */
export function harder(axis: DoseAxis, a: number, b: number): boolean {
  return DOSE_AXIS_SHAPE[axis].harderIs === 'HIGHER' ? a > b : a < b;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE READERS  ·  named, so nobody writes a second one
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The readers a dose requirement is allowed to be answered by.
 *
 * Rule 16 in its enforceable form. Every `DoseRequirement` names one of these,
 * and `_dose_responsive.test.ts` resolves each `module`/`symbol` pair against
 * the real file, so a reader that is renamed or deleted fails the build rather
 * than leaving a requirement pointing at nothing.
 *
 * `rule8Side` is the corollary Rule 8 spends most of its text on. A reader that
 * answers what the runner NORMALLY does must have taper and post-race recovery
 * excluded; a reader that answers what his legs have RECENTLY ABSORBED must
 * not. Recording it per reader is what stops the next author picking whichever
 * weekly-mileage function autocompleted first.
 */
export interface CanonicalReader {
  readonly readerId: ReaderId;
  readonly module: string;
  readonly symbol: string;
  readonly answers: string;
  readonly rule8Side: 'HABIT' | 'ABSORBED_LOAD' | 'NEITHER';
}

export type ReaderId =
  | 'STIMULUS_GRADE'
  | 'DETERIORATION_PATTERN'
  | 'HR_TRACE_CREDIBILITY'
  | 'WORK_HR_CEILING'
  | 'EXECUTION_IDENTITY'
  | 'HABIT_WEEKLY_MI'
  | 'ABSORBED_WEEKLY_MI'
  | 'PRESCRIBED_NON_NORMAL_DAY'
  | 'RECOVERY_PHASE'
  | 'MISSED_TRAINING';

export const DOSE_EVIDENCE_READERS: readonly CanonicalReader[] = [
  {
    readerId: 'STIMULUS_GRADE',
    module: 'lib/adaptation/canonical/stimulus.ts',
    symbol: 'gradeStimulus',
    answers: 'Did this session achieve the stimulus it was prescribed for.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'DETERIORATION_PATTERN',
    module: 'lib/adaptation/canonical/deterioration.ts',
    symbol: 'deteriorationPattern',
    answers: 'Is falling away late in a session a pattern across this window.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'HR_TRACE_CREDIBILITY',
    module: 'lib/adaptation/canonical/hr-trace-credibility.ts',
    symbol: 'workTraceIsCredible',
    answers: 'Is this a heart-rate measurement or one value carried forward.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'WORK_HR_CEILING',
    module: 'lib/adaptation/canonical/work-hr-ceiling.ts',
    symbol: 'workHrCeilingFor',
    answers: 'Which heart-rate ceiling may this session be graded against.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'EXECUTION_IDENTITY',
    module: 'lib/execution/day-resolver.ts',
    symbol: 'resolveDateRangeExecutions',
    answers: 'Which run, if any, actually executed this prescription.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'HABIT_WEEKLY_MI',
    module: 'lib/training/normal-window.ts',
    symbol: 'normalWeeklyMileage',
    answers: 'What this runner normally runs in a week, taper and recovery excluded.',
    rule8Side: 'HABIT',
  },
  {
    readerId: 'ABSORBED_WEEKLY_MI',
    module: 'lib/runs/volume.ts',
    symbol: 'recentWeeklyMileageMi',
    answers: 'What the legs have actually carried lately, taper included.',
    rule8Side: 'ABSORBED_LOAD',
  },
  {
    readerId: 'PRESCRIBED_NON_NORMAL_DAY',
    module: 'lib/training/normal-window.ts',
    symbol: 'isPrescribedNonNormal',
    answers: 'Was this day inside a taper, race week or post-race recovery block.',
    rule8Side: 'HABIT',
  },
  {
    readerId: 'RECOVERY_PHASE',
    module: 'lib/coach/recovery-phase.ts',
    symbol: 'computeRecoveryPhase',
    answers: 'Which hard session are we recovering from and how far into it are we.',
    rule8Side: 'NEITHER',
  },
  {
    readerId: 'MISSED_TRAINING',
    module: 'lib/plan/adapt.ts',
    symbol: 'partitionMissedCandidates',
    answers: 'Which scheduled sessions were skipped, missed long, dropped or moved.',
    rule8Side: 'NEITHER',
  },
];

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · REQUIREMENTS  ·  continuous by construction (Rule 9)
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * One measurable condition, with a RAMP rather than a step.
 *
 * Rule 9 is the reason for `rampFrom`. A binary requirement puts a cliff in the
 * middle of a coaching decision: two runners a tenth of a mile apart get plans
 * that differ in kind, and the rule's own audit found five live instances of
 * exactly that, with the recurring signature that the fitter runner gets the
 * worse plan. Here, satisfaction rises continuously from 0 at `rampFrom` to 1
 * at `threshold`, so a hair of evidence buys a hair of dose.
 *
 * `discreteBecause` is the argued escape hatch, and it is argued rather than
 * silent. Some requirements really are counts of sessions, and a count cannot
 * be ramped through without inventing half a session. Setting `rampFrom` equal
 * to `threshold` is legal ONLY with a sentence saying why, and
 * `validatePrescription` refuses without one.
 */
export interface DoseRequirement {
  readonly requirementId: string;
  /** In the runner's language. "Two of the three marathon-pace blocks land." */
  readonly what: string;
  /** In the engine's. The exact quantity, and the grade or state that counts. */
  readonly measurable: string;
  /** Which existing reader answers it. Never a new one. */
  readonly reader: ReaderId;
  readonly comparator: 'AT_LEAST' | 'AT_MOST';
  /** Fully satisfied at this value. */
  readonly threshold: number;
  /** Not satisfied at all at this value. Must sit on the unsatisfied side. */
  readonly rampFrom: number;
  /** Present only when `rampFrom === threshold`, and then it must be argued. */
  readonly discreteBecause: string | null;
  readonly byISO: string;
}

/**
 * How far along this requirement one reading sits, in [0, 1].
 *
 * Returns null when the reading is not a measurement, because a satisfaction
 * score for an absent input is an invented number and Rule 11 forbids one. Note
 * what this function will NOT do: coerce a measured zero into an absence. A
 * zero here is a real answer that produces satisfaction 0, which is what the
 * `recentQualityPerWeek` defect got wrong in the other direction when it turned
 * a correct zero into "no signal" and answered with full quality density.
 */
export function satisfactionOf(
  req: DoseRequirement, reading: Measured<number>,
): number | null {
  if (!reading.ok) return null;
  const v = reading.value;
  if (req.rampFrom === req.threshold) {
    return req.comparator === 'AT_LEAST'
      ? (v >= req.threshold ? 1 : 0)
      : (v <= req.threshold ? 1 : 0);
  }
  const span = req.threshold - req.rampFrom;
  const raw = (v - req.rampFrom) / span;
  return Math.max(0, Math.min(1, raw));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · THE CAP  ·  how far one reassessment may move a dose
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The maximum permitted change, part six of the shape David asked for.
 *
 * `maxHarder` and `maxEasier` are stated in DIFFICULTY, not in numeric sign, so
 * they can be compared directly on any axis including the one where harder
 * means a smaller number. That comparison is the point: Rule 21 says the bar to
 * go up may not be higher than the bar to come down, and a pair of caps written
 * as "increase" and "decrease" hides the asymmetry on the inverted axis.
 */
export interface DoseChangeCap {
  /** Most this reassessment may move the dose toward harder. */
  readonly maxHarder: Attributed<number>;
  /** Most this reassessment may move the dose toward easier. */
  readonly maxEasier: Attributed<number>;
  /** An absolute doctrine bound on the hard side, or null where none exists. */
  readonly hardCeiling: Attributed<number> | null;
  /** An absolute doctrine bound on the easy side, or null where none exists. */
  readonly easyFloor: Attributed<number> | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE PRESCRIPTION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * The only legal posture when the evidence is incomplete.
 *
 * A one-member union on purpose. Rule 11's requirement is not that the default
 * is held, it is that holding it is a STATED posture rather than a silent
 * fallback, and a required field with one legal value is the cheapest way to
 * make every author type the sentence. When a second posture is ever argued
 * for, it arrives here with its argument attached instead of as an `??`.
 */
export type IncompleteEvidencePosture = 'HOLD_DEFAULT';

export interface DoseResponsivePrescription {
  readonly prescriptionId: string;
  /** In the runner's language. "The marathon-pace block on 22 Nov." */
  readonly what: string;
  /** The date the prescription is actually run. */
  readonly landsOnISO: string;
  readonly axis: DoseAxis;
  readonly target: DoseTarget;

  /** 1 · what he gets if nothing changes. Safe, and prescribed today. */
  readonly defaultDose: Attributed<number>;
  /** 2 · the higher option, if the evidence arrives. Strictly harder. */
  readonly earnedDose: Attributed<number>;
  /** Where a measured reduction lands. Strictly easier than the default. */
  readonly reducedDose: Attributed<number>;

  /** 3 · what would earn the higher dose. */
  readonly earn: readonly DoseRequirement[];
  /** Rule 21's opposite number · what would justify the lower one. */
  readonly reduce: readonly DoseRequirement[];

  /** 4 · when this is re-taken. Must be before it lands. */
  readonly assessOnISO: string;
  /**
   * Whether `assessOnISO` falls inside a taper, race week or post-race
   * recovery block, resolved by `isPrescribedNonNormal` (reader
   * PRESCRIBED_NON_NORMAL_DAY). Null when the caller did not resolve the race
   * calendar at all, which is reported rather than assumed.
   *
   * This exists because of a defect in the first version of this module, found
   * while tracing the owner's own block. Both November gates were scheduled to
   * be assessed on 2026-11-09 and 2026-11-16, and Run Malibu is 2026-11-08, so
   * BOTH assessment dates sit inside the post-race recovery window the engine
   * itself prescribed. Rule 8 then does exactly what it should: the habit
   * reader excludes those days, and if it cannot reach far enough back for a
   * representative answer it REFUSES. A refusal is an absence, an absence
   * holds the default, and a gate whose earning condition can only ever read
   * absent is not a bar, it is a wall (Rule 21).
   *
   * The right fix is usually to move the assessment before the taper begins,
   * and where it genuinely cannot move, to say so with the reason. Neither
   * happens on its own, so the field is required and unanswered `true` blocks.
   */
  readonly assessOnIsPrescribedNonNormal: boolean | null;
  /** 5 · the fallback, stated. */
  readonly onIncompleteEvidence: IncompleteEvidencePosture;
  /** 6 · the maximum permitted change. */
  readonly cap: DoseChangeCap;

  readonly citations: readonly DoctrineCitation[];
  /**
   * Any asymmetry `auditSymmetry` finds, answered by kind with a citation.
   * An unanswered finding blocks the prescription.
   */
  readonly asymmetryJustified: Readonly<Partial<Record<SymmetryFindingKind, string>>>;
  /**
   * Why this gate is assessed inside a prescribed non-normal window anyway.
   * Required when `assessOnIsPrescribedNonNormal` is true, ignored otherwise.
   */
  readonly assessInsideWindowJustified: string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · VALIDATION  ·  a malformed gate fails loudly, never quietly
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PrescriptionDefect {
  readonly field: string;
  readonly detail: string;
}

/**
 * Everything structurally wrong with a prescription, in one pass.
 *
 * It reports rather than throws so a caller can show a runner all of it at
 * once, and `assertPrescription` is the throwing wrapper for callers that
 * cannot proceed. Neither judges the physiology, per this file's Rule 22 note.
 */
export function validatePrescription(
  rx: DoseResponsivePrescription,
): readonly PrescriptionDefect[] {
  const out: PrescriptionDefect[] = [];
  const shape = DOSE_AXIS_SHAPE[rx.axis];

  if (!harder(rx.axis, rx.earnedDose.value, rx.defaultDose.value)) {
    out.push({
      field: 'earnedDose',
      detail: `The earned dose (${rx.earnedDose.value} ${shape.unit}) is not harder than the `
        + `default (${rx.defaultDose.value} ${shape.unit}). A gate that cannot move anything is `
        + 'the wired-and-inert failure Rule 21 measured at zero upward adaptations in 309 rows.',
    });
  }
  if (!harder(rx.axis, rx.defaultDose.value, rx.reducedDose.value)) {
    out.push({
      field: 'reducedDose',
      detail: `The reduced dose (${rx.reducedDose.value} ${shape.unit}) is not easier than the `
        + `default (${rx.defaultDose.value} ${shape.unit}).`,
    });
  }
  if (rx.assessOnISO >= rx.landsOnISO) {
    out.push({
      field: 'assessOnISO',
      detail: `Reassessment on ${rx.assessOnISO} is not before the session on ${rx.landsOnISO}. `
        + 'A gate assessed after the prescription lands has decided nothing.',
    });
  }
  if (rx.earn.length === 0) {
    out.push({
      field: 'earn',
      detail: 'No earning requirements. An unconditional higher dose is not a gate.',
    });
  }
  if (rx.reduce.length === 0) {
    out.push({
      field: 'reduce',
      detail: 'No reduction requirements. Without them the dose can only be held or raised, and '
        + 'a reduction would then have to fire on absent evidence, which Rule 11 forbids.',
    });
  }
  for (const req of [...rx.earn, ...rx.reduce]) {
    const bad = req.comparator === 'AT_LEAST'
      ? req.rampFrom > req.threshold
      : req.rampFrom < req.threshold;
    if (bad) {
      out.push({
        field: `requirement:${req.requirementId}`,
        detail: `rampFrom ${req.rampFrom} sits on the satisfied side of threshold ${req.threshold} `
          + `for an ${req.comparator} requirement. Satisfaction would run backwards.`,
      });
    }
    if (req.rampFrom === req.threshold && !req.discreteBecause) {
      out.push({
        field: `requirement:${req.requirementId}`,
        detail: 'rampFrom equals threshold, which is a step, and no reason is given. Rule 9: a '
          + 'behaviour may be discrete but the decision may not hinge on a hair. Give the '
          + 'argument in discreteBecause or spread the ramp.',
      });
    }
    if (req.byISO > rx.assessOnISO) {
      out.push({
        field: `requirement:${req.requirementId}`,
        detail: `The requirement is due ${req.byISO}, after the reassessment on ${rx.assessOnISO}. `
          + 'It could never be read in time.',
      });
    }
  }
  if (rx.citations.length === 0) {
    out.push({ field: 'citations', detail: 'No doctrine citation for either dose.' });
  }
  if (rx.assessOnIsPrescribedNonNormal === null) {
    out.push({
      field: 'assessOnIsPrescribedNonNormal',
      detail: `Nobody resolved whether ${rx.assessOnISO} sits inside a taper, race week or `
        + 'post-race recovery block. Ask isPrescribedNonNormal and say which it is. Rule 11: '
        + 'an unresolved question is not the same fact as a resolved no.',
    });
  } else if (rx.assessOnIsPrescribedNonNormal && !rx.assessInsideWindowJustified) {
    out.push({
      field: 'assessInsideWindowJustified',
      detail: `${rx.assessOnISO} is inside a taper, race week or post-race recovery block. `
        + 'Rule 8 excludes those days from every habit reader, so an earning condition that '
        + 'reads habit may only ever come back absent, and a condition that can only read '
        + 'absent is a wall rather than a bar. Move the assessment before the window, or say '
        + 'why it cannot move and which requirements survive there.',
    });
  }
  for (const f of auditSymmetry(rx)) {
    if (!rx.asymmetryJustified[f.kind]) {
      out.push({
        field: 'asymmetryJustified',
        detail: `${f.kind}: ${f.detail} Rule 21 requires the asymmetry to be justified with a `
          + 'citation before it may stand.',
      });
    }
  }
  return out;
}

export function assertPrescription(rx: DoseResponsivePrescription): void {
  const defects = validatePrescription(rx);
  if (defects.length === 0) return;
  throw new Error(
    `Dose-responsive prescription ${rx.prescriptionId} cannot be used as written:\n`
    + defects.map((d) => `  · ${d.field}: ${d.detail}`).join('\n'),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · RULE 21  ·  the bar to go up beside the bar to come down
 * ═══════════════════════════════════════════════════════════════════════ */

export type SymmetryFindingKind =
  /** More conditions to earn the higher dose than to justify the lower one. */
  | 'MORE_CONDITIONS_TO_GO_UP'
  /** A smaller permitted step toward harder than toward easier. */
  | 'SMALLER_STEP_TO_GO_UP'
  /** The earning requirements are due later than the reduction ones. */
  | 'SLOWER_TO_GO_UP';

export interface SymmetryFinding {
  readonly kind: SymmetryFindingKind;
  readonly detail: string;
}

/**
 * Put each threshold beside its opposite number, and report every place where
 * going up is harder than coming down.
 *
 * Rule 21's own words: "Five downgrades against zero upgrades is not a runner's
 * record, it is an engine's disposition." An engine acquires that disposition
 * one reasonable-looking asymmetry at a time, and every one of them is
 * individually defensible, which is exactly why they have to be counted rather
 * than argued case by case.
 *
 * This is deliberately one-sided. See this file's Rule 22 block for why, and
 * for the condition under which that choice should be revisited.
 */
export function auditSymmetry(
  rx: DoseResponsivePrescription,
): readonly SymmetryFinding[] {
  const out: SymmetryFinding[] = [];
  if (rx.earn.length > rx.reduce.length) {
    out.push({
      kind: 'MORE_CONDITIONS_TO_GO_UP',
      detail: `${rx.earn.length} conditions to earn the higher dose against ${rx.reduce.length} `
        + 'to justify the lower one.',
    });
  }
  if (rx.cap.maxHarder.value < rx.cap.maxEasier.value) {
    out.push({
      kind: 'SMALLER_STEP_TO_GO_UP',
      detail: `One reassessment may move ${rx.cap.maxEasier.value} toward easier but only `
        + `${rx.cap.maxHarder.value} toward harder.`,
    });
  }
  const latest = (rs: readonly DoseRequirement[]): string =>
    rs.reduce((acc, r) => (r.byISO > acc ? r.byISO : acc), '');
  const upBy = latest(rx.earn);
  const downBy = latest(rx.reduce);
  if (upBy && downBy && upBy > downBy) {
    out.push({
      kind: 'SLOWER_TO_GO_UP',
      detail: `The last earning requirement is due ${upBy}, the last reduction requirement `
        + `${downBy}. The upward path has less time to complete.`,
    });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · THE GATE  ·  extends the one in contract.ts, never a second one
 * ═══════════════════════════════════════════════════════════════════════ */

export interface DoseEarningGate extends EarningGate {
  readonly axis: DoseAxis;
  readonly defaultDose: number;
  readonly earnedDose: number;
  readonly earn: readonly DoseRequirement[];
  readonly reduce: readonly DoseRequirement[];
  readonly cap: DoseChangeCap;
}

/**
 * Build the gate `checkPromotion` already knows how to count.
 *
 * `requires` is DERIVED from `earn` rather than passed in beside it, so the
 * runner-facing list and the machine-readable list cannot say different things.
 * Rule 16: one quantity, one name, and two hand-maintained copies of the same
 * list is the same defect wearing a plural.
 */
export function doseEarningGate(rx: DoseResponsivePrescription): DoseEarningGate {
  const shape = DOSE_AXIS_SHAPE[rx.axis];
  const requires: readonly EarningRequirement[] = rx.earn.map((r) => ({
    what: r.what, measurable: r.measurable, byISO: r.byISO,
  }));
  return {
    gateId: `dose:${rx.prescriptionId}`,
    forDecisionId: rx.prescriptionId,
    requires,
    assessOnISO: rx.assessOnISO,
    // The higher dose is what is conditional. Unmet, it comes back to the
    // default that is prescribed today, which is a REDUCE of the conditional
    // value and not a DROP of the session.
    ifUnmet: 'REDUCE',
    reduceTo: rx.defaultDose.value,
    explain: `${rx.what} is prescribed at ${rx.defaultDose.value} ${shape.unit} today. `
      + `It goes to ${rx.earnedDose.value} ${shape.unit} if, by ${rx.assessOnISO}, `
      + `${rx.earn.map((r) => r.what).join(' and ')}. `
      + `If that evidence is not there it stays at ${rx.defaultDose.value} ${shape.unit}.`,
    axis: rx.axis,
    defaultDose: rx.defaultDose.value,
    earnedDose: rx.earnedDose.value,
    earn: rx.earn,
    reduce: rx.reduce,
    cap: rx.cap,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 9 · THE EVALUATOR  ·  the half that did not exist
 * ═══════════════════════════════════════════════════════════════════════ */

/** What the readers returned, keyed by `requirementId`. */
export interface DoseEvidence {
  readonly assessedOnISO: string;
  readonly readings: ReadonlyMap<string, Measured<number>>;
}

export type DosePosture =
  /** Every earning requirement measured and fully met. */
  | 'EARNED_IN_FULL'
  /** Every earning requirement measured, some partly met. */
  | 'EARNED_IN_PART'
  /** Every earning requirement measured, none met. Default stands. */
  | 'NOT_EARNED_DEFAULT_HELD'
  /** At least one requirement absent or unreadable. Default stands, stated. */
  | 'DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE'
  /** Reduction evidence measured and present. */
  | 'REDUCED_ON_MEASURED_EVIDENCE';

export interface RequirementReading {
  readonly requirementId: string;
  readonly what: string;
  readonly reader: ReaderId;
  readonly state: 'MEASURED' | 'ABSENT' | 'FAILED' | 'NOT_SUPPLIED';
  /** Null unless MEASURED. Rule 11: a refusal carries no value. */
  readonly observed: number | null;
  /** Null unless MEASURED. */
  readonly satisfaction: number | null;
  readonly say: string;
}

export interface DoseVerdict {
  readonly prescriptionId: string;
  readonly assessedOnISO: string;
  readonly axis: DoseAxis;
  /** The doctrine state machine's verb. */
  readonly decision: 'PROGRESS' | 'HOLD' | 'REDUCE';
  readonly target: DoseTarget;
  readonly posture: DosePosture;
  readonly defaultDose: number;
  readonly resolvedDose: number;
  readonly changed: boolean;
  /** Null when the earning evidence was incomplete. */
  readonly earnedFraction: number | null;
  /** Null when the reduction evidence was incomplete. */
  readonly reduceFraction: number | null;
  /** Which bound bit, if the interpolated dose was pulled back. */
  readonly cappedBy: string | null;
  readonly earnReadings: readonly RequirementReading[];
  readonly reduceReadings: readonly RequirementReading[];
  /** Runner-facing. Present in EVERY branch, including no change. */
  readonly say: string;
}

function readOne(
  req: DoseRequirement, ev: DoseEvidence,
): RequirementReading {
  const r = ev.readings.get(req.requirementId);
  if (r === undefined) {
    return {
      requirementId: req.requirementId, what: req.what, reader: req.reader,
      state: 'NOT_SUPPLIED', observed: null, satisfaction: null,
      say: `${req.what} · nothing was supplied for this, so it counts as not read.`,
    };
  }
  if (r.ok) {
    return {
      requirementId: req.requirementId, what: req.what, reader: req.reader,
      state: 'MEASURED', observed: r.value, satisfaction: satisfactionOf(req, r),
      say: `${req.what} · read ${r.value}, needed ${req.comparator === 'AT_LEAST' ? 'at least' : 'at most'} ${req.threshold}.`,
    };
  }
  // `Readability` carries a third member, READ, which cannot legally appear on
  // a refusal. It is handled rather than cast away: an inconsistent reading is
  // a failed read, and saying so is cheaper than an assertion nobody reads.
  const why = r.why;
  const detail = why.kind === 'READ'
    ? 'the reader returned a refusal with no reason attached'
    : why.what;
  const state = why.kind === 'ABSENT' ? 'ABSENT' : 'FAILED';
  return {
    requirementId: req.requirementId, what: req.what, reader: req.reader,
    state, observed: null, satisfaction: null,
    say: `${req.what} · ${why.kind === 'ABSENT' ? 'no data' : 'the read did not complete'}: ${detail}.`,
  };
}

/**
 * The combined satisfaction of a requirement set, or null when any member is
 * not a measurement.
 *
 * The combiner is MIN, and the choice is doctrine rather than taste.
 * `Research/00a` §"Practical load rules" gives "Add stress one-at-a-time" and
 * `docs/ADAPTATION_PROGRESSION_DOCTRINE.md` gives "Progress one primary
 * stressor at a time", so a set of requirements is an AND and the weakest
 * member governs. A mean would let a runner buy a marathon-pace step with a
 * strong week of volume while every session in the window fell apart late.
 *
 * Null on ANY non-measurement is the strict reading of Rule 11, and it is
 * strict in the direction that costs the runner nothing: incomplete evidence
 * holds the default, and the default is what he is already prescribed.
 */
function combinedSatisfaction(
  reqs: readonly DoseRequirement[], readings: readonly RequirementReading[],
): number | null {
  if (reqs.length === 0) return null;
  let lo = 1;
  for (const r of readings) {
    if (r.satisfaction === null) return null;
    lo = Math.min(lo, r.satisfaction);
  }
  return lo;
}

/**
 * Round toward the EASIER end of the axis.
 *
 * Rounding is the last step and it is the only place this module can invent
 * load it was not given. Rounding toward easier means a push lands slightly
 * short of what was earned and a reduction lands slightly deeper than measured,
 * so the grain never manufactures difficulty in either direction.
 */
function roundToGrainEasier(axis: DoseAxis, value: number): number {
  const { grain, harderIs } = DOSE_AXIS_SHAPE[axis];
  if (grain <= 0) return value;
  const steps = harderIs === 'HIGHER'
    ? Math.floor(value / grain + 1e-9)
    : Math.ceil(value / grain - 1e-9);
  return Number((steps * grain).toFixed(6));
}

/** Clamp a candidate dose to the caps and report which bound bit. */
function applyCap(
  rx: DoseResponsivePrescription, candidate: number,
): { readonly value: number; readonly cappedBy: string | null } {
  const { axis, cap, defaultDose } = rx;
  const base = defaultDose.value;
  const towardHarder = harder(axis, candidate, base);
  let v = candidate;
  let by: string | null = null;

  const limit = towardHarder ? cap.maxHarder : cap.maxEasier;
  if (Math.abs(v - base) > limit.value) {
    v = DOSE_AXIS_SHAPE[axis].harderIs === 'HIGHER'
      ? (towardHarder ? base + limit.value : base - limit.value)
      : (towardHarder ? base - limit.value : base + limit.value);
    by = towardHarder
      ? `the maximum permitted step toward harder (${limit.value}). ${limit.basis}`
      : `the maximum permitted step toward easier (${limit.value}). ${limit.basis}`;
  }
  if (cap.hardCeiling && harder(axis, v, cap.hardCeiling.value)) {
    v = cap.hardCeiling.value;
    by = `the doctrine ceiling (${cap.hardCeiling.value}). ${cap.hardCeiling.basis}`;
  }
  if (cap.easyFloor && harder(axis, cap.easyFloor.value, v)) {
    v = cap.easyFloor.value;
    by = `the doctrine floor (${cap.easyFloor.value}). ${cap.easyFloor.basis}`;
  }
  return { value: v, cappedBy: by };
}

/**
 * Take the decision.
 *
 * ── WHY THIS IS A CROSSFADE AND NOT AN IF ──────────────────────────────────
 *
 * The first version of this function checked the reduction evidence first and
 * returned early when any of it was present. That is the correct PRECEDENCE
 * (Brief 11 puts safety above the normal coaching loop) implemented as the
 * wrong SHAPE, and Rule 9 catches it: at reduction fraction exactly zero the
 * runner got the fully earned eight miles, and at zero plus a hair he got four
 * and a half. One deteriorated third of one session, worth a thousandth of the
 * reduction evidence, moved the prescription by a categorical step. Both sides
 * were legal doses, which is precisely the check a discontinuity passes.
 *
 * So the two paths compose:
 *
 *   dose = default + (1 - rf) x earnedStep + rf x reducedStep
 *
 * At rf = 0 it is the earned path untouched. At rf = 1 it is the reduced dose,
 * with the earning contribution fully suppressed, so full non-absorption
 * evidence still beats full earning evidence and safety keeps its precedence
 * at the limit. In between it damps the push in proportion to the evidence
 * against it, which is what a coach does and what a step function cannot.
 *
 * Note what does NOT happen when evidence is missing: nothing. The default dose
 * is what he is prescribed today, so holding it is the one outcome that
 * requires no evidence to justify. Rule 11's warning cuts both ways here and
 * both halves are implemented: an absent reading may not earn the higher dose,
 * and it may not destroy the default either. Both fractions therefore
 * contribute ZERO when they are null, and the null is reported rather than
 * being turned into a zero on the way through.
 */
export function resolveDose(
  rx: DoseResponsivePrescription, ev: DoseEvidence,
): DoseVerdict {
  const shape = DOSE_AXIS_SHAPE[rx.axis];
  const base = rx.defaultDose.value;
  const earnReadings = rx.earn.map((r) => readOne(r, ev));
  const reduceReadings = rx.reduce.map((r) => readOne(r, ev));
  const earnedFraction = combinedSatisfaction(rx.earn, earnReadings);
  const reduceFraction = combinedSatisfaction(rx.reduce, reduceReadings);

  const ef = earnedFraction ?? 0;
  const rf = reduceFraction ?? 0;
  const target = base
    + (1 - rf) * ef * (rx.earnedDose.value - base)
    + rf * (rx.reducedDose.value - base);
  const capped = applyCap(rx, target);
  const resolved = roundToGrainEasier(rx.axis, capped.value);
  const changed = resolved !== base;
  const easier = harder(rx.axis, base, resolved);

  const posture: DosePosture = easier
    ? 'REDUCED_ON_MEASURED_EVIDENCE'
    : earnedFraction === null
      ? 'DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE'
      : earnedFraction >= 1 && rf === 0
        ? 'EARNED_IN_FULL'
        : earnedFraction > 0 ? 'EARNED_IN_PART' : 'NOT_EARNED_DEFAULT_HELD';

  const decision: DoseVerdict['decision'] = !changed ? 'HOLD' : easier ? 'REDUCE' : 'PROGRESS';
  const short = earnReadings.filter((r) => (r.satisfaction ?? 1) < 1);
  const pressing = reduceReadings.filter((r) => (r.satisfaction ?? 0) > 0);

  let say: string;
  if (decision === 'REDUCE') {
    say = `${rx.what} comes back to ${resolved} ${shape.unit} from ${base}. `
      + `${pressing.map((r) => r.say).join(' ')}`;
  } else if (decision === 'PROGRESS') {
    say = `${rx.what} moves from ${base} to ${resolved} ${shape.unit}. `
      + `${earnReadings.map((r) => r.say).join(' ')}`
      + (capped.cappedBy ? ` It stops there because of ${capped.cappedBy}` : '');
  } else if (posture === 'DEFAULT_HELD_ON_INCOMPLETE_EVIDENCE') {
    say = `${rx.what} stays at ${base} ${shape.unit}. `
      + `${earnReadings.filter((r) => r.satisfaction === null).map((r) => r.say).join(' ')} `
      + 'Without that there is nothing to move it on, so it holds where it is.';
  } else {
    say = `${rx.what} stays at ${base} ${shape.unit}. `
      + `${short.map((r) => r.say).join(' ')} `
      + `It goes to ${rx.earnedDose.value} ${shape.unit} once that is there.`;
  }

  return {
    prescriptionId: rx.prescriptionId, assessedOnISO: ev.assessedOnISO, axis: rx.axis,
    decision, target: rx.target, posture,
    defaultDose: base, resolvedDose: resolved, changed,
    earnedFraction, reduceFraction, cappedBy: capped.cappedBy,
    earnReadings, reduceReadings, say,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 10 · ADAPTERS  ·  existing readers' outputs, as requirement readings
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * These convert a canonical reader's OUTPUT type into `Measured<number>`. They
 * measure nothing. Every one of them returns an explicit absence for an empty
 * input rather than a zero, which is the whole point: a window containing no
 * gradeable session and a window whose every session fell short are opposite
 * facts, and Rule 11 was written after the second was served as the first.
 */

/**
 * How many sessions in this window achieved their stimulus.
 *
 * `gradesThatCount` is a PARAMETER rather than a constant here, and that is
 * the same wall showing through: `GRADES_THAT_COUNT_AS_EVIDENCE` is the one
 * answer to "which grades are evidence" and it lives inside the canonical
 * engine. Restating it here would be a second answer to an owned question
 * (Rule 16), so the caller passes the owner's own set in.
 */
export function sessionsThatCount(
  assessments: readonly { readonly grade: StimulusGrade }[],
  gradesThatCount: ReadonlySet<StimulusGrade>,
): Measured<number> {
  if (assessments.length === 0) {
    return reading.absent('no graded sessions in the window');
  }
  let n = 0;
  for (const a of assessments) {
    if (gradesThatCount.has(a.grade)) n += 1;
  }
  return reading.of(n);
}

/** How many sessions in this window fell away late. */
export function deterioratedSessions(
  pattern: DeteriorationPattern,
): Measured<number> {
  const judged = pattern.deterioratedCount + pattern.cleanCount;
  if (judged === 0) {
    return reading.absent(
      `no session in the window could be judged late-on · ${pattern.unknownCount} unreadable`,
    );
  }
  return reading.of(pattern.deterioratedCount);
}

/** The share of sessions in this window whose work heart rate was readable. */
export function credibleTraceShare(
  verdicts: readonly HrTraceVerdict[],
): Measured<number> {
  if (verdicts.length === 0) {
    return reading.absent('no heart-rate traces in the window');
  }
  const good = verdicts.filter((v) => v.credible).length;
  return reading.of(good / verdicts.length);
}

/**
 * How many prescriptions in this window were executed at an identity tier at
 * least as strong as `minTier`.
 *
 * The parameter is structural rather than the imported `PrescribedWorkout`, so
 * this module keeps no runtime edge into `day-resolver.ts`, which opens the
 * pool. The tier order is the resolver's own: an exact plan-id match is
 * stronger evidence than a type match, which is stronger than a run that merely
 * happened on the day.
 */
export function executedAtTier(
  prescriptions: readonly { readonly matchedRun: { readonly match: ExecutionMatch } | null }[],
  minTier: ExecutionMatch,
): Measured<number> {
  if (prescriptions.length === 0) {
    return reading.absent('no prescriptions in the window');
  }
  const rank: Record<ExecutionMatch, number> = { exact: 3, legacy_type: 2, supplemental: 1 };
  const need = rank[minTier];
  let n = 0;
  for (const p of prescriptions) {
    if (p.matchedRun && rank[p.matchedRun.match] >= need) n += 1;
  }
  return reading.of(n);
}

/**
 * A `NormalReading` as a requirement reading.
 *
 * The refusal branch becomes an ABSENT rather than a zero, which is the same
 * decision `normal-window.ts` made in its own types and for the same reason:
 * "if excluding leaves too little data to answer honestly, say so and refuse".
 */
export function fromNormalReading(
  r: NormalReading<number>,
): Measured<number> {
  if (r.ok) return reading.of(r.value);
  return reading.absent(r.refusal.message);
}
