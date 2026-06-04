/**
 * lib/training/goal-projection.ts · plan-trusts-itself projection.
 *
 * David 2026-06-04: "not everyone, or me, is going to do another race
 * while training for a race, so we have to be sure the coaching and the
 * plan and the adaptation will get me there. if its a goal, the plan
 * should get me there until its very clear I cannot."
 *
 * Doctrine shift. The old engine was backward-looking · projection was
 * derived from the runner's last race result via Daniels predictRaceTime.
 * Without a tune-up race during a long build, the projection stayed
 * frozen at the last race time. That punished anyone in a race-prep
 * build who isn't ALSO racing every 6 weeks.
 *
 * New doctrine · the plan is the path. PROJECTION = GOAL until drift
 * signals fire. The runner is assumed to be ON TRACK while they follow
 * the plan and no specific evidence shows fitness is regressing.
 *
 * Daniels actually backs this · §VDOT chapter: "Training-pace-derived
 * VDOT is valid when training is consistent." Pfitzinger §LT-pace +
 * tempo HR is a fitness gauge that doesn't need a race to read.
 *
 * Status ladder:
 *   · on-track  · projection = goal · no drift signals
 *   · watching  · projection = goal · soft signals firing · "next quality
 *                  run will tell us more"
 *   · off-track · projection = current VDOT-derived · clear evidence the
 *                  plan won't deliver as is · gap is real and worth
 *                  renegotiating
 *
 * Drift signals (weights):
 *   · STRONG · recent priority A/B race > 2% slower than goal pace
 *   · STRONG · VDOT trend down ≥ 1 point over 4+ weeks (snapshot history)
 *   · MEDIUM · aerobic decoupling trending up across last 3 long runs
 *   · MEDIUM · tempo/threshold paces ≥ 10s/mi slower for 3+ weeks
 *   · MEDIUM · plan adapter forced 2+ weeks of easy downgrades
 *   · WEAK   · 30%+ key sessions missed in last 4 weeks
 *
 * Status thresholds:
 *   · 1 strong OR ≥ 2 medium → off-track
 *   · 1 medium OR ≥ 2 weak  → watching
 *   · otherwise              → on-track
 */

import { pool } from '@/lib/db/pool';
import { predictRaceTime } from './vdot';
import { computeDecouplingTrend } from './decoupling-trend';
import { runnerToday } from '@/lib/runtime/runner-tz';

export type GoalStatus = 'on-track' | 'watching' | 'off-track';
export type DriftWeight = 'strong' | 'medium' | 'weak';

export interface DriftSignal {
  kind: 'recent_race' | 'vdot_trend' | 'aerobic_decoupling'
    | 'tempo_pace_drift' | 'plan_adapter_downgrades' | 'missed_key_workouts';
  weight: DriftWeight;
  /** Plain-language explanation the runner can verify. */
  detail: string;
  /** Raw numbers for diagnostic / debug surfaces. */
  evidence: Record<string, number | string | null>;
}

export interface GoalProjection {
  status: GoalStatus;
  /** What we tell the runner: goal when ON TRACK / WATCHING, VDOT-derived
   *  when OFF TRACK. The single projection number for the gauge. */
  projectionSec: number;
  /** The goal · always present so display can show "X projected · Y goal"
   *  when off-track. */
  goalSec: number;
  /** The raw current-VDOT projection · always computed. Used when status
   *  flips to off-track AND for the "soft watch" hint when WATCHING. */
  vdotProjectionSec: number | null;
  /** All firing drift signals · empty when ON TRACK. */
  driftSignals: DriftSignal[];
  /** One-liner the page can render under the gauge. */
  summary: string;
}

