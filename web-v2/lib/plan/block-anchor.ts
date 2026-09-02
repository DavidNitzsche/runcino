/**
 * lib/plan/block-anchor.ts · BLOCKANCHOR-1 (2026-09-02)
 *
 * WHERE DOES A REBUILT BLOCK BEGIN? — the fourth question in the family
 * `generate.ts` has been separating one at a time, and the one that was still
 * being answered by the wrong variable.
 *
 *   · WHERE DOES WEEK 0 BEGIN?        `weekStartBoundaryOf` — always a
 *     training-week boundary, so a `plan_weeks` row spans the same seven days
 *     every read surface does.
 *   · WHICH DAY IS THE RUNNER'S FIRST? `requestedBlockStartISO` — the join day
 *     or the day they chose; `null` on the lifecycle-regen path.
 *   · MAY A REGEN AUTHOR INTO THE PAST? `persistsComposedDay` — never a NEW
 *     prescription; a sealed one is carried.
 *   · AND NOW: WHEN A BLOCK ALREADY EXISTS, WHERE DOES ITS REBUILD BEGIN?
 *     This. At the same place the block itself began.
 *
 * THE DEFECT THIS EXISTS FOR (measured live, 2026-09-02). The owner's CIM
 * block `pln_9a57561debb776e5` was authored 2026-08-30 and runs 2026-08-24 →
 * 2026-12-06: 15 weeks, 103 rows, seven of them already in the past including a
 * 13-mile long run on 08-30. Every rebuild path — `fireAutoRebuild`,
 * `POST /api/cron/silent-rebuild`, `rebuildActivePlanForPrefs` — passes neither
 * `startAnchor` nor `startDateISO`, so `GenerateInput` defaults to
 * `startAnchor: 'monday'`: Monday of the CURRENT week. Rebuilding on 09-02
 * therefore composed **14 weeks from 08-31** and re-phased the whole block
 * across one week less:
 *
 *     peak week   61.0 (wk of 10-05)  →  57.5 (wk of 10-19)
 *     peak long   21.5 (wk of 10-26)  →  20.0 (wk of 11-09)
 *
 * Both numbers moved and both peaks slid a fortnight, with no volume decision
 * anywhere behind it. Worse, `persistPlan` only writes dates its composed weeks
 * cover, so the five sealed rows of the dropped week (08-24 … 08-30, the long
 * run among them) would not have been written into the new plan at all — Rule
 * 15's snapshot can only carry a completed day the new block still contains.
 *
 * WHY `startDateISO` COULD NOT EXPRESS THIS. Its doc says "Clamped to ≥ today",
 * and that clamp is correct: it is an ONBOARDING rule, and the runner's own
 * words for it are quoted at its declaration — *"today is their first day, why
 * would we schedule runs in the past."* A mid-block rebuild is the opposite
 * case. The block already started, its past weeks are real, its completed
 * sessions are real, and its phase and ramp structure are anchored to that
 * start. So this is a separate question with a separate answer, not a loosened
 * clamp — deleting the clamp would let onboarding schedule runs before the
 * runner existed, which is the defect it was written for.
 *
 * WHAT THIS DOES NOT CHANGE. `clipBeforeISO` stays exactly as it was (null on
 * the regen path), so `persistsComposedDay` still refuses to author a NEW
 * prescription onto any past day, and Rule 15 still overlays the prior
 * prescription on every sealed one. Preserving the anchor changes which
 * calendar the block occupies; it does not give a rebuild permission to rewrite
 * what the runner already ran.
 *
 * RULE 11. The refusal branch carries no `anchorISO` field at all, so
 * `read.anchorISO` does not compile until the caller has branched, and every
 * refusal carries a NAMED reason rather than a silent null — the preview and
 * the report print them. "There is no active block", "the block is aimed at a
 * different race" and "the read failed" are three different facts.
 *
 * RULE 9. Every clause below is a discrete fact about the world (a block exists
 * or it does not; it is aimed at this race or another; a race finished inside
 * it or none did) rather than a threshold on a continuous quantity, so there is
 * no hair to sit on either side of. And the change REMOVES a discontinuity that
 * was there: with the current-week anchor, the same block rebuilt on successive
 * Sundays and Mondays re-phases by a whole week every seven days; anchored to
 * its own start it composes the same geometry every day.
 */
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/pool';

