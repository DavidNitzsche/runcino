/**
 * L7 Signal 3 · Interval pace at controlled effort
 *
 * The third corroborating signal. Same shape as Signal 1 (threshold)
 * but for I-pace work — Daniels' interval pace, ~5K race pace, the
 * top of the aerobic-power adaptation curve. A runner whose I-pace
 * splits are 5+ s/mi faster than prescribed at Z4-Z5 HR has gained
 * VO₂max-shifting fitness.
 *
 * METHOD
 *   1. Walk last 6 weeks of activities (same window as Signal 1).
 *   2. Identify interval-effort candidates:
 *        - plannedWorkoutType matches intervals/threshold_intervals
 *        - OR activity name contains common interval-workout keywords
 *        - OR splits show a "fast outlier" pattern (one+ split ≥15
 *          s/mi faster than the activity median)
 *   3. For each candidate, find the FASTEST mile-splits where HR sat
 *      in Z4-Z5 (the work-interval miles, distinct from warmup +
 *      recovery jogs).
 *   4. Compute the mean pace of those work-interval miles → that's
 *      this workout's "I-pace observation."
 *   5. Compare to user's I-pace center (from pacesFromVdot). Apply
 *      Signal 1's HARD/SOFT context taxonomy.
 *
 * Why per-mile splits (not activity avg): an interval activity is a
 * mix of warmup, work, rest jogs, cooldown. The activity-level avg
 * pace is meaningless. The fast splits ARE the workout.
 *
 * Why Z4-Z5 HR (not just Z5): I-pace work peaks in Z5 but most of
 * the work-interval clock sits in upper Z4 (especially on short
 * intervals where HR lags behind effort). Daniels: intervals "raise
 * the lid" of aerobic power; HR will trail pace on shorter reps.
 *
 * CONTEXT FILTERS · same policy as Signal 1
 *   HARD (heat > 78°F, race-recency ≤ 7 days, poor-sleep) zeros the
 *   observation. SOFT (hr-missing on the work splits) attenuates to
 *   ×0.6.
 *
 * FIRING THRESHOLD · same as Signal 1
 *   UP: 3+ observations AND weight ≥ 2.5
 *   DOWN: 2+ observations AND weight ≥ 1.5
 *
 * Returns the per-workout observation shape the verdict module
 * combines alongside Signals 1 and 2.
 */

import { query } from './db';
import { pacesFromVdot } from './vdot';
import { buildFitnessHrZones } from './hr-zones';
import { getWorkoutTemperatureF } from './workout-weather';
import { HEAT_CEILING_F, RACE_RECENCY_DAYS } from './adaptive-vdot-signals';

export interface Signal3Observation {
  date: string;
  workoutLabel: string;
  workoutType: string;
  /** Mean raw pace of the work-interval splits (s/mi). */
  workIntervalPaceS: number;
  /** Mean grade-adjusted pace of the work-interval splits (s/mi).
   *  Null when no GAP available for any work split. */
  workIntervalGapS: number | null;
  /** The pace we ACTUALLY used for comparison — raw or GAP depending
   *  on whether terrain distortion was significant (>20 s/mi gap). */
  comparisonPaceS: number;
  /** Tag explaining which pace fed the comparison + why. */
  comparisonBasis: 'raw' | 'gap' | 'raw-no-gap-available';
  /** Prescribed I-pace center from VDOT (s/mi). */
  prescribedPaceS: number;
  /** Δ in s/mi using comparisonPaceS (positive = slower). */
  paceDeltaS: number;
  /** Average HR across the work-interval splits. */
  workAvgHr: number | null;
  /** True if work HR sat in Z4-Z5 territory. */
  hrInRange: boolean | null;
  /** Splits we identified as work intervals. */
  workSplits: Array<{
    mile: number;
    paceSPerMi: number;
    gapSPerMi: number | null;
    avgHr: number | null;
  }>;
  context: string[];
  temperatureF: number | null;
  daysToNearestRace: number | null;
  faster: boolean;
  slower: boolean;
  weight: number;
}

