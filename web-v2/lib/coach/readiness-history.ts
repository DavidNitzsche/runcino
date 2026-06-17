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
import { runnerToday } from '@/lib/runtime/runner-tz';

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
  /** 2026-06-01 · 30-day wrist temp history · feeds the wrist-temp
   *  forecaster. °C nightly avg. Empty when no wrist_temp data exists. */
  wristTemp:  PillarPoint[];     // °C

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
    /** RMSSDcv · coefficient of variation of RAW RMSSD, in %.
     *  Research/03 §CV: CV = SD(RMSSD)/mean(RMSSD)×100. Rising CV =
     *  destabilization · early functional overreach. 2026-06-16 · #20 ·
     *  computed on raw RMSSD (was: rolling LnRMSSD, which never reached
     *  the bands). Bands (Research/03): recreational 8–12%, intensified
     *  8–14%, NFOR >14%. */
    cv: number | null;
    /** 2026-06-01 · 14-day CV series for the Health-page trend strip.
     *  Each entry is the RMSSDcv over the trailing 14d of raw RMSSD ending
     *  on that date. Lets the runner SEE CV climbing before HRV ms itself
     *  drops. Empty until ≥14d of HRV history (need a full window). */
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
  // 2026-06-03 · runner TZ for the 60d / 30d windows · sample_date and
  // recorded_at are anchored against the runner's calendar day, not
  // server UTC. NOW() in the recorded_at queries kept as-is because it
  // compares against a TIMESTAMP column · the day boundary doesn't
  // matter for a 60-day rolling window of HRV/RHR readings.
  const today = await runnerToday(userId);
  const [sleepRows, rhrRows, hrvRows, hrrRows, wristTempRows] = await Promise.all([
    pool.query(
      `SELECT sample_date::date AS d, value
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
          AND sample_date >= $2::date - 60
          AND sample_date <= $2::date
        ORDER BY sample_date ASC`,
      [userId, today],
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
    // 2026-06-01 · wrist temp 30d for the wrist-temp forecaster.
    // Research/15 §Spotting-Illness-Early · rises 24-48h pre-illness · the  // was §wrist temp · heading: ## Spotting Illness Early
    // forecaster surfaces the trajectory before the runner feels it.
    pool.query(
      `SELECT sample_date::date AS d, AVG(value::numeric) AS v
         FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'wrist_temp'
          AND sample_date >= $2::date - 30
        GROUP BY sample_date::date
        ORDER BY sample_date::date ASC`,
      [userId, today],
    ).then((r) => r.rows).catch(() => [] as Array<{ d: Date; v: string }>),
  ]);

  const sleep      = sleepRows.map((r) => ({ date: dt(r.d), value: Number(r.value) })).filter((p) => p.value > 0);
  const rhr        = rhrRows.map((r) => ({ date: dt(r.d), value: Math.round(Number(r.v)) }));
  const hrv        = hrvRows.map((r) => ({ date: dt(r.d), value: Math.round(Number(r.v)) }));
  const hrRecovery = hrrRows.map((r) => ({ date: dt(r.d), value: Number(r.value) })).filter((p) => p.value > 0);
  const wristTemp  = wristTempRows.map((r) => ({ date: dt(r.d), value: +Number(r.v).toFixed(2) })).filter((p) => p.value > 30);

  const hrvPlews = computePlewsHRV(hrv);

  return { sleep, rhr, hrv, hrRecovery, wristTemp, hrvPlews };
}

// 2026-06-16 · #20 · window (days of raw readings) for the RMSSD CV.
// 14 trailing days gives a stable SD estimate and matches the length of
// the CV trend strip below.
const CV_WINDOW_DAYS = 14;

