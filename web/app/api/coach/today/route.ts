/**
 * /api/coach/today — daily prescription endpoint.
 *
 * Stage 3 wired: routes through `coach.prescribeWorkout` + `coach.
 * assessReadiness`. Both are deterministic — no Claude call, no API
 * key needed. The legacy `today` + `state` envelope is preserved
 * (iOS reads them); a `coach` sub-object carries the workout
 * prescription, readiness, and citations.
 *
 * GET → {
 *   ok: true,
 *   today: CoachToday,                  // legacy shape from coachDaily()
 *   state: CoachState,                  // raw aggregated state
 *   coach: {
 *     workout: CoachDecision<WorkoutPrescription>,
 *     readiness: CoachDecision<ReadinessAssessment>,
 *   }
 * }
 */
import { gatherCoachState } from '../../../../lib/coach-state';
import { coachDaily } from '../../../../lib/coach-engine';
import { coach } from '../../../../coach/coach';
import { vdotSnapshot, shouldPromptVdotTest } from '../../../../lib/vdot';

export async function GET() {
  try {
    const state = await gatherCoachState();
    const today = coachDaily(state);
    const isoToday = state.now.slice(0, 10);
    const [workout, readiness] = await Promise.all([
      coach.prescribeWorkout({ today: isoToday, state }),
      coach.assessReadiness({ today: isoToday, state }),
    ]);
    const vdot = vdotSnapshot(state);
    // Surface the test-prompt gate so the dashboard tile can flip
    // into a "Run a 5K to anchor your fitness" state when there's no
    // recent race, or the race is stale/expired.
    const vdotTestPrompt = shouldPromptVdotTest(state);
    return Response.json({
      ok: true,
      today,
      state,
      vdot,                    // null when no usable recent race
      vdotTestPrompt,          // true → tile renders the no-data / test prompt panel
      coach: { workout, readiness },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
