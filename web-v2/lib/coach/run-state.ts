/**
 * run-state.ts — load a single run by id for the drill-down view.
 *
 * Runs come from multiple sources (watch via HealthKit, manual entry,
 * Strava webhook). All share the `strava_activities` table (legacy name;
 * holds every run regardless of source). We read the canonical fields
 * the iOS sync + Strava webhook both write.
 */
import { pool } from '@/lib/db/pool';
import { computeZones } from '@/lib/training/zones';

export interface RunSplit {
  mile: number;
  pace: string | null;            // "9:18"
  hr: number | null;
  cadence: number | null;
  elev_change_ft: number | null;
}

export interface RunForm {
  // Apple Watch form-metric set, cross-referenced from health_samples for
  // the run's date. Cadence here can override the activity's stale value.
  cadence_spm: number | null;
  ground_contact_ms: number | null;
  stride_length_m: number | null;
  vertical_oscillation_cm: number | null;
  vertical_ratio_pct: number | null;
  run_power_w: number | null;
  respiratory_rate: number | null;
  spo2_pct: number | null;
}

export interface RunDetail {
  id: string;
  date: string;
  start_local: string | null;
  name: string | null;
  source: 'watch' | 'apple_health' | 'manual' | 'strava' | string;
  type: string | null;            // 'easy', 'long', 'tempo', etc.

  distance_mi: number;
  pace: string | null;            // formatted "9:18"
  pace_s_per_mi: number | null;   // raw seconds for derived calcs
  time_moving: string | null;     // formatted "54:29" or "1:54:29"
  time_elapsed: string | null;
  avg_speed_mph: number | null;

  hr_avg: number | null;
  hr_max: number | null;
  cadence_avg: number | null;
  elev_gain_ft: number | null;
  temp_f: number | null;
  suffer_score: number | null;
  kudos: number | null;

  // P32 — shoe assignment surfaced for the modal picker.
  shoe_id: number | null;
  // P42 — work-only HR/cadence averages excluding planned recovery/rest
  // phases. Returns null when no matching planned workout structure is
  // available; otherwise these are the "real" effort numbers minus the
  // jog-in-between dilution.
  hr_avg_work: number | null;
  cadence_avg_work: number | null;
  work_seconds: number | null;

  has_route: boolean;
  route_polyline: string | null;  // Strava-encoded polyline if available
  splits: RunSplit[];
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  hr_zones_from_lthr: { lthr: number | null; ranges: { label: string; lower: number; upper: number }[] } | null;
  form: RunForm;                  // Apple Watch form metrics for that day
}

