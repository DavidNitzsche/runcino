/**
 * lib/race/representativeness-inputs.ts · the DB side of rule 8.
 *
 * `representativeness.ts` is pure by design — no database, no network, no
 * clock — so that the diagnosis is exhaustively testable. This file is the
 * other half: it gathers what that module needs for one race and hands it over.
 *
 * Split this way for two reasons. The pure module stays trivially testable, and
 * `lib/plan/adapt.ts` (a file several agents edit at once) gains one import and
 * one call rather than five queries.
 *
 * Everything here is read-only and individually `.catch`-guarded. A missing
 * table or an unenriched run degrades one factor of the diagnosis; it never
 * throws, and it never blocks the re-anchor it is advising on. When nothing
 * resolves, the read comes back at full authority — which is exactly the old
 * behaviour, so a data outage cannot silently freeze the fitness model.
 */
import { pool } from '@/lib/db/pool';
import { TAPER_RACE_WEEK_PCT_OF_PEAK, distanceCategoryOf } from '@/lib/plan/goal-tiers';
import {
  assessRepresentativeness,
  type RaceSplit,
  type RepresentativenessInput,
  type RepresentativenessRead,
  type WindRelation,
} from './representativeness';

/** Tolerant read of the polymorphic split shapes the app ingests. */
function toSplits(raw: unknown): RaceSplit[] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const out: RaceSplit[] = [];
  raw.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const o = s as Record<string, unknown>;
    if (o.unreliable === true) {
      out.push({ mile: Number(o.mile ?? i + 1), paceSPerMi: null });
      return;
    }
    // The field-name ladder across watch / Strava / HealthKit / manual ingest.
    let pace: number | null = null;
    for (const k of ['paceSPerMi', 'paceSecPerMi', 'pace_s_per_mi']) {
      const v = Number(o[k]);
      if (isFinite(v) && v > 0) { pace = v; break; }
    }
    if (pace == null && typeof o.pace === 'string') {
      const m = /^(\d{1,3}):(\d{2})$/.exec(o.pace.trim());
      if (m) pace = Number(m[1]) * 60 + Number(m[2]);
    }
    if (pace == null) {
      // Strava shape · metres and seconds.
      const dist = Number(o.distance);
      const secs = Number(o.moving_time ?? o.elapsed_time);
      if (isFinite(dist) && dist > 0 && isFinite(secs) && secs > 0) {
        pace = secs / (dist / 1609.344);
      }
    }
    // Guard the known HealthKit trailing-stub and GPS-spike ranges.
    if (pace != null && (pace <= 0 || pace > 1800)) pace = null;
    out.push({ mile: Number(o.mile ?? o.mi ?? o.split ?? i + 1), paceSPerMi: pace });
  });
  return out.filter((s) => isFinite(s.mile)).length >= 3 ? out : null;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return isFinite(n) ? n : null;
};

/**
 * Gather every input rule 8 needs for one race and run the diagnosis.
 *
 * Returns null only when the race row itself cannot be read — in which case
 * the caller should proceed unscaled, exactly as before this existed.
 */
