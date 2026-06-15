/**
 * goal-ready.ts · "when is my goal time possible" for time-goal runners.
 *
 * David's framing (2026-06-10): "they could just want to hit a time and
 * then let the plan tell them when its possible." The no-race onboarding
 * path captures a time-trial goal (profile.tt_goal_distance +
 * tt_goal_time bucket); this module projects WHEN the runner's fitness
 * trajectory crosses the VDOT that goal requires.
 *
 * Method — every number here is either the runner's own measured data
 * or a cited bound:
 *
 *   1. Goal → required VDOT. Bucket boundary/midpoint seconds →
 *      vdotFromRace(sec, distanceMi) (Daniels VDOT table inversion,
 *      Research/01).
 *   2. Trajectory = the runner's OWN daily VDOT snapshots
 *      (projection_snapshots · cron-daily) over the last 56 days — the
 *      freshness horizon inside which a fitness signal still represents
 *      current fitness (Research/01 §Freshness window: ≤8 weeks).
 *      OLS slope over those points.
 *   3. The observed slope is CLAMPED to Daniels' improvement quantum:
 *      reassess every 4–6 weeks, with "+1 VDOT estimated" as the step
 *      between assessments (Research/01 §Testing cadence). So the
 *      projection band runs from min(observed, 1pt/4wk) [earliest] to
 *      min(observed, 1pt/6wk) [latest] — a runner can show a hot
 *      short-term slope, but the projection never promises faster than
 *      the cited adaptation rate.
 *   4. Honesty gates (engineering thresholds, labeled as such — they
 *      bound curve-fitting, not physiology): ≥4 distinct snapshot days
 *      spanning ≥21 days to fit a trend at all; crossings further than
 *      365 days out report 'beyond-horizon' rather than pretending a
 *      linear fit holds for years.
 *
 * States: in-range (current ≥ required — race it) · projectable
 * (earliest/latest dates) · trend-flat (slope ≤ 0) · beyond-horizon ·
 * insufficient-data (cold start). The UI copy renders each honestly.
 */
import { pool } from '@/lib/db/pool';
import { vdotFromRace, formatRaceTime } from './vdot';

export type TTGoalDistance = '1mi' | '5k' | '10k';

const DIST_MI: Record<TTGoalDistance, number> = { '1mi': 1.0, '5k': 3.107, '10k': 6.214 };

/** Bucket → seconds. Mirrors lib/onboarding/state.ts TT_TIME_LADDERS
 *  exactly. Closed buckets use the midpoint; 'Under X' uses X (being AT
 *  the boundary IS the goal); open '+' buckets use the boundary. */
const BUCKET_SECONDS: Record<TTGoalDistance, Record<string, number>> = {
  '1mi': {
    'Under 5:00': 300, '5:00-6:00': 330, '6:00-7:00': 390, '7:00-8:00': 450, '8:00+': 480,
  },
  '5k': {
    'Under 20:00': 1200, '20-22': 1260, '22-25': 1410, '25-28': 1590, '28-32': 1800, '32+': 1920,
  },
  '10k': {
    'Under 40': 2400, '40-45': 2550, '45-50': 2850, '50-60': 3300, '60+': 3600,
  },
};

/** Daniels improvement quantum (Research/01 §Testing cadence): +1 VDOT
 *  per reassessment block of 4–6 weeks. Earliest projection may not
 *  outrun 1/28 pts/day; latest uses the conservative 1/42. */
const MAX_RATE_PER_DAY = 1 / 28;
const CONSERVATIVE_RATE_PER_DAY = 1 / 42;

/** Engineering gates for fitting a trend (not physiology — stated so). */
const MIN_POINTS = 4;
const MIN_SPAN_DAYS = 21;
const HORIZON_DAYS = 365;
const FRESHNESS_WINDOW_DAYS = 56; // Research/01 §Freshness window (≤8wk)

export interface GoalReadyProjection {
  ttDistance: TTGoalDistance;
  /** "5K · UNDER 20:00" style display label. */
  goalLabel: string;
  goalTimeSec: number;
  requiredVdot: number;
  currentVdot: number | null;
  state: 'in-range' | 'projectable' | 'trend-flat' | 'beyond-horizon' | 'insufficient-data';
  /** Present when projectable. */
  readyEarliestISO?: string;
  readyLatestISO?: string;
  /** Observed (pre-clamp) trend, VDOT pts/week · for transparency. */
  observedPerWeek?: number;
}

export interface VdotPoint { dateISO: string; vdot: number; }

