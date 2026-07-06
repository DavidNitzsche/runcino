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
import { fetchRunWeather, WEATHER_VERSION_CURRENT } from '@/lib/weather/openmeteo';
import { toUtcIso } from '@/lib/runs/normalize-time';
import { requireUserId } from '@/lib/auth/session';
import { sanitizeElevGain } from '@/lib/runs/elev-sanity';
import { isSubThresholdRun, MIN_DISTANCE_MI, MIN_DURATION_SEC } from '@/lib/runs/length-guard';
import { classifyRunDistance, DISTANCE_REVIEW_FLAG, SOFT_DISTANCE_CEILING_MI, HARD_DISTANCE_CEILING_MI } from '@/lib/runs/distance-guard';
import { bucketHrSamplesByZone, hasHrSamples } from '@/lib/coach/hr-zone-bucket';
import { computeZones } from '@/lib/training/zones';

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

  // F20: physiological bounds guard — clamp impossible HR values to null
  // and reject absurd distances before any DB write.
  if (body.avg_hr_bpm != null && (body.avg_hr_bpm < 30 || body.avg_hr_bpm > 230)) {
    console.warn(`[ingest/workout] clamped out-of-bounds avg_hr_bpm=${body.avg_hr_bpm}`);
    body.avg_hr_bpm = null;
  }
  if (body.max_hr_bpm != null && (body.max_hr_bpm < 30 || body.max_hr_bpm > 230)) {
    console.warn(`[ingest/workout] clamped out-of-bounds max_hr_bpm=${body.max_hr_bpm}`);
    body.max_hr_bpm = null;
  }
  // 2026-07-06 · audit P1-26 / P2-62 fix · the old flat `> 50 → 400` here
  // permanently destroyed real ultra runs — the iPhone relay dead-letters
  // 4xx (WatchSync "dead-letter by returning true so the caller drops it").
  //   50–250 mi  → accept + quarantine (data.qualityFlag='distance_review'
  //                · counts toward volume, excluded from VDOT anchors),
  //   > 250 mi   → sensor garbage · answer the sub-threshold-style
  //                200 + { dropped } shape so the queue drops the payload
  //                INTENTIONALLY instead of silently dead-lettering a 400.
  // Rule rationale + Research citations: lib/runs/distance-guard.ts.
  const distGuard = classifyRunDistance(Number(body.distance_mi));
  if (distGuard.verdict === 'reject') {
    console.warn(`[ingest/workout] dropped over-ceiling workout ${body.client_workout_id} · ${distGuard.distanceMi}mi (hard ceiling ${HARD_DISTANCE_CEILING_MI}mi)`);
    return NextResponse.json({
      ok: true,
      id: `wko_${body.client_workout_id}`,
      dropped: 'distance_ceiling',
      distanceMi: distGuard.distanceMi,
    });
  }
  if (distGuard.verdict === 'review') {
    console.warn(`[ingest/workout] distance ${distGuard.distanceMi}mi exceeds ${SOFT_DISTANCE_CEILING_MI}mi soft bound · storing with qualityFlag='${distGuard.qualityFlag}'`);
  }

  const slug = `wko_${body.client_workout_id}`;

  // 2026-06-04 · compute HR-zone percentages at ingest. Watch payloads
  // ship raw HR samples every 5s inside each split's `_raw.hrSamples` ·
  // bucket them per-sample against the runner's LTHR-anchored Friel
  // zone table. Stored on `data.hrZonePcts` so the run detail page
  // reads a real distribution instead of falling back to the legacy
  // per-split-avg derivation at render time (which produced wrong
  // 33/33/33 splits when a tempo phase landed at LTHR).
  //
  // When LTHR isn't set yet, or the payload didn't ship raw samples
  // (older watch builds, Strava-pushed), we keep `hrZonePcts: null`
  // and `lib/coach/run-state.ts deriveHrZonesFromSamples` does the
  // bucketing at render time using the same helper.
  const rawSplitsForZones = Array.isArray(body.splits) ? body.splits : [];
  let computedHrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null = null;
  if (rawSplitsForZones.length > 0 && hasHrSamples(rawSplitsForZones)) {
    try {
      const lthrRow = await pool.query(
        `SELECT lthr FROM profile WHERE user_uuid = $1 ORDER BY (user_uuid=$1) DESC LIMIT 1`,
        [userId],
      );
      const lthr = lthrRow.rows[0]?.lthr;
      if (lthr) {
        const table = computeZones({ lthr });
        if (table) {
          const bucketed = bucketHrSamplesByZone(rawSplitsForZones, table);
          const sum = bucketed.z1 + bucketed.z2 + bucketed.z3 + bucketed.z4 + bucketed.z5;
          if (sum > 0) computedHrZonePcts = bucketed;
        }
      }
    } catch (e: unknown) {
      // Non-fatal · the render-time fallback covers us.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[ingest/workout] zone bucketing failed:', msg);
    }
  }

  // 2026-06-09 state-audit fix · stamp workoutType from the matched plan
  // day. Watch/HK ingests never carried a workout type, so every
  // type-gated consumer was blind: vdotFromRun's quality gate
  // (lib/training/vdot.ts QUALITY_RUN_TYPES), the tempo-pace-drift
  // detector (goal-projection.ts), and the decoupling steady-state
  // filter (decoupling-trend.ts) all read data->>'workoutType' and
  // found null. Strava rows keep their numeric enum ('0'/'1'/'3' ·
  // mapped in vdot-inputs.ts); this stamps the PLAN's string type on
  // device-ingested runs.
  //
  // Guard: only stamp when the run's distance is within ±30% of the
  // planned distance — a 2 mi bail on a tempo day (or an unplanned
  // jog on a rest day) must not inherit a quality label and pollute
  // the type-gated readers. workoutTypeSource records provenance.
  let plannedWorkoutType: string | null = null;
  try {
    const planDay = (await pool.query<{ type: string; distance_mi: string | null }>(
      `SELECT pw.type, pw.distance_mi::text
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.date_iso = $2
          AND pw.type NOT IN ('rest')
        LIMIT 1`,
      [userId, body.date],
    )).rows[0];
    if (planDay) {
      const plannedMi = planDay.distance_mi != null ? Number(planDay.distance_mi) : null;
      const actualMi = Number(body.distance_mi);
      const distanceMatches = plannedMi == null || plannedMi <= 0
        ? true
        : actualMi >= plannedMi * 0.7 && actualMi <= plannedMi * 1.3;
      if (distanceMatches) {
        // race_week_tuneup is T-pace work · stamp as threshold so the
        // quality-type readers treat it as the T-effort it is.
        plannedWorkoutType = planDay.type === 'race_week_tuneup' ? 'threshold' : planDay.type;
      }
    }
  } catch (e: unknown) {
    // Non-fatal · an unstamped run is the pre-fix status quo.
    console.warn('[ingest/workout] workoutType stamp failed:',
      e instanceof Error ? e.message : String(e));
  }

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
    // 2026-06-03 · splits validation · iPhone derives per-mile splits
    // from HKWorkoutRoute GPS timestamps in HealthKitManager.swift
    // buildRoutePayload. When the runner pauses mid-mile, GPS keeps
    // emitting samples but the watch correctly excludes paused time
    // from `workout.duration`. iPhone-side bug: split computation uses
    // raw GPS timestamps without consulting HKWorkoutEvent pause/resume
    // events. Result: split times sum to more than total duration, so
    // the "slowest mile" / drift / pace surfaces lie.
    //
    // Defense in depth: validate splits-time-sum vs total duration · if
    // off by > 5s, drop the splits and stamp splits_unreliable so
    // downstream renderers fall back to total stats only.
    //
    // Source-of-truth fix: designs/briefs/iphone-split-pause-fix.md ·
    // iPhone agent updates buildRoutePayload to mask paused time.
    ...(() => {
      const rawSplits = Array.isArray(body.splits) ? body.splits : [];
      const splitsCheck = validateSplitsAgainstDuration(rawSplits,
        Number(body.duration_sec ?? body.moving_sec ?? 0));
      if (!splitsCheck.reliable && rawSplits.length > 0) {
        console.warn(
          `[ingest/workout] dropping unreliable splits · user=${userId.slice(0,8)} ` +
          `client_workout_id=${body.client_workout_id} · ` +
          `splits_sum=${splitsCheck.splitsSumS}s vs duration=${splitsCheck.durationS}s ` +
          `(delta ${splitsCheck.deltaS}s)`,
        );
      }
      return {
        splits: splitsCheck.reliable ? rawSplits : [],
        splits_unreliable: rawSplits.length > 0 ? !splitsCheck.reliable : false,
        splits_validation: splitsCheck.reliable ? null : {
          splitsSumS: splitsCheck.splitsSumS,
          durationS: splitsCheck.durationS,
          deltaS: splitsCheck.deltaS,
          droppedCount: rawSplits.length,
        },
      };
    })(),
    // 2026-06-04 · zone bucketing now runs at ingest from raw HR
    // samples (preferred) · falls back to body-provided value if the
    // client pre-computed (rare) · falls back to null when neither is
    // available, in which case run-state.ts deriveHrZonesFromSamples
    // does the bucketing at render time using the same helper.
    //
    // Was: stored null unconditionally · the render-time fallback
    // bucketed per-split-average HR, which produced "33% Z1 / 33% Z4
    // / 33% Z5" on tempo workouts because (a) phase count drove
    // weight not time, and (b) phase avg HR at LTHR landed exactly
    // at Z5's lower bound. Per-sample bucketing fixes both.
    hrZonePcts: computedHrZonePcts ?? body.hr_zone_pcts ?? null,
    routePolyline: body.route_polyline ?? null,
    // 2026-06-09 · plan-stamped workout type (see lookup above). Null
    // when no plan day matched · readers treat null as untyped, the
    // pre-fix behavior.
    workoutType: plannedWorkoutType,
    ...(plannedWorkoutType ? { workoutTypeSource: 'plan' } : {}),
    // 2026-07-06 · P1-26 · distance quarantine. Key is ABSENT (not null)
    // on clean runs so the merge upsert below can never clobber a flag
    // set by a prior over-soft-bound write. See lib/runs/distance-guard.ts.
    ...(distGuard.qualityFlag ? { qualityFlag: distGuard.qualityFlag } : {}),
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

    // Rule 6 — preserve dedup flags across re-ingest. mergedIntoId is set
    // by autoMergeForDate on loser rows of a dupe cluster; the DELETE-then-
    // INSERT below wipes it, creating a convergence window until autoMerge
    // re-fires. Copy it forward so the window never exists.
    if (existing?.mergedIntoId != null) {
      (data as any).mergedIntoId = existing.mergedIntoId;
    }

    // M-16 / Rule 6 · upsert, not DELETE+INSERT. The old shape wiped every
    // COLUMN on re-ingest — shoe_id + shoe_auto_assigned_at (a manual shoe
    // pick was destroyed, then auto-assign re-filled with a system pick),
    // provenance (tier doctrine inverted: Strava pull saw tier 0 and
    // overwrote watch/HK values), weather_enriched_at, fetched_at. The
    // legacy-id DELETE below only clears rows from older id schemes; the
    // same-id path is now an UPDATE that never touches those columns.
    // Data merge: existing keys survive; incoming non-null keys win
    // (warmup bonus + mergedIntoId were already re-applied onto `data`
    // above, so they ride the incoming side); incoming nulls cannot erase
    // absorbed values.
    await pool.query(
      `DELETE FROM runs
        WHERE user_uuid = $1
          AND data->>'client_workout_id' = $2
          AND id <> $3::bigint`,
      [userId, body.client_workout_id, stableId]
    );
    // The WHERE keeps the pre-upsert safety property: a cross-user
    // synthetic-id collision used to die on the PK conflict; with DO
    // UPDATE it would silently merge into the other runner's row. WHERE
    // false → no row written → rowCount 0 → refuse loudly (P0-4 shape).
    const up = await pool.query(
      `INSERT INTO runs (id, user_uuid, data)
       VALUES ($1::bigint, $2, $3)
       ON CONFLICT (id) DO UPDATE
         SET data = runs.data || jsonb_strip_nulls(EXCLUDED.data)
       WHERE runs.user_uuid = EXCLUDED.user_uuid`,
      [stableId, userId, data]
    );
    if (up.rowCount === 0) {
      throw new Error(`cross-user collision on synthetic id ${stableId} · refusing to write`);
    }

    // 2026-07-06 · P1-26 · explicit flag clear on corrected re-import. The
    // merge upsert PRESERVES an absent key (Rule 6: default preserves,
    // explicit destruction only), so a re-import of the same
    // client_workout_id with a corrected in-bounds distance must clear a
    // stale quarantine flag field-level — never by replacing data wholesale.
    if (distGuard.verdict === 'ok') {
      await pool.query(
        `UPDATE runs SET data = data - 'qualityFlag'
          WHERE id = $1::bigint AND user_uuid = $2
            AND data->>'qualityFlag' = '${DISTANCE_REVIEW_FLAG}'`,
        [stableId, userId],
      );
    }

    // 2026-06-03 · post-write hook · calibration auto-complete on
    // HK ingest. Best-effort, doesn't block ingest response.
    void (await import('@/lib/runs/post-write-hooks'))
      .afterRunWrite({ userUuid: userId, runId: String(stableId), source: 'hk' });

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
        version: WEATHER_VERSION_CURRENT,
      };
      (data as any).weather = w;
      (data as any).tempF = hkTempF;
      // Rule 6 / 2026-06-07 circular-merge fix — patch ONLY the weather keys,
      // never the full in-memory `data`. autoMergeForDate (above) may have just
      // cleared/repointed mergedIntoId in the DB; the in-memory `data` still
      // carries the PRE-merge flag (C1b copied it forward at :279), so
      // `data || data` re-applies a now-stale mergedIntoId and forms a circular
      // A↔B pair that zeroes the day in volume.ts. A scoped patch also avoids
      // clobbering fields the absorber just merged onto the canonical (splits).
      const weatherPatch = { weather: w, tempF: hkTempF };
      await pool.query(
        `UPDATE runs
            SET data = data || $1::jsonb, weather_enriched_at = NOW()
          WHERE user_uuid = $2
            AND data->>'client_workout_id' = $3`,
        [weatherPatch, userId, body.client_workout_id]
      );
    } else if (body.route_polyline) {
      // Tier 2 · Open-Meteo span fetch (forecast host for recent runs,
      // archive host for older · see lib/weather/openmeteo.ts weatherHost).
      //
      // 2026-06-02 · CRITICAL · normalize startLocal via toUtcIso before
      // passing to fetchRunWeather. The previous direct pass of
      // `data.startLocal` (a no-Z PDT string from HK importer) caused
      // Date.parse to interpret it as UTC on Railway servers · the
      // weather query hit Open-Meteo at the WRONG hour (5 AM PDT
      // instead of noon PDT for David's audit case). Bucket at predawn
      // → 57°F garbage. With normalization: HK importer's "apple_watch"
      // source is in sourceStoresLocal, toUtcIso converts the wall time
      // to the correct UTC, fetchRunWeather looks up the right hour.
      try {
        const firstPair = decodePolylineFirst(body.route_polyline);
        if (firstPair) {
          const utcStartISO = toUtcIso(data.startLocal, data.source) ?? data.startLocal;
          const w = await fetchRunWeather(firstPair[0], firstPair[1], utcStartISO);
          if (w) {
            (data as any).weather = w;
            (data as any).tempF = w.temp_f ?? (data as any).tempF;
            // Rule 6 / circular-merge fix — same as Tier 1: patch only the
            // weather keys so a stale in-memory mergedIntoId can't be re-applied
            // over autoMergeForDate's just-written flag state.
            const weatherPatch = { weather: w, tempF: (data as any).tempF };
            await pool.query(
              `UPDATE runs
                  SET data = data || $1::jsonb, weather_enriched_at = NOW()
                WHERE user_uuid = $2
                  AND data->>'client_workout_id' = $3`,
              [weatherPatch, userId, body.client_workout_id]
            );
          }
        }
      } catch (e: any) {
        console.error('[ingest/workout] weather enrich warn:', e?.message);
      }
    }

    await bustBriefingCacheForEvent(userId, 'run_ingest');

    // 2026-06-03 · streak-milestone notifications DISABLED per David:
    // "I also dont like streaks. Its not about running all these days
    // in a row. I think thats bad to have, right?" Glorifying
    // consecutive-day volume with 7/14/30/100-day milestone pushes
    // undermines rest doctrine. Engine code (streak-check.ts) stays
    // in source for future re-enable as an opt-in setting; this fire
    // site is the only place the notifications originated.
    //
    // try {
    //   const { maybeFireStreakMilestone } = await import('@/lib/notifications/streak-check');
    //   await maybeFireStreakMilestone(userId);
    // } catch (e: any) {
    //   console.error('[ingest/workout] streak check failed:', e?.message);
    // }

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

