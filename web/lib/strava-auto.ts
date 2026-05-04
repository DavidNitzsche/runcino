/**
 * Client-side auto-sync glue for Strava.
 *
 * Runs on every relevant page mount (alongside seedIfNeeded). Pulls
 * fresh actualResult data for every saved race, but ONLY for races
 * that are either (a) without a result, or (b) previously sourced
 * from Strava. Manual entries (source==='manual') stay sticky —
 * the user's typed-in finish time is never overwritten by sync.
 *
 * Cached at 15 min on the server (lib/api/strava/sync), so back-to-
 * back page nav doesn't hammer Strava's rate limit.
 */

import { listRaces, saveRace, type ActualResult, type SavedRace } from './storage';

const LAST_SYNC_KEY = 'runcino:strava:last-sync';
const MIN_INTERVAL_MS = 5 * 60 * 1000; // client-side throttle: 5 min

export interface AutoSyncResult {
  triggered: boolean;
  updatedSlugs: string[];
  error: string | null;
}

export async function autoSyncStrava(): Promise<AutoSyncResult> {
  if (typeof window === 'undefined') return { triggered: false, updatedSlugs: [], error: null };

  // Throttle: skip if we synced within the last 5 minutes. Also
  // avoids running while seedIfNeeded() is still finishing on first
  // visit — seed doesn't take 5 min, so by the time you re-mount
  // we'll re-sync if needed.
  const last = Number(window.localStorage.getItem(LAST_SYNC_KEY) || 0);
  if (Date.now() - last < MIN_INTERVAL_MS) {
    return { triggered: false, updatedSlugs: [], error: null };
  }

  const races = listRaces();
  if (races.length === 0) return { triggered: false, updatedSlugs: [], error: null };

  // Only sync races that are either missing a result or previously
  // came from Strava. Manual entries stay frozen.
  const candidates = races.filter(r =>
    r.actualResult == null || r.actualResult.source === 'strava'
  );
  if (candidates.length === 0) {
    window.localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    return { triggered: false, updatedSlugs: [], error: null };
  }

  let payload: { matches: Record<string, ReturnType<typeof noop> | null>; fetchedAt: string | null; error?: string };
  try {
    const res = await fetch('/api/strava/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        races: candidates.map(r => ({ slug: r.slug, date: r.meta.date, distanceMi: r.meta.distanceMi })),
      }),
    });
    payload = await res.json();
  } catch (e) {
    return { triggered: true, updatedSlugs: [], error: e instanceof Error ? e.message : String(e) };
  }

  if (payload.error) {
    // Likely just "STRAVA_REFRESH_TOKEN not set" pre-OAuth. Quiet no-op.
    return { triggered: true, updatedSlugs: [], error: payload.error };
  }

  const updatedSlugs: string[] = [];
  for (const race of candidates) {
    const match = payload.matches?.[race.slug];
    if (!match) continue;
    const result: ActualResult = {
      finishS: match.finishS,
      finishDisplay: match.finishDisplay,
      paceSPerMi: match.paceSPerMi,
      paceDisplay: match.paceDisplay,
      recordedAt: new Date().toISOString(),
      source: 'strava',
      stravaActivityId: match.activityId,
      avgHr: match.avgHr,
      maxHr: match.maxHr,
      avgCadence: match.avgCadence,
      totalGainFt: match.totalGainFt,
      activityName: match.name,
      // Carry-over: PR flag and notes are user-entry fields and stay
      // even when Strava re-fills the rest.
      isPR: race.actualResult?.isPR ?? false,
      notes: race.actualResult?.notes,
      place: race.actualResult?.place,
      fieldSize: race.actualResult?.fieldSize,
    };
    saveRace({ ...race, actualResult: result } as SavedRace);
    updatedSlugs.push(race.slug);
  }

  window.localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
  return { triggered: true, updatedSlugs, error: null };
}

// Helper for the type narrowing in the response — server returns
// the ActivityResult shape from lib/strava.ts but importing it here
// would pull a server-side module into the client bundle.
function noop() {
  return {} as { finishS: number; finishDisplay: string; paceSPerMi: number; paceDisplay: string; activityId: number; avgHr: number | null; maxHr: number | null; avgCadence: number | null; totalGainFt: number; name: string };
}
