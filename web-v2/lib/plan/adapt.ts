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
 *      Cite: Research/00a-distance-running-training.md §missed-workout-policy
 *
 *   2. RHR_SPIKE — 3-day avg RHR > 7 bpm above 14-day baseline.
 *      → Convert next quality day to easy; flag readiness.
 *      Cite: Research/15-wearable-data.md §RHR-Recovery-Indicators
 *
 *   3. SLEEP_CRATER — 2+ nights < 5h.
 *      → Convert next quality day to easy.
 *      Cite: Research/00b-recovery-protocols.md §sleep-as-recovery
 *
 *   4. VOLUME_OVERSHOOT — last 7d running volume > 25% above current
 *      experience-level cap (P33).
 *      → Shave next 7d by 15-20% (proportional).
 *      Cite: Research/00a-distance-running-training.md §progressive-overload (ACWR + 10% rule)
 *
 *   5. PR_BANK — recent race finish that implies VDOT jump > 1.5 pts.
 *      → Recompute paces; mark plan_workouts as needing prescription refresh.
 *      Cite: Research/01-pace-zones-vdot.md §VDOT-recalibrate
 *
 * Output: array of `AdaptationAction`s. The caller applies them in
 * a single DB transaction, then bumps the plan's `last_adapted_at` so
 * the coach can see when the plan changed.
 */
import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import type { ExperienceLevel } from '@/lib/coach/profile-state';
import { logSealSkip } from './seal';

/**
 * 2026-06-03 · Rule 15 · seal guard for adapter writes.
 *
 * Given a list of plan_workouts IDs, returns the subset whose dates
 * are NOT sealed (no completed run for that date). Sealed IDs are
 * filtered out with a [plan/seal] log line.
 *
 * Used by every UPDATE path in applyAdaptations so the adapter can't
 * retroactively change what the runner was prescribed for a day they
 * already ran. Cite: designs/briefs/backend-rule-completed-days-immutable-2026-06-02.md
 */
async function filterUnsealedWorkouts(
  client: { query: typeof pool.query },
  userUuid: string,
  workoutIds: string[],
  source: string,
): Promise<string[]> {
  if (workoutIds.length === 0) return [];
  // Join workouts to runs by date · row is sealed if a non-merged
  // run row exists for the same date.
  const r = await client.query<{ id: string; sealed: boolean; date_iso: string }>(
    `SELECT pw.id::text AS id, pw.date_iso::text,
            EXISTS (
              SELECT 1 FROM runs r
               WHERE r.user_uuid = $1::uuid
                 AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal',10))::date = pw.date_iso::date
                 AND NOT (r.data ? 'mergedIntoId')
            ) AS sealed
       FROM plan_workouts pw
      WHERE pw.id = ANY($2::text[])`,
    [userUuid, workoutIds],
  ).catch(() => ({ rows: [] as Array<{ id: string; sealed: boolean; date_iso: string }> }));
  const unsealed: string[] = [];
  for (const row of r.rows) {
    if (row.sealed) {
      logSealSkip(source, userUuid, row.date_iso);
    } else {
      unsealed.push(row.id);
    }
  }
  return unsealed;
}

export type AdaptationTriggerKind =
  | 'missed_key_workout'
  | 'rhr_spike'           // retained for back-compat · NOT fired anymore (see readiness_pullback)
  | 'sleep_crater'        // retained for back-compat · NOT fired anymore (see readiness_pullback)
  | 'readiness_pullback'  // 2026-06-01 · multi-signal · supersedes the two above
  | 'volume_overshoot'
  | 'pr_bank'
  | 'niggle_reported'     // Q-04 · active niggle severity threshold
  | 'sick_episode_active' // Q-03 · active illness · propose, never auto
  | 'injury_active'       // Q-08 · active runner_injuries row · propose
  | 'goal_changed';       // runner edited goal time → mark paces stale

export interface AdaptationTrigger {
  kind: AdaptationTriggerKind;
  severity: 'info' | 'warn' | 'override';
  reason: string;             // human-readable; surfaces in coach prose
  evidence: Record<string, any>;
}

export interface AdaptationAction {
  kind: 'reschedule' | 'downgrade' | 'shave' | 'recompute_paces' | 'mark_dirty' | 'mark_upgrade';
  workoutIds?: string[];      // plan_workouts.id targeted
  newType?: string;
  newDate?: string;
  shaveFraction?: number;     // e.g. 0.15 = 15% off the volume
  /** 2026-06-03 · mark_upgrade · per-row distance bumps from adaptive
   *  ramp. Each entry sets plan_workouts.distance_mi = newDistanceMi,
   *  with a SQL guard ensuring distance never decreases (only bumps
   *  UP). Long bump capped at +1mi · weekly total capped at +5mi. */
  bumps?: Array<{ workoutId: string; newDistanceMi: number }>;
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

