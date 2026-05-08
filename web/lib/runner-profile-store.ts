/**
 * Server-side runner profile store. Single-row Postgres table
 * (`runner_profile` in lib/db.ts) — assumes one runner per deploy
 * until auth lands. Cross-device synced, replaces the prior
 * localStorage-only path.
 *
 * Birth-date as a full DATE so age computation can handle "has the
 * runner's birthday passed yet this year" — year-only would be off
 * by up to 1 for ~half the year.
 */

import { query } from './db';

export type RunnerSex = 'male' | 'female' | 'unspecified';

export type CyclePhase = 'menstruation' | 'follicular' | 'ovulation' | 'luteal' | null;

export interface RunnerProfile {
  /** ISO YYYY-MM-DD. Preferred over birth_year (precise age). */
  birthDate: string | null;
  sex: RunnerSex;
  hrmaxBpm: number | null;
  rhrBpm: number | null;
  /** Free-text health flags — current/recent injuries, conditions,
   *  cycle notes, anything the runner wants the coach to remember.
   *  Engine doesn't currently parse it; visible context for LLM
   *  brief generation. */
  healthFlags: string | null;
  /** GPS watch / running computer model (free text). */
  gpsWatchModel: string | null;
  /** Free text for shoe rotation notes, kit, anything else gear. */
  kitNotes: string | null;
  /** Start of the runner's most recent menstruation. Used to derive
   *  the current cycle phase + day-of-cycle. Only applicable when
   *  sex='female'. */
  lastPeriodDate: string | null;
  /** Self-reported cycle phase. Falls back to a date-derived value
   *  when lastPeriodDate is set but this isn't. */
  cyclePhase: CyclePhase;
  /** Day-of-week the runner wants their long run on (0=Sun..6=Sat).
   *  Drives defaultByDow's long-run placement + the longer rebuild
   *  day in postRaceWorkout's stage 3/4 weeks. NULL → engine defaults
   *  to 0 (Sunday). */
  longRunDow: number | null;
  updatedAt: string | null;
}

const DEFAULT: RunnerProfile = {
  birthDate: null,
  sex: 'unspecified',
  hrmaxBpm: null,
  rhrBpm: null,
  healthFlags: null,
  gpsWatchModel: null,
  kitNotes: null,
  lastPeriodDate: null,
  cyclePhase: null,
  longRunDow: null,
  updatedAt: null,
};

interface DbRow {
  birth_date: Date | string | null;
  birth_year: number | null;
  sex: string | null;
  hrmax_bpm: number | null;
  rhr_bpm: number | null;
  health_flags: string | null;
  gps_watch_model: string | null;
  kit_notes: string | null;
  last_period_date: Date | string | null;
  cycle_phase: string | null;
  long_run_dow: number | null;
  updated_at: Date;
}

