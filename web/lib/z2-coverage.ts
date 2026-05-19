/**
 * Z2 coverage finding · V5 · "Z2 stimulus check" surface on /overview
 *
 * The system observed across multiple data points: Z2 drift (most
 * easy-run mileage lands above Z2 even after HRR recalibration) +
 * threshold under-reach (recent T workouts hit pace band but stayed
 * below Z4 HR) + race-recency context. Connects them into one unified
 * coaching finding.
 *
 * Voice: data is data, coach is coach. Both honest. Don't soften the
 * diagnosis to make it palatable — the data IS the case for slowing
 * down, and softening it makes the coach less useful.
 *
 * TRIGGER (locked with David round 4, 2026-05-19):
 *   Surface fires when:
 *     - Last 7 days: ≥3 easy runs AND Z2 share < 40% of easy mileage
 *     - NOT during race-week (within 7 days of any race in scope)
 *     - NOT during post-race recovery (within 7 days AFTER a race)
 *     - HRR framework active (max HR + resting HR both set —
 *       otherwise Z2 band is uncalibrated and the finding is noise)
 *
 * The 40% threshold + 3-run minimum kills single-run noise. A 5K
 * effort or tempo day shouldn't flip the surface; sustained drift
 * over multiple sessions should.
 *
 * Falsifier: 3+ consecutive weeks where ≥60% of easy mileage lands
 * in Z2. That's the observable proof that the coaching landed.
 *
 * Second-order observation: when the most recent threshold workout
 * hit the pace band but stayed below Z4, surface it. That's downstream
 * evidence — body can't reach threshold intensity when carrying easy-
 * day load. Connecting the dots is the coaching.
 */

import { query } from './db';
import { buildFitnessHrZones } from './hr-zones';
import { pacesFromVdot } from './vdot';
import { RACE_RECENCY_DAYS } from './adaptive-vdot-signals';
import { computeStravaGap } from './strava-gap';

export interface Z2CoverageFinding {
  /** True when the surface should render. */
  shouldRender: boolean;
  /** Reason the finding didn't fire (for diagnostics). */
  suppressReason?: 'no-hrr-framework' | 'too-few-runs' | 'z2-share-ok' | 'race-week' | 'post-race-recovery' | 'no-data';
  /** Z2 HR ceiling (Z2 highBpm from hr-zones.ts). */
  z2CeilingBpm: number | null;
  /** Suggested E-pace range for the recommendation copy. */
  ePaceRangeDisplay: string | null;
  /** Last 7 days stats. */
  last7d: {
    easyRunCount: number;
    runsInZ2: number;
    easyMiles: number;
    z2Miles: number;
    z2SharePct: number;
  };
  /** Last 28 days stats. */
  last28d: {
    z2Miles: number;
    easyMiles: number;
    z2SharePct: number;
  };
  /** Second-order observation: most recent threshold workout that
   *  hit the pace band but stayed below Z4. Null when none. */
  thresholdUnderReach: {
    date: string;
    name: string;
    paceDisplay: string;
    avgHr: number;
    z4FloorBpm: number;
  } | null;
}

/** Z2 share threshold below which the surface fires. */
const Z2_SHARE_FIRE_PCT = 40;
/** Minimum easy-run count to evaluate (kills single-run noise). */
const MIN_EASY_RUNS = 3;

interface ActivityRow {
  data: {
    date?: string;
    name?: string;
    distanceMi?: number;
    movingTimeS?: number;
    avgHr?: number;
    workoutType?: number | null;
    splits?: Array<{ mile: number; paceSPerMi: number; avgHr: number | null }>;
  };
}

/** Test whether an activity is an easy-effort candidate.
 *  Same shape as Signal 2's filter. */
function isEasyCandidate(data: ActivityRow['data']): boolean {
  const wt = data.workoutType ?? 0;
  if (wt !== 0 && wt !== null) return false;
  const dist = Number(data.distanceMi) || 0;
  if (dist < 3) return false;
  if (dist >= 9) return false;
  return true;
}

