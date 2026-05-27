/**
 * glance-state.ts — fast read for page shell.
 *
 * Returns ONLY the fields needed to render the surface without the LLM:
 *   - today's date / phase / week stats
 *   - sleep / RHR / HRV / cadence baselines
 *   - readiness (computed from those inputs; no LLM)
 *   - next workout (for UP NEXT card placeholder while briefing loads)
 *
 * Cheap pg queries only — no Anthropic call. Page renders in ~200ms.
 */
import { pool } from '@/lib/db/pool';
import { computeReadiness, type ReadinessBreakdown } from './readiness';
import { loadNextARace } from './race-lookup';

export interface GlanceWeekDay {
  date: string;            // ISO YYYY-MM-DD
  dow: number;             // 0 Sun … 6 Sat
  // Plan side
  plannedMi: number;
  plannedType: string;     // 'easy' | 'rest' | 'long' | 'threshold' | etc.
  plannedLabel: string | null;
  // Actual (strava)
  doneMi: number;
  activityId: string | null;   // → click navigates to /runs/[id]
  // Flags
  isToday: boolean;
  isPast: boolean;
}

export interface GlanceState {
  today: string;
  greetingName: string;
  weekDone: number;
  weekPlanned: number | null;
  weekDays: GlanceWeekDay[];   // 7 entries, Monday → Sunday
  phaseLabel: string | null;
  sleep7Avg: number | null;
  sleep7Deficit: number;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  cadenceBaseline: number | null;
  daysToARace: number | null;
  nextARaceName: string | null;
  readiness: ReadinessBreakdown;
}

