/**
 * L7 Signal 2 · Pace at fixed HR, longitudinal drift
 *
 * The "alive" half of the alive-but-not-nervous discipline, now with
 * a second corroborating measurement. Where Signal 1 watches threshold
 * pace at controlled HR (a hard-workout snapshot), Signal 2 watches
 * easy-pace at Z2 HR across many days (the slow-drift baseline).
 *
 * Physiology: at a fixed sub-LT effort, faster pace = lower lactate
 * cost = more aerobic fitness. A runner whose Z2 pace at HR 140 was
 * 9:00/mi six weeks ago and is 8:45/mi now has added ~5% aerobic
 * efficiency, that's a real fitness gain, independent of workout-
 * adherence noise.
 *
 * METHOD
 *   1. Walk easy + recovery + general-aerobic runs over the last 8
 *      weeks. Skip races, threshold, intervals, long runs (>9 mi).
 *   2. For each run, pull `data.splits` (per-mile pace + HR from
 *      Strava's splits_standard). Skip if splits missing, backfill
 *      via /api/admin/backfill-splits.
 *   3. For each mile-split, classify as "Z2" if avgHr lands in the
 *      user's Z2 band (built via lib/hr-zones.ts, framework-aware).
 *   4. Weight each Z2 mile by its mileage (1 mile = 1 weight). Compute
 *      weighted-mean Z2 pace per workout.
 *   5. Group workouts into two windows:
 *        - RECENT  · last 28 days (4 weeks)
 *        - PRIOR   · 29-56 days ago (4 weeks before that)
 *      Each window's weighted-mean Z2 pace gives a single number.
 *   6. Δ = recent - prior. Negative Δ = faster at same HR = fitness up.
 *
 * CONTEXT FILTERS (same policy as Signal 1)
 *   HARD context (heat > 78°F, race-recency ≤ 7 days, poor-sleep flag)
 *   excludes the entire workout from the window. Reuses Signal 1's
 *   weather + race-calendar resolvers, no duplicate plumbing.
 *
 * FIRING THRESHOLD
 *   UP (faster):  Δ ≤ -5 s/mi AND each window has ≥3 qualifying
 *                  workouts AND ≥10 Z2 mile-splits. Below 10 splits,
 *                  noise dominates.
 *   DOWN (slower): Δ ≥ +5 s/mi AND same volume gates. Same
 *                  asymmetry-of-action principle as Signal 1.
 *
 * Returns the observation shape the verdict module can consume
 * alongside Signal 1. Verdict combines them additively: a banner
 * fires when EITHER signal's UP path passes its own threshold, OR
 * when both signals together hit a softer combined threshold (NOT
 * implemented in this commit, kept simple while Signal 2 is fresh).
 */

import { query } from './db';
import { buildFitnessHrZones } from './hr-zones';
import { getWorkoutTemperatureF } from './workout-weather';
import { HEAT_CEILING_F, RACE_RECENCY_DAYS } from './adaptive-vdot-signals';

export interface Signal2Workout {
  date: string;
  name: string;
  distanceMi: number;
  /** Per-mile splits we actually used (Z2 only). */
  z2Splits: Array<{ mile: number; paceSPerMi: number; avgHr: number }>;
  /** Weight-averaged Z2 pace across this workout's qualifying miles. */
  weightedZ2PaceS: number | null;
  context: string[];
  temperatureF: number | null;
  daysToNearestRace: number | null;
  inWindow: 'recent' | 'prior' | null;
}

export interface Signal2Result {
  z2BandBpm: { lo: number; hi: number } | null;
  windows: {
    recent: { from: string; to: string; workoutCount: number; z2MileCount: number; weightedZ2PaceS: number | null };
    prior:  { from: string; to: string; workoutCount: number; z2MileCount: number; weightedZ2PaceS: number | null };
  };
  /** Pace delta in s/mi (recent - prior). Negative = faster at fixed HR. */
  deltaSPerMi: number | null;
  /** True when both windows have ≥3 workouts AND ≥10 Z2 splits each. */
  enoughVolume: boolean;
  /** Fires if delta ≤ -5 s/mi AND enoughVolume. */
  firesUp: boolean;
  /** Fires if delta ≥ +5 s/mi AND enoughVolume. */
  firesDown: boolean;
  /** Full workout list (both windows) for the diagnostic surface. */
  workouts: Signal2Workout[];
  /** Skipped workouts the diagnostic should be aware of. */
  skipped: Array<{ date: string; reason: string }>;
}

