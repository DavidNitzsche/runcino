/**
 * lib/training/decoupling-trend.ts · per-block aerobic engine trajectory.
 *
 * Aggregates per-run aerobic decoupling across the last N steady-state
 * long runs. The single best proof your aerobic base is improving across
 * a build block · decoupling moves visibly week-to-week, unlike VO2 max
 * which barely budges.
 *
 * Doctrine: Research/03-heart-rate-zones.md §12 "Cardiac Drift and Aerobic
 * Decoupling (Pa:HR)".
 *
 *   A runner whose aerobic engine is improving will show progressively
 *   lower pace-to-HR drift on long steady-state runs. The trajectory
 *   across a 4-8 week block tells the story · race-readiness is built,
 *   not declared.
 *
 * Algorithm:
 *   1. Pull last 60d of steady runs long enough to carry the signal
 *   2. Filter to non-race / non-interval workouts (steady-state only)
 *   3. Take the first N and the last N · compare averages
 *   4. Surface the trend message
 *
 * 2026-08-19 · the SQL used to require `>= 6` miles, mirroring the distance
 * gate `computeAerobicDecoupling` no longer has. §12 states the protocol in
 * time (60-90 min), so the qualifying test is duration and it lives in exactly
 * one place — the computation. The distance term here is now only a cheap
 * prefilter for "could possibly hold four mile-splits", and every row it lets
 * through is still judged by the real gate below. That is what re-opens this
 * whole surface for a 5K/10K runner: a 5-mile long run at 12:00/mi is a 60
 * minute steady effort and always was a valid drift read.
 *
 * Returns null when there aren't enough samples for a meaningful trend
 * (< 3 runs in the window).
 */

import { pool } from '@/lib/db/pool';
import {
  runDaySql,
  runDateKeySql,
  runDistanceMiSql,
  runSplitsSql,
  runWorkoutTypeSql,
  runTypeSql,
  runTempFSql,
} from '@/lib/runs/run-shape';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import {
  computeAerobicDecoupling,
  DECOUPLING_BAND_STRONG_PCT,
  DECOUPLING_BAND_ACCEPTABLE_PCT,
  DECOUPLING_BAND_ABOVE_AET_PCT,
} from './aerobic-decoupling';
import { HEAT_CONFOUND_TEMP_F } from '@/lib/coach/easy-discipline';

export interface DecouplingTrend {
  /** Current drift % · mean of the last 3 long runs. */
  currentDriftPct: number;
  /** Block-start drift % · mean of the first 3 long runs in the window. */
  blockStartDriftPct: number;
  /** Number of weeks the window spans (max 8). */
  weeksTracked: number;
  /** Number of long runs in the trend. */
  runsCount: number;
  /** Long runs dropped from the trend because they were run in heat, which
   *  manufactures 2-5pp of decoupling on its own (Research/03 §12). Surfaced
   *  so a thin trend can be explained rather than looking like missing data. */
  heatExcludedRuns: number;
  /** Direction · derived from delta. */
  direction: 'improving' | 'flat' | 'declining';
  /** Plain-language summary. */
  summary: string;
  /** Latest 8 data points for a tile sparkline. */
  series: { date: string; driftPct: number }[];
  /** Zone for the current drift %, one per row of Research/03 §12's
   *  interpretation table:
   *  · < 5%   · race-ready · "Strong aerobic endurance; sustainable"
   *  · 5-8%   · building   · "Acceptable; approaching aerobic limit"
   *  · 8-10%  · developing · "Endurance gap; build base before progressing"
   *  · 10%+   · early base · "Above aerobic threshold or insufficient endurance"
   *
   *  2026-08-19 · the middle boundary was 7, which §12 does not publish — it
   *  cut the "5-8% Acceptable" row in half, so this surface called a 7.5%
   *  reading `developing` while `limiter.ts` (reading the "8-10% Endurance
   *  gap" row for the same number) said the aerobic base was fine. Both now
   *  read the same four rows. */
  currentZone: 'race-ready' | 'building' | 'developing' | 'early-base';
  /** 2026-06-03 · static explanation · what aerobic decoupling IS. */
  whatItIs: string;
}

