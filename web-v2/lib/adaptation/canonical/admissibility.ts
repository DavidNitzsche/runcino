/**
 * lib/adaptation/canonical/admissibility.ts · WHAT AN OBSERVATION MAY BE SPENT
 * ON. Representativeness is LEVER-SPECIFIC.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` "Evidence admissibility", Q27-Q29.
 *
 *     "Do not globally admit or reject an entire activity when different parts
 *      remain useful."   — Q27
 *
 * That one sentence is this file. The recurring bug it prevents is an engine
 * that sees `treadmill: true` and drops the run entirely, losing eight miles of
 * perfectly good weekly volume in order to avoid pricing road pace off a belt.
 * The activity is admissible; the CLAIM is what gets rationed.
 *
 * ── THE THREE QUESTIONS, ANSWERED SEPARATELY ───────────────────────────────
 *
 *   PACE evidence      · the strictest. Any representativeness flag disqualifies.
 *   LOAD evidence      · the most permissive. A treadmill hour is an hour.
 *   DURABILITY evidence· in between. Terrain is relevant rather than
 *                        disqualifying, but truncation is fatal to it.
 *
 * ── Q28 · THE TREADMILL RULE, AND THE DOOR IT DELIBERATELY LEAVES SHUT ─────
 *
 *     "Never moves road, threshold, marathon or race-projection pace. Any
 *      future treadmill-to-road calibration must be a separate versioned
 *      evidence source, not an implicit assumption."
 *
 * So there is no calibration factor in this file, not even a 1.0 placeholder. A
 * constant sitting at 1.0 with a comment saying "tune later" is exactly the
 * implicit assumption Q28 forbids, and it would be spent by the first person
 * who found it.
 */
import type { GradedSession, LongRunObservation, Provenance } from './input';
import { GRADES_THAT_COUNT_AS_EVIDENCE } from './stimulus';
import type { ExcludedEvidence, ExclusionReason } from './decision-record';

/** What a given observation is being asked to support. */
export type EvidenceUse = 'PACE_ANCHOR' | 'WEEKLY_LOAD' | 'LONG_RUN_DURABILITY';

export interface AdmissibilityVerdict {
  readonly admissible: boolean;
  readonly reason: ExclusionReason | null;
  readonly detail: string;
  /** Q27 · what it is still good for, so an exclusion is never a deletion. */
  readonly stillAdmissibleFor: readonly string[];
}

const ADMIT: AdmissibilityVerdict = {
  admissible: true,
  reason: null,
  detail: 'Admissible.',
  stillAdmissibleFor: [],
};

/**
 * Everything an activity always counts toward, whatever is wrong with its pace.
 * Contract's own list: completed duration, recorded distance, weekly volume,
 * consistency, time on feet, long-run completion, and "the fact that a workout
 * occurred, even when it cannot price pace".
 */
const ALWAYS_GOOD_FOR: readonly string[] = [
  'completed duration',
  'recorded distance',
  'weekly volume',
  'consistency',
  'time on feet',
  'the fact that the workout occurred',
];

/**
 * PACE-ANCHOR admissibility. The strictest of the three.
 *
 * Order matters here only for which reason gets reported; any one flag is
 * disqualifying. Treadmill is checked first because it is the one a reader is
 * most likely to look for.
 */