/** The named reasons a rebuild does NOT inherit an existing block's start. */
export type BlockAnchorRefusal =
  /** The caller named a first day itself — onboarding, or a chosen start date.
   *  `requestedBlockStartISO` owns that answer and this must not override it. */
  | 'caller_named_a_start'
  /** No unarchived plan. A first authoring, or a block that already graduated. */
  | 'no_active_plan'
  /** The active plan is a maintenance or recovery block. Those are not builds
   *  and their start is not a periodisation anchor; a rebuild of one is a new
   *  block, sized by its own composer from today. */
  | 'not_a_build_block'
  /** The rebuild is aimed at a different race or goal than the active plan.
   *  `race_graduate` is exactly this and must NOT inherit: the old block ended
   *  when its race did. */
  | 'different_target'
  /** The rebuild has no target at all (`openTarget`) — a post-race open block,
   *  which by construction begins now. */
  | 'open_block_has_no_prior_geometry'
  /** The active plan has no dated rows, so it has no start to inherit. */
  | 'active_plan_has_no_rows'
  /** The block's last prescribed day is already behind us. Its calendar is
   *  spent; anchoring to it would compose a block that is entirely past and
   *  `persistsComposedDay` would drop nearly all of it. */
  | 'block_already_ended'
  /** A race the runner actually ran finished on or after the block's start, so
   *  the block has been interrupted by a result. Recovery and graduation own
   *  that case and both legitimately re-anchor. */
  | 'race_finished_inside_block'
  /** The read failed. NOT the same fact as "there is no active plan", and the
   *  caller must not treat it as one. */
  | 'read_failed';

export type BlockAnchorRead =
  | { preserved: true; anchorISO: string; planId: string }
  | { preserved: false; reason: BlockAnchorRefusal; detail?: string };

/** The active plan, as the anchor decision needs to see it. Kept as a plain
 *  shape so the decision below is pure and can be walked without a database. */
export interface ActiveBlockFacts {
  planId: string;
  /** `training_plans.mode` — 'race-prep' | 'maintenance' | 'recovery'. */
  mode: string | null;
  /** `training_plans.race_id`, null on a goal-mode block. */
  raceId: string | null;
  /** `training_plans.goal_iso` (YYYY-MM-DD), the goal-mode block's deadline. */
  goalISO: string | null;
  /** Earliest `plan_weeks.week_start_iso`, else earliest `plan_workouts.date_iso`. */
  firstDayISO: string | null;
  /** Latest `plan_workouts.date_iso`. */
  lastDayISO: string | null;
}

/** What the rebuild is aiming at, as the anchor decision needs to see it. */
export interface RebuildTarget {
  raceSlug?: string;
  goalRaceDateISO?: string;
  isOpenBlock: boolean;
}

/**
 * THE DECISION, with no I/O in it, so a walk can drive every clause.
 *
 * `lastFinishedRaceISO` is the runner's most recent race that is already run —
 * `loadLastRaceFinished`'s own answer, passed in rather than re-derived, so
 * this file does not become a second owner of "when did he last race".
 */
export function decideBlockAnchor(args: {
  todayISO: string;
  startAnchor: 'today' | 'monday';
  startDateISO?: string;
  active: ActiveBlockFacts | null;
  target: RebuildTarget;
  lastFinishedRaceISO: string | null;
}): BlockAnchorRead {
  const { todayISO, startAnchor, startDateISO, active, target, lastFinishedRaceISO } = args;

  // The caller named a first day. `requestedBlockStartISO` owns that question
  // and answers it for onboarding and for a runner-chosen start; this one does
  // not get to overrule it. Checked FIRST so no later clause can.
  if (startAnchor !== 'monday' || startDateISO) {
    return { preserved: false, reason: 'caller_named_a_start' };
  }
  if (target.isOpenBlock) {
    return { preserved: false, reason: 'open_block_has_no_prior_geometry' };
  }
  if (!active) return { preserved: false, reason: 'no_active_plan' };
  if (active.mode !== 'race-prep') {
    return { preserved: false, reason: 'not_a_build_block', detail: String(active.mode) };
  }

  // Same block, or a different one? A race-anchored rebuild matches on the
  // slug; a goal-anchored one on the goal's own deadline, which is what a
  // goal-mode plan stores in place of a race. Anything else — a graduation to
  // the next A race, a goal replaced by a race — is a NEW block.
  if (target.raceSlug) {
    if (active.raceId !== target.raceSlug) {
      return { preserved: false, reason: 'different_target', detail: `plan race ${active.raceId} vs ${target.raceSlug}` };
    }
  } else if (target.goalRaceDateISO) {
    const planGoal = (active.goalISO ?? '').slice(0, 10);
    if (active.raceId != null || planGoal !== target.goalRaceDateISO.slice(0, 10)) {
      return { preserved: false, reason: 'different_target', detail: `plan goal ${active.raceId ?? planGoal} vs goal ${target.goalRaceDateISO}` };
    }
  } else {
    return { preserved: false, reason: 'different_target', detail: 'rebuild named no target' };
  }

  if (!active.firstDayISO) return { preserved: false, reason: 'active_plan_has_no_rows' };
  if (!active.lastDayISO || active.lastDayISO < todayISO) {
    return { preserved: false, reason: 'block_already_ended', detail: String(active.lastDayISO) };
  }
  // A result landed inside this block, so the block is not simply continuing:
  // `pickPlanMode` may answer recovery, and the graduate path re-targets
  // outright. Both own their own start and neither should inherit this one.
  if (lastFinishedRaceISO && lastFinishedRaceISO >= active.firstDayISO) {
    return { preserved: false, reason: 'race_finished_inside_block', detail: lastFinishedRaceISO };
  }
  return { preserved: true, anchorISO: active.firstDayISO, planId: active.planId };
}

