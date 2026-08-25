/**
 * lib/plan/open-block.ts · what a runner gets when there is nothing booked.
 *
 * ─── the hole ────────────────────────────────────────────────────────────────
 *
 * Every plan the engine authors is anchored to a target. `loadGeneratorInputs`
 * takes a `raceSlug` (a races row) or a `goalTarget` (a fitness goal with a
 * synthetic deadline) and returns `'race not found'` without one. So the whole
 * adaptation system is reachable only by runners who have something on the
 * calendar.
 *
 * The runner who does not is not an edge case, it is the ordinary end of a
 * season. They finish their goal race. `runPostResultChain` archives the plan
 * the moment the finish time lands, searches for the next A/B race, finds
 * none, and returns `nextPlan = null`. The cron's mirror says "No next A-race
 * · leave plan as-is" — but "as-is" is already archived. Zero active plans, on
 * the morning after a marathon.
 *
 * `composeRecoveryPlan` exists. `composeMaintenancePlan` exists. `pickPlanMode`
 * returns 'recovery' inside the post-race window and 'maintenance' for "no
 * next race" — step 2, in as many words. `ComposeNonRaceInput.nextRace` is
 * already declared nullable. Every piece of the answer is built. What is
 * missing is one entry: a way to reach them without a target.
 *
 * ─── this module ─────────────────────────────────────────────────────────────
 *
 * The DECISION — is this runner in the hole, what should they get, may Faff
 * author it at all, has it already been done today — lives here, fully tested,
 * and is wired into both writers (the result chain and the nightly cron).
 *
 * The AUTHORSHIP for the no-target case needed a `generate.ts` entry that did
 * not exist. It does now: `GenerateInput.openTarget` (2026-08-19 ·
 * OPEN-TARGET-1), and `authorNoTargetBlock` below calls it. A runner who
 * finishes a race with nothing booked receives an authored plan — the reverse
 * taper Research/00b prescribes for the distance they just ran, or a
 * maintenance block once that window has closed — not a pending proposal and a
 * nightly retry.
 *
 * The goal-anchored case works today and is taken first where it applies.
 */

import { pool } from '@/lib/db/pool';
import { logReadFailure } from '@/lib/db/read';
import { generatePlan } from '@/lib/plan/generate';
import { resolveGoalTarget } from '@/lib/plan/auto-rebuild';
import { isCoachedExternally, COACHED_SKIP_REASON } from '@/lib/plan/coached-gate';
import { openBlockDue, openBlockMode, type OpenBlockMode } from '@/lib/plan/race-lifecycle';

export interface OpenBlockOutcome {
  /** True when a plan was authored. */
  ok: boolean;
  /** 'recovery' | 'maintenance' when no target exists; 'goal-build' when the
   *  runner's own fitness goal is still live and the recovery window has
   *  passed, so the canonical goalTarget entry can build toward it. */
  mode: OpenBlockMode | 'goal-build' | null;
  /** Machine-readable outcome. Stable — surfaces and the cron report match
   *  on these.
   *    'authored'                 · a plan exists now
   *    'coached_externally'       · the runner's own coach owns the plan
   *    'not_due'                  · they have a plan, or a target to build to
   *    'already_pending'          · an open_block proposal is already standing
   *    'generation_failed'        · the generator ran and refused
   *
   * 'no_target_entry_missing' retired 2026-08-19 · the generate.ts open entry
   * exists (GenerateInput.openTarget), so the no-target case now authors or
   * fails for a real reason rather than for the absence of a code path.
   */
  reason: string;
  planId?: string;
}

export interface AuthorOpenBlockInput {
  userUuid: string;
  /** The runner's own date. Never `new Date()` — determinism. */
  todayISO: string;
  /** The race they just finished, when this fires off a result. Null when the
   *  cron finds them already planless. */
  lastRace: {
    slug: string;
    dateISO: string | null;
    distanceMi: number | null;
    priority?: string | null;
  } | null;
  /** True when a future A/B race or a live goal build already covers them. */
  hasFutureTarget: boolean;
  /** True when they still have an active plan. */
  hasActivePlan: boolean;
  /** Audit trail source, e.g. 'result_chain' / 'open_block_cron'. */
  source: string;
}

