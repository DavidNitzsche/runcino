/**
 * Client-side race API wrapper.
 *
 * Source of truth lives in Postgres on the server (lib/race-store.ts),
 * surfaced through the unified RunnerHub (/api/hub) on the read path.
 * This module is a thin fetch wrapper used by mutations + a handful
 * of legacy callers that need a one-off race read.
 *
 * Reads: prefer `useHub()?.races` over `listRaces()`. The hub already
 * has them, so this round-trip is wasted. Kept for back-compat.
 *
 * Writes: `saveRace`, `setActualResult`, `deleteRace` POST/PATCH/
 * DELETE the canonical /api/races endpoints, then call
 * `bumpHubCache()` so any subscribed `useHub()` refreshes.
 */

'use client';

import type { ActualResult, SavedRace } from './storage-types';
import { bumpHubCache } from './hub-provider';
export { slugifyRaceName } from './storage-types';
export type { ActualResult, SavedRace } from './storage-types';

const STALE_MS = 5_000;

let cached: { races: SavedRace[]; at: number } | null = null;
let inflight: Promise<SavedRace[]> | null = null;

/** Legacy: fetch all races. Most callers should read from the hub
 *  via `useHub()?.races` instead — this is kept for code paths that
 *  run outside React (e.g. autoSyncStrava). 5s in-memory dedup. */
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

/** Legacy: fetch one race by slug. Most callers should read from
 *  `useHub()?.races.find(r => r.slug === slug)` instead. */
export async function getRace(slug: string): Promise<SavedRace | null> {
  if (typeof window === 'undefined') return null;
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

export async function saveRace(race: SavedRace): Promise<void> {
  if (typeof window === 'undefined') return;
  invalidateRacesCache();
  const res = await fetch('/api/races', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(race),
  });
  if (!res.ok) throw new Error(`saveRace ${race.slug} → ${res.status}`);
  bumpHubCache();
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
  bumpHubCache();
}

export async function deleteRace(slug: string): Promise<void> {
  if (typeof window === 'undefined') return;
  invalidateRacesCache();
  const res = await fetch(`/api/races/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`deleteRace ${slug} → ${res.status}`);
  bumpHubCache();
}

/** Bust the in-memory client cache. Called automatically by every
 *  mutation here. The legacy localStorage races-cache layer was
 *  retired when the dashboard / training / races pages migrated to
 *  the hub — only the in-memory dedup remains. */
export function invalidateRacesCache(): void {
  cached = null;
  inflight = null;
}
