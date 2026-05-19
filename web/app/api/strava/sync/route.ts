/**
 * /api/strava/sync — match Strava activities to saved races AND to
 * the active training plan, then push writeback (rename) + auto-assign
 * shoes for each plan match.
 *
 * GET / POST — both refresh the activity cache (if stale), run the
 * race matcher across every saved race in Postgres, then run the
 * plan-match pass:
 *   1. for each (plan workout, same-day activity) pair:
 *      a. rename the Strava activity to the planned title ("Easy ·
 *         Apr 14") via PUT /activities/{id} when the name doesn't
 *         already encode our label.
 *      b. when shoe_id is still NULL, pick the user's preferred shoe
 *         for the planned run-type and stamp it on the activity row
 *         + increment the shoe's mileage.
 *
 * Returns { updated: string[], fetchedAt, plan: { renamed, shoed,
 * errors } } so the Overview page can show a fresh-state toast.
 *
 * Manual entries (actualResult.source === 'manual') are sticky and
 * never overwritten by sync. Only Strava-sourced rows refresh, plus
 * any race that has no actualResult yet. Shoes the user has manually
 * assigned (shoe_id IS NOT NULL) are never overwritten.
 */

import {
  fetchActivityDetail,
  activityToResult,
  type StravaActivity,
} from '../../../../lib/strava';
import {
  getCachedActivities,
  getCacheFetchedAt,
  getCachedDetail,
  setCachedDetail,
  getActivitySyncMeta,
  markWriteback,
  autoAssignShoe,
} from '../../../../lib/strava-cache';
import type { NormalizedActivity } from '../activities/route-shared';
import { listRacesDB, setActualResultDB } from '../../../../lib/race-store';
import { ensureSeed } from '../../../../lib/seed-server';
import type { ActualResult } from '../../../../lib/storage-types';
import { getCurrentPlan } from '../../../../coach/plan-lifecycle';
import { buildPlanMatches, runTypeForWorkout, type PlanMatch } from '../../../../lib/plan-match';
import {
  plannedActivityTitle,
  renameStravaActivity,
  nameAlreadyMatchesPlan,
} from '../../../../lib/strava-writeback';
import { listShoes, recommendShoe } from '../../../../lib/shoe-store';

interface PlanSyncReport {
  renamed: Array<{ id: number; title: string }>;
  shoed: Array<{ id: number; shoeId: number; runType: string }>;
  errors: string[];
}

async function runSync(): Promise<{
  updated: string[];
  fetchedAt: string | null;
  plan?: PlanSyncReport;
  error?: string;
}> {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return { updated: [], fetchedAt: null, error: 'STRAVA_REFRESH_TOKEN not set — visit /api/strava/connect to capture it.' };
  }

  await ensureSeed();
  const races = await listRacesDB();

  // Filter to candidates: races without a result OR previously sourced
  // from Strava. Manual entries stay frozen.
  const candidates = races.filter(r => r.actualResult == null || r.actualResult.source === 'strava');

  // Pull the cached activity list (refreshes from Strava if stale).
  // Used by both the race matcher AND the plan-match pass below.
  let activities: NormalizedActivity[];
  try {
    ({ activities } = await getCachedActivities());
  } catch (e) {
    return { updated: [], fetchedAt: null, error: String(e) };
  }

  // Run the plan-match pass regardless of whether any races exist —
  // every Strava activity that lands on a planned workout day needs
  // its writeback + shoe assignment, race or not.
  const plan = await runPlanMatchPass(activities);

  const updated: string[] = [];
  if (candidates.length === 0) {
    const at = await getCacheFetchedAt();
    return { updated, fetchedAt: at ? new Date(at).toISOString() : null, plan };
  }
  for (const race of candidates) {
    const match = findMatchByDate(activities, race.meta.date, race.meta.distanceMi);
    if (!match) continue;

    // Prefer cached detail; otherwise fetch (which writes through).
    let detail: StravaActivity | null = null;
    const cachedDetail = await getCachedDetail(match.id);
    if (cachedDetail?.detail) {
      detail = cachedDetail.detail as StravaActivity;
    } else {
      try {
        detail = await fetchActivityDetail(match.id);
        await setCachedDetail(match.id, detail);
      } catch {
        // Fall back to summary if detail fetch fails.
      }
    }

    const richActivity: StravaActivity = detail ?? toStravaShape(match);
    const r = activityToResult(richActivity, race.meta.distanceMi);

    const result: ActualResult = {
      finishS: r.finishS,
      finishDisplay: r.finishDisplay,
      paceSPerMi: r.paceSPerMi,
      paceDisplay: r.paceDisplay,
      recordedAt: new Date().toISOString(),
      source: 'strava',
      stravaActivityId: r.activityId,
      avgHr: r.avgHr,
      maxHr: r.maxHr,
      avgCadence: r.avgCadence,
      totalGainFt: r.totalGainFt,
      activityName: r.name,
      description: r.description,
      sufferScore: r.sufferScore,
      kudosCount: r.kudosCount,
      achievementCount: r.achievementCount,
      workoutType: r.workoutType,
      miles: r.miles,
      bestEfforts: r.bestEfforts,
      summaryPolyline: r.summaryPolyline,
      isPR: (r.bestEfforts?.some(b => b.isPR) ?? false) || (race.actualResult?.isPR ?? false),
      notes: race.actualResult?.notes,                  // user-entered notes are preserved
    };
    await setActualResultDB(race.slug, result);
    updated.push(race.slug);
  }

  const at = await getCacheFetchedAt();
  return { updated, fetchedAt: at ? new Date(at).toISOString() : null, plan };
}

