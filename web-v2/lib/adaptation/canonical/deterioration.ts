/**
 * lib/adaptation/canonical/deterioration.ts · MEANINGFUL LATE-SESSION
 * DETERIORATION, and the difference between one bad session and a pattern.
 *
 * `docs/PROGRESSIVE_BASELINE_DOCTRINE.md` Q13.
 *
 * ── THE TWO THINGS Q13 IS MOST INSISTENT ABOUT ─────────────────────────────
 *
 * 1 · "Apply only to comparable work." A workout with different prescribed
 *     phases has no meaningful thirds, and Q13 says so directly: "Do not infer
 *     deterioration from whole-run thirds when the workout contains different
 *     prescribed phases." `ComparableThirds.comparable` carries that judgement
 *     from the evidence layer, and this file refuses rather than guesses when
 *     it is false.
 *
 * 2 · "'Repeated' means ≥2 relevant SESSIONS in the window, not two segments in
 *     one run." Two collapsing reps inside one workout is one deteriorated
 *     session. The distinction matters because the lever contracts gate on
 *     REPEATED deterioration, and counting segments would let a single ragged
 *     session block a progression Q13 explicitly says it must not:
 *
 *         "One deteriorated session reduces confidence; it must not
 *          independently block progression unless the deterioration is extreme
 *          or that session was the direct prerequisite."
 *
 * ── Q29 · TRUNCATION AND THE ABSENCE OF EVIDENCE ───────────────────────────
 *
 *     "not usable for late-session deterioration · absence of a captured late
 *      decline is not evidence of durability"
 *
 * A truncated activity therefore returns UNKNOWN here, never CLEAN. Returning
 * CLEAN would let a watch dying at mile 18 read as a strong finish, which is
 * Rule 11's collapse in its most expensive form: the missing data would become
 * positive evidence for a longer long run.
 *
 * ── DETERIORATION-SEVERITY-1 (2026-09-05) · THE WORD "EXTREME", MEASURED ───
 *
 * Q13's sentence above has two escapes and named neither: one deteriorated
 * session may block "if the deterioration is EXTREME or that session was the
 * direct prerequisite". Until this change nothing in the engine could measure
 * either, so `deteriorationPattern` said one session "reduces confidence
 * without blocking progression" while `volume-evidence/admit.ts` refused the
 * whole week on `deterioratedCount > 0`. The two sentences contradicted each
 * other, and the contradiction was not academic: it was the ONLY reason the
 * one week on the reference account with a real admissible surplus
 * (2026-06-15, 47.3 mi against 45.5 prescribed) contributed nothing.
 *
 * This file now measures HOW BADLY. `severityFrac` is `Research/03` §12's
 * Pa:HR decoupling, the same quantity Q13's own third signal thresholds, and
 * §12 carries a four-row band table over it. The 8% row reads "Endurance gap;
 * build base before progressing", which is doctrine saying in its own words
 * that a progression is not licensed there — so that is what EXTREME means,
 * and `DETERIORATION_SEVERITY_EXTREME_FRAC` is its lower edge rather than a
 * number anybody picked.
 *
 * WHAT THIS FILE STILL DOES NOT MEASURE, said plainly rather than left to be
 * discovered: Q13's OTHER escape. Nothing here knows whether a session was the
 * "direct prerequisite" for the progression being considered, because that is
 * a property of the QUESTION being asked and not of the session. A caller that
 * needs it has to supply it; no caller does today, so that escape is unused
 * and a prerequisite session currently blocks only on severity or repetition
 * like any other.
 */
import {
  DETERIORATION_PACE_SLOWDOWN_FRAC,
  DETERIORATION_PACE_STABLE_FRAC,
  DETERIORATION_HR_RISE_BPM,
  DETERIORATION_DECOUPLING_FRAC,
  DETERIORATION_REPEATED_MIN_SESSIONS,
  DETERIORATION_SEVERITY_EXTREME_FRAC,
} from './contract-constants';
import type { ComparableThirds, Truncation } from './input';

