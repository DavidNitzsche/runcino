/**
 * lib/coach/readiness-history.ts · history loaders for the readiness brief.
 *
 * Pulls the 60-day window of per-pillar inputs from health_samples + runs
 * the brief needs to compute:
 *
 *   · Plews-style HRV (7-day rolling LnRMSSD + 60d SD-based SWC + CV)
 *   · Streak detection per pillar (3-day persistence rule per Research/15)
 *   · 14-day trend series for each pillar (rendered as sparklines)
 *
 * Pure history; the score function itself stays in readiness.ts and
 * consumes a snapshot of state. This file feeds it inputs.
 *
 * Doctrine citations:
 *   · Research/15 §HRV (Plews approach · 7-day rolling + SWC + CV)
 *   · Research/15 §RHR (nocturnal preferred · 60d baseline)
 *   · Research/00b §Sleep (7-9h healthy band · 8-9h+ under high load)
 *   · Research/15 §ACWR (directional sanity check · NOT deterministic)
 */

import { pool } from '@/lib/db/pool';

export interface PillarPoint {
  date: string;        // YYYY-MM-DD
  value: number;
}

export interface ReadinessHistory {
  /** 60-day raw per-pillar history. */
  sleep:      PillarPoint[];     // hours
  rhr:        PillarPoint[];     // bpm (nocturnal preferred where available)
  hrv:        PillarPoint[];     // ms (RMSSD; per-night avg)
  hrRecovery: PillarPoint[];     // bpm 60s drop

  /** Plews HRV derivatives · null when fewer than 7 days of data. */
  hrvPlews: {
    /** 7-day rolling avg of LnRMSSD (ln of HRV ms). */
    rollingLn: number | null;
    /** Most-recent rolling vs the prior rolling — change in LnRMSSD. */
    deltaLn: number | null;
    /** Smallest Worthwhile Change (SWC) · 0.5 × SD of 7-day rolling
     *  over prior 60 days. A drop of ≥ SWC for ≥3 consecutive days
     *  is the early-overreach flag. */
    swc: number | null;
    /** Coefficient of variation (CV) of the 7-day rolling, in %.
     *  Rising CV = destabilization · early functional overreach. */
    cv: number | null;
    /** 2026-06-01 · 14-day CV series for the Health-page trend strip.
     *  Each entry computes CV using the prior 14d of 7d-rolling values
     *  ending on that date. Lets the runner SEE CV climbing before
     *  HRV ms itself drops. Empty when < 21d of HRV history (need 7d
     *  for the rolling + 14d to compute SD of those rollings). */
    cvSeries: { date: string; pct: number }[];
  } | null;
}

/**
 * Load 60d of pillar history for a runner. Single-call wrapper around
 * health_samples (mirrors lib/coach/health-state.ts queries but widens
 * the window from 30 to 60 days · the Plews SWC needs 60d SD).
 *
 * Best-effort · returns empty arrays on error so the brief degrades to
 * "no data yet" copy rather than blowing up the page.
 */
export async function loadReadinessHistory(userId: string): Promise<ReadinessHistory> {
  const [sleepRows, rhrRows, hrvRows, hrrRows] = await Promise.all([
    pool.query(
      `SELECT sample_date::date AS d, value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= CURRENT_DATE - 60
          AND sample_date <= CURRENT_DATE
        ORDER BY sample_date ASC`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as Array<{ d: Date; value: number }>),
    pool.query(
      `SELECT recorded_at::date AS d, AVG(value)::numeric AS v
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY recorded_at::date
        ORDER BY d ASC`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as Array<{ d: Date; v: string }>),
    pool.query(
      `SELECT recorded_at::date AS d, AVG(value)::numeric AS v
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hrv'
          AND recorded_at >= NOW() - interval '60 days'
        GROUP BY recorded_at::date
        ORDER BY d ASC`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as Array<{ d: Date; v: string }>),
    pool.query(
      `SELECT recorded_at::date AS d, value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'hr_recovery'
          AND recorded_at >= NOW() - interval '60 days'
        ORDER BY recorded_at ASC`,
      [userId],
    ).then((r) => r.rows).catch(() => [] as Array<{ d: Date; value: number }>),
  ]);

  const sleep      = sleepRows.map((r) => ({ date: dt(r.d), value: Number(r.value) })).filter((p) => p.value > 0);
  const rhr        = rhrRows.map((r) => ({ date: dt(r.d), value: Math.round(Number(r.v)) }));
  const hrv        = hrvRows.map((r) => ({ date: dt(r.d), value: Math.round(Number(r.v)) }));
  const hrRecovery = hrrRows.map((r) => ({ date: dt(r.d), value: Number(r.value) })).filter((p) => p.value > 0);

  const hrvPlews = computePlewsHRV(hrv);

  return { sleep, rhr, hrv, hrRecovery, hrvPlews };
}

