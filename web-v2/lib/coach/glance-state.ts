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
import { canonicalMileageByDay } from '@/lib/runs/merge';
import { loadActivePlan } from '@/lib/plan/lookup';
import type { WorkoutSpec } from '@/lib/faff/types';

export interface GlanceWeekDay {
  date: string;            // ISO YYYY-MM-DD
  dow: number;             // 0 Sun … 6 Sat
  // Plan side
  /** 2026-06-01 · plan_workouts.id for this row · null on off-plan days.
   *  Required for POST /api/plan/restore (commit d8a4082d) so the
   *  frontend's "Restore original" button can identify the row.
   *  Optional on the type so legacy fixtures (personas, WeekAhead
   *  tests) compile without backfill. */
  plannedId?: string | null;
  plannedMi: number;
  plannedType: string;     // 'easy' | 'rest' | 'long' | 'threshold' | etc.
  plannedLabel: string | null;
  /** Structured per-workout spec (migration 120). null when the plan-builder
   *  authored this row without a VDOT, OR when the workout type has no
   *  structured spec (rest/race/shakeout). Downstream renderers fall back
   *  to the existing label-only render in that case. */
  plannedSpec: WorkoutSpec | null;
  // Actual (strava)
  doneMi: number;
  activityId: string | null;   // → click navigates to /runs/[id]
  // Flags
  isToday: boolean;
  isPast: boolean;
  /** 2026-06-01 · adaptation envelope · web agent brief
   *  adaptation-visibility-backend-brief.md. wasAdapted=true means
   *  THIS specific row was mutated by the auto-adapter (downgrade /
   *  reschedule / shave). Frontend renders "was CRUISE INTERVALS"
   *  sublines + "How it changed" modal section from these fields.
   *  Null on off-plan days (no plan_workouts row). */
  adaptation: {
    wasAdapted: boolean;
    originalType: string | null;
    originalSubLabel: string | null;
    originalDistanceMi: number | null;
    originalDateIso: string | null;
    reason: string | null;
    adaptedAt: string | null;
    kind: 'downgrade' | 'reschedule' | 'shave' | 'mark_dirty' | 'other' | null;
  } | null;
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
  // 2026-05-27 P-AT-A-GLANCE: HRV + ACWR were computed inside this
  // function but not exposed on the interface. The new AtAGlanceCard
  // needs them as tile data, so surface them.
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  loadAcwr: number | null;
  cadenceBaseline: number | null;
  daysToARace: number | null;
  nextARaceName: string | null;
  // Pace-derivation inputs (Phase 47). LTHR + closest upcoming A-race goal →
  // prescriptions.derivePaces() in glance-adapter, so the Poster fallback
  // renders REAL pace/HR (never fixed placeholders) when a workout_spec is
  // absent. null when the runner has no LTHR / no goal race.
  lthr: number | null;
  raceGoalSeconds: number | null;
  raceGoalDistanceMi: number | null;
  readiness: ReadinessBreakdown;
  // Skip Today (P-SKIP, 2026-05-28): runner explicitly tapped SKIP on the
  // poster. Row lives in `day_actions` (migration 114). Distinct from rest
  // (planned), missed (passive), sick/niggle (health). Drives the `skipped`
  // DayState in lib/faff/glance-adapter.ts → resolveDayState().
  todaySkipped: boolean;
  // Niggle + Sick logging (P-NIGGLE-SICK, 2026-05-28). Rows live in
  // `niggles` (mig 116) + `sick_episodes` (mig 117). The active row (most
  // recent WHERE cleared_at IS NULL) drives the `niggle` / `sick` DayState
  // in resolveDayState. days_active is computed from logged_at.
  activeNiggle: {
    id: number;
    body_part: string;
    severity: number;
    side: 'left' | 'right' | 'both' | null;
    status: 'just_started' | 'few_days' | 'weeks';
    logged_at: string;
    days_active: number;
  } | null;
  activeSick: {
    id: number;
    symptoms: string[];
    has_fever: boolean;
    started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
    logged_at: string;
    days_active: number;
  } | null;
  /** 2026-06-01 · per-runner strength day picker output. ISO YYYY-MM-DD
   *  dates for this week (Mon-Sun), 0-2 entries. Empty array = no
   *  strength surfaced (race week, plan dormant, no acceptable slot).
   *  Frontend renders as "+ STRENGTH" annotation on week-strip chips. */
  recommendedStrengthDays: string[];
  /** Full strength recommendation envelope · reason + habit +
   *  coachIntent. Null when the recommender failed (frontend falls back
   *  to its local heuristic). */
  strengthRecommendation: {
    recommendedDays: string[];
    reason: string;
    habit: 'on_track' | 'building' | 'lapsed' | 'dormant' | 'unknown';
    coachIntent: { severity: 'soft' | 'firm' | 'urgent'; body: string } | null;
  } | null;
  /** 2026-06-01 · this-week reconcile of recommendedDays vs logged
   *  strength_sessions (manual + HK). Drives chip summary + per-bucket
   *  arrays for any surface. Null when no recommender output. */
  strengthWeekStatus: {
    weekStartISO: string;
    weekEndISO: string;
    recommended: string[];
    confirmed: Array<{
      date: string; sessionId: number | null;
      source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
      durationMin: number | null; sessionType: string | null;
    }>;
    skipped: string[];
    bonus: Array<{
      date: string; sessionId: number | null;
      source: 'manual' | 'apple_health' | 'watch' | 'strava' | null;
      durationMin: number | null; sessionType: string | null;
    }>;
    summary: string;
  } | null;
}

