/**
 * GET /api/prescription?type=threshold&weeklyMi=43 → structured workout
 *
 * Reads the runner's profile (LTHR + race goal) and returns a fully
 * broken-out prescription so the modal doesn't have to ship the
 * pace-derivation logic to the client.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { prescriptionFor, type WorkoutType } from '@/lib/training/prescriptions';
import { lookupTempF, baselineTempF } from '@/lib/weather/lookup';
import { abilityTierFromVdot } from '@/lib/weather/heat-adjustment';
import {
  computeFueling,
  type WorkoutFuelingType,
} from '@/lib/training/fueling';

const DAVID_USER_ID = process.env.DEFAULT_USER_ID ?? '0645f40c-951d-4ccc-b86e-9979cd26c795';

const VALID: WorkoutType[] = ['easy','long','tempo','threshold','intervals','race','shakeout','rest','unplanned'];

function parseGoalSeconds(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

function distanceMiFromLabel(label: string | null): number | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('marathon') && !l.includes('half')) return 26.2;
  if (l.includes('half') || l.includes('21k')) return 13.1;
  if (l.includes('10k')) return 6.2;
  if (l.includes('5k')) return 3.1;
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const userId = sp.get('user_id') ?? DAVID_USER_ID;
  const typeRaw = (sp.get('type') ?? 'easy').toLowerCase() as WorkoutType;
  const type: WorkoutType = VALID.includes(typeRaw) ? typeRaw : 'easy';
  const weeklyMi = Number(sp.get('weeklyMi')) || 30;
  const targetMiRaw = sp.get('targetMi');
  const targetMi = targetMiRaw != null ? Number(targetMiRaw) : undefined;

  // Profile: LTHR
  const profRow = (await pool.query(
    `SELECT lthr FROM profile WHERE user_uuid = $1 ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = profRow?.lthr ?? null;

  // Race goal: closest upcoming A-race with a goal time
  const today = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const raceRow = (await pool.query(
    `SELECT meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' = 'A'
        AND meta->>'goalDisplay' IS NOT NULL
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date') ASC LIMIT 1`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const meta = raceRow?.meta ?? {};
  const goal_seconds = parseGoalSeconds(meta.goalDisplay);
  const goal_distance_mi = meta.distanceMi ? Number(meta.distanceMi) : distanceMiFromLabel(meta.distanceLabel);

  // ── Weather: pull tempF for the workout date (forecast lookup).
  //
  // Q-04 / Research/06 — apply Maughan heat slowdown to displayed paces.
  // Caller can pass explicit ?tempF=N OR ?date=YYYY-MM-DD (we look up
  // the cache for the runner's recent lat/lon bucket). Falls back to
  // baseline avg over last 14d when exact date not cached yet.
  const explicitTempF = Number(sp.get('tempF'));
  let tempF: number | null = isFinite(explicitTempF) ? explicitTempF : null;
  if (tempF == null) {
    // Use the runner's most-recent Strava activity coords as a proxy
    // for "where they usually run". Slim lookup; never blocks the
    // prescription if it fails.
    try {
      const r = await pool.query<{ start_lat: string | null; start_lng: string | null }>(
        `SELECT (data->>'startLat')::text AS start_lat, (data->>'startLng')::text AS start_lng
           FROM strava_activities
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND data->>'startLat' IS NOT NULL
          ORDER BY (data->>'date') DESC LIMIT 1`,
        [userId]
      );
      const row = r.rows[0];
      const lat = Number(row?.start_lat);
      const lon = Number(row?.start_lng);
      if (isFinite(lat) && isFinite(lon)) {
        const dateParam = sp.get('date');
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          tempF = await lookupTempF(lat, lon, dateParam);
        }
        // Fall back to 14-day baseline if no exact-date forecast cached.
        if (tempF == null) {
          tempF = await baselineTempF(lat, lon, today, 14);
        }
      }
    } catch { /* non-fatal */ }
  }

  // Get VDOT for ability-tier inference (heat impact varies by tier).
  const userRow = (await pool.query<{ vdot: string | null }>(
    `SELECT vdot_last_reviewed::text AS vdot FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const vdot = userRow?.vdot != null ? Number(userRow.vdot) : null;
  const abilityTier = abilityTierFromVdot(vdot);

  const prescription = prescriptionFor(type, weeklyMi, {
    lthr, goal_seconds, goal_distance_mi,
    weather: tempF != null ? {
      tempF,
      raceDistanceMi: goal_distance_mi ?? undefined,
      abilityTier,
    } : null,
  }, isFinite(targetMi as number) ? (targetMi as number) : undefined);

  // ── Fueling: compute gels + carb intake per Research/18 ─────────
  //
  // Pulls the runner's product preferences from users.fuel_* so the
  // brief can quote "2 Maurten 100s at 30 + 60 min" instead of generic
  // "2 gels". Race-aware ramp applies when an A-race is within 56d
  // (Costa et al. gut-training §13).
  const fuelRow = (await pool.query<{
    fuel_brand: string | null;
    fuel_gel_carbs_g: number | null;
    fuel_target_g_per_hr: number | null;
  }>(
    `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];

  // Derive workout type + duration estimate for fueling math.
  const fuelingType: WorkoutFuelingType =
    type === 'long' || type === 'race' ? type
    : type === 'threshold' || type === 'tempo' || type === 'intervals' ? 'quality'
    : type === 'rest' ? 'rest'
    : 'easy';
  // Conservative ~ 9 min/mi default for duration estimate.
  const durationEstMin = Math.round(prescription.total_mi * 9);

  const daysToARace = meta?.date
    ? Math.max(0, Math.round((Date.parse(meta.date + 'T12:00:00Z') - Date.now()) / 86400000))
    : null;

  const fueling = computeFueling({
    durationEstMin,
    distanceMi: prescription.total_mi,
    workoutType: fuelingType,
    tempF,
    daysToARace,
    raceFuelTargetGPerHr: fuelRow?.fuel_target_g_per_hr ?? null,
    gelCarbsG: fuelRow?.fuel_gel_carbs_g ?? null,
    gelLabel: fuelRow?.fuel_brand ?? null,
  });
  prescription.fueling = fueling.needed ? {
    needed: fueling.needed,
    gels: fueling.gels,
    atMins: fueling.atMins,
    carbsTotalG: fueling.carbsTotalG,
    shortLine: fueling.shortLine,
    why: fueling.why,
  } : null;

  // Prescriptions are deterministic from (type, weeklyMi, lthr, goal_*).
  // The same query string returns the same output until the runner's
  // profile changes — safe to cache aggressively client-side.
  return NextResponse.json(prescription, {
    headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=60' },
  });
}
