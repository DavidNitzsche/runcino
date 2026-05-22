/**
 * GET /api/runs/by-date?date=YYYY-MM-DD
 *
 * Returns the most-recent activity logged on the given date for the
 * authenticated user (or null if none). Used by the workout-detail
 * modal on /overview + /training so a past workout cell can surface
 * its actual results alongside the plan.
 *
 * If multiple activities ran the same date (e.g. two-a-day), returns
 * the one with the greatest distance, best proxy for "the main run".
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { getActivityDetail } from '@/lib/sync-strava-user';
import { resolveEffectiveMaxHr } from '@/lib/compute-max-hr';
import { getRouteForDate } from '@/lib/watch-route';

interface ActivityRow {
  id: string;
  data: Record<string, unknown>;
  shoe_id: number | null;
}

export async function GET(req: NextRequest) {
  // Auth optional, anonymous callers (simulator preview) fall back to
  // the legacy 'me' demo account, mirroring /api/overview + /api/races.
  const user = await getCurrentUser(req);
  const uid = user?.id ?? 'me';

  const date = req.nextUrl.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 });
  }

  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data, shoe_id
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
      ORDER BY (data->>'distanceMi')::NUMERIC DESC NULLS LAST
      LIMIT 1`,
    [user?.id ?? null, date],
  );
  const row = rows[0];
  if (!row) {
    // No Strava activity for this date, fall back to an Apple-Watch
    // completion that never synced to Strava. The watch workoutId is
    // "YYYY-MM-DD-<slug>", so we match the date off its prefix (timezone-
    // proof, unlike completed_at). Gives the Today hero its actuals +
    // flips it out of "NOT LOGGED"; splits/map aren't available.
    const wc = await query<{
      workout_id: string; total_distance_mi: string | null; total_duration_sec: number | null;
      avg_hr: number | null; max_hr: number | null;
    }>(
      `SELECT workout_id, total_distance_mi, total_duration_sec, avg_hr, max_hr
         FROM workout_completions
        WHERE user_id = $1
          AND LEFT(workout_id, 10) = $2
          AND total_distance_mi IS NOT NULL
        ORDER BY recorded_at DESC
        LIMIT 1`,
      [user?.id ?? null, date],
    ).catch(() => [] as never[]);
    const c = wc[0];
    if (!c) return NextResponse.json({ ok: true, run: null });
    const dist = Number(c.total_distance_mi) || 0;
    const dur = Number(c.total_duration_sec) || 0;
    const maxHrEff = await resolveEffectiveMaxHr(uid).catch(() => ({ value: null as number | null }));
    // Map + per-mile splits from the Apple-Health route (if the iPhone has
    // uploaded one for this date), gives watch-only runs a recap map.
    const route = user?.id ? await getRouteForDate(user.id, date).catch(() => null) : null;
    const splits = (route?.splits ?? []).map((s) => {
      const m = Math.floor(s.paceSPerMi / 60), sec = s.paceSPerMi % 60;
      return { mile: s.mile, paceSPerMi: s.paceSPerMi, paceDisplay: `${m}:${String(sec).padStart(2, '0')}`,
               avgHr: s.avgHr, elevDeltaFt: s.elevDeltaFt ?? 0 };
    });
    const startLatLng = route?.startLat != null && route?.startLng != null ? [route.startLat, route.startLng] : null;
    const endLatLng = route?.endLat != null && route?.endLng != null ? [route.endLat, route.endLng] : null;
    return NextResponse.json({
      ok: true,
      maxHr: maxHrEff.value ?? null,
      run: {
        id: `wc-${c.workout_id}`,
        name: 'Run',
        description: null,
        date,
        distanceMi: dist,
        movingTimeS: dur,
        paceSPerMi: dist > 0 ? Math.round(dur / dist) : 0,
        avgHr: c.avg_hr != null ? Math.round(Number(c.avg_hr)) : null,
        maxHr: c.max_hr != null ? Math.round(Number(c.max_hr)) : null,
        avgCadence: null,
        elevGainFt: 0,
        type: null,
        splits,
        summaryPolyline: route?.polyline ?? null,
        startLatLng,
        endLatLng,
      },
    });
  }

  const d = row.data as {
    name?: string; description?: string | null;
    startLocal?: string; date?: string;
    distanceMi?: number; movingTimeS?: number; paceSPerMi?: number;
    avgHr?: number | null; maxHr?: number | null; avgCadence?: number | null;
    elevGainFt?: number; type?: string; workoutType?: number | null;
  };

  // Lazy-fetch the activity detail to extract per-mile splits.
  // splits_standard = imperial-mile splits from Strava.
  interface StravaSplit {
    split: number;
    distance: number;        // meters
    elapsed_time: number;    // seconds
    moving_time: number;
    average_speed: number;   // m/s
    average_heartrate?: number;
    elevation_difference?: number;
    pace_zone?: number;
  }
  let splits: Array<{ mile: number; paceSPerMi: number; paceDisplay: string; avgHr: number | null; elevDeltaFt: number }> = [];
  let summaryPolyline: string | null = (d as { summaryPolyline?: string | null }).summaryPolyline ?? null;
  let startLatLng: [number, number] | null = null;
  let endLatLng: [number, number] | null = null;
  try {
    const detail = await getActivityDetail(uid, row.id);
    const detailTyped = detail as unknown as {
      splits_standard?: StravaSplit[];
      map?: { summary_polyline?: string };
      start_latlng?: [number, number];
      end_latlng?: [number, number];
    } | null;
    const std = detailTyped?.splits_standard;
    if (std && Array.isArray(std)) {
      splits = std
        // Only count splits that covered at least 0.95 of a mile. Strava
        // emits a final partial row for the last fractional mile which
        // would otherwise show as a "9th split" of 0.1 mi at slow pace.
        .filter((s) => s.distance >= 1609.344 * 0.95 && s.moving_time > 0)
        .map((s) => {
          const distMi = s.distance / 1609.344;
          const paceSPerMi = Math.round(s.moving_time / Math.max(distMi, 0.0001));
          const m = Math.floor(paceSPerMi / 60);
          const sec = paceSPerMi % 60;
          return {
            mile: s.split,
            paceSPerMi,
            paceDisplay: `${m}:${String(sec).padStart(2, '0')}`,
            avgHr: s.average_heartrate ? Math.round(s.average_heartrate) : null,
            elevDeltaFt: s.elevation_difference != null ? Math.round(s.elevation_difference * 3.28084) : 0,
          };
        });
    }
    if (detailTyped?.map?.summary_polyline) summaryPolyline = detailTyped.map.summary_polyline;
    if (detailTyped?.start_latlng && detailTyped.start_latlng.length === 2) startLatLng = detailTyped.start_latlng;
    if (detailTyped?.end_latlng && detailTyped.end_latlng.length === 2) endLatLng = detailTyped.end_latlng;
  } catch (e) {
    console.warn('[api/runs/by-date] detail fetch failed for', row.id, e);
    // Splits stay empty; the rest of the response still works
  }

  // Watch / Apple-Health runs are now first-class strava_activities rows (via
  // the canonical-run writer), so they reach this MAIN path rather than the
  // no-row fallback below — but they have NO Strava detail, so the loop above
  // leaves the map + splits empty. Fall back to the on-device GPS route the
  // iPhone uploaded for this date so these runs still get a recap map.
  if ((!summaryPolyline || splits.length === 0) && user?.id) {
    const route = await getRouteForDate(user.id, date).catch(() => null);
    if (route) {
      if (!summaryPolyline && route.polyline) summaryPolyline = route.polyline;
      if (splits.length === 0 && route.splits.length > 0) {
        splits = route.splits.map((s) => {
          const m = Math.floor(s.paceSPerMi / 60), sec = s.paceSPerMi % 60;
          return {
            mile: s.mile, paceSPerMi: s.paceSPerMi,
            paceDisplay: `${m}:${String(sec).padStart(2, '0')}`,
            avgHr: s.avgHr, elevDeltaFt: s.elevDeltaFt ?? 0,
          };
        });
      }
      if (!startLatLng && route.startLat != null && route.startLng != null) startLatLng = [route.startLat, route.startLng];
      if (!endLatLng && route.endLat != null && route.endLng != null) endLatLng = [route.endLat, route.endLng];
    }
  }

  // ── Apple Health for this date: per-run dynamics + the morning's
  //    recovery vitals (with 30-day baselines) so the coach take can
  //    cite the actual cause of an off day instead of guessing. ──
  interface SampleRow { sample_type: string; value: number }
  const daySamples = await query<SampleRow>(
    `SELECT sample_type, value FROM health_samples
      WHERE user_id = $1 AND sample_date = $2
        AND sample_type = ANY($3)`,
    [uid, date, ['hrv', 'resting_hr', 'sleep_hours', 'respiratory_rate',
                 'cadence', 'stride_length', 'vertical_oscillation',
                 'ground_contact_time', 'vertical_ratio', 'run_power']],
  ).catch(() => [] as SampleRow[]);
  const baselineRows = await query<{ sample_type: string; avg: number }>(
    `SELECT sample_type, AVG(value)::float8 AS avg FROM health_samples
      WHERE user_id = $1
        AND sample_date >= ($2::date - INTERVAL '30 days') AND sample_date < $2
        AND sample_type = ANY($3)
      GROUP BY sample_type`,
    [uid, date, ['hrv', 'resting_hr']],
  ).catch(() => [] as { sample_type: string; avg: number }[]);
  const dayMap = new Map(daySamples.map((r) => [r.sample_type, Number(r.value)]));
  const baseMap = new Map(baselineRows.map((r) => [r.sample_type, Number(r.avg)]));
  const recovery = {
    hrvMs: dayMap.get('hrv') ?? null,
    hrvBaselineMs: baseMap.get('hrv') ?? null,
    // Fall back to the 30-day baseline when there's no resting-HR sample on
    // the run's exact date. Without this the recap loses resting HR and the
    // debrief silently drops to generic %max zones (a lower easy ceiling),
    // contradicting the personalized %HRR zones shown on the HR-zones card.
    restingHrBpm: dayMap.get('resting_hr') ?? baseMap.get('resting_hr') ?? null,
    restingHrBaselineBpm: baseMap.get('resting_hr') ?? null,
    sleepHours: dayMap.get('sleep_hours') ?? null,
    respiratoryRate: dayMap.get('respiratory_rate') ?? null,
  };
  const dynamics = {
    cadence: dayMap.get('cadence') ?? null,
    strideLength: dayMap.get('stride_length') ?? null,
    verticalOscillation: dayMap.get('vertical_oscillation') ?? null,
    groundContactTime: dayMap.get('ground_contact_time') ?? null,
    verticalRatio: dayMap.get('vertical_ratio') ?? null,
    runPower: dayMap.get('run_power') ?? null,
  };

  // Weather at the run's start (Open-Meteo), surfaced on the recap and
  // fed to the coach take (heat/humidity explains an elevated HR).
  const { fetchRunWeather } = await import('@/lib/weather');
  const runStartISO = (d.startLocal as string | undefined) || (d.date ? `${d.date}T07:00:00` : null);
  const weather = startLatLng
    ? await fetchRunWeather(startLatLng[0], startLatLng[1], runStartISO)
    : null;

  // Max HR, prefer the user's manual override, fall back to the
  // value computed from their activity history (peak max_heartrate
  // across runs). null when neither is available.
  const maxHr = await resolveEffectiveMaxHr(uid);

  // Resolve the user's full fitness so the modal can render
  // workout descriptions with race-goal-derived paces (HM Blocks
  // workout for a 1:30 goal shows ~6:52/mi, not the hardcoded
  // 7:30-7:50 from the pre-resolver era).
  const { resolveFitness } = await import('@/lib/fitness-resolver');
  const today = new Date().toISOString().slice(0, 10);
  const fitness = await resolveFitness(uid, today);

  return NextResponse.json({
    ok: true,
    maxHr: maxHr.value,
    maxHrSource: maxHr.source,
    recovery,
    dynamics,
    weather,
    fitness: {
      paces: fitness.paces,
      racePaceBand: fitness.racePaceBand,
      activeRace: fitness.activeRace ? {
        name: fitness.activeRace.name,
        goalPaceSPerMi: fitness.activeRace.goalPaceSPerMi,
        goalDisplay: fitness.activeRace.goalDisplay,
      } : null,
      vdot: fitness.vdot.value,
    },
    run: {
      id: row.id,
      name: d.name || 'Untitled run',
      description: d.description || null,
      date: d.date || (d.startLocal || '').slice(0, 10),
      distanceMi: Number(d.distanceMi) || 0,
      movingTimeS: Number(d.movingTimeS) || 0,
      paceSPerMi: Number(d.paceSPerMi) || 0,
      // Round HR + cadence at the API boundary so consumers never
      // need to render "148.7" or "26.6999...bpm over ceiling".
      avgHr: d.avgHr ? Math.round(Number(d.avgHr)) : null,
      maxHr: d.maxHr ? Math.round(Number(d.maxHr)) : null,
      avgCadence: d.avgCadence ? Math.round(Number(d.avgCadence)) : null,
      elevGainFt: Math.round(Number(d.elevGainFt) || 0),
      type: d.type || 'Run',
      workoutType: d.workoutType ?? null,
      splits,
      summaryPolyline,
      startLatLng,
      endLatLng,
    },
  });
}