interface ActivityRow {
  id: string;
  data: {
    date?: string;
    name?: string;
    distanceMi?: number;
    movingTimeS?: number;
    workoutType?: number | null;
    startLatLng?: [number, number] | null;
    splits?: Array<{ mile: number; paceSPerMi: number; avgHr: number | null }>;
  };
}

/** Window bounds. RECENT is days 0-27, PRIOR is 28-55. */
const RECENT_WINDOW_DAYS = 28;
const PRIOR_WINDOW_DAYS = 28;
const TOTAL_LOOKBACK_DAYS = RECENT_WINDOW_DAYS + PRIOR_WINDOW_DAYS;

/** Minimum data before we'll fire. Same-shape conservative gate as
 *  Signal 1's 3+ obs / 2.5+ weight. */
const MIN_WORKOUTS_PER_WINDOW = 3;
const MIN_Z2_MILES_PER_WINDOW = 10;

/** Drift threshold. 5 s/mi is the same noise floor Signal 1 uses. */
const DRIFT_FIRE_S_PER_MI = 5;

/** Easy-pace workouts only. Strava workout_type codes:
 *    0 = default, 1 = race, 2 = long, 3 = workout (quality), 11 = (other)
 *  We accept type 0 only AND distance < 9 mi to exclude longs. */
function isEasyCandidate(data: ActivityRow['data']): boolean {
  const wt = data.workoutType ?? 0;
  if (wt !== 0 && wt !== null) return false;
  const dist = Number(data.distanceMi) || 0;
  if (dist < 3) return false;        // skip <3mi (usually warmup-only)
  if (dist >= 9) return false;       // long runs handled separately
  return true;
}

