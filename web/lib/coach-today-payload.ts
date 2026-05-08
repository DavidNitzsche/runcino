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
import { getRunnerProfile, ageFromBirthDate } from './runner-profile-store';

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
    age: ageFromBirthDate(profile.birthDate),
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

/** Removed: the cache key is now derived in coach-today-cache.ts
 *  via `currentCacheKey()` (single source for both read + write).
 *  The previous version walked state.races.recent + recovery to
 *  find the latest activity ID, which only saw activities flagged
 *  as races or running yesterday/today — eternal cache miss for
 *  every other run. The new path SELECTs from strava_activities
 *  directly, matching what the read uses to look up the cache.
 *  Keeping the function declaration as a noop that returns the
 *  date alone, in case any future caller wants the date piece. */
export function cacheKey(payload: CoachTodayPayloadShape): { date: string; latestActivityId: null } {
  return { date: payload.state.now.slice(0, 10), latestActivityId: null };
}