export async function computeGoalProjection(args: {
  userUuid: string;
  goalSec: number;
  raceDistanceMi: number;
  vdot: number | null;
}): Promise<GoalProjection> {
  const { userUuid, goalSec, raceDistanceMi, vdot } = args;

  const vdotProjectionSec = vdot != null
    ? predictRaceTime(vdot, raceDistanceMi) ?? null
    : null;

  // Collect drift signals · each detector returns 0 or 1 signal. Failures
  // (DB error, missing data) silently produce no signal · we never punish
  // a healthy runner because a query timed out.
  const driftSignals: DriftSignal[] = [];
  const detectors = [
    () => detectRecentRaceDrift(userUuid, goalSec, raceDistanceMi),
    () => detectVdotTrendDrift(userUuid),
    () => detectAerobicDecouplingDrift(userUuid),
    () => detectTempoPaceDrift(userUuid, vdot),
    () => detectPlanAdapterDrift(userUuid),
    () => detectMissedKeyWorkoutDrift(userUuid),
  ];
  for (const detect of detectors) {
    try {
      const signal = await detect();
      if (signal) driftSignals.push(signal);
    } catch {
      // swallow · a broken detector ≠ drift
    }
  }

  // Status ladder
  const strongCount = driftSignals.filter((s) => s.weight === 'strong').length;
  const mediumCount = driftSignals.filter((s) => s.weight === 'medium').length;
  const weakCount = driftSignals.filter((s) => s.weight === 'weak').length;

  let status: GoalStatus = 'on-track';
  if (strongCount >= 1 || mediumCount >= 2) {
    status = 'off-track';
  } else if (mediumCount >= 1 || weakCount >= 2) {
    status = 'watching';
  }

  // Projection = goal until off-track
  const projectionSec = status === 'off-track' && vdotProjectionSec != null
    ? vdotProjectionSec
    : goalSec;

  const summary = composeSummary(status, driftSignals, goalSec, vdotProjectionSec);

  return {
    status,
    projectionSec,
    goalSec,
    vdotProjectionSec,
    driftSignals,
    summary,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Detectors · each returns 0 or 1 signal. All independent + side-effect
// free · order doesn't matter, double-firing is fine (each is a distinct
// kind).
// ────────────────────────────────────────────────────────────────────────

/** STRONG · a finished priority A/B race within 180 days that came in
 *  more than 2% slower than goal pace at that race's distance. */
async function detectRecentRaceDrift(
  userUuid: string,
  goalSec: number,
  raceDistanceMi: number,
): Promise<DriftSignal | null> {
  const goalPacePerMi = goalSec / Math.max(raceDistanceMi, 0.1);
  const today = await runnerToday(userUuid);
  const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 180 * 86400000)
    .toISOString().slice(0, 10);

  const r = (await pool.query<{
    slug: string;
    name: string | null;
    date: string;
    dist: string | null;
    finish_s: number | string | null;
  }>(
    `SELECT slug,
            meta->>'name' AS name,
            meta->>'date' AS date,
            meta->>'distanceMi' AS dist,
            COALESCE(
              (actual_result->>'finishS')::numeric,
              NULLIF(meta->>'finishTime','')::numeric
            ) AS finish_s
       FROM races
      WHERE user_uuid = $1::uuid
        AND meta->>'priority' IN ('A','B')
        AND meta->>'date' < $2
        AND meta->>'date' >= $3
      ORDER BY meta->>'date' DESC
      LIMIT 1`,
    [userUuid, today, cutoff],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!r || !r.finish_s || !r.dist) return null;
  const dist = Number(r.dist);
  const finishS = Number(r.finish_s);
  const racePacePerMi = finishS / Math.max(dist, 0.1);
  const slowdownPct = (racePacePerMi - goalPacePerMi) / goalPacePerMi * 100;
  if (slowdownPct < 2) return null;

  return {
    kind: 'recent_race',
    weight: 'strong',
    detail: `${r.name ?? r.slug} on ${r.date} finished ${slowdownPct.toFixed(1)}% off goal pace · the strongest signal we have on current fitness.`,
    evidence: {
      slug: r.slug,
      raceDate: r.date,
      raceFinishSec: finishS,
      raceDistanceMi: dist,
      racePacePerMiSec: Math.round(racePacePerMi),
      goalPacePerMiSec: Math.round(goalPacePerMi),
      slowdownPct: Number(slowdownPct.toFixed(2)),
    },
  };
}

/** STRONG · VDOT trend over 4+ weeks has dropped by ≥ 1 point.
 *  Read from projection_snapshots history. */
async function detectVdotTrendDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ recent: string | null; older: string | null }>(
    `WITH ranked AS (
       SELECT vdot, snapshot_date,
              ROW_NUMBER() OVER (ORDER BY snapshot_date DESC) AS rn
         FROM projection_snapshots
        WHERE user_uuid = $1::uuid
          AND vdot IS NOT NULL
          AND snapshot_date >= CURRENT_DATE - INTERVAL '60 days'
        GROUP BY vdot, snapshot_date
     )
     SELECT
       (SELECT vdot::text FROM ranked WHERE rn <= 7 ORDER BY snapshot_date DESC LIMIT 1) AS recent,
       (SELECT vdot::text FROM ranked WHERE snapshot_date <= CURRENT_DATE - INTERVAL '28 days' ORDER BY snapshot_date DESC LIMIT 1) AS older`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.recent || !r.older) return null;
  const recent = Number(r.recent);
  const older = Number(r.older);
  if (recent >= older - 1) return null;

  return {
    kind: 'vdot_trend',
    weight: 'strong',
    detail: `VDOT trend is down · ${older.toFixed(1)} four weeks ago, ${recent.toFixed(1)} now · ${(older - recent).toFixed(1)} points of fitness loss.`,
    evidence: { vdotRecent: recent, vdot4wAgo: older, delta: Number((recent - older).toFixed(2)) },
  };
}

