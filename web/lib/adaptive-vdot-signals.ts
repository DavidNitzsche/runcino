/**
 * Adaptive VDOT signals, passive fitness movement detection between
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
 *     - Context filters: heat >78°F, within 7 days of any race,
 *       missing HR (soft attenuation only).
 *       Sleep filter HOOK present, wired when sleep data lands.
 *
 *   SIGNAL 2 · Pace at fixed HR (longitudinal drift), TODO
 *     Rolling 4-week average pace at HR 140 (Z2 midpoint) for
 *     easy runs. Pace improving 5+ sec/mi over 4 weeks is fitness
 *     gain; degrading 5+ sec/mi is investigate signal.
 *
 *   SIGNAL 3 · Interval pace at controlled effort, TODO
 *     Same pattern as Signal 1 but for I-pace workouts. Tighter
 *     HR ceiling (work intervals must stay below Z5 cap).
 *
 * This module computes per-signal observations. The verdict module
 * (lib/adaptive-vdot-verdict.ts) combines them using adaptive-
 * pattern.ts thresholds (UP: 3+ obs + 2.5 weight; DOWN: 2+ obs +
 * 1.5 weight) into a single banner-shape verdict.
 *
 * Source-of-truth contract: this reads from strava_activities for
 * workout HR/pace data, that's correct, training data lives in
 * strava_activities. compute-vdot still reads ONLY from races for
 * the race-derived aggregate. L7 doesn't break the L6 contract.
 *
 * Context attenuation policy (David 2026-05-19 round 3 spec):
 *   HARD context (heat, race-recency, poor-sleep) → weight = 0
 *     AND faster/slower flags = false. The observation stays
 *     visible (user can see what filtered out) but doesn't enter
 *     the verdict's count/weight tallies. Conservative-on-upside:
 *     a fast workout in 80°F heat is not evidence of fitness gain,
 *     period.
 *   SOFT context (hr-missing) → weight × 0.6. Still counts as
 *     evidence, just weaker. HR sensors glitch; the underlying
 *     pace signal is still real.
 *
 * Testability: evaluateActivities() is the pure transform. Hand it
 * activities + a context resolver and it returns the AdaptiveSignals
 * shape with no DB dependency. computeThresholdSignal() wraps it
 * with the DB + weather + race-calendar plumbing.
 */

import { query } from './db';
import { pacesFromVdot } from './vdot';
import { getWorkoutTemperatureF } from './workout-weather';
import { buildHrZonesBundle } from './hr-zones';

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
  /** Tags any context that should attenuate or skip this observation.
   *  HARD tags (heat, race-recency, poor-sleep) zero the weight and
   *  unset faster/slower. SOFT tags (hr-missing) attenuate weight only. */
  context: string[];
  /** Temperature at workout start in °F, if known. null = unknown
   *  (no coords, fetch failed, etc.), does NOT count as hot. */
  temperatureF: number | null;
  /** Days to nearest race (past or future, taking abs). null = no
   *  races in scope. */
  daysToNearestRace: number | null;
  /** True when this observation supports VDOT-up (faster + controlled HR
   *  + no hard context). */
  faster: boolean;
  /** True when this observation supports VDOT-investigate (slower + no
   *  hard context). */
  slower: boolean;
  /** Weight per observation (1.0 default, 0 with hard context, 0.6
   *  with hr-missing only). */
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
  data: ActivityData;
}

export interface ActivityData {
  name?: string;
  date?: string;
  distanceMi?: number;
  movingTimeS?: number;
  avgHr?: number;
  maxHr?: number;
  workoutType?: number | null;
  startLatLng?: [number, number] | null;
  /** Coarse workout class set at ingest time by upsertCanonicalRun
   *  from the watch slug ("2026-05-20-threshold" → "threshold"). Used
   *  as a fallback for plannedWorkoutType when the dedicated field
   *  isn't populated (e.g. Strava-only sync, no watch). */
  type?: string;
  /** Provenance tag ('watch' | 'apple_health' | 'strava'). The signal
   *  evaluator uses this to scope source-specific filters (e.g.
   *  Strava workoutType=1 race exclude only applies to Strava rows). */
  source?: string;
  // matched-workout fields if available from plan-match
  plannedWorkoutType?: string;
  plannedPaceS?: number;
  plannedLabel?: string;
}