/**
 * DETERIORATION-SEVERITY-1 · HOW BADLY, not only whether.
 *
 * `Research/03-heart-rate-zones.md` §12 "Cardiac Drift and Aerobic Decoupling
 * (Pa:HR)" states the formula, verbatim:
 *
 *     EF = speed / HR    (use speed, not min/km)
 *     Pa:HR Decoupling = ((EF_1st_half / EF_2nd_half) - 1) × 100%
 *
 * This file compares the MIDDLE third against the FINAL third rather than
 * half against half, which is Q13's window and not §12's. The transfer is
 * declared here rather than hidden: §12 measures a steady 60-90 minute run in
 * halves, Q13 measures a session in thirds and excludes the opening third
 * precisely because a warm-up is not the comparison anybody wants. The BAND
 * TABLE is what is borrowed, and the bands are about the size of an efficiency
 * drop, not about which two windows produced it.
 *
 * Written in PACE because that is what `ComparableThirds` carries. With
 * `speed = 1 / pace`,
 *
 *     EF_mid / EF_fin = (paceFin / paceMid) × (hrFin / hrMid)
 *
 * so the returned fraction is exactly §12's quantity with no linearisation.
 * The engine's `PACE_TO_HR_DECOUPLING` signal used the first-order sum
 * (`slowdown + hrRiseFrac`) and now calls this instead, so ONE definition of
 * decoupling exists in this file rather than two that agree to second order
 * (Rule 16). The two differ by `slowdown × hrRiseFrac`, which is under a tenth
 * of a percentage point at any realistic pair.
 *
 * Positive means efficiency FELL: the runner gave more heart rate for less
 * speed. Negative means it rose. Not clamped, because a strongly negative
 * value is a real fact about a session that got more efficient, and clamping
 * it would collapse "improved" into "held" (Rule 11).
 */
export function paHrDecouplingFrac(
  middlePaceSecPerMi: number,
  finalPaceSecPerMi: number,
  middleHrBpm: number,
  finalHrBpm: number,
): number {
  if (!(middlePaceSecPerMi > 0) || !(middleHrBpm > 0)) return 0;
  return (finalPaceSecPerMi / middlePaceSecPerMi) * (finalHrBpm / middleHrBpm) - 1;
}

/**
 * Three states, not a boolean. Rule 11: a session that held together and a
 * session nobody could read are opposite facts, and only one of them is
 * evidence.
 */
export type DeteriorationVerdict = 'CLEAN' | 'DETERIORATED' | 'UNKNOWN';

export type DeteriorationSignal =
  | 'FINAL_THIRD_SLOWER_AT_EQUAL_OR_HIGHER_HR'
  | 'HR_ROSE_AT_STABLE_PACE'
  | 'PACE_TO_HR_DECOUPLING';

export interface DeteriorationResult {
  readonly verdict: DeteriorationVerdict;
  readonly signals: readonly DeteriorationSignal[];
  /**
   * HOW BADLY, as `Research/03` §12's Pa:HR decoupling fraction, or `null`
   * when it could not be measured.
   *
   * RULE 11, AND IT IS THE WHOLE REASON THIS IS NULLABLE. A session at
   * severity 0 and a session whose severity nobody could read are opposite
   * facts, and a caller that treats the second as the first has just given
   * full credit to a run it could not see. `null` and `UNKNOWN` always travel
   * together — every branch that returns UNKNOWN returns null here, and every
   * branch that returns CLEAN or DETERIORATED returns a number, because both
   * of those require a readable heart rate to reach. That invariant is
   * asserted in `volume-evidence/_deterioration_severity.test.ts` rather than
   * claimed here (Rule 20).
   */
  readonly severityFrac: number | null;
  readonly detail: string;
}

/**
 * One session's late-session behaviour.
 *
 * Note the HR condition on the first signal. Q13 does not flag a slower final
 * third on its own, and that is deliberate: a slower finish at LOWER heart rate
 * is a runner easing down, which is not deterioration. Requiring "HR equal or
 * higher" is what separates fatigue from a cool-down, and dropping it would
 * make every well-executed progression run look like a collapse.
 */