/** MEDIUM · aerobic decoupling trending up across recent long runs.
 *  Worsening drift = aerobic engine slipping. */
async function detectAerobicDecouplingDrift(userUuid: string): Promise<DriftSignal | null> {
  const trend = await computeDecouplingTrend(userUuid).catch(() => null);
  if (!trend) return null;
  if (trend.direction !== 'declining') return null;
  // A "declining" trend means decoupling is INCREASING (worse aerobic
  // efficiency). 0.5pp+ worse is the threshold for medium signal.
  if (trend.currentDriftPct - trend.blockStartDriftPct < 0.5) return null;

  return {
    kind: 'aerobic_decoupling',
    weight: 'medium',
    detail: `Aerobic decoupling is widening · ${trend.blockStartDriftPct.toFixed(1)}% drift at block start, ${trend.currentDriftPct.toFixed(1)}% now. The engine is working harder for the same effort.`,
    evidence: {
      currentDriftPct: trend.currentDriftPct,
      blockStartDriftPct: trend.blockStartDriftPct,
      runsCount: trend.runsCount,
      weeksTracked: trend.weeksTracked,
    },
  };
}

/** MEDIUM · recent tempo/threshold paces drifting slower than the
 *  VDOT-implied T-pace by ≥ 10 s/mi for 3+ weeks. */
async function detectTempoPaceDrift(
  userUuid: string,
  vdot: number | null,
): Promise<DriftSignal | null> {
  if (!vdot) return null;
  // T-pace implied by current VDOT (Daniels: T-pace ≈ HM-pace minus
  // ~5 s/mi). Use predictRaceTime for HM, derive pace, subtract 5.
  const hmSec = predictRaceTime(vdot, 13.1);
  if (!hmSec) return null;
  const tPacePerMi = hmSec / 13.1 - 5;

  const r = (await pool.query<{
    avg_pace_s: number | string | null;
    count: number | string;
  }>(
    `SELECT AVG((data->>'avgPaceSecPerMi')::numeric) AS avg_pace_s,
            COUNT(*) AS count
       FROM runs
      WHERE user_uuid = $1::uuid
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'workoutType' = 'tempo' OR data->>'workoutType' = 'threshold')
        AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) >= (CURRENT_DATE - INTERVAL '21 days')::text
        AND (data->>'distanceMi')::numeric >= 4`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || !r.avg_pace_s || Number(r.count) < 3) return null;
  const observedPaceSec = Number(r.avg_pace_s);
  const driftSecPerMi = observedPaceSec - tPacePerMi;
  if (driftSecPerMi < 10) return null;

  return {
    kind: 'tempo_pace_drift',
    weight: 'medium',
    detail: `Recent tempo paces averaging ${Math.round(driftSecPerMi)} s/mi slower than the VDOT-implied T-pace across ${r.count} sessions in the last 3 weeks.`,
    evidence: {
      observedPaceSec: Math.round(observedPaceSec),
      vdotTPaceSec: Math.round(tPacePerMi),
      driftSecPerMi: Math.round(driftSecPerMi),
      sessionCount: Number(r.count),
    },
  };
}

/** MEDIUM · plan adapter has forced 2+ weeks of downgrades. The
 *  adapter doesn't fire unless something's tripping it · sustained
 *  firing is a fitness drift signal. */
async function detectPlanAdapterDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ count: number | string }>(
    `SELECT COUNT(DISTINCT date_trunc('week', ci.ts)) AS count
       FROM coach_intents ci
      WHERE COALESCE(ci.user_uuid, ci.user_id::uuid) = $1::uuid
        AND ci.reason IN ('plan_adapt_downgrade','plan_adapt_shave')
        AND ci.ts >= NOW() - INTERVAL '28 days'`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const weeksWithAdapts = Number(r.count);
  if (weeksWithAdapts < 2) return null;

  return {
    kind: 'plan_adapter_downgrades',
    weight: 'medium',
    detail: `Plan adapter has stepped in ${weeksWithAdapts} of the last 4 weeks · sustained downgrades signal the runner isn't absorbing the plan as designed.`,
    evidence: { weeksWithAdaptations: weeksWithAdapts },
  };
}

