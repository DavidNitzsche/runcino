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
    `SELECT tp.id, tp.user_uuid, tp.mode, tp.authored_iso, tp.race_date,
            COUNT(DISTINCT plw.id) AS week_count,
            COUNT(pw.id) FILTER (WHERE pw.distance_mi > 0) AS total_run_days,
            ROUND(SUM(pw.distance_mi) FILTER (WHERE pw.distance_mi > 0)) AS total_plan_mi,
            ROUND(MAX(pw.distance_mi)) AS peak_long_run_mi,
            ROUND(AVG(pw.distance_mi) FILTER (WHERE pw.distance_mi > 0)) AS avg_run_mi
     FROM training_plans tp
     LEFT JOIN plan_weeks plw ON plw.plan_id = tp.id
     LEFT JOIN plan_workouts pw ON pw.week_id = plw.id
     WHERE tp.user_uuid = ANY($1) AND tp.archived_iso IS NULL
     GROUP BY tp.id, tp.user_uuid, tp.mode, tp.authored_iso, tp.race_date
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

  // ── 8. Assemble + doctrine checks ────────────────────────────────────────
  const testers = users.map((u) => {
    const p = profileMap[u.id] ?? null;
    const plan = planMap[u.id] ?? null;
    const ramp = plan ? (rampMap[plan.id] ?? []) : [];
    const conn = connMap[u.id] ?? { strava: false, healthkit: false };
    const runs30 = runsMap[u.id] ?? { count: 0, mi: 0 };

    const checks: { label: string; pass: boolean; note: string }[] = [];

    if (p) {
      // Onboarding fields complete
      checks.push({ label: 'Goal race set', pass: !!p.goal_race_distance && p.goal_race_distance !== 'none', note: p.goal_race_distance ?? 'missing' });
      checks.push({ label: 'Timezone set', pass: !!p.timezone, note: p.timezone ?? 'missing' });
      checks.push({ label: 'Weekly frequency set', pass: !!p.weekly_frequency, note: p.weekly_frequency ? `${p.weekly_frequency}d/wk` : 'missing' });
      checks.push({ label: 'History filled', pass: !!p.history_avg_weekly_mi, note: p.history_avg_weekly_mi ?? 'missing' });
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
      } : null,
      plan: plan ? {
        id: plan.id,
        mode: plan.mode,
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