/**
 * 2026-06-03 · Splits sanity check · sum of per-mile times must match
 * total moving duration within 5 seconds. When the sum is > duration,
 * splits include time the watch correctly excluded (pause/stop), which
 * means iPhone's GPS-timestamp-derived split computation in
 * HealthKitManager.swift didn't consult HKWorkoutEvent pause/resume.
 *
 * `reliable=false` means we drop the splits at storage time so downstream
 * surfaces (slowest mile / drift / fastest mile) fall back to total
 * stats only instead of rendering wrong numbers from inconsistent data.
 *
 * Source-of-truth fix lives at designs/briefs/iphone-split-pause-fix.md
 * · iPhone agent updates buildRoutePayload to mask paused time.
 */
function validateSplitsAgainstDuration(
  splits: unknown,
  durationS: number,
): { reliable: boolean; splitsSumS: number; durationS: number; deltaS: number } {
  if (!Array.isArray(splits) || splits.length === 0 || durationS <= 0) {
    return { reliable: true, splitsSumS: 0, durationS, deltaS: 0 };
  }
  let splitsSumS = 0;
  for (const s of splits) {
    if (!s || typeof s !== 'object') continue;
    // Split formats vary · iPhone sends `pace: "9:19"`, watch derives
    // `paceSecPerMi: 559`. Both represent seconds-per-mile for a 1-mile
    // split. Sum the per-mile times, optionally scaling by mile size if
    // mile distance is sub-1 (rare · tail-end partial splits).
    const split = s as Record<string, unknown>;
    const distMi = typeof split.distanceMi === 'number'
      ? split.distanceMi
      : (typeof split.distance_mi === 'number' ? split.distance_mi : 1);
    const paceSec = parsePaceToSec(split.pace ?? split.paceMinPerMi)
      ?? (typeof split.paceSecPerMi === 'number' ? split.paceSecPerMi : null)
      ?? (typeof split.pace_s_per_mi === 'number' ? split.pace_s_per_mi : null);
    if (paceSec == null || !Number.isFinite(paceSec)) continue;
    splitsSumS += paceSec * (distMi ?? 1);
  }
  const deltaS = Math.round(splitsSumS - durationS);
  const reliable = Math.abs(deltaS) <= 5;
  return {
    reliable,
    splitsSumS: Math.round(splitsSumS),
    durationS,
    deltaS,
  };
}

/** Parse "M:SS" pace string to seconds. Returns null on garbage input. */
function parsePaceToSec(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
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
