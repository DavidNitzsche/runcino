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
import { runnerToday } from '@/lib/runtime/runner-tz';
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
  /** 2026-06-03 · zone for the current drift % · Research/15:
   *  · < 5%  · race-ready band · aerobic engine deeply built
   *  · 5-7%  · building band · solid base, still improving
   *  · 7-10% · developing band · base under construction
   *  · 10%+  · early base band */
  currentZone: 'race-ready' | 'building' | 'developing' | 'early-base';
  /** 2026-06-03 · static explanation · what aerobic decoupling IS. */
  whatItIs: string;
}

export async function computeDecouplingTrend(userUuid: string): Promise<DecouplingTrend | null> {
  // 2026-06-03 · runner TZ for the 60d window.
  const today = await runnerToday(userUuid);
  // Pull last 60d of long runs (>= 6mi).
  const rows = await pool.query<{ id: string; date: string; mi: number | string; splits: unknown }>(
    `SELECT id::text, data->>'date' AS date, (data->>'distanceMi')::numeric AS mi, data->'splits' AS splits
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'distanceMi')::numeric >= 6
        AND (data->>'date')::date >= $2::date - interval '60 days'
        AND COALESCE(data->>'type', '') NOT IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek')
      ORDER BY (data->>'date')::date ASC`,
    [userUuid, today],
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

  // 2026-06-03 · tightened threshold from ±1pp → ±0.5pp. David's 7.6 →
  // 6.8 was reading as 'flat' under the 1pp gate even though it's a
  // 10% relative drop in decoupling · meaningful in this metric.
  // Aerobic decoupling moves slowly · 0.5pp over 7 weeks IS signal.
  let direction: DecouplingTrend['direction'];
  if (delta < -0.5) direction = 'improving';
  else if (delta > 0.5) direction = 'declining';
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

  // 2026-06-03 · zone reference for the current drift % · per Research/15.
  const currentZone: DecouplingTrend['currentZone'] =
    currentDriftPct < 5 ? 'race-ready'
    : currentDriftPct < 7 ? 'building'
    : currentDriftPct < 10 ? 'developing'
    : 'early-base';

  // 2026-06-03 · "Lower is better" moved to the headline eyebrow on
  // the card render · so the footer just defines the term.
  const whatItIs = `Aerobic decoupling = HR drift on a steady long run, second-half avg vs first half.`;

  return {
    currentDriftPct,
    blockStartDriftPct,
    weeksTracked,
    runsCount: series.length,
    direction,
    summary,
    series: series.slice(-8),
    currentZone,
    whatItIs,
  };
}
