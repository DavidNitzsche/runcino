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
import { baselineTempF } from '@/lib/weather/lookup';
import { weatherContext } from '@/lib/weather/heat-adjustment';

export interface RunSplit {
  mile: number;
  pace: string | null;            // "9:18"
  hr: number | null;
  cadence: number | null;
  elev_change_ft: number | null;
  /**
   * Phase classification for this mile · derived from the run's
   * structured phaseBreakdown when present. Null for runs without
   * phase data (free-form easy runs, manual entries, Strava-only
   * imports). When set, the UI can color-code MP-finish miles
   * distinctly from the warmup build.
   */
  phase: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown' | null;
}

/**
 * P44 — single phase of a structured workout, plan vs actual.
 * Populated from WatchCompletionPhase entries in coach_intents.
 */
export interface PhaseBreakdown {
  index: number;
  label: string;            // "Warmup" | "Rep 1/4" | "Recovery" | "Cooldown"
  type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown';
  // Plan
  target_pace: string | null;       // "6:48" formatted
  target_distance_mi: number | null;
  target_duration_sec: number | null;
  // Actual
  actual_pace: string | null;
  actual_distance_mi: number | null;
  actual_duration_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  completed: boolean;
  // Derived: did the rep hit target? "on" / "fast" / "slow" / null
  status: 'on' | 'fast' | 'slow' | null;
}

/** Shoe entry surfaced inline on the run detail so the picker doesn't
 *  need a second round-trip on modal open. Shape mirrors GET /api/shoe. */
export interface RunDetailShoe {
  id: number;
  brand: string;
  model: string;
  color: string | null;
  color2: string | null;
  run_types: string[];
  mileage: number | null;
  mileage_cap: number | null;
  retired: boolean;
  preferred: boolean;
  notes: string | null;
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
  /**
   * Thermal arc for the run · the chip wants to show "65°F → 77°F" when
   * a long run rolled through real climb. Populated from data.weather
   * by the span-aware enrichment (lib/weather/openmeteo.ts). Null on
   * runs that landed before span enrichment shipped (legacy single-point
   * fetch) or runs without GPS · the chip falls back to temp_f.
   */
  temp_range_f: {
    start: number | null;
    end: number | null;
    peak: number | null;
    mean: number | null;
  } | null;
  /**
   * Total calories burned for the run. Two source-tier paths:
   *   1. Strava ships `data.calories` on detail-pulled activities · this
   *      is the strongest signal (Strava blends HR + power + weight).
   *   2. Fallback: sum of `active_energy` health samples whose
   *      sample_date falls within [start_local, start_local + moving_time].
   *      Works for Apple-Watch-only runs that never hit Strava.
   * Null when neither source has a value.
   */
  calories_kcal: number | null;
  /**
   * Post-run weather context. When the run was meaningfully hotter or
   * cooler than the runner's recent baseline, surfaces a one-line
   * explainer ("Temp 78°F vs your typical 60°F. HR ~8 bpm elevated
   * is expected.") + the estimated HR bump in bpm. Null when delta
   * isn't material (< 8°F) or temps aren't known.
   *
   * Cite: Research/06-weather-adjustments.md §1 Heat Adjustment.
   */
  weather_context: { message: string; hr_bump_bpm: number } | null;
  suffer_score: number | null;
  kudos: number | null;
  // P2 #10 (2026-05-30): average running power from HealthKit for the
  // day this run lives on. health_samples.sample_type='run_power' is
  // already ingested. Watts; null when the user doesn't ship a power
  // signal (no Stryd, no Apple Watch running power, etc.).
  power_avg_w: number | null;
  /**
   * "How was today's HR vs your usual?" · the headline signal for the
   * "how it went" verdict. Compares today's avg HR against the runner's
   * last 4 same-effort runs at a similar pace (±10s/mi bucket). Positive
   * = HR ran hotter than typical (heat, dehydration, fatigue, illness).
   * Negative = HR ran cooler than typical (well-rested, cool day).
   * Null when we don't have enough comparable runs to draw a baseline.
   *
   * Rules:
   *   · Need this run to carry both pace + HR.
   *   · Comparison pool: last 4 canonical runs with same `type` AND pace
   *     within ±10 s/mi of today's pace (the "pace bucket").
   *   · Threshold: returns the bpm delta as an integer; consumers decide
   *     when to surface (e.g. |delta| ≥ 5 bpm is meaningful for steady
   *     efforts; intervals are too variable).
   */
  hr_on_pace_delta_bpm: number | null;

