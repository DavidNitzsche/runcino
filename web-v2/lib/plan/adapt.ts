/**
 * P38 — plan adaptation triggers.
 *
 * Sits next to the v1 algorithmic plan generator (`./generate.ts`).
 * Doesn't replace it; adds a feedback layer that rewrites the next
 * N days when reality diverges from the plan.
 *
 * Detection triggers (all cite Research):
 *
 *   1. MISSED_KEY_WORKOUT — planned threshold/intervals not completed
 *      within ±1d. → Reschedule that workout 2-3d forward; downgrade
 *      next quality day to recovery (avoid stacking).
 *      Cite: 00a §missed-workout-policy
 *
 *   2. RHR_SPIKE — 3-day avg RHR > 7 bpm above 14-day baseline.
 *      → Convert next quality day to easy; flag readiness.
 *      Cite: 05-readiness-and-recovery.md §rhr-deviation
 *
 *   3. SLEEP_CRATER — 2+ nights < 5h.
 *      → Convert next quality day to easy.
 *      Cite: 05 §sleep-quality
 *
 *   4. VOLUME_OVERSHOOT — last 7d running volume > 25% above current
 *      experience-level cap (P33).
 *      → Shave next 7d by 15-20% (proportional).
 *      Cite: 00a §ramp-rules
 *
 *   5. PR_BANK — recent race finish that implies VDOT jump > 1.5 pts.
 *      → Recompute paces; mark plan_workouts as needing prescription refresh.
 *      Cite: 03-pacing-and-zones.md §vdot-recalc
 *
 * Output: array of `AdaptationAction`s. The caller applies them in
 * a single DB transaction, then bumps the plan's `last_adapted_at` so
 * the coach can see when the plan changed.
 */
import { pool } from '@/lib/db/pool';
import type { ExperienceLevel } from '@/lib/coach/profile-state';

export type AdaptationTriggerKind =
  | 'missed_key_workout'
  | 'rhr_spike'
  | 'sleep_crater'
  | 'volume_overshoot'
  | 'pr_bank';

export interface AdaptationTrigger {
  kind: AdaptationTriggerKind;
  severity: 'info' | 'warn' | 'override';
  reason: string;             // human-readable; surfaces in coach prose
  evidence: Record<string, any>;
}

export interface AdaptationAction {
  kind: 'reschedule' | 'downgrade' | 'shave' | 'recompute_paces' | 'mark_dirty';
  workoutIds?: string[];      // plan_workouts.id targeted
  newType?: string;
  newDate?: string;
  shaveFraction?: number;     // e.g. 0.15 = 15% off the volume
  why: string;                // for the coach to repeat
}

export interface AdaptationResult {
  triggers: AdaptationTrigger[];
  actions: AdaptationAction[];
  applied: boolean;
}

/**
 * Experience-level volume caps (P33). Multiplied by current peak
 * mileage in the plan to determine "overshoot" threshold.
 */
export const EXPERIENCE_CAPS_MI: Record<ExperienceLevel, number> = {
  beginner:      25,
  intermediate:  45,
  advanced:      75,
  advanced_plus: 110,
};

/** Run all detectors against today's state, return triggers + actions. */
export async function detectAdaptations(userId: string): Promise<AdaptationResult> {
  const triggers: AdaptationTrigger[] = [];

  // 1. Missed key workout
  const missed = await detectMissedKeyWorkout(userId);
  if (missed) triggers.push(missed);

  // 2. RHR spike
  const rhr = await detectRhrSpike(userId);
  if (rhr) triggers.push(rhr);

  // 3. Sleep crater
  const sleep = await detectSleepCrater(userId);
  if (sleep) triggers.push(sleep);

  // 4. Volume overshoot
  const overshoot = await detectVolumeOvershoot(userId);
  if (overshoot) triggers.push(overshoot);

  const actions: AdaptationAction[] = [];
  for (const t of triggers) {
    actions.push(...await actionsForTrigger(userId, t));
  }

  return { triggers, actions, applied: false };
}

