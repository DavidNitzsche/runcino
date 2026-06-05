/**
 * lib/coach/heat-acclimatization.ts · Research/06 § heat adjustment.
 *
 * Detects active heat exposure (7d rolling avg high temp > 75°F),
 * tracks the body's adaptation curve, and projects expected HR
 * penalty drop over time.
 *
 * Doctrine sources:
 *   · Research/06 § heat adjustment (8 bpm/10°F penalty on Z2)
 *   · Sawka et al. (full acclimatization in 10-14 days)
 *   · Friel · 50% acclimatized by day 5, 90%+ by day 10
 *
 * Algorithm:
 *   1. Pull last 14 days of recent run weather temps + RHR
 *   2. Detect heat window · 7d rolling avg > 75°F = exposure
 *   3. Count days in window · 1 to 14
 *   4. Compute current expected HR penalty using Sawka decay:
 *      penalty(day_N) = max_penalty × exp(-N/7)
 *   5. Compare actual RHR climb pattern to expected
 *
 * Returns null when not in a heat exposure window.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface HeatAcclimatization {
  daysInWindow: number;
  avgTempF: number;
  /** 2026-06-05 · multi-tenant audit Pattern 5 fix · was non-nullable
   *  with a 'plateauing' default when rhrSeries < 5 readings. That
   *  silently said "body is plateauing" with no evidence. Now nullable ·
   *  null means "we don't have enough RHR signal to call a trend."
   *  Consumers (the message builder) handle null by skipping the
   *  RHR-conditional prose. */
  rhrTrend: 'rising' | 'plateauing' | 'falling' | null;
  expectedHRPenaltyBpm: number;
  daysToFullAcclim: number;
  message: string;
}

const HEAT_THRESHOLD_F = 75;
const FULL_ACCLIM_DAYS = 14;
const MAX_PENALTY_BPM_AT_PEAK = 8;  // 8 bpm above baseline at peak heat per Research/06

export async function computeHeatAcclimatization(userUuid: string): Promise<HeatAcclimatization | null> {
  // 2026-06-03 · runner TZ anchors the 14d window.
  const today = await runnerToday(userUuid);
  // Pull last 14d of runs with weather + RHR.
  const tempRows = await pool.query<{ d: string; temp_f: number | string | null }>(
    `SELECT (data->>'date')::date::text AS d,
            COALESCE(
              (data->'weather'->>'temp_f')::numeric,
              (data->'weather'->'tempRange'->>'peak')::numeric,
              (data->'weather'->'tempRange'->>'mean')::numeric
            ) AS temp_f
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND data->>'weather' IS NOT NULL
        AND (data->>'date')::date >= $2::date - interval '14 days'
      ORDER BY (data->>'date')::date ASC`,
    [userUuid, today],
  ).then((r) => r.rows).catch(() => []);

  const temps = tempRows.map((r) => Number(r.temp_f)).filter((v) => Number.isFinite(v) && v > 0);
  if (temps.length < 4) return null;

  const avgTempF = temps.reduce((s, x) => s + x, 0) / temps.length;
  if (avgTempF < HEAT_THRESHOLD_F) return null;  // not in a heat window

  // Days in window · count runs above threshold.
  const heatDays = temps.filter((t) => t >= HEAT_THRESHOLD_F).length;
  const daysInWindow = Math.min(FULL_ACCLIM_DAYS, heatDays);

  // RHR trend across the window.
  const rhrRows = await pool.query<{ d: string; v: number | string }>(
    `SELECT recorded_at::date::text AS d, AVG(value::numeric)::numeric AS v
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '14 days'
      GROUP BY recorded_at::date
      ORDER BY recorded_at::date ASC`,
    [userUuid],
  ).then((r) => r.rows).catch(() => []);
  const rhrSeries = rhrRows.map((r) => Number(r.v)).filter((v) => Number.isFinite(v));

  // 2026-06-05 · multi-tenant audit Pattern 5 fix · was: defaulted to
  // 'plateauing' when rhrSeries.length < 5. Silent claim about the
  // body's adaptation state with zero RHR evidence. Now: null when
  // we don't have at least 5 RHR readings to compare halves of.
  let rhrTrend: HeatAcclimatization['rhrTrend'] = null;
  if (rhrSeries.length >= 5) {
    const firstHalf = rhrSeries.slice(0, Math.floor(rhrSeries.length / 2));
    const secondHalf = rhrSeries.slice(Math.floor(rhrSeries.length / 2));
    const firstAvg = firstHalf.reduce((s, x) => s + x, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, x) => s + x, 0) / secondHalf.length;
    const delta = secondAvg - firstAvg;
    if (delta > 1) rhrTrend = 'rising';
    else if (delta < -1) rhrTrend = 'falling';
    else rhrTrend = 'plateauing';
  }

  // Expected HR penalty using Sawka exponential decay.
  // Day 0: 100% penalty · Day 7: 36% · Day 14: 13%
  const expectedHRPenaltyBpm = +(MAX_PENALTY_BPM_AT_PEAK * Math.exp(-daysInWindow / 7)).toFixed(1);
  const daysToFullAcclim = Math.max(0, FULL_ACCLIM_DAYS - daysInWindow);

  let message: string;
  if (daysInWindow <= 3) {
    message = `Heat exposure day ${daysInWindow} of ~10 · expect ~${expectedHRPenaltyBpm} bpm HR penalty on easy efforts. Hydrate harder, cap one workout intensity this week.`;
  } else if (daysInWindow <= 7) {
    // 2026-06-05 · multi-tenant audit Pattern 5 · only the 'falling'
    // branch makes a positive RHR claim · keep that gated on real
    // signal. 'rising' / 'plateauing' / null all flow to the
    // mid-adaptation copy which is Sawka-curve-based (days, not RHR)
    // · honest with or without RHR data.
    if (rhrTrend === 'falling') {
      message = `Heat acclimatization day ${daysInWindow} · RHR is settling · the body is adapting on schedule. Expected HR penalty down to ~${expectedHRPenaltyBpm} bpm.`;
    } else {
      message = `Heat acclimatization day ${daysInWindow} · body is mid-adaptation. Expected HR penalty ~${expectedHRPenaltyBpm} bpm · should drop to ~3 bpm by day 10.`;
    }
  } else {
    message = `Heat acclimatization day ${daysInWindow} · mostly adapted · expected HR penalty ~${expectedHRPenaltyBpm} bpm. ~${daysToFullAcclim} days to full adaptation.`;
  }

  return {
    daysInWindow,
    avgTempF: +avgTempF.toFixed(1),
    rhrTrend,
    expectedHRPenaltyBpm,
    daysToFullAcclim,
    message,
  };
}
