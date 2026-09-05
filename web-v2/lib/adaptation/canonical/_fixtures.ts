/**
 * lib/adaptation/canonical/_fixtures.ts · FIXTURE BUILDERS AT THE REAL INPUT
 * SHAPE.
 *
 * ── A DELIBERATE DEPARTURE FROM THIS DIRECTORY'S CONVENTION ────────────────
 *
 * `_pace_replay_corpus.test.ts` duplicates its fixture builders per file and
 * says so explicitly, "matching that file's own un-shared, per-file convention
 * — there is no shared fixture-builder module in this codebase to import from".
 *
 * This file breaks that convention on purpose, and the reason is worth stating
 * rather than hiding: the canonical engine has SEVEN test files, and seven
 * copies of a builder for a nine-field `GradedSession` is seven places for the
 * corpus to drift apart. A replay ledger whose fixtures differ subtly from the
 * lever tests' fixtures would produce two different accounts of the same
 * runner, which is exactly the Rule 16 defect these tests exist to catch.
 *
 * The property that matters is preserved: every builder produces a REAL
 * `CanonicalAdaptationInput`, never a mock, and every test runs the REAL
 * `evaluateAdaptation`. Nothing here stubs a lever or fakes a grade.
 *
 * ── THE NUMBERS ARE THE OWNER'S OWN ────────────────────────────────────────
 *
 * Grounded in the documented real athlete so the replay is not an abstraction:
 *
 *   threshold anchor   7:10/mi   · PROGRESSIVE_BASELINE_DOCTRINE.md Q10
 *   weekly volume      47-50 mi  · Q11's "surrounding 47-50-mile weeks"
 *   best recorded week 48.5 mi   · Q9, "never recorded a 50-mile calendar week"
 *   marathon effort    7:52/mi   · Q8's early marathon-specific band
 *   goal               3:00      · Q7, aspirational, never used as capacity
 *   active target      ~3:24     · Q7, the projection-derived execution number
 *   A race             CIM       · early December
 */
import type {
  CanonicalAdaptationInput,
  ComparableThirds,
  GradedSession,
  LongRunObservation,
  Provenance,
  WeekObservation,
} from './input';
import { measured, absent } from './input';
import { demandCeilingForWeek } from './plan-load';
import type { StimulusGrade } from './stimulus';

/** 7:10/mi, the demonstrated threshold anchor. */
export const THRESHOLD_ANCHOR_SEC = 430;
/** 6:52/mi, the 3:00 goal pace. Never used as capacity. */
export const GOAL_PACE_SEC = 412;

export const cleanThirds = (opts?: Partial<ComparableThirds>): ComparableThirds => ({
  middlePaceSecPerMi: measured(430),
  finalPaceSecPerMi: measured(429),
  middleHrBpm: measured(168),
  finalHrBpm: measured(169),
  comparable: true,
  ...opts,
});

/** Final third 6% slower at equal-or-higher HR. Q13's first signal. */
export const decayingThirds = (): ComparableThirds => ({
  middlePaceSecPerMi: measured(430),
  finalPaceSecPerMi: measured(456),
  middleHrBpm: measured(168),
  finalHrBpm: measured(172),
  comparable: true,
});

export const unreadableThirds = (): ComparableThirds => ({
  middlePaceSecPerMi: absent('no split data'),
  finalPaceSecPerMi: absent('no split data'),
  middleHrBpm: absent('no hr'),
  finalHrBpm: absent('no hr'),
  comparable: true,
});

export const prov = (
  id: string,
  dateISO: string,
  opts?: Partial<Provenance>,
): Provenance => ({
  activityId: id,
  dateISO,
  paceFlags: [],
  truncation: { truncated: false, completeWorkPhasesCaptured: true, note: '' },
  treadmill: false,
  ...opts,
});

/**
 * A graded session.
 *
 * `thresholdEquivalentPaceSecPerMi` defaults to the work pace, which is the
 * evidence layer's own rule for a NON-RACE session: for a threshold workout the
 * two quantities are the same number. A RACE fixture should set it explicitly,
 * because a finish pace over 6.2 or 13.1 miles is not a threshold measurement
 * and the default would be the very defect the field exists to make impossible.
 */
export const session = (
  id: string,
  dateISO: string,
  opts?: Partial<GradedSession> & { provOpts?: Partial<Provenance> },
): GradedSession => {
  const workPaceSecPerMi = opts?.workPaceSecPerMi ?? measured(THRESHOLD_ANCHOR_SEC);
  return {
    provenance: prov(id, dateISO, opts?.provOpts),
    tests: 'THRESHOLD',
    grade: 'FULL' as StimulusGrade,
    workPaceSecPerMi,
    thresholdEquivalentPaceSecPerMi: workPaceSecPerMi,
    thirds: cleanThirds(),
    raceDistance: null,
    ...opts,
  };
};

export const week = (
  weekStartISO: string,
  prescribedMi: number,
  completedMi: number,
  opts?: Partial<WeekObservation>,
): WeekObservation => ({
  weekStartISO,
  prescribedMi,
  completedMi: measured(completedMi),
  isCutback: false,
  authoredPlanMode: 'BUILD',
  dataComplete: true,
  ...opts,
});

