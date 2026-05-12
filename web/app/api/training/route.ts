/**
 * /api/training — server-side bundle of every Coach call the Training
 * page needs.
 *
 * Mirrors /api/overview/route.ts. The Coach engine pulls in node-only
 * modules so every Coach method call runs here on the server; the
 * client renders a single serialized envelope.
 *
 * Coach methods wired:
 *   - prescribeWorkout (TODAY card + structure)
 *   - assessReadiness  (Ready-to-Run signal headline)
 *   - weekDeltas       (THIS WEEK strip)
 *   - trajectory14wk   (PATH TO AFC build curve + Next 4 weeks)
 *   - proofSessions    (PROOF SESSIONS AHEAD list + latest proof)
 *   - raceFitnessPrediction (GOAL TRACKING card — A race only)
 */

import { gatherCoachState, type CoachState } from '../../../lib/coach-state';
import { coach } from '../../../coach/coach';
import type {
  CoachDecision,
  Trajectory14wk,
  ProofSessionsReport,
  WeekDeltasReport,
  RaceFitnessPrediction,
} from '../../../coach/types';
import type {
  WorkoutPrescription,
  ReadinessAssessment,
  RecentAdjustmentsReport,
  AdjustedPlan,
  PathToRaceResult,
  NextPushesReport,
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';
import { narrativeLine, type NarrativeLine } from '../../../coach/coach-narrative';

// ─────────────────────────────────────────────────────────────────────
// HR zones rollup — re-homed from /health per Research/00a §TID
// (training-design metric, not a readiness signal).
// TODO: wire to a `lib/strava-hr-zones.ts` rollup that aggregates
// per-activity HR streams into zone minutes per day. The shape mirrors
// /api/health/route.ts so the rebuilt /health page can pull from a
// single source once Stage 7 lands.
// ─────────────────────────────────────────────────────────────────────

export interface TrainingApiZoneDay {
  dateISO: string;
  dayLabel: string;
  rest: boolean;
  z1Min: number;
  z2Min: number;
  z3Min: number;
  z4Min: number;
  z5Min: number;
}

export interface TrainingApiHrZoneTime {
  z1Min: number;
  z2Min: number;
  z3Min: number;
  z4Min: number;
  z5Min: number;
  easyShare: number;
  days: TrainingApiZoneDay[];
  /** False until per-activity HR-stream rollup (lib/strava-hr-zones.ts)
   *  lands. When false the per-day mix is empty and the UI renders
   *  AWAITING STRAVA HR. easyShare is still real when intensity data
   *  is available (it derives from pace, not HR). */
  isAvailable: boolean;
}

interface TrainingApiOk {
  ok: true;
  today: string;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  proofSessions: CoachDecision<ProofSessionsReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  hrZones: TrainingApiHrZoneTime;
  /** Per-signal freshness map — drives the "Coach is watching" UI
   *  strip. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
  recentAdjustments: CoachDecision<RecentAdjustmentsReport>;
  adjustedToday: CoachDecision<AdjustedPlan>;
  /** Wave G · PATH TO RACE decision — null when no A-race with goal. */
  pathToRace: CoachDecision<PathToRaceResult> | null;
  /** Wave G · NEXT PUSH report. */
  nextPushes: CoachDecision<NextPushesReport>;
  /** Wave J · narrative line. Null when no priority signal fires. */
  narrative: NarrativeLine | null;
}

interface TrainingApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);

    const allRaces = await listRacesDB().catch(() => []);
    const upcoming = allRaces
      .filter((r) => r.meta.date >= today)
      .sort((a, b) => a.meta.date.localeCompare(b.meta.date));
    const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;

    const [
      workout,
      readiness,
      weekDeltas,
      trajectory,
      proofSessions,
      recentAdjustments,
    ] = await Promise.all([
      coach.prescribeWorkout({ today, state }),
      coach.assessReadiness({ today, state }),
      coach.weekDeltas({ today, state }),
      coach.trajectory14wk({ today, state }),
      coach.proofSessions({ today, state }),
      coach.recentAdjustments({ today, state }),
    ]);

    const missedRunsLast7d = recentAdjustments.answer.items.filter(
      (i) => i.dateISO !== today,
    ).length;
    const acwrVal =
      state.volume.weeklyAvg8w > 0
        ? state.volume.last7Mi / state.volume.weeklyAvg8w
        : 0;
    const adjustedToday = await coach.adjustForReality({
      today,
      scheduledWorkout: workout.answer,
      signals: {
        daysSinceLastRun:
          state.recovery.daysSinceLastRun >= 0 ? state.recovery.daysSinceLastRun : 0,
        missedRunsLast7d,
        acwr: acwrVal,
        checkinPoorDaysLast7d: state.checkin?.poorDaysCount,
      },
    });

    const raceFitnessA = nextA
      ? await callRacePrediction(today, state, nextA)
      : null;

    const hrZones = buildHrZones(today, state);

    const freshness = await gatherFreshness({ state });

    // Wave G · alive-coach surfaces (server-side). Same engine the
    // /api/overview route calls — pageviews on /training reuse them.
    const stateNextA = state.races.nextA;
    const pathToRace = (stateNextA && stateNextA.goalFinishS)
      ? await coach.pathToRace({
          today,
          state,
          raceName: stateNextA.name,
          raceDateISO: stateNextA.date,
          raceDistanceMi: stateNextA.distanceMi,
          goalTimeS: stateNextA.goalFinishS,
        })
      : null;
    const nextPushes = await coach.nextPushes({ today, state });

    const adjAns = adjustedToday.answer;
    const narrative = await narrativeLine(state, today, {
      adjustment: adjAns.changed
        ? {
            changed: true,
            adjustedFor: adjAns.adjustedFor,
            newLabel: adjAns.workout.label,
            direction: 'softening',
          }
        : undefined,
    });

    const body: TrainingApiOk = {
      ok: true,
      today,
      state,
      workout,
      readiness,
      weekDeltas,
      trajectory,
      proofSessions,
      raceFitnessA,
      hrZones,
      freshness,
      recentAdjustments,
      adjustedToday,
      pathToRace,
      nextPushes,
      narrative,
    };
    return Response.json(body);
  } catch (e) {
    const err: TrainingApiErr = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
    return Response.json(err, { status: 200 });
  }
}

