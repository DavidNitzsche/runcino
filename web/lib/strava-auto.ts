/**
 * Client-side Strava sync trigger.
 *
 * Calls /api/strava/sync on every relevant page mount. The server
 * handles everything: pulls Strava activities, matches against saved
 * races in Postgres, writes actualResult into the DB. This module
 * just kicks the endpoint and reports back which slugs changed so the
 * caller can re-fetch /api/races.
 *
 * Throttled at 5 min via localStorage so back-to-back page navs
 * don't double-trigger.
 */

const LAST_SYNC_KEY = 'runcino:strava:last-sync';
const MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface AutoSyncResult {
  triggered: boolean;
  updatedSlugs: string[];
  error: string | null;
}

export async function autoSyncStrava(): Promise<AutoSyncResult> {
  if (typeof window === 'undefined') return { triggered: false, updatedSlugs: [], error: null };

  const last = Number(window.localStorage.getItem(LAST_SYNC_KEY) || 0);
  if (Date.now() - last < MIN_INTERVAL_MS) {
    return { triggered: false, updatedSlugs: [], error: null };
  }

  try {
    const res = await fetch('/api/strava/sync', { method: 'POST' });
    const json = await res.json() as { updated?: string[]; error?: string };
    window.localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    return {
      triggered: true,
      updatedSlugs: json.updated ?? [],
      error: json.error ?? null,
    };
  } catch (e) {
    return { triggered: true, updatedSlugs: [], error: e instanceof Error ? e.message : String(e) };
  }
}
