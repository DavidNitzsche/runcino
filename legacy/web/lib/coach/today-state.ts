/**
 * today-state · server-side state loader for the TODAY coach briefing.
 *
 * Mirrors the queries from web/scripts/test-daily-briefing.mjs but lives
 * in the Next runtime + returns typed state ready for the daily-briefing
 * function to consume.
 *
 * Principle from docs/coach/PHILOSOPHY.md: feed the coach RICH data + the
 * relevant research; let the coach decide what to surface. This loader
 * gathers everything; the prompt + LLM pick what matters.
 */

import { query } from '../db';

const TZ_OFFSET_FALLBACK_H = -7; // LA fallback; user.timezone overrides

export interface TodayPlanWorkout {
  date: string;       // YYYY-MM-DD
  dow: string;        // 'mon'..'sun'
  type: string;       // 'easy' | 'long' | 'quality' | 'threshold' | ...
  label: string;
  distanceMi: number;
  isRest: boolean;
  paceTargetSPerMi: number | null;
  durationMin: number | null;
}

export interface TodayPlanWeek {
  idx: number;
  phase: string;       // 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'RACE_WEEK'
  startDate: string;
  endDate: string;
  plannedMi: number;
  isCutback: boolean;
  isPeak: boolean;
  isRaceWeek: boolean;
  days: TodayPlanWorkout[];
}

export interface TodayActualRun {
  id: string;
  startLocal: string;    // ISO string
  startHourLocal: number; // 0-23 for time-of-day reference
  distanceMi: number;
  movingTimeS: number;
  paceSPerMi: number;
  avgHr: number | null;
  avgCadence: number | null;
  name: string | null;
  source: string;
}

export interface TodayState {
  /** Date the runner is reading (YYYY-MM-DD in their local TZ). */
  today: string;
  /** Local hour the runner is reading (0-23). */
  localHour: number;
  /** Runner identity. */
  runner: {
    id: string;
    firstName: string;
    sex: 'M' | 'F' | null;
    age: number | null;
  };

  /** Active training plan + weeks. null when no plan. */
  plan: { weeks: TodayPlanWeek[]; raceId: string | null } | null;
  /** This week from the plan. null when no plan or today outside plan. */
  currentWeek: TodayPlanWeek | null;
  /** Previous week. */
  prevWeek: TodayPlanWeek | null;
  /** Today's planned workout (or null on rest days / no plan). */
  todayDay: TodayPlanWorkout | null;
  /** Next chronologically-planned workout after today. */
  nextWorkout: TodayPlanWorkout | null;

  /** Today's actual run if completed; null otherwise. */
  actualToday: TodayActualRun | null;
  /** Total miles banked this week (Strava + watch-completion MAX per day). */
  bankedMi: number;
  /** Last week's banked mi (same MAX-per-day logic). */
  lastWeekBankedMi: number | null;

  /** 7-night sleep history, most recent first. Numeric hours. */
  sleepNights: Array<{ date: string; hours: number }>;
  /** 7-night sleep summary derived from sleepNights. */
  sleepSummary: {
    lastNightH: number | null;
    avg7nH: number | null;
    deficit7nH: number | null;  // vs 7.5h target, never negative
    target_h: number;
  };
  /** Most recent HRV (ms) and RHR (bpm). */
  recovery: {
    hrvMs: number | null;
    restingHrBpm: number | null;
  };

  /** Form baselines derived from health_samples last 60 days. */
  baselines: {
    cadence60d: { mean: number; min: number; max: number; nDays: number } | null;
  };

  /** Today's check-in (energy/soreness/stress 1-5). */
  checkIn: { energy: number | null; soreness: number | null; stress: number | null } | null;

  /** Next race (from the active plan's race_id, fallback to nearest A). */
  nextRace: { slug: string; name: string; date: string; priority: string | null; daysAway: number } | null;

  /** Derived profile values — DO NOT ask the runner for these. */
  derived: {
    maxHr: number | null;
    maxHrSource: 'manual' | 'observed_peak' | 'none';
    restingHr: number | null;
    restingHrSource: 'manual' | 'observed_60d_mean' | 'none';
  };

  /** Genuine profile gaps — fields not in any data source. */
  gaps: Array<{ field: string; impact: string }>;

