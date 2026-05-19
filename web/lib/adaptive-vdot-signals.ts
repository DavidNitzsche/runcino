/**
 * Adaptive VDOT signals — passive fitness movement detection between
 * races. The "alive" half of "alive but not nervous."
 *
 * Three independent signals (locked with David 2026-05-19 round 2):
 *
 *   SIGNAL 1 · Threshold workout adherence
 *     Compare actual avg pace to prescribed T pace WITH HR check.
 *     - Faster than prescribed at controlled HR (within Z4 ceiling)
 *       → evidence VDOT is climbing
 *     - Slower than prescribed at controlled HR with no contextual
 *       explanation → evidence to investigate downgrade
 *     - Context filters: skip workouts in heat >78°F, within 7
 *       days of a race, with manual "bad day" flag
 *
 *   SIGNAL 2 · Pace at fixed HR (longitudinal drift) — TODO
 *     Rolling 4-week average pace at HR 140 (Z2 midpoint) for
 *     easy runs. Pace improving 5+ sec/mi over 4 weeks is fitness
 *     gain; degrading 5+ sec/mi is investigate signal.
 *
 *   SIGNAL 3 · Interval pace at controlled effort — TODO
 *     Same pattern as Signal 1 but for I-pace workouts. Tighter
 *     HR ceiling (work intervals must stay below Z5 cap).
 *
 * This module computes per-signal observations. The verdict module
 * (lib/adaptive-vdot-verdict.ts) combines them using adaptive-
 * pattern.ts thresholds (UP: 3+ obs + 2.5 weight; DOWN: 2+ obs +
 * 1.5 weight) into a single banner-shape verdict.
 *
 * Source-of-truth contract: this reads from strava_activities for
 * workout HR/pace data — that's correct, training data lives in
 * strava_activities. compute-vdot still reads ONLY from races for
 * the race-derived aggregate. L7 doesn't break the L6 contract.
 *
 * Edge case suspension:
 *   - Race week (within 7 days of a goal race): suspend all signals
 *   - First 2 weeks of new training block: suspend (body adapting)
 *   - Workouts user manually flagged "bad day": skip in signal
 *   - HR data missing: signal weight reduced but doesn't disqualify
 */

import { query } from './db';
import { pacesFromVdot } from './vdot';

export interface SignalObservation {
  date: string;
  workoutLabel: string;
  workoutType: string;
  prescribedPaceS: number | null;
  actualPaceS: number | null;
  actualAvgHr: number | null;
  hrInRange: boolean | null;
  /** Δ in s/mi (positive = slower than prescribed). */
  paceDeltaS: number | null;
  /** Tags any context that should attenuate or skip this observation. */
  context: string[];
  /** True when this observation supports VDOT-up (faster + controlled HR). */
  faster: boolean;
  /** True when this observation supports VDOT-investigate (slower + no context). */
  slower: boolean;
  /** Weight per observation (1.0 default, reduced by context). */
  weight: number;
}

export interface AdaptiveSignals {
  threshold: {
    observations: SignalObservation[];
    fasterCount: number;
    slowerCount: number;
    fasterWeight: number;
    slowerWeight: number;
  };
  /** Stubbed for tonight; full implementation in follow-up. */
  hrPaceDrift: {
    observations: SignalObservation[];
    implemented: false;
    note: string;
  };
  /** Stubbed for tonight; full implementation in follow-up. */
  intervals: {
    observations: SignalObservation[];
    implemented: false;
    note: string;
  };
}

interface ActivityRow {
  id: string;
  data: {
    name?: string;
    date?: string;
    distanceMi?: number;
    movingTimeS?: number;
    avgHr?: number;
    maxHr?: number;
    workoutType?: number | null;
    // matched-workout fields if available from plan-match
    plannedWorkoutType?: string;
    plannedPaceS?: number;
    plannedLabel?: string;
  };
}

/** Look back 6 weeks for threshold-effort activities. We're looking
 *  for sustained signals, not single workouts — 6 weeks gives 4-8
 *  T workouts in a healthy training block, plenty for 3-consecutive
 *  detection without dragging in stale evidence. */
const LOOKBACK_DAYS = 42;

/** Z4 ceiling as % of max HR (for HR-in-range check). Matches the
 *  Daniels threshold band — workouts at T pace should sit in Z4
 *  with maybe a few beats into Z5 on the last reps. */
const Z4_CEILING_PCT = 0.92;
const Z4_FLOOR_PCT = 0.85;

/** Threshold for "faster than prescribed" (sec/mi). Below 5 sec is
 *  within rounding noise. 5+ s/mi is a real signal. */
const FASTER_THRESHOLD_S = 5;
const SLOWER_THRESHOLD_S = 5;

/** Goal race recency window — within 7 days of a goal race,
 *  paces are distorted by taper. Suspend signals. */
const RACE_WEEK_DAYS = 7;

/** Returns the user's threshold-workout observations over the
 *  lookback window. Pulls workout data from strava_activities; if
 *  the activity matches a planned T workout (via plan-match), uses
 *  the planned pace as the "prescribed" target. Falls back to
 *  VDOT-derived T pace from pacesFromVdot when no plan match. */
