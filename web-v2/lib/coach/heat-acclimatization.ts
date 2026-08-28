/**
 * lib/coach/heat-acclimatization.ts · Research/06 §4 Heat Acclimation.
 *
 * HEAT-1 (2026-08-17) · four doctrine faults fixed here, plus the
 * missing safety gate (lib/coach/heat-gate.ts).
 *
 * 1 · The dose threshold read the wrong column. The Protocol block is
 *     explicit — "Heat dose:   Tair ≥85°F or WBGT ≥75°F" — and the code
 *     carried HEAT_THRESHOLD_F = 75 applied to AIR temperature, so the
 *     WBGT number was sitting in the Tair slot and an ordinary 75°F
 *     morning counted as acclimation stimulus. Now: isHeatDoseDay()
 *     takes Tair >=85 OR an approximated WBGT >=75, using the humidity
 *     and cloud cover already stored on every enriched run.
 *
 * 2 · The adaptation signature was inverted. The "Adaptation timeline"
 *     table's "HR @ workload" column says acclimation shows up as HR AT
 *     A GIVEN WORKLOAD falling, -5 bpm by day 3 through -15 bpm by day
 *     14. The engine watched RESTING HR, and the HealthView card read
 *     RISING resting HR as "Adapting" — which is the fatigue signature,
 *     not the adaptation one. Resting HR is now reported as what it is
 *     (a load signal that can contradict the day count), and
 *     `workloadHrDeltaBpm` carries the real measurement: mean HR across
 *     easy runs held at a comparable pace, first half vs second.
 *
 * 3 · The decay curve and its attribution were invented. The header
 *     credited Friel with "50% by day 5, 90%+ by day 10" and the code
 *     used `max_penalty * exp(-N/7)`. The timeline table is attributed
 *     to Périard 2021 and its "Performance" column gives ~50% of gains
 *     at days 4-7 and ~70-80% at days 8-10. ACCLIMATION_TIMELINE is now
 *     that table, read directly, with no exponential in between.
 *
 * 4 · MAX_PENALTY_BPM_AT_PEAK was 8 bpm citing Research/06, whose
 *     "HR @ workload" column gives -5 to -15. It is 15 now, the
 *     full-acclimation figure.
 *
 * ── RULE 7 (2026-08-19) · THE CITATIONS HERE WERE LINE NUMBERS ─────────────
 * Every reference in this file used to read `Research/06:158-163`, `:169`,
 * `:172`, `:179-185`. Rule 7 forbids that outright: "Anchor on quoted text,
 * never a line number. Line numbers rot on the next edit." They are now the
 * doc's own heading and table-header strings, which is what the registry
 * resolves against, and the three constants below are bound by
 * HEAT.acclimation-timeline, HEAT.full-acclimation-duration and
 * HEAT.pacing-during-acclimation — each of which PARSES the numbers out of
 * Research/06 at run time rather than restating them here.
 *
 * Returns null when not in a heat exposure window.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday, runnerTimezone } from '@/lib/runtime/runner-tz';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import {
  isHeatDoseDay,
  wbgtApproxF,
  evaluateHeatGate,
  type HeatGateVerdict,
} from './heat-gate';

/**
 * Research/06-weather-adjustments.md §4, table "Adaptation timeline
 * (Périard 2021, Tipton-related ACSM consensus)".
 *
 * `throughDay` is the top of each of that table's own day rows (1–3,
 * 4–7, 8–10, 11–14). Bands are the research's own, kept as bands rather
 * than collapsed to a point so the conformance test can assert against
 * the table. Bound by HEAT.acclimation-timeline, which parses the "HR @
 * workload" and "Performance" columns out of the doc.
 */
export const ACCLIMATION_TIMELINE: ReadonlyArray<{
  throughDay: number;
  /** "HR @ workload" column · bpm reduction from the unacclimated state. */
  hrReductionBpm: readonly [number, number];
  /** "Performance" column · share of full acclimation gains realized. */
  gainsPct: readonly [number, number];
  /** §4 "Pacing during acclimation" · % slower than normal. */
  pacingAdjustPct: readonly [number, number];
  label: string;
}> = [
  { throughDay: 3,  hrReductionBpm: [5, 5],   gainsPct: [0, 0],     pacingAdjustPct: [10, 15], label: 'first days' },
  { throughDay: 7,  hrReductionBpm: [10, 10], gainsPct: [50, 50],   pacingAdjustPct: [5, 10],  label: 'half adapted' },
  { throughDay: 10, hrReductionBpm: [10, 15], gainsPct: [70, 80],   pacingAdjustPct: [3, 5],   label: 'mostly adapted' },
  { throughDay: 14, hrReductionBpm: [15, 15], gainsPct: [100, 100], pacingAdjustPct: [0, 0],   label: 'adapted' },
] as const;

