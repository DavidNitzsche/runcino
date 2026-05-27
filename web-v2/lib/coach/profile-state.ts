/**
 * profile-state.ts
 * Identity + physiology (derived) + connections + preferences + shoes.
 */
import { pool } from '@/lib/db/pool';
import { loadSettings, type UserSettings } from '@/lib/coach/settings';
import { computeZones, estimateLTHR, estimateMaxHRFromLTHR, type ZoneTable } from '@/lib/training/zones';
import { bestRecentVdot, parseRaceTime } from '@/lib/training/vdot';

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
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const p = (await pool.query(
    `SELECT full_name, sex, age, city, height_cm, hrmax, rhr,
            birthday::text AS birthday,
            lthr, hrmax_observed, experience_level,
            lthr_method, lthr_set_at::text AS lthr_set_at
       FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];

  // Observed max HR from health_samples (peak across all recorded HR samples).
  // Final max_hr decision happens below after LTHR is known.
  const mhrRow = (await pool.query(
    `SELECT MAX(value) AS m FROM health_samples WHERE user_id = $1 AND sample_type = 'hr'`,
    [userId]
  )).rows[0];

  const rhrRow = (await pool.query(
    `SELECT AVG(value) AS a FROM health_samples
      WHERE user_id = $1 AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '60 days'`,
    [userId]
  )).rows[0];
  const rhr = rhrRow?.a ? Math.round(Number(rhrRow.a)) : (p?.rhr ?? null);

  const vo2Row = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'vo2_max'
      ORDER BY recorded_at DESC LIMIT 1`,
    [userId]
  )).rows[0];
  const vo2 = vo2Row?.value ? +Number(vo2Row.value).toFixed(1) : null;

  const wRow = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'body_mass'
      ORDER BY sample_date DESC LIMIT 1`,
    [userId]
  )).rows[0];
  const weight_lb = wRow?.value ? +(Number(wRow.value) * 2.20462).toFixed(1) : null;

  // Shoes
  const shoes = (await pool.query(
    `SELECT id, brand, model, color, color2, notes, run_types, mileage, mileage_cap, retired, preferred
       FROM shoes
      WHERE user_uuid = $1 OR user_uuid IS NULL
      ORDER BY id`,
    [userId]
  )).rows.map((s: any) => {
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

  // Next A race for context (shoes-vs-race not surfaced unless flagged)
  const plan = (await pool.query(
    `SELECT race_id FROM training_plans WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  let nextARace: ProfileState['nextARace'] = null;
  if (plan?.race_id) {
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0];
    if (raceRow) {
      const date = raceRow.meta?.date;
      const days_to_race = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
      nextARace = { slug: raceRow.slug, name: raceRow.meta?.name, date, goal: raceRow.meta?.goalDisplay ?? null, days_to_race };
    }
  }

  // === Connection state — real data presence, not hardcoded ===
  // Strava = most recent activity in strava_activities (jsonb data->>'date').
  const stravaRow = (await pool.query(
    `SELECT MAX(COALESCE(data->>'date', LEFT(data->>'startLocal',10))::text) AS last
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')`,
    [userId]
  ).catch(() => ({ rows: [{ last: null }] }))).rows[0];
  const stravaLast: Date | null = stravaRow?.last ? new Date(`${stravaRow.last}T12:00:00Z`) : null;
  const stravaConnected = stravaLast != null && (Date.now() - stravaLast.getTime()) < 1000 * 60 * 60 * 24 * 14;

  // Apple Health = most recent health_samples row
  const healthRow = (await pool.query(
    `SELECT MAX(recorded_at) AS last FROM health_samples WHERE user_id = $1`,
    [userId]
  ).catch(() => ({ rows: [{ last: null }] }))).rows[0];
  const healthLast: Date | null = healthRow?.last ? new Date(healthRow.last) : null;
  const healthConnected = healthLast != null && (Date.now() - healthLast.getTime()) < 1000 * 60 * 60 * 24 * 7;

  // Apple Watch = paired iff watch-only metrics (HRV, VO2 max) are landing.
  // The watch is the only source of those sample types in our pipeline.
  const watchRow = (await pool.query(
    `SELECT MAX(recorded_at) AS last
       FROM health_samples
      WHERE user_id = $1
        AND sample_type IN ('hrv_sdnn','vo2_max','resting_hr')`,
    [userId]
  ).catch(() => ({ rows: [{ last: null }] }))).rows[0];
  const watchLast: Date | null = watchRow?.last ? new Date(watchRow.last) : null;
  const watchConnected = watchLast != null && (Date.now() - watchLast.getTime()) < 1000 * 60 * 60 * 24 * 30;

  // Preferences (settings) — real values, not hardcoded
  const preferences = await loadSettings(userId).catch(() => DEFAULT_PREFS);

  // VDOT — compute from the best race in the last 6 months.
  // Only A/B priority races count (skip C and custom flags like
  // 'hilly-excluded'). Auto-matches each race to its actual completed
  // run in the runs table to get finish time (race meta doesn't persist
  // it).
  const raceRows = (await pool.query(
    `SELECT slug, meta FROM races
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (meta->>'date')::date >= ($2::date - interval '180 days')::date
        AND (meta->>'date')::date < $2::date
        AND meta->>'priority' IN ('A', 'B')`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows;

  // For VDOT, also need to match each race to its run for finish time.
  const earliestDate = raceRows.length
    ? raceRows.reduce((min: string, r: any) => {
        const d = r.meta?.date ?? '';
        return (!min || d < min) ? d : min;
      }, '')
    : null;
  const candidateRuns = earliestDate ? (await pool.query(
    `SELECT data FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 2.5
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= $2
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) <= $3`,
    [userId, earliestDate, today]
  ).catch(() => ({ rows: [] }))).rows : [];

  function distFromLabel(label: string | null | undefined): number | null {
    const l = String(label ?? '').toLowerCase();
    if (l.includes('marathon') && !l.includes('half')) return 26.2;
    if (l.includes('half') || l.includes('21k'))  return 13.1;
    if (l.includes('10k')) return 6.2;
    if (l.includes('5k')) return 3.1;
    return null;
  }

  const raceCandidates = raceRows.map((r: any) => {
    const m = r.meta ?? {};
    const distMi = m.distanceMi ? Number(m.distanceMi) : distFromLabel(m.distanceLabel);
    // First try meta.finishTime, then match a run by date+distance
    let finishSec = parseRaceTime(m.finishTime);
    if (!finishSec && distMi && m.date) {
      let bestMatch: any = null;
      let bestScore = Infinity;
      for (const c of candidateRuns) {
        const d = c.data;
        const day = d.date || (d.startLocal ?? '').slice(0, 10);
        if (!day) continue;
        const dayDelta = Math.abs((Date.parse(day + 'T12:00:00Z') - Date.parse(m.date + 'T12:00:00Z')) / 86400000);
        if (dayDelta > 1) continue;
        const mi = Number(d.distanceMi);
        const miDelta = Math.abs(mi - distMi);
        if (miDelta > 2.0) continue;
        const score = dayDelta * 10 + miDelta;
        if (score < bestScore) { bestMatch = d; bestScore = score; }
      }
      if (bestMatch) {
        finishSec = Number(bestMatch.movingTimeS) || Number(bestMatch.elapsedTimeS) || null;
      }
    }
    return {
      slug: r.slug,
      name: m.name ?? r.slug,
      date: m.date ?? '',
      priority: (m.priority ?? null) as 'A'|'B'|'C'|null,
      distance_mi: distMi,
      finish_seconds: finishSec,
    };
  });
  const { best: bestVdot } = bestRecentVdot(raceCandidates, today, 180);
  const vdot: number | null = bestVdot?.vdot ?? null;

  // === LTHR + true MaxHR ===
  // Prefer user-entered values; fall back to derived-from-race if we have race meta.
  let lthr: number | null = p?.lthr ?? null;
  let lthrMethod: string | null = p?.lthr_method ?? null;
  if (lthr == null) {
    // Try to derive from race data — half-marathon avg HR is the best proxy
    const raceWithHr = (await pool.query(
      `SELECT meta FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
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

  // True MaxHR: prefer user-entered, then derived from LTHR (typically LTHR + ~22 bpm),
  // then observed (existing logic), then null.
  const max_hr: number | null = p?.hrmax_observed ?? (lthr != null ? estimateMaxHRFromLTHR(lthr) : (mhrRow?.m ? Math.round(Number(mhrRow.m)) : (p?.hrmax ?? null)));
  const max_hr_source: ProfileState['physiology']['max_hr_source'] =
    p?.hrmax_observed ? 'manual' :
    lthr != null ? 'lthr-derived' :
    mhrRow?.m ? 'observed' :
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
      height_cm: p?.height_cm ?? null,
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