/** Resolved context for a single activity, passed into evaluator.
 *  Caller fetches these per-activity (weather lookup, race calendar
 *  scan); the pure evaluator just consumes them. */
export interface ActivityContext {
  temperatureF: number | null;
  daysToNearestRace: number | null;
  /** Sleep quality flag, wired when sleep ingestion lands. Until
   *  then, callers pass undefined and the filter is a no-op. */
  poorSleepFlag?: boolean;
}

/** Look back 6 weeks for threshold-effort activities. We're looking
 *  for sustained signals, not single workouts, 6 weeks gives 4-8
 *  T workouts in a healthy training block, plenty for 3-consecutive
 *  detection without dragging in stale evidence. */
export const LOOKBACK_DAYS = 42;

/** Z4 ceiling as % of max HR (for HR-in-range check). Matches the
 *  Daniels threshold band, workouts at T pace should sit in Z4
 *  with maybe a few beats into Z5 on the last reps. */
const Z4_CEILING_PCT = 0.92;
const Z4_FLOOR_PCT = 0.85;

/** Threshold for "faster than prescribed" (sec/mi). Below 5 sec is
 *  within rounding noise. 5+ s/mi is a real signal. */
const FASTER_THRESHOLD_S = 5;
const SLOWER_THRESHOLD_S = 5;

/** Heat ceiling. Anything strictly hotter than this at workout
 *  start zeros the observation's weight, fast paces in heat are
 *  evidence of grit, not fitness gain. Conservative-on-upside.
 *  Threshold from David's spec 2026-05-19 round 3. */
export const HEAT_CEILING_F = 78;

/** Race-recency window. A workout within this many days BEFORE or
 *  AFTER a race is attenuated, taper distorts paces forward, race
 *  recovery distorts paces backward. Spec: ±7 days. */
export const RACE_RECENCY_DAYS = 7;

/** Soft attenuation factor when HR data is missing on an otherwise
 *  matching workout. The pace signal is still real (we observed the
 *  athlete running fast at threshold) but we can't confirm it was
 *  at controlled effort. */
const HR_MISSING_FACTOR = 0.6;

/** Context tag taxonomy. HARD tags zero the weight and unset
 *  faster/slower; SOFT tags scale weight by HR_MISSING_FACTOR. */
const HARD_CONTEXT_TAGS = new Set(['heat', 'race-recency', 'poor-sleep']);

/** Result of resolving an activity into a context shape, used by
 *  the verdict module for evidence rendering. */
export function tagsFromContext(ctx: ActivityContext, hrPresent: boolean): string[] {
  const tags: string[] = [];
  if (ctx.temperatureF != null && ctx.temperatureF > HEAT_CEILING_F) tags.push('heat');
  if (ctx.daysToNearestRace != null && ctx.daysToNearestRace <= RACE_RECENCY_DAYS) tags.push('race-recency');
  if (ctx.poorSleepFlag) tags.push('poor-sleep');
  if (!hrPresent) tags.push('hr-missing');
  return tags;
}

/** Pure transform: activities + per-activity context → signal shape.
 *  No DB or network. Tests inject mock activities + contexts. */