  // 2. Readiness pullback · multi-signal composite (Research/15 + /00b).
  //    Replaces the single-signal RHR + sleep detectors below as of
  //    2026-06-01 · David's feedback: "I want it to read all the
  //    information it needs. I don't know about a number Sunday at
  //    5:50 AM making a call for Tuesday." Now reads the readiness
  //    brief (5 pillars · Plews HRV · 3-day streak persistence ·
  //    composite score) AND acts only on TODAY's workout.
  const readinessPullback = await detectReadinessPullback(userId);
  if (readinessPullback) triggers.push(readinessPullback);

  // OLD detectors retained as dead code (function bodies kept for
  // reference) but NOT pushed to triggers. Removing entirely would
  // break test fixtures + tracked-issue analytics; the union type
  // still includes the kinds so prior coach_intents rows resolve.

  // 4. Volume overshoot
  const overshoot = await detectVolumeOvershoot(userId);
  if (overshoot) triggers.push(overshoot);

  // 5. Niggle reported (Q-04 default: graduated severity response)
  const niggle = await detectNiggleReported(userId);
  if (niggle) triggers.push(niggle);

  // 6. Sick episode active (Q-03 default: propose, don't auto-modify)
  const sick = await detectSickEpisodeActive(userId);
  if (sick) triggers.push(sick);

  // 7. Active injury (Q-08 default: propose INJURY-mode adjustments)
  const injury = await detectInjuryActive(userId);
  if (injury) triggers.push(injury);

  // 8. PR_BANK · new race finish that implies VDOT jump > 1.5 pts
  const prBank = await detectPrBank(userId);
  if (prBank) triggers.push(prBank);

  // 9. GOAL_CHANGED · runner accepted adaptive-VDOT bump (manual override)
  //    OR edited their goal_race_time. Both signal "paces need re-derive".
  const goalChanged = await detectGoalChanged(userId);
  if (goalChanged) triggers.push(goalChanged);

  const actions: AdaptationAction[] = [];
  for (const t of triggers) {
    actions.push(...await actionsForTrigger(userId, t));
  }

  return { triggers, actions, applied: false };
}

/** Apply the actions to plan_workouts in a single transaction.
 *
 *  P1 #8 (2026-05-30): also writes a coach_intents row per applied action
 *  so the closed-loop history exists — every readiness/volume-driven plan
 *  mutation is recorded with its trigger reason. The next briefing voice
 *  reads pending intents (acknowledged_at IS NULL) so the coach can
 *  acknowledge the change once and move on.
 */
