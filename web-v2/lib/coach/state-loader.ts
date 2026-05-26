/**
 * State loader — assembles a CoachState snapshot for a user.
 *
 * Ports the read logic from web/scripts/mockup-today.mjs (proven, real-data)
 * into a typed service. Every value returned here is queried; nothing is
 * invented. Missing data returns null (handled by topic prereqs).
 */
import { pool } from '@/lib/db/pool';
import type { CoachState } from '@/lib/topics/types';

export async function loadCoachState(userId: string): Promise<CoachState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // PROFILE — includes LTHR + observed maxHR + experience for HR-zone reasoning
  const profResult = await pool.query(
    `SELECT full_name, sex, age, city, hrmax, hrmax_observed, lthr,
            rhr, height_cm, experience_level
       FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  );
  const profile = profResult.rows[0] ?? null;

  // LATEST ACTIVITY (most recent strava run ≤ today)
  const recent = await pool.query(
    `SELECT data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) <= $2
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC,
               COALESCE(data->>'startLocal','') DESC
      LIMIT 1`,
    [userId, today]
  );
  const r = recent.rows[0]?.data ?? null;
  const latest_activity = r
    ? {
        id: r.id ?? r.activityId ?? `${r.date}-${r.distanceMi}`,
        date: r.date || (r.startLocal ?? '').slice(0, 10),
        mi: Number(r.distanceMi) || 0,
        pace: r.avgPaceMinPerMi || r.pace || null,
        timeMoving: r.timeMoving || r.duration || null,
        hr: Number(r.avgHr) || null,
        cadence: Number(r.avgCadence) || null,
        tempF: Number(r.tempF) || null,
        name: r.name || null,
      }
    : null;

  // RECENT RUNS (last 7 days, deduped, all sources) — fed into coach
  // prompt to prevent hallucination about runs that didn't happen.
  const recentRows = (await pool.query(
    `SELECT data FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 0.5
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text >= ($2::date - interval '7 days')::date::text
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))::text <= $2::text
      ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC,
               COALESCE(data->>'startLocal','') DESC`,
    [userId, today]
  )).rows;
  // Dedupe: same date + similar distance → keep richest source
  const SOURCE_RANK: Record<string, number> = { strava: 4, watch: 3, manual: 2, apple_health: 1 };
  const byKey = new Map<string, any>();
  for (const row of recentRows) {
    const d = row.data;
    const date = d.date || (d.startLocal ?? '').slice(0, 10);
    const mi = Number(d.distanceMi);
    if (!date || !isFinite(mi)) continue;
    const k = `${date}-${Math.round(mi * 20) / 20}`;
    const cur = byKey.get(k);
    const newRank = SOURCE_RANK[d.source ?? 'strava'] ?? 0;
    const curRank = cur ? (SOURCE_RANK[cur.source ?? 'strava'] ?? 0) : -1;
    if (newRank > curRank) byKey.set(k, d);
  }
  const recentRuns = [...byKey.values()]
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, 10)
    .map((d) => ({
      date: d.date || (d.startLocal ?? '').slice(0, 10),
      type: d.type ?? null,
      mi: Number(d.distanceMi) || 0,
      pace: d.avgPaceMinPerMi || (d.paceSPerMi ? `${Math.floor(d.paceSPerMi / 60)}:${String(Math.round(d.paceSPerMi % 60)).padStart(2, '0')}` : null),
      hr: Number(d.avgHr) || null,
      name: d.name ?? null,
      source: d.source ?? null,
    }));

  // CURRENT WEEK from plan
  const plan = (await pool.query(
    `SELECT id, race_id
       FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  let weekPlanned: number | null = null;
  let phaseLabel: string | null = null;
  let currentWeekDays: CoachState['currentWeekDays'] = [];
  let nextWorkout: CoachState['nextWorkout'] = null;
  let nextARace: CoachState['nextARace'] = null;

  if (plan) {
    const weeks = (await pool.query(
      `SELECT id::text AS id, week_idx, week_start_iso
         FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [plan.id]
    )).rows;
    const phases = (await pool.query(
      `SELECT label, start_week_idx, end_week_idx
         FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`,
      [plan.id]
    )).rows;
    const workouts = (await pool.query(
      `SELECT week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label
         FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`,
      [plan.id]
    )).rows;

    const cw =
      weeks.find((w) => workouts.some((x) => x.week_id === w.id && x.date_iso === today)) ??
      weeks.find((w) => {
        const next = new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000)
          .toISOString().slice(0, 10);
        return w.week_start_iso <= today && next > today;
      });

    if (cw) {
      const days = workouts
        .filter((w) => w.week_id === cw.id)
        .sort((a, b) => a.date_iso.localeCompare(b.date_iso));
      currentWeekDays = days.map((d) => ({
        date: d.date_iso, dow: d.dow, type: d.type,
        mi: Number(d.distance_mi) || 0, label: d.sub_label,
      }));
      weekPlanned = Math.round(currentWeekDays.reduce((s, d) => s + d.mi, 0) * 10) / 10;
      phaseLabel = phases.find((p) => cw.week_idx >= p.start_week_idx && cw.week_idx <= p.end_week_idx)?.label ?? null;
    }

    const upcoming = workouts
      .filter((w) => w.date_iso > today && w.type !== 'rest' && Number(w.distance_mi) > 0)
      .sort((a, b) => a.date_iso.localeCompare(b.date_iso))[0];
    if (upcoming) {
      nextWorkout = {
        date: upcoming.date_iso, dow: upcoming.dow, type: upcoming.type,
        mi: Number(upcoming.distance_mi) || 0, label: upcoming.sub_label,
      };
    }

    if (plan.race_id) {
      const raceRow = (await pool.query(
        `SELECT slug, meta FROM races WHERE slug = $1`,
        [plan.race_id]
      )).rows[0];
      if (raceRow) {
        const date = raceRow.meta?.date;
        const days_to_race = Math.round(
          (Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000
        );
        nextARace = {
          slug: raceRow.slug,
          name: raceRow.meta?.name,
          date,
          goal: raceRow.meta?.goalDisplay ?? null,
          days_to_race,
        };
      }
    }
  }

  // Fallback: if NO plan but the user has an upcoming A-race, still surface
  // it so the coach doesn't think we're "in free-running mode" when the
  // runner has anchored races. This is the source-of-truth for nextARace
  // when between plans.
  if (!nextARace) {
    const fallbackRace = (await pool.query(
      `SELECT slug, meta FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'priority' = 'A'
          AND (meta->>'date')::date >= $2::date
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId, today]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (fallbackRace) {
      const date = fallbackRace.meta?.date;
      const days_to_race = Math.round(
        (Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000
      );
      nextARace = {
        slug: fallbackRace.slug,
        name: fallbackRace.meta?.name,
        date,
        goal: fallbackRace.meta?.goalDisplay ?? null,
        days_to_race,
      };
    }
  }

  // WEEK DONE (strava sum from Monday → today)
  const monday = (() => {
    const d = new Date(today + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    return new Date(d.getTime() + shift * 86400000).toISOString().slice(0, 10);
  })();
  const weekRuns = await pool.query(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            SUM((data->>'distanceMi')::numeric) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      GROUP BY day`,
    [userId, monday, today]
  );
  const weekDone = Math.round(weekRuns.rows.reduce((s, r) => s + Number(r.mi), 0) * 10) / 10;

  // SLEEP last 7
  const sleep = (await pool.query(
    `SELECT value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'sleep_hours'
        AND sample_date <= $2::date
      ORDER BY sample_date DESC LIMIT 7`,
    [userId, today]
  )).rows;
  const sleepVals = sleep.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const sleep7Avg = sleepVals.length
    ? +(sleepVals.reduce((s, x) => s + x, 0) / sleepVals.length).toFixed(1)
    : null;
  const sleep7Deficit = +sleepVals.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // HRV current + baseline
  const hrv = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'hrv'
      ORDER BY recorded_at DESC LIMIT 30`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const hrvCurrent = hrv[0] ?? null;
  const hrvBaseline = hrv.length ? Math.round(hrv.reduce((s, x) => s + x, 0) / hrv.length) : null;

  // RHR
  const rhr = (await pool.query(
    `SELECT value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '60 days'
      ORDER BY recorded_at DESC LIMIT 14`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const rhrCurrent = rhr[0] ?? null;
  const rhrBaseline = rhr.length ? Math.round(rhr.reduce((s, x) => s + x, 0) / rhr.length) : null;

  // Cadence 60d baseline
  const cad = (await pool.query(
    `SELECT AVG(value)::numeric AS avg FROM health_samples
      WHERE user_id = $1 AND sample_type = 'cadence'
        AND sample_date >= ($2::date - interval '60 days')`,
    [userId, today]
  )).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  // Recent check-ins (7 days)
  const checkIns = await pool.query(
    `SELECT ts, rating FROM check_ins
      WHERE user_id = $1 AND ts >= NOW() - interval '7 days'
      ORDER BY ts DESC LIMIT 10`,
    [userId]
  ).catch(() => ({ rows: [] }));  // table may not exist before P0.7 migration

  // Pending intents (not yet acknowledged)
  const intents = await pool.query(
    `SELECT reason, field, value FROM coach_intents
      WHERE user_id = $1 AND acknowledged_at IS NULL
      ORDER BY ts DESC LIMIT 5`,
    [userId]
  ).catch(() => ({ rows: [] }));

  return {
    today,
    user_id: userId,
    profile: profile ? {
      full_name: profile.full_name ?? null,
      sex: profile.sex ?? null,
      age: profile.age ?? null,
      city: profile.city ?? null,
      height_cm: profile.height_cm ?? null,
      // Prefer user-entered observed maxHR; fall back to legacy column.
      hrmax: profile.hrmax_observed ?? profile.hrmax ?? null,
      lthr: profile.lthr ?? null,
      rhr: profile.rhr ?? null,
      experience_level: profile.experience_level ?? null,
    } : null,
    latest_activity,
    recentRuns,
    weekDone,
    weekPlanned,
    phaseLabel,
    currentWeekDays,
    nextWorkout,
    nextARace,
    sleep7Avg,
    sleep7Deficit,
    hrvCurrent,
    hrvBaseline,
    rhrCurrent,
    rhrBaseline,
    cadenceBaseline,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    pendingIntents: intents.rows.map((r: any) => ({
      reason: r.reason, field: r.field, value: r.value,
    })),
    shoes: [], // populated by P0.6b — out of scope for the engine skeleton
  };
}