/**
 * §4 Protocol block · "Duration:    10–14 days minimum, 14–21 days
 * preferred." The engine takes the top of the MINIMUM band, which is
 * also where the timeline's own "11–14" row reaches full acclimation.
 * Bound by HEAT.full-acclimation-duration.
 */
export const FULL_ACCLIM_DAYS = 14;

/**
 * The "HR @ workload" reduction a fully acclimated runner has banked —
 * the timeline's 11–14 row, "−15 bpm" — which is the same number an
 * unacclimated runner is paying. Was 8, citing a research file whose
 * column gives -5 to -15. Bound by HEAT.acclimation-timeline.
 */
export const MAX_PENALTY_BPM_AT_PEAK = 15;

/** Minimum heat-window runs before we will call anything. */
const MIN_HEAT_RUNS = 4;

/**
 * Pace band, in seconds per mile, within which two easy runs count as
 * "the same workload" for the "HR @ workload" comparison. CONVENTION,
 * not from Research/06: the doc names the measurement but states no
 * tolerance for it. It exists so the HR delta is not just a proxy for
 * one hard run in the window.
 */
const SAME_WORKLOAD_PACE_TOLERANCE_S = 45;

export interface HeatAcclimatization {
  daysInWindow: number;
  avgTempF: number;
  /** Mean approximated WBGT across the heat-window runs. Null when no
   *  humidity was stored. */
  avgWbgtF: number | null;
  /** 2026-06-05 · multi-tenant audit Pattern 5 fix · was non-nullable
   *  with a 'plateauing' default when rhrSeries < 5 readings. That
   *  silently said "body is plateauing" with no evidence. Now nullable ·
   *  null means "we don't have enough RHR signal to call a trend."
   *
   *  HEAT-1 (2026-08-17): this is RESTING HR and it is NOT the
   *  acclimation signature (§4's timeline measures HR at a given
   *  workload). Rising resting HR is a load / heat-strain signal. No
   *  consumer may read it as adaptation. */
  rhrTrend: 'rising' | 'plateauing' | 'falling' | null;
  /**
   * HEAT-1 · the real adaptation signature · §4's "HR @ workload".
   * Change in mean HR across easy runs held at a comparable pace,
   * second half of the window minus first half. NEGATIVE means
   * adapting. Null when fewer than four comparable runs.
   */
  workloadHrDeltaBpm: number | null;
  /** Whether the measured workload-HR agrees with the day count. */
  adaptationEvidence: 'measured_adapting' | 'measured_not_yet' | 'day_count_only';
  /** Share of full acclimation gains the timeline predicts · the
   *  "Performance" column of §4's adaptation timeline. */
  adaptationPct: number;
  expectedHRPenaltyBpm: number;
  /** §4 "Pacing during acclimation" · how much slower than normal to
   *  run today, percent. */
  pacingAdjustPct: readonly [number, number];
  daysToFullAcclim: number;
  message: string;
  /**
   * HEAT-1 · the Research/06 §11 safety gate for the most recent
   * conditions we have. `fires` true means the session should change;
   * `proposeFirst` is always true when it fires, so nothing mutates
   * without the runner.
   */
  gate: HeatGateVerdict;
}

/** The timeline row covering day N. */
export function acclimationStage(dayN: number): (typeof ACCLIMATION_TIMELINE)[number] {
  for (const row of ACCLIMATION_TIMELINE) {
    if (dayN <= row.throughDay) return row;
  }
  return ACCLIMATION_TIMELINE[ACCLIMATION_TIMELINE.length - 1];
}

const mid = (b: readonly [number, number]): number => (b[0] + b[1]) / 2;