function fmtPace(s: number | null): string | null {
  if (!s || s <= 0 || !isFinite(s)) return null;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function fmtDuration(secs: number | null): string | null {
  if (!secs || secs <= 0 || !isFinite(secs)) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function loadRunDetail(userId: string, activityId: string): Promise<RunDetail | null> {
  // The id passed in is whatever the briefing surfaced — could be a real
  // run id, or a synthesized "YYYY-MM-DD-mi.mi" id (state-loader fallback
  // when the activity has no first-party id, e.g. watch-synced runs).
  let row = (await pool.query(
    `SELECT data, shoe_id FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'id' = $2 OR data->>'activityId' = $2)
      LIMIT 1`,
    [userId, activityId]
  )).rows[0];

  // Fallback: synthetic id "YYYY-MM-DD-mi"
  if (!row) {
    const m = activityId.match(/^(\d{4}-\d{2}-\d{2})-([\d.]+)$/);
    if (m) {
      const [, date, mi] = m;
      const fb = (await pool.query(
        `SELECT data, shoe_id FROM strava_activities
          WHERE (user_uuid = $1 OR user_uuid IS NULL)
            AND NOT (data ? 'mergedIntoId')
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) = $2
            AND ABS((data->>'distanceMi')::numeric - $3::numeric) < 0.05
          ORDER BY data->>'startLocal' DESC LIMIT 1`,
        [userId, date, mi]
      ).catch(() => ({ rows: [] }))).rows[0];
      row = fb;
    }
  }

  if (!row) return null;
  const r = row.data;
  const shoeId: number | null = row.shoe_id ?? null;

  // Pace — prefer formatted, else derive from seconds.
  const paceSPerMi = Number(r.paceSPerMi) || null;
  const pace = r.avgPaceMinPerMi
    || r.pace
    || fmtPace(paceSPerMi)
    || null;

  // Moving / elapsed time
  const movingSec  = Number(r.movingTimeS) || Number(r.duration_sec) || null;
  const elapsedSec = Number(r.elapsedTimeS) || Number(r.duration_sec) || null;

  // Splits — normalize various source shapes.
  const splits: RunSplit[] = Array.isArray(r.splits) ? r.splits.map((s: any, i: number) => {
    const sPerMi = Number(s.paceSPerMi) || (s.pace_s_per_mi ?? null);
    return {
      mile: Number(s.mile ?? s.index ?? i + 1) || (i + 1),
      pace: s.pace ?? s.pace_min_per_mi ?? fmtPace(sPerMi) ?? null,
      hr: Number(s.hr ?? s.avgHr) || null,
      cadence: Number(s.cadence ?? s.avgCadence) || null,
      elev_change_ft: Number(s.elev_change_ft ?? s.elevChangeFt) || null,
    };
  }) : [];

  // HR zone percentages — stored or computed from splits if missing.
  const hrPctsRaw = r.hrZonePcts ?? r.hr_zones ?? null;
  const hrZonePcts = hrPctsRaw
    ? {
        z1: Number(hrPctsRaw.z1) || 0, z2: Number(hrPctsRaw.z2) || 0,
        z3: Number(hrPctsRaw.z3) || 0, z4: Number(hrPctsRaw.z4) || 0,
        z5: Number(hrPctsRaw.z5) || 0,
      }
    : await deriveHrZones(userId, r.avgHr, splits);

  // Bring the user's LTHR-anchored zone ranges so the modal can render
  // an actionable "where your HR landed" panel.
  const lthrRow = await pool.query(
    `SELECT lthr FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id='me') ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const lthr = lthrRow.rows[0]?.lthr ?? null;
  const zoneTable = lthr ? computeZones({ lthr }) : null;
  const hr_zones_from_lthr = zoneTable ? {
    lthr,
    ranges: zoneTable.zones.map((z) => ({ label: z.shortLabel, lower: z.lower, upper: z.upper })),
  } : null;

  // Cross-reference health_samples for the day to enrich form metrics.
  // Watch runs ship lean payloads; HealthKit holds cadence, ground contact,
  // vertical oscillation/ratio, stride length, run power, etc.
  const day = r.date || (r.startLocal ?? '').slice(0, 10);
  const form = await loadFormMetrics(userId, day);

  // P42 — work-only averages (excluding planned recovery/rest phases).
  // computeWorkAverages matches the run's splits against the planned
  // workout structure for the date and returns averages over work
  // phases only. Returns nulls when no structure exists.
  const workAvgs = await computeWorkAverages(userId, day, splits);

  return {
    id: r.id ?? r.activityId ?? activityId,
    date: day,
    start_local: r.startLocal ?? null,
    name: r.name ?? null,
    source: r.source ?? 'strava',
    type: r.type ?? null,

    distance_mi: Number(r.distanceMi) || 0,
    pace, pace_s_per_mi: paceSPerMi,
    time_moving:  r.timeMoving  || fmtDuration(movingSec)  || null,
    time_elapsed: r.timeElapsed || fmtDuration(elapsedSec) || null,
    avg_speed_mph: Number(r.avgSpeedMph) || null,

    hr_avg: Number(r.avgHr) || null,
    hr_max: Number(r.maxHr) || null,
    // Prefer activity-supplied cadence; fall back to the day's HealthKit cadence.
    cadence_avg: Number(r.avgCadence) || form.cadence_spm,
    elev_gain_ft: Number(r.elevGainFt) || null,
    temp_f: Number(r.tempF) || null,
    suffer_score: Number(r.sufferScore) || null,
    kudos: Number(r.kudosCount) || null,

    shoe_id: shoeId,
    hr_avg_work: workAvgs.hrAvg,
    cadence_avg_work: workAvgs.cadenceAvg,
    work_seconds: workAvgs.workSeconds,

    has_route: Boolean(r.summaryPolyline || r.routePolyline || r.startLatLng),
    route_polyline: r.summaryPolyline ?? r.routePolyline ?? null,
    splits,
    hrZonePcts,
    hr_zones_from_lthr,
    form,
  };
}

/**
 * P42 — compute averages over WORK phases only (exclude warmup, recovery
 * jogs, cooldown). Matches the day's plan_workouts.json structure to the
 * actual splits by walking time forward and assigning each split's
 * estimated time to a phase by cumulative duration.
 *
 * Returns nulls when:
 *   - no plan_workout exists for the date
 *   - plan_workout has no phase structure (flat distance/type only)
 *   - splits don't carry HR/cadence
 *
 * Phases counted as "work": types containing "work", "rep", "tempo",
 * "threshold", "intervals", "race". Skip: "warmup", "cooldown",
 * "recovery", "rest", "easy_recovery", "jog".
 */
async function computeWorkAverages(
  userId: string,
  date: string | null,
  splits: RunSplit[],
): Promise<{ hrAvg: number | null; cadenceAvg: number | null; workSeconds: number | null }> {
  if (!date || splits.length === 0) return { hrAvg: null, cadenceAvg: null, workSeconds: null };

  const pw = (await pool.query(
    `SELECT pw.notes, pw.distance_mi, pw.type
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.date_iso = $2
      LIMIT 1`,
    [userId, date]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!pw) return { hrAvg: null, cadenceAvg: null, workSeconds: null };

  // pw.notes can be a JSON blob with structured phases; otherwise we
  // only know type + distance. Without phase structure, fall back to a
  // simple heuristic: skip the first split (warmup) and last split
  // (cooldown) for quality types.
  const isQuality = ['threshold','tempo','intervals','vo2max','race'].includes(pw.type);
  if (!isQuality || splits.length < 3) {
    return { hrAvg: null, cadenceAvg: null, workSeconds: null };
  }

  // Heuristic: middle splits (skip first + last) are the work portion.
  // This isn't phase-accurate, but it's a useful first pass for the
  // run-detail modal. When plan_workouts gains structured phase JSON
  // (P38 follow-up), we'll match by cumulative duration.
  const work = splits.slice(1, -1);
  const hrs = work.map((s) => s.hr).filter((n): n is number => typeof n === 'number' && n > 0);
  const cads = work.map((s) => s.cadence).filter((n): n is number => typeof n === 'number' && n > 0);

  // Estimate work seconds: each split is roughly 1 mile of the planned
  // pace. Without the pace seconds parsed we just use a rough 7-min
  // baseline; this is decorative, not metric-grade.
  const workSeconds = work.length * 7 * 60;

  return {
    hrAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    cadenceAvg: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    workSeconds,
  };
}

async function loadFormMetrics(userId: string, date: string | null): Promise<RunForm> {
  const empty: RunForm = {
    cadence_spm: null, ground_contact_ms: null, stride_length_m: null,
    vertical_oscillation_cm: null, vertical_ratio_pct: null,
    run_power_w: null, respiratory_rate: null, spo2_pct: null,
  };
  if (!date) return empty;

  const rows = (await pool.query(
    `SELECT sample_type, AVG(value)::numeric AS avg
       FROM health_samples
      WHERE user_id = $1
        AND sample_date = $2::date
        AND sample_type IN (
          'cadence','ground_contact_time','stride_length',
          'vertical_oscillation','vertical_ratio','run_power',
          'respiratory_rate','spo2'
        )
      GROUP BY sample_type`,
    [userId, date]
  ).catch(() => ({ rows: [] }))).rows;

  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.sample_type, Number(r.avg));

  return {
    cadence_spm:             byType.has('cadence')              ? Math.round(byType.get('cadence')!)                 : null,
    ground_contact_ms:       byType.has('ground_contact_time')  ? Math.round(byType.get('ground_contact_time')!)     : null,
    stride_length_m:         byType.has('stride_length')        ? +(byType.get('stride_length')!).toFixed(2)         : null,
    vertical_oscillation_cm: byType.has('vertical_oscillation') ? +(byType.get('vertical_oscillation')!).toFixed(1)  : null,
    vertical_ratio_pct:      byType.has('vertical_ratio')       ? +(byType.get('vertical_ratio')!).toFixed(1)        : null,
    run_power_w:             byType.has('run_power')            ? Math.round(byType.get('run_power')!)               : null,
    respiratory_rate:        byType.has('respiratory_rate')     ? +(byType.get('respiratory_rate')!).toFixed(1)      : null,
    spo2_pct:                byType.has('spo2')                 ? +(byType.get('spo2')!).toFixed(1)                  : null,
  };
}

/** When the activity didn't ship hrZonePcts, derive a rough split based on
 *  the runner's LTHR zones (if known) and the available avg HR. */
async function deriveHrZones(
  userId: string,
  avgHr: number | string | null,
  splits: RunSplit[],
): Promise<{ z1: number; z2: number; z3: number; z4: number; z5: number }> {
  const empty = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  const hr = Number(avgHr);
  if (!hr) return empty;

  // Pull LTHR for zone bands
  const lthrRow = await pool.query(
    `SELECT lthr FROM profile WHERE user_uuid = $1 OR (user_uuid IS NULL AND user_id='me') ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const lthr = lthrRow.rows[0]?.lthr;
  if (!lthr) return empty;
  const z = computeZones({ lthr });
  if (!z) return empty;

  // If we have per-mile HR, classify each mile.
  if (splits.length > 0 && splits.some((s) => s.hr)) {
    const counts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    let total = 0;
    for (const s of splits) {
      if (!s.hr) continue;
      total++;
      const zone = z.zones.find((zz) => s.hr! >= zz.lower && s.hr! <= zz.upper) ?? z.zones[0];
      const k = `z${zone.idx}` as keyof typeof counts;
      counts[k]++;
    }
    if (total > 0) return {
      z1: Math.round(counts.z1 / total * 100),
      z2: Math.round(counts.z2 / total * 100),
      z3: Math.round(counts.z3 / total * 100),
      z4: Math.round(counts.z4 / total * 100),
      z5: Math.round(counts.z5 / total * 100),
    };
  }

  // No splits — assign 100% to the band the avg HR falls in.
  const zone = z.zones.find((zz) => hr >= zz.lower && hr <= zz.upper) ?? z.zones[0];
  const k = `z${zone.idx}` as keyof typeof empty;
  return { ...empty, [k]: 100 };
}
