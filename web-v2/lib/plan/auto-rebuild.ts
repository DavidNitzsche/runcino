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
import { logReadFailure } from '@/lib/db/read';
import { generatePlan } from '@/lib/plan/generate';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { isCoachedExternally, COACHED_SKIP_REASON } from '@/lib/plan/coached-gate';
import type { PlanDelta } from '@/lib/plan/plan-delta';

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
  | 'race_graduate'
  /** 2026-08-17 · race-lifecycle · a recovery-mode plan ran out of
   *  prescribed days with its target race still ahead; rebuild toward
   *  the SAME race_id (pickPlanMode returns race-prep / maintenance /
   *  a recovery remainder). race_id matches, so the race_mismatch
   *  check passes normally. Fired by the plan-drift cron's
   *  recovery-complete block. */
  | 'recovery_complete'
  /** 2026-08-17 · truth-bug fix · the nightly soft-drift + goal-gap
   *  writers stamp their TRUE kind on the proposal row. They used to
   *  write a synthetic 'goal_time_changed' ("recalibrate"), which
   *  (a) rendered as "Goal time updated" for what was a staleness
   *  observation and (b) never matched the next-day dedupe check
   *  (which looked for volume_drift/vdot_drift/staleness), so a
   *  refused rebuild near race day re-proposed itself DAILY.
   *  'goal_time_changed' is reserved for actual goal edits. */
  | 'volume_drift'
  | 'vdot_drift'
  | 'staleness'
  | 'easy_drift'
  | 'long_drift'
  | 'quality_drift'
  | 'goal_gap_widening'
  /** 2026-08-19 · race-shape audit · a plan with no race ran out of
   *  prescribed days. `graduateDue` only ever asked about a RACE date, so a
   *  goal-mode plan had no end at all: sixteen weeks elapsed and Today kept
   *  rendering the last day forever. Rebuilt toward the goal, not a race. */
  | 'plan_elapsed';

/** 2026-08-19 · the no-race target. Same shape `generatePlan` already takes
 *  (GenerateInput.goalTarget) and the same one `rebuildActivePlanForPrefs` has
 *  regenerated goal-mode plans through since P1-16. */
export interface RebuildGoalTarget {
  distanceMi: number;
  goalSec: number | null;
  raceDateISO: string;
}

export interface AutoRebuildInput {
  userUuid: string;
  /** The race to build toward. Exactly one of raceSlug / goalTarget. */
  raceSlug?: string;
  /** 2026-08-19 · race-shape audit · the GOAL to build toward, for a runner
   *  with no race row. Every trigger in this module keyed off a race slug,
   *  which is why a goal-mode runner's drift signals were detected nightly
   *  and acted on never: the cron's only rebuild call site was guarded on
   *  `plan?.race_id` and a goal-mode plan's race_id is NULL. */
  goalTarget?: RebuildGoalTarget;
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
  /** 2026-08-25 · the rebuild ran and produced the block the runner already
   *  had, so nothing was archived and `newPlanId` is absent. `ok` stays true:
   *  the engine did its job. A caller that counts rebuilds must not count
   *  this one. */
  unchanged?: boolean;
  /** What moved, when something did. Read off both persisted blocks. */
  planDelta?: PlanDelta;
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
  // 0. 2026-08-19 · race-shape audit · COACHED RUNNERS ARE NOT REBUILT.
  // `coached_externally` was honoured at onboarding and nowhere else, so a
  // coached runner whose race date moved (or whose nightly drift fired) had a
  // full Faff block authored against their own coach's. Faff is the
  // measurement layer for this runner; it prescribes nothing.
  if (await isCoachedExternally(input.userUuid)) {
    return { ok: false, reason: COACHED_SKIP_REASON };
  }

  if (!input.raceSlug && !input.goalTarget) {
    return { ok: false, reason: 'no_target' };
  }

  // 1. Find the active plan + verify its race matches
  const plan = (await pool.query<{ id: string; race_id: string | null }>(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [input.userUuid],
  ).catch(() => ({ rows: [] }))).rows[0];

