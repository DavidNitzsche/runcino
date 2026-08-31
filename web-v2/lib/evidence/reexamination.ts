/**
 * lib/evidence/reexamination.ts · THE BELIEF-TENSION CONSUMER.
 *
 * `activity-evidence.ts` computes `BeliefTensionRead.reexaminationWeight` and
 * says, in its own header, that nothing consumes it: "lowering a future
 * corroboration bar is a Runner Model behaviour and is named as an explicit
 * follow-up rather than built here". This file is that follow-up, and it is
 * deliberately NOT in the Adaptation Engine.
 *
 * ── WHY THIS LIVES ONE LAYER DOWN, AND NOT IN THE ADAPTATION ENGINE ─────────
 *
 * `docs/DOCTRINE_ENFORCEMENT_AND_CLEAN_IMPLEMENTATION.md` §1 gives the Runner
 * Model "what do we currently believe about the runner's underlying capacity",
 * and the Adaptation Engine "what should change in response to new evidence —
 * proposes changes, DOES NOT independently reinterpret raw activity data".
 *
 * Lowering a corroboration bar changes WHICH EVIDENCE COUNTS toward a belief.
 * That is the belief-formation question, not the change question. An Adaptation
 * Engine that relaxed the bar itself would be forming a capacity belief the
 * Runner Model did not form — a second answer to a question that already has an
 * owner, which §2 calls "doctrine already compromised". So the consumer sits in
 * the corroboration seam `composeThresholdCapacity` already exposes
 * (`ThresholdCapacityInputs.minObservations`), and the Adaptation Engine sees
 * only the capacity estimate that comes out. It is built HERE and nowhere else.
 *
 * The structured-long-run reference case says the same thing from the product
 * side: the signal is "for the Runner Model layer to consult (a lower future
 * corroboration bar, or elevated attention) when it next resolves the
 * capacity".
 *
 * ── WHAT IT MAY AND MAY NOT DO ──────────────────────────────────────────────
 *
 * It may lower the number of corroborating observations the direct-evidence
 * reader needs, BY AT MOST ONE, AND NEVER BELOW TWO. It may never move an
 * estimate, never raise a bar, and never let a single activity anchor
 * anything — `REEXAMINATION_FLOOR_MIN_OBSERVATIONS` is the hard stop, and it is
 * two rather than one precisely because "one run rarely rewrites the runner"
 * is doctrine's own final line. The relaxation is a single step however much
 * tension accumulates, so tension can never become a back door around
 * corroboration.
 *
 * ── RULE 9 · THE DECISION RESTS ON A DISCRETE FACT, NOT A HAIR ──────────────
 *
 * The obvious implementation gates the relaxation on accumulated
 * `reexaminationWeight` crossing a threshold — and that is exactly the cliff
 * Rule 9 was locked about: a runner a thousandth either side of it gets a
 * categorically different corroboration bar.
 *
 * So the decision does not read the continuous quantity at all. It reads the
 * COUNT of activities the Evidence Engine already graded
 * `CONTRADICTS_CURRENT_ESTIMATE` — a discrete, structural fact it computed
 * from a tier gate, not a number this file thresholds. The accumulated
 * pressure is still computed and reported for explainability (§27), and it
 * decides nothing. That is the same fix `adapt.ts`'s overshoot gate took when
 * a mileage threshold turned out to be standing in for a data-presence
 * question: replace the threshold with the discrete fact it was proxying.
 *
 * The one continuous input left is AGE, and it is applied as a window cutoff
 * (a date comparison) rather than a weight threshold. A tension observation
 * that falls out of the window stops counting; nothing about the decision
 * moves smoothly with how old it was.
 *
 * ── RULE 11 · CONFLICT IS NOT PRESSURE ──────────────────────────────────────
 *
 * Two activities in tension in OPPOSITE directions do not license anything.
 * They are a reason for LOWER CONFIDENCE, which the confidence model already
 * expresses through `OBSERVATIONS_DISAGREE`, not a reason to admit thinner
 * corroboration. `direction: 'conflicting'` therefore relaxes nothing, and
 * says so in its reasons.
 */
import type { CapacityName } from './activity-evidence';

/** §31 · version the model. Bump the MINOR when the relaxation policy changes;
 *  the PATCH when a reported field or reason code changes without moving it. */
export const REEXAMINATION_MODEL_VERSION = '1.0.0';

