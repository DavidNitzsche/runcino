/**
 * POST /api/ingest/workout
 *
 * Ingest a single completed workout from the iPhone (reading HKWorkout from
 * HealthKit after the watch finished it). This is the SOURCE OF TRUTH path
 * per the architectural pivot — Strava is now a destination (push), not the
 * primary source (pull).
 *
 * Body shape (mirrors what an iPhone HealthKit reader would post):
 *
 * {
 *   client_workout_id: "watch-uuid-abc123",   // HKWorkout.uuid; idempotent dedup key
 *   start_local:       "2026-05-25T07:24:39", // ISO local time
 *   date:              "2026-05-25",          // local date (PT)
 *   activity_type:     "running",
 *   distance_mi:       6.16,
 *   duration_sec:      3450,
 *   moving_sec:        3420,
 *   avg_pace_min_per_mi: "9:18",
 *   avg_hr_bpm:        133,
 *   max_hr_bpm:        149,
 *   avg_cadence_spm:   168,
 *   elev_gain_ft:      82,
 *   temp_f:            58,
 *   source:            "apple_watch",
 *   name:              "Morning easy",       // optional title
 *   splits:            [{ mile: 1, pace: "9:15", hr: 128 }, ...],
 *   hr_zone_pcts:      { z1: 78, z2: 22, z3: 0, z4: 0, z5: 0 },
 *   route_polyline:    null   // optional GPS polyline
 * }
 *
 * We dedupe on client_workout_id. Writes into strava_activities.data
 * (jsonb) so all existing readers work unchanged. Busts the briefing
 * cache so the next /today render sees the new run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { pool } from '@/lib/db/pool';
import { bustBriefingCacheForEvent } from '@/lib/coach/cache';
import { autoMergeForDate } from '@/lib/runs/merge';
import { fetchRunWeather } from '@/lib/weather/openmeteo';
import { requireUserId } from '@/lib/auth/session';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import { isSubThresholdRun, MIN_DISTANCE_MI, MIN_DURATION_SEC } from '@/lib/runs/length-guard';

export async function POST(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });

  if (!body.client_workout_id) {
    return NextResponse.json({ error: 'client_workout_id required (HKWorkout.uuid)' }, { status: 400 });
  }
  if (!body.date || !body.distance_mi) {
    return NextResponse.json({ error: 'date + distance_mi required' }, { status: 400 });
  }

  // 2026-06-02 · length guard · drop tap-test workouts before any
  // write. See lib/runs/length-guard.ts for the rule.
  const guard = isSubThresholdRun({
    distanceMi: Number(body.distance_mi),
    durationSec: Number(body.duration_sec ?? body.moving_sec ?? 0),
  });
  if (guard.isSubThreshold) {
    console.log(`[ingest/workout] dropped sub-threshold workout ${body.client_workout_id} · ${guard.distanceMi}mi / ${guard.durationSec}s (min ${MIN_DISTANCE_MI}mi / ${MIN_DURATION_SEC}s)`);
    return NextResponse.json({
      ok: true,
      id: `wko_${body.client_workout_id}`,
      dropped: guard.reason,
      distanceMi: guard.distanceMi,
      durationSec: guard.durationSec,
    });
  }

  const slug = `wko_${body.client_workout_id}`;

  // Build the data payload matching the strava_activities.data shape.
  const data = {
    id: slug,                            // synthetic id (no Strava id yet)
    activityId: slug,
    client_workout_id: body.client_workout_id,
    source: body.source ?? 'apple_watch',
    name: body.name ?? 'Run',
    date: body.date,
    startLocal: body.start_local ?? `${body.date}T08:00:00`,
    distanceMi: Number(body.distance_mi),
    durationSec: Number(body.duration_sec ?? 0),
    timeMoving: body.moving_sec
      ? formatMmSs(Number(body.moving_sec))
      : (body.duration_sec ? formatMmSs(Number(body.duration_sec)) : null),
    avgPaceMinPerMi: body.avg_pace_min_per_mi ?? deriveAvgPace(body),
    avgHr: body.avg_hr_bpm ?? null,
    maxHr: body.max_hr_bpm ?? null,
    avgCadence: body.avg_cadence_spm ?? null,
    // #180 — running form metrics direct from HK. avg_power_w + avg_vert_osc_cm
    // are what the coach's getRuns surface reads; the rest are stored for the
    // run detail modal's FORM tile.
    avgPowerW: body.avg_power_w ?? null,
    avgVertOscCm: body.avg_vert_osc_cm ?? null,
    avgStrideLengthM: body.avg_stride_length_m ?? null,
    avgGctMs: body.avg_gct_ms ?? null,
    // 2026-05-31: barometric-drift sanity at ingest. iPhone HK importer
    // sums every sample-to-sample altitude delta — on a 12mi run with
    // 5000+ GPS points at ±2m jitter, that compounds to thousands of
    // fictional feet (David's 12mi long: 4684 ft, 379 ft/mi). When the
    // raw ratio busts 250 ft/mi AND per-mile splits agree on a smaller
    // value, persist the splits-derived sum and stamp elevGainSource =
    // 'recomputed' so the read path knows the provenance.
    ...(() => {
      const splitsArr = Array.isArray(body.splits) ? body.splits : [];
      const sanity = sanitizeElevGain({
        elevGainFt: body.elev_gain_ft ?? null,
        distanceMi: Number(body.distance_mi),
        splits: splitsArr,
      });
      return {
        elevGainFt: sanity.value,
        elevGainSource: sanity.source,
      };
    })(),
    tempF: body.temp_f ?? null,
    splits: Array.isArray(body.splits) ? body.splits : [],
    // 2026-05-31: was defaulting to {z1:0,...,z5:0} — a falsey-looking value
    // that's actually truthy, so the run-detail loader treated it as
    // "zones present" and skipped the deriveHrZones fallback. The Faff
    // watch app + HK ingest paths almost never ship pre-computed zone
    // percentages (per-mile HR is enough for the loader to compute them),
    // so we keep this null and let run-state.ts derive at read time.
    hrZonePcts: body.hr_zone_pcts ?? null,
    routePolyline: body.route_polyline ?? null,
    ingestedAt: new Date().toISOString(),
  };

  try {
    // Upsert on client_workout_id (idempotent: HKWorkout.uuid is stable).
    // strava_activities doesn't have a unique key on jsonb fields, so we
    // delete-then-insert under the synthetic slug to keep at most one row
    // per client_workout_id.
    //
    // FIX: the `id` column is BIGINT NOT NULL with no sequence default
    // (it's legacy: Strava activity ids landed there pre-cutover).
    // Build a stable BIGINT id from a hash of client_workout_id so the
    // INSERT doesn't violate NOT NULL and re-imports stay idempotent.
    const stableId = bigIntIdFromString(body.client_workout_id);

    // P43 — preserve hand-added warmup data across re-ingests. When the
    // iPhone re-syncs an HKWorkout we'd otherwise DELETE then INSERT,
    // wiping any warmup bonus that was patched on top (e.g. the Faff
    // watch app glitched and the 15-min warmup was hand-added). Read
    // the existing row first; if it has warmupAddedManually=true,
    // re-apply the warmup bonus to the new data before insert.
    const existing = (await pool.query(
      `SELECT data FROM runs
        WHERE user_uuid = $1
          AND data->>'client_workout_id' = $2
        LIMIT 1`,
      [userId, body.client_workout_id]
    )).rows[0]?.data;

    if (existing?.warmupAddedManually) {
      const bonusMi = Number(existing.warmupBonusMi ?? 1.7);
      const bonusSec = Number(existing.warmupBonusSec ?? 900);
      const warmupSplit = (existing.splits ?? []).find((s: any) => s?.note?.includes('warmup'))
        ?? { mile: 0, pace: '8:50', elev_ft: 0, note: 'Faff warmup (preserved across re-ingest)' };

      const newDist = Math.round(((data as any).distanceMi + bonusMi) * 100) / 100;
      const newDurS = Number((data as any).durationSec ?? 0) + bonusSec;
      const newMovS = Number((data as any).movingSec ?? newDurS - bonusSec) + bonusSec;
      const sPerMi = newDist > 0 ? Math.round(newDurS / newDist) : 0;
      const newPace = sPerMi > 0
        ? `${Math.floor(sPerMi / 60)}:${String(sPerMi % 60).padStart(2, '0')}`
        : (data as any).avgPaceMinPerMi;
      const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

      Object.assign(data, {
        distanceMi: newDist,
        durationSec: newDurS,
        movingSec: newMovS,
        movingTimeS: newMovS,
        timeMoving: mmss(newMovS),
        avgPaceMinPerMi: newPace,
        splits: [warmupSplit, ...((data as any).splits ?? [])],
        warmupAddedManually: true,
        warmupAddedAt: existing.warmupAddedAt ?? new Date().toISOString(),
        warmupBonusMi: bonusMi,
        warmupBonusSec: bonusSec,
        warmupNote: existing.warmupNote ?? 'Hand-added warmup preserved across re-ingest.',
      });
      console.log('[ingest/workout] preserved warmup bonus across re-ingest for', body.client_workout_id);
    }

    await pool.query(
      `DELETE FROM runs
        WHERE user_uuid = $1
          AND data->>'client_workout_id' = $2`,
      [userId, body.client_workout_id]
    );
    await pool.query(
      `INSERT INTO runs (id, user_uuid, data)
       VALUES ($1::bigint, $2, $3)`,
      [stableId, userId, data]
    );

    // P27.3 — auto-merge dupes for this date. If a hollow watch row + a
    // rich HKWorkout row both exist for the same start time, this marks
    // the hollow one's data.mergedIntoId so the coach sees one run.
    try {
      await autoMergeForDate(userId, body.date);
    } catch (e: any) {
      console.error('[ingest/workout] autoMerge warn:', e?.message);
    }

    // P42 hardening — when a rich HKWorkout lands for a date that ALSO
    // has an "abandoned" watch_completion intent, the runner finished
    // the workout in a non-Faff app (e.g. Apple Watch Workouts after
    // the Faff watch app glitched). Mark the abandoned intent as acked
    // so getWorkoutCompletion stops surfacing it. Without this the coach
    // narrates a phantom "session cut short" on top of a real completion.
    try {
      if (body.date && Number(body.distance_mi) > 0.5) {
        await pool.query(
          `UPDATE coach_intents
              SET acknowledged_at = NOW()
            WHERE COALESCE(user_uuid, user_id) = $1
              AND reason = 'watch_completion'
              AND acknowledged_at IS NULL
              AND ts::date = $2::date
              AND (value::jsonb->>'status') IN ('abandoned', 'aborted')`,
          [userId, body.date]
        );
      }
    } catch (e: any) {
      console.error('[ingest/workout] ack stale watch intent warn:', e?.message);
    }

    // P31 — best-effort weather enrichment on ingest. Three tiers, in
    // priority order:
    //   1. HK metadata weather · Apple's Workouts.app stamps
    //      HKMetadataKeyWeatherTemperature + HKMetadataKeyWeatherHumidity
    //      from the runner's local Weather app data. iOS importer surfaces
    //      these as body.weather_hk_temp_f + body.weather_hk_humidity_pct.
    //      This is the value the runner SAW on their watch · trust it over
    //      any server-side fallback.
    //   2. Open-Meteo span fetch · route_polyline start coords + duration.
    //      Used when HK didn't stamp weather (older watch builds, Weather
    //      permission denied, third-party workout sources).
    //   3. Open-Meteo single-point fetch · same coords, start time only.
    //      Already handled by enrichOneActivity downstream as a fallback.
    const hkTempF = typeof body.weather_hk_temp_f === 'number' && isFinite(body.weather_hk_temp_f)
      ? body.weather_hk_temp_f : null;
    const hkHumPct = typeof body.weather_hk_humidity_pct === 'number' && isFinite(body.weather_hk_humidity_pct)
      ? body.weather_hk_humidity_pct : null;

    if (hkTempF != null) {
      // Tier 1 · trust the Watch's reading. Shape mirrors RunWeather (see
      // lib/weather/openmeteo.ts) so downstream consumers don't branch.
      const w = {
        temp_f: hkTempF,
        temp_f_start: hkTempF,
        humidity_pct: hkHumPct,
        wind_mph: null,
        wind_gust_mph: null,
        cloud_cover_pct: null,
        precip_in: null,
        conditions: null,
        fetched_at: new Date().toISOString(),
        source: 'apple_hk' as const,
      };
      (data as any).weather = w;
      (data as any).tempF = hkTempF;
      await pool.query(
        `UPDATE runs
            SET data = $1, weather_enriched_at = NOW()
          WHERE user_uuid = $2
            AND data->>'client_workout_id' = $3`,
        [data, userId, body.client_workout_id]
      );
    } else if (body.route_polyline) {
      // Tier 2 · Open-Meteo span fetch (forecast host for recent runs,
      // archive host for older · see lib/weather/openmeteo.ts weatherHost).
      try {
        const firstPair = decodePolylineFirst(body.route_polyline);
        if (firstPair) {
          const w = await fetchRunWeather(firstPair[0], firstPair[1], data.startLocal);
          if (w) {
            (data as any).weather = w;
            (data as any).tempF = w.temp_f ?? (data as any).tempF;
            await pool.query(
              `UPDATE runs
                  SET data = $1, weather_enriched_at = NOW()
                WHERE user_uuid = $2
                  AND data->>'client_workout_id' = $3`,
              [data, userId, body.client_workout_id]
            );
          }
        }
      } catch (e: any) {
        console.error('[ingest/workout] weather enrich warn:', e?.message);
      }
    }

    await bustBriefingCacheForEvent(userId, 'run_ingest');

    // Notifications v1 §F — check for streak milestone (7/14/30/100 days).
    // Non-blocking; failures don't affect the ingest path.
    try {
      const { maybeFireStreakMilestone } = await import('@/lib/notifications/streak-check');
      await maybeFireStreakMilestone(userId);
    } catch (e: any) {
      console.error('[ingest/workout] streak check failed:', e?.message);
    }

    // #161 — auto-push to Strava when the toggle is on. Fire-and-forget;
    // failures land in strava_pushes for retry. The push itself is
    // idempotent on run_id so a re-ingest won't double-upload.
    // 2026-06-01: lifted into lib/strava/auto-push.ts so all three
    // ingest paths share one hook.
    const { maybeAutoPush } = await import('@/lib/strava/auto-push');
    maybeAutoPush(userId, slug);

    return NextResponse.json({ ok: true, id: slug });
  } catch (err: any) {
    console.error('[ingest/workout] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatMmSs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function deriveAvgPace(b: any): string | null {
  if (!b.duration_sec || !b.distance_mi) return null;
  const sPerMi = Math.round(Number(b.duration_sec) / Number(b.distance_mi));
  return formatMmSs(sPerMi);
}

/**
 * Build a stable, negative BIGINT id from a client-supplied stable
 * identifier (HKWorkout.uuid). We pick negative because legacy Strava
 * activity ids are positive — keeping HK + manual ids in the negative
 * half avoids collision risk forever.
 *
 * Hash the input to 8 bytes (SHA-256, lower half), interpret as signed,
 * negate the positive sign bit. JS Number can't hold 64-bit ints
 * losslessly past 2^53; we cap at 53 bits to stay safe, then negate.
 */
function bigIntIdFromString(s: string): string {
  const digest = createHash('sha256').update(s).digest();
  // Take first 8 bytes, mask to 52 bits (stays under Number.MAX_SAFE_INTEGER), negate.
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(digest[i]);
  n = n & 0x000fffffffffffffn;   // 52 bits
  return (-n).toString();
}

/** Decode just the first lat,lng pair from a Google polyline (precision 5). */
function decodePolylineFirst(s: string): [number, number] | null {
  if (!s || s.length < 2) return null;
  let index = 0;
  let lat = 0, lng = 0;
  const decodeOne = (): number => {
    let shift = 0, result = 0;
    while (index < s.length) {
      const b = s.charCodeAt(index) - 63;
      index++;
      result |= (b & 0x1f) << shift;
      if (b < 0x20) break;
      shift += 5;
    }
    return (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
  };
  try {
    lat = decodeOne();
    lng = decodeOne();
    return [lat / 1e5, lng / 1e5];
  } catch { return null; }
}