  if (!plan) {
    // No active plan · race_graduate path is OK with this (build fresh).
    // 2026-08-19 · so is a goal-anchored rebuild: 'plan_elapsed' archives the
    // dead plan before it gets here, and a goal target does not need a prior
    // plan to be meaningful.
    if (input.kind !== 'race_graduate' && !input.goalTarget) {
      return { ok: false, reason: 'no_active_plan' };
    }
  }
  // 2026-06-03 · race_graduate intentionally crosses race_id boundaries.
  // The active plan is for the OLD race (which just finished); we're
  // building the NEW plan for the next A-race. generatePlan archives
  // the old plan inside persistPlan's clearActivePlansFor.
  // 2026-08-19 · the race-match question only exists for a race-anchored
  // rebuild. A goal target has no slug to compare, and the plan it replaces is
  // by definition the goal-mode one (race_id NULL) this user already has.
  if (
    input.raceSlug && plan && plan.race_id !== input.raceSlug
    && input.kind !== 'race_graduate'
  ) {
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
  // 2026-08-25 · the two things the audit row could not say before: whether a
  // plan actually landed, and what moved when one did.
  let unchanged = false;
  let refusedReason: string | undefined;
  let planDelta: PlanDelta | undefined;
  try {
    // 2026-08-25 · the archived plan records WHICH trigger replaced it. The
    // proposal row below is the fuller story, but it is a separate write on a
    // separate transaction — if it fails, the plan is already gone and this
    // stamp is the only thing left that says why.
    const result = input.raceSlug
      ? await generatePlan({
          userId: input.userUuid, raceSlug: input.raceSlug, archiveReason: input.kind,
        })
      : await generatePlan({
          userId: input.userUuid, goalTarget: input.goalTarget!, archiveReason: input.kind,
        });
    if (result.ok) {
      rebuildOk = true;
      newPlanId = result.plan_id;
      unchanged = result.unchanged === true;
      refusedReason = result.refusedReason;
      planDelta = result.plan_delta;
    } else {
      rebuildReason = result.reason;
    }
  } catch (e: unknown) {
    rebuildReason = e instanceof Error ? e.message : String(e);
  }

  // 4. Always write the audit row · success or fail · the runner needs
  //    to see what was attempted and why.
  //
  // 2026-08-25 · THREE OUTCOMES NOW, NOT TWO.
  //
  //   auto_applied · a new block landed. The runner gets a notice card saying
  //                  what moved, with an undo on it.
  //   no_change    · the engine ran and the block it produced was the block the
  //                  runner already had, so nothing was archived. The row
  //                  exists because "we looked and there was nothing to do" is
  //                  a real answer and the audit trail is poorer without it.
  //                  It does NOT surface: `loadPlanProposals` selects pending
  //                  and auto_applied only, and interrupting a runner to tell
  //                  them their plan is unchanged is not a coaching act.
  //   pending      · the rebuild FAILED. Unchanged from before: a human surface
  //                  can retry it.
  //
  // The distinction matters beyond tidiness. Stamping `auto_applied` on a
  // rebuild that never happened would put a notice card in front of the runner
  // pointing at a `new_plan_id` equal to the plan they were already on, and its
  // undo button would offer to restore a block that was never replaced.
  const status = !rebuildOk ? 'pending' : unchanged ? 'no_change' : 'auto_applied';
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
        ...(unchanged ? { unchanged: true, refused_reason: refusedReason ?? null } : {}),
        // The delta is the card's body. Stored on the row rather than recomputed
        // at read time because by then the block it describes has been archived
        // and the two sides of the comparison no longer both exist as "the
        // active plan" — recomputing later would be reconstructing history from
        // a plan that has since moved on.
        ...(planDelta ? { plan_delta: planDelta } : {}),
      }),
      status,
      input.source,
      // A refused rebuild has no new plan. Writing the kept plan's id here
      // would make the row read as "we replaced X with X".
      unchanged ? null : (newPlanId ?? null),
    ],
    // `-1` is a sentinel, not an id — no row has it, so a caller can tell the
    // proposal was not written. It logs now; a proposal that silently failed to
    // record looked identical to one that recorded fine.
  ).catch((e) => { logReadFailure('plan/auto-rebuild · proposal insert', e); return { rows: [{ id: -1 }] }; })).rows[0];

  return {
    ok: rebuildOk,
    reason: rebuildReason,
    oldPlanId: plan?.id ?? undefined,
    // Absent on a refusal. The caller asked whether a NEW plan exists.
    newPlanId: unchanged ? undefined : newPlanId,
    proposalId: proposalRow.id,
    unchanged,
    planDelta,
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
  // 2026-08-19 · same gate as fireAutoRebuild. A coached runner changing their
  // long-run day is telling Faff how to READ their week, not asking it to
  // author one.
  if (await isCoachedExternally(userUuid)) {
    return { ok: false, reason: COACHED_SKIP_REASON };
  }
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
  // 2026-08-25 · same three outcomes as fireAutoRebuild. A settings change that
  // does not move a single prescribed day must not archive the block: the
  // runner edited a preference, and if the preference makes no difference to
  // what they run then their block identity and week counter are not the price
  // of finding that out.
  let unchanged = false;
  let refusedReason: string | undefined;
  let planDelta: PlanDelta | undefined;
  try {
    // Race-prep plans regen off their race; goal-mode plans (P1-16) regen off
    // the goal the plan recorded — same distance, same target, same deadline
    // (goal_iso) — through the canonical goalTarget entry. Only the shaping
    // prefs (which generatePlan re-reads itself) change.
    const result = plan.race_id
      ? await generatePlan({
          userId: userUuid, raceSlug: String(plan.race_id), archiveReason: 'settings_prefs',
        })
      : await generatePlan({
          userId: userUuid,
          archiveReason: 'settings_prefs',
          goalTarget: {
            distanceMi: goalModeDistanceMi as number,
            goalSec: plan.goal_sec != null && Number.isFinite(Number(plan.goal_sec))
              ? Number(plan.goal_sec) : null,
            raceDateISO: String(plan.goal_iso).slice(0, 10),
          },
        });
    if (result.ok) {
      rebuildOk = true;
      newPlanId = result.plan_id;
      unchanged = result.unchanged === true;
      refusedReason = result.refusedReason;
      planDelta = result.plan_delta;
    }
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
        ...(unchanged ? { unchanged: true, refused_reason: refusedReason ?? null } : {}),
        ...(planDelta ? { plan_delta: planDelta } : {}),
      }),
      !rebuildOk ? 'pending' : unchanged ? 'no_change' : 'auto_applied',
      unchanged ? null : (newPlanId ?? null),
    ],
    // `-1` is a sentinel, not an id — no row has it, so a caller can tell the
    // proposal was not written. It logs now; a proposal that silently failed to
    // record looked identical to one that recorded fine.
  ).catch((e) => { logReadFailure('plan/auto-rebuild · proposal insert', e); return { rows: [{ id: -1 }] }; })).rows[0];

  return {
    ok: rebuildOk,
    reason: rebuildReason,
    oldPlanId: plan.id,
    newPlanId: unchanged ? undefined : newPlanId,
    proposalId: proposalRow.id,
    unchanged,
    planDelta,
  };
}