  /** Recent weight readings (last 4). */
  weightRecent: Array<{ date: string; lb: number }>;

  /** Active coach intents (e.g., cadence_experiment locked in). */
  activeIntents: Array<{ id: string; kind: string; payload: unknown }>;

  /** Terms the runner has already seen a fun_fact for. */
  knownTerms: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function localTodayISO(tzOffsetH: number): string {
  const ms = Date.now() + tzOffsetH * 3600000;
  return new Date(ms).toISOString().slice(0, 10);
}

function localHour(tzOffsetH: number): number {
  const ms = Date.now() + tzOffsetH * 3600000;
  return new Date(ms).getUTCHours();
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

// ─────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────

export async function loadTodayState(userUuid: string, opts?: { tzOffsetH?: number }): Promise<TodayState> {
  const tzOffsetH = opts?.tzOffsetH ?? TZ_OFFSET_FALLBACK_H;
  const today = localTodayISO(tzOffsetH);
  const hour = localHour(tzOffsetH);

  // ── Runner identity ──
  const profRows = await query<{ full_name: string | null; sex: string | null; age: number | null; height_cm: string | null }>(
    `SELECT full_name, sex, age, height_cm FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userUuid],
  );
  const profile = profRows[0] ?? null;
  const firstName = (profile?.full_name ?? '').trim().split(/\s+/)[0] || 'Runner';
  const sex = (profile?.sex === 'M' || profile?.sex === 'F') ? profile.sex : null;
  const age = typeof profile?.age === 'number' ? profile.age : null;
  const heightCm = profile?.height_cm != null ? Number(profile.height_cm) : null;

  // ── Plan + weeks + workouts ──
  const planRows = await query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE (user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me'))
        AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  );
  const planRow = planRows[0] ?? null;

  let plan: TodayState['plan'] = null;
  let currentWeek: TodayPlanWeek | null = null;
  let prevWeek: TodayPlanWeek | null = null;
  let todayDay: TodayPlanWorkout | null = null;
  let nextWorkout: TodayPlanWorkout | null = null;

  if (planRow) {
    const phaseRows = await query<{ label: string; start_week_idx: number; end_week_idx: number }>(
      `SELECT label, start_week_idx, end_week_idx FROM plan_phases WHERE plan_id = $1 ORDER BY start_week_idx`,
      [planRow.id],
    );
    const labelForWeekIdx = (idx: number): string => {
      const p = phaseRows.find((p) => idx >= p.start_week_idx && idx <= p.end_week_idx);
      return p?.label ?? 'BASE';
    };

    const weekRows = await query<{ id: string; week_idx: number; week_start_iso: string; is_cutback: boolean; is_peak: boolean; is_race_week: boolean }>(
      `SELECT id::text, week_idx, week_start_iso, is_cutback, is_peak, is_race_week
         FROM plan_weeks WHERE plan_id = $1 ORDER BY week_idx`,
      [planRow.id],
    );
    const workoutRows = await query<{ week_id: string; date_iso: string; dow: string; type: string; distance_mi: string | null; pace_target_s_per_mi: string | null; duration_min: string | null; sub_label: string | null }>(
      `SELECT week_id::text, date_iso, dow, type, distance_mi, pace_target_s_per_mi, duration_min, sub_label
         FROM plan_workouts WHERE plan_id = $1 ORDER BY date_iso`,
      [planRow.id],
    );

    const woByWeek = new Map<string, TodayPlanWorkout[]>();
    for (const w of workoutRows) {
      const arr = woByWeek.get(w.week_id) ?? [];
      const mi = Number(w.distance_mi) || 0;
      arr.push({
        date: w.date_iso,
        dow: w.dow,
        type: w.type,
        label: w.sub_label || (w.type === 'rest' ? 'REST' : w.type.toUpperCase()),
        distanceMi: mi,
        isRest: w.type === 'rest' || mi === 0,
        paceTargetSPerMi: w.pace_target_s_per_mi != null ? Number(w.pace_target_s_per_mi) : null,
        durationMin: w.duration_min != null ? Number(w.duration_min) : null,
      });
      woByWeek.set(w.week_id, arr);
    }

    const weeks: TodayPlanWeek[] = weekRows.map((w) => {
      const days = (woByWeek.get(w.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const endDate = days.length > 0 ? days[days.length - 1].date : w.week_start_iso;
      const plannedMi = Math.round(days.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
      return {
        idx: w.week_idx,
        phase: labelForWeekIdx(w.week_idx),
        startDate: w.week_start_iso,
        endDate,
        plannedMi,
        isCutback: w.is_cutback,
        isPeak: w.is_peak,
        isRaceWeek: w.is_race_week,
        days,
      };
    });

    plan = { weeks, raceId: planRow.race_id };

    for (let i = 0; i < weeks.length; i++) {
      if (weeks[i].days.some((d) => d.date === today)) {
        currentWeek = weeks[i];
        prevWeek = weeks[i - 1] ?? null;
        todayDay = currentWeek.days.find((d) => d.date === today) ?? null;
        break;
      }
    }
    if (!currentWeek && weeks.length > 0) {
      currentWeek = weeks[weeks.length - 1];
      prevWeek = weeks[weeks.length - 2] ?? null;
    }

    // chronologically next non-rest workout after today
    for (const w of weeks) {
      for (const d of w.days) {
        if (d.date > today && !d.isRest && d.distanceMi > 0) {
          nextWorkout = d;
          break;
        }
      }
      if (nextWorkout) break;
    }
  }

  // ── Today's actual run (strava_activities, unmerged) ──
  type StravaRow = { id: string; data: any; detail: any };
  const todayRunRows = await query<StravaRow>(
    `SELECT id::text, data, detail FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'startLocal') >= $2
        AND (data->>'startLocal') < $3
        AND NOT (data ? 'mergedIntoId')
      ORDER BY (data->>'distanceMi')::numeric DESC LIMIT 1`,
    [userUuid, today, addDays(today, 1)],
  );
  let actualToday: TodayActualRun | null = null;
  if (todayRunRows[0]) {
    const d = todayRunRows[0].data;
    let cadence: number | null = d.avgCadence ?? null;
    if (cadence == null) {
      const cadRows = await query<{ avg_cadence: string }>(
        `SELECT AVG(value)::numeric AS avg_cadence FROM health_samples
          WHERE user_id=$1 AND sample_type='cadence' AND sample_date = $2::date`,
        [userUuid, today],
      ).catch(() => [] as { avg_cadence: string }[]);
      const v = Number(cadRows[0]?.avg_cadence);
      cadence = v > 0 ? v : null;
    }
    const startLocal = d.startLocal as string | undefined;
    const m = (startLocal ?? '').match(/T(\d\d):/);
    actualToday = {
      id: String(todayRunRows[0].id),
      startLocal: startLocal ?? '',
      startHourLocal: m ? Number(m[1]) : 0,
      distanceMi: Number(d.distanceMi) || 0,
      movingTimeS: Number(d.movingTimeS) || 0,
      paceSPerMi: Number(d.paceSPerMi) || 0,
      avgHr: d.avgHr != null ? Number(d.avgHr) : null,
      avgCadence: cadence,
      name: d.name ?? null,
      source: d.source ?? 'strava',
    };
  }

  // ── Week banked: strava unmerged + workout_completions MAX per day ──
  const bankedMi = await sumWeekMi(userUuid, currentWeek?.startDate ?? today, currentWeek?.endDate ?? today);
  const lastWeekBankedMi = prevWeek ? await sumWeekMi(userUuid, prevWeek.startDate, prevWeek.endDate) : null;

  // ── 7-night sleep ──
  const sleepRows = await query<{ sample_date: Date; value: string }>(
    `SELECT sample_date, value FROM health_samples
      WHERE user_id = $1 AND sample_type = 'sleep_hours'
        AND sample_date <= $2::date
      ORDER BY sample_date DESC LIMIT 7`,
    [userUuid, today],
  );
  const sleepNights = sleepRows.map((r) => ({ date: r.sample_date.toISOString().slice(0, 10), hours: Number(r.value) }))
    .filter((s) => s.hours > 0);
  const target_h = 7.5;
  const sleepSummary = sleepNights.length === 0
    ? { lastNightH: null, avg7nH: null, deficit7nH: null, target_h }
    : {
        lastNightH: sleepNights[0].hours,
        avg7nH: Math.round((sleepNights.reduce((s, x) => s + x.hours, 0) / sleepNights.length) * 10) / 10,
        deficit7nH: Math.round(sleepNights.reduce((s, x) => s + Math.max(0, target_h - x.hours), 0) * 10) / 10,
        target_h,
      };

  // ── HRV + RHR ──
  const recRows = await query<{ sample_type: string; value: string }>(
    `SELECT DISTINCT ON (sample_type) sample_type, value
       FROM health_samples
      WHERE user_id = $1
        AND sample_type IN ('hrv','resting_hr')
        AND recorded_at >= ($2::date - interval '2 days')
      ORDER BY sample_type, recorded_at DESC`,
    [userUuid, today],
  );
  const recMap = Object.fromEntries(recRows.map((r) => [r.sample_type, Number(r.value)]));
  const recovery = {
    hrvMs: recMap.hrv ?? null,
    restingHrBpm: recMap.resting_hr ?? null,
  };

  // ── Cadence baseline (60d) ──
  const cadBaseRows = await query<{ mean_cad: string; min_cad: string; max_cad: string; n_days: string }>(
    `SELECT AVG(daily_avg)::numeric AS mean_cad, MIN(daily_avg)::numeric AS min_cad, MAX(daily_avg)::numeric AS max_cad, COUNT(*) AS n_days
       FROM (SELECT sample_date, AVG(value) AS daily_avg
                FROM health_samples
               WHERE user_id = $1 AND sample_type = 'cadence'
                 AND sample_date >= ($2::date - interval '60 days') AND sample_date < $2::date
               GROUP BY sample_date) t`,
    [userUuid, today],
  );
  const cb = cadBaseRows[0];
  const baselines = {
    cadence60d: cb && Number(cb.n_days) > 0 ? {
      mean: Number(cb.mean_cad),
      min: Number(cb.min_cad),
      max: Number(cb.max_cad),
      nDays: Number(cb.n_days),
    } : null,
  };

  // ── Check-in ──
  const ciRows = await query<{ energy: number | null; soreness: number | null; stress: number | null }>(
    `SELECT energy, soreness, stress FROM daily_checkin
      WHERE (user_uuid = $1 OR user_id = 'me') AND date = $2::date
      ORDER BY logged_at DESC LIMIT 1`,
    [userUuid, today],
  ).catch(() => [] as { energy: number | null; soreness: number | null; stress: number | null }[]);
  const checkIn = ciRows[0] ?? null;

  // ── Next race ──
  let nextRace: TodayState['nextRace'] = null;
  if (planRow?.race_id) {
    const rr = await query<{ slug: string; meta: any }>(
      `SELECT slug, meta FROM races WHERE slug = $1 LIMIT 1`,
      [planRow.race_id],
    );
    if (rr[0]) {
      const m = rr[0].meta ?? {};
      const date = (m.date as string) ?? null;
      if (date) {
        nextRace = {
          slug: rr[0].slug,
          name: (m.name as string) ?? rr[0].slug,
          date,
          priority: (m.priority as string) ?? null,
          daysAway: daysBetween(today, date),
        };
      }
    }
  }
  if (!nextRace) {
    const rs = await query<{ slug: string; meta: any }>(
      `SELECT slug, meta FROM races WHERE user_uuid = $1 OR user_uuid IS NULL`,
      [userUuid],
    );
    const upcoming = rs
      .map((r) => ({ slug: r.slug, meta: r.meta ?? {} }))
      .filter((r) => r.meta.date && r.meta.date >= today)
      .sort((a, b) => String(a.meta.date).localeCompare(String(b.meta.date)));
    if (upcoming[0]) {
      const r = upcoming[0];
      nextRace = {
        slug: r.slug,
        name: r.meta.name ?? r.slug,
        date: r.meta.date,
        priority: r.meta.priority ?? null,
        daysAway: daysBetween(today, r.meta.date),
      };
    }
  }

  // ── Derived profile (HRmax + RHR) ──
  const hrmaxRows = await query<{ peak: number | null }>(
    `SELECT GREATEST(
       (SELECT MAX(value)::int FROM health_samples WHERE user_id=$1 AND sample_type='max_hr'),
       (SELECT MAX((data->>'maxHr')::numeric)::int FROM strava_activities WHERE user_uuid=$1 OR user_uuid IS NULL)
     ) AS peak`,
    [userUuid],
  ).catch(() => [{ peak: null }]);
  const rhrRows = await query<{ mean: string | null }>(
    `SELECT AVG(value)::int AS mean FROM health_samples
      WHERE user_id=$1 AND sample_type='resting_hr'
        AND recorded_at >= NOW() - interval '60 days'`,
    [userUuid],
  ).catch(() => [{ mean: null }]);
  const profileRow = profRows[0] ?? null;
  const derived = {
    maxHr: Number(hrmaxRows[0]?.peak) || null,
    maxHrSource: (profileRow?.full_name && (profileRow as any).hrmax) ? ('manual' as const) : (Number(hrmaxRows[0]?.peak) ? ('observed_peak' as const) : ('none' as const)),
    restingHr: Number(rhrRows[0]?.mean) || null,
    restingHrSource: (profileRow as any)?.rhr ? ('manual' as const) : (Number(rhrRows[0]?.mean) ? ('observed_60d_mean' as const) : ('none' as const)),
  };

  // ── Weight trend ──
  const wRows = await query<{ sample_date: Date; value: string }>(
    `SELECT sample_date, value FROM health_samples
      WHERE user_id=$1 AND sample_type='body_mass' ORDER BY sample_date DESC LIMIT 4`,
    [userUuid],
  );
  const weightRecent = wRows.map((r) => ({
    date: r.sample_date.toISOString().slice(0, 10),
    lb: Math.round(Number(r.value) * 2.20462 * 10) / 10,
  }));

  // ── Genuine gaps ──
  const gaps: TodayState['gaps'] = [];
  if (heightCm == null) {
    gaps.push({
      field: 'height',
      impact: 'Cadence research thresholds depend on leg length; until set, the coach defers cadence prescriptions.',
    });
  }

  // ── Active intents + known terms ──
  const intentRows = await query<{ id: string; kind: string; payload: any }>(
    `SELECT id::text, kind, payload FROM coach_intent
      WHERE user_id = $1 AND fulfilled_at IS NULL
        AND (valid_until IS NULL OR valid_until > NOW())
      ORDER BY created_at DESC`,
    [userUuid],
  ).catch(() => [] as { id: string; kind: string; payload: any }[]);

  const ktRows = await query<{ known_terms: string[] | null }>(
    `SELECT known_terms FROM profile
      WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id = 'me')
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userUuid],
  );
  const knownTerms = ktRows[0]?.known_terms ?? [];

  return {
    today,
    localHour: hour,
    runner: { id: userUuid, firstName, sex, age },
    plan,
    currentWeek,
    prevWeek,
    todayDay,
    nextWorkout,
    actualToday,
    bankedMi,
    lastWeekBankedMi,
    sleepNights,
    sleepSummary,
    recovery,
    baselines,
    checkIn,
    nextRace,
    derived,
    gaps,
    weightRecent,
    activeIntents: intentRows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload })),
    knownTerms,
  };
}

