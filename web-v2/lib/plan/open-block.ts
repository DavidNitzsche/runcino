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
 * The AUTHORSHIP for the no-target case needs the `generate.ts` entry that
 * does not exist yet; `authorNoTargetBlock` below is the single seam where it
 * lands, and it says so precisely rather than pretending. Until then the state
 * is SURFACED, not silent: a pending `open_block` proposal records that this
 * runner is planless and why, the cron retries every night, and the runner is
 * picked up on the first tick after the entry point ships.
 *
 * The goal-anchored case works today and is taken first where it applies.
 */

import { pool } from '@/lib/db/pool';
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
   *    'no_target_entry_missing'  · the generate.ts open entry (see below)
   *    'generation_failed'        · the generator ran and refused
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
  ).catch(() => ({ rowCount: 0 }))).rowCount;
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
 * THE SEAM. Authoring a recovery or maintenance block with no target at all.
 *
 * `generate.ts` is the only module that can do this, and it cannot yet: with
 * neither `raceSlug` nor `goalTarget`, `loadGeneratorInputs` returns
 * `'race not found'` before any composer is reached. Nothing downstream is
 * missing — `pickPlanMode` already answers "no next race → maintenance" at
 * step 2, `composeMaintenancePlan` already falls back to its rolling four-week
 * default when `nextRace` is null, and `ComposeNonRaceInput.nextRace` is
 * already typed nullable. The gap is the input loader, and it is the one file
 * this work does not own.
 *
 * What lands here when that entry exists (the whole change, verbatim):
 *
 *     const gen = await generatePlan({
 *       userId: input.userUuid,
 *       openTarget: { after: input.lastRace },   // new GenerateInput member
 *       startAnchor: 'today',
 *     });
 *     return gen.ok
 *       ? { ok: true, mode, reason: 'authored', planId: gen.plan_id }
 *       : { ok: false, mode, reason: 'generation_failed' };
 *
 * Until then this returns honestly. It does NOT fall back to a race-anchored
 * build off the finished race: `loadGeneratorInputs` rejects a past date at
 * `totalDays < 14` ("target < 2 weeks away"), so that path cannot work, and
 * making it work would mean writing a plan whose `race_id` points at a race
 * that already happened — a lie the graduate cron would then act on.
 */
async function authorNoTargetBlock(
  input: AuthorOpenBlockInput,
  mode: OpenBlockMode,
): Promise<OpenBlockOutcome> {
  void input;
  return { ok: false, mode, reason: 'no_target_entry_missing' };
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