/**
 * 2026-08-19 · race-shape audit · the goal a no-race runner is working toward,
 * in the shape `generatePlan` takes.
 *
 * TWO SOURCES, in order:
 *
 *   1. The active plan's OWN record of its goal (`authored_state.goal_mode` +
 *      `goal_distance_mi` / `goal_sec`, deadline `goal_iso`). This is what
 *      `rebuildActivePlanForPrefs` has used since P1-16, and it is the right
 *      first answer for a REBUILD: same goal, same deadline, only the shaping
 *      changes.
 *
 *   2. `profile.tt_goal_*` — the runner's stated fitness goal — when the plan
 *      has no record of one, or when its deadline has already passed. The
 *      deadline is re-derived as today + `tt_goal_plan_weeks` (default 16, the
 *      same default `/api/profile/goal` uses) because there IS no stored date:
 *      plan_weeks is a LENGTH the runner picked, which the goal route turns
 *      into a deadline at generation time. Re-deriving from today is what lets
 *      an elapsed goal plan rebuild at all — the alternative is a deadline in
 *      the past, which `loadGeneratorInputs` rejects at `totalDays < 14`.
 *
 * Null when neither resolves. Callers must treat null as "no target", never
 * substitute a guess: a plan built to an invented goal is worse than no plan.
 */
