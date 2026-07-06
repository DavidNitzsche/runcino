/**
 * lib/plan/auto-rebuild.ts · auto-apply plan rebuilds for unambiguous
 * runner-driven changes.
 *
 * Four trigger conditions, all hooked from route handlers (NOT cron):
 *
 *   · raceDateChanged   · runner moves the goal-race date
 *   · goalTimeChanged   · runner edits the A-race goal time
 *   · aRaceAdded        · new A-priority race created
 *   · aRacePriorityChanged · existing race promoted/demoted from A
 *
 * Each writes an `auto_applied` row to plan_proposals (for audit) and
 * runs generatePlan() if the plan's race_id matches. Idempotent · two
 * rapid edits to the same race don't double-rebuild within 60s.
 *
 * Why auto-apply (no accept gate):
 *   The user already made the underlying change. If they moved their
 *   race from Aug 16 to Aug 23, the plan timeline is OBJECTIVELY wrong
 *   until rebuilt. Asking "want to rebuild?" turns into a chat-shaped
 *   prompt for a decision the runner already made. Just do the work,
 *   log it, surface the result as a notification.
 */

import { pool } from '@/lib/db/pool';
import { generatePlan } from '@/lib/plan/generate';

export type AutoRebuildKind =
  | 'race_date_changed'
  | 'goal_time_changed'
  | 'a_race_added'
  | 'a_race_removed'
  /** 2026-06-03 · graduation · the current target's race day has
   *  passed; we're transitioning to the next A-race. fireAutoRebuild
   *  skips the race_mismatch check in this mode because the active
   *  plan's race_id IS expected to differ (old race). generatePlan
   *  archives the old plan via persistPlan's clearActivePlansFor. */
  | 'race_graduate';

export interface AutoRebuildInput {
  userUuid: string;
  raceSlug: string;
  kind: AutoRebuildKind;
  /** Optional from/to context for the audit row. */
  reasons: Record<string, unknown>;
  /** Source identifier · 'race_hook' / 'goal_hook' / etc. */
  source: string;
}

export interface AutoRebuildResult {
  ok: boolean;
  reason?: string;
  oldPlanId?: string;
  newPlanId?: string;
  proposalId?: number;
}

/**
 * Fire an auto-rebuild for the given user when their plan's race_id
 * matches raceSlug. Returns details for the caller (route handler) to
 * surface to the runner via response payload.
 *
 * Safe to call when NO plan exists · returns `{ok: false, reason: 'no_active_plan'}`
 * without raising.
 *
 * Safe to call against a plan that DOESN'T match raceSlug · returns
 * `{ok: false, reason: 'race_mismatch'}` (the runner may be planning
 * for a different race entirely).
 *
 * De-duplicates · if an auto-applied row for the same (user, race, kind)
 * was written in the last 60 seconds, skips the rebuild and returns
 * the prior proposal_id. Protects against double-firing when a single
 * UI edit triggers two route hits (PATCH + revalidate).
 */
