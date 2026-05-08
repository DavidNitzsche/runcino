/**
 * Runner profile — birth year + sex, localStorage-backed.
 *
 * Fuels age + sex grading on the VDOT tile (Research/24). Both
 * fields are optional — when absent, the dashboard surfaces raw
 * VDOT only with no age/sex framing.
 *
 * Server-side persistence (Postgres user table) is a future
 * migration; localStorage is sufficient until we add auth and
 * multi-device sync.
 */

import type { RunnerSex } from '../coach/doctrine';

const KEY = 'runcino:runner-profile';

export interface RunnerProfile {
  /** 4-digit birth year (e.g. 1985). Used to compute age. Null
   *  when unspecified. */
  birthYear: number | null;
  /** Sex at the level of granularity needed for age + sex grading.
   *  'unspecified' is the default — no age/sex VDOT framing. */
  sex: RunnerSex;
  /** Maximum heart rate, BPM. When known (lab test or field test
   *  per Research/03 §HRmax field-test protocols), drives 5-zone
   *  HR-zone derivation on the dashboard. When null, the dashboard
   *  estimates from age via HRMAX_FORMULAS (Tanaka by default —
   *  208 - 0.7×age, ±10 BPM SE). */
  hrmaxBpm: number | null;
  /** Resting heart rate, BPM. Optional — needed for Karvonen / HRR
   *  zones. Most runners can leave this null and use %HRmax zones. */
  rhrBpm: number | null;
}

const DEFAULT: RunnerProfile = { birthYear: null, sex: 'unspecified', hrmaxBpm: null, rhrBpm: null };

/** Server-safe: returns the default profile when called outside
 *  the browser (SSR). The dashboard tile re-reads on mount so
 *  the actual profile lands client-side. */
export function loadRunnerProfile(): RunnerProfile {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<RunnerProfile>;
    return {
      birthYear: typeof parsed.birthYear === 'number' && parsed.birthYear > 1900 && parsed.birthYear < 2030
        ? parsed.birthYear
        : null,
      sex: (['male', 'female', 'other', 'unspecified'] as RunnerSex[]).includes(parsed.sex as RunnerSex)
        ? parsed.sex as RunnerSex
        : 'unspecified',
      hrmaxBpm: typeof parsed.hrmaxBpm === 'number' && parsed.hrmaxBpm >= 130 && parsed.hrmaxBpm <= 230
        ? parsed.hrmaxBpm
        : null,
      rhrBpm: typeof parsed.rhrBpm === 'number' && parsed.rhrBpm >= 30 && parsed.rhrBpm <= 100
        ? parsed.rhrBpm
        : null,
    };
  } catch {
    return DEFAULT;
  }
}

export function saveRunnerProfile(profile: RunnerProfile): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // localStorage full or disabled — silently no-op.
  }
}

/** Compute age from birth year. Returns null when birthYear is
 *  missing or invalid. Uses calendar year only (not birthday) —
 *  good enough for VDOT age-grading where year-level granularity
 *  is the standard. */
export function ageFromBirthYear(birthYear: number | null, today: Date = new Date()): number | null {
  if (birthYear == null) return null;
  const age = today.getFullYear() - birthYear;
  return age > 0 && age < 130 ? age : null;
}

/** Resolve the runner's HRmax. Prefers the entered value (lab test or
 *  field test); falls back to a Tanaka estimate from age. Tanaka is
 *  more accurate than Fox/Haskell (208 - 0.7×age, SE ±10 BPM, vs Fox's
 *  220-age SE ±13 BPM). Doctrine: HRMAX_FORMULAS (Research/03).
 *  Returns null when neither HRmax nor age are known. */
export function resolveHrmax(profile: RunnerProfile): { bpm: number; source: 'measured' | 'tanaka_estimate' } | null {
  if (profile.hrmaxBpm != null) return { bpm: profile.hrmaxBpm, source: 'measured' };
  const age = ageFromBirthYear(profile.birthYear);
  if (age != null) {
    return { bpm: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
  }
  return null;
}
