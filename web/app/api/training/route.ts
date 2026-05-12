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
} from '../../../coach/coach';
import { listRacesDB } from '../../../lib/race-store';

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

    const hrZones = buildHrZones(today, state);

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
// HR-zones rollup builder — synthesized per-day mix until per-activity
// HR stream parsing lands (lib/strava-hr-zones.ts). easyShare comes
// from coach-state.intensity which IS real when Strava activities load;
// only the per-day mix is mock.
// ─────────────────────────────────────────────────────────────────────

function buildHrZones(today: string, state: CoachState): TrainingApiHrZoneTime {
  const easyShare = state.intensity.easyShare14d > 0 ? state.intensity.easyShare14d : 0.92;
  const daysMix: TrainingApiZoneDay[] = [];
  const offsetLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const baseDate = new Date(today + 'T12:00:00Z');
  const pattern = [
    { z1: 55, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 62, z4: 18, z5: 0, rest: false },
    { z1: 48, z4: 0, z5: 0, rest: false },
    { z1: 70, z4: 0, z5: 15, rest: false },
    { z1: 42, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 52, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 38, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 40, z4: 0, z5: 0, rest: false },
    { z1: 0, z4: 0, z5: 0, rest: true },
    { z1: 35, z4: 0, z5: 0, rest: false },
  ];
  for (let i = 0; i < 14; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + (i - 12));
    const dow = d.getUTCDay();
    daysMix.push({
      dateISO: d.toISOString().slice(0, 10),
      dayLabel: offsetLabels[(dow + 6) % 7],
      rest: pattern[i].rest,
      z1Min: pattern[i].z1,
      z2Min: 0,
      z3Min: 0,
      z4Min: pattern[i].z4,
      z5Min: pattern[i].z5,
    });
  }
  return {
    z1Min: 14 * 60,
    z2Min: 0,
    z3Min: 0,
    z4Min: 42,
    z5Min: 28,
    easyShare,
    days: daysMix,
  };
}
