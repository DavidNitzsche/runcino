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
    const vdotTestPrompt = shouldPromptVdotTest(state);

    // Today's training brief — voice paragraph for the dashboard.
    // Generated separately from the race brief because it anchors on
    // TODAY (workout + trajectory) rather than on a specific race.
    const dailyBrief = await coach.briefDailyTraining({
      today: isoToday,
      state,
      prescription: today,
      vdot: vdot ? {
        vdot: vdot.vdot,
        tier: vdot.tierLabel,
        freshness: vdot.freshness,
        daysAgo: vdot.source.daysAgo,
        sourceName: vdot.source.name,
      } : null,
      vdotTestPrompt,
    }).catch(() => null);

    return Response.json({
      ok: true,
      today,
      state,
      vdot,
      vdotTestPrompt,
      dailyBrief,              // CoachDecision<string> | null
      coach: { workout, readiness },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
