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
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
import { canonicalSessionType } from '@/lib/training/workout-type';
import { lookupTempF, baselineTempF } from '@/lib/weather/lookup';
import {
  computeFueling,
  type WorkoutFuelingType,
} from '@/lib/training/fueling';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { distanceMiFromLabel } from '@/lib/race/distance';

/**
 * The types this endpoint can actually build a prescription for · the arms of
 * `prescriptionFor`'s switch. Deliberately NARROWER than `WorkoutType`, which
 * now spans every session type the engine authors: the extra members fall to
 * that switch's `default` arm and would return an empty card, so serving the
 * runner an honest easy-run prescription is better than an empty one.
 */
const VALID: WorkoutType[] = ['easy','long','tempo','threshold','intervals','race','shakeout','rest','unplanned'];

function parseGoalSeconds(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

// 2026-07-07 · ultra-honesty audit · local fork replaced with the shared
// parser (@/lib/race/distance) — was already null-safe on unmatched (no
// 13.1 fallthrough here), just didn't recognize ultra labels.

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const sp = req.nextUrl.searchParams;
  // 2026-08-18 · normalise before the allowlist check. `?type=interval` (the
  // singular spelling 214 production rows carry) used to miss VALID entirely
  // and fall through to 'easy' — the runner asked for their rep session and
  // was handed an easy-run card.
  const typeRaw = canonicalSessionType(sp.get('type')) ?? 'easy';
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
  const today = await runnerToday(userId);
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
  const goal_distance_mi = meta.distanceMi ? Number(meta.distanceMi) : distanceMiFromLabel(meta.distanceLabel);

  /* SECOND-OWNER-1 (2026-09-02) · the goal TIME read is deleted. It existed to
   * feed `prescriptionFor`'s pace ladder, which derived every zone from
   * `tPaceFromGoal(goal_seconds, goal_distance_mi)` — the runner's aspiration
   * pricing his training. The ladder now reads the canonical anchors, whose
   * inputs are `(userId, today)` and nothing else. The race DISTANCE survives:
   * it sizes the fuelling ramp below, and a distance cannot price a pace. */
  const anchorRead = await resolvePrescribedPaceAnchors(userId, today);

  // ── Weather: pull tempF for the workout date (forecast lookup).
  //
  // Feeds the fueling dose (hydration/carb needs scale with heat) and the
  // informational weather_baseline tag below only. No pace target is
  // adjusted for heat — the runner paces by feel and conditions on the day.
  // Caller can pass explicit ?tempF=N OR ?date=YYYY-MM-DD (we look up
  // the cache for the runner's recent lat/lon bucket). Falls back to
  // baseline avg over last 14d when exact date not cached yet.
  const explicitTempF = Number(sp.get('tempF'));
  let tempF: number | null = isFinite(explicitTempF) ? explicitTempF : null;
  // Baseline temp (14-day avg at the runner's typical lat/lon) is also
  // returned so the iPhone can render a "HOTTER THAN USUAL" tag even
  // when the heat slowdown is trivial. Set in the same lookup loop.
  let baseline: number | null = null;
  if (tempF == null) {
    // Use the runner's most-recent Strava activity coords as a proxy
    // for "where they usually run". Slim lookup; never blocks the
    // prescription if it fails.
    try {
      // Coords live in `startLatLng` (Strava-native array) OR in flat
      // scalar pairs from older sync paths — read both shapes so this
      // works for every ingest path that's ever populated the table.
      const r = await pool.query<{
        start_lat: string | null; start_lng: string | null;
        sll_lat: string | null;   sll_lng: string | null;
      }>(
        `SELECT (data->>'startLat')::text AS start_lat,
                (data->>'startLng')::text AS start_lng,
                (data->'startLatLng'->>0)::text AS sll_lat,
                (data->'startLatLng'->>1)::text AS sll_lng
           FROM runs
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND (data ? 'startLat' OR data ? 'startLatLng')
          ORDER BY (data->>'date') DESC LIMIT 1`,
        [userId]
      );
      const row = r.rows[0];
      const lat = Number(row?.start_lat ?? row?.sll_lat);
      const lon = Number(row?.start_lng ?? row?.sll_lng);
      if (isFinite(lat) && isFinite(lon)) {
        const dateParam = sp.get('date');
        if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          tempF = await lookupTempF(lat, lon, dateParam);
        }
        // Always pull the baseline so the iPhone can render the
        // "HOTTER THAN USUAL" tag — even when the forecast is exactly
        // the baseline temp and heat-adjustment is a no-op.
        baseline = await baselineTempF(lat, lon, today, 14);
        // Fall back to baseline as the forecast itself if no exact-date
        // entry is cached yet.
        if (tempF == null) tempF = baseline;
      }
    } catch { /* non-fatal */ }
  }

  const prescription = prescriptionFor(type, weeklyMi, {
    lthr, anchors: anchorRead.ok ? anchorRead.anchors : null, raceDistanceMi: goal_distance_mi,
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
    // The gut-training ramp aims at the goal race's Research/18 §11 rate
    // (doctrine audit 2026-08-17); without it every runner rehearsed the
    // marathon row.
    raceDistanceMi: goal_distance_mi ?? null,
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
    citation: fueling.citation,
  } : null;

  // Augment with weather-baseline context so the iPhone can render a
  // "HOTTER THAN USUAL" tag without another network call. Lives at the
  // top level (alongside prescription) instead of inside prescription.weather
  // because the existing weatherSummary suppresses itself on trivial slowdowns.
  const weather_baseline = (baseline != null || tempF != null) ? {
    tempF: tempF ?? null,
    baselineTempF: baseline,
    deltaF: (tempF != null && baseline != null) ? Math.round(tempF - baseline) : null,
  } : null;

  // Prescriptions are deterministic from (type, weeklyMi, lthr, canonical anchors).
  // The same query string returns the same output until the runner's
  // profile changes — safe to cache aggressively client-side.
  return NextResponse.json({ ...prescription, weather_baseline }, {
    headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=60' },
  });
}