/** Iterate every (plan workout, same-day activity) match and:
 *    - rename the activity on Strava to encode the planned title
 *    - assign the user's preferred shoe (when none is set)
 *  Returns a per-activity tally so callers can surface what happened.
 *  Soft-fails: a failed rename / shoe assign is logged into errors[]
 *  and the loop continues — partial progress is better than nothing. */
async function runPlanMatchPass(activities: NormalizedActivity[]): Promise<PlanSyncReport> {
  const report: PlanSyncReport = { renamed: [], shoed: [], errors: [] };

  // Load the active plan + the shoe rotation up front. Either may be
  // absent (no plan authored yet / no shoes seeded) — that just means
  // the loop has nothing to do.
  const planResult = await getCurrentPlan('me').catch((e) => {
    report.errors.push(`getCurrentPlan: ${e instanceof Error ? e.message : String(e)}`);
    return { plan: null };
  });
  const plan = planResult.plan;
  if (!plan) return report;

  const shoes = await listShoes().catch((e) => {
    report.errors.push(`listShoes: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  });

  const matches: PlanMatch[] = buildPlanMatches(plan, activities);
  for (const m of matches) {
    // ── Writeback ───────────────────────────────────────────────
    const title = plannedActivityTitle(m.workout);
    if (!nameAlreadyMatchesPlan(m.activity.name, title)) {
      const result = await renameStravaActivity(m.activity.id, m.activity.name, title);
      if (result.ok && result.changed) {
        try {
          await markWriteback(m.activity.id, title);
          report.renamed.push({ id: m.activity.id, title });
        } catch (e) {
          report.errors.push(`markWriteback ${m.activity.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else if (!result.ok && result.error) {
        report.errors.push(`rename ${m.activity.id}: ${result.error}`);
      }
    }

    // ── Shoe auto-assign ────────────────────────────────────────
    // Only assign when the user hasn't picked a shoe yet (shoe_id is
    // NULL). Manual picks are sticky — see `users.strava_writeback`
    // semantics: writeback can re-touch the name, but a user's
    // intentional shoe choice is never overwritten.
    const meta = await getActivitySyncMeta(m.activity.id).catch(() => null);
    if (meta && meta.shoe_id == null && shoes.length > 0) {
      const runType = runTypeForWorkout(m.workout.type);
      const shoe = recommendShoe(shoes, runType);
      if (shoe) {
        try {
          await autoAssignShoe(m.activity.id, shoe.id, m.activity.distanceMi);
          report.shoed.push({ id: m.activity.id, shoeId: shoe.id, runType });
        } catch (e) {
          report.errors.push(`autoAssignShoe ${m.activity.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  return report;
}

/** Find the cached normalized activity that best matches a saved race
 *  (same calendar day, run type, distance within ±15%). The matcher
 *  in lib/strava.ts works on the raw Strava shape; we reimplement the
 *  same rules here against our normalized rows. */
function findMatchByDate(activities: NormalizedActivity[], dateISO: string, distMi: number): NormalizedActivity | null {
  const datePrefix = dateISO.slice(0, 10);
  const sameDay = activities.filter(a => a.date === datePrefix && (a.type === 'Run' || a.sportType === 'Run' || a.sportType === 'TrailRun'));
  if (sameDay.length === 0) return null;
  if (distMi > 0) {
    const within = sameDay.filter(a => Math.abs(a.distanceMi - distMi) / Math.max(distMi, 0.1) < 0.15);
    if (within.length > 0) return within.sort((a, b) => b.distanceMi - a.distanceMi)[0];
  }
  return sameDay.sort((a, b) => b.distanceMi - a.distanceMi)[0];
}

/** Reconstruct the minimum StravaActivity shape activityToResult()
 *  expects when we don't have the full detail cached — miles +
 *  best_efforts will be missing, which is fine; they fill in after
 *  the next detail fetch. */
function toStravaShape(n: NormalizedActivity): StravaActivity {
  return {
    id: n.id,
    name: n.name,
    distance: n.distanceMi * 1609.344,
    moving_time: n.movingTimeS,
    elapsed_time: n.elapsedTimeS,
    total_elevation_gain: n.elevGainFt / 3.28084,
    type: n.type,
    sport_type: n.sportType ?? undefined,
    workout_type: n.workoutType,
    start_date: n.startLocal,
    start_date_local: n.startLocal,
    average_heartrate: n.avgHr ?? undefined,
    max_heartrate: n.maxHr ?? undefined,
    average_cadence: n.avgCadence ?? undefined,
    map: n.summaryPolyline ? { summary_polyline: n.summaryPolyline } : undefined,
  };
}

// Both methods do the same thing — POST kept for legacy callers (the
// old client used to send a races[] body), GET added so the Overview
// page can trigger a sync via a plain background fetch.
export async function POST() {
  // Body is ignored — server is the source of truth for which races exist.
  const result = await runSync();
  return Response.json(result, { status: 200 });
}
export async function GET() {
  const result = await runSync();
  return Response.json(result, { status: 200 });
}