export async function loadGlanceState(userId: string): Promise<GlanceState> {
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);

  // Profile (just for name)
  const prof = (await pool.query(
    `SELECT full_name, height_cm, lthr FROM profile WHERE user_uuid = $1
      ORDER BY (user_uuid = $1) DESC LIMIT 1`,
    [userId]
  )).rows[0];

  // Active plan summary (memoized — shared across state-loaders)
  const plan = await loadActivePlan(userId);

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
    // Migration 120 · workout_spec is the per-workout JSONB anchor for
    // /runs/[id] WorkoutBreakdown + /today Poster A3 breakdown rows. We
    // pull it here (small per-day payload) so glance-adapter can prefer
    // real Daniels-VDOT numbers over its placeholder strings.
    const planRows = (await pool.query(
      `SELECT id::text AS id, date_iso, dow, type, distance_mi, sub_label, workout_spec FROM plan_workouts
        WHERE plan_id = $1 AND date_iso BETWEEN $2::text AND $3::text`,
      [plan.id, weekDates[0].date, weekDates[6].date]
    )).rows;
    planByDate = new Map<string, any>(planRows.map((r: any) => [r.date_iso, r]));
  }

  // 2026-06-01 · adaptation envelope per workout · web agent brief
  // adaptation-visibility-backend-brief.md. Loaded once per request
  // (single LATERAL join query) · attached to each GlanceWeekDay below.
  const adaptationByWorkoutId = plan
    ? await (async () => {
        try {
          const { loadAdaptationInfoByPlanIds } = await import('./adaptation-info');
          return await loadAdaptationInfoByPlanIds([plan.id]);
        } catch { return new Map(); }
      })()
    : new Map();

  // Strava actuals — ALWAYS loaded, with or without an active plan, so the
  // week strip + TodayPlannedCard always show real runs.
  //
  // 2026-05-27 P-DOUBLECOUNT: query-time dedupe via canonicalMileageByDay
  // so un-flagged duplicate rows don't inflate. David hit "31.6 done"
  // in the strip vs /log's correct "19.6" because Mon/Tue/Wed each had
  // one extra un-merged row and this loop was summing them all. Now
  // each day's mi is the sum of CANONICAL runs (one per physical
  // workout cluster) so the strip agrees with /log.
  const canonicalByDay = await canonicalMileageByDay(
    userId, weekDates[0].date, weekDates[6].date,
  );
  // Still need a per-day activity_id for click-through to the run modal.
  // Fetch the canonical IDs from canonicalByDay and resolve the first
  // one's data->>'id' (the public Strava id) from strava_activities.
  const allCanonicalIds = Array.from(canonicalByDay.values()).flatMap((v) => v.canonicalIds);
  const idLookup = allCanonicalIds.length > 0
    ? (await pool.query(
        `SELECT id::text AS row_id, data->>'id' AS strava_id,
                COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) AS day
           FROM runs
          WHERE id::text = ANY($1::text[])`,
        [allCanonicalIds],
      )).rows
    : [];
  const idByRow = new Map<string, { strava_id: string | null; day: string }>(
    idLookup.map((r: any) => [String(r.row_id), { strava_id: r.strava_id ?? null, day: r.day }]),
  );
  const actualByDate = new Map<string, { mi: number; id: string | null }>();
  for (const [day, info] of canonicalByDay) {
    // Pick first canonical's public id (any will do — they're all canonical
    // representatives of separate workouts; for a single-workout day there's
    // only one).
    const firstRow = info.canonicalIds[0];
    const stravaId = firstRow ? (idByRow.get(firstRow)?.strava_id ?? firstRow) : null;
    actualByDate.set(day, { mi: info.mi, id: stravaId });
  }

  weekDays = weekDates.map(({ date, dow }) => {
    const planRow = planByDate.get(date);
    const actual = actualByDate.get(date);
    // workout_spec lands as a parsed object via node-postgres JSON typecast;
    // narrow to WorkoutSpec | null. The adapter validates spec.kind matches
    // the day-state before using it (guards against a stale spec left by
    // an updateWorkout that didn't refresh the column).
    const plannedSpec: WorkoutSpec | null = planRow?.workout_spec ?? null;
    // 2026-06-01 · attach the adaptation envelope. Lookup by the
    // plan_workouts.id stamped onto each row · null when no plan
    // row exists for this date (off-plan days).
    const adaptation = planRow?.id
      ? (adaptationByWorkoutId.get(planRow.id) ?? null)
      : null;
    return {
      date, dow,
      plannedId: planRow?.id ?? null,
      plannedMi: planRow ? Number(planRow.distance_mi) || 0 : 0,
      // When no plan, default to a neutral "—" type (NOT "rest") so the
      // TodayPlannedCard doesn't mislabel a run-day as a rest day.
      plannedType: planRow?.type ?? (plan ? 'rest' : 'unplanned'),
      plannedLabel: planRow?.sub_label ?? null,
      plannedSpec,
      doneMi: actual ? Math.round(actual.mi * 10) / 10 : 0,
      activityId: actual?.id ?? null,
      isToday: date === today,
      isPast: date < today,
      adaptation,
    };
  });

  // Week done — sum from weekDays we already loaded
  const weekDone = Math.round(weekDays.reduce((s, d) => s + d.doneMi, 0) * 10) / 10;

  // Sleep
  const sleep = (await pool.query(
    `SELECT value FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours' AND sample_date <= $2::date
      ORDER BY sample_date DESC LIMIT 7`,
    [userId, today]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const sleep7Avg = sleep.length ? +(sleep.reduce((s, x) => s + x, 0) / sleep.length).toFixed(1) : null;
  const sleep7Deficit = +sleep.reduce((s, x) => s + Math.max(0, 7.5 - x), 0).toFixed(1);

  // RHR
  const rhr = (await pool.query(
    `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
       AND recorded_at >= NOW() - interval '60 days' ORDER BY recorded_at DESC LIMIT 14`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const rhrCurrent = rhr[0] ?? null;
  const rhrBaseline = rhr.length ? Math.round(rhr.reduce((s, x) => s + x, 0) / rhr.length) : null;

  // HRV
  // 2026-05-29 (anti-staleness): bound to a 60-day recency window like RHR
  // above. Without it, a lapsed HealthKit sync left `current` and the
  // 30-sample `baseline` drawn from the same stale era → pct≈0, so HRV
  // silently contributed a neutral value at its full 25% weight and diluted
  // the real signal. With the window, a stale-only history yields no samples
  // → hrvCurrent null → readiness drops HRV to weight 0 ("no data") and
  // re-weights the remaining pillars (see readiness.ts §HRV).
  const hrv = (await pool.query(
    `SELECT value FROM health_samples WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hrv'
       AND recorded_at >= NOW() - interval '60 days'
       ORDER BY recorded_at DESC LIMIT 30`,
    [userId]
  )).rows.map((r: any) => Number(r.value)).filter((v: number) => v > 0);
  const hrvCurrent = hrv[0] ?? null;
  const hrvBaseline = hrv.length ? Math.round(hrv.reduce((s, x) => s + x, 0) / hrv.length) : null;

  // Cadence
  const cad = (await pool.query(
    `SELECT AVG(value)::numeric AS avg FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'cadence' AND sample_date >= ($2::date - interval '60 days')`,
    [userId, today]
  )).rows[0];
  const cadenceBaseline = cad?.avg ? Math.round(Number(cad.avg)) : null;

  // 2026-06-01 · HR recovery now wired here too. Previously hardcoded
  // to null (the "fast path" excuse) which made the Health page show
  // "no data" while the slide-out brief (which uses loadCoachState)
  // showed the real value. Two surfaces, same metric, different
  // numbers · the kind of split-brain inconsistency the dedup
  // doctrine bans. Same query shape as state-loader.ts:237.
  const hrRecRows = (await pool.query(
    `SELECT value FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hr_recovery'
        AND recorded_at >= NOW() - interval '30 days'
      ORDER BY recorded_at DESC LIMIT 30`,
    [userId]
  )).rows.map((r: { value: number | string }) => Number(r.value)).filter((v: number) => v > 0);
  const hrRecoveryCurrent = hrRecRows[0] ?? null;
  const hrRecoveryBaseline = hrRecRows.length
    ? Math.round(hrRecRows.reduce((s: number, x: number) => s + x, 0) / hrRecRows.length)
    : null;

  // Recent check-ins
  const checkIns = await pool.query(
    `SELECT ts, rating FROM check_ins WHERE COALESCE(user_uuid, user_id) = $1 AND ts >= NOW() - interval '7 days'
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
       FROM runs
      WHERE user_uuid = $2
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric > 0.3`,
    [today, userId]
  ).catch(() => ({ rows: [] as any[] }));
  let acuteSum = Number(acwrRow.rows[0]?.acute_sum) || 0;
  let chronicSum = Number(acwrRow.rows[0]?.chronic_sum) || 0;
  const runs28 = Number(acwrRow.rows[0]?.runs28) || 0;
  // 2026-06-01 · fold strength_sessions into ACWR. Same conversion +
  // rationale as state-loader · see lib/coach/strength-load.ts.
  try {
    const { strengthLoadByDay } = await import('@/lib/coach/strength-load');
    const fromISO = new Date(Date.parse(today + 'T00:00:00Z') - 28 * 86400000).toISOString().slice(0, 10);
    const acuteFromISO = new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    const strengthByDay = await strengthLoadByDay(userId, fromISO, today);
    for (const [day, miEquiv] of strengthByDay) {
      chronicSum += miEquiv;
      if (day >= acuteFromISO) acuteSum += miEquiv;
    }
  } catch (e) {
    console.warn('[glance-state] strength-load fold failed:', e instanceof Error ? e.message : String(e));
  }
  const loadAcute7 = acuteSum > 0 ? +(acuteSum / 7).toFixed(2) : 0;
  const loadChronic28 = chronicSum > 0 ? +(chronicSum / 28).toFixed(2) : 0;
  const loadAcwr = (loadChronic28 >= 0.1 && runs28 >= 3)
    ? +(loadAcute7 / loadChronic28).toFixed(2)
    : null;

  // Skip Today (P-SKIP, 2026-05-28). One-row point read against day_actions
  // (migration 114). Index on (user_id, date_iso, action) makes this ~O(1).
  // If the table doesn't exist yet (migration not applied) we default to
  // false so the loader doesn't hard-fail.
  const skipRow = await pool.query(
    `SELECT 1 FROM day_actions
      WHERE COALESCE(user_uuid, user_id) = $1 AND date_iso = $2 AND action = 'skip' LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] as any[] }));
  const todaySkipped = skipRow.rows.length > 0;

  // Niggle + Sick (P-NIGGLE-SICK, 2026-05-28). Two LIMIT-1 point reads
  // against migrations 116/117. Partial indexes on (user_id, logged_at DESC)
  // WHERE cleared_at IS NULL keep this ~O(1). Silent degrade to null if
  // tables don't exist yet so the loader doesn't hard-fail.
  const niggleRow = await pool.query(
    `SELECT id, body_part, side, severity, status, logged_at,
            EXTRACT(EPOCH FROM (now() - logged_at)) / 86400.0 AS days_active
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const activeNiggle = niggleRow.rows[0]
    ? {
        id: Number(niggleRow.rows[0].id),
        body_part: String(niggleRow.rows[0].body_part),
        severity: Number(niggleRow.rows[0].severity),
        side: niggleRow.rows[0].side ?? null,
        status: niggleRow.rows[0].status,
        logged_at: new Date(niggleRow.rows[0].logged_at).toISOString(),
        days_active: Math.floor(Number(niggleRow.rows[0].days_active) || 0),
      }
    : null;

  const sickRow = await pool.query(
    `SELECT id, symptoms, started, has_fever, logged_at,
            EXTRACT(EPOCH FROM (now() - logged_at)) / 86400.0 AS days_active
       FROM sick_episodes
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as any[] }));
  const activeSick = sickRow.rows[0]
    ? {
        id: Number(sickRow.rows[0].id),
        symptoms: Array.isArray(sickRow.rows[0].symptoms)
          ? sickRow.rows[0].symptoms
          : [],
        has_fever: Boolean(sickRow.rows[0].has_fever),
        started: sickRow.rows[0].started,
        logged_at: new Date(sickRow.rows[0].logged_at).toISOString(),
        days_active: Math.floor(Number(sickRow.rows[0].days_active) || 0),
      }
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
    // 2026-06-01 · was hardcoded null (fast-path excuse) · split-brain
    // with state-loader (loadReadinessBrief) which loaded the real
    // values. Now wired the same query as state-loader.ts so both
    // surfaces show the same number for the same metric.
    hrRecoveryCurrent, hrRecoveryBaseline,
    loadAcute7, loadChronic28, loadAcwr,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    activeNiggle: null,  // glance state doesn't pull niggle extras
    pendingIntents: [], shoes: [],
  });

  // Pace-derivation inputs (Phase 47 · /today fallback). LTHR + the closest
  // upcoming A-race goal feed prescriptions.derivePaces() in the adapter so
  // the Poster shows REAL pace/HR when a per-workout spec is absent — instead
  // of fixed, fitness-agnostic placeholder strings. Mirrors the profile+race
  // reads in GET /api/prescription so the two paths agree.
  const lthr = prof?.lthr != null ? Number(prof.lthr) : null;
  let raceGoalSeconds: number | null = null;
  let raceGoalDistanceMi: number | null = null;
  {
    const goalRow = (await pool.query(
      `SELECT meta FROM races
        WHERE user_uuid = $1
          AND meta->>'priority' = 'A'
          AND meta->>'goalDisplay' IS NOT NULL
          AND (meta->>'date')::date >= $2::date
        ORDER BY (meta->>'date') ASC LIMIT 1`,
      [userId, today]
    ).catch(() => ({ rows: [] as any[] }))).rows[0];
    const meta = goalRow?.meta ?? {};
    const gd = String(meta.goalDisplay ?? '').match(/^(\d+):(\d{2}):(\d{2})$/);
    if (gd) raceGoalSeconds = (+gd[1]) * 3600 + (+gd[2]) * 60 + (+gd[3]);
    if (meta.distanceMi) {
      raceGoalDistanceMi = Number(meta.distanceMi);
    } else {
      const dl = String(meta.distanceLabel ?? '').toLowerCase();
      if (dl.includes('marathon') && !dl.includes('half')) raceGoalDistanceMi = 26.2;
      else if (dl.includes('half') || dl.includes('21k')) raceGoalDistanceMi = 13.1;
      else if (dl.includes('10k')) raceGoalDistanceMi = 6.2;
      else if (dl.includes('5k')) raceGoalDistanceMi = 3.1;
    }
  }

  // 2026-06-01 · strength-day recommender (web agent brief
  // strength-recommender-backend-brief.md). Replaces the frontend's
  // pure-week-shape pickStrengthDays() heuristic. Computed off the
  // Mon-Sun week (weekDays[0].date is the Monday). Best-effort · null
  // when plan or signals aren't available, frontend falls back to its
  // local heuristic.
  let strengthRecommendation: import('./strength-recommender').StrengthRecommendation | null = null;
  let strengthWeekStatus: import('./strength-status').StrengthWeekStatus | null = null;
  try {
    const {
      recommendStrengthDays,
      emitStrengthCoachIntent,
      emitStrengthSkipIntent,
      emitStrengthResumeIntent,
    } = await import('./strength-recommender');
    const { loadStrengthWeekStatus } = await import('./strength-status');
    const weekStartISO = weekDays[0]?.date;
    if (weekStartISO) {
      strengthRecommendation = await recommendStrengthDays(userId, weekStartISO);
      // Fire-and-forget · all three are idempotent.
      //   · dormant habit → "you haven't lifted in 24 days" intent
      //   · readiness suppress/cap → "we skipped strength today" intent
      //   · signals normalized after a skip → "strength resumes today" intent
      void emitStrengthCoachIntent(userId, strengthRecommendation);
      void emitStrengthSkipIntent(userId, strengthRecommendation);
      void emitStrengthResumeIntent(userId, strengthRecommendation);
      // 2026-06-01 · scheduled-vs-actual reconcile · diff recommendedDays
      // against logged strength_sessions (manual + HK-imported). Drives
      // the "2/2 this week + 1 bonus" chip + the briefing summary.
      strengthWeekStatus = await loadStrengthWeekStatus(
        userId, weekStartISO, strengthRecommendation.recommendedDays,
      );
    }
  } catch (e) {
    console.warn('[glance-state] strength-recommender failed:', e instanceof Error ? e.message : String(e));
  }

  return {
    today,
    greetingName: prof?.full_name?.split(/\s+/)[0] ?? 'David',
    weekDone, weekPlanned, weekDays, phaseLabel,
    sleep7Avg, sleep7Deficit,
    rhrCurrent, rhrBaseline,
    hrvCurrent, hrvBaseline,
    loadAcwr,
    cadenceBaseline,
    daysToARace, nextARaceName,
    lthr, raceGoalSeconds, raceGoalDistanceMi,
    readiness,
    todaySkipped,
    activeNiggle,
    activeSick,
    /** 2026-06-01 · strength-recommender output. recommendedStrengthDays
     *  is the chip-annotation array (web agent's primary consumer);
     *  strengthRecommendation carries the full envelope (reason, habit,
     *  coachIntent) for the briefing surface. */
    recommendedStrengthDays: strengthRecommendation?.recommendedDays ?? [],
    strengthRecommendation,
    /** 2026-06-01 · this-week reconcile of recommendedDays vs actual
     *  logged sessions (manual + HK-imported). Drives the "2/2 this
     *  week" summary chip + confirmed/skipped/bonus arrays for any
     *  surface that wants to render them. Null when the recommender
     *  hasn't produced a week start (cold path). */
    strengthWeekStatus,
  };
}
