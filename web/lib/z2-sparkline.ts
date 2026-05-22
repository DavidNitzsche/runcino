/**
 * C2 · Z2 pace sparkline data
 *
 * Computes weekly weighted-mean Z2 pace over the last 8 weeks. Reads
 * from the same data Signal 2 uses (splits-based, HRR-framework Z2
 * band), but rolls up per ISO week instead of per 4-week window.
 *
 * Result: 8 data points the sparkline component renders as a tiny
 * inline SVG on /profile Coach Reads, under the HR section.
 *
 * Falling line = pace getting faster at fixed HR = fitness gain.
 * Rising line = slower at fixed HR. Flat line = baseline.
 */

import { query } from './db';
import { buildFitnessHrZones } from './hr-zones';
import { formatCrossReference, type CrossReference } from './coach-voice';

export const SPARKLINE_WEEKS = 8;

export interface Z2SparklinePoint {
  /** Monday of the ISO week, YYYY-MM-DD. */
  weekStartIso: string;
  /** Weighted-mean Z2 pace this week (s/mi). Null when no Z2 splits. */
  paceSPerMi: number | null;
  /** Number of Z2 mile-splits this week. */
  z2Miles: number;
  /** Number of qualifying easy runs this week. */
  workoutCount: number;
}

export interface Z2SparklineResult {
  z2Band: { lo: number; hi: number } | null;
  points: Z2SparklinePoint[];
  /** Pace range across the visible window, used by the renderer
   *  to scale the Y axis. Null when no data. */
  paceRange: { min: number; max: number } | null;
  /** True when the data tells a meaningful story (≥3 weeks with data). */
  hasSignal: boolean;
  /** V7 cross-reference to the max HR validation surface when the
   *  sparkline window overlaps with a recalibration event. */
  crossRef?: CrossReference;
  /** Optional hedge text shown alongside the sparkline when the data
   *  spans a recalibration mid-window.  Empty when the window is fully
   *  post-recalibration (clean) or pre-recalibration (no overlap). */
  recalibrationHedge?: string;
}

/**
 * V7 item 4 · Resolve the sparkline ↔ max HR recalibration relationship.
 *
 * Three cases (per David's V7 brief):
 *   1. Recalibration PREDATES the window entirely → null cross-ref;
 *      the runner is looking at settled history in the new framework.
 *   2. Recalibration falls INSIDE the window's recent half (most of
 *      the data is still in the OLD framework) → hedged cross-ref
 *      noting the mixed-framework reality.
 *   3. Recalibration falls AT the window's starting boundary or in
 *      its older half (most data is already post-recalibration) →
 *      clean 'tied to' cross-reference.
 *
 * Earned-not-decorative: when max HR has never been set, or
 * recalibration is outside the window, no cross-reference fires.
 */
export function resolveSparklineRecalibrationRef(
  windowStartIso: string,
  windowEndIso: string,
  maxHrUpdatedAt: Date | null,
): { crossRef?: CrossReference; recalibrationHedge?: string } {
  if (!maxHrUpdatedAt) return {};

  const windowStartMs = Date.parse(windowStartIso + 'T00:00:00Z');
  const windowEndMs = Date.parse(windowEndIso + 'T23:59:59Z');
  const recalibMs = maxHrUpdatedAt.getTime();

  // Case 1: recalibration predates window → settled history → no cross-ref.
  if (recalibMs < windowStartMs) return {};

  // Recalibration is at-or-after window start.  Split the window in
  // two; if recalibration falls into the SECOND half (more recent),
  // most of the window is OLD-framework data → hedge.
  const windowMidMs = windowStartMs + (windowEndMs - windowStartMs) / 2;
  const inSecondHalf = recalibMs > windowMidMs;

  const baseRef = formatCrossReference({
    relatedLabel: 'max HR validation',
    surface: '/profile',
    anchor: 'max-hr-validation',
    relation: 'tied to',
  });

  if (inSecondHalf) {
    return {
      crossRef: baseRef,
      recalibrationHedge:
        'Zones recalibrated mid-window; the older weeks in this trend reflect mixed framework data.',
    };
  }

  return { crossRef: baseRef };
}

interface ActivityRow {
  data: {
    date?: string;
    distanceMi?: number;
    workoutType?: number | null;
    splits?: Array<{ paceSPerMi: number; avgHr: number | null }>;
  };
}