/**
 * Expected residual HR cost, bpm · §4's "HR @ workload" column read
 * forward.
 * An unacclimated runner carries the full MAX_PENALTY_BPM_AT_PEAK; the
 * timeline's HR-at-workload column is how much of it they have paid
 * back by day N. No exponential, no Sawka decay constant — the previous
 * `max * exp(-N/7)` was not in the research.
 */
export function expectedHeatPenaltyBpm(dayN: number): number {
  const stage = acclimationStage(dayN);
  return Math.max(0, Math.round((MAX_PENALTY_BPM_AT_PEAK - mid(stage.hrReductionBpm)) * 10) / 10);
}

export async function computeHeatAcclimatization(userUuid: string): Promise<HeatAcclimatization | null> {
  // 2026-06-03 · runner TZ anchors the 14d window.
  const today = await runnerToday(userUuid);
  const heatTz = await runnerTimezone(userUuid).catch(() => 'UTC');
  // Pull last 14d of runs with weather + RHR.
  // Phase B · one canonical dedup. An unflagged watch+HK dupe of one run would
  // otherwise weight its weather temp 2× in the avg + heat-day count.
  const canonicalIds = await getCanonicalRunIds(userUuid, isoDaysBefore(today, 14), today);
  // HEAT-1 · humidity and cloud cover come along now: the dose test is
  // the Protocol block's "Heat dose:   Tair ≥85°F or WBGT ≥75°F", and
  // WBGT needs both.
  const tempRows = await pool.query<{
    d: string; temp_f: number | string | null;
    humidity_pct: number | string | null; cloud_pct: number | string | null;
  }>(
    `SELECT (data->>'date')::date::text AS d,
            COALESCE(
              (data->'weather'->>'temp_f_peak')::numeric,
              (data->'weather'->>'temp_f')::numeric,
              (data->'weather'->'tempRange'->>'peak')::numeric,
              (data->'weather'->'tempRange'->>'mean')::numeric
            ) AS temp_f,
            COALESCE(
              (data->'weather'->>'humidity_pct_peak')::numeric,
              (data->'weather'->>'humidity_pct')::numeric
            ) AS humidity_pct,
            (data->'weather'->>'cloud_cover_pct')::numeric AS cloud_pct
       FROM runs
      WHERE user_uuid = $1::uuid
        AND id = ANY($3::bigint[])
        AND data->>'weather' IS NOT NULL
        AND (data->>'date')::date >= $2::date - interval '14 days'
      ORDER BY (data->>'date')::date ASC`,
    [userUuid, today, canonicalIds],
  ).then((r) => r.rows).catch(() => []);

  const readings = tempRows
    .map((r) => ({
      d: r.d,
      tempF: Number(r.temp_f),
      humidityPct: r.humidity_pct != null ? Number(r.humidity_pct) : null,
      cloudPct: r.cloud_pct != null ? Number(r.cloud_pct) : null,
    }))
    .filter((r) => Number.isFinite(r.tempF) && r.tempF > 0);
  if (readings.length < MIN_HEAT_RUNS) return null;

  // HEAT-1 · a day is acclimation stimulus at Tair >=85°F OR WBGT >=75°F,
  // per §4's Protocol block. The old gate was avgTemp >= 75°F on AIR
  // temperature, which is the WBGT number in the wrong column.
  const doseDays = readings.filter((r) => isHeatDoseDay(r.tempF, r.humidityPct, r.cloudPct));
  if (doseDays.length === 0) return null;

  const avgTempF = readings.reduce((s, r) => s + r.tempF, 0) / readings.length;
  const wbgts = readings
    .map((r) => wbgtApproxF(r.tempF, r.humidityPct, r.cloudPct))
    .filter((v): v is number => v != null);
  const avgWbgtF = wbgts.length > 0 ? wbgts.reduce((s, x) => s + x, 0) / wbgts.length : null;

  const daysInWindow = Math.min(FULL_ACCLIM_DAYS, doseDays.length);

  // Resting HR trend across the window. Kept because it is a real load
  // signal, but explicitly NOT the acclimation signature.
  const rhrRows = await pool.query<{ d: string; v: number | string }>(
    `SELECT (recorded_at AT TIME ZONE $2::text)::date::text AS d, AVG(value::numeric)::numeric AS v
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1
        AND sample_type = 'resting_hr'
        AND recorded_at >= NOW() - interval '14 days'
      GROUP BY (recorded_at AT TIME ZONE $2::text)::date
      ORDER BY (recorded_at AT TIME ZONE $2::text)::date ASC`,
    [userUuid, heatTz],
  ).then((r) => r.rows).catch(() => []);
  const rhrSeries = rhrRows.map((r) => Number(r.v)).filter((v) => Number.isFinite(v));

  // 2026-06-05 · multi-tenant audit Pattern 5 fix · was: defaulted to
  // 'plateauing' when rhrSeries.length < 5. Silent claim about the
  // body's adaptation state with zero RHR evidence. Now: null when
  // we don't have at least 5 RHR readings to compare halves of.
  let rhrTrend: HeatAcclimatization['rhrTrend'] = null;
  /** How far the second half of the 14-day window sits above the first, bpm.
   *  Kept so the copy can state its own window instead of asserting a bare
   *  "climbing" that a differently-windowed reading contradicts. */
  let rhrDeltaBpm: number | null = null;
  if (rhrSeries.length >= 5) {
    const firstHalf = rhrSeries.slice(0, Math.floor(rhrSeries.length / 2));
    const secondHalf = rhrSeries.slice(Math.floor(rhrSeries.length / 2));
    const firstAvg = firstHalf.reduce((s, x) => s + x, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, x) => s + x, 0) / secondHalf.length;
    const delta = secondAvg - firstAvg;
    if (delta > 1) rhrTrend = 'rising';
    else if (delta < -1) rhrTrend = 'falling';
    else rhrTrend = 'plateauing';
    rhrDeltaBpm = Math.round(delta * 10) / 10;
  }

  // HEAT-1 · the actual §4 measurement: HR at a given
  // workload. Easy runs only, held inside a tight pace band so the
  // comparison really is "at a given workload".
  const workloadHrDeltaBpm = await measureWorkloadHrDelta(userUuid, canonicalIds);

  const stage = acclimationStage(daysInWindow);
  const expectedHRPenaltyBpm = expectedHeatPenaltyBpm(daysInWindow);
  const adaptationPct = mid(stage.gainsPct);
  const daysToFullAcclim = Math.max(0, FULL_ACCLIM_DAYS - daysInWindow);

  const adaptationEvidence: HeatAcclimatization['adaptationEvidence'] =
    workloadHrDeltaBpm == null ? 'day_count_only'
      : workloadHrDeltaBpm <= -3 ? 'measured_adapting'
        : 'measured_not_yet';

  // Copy. Coach voice · no hype, and never a claim the data does not
  // carry. Day count drives the headline (the timeline is a day
  // timeline); measured workload HR either corroborates it or says so.
  const dayLine = `Heat day ${daysInWindow} of ${FULL_ACCLIM_DAYS}`;
  let message: string;
  if (adaptationEvidence === 'measured_adapting') {
    message = `${dayLine} · ${stage.label}. Your HR at the same easy pace is down ${Math.abs(workloadHrDeltaBpm!)} bpm across the window, which is the adaptation showing up. Expect about ${expectedHRPenaltyBpm} bpm of heat cost left.`;
  } else if (adaptationEvidence === 'measured_not_yet') {
    message = `${dayLine} · ${stage.label} on the timeline, but your HR at the same easy pace has not come down yet. Hold the effort, let the pace be what it is.`;
  } else {
    message = `${dayLine} · ${stage.label}. Expect about ${expectedHRPenaltyBpm} bpm of heat cost on easy efforts, and run ${stage.pacingAdjustPct[0]}-${stage.pacingAdjustPct[1]}% slower than normal while it settles.`;
  }
  if (rhrTrend === 'rising') {
    // Resting HR climbing during a heat block is strain, not progress.
    //
    // ── 2026-08-21 · web audit · two fixes in one sentence ────────────────
    //
    // It read: "Resting HR is climbing. That is heat strain, not adaptation.
    // Sleep and fluids before you add any load."
    //
    // 1 · IT CONTRADICTED THE PILLAR ON THE SAME SCREEN. This reads the two
    //     halves of a 14-day window against each other; the readiness pillar
    //     three inches up the same Health page reads a 3-day average against
    //     the runner's long baseline. On 21 August those said, side by side,
    //     "RHR · 47 bpm · baseline 48 · no change · ON BASELINE" and
    //     "Resting HR is climbing." Both are honest readings of different
    //     windows, and stating neither window made them a contradiction
    //     rather than two facts. The window is now in the sentence.
    //
    // 2 · IT PRESCRIBED OFF ONE SIGNAL. "before you add any load" is a
    //     training instruction issued on the cardiac domain alone, which is
    //     the rule lib/coach/convergence.ts exists to hold. The observation
    //     is worth making during a heat block; the instruction is not this
    //     surface's to give.
    const amount = rhrDeltaBpm != null ? ` about ${rhrDeltaBpm.toFixed(1)} bpm` : '';
    message += ` Resting heart rate is up${amount} across this heat window against the days before it. During a heat block that reads as strain rather than adaptation.`;
  }

  // Gate the most recent conditions we have against Research/06 §11.
  const latest = readings[readings.length - 1];
  const gate = evaluateHeatGate({
    tairF: latest.tempF,
    humidityPct: latest.humidityPct,
    cloudCoverPct: latest.cloudPct,
  });
  if (gate.fires) message = `${gate.headline} ${message}`;

  return {
    daysInWindow,
    avgTempF: +avgTempF.toFixed(1),
    avgWbgtF: avgWbgtF != null ? +avgWbgtF.toFixed(1) : null,
    rhrTrend,
    workloadHrDeltaBpm,
    adaptationEvidence,
    adaptationPct,
    expectedHRPenaltyBpm,
    pacingAdjustPct: stage.pacingAdjustPct,
    daysToFullAcclim,
    message,
    gate,
  };
}

