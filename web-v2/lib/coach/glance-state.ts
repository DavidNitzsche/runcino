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

export interface GlanceState {
  today: string;
  greetingName: string;
  weekDone: number;
  weekPlanned: number | null;
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
      const race = (await pool.query(`SELECT meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0];
      const date = race?.meta?.date;
      if (date) {
        daysToARace = Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000);
        nextARaceName = race.meta?.name ?? null;
      }
    }
  }

  // Week done (strava sum)
  const monday = (() => {
    const d = new Date(today + 'T12:00:00Z');
    const dow = d.getUTCDay();
    const shift = dow === 0 ? -6 : 1 - dow;
    return new Date(d.getTime() + shift * 86400000).toISOString().slice(0, 10);
  })();
  const weekRuns = await pool.query(
    `SELECT SUM((data->>'distanceMi')::numeric) AS mi FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL) AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2::text AND $3::text`,
    [userId, monday, today]
  );
  const weekDone = Math.round(Number(weekRuns.rows[0]?.mi ?? 0) * 10) / 10;

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

  const readiness = computeReadiness({
    today, user_id: userId,
    profile: prof ?? null,
    latest_activity: null,
    weekDone, weekPlanned, phaseLabel, currentWeekDays: [],
    nextWorkout: null,
    nextARace: nextARaceName && daysToARace != null
      ? { slug: '', name: nextARaceName, date: '', goal: null, days_to_race: daysToARace }
      : null,
    sleep7Avg, sleep7Deficit, hrvCurrent, hrvBaseline,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    pendingIntents: [], shoes: [],
  });

  return {
    today,
    greetingName: prof?.full_name?.split(/\s+/)[0] ?? 'David',
    weekDone, weekPlanned, phaseLabel,
    sleep7Avg, sleep7Deficit,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    daysToARace, nextARaceName,
    readiness,
  };
}