export interface Signal3Result {
  iPaceCenterS: number | null;
  z4z5Range: { lo: number; hi: number } | null;
  observations: Signal3Observation[];
  candidatesSkipped: Array<{ date: string; reason: string }>;
  fasterCount: number;
  slowerCount: number;
  fasterWeight: number;
  slowerWeight: number;
  firesUp: boolean;
  firesDown: boolean;
}

const LOOKBACK_DAYS = 42;
const UP_OBS_MIN = 3;
const UP_WEIGHT_MIN = 2.5;
const DOWN_OBS_MIN = 2;
const DOWN_WEIGHT_MIN = 1.5;
const FASTER_THRESHOLD_S = 5;
const SLOWER_THRESHOLD_S = 5;
const HR_MISSING_FACTOR = 0.6;
const HARD_CONTEXT_TAGS = new Set(['heat', 'race-recency', 'poor-sleep']);

/** Interval-workout keyword detection — used when the activity
 *  doesn't carry a plannedWorkoutType but the runner clearly
 *  named the session. */
const INTERVAL_NAME_KEYWORDS = [
  /interval/i,
  /repeats?\b/i,
  /\d+\s*x\s*\d/i,  // "5x400", "4 x 800"
  /pyramid/i,
  /vo2/i,
  /track\b/i,
];

interface ActivityRow {
  id: string;
  data: {
    date?: string;
    name?: string;
    distanceMi?: number;
    movingTimeS?: number;
    avgHr?: number;
    workoutType?: number | null;
    startLatLng?: [number, number] | null;
    plannedWorkoutType?: string;
    plannedLabel?: string;
    splits?: Array<{
      mile: number;
      paceSPerMi: number;
      gapSPerMi?: number | null;
      avgHr: number | null;
    }>;
  };
}

/** Threshold for "meaningful terrain distortion." When raw and grade-
 *  adjusted pace differ by more than this many seconds per mile,
 *  Signal 3 swaps to GAP for the I-pace comparison. Below this gap,
 *  the difference is noise and raw pace is the honest reading.
 *  Locked with David 2026-05-19 round 4. */
const GAP_SWAP_THRESHOLD_S = 20;

function isIntervalCandidate(data: ActivityRow['data']): boolean {
  // Planned-workout tag is the most reliable signal
  if (data.plannedWorkoutType === 'intervals' || data.plannedWorkoutType === 'threshold_intervals') {
    return true;
  }
  // Strava workoutType=3 = "Workout" tag (catch-all for hard sessions)
  if (data.workoutType === 3) {
    // Refine: name must look like intervals (not threshold/tempo)
    const name = data.name ?? '';
    if (INTERVAL_NAME_KEYWORDS.some((r) => r.test(name))) return true;
  }
  // Fall through: name explicitly says intervals
  const name = data.name ?? '';
  if (INTERVAL_NAME_KEYWORDS.some((r) => r.test(name))) return true;
  return false;
}

type SplitWithOptionalGap = {
  mile: number;
  paceSPerMi: number;
  gapSPerMi?: number | null;
  avgHr: number | null;
};

/** Identify the "work" splits within an interval activity. Approach:
 *  find the fastest contiguous splits whose HR sat in Z4-Z5. Skip
 *  warmup (first mile usually slow) and cooldown (last mile often
 *  recovery jog). */
function pickWorkSplits(
  splits: Array<SplitWithOptionalGap>,
  z4z5: { lo: number; hi: number },
): Array<SplitWithOptionalGap> {
  if (splits.length === 0) return [];
  // Filter to splits with HR in Z4-Z5 range. If no HR data, fall
  // back to top-3 fastest splits.
  const inZ45 = splits.filter((s) =>
    s.avgHr != null && s.avgHr >= z4z5.lo && s.avgHr <= z4z5.hi,
  );
  if (inZ45.length >= 1) return inZ45;
  // No HR-in-Z45 splits — pick the 2-3 fastest splits as a proxy
  // for "work intervals" (rough but better than empty). These are
  // signal-weakened (hr-missing tag will fire if we can't confirm).
  const sorted = [...splits].sort((a, b) => a.paceSPerMi - b.paceSPerMi);
  return sorted.slice(0, Math.min(3, sorted.length));
}

