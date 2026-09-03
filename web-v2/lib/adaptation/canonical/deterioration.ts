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
 */
import {
  DETERIORATION_PACE_SLOWDOWN_FRAC,
  DETERIORATION_PACE_STABLE_FRAC,
  DETERIORATION_HR_RISE_BPM,
  DETERIORATION_DECOUPLING_FRAC,
  DETERIORATION_REPEATED_MIN_SESSIONS,
} from './contract-constants';
import type { ComparableThirds, Truncation } from './input';

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
      detail:
        'The activity was truncated, so the late portion was not captured. '
        + 'Absence of a recorded decline is not evidence the session held together.',
    };
  }

  if (!thirds.comparable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      detail:
        'The session does not contain comparable work across its thirds, so a '
        + 'late-session comparison would not mean anything.',
    };
  }

  if (!thirds.middlePaceSecPerMi.ok || !thirds.finalPaceSecPerMi.ok) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      detail: 'Pace for the middle or final third could not be read.',
    };
  }

  const midPace = thirds.middlePaceSecPerMi.value;
  const finPace = thirds.finalPaceSecPerMi.value;
  // Positive means the final third was SLOWER.
  const slowdown = (finPace - midPace) / midPace;

  const hrReadable = thirds.middleHrBpm.ok && thirds.finalHrBpm.ok;
  const hrRise = hrReadable ? thirds.finalHrBpm.value - thirds.middleHrBpm.value : null;

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
  if (hrReadable && hrRise !== null && thirds.middleHrBpm.ok) {
    const hrRiseFrac = hrRise / thirds.middleHrBpm.value;
    const decoupling = slowdown + hrRiseFrac;
    if (slowdown > 0 && hrRise > 0 && decoupling > DETERIORATION_DECOUPLING_FRAC) {
      signals.push('PACE_TO_HR_DECOUPLING');
    }
  }

  if (signals.length > 0) {
    return {
      verdict: 'DETERIORATED',
      signals,
      detail: `Late-session deterioration · ${signals.join(', ')}.`,
    };
  }

  // Pace is readable and shows no decline, but HR is not. That is a partial
  // read, and Q13's signals two and three both need HR. Saying CLEAN here would
  // claim more than the data supports.
  if (!hrReadable) {
    return {
      verdict: 'UNKNOWN',
      signals: [],
      detail:
        'Pace held through the final third, but heart rate could not be read, '
        + 'so two of the three deterioration signals could not be evaluated.',
    };
  }

  return { verdict: 'CLEAN', signals: [], detail: 'The session held together to the finish.' };
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
  readonly detail: string;
}

export function deteriorationPattern(
  results: readonly DeteriorationResult[],
): DeteriorationPattern {
  const deterioratedCount = results.filter((r) => r.verdict === 'DETERIORATED').length;
  const unknownCount = results.filter((r) => r.verdict === 'UNKNOWN').length;
  const cleanCount = results.filter((r) => r.verdict === 'CLEAN').length;
  const repeated = deterioratedCount >= DETERIORATION_REPEATED_MIN_SESSIONS;

  return {
    repeated,
    deterioratedCount,
    unknownCount,
    cleanCount,
    detail: repeated
      ? `${deterioratedCount} sessions in the window showed late deterioration.`
      : deterioratedCount === 1
        ? 'One session showed late deterioration, which reduces confidence without blocking progression.'
        : `No repeated late deterioration across ${cleanCount} readable sessions.`,
  };
}
