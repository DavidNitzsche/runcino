/**
 * lib/training/detector-fitness-posture.ts · PROPOSAL, NOT WIRED IN.
 *
 * WAVE 2, QUESTION 6 · EXACTLY WHAT `detectFitnessRegression` AND
 * `detectTrainingLead` SHOULD DO IN EACH OF THE FOUR STATES, IF THEY WERE TO
 * ADOPT THE CANONICAL RESOLVER.
 *
 * `adapt.ts` is NOT touched by this file or by anything on this branch. This
 * is the behaviour spec, written as executable code so it can be tested and
 * falsified before anyone decides whether to adopt it — see
 * `_detector_fitness_posture.test.ts` and
 * `_wave2_no_mutation_scan.test.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * THE FOUR STATES, AND THE ONE RULE THAT DECIDES ALL OF THEM
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Rule 11, and its Rule 8 corollary: a zero measured inside a prescribed
 * recovery block and a zero measured off a detrained runner are OPPOSITE
 * FACTS. Applied here: "the runner has not changed", "we have nothing to say
 * about the runner", and "we could not find out" are three different reasons
 * for a detector to stay silent, and today all three produce the same
 * `return null`. That is the ambiguity Rule 21 says let a zero-upgrade engine
 * survive 309 production intents — "an engine that returns nothing when it
 * cannot decide is indistinguishable from an engine that was never called".
 *
 * So every state below produces a TYPED POSTURE, never a bare null, and every
 * non-firing posture states which of the three silences it is.
 *
 *   1 · AGREEMENT      canonical answers, legacy cascade within
 *                      SELF_HEAL_REANCHOR_DELTA         → EVALUATE
 *   2 · DISAGREEMENT   beyond that threshold            → HOLD + RAISE
 *   3 · UNAVAILABLE    canonical has no runner-specific
 *                      evidence (new runner)            → HOLD, no raise
 *   4 · READ FAILURE   a read broke                     → HOLD + RAISE
 *
 * ══════════════════════════════════════════════════════════════════════════
 * STATE 3 IS NOT WHAT IT LOOKS LIKE, AND THIS IS THE TRAP
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `resolveThresholdCapacity()` NEVER returns "I have nothing to say". It
 * always returns a number, because it has fallback rungs all the way down to
 * `MILEAGE_POPULATION_PRIOR` — a threshold pace derived from how many miles a
 * week the runner told an onboarding form they run. That is the correct
 * design for a PACE PRESCRIPTION consumer (Constitution §32: a simple
 * fallback beats fake intelligence, and the runner still needs a pace today).
 *
 * It is a disaster for an ADAPTATION consumer, and the reason is Rule 11
 * again in its most expensive form: a detector that compares a
 * population-prior number against a stale anchor will find a delta, and the
 * delta will be an artefact of two different fallbacks disagreeing rather
 * than anything the runner did. It would fire a pace change on a runner the
 * engine has never observed.
 *
 * So "unavailable" is detected from `sourceMode` and `evidenceIds`, not from
 * a null. `EVIDENCE_BEARING_SOURCE_MODES` below is the list, and its
 * membership is argued per member rather than asserted as a block.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHY STATE 2 HOLDS RATHER THAN PREFERRING THE CANONICAL BELIEF
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Constitution §C makes the canonical belief the authority, and the resolver
 * at `6874b4518` is right to say so. This posture does NOT contradict that: it
 * does not prefer the legacy anchor, it declines to MOVE A PLAN while two
 * numbers that should agree do not. §16's final decision validator is
 * explicit about the shape — "if a contradiction exists: FAIL LOUDLY rather
 * than silently choosing one."
 *
 * And the raise is load-bearing, not decoration. Measured on the owner's real
 * history over 45 consecutive days (read-only replay, proposal §2), the
 * cross-check answered `ok` on 45 of 45 days with a delta between +0.90 and
 * +1.30 against a 2.00 threshold. It has never fired. Per Rule 18 that makes
 * it a hypothesis, and per the proposal's headline finding it is a
 * hypothesis with a clock on it: the legacy anchor is FROZEN at 46.6 and the
 * canonical belief is rising, so the delta grows monotonically until it
 * crosses 2.00 and the resolver refuses PERMANENTLY, for a reason that has
 * nothing to do with the runner. A silent hold in that state would stop the
 * pace lever forever with no alert. This is why state 2 raises.
 */
import type { SourceMode } from '@/lib/training/capacity-resolver';
import type { CurrentFitnessRead } from '@/lib/training/resolve-current-fitness';
import {
  toCurrentFitnessContract,
  withCurrentFitness,
  type CaveatAssessment,
  type CurrentFitnessNumbers,
} from '@/lib/training/current-fitness-contract';
import type { CapacityReasonCode } from '@/lib/training/capacity-resolver';

