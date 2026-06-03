/**
 * lib/training/decoupling-trend.ts · per-block aerobic engine trajectory.
 *
 * Aggregates per-run aerobic decoupling across the last N steady-state
 * long runs. The single best proof your aerobic base is improving across
 * a build block · decoupling moves visibly week-to-week, unlike VO2 max
 * which barely budges.
 *
 * Doctrine: Research/15 § aerobic decoupling.
 *
 *   A runner whose aerobic engine is improving will show progressively
 *   lower pace-to-HR drift on long steady-state runs. The trajectory
 *   across a 4-8 week block tells the story · race-readiness is built,
 *   not declared.
 *
 * Algorithm:
 *   1. Pull last 60d of long runs with computed decoupling (>= 6mi
 *      steady-state)
 *   2. Filter to non-race / non-interval workouts (steady-state only)
 *   3. Take the first N and the last N · compare averages
 *   4. Surface the trend message
 *
 * Returns null when there aren't enough samples for a meaningful trend
 * (< 3 runs in the window).
 */

import { pool } from '@/lib/db/pool';
import { computeAerobicDecoupling } from './aerobic-decoupling';

export interface DecouplingTrend {
  /** Current drift % · mean of the last 3 long runs. */
  currentDriftPct: number;
  /** Block-start drift % · mean of the first 3 long runs in the window. */
  blockStartDriftPct: number;
  /** Number of weeks the window spans (max 8). */
  weeksTracked: number;
  /** Number of long runs in the trend. */
  runsCount: number;
  /** Direction · derived from delta. */
  direction: 'improving' | 'flat' | 'declining';
  /** Plain-language summary. */
  summary: string;
  /** Latest 8 data points for a tile sparkline. */
  series: { date: string; driftPct: number }[];
}

export async function computeDecouplingTrend(userUuid: string): Promise<DecouplingTrend | null> {
  // Pull last 60d of long runs (>= 6mi).
  const rows = await pool.query<{ id: string; date: string; mi: number | string; splits: unknown }>(
    `SELECT id::text, data->>'date' AS date, (data->>'distanceMi')::numeric AS mi, data->'splits' AS splits
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric >= 6
        AND (data->>'date')::date >= CURRENT_DATE - interval '60 days'
        AND COALESCE(data->>'type', '') NOT IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek')
      ORDER BY (data->>'date')::date ASC`,
    [userUuid],
  ).then((r) => r.rows).catch(() => []);

  const series: { date: string; driftPct: number }[] = [];
  for (const r of rows) {
    const splits = Array.isArray(r.splits) ? r.splits as Parameters<typeof computeAerobicDecoupling>[0] : null;
    const result = computeAerobicDecoupling(splits, Number(r.mi));
    if (result) series.push({ date: r.date, driftPct: result.driftPct });
  }

  if (series.length < 3) return null;

  // First-3 vs last-3 mean.
  const first3 = series.slice(0, 3);
  const last3 = series.slice(-3);
  const blockStartDriftPct = +(first3.reduce((s, p) => s + p.driftPct, 0) / first3.length).toFixed(1);
  const currentDriftPct = +(last3.reduce((s, p) => s + p.driftPct, 0) / last3.length).toFixed(1);
  const delta = currentDriftPct - blockStartDriftPct;

  let direction: DecouplingTrend['direction'];
  if (delta < -1) direction = 'improving';
  else if (delta > 1) direction = 'declining';
  else direction = 'flat';

  // Weeks tracked = span of dates.
  const firstDate = new Date(series[0].date);
  const lastDate = new Date(series[series.length - 1].date);
  const daysSpan = (lastDate.getTime() - firstDate.getTime()) / 86400000;
  const weeksTracked = Math.max(1, Math.min(8, Math.round(daysSpan / 7)));

  // 2026-06-03 · stripped prescriptive tails ("push more aerobic volume",
  // "check whether load has outpaced recovery") per no-reactive-coach
  // doctrine. The engine describes what the decoupling number says, the
  // runner decides what to do about it.
  let summary: string;
  if (direction === 'improving') {
    const verdict = currentDriftPct < 5 ? 'race-ready band' : currentDriftPct < 7 ? 'building strongly' : 'building';
    summary = `Aerobic decoupling ${blockStartDriftPct}% → ${currentDriftPct}% over ${weeksTracked} week${weeksTracked === 1 ? '' : 's'} · the engine is getting more efficient · ${verdict}.`;
  } else if (direction === 'flat') {
    summary = `Aerobic decoupling holding ~${currentDriftPct}% over ${weeksTracked} week${weeksTracked === 1 ? '' : 's'} · the engine is stable, neither building nor losing efficiency.`;
  } else {
    summary = `Aerobic decoupling ${blockStartDriftPct}% → ${currentDriftPct}% over ${weeksTracked} week${weeksTracked === 1 ? '' : 's'} · efficiency declining across the block.`;
  }

  return {
    currentDriftPct,
    blockStartDriftPct,
    weeksTracked,
    runsCount: series.length,
    direction,
    summary,
    series: series.slice(-8),
  };
}