  // P32 — shoe assignment surfaced for the modal picker.
  shoe_id: number | null;
  // Audit 2026-05-27: shoe inventory embedded inline so RunDetailModal
  // can render the picker without a second round-trip to /api/shoe.
  // Filtered to non-retired entries (the picker rule) but the modal can
  // still display the assigned shoe by id regardless.
  shoes: RunDetailShoe[];
  // P42 — work-only averages excluding planned recovery/rest phases.
  // Returns null when no matching planned workout structure is available;
  // otherwise these are the "real" effort numbers minus the jog-in-between
  // dilution. Upgraded P44: when phase data exists in coach_intents,
  // computes weighted averages over WORK phases only (best signal). Falls
  // back to the "skip first + last split" heuristic when phase data is
  // missing but the planned workout type is a quality session.
  pace_work: string | null;
  pace_work_s_per_mi: number | null;
  hr_avg_work: number | null;
  cadence_avg_work: number | null;
  work_seconds: number | null;

  // P44 — phase-by-phase breakdown when the watch did the workout.
  // Populated from coach_intents.value.phases (WatchCompletion payload)
  // for Faff-watch runs. Empty for runs from other sources (Apple Watch
  // Workouts, Strava, manual) where we only have mile splits.
  phase_breakdown: PhaseBreakdown[];