export async function applyAdaptations(userId: string, actions: AdaptationAction[]): Promise<number> {
  if (actions.length === 0) return 0;
  let touched = 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of actions) {
      // Map action kind → coach_intents reason. Prefix with plan_adapt_
      // so the briefing voice can detect any prescription-mutation row by
      // a single string-prefix scan in the LLM context.
      const reason =
        a.kind === 'reschedule' ? 'plan_adapt_reschedule'
        : a.kind === 'downgrade' ? 'plan_adapt_downgrade'
        : a.kind === 'shave'     ? 'plan_adapt_shave'
        : a.kind === 'mark_dirty' ? 'plan_adapt_mark_dirty'
        : a.kind === 'mark_upgrade' ? 'plan_adapt_upgrade'
        : 'plan_adapt_other';

      // 2026-06-03 · Rule 15 · filter sealed (completed-day) workouts
      // out of every action before iterating · the adapter cannot
      // retroactively change what was prescribed for a day the runner
      // already ran. Cite: §Rule 15.
      const wids = a.workoutIds ?? a.bumps?.map((b) => b.workoutId) ?? [];
      const unsealedIds = await filterUnsealedWorkouts(client, userId, wids, `adapt/${a.kind}`);
      const unsealedSet = new Set(unsealedIds);

      if (a.kind === 'reschedule' && a.newDate && a.workoutIds) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          await client.query(
            `UPDATE plan_workouts SET date_iso = $1 WHERE id = $2`,
            [a.newDate, wid]
          );
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, newDate: a.newDate, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'downgrade' && a.newType && a.workoutIds) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          // 2026-06-01 · type is source of truth (web agent brief
          // plan-type-column-alignment-brief.md · Option A). When we
          // downgrade a quality workout to easy/recovery/rest, we MUST
          // clear the trailing fields too · otherwise the row reads
          // "type=easy but sub_label='Cruise Intervals' + pace=T-pace
          // + is_quality=true" and every downstream consumer (chip
          // color, hero gradient, strength placement, coach mode
          // resolver) gets contradictory signals.
          //
          // Coherent downgrade · clear sub_label · clear pace target ·
          // set is_quality=false (easy/recovery/rest are never quality)
          // · clear is_long if downgrading FROM long.
          const newType = a.newType;
          const clearsQuality = ['easy', 'recovery', 'rest'].includes(newType);
          if (clearsQuality) {
            // 2026-06-03 · iPhone agent Tier 3.e brief · write a NEW
            // spec for the downgraded type instead of NULL. The
            // expandSpecToPhases() helper needs SOMETHING to work
            // with; NULL forces the prescriptionFor() fallback path
            // and re-fragments the read pipeline.
            //
            // Easy + recovery share a minimal shape (kind only · the
            // expander's easyPaceFallback fills in pace from runner
            // history at read time). Rest gets null spec since rest
            // days don't expand to phases.
            const newSpec = newType === 'rest'
              ? null
              : { kind: newType };  // easy or recovery
            await client.query(
              `UPDATE plan_workouts
                  SET type = $1,
                      original_sub_label = COALESCE(original_sub_label, sub_label),
                      sub_label = $3,
                      pace_target_s_per_mi = NULL,
                      is_quality = false,
                      is_long = (CASE WHEN $1 = 'long' THEN is_long ELSE false END),
                      workout_spec = $4::jsonb
                WHERE id = $2`,
              [
                newType,
                wid,
                newType === 'rest' ? 'REST' : newType.toUpperCase(),
                newSpec ? JSON.stringify(newSpec) : null,
              ]
            );
          } else {
            // Lateral move between quality kinds (rare · e.g. threshold
            // → tempo) · just update type, leave the rest.
            await client.query(
              `UPDATE plan_workouts SET type = $1 WHERE id = $2`,
              [newType, wid]
            );
          }
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, newType: a.newType, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'shave' && a.workoutIds && a.shaveFraction) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          // 2026-06-01 · round to nearest 0.5 mi instead of 1-decimal.
          // ROUND(x, 1) produced 5.8 / 4.2 type values that read as
          // arbitrary noise · runners think in half-mile increments.
          // Multiply by 2, round to integer, divide by 2 = snap to
          // 0.5. Skip the shave entirely if it would produce 0 (a
          // 0.4mi shake-out becomes 0.0 after a 17% shave · keep it).
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = GREATEST(
                  0.5,
                  ROUND((distance_mi * (1 - $1::numeric)) * 2)::numeric / 2
                )
              WHERE id = $2
                AND distance_mi >= 1.0`,
            [a.shaveFraction, wid]
          );
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, shaveFraction: a.shaveFraction, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'mark_upgrade' && a.bumps && a.bumps.length > 0) {
        // 2026-06-03 · adaptive ramp · push UP when signals green.
        // Per David: "if the runner and the weeks are solid, distance
        // up is OK." SQL guard `distance_mi < $1` makes this strictly
        // additive · never accidentally cuts a row.
        for (const b of a.bumps) {
          if (!unsealedSet.has(b.workoutId)) continue;
          await client.query(
            `UPDATE plan_workouts
                SET distance_mi = $1
              WHERE id = $2
                AND distance_mi < $1`,
            [b.newDistanceMi, b.workoutId],
          );
          await writeIntent(client, userId, 'plan_adapt_upgrade', b.workoutId, {
            kind: 'mark_upgrade', newDistanceMi: b.newDistanceMi, why: a.why,
          });
          touched++;
        }
      } else if (a.kind === 'mark_dirty' && a.workoutIds) {
        for (const wid of a.workoutIds) {
          if (!unsealedSet.has(wid)) continue;
          await client.query(
            `UPDATE plan_workouts
                SET notes = COALESCE(notes, '') || ' [paces stale - recompute]'
              WHERE id = $1`,
            [wid]
          );
          await writeIntent(client, userId, reason, wid, {
            kind: a.kind, why: a.why,
          });
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

/** Insert a coach_intents row for the given adaptation action. The next
 *  briefing voice picks this up via the pending-intents index so the
 *  coach can acknowledge the change. Value is JSON-stringified so it
 *  fits the text column without schema change. */
async function writeIntent(
  client: { query: (q: string, p: unknown[]) => Promise<unknown> },
  userId: string,
  reason: string,
  workoutId: string,
  value: Record<string, unknown>,
): Promise<void> {
  try {
    await client.query(
      `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
       VALUES ($1, $1, $2, $3, $4)`,
      [userId, reason, workoutId, JSON.stringify(value)]
    );
  } catch (e: unknown) {
    // Don't roll back the whole adaptation for an intents-log failure;
    // the plan change is more important than the audit row.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[applyAdaptations] writeIntent failed:', msg);
  }
}

// ── Detectors ──────────────────────────────────────────────────────────

async function detectMissedKeyWorkout(userId: string): Promise<AdaptationTrigger | null> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  // Was the last scheduled threshold/intervals NOT completed within ±1d
  // of its plan date?
  const r = (await pool.query(
    `SELECT pw.id, pw.date_iso::date::text AS date, pw.type
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1
        AND tp.archived_iso IS NULL
        AND pw.type IN ('threshold','tempo','intervals','vo2max')
        AND pw.date_iso::date BETWEEN $2::date - 7 AND $2::date - 1
      ORDER BY pw.date_iso::date DESC LIMIT 1`,
    [userId, today]
  )).rows[0];
  if (!r) return null;

  // Was there a run of distance >= 4mi within the ±1d window with a
  // matching workout type heuristic?
  const completed = (await pool.query(
    `SELECT COUNT(*) AS n FROM runs
      WHERE user_uuid = $1
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