/** Pure core — exported for tests. todayISO keeps it deterministic. */
export function computeGoalReady(
  ttDistance: TTGoalDistance,
  ttTimeBucket: string,
  points: VdotPoint[],
  todayISO: string,
  exactGoalTimeSec?: number | null,
): GoalReadyProjection | null {
  // Prefer the runner's EXACT goal time (native sends it) over the bucket
  // midpoint — a 26:00 goal lands in the "25-28" bucket whose midpoint is
  // ~26:30, skewing the required-VDOT gap ~4%. Fall back to the midpoint for
  // older clients that only sent the bucket.
  const goalTimeSec = (exactGoalTimeSec != null && exactGoalTimeSec > 0)
    ? exactGoalTimeSec
    : BUCKET_SECONDS[ttDistance]?.[ttTimeBucket];
  if (goalTimeSec == null) return null;
  const requiredVdot = vdotFromRace(goalTimeSec, DIST_MI[ttDistance]);
  if (requiredVdot == null) return null;

  const goalDisplay = (exactGoalTimeSec != null && exactGoalTimeSec > 0)
    ? (formatRaceTime(exactGoalTimeSec) ?? ttTimeBucket.toUpperCase())
    : ttTimeBucket.toUpperCase();
  const goalLabel = `${ttDistance === '1mi' ? '1 MI' : ttDistance.toUpperCase()} · ${goalDisplay}`;
  const base: Omit<GoalReadyProjection, 'state'> = {
    ttDistance, goalLabel, goalTimeSec, requiredVdot,
    currentVdot: points.length ? points[points.length - 1].vdot : null,
  };

  if (base.currentVdot != null && base.currentVdot >= requiredVdot) {
    return { ...base, state: 'in-range' };
  }

  const days = (iso: string) => Math.round(new Date(iso + 'T12:00:00Z').getTime() / 86400000);
  const today = days(todayISO);
  const spanDays = points.length >= 2
    ? days(points[points.length - 1].dateISO) - days(points[0].dateISO)
    : 0;
  if (points.length < MIN_POINTS || spanDays < MIN_SPAN_DAYS || base.currentVdot == null) {
    return { ...base, state: 'insufficient-data' };
  }

  // OLS slope · x in days, y in VDOT.
  const xs = points.map((p) => days(p.dateISO));
  const ys = points.map((p) => p.vdot);
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0;

  if (slope <= 0) {
    return { ...base, state: 'trend-flat', observedPerWeek: Math.round(slope * 7 * 100) / 100 };
  }

  const gap = requiredVdot - base.currentVdot;
  const earliestDays = gap / Math.min(slope, MAX_RATE_PER_DAY);
  const latestDays = gap / Math.min(slope, CONSERVATIVE_RATE_PER_DAY);

  if (earliestDays > HORIZON_DAYS) {
    return { ...base, state: 'beyond-horizon', observedPerWeek: Math.round(slope * 7 * 100) / 100 };
  }

  // Anchor reconstruction on todayISO itself (noon UTC) — converting the
  // rounded epoch-day integer back through midnight shifts dates ±1.
  const toISO = (d: number) =>
    new Date(new Date(todayISO + 'T12:00:00Z').getTime() + d * 86400000).toISOString().slice(0, 10);
  return {
    ...base,
    state: 'projectable',
    readyEarliestISO: toISO(Math.ceil(earliestDays)),
    readyLatestISO: toISO(Math.ceil(Math.min(latestDays, HORIZON_DAYS * 2))),
    observedPerWeek: Math.round(slope * 7 * 100) / 100,
  };
}

/** DB loader · null when the runner has no TT goal (race-anchored
 *  runners use the existing goal-gap machinery instead — caller gates). */
export async function loadGoalReadyProjection(userId: string): Promise<GoalReadyProjection | null> {
  const prof = (await pool.query<{ tt_distance: string | null; tt_time: string | null; tt_secs: number | null }>(
    `SELECT tt_goal_distance AS tt_distance, tt_goal_time AS tt_time,
            (user_settings->>'tt_goal_time_seconds')::int AS tt_secs
       FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ tt_distance: string | null; tt_time: string | null; tt_secs: number | null }> }))).rows[0];
  const tt = prof?.tt_distance as TTGoalDistance | null;
  if (!tt || !prof?.tt_time || !(tt in DIST_MI)) return null;

  // One VDOT per day (snapshots write one row per projected distance ·
  // vdot is identical across them).
  const pts = (await pool.query<{ d: string; v: string }>(
    `SELECT DISTINCT ON (snapshot_date)
            to_char(snapshot_date, 'YYYY-MM-DD') AS d, vdot::text AS v
       FROM projection_snapshots
      WHERE user_uuid = $1 AND vdot IS NOT NULL
        AND snapshot_date >= CURRENT_DATE - ${FRESHNESS_WINDOW_DAYS}
      ORDER BY snapshot_date ASC`,
    [userId],
  ).catch(() => ({ rows: [] as Array<{ d: string; v: string }> }))).rows
    .map((r) => ({ dateISO: r.d, vdot: Number(r.v) }))
    .filter((p) => Number.isFinite(p.vdot));

  const todayISO = new Date().toISOString().slice(0, 10);
  return computeGoalReady(tt, prof.tt_time, pts, todayISO, prof.tt_secs);
}
