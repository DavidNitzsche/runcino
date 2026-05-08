/**
 * Runner profile — client-side wrapper over /api/runner-profile
 * (Postgres-backed, single-row, server-side store). Cross-device
 * synced.
 *
 * Birth as a full ISO date so age computation is precise — year
 * alone is off by up to a year for most runners through their
 * birthday.
 *
 * Migration: on first load, if a localStorage profile exists from
 * the legacy (birth_year + 'other'/'prefer not to say') schema,
 * push it to the server then forget it.
 */

import type { RunnerSex } from '../coach/doctrine';

const LEGACY_KEY = 'runcino:runner-profile';

export interface RunnerProfile {
  /** ISO YYYY-MM-DD. Null when unset. */
  birthDate: string | null;
  sex: RunnerSex;
  hrmaxBpm: number | null;
  rhrBpm: number | null;
}

export const DEFAULT_PROFILE: RunnerProfile = {
  birthDate: null, sex: 'unspecified', hrmaxBpm: null, rhrBpm: null,
};

let cached: { profile: RunnerProfile; at: number } | null = null;
let inflight: Promise<RunnerProfile> | null = null;
const CACHE_TTL_MS = 60_000;

interface ApiResponse {
  profile: {
    birthDate: string | null;
    sex: RunnerSex | null;
    hrmaxBpm: number | null;
    rhrBpm: number | null;
    updatedAt: string | null;
  } | null;
  error?: string;
}

function fromApi(api: ApiResponse['profile']): RunnerProfile {
  if (!api) return DEFAULT_PROFILE;
  // Server may return legacy 'other'/'prefer not to say' — coerce
  // to 'unspecified' for clients that expect the new {male/female/
  // unspecified} contract.
  const sex: RunnerSex = (['male', 'female'] as const).includes(api.sex as 'male' | 'female')
    ? (api.sex as 'male' | 'female')
    : 'unspecified';
  return {
    birthDate: api.birthDate,
    sex,
    hrmaxBpm: api.hrmaxBpm,
    rhrBpm: api.rhrBpm,
  };
}

/** Read a legacy localStorage profile (if any). Used once during
 *  migration. Handles both schemas — legacy birth_year + the new
 *  birth_date format. */
function readLegacy(): RunnerProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RunnerProfile> & { birthYear?: number };

    // Convert legacy birthYear → mid-year birth_date.
    let birthDate: string | null = null;
    if (typeof parsed.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.birthDate)) {
      birthDate = parsed.birthDate;
    } else if (typeof parsed.birthYear === 'number' && parsed.birthYear > 1900 && parsed.birthYear < 2030) {
      birthDate = `${parsed.birthYear}-07-02`;
    }

    return {
      birthDate,
      sex: (['male', 'female'] as const).includes(parsed.sex as 'male' | 'female')
        ? (parsed.sex as 'male' | 'female')
        : 'unspecified',
      hrmaxBpm: typeof parsed.hrmaxBpm === 'number' && parsed.hrmaxBpm >= 130 && parsed.hrmaxBpm <= 230
        ? parsed.hrmaxBpm : null,
      rhrBpm: typeof parsed.rhrBpm === 'number' && parsed.rhrBpm >= 30 && parsed.rhrBpm <= 100
        ? parsed.rhrBpm : null,
    };
  } catch {
    return null;
  }
}

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

      // First-load legacy migration.
      const isEmpty = profile.birthDate == null && profile.sex === 'unspecified'
                   && profile.hrmaxBpm == null && profile.rhrBpm == null;
      const legacy = isEmpty ? readLegacy() : null;
      if (legacy && (legacy.birthDate != null || legacy.sex !== 'unspecified' || legacy.hrmaxBpm != null || legacy.rhrBpm != null)) {
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
        } catch { /* non-fatal */ }
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

export function getCachedRunnerProfile(): RunnerProfile {
  return cached?.profile ?? DEFAULT_PROFILE;
}

/** Compute age from a full birth date — accounts for whether the
 *  birthday has passed yet this year. */
export function ageFromBirthDate(birthDate: string | null, today: Date = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - y;
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  if (todayMonth < m || (todayMonth === m && todayDay < d)) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

export function resolveHrmax(profile: RunnerProfile): { bpm: number; source: 'measured' | 'tanaka_estimate' } | null {
  if (profile.hrmaxBpm != null) return { bpm: profile.hrmaxBpm, source: 'measured' };
  const age = ageFromBirthDate(profile.birthDate);
  if (age != null) {
    return { bpm: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
  }
  return null;
}
