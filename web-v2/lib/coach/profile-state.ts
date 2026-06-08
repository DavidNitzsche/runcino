/**
 * profile-state.ts
 * Identity + physiology (derived) + connections + preferences + shoes.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadSettings, type UserSettings } from '@/lib/coach/settings';
import { computeZones, estimateLTHR, estimateMaxHRFromLTHR, type ZoneTable } from '@/lib/training/zones';
import { loadLatestVdotForUser } from '@/lib/training/projection-snapshots';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { loadNextARace } from './race-lookup';
import { loadActivePlan } from '@/lib/plan/lookup';

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'advanced_plus';

export interface ProfileState {
  identity: {
    full_name: string | null;
    sex: string | null;
    birthday: string | null;     // ISO date
    age: number | null;          // computed from birthday
    city: string | null;
    height_cm: number | null;
    experience_level: ExperienceLevel | null;
  };
  physiology: {
    max_hr: number | null;           // best estimate (user-entered, observed, or derived)
    max_hr_source: 'observed' | 'lthr-derived' | 'formula' | 'manual' | null;
    rhr: number | null;
    vo2: number | null;
    weight_lb: number | null;
    vdot: number | null;
    lthr: number | null;
    lthr_method: string | null;      // how it was set
    lthr_set_at: string | null;      // ISO timestamp
    zones: ZoneTable | null;         // computed zones (LTHR-based if available, else %MHR)
  };
  shoes: { id: string; name: string; brand: string; model: string; color: string | null; color2: string | null; notes: string | null; runTypes: string[]; mileage: number; cap: number; pctUsed: number; preferred: boolean | null; retired: boolean }[];
  nextARace: { slug: string; name: string; date: string; goal: string | null; days_to_race: number } | null;
  connections: {
    strava:       { connected: boolean; lastSync: string | null; note: string };
    appleHealth:  { connected: boolean; lastSync: string | null; note: string };
    appleWatch:   { connected: boolean; lastSync: string | null; note: string };
  };
  preferences: UserSettings;
}

function ageFromBirthday(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso + 'T12:00:00Z');
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const beforeBday = now.getUTCMonth() < b.getUTCMonth() ||
                     (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate());
  if (beforeBday) age--;
  return age;
}

export async function loadProfileState(userId: string): Promise<ProfileState> {
  const today = await runnerToday(userId);

  // Audit 2026-05-27: most of /profile's data sources are independent.
  // Parallelize the 11-query first batch with Promise.all so /profile FCP
  // is bounded by max query time rather than sum. Dependent lookups
  // (race lookup off plan.race_id, VDOT candidate runs off race rows,
  // LTHR derive off race meta) follow in the second wave.
  const [
    pRow,
    mhrRow,
    rhrRow,
    vo2Row,
    wRow,
    shoesRows,
    planRow,
    stravaRow,
    healthRow,
    watchRow,
    preferencesResolved,
  ] = await Promise.all([
    pool.query(
      `SELECT full_name, sex, age, city, height_cm, hrmax, rhr,
              birthday::text AS birthday,
              lthr, experience_level,
              lthr_method, lthr_set_at::text AS lthr_set_at
         FROM profile
        WHERE user_uuid = $1
        ORDER BY (user_uuid = $1) DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(value) AS m FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hr'`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT AVG(value) AS a FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND recorded_at >= NOW() - interval '60 days'`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'vo2_max'
        ORDER BY recorded_at DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'body_mass'
        ORDER BY sample_date DESC LIMIT 1`,
      [userId]
    ).then((r) => r.rows[0]),
    pool.query(
      `SELECT id, brand, model, color, color2, notes, run_types, mileage, mileage_cap, retired, preferred
         FROM shoes
        WHERE user_uuid = $1
        ORDER BY id`,
      [userId]
    ).then((r) => r.rows),
    // Active plan via the memoized loadActivePlan helper. Inside this
    // Promise.all batch we still hit the lookup, but subsequent state-
    // loaders firing on /today + /profile share the cached value.
    loadActivePlan(userId).then((p) => p ? { race_id: p.race_id } : undefined),
    pool.query(
      `SELECT MAX(COALESCE(data->>'date', LEFT(data->>'startLocal',10))::text) AS last
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(recorded_at) AS last FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    pool.query(
      `SELECT MAX(recorded_at) AS last
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type IN ('hrv_sdnn','vo2_max','resting_hr')`,
      [userId]
    ).catch(() => ({ rows: [{ last: null }] })).then((r) => r.rows[0]),
    loadSettings(userId).catch(() => DEFAULT_PREFS),
  ]);

  const p = pRow;
  const rhr = rhrRow?.a ? Math.round(Number(rhrRow.a)) : (p?.rhr ?? null);
  const vo2 = vo2Row?.value ? +Number(vo2Row.value).toFixed(1) : null;
  const weight_lb = wRow?.value ? +(Number(wRow.value) * 2.20462).toFixed(1) : null;
  const preferences = preferencesResolved;

  const shoes = shoesRows.map((s: any) => {
    const m = Number(s.mileage) || 0;
    const cap = Number(s.mileage_cap) || 400;
    return {
      id: String(s.id),
      name: `${s.brand} ${s.model}`,
      brand: s.brand, model: s.model,
      color: s.color ?? null,
      color2: s.color2 ?? null,
      notes: s.notes ?? null,
      runTypes: s.run_types ?? [],
      mileage: Math.round(m),
      cap, pctUsed: Math.round((m / cap) * 100),
      preferred: s.preferred,
      retired: !!s.retired,
    };
  });

  // Next A race — shared memoized helper. Same lookup state-loader uses,
  // so /today + /profile + /health all share one query per 60s window.
  const nextARaceFull = await loadNextARace(userId, today, planRow?.race_id ?? null);
  const nextARace: ProfileState['nextARace'] = nextARaceFull ? {
    slug: nextARaceFull.slug,
    name: nextARaceFull.name ?? '',
    date: nextARaceFull.date,
    goal: nextARaceFull.goal,
    days_to_race: nextARaceFull.days_to_race,
  } : null;

  // Connection windows from the now-parallelized lastsync rows.
  const stravaLast: Date | null = stravaRow?.last ? new Date(`${stravaRow.last}T12:00:00Z`) : null;
  const stravaConnected = stravaLast != null && (Date.now() - stravaLast.getTime()) < 1000 * 60 * 60 * 24 * 14;
  const healthLast: Date | null = healthRow?.last ? new Date(healthRow.last) : null;
  const healthConnected = healthLast != null && (Date.now() - healthLast.getTime()) < 1000 * 60 * 60 * 24 * 7;
  const watchLast: Date | null = watchRow?.last ? new Date(watchRow.last) : null;
  const watchConnected = watchLast != null && (Date.now() - watchLast.getTime()) < 1000 * 60 * 60 * 24 * 30;

  // B4 (2026-06-08): VDOT is now read from projection_snapshots (cron-written
  // nightly) rather than recomputed live. Single query replaces 4+ queries +
  // the full race-candidate chain. Falls back to null for cold-start users
  // who haven't had a cron run yet — display reads null as "no VDOT yet".
  const effMaxHr = await loadEffectiveMaxHr(userId, today);
  const vdot = await loadLatestVdotForUser(userId);

  // === LTHR + true MaxHR ===
  // Prefer user-entered values; fall back to derived-from-race if we have race meta.
  let lthr: number | null = p?.lthr ?? null;
  let lthrMethod: string | null = p?.lthr_method ?? null;
  if (lthr == null) {
    // Try to derive from race data — half-marathon avg HR is the best proxy
    const raceWithHr = (await pool.query(
      `SELECT meta FROM races
        WHERE user_uuid = $1
          AND meta->>'finishTime' IS NOT NULL
          AND meta->>'avgHrBpm' IS NOT NULL
        ORDER BY (meta->>'date') DESC NULLS LAST LIMIT 5`,
      [userId]
    ).catch(() => ({ rows: [] }))).rows;
    for (const row of raceWithHr) {
      const m = row.meta;
      const est = estimateLTHR({
        raceDistanceMi: Number(m.distanceMi ?? 13.1),
        avgHrBpm: Number(m.avgHrBpm),
      });
      if (est) {
        lthr = est.lthr;
        lthrMethod = `derived: ${m.name ?? 'race'} (${est.note})`;
        break;
      }
    }
  }

  // True MaxHR: loadEffectiveMaxHr is authoritative for every user
  // (user_override → 12-month observed → manual stored → null).
  // profile.hrmax_observed no longer bypasses the resolver — any user
  // who wants to assert a known max should use users.max_hr_override,
  // which feeds into the resolver at step 1.
  // See lib/training/max-hr.ts for the full resolution doctrine.
  const max_hr: number | null =
    effMaxHr.bpm
    ?? (lthr != null ? estimateMaxHRFromLTHR(lthr) : null)
    ?? (p?.hrmax ?? null);
  const max_hr_source: ProfileState['physiology']['max_hr_source'] =
    effMaxHr.bpm != null && effMaxHr.source === 'observed_12mo' ? 'observed' :
    effMaxHr.bpm != null && effMaxHr.source === 'user_override' ? 'manual' :
    effMaxHr.bpm != null && effMaxHr.source === 'manual_stored' ? 'manual' :
    lthr != null ? 'lthr-derived' :
    p?.hrmax ? 'formula' : null;

  const zones = computeZones({ lthr, maxHr: max_hr });

  const birthday = p?.birthday ?? null;
  const age = ageFromBirthday(birthday) ?? p?.age ?? null;

  return {
    identity: {
      full_name: p?.full_name ?? null,
      sex: p?.sex ?? null,
      birthday,
      age,
      city: p?.city ?? null,
      // Postgres returns NUMERIC columns as strings by default to preserve
      // precision · pg-node never coerces them. iPhone Decodable expects
      // Double, so a String payload here crashed the entire ProfileState
      // decode + emptied the iPhone Profile / Today / Activity / Targets /
      // Train avatars (all 5 views read this struct). Cast to Number on
      // the way out so the wire shape is honest. Added 2026-05-31.
      height_cm: p?.height_cm != null ? Number(p.height_cm) : null,
      experience_level: (p?.experience_level as ExperienceLevel | null) ?? null,
    },
    physiology: {
      max_hr, max_hr_source,
      rhr, vo2, weight_lb, vdot,
      lthr,
      lthr_method: lthrMethod,
      lthr_set_at: p?.lthr_set_at ?? null,
      zones,
    },
    shoes: shoes.filter((s) => !s.retired),
    nextARace,
    connections: {
      strava:      { connected: stravaConnected, lastSync: stravaLast?.toISOString() ?? null, note: stravaConnected ? `Last sync ${relativeAgo(stravaLast!)}` : 'Connect for auto-sync' },
      appleHealth: { connected: healthConnected, lastSync: healthLast?.toISOString() ?? null, note: healthConnected ? `Last reading ${relativeAgo(healthLast!)}` : 'Sleep / HRV / RHR / weight / VO2' },
      appleWatch:  { connected: watchConnected, lastSync: watchLast?.toISOString() ?? null, note: watchConnected ? `Last workout ${relativeAgo(watchLast!)}` : 'Open Faff on iPhone to pair' },
    },
    preferences,
  };
}

// Inline default to avoid import cycle issues if settings loader fails completely.
const DEFAULT_PREFS: UserSettings = {
  units_distance: 'mi',
  units_temp: 'F',
  units_pace: 'min_per_mi',
  long_run_day: 'sun',
  rest_day: 'sat',
  quality_days: ['tue', 'thu'],
  briefing_time: '07:00',
  push_enabled: true,
};

function relativeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}
