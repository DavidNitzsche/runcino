/**
 * `computeCoachTodayPayload()` — the full /api/coach/today response,
 * extracted from the route handler so it can be reused by:
 *   - the route's read path (cache hit → return cached, miss → compute)
 *   - the cache regenerator (Strava webhook + midnight cron)
 *
 * The payload includes everything the dashboard renders: today's
 * prescription, week shape, 30-day outlook, VDOT snapshot, daily
 * brief (LLM call when key is set), readiness verdict, and the
 * raw state for client-side derivations. Computing it costs ~150ms
 * for the deterministic parts plus 2-5s for the LLM brief — which
 * is exactly why we cache it.
 */

import { gatherCoachState } from './coach-state';
import { coachDaily } from './coach-engine';
import { coach } from '../coach/coach';
import { vdotSnapshot, shouldPromptVdotTest } from './vdot';
import { getRunnerProfile, ageFromBirthYear } from './runner-profile-store';

export interface CoachTodayPayloadShape {
  ok: true;
  today: ReturnType<typeof coachDaily>;
  state: Awaited<ReturnType<typeof gatherCoachState>>;
  vdot: ReturnType<typeof vdotSnapshot>;
  vdotTestPrompt: boolean;
  dailyBrief: Awaited<ReturnType<typeof coach.briefDailyTraining>> | null;
  coach: {
    workout: Awaited<ReturnType<typeof coach.prescribeWorkout>>;
    readiness: Awaited<ReturnType<typeof coach.assessReadiness>>;
  };
}

export async function computeCoachTodayPayload(): Promise<CoachTodayPayloadShape> {
  const state = await gatherCoachState();
  const today = coachDaily(state);
  const isoToday = state.now.slice(0, 10);
  const [workout, readiness] = await Promise.all([
    coach.prescribeWorkout({ today: isoToday, state }),
    coach.assessReadiness({ today: isoToday, state }),
  ]);
  const vdot = vdotSnapshot(state);
  const vdotTestPrompt = shouldPromptVdotTest(state);

  const profile = await getRunnerProfile().catch(() => null);
  const runnerProfileForBrief = profile ? {
    age: ageFromBirthYear(profile.birthYear),
    sex: profile.sex,
    hrmaxBpm: profile.hrmaxBpm,
    rhrBpm: profile.rhrBpm,
  } : undefined;

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
    runnerProfile: runnerProfileForBrief,
  }).catch(() => null);

  return {
    ok: true,
    today,
    state,
    vdot,
    vdotTestPrompt,
    dailyBrief,
    coach: { workout, readiness },
  };
}

/** The "freshness key" for the cache. Combines the LA-calendar date
 *  + the latest Strava activity ID. Cache hits when both match;
 *  miss → regenerate. The activity ID auto-invalidates whenever a
 *  new run lands. */
export function cacheKey(payload: CoachTodayPayloadShape): { date: string; latestActivityId: number | null } {
  const date = payload.state.now.slice(0, 10);
  // Walk recent races (which include Strava activity IDs) to find
  // the most recent activity ID we know about. Could also walk the
  // full activity cache but that requires a separate read; the
  // "recent races + recovery.yesterday + recovery.today" set covers
  // the freshness signal we need.
  const ids: number[] = [];
  for (const r of payload.state.races.recent) {
    if (r.activityId != null) ids.push(r.activityId);
  }
  if (payload.state.recovery.yesterday?.activityId != null) ids.push(payload.state.recovery.yesterday.activityId);
  if (payload.state.recovery.today?.activityId != null) ids.push(payload.state.recovery.today.activityId);
  const latestActivityId = ids.length > 0 ? Math.max(...ids) : null;
  return { date, latestActivityId };
}