/** ISO week-start (Monday) for a given date. Returns YYYY-MM-DD. */
function weekStartIso(dateIso: string): string {
  const d = new Date(dateIso + 'T12:00:00Z');
  const dow = d.getUTCDay();            // 0=Sun, 1=Mon, ...
  const offset = dow === 0 ? -6 : 1 - dow;  // shift back to Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + offset);
  return monday.toISOString().slice(0, 10);
}

function isEasyCandidate(data: ActivityRow['data']): boolean {
  const wt = data.workoutType ?? 0;
  if (wt !== 0 && wt !== null) return false;
  const dist = Number(data.distanceMi) || 0;
  if (dist < 3) return false;
  if (dist >= 9) return false;
  return true;
}

export async function computeZ2Sparkline(
  userId: string,
  today: Date,
  maxHr: number | null,
  restingHr: number | null,
  maxHrUpdatedAt: Date | null = null,
): Promise<Z2SparklineResult> {
  const empty: Z2SparklineResult = {
    z2Band: null,
    points: [],
    paceRange: null,
    hasSignal: false,
  };

  const zones = buildFitnessHrZones(maxHr, restingHr);
  if (!zones) return empty;
  const z2 = zones.z2;

  // Build the 8-week window of Monday-anchored buckets.
  const todayIso = today.toISOString().slice(0, 10);
  const todayWeekStart = weekStartIso(todayIso);
  const weeks: string[] = [];
  for (let i = SPARKLINE_WEEKS - 1; i >= 0; i--) {
    const ms = Date.parse(todayWeekStart + 'T12:00:00Z') - i * 7 * 86_400_000;
    weeks.push(new Date(ms).toISOString().slice(0, 10));
  }

  const lookbackStartIso = weeks[0];
  const rows = await query<ActivityRow>(
    `SELECT data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC > 0
        AND (data->>'movingTimeS')::NUMERIC > 0
      ORDER BY (data->>'date') ASC
      LIMIT 200`,
    [userId, lookbackStartIso],
  );

  // Accumulators keyed by ISO week start.
  const byWeek = new Map<string, { paceSum: number; mileCount: number; workouts: Set<string> }>();
  for (const ws of weeks) byWeek.set(ws, { paceSum: 0, mileCount: 0, workouts: new Set() });

  for (const r of rows) {
    const d = r.data;
    if (!d.date || !isEasyCandidate(d)) continue;
    const splits = d.splits ?? [];
    if (splits.length === 0) continue;

    const ws = weekStartIso(d.date);
    const bucket = byWeek.get(ws);
    if (!bucket) continue;

    let runHadZ2 = false;
    for (const s of splits) {
      const hr = Number(s.avgHr);
      const pace = Number(s.paceSPerMi);
      if (!Number.isFinite(hr) || hr <= 0) continue;
      if (!Number.isFinite(pace) || pace <= 0) continue;
      if (hr < z2.lowBpm || hr > z2.highBpm) continue;
      bucket.paceSum += pace;
      bucket.mileCount += 1;
      runHadZ2 = true;
    }
    if (runHadZ2) bucket.workouts.add(d.date);
  }

  const points: Z2SparklinePoint[] = weeks.map((ws) => {
    const b = byWeek.get(ws)!;
    return {
      weekStartIso: ws,
      paceSPerMi: b.mileCount > 0 ? Math.round(b.paceSum / b.mileCount) : null,
      z2Miles: b.mileCount,
      workoutCount: b.workouts.size,
    };
  });

  const paces = points.map((p) => p.paceSPerMi).filter((p): p is number => p != null);
  const paceRange = paces.length > 0
    ? { min: Math.min(...paces), max: Math.max(...paces) }
    : null;
  const weeksWithData = points.filter((p) => p.paceSPerMi != null).length;
  const hasSignal = weeksWithData >= 3;

  // V7 cross-reference · only fires when there's enough signal to
  // show the chart in the first place (no point pointing at empty data).
  const recalibrationRef = hasSignal
    ? resolveSparklineRecalibrationRef(
        weeks[0],
        weeks[weeks.length - 1],
        maxHrUpdatedAt,
      )
    : {};

  return {
    z2Band: { lo: z2.lowBpm, hi: z2.highBpm },
    points,
    paceRange,
    hasSignal,
    crossRef: recalibrationRef.crossRef,
    recalibrationHedge: recalibrationRef.recalibrationHedge,
  };
}