export async function assessRaceRepresentativeness(args: {
  userId: string;
  raceSlug: string;
  raceDateISO: string;
  distanceMi: number;
  finishS: number;
  anchorVdot: number;
  raceVdot: number;
}): Promise<RepresentativenessRead | null> {
  const { userId, raceSlug, raceDateISO, distanceMi, finishS, anchorVdot, raceVdot } = args;

  // ── 1 · The race row · priority, curated splits, GPX course geometry ────
  const raceRow = (await pool.query<{
    priority: string | null;
    actual_result: Record<string, unknown> | null;
    course_geometry: Record<string, unknown> | null;
  }>(
    `SELECT meta->>'priority' AS priority, actual_result, course_geometry
       FROM races
      WHERE user_uuid = $1::uuid AND slug = $2
      LIMIT 1`,
    [userId, raceSlug],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!raceRow) return null;

  const ar = (raceRow.actual_result ?? {}) as Record<string, unknown>;
  const geom = (raceRow.course_geometry ?? {}) as Record<string, unknown>;

  // ── 2 · Course elevation · course_library first, GPX geometry as the
  //        labelled fallback. Mirrors the precedence in components/faff-app/
  //        seed.ts rather than the projection route, which lacks the fallback.
  const lib = (await pool.query<{
    source: string | null;
    elevation_gain_ft: string | null;
    net_elevation_ft: string | null;
  }>(
    `SELECT source, elevation_gain_ft::text, net_elevation_ft::text
       FROM course_library WHERE slug = $1 LIMIT 1`,
    [raceSlug],
  ).catch(() => ({ rows: [] }))).rows[0];

  let elevationGainFt = num(lib?.elevation_gain_ft);
  let netElevationFt = num(lib?.net_elevation_ft);
  const libIsStub = lib?.source == null || lib.source === 'stub';
  if (libIsStub && geom.elevation_gain_ft != null) {
    elevationGainFt = num(geom.elevation_gain_ft);
    const tp = Array.isArray(geom.trackPoints) ? geom.trackPoints : null;
    if (tp && tp.length >= 2) {
      const first = num((tp[0] as Record<string, unknown>)?.ele);
      const last = num((tp[tp.length - 1] as Record<string, unknown>)?.ele);
      if (first != null && last != null) netElevationFt = Math.round((last - first) * 3.28084);
    }
  }

  // Mean course altitude, for the Research/06 §7 gate. Only the GPX carries it.
  let altitudeFt: number | null = null;
  if (Array.isArray(geom.trackPoints) && geom.trackPoints.length > 0) {
    const eles = (geom.trackPoints as Record<string, unknown>[])
      .map((p) => num(p?.ele))
      .filter((e): e is number => e != null);
    if (eles.length > 0) {
      altitudeFt = Math.round((eles.reduce((a, b) => a + b, 0) / eles.length) * 3.28084);
    }
  }

  // ── 3 · The matched run · cached weather and, failing curated miles,
  //        the watch splits. Same date+distance match the retrospective uses.
  const run = (await pool.query<{ data: Record<string, unknown> }>(
    `SELECT data FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) = $2
        AND (data->>'distanceMi')::numeric BETWEEN $3::numeric * 0.9 AND $3::numeric * 1.1
      ORDER BY (data->>'distanceMi')::numeric DESC
      LIMIT 1`,
    [userId, raceDateISO, distanceMi],
  ).catch(() => ({ rows: [] }))).rows[0];

  const runData = (run?.data ?? {}) as Record<string, unknown>;
  const wx = (runData.weather ?? null) as Record<string, unknown> | null;

  // Curated miles beat watch splits · CLAUDE.md race-data source-of-truth.
  const splits = toSplits(ar.miles) ?? toSplits(runData.splits);

  // ── 4 · Taper · race-week volume against the peak week of the block
  //        before it. Measured strictly BEFORE the race, so unlike a
  //        post-race TSB read it cannot be contaminated by the race itself.
  const vol = (await pool.query<{ race_week: string | null; peak_before: string | null }>(
    `WITH dedup AS (
       SELECT COALESCE((data->>'date')::date, LEFT(data->>'startLocal', 10)::date) AS d,
              ROUND((data->>'distanceMi')::numeric, 1) AS bucket,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1::uuid
          AND NOT (data ? 'mergedIntoId')
          AND COALESCE((data->>'date')::date, LEFT(data->>'startLocal', 10)::date)
              BETWEEN $2::date - 28 AND $2::date - 1
        GROUP BY 1, 2
     )
     SELECT
       (SELECT COALESCE(SUM(mi), 0) FROM dedup WHERE d >= $2::date - 7)::text AS race_week,
       (SELECT COALESCE(MAX(wk), 0) FROM (
          SELECT SUM(mi) AS wk FROM dedup
           WHERE d < $2::date - 7
           GROUP BY FLOOR(($2::date - 8 - d) / 7)
        ) weeks)::text AS peak_before`,
    [userId, raceDateISO],
  ).catch(() => ({ rows: [] }))).rows[0];

  const raceWeekMi = num(vol?.race_week) ?? 0;
  const peakBeforeMi = num(vol?.peak_before) ?? 0;
  const taperRatio = peakBeforeMi > 0 ? raceWeekMi / peakBeforeMi : null;

  // ── 5 · Illness and niggle open ON the race date ────────────────────────
  const sick = (await pool.query(
    `SELECT 1 FROM sick_episodes
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND logged_at::date <= $2::date
        AND (cleared_at IS NULL OR cleared_at::date >= $2::date)
      LIMIT 1`,
    [userId, raceDateISO],
  ).catch(() => ({ rows: [] as unknown[] }))).rows.length > 0;

  const niggle = (await pool.query<{ severity: string | null }>(
    `SELECT severity::text FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1::uuid
        AND logged_at::date <= $2::date
        AND (cleared_at IS NULL OR cleared_at::date >= $2::date)
      ORDER BY severity DESC LIMIT 1`,
    [userId, raceDateISO],
  ).catch(() => ({ rows: [] }))).rows[0];

  const input: RepresentativenessInput = {
    distanceMi,
    finishS,
    anchorVdot,
    raceVdot,
    course: {
      elevationGainFt,
      netElevationFt,
      altitudeFt,
      // No residency data · the conservative read for a road racer is that
      // they travelled to the altitude rather than living at it.
      altitudeAcclimatized: false,
    },
    weather: wx
      ? {
          // The hottest hour the race spanned, per the enrichment's own
          // guidance, falling back to the headline temp.
          tempF: num(wx.temp_f_peak) ?? num(wx.temp_f),
          humidityPct: num(wx.humidity_pct_peak) ?? num(wx.humidity_pct),
          conditions: typeof wx.conditions === 'string' ? wx.conditions : null,
          cloudCoverPct: num(wx.cloud_cover_pct),
          windMph: num(wx.wind_mph),
          // Course bearing is not modelled · treat a road race as the
          // out-and-back case, which is Research/06 §6's own default for a
          // course whose wind exposure is unknown.
          windRelation: 'unknown' as WindRelation,
        }
      : null,
    splits,
    state: {
      priority: raceRow.priority,
      // Deliberately null · see the note on RaceStateInput.formBand.
      formBand: null,
      taperRatio,
      illness: sick,
      niggleSeverity: num(niggle?.severity),
    },
    // Empty in production · vdotFromRace reads raw elapsed time and the anchor
    // side does not terrain-adjust races. See the double-counting note in
    // representativeness.ts. If terrain is ever added to vdot-inputs.ts's race
    // branch, add 'course_elevation' here.
    alreadyPricedFor: [],
  };

  return assessRepresentativeness(input);
}

/** Re-exported so callers need one import. */
export { TAPER_RACE_WEEK_PCT_OF_PEAK, distanceCategoryOf };
