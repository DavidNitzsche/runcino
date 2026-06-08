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
import { runnerToday } from '@/lib/runtime/runner-tz';
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
  /**
   * E5 · how TODAY's completed run actually went vs what was prescribed.
   * Drives the done-state copy in glance-adapter (resolveDayState +
   * poster/sibling) so a missed or abandoned session no longer reads
   * "NAILED IT". Derived from the frozen watch-completion phases (same
   * source as loadPhaseBreakdown), not doneMi alone — Jun 2 ran the planned
   * mileage but missed 2 of 4 reps, invisible to a distance check.
   *   · 'nailed' — ran today, hit the work (or no negative signal / non-watch)
   *   · 'short'  — the WORK (quality) block was cut short (a work phase didn't
   *               complete) or missed pace. Cutting only a warmup/cooldown
   *               short does NOT count — the quality is what defines the session
   *   · 'over'   — ran ≥1.25× the planned distance (the deferred ease-off case)
   *   · null     — no run logged today (the done-state isn't active)
   * Optional: loadGlanceState always sets it for real data; minimal fixtures
   * (personas) omit it and consumers treat absent as "no signal" (→ nailed).
   */
  todayExecution?: 'nailed' | 'short' | 'over' | null;
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

/**
 * E5 · classify how TODAY's completed run went vs the prescription.
 * Reads the frozen watch-completion phases (same field-date query as
 * loadPhaseBreakdown / the recap route) so a missed-rep session is caught
 * even when total mileage matched the plan. Cold-start / non-watch / no-phase
 * runs default to 'nailed' (a logged run with no negative signal). Returns
 * null when there's no run today, so the done-state simply isn't active.
 *
 * Only WORK phases count — cutting a warmup/cooldown short (status='abandoned'
 * during the CD) is not "coming up short" on the session. Threshold (tunable
 * coach judgment): 'short' when a work phase didn't complete, or ≥ ~1/3 of the
 * ran work phases missed pace — flags Jun 2 (2 of 4) while leaving a single
 * off-rep in a long set as still "nailed".
 */
