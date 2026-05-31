/**
 * training-state.ts
 *
 * Extra state the TRAINING surface needs beyond the base CoachState:
 *   - All weeks of the active plan (volume arc)
 *   - Phase boundaries
 *   - Last-quality session for "since last check-in" delta
 *
 * Lives separately from state-loader so the TODAY load stays light.
 */
import { pool } from '@/lib/db/pool';
import { loadActivePlan } from '@/lib/plan/lookup';

export interface PlanWeek {
  idx: number;
  phase: string;
  startDate: string;
  plannedMi: number;
  days: Array<{
    date: string; dow: number; type: string;
    mi: number; label: string | null;
    // 2026-05-30: workout_spec jsonb (migration 120) so the train-view week
    // strip can render real Daniels-VDOT paces per day (P0 #4 backfill)
    // instead of the canonical PACE_DEFAULT placeholder.
    spec: import('@/lib/faff/types').WorkoutSpec | null;
    // Actual side (strava activity if logged):
    doneMi: number;
    activityId: string | null;
    // 2026-05-31: actual pace + avg HR for done days so the TrainView's
    // KEY WORKOUTS list can render hit-or-miss vs the planned target
    // ("→ 6:45 actual · Hit" or "→ 7:10 actual · Off pace").
    donePaceSec: number | null;
    doneAvgHr: number | null;
  }>;
  isCurrent: boolean;
}

export interface PlanPhase { label: string; startWeekIdx: number; endWeekIdx: number; }

export interface TrainingState {
  plan_id: string | null;
  today: string;
  race: { slug: string; name: string; date: string; goal: string | null; days_to_race: number } | null;
  phases: PlanPhase[];
  weeks: PlanWeek[];
  currentPhase: string | null;
  currentWeekIdx: number | null;
  nextQuality: { date: string; dow: number; type: string; label: string | null; mi: number } | null;
  weekDone: number;            // strava sum Mon→today for current week
  weekPlanned: number | null;
}