async function sumWeekMi(userUuid: string, fromISO: string, toISO: string): Promise<number> {
  const stravaPerDay = await query<{ day: string; mi: string }>(
    `SELECT COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day,
            SUM((data->>'distanceMi')::numeric) AS mi
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) BETWEEN $2 AND $3
      GROUP BY day`,
    [userUuid, fromISO, toISO],
  );
  const wcPerDay = await query<{ day: string; mi: string }>(
    `SELECT LEFT(workout_id, 10) AS day, SUM(total_distance_mi) AS mi
       FROM workout_completions
      WHERE user_id = $1 AND status IN ('completed','partial')
        AND total_distance_mi IS NOT NULL
        AND workout_id ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND LEFT(workout_id, 10) BETWEEN $2 AND $3
      GROUP BY LEFT(workout_id, 10)`,
    [userUuid, fromISO, toISO],
  ).catch(() => [] as { day: string; mi: string }[]);
  const map = new Map<string, number>();
  for (const r of stravaPerDay) if (r.day) map.set(r.day, Number(r.mi) || 0);
  for (const r of wcPerDay) {
    if (!r.day) continue;
    map.set(r.day, Math.max(map.get(r.day) ?? 0, Number(r.mi) || 0));
  }
  return Math.round([...map.values()].reduce((s, x) => s + x, 0) * 10) / 10;
}