  has_route: boolean;
  route_polyline: string | null;  // Strava-encoded polyline if available
  splits: RunSplit[];
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number };
  hr_zones_from_lthr: { lthr: number | null; ranges: { label: string; lower: number; upper: number }[] } | null;
  form: RunForm;                  // Apple Watch form metrics for that day
  /** Migration 120 · structured spec for the plan_workouts row matching
   *  this run's date (if any). Drives the WorkoutBreakdown component on
   *  /runs/[id]. null when no plan exists, no plan_workout matches the
   *  date, or the plan-builder authored this workout without a VDOT. */
  planned_spec: import('@/lib/faff/types').WorkoutSpec | null;
  /** The plan_workouts row's sub_label, mirrored so the page can compose
   *  the WorkoutBreakdown header (e.g. "WORKOUT · CRUISE INTERVALS"). */
  planned_sub_label: string | null;
  /** plan_workouts.distance_mi for the matching row; used as the "planned
   *  distance" axis when the spec ships rep-only structures. */
  planned_distance_mi: number | null;
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
    `SELECT data, shoe_id FROM runs
      WHERE user_uuid = $1
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
        `SELECT data, shoe_id FROM runs
          WHERE user_uuid = $1
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
  // Coerce: bigint columns can come back as strings (see shoes mapping).
  const shoeId: number | null = row.shoe_id == null ? null : Number(row.shoe_id);

  // Pace — prefer formatted, else derive from seconds.
  const paceSPerMi = Number(r.paceSPerMi) || null;
  const pace = r.avgPaceMinPerMi
    || r.pace
    || fmtPace(paceSPerMi)
    || null;

  // Moving / elapsed time
  const movingSec  = Number(r.movingTimeS) || Number(r.duration_sec) || null;
  const elapsedSec = Number(r.elapsedTimeS) || Number(r.duration_sec) || null;

  // Splits — normalize various source shapes. Per-split `phase` tag is
  // filled in after phaseBreakdown loads (a few lines down) · null here
  // because we don't know yet, and a later pass walks the splits + phase
  // cumulative-distance map to attach the right tag per mile.
  const splits: RunSplit[] = Array.isArray(r.splits) ? r.splits.map((s: any, i: number) => {
    const sPerMi = Number(s.paceSPerMi) || (s.pace_s_per_mi ?? null);
    return {
      mile: Number(s.mile ?? s.index ?? i + 1) || (i + 1),
      pace: s.pace ?? s.pace_min_per_mi ?? fmtPace(sPerMi) ?? null,
      hr: Number(s.hr ?? s.avgHr) || null,
      cadence: Number(s.cadence ?? s.avgCadence) || null,
      // 2026-05-31: also accept `elev_ft` · iPhone HK importer + Faff
      // watch app post per-mile splits keyed `elev_ft` (semantically the
      // mile-end minus mile-start altitude delta, NOT an absolute). Without
      // this fallback the read-time elev sanity check below saw all-zero
      // splits and bailed back to the raw 4684 ft on watch-source rows.
      elev_change_ft: Number(s.elev_change_ft ?? s.elevChangeFt ?? s.elev_ft) || null,
      phase: null,
    };
  }) : [];

  // HR zone percentages — stored or computed from splits if missing.
  //
  // 2026-05-31: treat an all-zero hrZonePcts as MISSING data and fall
  // through to deriveHrZones. Strava (and the Watch sync path) often
  // persists a placeholder `{z1:0,...,z5:0}` when the activity has HR
  // but no per-zone breakdown was computed at write-time. Without this
  // check, the post-run hero's Z1-Z5 bar reads empty on completed runs
  // that DO have avg+max+per-mile HR (David's Tue tempo: 156/172 avg/pk).
  const hrPctsRaw = r.hrZonePcts ?? r.hr_zones ?? null;
  const hrPctsSum = hrPctsRaw
    ? (Number(hrPctsRaw.z1) || 0) + (Number(hrPctsRaw.z2) || 0)
      + (Number(hrPctsRaw.z3) || 0) + (Number(hrPctsRaw.z4) || 0)
      + (Number(hrPctsRaw.z5) || 0)
    : 0;
  const hrZonePcts = (hrPctsRaw && hrPctsSum > 0)
    ? {
        z1: Number(hrPctsRaw.z1) || 0, z2: Number(hrPctsRaw.z2) || 0,
        z3: Number(hrPctsRaw.z3) || 0, z4: Number(hrPctsRaw.z4) || 0,
        z5: Number(hrPctsRaw.z5) || 0,
      }
    : await deriveHrZones(userId, r.avgHr, splits);

  // Bring the user's LTHR-anchored zone ranges so the modal can render
  // an actionable "where your HR landed" panel.
  const lthrRow = await pool.query(
    `SELECT lthr FROM profile WHERE user_uuid = $1 ORDER BY (user_uuid=$1) DESC LIMIT 1`,
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

  // Calories. Strava ships `data.calories` on detail-pulled runs · trust
  // that first. Otherwise, sum active_energy samples in the run's window.
  const caloriesKcal = await resolveCalories({
    userId,
    stravaCalories: Number(r.calories) || null,
    startLocal: r.startLocal as string | null,
    movingTimeS: Number(r.movingTimeS) || Number(r.durationSec) || Number(r.elapsedTimeS) || 0,
  });

  // "How was today's HR vs your usual?" · compare today's avg HR at this
  // pace bucket against the runner's last 4 same-effort runs. The
  // headline signal for the "how it went" verdict, and the one that
  // separates a heat day ("HR up 9, conditions explain it") from a
  // training-load problem.
  const hrOnPaceDelta = await computeHrOnPaceDelta({
    userId,
    runIdToExclude: String(r.id ?? activityId),
    type: (r.type as string | null) ?? null,
    paceSPerMi: Number(r.paceSPerMi) || null,
    avgHr: Number(r.avgHr) || null,
  });

  // Post-run weather context. When the run's tempF is known and the
  // runner has a 14-day baseline at this lat/lon, surface a one-line
  // "hotter than normal" / "cooler than normal" explainer + HR bump.
  // Cite Research/06-weather-adjustments.md §1.
  const actualTempF = Number(r.tempF) || null;
  const startLat = Number(r.startLat ?? r.start_latitude);
  const startLng = Number(r.startLng ?? r.start_longitude);
  let weatherCtx: { message: string; hr_bump_bpm: number } | null = null;
  if (actualTempF != null && day && isFinite(startLat) && isFinite(startLng)) {
    const baseline = await baselineTempF(startLat, startLng, day).catch(() => null);
    const ctx = weatherContext({ actualTempF, baselineTempF: baseline });
    if (ctx) weatherCtx = { message: ctx.message, hr_bump_bpm: ctx.hrBumpBpm };
  }

  // P44 — phase-by-phase breakdown from watch completion payload, when
  // a Faff-watch run for this date exists in coach_intents. Returns
  // empty array for non-watch runs (Apple Watch Workouts, Strava, manual)
  // where we don't have the planned phase structure.
  const phaseBreakdown = await loadPhaseBreakdown(userId, day);

  // Per-split phase tagging · walks the phaseBreakdown's cumulative
  // distance map and assigns each mile's phase. The renderer uses this
  // to color-code MP-finish miles distinctly from the warmup build
  // (e.g. David's long: miles 1-8 = work, mile 9-11 = work@MP, mile 12 =
  // cooldown). When phaseBreakdown is empty (Strava-only / apple_watch
  // runs), every split keeps `phase: null` and the renderer falls back
  // to the run's overall effort color.
  tagSplitsWithPhases(splits, phaseBreakdown);

  // P42 + P45 — work-only averages (excluding planned recovery/rest phases).
  // Tries phase data first (best signal from the WatchCompletion payload),
  // then falls back to the splits-based heuristic. Returns nulls when no
  // structure exists or when the run is a plain easy/long run (nothing to
  // exclude).
  const workAvgs = await computeWorkAverages(userId, day, splits, phaseBreakdown);

  // Migration 120 (2026-05-28) — pull the matching plan_workouts row's
  // structured spec so /runs/[id] can render the proper WorkoutBreakdown
  // (plan-vs-actual surface). Selection: active plan + this run's date.
  // Skipped silently when no plan or no matching workout — page falls
  // back to the placeholder card.
  const plannedRow = day
    ? (await pool.query(
        `SELECT pw.workout_spec, pw.sub_label, pw.distance_mi
           FROM plan_workouts pw
           JOIN training_plans tp ON tp.id = pw.plan_id
          WHERE tp.user_uuid = $1
            AND tp.archived_iso IS NULL
            AND pw.date_iso = $2
          LIMIT 1`,
        [userId, day],
      ).catch(() => ({ rows: [] as any[] }))).rows[0]
    : null;
  const planned_spec = plannedRow?.workout_spec ?? null;
  const planned_sub_label = plannedRow?.sub_label ?? null;
  const planned_distance_mi = plannedRow?.distance_mi != null
    ? Number(plannedRow.distance_mi)
    : null;

  // Inline shoe inventory — same query as GET /api/shoe but bundled here
  // so the modal opens with no second round-trip.
  const shoesRows = (await pool.query(
    `SELECT id, brand, model, color, color2, run_types,
            mileage::numeric AS mileage,
            mileage_cap::numeric AS mileage_cap,
            COALESCE(retired, false) AS retired,
            COALESCE(preferred, false) AS preferred,
            notes
       FROM shoes
      WHERE user_uuid = $1
        AND COALESCE(retired, false) = false
      ORDER BY preferred DESC, mileage DESC NULLS LAST`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows;
  const shoes: RunDetailShoe[] = shoesRows.map((s: any) => ({
    // 2026-05-27: coerce id to number. node-postgres returns bigint
    // columns as strings by default, but RunDetailShoe.id is typed
    // as number and the ShoePicker uses strict `value === s.id` to
    // know which row is selected — string vs number broke the
    // post-save selection display ("assigned shoes are not saving").
    id: Number(s.id),
    brand: s.brand,
    model: s.model,
    color: s.color,
    color2: s.color2,
    run_types: s.run_types ?? [],
    mileage: s.mileage == null ? null : Number(s.mileage),
    mileage_cap: s.mileage_cap == null ? null : Number(s.mileage_cap),
    retired: Boolean(s.retired),
    preferred: Boolean(s.preferred),
    notes: s.notes,
  }));

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
    // 2026-05-31: barometric-drift sanity check on Strava's rolled-up
    // elev_gain_ft. Barometric watches occasionally report 5-10x the
    // real gain when ambient pressure swings during a run (humidity,
    // weather front, indoor-to-outdoor transition · David's 12.1mi
    // long run came back at 4684 ft / 387 ft/mi · mountain territory
    // on a suburban route). When the raw ratio exceeds 250 ft/mi
    // (Research/12 cap for credible urban / trail runs) AND we have
    // per-mile splits with their own elev deltas, swap the raw value
    // for sum-of-positive-deltas from splits. The splits sum is a
    // lower bound (it misses in-mile climbs that net to zero) but a
    // credible one · always better than a fictional number.
    elev_gain_ft: (() => {
      // 2026-05-31: barometric-drift sanity check (read-time fallback for
      // rows ingested before the sanity check landed on the ingest path).
      // New rows get `data.elevGainSource = 'recomputed'` stamped by the
      // ingest writer when this same check fires there.
      const raw = Number(r.elevGainFt) || null;
      const distMi = Number(r.distanceMi) || 0;
      if (raw == null || raw <= 0 || distMi <= 0) return raw;
      const ftPerMi = raw / distMi;
      if (ftPerMi <= 250) return raw;
      const minSplits = Math.max(3, Math.floor(distMi * 0.75));
      if (splits.length < minSplits) return raw;
      const splitsPositive = splits.reduce((s, sp) => {
        const c = Number(sp.elev_change_ft ?? 0);
        return s + (c > 0 ? c : 0);
      }, 0);
      if (splitsPositive <= 0) return raw;
      if (splitsPositive >= raw * 0.6) return raw;
      return Math.round(splitsPositive);
    })(),
    temp_f: Number(r.tempF) || null,
    temp_range_f: (() => {
      const w = (r.weather ?? {}) as Record<string, unknown>;
      const start = typeof w.temp_f_start === 'number' ? w.temp_f_start : null;
      const end = typeof w.temp_f_end === 'number' ? w.temp_f_end : null;
      const peak = typeof w.temp_f_peak === 'number' ? w.temp_f_peak : null;
      const mean = typeof w.temp_f_mean === 'number' ? w.temp_f_mean : null;
      // Only emit the arc when at least one bound has a value · otherwise
      // the chip should fall through to temp_f.
      if (start == null && end == null && peak == null && mean == null) return null;
      return { start, end, peak, mean };
    })(),
    weather_context: weatherCtx,
    suffer_score: Number(r.sufferScore) || null,
    kudos: Number(r.kudosCount) || null,
    // P2 #10 (2026-05-30): surface the day's avg running power (W).
    // Already loaded into form.run_power_w by loadFormMetrics() from
    // health_samples; mirror it at the top level so RunDetailModal
    // doesn't need to dig into the form nest.
    power_avg_w: form.run_power_w,
    calories_kcal: caloriesKcal,
    hr_on_pace_delta_bpm: hrOnPaceDelta,

    shoe_id: shoeId,
    shoes,
    pace_work: workAvgs.pace,
    pace_work_s_per_mi: workAvgs.paceSPerMi,
    hr_avg_work: workAvgs.hrAvg,
    cadence_avg_work: workAvgs.cadenceAvg,
    work_seconds: workAvgs.workSeconds,

    has_route: Boolean(r.summaryPolyline || r.routePolyline || r.startLatLng),
    route_polyline: r.summaryPolyline ?? r.routePolyline ?? null,
    splits,
    hrZonePcts,
    hr_zones_from_lthr,
    form,
    phase_breakdown: phaseBreakdown,
    planned_spec,
    planned_sub_label,
    planned_distance_mi,
  };
}

/**
 * P44 — load the phase-by-phase breakdown for a Faff-watch run.
 *
 * The watch app posts a WatchCompletion payload at run end that includes
 * a phases[] array with target + actual numbers per phase (warmup, each
 * rep, recoveries, cooldown). We tucked that into coach_intents so the
 * coach voice could reference "rep 3 was 4s slow." This loader surfaces
 * it to the run-detail UI so the runner sees the same breakdown they
 * felt on the watch.
 *
 * Returns []:
 *   - non-Faff-watch runs (Apple Watch Workouts, Strava, manual) where
 *     no WatchCompletion intent exists
 *   - days that did have a Faff-watch run but no phase structure (open
 *     easy runs with no planned phases)
 *
 * Only returns the most-recent watch_completion intent for the date —
 * if the runner did multiple watch sessions on one day (rare), the
 * latest one wins.
 */
async function loadPhaseBreakdown(userId: string, date: string | null): Promise<PhaseBreakdown[]> {
  if (!date) return [];
  const row = (await pool.query(
    `SELECT value FROM coach_intents
      WHERE COALESCE(user_uuid, user_id) = $1
        AND reason = 'watch_completion'
        AND ts::date = $2::date
      ORDER BY ts DESC LIMIT 1`,
    [userId, date]
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!row?.value) return [];

  let payload: any = row.value;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return []; }
  }
  const phases: any[] = Array.isArray(payload?.phases) ? payload.phases : [];
  if (phases.length === 0) return [];

  return phases.map((p: any, i: number): PhaseBreakdown => {
    const targetSPerMi = Number(p.targetPaceSPerMi) || null;
    const actualSPerMi = Number(p.actualPaceSPerMi) || null;

    // Status: on-target if within ±5s/mi, otherwise fast/slow.
    let status: 'on' | 'fast' | 'slow' | null = null;
    if (targetSPerMi && actualSPerMi && p.type !== 'recovery' && p.type !== 'rest') {
      const delta = actualSPerMi - targetSPerMi;
      if (Math.abs(delta) <= 5) status = 'on';
      else if (delta < 0) status = 'fast';      // fewer s/mi = faster
      else status = 'slow';
    }

    const typeRaw = String(p.type ?? 'unknown').toLowerCase();
    const type: PhaseBreakdown['type'] =
      typeRaw === 'warmup' || typeRaw === 'cooldown' || typeRaw === 'recovery'
        ? typeRaw
        : (typeRaw === 'work' || typeRaw === 'rep' || typeRaw === 'tempo'
            || typeRaw === 'threshold' || typeRaw === 'intervals' || typeRaw === 'race')
          ? 'work'
          : 'unknown';

    return {
      index: Number(p.index ?? i) || i,
      label: String(p.label ?? p.name ?? defaultLabel(type, i)),
      type,
      target_pace: fmtPace(targetSPerMi),
      target_distance_mi: Number(p.targetDistanceMi) || null,
      target_duration_sec: Number(p.targetDurationSec) || null,
      actual_pace: fmtPace(actualSPerMi),
      actual_distance_mi: Number(p.actualDistanceMi) || null,
      actual_duration_sec: Number(p.actualDurationSec) || null,
      avg_hr: Number(p.avgHr) || null,
      max_hr: Number(p.maxHr) || null,
      avg_cadence: Number(p.avgCadence) || null,
      completed: Boolean(p.completed ?? true),
      status,
    };
  });
}

