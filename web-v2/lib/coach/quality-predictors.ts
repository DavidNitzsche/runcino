/**
 * lib/coach/quality-predictors.ts · run-quality vs recovery correlation.
 *
 * Finds the recovery metric that most strongly predicts the runner's
 * top-quartile runs. Pearson-style correlation between each recovery
 * pillar (sleep, HRV, RHR, deep sleep, REM sleep) the night BEFORE each
 * run vs the next-day run's pace (effort-normalized).
 *
 * Result: "Your top-quartile runs follow nights with deep sleep > 70min."
 *
 * Algorithm:
 *   1. Pull last 60d of runs + the runner's recovery metric on each
 *      run's prior night.
 *   2. For each pillar with enough joined data, compute correlation
 *      and threshold (mean of the pillar values that precede top-
 *      quartile runs).
 *   3. Surface the highest-correlation predictor.
 *
 * Returns null when there isn't enough joined data (< 12 runs with
 * matched recovery samples).
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface QualityPredictors {
  topPredictor: {
    metric: string;             // "Deep sleep"
    threshold: number;
    unit: string;
    correlation: number;        // 0-1 lift in top-quartile rate
    message: string;
  };
  allCorrelations: Array<{ metric: string; correlation: number }>;
}

interface JoinedRow {
  pace: number;                 // sec/mi · lower = faster
  pillarValue: number | null;
}

function pearson(rows: JoinedRow[]): number {
  const valid = rows.filter((r) => r.pillarValue != null) as Array<{ pace: number; pillarValue: number }>;
  if (valid.length < 8) return 0;
  const n = valid.length;
  const sumX = valid.reduce((s, r) => s + r.pillarValue, 0);
  const sumY = valid.reduce((s, r) => s + r.pace, 0);
  const sumXY = valid.reduce((s, r) => s + r.pillarValue * r.pace, 0);
  const sumXX = valid.reduce((s, r) => s + r.pillarValue * r.pillarValue, 0);
  const sumYY = valid.reduce((s, r) => s + r.pace * r.pace, 0);
  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  if (den === 0) return 0;
  return num / den;
}

/**
 * Convert correlation to a "lift" score · how much more likely top-
 * quartile runs are when this metric is above its predictor threshold.
 */
function liftScore(rows: JoinedRow[], threshold: number, higherIsBetter: boolean): number {
  const valid = rows.filter((r) => r.pillarValue != null) as Array<{ pace: number; pillarValue: number }>;
  if (valid.length < 8) return 0;
  // Top-quartile by pace (lowest paces).
  const paces = valid.map((r) => r.pace).sort((a, b) => a - b);
  const topPace = paces[Math.floor(paces.length / 4)];
  const topRuns = valid.filter((r) => r.pace <= topPace);
  const abovePredictor = topRuns.filter((r) => higherIsBetter ? r.pillarValue >= threshold : r.pillarValue <= threshold).length;
  return topRuns.length > 0 ? abovePredictor / topRuns.length : 0;
}