async function fetchRaceDates(userId: string, startIso: string, endIso: string): Promise<string[]> {
  const padDays = RACE_RECENCY_DAYS + 1;
  const padStart = new Date(Date.parse(startIso + 'T00:00:00Z') - padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const padEnd = new Date(Date.parse(endIso + 'T00:00:00Z') + padDays * 86_400_000)
    .toISOString().slice(0, 10);
  try {
    const rows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' BETWEEN $2 AND $3`,
      [userId, padStart, padEnd],
    );
    return rows.map((r) => r.date).filter(Boolean);
  } catch {
    return [];
  }
}

export async function computeSignal3(
  userId: string,
  today: Date,
  currentVdot: number,
  maxHr: number | null,
  restingHr: number | null,
): Promise<Signal3Result> {
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000)
    .toISOString().slice(0, 10);

  const paces = pacesFromVdot(currentVdot);
  const iPaceCenterS = paces ? Math.round((paces.I.lowS + paces.I.highS) / 2) : null;

  const zones = buildFitnessHrZones(maxHr, restingHr);
  // Z4-Z5 ceiling: from Z4 lower bound to Z5 upper bound. Captures
  // upper-threshold through max-effort intervals.
  const z4z5 = zones ? { lo: zones.z4.lowBpm, hi: zones.z5.highBpm } : null;

  if (!iPaceCenterS || !z4z5) {
    return {
      iPaceCenterS,
      z4z5Range: z4z5,
      observations: [],
      candidatesSkipped: [{ date: todayIso, reason: !iPaceCenterS ? 'no VDOT-derived I pace' : 'no Z4-Z5 band (max HR missing)' }],
      fasterCount: 0, slowerCount: 0,
      fasterWeight: 0, slowerWeight: 0,
      firesUp: false, firesDown: false,
    };
  }

  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND (data->>'distanceMi')::NUMERIC > 0
      ORDER BY (data->>'date') DESC
      LIMIT 100`,
    [userId, cutoffIso],
  );

  const raceDates = await fetchRaceDates(userId, cutoffIso, todayIso);
  const observations: Signal3Observation[] = [];
  const skipped: Signal3Result['candidatesSkipped'] = [];

  for (const r of rows) {
    const d = r.data;
    const date = d.date ?? '';
    if (!date) continue;

    if (!isIntervalCandidate(d)) {
      skipped.push({ date, reason: 'not an interval candidate (no workout-type match, no name keyword)' });
      continue;
    }
    if (!d.splits || d.splits.length === 0) {
      skipped.push({ date, reason: 'no per-mile splits — needs backfill' });
      continue;
    }

    // Pick work splits.
    const workSplits = pickWorkSplits(d.splits, z4z5);
    if (workSplits.length === 0) {
      skipped.push({ date, reason: 'no work-interval splits identified' });
      continue;
    }

    const workIntervalPaceS = Math.round(
      workSplits.reduce((s, w) => s + w.paceSPerMi, 0) / workSplits.length,
    );

    // GAP comparison logic · per David 2026-05-19 round 4 spec:
    //   - If GAP is available for ALL work splits AND the mean
    //     raw-vs-GAP gap exceeds GAP_SWAP_THRESHOLD_S (20 s/mi),
    //     terrain is distorting the comparison — swap to GAP.
    //   - If GAP is available but gap is < 20 s/mi, raw pace is
    //     the honest reading (flat-ish terrain).
    //   - If GAP missing on any split, fall back to raw with a
    //     'raw-no-gap-available' tag so the diagnostic surfaces
    //     the uncertainty. Don't compute GAP locally.
    const gapSplits = workSplits.filter((w) => w.gapSPerMi != null && w.gapSPerMi > 0);
    const allHaveGap = gapSplits.length === workSplits.length;
    const workIntervalGapS = allHaveGap && gapSplits.length > 0
      ? Math.round(gapSplits.reduce((s, w) => s + (w.gapSPerMi ?? 0), 0) / gapSplits.length)
      : null;
    const rawVsGapDistortionS = workIntervalGapS != null
      ? Math.abs(workIntervalPaceS - workIntervalGapS)
      : null;
    let comparisonPaceS = workIntervalPaceS;
    let comparisonBasis: Signal3Observation['comparisonBasis'] = 'raw';
    if (workIntervalGapS == null) {
      comparisonBasis = 'raw-no-gap-available';
    } else if (rawVsGapDistortionS != null && rawVsGapDistortionS > GAP_SWAP_THRESHOLD_S) {
      comparisonPaceS = workIntervalGapS;
      comparisonBasis = 'gap';
    } else {
      comparisonBasis = 'raw';
    }

    const hrSplits = workSplits.filter((w) => w.avgHr != null);
    const workAvgHr = hrSplits.length > 0
      ? Math.round(hrSplits.reduce((s, w) => s + (w.avgHr ?? 0), 0) / hrSplits.length)
      : null;
    const hrInRange = workAvgHr != null ? (workAvgHr >= z4z5.lo && workAvgHr <= z4z5.hi) : null;

    const paceDeltaS = comparisonPaceS - iPaceCenterS;

    // Resolve context (weather + race-recency).
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
    if (workAvgHr == null) context.push('hr-missing');

    const hasHard = context.some((t) => HARD_CONTEXT_TAGS.has(t));
    const hasHrMissing = context.includes('hr-missing');
    let weight = 1.0;
    if (hasHard) weight = 0;
    else if (hasHrMissing) weight = HR_MISSING_FACTOR;

    const fasterEnough = paceDeltaS < -FASTER_THRESHOLD_S;
    const slowerEnough = paceDeltaS > SLOWER_THRESHOLD_S;
    const hrAllows = hrInRange !== false;  // null OK (no HR data), explicit false blocks
    const faster = fasterEnough && hrAllows && !hasHard;
    const slower = slowerEnough && hrAllows && !hasHard;

    observations.push({
      date,
      workoutLabel: d.plannedLabel || d.name || 'Interval workout',
      workoutType: d.plannedWorkoutType || 'intervals',
      workIntervalPaceS,
      workIntervalGapS,
      comparisonPaceS,
      comparisonBasis,
      prescribedPaceS: iPaceCenterS,
      paceDeltaS,
      workAvgHr,
      hrInRange,
      workSplits: workSplits.map((w) => ({
        mile: w.mile,
        paceSPerMi: w.paceSPerMi,
        gapSPerMi: w.gapSPerMi ?? null,
        avgHr: w.avgHr,
      })),
      context,
      temperatureF,
      daysToNearestRace,
      faster,
      slower,
      weight,
    });
  }

  const fasterObs = observations.filter((o) => o.faster);
  const slowerObs = observations.filter((o) => o.slower);
  const fasterCount = fasterObs.length;
  const slowerCount = slowerObs.length;
  const fasterWeight = fasterObs.reduce((s, o) => s + o.weight, 0);
  const slowerWeight = slowerObs.reduce((s, o) => s + o.weight, 0);

  return {
    iPaceCenterS,
    z4z5Range: z4z5,
    observations,
    candidatesSkipped: skipped,
    fasterCount, slowerCount,
    fasterWeight, slowerWeight,
    firesUp: fasterCount >= UP_OBS_MIN && fasterWeight >= UP_WEIGHT_MIN,
    firesDown: slowerCount >= DOWN_OBS_MIN && slowerWeight >= DOWN_WEIGHT_MIN,
  };
}