function fmtPace(s: number): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}/mi`;
}

async function fetchRaceDates(userId: string, startIso: string, endIso: string): Promise<string[]> {
  const padDays = RACE_RECENCY_DAYS + 1;
  const padStart = new Date(Date.parse(startIso + 'T00:00:00Z') - padDays * 86_400_000)
    .toISOString().slice(0, 10);
  const padEnd = new Date(Date.parse(endIso + 'T00:00:00Z') + padDays * 86_400_000)
    .toISOString().slice(0, 10);
  try {
    const rows = await query<{ date: string }>(
      `SELECT meta->>'date' AS date FROM races
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND meta->>'date' BETWEEN $2 AND $3`,
      [userId, padStart, padEnd],
    );
    return rows.map((r) => r.date).filter(Boolean);
  } catch {
    return [];
  }
}

/** Find the most recent threshold-effort workout that hit pace target
 *  but stayed below Z4 HR. The "downstream" observation in the V5
 *  surface — when easy runs are too hard, threshold can't reach Z4.
 *
 *  RACE-RECENCY GUARD · skips workouts within ±7 days of any race.
 *  A pace-band-but-sub-Z4 workout 3 days before a race is intentional
 *  taper conservation, not a fitness/freshness symptom. Without this
 *  guard the under-reach observation would misattribute taper miles
 *  to the easy-day-load story. */
async function findThresholdUnderReach(
  userId: string,
  todayIso: string,
  z4FloorBpm: number,
  vdot: number,
  raceDates: string[],
): Promise<Z2CoverageFinding['thresholdUnderReach']> {
  const paces = pacesFromVdot(vdot);
  if (!paces) return null;
  const tCenter = Math.round((paces.T.lowS + paces.T.highS) / 2);
  const tLow = tCenter - 25;
  const tHigh = tCenter + 25;

  const cutoffIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 28 * 86_400_000)
    .toISOString().slice(0, 10);

  const rows = await query<{
    date: string; name: string;
    actual_pace_s: string; avg_hr: string;
  }>(
    `SELECT
        data->>'date'                  AS date,
        COALESCE(data->>'name', '')    AS name,
        ((data->>'movingTimeS')::NUMERIC / NULLIF((data->>'distanceMi')::NUMERIC, 0))::NUMERIC AS actual_pace_s,
        (data->>'avgHr')::NUMERIC      AS avg_hr
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC BETWEEN 3 AND 10
        AND (data->>'movingTimeS')::NUMERIC > 0
        AND (data->>'avgHr')::NUMERIC > 0
        AND COALESCE((data->>'workoutType')::INTEGER, 0) IN (0, 3)
      ORDER BY (data->>'date') DESC
      LIMIT 30`,
    [userId, cutoffIso],
  );

  for (const r of rows) {
    const pace = Math.round(Number(r.actual_pace_s));
    const hr = Math.round(Number(r.avg_hr));
    if (pace < tLow || pace > tHigh) continue;
    if (hr >= z4FloorBpm) continue;  // hit Z4 → not an under-reach
    // Race-recency: skip if within ±7 days of any race in scope
    const wMs = Date.parse(r.date + 'T12:00:00Z');
    const inRaceWindow = raceDates.some((rd) => {
      const rMs = Date.parse(rd + 'T12:00:00Z');
      return Math.abs(Math.round((rMs - wMs) / 86_400_000)) <= RACE_RECENCY_DAYS;
    });
    if (inRaceWindow) continue;
    return {
      date: r.date,
      name: r.name || 'Threshold workout',
      paceDisplay: fmtPace(pace),
      avgHr: hr,
      z4FloorBpm,
    };
  }
  return null;
}

export async function computeZ2CoverageFinding(
  userId: string,
  todayIso: string,
  maxHr: number | null,
  restingHr: number | null,
  vdot: number,
): Promise<Z2CoverageFinding> {
  // Default empty result for early-return paths.
  const empty: Z2CoverageFinding = {
    shouldRender: false,
    z2CeilingBpm: null,
    ePaceRangeDisplay: null,
    last7d: { easyRunCount: 0, runsInZ2: 0, easyMiles: 0, z2Miles: 0, z2SharePct: 0 },
    last28d: { z2Miles: 0, easyMiles: 0, z2SharePct: 0 },
    thresholdUnderReach: null,
  };

  const zones = buildFitnessHrZones(maxHr, restingHr);
  // No HRR framework → don't fire. Z2 band derived from %max alone
  // tends to be miscalibrated for trained runners with low resting
  // HR; firing the surface on uncertain band data would be coaching
  // noise, not signal.
  if (!zones || !restingHr) {
    return { ...empty, suppressReason: 'no-hrr-framework' };
  }

  // Injury suspension · per Rule 5 (per-finding context filter). V5
  // shouldn't fire while the user is marked injured — missed easy
  // runs during recovery are not "easy runs too hard," they're
  // intentional rehab. Same context-filter principle as L7.
  try {
    const gap = await computeStravaGap(userId, todayIso);
    if (gap.signalsSuspended) {
      return { ...empty, z2CeilingBpm: zones.z2.highBpm, suppressReason: 'no-data' };
    }
  } catch { /* non-fatal */ }
  const z2 = zones.z2;
  const z4FloorBpm = zones.z4.lowBpm;

  // Pull race dates across the 28-day lookback window (plus padding).
  // Used twice below: race-week suppression (today ± 7d) AND
  // threshold-under-reach race-recency filtering (across the window).
  const startIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 28 * 86_400_000)
    .toISOString().slice(0, 10);
  const raceDates = await fetchRaceDates(userId, startIso, todayIso);
  const todayMs = Date.parse(todayIso + 'T12:00:00Z');
  const inRaceWindow = raceDates.some((rd) => {
    const rMs = Date.parse(rd + 'T12:00:00Z');
    return Math.abs(Math.round((rMs - todayMs) / 86_400_000)) <= RACE_RECENCY_DAYS;
  });
  if (inRaceWindow) {
    return { ...empty, z2CeilingBpm: z2.highBpm, suppressReason: 'race-week' };
  }
  // Post-race recovery: any race in the last 7 days (already covered
  // by inRaceWindow check above, but we keep an explicit branch in
  // case the suppression policy diverges).

  // Pull easy candidates with splits for Z2 mile calculation.
  const rows = await query<ActivityRow>(
    `SELECT data
       FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND (data->>'date') >= $2
        AND (data->>'distanceMi')::NUMERIC > 0
        AND (data->>'movingTimeS')::NUMERIC > 0
      ORDER BY (data->>'date') DESC
      LIMIT 100`,
    [userId, startIso],
  );

  const last7dStartIso = new Date(Date.parse(todayIso + 'T00:00:00Z') - 7 * 86_400_000)
    .toISOString().slice(0, 10);

  let last7dEasyCount = 0;
  let last7dRunsInZ2 = 0;
  let last7dEasyMiles = 0;
  let last7dZ2Miles = 0;
  let last28dEasyMiles = 0;
  let last28dZ2Miles = 0;

  for (const r of rows) {
    const d = r.data;
    const date = d.date ?? '';
    if (!date || !isEasyCandidate(d)) continue;
    const splits = d.splits ?? [];
    if (splits.length === 0) continue;

    const distance = Number(d.distanceMi) || 0;
    const z2SplitsCount = splits.filter(
      (s) => s.avgHr != null && s.avgHr >= z2.lowBpm && s.avgHr <= z2.highBpm,
    ).length;
    // Treat the run as "in Z2" if MAJORITY of splits land in Z2.
    const runInZ2 = z2SplitsCount >= splits.length / 2;

    last28dEasyMiles += distance;
    last28dZ2Miles += z2SplitsCount;  // 1 mile per split

    if (date >= last7dStartIso) {
      last7dEasyCount += 1;
      last7dEasyMiles += distance;
      last7dZ2Miles += z2SplitsCount;
      if (runInZ2) last7dRunsInZ2 += 1;
    }
  }

  const last7dShare = last7dEasyMiles > 0
    ? Math.round((last7dZ2Miles / last7dEasyMiles) * 100)
    : 0;
  const last28dShare = last28dEasyMiles > 0
    ? Math.round((last28dZ2Miles / last28dEasyMiles) * 100)
    : 0;

  // E-pace range for the recommendation copy.
  const paces = pacesFromVdot(vdot);
  const ePaceRangeDisplay = paces
    ? `${fmtPace(paces.E.lowS)}-${fmtPace(paces.E.highS)}`.replace(/\/mi/g, '').trim() + '/mi'
    : null;

  // Trigger guard: need MIN_EASY_RUNS in last 7 days AND share < threshold.
  if (last7dEasyCount < MIN_EASY_RUNS) {
    return {
      ...empty,
      z2CeilingBpm: z2.highBpm,
      ePaceRangeDisplay,
      last7d: {
        easyRunCount: last7dEasyCount,
        runsInZ2: last7dRunsInZ2,
        easyMiles: Math.round(last7dEasyMiles * 10) / 10,
        z2Miles: last7dZ2Miles,
        z2SharePct: last7dShare,
      },
      last28d: {
        easyMiles: Math.round(last28dEasyMiles * 10) / 10,
        z2Miles: last28dZ2Miles,
        z2SharePct: last28dShare,
      },
      suppressReason: last7dEasyCount === 0 ? 'no-data' : 'too-few-runs',
    };
  }
  if (last7dShare >= Z2_SHARE_FIRE_PCT) {
    return {
      ...empty,
      z2CeilingBpm: z2.highBpm,
      ePaceRangeDisplay,
      last7d: {
        easyRunCount: last7dEasyCount,
        runsInZ2: last7dRunsInZ2,
        easyMiles: Math.round(last7dEasyMiles * 10) / 10,
        z2Miles: last7dZ2Miles,
        z2SharePct: last7dShare,
      },
      last28d: {
        easyMiles: Math.round(last28dEasyMiles * 10) / 10,
        z2Miles: last28dZ2Miles,
        z2SharePct: last28dShare,
      },
      suppressReason: 'z2-share-ok',
    };
  }

  // Fires. Look up the second-order under-reach observation, passing
  // the race-dates we already fetched so taper workouts get filtered.
  const thresholdUnderReach = await findThresholdUnderReach(userId, todayIso, z4FloorBpm, vdot, raceDates);

  return {
    shouldRender: true,
    z2CeilingBpm: z2.highBpm,
    ePaceRangeDisplay,
    last7d: {
      easyRunCount: last7dEasyCount,
      runsInZ2: last7dRunsInZ2,
      easyMiles: Math.round(last7dEasyMiles * 10) / 10,
      z2Miles: last7dZ2Miles,
      z2SharePct: last7dShare,
    },
    last28d: {
      easyMiles: Math.round(last28dEasyMiles * 10) / 10,
      z2Miles: last28dZ2Miles,
      z2SharePct: last28dShare,
    },
    thresholdUnderReach,
  };
}