export function admissibleForPaceAnchor(p: Provenance): AdmissibilityVerdict {
  if (p.treadmill) {
    return {
      admissible: false,
      reason: 'TREADMILL_CANNOT_PRICE_ROAD_PACE',
      detail:
        'Treadmill session. It counts toward volume, load and consistency, but '
        + 'it never moves a road pace anchor.',
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  if (p.paceFlags.length > 0) {
    return {
      admissible: false,
      reason: 'NOT_REPRESENTATIVE_FOR_PACE',
      detail: `Conditions make pace unrepresentative · ${p.paceFlags.join(', ')}.`,
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  // Q29 · truncation is survivable for pace IF the work phases finished first.
  if (p.truncation.truncated && !p.truncation.completeWorkPhasesCaptured) {
    return {
      admissible: false,
      reason: 'TRUNCATED_PORTION_REQUIRED',
      detail:
        'The recording stopped before the prescribed work was complete, so the '
        + 'captured portion cannot price the session.',
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  return ADMIT;
}

/**
 * WEEKLY-LOAD admissibility. Almost everything counts.
 *
 * Q29 · a truncated activity counts its RECORDED distance and duration and
 * nothing is inferred about the missing portion. That is not an exclusion, it
 * is a smaller number, so truncation does not appear here at all. It appears in
 * the volume lever, where "did the week reach 95%" has to decide whether the
 * shortfall is real or unmeasured.
 */
export function admissibleForWeeklyLoad(p: Provenance): AdmissibilityVerdict {
  void p;
  return ADMIT;
}

/**
 * LONG-RUN DURABILITY admissibility.
 *
 * Truncation IS fatal here, and only here, for the reason Q29 gives directly:
 * a truncated activity is "not usable for late-session deterioration" and
 * "absence of a captured late decline is not evidence of durability". The long
 * run's whole evidentiary value is how it finished.
 */
export function admissibleForLongRunDurability(p: Provenance): AdmissibilityVerdict {
  if (p.truncation.truncated) {
    return {
      admissible: false,
      reason: 'TRUNCATED_PORTION_REQUIRED',
      detail:
        'The recording stopped early, so how the run finished was never '
        + 'captured. A missing late decline is not evidence of durability.',
      stillAdmissibleFor: [...ALWAYS_GOOD_FOR, 'recorded long-run distance'],
    };
  }
  return ADMIT;
}

/* ══════════════════════════════════════════════════════════════════════════
 * THRESHOLD-RELEVANCE  ·  Q20
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Whether a session says anything about THRESHOLD specifically.
 *
 * Q20's distance ruling, implemented rather than paraphrased:
 *
 *   · 10K and half   · directly relevant.
 *   · 5K             · informs high-intensity capacity more than threshold.
 *   · marathon       · NOT clean threshold evidence. Durability and execution
 *                      dominate the result, so a marathon time is a statement
 *                      about a different quality wearing threshold's clothes.
 *
 * And the general rule underneath it, from Q27: "A session prescribed at a
 * deliberately different effort supports the lever it actually tests, not the
 * lever its nominal label implies." So the check is on `tests`, not on what the
 * workout was called.
 */
export function relevantToThreshold(s: GradedSession): AdmissibilityVerdict {
  if (s.raceDistance !== null) {
    if (s.raceDistance === 'TEN_K' || s.raceDistance === 'HALF') return ADMIT;
    return {
      admissible: false,
      reason: 'WRONG_LEVER_FOR_THIS_SESSION',
      detail:
        s.raceDistance === 'FIVE_K'
          ? 'A 5K informs high-intensity capacity more than threshold.'
          : 'A marathon result is dominated by durability and execution, so it is not clean threshold evidence.',
      stillAdmissibleFor:
        s.raceDistance === 'FIVE_K'
          ? ['high-intensity capacity', ...ALWAYS_GOOD_FOR]
          : ['durability evidence', 'race execution evidence', ...ALWAYS_GOOD_FOR],
    };
  }

  if (s.tests !== 'THRESHOLD') {
    return {
      admissible: false,
      reason: 'WRONG_LEVER_FOR_THIS_SESSION',
      detail: `The session tested ${s.tests.toLowerCase().replace(/_/g, ' ')}, not threshold.`,
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  return ADMIT;
}

/** Q20/Q21 · only FULL or defensible SUBSTANTIAL count toward a move. */
export function gradeCounts(s: GradedSession): AdmissibilityVerdict {
  if (GRADES_THAT_COUNT_AS_EVIDENCE.has(s.grade)) return ADMIT;
  return {
    admissible: false,
    reason: 'GRADE_DOES_NOT_COUNT',
    detail: `The session graded ${s.grade}, which does not establish the intended stimulus.`,
    stillAdmissibleFor: ALWAYS_GOOD_FOR,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * REPORTING
 * ═══════════════════════════════════════════════════════════════════════ */

/** Turn a rejection into the record's exclusion entry. */
export function excluded(
  activityId: string,
  dateISO: string,
  v: AdmissibilityVerdict,
): ExcludedEvidence {
  return {
    activityId,
    dateISO,
    reason: v.reason ?? 'DATA_UNREADABLE',
    detail: v.detail,
    stillAdmissibleFor: v.stillAdmissibleFor,
  };
}

/**
 * Run a session past every gate a threshold PACE claim has to clear, in order,
 * and report the first failure.
 *
 * One function rather than four call sites checking four things, because the
 * threshold lever is not the only future consumer and two call sites would
 * become two opinions about what "qualifying" means.
 */
export function qualifiesAsThresholdEvidence(s: GradedSession): AdmissibilityVerdict {
  const relevance = relevantToThreshold(s);
  if (!relevance.admissible) return relevance;

  const pace = admissibleForPaceAnchor(s.provenance);
  if (!pace.admissible) return pace;

  const grade = gradeCounts(s);
  if (!grade.admissible) return grade;

  if (!s.workPaceSecPerMi.ok) {
    return {
      admissible: false,
      reason: 'DATA_UNREADABLE',
      detail: 'The session work pace could not be read.',
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  // Q20's distance ruling has a second half the first version of this gate did
  // not enforce. Admitting a 10K or a half is not the same as knowing what it
  // says about THRESHOLD: a race is run over 6.2 or 13.1 miles at a different
  // fraction of threshold, so its finish pace needs an equivalence step before
  // it can be compared to an anchor. That step belongs to the pace owner and
  // arrives on `thresholdEquivalentPaceSecPerMi`. When it could not be made —
  // a finish outside the tabulated range, say — the honest answer is that this
  // session cannot price threshold, not that its finish pace will do (Rule 11).
  if (!s.thresholdEquivalentPaceSecPerMi.ok) {
    return {
      admissible: false,
      reason: 'DATA_UNREADABLE',
      detail:
        'What this session says about threshold pace could not be established. '
        + 'A race finish pace is not a threshold measurement without an equivalence step.',
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  return ADMIT;
}

/** The long run's own combined gate. */
export function qualifiesAsLongRunEvidence(l: LongRunObservation): AdmissibilityVerdict {
  const dur = admissibleForLongRunDurability(l.provenance);
  if (!dur.admissible) return dur;

  if (!l.completedMi.ok) {
    return {
      admissible: false,
      reason: 'DATA_UNREADABLE',
      detail: 'The completed long-run distance could not be read.',
      stillAdmissibleFor: ALWAYS_GOOD_FOR,
    };
  }

  return ADMIT;
}
