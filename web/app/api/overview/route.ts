/**
 * /api/overview — server-side bundle of every Coach call the Overview
 * page needs.
 *
 * The Overview page is a client component (because it owns modal /
 * hover state), but the Coach engine pulls in node-only modules
 * (Anthropic SDK, fs reads of research docs). So every Coach method
 * call runs here on the server, returning a single serialized envelope
 * the client uses to render every coach-tinted surface.
 *
 * Mirrors the shape of /api/coach/today but adds the Stage-7 stubs:
 * bodySystems / trajectory14wk / weekDeltas / raceFitnessPrediction
 * for the next A and next B race.
 */

import { gatherCoachState } from '../../../lib/coach-state';
import { coach } from '../../../coach/coach';
import type {
  CoachDecision,
  BodySystemsReport,
  Trajectory14wk,
  RaceFitnessPrediction,
  WeekDeltasReport,
} from '../../../coach/types';
import type {
  ReadinessAssessment,
  WorkoutPrescription,
  RecentAdjustmentsReport,
  AdjustedPlan,
  PathToRaceResult,
  NextPushesReport,
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';
import { narrativeLine, type NarrativeLine } from '../../../coach/coach-narrative';

interface OverviewApiOk {
  ok: true;
  today: string;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  workout: CoachDecision<WorkoutPrescription>;
  readiness: CoachDecision<ReadinessAssessment>;
  bodySystems: CoachDecision<BodySystemsReport>;
  trajectory: CoachDecision<Trajectory14wk>;
  weekDeltas: CoachDecision<WeekDeltasReport>;
  raceFitnessA: CoachDecision<RaceFitnessPrediction> | null;
  raceFitnessB: CoachDecision<RaceFitnessPrediction> | null;
  /** Per-signal freshness map — drives the "Coach is watching" UI
   *  strip. Six signals: strava / checkin / vdotAnchor / profile /
   *  raceCal / healthkit. See lib/freshness.ts for budgets. */
  freshness: FreshnessMap;
  /** 7-day plan-adjustments rollup — drives the PLAN ADAPTED card. */
  recentAdjustments: CoachDecision<RecentAdjustmentsReport>;
  /** AdjustForReality applied to today's prescription. Drives the
   *  COACH ADJUSTED pin + "why" line on the TodayCard. */
  adjustedToday: CoachDecision<AdjustedPlan>;
  /** Wave G · PATH TO RACE — null when no A-race with goal time. */
  pathToRace: CoachDecision<PathToRaceResult> | null;
  /** Wave G · NEXT PUSH — always present, may have 0 pushes. */
  nextPushes: CoachDecision<NextPushesReport>;
  /** Wave J · one-sentence narrative line. Null when no signal fires. */
  narrative: NarrativeLine | null;
}

interface OverviewApiErr {
  ok: false;
  error: string;
}

export async function GET(): Promise<Response> {
  try {
    const state = await gatherCoachState();
    const today = state.now.slice(0, 10);

    // The Coach methods that need a goal time pull from the saved
    // races table directly; gatherCoachState already exposes nextA
    // and nextAny but only as a NextRace shape with goalFinishS.
    const allRaces = await listRacesDB().catch(() => []);
    const upcoming = allRaces
      .filter((r) => r.meta.date >= today)
      .sort((a, b) => a.meta.date.localeCompare(b.meta.date));
    const nextA = upcoming.find((r) => (r.meta.priority ?? 'A') === 'A') ?? null;
    const nextB = upcoming.find((r) => r.meta.priority === 'B') ?? null;

    const [
      workout,
      readiness,
      bodySystems,
      trajectory,
      weekDeltas,
      recentAdjustments,
    ] = await Promise.all([
      coach.prescribeWorkout({ today, state }),
      coach.assessReadiness({ today, state }),
      coach.bodySystems({ today, state }),
      coach.trajectory14wk({ today, state }),
      coach.weekDeltas({ today, state }),
      coach.recentAdjustments({ today, state }),
    ]);

    // Today's adjustForReality consumes the live state.checkin
    // aggregate so the engine can fold qualitative signals into the
    // decision (Research/00b §Decision Matrix).
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
    const raceFitnessB = nextB
      ? await callRacePrediction(today, state, nextB)
      : null;

    const freshness = await gatherFreshness({ state });

    // Wave G · alive-coach surfaces. Run server-side so the coach
    // module never enters the client bundle.
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

    // Wave J · narrative line. Pull adjustment context from
    // adjustedToday so the "Coach adjusted today" priority can fire.
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

    const body: OverviewApiOk = {
      ok: true,
      today,
      state,
      workout,
      readiness,
      bodySystems,
      trajectory,
      weekDeltas,
      raceFitnessA,
      raceFitnessB,
      freshness,
      recentAdjustments,
      adjustedToday,
      pathToRace,
      nextPushes,
      narrative,
    };
    return Response.json(body);
  } catch (e) {
    const err: OverviewApiErr = {
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