function defaultLabel(type: PhaseBreakdown['type'], i: number): string {
  switch (type) {
    case 'warmup': return 'Warmup';
    case 'cooldown': return 'Cooldown';
    case 'recovery': return 'Recovery';
    case 'work': return `Rep ${i + 1}`;
    default: return `Phase ${i + 1}`;
  }
}

/**
 * P42 + P45 — compute averages over WORK phases only (exclude warmup,
 * recovery jogs, cooldown).
 *
 * Two signal sources, in order of preference:
 *
 *   (a) PHASE DATA from the WatchCompletion payload — when the Faff watch
 *       app ran the workout, each phase carries actualDurationSec +
 *       actualDistanceMi + avgHr + avgCadence + type. We weight each
 *       average by the phase's actual duration so a 20-min threshold rep
 *       counts more than a 90-sec recovery (which we filter out anyway).
 *       This is the metric-grade path.
 *
 *   (b) SPLITS HEURISTIC fallback — when no phase data exists but the
 *       planned workout type is a quality session (threshold/tempo/intervals
 *       /vo2max/race), drop the first split (warmup) and last split
 *       (cooldown) and average the middle. Decorative, not metric-grade.
 *
 * Returns nulls when neither path applies (easy/long runs, no plan match,
 * etc.) — the UI hides the card so the all-in averages stay the only
 * headline numbers.
 *
 * Phases counted as "work": warmup/cooldown/recovery/rest are filtered
 * out; everything else (work/rep/tempo/threshold/intervals/race) counts.
 */