/**
 * Multi-signal readiness check via the readiness brief (2026-06-01).
 *
 * Replaces detectRhrSpike + detectSleepCrater + any other single-pillar
 * heuristic. Reads the full brief (5 pillars + Plews HRV + 3-day streak
 * persistence) and fires ONLY when:
 *
 *   · band === 'pull-back' (composite score < 50 · multiple pillars
 *     simultaneously degraded · per Research/15 §interpretation)
 *
 *   OR
 *
 *   · ≥1 active streak (per Research/15 Plews approach · 3-day
 *     persistence is the actionable signal · single-day swings are
 *     noise)
 *
 * Severity ladder:
 *   · 'override' when band='pull-back' OR ≥2 active streaks
 *   · 'warn'      when ≥1 streak only
 *
 * The action handler (see actionsForTrigger) targets only TODAY's
 * workout · never reaches forward 2+ days to decide a future quality
 * day from yesterday's data.
 */
async function detectReadinessPullback(userId: string): Promise<AdaptationTrigger | null> {
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { loadReadinessBrief } = await import('@/lib/coach/readiness-brief');
    const { tierRulesFor, HARD_RULES } = await import('@/lib/coach/tier-rules');
    const state = await loadCoachState(userId);
    if (!state) return null;
    const brief = await loadReadinessBrief(userId, state);
    if (!brief) return null;

    // 2026-06-03 · tier-aware thresholds. Same rules as the Health
    // page WHAT TO DO panel (lib/coach/health-actions.ts) · plan and
    // panel must agree. Per David: "I think the plan adjustments and
    // flags should be dependent on the level of the runner. So
    // advanced maybe let the runner push through things more?"
    //
    // Advanced runners require:
    //   · sustained pull-back (3+ consecutive days < 40), OR
    //   · streak ≥ 5 days, OR
    //   · 2+ simultaneous streaks ≥ 5 days each
    // Beginners/intermediate: 2+ days pull-back OR streak ≥ 3 days.
    //
    // HARD RULES (always fire regardless of tier):
    //   · 7-day sustained pull-back · trumps any tier setting
    //   · We don't gate the streak detector itself · it still emits
    //     3-day streaks for the streaks panel. Just the plan-adjust
    //     trigger waits for the tier threshold before downgrading.
    const tier = state.profile?.experience_level ?? null;
    const rules = tierRulesFor(tier);

    const streaks = brief.streaks ?? [];
    const scoreTrend = brief.scoreTrend ?? [];
    const recentScores = scoreTrend.slice(-rules.pullbackConsecutiveDays).map((s) => s.score);
    const sustainedPullBack = recentScores.length >= rules.pullbackConsecutiveDays
      && recentScores.every((s) => s < 40);

    // 7-day hard rule · pull-back sustained that long forces an
    // adaptation regardless of tier.
    const last7Scores = scoreTrend.slice(-HARD_RULES.pullbackForcedAck).map((s) => s.score);
    const forcedByHardRule = last7Scores.length === HARD_RULES.pullbackForcedAck
      && last7Scores.every((s) => s < 40);

    // Streaks gated by tier minimum AND by pillar.
    //
    // 2026-06-04 · SLEEP streaks excluded from plan-adapt triggers
    // (David's "why did my plan change in the middle of the night???").
    // Sleep is a BEHAVIORAL lever the runner controls · short sleep
    // weeks are life, not fitness drift. Plan adapts to what the body
    // shows in response to TRAINING (HRV / RHR / hr_recovery / load),
    // not to lifestyle inputs. Sleep still surfaces in the streaks
    // panel + WHAT TO DO actions (where it's a behavioral nudge, not
    // an auto-downgrade trigger).
    //
    // The bar for "plan should change" is objective body response,
    // not behavioral input. A runner sleeping poorly for a week
    // doesn't need their quality session moved · they need a heads-up
    // about the sleep itself. Their body will tell us via HRV/RHR if
    // it's actually compromising training.
    const adapterRelevantPillars = new Set(['hrv', 'rhr', 'hr_recovery', 'load']);
    const tierStreaks = streaks.filter((s) =>
      s.days >= rules.streakDaysMin && adapterRelevantPillars.has(s.pillar)
    );
    const hasTieredStreak = tierStreaks.length > 0;

    if (!sustainedPullBack && !hasTieredStreak && !forcedByHardRule) return null;

    // Reason · what TRULY tripped, in plain English.
    const reasonParts: string[] = [];
    if (tierStreaks.length > 0) {
      const s = tierStreaks[0];
      reasonParts.push(`${s.pillar.toUpperCase()} ${s.direction} ${s.days} days running`);
    }
    if (forcedByHardRule) {
      reasonParts.push(`pull-back band sustained ${HARD_RULES.pullbackForcedAck} days (hard rule)`);
    } else if (sustainedPullBack) {
      reasonParts.push(`pull-back band sustained ${recentScores.length} days · score ${brief.score}/100`);
    }

    // Severity ladder: hard-rule sustained pull-back OR 2+ tier-streaks → override.
    // Single tier-streak OR shorter sustained pull-back → warn (softer adjust).
    const severity: 'warn' | 'override' = (forcedByHardRule || tierStreaks.length >= 2 || (sustainedPullBack && tierStreaks.length >= 1))
      ? 'override'
      : 'warn';

    return {
      kind: 'readiness_pullback',
      severity,
      reason: `Readiness pullback · ${reasonParts.join(' + ')}.`,
      evidence: {
        score: brief.score,
        band: brief.band,
        tier: tier ?? 'intermediate',
        streaks: tierStreaks.map((s) => ({ pillar: s.pillar, direction: s.direction, days: s.days })),
        sustainedPullBackDays: sustainedPullBack ? recentScores.length : 0,
        forcedByHardRule,
        headline: brief.headline,
      },
    };
  } catch (e) {
    console.warn('[adapt] detectReadinessPullback failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function detectRhrSpike(userId: string): Promise<AdaptationTrigger | null> {
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  const r = (await pool.query(
    `WITH recent AS (
       SELECT AVG(value) AS avg3 FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND sample_date >= $2::date - 3
     ), baseline AS (
       SELECT AVG(value) AS avg14 FROM health_samples
        WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'resting_hr'
          AND sample_date BETWEEN $2::date - 17 AND $2::date - 4
     )
     SELECT recent.avg3, baseline.avg14,
            recent.avg3 - baseline.avg14 AS delta
       FROM recent, baseline`,
    [userId, today]
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
  // 2026-06-03 · runner TZ.
  const today = await runnerToday(userId);
  const r = (await pool.query(
    `SELECT COUNT(*) AS bad_nights
       FROM health_samples
      WHERE COALESCE(user_uuid, user_id) = $1 AND sample_type = 'sleep_hours'
        AND sample_date >= $2::date - 3
        AND value < 5`,
    [userId, today]
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

/**
 * Q-04 default · NIGGLE_REPORTED triggers when an active niggle (cleared_at
 * IS NULL) crosses severity thresholds. Graduated response per
 * Research/05-injury-return-protocols.md §Pain-Stop-Rules:
 *   - severity 5-6 → 'warn' · downgrade next quality day to easy
 *   - severity ≥ 7 → 'override' · suspend running for ~48h
 *
 * Cite: Research/05-injury-return-protocols.md §Pain-Stop-Rules (5/10
 *       interrupts the planned session; 7/10 rests the area).
 */
async function detectNiggleReported(userId: string): Promise<AdaptationTrigger | null> {
  // Post-126: niggles uses canonical user_uuid. user_id (also uuid) kept
  // for backward compat — COALESCE so unbackfilled rows still match.
  const r = (await pool.query(
    `SELECT id, body_part, side, severity, status, logged_at::text AS logged_at
       FROM niggles
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY severity DESC, logged_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const severity = Number(r.severity);
  if (severity < 5) return null;
  return {
    kind: 'niggle_reported',
    severity: severity >= 7 ? 'override' : 'warn',
    reason: severity >= 7
      ? `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Suspend running 48h.`
      : `Active ${r.body_part}${r.side ? ' (' + r.side + ')' : ''} niggle at ${severity}/10. Downgrade next quality day.`,
    evidence: { niggle_id: r.id, body_part: r.body_part, side: r.side, severity, status: r.status },
  };
}

/**
 * Q-03 default · SICK_EPISODE_ACTIVE triggers when sick_episodes.cleared_at
 * IS NULL. By doctrine we DO NOT auto-modify the plan for illness — runner
 * agency matters. The trigger fires; actionsForTrigger writes a
 * coach_proposals row that the runner accepts/rejects from the UI.
 *
 * Cite: Research/05-injury-return-protocols.md §illness-return (above-the-
 *       neck cold = run easy; below-the-neck OR fever = no running).
 */
async function detectSickEpisodeActive(userId: string): Promise<AdaptationTrigger | null> {
  // Post-126: sick_episodes uses canonical user_uuid.
  const r = (await pool.query(
    `SELECT id, symptoms, has_fever, started, logged_at::text AS logged_at
       FROM sick_episodes
      WHERE COALESCE(user_uuid, user_id) = $1 AND cleared_at IS NULL
      ORDER BY logged_at DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  return {
    kind: 'sick_episode_active',
    severity: r.has_fever ? 'override' : 'warn',
    reason: r.has_fever
      ? 'Active illness with fever. Suspend running entirely until cleared.'
      : 'Active illness reported. Above-the-neck symptoms: easy running only.',
    evidence: {
      episode_id: r.id,
      has_fever: !!r.has_fever,
      symptoms: r.symptoms,
      started: r.started,
    },
  };
}

/**
 * Q-08 default · INJURY_ACTIVE triggers when `runner_injuries.resolved_date
 * IS NULL`. Like SICK_EPISODE_ACTIVE, this is a propose-only trigger —
 * the runner accepts/rejects the modified plan from the UI. Severity:
 * 'override' if severity in (moderate, major); 'warn' if 'minor'.
 *
 * Cite: Research/05-injury-return-protocols.md §General-Principles
 *       (pain ≥ 5/10 stops the session; structured return phases).
 */
async function detectInjuryActive(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query(
    `SELECT id, site, severity, return_protocol, start_date::text AS start_date
       FROM runner_injuries
      WHERE user_uuid = $1 AND resolved_date IS NULL
      ORDER BY start_date DESC LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;
  const severe = r.severity === 'moderate' || r.severity === 'major';
  return {
    kind: 'injury_active',
    severity: severe ? 'override' : 'warn',
    reason: severe
      ? `Active ${r.site} injury (${r.severity}). Switch to INJURY-mode walk-run + cross-train.`
      : `Active ${r.site} injury (minor). Drop quality; easy mileage only with daily pain check.`,
    evidence: {
      injury_id: r.id,
      site: r.site,
      severity: r.severity,
      return_protocol: r.return_protocol,
      start_date: r.start_date,
    },
  };
}

/**
 * GOAL_CHANGED · runner edited their goal time OR accepted an adaptive-
 * VDOT bump (vdot_manual_override set). Either way, the active plan's
 * pace targets were derived from old numbers and need recompute.
 *
 * Detection:
 *   - users.vdot_manual_override_at within last 24h, OR
 *   - profile.goal_race_time changed within last 24h (we don't track
 *     change history, so we approximate via profile.updated_at vs the
 *     active plan's authored_iso — if profile was edited AFTER the plan
 *     was authored, the goal likely changed since)
 *
 * Action: mark next 14d plan_workouts as paces-stale (same as PR_BANK).
 *
 * Cite: Research/01-pace-zones-vdot.md §VDOT-recalibrate (pace derivation
 *       from goal time / VDOT changes invalidate prior prescriptions).
 */
async function detectGoalChanged(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query<{
    vdot_override_at: string | null;
    profile_updated_at: string | null;
    plan_authored_at: string | null;
  }>(
    `SELECT u.vdot_manual_override_at::text AS vdot_override_at,
            p.updated_at::text             AS profile_updated_at,
            tp.authored_iso::text          AS plan_authored_at
       FROM users u
       LEFT JOIN profile p ON p.user_uuid = u.id
       LEFT JOIN training_plans tp
              ON tp.user_uuid = u.id AND tp.archived_iso IS NULL
      WHERE u.id = $1
      LIMIT 1`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r) return null;

  const now = Date.now();
  const vdotOverrideAt = r.vdot_override_at ? Date.parse(r.vdot_override_at) : 0;
  const profileUpdatedAt = r.profile_updated_at ? Date.parse(r.profile_updated_at) : 0;
  const planAuthoredAt = r.plan_authored_at ? Date.parse(r.plan_authored_at) : 0;

  const vdotChangedRecent = vdotOverrideAt > 0 && (now - vdotOverrideAt) < 24 * 3600 * 1000;
  const profileChangedAfterPlan = profileUpdatedAt > planAuthoredAt && (now - profileUpdatedAt) < 24 * 3600 * 1000;

  if (!vdotChangedRecent && !profileChangedAfterPlan) return null;

  return {
    kind: 'goal_changed',
    severity: 'info',
    reason: vdotChangedRecent
      ? 'VDOT override applied. Plan paces derive from old VDOT; recompute next 14d.'
      : 'Profile updated after plan authored. Plan paces may be stale.',
    evidence: {
      vdot_override_at: r.vdot_override_at,
      profile_updated_at: r.profile_updated_at,
      plan_authored_at: r.plan_authored_at,
    },
  };
}

/**
 * PR_BANK · recent race finish whose VDOT exceeds users.vdot_last_reviewed
 * by > 1.5 pts. Action: mark next 14d plan_workouts as paces-stale so the
 * runner's prescription gets recomputed off the new VDOT before the next
 * quality session. Cite: Research/01-pace-zones-vdot.md §VDOT-recalibrate.
 */
async function detectPrBank(userId: string): Promise<AdaptationTrigger | null> {
  const r = (await pool.query<{
    new_vdot: number | null;
    old_vdot: number | null;
    slug: string | null;
    raced_at: string | null;
  }>(
    `WITH last_review AS (
       SELECT vdot_last_reviewed::numeric AS old_vdot FROM users WHERE id = $1
     )
     SELECT u.old_vdot
       FROM last_review u`,
    [userId],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (!r || r.old_vdot == null) return null;

  // Find races in last 14d, A/B priority, with a finishS — derive VDOT
  // and compare to old_vdot.
  const recent = (await pool.query<{
    slug: string;
    date: string;
    distance_mi: string | null;
    finish_s: string | null;
  }>(
    `SELECT slug,
            meta->>'date' AS date,
            (meta->>'distanceMi')::numeric::text AS distance_mi,
            actual_result->>'finishS' AS finish_s
       FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' IN ('A','B')
        AND (meta->>'date')::date >= $2::date - 14
        AND (meta->>'date')::date < $2::date
        AND actual_result->>'finishS' IS NOT NULL
      ORDER BY (meta->>'date') DESC LIMIT 3`,
    [userId, await runnerToday(userId)],
  ).catch(() => ({ rows: [] }))).rows;
  if (recent.length === 0) return null;

  // Lazy-import vdotFromRace; same file group, no cycle.
  const { vdotFromRace } = await import('../training/vdot');
  let bestNewVdot = 0;
  let bestSlug = '';
  let bestDate = '';
  for (const raceRow of recent) {
    const fs = raceRow.finish_s ? Number(raceRow.finish_s) : 0;
    const mi = raceRow.distance_mi ? Number(raceRow.distance_mi) : 0;
    const v = fs > 0 && mi > 0 ? vdotFromRace(fs, mi) : null;
    if (v != null && v > bestNewVdot) {
      bestNewVdot = v;
      bestSlug = raceRow.slug;
      bestDate = raceRow.date;
    }
  }
  const oldVdot = Number(r.old_vdot);
  const delta = bestNewVdot - oldVdot;
  if (delta <= 1.5) return null;
  return {
    kind: 'pr_bank',
    severity: 'info',
    reason: `New race fitness · VDOT ${bestNewVdot.toFixed(1)} vs prior ${oldVdot.toFixed(1)} (+${delta.toFixed(1)}). Paces need recompute.`,
    evidence: {
      new_vdot: bestNewVdot,
      old_vdot: oldVdot,
      delta,
      race_slug: bestSlug,
      raced_at: bestDate,
    },
  };
}

async function detectVolumeOvershoot(userId: string): Promise<AdaptationTrigger | null> {
  // Last 7d running volume vs experience cap.
  // 2026-06-02 · smart-dedup at 0.1 mi (was MAX-per-day · undercounted
  // legit same-day doubles). See lib/runs/volume.ts for the rule.
  const r = (await pool.query(
    `WITH dedup AS (
       SELECT (data->>'date')::date AS d,
              ROUND((data->>'distanceMi')::numeric, 1) AS bucket,
              MAX((data->>'distanceMi')::numeric) AS mi
         FROM runs
        WHERE user_uuid = $1
          AND NOT (data ? 'mergedIntoId')
          AND (data->>'date')::date >= $2::date - 7
        GROUP BY 1, 2
     ), vol AS (
       SELECT COALESCE(SUM(mi), 0) AS mi FROM dedup
     ), p AS (
       SELECT experience_level FROM profile WHERE user_uuid = $1
     )
     SELECT vol.mi, p.experience_level FROM vol, p`,
    [userId, await runnerToday(userId)]
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
  // 2026-06-03 · runner TZ used by every case below.
  const today = await runnerToday(userId);
  switch (t.kind) {
    case 'missed_key_workout': {
      const nextKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max')
             AND pw.date_iso::date BETWEEN $2::date AND $2::date + 7
           ORDER BY pw.date_iso::date ASC LIMIT 1`,
        [userId, today]
      )).rows[0];
      // Reschedule date · runner-TZ today + 2 days · matches the BETWEEN
      // window above so the rescheduled key lands inside the search window.
      const rescheduledDate = new Date(Date.parse(today + 'T12:00:00Z') + 2 * 86400000)
        .toISOString().slice(0, 10);
      const out: AdaptationAction[] = [{
        kind: 'reschedule',
        workoutIds: [t.evidence.workout_id],
        newDate: rescheduledDate,
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
    case 'readiness_pullback': {
      // 2026-06-01 · just-in-time window. Only act on TODAY's workout.
      // The runner has another 24-72h to recover before any future
      // quality day · don't pre-emptively flatten Tuesday from Sunday's
      // data. If today's signals are still bad tomorrow, tomorrow's
      // adapter run sees that and acts on tomorrow.
      //
      // Doctrine · David, 2026-06-01: "I don't know about a number
      // Sunday at 5:50 AM making a call for Tuesday. That doesn't
      // seem right." Right · just-in-time decisions only, and only
      // when the multi-signal brief says so (not a single RHR spike).
      const todayKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
             AND pw.date_iso = $2::text
           LIMIT 1`,
        [userId, today]
      )).rows[0];
      if (!todayKey) return [];
      return [{
        kind: 'downgrade',
        workoutIds: [todayKey.id],
        newType: 'easy',
        why: t.reason,
      }];
    }
    case 'rhr_spike':
    case 'sleep_crater': {
      // DEPRECATED · these trigger kinds are no longer emitted by
      // detectAdaptations (2026-06-01 · superseded by readiness_pullback).
      // Case retained so any in-flight coach_intents rows from the old
      // path still resolve cleanly. If somehow re-emitted, applies the
      // SAME just-in-time window as readiness_pullback.
      const todayKey = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.type IN ('threshold','tempo','intervals','vo2max','long')
             AND pw.date_iso = $2::text
           LIMIT 1`,
        [userId, today]
      )).rows[0];
      if (!todayKey) return [];
      return [{
        kind: 'downgrade',
        workoutIds: [todayKey.id],
        newType: 'easy',
        why: t.reason,
      }];
    }
    case 'volume_overshoot': {
      const next7 = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.date_iso::date BETWEEN $2::date AND $2::date + 7`,
        [userId, today]
      )).rows;
      return [{
        kind: 'shave',
        workoutIds: next7.map((r: any) => r.id),
        shaveFraction: 0.17,
        why: `Volume ${Math.round(t.evidence.last7d_mi)}mi exceeded ${t.evidence.level} cap. Shave next 7 days 17%.`,
      }];
    }
    case 'pr_bank':
    case 'goal_changed': {
      // Both signals say "paces stale; recompute". Mark next 14d
      // plan_workouts so the briefing surface re-derives pace targets
      // from the new VDOT / new goal.
      const rows = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
             AND pw.date_iso::date BETWEEN $2::date AND $2::date + 14
           ORDER BY pw.date_iso::date ASC`,
        [userId, today]
      )).rows;
      if (rows.length === 0) return [];
      const why = t.kind === 'pr_bank'
        ? `New race fitness · VDOT +${Number(t.evidence.delta).toFixed(1)} pts. Paces need recompute.`
        : 'Goal or VDOT changed. Plan paces need recompute against new target.';
      return [{
        kind: 'mark_dirty',
        workoutIds: rows.map((r: any) => r.id),
        why,
      }];
    }
    case 'niggle_reported': {
      // Q-04 default. ≥7/10 → 48h suspension (downgrade next 2d to rest);
      // 5-6/10 → downgrade next quality day to easy.
      const severity = Number(t.evidence.severity ?? 0);
      // 2026-06-03 · runner TZ via $2::date · was inline CURRENT_DATE which
      // shifted at server-UTC midnight. The horizon ternary still selects
      // 2 days (preserving existing behavior; bug-for-bug per the original).
      const where = severity >= 7
        ? `pw.date_iso::date BETWEEN $2::date AND $2::date + 2`
        : `pw.type IN ('threshold','tempo','intervals','vo2max','long')
            AND pw.date_iso::date BETWEEN $2::date AND $2::date + 2`;
      const rows = (await pool.query(
        `SELECT pw.id FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL AND ${where}
           ORDER BY pw.date_iso::date ASC`,
        [userId, today]
      )).rows;
      if (rows.length === 0) return [];
      return [{
        kind: 'downgrade',
        workoutIds: rows.map((r: any) => r.id),
        newType: severity >= 7 ? 'rest' : 'easy',
        why: t.reason,
      }];
    }
    case 'sick_episode_active': {
      // Q-03 default — propose, never auto-modify. Writes a coach_proposals
      // row that the runner accepts/rejects from the UI. Returns no actions
      // so applyAdaptations doesn't mutate plan_workouts.
      try {
        await pool.query(
          `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
           VALUES ($1, $1::text, 'illness_adjust', $2::jsonb, 'pending', NOW())
           ON CONFLICT DO NOTHING`,
          [userId, JSON.stringify({
            reason: t.reason,
            evidence: t.evidence,
            suggested:
              t.severity === 'override'
                ? 'Suspend all running until cleared. Cross-train if symptoms allow.'
                : 'Drop all quality. Run easy for 3-5 days; reassess.',
          })],
        );
      } catch {
        // Proposal write failure is non-fatal; runner still sees the
        // niggle/sick UI surface even without a proposal row.
      }
      return [];
    }
    case 'injury_active': {
      // Q-08 default — same propose-only pattern as illness. Walk-run +
      // cross-train suggestion comes from Research/05; the runner
      // accepts in the UI.
      try {
        await pool.query(
          `INSERT INTO coach_proposals (user_uuid, user_id, proposal_type, payload, status, created_at)
           VALUES ($1, $1::text, 'injury_adjust', $2::jsonb, 'pending', NOW())
           ON CONFLICT DO NOTHING`,
          [userId, JSON.stringify({
            reason: t.reason,
            evidence: t.evidence,
            suggested:
              t.severity === 'override'
                ? 'Walk-run scaffold + cross-train. Pain-monitor in-session, 24h, location. Suspend running ≥ 5/10 pain.'
                : 'Easy mileage only; daily pain check before each session. Drop quality. Reassess after 7 days.',
          })],
        );
      } catch {
        // Non-fatal — runner still sees the injury UI surface.
      }
      return [];
    }
    default:
      return [];
  }
}