async function fetchRaceDatesForWindow(
  userId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<string[]> {
  const padDays = RACE_RECENCY_DAYS + 1;
  const padStart = new Date(Date.parse(windowStartIso + 'T00:00:00Z') - padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const padEnd = new Date(Date.parse(windowEndIso + 'T00:00:00Z') + padDays * 86_400_000)
    .toISOString().slice(0, 10);
  try {
    const rows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date
         FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' BETWEEN $2 AND $3`,
      [userId, padStart, padEnd],
    );
    return rows.map((r) => r.date).filter(Boolean);
  } catch {
    return [];
  }
}

export async function computeSignal2(
  userId: string,
  today: Date,
  maxHr: number | null,
  restingHr: number | null,
): Promise<Signal2Result> {
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - TOTAL_LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const recentCutoffIso = new Date(today.getTime() - RECENT_WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  // Build Z2 band from the user's max HR + (optional) resting HR.
  // Without a valid maxHr we can't classify miles; bail with empty result.
  const zones = buildFitnessHrZones(maxHr, restingHr);
  const z2 = zones?.z2 ?? null;
  if (!z2) {
    return {
      z2BandBpm: null,
      windows: {
        recent: { from: recentCutoffIso, to: todayIso, workoutCount: 0, z2MileCount: 0, weightedZ2PaceS: null },
        prior:  { from: cutoffIso,        to: recentCutoffIso, workoutCount: 0, z2MileCount: 0, weightedZ2PaceS: null },
      },
      deltaSPerMi: null,
      enoughVolume: false,
      firesUp: false,
      firesDown: false,
      workouts: [],
      skipped: [{ date: todayIso, reason: 'no max HR, cannot define Z2 band' }],
    };
  }

  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC > 0
        AND (data->>'movingTimeS')::NUMERIC > 0
      ORDER BY (data->>'date') DESC
      LIMIT 200`,
    [userId, cutoffIso],
  );

  const raceDates = await fetchRaceDatesForWindow(userId, cutoffIso, todayIso);

  const workouts: Signal2Workout[] = [];
  const skipped: Signal2Result['skipped'] = [];

  for (const r of rows) {
    const d = r.data;
    const date = d.date ?? '';
    if (!date) continue;

    if (!isEasyCandidate(d)) {
      skipped.push({ date, reason: 'not an easy-pace candidate (workout type or distance)' });
      continue;
    }
    if (!d.splits || d.splits.length === 0) {
      skipped.push({ date, reason: 'no per-mile splits, needs backfill' });
      continue;
    }

    // Filter splits to Z2 miles.
    const z2Splits: Signal2Workout['z2Splits'] = [];
    for (const s of d.splits) {
      const hr = Number(s.avgHr);
      const pace = Number(s.paceSPerMi);
      if (!Number.isFinite(hr) || hr <= 0) continue;
      if (!Number.isFinite(pace) || pace <= 0) continue;
      if (hr < z2.lowBpm || hr > z2.highBpm) continue;
      z2Splits.push({ mile: s.mile, paceSPerMi: pace, avgHr: hr });
    }
    if (z2Splits.length === 0) {
      skipped.push({ date, reason: 'no Z2 splits, entire run outside Z2 band' });
      continue;
    }

    // Resolve context (weather + race-recency), reuse Signal 1 policy.
    const context: string[] = [];
    let temperatureF: number | null = null;
    if (d.startLatLng) {
      temperatureF = await getWorkoutTemperatureF(d.startLatLng[0], d.startLatLng[1], date);
      if (temperatureF != null && temperatureF > HEAT_CEILING_F) context.push('heat');
    }
    let daysToNearestRace: number | null = null;
    if (raceDates.length > 0) {
      const wMs = Date.parse(date + 'T12:00:00Z');
      let minAbs = Number.POSITIVE_INFINITY;
      for (const rd of raceDates) {
        const rMs = Date.parse(rd + 'T12:00:00Z');
        const days = Math.abs(Math.round((rMs - wMs) / 86_400_000));
        if (days < minAbs) minAbs = days;
      }
      if (Number.isFinite(minAbs)) daysToNearestRace = minAbs;
      if (daysToNearestRace != null && daysToNearestRace <= RACE_RECENCY_DAYS) context.push('race-recency');
    }
    // Skip filtered workouts entirely from window math (matches the
    // hard-context policy from Signal 1, heat distorts Z2 pace badly).
    if (context.length > 0) {
      skipped.push({ date, reason: `filtered · ${context.join(', ')}` });
      continue;
    }

    // Weighted-mean Z2 pace = simple mean since each split is 1 mile.
    const weightedZ2PaceS = Math.round(
      z2Splits.reduce((s, m) => s + m.paceSPerMi, 0) / z2Splits.length,
    );

    // Bucket into window.
    const inWindow: Signal2Workout['inWindow'] = date >= recentCutoffIso ? 'recent' : 'prior';

    workouts.push({
      date,
      name: d.name || 'Easy run',
      distanceMi: Number(d.distanceMi) || 0,
      z2Splits,
      weightedZ2PaceS,
      context,
      temperatureF,
      daysToNearestRace,
      inWindow,
    });
  }

  // Aggregate per window. Each split contributes 1 mile of weight.
  function aggregate(window: 'recent' | 'prior') {
    const wks = workouts.filter((w) => w.inWindow === window);
    let totalPaceS = 0;
    let totalMiles = 0;
    for (const w of wks) {
      for (const s of w.z2Splits) {
        totalPaceS += s.paceSPerMi;
        totalMiles += 1;
      }
    }
    return {
      workoutCount: wks.length,
      z2MileCount: totalMiles,
      weightedZ2PaceS: totalMiles > 0 ? Math.round(totalPaceS / totalMiles) : null,
    };
  }

  const recentAgg = aggregate('recent');
  const priorAgg = aggregate('prior');

  const enoughVolume =
    recentAgg.workoutCount >= MIN_WORKOUTS_PER_WINDOW &&
    priorAgg.workoutCount >= MIN_WORKOUTS_PER_WINDOW &&
    recentAgg.z2MileCount >= MIN_Z2_MILES_PER_WINDOW &&
    priorAgg.z2MileCount >= MIN_Z2_MILES_PER_WINDOW;

  const deltaSPerMi =
    recentAgg.weightedZ2PaceS != null && priorAgg.weightedZ2PaceS != null
      ? recentAgg.weightedZ2PaceS - priorAgg.weightedZ2PaceS
      : null;

  const firesUp = enoughVolume && deltaSPerMi != null && deltaSPerMi <= -DRIFT_FIRE_S_PER_MI;
  const firesDown = enoughVolume && deltaSPerMi != null && deltaSPerMi >= DRIFT_FIRE_S_PER_MI;

  return {
    z2BandBpm: { lo: z2.lowBpm, hi: z2.highBpm },
    windows: {
      recent: { from: recentCutoffIso, to: todayIso, ...recentAgg },
      prior:  { from: cutoffIso,        to: recentCutoffIso, ...priorAgg },
    },
    deltaSPerMi,
    enoughVolume,
    firesUp,
    firesDown,
    workouts,
    skipped,
  };
}
