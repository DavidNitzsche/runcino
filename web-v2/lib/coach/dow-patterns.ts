/**
 * lib/coach/dow-patterns.ts · day-of-week patterns in recovery metrics.
 *
 * Surfaces "your HRV is consistently lowest on Mondays · this is a
 * Sunday recovery problem, not a training problem."
 *
 * Algorithm: compute mean of each pillar by day-of-week over the last
 * 60 days. Surface the highest-variance pillar with the strongest DOW
 * signal.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';

export interface DowPatterns {
  sleep: Array<{ dow: number; label: string; avg: number | null }>;
  hrv: Array<{ dow: number; label: string; avg: number | null }>;
  rhr: Array<{ dow: number; label: string; avg: number | null }>;
  insights: string[];
}

const DOW_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

async function loadDowSeries(userUuid: string, sampleType: string, dateCol: 'sample_date' | 'recorded_at::date', today: string): Promise<DowPatterns['sleep']> {
  const rows = await pool.query<{ dow: number | string; avg: number | string }>(
    `SELECT EXTRACT(dow FROM ${dateCol})::int AS dow, AVG(value::numeric) AS avg
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = $2
        AND ${dateCol} >= $3::date - interval '60 days'
      GROUP BY EXTRACT(dow FROM ${dateCol})
      ORDER BY dow ASC`,
    [userUuid, sampleType, today],
  ).then((r) => r.rows).catch(() => []);

  const byDow = new Map<number, number>();
  for (const r of rows) byDow.set(Number(r.dow), Number(r.avg));
  return DOW_LABELS.map((label, dow) => ({
    dow,
    label,
    avg: byDow.has(dow) ? +byDow.get(dow)!.toFixed(1) : null,
  }));
}

function computeInsight(series: DowPatterns['sleep'], metric: string, isLowerBetter: boolean): string | null {
  const vals = series.map((s) => s.avg).filter((v): v is number => v != null);
  if (vals.length < 5) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  // Need meaningful day-to-day variance.
  if (metric === 'HRV' && sd < 2) return null;
  if (metric === 'sleep' && sd < 0.25) return null;
  if (metric === 'RHR' && sd < 1) return null;

  // Find the worst day.
  const worstDay = series.filter((s) => s.avg != null)
    .sort((a, b) => isLowerBetter ? b.avg! - a.avg! : a.avg! - b.avg!)[0];
  if (!worstDay) return null;
  const deficit = isLowerBetter ? worstDay.avg! - mean : mean - worstDay.avg!;
  if (deficit < sd) return null;  // not a strong enough signal

  // 2026-06-03 · reframed HRV + RHR insights as pure observation. The
  // old copy attributed cause to the prior day ("likely a SAT recovery
  // problem", "pattern points at SAT stress or sleep") which the engine
  // can't actually verify · per Research/15 §HRV, the  // was §autonomic patterning · heading: ## Heart Rate Variability (HRV)
  // morning reading reflects the prior 24h but the *cause* could be
  // training load, sleep, alcohol, stress, or any combination. The
  // runner reads the pattern and decides what to investigate.
  if (metric === 'HRV') {
    return `HRV consistently lowest on ${worstDay.label} · ${(mean - worstDay.avg!).toFixed(0)}ms below your weekly average.`;
  }
  if (metric === 'sleep') {
    return `Sleep shortest on ${worstDay.label} · ${(mean - worstDay.avg!).toFixed(1)}h below your weekly average.`;
  }
  if (metric === 'RHR') {
    return `RHR highest on ${worstDay.label} · ${(worstDay.avg! - mean).toFixed(0)} bpm above your weekly average.`;
  }
  return null;
}

export async function computeDowPatterns(userUuid: string): Promise<DowPatterns | null> {
  // 2026-06-03 · runner TZ anchors the 60-day window.
  const today = await runnerToday(userUuid);
  const [sleep, hrv, rhr] = await Promise.all([
    loadDowSeries(userUuid, 'sleep_hours', 'sample_date', today),
    loadDowSeries(userUuid, 'hrv', 'recorded_at::date', today),
    loadDowSeries(userUuid, 'resting_hr', 'recorded_at::date', today),
  ]);

  // Need at least one pillar with day-of-week coverage.
  const hasData = [sleep, hrv, rhr].some((s) => s.filter((p) => p.avg != null).length >= 4);
  if (!hasData) return null;

  const insights: string[] = [];
  const hrvIns = computeInsight(hrv, 'HRV', false);
  if (hrvIns) insights.push(hrvIns);
  const sleepIns = computeInsight(sleep, 'sleep', false);
  if (sleepIns) insights.push(sleepIns);
  const rhrIns = computeInsight(rhr, 'RHR', true);
  if (rhrIns) insights.push(rhrIns);

  if (insights.length === 0) return null;
  return { sleep, hrv, rhr, insights };
}