export async function loadGlanceState(userId: string): Promise<GlanceState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Profile (just for name)
  const prof = (await pool.query(
    `SELECT full_name, height_cm FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id='me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];

  // Active plan summary
  const plan = (await pool.query(
    `SELECT id, race_id FROM training_plans
      WHERE (user_uuid = $1 OR user_id = 'me') AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];

  let weekPlanned: number | null = null;
  let phaseLabel: string | null = null;
  let daysToARace: number | null = null;
  let nextARaceName: string | null = null;
  let weekDays: GlanceWeekDay[] = [];

  // Compute the Mon-Sun window around today regardless of plan presence.
  const monday = (() => {
    const d = new Date(today + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    return new Date(d.getTime() + shift * 86400000).toISOString().slice(0, 10);
  })();
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.parse(monday + 'T12:00:00Z') + i * 86400000);
    return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
  });

  // Plan-aware fields (only populated when plan exists)
  let planByDate = new Map<string, any>();
  if (plan) {
    const weeks = (await pool.query(
      `SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [plan.id]
    )).rows;
    const cw = weeks.find((w: any) => w.week_start_iso <= today &&
      new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10) > today);
    if (cw) {
      const wkmi = await pool.query(
        `SELECT SUM(distance_mi)::numeric AS mi FROM plan_workouts WHERE plan_id = $1 AND week_id = $2`,
        [plan.id, cw.id]
      );
      weekPlanned = Number(wkmi.rows[0]?.mi ?? 0);
      const phases = (await pool.query(
        `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1`,
        [plan.id]
      )).rows;
      phaseLabel = phases.find((p: any) => cw.week_idx >= p.start_week_idx && cw.week_idx <= p.end_week_idx)?.label ?? null;
    }
    if (plan.race_id) {
      // Shared, memoized lookup — same query state-loader runs on /today
      // and /health Promise.all'd loads, deduped to 1 round-trip per 60s.
      const race = await loadNextARace(userId, today, plan.race_id);
      if (race) {
        daysToARace = race.days_to_race;
        nextARaceName = race.name;
      }
    }
    const planRows = (await pool.query(
      `SELECT date_iso, dow, type, distance_mi, sub_label FROM plan_workouts
        WHERE plan_id = $1 AND date_iso BETWEEN $2::text AND $3::text`,
      [plan.id, weekDates[0].date, weekDates[6].date]
    )).rows;
    planByDate = new Map<string, any>(planRows.map((r: any) => [r.date_iso, r]));
  }

  // Strava actuals — ALWAYS loaded, with or without an active plan, so the
  // week strip + TodayPlannedCard always show real runs.
  const stravaRows = (await pool.query(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            data->>'id' AS activity_id,
            SUM((data->>'distanceMi')::numeric) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL) AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2::text AND $3::text
      GROUP BY day, activity_id`,
    [userId, weekDates[0].date, weekDates[6].date]
  )).rows;
  const actualByDate = new Map<string, { mi: number; id: string | null }>();
  for (const r of stravaRows) {
    const cur = actualByDate.get(r.day) ?? { mi: 0, id: null };
    cur.mi += Number(r.mi);
    if (cur.id == null || Number(r.mi) >= cur.mi - Number(r.mi)) cur.id = r.activity_id ?? cur.id;
    actualByDate.set(r.day, cur);
  }

  weekDays = weekDates.map(({ date, dow }) => {
    const planRow = planByDate.get(date);
    const actual = actualByDate.get(date);
    return {
      date, dow,
      plannedMi: planRow ? Number(planRow.distance_mi) || 0 : 0,
      // When no plan, default to a neutral "—" type (NOT "rest") so the
      // TodayPlannedCard doesn't mislabel a run-day as a rest day.
      plannedType: planRow?.type ?? (plan ? 'rest' : 'unplanned'),
      plannedLabel: planRow?.sub_label ?? null,
      doneMi: actual ? Math.round(actual.mi * 10) / 10 : 0,
      activityId: actual?.id ?? null,
      isToday: date === today,
      isPast: date < today,
    };
  });

  // Week done — sum from weekDays we already loaded
  const weekDone = Math.round(weekDays.reduce((s, d) => s + d.doneMi, 0) * 10) / 10;

  // Sleep
  const sleep = (await pool.query(
    `SELECT value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date
      ORDER BY sample_date DESC LIMIT 7`,
    [userId, today]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const sleep7Avg = sleep.length ? +(sleep.reduce((s, x) => s + x, 0) / sleep.length).toFixed(1) : null;
  const sleep7Deficit = +sleep.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // RHR
  const rhr = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'resting_hr'
       AND recorded_at >= NOW() - interval '60 days' ORDER BY recorded_at DESC LIMIT 14`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const rhrCurrent = rhr[0] ?? null;
  const rhrBaseline = rhr.length ? Math.round(rhr.reduce((s, x) => s + x, 0) / rhr.length) : null;

  // HRV
  const hrv = (await pool.query(
    `SELECT value FROM health_samples WHERE user_id = $1 AND sample_type = 'hrv'
       ORDER BY recorded_at DESC LIMIT 30`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const hrvCurrent = hrv[0] ?? null;
  const hrvBaseline = hrv.length ? Math.round(hrv.reduce((s, x) => s + x, 0) / hrv.length) : null;

  // Cadence
  const cad = (await pool.query(
    `SELECT AVG(value)::numeric AS avg FROM health_samples
      WHERE user_id = $1 AND sample_type = 'cadence' AND sample_date >= ($2::date - interval '60 days')`,
    [userId, today]
  )).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  // Recent check-ins
  const checkIns = await pool.query(
    `SELECT ts, rating FROM check_ins WHERE user_id = $1 AND ts >= NOW() - interval '7 days'
      ORDER BY ts DESC LIMIT 10`,
    [userId]
  ).catch(() => ({ rows: [] }));

  // ACWR for LOAD pillar — sum mi/day in 7d and 28d windows.
  const acwrRow = await pool.query(
    `SELECT
        COALESCE(SUM(CASE WHEN data->>'date' >= ($1::date - interval '7 days')::text
                          AND  data->>'date' <  ($1::date + interval '1 day')::text
                          THEN (data->>'distanceMi')::numeric ELSE 0 END), 0)::numeric AS acute_sum,
        COALESCE(SUM(CASE WHEN data->>'date' >= ($1::date - interval '28 days')::text
                          AND  data->>'date' <  ($1::date + interval '1 day')::text
                          THEN (data->>'distanceMi')::numeric ELSE 0 END), 0)::numeric AS chronic_sum,
        COUNT(*) FILTER (WHERE data->>'date' >= ($1::date - interval '28 days')::text)::int AS runs28
       FROM strava_activities
      WHERE (user_uuid = $2 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 0.3`,
    [today, userId]
  ).catch(() => ({ rows: [] as any[] }));
  const acuteSum = Number(acwrRow.rows[0]?.acute_sum) || 0;
  const chronicSum = Number(acwrRow.rows[0]?.chronic_sum) || 0;
  const runs28 = Number(acwrRow.rows[0]?.runs28) || 0;
  const loadAcute7 = acuteSum > 0 ? +(acuteSum / 7).toFixed(2) : 0;
  const loadChronic28 = chronicSum > 0 ? +(chronicSum / 28).toFixed(2) : 0;
  const loadAcwr = (loadChronic28 >= 0.1 && runs28 >= 3)
    ? +(loadAcute7 / loadChronic28).toFixed(2)
    : null;

  const readiness = computeReadiness({
    today, user_id: userId,
    profile: prof ?? null,
    latest_activity: null,
    recentRuns: [],
    weekDone, weekPlanned, phaseLabel, currentWeekDays: [],
    todayWorkout: null,
    nextWorkout: null,
    nextARace: nextARaceName && daysToARace != null
      ? { slug: '', name: nextARaceName, date: '', goal: null, days_to_race: daysToARace }
      : null,
    sleep7Avg, sleep7Deficit, hrvCurrent, hrvBaseline,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    loadAcute7, loadChronic28, loadAcwr,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    activeNiggle: null,  // glance state doesn't pull niggle extras
    pendingIntents: [], shoes: [],
  });

  return {
    today,
    greetingName: prof?.full_name?.split(/\s+/)[0] ?? 'David',
    weekDone, weekPlanned, weekDays, phaseLabel,
    sleep7Avg, sleep7Deficit,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    daysToARace, nextARaceName,
    readiness,
  };
}