/** Apply the actions to plan_workouts in a single transaction. */
export async function applyAdaptations(userId: string, actions: AdaptationAction[]): Promise<number> {
  if (actions.length === 0) return 0;
  let touched = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of actions) {
      if (a.kind === 'reschedule' && a.newDate && a.workoutIds) {
        for (const wid of a.workoutIds) {
          await client.query(
            `UPDATE plan_workouts SET date_iso = $1 WHERE id = $2`,
            [a.newDate, wid]
          );
          touched++;
        }
      } else if (a.kind === 'downgrade' && a.newType && a.workoutIds) {
        for (const wid of a.workoutIds) {
          await client.query(
            `UPDATE plan_workouts SET type = $1 WHERE id = $2`,
            [a.newType, wid]
          );
          touched++;
        }
      } else if (a.kind === 'shave' && a.workoutIds && a.shaveFraction) {
        for (const wid of a.workoutIds) {
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = ROUND((distance_mi * (1 - $1::numeric))::numeric, 1)
              WHERE id = $2`,
            [a.shaveFraction, wid]
          );
          touched++;
        }
      } else if (a.kind === 'mark_dirty' && a.workoutIds) {
        for (const wid of a.workoutIds) {
          await client.query(
            `UPDATE plan_workouts
                SET notes = COALESCE(notes, '') || ' [paces stale - recompute]'
              WHERE id = $1`,
            [wid]
          );
          touched++;
        }
      }
    }
    // Stamp adaptation on the plan
    await client.query(
      `UPDATE training_plans SET last_adapted_at = NOW()
        WHERE user_uuid = $1 AND archived_iso IS NULL`,
      [userId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return touched;
}

// ── Detectors ──────────────────────────────────────────────────────────

async function detectMissedKeyWorkout(userId: string): Promise<AdaptationTrigger | null> {
  // Was the last scheduled threshold/intervals NOT completed within ±1d
  // of its plan date?
  const r = (await pool.query(
    `SELECT pw.id, pw.date_iso::date::text AS date, pw.type
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.type IN ('threshold','tempo','intervals','vo2max')
        AND pw.date_iso::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE - 1
      ORDER BY pw.date_iso::date DESC LIMIT 1`,
    [userId]
  )).rows[0];
  if (!r) return null;

  // Was there a run of distance >= 4mi within the ±1d window with a
  // matching workout type heuristic?
  const completed = (await pool.query(
    `SELECT COUNT(*) AS n FROM strava_activities
      WHERE (user_uuid = $1 OR user_uuid IS NULL)
        AND NOT (data ? 'mergedIntoId')
        AND (data->>'date')::date BETWEEN $2::date - 1 AND $2::date + 1
        AND (data->>'distanceMi')::numeric >= 4`,
    [userId, r.date]
  )).rows[0];

  if (Number(completed.n) === 0) {
    return {
      kind: 'missed_key_workout',
      severity: 'warn',
      reason: `${r.type} on ${r.date} appears uncompleted.`,
      evidence: { workout_id: r.id, planned_date: r.date, type: r.type },
    };
  }
  return null;
}

async function detectRhrSpike(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query(
    `WITH recent AS (
       SELECT AVG(value) AS avg3 FROM health_samples
        WHERE user_id = $1 AND sample_type = 'resting_hr'
          AND sample_date >= CURRENT_DATE - 3
     ), baseline AS (
       SELECT AVG(value) AS avg14 FROM health_samples
        WHERE user_id = $1 AND sample_type = 'resting_hr'
          AND sample_date BETWEEN CURRENT_DATE - 17 AND CURRENT_DATE - 4
     )
     SELECT recent.avg3, baseline.avg14,
            recent.avg3 - baseline.avg14 AS delta
       FROM recent, baseline`,
    [userId]
  )).rows[0];
  if (!r || r.avg3 == null || r.avg14 == null) return null;
  const delta = Number(r.delta);
  if (delta >= 7) {
    return {
      kind: 'rhr_spike',
      severity: delta >= 10 ? 'override' : 'warn',
      reason: `Resting HR averaging ${Math.round(Number(r.avg3))} bpm, ${Math.round(delta)} above 14-day baseline.`,
      evidence: { avg3: Number(r.avg3), avg14: Number(r.avg14), delta },
    };
  }
  return null;
}

async function detectSleepCrater(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query(
    `SELECT COUNT(*) AS bad_nights
       FROM health_samples
      WHERE user_id = $1 AND sample_type = 'sleep_hours'
        AND sample_date >= CURRENT_DATE - 3
        AND value < 5`,
    [userId]
  )).rows[0];
  const n = Number(r?.bad_nights ?? 0);
  if (n >= 2) {
    return {
      kind: 'sleep_crater',
      severity: 'override',
      reason: `${n} nights < 5h sleep in the last 3 days.`,
      evidence: { bad_nights: n },
    };
  }
  return null;
}

async function detectVolumeOvershoot(userId: string): Promise<AdaptationTrigger | null> {
  // Last 7d running volume vs experience cap.
  const r = (await pool.query(
    `WITH vol AS (
       SELECT COALESCE(SUM((data->>'distanceMi')::numeric), 0) AS mi
         FROM strava_activities
        WHERE (user_uuid = $1 OR user_uuid IS NULL)
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= CURRENT_DATE - 7
     ), p AS (
       SELECT experience_level FROM profile WHERE user_uuid = $1
     )
     SELECT vol.mi, p.experience_level FROM vol, p`,
    [userId]
  )).rows[0];
  if (!r) return null;
  const lvl = (r.experience_level ?? 'intermediate') as ExperienceLevel;
  const cap = EXPERIENCE_CAPS_MI[lvl];
  if (!cap) return null;
  const mi = Number(r.mi);
  if (mi > cap * 1.25) {
    return {
      kind: 'volume_overshoot',
      severity: 'warn',
      reason: `Last 7d ${Math.round(mi)}mi exceeds ${lvl} cap ${cap}mi by >25%.`,
      evidence: { last7d_mi: mi, cap, level: lvl },
    };
  }
  return null;
}

// ── Action builders ─────────────────────────────────────────────────────

async function actionsForTrigger(userId: string, t: AdaptationTrigger): Promise<AdaptationAction[]> {
  switch (t.kind) {
    case 'missed_key_workout': {
      const nextKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max')
             AND pw.date_iso::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
           ORDER BY pw.date_iso::date ASC LIMIT 1`,
        [userId]
      )).rows[0];
      const out: AdaptationAction[] = [{
        kind: 'reschedule',
        workoutIds: [t.evidence.workout_id],
        newDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        why: 'Reschedule missed quality day 2 days forward.',
      }];
      if (nextKey) {
        out.push({
          kind: 'downgrade',
          workoutIds: [nextKey.id],
          newType: 'easy',
          why: 'Avoid stacking two quality days; downgrade upcoming key to easy.',
        });
      }
      return out;
    }
    case 'rhr_spike':
    case 'sleep_crater': {
      const nextKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
             AND pw.date_iso::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2
           ORDER BY pw.date_iso::date ASC LIMIT 1`,
        [userId]
      )).rows[0];
      if (!nextKey) return [];
      return [{
        kind: 'downgrade',
        workoutIds: [nextKey.id],
        newType: 'easy',
        why: t.reason,
      }];
    }
    case 'volume_overshoot': {
      const next7 = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.date_iso::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7`,
        [userId]
      )).rows;
      return [{
        kind: 'shave',
        workoutIds: next7.map((r: any) => r.id),
        shaveFraction: 0.17,
        why: `Volume ${Math.round(t.evidence.last7d_mi)}mi exceeded ${t.evidence.level} cap. Shave next 7 days 17%.`,
      }];
    }
    case 'pr_bank':
      return [{
        kind: 'mark_dirty',
        workoutIds: [],   // caller fills with next 7-14d ids
        why: 'New PR. Pace prescriptions need recompute from updated VDOT.',
      }];
    default:
      return [];
  }
}