export function assessDeterioration(
  thirds: ComparableThirds,
  truncation: Truncation,
): DeteriorationResult {
  if (truncation.truncated) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      detail:
        'The activity was truncated, so the late portion was not captured. '
        + 'Absence of a recorded decline is not evidence the session held together.',
    };
  }

  if (!thirds.comparable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      detail:
        'The session does not contain comparable work across its thirds, so a '
        + 'late-session comparison would not mean anything.',
    };
  }

  if (!thirds.middlePaceSecPerMi.ok || !thirds.finalPaceSecPerMi.ok) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      detail: 'Pace for the middle or final third could not be read.',
    };
  }

  const midPace = thirds.middlePaceSecPerMi.value;
  const finPace = thirds.finalPaceSecPerMi.value;
  // Positive means the final third was SLOWER.
  const slowdown = (finPace - midPace) / midPace;

  const hrReadable = thirds.middleHrBpm.ok && thirds.finalHrBpm.ok;
  const hrRise = hrReadable ? thirds.finalHrBpm.value - thirds.middleHrBpm.value : null;

  /* DETERIORATION-SEVERITY-1 · ONE decoupling number, computed once, used both
   * as Q13's third signal and as the SEVERITY the band table is read against.
   * Null exactly when heart rate is unreadable, which is exactly when every
   * branch below returns UNKNOWN (Rule 11: the two travel together). */
  const severityFrac = hrReadable && thirds.middleHrBpm.ok && thirds.finalHrBpm.ok
    ? paHrDecouplingFrac(midPace, finPace, thirds.middleHrBpm.value, thirds.finalHrBpm.value)
    : null;

  const signals: DeteriorationSignal[] = [];

  // Q13 · final third >~4% slower while HR is equal or higher.
  if (slowdown > DETERIORATION_PACE_SLOWDOWN_FRAC && hrRise !== null && hrRise >= 0) {
    signals.push('FINAL_THIRD_SLOWER_AT_EQUAL_OR_HIGHER_HR');
  }

  // Q13 · pace within ~2% but HR rises >~6 bpm.
  if (Math.abs(slowdown) <= DETERIORATION_PACE_STABLE_FRAC
    && hrRise !== null && hrRise > DETERIORATION_HR_RISE_BPM) {
    signals.push('HR_ROSE_AT_STABLE_PACE');
  }

  // Q13 · pace-to-HR decoupling >~5%. Pace slowed and HR climbed together.
  // The magnitude is `severityFrac`, computed once above, so this predicate and
  // the band table below cannot drift apart (Rule 16).
  if (severityFrac !== null && hrRise !== null
    && slowdown > 0 && hrRise > 0 && severityFrac > DETERIORATION_DECOUPLING_FRAC) {
    signals.push('PACE_TO_HR_DECOUPLING');
  }

  if (signals.length > 0) {
    return {
      verdict: 'DETERIORATED',
      signals,
      severityFrac,
      detail: `Late-session deterioration · ${signals.join(', ')}`
        + `${severityFrac == null ? '' : ` · Pa:HR decoupling ${(severityFrac * 100).toFixed(1)} per cent`}.`,
    };
  }

  // Pace is readable and shows no decline, but HR is not. That is a partial
  // read, and Q13's signals two and three both need HR. Saying CLEAN here would
  // claim more than the data supports.
  if (!hrReadable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      severityFrac: null,
      detail:
        'Pace held through the final third, but heart rate could not be read, '
        + 'so two of the three deterioration signals could not be evaluated.',
    };
  }

  return {
    verdict: 'CLEAN',
    signals: [],
    severityFrac,
    detail: 'The session held together to the finish.',
  };
}

/**
 * Q13's "repeated" · counted in SESSIONS, never in segments.
 *
 * UNKNOWN sessions are not counted as clean and not counted as deteriorated.
 * They are reported separately so a caller can tell "two good sessions" from
 * "two sessions I could not read", which the lever contracts need in order to
 * refuse rather than pass.
 */
