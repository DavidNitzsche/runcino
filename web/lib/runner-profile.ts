/**
 * Runner profile — client-side wrapper over the server-side store
 * at /api/runner-profile (Postgres-backed). Replaces the prior
 * localStorage-only implementation.
 *
 * Cross-device synced: phone + desktop see the same profile. The
 * server-side coach engine sees it too, so briefDailyTraining /
 * briefRaceMorning / assessReadiness can use age + sex + HRmax
 * for context (the audit's #1 priority).
 *
 * Migration: on first load, if a localStorage profile exists, push
 * it to the server then forget it. The legacy key is preserved
 * during migration but no longer read.
 */

import type { RunnerSex } from '../coach/doctrine';

const LEGACY_KEY = 'runcino:runner-profile';

export interface RunnerProfile {
  birthYear: number | null;
  sex: RunnerSex;
  hrmaxBpm: number | null;
  rhrBpm: number | null;
}

export const DEFAULT_PROFILE: RunnerProfile = {
  birthYear: null, sex: 'unspecified', hrmaxBpm: null, rhrBpm: null,
};

let cached: { profile: RunnerProfile; at: number } | null = null;
let inflight: Promise<RunnerProfile> | null = null;
const CACHE_TTL_MS = 60_000;

interface ApiResponse {
  profile: {
    birthYear: number | null;
    sex: RunnerSex | null;
    hrmaxBpm: number | null;
    rhrBpm: number | null;
    updatedAt: string | null;
  } | null;
  error?: string;
}

function fromApi(api: ApiResponse['profile']): RunnerProfile {
  if (!api) return DEFAULT_PROFILE;
  const sex: RunnerSex = (['male', 'female', 'other', 'unspecified'] as const).includes(api.sex as RunnerSex)
    ? (api.sex as RunnerSex)
    : 'unspecified';
  return {
    birthYear: api.birthYear,
    sex,
    hrmaxBpm: api.hrmaxBpm,
    rhrBpm: api.rhrBpm,
  };
}

/** Read a legacy localStorage profile (if any). Used once during
 *  migration to seed the server, then ignored. */
function readLegacy(): RunnerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunnerProfile>;
    return {
      birthYear: typeof parsed.birthYear === 'number' && parsed.birthYear > 1900 && parsed.birthYear < 2030
        ? parsed.birthYear : null,
      sex: (['male', 'female', 'other', 'unspecified'] as RunnerSex[]).includes(parsed.sex as RunnerSex)
        ? (parsed.sex as RunnerSex) : 'unspecified',
      hrmaxBpm: typeof parsed.hrmaxBpm === 'number' && parsed.hrmaxBpm >= 130 && parsed.hrmaxBpm <= 230
        ? parsed.hrmaxBpm : null,
      rhrBpm: typeof parsed.rhrBpm === 'number' && parsed.rhrBpm >= 30 && parsed.rhrBpm <= 100
        ? parsed.rhrBpm : null,
    };
  } catch {
    return null;
  }
}

/** Async loader — fetches profile from server. In-memory cache with
 *  60s TTL deduplicates concurrent reads across the dashboard's
 *  shared context. SSR-safe (returns DEFAULT). */
export async function loadRunnerProfile(force = false): Promise<RunnerProfile> {
  if (typeof window === 'undefined') return DEFAULT_PROFILE;
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.profile;
  if (!force && inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/runner-profile', { cache: 'no-store' });
      if (!res.ok) throw new Error(`/api/runner-profile ${res.status}`);
      const json = await res.json() as ApiResponse;
      let profile = fromApi(json.profile);

      // First-load legacy migration: if the server profile is empty
      // but the browser has a localStorage profile, push it up.
      // Then mark the legacy key as migrated (don't delete — keeps
      // a backup if anything goes wrong).
      const isEmpty = profile.birthYear == null && profile.sex === 'unspecified'
                   && profile.hrmaxBpm == null && profile.rhrBpm == null;
      const legacy = isEmpty ? readLegacy() : null;
      if (legacy && (legacy.birthYear != null || legacy.sex !== 'unspecified' || legacy.hrmaxBpm != null || legacy.rhrBpm != null)) {
        try {
          const migrateRes = await fetch('/api/runner-profile', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(legacy),
          });
          if (migrateRes.ok) {
            const migrated = await migrateRes.json() as ApiResponse;
            profile = fromApi(migrated.profile);
            window.localStorage.setItem(LEGACY_KEY + ':migrated', String(Date.now()));
          }
        } catch {
          // Migration failure is non-fatal — keep the server's
          // (empty) profile and try again next time.
        }
      }

      cached = { profile, at: Date.now() };
      return profile;
    } catch {
      return DEFAULT_PROFILE;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Save the profile back to the server. Updates the local cache so
 *  consumers re-rendering after the save see the new values without
 *  another fetch. */
export async function saveRunnerProfile(profile: RunnerProfile): Promise<RunnerProfile> {
  if (typeof window === 'undefined') return profile;
  const res = await fetch('/api/runner-profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`save profile failed: ${res.status}`);
  const json = await res.json() as ApiResponse;
  const next = fromApi(json.profile);
  cached = { profile: next, at: Date.now() };
  return next;
}

/** Synchronous read of the most recent cached profile, for components
 *  that have already triggered loadRunnerProfile elsewhere on the
 *  page. Returns DEFAULT_PROFILE before the first fetch resolves. */
export function getCachedRunnerProfile(): RunnerProfile {
  return cached?.profile ?? DEFAULT_PROFILE;
}

/** Compute age from birth year. */
export function ageFromBirthYear(birthYear: number | null, today: Date = new Date()): number | null {
  if (birthYear == null) return null;
  const age = today.getFullYear() - birthYear;
  return age > 0 && age < 130 ? age : null;
}

/** Resolve HRmax. Prefers measured, falls back to Tanaka estimate
 *  from age (208 - 0.7×age, ±10 BPM SE). Doctrine: HRMAX_FORMULAS
 *  in Research/03. */
export function resolveHrmax(profile: RunnerProfile): { bpm: number; source: 'measured' | 'tanaka_estimate' } | null {
  if (profile.hrmaxBpm != null) return { bpm: profile.hrmaxBpm, source: 'measured' };
  const age = ageFromBirthYear(profile.birthYear);
  if (age != null) {
    return { bpm: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
  }
  return null;
}
