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
import { resolveAthleteWeeklyDemandCeiling } from './demand-ceiling';
import { unknownWeekDemandContext } from '@/lib/plan/adjudication/weekly-demand';
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
  /**
   * The base fixture is a runner MID-BLOCK in a quality phase, with no thesis
   * limiter named and Safety normal.
   *
   * QUALITY rather than BASE deliberately: BASE and MAINTENANCE both resolve to
   * the phase-neutral order, so a fixture on either of them would leave every
   * test unable to tell "phase-aware ordering worked" from "the order never
   * changed". QUALITY's order differs from the phase-neutral one (threshold
   * rises above the long run), so the default exercises the resolver rather
   * than agreeing with the constant it replaced (Rule 15).
   */
  phaseContext: {
    phase: 'QUALITY',
    limiter: 'UNKNOWN',
    safety: 'NORMAL',
    phaseSource: 'fixture',
  },
  qualitySessions: [],
  weeks: [],
  longRuns: [],
  /**
   * ABSENT by default, and that default is a statement rather than a
   * convenience.
   *
   * A ceiling now exists on a live evaluation (`canonical-shadow/demand-input
   * .ts` builds one from the demand model), but it exists only when the runner
   * has ABSORBED WEEKS TO PRICE ONE FROM. A new runner, a rebuilt plan with no
   * completed week yet, and an unreadable history all still land here. So the
   * absent posture is a real production state and the default keeps testing it.
   *
   * A test about rule 1 must therefore say so, by passing
   * `athleteCeilingWeeklyDemand: ceilingOf(...)`. That is deliberate friction.
   */
  athleteCeilingWeeklyDemand: absent('no absorbed week has been supplied to price a ceiling from'),
  readable: true,
  ...opts,
});

/**
 * A demand ceiling stated as the week that sits exactly at it.
 *
 * Built by running the REAL resolver over a demonstrated week of exactly those
 * numbers, rather than by hand. That matters for two reasons and both are
 * CLAUDE.md rules:
 *
 *   · Rule 15 — a fixture that hand-built the ceiling object would leave
 *     `resolveAthleteWeeklyDemandCeiling` unreached by every test that uses a
 *     ceiling, which is most of them.
 *   · Rule 16 — the number comes out of the demand model's own pricing door,
 *     so it cannot drift from the number arbitration prices the week with.
 *
 * The context is unknown, so the model prices on BASE_ONLY, and on BASE_ONLY
 * this is identically `demandCeilingForWeek(week)` — which is what every
 * existing expectation in this suite was written against.
 */
export const ceilingOf = (week: {
  weeklyMi: number;
  longRunMi: number;
  qualityMinutes: number;
}) => {
  const resolved = resolveAthleteWeeklyDemandCeiling({
    context: unknownWeekDemandContext('2026-09-07'),
    week: { ...week, thresholdAnchorDeltaSecPerMi: 0 },
    demonstratedWeeks: [{
      weekStartISO: '2026-08-31',
      weeklyMi: week.weeklyMi,
      longRunMi: week.longRunMi,
      qualityMinutes: week.qualityMinutes,
      absorbed: true,
      context: null,
    }],
  });
  if (!resolved.ok) {
    // A fixture that silently produced an absent ceiling would make every
    // rule-1 test pass vacuously, which is the worst failure available here.
    const why = resolved.why.kind === 'READ' ? 'no reason recorded' : resolved.why.what;
    throw new Error(`ceilingOf: the demand model refused to price a ceiling: ${why}`);
  }
  return resolved;
};

/**
 * The same, but as a RAW index on the model's own scale, for the handful of
 * assertions that want to name a number rather than a week.
 *
 * Kept as one expression so a test can say "the ceiling one demand-step
 * higher" without hand-rolling a second pricing path.
 */
export const ceilingAt = (index: number) => ceilingOf({
  weeklyMi: index, longRunMi: 0, qualityMinutes: 0,
});

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