export async function computeDecouplingTrend(userUuid: string): Promise<DecouplingTrend | null> {
  // 2026-06-03 · runner TZ for the 60d window.
  const today = await runnerToday(userUuid);
  // Pull last 60d of steady runs. The distance term is a prefilter for "could
  // hold four mile-splits", not the qualifying test — that is §12's 60-minute
  // duration, applied per run by `computeAerobicDecoupling` below.
  // Phase B · one canonical dedup. A dupe of one long run would otherwise push
  // two identical drift points into the first-3 / last-3 means.
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(today, 60), today);
  // 2026-06-09 state-audit fix · the steady-state filter read
  // data->>'type', a field runs never carried, so EVERY run ≥ 6mi
  // passed — including tempo days, whose deliberate negative-split
  // structure (HR climbing into the work block) registers as
  // double-digit fake "decoupling" and can single-handedly flip the
  // goal status to WATCHING. Two-layer exclusion now:
  //   1. data->>'workoutType' · stamped from the plan at ingest going
  //      forward (api/ingest/workout).
  //   2. plan-day join · any plan (active OR archived · historical
  //      runs matched plans that have since been re-authored) that
  //      prescribed quality on that date excludes the run. Catches
  //      every pre-stamp historical row.
  // Over-exclusion (a quality day run easy) is the safe direction for
  // this signal — a contaminated point is worse than a missing one.
  const rows = await pool.query<{ id: string; date: string; mi: number | string; splits: unknown; temp_f: string | null }>(
    `SELECT r.id::text, ${runDateKeySql('r')} AS date, ${runDistanceMiSql('r')} AS mi, ${runSplitsSql('r')} AS splits,
            ${runTempFSql('r')} AS temp_f
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND r.id = ANY($3::bigint[])
        AND ${runDistanceMiSql('r')} >= 4
        AND (${runDateKeySql('r')})::date >= $2::date - interval '60 days'
        AND COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
              NOT IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek')
        AND NOT EXISTS (
          SELECT 1
            FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1::uuid
             AND pw.date_iso = ${runDaySql('r')}
             AND pw.type IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek', 'race_week_tuneup')
        )
      ORDER BY (${runDateKeySql('r')})::date ASC`,
    [userUuid, today, canonicalIds],
  ).then((r) => r.rows).catch(() => []);

  /* 2026-08-17 · HEAT, PER OBSERVATION.
   *
   * This trend compares the first three long runs in a 60-day window against
   * the last three, and it never looked at temperature. Over a summer block
   * that is June against August, and `Research/03` §12 says heat manufactures
   * 2-5% of decoupling on its own — comfortably more than the ±0.5pp the
   * direction call turns on. The signal was reading the season and reporting
   * it as a declining aerobic engine, which then moved goal status toward
   * watching / off-track.
   *
   * `lib/adaptation/load.ts` already applies exactly this filter to exactly
   * this function; the trend is the mirror that never got it. CLAUDE.md's
   * per-finding rule is explicit that a guard elsewhere does not protect this.
   *
   * Excluding rather than adjusting, because this module already states the
   * principle for its own contamination case: over-exclusion is the safe
   * direction here, and a contaminated point is worse than a missing one. */
  const series: { date: string; driftPct: number }[] = [];
  let heatExcluded = 0;
  for (const r of rows) {
    const tempF = r.temp_f != null ? Number(r.temp_f) : null;
    if (tempF != null && Number.isFinite(tempF) && tempF >= HEAT_CONFOUND_TEMP_F) {
      heatExcluded++;
      continue;
    }
    const splits = Array.isArray(r.splits) ? r.splits as Parameters<typeof computeAerobicDecoupling>[0] : null;
    const result = computeAerobicDecoupling(splits, Number(r.mi));
    if (result) series.push({ date: r.date, driftPct: result.driftPct });
  }

  // Honest absence. A summer block can legitimately leave too few comparable
  // runs to call a direction, and saying nothing beats reporting the weather.
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

  // 2026-06-03 · summary describes the runner's NOW · David: "Talk about
  // what is happening NOW." Dropped phase taxonomy (race-ready / building
  // strongly / building) which read as overlapping with the previous
  // zone-chip · the headline numbers + delta line already carry the
  // direction, this just narrates plainly what those numbers mean.
  let summary: string;
  if (direction === 'improving') {
    summary = `Your HR is holding steadier through the back half of your long runs than it was ${weeksTracked} week${weeksTracked === 1 ? '' : 's'} ago. The aerobic engine is getting more efficient.`;
  } else if (direction === 'flat') {
    summary = `Your HR drift on steady long runs is holding around ${currentDriftPct}%. The aerobic engine is stable · neither gaining nor losing efficiency.`;
  } else {
    summary = `Your HR is drifting more through the back half of your long runs than it was ${weeksTracked} week${weeksTracked === 1 ? '' : 's'} ago. The aerobic engine is losing efficiency.`;
  }

  // Zone reference for the current drift % · Research/03 §12's four rows.
  const currentZone: DecouplingTrend['currentZone'] =
    currentDriftPct < DECOUPLING_BAND_STRONG_PCT ? 'race-ready'
    : currentDriftPct < DECOUPLING_BAND_ACCEPTABLE_PCT ? 'building'
    : currentDriftPct < DECOUPLING_BAND_ABOVE_AET_PCT ? 'developing'
    : 'early-base';

  // 2026-06-03 · "Lower is better" moved to the headline eyebrow on
  // the card render · so the footer just defines the term.
  const whatItIs = `Aerobic decoupling = HR drift on a steady long run, second-half avg vs first half.`;

  return {
    currentDriftPct,
    blockStartDriftPct,
    weeksTracked,
    runsCount: series.length,
    heatExcludedRuns: heatExcluded,
    direction,
    summary,
    series: series.slice(-8),
    currentZone,
    whatItIs,
  };
}