/**
 * Give a runner with nothing booked the block doctrine says they should have.
 *
 * Order of questions, and why:
 *
 *   1. Coached? Faff authors nothing for a runner whose own coach writes the
 *      plan — including here. This runner is PLANLESS BY DESIGN.
 *   2. Due? A runner with a plan, or with a race to build toward, is already
 *      the graduate/build machinery's problem.
 *   3. Recovery or maintenance? Answered against Research/00b's window
 *      (`openBlockMode`), never guessed.
 *   4. Recovery window passed AND a live fitness goal? Then the honest block
 *      is the goal build, not maintenance — the runner told us what they are
 *      training for. Taken through the canonical goalTarget entry.
 *   5. Otherwise the no-target entry, and its current state.
 *
 * Idempotent. A standing pending `open_block` proposal for this runner blocks
 * a re-fire, so the nightly retry cannot mint a row per morning — the exact
 * shape that accumulated nineteen duplicate staleness proposals before the
 * 2026-08-17 expiry hygiene landed.
 */
export async function authorOpenBlock(input: AuthorOpenBlockInput): Promise<OpenBlockOutcome> {
  const { userUuid, todayISO } = input;

  if (await isCoachedExternally(userUuid)) {
    return { ok: false, mode: null, reason: COACHED_SKIP_REASON };
  }

  if (!openBlockDue({ hasActivePlan: input.hasActivePlan, hasFutureTarget: input.hasFutureTarget })) {
    return { ok: false, mode: null, reason: 'not_due' };
  }

  // THREE days, not the proposal system's usual fourteen. A pending row here
  // means "this runner is planless and we could not fix it", which is a state
  // worth retrying often — the moment the generator gains its open entry, or
  // the runner sets a goal, the next retry authors. Fourteen would leave them
  // waiting a fortnight for a fix that already shipped. Three still costs at
  // most two rows a week, nowhere near the nineteen-duplicates shape the
  // 2026-08-17 expiry hygiene was written for.
  const standing = (await pool.query(
    `SELECT 1 FROM plan_proposals
      WHERE user_uuid = $1
        AND proposal_kind = 'open_block'
        AND status = 'pending'
        AND created_at >= NOW() - interval '3 days'`,
    [userUuid],
    // 2026-08-24 · swallowed-failure sweep · fails CLOSED. `rowCount: 0` reads
    // as "no standing proposal", so a failed read wrote a second one. A
    // proposal we cannot prove is absent is treated as present.
  ).catch((e) => { logReadFailure('plan/open-block · standing proposal', e); return { rowCount: 1 }; })).rowCount;
  if (standing) return { ok: false, mode: null, reason: 'already_pending' };

  const mode = openBlockMode({
    lastRaceDateISO: input.lastRace?.dateISO ?? null,
    lastRaceDistanceMi: input.lastRace?.distanceMi ?? null,
    lastRacePriority: input.lastRace?.priority ?? null,
    todayISO,
  });

  // Step 4 · out of the recovery window with a live goal → build toward it.
  // Inside the window this branch is deliberately NOT taken: a goal build the
  // week after a marathon is the "sized every distance off the reverse taper"
  // error in a different costume. Recovery first, then the build.
  if (mode === 'maintenance') {
    // Same reader the elapsed-plan rebuild uses, so an open block and a
    // rebuild cannot disagree about what the runner is working toward.
    const goal = await resolveGoalTarget(userUuid, todayISO);
    if (goal) {
      const gen = await generatePlan({
        userId: userUuid,
        goalTarget: goal,
        freshTarget: true,
        // 2026-08-25 · automatic path · the archived plan records the trigger.
        archiveReason: 'open_block',
      }).catch((e: unknown) => ({
        ok: false as const,
        reason: e instanceof Error ? e.message : String(e),
      }));
      await recordOpenBlock(userUuid, 'goal-build', input.source, gen.ok, gen.ok ? null : gen.reason ?? null);
      return gen.ok
        ? { ok: true, mode: 'goal-build', reason: 'authored', planId: gen.plan_id }
        : { ok: false, mode: 'goal-build', reason: 'generation_failed' };
    }
  }

  const authored = await authorNoTargetBlock(input, mode);
  await recordOpenBlock(userUuid, mode, input.source, authored.ok, authored.ok ? null : authored.reason);
  return authored;
}

