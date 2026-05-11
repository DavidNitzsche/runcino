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

import { gatherCoachState } from '../../../lib/coach-state';
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
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';

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
    ] = await Promise.all([
      coach.prescribeWorkout({ today, state }),
      coach.assessReadiness({ today, state }),
      coach.weekDeltas({ today, state }),
      coach.trajectory14wk({ today, state }),
      coach.proofSessions({ today, state }),
    ]);

    const raceFitnessA = nextA
      ? await callRacePrediction(today, state, nextA)
      : null;

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