/** WEAK · 30%+ of scheduled key workouts (quality + long) missed in
 *  the last 4 weeks. */
async function detectMissedKeyWorkoutDrift(userUuid: string): Promise<DriftSignal | null> {
  const r = (await pool.query<{ scheduled: number | string; completed: number | string }>(
    `WITH key_window AS (
       SELECT pw.id, pw.date_iso, pw.type, pw.distance_mi
         FROM plan_workouts pw
         JOIN training_plans tp ON tp.id = pw.plan_id
        WHERE tp.user_uuid = $1::uuid
          AND tp.archived_iso IS NULL
          AND pw.type IN ('long','tempo','threshold','intervals','race')
          AND pw.date_iso >= (CURRENT_DATE - INTERVAL '28 days')::text
          AND pw.date_iso < CURRENT_DATE::text
     )
     SELECT
       (SELECT COUNT(*) FROM key_window) AS scheduled,
       (SELECT COUNT(*) FROM key_window kw
         WHERE EXISTS (
           SELECT 1 FROM runs r
            WHERE r.user_uuid = $1
              AND NOT (r.data ? 'mergedIntoId')
              AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10)) = kw.date_iso
              AND (r.data->>'distanceMi')::numeric >= kw.distance_mi * 0.8
         )
       ) AS completed`,
    [userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const scheduled = Number(r.scheduled);
  const completed = Number(r.completed);
  if (scheduled < 3) return null;
  const missedPct = (scheduled - completed) / scheduled;
  if (missedPct < 0.3) return null;

  return {
    kind: 'missed_key_workouts',
    weight: 'weak',
    detail: `${scheduled - completed} of ${scheduled} key workouts missed in the last 4 weeks · ${Math.round(missedPct * 100)}%.`,
    evidence: {
      scheduledCount: scheduled,
      completedCount: completed,
      missedCount: scheduled - completed,
      missedPct: Number(missedPct.toFixed(2)),
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// Summary composition
// ────────────────────────────────────────────────────────────────────────

function composeSummary(
  status: GoalStatus,
  signals: DriftSignal[],
  goalSec: number,
  vdotProjectionSec: number | null,
): string {
  if (status === 'on-track') {
    return 'The plan is the path. Keep doing the work.';
  }
  if (status === 'watching') {
    const top = signals.find((s) => s.weight === 'medium') ?? signals[0];
    return `Watching · ${top?.detail ?? 'soft signal firing'}. The next quality run will tell us more.`;
  }
  // off-track
  const strong = signals.find((s) => s.weight === 'strong');
  if (strong) {
    return `Off track · ${strong.detail}`;
  }
  const mediums = signals.filter((s) => s.weight === 'medium');
  if (mediums.length >= 2) {
    return `Off track · ${mediums[0].detail} Plus ${mediums.length - 1} more drift signal${mediums.length - 1 === 1 ? '' : 's'}.`;
  }
  return 'Off track · plan is no longer on pace for goal.';
}

/** Format helper · seconds → "1:30:00" or "30:00". */
export function formatGoalTime(sec: number | null): string {
  if (sec == null) return '·';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