export async function resolveGoalTarget(
  userUuid: string,
  todayISO: string,
): Promise<RebuildGoalTarget | null> {
  const plan = (await pool.query<{
    goal_mode: string | null; goal_distance_mi: string | null;
    goal_sec: string | null; goal_iso: string | null;
  }>(
    `SELECT authored_state->>'goal_mode'        AS goal_mode,
            authored_state->>'goal_distance_mi' AS goal_distance_mi,
            authored_state->>'goal_sec'         AS goal_sec,
            goal_iso::text                      AS goal_iso
       FROM training_plans
      WHERE user_uuid = $1::uuid AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{
    goal_mode: string | null; goal_distance_mi: string | null;
    goal_sec: string | null; goal_iso: string | null;
  }> }))).rows[0];

  const planDistanceMi = plan?.goal_distance_mi != null ? Number(plan.goal_distance_mi) : NaN;
  const planDeadline = plan?.goal_iso ? String(plan.goal_iso).slice(0, 10) : null;
  // MIN_RUNWAY_DAYS, not "still in the future". `loadGeneratorInputs` refuses
  // anything under 14 days ('target < 2 weeks away'), so handing back a
  // deadline inside that window produces a rebuild that can only fail — and a
  // failed rebuild lands a `pending` proposal that nothing can ever resolve.
  // That is the stuck-pending-row shape the 2026-08-17 drift fix closed;
  // falling through to the profile branch re-derives a full-length runway
  // from the plan length the runner themselves chose, which is exactly what
  // POST /api/profile/goal does when they re-set the goal.
  const MIN_RUNWAY_DAYS = 14;
  const runwayEnough = planDeadline != null
    && (Date.parse(planDeadline + 'T12:00:00Z') - Date.parse(todayISO.slice(0, 10) + 'T12:00:00Z'))
       / 86400000 >= MIN_RUNWAY_DAYS;
  if (
    plan?.goal_mode === 'true'
    && Number.isFinite(planDistanceMi) && planDistanceMi > 0
    && planDeadline && runwayEnough
  ) {
    const secs = plan.goal_sec != null ? Number(plan.goal_sec) : NaN;
    return {
      distanceMi: planDistanceMi,
      goalSec: Number.isFinite(secs) && secs > 0 ? Math.round(secs) : null,
      raceDateISO: planDeadline,
    };
  }

  const prof = (await pool.query<{ dist: string | null; secs: string | null; weeks: string | null }>(
    `SELECT tt_goal_distance     AS dist,
            tt_goal_time_seconds AS secs,
            tt_goal_plan_weeks   AS weeks
       FROM profile WHERE user_uuid = $1 LIMIT 1`,
    [userUuid],
  ).catch(() => ({ rows: [] as Array<{ dist: string | null; secs: string | null; weeks: string | null }> }))).rows[0];
  if (!prof?.dist) return null;
  const distanceMi = distanceMiFromLabel(prof.dist);
  if (distanceMi == null || !(distanceMi > 0)) return null;
  const weeksRaw = prof.weeks != null ? Number(prof.weeks) : NaN;
  const weeks = Number.isFinite(weeksRaw) && weeksRaw >= 4 && weeksRaw <= 52
    ? Math.round(weeksRaw) : 16;
  const secsRaw = prof.secs != null ? Number(prof.secs) : NaN;
  return {
    distanceMi,
    goalSec: Number.isFinite(secsRaw) && secsRaw > 0 ? Math.round(secsRaw) : null,
    raceDateISO: new Date(Date.parse(todayISO.slice(0, 10) + 'T12:00:00Z') + weeks * 7 * 86400000)
      .toISOString().slice(0, 10),
  };
}