/**
 * Walk `splits` and assign each mile's `phase` based on cumulative
 * distance against the `phaseBreakdown` boundaries. Mutates splits in
 * place; safe no-op when phases is empty.
 *
 * Heuristic: build a sorted list of phase boundaries by cumulative
 * distance, then for each split find the phase whose distance range
 * contains the mile's midpoint (mile N covers [N-1, N] miles). When
 * splits span more than one phase (rare · usually only happens on a
 * mid-mile recovery jog), the phase with the most overlap wins.
 *
 * Edge cases:
 *   · phases empty → splits stay phase: null
 *   · phases have no actual_distance_mi → splits stay phase: null
 *   · split mile beyond last phase boundary → tagged as last phase's type
 */
function tagSplitsWithPhases(splits: RunSplit[], phases: PhaseBreakdown[]): void {
  if (splits.length === 0 || phases.length === 0) return;

  // Build cumulative boundary list: [{ endMi, type }] sorted by index.
  const boundaries: Array<{ endMi: number; type: PhaseBreakdown['type'] }> = [];
  let cumMi = 0;
  for (const p of phases.slice().sort((a, b) => a.index - b.index)) {
    const mi = Number(p.actual_distance_mi);
    if (!isFinite(mi) || mi <= 0) continue;
    cumMi += mi;
    boundaries.push({ endMi: cumMi, type: p.type });
  }
  if (boundaries.length === 0) return;

  for (const s of splits) {
    // Midpoint of mile N is at (N - 0.5) miles of cumulative distance.
    const midpoint = Math.max(0, s.mile - 0.5);
    const match = boundaries.find((b) => midpoint <= b.endMi);
    s.phase = match?.type ?? boundaries[boundaries.length - 1].type;
  }
}