export interface DeteriorationPattern {
  readonly repeated: boolean;
  readonly deterioratedCount: number;
  readonly unknownCount: number;
  readonly cleanCount: number;
  /**
   * DETERIORATION-SEVERITY-1 · the WORST readable Pa:HR decoupling across the
   * window, or `null` when no session in it was readable.
   *
   * THE MAXIMUM, not the mean, and that is the conservative choice on purpose:
   * the question a caller asks this is "did anything in this week fall apart",
   * and averaging one collapsed session against three clean ones answers a
   * different question. It is also what makes the roll-up monotone — adding a
   * worse session can only ever lower the confidence a caller derives from it,
   * never raise it.
   *
   * READ ACROSS EVERY READABLE SESSION, clean ones included. That is not an
   * oversight and it is what keeps the whole pipeline continuous: a session a
   * hair on either side of a detector line has almost the same decoupling, so
   * a factor derived from the decoupling moves by a hair, while a factor gated
   * on the VERDICT would jump. `_deterioration_severity.test.ts` walks the
   * `HR_ROSE_AT_STABLE_PACE` boundary and measures exactly that.
   *
   * Rule 11 · `null` here means NO SESSION COULD BE READ, never "nothing went
   * wrong". A window with no sessions at all also reports null, and a caller
   * has to decide what an empty window means for its own question rather than
   * being handed a zero that looks like a measurement.
   */
  readonly worstSeverityFrac: number | null;
  readonly detail: string;
}

/**
 * What ONE deteriorated session means, in `Research/03` §12's own vocabulary.
 *
 * DETERIORATION-SEVERITY-1 · this sentence used to be unconditional: "which
 * reduces confidence without blocking progression", printed over every single
 * fade whatever its size. It was wrong in both directions. It was wrong about
 * an extreme fade, which §12 says should stop a progression, and it went on
 * being wrong even while `admit.ts` refused the week -- the report printed a
 * sentence saying a fade does not block, as the reason a fade had blocked.
 * CLAUDE.md Rule 16: a sentence asserting a fact about a measurement must be
 * gated on that measurement or not said.
 *
 * This describes the MEASUREMENT and never a lever's decision. Whether a
 * particular lever refuses is that lever's question; what the decoupling means
 * is this file's.
 */
function oneSessionMeans(severityFrac: number | null): string {
  if (severityFrac == null) {
    return 'How far it fell could not be measured, so how much confidence it costs cannot '
      + 'be said either.';
  }
  if (severityFrac >= DETERIORATION_SEVERITY_EXTREME_FRAC) {
    return 'That is past the point doctrine calls an endurance gap, where the instruction is '
      + 'to build base before progressing.';
  }
  if (severityFrac > DETERIORATION_DECOUPLING_FRAC) {
    return 'That reduces confidence in proportion to how far it fell rather than blocking '
      + 'progression.';
  }
  return 'That is inside the range doctrine calls sustainable, so it does not reduce '
    + 'confidence on its own.';
}

export function deteriorationPattern(
  results: readonly DeteriorationResult[],
): DeteriorationPattern {
  const deterioratedCount = results.filter((r) => r.verdict === 'DETERIORATED').length;
  const unknownCount = results.filter((r) => r.verdict === 'UNKNOWN').length;
  const cleanCount = results.filter((r) => r.verdict === 'CLEAN').length;
  const repeated = deterioratedCount >= DETERIORATION_REPEATED_MIN_SESSIONS;

  const readable = results
    .map((r) => r.severityFrac)
    .filter((s): s is number => s != null);
  const worstSeverityFrac = readable.length === 0 ? null : Math.max(...readable);

  const worstPct = worstSeverityFrac == null
    ? null
    : `${(worstSeverityFrac * 100).toFixed(1)} per cent`;

  return {
    repeated,
    deterioratedCount,
    unknownCount,
    cleanCount,
    worstSeverityFrac,
    detail: repeated
      ? `${deterioratedCount} sessions in the window showed late deterioration`
        + `${worstPct == null ? '' : `, the worst at ${worstPct} Pa:HR decoupling`}.`
      : deterioratedCount === 1
        ? `One session showed late deterioration${worstPct == null ? '' : ` at ${worstPct} `
          + 'Pa:HR decoupling'}. ${oneSessionMeans(worstSeverityFrac)}`
        : `No repeated late deterioration across ${cleanCount} readable sessions.`
          + `${worstPct == null ? '' : ` The worst finished at ${worstPct} Pa:HR decoupling.`}`,
  };
}