/**
 * Plews approach to HRV (Research/15 §Plews).
 *
 * Goal: filter day-to-day noise so we react to maladaptation, not weather.
 *
 *   1. Convert nightly RMSSD → LnRMSSD (natural log).
 *   2. 7-day rolling average of LnRMSSD over the entire 60-day window.
 *      (Yields ~54 rolling values for 60 days of data.)
 *   3. SWC = 0.5 × SD of those rolling values (ex. the most recent 7).
 *   4. CV = SD / mean × 100 of the rolling values.
 *   5. Delta = (today's rolling) − (yesterday's rolling).
 *
 * Returns null when fewer than 7 days of HRV history · the brief uses
 * the per-night value with no Plews context in that case.
 */
function computePlewsHRV(hrv: PillarPoint[]): ReadinessHistory['hrvPlews'] {
  if (hrv.length < 7) return null;
  const ln = hrv.map((p) => ({ date: p.date, value: Math.log(p.value) }));
  const rolling: number[] = [];
  for (let i = 6; i < ln.length; i++) {
    const window = ln.slice(i - 6, i + 1);
    const avg = window.reduce((s, p) => s + p.value, 0) / window.length;
    rolling.push(avg);
  }
  if (rolling.length === 0) return null;
  const rollingLn = rolling.at(-1) ?? null;
  const yesterday = rolling.length >= 2 ? rolling[rolling.length - 2] : null;
  const deltaLn = rollingLn != null && yesterday != null ? rollingLn - yesterday : null;

  // SWC and CV on the PRIOR 60d of rolling values (excludes today so today's
  // dip doesn't deflate the SD it's being measured against).
  const priorRolling = rolling.slice(0, -1);
  const sd = priorRolling.length >= 7 ? stddev(priorRolling) : null;
  const mean = priorRolling.length >= 7 ? priorRolling.reduce((s, v) => s + v, 0) / priorRolling.length : null;
  const swc = sd != null ? 0.5 * sd : null;
  const cv = sd != null && mean != null && mean !== 0 ? (sd / mean) * 100 : null;

  // 2026-06-01 · 14-day CV series. For each day in the last 14, recompute
  // CV using THAT day's prior 14-day rolling window. Lets the runner see
  // CV climbing before HRV ms drops (the whole point of the Plews framework).
  const cvSeries: { date: string; pct: number }[] = [];
  // Need >= 21 rollings to compute 14 CV values · each CV needs the prior 14
  // rollings for SD. Start at index 14 so prior-window has 14 elements.
  for (let i = Math.max(14, rolling.length - 14); i < rolling.length; i++) {
    const window = rolling.slice(Math.max(0, i - 14), i);
    if (window.length < 7) continue;
    const wMean = window.reduce((s, v) => s + v, 0) / window.length;
    const wSd = stddev(window);
    if (wMean === 0) continue;
    const wCv = (wSd / wMean) * 100;
    // hrv array is aligned: rolling[i] corresponds to hrv[i + 6] (window
    // started at i-6, ended at i in the original loop · so the 7d-rolling
    // at position i in `rolling` is "as of" hrv[i + 6].date).
    const dateIdx = i + 6;
    if (dateIdx < hrv.length) {
      cvSeries.push({ date: hrv[dateIdx].date, pct: round(wCv, 2) });
    }
  }

  return {
    rollingLn: rollingLn != null ? round(rollingLn, 3) : null,
    deltaLn: deltaLn != null ? round(deltaLn, 3) : null,
    swc: swc != null ? round(swc, 3) : null,
    cv: cv != null ? round(cv, 2) : null,
    cvSeries,
  };
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function round(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function dt(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
}
