/**
 * Client-side race API wrapper.
 *
 * Source of truth lives in Postgres on the server (lib/race-store.ts).
 * This module is a thin fetch wrapper consumed by the React pages.
 *
 * Every function is async — the localStorage path is gone. Pages
 * already load races inside `useEffect`, so they `await` here just
 * like they did the old seedIfNeeded() call.
 *
 * In-memory client cache: the first call within a page-load fetches
 * /api/races; subsequent calls within ~5s reuse the response. Saves
 * the round trip when multiple components mount concurrently. The
 * cache is busted on every save / mutation so writes show up live.
 */

'use client';

import type { ActualResult, SavedRace } from './storage-types';
export { slugifyRaceName } from './storage-types';
export type { ActualResult, SavedRace } from './storage-types';

const STALE_MS = 5_000;
const LS_KEY = 'runcino:races-cache:v1';
const LS_TTL_MS = 6 * 60 * 60 * 1000;  // 6h — pages render instantly on revisit

let cached: { races: SavedRace[]; at: number } | null = null;
let inflight: Promise<SavedRace[]> | null = null;

interface LsEntry { races: SavedRace[]; storedAt: number }

/** Synchronous read of the localStorage races cache. Used by page
 *  components for `useState(() => listRacesCachedSync())` so first
 *  paint can have data populated, no loading flash. Returns null
 *  on miss / stale / SSR. */
export function listRacesCachedSync(): SavedRace[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as LsEntry;
    if (Date.now() - entry.storedAt > LS_TTL_MS) return null;
    return entry.races;
  } catch {
    return null;
  }
}

function writeLs(races: SavedRace[]): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: LsEntry = { races, storedAt: Date.now() };
    window.localStorage.setItem(LS_KEY, JSON.stringify(entry));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export async function listRaces(force = false): Promise<SavedRace[]> {
  if (typeof window === 'undefined') return [];
  if (!force && cached && Date.now() - cached.at < STALE_MS) return cached.races;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/races', { cache: 'no-store' });
      if (!res.ok) throw new Error(`/api/races ${res.status}`);
      const json = await res.json() as { races: SavedRace[] };
      cached = { races: json.races, at: Date.now() };
      writeLs(json.races);
      return json.races;
    } catch (e) {
      console.error('listRaces failed:', e);
      return cached?.races ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function getRace(slug: string): Promise<SavedRace | null> {
  if (typeof window === 'undefined') return null;
  // Prefer the list cache when fresh — saves a round trip.
  if (cached && Date.now() - cached.at < STALE_MS) {
    const hit = cached.races.find(r => r.slug === slug);
    if (hit) return hit;
  }
  try {
    const res = await fetch(`/api/races/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`/api/races/${slug} ${res.status}`);
    const json = await res.json() as { race: SavedRace };
    return json.race;
  } catch (e) {
    console.error(`getRace(${slug}) failed:`, e);
    return null;
  }
}

/** Synchronous read of a single race from the localStorage list
 *  cache. Used for sync-init on the race-detail page so the page
 *  can render content on first paint instead of "Loading…". */
export function getRaceCachedSync(slug: string): SavedRace | null {
  const list = listRacesCachedSync();
  return list?.find(r => r.slug === slug) ?? null;
}

export async function saveRace(race: SavedRace): Promise<void> {
  if (typeof window === 'undefined') return;
  invalidateRacesCache();
  const res = await fetch('/api/races', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(race),
  });
  if (!res.ok) throw new Error(`saveRace ${race.slug} → ${res.status}`);
}

export async function setActualResult(slug: string, result: ActualResult | null): Promise<void> {
  if (typeof window === 'undefined') return;
  invalidateRacesCache();
  const res = await fetch(`/api/races/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actualResult: result }),
  });
  if (!res.ok) throw new Error(`setActualResult ${slug} → ${res.status}`);
}

export async function deleteRace(slug: string): Promise<void> {
  if (typeof window === 'undefined') return;
  invalidateRacesCache();
  const res = await fetch(`/api/races/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteRace ${slug} → ${res.status}`);
}

/** Bust the client cache (useful after a server-side mutation that
 *  bypassed this module — e.g. a Strava sync that ran on the server).
 *  Wipes both the in-memory + localStorage cache so next listRaces
 *  call hits the network. */
export function invalidateRacesCache(): void {
  cached = null;
  inflight = null;
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