export async function loadTrainingState(userId: string): Promise<TrainingState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  const plan = await loadActivePlan(userId);

  if (!plan) {
    return {
      plan_id: null, today, race: null, phases: [], weeks: [],
      currentPhase: null, currentWeekIdx: null, nextQuality: null,
      weekDone: 0, weekPlanned: null,
    };
  }

  const phases: PlanPhase[] = (await pool.query(
    `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`,
    [plan.id]
  )).rows.map((r: any) => ({ label: r.label, startWeekIdx: r.start_week_idx, endWeekIdx: r.end_week_idx }));

  const weekRows = (await pool.query(
    `SELECT id::text AS id, week_idx, week_start_iso FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
    [plan.id]
  )).rows;
  const workouts = (await pool.query(
    `SELECT week_id::text AS week_id, date_iso, dow, type, distance_mi, sub_label, workout_spec
       FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`,
    [plan.id]
  )).rows;

  const phaseFor = (idx: number) =>
    phases.find((p) => idx >= p.startWeekIdx && idx <= p.endWeekIdx)?.label ?? 'BASE';

  // Pull all strava activities in plan range, indexed by date for fast lookup
  const planRangeStart = weekRows[0]?.week_start_iso;
  const planRangeEnd = weekRows.length
    ? new Date(Date.parse(weekRows[weekRows.length - 1].week_start_iso + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10)
    : today;
  // 2026-05-31: also pull avg pace + HR per activity so the TrainView's
  // milestones list can show hit-or-miss for past quality workouts. We
  // aggregate per (day, activity) and pick the richest payload per day.
  const stravaRows = planRangeStart
    ? (await pool.query(
        `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
                data->>'id' AS activity_id,
                (data->>'distanceMi')::numeric AS mi,
                NULLIF(data->>'paceSPerMi','')::numeric AS pace_sec,
                NULLIF(data->>'avgPaceMinPerMi','')             AS pace_str,
                NULLIF(data->>'movingTimeS','')::numeric AS moving_s,
                NULLIF(data->>'avgHr','')::numeric AS avg_hr
           FROM strava_activities
          WHERE user_uuid = $1 AND NOT (data ? 'mergedIntoId')
            AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2::text AND $3::text`,
        [userId, planRangeStart, planRangeEnd]
      )).rows
    : [];
  function parsePaceStr(s: string | null | undefined): number | null {
    if (!s) return null;
    const m = String(s).match(/^(\d+):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  const actualByDate = new Map<string, { mi: number; id: string | null; paceSec: number | null; avgHr: number | null }>();
  for (const r of stravaRows) {
    const cur = actualByDate.get(r.day) ?? { mi: 0, id: null, paceSec: null, avgHr: null };
    cur.mi += Number(r.mi) || 0;
    if (!cur.id) cur.id = r.activity_id ?? null;
    // Prefer the richer activity's pace + HR. paceSPerMi wins, then
    // string "8:45" parse, then derived from movingTimeS / mi.
    if (cur.paceSec == null) {
      const direct = r.pace_sec != null ? Number(r.pace_sec) : null;
      const fromStr = parsePaceStr(r.pace_str);
      const fromMoving = r.moving_s && r.mi ? Math.round(Number(r.moving_s) / Number(r.mi)) : null;
      cur.paceSec = direct ?? fromStr ?? fromMoving ?? null;
    }
    if (cur.avgHr == null && r.avg_hr != null) cur.avgHr = Math.round(Number(r.avg_hr));
    actualByDate.set(r.day, cur);
  }

  const weeks: PlanWeek[] = weekRows.map((w: any) => {
    const days = workouts
      .filter((x: any) => x.week_id === w.id)
      .sort((a: any, b: any) => a.date_iso.localeCompare(b.date_iso))
      .map((d: any) => {
        const actual = actualByDate.get(d.date_iso);
        return {
          date: d.date_iso, dow: d.dow, type: d.type,
          mi: Number(d.distance_mi) || 0, label: d.sub_label,
          // workout_spec parses as a JS object via node-postgres JSON typecast.
          spec: d.workout_spec ?? null,
          doneMi: actual ? Math.round(actual.mi * 10) / 10 : 0,
          activityId: actual?.id ?? null,
          donePaceSec: actual?.paceSec ?? null,
          doneAvgHr: actual?.avgHr ?? null,
        };
      });
    const plannedMi = Math.round(days.reduce((s, d) => s + d.mi, 0) * 10) / 10;
    const isCurrent = days.some((d) => d.date === today) ||
      (w.week_start_iso <= today &&
       new Date(Date.parse(w.week_start_iso + 'T00:00:00Z') + 7 * 86400000)
         .toISOString().slice(0, 10) > today);
    return {
      idx: w.week_idx,
      phase: phaseFor(w.week_idx),
      startDate: w.week_start_iso,
      plannedMi,
      days,
      isCurrent,
    };
  });

  const current = weeks.find((w) => w.isCurrent);
  const currentPhase = current?.phase ?? null;
  const currentWeekIdx = current?.idx ?? null;

  // Next quality day = first future non-rest, non-easy workout (or first quality session in plan).
  const QUALITY_TYPES = new Set(['threshold', 'tempo', 'intervals', 'long', 'race']);
  const upcoming = workouts
    .filter((w: any) => w.date_iso > today && Number(w.distance_mi) > 0 && QUALITY_TYPES.has(w.type))
    .sort((a: any, b: any) => a.date_iso.localeCompare(b.date_iso))[0];
  const nextQuality = upcoming ? {
    date: upcoming.date_iso, dow: upcoming.dow, type: upcoming.type,
    label: upcoming.sub_label, mi: Number(upcoming.distance_mi) || 0,
  } : null;

  // Week mileage done so far
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
      WHERE user_uuid = $1
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10))
            BETWEEN $2::text AND $3::text
      GROUP BY day`,
    [userId, monday, today]
  );
  const weekDone = Math.round(weekRuns.rows.reduce((s: number, r: any) => s + Number(r.mi), 0) * 10) / 10;
  const weekPlanned = current?.plannedMi ?? null;

  // Race
  let race: TrainingState['race'] = null;
  if (plan.race_id) {
    const raceRow = (await pool.query(`SELECT slug, meta FROM races WHERE slug = $1`, [plan.race_id])).rows[0];
    if (raceRow) {
      const date = raceRow.meta?.date;
      const days_to_race = Math.round(
        (Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000
      );
      race = {
        slug: raceRow.slug, name: raceRow.meta?.name, date,
        goal: raceRow.meta?.goalDisplay ?? null, days_to_race,
      };
    }
  }

  return {
    plan_id: plan.id, today, race, phases, weeks,
    currentPhase, currentWeekIdx, nextQuality, weekDone, weekPlanned,
  };
}