/**
 * How long a tension observation stays live.
 *
 * THE SAME NUMBER the confidence model ages evidence by,
 * `CAPACITY_CONFIDENCE_HALF_LIFE_DAYS` — so a tension can never outlive the
 * freshness the belief it challenges is graded on.
 *
 * WRITTEN OUT RATHER THAN IMPORTED, and the reason is structural rather than
 * stylistic: `capacity-resolver.ts` is the consumer of this module, so a value
 * import in this direction would close a module cycle. Rule 16 still holds, but
 * it is held by a GATE instead of by the import — `_reexamination.test.ts`
 * imports both and fails if they ever diverge, which is the enforcement Rule 20
 * asks for when the obvious mechanism is unavailable. Do not "fix" this by
 * importing the constant; fix it by deleting the test, and the divergence
 * arrives silently the next time either number moves.
 */
export const REEXAMINATION_WINDOW_DAYS = 28;

/**
 * How many same-direction tension observations license the single-step
 * relaxation.
 *
 * TWO, and the argument is the reference case's own: one strong observation
 * "isn't enough to redefine your fitness" but should make the system
 * "measurably more receptive to the next piece of confirming evidence". Two
 * activities disagreeing with the belief in the same direction is repetition,
 * which BRIEF 02 says dominates isolated observation; one is not.
 */
export const REEXAMINATION_MIN_OBSERVATIONS = 2;

/**
 * The floor the bar may never go below, whatever the pressure.
 *
 * Doctrine's closing line — "one run rarely rewrites the runner" — as a
 * constant. A relaxed bar of one would make a single activity sufficient to
 * anchor a capacity, which is the single-run-overwrite defect §10 names as a
 * machine-checkable invariant.
 */
export const REEXAMINATION_FLOOR_MIN_OBSERVATIONS = 2;

/** At most one observation comes off the bar, ever. */
export const REEXAMINATION_MAX_RELAXATION = 1;

export type ReexaminationDirection = 'stronger' | 'weaker' | 'conflicting' | 'none';

export type ReexaminationReasonCode =
  | 'NO_TENSION_OBSERVED'
  | 'TENSION_BELOW_REPETITION_FLOOR'
  | 'CONFLICTING_TENSION_DIRECTIONS'
  | 'REPEATED_TENSION_LOWERED_THE_CORROBORATION_BAR'
  | 'RELAXATION_CLAMPED_AT_FLOOR'
  | 'TENSION_OUTSIDE_WINDOW';

/**
 * One activity's disagreement with the belief that was held when it arrived.
 *
 * Assembled from `ActivityEvidenceResult.beliefTension`'s `ok: true` arm —
 * this file never re-derives a tension, it only accumulates ones the Evidence
 * Engine already graded.
 */
export interface TensionObservation {
  activityId: string;
  dateISO: string;
  capacity: CapacityName;
  direction: 'observation_stronger_than_belief' | 'observation_weaker_than_belief';
  /** 0-1, straight from `BeliefTensionRead.reexaminationWeight`. REPORTED,
   *  never thresholded — see the Rule 9 note in the header. */
  reexaminationWeight: number;
}

export interface ReexaminationPressure {
  capacity: CapacityName;
  /**
   * 0-1 · the age-decayed combination of the contributing weights, for
   * explanation and logging only. Nothing in this file branches on it, and a
   * consumer that starts branching on it has reintroduced the cliff.
   */
  pressure: number;
  direction: ReexaminationDirection;
  /** In-window observations, newest first. */
  observations: TensionObservation[];
  /** The floor the reader would otherwise have used. */
  baseMinObservations: number;
  /** The floor it may use instead. Never above `baseMinObservations`, never
   *  below `REEXAMINATION_FLOOR_MIN_OBSERVATIONS`. */
  effectiveMinObservations: number;
  reasons: ReexaminationReasonCode[];
  modelVersion: string;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return (b - a) / 86_400_000;
}

/**
 * Combine independent 0-1 weights the way the capacity resolver combines
 * independent confidences: `1 - Π(1 - w)`. Written here rather than imported
 * because the resolver's version takes exactly two arguments; the SHAPE is
 * deliberately identical so the two cannot express different ideas about what
 * "independent" means.
 */
function combineIndependent(weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  const residual = weights.reduce((acc, w) => acc * (1 - Math.min(1, Math.max(0, w))), 1);
  return 1 - residual;
}