/**
 * Plews approach to HRV (Research/15 §Plews).
 *
 * Goal: filter day-to-day noise so we react to maladaptation, not weather.
 *
 *   1. Convert nightly RMSSD → LnRMSSD (natural log).
 *   2. 7-day rolling average of LnRMSSD over the entire 60-day window.
 *      (Yields ~54 rolling values for 60 days of data.)
 *   3. SWC = 0.5 × SD of those rolling values (ex. the most recent 7).
 *   4. Delta = (today's rolling) − (yesterday's rolling).
 *
 * CV is computed SEPARATELY on RAW RMSSD (NOT the rolling LnRMSSD) — see
 * computeRmssdCv and the #20 note below.
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

  // SWC on the PRIOR 60d of rolling LnRMSSD values (excludes today so
  // today's dip doesn't deflate the SD it's measured against). SWC stays
  // on LnRMSSD per Research/15 §Plews — only CV moves to raw RMSSD.
  const priorRolling = rolling.slice(0, -1);
  const sd = priorRolling.length >= 7 ? stddev(priorRolling) : null;
  const swc = sd != null ? 0.5 * sd : null;

  // 2026-06-16 · #20 · CV on RAW RMSSD, not the rolling LnRMSSD.
  //
  // The doctrine for RMSSDcv is Research/03 §CV (Coefficient of
  // Variation): `CV = SD(RMSSD) / mean(RMSSD) × 100%`, computed on RAW
  // RMSSD. Its population bands (Research/03): elite 5–8%, recreational
  // 8–12%, intensified block 8–14%, NFOR >14% (and line 371: >10–14% =
  // increased acute perturbation, persistent → overload).
  //
  // The old code computed CV on the 7-day rolling average of LnRMSSD.
  // That double variance-suppression (log transform + 7d smoothing)
  // drove CV to ~sub-1% on a normal series, so the 5%/7% display/action
  // bands — which themselves came from the raw-RMSSD literature — could
  // never fire (a 7% CV-of-rolling-Ln needs a ~±32% week-over-week
  // swing). Both the INPUT (rolling-Ln → raw RMSSD) and the BANDS (5/7 →
  // 10/14 per Research/03) were wrong. Fixed here + in the consuming
  // band/action thresholds (readiness-brief.ts, health-actions.ts).
  //
  // Computed over the trailing CV_WINDOW_DAYS of raw readings, excluding
  // today (same "today's dip doesn't deflate its own SD" property the
  // old code had via priorRolling).
  const priorRaw = hrv.slice(0, -1).map((p) => p.value);
  const cv = computeRmssdCv(priorRaw.slice(-CV_WINDOW_DAYS));

  // 2026-06-01 · CV trend strip. For each recent day, recompute RMSSDcv
  // over THAT day's trailing CV_WINDOW_DAYS of raw RMSSD. Lets the runner
  // see CV climbing before HRV ms drops (the point of the Plews/RMSSDcv
  // framework).
  const cvSeries: { date: string; pct: number }[] = [];
  for (let i = Math.max(CV_WINDOW_DAYS, hrv.length - 14); i < hrv.length; i++) {
    const window = hrv.slice(Math.max(0, i - CV_WINDOW_DAYS), i).map((p) => p.value);
    const wCv = computeRmssdCv(window);
    if (wCv == null) continue;
    cvSeries.push({ date: hrv[i].date, pct: round(wCv, 2) });
  }

  return {
    rollingLn: rollingLn != null ? round(rollingLn, 3) : null,
    deltaLn: deltaLn != null ? round(deltaLn, 3) : null,
    swc: swc != null ? round(swc, 3) : null,
    cv: cv != null ? round(cv, 2) : null,
    cvSeries,
  };
}

/**
 * 2026-06-16 · #20 · RMSSDcv per Research/03 §CV.
 *   CV = SD(RMSSD) / mean(RMSSD) × 100%  (raw RMSSD, NOT LnRMSSD)
 * Needs ≥7 readings for a meaningful SD; returns null below that.
 */
function computeRmssdCv(rawRmssd: number[]): number | null {
  const xs = rawRmssd.filter((v) => Number.isFinite(v) && v > 0);
  if (xs.length < 7) return null;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  if (mean === 0) return null;
  return (stddev(xs) / mean) * 100;
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
