/**
 * profile-types · pure shapes + validators for the `profile` table.
 *
 * Split out from profile-store.ts because client components (the
 * EditProfileModal) need ProfileRow + VALID_SEX + validateProfileInput,
 * but importing profile-store (which loads `pg` via db.ts) into a
 * 'use client' file makes Next try to bundle `pg` for the browser.
 *
 * Anything in this file must remain free of node-only imports
 * (no pg, no fs, no DATABASE_URL touches).
 */

export interface ProfileRow {
  user_id: string;
  full_name: string | null;
  sex: string | null;
  age: number | null;
  city: string | null;
  runner_id: string | null;
  since_year: number | null;
  /** Measured HRmax in bpm. null when not entered (Tanaka estimate
   *  derived from age is the fallback). */
  hrmax: number | null;
  /** Resting HR — requires HealthKit or manual entry. null today. */
  rhr: number | null;
  /** Apple Health VO2max estimate (manual entry today; HealthKit M2).
   *  WELLNESS signal — physiological capacity. NEVER used for pace
   *  prescription. Range 25-90. See lib/vo2max-apple.ts. */
  vo2max_apple: number | null;
  /** ISO timestamp the manual VO2max was last written. Drives the
   *  trend display on /profile. */
  vo2max_apple_updated_at: string | null;
}

export interface ProfileInput {
  full_name?: string | null;
  sex?: string | null;
  age?: number | string | null;
  city?: string | null;
  runner_id?: string | null;
  since_year?: number | string | null;
  hrmax?: number | string | null;
  rhr?: number | string | null;
}

/** Allowed sex values. 'Other' and 'Prefer not to say' coexist with
 *  the legacy M / F shorthand the rest of the codebase already
 *  renders (/health page M 38 line). */
export const VALID_SEX = ['M', 'F', 'Other', 'Prefer not to say'] as const;
export type Sex = typeof VALID_SEX[number];

export interface ValidatedProfile {
  full_name: string;
  sex: Sex;
  age: number;
  city: string | null;
  runner_id: string | null;
  since_year: number | null;
  hrmax: number | null;
  rhr: number | null;
}

/** Pure validator — exported so unit tests can exercise it without a
 *  live DB. Throws Error on invalid input. */
export function validateProfileInput(input: ProfileInput): ValidatedProfile {
  const nameRaw = (input.full_name ?? '').toString().trim();
  if (!nameRaw) throw new Error('Name is required.');
  if (nameRaw.length > 120) throw new Error('Name must be 120 characters or less.');

  const ageNum = coerceInt(input.age);
  if (ageNum == null) throw new Error('Age is required.');
  if (ageNum < 10 || ageNum > 100) throw new Error('Age must be between 10 and 100.');

  const sexRaw = (input.sex ?? 'Prefer not to say').toString().trim();
  const sex: Sex | null = (VALID_SEX as readonly string[]).includes(sexRaw)
    ? (sexRaw as Sex)
    : null;
  if (!sex) throw new Error(`Sex must be one of: ${VALID_SEX.join(', ')}`);

  const cityRaw = (input.city ?? '').toString().trim();
  const city = cityRaw || null;
  if (city && city.length > 120) throw new Error('Location must be 120 characters or less.');

  const runnerIdRaw = (input.runner_id ?? '').toString().trim();
  const runner_id = runnerIdRaw || null;

  const since_year = coerceInt(input.since_year);
  if (since_year != null && (since_year < 1900 || since_year > 2100)) {
    throw new Error('Since year must be a valid 4-digit year.');
  }

  const hrmax = coerceInt(input.hrmax);
  if (hrmax != null && (hrmax < 100 || hrmax > 250)) {
    throw new Error('Max HR must be between 100 and 250 bpm.');
  }

  const rhr = coerceInt(input.rhr);
  if (rhr != null && (rhr < 30 || rhr > 100)) {
    throw new Error('Resting HR must be between 30 and 100 bpm.');
  }

  return {
    full_name: nameRaw,
    sex,
    age: ageNum,
    city,
    runner_id,
    since_year,
    hrmax,
    rhr,
  };
}

function coerceInt(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.trunc(v) : null;
  }
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