export async function fireAutoRebuild(input: AutoRebuildInput): Promise<AutoRebuildResult> {
  // 1. Find the active plan + verify its race matches
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [input.userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!plan) {
    // No active plan · race_graduate path is OK with this (build fresh).
    if (input.kind !== 'race_graduate') {
      return { ok: false, reason: 'no_active_plan' };
    }
  }
  // 2026-06-03 · race_graduate intentionally crosses race_id boundaries.
  // The active plan is for the OLD race (which just finished); we're
  // building the NEW plan for the next A-race. generatePlan archives
  // the old plan inside persistPlan's clearActivePlansFor.
  if (plan && plan.race_id !== input.raceSlug && input.kind !== 'race_graduate') {
    return { ok: false, reason: 'race_mismatch', oldPlanId: plan.id };
  }

  // 2. De-dupe · skip if same kind/race fired within 60s
  const recent = (await pool.query<{ id: number; new_plan_id: string | null }>(
    `SELECT id, new_plan_id FROM plan_proposals
      WHERE user_uuid = $1
        AND plan_id = $2
        AND proposal_kind = $3
        AND created_at >= NOW() - interval '60 seconds'
      ORDER BY created_at DESC LIMIT 1`,
    [input.userUuid, plan?.id ?? null, input.kind],
  ).catch(() => ({ rows: [] }))).rows[0];
  if (recent) {
    return {
      ok: true,
      reason: 'deduped_within_60s',
      oldPlanId: plan?.id ?? undefined,
      newPlanId: recent.new_plan_id ?? undefined,
      proposalId: recent.id,
    };
  }

  // 3. Run the rebuild
  let newPlanId: string | undefined;
  let rebuildOk = false;
  let rebuildReason: string | undefined;
  try {
    const result = await generatePlan({ userId: input.userUuid, raceSlug: input.raceSlug });
    if (result.ok) {
      rebuildOk = true;
      newPlanId = result.plan_id;
    } else {
      rebuildReason = result.reason;
    }
  } catch (e: unknown) {
    rebuildReason = e instanceof Error ? e.message : String(e);
  }

  // 4. Always write the audit row · success or fail · the runner needs
  //    to see what was attempted and why.
  const proposalRow = (await pool.query<{ id: number }>(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, new_plan_id, created_at, resolved_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW(), NOW())
     RETURNING id`,
    [
      input.userUuid,
      plan?.id ?? null,
      input.kind,
      JSON.stringify({
        ...input.reasons,
        rebuild_ok: rebuildOk,
        rebuild_reason: rebuildReason ?? null,
      }),
      rebuildOk ? 'auto_applied' : 'pending',  // failures fall back to pending so a human surface can retry
      input.source,
      newPlanId ?? null,
    ],
  ).catch(() => ({ rows: [{ id: -1 }] }))).rows[0];

  return {
    ok: rebuildOk,
    reason: rebuildReason,
    oldPlanId: plan?.id ?? undefined,
    newPlanId,
    proposalId: proposalRow.id,
  };
}

/**
 * 2026-06-12 · rebuild the active race-prep plan after a plan-shaping
 * SETTINGS change (days/week, long-run / rest / quality day, weekly
 * target, experience, cross-training). Same generatePlan path the race
 * hooks use, so the edit takes effect immediately instead of waiting for
 * the next organic rebuild.
 *
 * 2026-07-06 · P1-16 · goal-mode plans (no-race fitness goal · race_id NULL,
 * authored_state.goal_mode) rebuild through the SAME path. They used to bail
 * at the race_id gate BEFORE the plan_proposals audit insert — the setting
 * saved, /api/plan/week re-bucketed the week by the new long_run_day, but
 * every prescribed workout stayed on the old days with no error and no
 * pending row to retry. Regenerated via the canonical goalTarget entry
 * (generate.ts GOAL-MODE) off the goal the plan itself recorded
 * (authored_state.goal_distance_mi/goal_sec + goal_iso deadline), so the
 * deadline holds and only the shaping changes. NOT freshTarget — this is a
 * same-goal regen, the prior-plan corruption check must still run.
 *
 * No-op (returns ok:false, no throw) when the runner has no active
 * race-prep or goal-mode plan (maintenance/recovery plans reshape at their
 * next organic build) · the new prefs simply apply at the next build.
 *
 * De-duped within 30s on (user, 'settings_prefs') so a burst of single-
 * field PATCHes from the Settings UI rebuilds once, not N times.
 */
export async function rebuildActivePlanForPrefs(
  userUuid: string,
  changedFields: string[],
): Promise<AutoRebuildResult> {
  type ActivePlanRow = {
    id: string; race_id: string | null; goal_iso: string | null;
    goal_mode: string | null; goal_distance_mi: string | null; goal_sec: string | null;
  };
  const plan = (await pool.query<ActivePlanRow>(
    `SELECT id, race_id, goal_iso,
            authored_state->>'goal_mode'        AS goal_mode,
            authored_state->>'goal_distance_mi' AS goal_distance_mi,
            authored_state->>'goal_sec'         AS goal_sec
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as ActivePlanRow[] }))).rows[0];
  if (!plan) return { ok: false, reason: 'no_active_race_plan' };
  // Goal-mode gate · race_id NULL alone is NOT enough (maintenance/recovery
  // plans also carry NULL) — require the goal_mode stamp + a usable goal.
  const goalModeDistanceMi = plan.goal_distance_mi != null ? Number(plan.goal_distance_mi) : null;
  const isGoalMode = plan.goal_mode === 'true'
    && goalModeDistanceMi != null && Number.isFinite(goalModeDistanceMi) && goalModeDistanceMi > 0
    && !!plan.goal_iso;
  if (!plan.race_id && !isGoalMode) return { ok: false, reason: 'no_active_race_plan' };

  // De-dupe rapid single-field PATCHes from the Settings UI.
  const recent = (await pool.query<{ id: number; new_plan_id: string | null }>(
    `SELECT id, new_plan_id FROM plan_proposals
      WHERE user_uuid = $1::uuid AND source = 'settings_prefs'
        AND created_at >= NOW() - interval '30 seconds'
      ORDER BY created_at DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ id: number; new_plan_id: string | null }> }))).rows[0];
  if (recent) {
    return {
      ok: true,
      reason: 'deduped_within_30s',
      oldPlanId: plan.id,
      newPlanId: recent.new_plan_id ?? undefined,
      proposalId: recent.id,
    };
  }

  let newPlanId: string | undefined;
  let rebuildOk = false;
  let rebuildReason: string | undefined;
  try {
    // Race-prep plans regen off their race; goal-mode plans (P1-16) regen off
    // the goal the plan recorded — same distance, same target, same deadline
    // (goal_iso) — through the canonical goalTarget entry. Only the shaping
    // prefs (which generatePlan re-reads itself) change.
    const result = plan.race_id
      ? await generatePlan({ userId: userUuid, raceSlug: String(plan.race_id) })
      : await generatePlan({
          userId: userUuid,
          goalTarget: {
            distanceMi: goalModeDistanceMi as number,
            goalSec: plan.goal_sec != null && Number.isFinite(Number(plan.goal_sec))
              ? Number(plan.goal_sec) : null,
            raceDateISO: String(plan.goal_iso).slice(0, 10),
          },
        });
    if (result.ok) { rebuildOk = true; newPlanId = result.plan_id; }
    else rebuildReason = result.reason;
  } catch (e: unknown) {
    rebuildReason = e instanceof Error ? e.message : String(e);
  }

  const proposalRow = (await pool.query<{ id: number }>(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, new_plan_id, created_at, resolved_at)
     VALUES ($1, $2, 'replan', $3::jsonb, $4, 'settings_prefs', $5, NOW(), NOW())
     RETURNING id`,
    [
      userUuid,
      plan.id,
      JSON.stringify({
        trigger: 'prefs_changed',
        fields: changedFields,
        rebuild_ok: rebuildOk,
        rebuild_reason: rebuildReason ?? null,
      }),
      rebuildOk ? 'auto_applied' : 'pending',
      newPlanId ?? null,
    ],
  ).catch(() => ({ rows: [{ id: -1 }] }))).rows[0];

  return {
    ok: rebuildOk,
    reason: rebuildReason,
    oldPlanId: plan.id,
    newPlanId,
    proposalId: proposalRow.id,
  };
}