async function callRacePrediction(
  today: string,
  state: Awaited<ReturnType<typeof gatherCoachState>>,
  race: Awaited<ReturnType<typeof listRacesDB>>[number],
): Promise<CoachDecision<RaceFitnessPrediction> | null> {
  const goalS = parseGoalHMS(race.meta.goalDisplay);
  if (goalS == null) return null;
  return coach.raceFitnessPrediction({
    today,
    state,
    raceName: race.meta.name,
    raceDateISO: race.meta.date,
    raceDistanceMi: race.meta.distanceMi,
    goalTimeS: goalS,
  });
}

function parseGoalHMS(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

// ─────────────────────────────────────────────────────────────────────
// HR-zones rollup builder — gated on real Strava HR-stream rollup data.
// Until lib/strava-hr-zones.ts lands (per-activity HR streams parsed
// into per-day zone minutes), we return isAvailable:false and the UI
// surfaces "AWAITING STRAVA HR." easyShare IS real when intensity data
// is present (it derives from pace, not HR) so we surface that even
// in the not-yet-available state — but with zero minute totals to make
// it obvious to the UI that the per-day mix is unwired.
// TODO (Wave J/H follow-up): wire to lib/strava-hr-zones.ts when it
// lands.
// ─────────────────────────────────────────────────────────────────────

function buildHrZones(_today: string, state: CoachState): TrainingApiHrZoneTime {
  void _today;
  const easyShare = state.intensity.easyShare14d > 0 ? state.intensity.easyShare14d : 0;
  return {
    z1Min: 0,
    z2Min: 0,
    z3Min: 0,
    z4Min: 0,
    z5Min: 0,
    easyShare,
    days: [],
    isAvailable: false,
  };
}