async function computeWorkAverages(
  userId: string,
  date: string | null,
  splits: RunSplit[],
  phases: PhaseBreakdown[],
): Promise<{
  pace: string | null;
  paceSPerMi: number | null;
  hrAvg: number | null;
  cadenceAvg: number | null;
  workSeconds: number | null;
}> {
  const empty = { pace: null, paceSPerMi: null, hrAvg: null, cadenceAvg: null, workSeconds: null };

  // (a) Phase-data path — preferred when WatchCompletion phases exist.
  if (phases.length > 0) {
    const workPhases = phases.filter((p) => p.type === 'work');
    if (workPhases.length > 0) {
      // Sum duration, distance for the pace calc; weight HR + cadence by duration.
      let totalSec = 0;
      let totalMi = 0;
      let hrWeighted = 0;
      let hrWeight = 0;
      let cadWeighted = 0;
      let cadWeight = 0;
      for (const p of workPhases) {
        const sec = Number(p.actual_duration_sec) || 0;
        const mi = Number(p.actual_distance_mi) || 0;
        if (sec > 0) totalSec += sec;
        if (mi > 0) totalMi += mi;
        if (p.avg_hr && sec > 0) {
          hrWeighted += p.avg_hr * sec;
          hrWeight += sec;
        }
        if (p.avg_cadence && sec > 0) {
          cadWeighted += p.avg_cadence * sec;
          cadWeight += sec;
        }
      }
      const paceSPerMi = totalMi > 0 && totalSec > 0
        ? Math.round(totalSec / totalMi)
        : null;
      const hrAvg = hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null;
      const cadenceAvg = cadWeight > 0 ? Math.round(cadWeighted / cadWeight) : null;

      // If at least one of the three signals exists, return them. Otherwise
      // fall through to the heuristic path.
      if (paceSPerMi != null || hrAvg != null || cadenceAvg != null) {
        return {
          pace: fmtPace(paceSPerMi),
          paceSPerMi,
          hrAvg,
          cadenceAvg,
          workSeconds: totalSec > 0 ? totalSec : null,
        };
      }
    }
  }

  // (b) Splits heuristic fallback — only for quality types with ≥3 splits.
  if (!date || splits.length === 0) return empty;
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
  if (!pw) return empty;

  const isQuality = ['threshold','tempo','intervals','vo2max','race'].includes(pw.type);
  if (!isQuality || splits.length < 3) return empty;

  const work = splits.slice(1, -1);
  const hrs = work.map((s) => s.hr).filter((n): n is number => typeof n === 'number' && n > 0);
  const cads = work.map((s) => s.cadence).filter((n): n is number => typeof n === 'number' && n > 0);

  // For pace from splits we parse the formatted "mm:ss" strings.
  const splitPaces: number[] = [];
  for (const s of work) {
    if (!s.pace) continue;
    const m = s.pace.match(/^(\d+):(\d{2})$/);
    if (!m) continue;
    splitPaces.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
  }
  const paceSPerMi = splitPaces.length > 0
    ? Math.round(splitPaces.reduce((a, b) => a + b, 0) / splitPaces.length)
    : null;

  // Estimate work seconds from the splits we kept.
  const workSeconds = paceSPerMi != null
    ? work.length * paceSPerMi
    : work.length * 7 * 60;

  return {
    pace: fmtPace(paceSPerMi),
    paceSPerMi,
    hrAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    cadenceAvg: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    workSeconds,
  };
}

