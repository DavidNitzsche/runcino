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
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';
import { gatherFreshness } from '../../../lib/freshness';
import type { FreshnessMap } from '../../../lib/freshness-types';

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
    ] = await Promise.all([
      coach.prescribeWorkout({ today, state }),
      coach.assessReadiness({ today, state }),
      coach.bodySystems({ today, state }),
      coach.trajectory14wk({ today, state }),
      coach.weekDeltas({ today, state }),
    ]);

    const raceFitnessA = nextA
      ? await callRacePrediction(today, state, nextA)
      : null;
    const raceFitnessB = nextB
      ? await callRacePrediction(today, state, nextB)
      : null;

    const freshness = await gatherFreshness({ state });

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