export const longRun = (
  id: string,
  dateISO: string,
  prescribedMi: number,
  completedMi: number,
  opts?: Partial<LongRunObservation> & { provOpts?: Partial<Provenance> },
): LongRunObservation => ({
  provenance: prov(id, dateISO, opts?.provOpts),
  prescribedMi,
  completedMi: measured(completedMi),
  thirds: cleanThirds(),
  followingKeySessionOk: measured(true),
  ...opts,
});

/**
 * The baseline input · a runner mid-block with nothing yet supporting a change.
 * Every test starts here and adds only the evidence it is testing, so a passing
 * test names exactly what caused the decision.
 */
export const baseInput = (
  opts?: Partial<CanonicalAdaptationInput>,
): CanonicalAdaptationInput => ({
  athleteId: 'athlete-1',
  planVersion: 'plan-v1',
  evidenceVersion: 'ev-1',
  evaluatedAtISO: '2026-09-06',
  boundary: 'WEEKLY_BOUNDARY',
  belief: {
    thresholdPaceSecPerMi: THRESHOLD_ANCHOR_SEC,
    weeklyVolumeMi: 47,
    longRunMi: 16,
    supportingSessionCount: 2,
    oldestSupportingDateISO: '2026-08-10',
  },
  race: {
    raceDateISO: '2026-12-06',
    raceDistance: 'MARATHON',
  },
  goal: {
    goalFinishSeconds: 10_800,
    goalPaceSecPerMi: GOAL_PACE_SEC,
  },
  plan: {
    planVersion: 'plan-v1',
    nextWeekStartISO: '2026-09-07',
    nextWeekPrescribedMi: 48,
    nextWeekLongRunMi: 16,
    nextWeekQualityMinutes: 60,
    nextCutbackBoundaryISO: '2026-10-05',
    nextRaceBoundaryISO: null,
    taperStartISO: '2026-11-15',
    futureThresholdSessionIds: ['w-101', 'w-102', 'w-103'],
    stepsTakenThisCycle: { THRESHOLD_PACE: 0, WEEKLY_VOLUME: 0, LONG_RUN: 0 },
    anchorMovedTodayForLever: {
      THRESHOLD_PACE: false,
      WEEKLY_VOLUME: false,
      LONG_RUN: false,
    },
  },
  qualitySessions: [],
  weeks: [],
  longRuns: [],
  /**
   * ABSENT by default, and that default is a statement rather than a
   * convenience: no demand model is wired anywhere in this app yet, so an
   * absent ceiling is the state every live evaluation is actually in. A
   * fixture that quietly supplied one would make the corpus test a world that
   * does not exist, which is CLAUDE.md Rule 15's failure ("a mechanism the
   * test corpus cannot REACH is untested") pointed the other way round.
   *
   * A test about rule 1 must therefore say so, by passing
   * `athleteCeilingWeeklyDemand: ceilingOf(...)`. That is deliberate friction.
   */
  athleteCeilingWeeklyDemand: absent('no demand model is wired yet'),
  readable: true,
  ...opts,
});

/**
 * A demand ceiling stated as the week that sits exactly at it, priced by the
 * engine's own `demandCeilingForWeek` so both sides of the comparison come from
 * one piece of arithmetic (Rule 16).
 */
export const ceilingOf = (week: {
  weeklyMi: number;
  longRunMi: number;
  qualityMinutes: number;
}) => measured(demandCeilingForWeek(week));

/**
 * The base fixture's own next week, as a ceiling: 48 mi, a 16-mile long run and
 * 60 quality minutes. A week exactly AT this is at its ceiling, so any proposal
 * that raises demand at all pushes past it. This is the "full week" every
 * rule-1 test uses.
 */
export const baseWeekAtCeiling = () =>
  ceilingOf({ weeklyMi: 48, longRunMi: 16, qualityMinutes: 60 });

/**
 * The same week with real headroom: priced as if the athlete could carry 60
 * miles with a 20-mile long run. Nothing any single lever can propose reaches
 * it, so rule 1 never fires and rule 3 is the only thing left arbitrating.
 */
export const baseWeekWithHeadroom = () =>
  ceilingOf({ weeklyMi: 60, longRunMi: 20, qualityMinutes: 90 });

/** Three consecutive weeks completed at or above the 95% bar. */
export const threeGoodWeeks = (): WeekObservation[] => [
  week('2026-08-17', 47, 47.2),
  week('2026-08-24', 48, 48.1),
  week('2026-08-31', 48, 47.9),
];

/** Two long runs completed, both holding together to the finish. */
export const twoGoodLongRuns = (): LongRunObservation[] => [
  longRun('lr-1', '2026-08-23', 16, 16.0),
  longRun('lr-2', '2026-08-30', 16, 16.1),
];

/** Two corroborating threshold sessions, faster than the anchor, controlled. */
export const twoFasterThresholdSessions = (): GradedSession[] => [
  session('s-1', '2026-08-25', { workPaceSecPerMi: measured(425) }),
  session('s-2', '2026-09-01', { workPaceSecPerMi: measured(424) }),
];
