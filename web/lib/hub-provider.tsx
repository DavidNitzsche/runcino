/**
 * HubProvider + useHub() — the client-side gateway to the canonical
 * RunnerHub payload. ONE fetch on mount, every page projects from it.
 *
 * Stale-while-revalidate pattern (same as the previous coach-only
 * provider, generalized to the full hub):
 *   1. Sync init from localStorage if a cached entry is fresh enough
 *      (≤6h). Lets first paint render real data instead of a loading
 *      flash.
 *   2. On mount, fire a /api/hub fetch and update on response. The
 *      Strava webhook + midnight cron keep the SERVER cache fresh,
 *      so this round trip is fast (~50ms hot, ~300ms cold-but-cached).
 *   3. Cross-tab sync: a `storage` event listener picks up writes
 *      from other tabs (e.g. you save a race in /races → the
 *      dashboard tab sees the new race appear without reload).
 *
 * Cache key is bumped via `bumpHubCache()` whenever a client-side
 * mutation succeeds (saveRace, setActualResult, deleteRace,
 * saveProfile). That clears localStorage + triggers a re-fetch in
 * any subscribed component.
 */

'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { RunnerHub, RunnerHubResponse } from './hub-types';

const LS_KEY = 'runcino:hub:v1';
const TTL_MS = 6 * 60 * 60 * 1000;  // 6h — very generous; stale-while-revalidate keeps it fresh

interface HubCacheEntry {
  hub: RunnerHub;
  storedAt: number;
}

/** Synchronous read of the localStorage hub cache. Returns null on
 *  miss / stale / SSR. Used by the provider's `useState` lazy
 *  initializer for sync-first-paint. */
export function readHubCachedSync(): RunnerHub | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as HubCacheEntry;
    if (Date.now() - entry.storedAt > TTL_MS) return null;
    // Also bail if the cache_date doesn't match today's LA-calendar
    // date — means the day rolled over since this was cached and we
    // want a fresh prescription for today.
    const todayLA = todayLAISO();
    if (entry.hub.meta?.cacheDate !== todayLA) return null;
    return entry.hub;
  } catch {
    return null;
  }
}

function writeHubCache(hub: RunnerHub): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: HubCacheEntry = { hub, storedAt: Date.now() };
    window.localStorage.setItem(LS_KEY, JSON.stringify(entry));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

/** Bust the client cache. Call after a mutation that the server has
 *  acknowledged (e.g. saveRace POST returned 200) so the next read
 *  skips the stale local cache and pulls a fresh hub. */
export function bumpHubCache(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

function todayLAISO(): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

interface HubContextValue {
  /** Latest known hub. Null while the first fetch is in flight on a
   *  cold start (no localStorage cache). */
  hub: RunnerHub | null;
  /** Last error string, if the most recent fetch failed. UI can
   *  ignore this and keep rendering `hub` — the cache is still
   *  valid for read. */
  error: string | null;
  /** Force a re-fetch. Bumps the cache and re-pulls /api/hub. Used
   *  by mutation flows after they save server-side. */
  refresh: () => Promise<void>;
}

const HubContext = createContext<HubContextValue | null>(null);

export function HubProvider({ children }: { children: React.ReactNode }) {
  const [hub, setHub] = useState<RunnerHub | null>(() => readHubCachedSync());
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/api/hub', { cache: 'no-store' });
      if (!res.ok) throw new Error(`/api/hub ${res.status}`);
      const data = await res.json() as RunnerHubResponse;
      if (data.ok === false) {
        setError(data.error);
        return;
      }
      setHub(data);
      setError(null);
      writeHubCache(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Initial fetch + cross-tab storage sync.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/hub', { cache: 'no-store' });
        if (!res.ok) throw new Error(`/api/hub ${res.status}`);
        const data = await res.json() as RunnerHubResponse;
        if (cancelled) return;
        if (data.ok === false) {
          setError(data.error);
          return;
        }
        setHub(data);
        setError(null);
        writeHubCache(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    // Cross-tab sync: another tab wrote/cleared the hub cache, refresh.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      const fresh = readHubCachedSync();
      if (fresh) setHub(fresh);
      // Removed: trigger a re-fetch since the cache was busted.
      else void refresh();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return (
    <HubContext.Provider value={{ hub, error, refresh }}>
      {children}
    </HubContext.Provider>
  );
}

/** Read the canonical hub. Returns null while the very first fetch
 *  is in flight on a cold start. After that, always non-null until
 *  the page unmounts. */
export function useHub(): RunnerHub | null {
  const ctx = useContext(HubContext);
  return ctx?.hub ?? null;
}

/** Read the full hub context — useful when you need `refresh()` for
 *  post-mutation re-fetch. */
export function useHubContext(): HubContextValue {
  const ctx = useContext(HubContext);
  if (!ctx) {
    // Defensive default — pages that forgot to wrap themselves get
    // a noop context instead of a crash.
    return {
      hub: null,
      error: null,
      refresh: async () => undefined,
    };
  }
  return ctx;
}
