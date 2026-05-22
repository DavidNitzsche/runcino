/**
 * Client-side cache + hook for the year's Strava activities.
 *
 * Every page that wants live Strava data calls useActivities(). The
 * first call hits /api/strava/activities; subsequent mounts within
 * 5 minutes read from localStorage. The fetch itself is deduped across
 * tabs/components within a single page load via an in-flight promise.
 *
 * Server-side already caches the upstream Strava list at 15 min, so the
 * worst case here is a single GET to our own API that returns from RAM.
 */

'use client';

import { useEffect, useState } from 'react';

export interface NormalizedActivity {
  id: number;
  name: string;
  type: string;
  sportType: string | null;
  workoutType: number | null;
  startLocal: string;
  date: string;
  distanceMi: number;
  movingTimeS: number;
  elapsedTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevGainFt: number;
  avgSpeedMph: number | null;
  startLatLng: [number, number] | null;
  endLatLng: [number, number] | null;
  summaryPolyline: string | null;
  kudosCount: number;
  achievementCount: number;
  sufferScore: number | null;
  /** Time at the canonical race distance, sourced from Strava's
   *  best_efforts. For a half marathon ran as a 13.4 mi activity,
   *  this is the time at exactly 13.10 mi (the chip-time finish).
   *  null when activity detail hasn't been fetched OR the activity
   *  doesn't match a canonical distance. */
  canonicalFinishS: number | null;
  canonicalDistanceMi: number | null;
  canonicalLabel: string | null;
}

interface CachedPayload {
  activities: NormalizedActivity[];
  fetchedAt: string | null;
  cachedAt: number;        // client-side timestamp, ms
  error?: string;
}

const CACHE_KEY = 'faff:strava:activities:v1';
const CLIENT_TTL_MS = 5 * 60 * 1000;

let inflight: Promise<CachedPayload> | null = null;

function readCache(): CachedPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedPayload = JSON.parse(raw);
    if (!parsed.cachedAt || Date.now() - parsed.cachedAt > CLIENT_TTL_MS) return parsed;  // stale but usable
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(payload: CachedPayload): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch { /* quota, ignore */ }
}

export async function fetchActivities(force = false): Promise<CachedPayload> {
  if (!force) {
    const cached = readCache();
    if (cached && Date.now() - cached.cachedAt < CLIENT_TTL_MS) return cached;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/strava/activities', { cache: 'no-store' });
      const json = await res.json();
      const payload: CachedPayload = {
        activities: Array.isArray(json.activities) ? json.activities : [],
        fetchedAt: json.fetchedAt ?? null,
        cachedAt: Date.now(),
        error: json.error,
      };
      writeCache(payload);
      return payload;
    } catch (e) {
      const payload: CachedPayload = {
        activities: [],
        fetchedAt: null,
        cachedAt: Date.now(),
        error: e instanceof Error ? e.message : String(e),
      };
      return payload;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useActivities(): {
  activities: NormalizedActivity[] | null;
  fetchedAt: string | null;
  error: string | null;
  refetch: () => void;
} {
  const [state, setState] = useState<CachedPayload | null>(() => readCache());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchActivities().then(p => { if (!cancelled) setState(p); });
    return () => { cancelled = true; };
  }, [tick]);

  return {
    activities: state?.activities ?? null,
    fetchedAt: state?.fetchedAt ?? null,
    error: state?.error ?? null,
    refetch: () => setTick(t => t + 1),
  };
}

/** Filter to runs only (drop rides, swims, walks, hikes). */
export function onlyRuns(activities: NormalizedActivity[]): NormalizedActivity[] {
  return activities.filter(a => a.type === 'Run' || a.sportType === 'Run' || a.sportType === 'TrailRun');
}
