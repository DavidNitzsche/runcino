/**
 * /api/strava/sync, match Strava activities to saved races and write
 * actualResult into Postgres.
 *
 * GET / POST, both refresh the activity cache (if stale) and run the
 * race matcher across every saved race in Postgres. Returns
 * { updated: string[], fetchedAt } so the client can decide whether
 * to re-fetch /api/races.
 *
 * Manual entries (actualResult.source === 'manual') are sticky and
 * never overwritten by sync. Only Strava-sourced rows refresh, plus
 * any race that has no actualResult yet.
 */

import {
  fetchActivityDetail,
  activityToResult,
  type StravaActivity,
} from '../../../../lib/strava';
import { getCachedActivities, getCacheFetchedAt, getCachedDetail, setCachedDetail } from '../../../../lib/strava-cache';
import type { NormalizedActivity } from '../activities/route-shared';
import { listRacesDB, setActualResultDB } from '../../../../lib/race-store';
import { ensureSeed } from '../../../../lib/seed-server';
import type { ActualResult } from '../../../../lib/storage-types';

async function runSync(): Promise<{ updated: string[]; fetchedAt: string | null; error?: string }> {
  if (!process.env.STRAVA_REFRESH_TOKEN) {
    return { updated: [], fetchedAt: null, error: 'STRAVA_REFRESH_TOKEN not set, visit /api/strava/connect to capture it.' };
  }

  await ensureSeed();
  const races = await listRacesDB();

  // Filter to candidates: races without a result OR previously sourced
  // from Strava. Manual entries stay frozen.
  const candidates = races.filter(r => r.actualResult == null || r.actualResult.source === 'strava');
  if (candidates.length === 0) {
    const at = await getCacheFetchedAt();
    return { updated: [], fetchedAt: at ? new Date(at).toISOString() : null };
  }

  // Pull the cached activity list (refreshes from Strava if stale).
  let activities;
  try {
    ({ activities } = await getCachedActivities());
  } catch (e) {
    return { updated: [], fetchedAt: null, error: String(e) };
  }

  const updated: string[] = [];
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
      } catch (err) {
        // Detail fetch can fail (rate limit, deleted activity, network) —
        // fall back to summary so the sync proceeds. Log so an ops scan
        // can spot a pattern instead of a silent miss.
        console.warn('[strava/sync] activity detail fetch failed', { id: match.id, err });
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
  return { updated, fetchedAt: at ? new Date(at).toISOString() : null };
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
 *  expects when we don't have the full detail cached, miles +
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

// Both methods do the same thing, POST kept for legacy callers (the
// old client used to send a races[] body), GET added so the Overview
// page can trigger a sync via a plain background fetch.
export async function POST() {
  // Body is ignored, server is the source of truth for which races exist.
  const result = await runSync();
  return Response.json(result, { status: 200 });
}
export async function GET() {
  const result = await runSync();
  return Response.json(result, { status: 200 });
}
