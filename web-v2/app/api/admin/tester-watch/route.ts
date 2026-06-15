/**
 * GET /api/admin/tester-watch
 *
 * Admin diagnostic: snapshot of all non-admin user accounts — onboarding
 * state, plan shape, doctrine checks, last-seen. Used by docs/tester-watch.html.
 *
 * Optional ?email=foo@bar.com to narrow to one user.
 * Returns CORS headers so the local HTML file can hit Railway prod directly.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) {
    // Attach CORS so the browser sees the 403 body, not an opaque network error
    const r = auth;
    Object.entries(CORS).forEach(([k, v]) => r.headers.set(k, v));
    return r;
  }

  const emailFilter = req.nextUrl.searchParams.get('email');

  try {
  // ── 1. Users (exclude admin) ─────────────────────────────────────────────
  const usersQ = await pool.query<{
    id: string; email: string; name: string; created_at: string; is_admin: boolean;
  }>(
    `SELECT id, email, name, created_at, COALESCE(is_admin, false) AS is_admin
     FROM users
     WHERE COALESCE(is_admin, false) = false
       AND ($1::text IS NULL OR email = $1)
     ORDER BY created_at DESC`,
    [emailFilter ?? null],
  );

  const users = usersQ.rows;
  if (!users.length) {
    return NextResponse.json({ testers: [] }, { headers: CORS });
  }

  const uuids = users.map((u) => u.id);

  // ── 2. Profiles ──────────────────────────────────────────────────────────
  const profilesQ = await pool.query(
    `SELECT user_uuid,
            goal_race_distance, goal_race_date, goal_race_time,
            tt_goal_distance, tt_goal_time,
            weekly_frequency, weekly_mileage_target,
            history_avg_weekly_mi, history_longest_recent_mi, history_years_running,
            timezone, onboarding_completed_at, connections_skipped,
            hrmax, rhr, weight_kg, experience_level
     FROM profile WHERE user_uuid = ANY($1)`,
    [uuids],
  );
  const profileMap = Object.fromEntries(profilesQ.rows.map((r: any) => [r.user_uuid, r]));

  // ── 3. Latest active plan per user ───────────────────────────────────────
  const plansQ = await pool.query(
    `SELECT tp.id, tp.user_uuid, tp.mode, tp.authored_iso, tp.goal_iso,
            tp.authored_state->>'intent'       AS intent,
            tp.authored_state->>'anchorVdot'   AS anchor_vdot,
            tp.authored_state->>'anchorSource' AS anchor_source,
            (SELECT label FROM plan_phases WHERE plan_id = tp.id ORDER BY start_week_idx LIMIT 1) AS phase_label,
            COUNT(DISTINCT plw.id) AS week_count,
            COUNT(pw.id) FILTER (WHERE pw.distance_mi > 0) AS total_run_days,
            ROUND(SUM(pw.distance_mi) FILTER (WHERE pw.distance_mi > 0)) AS total_plan_mi,
            ROUND(MAX(pw.distance_mi)) AS peak_long_run_mi,
            ROUND(AVG(pw.distance_mi) FILTER (WHERE pw.distance_mi > 0)) AS avg_run_mi
     FROM training_plans tp
     LEFT JOIN plan_weeks plw ON plw.plan_id = tp.id
     LEFT JOIN plan_workouts pw ON pw.week_id = plw.id
     WHERE tp.user_uuid = ANY($1) AND tp.archived_iso IS NULL
     GROUP BY tp.id, tp.user_uuid, tp.mode, tp.authored_iso, tp.goal_iso
     ORDER BY tp.authored_iso DESC`,
    [uuids],
  );
  // One plan per user (latest)
  const planMap: Record<string, any> = {};
  for (const p of plansQ.rows) {
    if (!planMap[p.user_uuid]) planMap[p.user_uuid] = p;
  }

  // ── 4. Weekly mileage ramp (first 4 weeks) ──────────────────────────────
  const planIds = Object.values(planMap).map((p: any) => p?.id).filter(Boolean);
  const rampMap: Record<string, number[]> = {};
  if (planIds.length) {
    const rampQ = await pool.query(
      `SELECT plw.plan_id, plw.week_idx,
              ROUND(SUM(pw.distance_mi) FILTER (WHERE pw.distance_mi > 0)) AS week_mi
       FROM plan_weeks plw
       JOIN plan_workouts pw ON pw.week_id = plw.id
       WHERE plw.plan_id = ANY($1) AND plw.week_idx <= 4
       GROUP BY plw.plan_id, plw.week_idx
       ORDER BY plw.plan_id, plw.week_idx`,
      [planIds],
    );
    for (const r of rampQ.rows) {
      if (!rampMap[r.plan_id]) rampMap[r.plan_id] = [];
      rampMap[r.plan_id].push(Number(r.week_mi));
    }
  }

  // ── 5. Last session (last seen) ──────────────────────────────────────────
  const sessionsQ = await pool.query(
    `SELECT user_uuid, MAX(last_used_at) AS last_seen
     FROM sessions WHERE user_uuid = ANY($1) GROUP BY user_uuid`,
    [uuids],
  );
  const sessionMap = Object.fromEntries(sessionsQ.rows.map((r: any) => [r.user_uuid, r.last_seen]));

  // ── 6. Strava/HK connection status ───────────────────────────────────────
  const connQ = await pool.query(
    `SELECT user_uuid,
            strava_connected_at IS NOT NULL AS strava,
            health_connected_at IS NOT NULL AS healthkit
     FROM profile WHERE user_uuid = ANY($1)`,
    [uuids],
  );
  const connMap = Object.fromEntries(connQ.rows.map((r: any) => [r.user_uuid, { strava: r.strava, healthkit: r.healthkit }]));

  // ── 7. Run count (last 30 days) ──────────────────────────────────────────
  // runs.data is JSONB: distanceMi, startLocal; absorbed_into_canonical_at = dedup flag
  const runsQ = await pool.query(
    `SELECT user_uuid,
            COUNT(*) AS run_count,
            ROUND(SUM((data->>'distanceMi')::numeric)) AS run_mi
     FROM runs
     WHERE user_uuid = ANY($1)
       AND absorbed_into_canonical_at IS NULL
       AND (data->>'startLocal')::date >= CURRENT_DATE - 30
     GROUP BY user_uuid`,
    [uuids],
  );
  const runsMap = Object.fromEntries(runsQ.rows.map((r: any) => [r.user_uuid, { count: r.run_count, mi: r.run_mi }]));

  // ── 7b. Connected biometrics (HealthKit health_samples · tall table) ──────
  // What the runner actually HAS even when they skipped self-report at
  // onboarding: observed max HR (12mo ceiling), latest resting HR / HRV /
  // HealthKit VO2max. The engine already derives effective max HR from these;
  // the admin should show them instead of the empty self-report columns.
  const bioQ = await pool.query(
    `SELECT user_uuid,
            ROUND(MAX(value) FILTER (WHERE sample_type = 'max_hr' AND sample_date >= now() - interval '12 months')) AS obs_max_hr,
            ROUND((array_agg(value ORDER BY sample_date DESC) FILTER (WHERE sample_type = 'resting_hr'))[1]) AS rhr,
            ROUND((array_agg(value ORDER BY sample_date DESC) FILTER (WHERE sample_type = 'hrv'))[1]) AS hrv,
            ROUND((array_agg(value ORDER BY sample_date DESC) FILTER (WHERE sample_type = 'vo2_max'))[1]) AS vo2max_hk
       FROM health_samples WHERE user_uuid = ANY($1) GROUP BY user_uuid`,
    [uuids],
  ).catch(() => ({ rows: [] as any[] }));
  const bioMap = Object.fromEntries(bioQ.rows.map((r: any) => [r.user_uuid, r]));

  // ── 7c. History DERIVED from actual runs (vs skipped self-report) ─────────
  const runHistQ = await pool.query(
    `SELECT user_uuid,
            MIN(COALESCE(data->>'date', LEFT(data->>'startLocal',10))) AS first_run,
            ROUND(MAX((data->>'distanceMi')::numeric), 1) AS longest_mi,
            ROUND(SUM((data->>'distanceMi')::numeric)
              FILTER (WHERE COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= (CURRENT_DATE - 28)::text) / 4.0, 1) AS avg_wk_mi,
            ROUND(MAX((data->>'maxHr')::numeric)) AS run_max_hr
       FROM runs WHERE user_uuid = ANY($1) AND NOT (data ? 'mergedIntoId') GROUP BY user_uuid`,
    [uuids],
  ).catch(() => ({ rows: [] as any[] }));
  const runHistMap = Object.fromEntries(runHistQ.rows.map((r: any) => [r.user_uuid, r]));

  // ── 8. Assemble + doctrine checks ────────────────────────────────────────
  const testers = users.map((u) => {
    const p = profileMap[u.id] ?? null;
    const plan = planMap[u.id] ?? null;
    const ramp = plan ? (rampMap[plan.id] ?? []) : [];
    const conn = connMap[u.id] ?? { strava: false, healthkit: false };
    const runs30 = runsMap[u.id] ?? { count: 0, mi: 0 };
    const bio = bioMap[u.id] ?? null;
    const rh = runHistMap[u.id] ?? null;
    // Observed max HR = the higher of the HealthKit daily ceiling and the
    // hardest HR seen in a run (matches loadEffectiveMaxHr's union of sources).
    const observedMaxHr = Math.max(Number(bio?.obs_max_hr ?? 0), Number(rh?.run_max_hr ?? 0)) || null;
    const runningSinceMonths = rh?.first_run
      ? Math.round((Date.now() - new Date(rh.first_run + 'T12:00:00Z').getTime()) / (30 * 86400000))
      : null;

    const checks: { label: string; pass: boolean; note: string }[] = [];

    if (p) {
      // Onboarding fields complete
      // A goal can be a race (goal_race_distance) OR a no-race time goal
      // (tt_goal_distance). Goal-mode runners correctly have no race — don't
      // flag them red for it.
      const hasRaceGoal = !!p.goal_race_distance && p.goal_race_distance !== 'none';
      const hasTtGoal = !!p.tt_goal_distance;
      checks.push({ label: 'Goal set', pass: hasRaceGoal || hasTtGoal, note: hasRaceGoal ? p.goal_race_distance : hasTtGoal ? `${p.tt_goal_distance} time goal` : 'missing' });
      checks.push({ label: 'Timezone set', pass: !!p.timezone, note: p.timezone ?? 'missing' });
      checks.push({ label: 'Weekly frequency set', pass: !!p.weekly_frequency, note: p.weekly_frequency ? `${p.weekly_frequency}d/wk` : 'missing' });
      // History is "known" if self-reported OR derivable from actual runs.
      const histKnown = !!p.history_avg_weekly_mi || rh?.avg_wk_mi != null;
      checks.push({ label: 'History known', pass: histKnown, note: p.history_avg_weekly_mi ?? (rh?.avg_wk_mi != null ? `${rh.avg_wk_mi} mi/wk · runs` : 'missing') });
    }

    if (plan) {
      const weekCount = Number(plan.week_count);
      const totalRunDays = Number(plan.total_run_days);
      const freq = p?.weekly_frequency ? Number(p.weekly_frequency) : null;
      const avgRunDaysPerWeek = weekCount > 0 ? (totalRunDays / weekCount) : 0;
      const peakLong = Number(plan.peak_long_run_mi);

      // Frequency match: avg run days/wk should be ≤ weekly_frequency
      if (freq) {
        const match = avgRunDaysPerWeek <= freq + 0.5;
        checks.push({ label: 'Plan freq ≤ user freq', pass: match, note: `plan avg ${avgRunDaysPerWeek.toFixed(1)}d/wk vs pref ${freq}d` });
      }

      // Peak long run: marathon 18-22mi, half 10-14mi, 10k 8-10mi
      const dist = p?.goal_race_distance;
      if (dist === 'marathon') {
        checks.push({ label: 'Peak long run (18–22mi)', pass: peakLong >= 18 && peakLong <= 22, note: `${peakLong}mi` });
      } else if (dist === 'half') {
        checks.push({ label: 'Peak long run (10–14mi)', pass: peakLong >= 10 && peakLong <= 14, note: `${peakLong}mi` });
      } else if (dist === '10k') {
        checks.push({ label: 'Peak long run (8–10mi)', pass: peakLong >= 8 && peakLong <= 10, note: `${peakLong}mi` });
      }

      // Ramp rate: no week-over-week jump > 15mi or > 40%
      if (ramp.length >= 2) {
        let rampOk = true;
        let rampNote = '';
        for (let i = 1; i < ramp.length; i++) {
          const prev = ramp[i - 1]; const curr = ramp[i];
          if (prev > 0 && (curr - prev) / prev > 0.4 && (curr - prev) > 5) {
            rampOk = false; rampNote = `wk${i}→wk${i + 1}: ${prev}→${curr}mi (+${Math.round((curr - prev) / prev * 100)}%)`;
          }
        }
        checks.push({ label: 'Week 1–4 ramp ≤40%', pass: rampOk, note: rampNote || `${ramp.join('→')}mi` });
      }

      // Plan length vs race date
      if (plan.race_date && p?.goal_race_date) {
        const weeksToRace = Math.round((new Date(p.goal_race_date).getTime() - Date.now()) / (7 * 86400000));
        const planWeeks = weekCount;
        const reasonable = Math.abs(weeksToRace - planWeeks) <= 4;
        checks.push({ label: 'Plan length matches race date', pass: reasonable, note: `${planWeeks}wk plan, ${weeksToRace}wk to race` });
      }
    }

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.created_at,
      lastSeen: sessionMap[u.id] ?? null,
      onboardedAt: p?.onboarding_completed_at ?? null,
      connections: conn,
      runs30,
      profile: p ? {
        goalDistance: p.goal_race_distance,
        goalDate: p.goal_race_date,
        goalTime: p.goal_race_time,
        ttGoalDistance: p.tt_goal_distance,
        ttGoalTime: p.tt_goal_time,
        weeklyFrequency: p.weekly_frequency,
        weeklyMileageTarget: p.weekly_mileage_target,
        historyAvgMi: p.history_avg_weekly_mi,
        historyLongest: p.history_longest_recent_mi,
        historyYears: p.history_years_running,
        timezone: p.timezone,
        hrmax: p.hrmax,
        rhr: p.rhr,
        experienceLevel: p.experience_level,
        connectionsSkipped: p.connections_skipped,
        // Connected-data fallbacks — what we actually have when self-report is blank.
        observedMaxHr,
        restingHr: bio?.rhr != null ? Number(bio.rhr) : null,
        hrv: bio?.hrv != null ? Number(bio.hrv) : null,
        vo2maxHk: bio?.vo2max_hk != null ? Number(bio.vo2max_hk) : null,
        derivedAvgWkMi: rh?.avg_wk_mi != null ? Number(rh.avg_wk_mi) : null,
        derivedLongestMi: rh?.longest_mi != null ? Number(rh.longest_mi) : null,
        runningSinceMonths,
      } : null,
      plan: plan ? {
        id: plan.id,
        mode: plan.mode,
        phaseLabel: plan.phase_label ?? null,
        intent: plan.intent ?? null,
        anchorVdot: plan.anchor_vdot ?? null,
        anchorSource: plan.anchor_source ?? null,
        authoredIso: plan.authored_iso,
        raceDate: plan.race_date,
        weekCount: Number(plan.week_count),
        totalRunDays: Number(plan.total_run_days),
        totalPlanMi: Number(plan.total_plan_mi),
        peakLongRunMi: Number(plan.peak_long_run_mi),
        avgRunMi: Number(plan.avg_run_mi),
        earlyRamp: ramp,
      } : null,
      checks,
    };
  });

  return NextResponse.json({ testers, generatedAt: new Date().toISOString() }, { headers: CORS });
  } catch (e: any) {
    console.error('[tester-watch]', e);
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500, headers: CORS });
  }
}