export function evaluateActivities(
  activities: Array<{ data: ActivityData; context: ActivityContext }>,
  currentVdot: number,
  maxHr: number | null,
  restingHr: number | null = null,
): AdaptiveSignals['threshold'] {
  const tPaces = pacesFromVdot(currentVdot);
  const tCenterS = tPaces ? Math.round((tPaces.T.lowS + tPaces.T.highS) / 2) : null;

  // Karvonen Threshold band (Z4) when resting HR is known, more accurate
  // than %max for trained runners (Research/03 §4 + §5). Falls back to the
  // %max Z4_FLOOR/CEILING constants below when resting HR is absent.
  const z4Band = buildHrZonesBundle(maxHr, restingHr)?.zones.find((z) => z.tier === 'z4') ?? null;

  const observations: SignalObservation[] = [];

  for (const { data: d, context: ctx } of activities) {
    const distMi = Number(d.distanceMi) || 0;
    const timeS = Number(d.movingTimeS) || 0;
    const avgHr = Number(d.avgHr) || 0;
    const actualPaceS = distMi > 0 ? Math.round(timeS / distMi) : null;
    if (!actualPaceS || !tCenterS) continue;

    // Identify as "threshold-like", either:
    //   - matched as planned T workout (via plan-match, when wired), OR
    //   - the coarse `type` field set at watch-ingest from the workout
    //     slug ("2026-05-20-threshold" → type='threshold'), OR
    //   - the actual pace sits in the broad T band (±25 s/mi of T center)
    const T_TYPES = new Set(['threshold', 'sub_threshold', 'threshold_intervals', 'tempo']);
    const isPlannedT = (d.plannedWorkoutType && T_TYPES.has(d.plannedWorkoutType))
                    || (d.type && T_TYPES.has(d.type));
    const paceInTBand = Math.abs(actualPaceS - tCenterS) <= 25;
    if (!isPlannedT && !paceInTBand) continue;

    // HR in range, within Z4 (or close to it). hrInRange=null when
    // we don't know max HR; hrInRange=false when HR was measured but
    // out of Z4 (workout was harder or easier than threshold effort).
    let hrInRange: boolean | null = null;
    const hrPresent = avgHr > 0;
    if (maxHr && maxHr > 0 && hrPresent) {
      if (z4Band) {
        // Karvonen %HRR Threshold band when resting HR is known.
        hrInRange = avgHr >= z4Band.lowBpm && avgHr <= z4Band.highBpm;
      } else {
        const hrPct = avgHr / maxHr;
        hrInRange = hrPct >= Z4_FLOOR_PCT && hrPct <= Z4_CEILING_PCT;
      }
    }

    const prescribedPaceS = isPlannedT && d.plannedPaceS ? d.plannedPaceS : tCenterS;
    const paceDeltaS = actualPaceS - prescribedPaceS;

    // Resolve context tags.
    const context = tagsFromContext(ctx, hrPresent);
    const hasHard = context.some((t) => HARD_CONTEXT_TAGS.has(t));
    const hasHrMissing = context.includes('hr-missing');

    // Weight calculation:
    //   - Hard context → 0 (observation visible but inert)
    //   - hr-missing only → 0.6 (soft attenuation)
    //   - clean → 1.0
    let weight = 1.0;
    if (hasHard) weight = 0;
    else if (hasHrMissing) weight = HR_MISSING_FACTOR;

    // Faster/slower flags require:
    //   - meaningful pace delta (≥ 5 s/mi)
    //   - HR not measured as out-of-Z4 (null is OK, we couldn't measure)
    //   - no hard context (heat / race-recency / poor-sleep)
    const fasterEnough = paceDeltaS < -FASTER_THRESHOLD_S;
    const slowerEnough = paceDeltaS > SLOWER_THRESHOLD_S;
    const hrAllows = hrInRange !== false;
    const faster = fasterEnough && hrAllows && !hasHard;
    const slower = slowerEnough && hrAllows && !hasHard;

    observations.push({
      date: d.date || '',
      workoutLabel: d.plannedLabel || d.name || 'Threshold-pace run',
      workoutType: d.plannedWorkoutType || d.type || 'threshold',
      prescribedPaceS,
      actualPaceS,
      actualAvgHr: avgHr || null,
      hrInRange,
      paceDeltaS,
      context,
      temperatureF: ctx.temperatureF,
      daysToNearestRace: ctx.daysToNearestRace,
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

/** Resolves the per-activity context shape using live DB / Open-Meteo
 *  data. Called once per candidate activity inside computeThresholdSignal. */
async function resolveActivityContext(
  data: ActivityData,
  raceDates: string[],
): Promise<ActivityContext> {
  const date = data.date ?? null;
  let temperatureF: number | null = null;
  if (data.startLatLng && date) {
    temperatureF = await getWorkoutTemperatureF(data.startLatLng[0], data.startLatLng[1], date);
  }
  let daysToNearestRace: number | null = null;
  if (date && raceDates.length > 0) {
    const workoutMs = Date.parse(date + 'T12:00:00Z');
    let minAbs = Number.POSITIVE_INFINITY;
    for (const rd of raceDates) {
      const raceMs = Date.parse(rd + 'T12:00:00Z');
      const days = Math.abs(Math.round((raceMs - workoutMs) / 86_400_000));
      if (days < minAbs) minAbs = days;
    }
    if (Number.isFinite(minAbs)) daysToNearestRace = minAbs;
  }
  return { temperatureF, daysToNearestRace };
}

/** Fetches the race calendar entries that fall within ±RACE_RECENCY_DAYS
 *  of the lookback window, that's the set whose dates could attenuate
 *  a workout in the window. */
async function fetchRecentAndUpcomingRaceDates(
  userId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<string[]> {
  const padDays = RACE_RECENCY_DAYS + 1;
  const padStart = new Date(Date.parse(windowStartIso + 'T00:00:00Z') - padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const padEnd = new Date(Date.parse(windowEndIso + 'T00:00:00Z') + padDays * 86_400_000)
    .toISOString().slice(0, 10);
  try {
    const rows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date
         FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' BETWEEN $2 AND $3
        ORDER BY meta->>'date'`,
      [userId, padStart, padEnd],
    );
    return rows.map((r) => r.date).filter(Boolean);
  } catch {
    return [];
  }
}

/** Returns the user's threshold-workout observations over the
 *  lookback window. Pulls workout data from strava_activities; if
 *  the activity matches a planned T workout (via plan-match), uses
 *  the planned pace as the "prescribed" target. Falls back to
 *  VDOT-derived T pace from pacesFromVdot when no plan match.
 *
 *  Resolves per-activity context (heat, race-recency) before
 *  evaluation; hard context zeros the observation's weight per the
 *  policy in the file header. */
export async function computeThresholdSignal(
  userId: string,
  today: Date,
  currentVdot: number,
  maxHr: number | null,
  restingHr: number | null = null,
): Promise<AdaptiveSignals['threshold']> {
  const todayIso = today.toISOString().slice(0, 10);
  const cutoffIso = new Date(today.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);

  // Pull all candidate runs in the window — let the evaluator decide
  // which qualify. The previous SQL filter `avgHr > 0` was silently
  // dropping HealthKit-sourced runs without HR (or runs where the watch
  // didn't sync HR through to the JSON); the evaluator already handles
  // missing HR via HR_MISSING_FACTOR (0.6× weight), so the hard filter
  // here was over-rejecting valid observations. The Strava-specific
  // workoutType filter only applies to Strava-source rows (HealthKit
  // rows use source='apple_health' or 'watch' and don't carry the
  // workoutType=1 race enum).
  const rows = await query<ActivityRow>(
    `SELECT id::text AS id, data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC BETWEEN 3 AND 15
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND NOT (
          COALESCE(data->>'source', 'strava') = 'strava'
          AND COALESCE((data->>'workoutType')::INTEGER, 0) = 1
        )
      ORDER BY (data->>'date') DESC
      LIMIT 50`,
    [userId, cutoffIso],
  );

  const raceDates = await fetchRecentAndUpcomingRaceDates(userId, cutoffIso, todayIso);

  // Resolve context per activity (weather + race recency). This is
  // the only async-per-activity step; the cache in workout-weather.ts
  // keeps it cheap on warm runs.
  const enriched = await Promise.all(
    rows.map(async (r) => ({
      data: r.data,
      context: await resolveActivityContext(r.data, raceDates),
    })),
  );

  return evaluateActivities(enriched, currentVdot, maxHr, restingHr);
}

/** Signal 2 implementation lives in lib/adaptive-vdot-signal2.ts, 
 *  this stub kept for the shape contract; the verdict module reads
 *  the new module directly. */
export function computeHrPaceDriftSignal(): AdaptiveSignals['hrPaceDrift'] {
  return {
    observations: [],
    implemented: false,
    note: 'See lib/adaptive-vdot-signal2.ts, Signal 2 now lives there with its own observation shape.',
  };
}

/** Signal 3 implementation lives in lib/adaptive-vdot-signal3.ts, 
 *  this stub kept for the shape contract; the verdict module reads
 *  the new module directly. */
export function computeIntervalSignal(): AdaptiveSignals['intervals'] {
  return {
    observations: [],
    implemented: false,
    note: 'See lib/adaptive-vdot-signal3.ts, Signal 3 now lives there with its own observation shape.',
  };
}

/** Top-level: compute all three signals. The verdict module
 *  combines them. */
export async function computeAdaptiveSignals(
  userId: string,
  today: Date,
  currentVdot: number,
  maxHr: number | null,
  restingHr: number | null = null,
): Promise<AdaptiveSignals> {
  const threshold = await computeThresholdSignal(userId, today, currentVdot, maxHr, restingHr);
  return {
    threshold,
    hrPaceDrift: computeHrPaceDriftSignal(),
    intervals: computeIntervalSignal(),
  };
}