/**
 * Source modes that represent something the engine OBSERVED about THIS
 * runner. An adaptation may only be reasoned from one of these.
 *
 *   `direct`        · observations from this runner's own training corpus.
 *   `inferred`      · derived from another of this runner's own capacities,
 *                     which is itself observation-backed.
 *   `race_derived`  · this runner's own race result.
 *
 * And the three that are excluded, each for its own reason rather than as a
 * block:
 *
 *   `vdot_fallback`     · a measured VDOT from the legacy estimator. It IS
 *                         runner-specific, and it is excluded anyway: it is
 *                         the very cascade this whole proposal is migrating
 *                         AWAY from, so admitting it here would let the
 *                         detector reason from the legacy number through a
 *                         canonical-looking door — a side door, §4.
 *   `user_prior`        · what the runner TOLD us at onboarding. A
 *                         declaration, not an observation. Constitution §K's
 *                         line about the goal applies with equal force to a
 *                         self-reported PR: it does not determine current
 *                         fitness.
 *   `population_prior`  · not about this runner at all.
 */
export const EVIDENCE_BEARING_SOURCE_MODES: readonly SourceMode[] = Object.freeze([
  'direct',
  'inferred',
  'race_derived',
]);

export type DetectorSilence =
  /** The two beliefs contradict each other. State 2. */
  | 'BELIEFS_DISAGREE'
  /** No runner-specific evidence exists. State 3. NOT a failure. */
  | 'NO_RUNNER_EVIDENCE'
  /** A read broke. State 4. */
  | 'READ_FAILED'
  /** The evidence carries a Rule 11 absence (see `current-fitness-contract`). */
  | 'EVIDENCE_DISQUALIFIED';

export type DetectorPosture =
  | {
      readonly posture: 'EVALUATE';
      /** The anchor the detector should measure its delta against — the
       *  CANONICAL belief, never the legacy cascade. */
      readonly canonicalVdot: number;
      readonly canonicalPaceSecPerMi: number;
      readonly confidence: number;
      readonly sourceMode: SourceMode;
      /** Empty on a clean read. Non-empty means the caller has been handed a
       *  discounted number and must carry that into whatever it records. */
      readonly caveats: readonly CapacityReasonCode[];
      readonly evidenceIds: readonly string[];
      readonly why: string;
    }
  | {
      readonly posture: 'HOLD';
      readonly silence: DetectorSilence;
      /** Whether this silence is an OPERATIONAL fault someone must see. Rule
       *  23's surface is `ops_alerts`; this only says whether to write one. */
      readonly raise: boolean;
      readonly why: string;
      /** Recorded even on a hold, so the ledger can answer "why did the pace
       *  lever not move" — Rule 21's "a log that records that something
       *  happened but not what is not a log", applied to non-events. */
      readonly assessment: CaveatAssessment;
    };

/**
 * PURE. Given the resolver's read (and whether the read itself threw),
 * what should either detector do?
 *
 * ONE function for BOTH detectors, deliberately. Rule 21: "The bar to go UP
 * may not be higher than the bar to come DOWN." Two functions is how the two
 * bars drift apart, and `adapt.ts` has already paid for that once — its own
 * comment records that `detectFitnessRegression` swallows a failed race-week
 * read into "no race is coming" while `detectTrainingLead` fails closed on
 * the identical query. This function takes no direction argument, so the
 * asymmetry is not expressible.
 */