/**
 * THE policy · accumulate tension for one capacity and say what corroboration
 * floor it licenses.
 *
 * Pure. `todayISO` is the runner's own day, supplied rather than read from a
 * clock, so this is falsifiable without one (Rule 18).
 */
export function accumulateReexamination(args: {
  capacity: CapacityName;
  observations: readonly TensionObservation[];
  baseMinObservations: number;
  todayISO: string;
}): ReexaminationPressure {
  const { capacity, baseMinObservations, todayISO } = args;

  const forCapacity = args.observations.filter((o) => o.capacity === capacity);
  const inWindow = forCapacity
    .filter((o) => {
      const age = daysBetween(o.dateISO, todayISO);
      return Number.isFinite(age) && age >= 0 && age <= REEXAMINATION_WINDOW_DAYS;
    })
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));

  const reasons: ReexaminationReasonCode[] = [];
  if (forCapacity.length > inWindow.length) reasons.push('TENSION_OUTSIDE_WINDOW');

  const base = {
    capacity,
    observations: inWindow,
    baseMinObservations,
    modelVersion: REEXAMINATION_MODEL_VERSION,
  };

  if (inWindow.length === 0) {
    return {
      ...base,
      pressure: 0,
      direction: 'none',
      effectiveMinObservations: baseMinObservations,
      reasons: [...reasons, 'NO_TENSION_OBSERVED'],
    };
  }

  // Age-decayed, and REPORTED ONLY. A half-life decay over the same half-life
  // the confidence model uses.
  const pressure = combineIndependent(
    inWindow.map((o) => {
      const age = daysBetween(o.dateISO, todayISO);
      const decay = Math.pow(0.5, age / REEXAMINATION_WINDOW_DAYS);
      return o.reexaminationWeight * decay;
    }),
  );

  const stronger = inWindow.filter((o) => o.direction === 'observation_stronger_than_belief').length;
  const weaker = inWindow.length - stronger;
  const direction: ReexaminationDirection =
    stronger > 0 && weaker > 0 ? 'conflicting' : stronger > 0 ? 'stronger' : 'weaker';

  if (direction === 'conflicting') {
    return {
      ...base,
      pressure,
      direction,
      effectiveMinObservations: baseMinObservations,
      reasons: [...reasons, 'CONFLICTING_TENSION_DIRECTIONS'],
    };
  }

  // THE DECISION · a count of discrete facts, never a threshold on `pressure`.
  if (inWindow.length < REEXAMINATION_MIN_OBSERVATIONS) {
    return {
      ...base,
      pressure,
      direction,
      effectiveMinObservations: baseMinObservations,
      reasons: [...reasons, 'TENSION_BELOW_REPETITION_FLOOR'],
    };
  }

  const relaxed = baseMinObservations - REEXAMINATION_MAX_RELAXATION;
  const clamped = Math.max(REEXAMINATION_FLOOR_MIN_OBSERVATIONS, relaxed);
  const effectiveMinObservations = Math.min(baseMinObservations, clamped);

  reasons.push('REPEATED_TENSION_LOWERED_THE_CORROBORATION_BAR');
  if (clamped > relaxed) reasons.push('RELAXATION_CLAMPED_AT_FLOOR');

  return { ...base, pressure, direction, effectiveMinObservations, reasons };
}

/**
 * Lift the `ok: true` arm of a set of belief-tension reads into observations.
 *
 * Rule 11 in the small: a refusal arm carries no numbers and is DROPPED rather
 * than defaulted to a zero-weight observation, because "we had no comparable
 * observation" and "we compared and found no tension" are different facts and
 * neither is "a tension of zero".
 */
export function tensionObservationsFrom(
  reads: readonly {
    activityId: string;
    dateISO: string;
    tension:
      | {
          ok: true;
          capacity: CapacityName;
          direction: 'observation_stronger_than_belief' | 'observation_weaker_than_belief';
          reexaminationWeight: number;
        }
      | { ok: false };
  }[],
): TensionObservation[] {
  const out: TensionObservation[] = [];
  for (const r of reads) {
    if (!r.tension.ok) continue;
    out.push({
      activityId: r.activityId,
      dateISO: r.dateISO,
      capacity: r.tension.capacity,
      direction: r.tension.direction,
      reexaminationWeight: r.tension.reexaminationWeight,
    });
  }
  return out;
}