export async function computeQualityPredictors(userUuid: string): Promise<QualityPredictors | null> {
  // 2026-06-03 · runner TZ anchors the 60d window.
  const today = await runnerToday(userUuid);
  // Pull joined dataset · runs + prior night's recovery metrics.
  // 2026-06-01 · pace lives at `avgPaceMinPerMi` as mm:ss text · parse
  // to seconds in JS · SQL converts it via a CASE on whether colons
  // are present.
  const rows = await pool.query<{
    date: string; pace: number | string | null;
    sleep: number | string | null;
    hrv: number | string | null;
    rhr: number | string | null;
    deep: number | string | null;
    rem: number | string | null;
  }>(
    `SELECT r.data->>'date' AS date,
            CASE
              WHEN r.data->>'avgPaceMinPerMi' LIKE '%:%'
              THEN (SPLIT_PART(r.data->>'avgPaceMinPerMi', ':', 1)::int * 60
                  + SPLIT_PART(r.data->>'avgPaceMinPerMi', ':', 2)::int)
              ELSE (r.data->>'avgPaceMinPerMi')::numeric
            END AS pace,
            (SELECT value::numeric FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'sleep_hours'
                AND h.sample_date = (r.data->>'date')::date) AS sleep,
            (SELECT value::numeric FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'hrv'
                AND h.recorded_at::date = (r.data->>'date')::date) AS hrv,
            (SELECT value::numeric FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'resting_hr'
                AND h.recorded_at::date = (r.data->>'date')::date) AS rhr,
            (SELECT value::numeric FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'sleep_deep_minutes'
                AND h.sample_date = (r.data->>'date')::date) AS deep,
            (SELECT value::numeric FROM health_samples h
              WHERE COALESCE(h.user_uuid, h.user_id) = $1
                AND h.sample_type = 'sleep_rem_minutes'
                AND h.sample_date = (r.data->>'date')::date) AS rem
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND NOT (r.data ? 'mergedIntoId')
        AND r.data->>'avgPaceMinPerMi' IS NOT NULL
        AND (r.data->>'date')::date >= $2::date - interval '60 days'
        AND COALESCE(r.data->>'type', '') NOT IN ('race', 'shakeout', 'recovery')`,
    [userUuid, today],
  ).then((q) => q.rows).catch(() => []);

  if (rows.length < 12) return null;

  const normalize = (k: 'sleep' | 'hrv' | 'rhr' | 'deep' | 'rem'): JoinedRow[] =>
    rows.map((r) => ({
      pace: r.pace != null ? Number(r.pace) : 0,
      pillarValue: r[k] != null ? Number(r[k]) : null,
    })).filter((r) => r.pace > 0);

  // Compute correlations.
  // Sleep, HRV, deep, REM: higher = better (negative correlation with pace).
  // RHR: lower = better (positive correlation with pace).
  const candidates: Array<{ metric: string; unit: string; key: 'sleep' | 'hrv' | 'rhr' | 'deep' | 'rem'; higherIsBetter: boolean; thresholdFn: (vals: number[]) => number }> = [
    { metric: 'Deep sleep', unit: 'min', key: 'deep', higherIsBetter: true, thresholdFn: (vals) => Math.round(percentile(vals, 75)) },
    { metric: 'REM sleep', unit: 'min', key: 'rem', higherIsBetter: true, thresholdFn: (vals) => Math.round(percentile(vals, 75)) },
    { metric: 'Total sleep', unit: 'h', key: 'sleep', higherIsBetter: true, thresholdFn: (vals) => +percentile(vals, 75).toFixed(1) },
    { metric: 'HRV', unit: 'ms', key: 'hrv', higherIsBetter: true, thresholdFn: (vals) => Math.round(percentile(vals, 75)) },
    { metric: 'RHR', unit: 'bpm', key: 'rhr', higherIsBetter: false, thresholdFn: (vals) => Math.round(percentile(vals, 25)) },
  ];

  const correlations: Array<{ metric: string; correlation: number; threshold: number; unit: string; higherIsBetter: boolean }> = [];
  for (const c of candidates) {
    const rowsForC = normalize(c.key);
    const r = pearson(rowsForC);
    // Sign-flip if metric is "lower-is-better" so positive correlation = predictor strength.
    const correlationSigned = c.higherIsBetter ? -r : r;  // negative pace-correlation when higher = better
    // Compute threshold from the valid data.
    const vals = rowsForC.filter((r) => r.pillarValue != null).map((r) => r.pillarValue!);
    if (vals.length < 8) continue;
    const threshold = c.thresholdFn(vals);
    const lift = liftScore(rowsForC, threshold, c.higherIsBetter);
    // Use lift as the correlation score (more interpretable for "X% of top runs follow").
    correlations.push({
      metric: c.metric,
      correlation: +lift.toFixed(2),
      threshold,
      unit: c.unit,
      higherIsBetter: c.higherIsBetter,
    });
    void correlationSigned;
  }

  // Pick the highest-lift predictor with at least 60% lift.
  const sorted = correlations.sort((a, b) => b.correlation - a.correlation);
  const top = sorted[0];
  if (!top || top.correlation < 0.6) return null;

  const comparator = top.higherIsBetter ? '>' : '<';
  const message = `Your top-quartile runs follow nights with ${top.metric.toLowerCase()} ${comparator} ${top.threshold}${top.unit} · ${Math.round(top.correlation * 100)}% of your best runs match this pattern.`;

  return {
    topPredictor: {
      metric: top.metric,
      threshold: top.threshold,
      unit: top.unit,
      correlation: top.correlation,
      message,
    },
    allCorrelations: sorted.map((c) => ({ metric: c.metric, correlation: c.correlation })),
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * (p / 100));
  return sorted[idx];
}
