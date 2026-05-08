/**
 * Server-side runner profile store. Single-row Postgres table
 * (`runner_profile` in lib/db.ts) — assumes one runner per deploy
 * until auth lands. Cross-device synced, replaces the prior
 * localStorage-only path.
 *
 * The client (lib/runner-profile.ts) becomes a thin fetch wrapper
 * over /api/runner-profile and migrates any existing localStorage
 * profile to the server on first load.
 */

import { query } from './db';

export type RunnerSex = 'male' | 'female' | 'other' | 'unspecified';

export interface RunnerProfile {
  birthYear: number | null;
  sex: RunnerSex;
  hrmaxBpm: number | null;
  rhrBpm: number | null;
  updatedAt: string | null;       // ISO timestamp; null on a fresh row
}

const DEFAULT: RunnerProfile = {
  birthYear: null,
  sex: 'unspecified',
  hrmaxBpm: null,
  rhrBpm: null,
  updatedAt: null,
};

interface DbRow {
  birth_year: number | null;
  sex: string | null;
  hrmax_bpm: number | null;
  rhr_bpm: number | null;
  updated_at: Date;
}

function rowToProfile(row: DbRow): RunnerProfile {
  return {
    birthYear: row.birth_year,
    sex: (['male', 'female', 'other', 'unspecified'] as const).includes(row.sex as RunnerSex)
      ? (row.sex as RunnerSex)
      : 'unspecified',
    hrmaxBpm: row.hrmax_bpm,
    rhrBpm: row.rhr_bpm,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** Read the (singleton) runner profile. Returns DEFAULT when no row
 *  exists yet — caller can still render an empty profile editor. */
export async function getRunnerProfile(): Promise<RunnerProfile> {
  const rows = await query<DbRow>(`SELECT birth_year, sex, hrmax_bpm, rhr_bpm, updated_at FROM runner_profile WHERE id = 1`);
  return rows.length === 0 ? DEFAULT : rowToProfile(rows[0]);
}

/** Upsert the profile. All fields optional — passing null wipes that
 *  field, leaving the others alone. A single row pinned to id = 1. */
export async function setRunnerProfile(profile: Partial<RunnerProfile>): Promise<RunnerProfile> {
  // Validate fields we accept. Defensive — both the route handler and
  // the legacy-localStorage migration path call this.
  const birthYear = profile.birthYear ?? null;
  const sex: RunnerSex = (['male', 'female', 'other', 'unspecified'] as const).includes(profile.sex as RunnerSex)
    ? (profile.sex as RunnerSex)
    : 'unspecified';
  const hrmaxBpm = profile.hrmaxBpm ?? null;
  const rhrBpm = profile.rhrBpm ?? null;

  // Range-check numeric fields the same way the client did.
  const validBirthYear = birthYear != null && birthYear > 1900 && birthYear < 2030 ? birthYear : null;
  const validHrmax = hrmaxBpm != null && hrmaxBpm >= 130 && hrmaxBpm <= 230 ? hrmaxBpm : null;
  const validRhr = rhrBpm != null && rhrBpm >= 30 && rhrBpm <= 100 ? rhrBpm : null;

  await query(
    `INSERT INTO runner_profile (id, birth_year, sex, hrmax_bpm, rhr_bpm, updated_at)
     VALUES (1, $1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       birth_year = EXCLUDED.birth_year,
       sex = EXCLUDED.sex,
       hrmax_bpm = EXCLUDED.hrmax_bpm,
       rhr_bpm = EXCLUDED.rhr_bpm,
       updated_at = NOW();`,
    [validBirthYear, sex, validHrmax, validRhr],
  );

  return getRunnerProfile();
}

/** Compute age from birth year. Returns null when birthYear missing
 *  or out of plausible range. Calendar-year only (not birthday) —
 *  matches WMA grading convention. */
export function ageFromBirthYear(birthYear: number | null, today: Date = new Date()): number | null {
  if (birthYear == null) return null;
  const age = today.getFullYear() - birthYear;
  return age > 0 && age < 130 ? age : null;
}

/** Resolve HRmax. Prefers measured > Tanaka estimate from age >
 *  null. Tanaka (208 - 0.7×age) is more accurate than Fox
 *  (220 - age). Doctrine: HRMAX_FORMULAS in Research/03. */
export function resolveHrmax(profile: RunnerProfile): { bpm: number; source: 'measured' | 'tanaka_estimate' } | null {
  if (profile.hrmaxBpm != null) return { bpm: profile.hrmaxBpm, source: 'measured' };
  const age = ageFromBirthYear(profile.birthYear);
  if (age != null) {
    return { bpm: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
  }
  return null;
}