export async function computeThresholdSignal(
  userId: string,
  today: Date,
  currentVdot: number,
  maxHr: number | null,
): Promise<AdaptiveSignals['threshold']> {
  const cutoffIso = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Pull activities that LOOK like threshold work:
  //   - Distance 3-15 miles (typical T session range)
  //   - moving time > 0
  //   - Has HR data (avgHr present)
  //   - Not race-tagged
  // We then filter to those that match a planned threshold day OR
  // have an avg pace in the Daniels T band for the user's VDOT.
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC BETWEEN 3 AND 15
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND (data->>'avgHr')::NUMERIC > 0
        AND COALESCE((data->>'workoutType')::INTEGER, 0) != 1
      ORDER BY (data->>'date') DESC
      LIMIT 50`,
    [userId, cutoffIso],
  );

  const tPaces = pacesFromVdot(currentVdot);
  const tCenterS = tPaces ? Math.round((tPaces.T.lowS + tPaces.T.highS) / 2) : null;

  const observations: SignalObservation[] = [];

  for (const r of rows) {
    const d = r.data;
    const distMi = Number(d.distanceMi) || 0;
    const timeS = Number(d.movingTimeS) || 0;
    const avgHr = Number(d.avgHr) || 0;
    const actualPaceS = distMi > 0 ? Math.round(timeS / distMi) : null;
    if (!actualPaceS || !tCenterS) continue;

    // Identify as "threshold-like" — either matched as planned T workout
    // OR the actual pace sits in the broad T band (±25 s/mi of T center)
    // AND HR sat in Z4 territory.
    const isPlannedT = d.plannedWorkoutType === 'threshold' || d.plannedWorkoutType === 'sub_threshold' || d.plannedWorkoutType === 'threshold_intervals';
    const paceInTBand = Math.abs(actualPaceS - tCenterS) <= 25;
    if (!isPlannedT && !paceInTBand) continue;

    // HR in range — within Z4 (or close to it).
    let hrInRange: boolean | null = null;
    if (maxHr && maxHr > 0) {
      const hrPct = avgHr / maxHr;
      hrInRange = hrPct >= Z4_FLOOR_PCT && hrPct <= Z4_CEILING_PCT;
    }

    const prescribedPaceS = isPlannedT && d.plannedPaceS ? d.plannedPaceS : tCenterS;
    const paceDeltaS = actualPaceS - prescribedPaceS;

    // Context filters
    const context: string[] = [];
    let weight = 1.0;
    // No heat / sleep data wired in this pass — placeholder for when context tracking lands
    // No race-week check without goal race date; do that in the verdict layer

    const faster = paceDeltaS < -FASTER_THRESHOLD_S && hrInRange !== false;
    const slower = paceDeltaS > SLOWER_THRESHOLD_S && hrInRange !== false && context.length === 0;

    // If HR data missing, reduce weight (still a signal, just weaker)
    if (hrInRange === null) {
      weight *= 0.6;
      context.push('hr-missing');
    }

    observations.push({
      date: d.date || '',
      workoutLabel: d.plannedLabel || d.name || 'Threshold-pace run',
      workoutType: d.plannedWorkoutType || 'threshold',
      prescribedPaceS,
      actualPaceS,
      actualAvgHr: avgHr || null,
      hrInRange,
      paceDeltaS,
      context,
      faster,
      slower,
      weight,
    });
  }

  const fasterObs = observations.filter((o) => o.faster);
  const slowerObs = observations.filter((o) => o.slower);

  return {
    observations,
    fasterCount: fasterObs.length,
    slowerCount: slowerObs.length,
    fasterWeight: fasterObs.reduce((s, o) => s + o.weight, 0),
    slowerWeight: slowerObs.reduce((s, o) => s + o.weight, 0),
  };
}

/** STUB · Pace-at-fixed-HR drift. Returns empty observations + a
 *  note explaining the deferral. Full implementation requires HR
 *  stream data or per-mile splits, both of which need additional
 *  Strava API integration. Queued for follow-up. */
export function computeHrPaceDriftSignal(): AdaptiveSignals['hrPaceDrift'] {
  return {
    observations: [],
    implemented: false,
    note: 'Signal 2 (pace-at-fixed-HR drift) requires per-mile HR splits or stream data. Not implemented in this commit.',
  };
}

/** STUB · Interval pace adherence. Same pattern as Signal 1 but
 *  filters for I-pace workouts. Deferred to next pass to keep
 *  this commit focused on Signal 1 end-to-end. */
export function computeIntervalSignal(): AdaptiveSignals['intervals'] {
  return {
    observations: [],
    implemented: false,
    note: 'Signal 3 (interval pace) deferred to follow-up; pattern mirrors Signal 1.',
  };
}

/** Top-level: compute all three signals. The verdict module
 *  combines them. */
export async function computeAdaptiveSignals(
  userId: string,
  today: Date,
  currentVdot: number,
  maxHr: number | null,
): Promise<AdaptiveSignals> {
  const threshold = await computeThresholdSignal(userId, today, currentVdot, maxHr);
  return {
    threshold,
    hrPaceDrift: computeHrPaceDriftSignal(),
    intervals: computeIntervalSignal(),
  };
}