function rowToProfile(row: DbRow): RunnerProfile {
  // Prefer birth_date column when populated. Fall back to birth_year
  // (legacy data from before the DATE migration) by anchoring at
  // July 2 (median of the year — minimizes max age error).
  let birthDate: string | null = null;
  if (row.birth_date != null) {
    birthDate = row.birth_date instanceof Date
      ? row.birth_date.toISOString().slice(0, 10)
      : String(row.birth_date).slice(0, 10);
  } else if (row.birth_year != null) {
    birthDate = `${row.birth_year}-07-02`;
  }
  const sex: RunnerSex = (['male', 'female', 'unspecified'] as const).includes(row.sex as RunnerSex)
    ? (row.sex as RunnerSex)
    : 'unspecified';
  const lastPeriodDate: string | null = row.last_period_date instanceof Date
    ? row.last_period_date.toISOString().slice(0, 10)
    : (typeof row.last_period_date === 'string' ? row.last_period_date.slice(0, 10) : null);
  const cyclePhase: CyclePhase = (['menstruation', 'follicular', 'ovulation', 'luteal'] as const)
    .includes(row.cycle_phase as Exclude<CyclePhase, null>)
    ? (row.cycle_phase as Exclude<CyclePhase, null>)
    : null;
  const longRunDow = (row.long_run_dow != null && row.long_run_dow >= 0 && row.long_run_dow <= 6)
    ? row.long_run_dow
    : null;
  return {
    birthDate,
    sex,
    hrmaxBpm: row.hrmax_bpm,
    rhrBpm: row.rhr_bpm,
    healthFlags: row.health_flags,
    gpsWatchModel: row.gps_watch_model,
    kitNotes: row.kit_notes,
    lastPeriodDate,
    cyclePhase,
    longRunDow,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function getRunnerProfile(): Promise<RunnerProfile> {
  const rows = await query<DbRow>(
    `SELECT birth_date, birth_year, sex, hrmax_bpm, rhr_bpm, health_flags,
            gps_watch_model, kit_notes, last_period_date, cycle_phase,
            long_run_dow, updated_at
     FROM runner_profile WHERE id = 1`,
  );
  return rows.length === 0 ? DEFAULT : rowToProfile(rows[0]);
}

export async function setRunnerProfile(profile: Partial<RunnerProfile>): Promise<RunnerProfile> {
  const birthDateRaw = profile.birthDate ?? null;
  // ISO date validation. Accept YYYY-MM-DD; reject anything else.
  const validBirthDate = (() => {
    if (!birthDateRaw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDateRaw)) return null;
    const d = new Date(birthDateRaw + 'T12:00:00Z');
    if (isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    if (y < 1900 || y > 2030) return null;
    return birthDateRaw;
  })();
  const birthYearDerived = validBirthDate ? Number(validBirthDate.slice(0, 4)) : null;

  const sex: RunnerSex = (['male', 'female', 'unspecified'] as const).includes(profile.sex as RunnerSex)
    ? (profile.sex as RunnerSex)
    : 'unspecified';

  const hrmaxBpm = profile.hrmaxBpm != null && profile.hrmaxBpm >= 130 && profile.hrmaxBpm <= 230
    ? profile.hrmaxBpm : null;
  const rhrBpm = profile.rhrBpm != null && profile.rhrBpm >= 30 && profile.rhrBpm <= 100
    ? profile.rhrBpm : null;
  const healthFlags = (profile.healthFlags ?? '').trim().slice(0, 1000) || null;
  const gpsWatchModel = (profile.gpsWatchModel ?? '').trim().slice(0, 200) || null;
  const kitNotes = (profile.kitNotes ?? '').trim().slice(0, 500) || null;
  // Last-period date validation — same shape as birthDate.
  const validLastPeriod = (() => {
    const d = profile.lastPeriodDate ?? null;
    if (!d) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    return d;
  })();
  const cyclePhase: CyclePhase = (['menstruation', 'follicular', 'ovulation', 'luteal'] as const)
    .includes(profile.cyclePhase as Exclude<CyclePhase, null>)
    ? (profile.cyclePhase as Exclude<CyclePhase, null>)
    : null;
  const longRunDow = profile.longRunDow != null && profile.longRunDow >= 0 && profile.longRunDow <= 6
    ? profile.longRunDow
    : null;

  await query(
    `INSERT INTO runner_profile (id, birth_year, birth_date, sex, hrmax_bpm, rhr_bpm,
                                  health_flags, gps_watch_model, kit_notes,
                                  last_period_date, cycle_phase, long_run_dow, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (id) DO UPDATE SET
       birth_year = EXCLUDED.birth_year,
       birth_date = EXCLUDED.birth_date,
       sex = EXCLUDED.sex,
       hrmax_bpm = EXCLUDED.hrmax_bpm,
       rhr_bpm = EXCLUDED.rhr_bpm,
       health_flags = EXCLUDED.health_flags,
       gps_watch_model = EXCLUDED.gps_watch_model,
       kit_notes = EXCLUDED.kit_notes,
       last_period_date = EXCLUDED.last_period_date,
       cycle_phase = EXCLUDED.cycle_phase,
       long_run_dow = EXCLUDED.long_run_dow,
       updated_at = NOW();`,
    [birthYearDerived, validBirthDate, sex, hrmaxBpm, rhrBpm,
     healthFlags, gpsWatchModel, kitNotes, validLastPeriod, cyclePhase, longRunDow],
  );

  return getRunnerProfile();
}

/** Compute age precisely from a full birth date — accounts for
 *  whether the birthday has passed yet this year. Returns null on
 *  missing/invalid input. */
export function ageFromBirthDate(birthDate: string | null, today: Date = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = today.getFullYear() - y;
  // If today's month-day is before the birthday's month-day, subtract one.
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  if (todayMonth < m || (todayMonth === m && todayDay < d)) age -= 1;
  return age > 0 && age < 130 ? age : null;
}

/** Legacy export — kept for any module still importing the year-
 *  only helper. Routes through ageFromBirthDate when a date exists,
 *  otherwise falls back to year-only math (less precise). */
export function ageFromBirthYear(birthYear: number | null, today: Date = new Date()): number | null {
  if (birthYear == null) return null;
  // Year-only fallback: assume mid-year (July 2) so worst-case
  // error is half a year. Used only when birth_date is null.
  return ageFromBirthDate(`${birthYear}-07-02`, today);
}

/** Resolve HRmax. Prefers measured > Tanaka estimate from age. */
export function resolveHrmax(profile: RunnerProfile): { bpm: number; source: 'measured' | 'tanaka_estimate' } | null {
  if (profile.hrmaxBpm != null) return { bpm: profile.hrmaxBpm, source: 'measured' };
  const age = ageFromBirthDate(profile.birthDate);
  if (age != null) {
    return { bpm: Math.round(208 - 0.7 * age), source: 'tanaka_estimate' };
  }
  return null;
}