/**
 * Research/06-weather-adjustments.md §4 · "HR @ workload" falling is
 * the acclimation
 * signature. Take the window's easy runs, keep only those within
 * SAME_WORKLOAD_PACE_TOLERANCE_S of the window's median easy pace, and
 * compare mean HR in the second half against the first.
 *
 * Null when fewer than four comparable runs — the same posture as the
 * RHR trend: no reading rather than a claim with no evidence behind it.
 */
async function measureWorkloadHrDelta(
  userUuid: string,
  canonicalIds: number[] | string[],
): Promise<number | null> {
  const rows = await pool.query<{ d: string; hr: string | null; pace: string | null }>(
    `SELECT (data->>'date')::date::text AS d,
            (data->>'avgHr')::numeric AS hr,
            COALESCE(
              (data->>'avgPaceSPerMi')::numeric,
              CASE WHEN data->>'avgPaceMinPerMi' ~ '^\\d+:\\d+$'
                THEN split_part(data->>'avgPaceMinPerMi', ':', 1)::numeric * 60
                   + split_part(data->>'avgPaceMinPerMi', ':', 2)::numeric
                ELSE NULL END
            )::numeric AS pace
       FROM runs
      WHERE user_uuid = $1::uuid
        AND id = ANY($2::bigint[])
        AND COALESCE(data->>'type', 'easy') IN ('easy', 'recovery', 'long')
        AND (data->>'avgHr') IS NOT NULL
        AND (data->>'distanceMi')::numeric >= 2
      ORDER BY (data->>'date')::date ASC`,
    [userUuid, canonicalIds],
  ).then((r) => r.rows).catch(() => []);

  const pts = rows
    .map((r) => ({ hr: Number(r.hr), pace: r.pace != null ? Number(r.pace) : NaN }))
    .filter((p) => Number.isFinite(p.hr) && p.hr > 60 && Number.isFinite(p.pace) && p.pace > 0);
  if (pts.length < 4) return null;

  const paces = pts.map((p) => p.pace).sort((a, b) => a - b);
  const medianPace = paces[Math.floor(paces.length / 2)];
  const comparable = pts.filter((p) => Math.abs(p.pace - medianPace) <= SAME_WORKLOAD_PACE_TOLERANCE_S);
  if (comparable.length < 4) return null;

  const half = Math.floor(comparable.length / 2);
  const first = comparable.slice(0, half);
  const second = comparable.slice(comparable.length - half);
  const mean = (xs: typeof comparable) => xs.reduce((s, x) => s + x.hr, 0) / xs.length;
  return Math.round((mean(second) - mean(first)) * 10) / 10;
}