async function computeTodayExecution(
  userId: string,
  today: string,
  todayRow: GlanceWeekDay | undefined,
): Promise<'nailed' | 'short' | 'over' | null> {
  if (!todayRow || todayRow.doneMi < 0.5) return null; // no run today
  const row = (await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'watch_completion'
        AND (CASE WHEN field LIKE '%-____-__-__' THEN RIGHT(field, 10) = $2 ELSE ts::date = $2::date END)
      ORDER BY ts DESC LIMIT 1`,
    [userId, today],
  ).catch(() => ({ rows: [] }))).rows[0];

  const overreach = todayRow.plannedMi > 0 && todayRow.doneMi >= todayRow.plannedMi * 1.25;

  if (row?.value) {
    let payload: unknown = row.value;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
    const p = payload as { phases?: Array<Record<string, unknown>> } | null;
    // Only the WORK (quality) phases define the session. Cutting a warmup or
    // cooldown short (status='abandoned' during the CD) is NOT "coming up
    // short" — David's call. 'short' fires when the quality block itself was
    // cut short (a work phase didn't complete) or missed pace.
    const workPhases = (Array.isArray(p?.phases) ? p!.phases : []).filter((ph) => ph.type === 'work');
    const workCutShort = workPhases.some((ph) => ph.completed === false);
    const ranWork = workPhases.filter((ph) => Number(ph.targetPaceSPerMi) > 0 && Number(ph.actualPaceSPerMi) > 0);
    const missed = ranWork.filter((ph) => {
      const v = String(ph.verdict ?? '').toLowerCase();
      if (v === 'missed' || v === 'slow') return true;
      // Verdict-absent fallback: actual slower than target + 12 s/mi.
      return Number(ph.actualPaceSPerMi) > Number(ph.targetPaceSPerMi) + 12;
    }).length;
    if (workCutShort || (ranWork.length > 0 && missed / ranWork.length >= 0.34)) return 'short';
  }
  // No negative signal from the phases → overreach (volume) or a clean hit.
  return overreach ? 'over' : 'nailed';
}

export async function loadGlanceState(userId: string): Promise<GlanceState> {
  // 2026-06-03 · runner TZ instead of the old UTC-minus-7-hour Pacific
  // hack. Now uses profile.timezone which handles DST + non-Pacific
  // runners + travel automatically.
  const today = await runnerToday(userId);

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

  // RHR + HRV — STABLE BASELINE per the 2026-06-03 unification.
  //
  // current = today's daily-avg value · baseline = mean of last 30
  // days EXCLUDING the recent 7. The 7-day exclusion stops the
  // comparator from drifting with the runner · a 5-day RHR streak
  // pulls the rolling-14 baseline up so the pillar always reads
  // "at baseline" even when the runner is genuinely elevated above
  // their settled state. Same definition as state-loader.ts
  // (loadStableBaseline) and the forecasts engine · keeps the
  // driver row, BODY tile, and WATCHING TOMORROW forecast on the
  // same number. Previously: driver row used LIMIT 14 here (got 51),
  // BODY tile + forecast used the stable form (got 45) · same metric,
  // two numbers, one page.
  const loadStableBaseline = async (sampleType: string): Promise<{ current: number | null; baseline: number | null }> => {
    const rows = (await pool.query<{ d: string; v: number | string }>(
      `SELECT recorded_at::date::text AS d, AVG(value)::numeric AS v
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = $2
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY recorded_at::date
        ORDER BY d ASC`,
      [userId, sampleType]
    ).catch(() => ({ rows: [] as Array<{ d: string; v: number | string }> }))).rows;
    const vals = rows.slice(-30).map((r) => Math.round(Number(r.v))).filter((v) => v > 0);
    if (vals.length === 0) return { current: null, baseline: null };
    const current = vals.at(-1) ?? null;
    const baseline = vals.length >= 14
      ? Math.round(vals.slice(0, -7).reduce((s, x) => s + x, 0) / Math.max(1, vals.length - 7))
      : Math.round(vals.reduce((s, x) => s + x, 0) / vals.length);
    return { current, baseline };
  };
  const rhrSt = await loadStableBaseline('resting_hr');
  const rhrCurrent = rhrSt.current;
  const rhrBaseline = rhrSt.baseline;
  const hrvSt = await loadStableBaseline('hrv');
  const hrvCurrent = hrvSt.current;
  const hrvBaseline = hrvSt.baseline;

  // Cadence 60d baseline. Cluster 3: prefer runs.data.avgCadence over
  // health_samples.cadence (writing stopped 2026-05-25; falls null ~49d
  // from now). Same COALESCE pattern as health-state.ts.
  const cad = (await pool.query(
    `WITH run_cadence AS (
       SELECT AVG((data->>'avgCadence')::numeric)::numeric AS avg
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND data->>'avgCadence' IS NOT NULL
          AND (data->>'avgCadence')::numeric BETWEEN 130 AND 220
          AND (data->>'date')::date >= ($2::date - interval '60 days')
     ),
     hk_cadence AS (
       SELECT AVG(value)::numeric AS avg FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'cadence'
          AND sample_date >= ($2::date - interval '60 days')
     )
     SELECT COALESCE(rc.avg, hc.avg) AS avg
       FROM run_cadence rc, hk_cadence hc`,
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

  // ACWR for LOAD pillar — Gabbett's Acute:Chronic Workload Ratio.
  //   acute7    = avg daily distance over last 7 days  (mi/day)
  //   chronic28 = avg daily distance over last 28 days (mi/day)
  //
  // 2026-06-03 · pulled through canonicalMileageByDay (matches state-
  // loader.ts pattern). Raw SUM(distanceMi) inflated David's ACWR to
  // 1.60 because mergedIntoId-less duplicate rows from watch+Strava
  // double-counted. canonicalMileageByDay clusters by (date, distance
  // ±15%, duration ±20%) and picks one canonical row per cluster — same
  // dedupe the Readiness drawer uses (which read 0.97). Three Health-
  // page surfaces had three different ACWR numbers before this fix.
  const acwrFrom = new Date(Date.parse(today + 'T12:00:00Z') - 28 * 86400000)
    .toISOString().slice(0, 10);
  const acuteCutoff = new Date(Date.parse(today + 'T12:00:00Z') - 7 * 86400000)
    .toISOString().slice(0, 10);
  const canonicalAcwr = await canonicalMileageByDay(userId, acwrFrom, today);
  let acuteSum = 0;
  let chronicSum = 0;
  let runs28 = 0;
  for (const [day, info] of canonicalAcwr) {
    if (info.mi <= 0.3) continue;
    chronicSum += info.mi;
    runs28 += info.canonicalIds.length;
    if (day > acuteCutoff) acuteSum += info.mi;
  }
  // 2026-06-01 · fold strength_sessions into ACWR. Same conversion +
  // rationale as state-loader · see lib/coach/strength-load.ts.
  try {
    const { strengthLoadByDay } = await import('@/lib/coach/strength-load');
    const strengthByDay = await strengthLoadByDay(userId, acwrFrom, today);
    for (const [day, miEquiv] of strengthByDay) {
      chronicSum += miEquiv;
      if (day > acuteCutoff) acuteSum += miEquiv;
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
      ? {
          slug: '', name: nextARaceName, date: '', goal: null,
          days_to_race: daysToARace,
          // 2026-06-03 · glance fast-path skips the distance lookup ·
          // the brief envelope (state-loader) carries the real value.
          distanceMi: null,
          distanceLabel: null,
        }
      : null,
    sleep7Avg, sleep7Deficit, hrvCurrent, hrvBaseline,
    rhrCurrent, rhrBaseline, cadenceBaseline,
    // 2026-06-01 · was hardcoded null (fast-path excuse) · split-brain
    // with state-loader (loadReadinessBrief) which loaded the real
    // values. Now wired the same query as state-loader.ts so both
    // surfaces show the same number for the same metric.
    hrRecoveryCurrent, hrRecoveryBaseline,
    loadAcute7, loadChronic28, loadAcwr,
    // 2026-06-01 · glance state is the fast-path · skip the cycle DB
    // query (state-loader does it for the brief). Luteal adjustment
    // only matters for the morning brief score · glance shows the raw
    // pillars, not the score, so this default is honest.
    biologicalSex: 'not_specified' as const,
    cyclePhase: null,
    recentCheckIns: checkIns.rows.map((r: any) => ({ ts: r.ts, rating: r.rating })),
    activeNiggle: null,  // glance state doesn't pull niggle extras
    pendingIntents: [], shoes: [],
    // 2026-06-03 · Today screen post-run pivot · glance-state is a
    // FAST-PATH variant of state-loader (skips heavy reads). Default
    // false here · the dedicated /api/coach/recovery-brief endpoint
    // re-queries via the full state-loader, which DOES compute these.
    todayRunDone: false,
    todayRunLong: false,
    // 2026-06-03 · voice band null on the fast path · morning brief
    // composer falls back to 'guided' (safe default) when null.
    voiceBand: null,
    // 2026-06-03 · phase focus null on the fast path · iPhone reads
    // from the full state-loader path (e.g. /api/coach/today) when
    // it needs the authored copy.
    phase: null,
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
    // 2026-06-03 · use the canonical parser · was a strict H:MM:SS regex
    // that silently dropped "1:30" goals (David's AFC race) · cascaded
    // into null pace targets across the glance + breakdown surfaces.
    const { parseRaceTime } = await import('@/lib/training/vdot');
    raceGoalSeconds = parseRaceTime(meta.goalDisplay);
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

  // E5 · classify how today's run went (frozen phases) → done-state copy.
  const todayExecution = await computeTodayExecution(userId, today, weekDays.find((d) => d.isToday));

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
    todayExecution,
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