export function fitnessDetectorPosture(
  read: CurrentFitnessRead | { readonly threw: true; readonly why: string },
): DetectorPosture {
  const emptyAssessment: CaveatAssessment = {
    tier: 'DISQUALIFYING',
    caveats: [],
    why: 'no read completed, so no caveat assessment exists.',
  };

  // ── STATE 4 · READ FAILURE ───────────────────────────────────────────────
  // Distinguished from state 3 by construction: this branch is only reachable
  // when the caller caught a throw. Rule 11 — "the read failed" is not "there
  // is nothing to read", and collapsing them is what lets a database blip
  // read as a detrained runner.
  if ('threw' in read) {
    return {
      posture: 'HOLD',
      silence: 'READ_FAILED',
      raise: true,
      why:
        `the canonical fitness read failed: ${read.why}. That is not "the runner has not `
        + 'changed" and it is not "we have nothing on this runner" — it is a fault, and a '
        + 'detector that treats it as either would be spending a number it never obtained.',
      assessment: emptyAssessment,
    };
  }

  const contract = toCurrentFitnessContract(read);

  return withCurrentFitness<DetectorPosture>(contract, {
    // ── STATE 1 · AGREEMENT, clean ───────────────────────────────────────
    onClean: (numbers, provenance) => evaluate(numbers, [], provenance.canonicalBelief.evidenceIds,
      'the canonical belief answered and the legacy cascade agrees within '
      + `${provenance.disagreementThresholdVdot} VDOT. No caveat was reported.`),

    // ── STATE 1 · AGREEMENT, qualified ───────────────────────────────────
    // The caveats are carried into the posture, so whatever the detector
    // records names them. This is the whole point of routing through
    // `withCurrentFitness`: the caveats cannot be dropped between the
    // resolver and the ledger row, because the only route to the numbers
    // hands them over together.
    onQualified: (numbers, caveats, provenance) => {
      const gated = gateOnUnobservedRunner(numbers, caveats, provenance.canonicalBelief.evidenceIds);
      if (gated) return gated;
      return evaluate(numbers, caveats, provenance.canonicalBelief.evidenceIds,
        'the canonical belief answered with caveats already priced into its confidence '
        + `(Constitution §14) and the legacy cascade agrees within `
        + `${provenance.disagreementThresholdVdot} VDOT. The caveats travel with the number.`);
    },

    // ── STATES 2 and "disqualified" ──────────────────────────────────────
    onRefused: (reason, detail, assessment) => {
      if (reason === 'DISQUALIFYING_CAVEATS') {
        return {
          posture: 'HOLD',
          silence: 'EVIDENCE_DISQUALIFIED',
          // Not an operational fault. The engine worked; the evidence did not
          // support a number. Raising here would train whoever reads
          // `ops_alerts` to ignore it, which is how a real fault gets missed.
          raise: false,
          why: detail,
          assessment,
        };
      }
      if (reason === 'INCOMPARABLE_BELOW_TABLE') {
        // A below-table runner is a real runner with a real pace and no VDOT.
        // Not a fault, and not a state an adaptation should act in: every
        // threshold in `adapt.ts` is denominated in VDOT points.
        return {
          posture: 'HOLD',
          silence: 'NO_RUNNER_EVIDENCE',
          raise: false,
          why: detail,
          assessment,
        };
      }
      // BELIEF_SNAPSHOT_DISAGREEMENT · state 2.
      return {
        posture: 'HOLD',
        silence: 'BELIEFS_DISAGREE',
        raise: true,
        why:
          `${detail} Neither detector may move a plan while the two beliefs contradict each `
          + 'other (Constitution §16: fail loudly rather than silently choosing one), and the '
          + 'contradiction is raised because the most likely cause — a legacy anchor frozen by '
          + 'the dead recompute_paces stamp — would otherwise silence the pace lever '
          + 'permanently with nothing reporting it.',
        assessment,
      };
    },
  });

  function evaluate(
    numbers: CurrentFitnessNumbers,
    caveats: readonly CapacityReasonCode[],
    evidenceIds: readonly string[],
    why: string,
  ): DetectorPosture {
    const gated = gateOnUnobservedRunner(numbers, caveats, evidenceIds);
    if (gated) return gated;
    return {
      posture: 'EVALUATE',
      canonicalVdot: numbers.vdot,
      canonicalPaceSecPerMi: numbers.paceSecPerMi,
      confidence: numbers.confidence,
      sourceMode: numbers.sourceMode,
      caveats,
      evidenceIds,
      why,
    };
  }

  // ── STATE 3 · UNAVAILABLE EVIDENCE ─────────────────────────────────────
  function gateOnUnobservedRunner(
    numbers: CurrentFitnessNumbers,
    caveats: readonly CapacityReasonCode[],
    evidenceIds: readonly string[],
  ): DetectorPosture | null {
    const observed = EVIDENCE_BEARING_SOURCE_MODES.includes(numbers.sourceMode);
    if (observed && evidenceIds.length > 0) return null;
    return {
      posture: 'HOLD',
      silence: 'NO_RUNNER_EVIDENCE',
      // Not a fault. A brand-new runner having no training corpus is the
      // system working. Rule 11's point is that it must be SAID, not that it
      // must be alarming.
      raise: false,
      why:
        `the canonical belief answered ${numbers.vdot.toFixed(1)} from sourceMode `
        + `'${numbers.sourceMode}' with ${evidenceIds.length} named observation(s). That is a `
        + 'fallback, not evidence about this runner, and a delta measured against it would be '
        + 'two fallbacks disagreeing rather than anything the runner did. No adaptation may '
        + 'rest on it.',
      assessment: {
        tier: caveats.length === 0 ? 'CLEAN' : 'QUALIFIED',
        caveats,
        why: 'assessed, then superseded by the unobserved-runner gate.',
      },
    };
  }
}