/**
 * Resolve total calories burned for a run. Two-tier resolution:
 *
 *   1. Strava `data.calories` · trusted when present. Strava blends HR +
 *      power + weight + duration into a calibrated value · best signal.
 *   2. Sum of `active_energy` health samples in the run's window.
 *      HealthKit ships these per ~15-second bucket. We sum any sample
 *      whose timestamp falls inside [start, start + movingTimeS].
 *
 * Returns null when neither path has data. Wrapped defensively so a
 * malformed start time or DB error degrades the field to null instead
 * of throwing.
 */
async function resolveCalories(args: {
  userId: string;
  stravaCalories: number | null;
  startLocal: string | null;
  movingTimeS: number;
}): Promise<number | null> {
  if (args.stravaCalories != null && args.stravaCalories > 0) {
    return Math.round(args.stravaCalories);
  }
  if (!args.startLocal || args.movingTimeS <= 0) return null;
  try {
    const startMs = Date.parse(args.startLocal);
    if (!isFinite(startMs)) return null;
    const endMs = startMs + args.movingTimeS * 1000;
    const startIso = new Date(startMs).toISOString();
    const endIso = new Date(endMs).toISOString();
    // The table doesn't carry per-sample timestamps · `sample_date` is
    // day-granular and `recorded_at` is the insert time, which for HK
    // ingest is roughly when the watch handed the bucket to the iPhone.
    // Best-effort: prefer recorded_at when present, fall back to date.
    // Over-counts slightly when the watch lazy-uploads after the run
    // ends · but it's a fallback path, only fires when Strava has no
    // calories number, and the alternative is reporting 0 kcal forever.
    const r = await pool.query(
      `SELECT COALESCE(SUM(value), 0)::numeric AS total
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1
          AND sample_type = 'active_energy'
          AND COALESCE(recorded_at, sample_date::timestamptz) >= $2::timestamptz
          AND COALESCE(recorded_at, sample_date::timestamptz) <  $3::timestamptz`,
      [args.userId, startIso, endIso],
    );
    const total = Number(r.rows[0]?.total ?? 0);
    return total > 0 ? Math.round(total) : null;
  } catch {
    return null;
  }
}