/**
 * Read the active block's facts. Returns `undefined` on a READ FAILURE, which
 * is a different fact from `null` ("this runner has no active plan") — Rule 11,
 * and the caller turns the two into different refusals.
 */
export async function readActiveBlockFacts(
  userId: string,
  client?: PoolClient,
): Promise<ActiveBlockFacts | null | undefined> {
  const q = client ?? pool;
  try {
    // Rule 14 · the population is named: THIS user's ONE unarchived plan, and
    // the week/day rows of THAT PLAN by plan_id. Joining `plan_workouts` on
    // user_uuid alone reads every archived version the runner has ever had.
    const row = (await q.query<{
      id: string; mode: string | null; race_id: string | null; goal_iso: string | null;
      first_week: string | null; first_day: string | null; last_day: string | null;
    }>(
      `SELECT tp.id, tp.mode, tp.race_id, tp.goal_iso::text AS goal_iso,
              (SELECT MIN(pw.week_start_iso) FROM plan_weeks pw WHERE pw.plan_id = tp.id) AS first_week,
              (SELECT MIN(w.date_iso) FROM plan_workouts w WHERE w.plan_id = tp.id) AS first_day,
              (SELECT MAX(w.date_iso) FROM plan_workouts w WHERE w.plan_id = tp.id) AS last_day
         FROM training_plans tp
        WHERE tp.user_uuid = $1 AND tp.archived_iso IS NULL
        ORDER BY tp.authored_iso DESC
        LIMIT 1`,
      [userId],
    )).rows[0];
    if (!row) return null;
    return {
      planId: row.id,
      mode: row.mode,
      raceId: row.race_id,
      goalISO: row.goal_iso ? String(row.goal_iso).slice(0, 10) : null,
      // The block's own week-0 boundary is the exact quantity being preserved.
      // The earliest workout is the fallback for a plan whose week rows are
      // missing, and it is snapped to a boundary by `weekStartBoundaryOf` at
      // the call site either way.
      firstDayISO: row.first_week ? String(row.first_week).slice(0, 10)
        : row.first_day ? String(row.first_day).slice(0, 10) : null,
      lastDayISO: row.last_day ? String(row.last_day).slice(0, 10) : null,
    };
  } catch {
    return undefined;
  }
}

/** The I/O wrapper. One resolver, one answer, every rebuild path. */
export async function resolveBlockAnchor(args: {
  userId: string;
  todayISO: string;
  startAnchor: 'today' | 'monday';
  startDateISO?: string;
  target: RebuildTarget;
  lastFinishedRaceISO: string | null;
  client?: PoolClient;
}): Promise<BlockAnchorRead> {
  // Cheap clauses first: a caller-named start and an open block need no read at
  // all, so onboarding does not pay a query for an answer it cannot use.
  if (args.startAnchor !== 'monday' || args.startDateISO) {
    return { preserved: false, reason: 'caller_named_a_start' };
  }
  if (args.target.isOpenBlock) {
    return { preserved: false, reason: 'open_block_has_no_prior_geometry' };
  }
  const active = await readActiveBlockFacts(args.userId, args.client);
  if (active === undefined) return { preserved: false, reason: 'read_failed' };
  return decideBlockAnchor({
    todayISO: args.todayISO,
    startAnchor: args.startAnchor,
    startDateISO: args.startDateISO,
    active,
    target: args.target,
    lastFinishedRaceISO: args.lastFinishedRaceISO,
  });
}