/**
 * THE SEAM, now closed (2026-08-19 · OPEN-TARGET-1).
 *
 * Authoring a recovery or maintenance block with no target at all. `generate.ts`
 * is the only module that can do this, and until this commit it could not: with
 * neither `raceSlug` nor `goalTarget`, `loadGeneratorInputs` returned
 * `'race not found'` before any composer was reached. That was the ONLY missing
 * piece, and re-verified before building on it rather than taken on trust:
 *
 *   · `pickPlanMode` step 2 reads, verbatim, "No next race · maintenance by
 *     default" — and it is reached, because step 1's recovery check is guarded
 *     on the LAST race, not the next one.
 *   · `ComposeNonRaceInput.nextRace` is declared `| null`.
 *   · `composeMaintenancePlan` guards its whole horizon calculation behind
 *     `if (input.nextRace)` and otherwise keeps `TOTAL_WEEKS = 4` — "when no
 *     race is scheduled (just-run mode), fall back to the 4-week rolling
 *     default", in its own comment.
 *   · `composeRecoveryPlan` never reads `nextRace` at all; its length and
 *     shape come from `lastRaceFinished` and Research/00b's reverse taper.
 *
 * Two things the claim did NOT cover, found by tracing rather than assuming,
 * and handled in `generate.ts` (see OPEN-TARGET-1 there):
 *
 *   · `ComposePlanInput` still requires a `raceDistanceMi`, so the no-target
 *     path has to name a distance nobody is racing. It names the last raced
 *     one, and where none exists a labelled convention that is provably inert.
 *   · `pickPlanMode` would have disagreed with `openBlockMode` on race DAY and
 *     on any C-priority race, because the DB reader behind it filters to A/B
 *     races dated strictly before today. The finished race is threaded through
 *     `openTarget.after` so both read the same race and reach the same answer.
 *
 * It still does NOT fall back to a race-anchored build off the finished race:
 * that would write a plan whose `race_id` points at a race that already
 * happened, which the graduate cron would then act on.
 */
async function authorNoTargetBlock(
  input: AuthorOpenBlockInput,
  mode: OpenBlockMode,
): Promise<OpenBlockOutcome> {
  const gen = await generatePlan({
    userId: input.userUuid,
    openTarget: { after: input.lastRace },
    // 2026-08-25 · automatic path · the archived plan records the trigger.
    archiveReason: 'open_block',
    // The block starts TODAY, not on the training-week boundary behind it. A
    // runner who is planless right now needs today prescribed; anchoring to
    // Monday would date the opening days before the block was authored, which
    // is the same reason onboarding uses this anchor.
    startAnchor: 'today',
  }).catch((e: unknown) => ({
    ok: false as const,
    plan_id: undefined,
    reason: e instanceof Error ? e.message : String(e),
  }));
  return gen.ok
    ? { ok: true, mode, reason: 'authored', planId: gen.plan_id }
    : { ok: false, mode, reason: 'generation_failed' };
}

/**
 * Audit row. Written on success AND failure, for the same reason
 * `fireAutoRebuild` writes one either way: the runner needs the attempt to be
 * visible. A failure lands `pending`, which is also what blocks tomorrow's
 * duplicate — one standing row per planless runner, not one per morning.
 */
async function recordOpenBlock(
  userUuid: string,
  mode: OpenBlockMode | 'goal-build',
  source: string,
  ok: boolean,
  reason: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO plan_proposals
       (user_uuid, plan_id, proposal_kind, reasons, status, source, created_at, resolved_at)
     VALUES ($1, NULL, 'open_block', $2::jsonb, $3, $4, NOW(),
             CASE WHEN $5::boolean THEN NOW() ELSE NULL END)`,
    [
      userUuid,
      JSON.stringify({
        block_mode: mode,
        message: ok
          ? `Race done, nothing booked · authored a ${mode} block.`
          : `Race done, nothing booked · no ${mode} block authored yet.`,
        authored: ok,
        reason,
      }),
      ok ? 'auto_applied' : 'pending',
      source,
      ok,
    ],
  ).catch(() => null);
}