/**
 * Compute "HR on pace delta" · how today's avg HR compares to the
 * runner's last 4 same-effort runs at the same pace.
 *
 * Why this exists (David, 2026-05-31 web-agent punch list #4):
 *   The "how it went" verdict can't honestly say "you worked harder
 *   than usual today" without knowing what "usual" is. This gives
 *   the verdict a calibrated comparison · today's HR minus the median
 *   of recent same-effort, same-pace runs.
 *
 * Comparable run definition:
 *   · Same `type` (easy/long/tempo/intervals/etc.) · matches the
 *     stimulus the runner thinks they're doing.
 *   · Pace within ±10 s/mi of today's pace · "same-effort" by pace
 *     bucket. Cardiac drift across paces is real, so we hold pace
 *     roughly constant before comparing HR.
 *   · Not today's run.
 *   · Has both pace AND avg HR. Filters out manual entries.
 *   · Most recent 4 matching runs. If fewer than 2 match, returns null
 *     (no honest baseline).
 *
 * Doctrine (Research/03 · Heart Rate Zones · cardiac drift across days):
 *   ±5 bpm at the same pace is the meaningful threshold for steady
 *   efforts · noise floor for HR baseline. Consumers gate display
 *   accordingly.
 */
async function computeHrOnPaceDelta(args: {
  userId: string;
  runIdToExclude: string;
  type: string | null;
  paceSPerMi: number | null;
  avgHr: number | null;
}): Promise<number | null> {
  if (!args.type || !args.paceSPerMi || !args.avgHr) return null;
  if (args.paceSPerMi <= 0 || args.avgHr <= 0) return null;
  try {
    const PACE_BUCKET = 10; // ±10 s/mi
    const recent = (await pool.query<{ avg_hr: string }>(
      `SELECT (data->>'avgHr')::numeric AS avg_hr
         FROM runs
        WHERE user_uuid = $1
          AND absorbed_into_canonical_at IS NULL
          AND NOT (data ? 'mergedIntoId')
          AND id::text <> $2
          AND data->>'type' = $3
          AND (data->>'paceSPerMi')::numeric BETWEEN ($4::numeric - $5) AND ($4::numeric + $5)
          AND (data->>'avgHr')::numeric > 0
        ORDER BY COALESCE(data->>'date', LEFT(data->>'startLocal', 10)) DESC
        LIMIT 4`,
      [args.userId, args.runIdToExclude, args.type, args.paceSPerMi, PACE_BUCKET],
    ).catch(() => ({ rows: [] as Array<{ avg_hr: string }> }))).rows;

    if (recent.length < 2) return null;

    // Median is more robust than mean against a single weird-day outlier.
    const hrs = recent.map(r => Number(r.avg_hr)).filter(Number.isFinite).sort((a, b) => a - b);
    if (hrs.length === 0) return null;
    const mid = Math.floor(hrs.length / 2);
    const baseline = hrs.length % 2 === 0 ? (hrs[mid - 1] + hrs[mid]) / 2 : hrs[mid];

    return Math.round(args.avgHr - baseline);
  } catch {
    return null;
  }
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
      WHERE COALESCE(user_uuid, user_id) = $1
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
    `SELECT lthr FROM profile WHERE user_uuid = $1 ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const lthr = lthrRow.rows[0]?.lthr;
  if (!lthr) return empty;
  const z = computeZones({ lthr });
  if (!z) return empty;

  // Classify a HR reading. Friel's bands leave 1-bpm gaps between zones
  // (e.g. Z2 upper 144, Z3 lower 146 at LTHR=162). A reading of 145 used to
  // default to Z1 because the `.find()` missed every band — flooring it
  // into Recovery is the opposite of what the runner did. Snap to the
  // nearest band by midpoint distance instead.
  const classify = (bpm: number) => {
    const exact = z.zones.find((zz) => bpm >= zz.lower && bpm <= zz.upper);
    if (exact) return exact;
    let best = z.zones[0];
    let bestDist = Infinity;
    for (const zz of z.zones) {
      const mid = (zz.lower + zz.upper) / 2;
      const dist = Math.abs(bpm - mid);
      if (dist < bestDist) { bestDist = dist; best = zz; }
    }
    return best;
  };

  // If we have per-mile HR, classify each mile.
  if (splits.length > 0 && splits.some((s) => s.hr)) {
    const counts = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
    let total = 0;
    for (const s of splits) {
      if (!s.hr) continue;
      total++;
      const zone = classify(s.hr);
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
  const zone = classify(hr);
  const k = `z${zone.idx}` as keyof typeof empty;
  return { ...empty, [k]: 100 };
}
