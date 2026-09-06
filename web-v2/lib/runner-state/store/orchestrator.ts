/**
 * lib/runner-state/store/orchestrator.ts · STEP 1 ("LOAD CANONICAL RUNNER
 * STATE") AND STEP 5/"7" ("UPDATE BELIEFS"), AS TWO CALLABLE FUNCTIONS.
 *
 * `lib/brain/orchestration/steps.ts` declares sixteen steps and checks each
 * one's claim against the real import graph.
 *
 * ── ORCHESTRATIONWIRE-1 (2026-09-06) ────────────────────────────────────────
 *
 * The previous session's own header (kept below, in spirit, as the record of
 * why this was not done then) named two things missing before either step
 * could be WIRED: a table-existence probe so a production call does not throw
 * a raw "relation does not exist" into whatever cron called it, and an actual
 * production caller. This change adds both, in the same shape as
 * `plan_decision_ledger`'s LEDGERREQUIRED-1: `beliefsTableExistsCheck`
 * (`./schema.ts`) is queried before every write or read, and an absent table
 * is a REFUSAL (`BeliefsTableAbsent`, thrown), never a crash and never a
 * silent no-op. `app/api/cron/run-adaptations/route.ts` now calls
 * `updateRunnerBeliefs` for every runner in its existing per-runner loop, one
 * call per pass, catching the refusal exactly the way it already catches
 * every other per-runner failure so one runner's absent table cannot take the
 * rest of the pass down.
 *
 * What this does NOT do: apply a migration to production. No migration for
 * `runner_beliefs` has been written yet (see `db/migrations/169_runner_
 * beliefs.sql`, drafted and NOT applied — DDL needs David's per-statement go,
 * per this repo's deployment doctrine). Until it is, every single call from
 * the cron answers the refusal branch and nothing is stored. That is the same
 * state steps 12 and 16 are already declared WIRED in — "reachable and
 * blocked on approval is a different state from unwired, and the blocker is
 * named in the packet rather than hidden behind this number" — and it is why
 * `steps.ts` promotes steps 1 and 5 alongside this change rather than waiting
 * for the migration.
 *
 * Original header, for the record:
 *   "This file is BOTH functions, but it is deliberately NOT a route, a cron
 *   entry or a call site outside `lib/runner-state/`. Per this session's hard
 *   constraints, the schema lives on a scratch database only — there is no
 *   migration onto production tonight, and `WIRED_STEP_PIN` in `steps.ts`
 *   stays where it is... Wiring either step to WIRED needs two things this
 *   file does not do: a reviewed, approved migration creating `runner_beliefs`
 *   in production..., and an actual production route or cron importing these
 *   functions. Both are the next session's work, not a claim this one gets to
 *   make for it."
 */
import type { PoolClient, Pool } from 'pg';
import { resolveRunnerLineage } from './lineage';
import { buildRunnerBeliefInput } from './loaders';
import { quantitiesFromWeeklyVolume } from './quantity-loaders';
import { stampBelief, stampQuantity } from './write';
import { readAllLatestBeliefs, withStoreStaleness, type DecayedBelief } from './read';
import { beliefsTableExistsCheck } from './schema';
import { assembleRunnerBeliefs, type RunnerBeliefs, type BeliefValueByKey } from '../assemble';
import type { StoredBelief } from './record';
import type { BeliefKey } from '../belief';

/**
 * Thrown by both `updateRunnerBeliefs` and `loadRunnerBeliefs` when the store
 * cannot be read or written. `reason` distinguishes Rule 11's two remaining
 * facts once "it worked" is ruled out: a definite absence (no migration
 * applied here) from a probe that could not complete at all (connection or
 * permission trouble) — a caller that conflates them cannot tell "wait for
 * the migration" from "something is actually broken right now."
 */
export class BeliefsTableUnavailable extends Error {
  constructor(public readonly reason: 'absent' | 'probe_failed', message: string) {
    super(message);
    this.name = 'BeliefsTableUnavailable';
  }
}

async function requireBeliefsTable(exec: Pick<PoolClient, 'query'>): Promise<void> {
  const probe = await beliefsTableExistsCheck(exec);
  if (probe === 'present') return;
  if (probe === 'absent') {
    throw new BeliefsTableUnavailable(
      'absent',
      'runner_beliefs does not exist on this database. No migration has been applied here '
      + '(db/migrations/169_runner_beliefs.sql is drafted and unapplied). The belief store '
      + 'is a declared, approved-pending state, not a failure to catch and hide.',
    );
  }
  throw new BeliefsTableUnavailable(
    'probe_failed',
    'the check for runner_beliefs could not be completed, so whether the table exists is '
    + 'UNKNOWN. That is not the same as the migration not having been applied.',
  );
}

/** Bump on any change to what a loader submits or how a quantity is derived,
 *  so a stored row can always say which build of this pipeline produced it
 *  (Rule 10 / doctrine §31). */
export const BELIEF_STORE_MODEL_VERSION = 'belief-store-1';

/* ══════════════════════════════════════════════════════════════════════════
 * STEP 5/7 · UPDATE BELIEFS · compute fresh, weld, stamp every row
 * ═══════════════════════════════════════════════════════════════════════ */

export interface BeliefUpdateResult {
  readonly planLineageId: string;
  readonly beliefs: RunnerBeliefs;
  readonly writtenBeliefIds: ReadonlyArray<{ key: BeliefKey; id: string }>;
  readonly writtenQuantityIds: ReadonlyArray<{ quantityId: string; id: string }>;
}

/**
 * Compute every in-scope belief and quantity for one runner, as of `todayISO`,
 * and stamp all of it into `runner_beliefs` in one pass.
 *
 * `exec` should be a transaction when this call accompanies a plan mutation
 * (matching `resolveRunnerLineage`'s own contract), and may be the bare pool
 * for a standalone nightly refresh. Every write in this function goes through
 * that one `exec`, so a caller wrapping it in a transaction gets one atomic
 * batch; a caller passing the pool gets N independent inserts, which is safe
 * here specifically because inserts are append-only and never each other's
 * precondition.
 */
export async function updateRunnerBeliefs(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  todayISO: string,
): Promise<BeliefUpdateResult> {
  await requireBeliefsTable(exec);
  const { planLineageId } = await resolveRunnerLineage(exec, userUuid);
  const input = await buildRunnerBeliefInput(exec, userUuid, todayISO);
  const beliefs = assembleRunnerBeliefs(input);

  const ctx = { userUuid, planLineageId, modelVersion: BELIEF_STORE_MODEL_VERSION };
  const writtenBeliefIds: Array<{ key: BeliefKey; id: string }> = [];
  for (const key of Object.keys(beliefs) as BeliefKey[]) {
    const w = await stampBelief(exec, beliefs[key] as never, ctx);
    writtenBeliefIds.push({ key, id: w.id });
  }

  // LONG_RUN_DISTANCE's share-of-week half ("long-run structure") is
  // deliberately not stamped here — see quantity-loaders.ts's header for why
  // its owner sits behind the walled canonical adaptation engine's import
  // wall, and why spending either of its two disagreeing SECOND answers
  // instead would be the thirteenth-owner defect this store must not produce.
  const quantities = quantitiesFromWeeklyVolume(beliefs.SUSTAINABLE_WEEKLY_VOLUME);
  const writtenQuantityIds: Array<{ quantityId: string; id: string }> = [];
  for (const q of quantities) {
    const w = await stampQuantity(exec, {
      quantityId: q.quantityId,
      reading: q.reading,
      confidence: q.confidence,
      sourceMode: q.sourceMode,
      supporting: q.supporting,
      contradicting: [],
      tension: null,
      recency: q.recency,
      rule8Side: q.rule8Side,
      movesUpOn: q.movesUpOn,
      movesDownOn: q.movesDownOn,
      neverMovesOn: q.neverMovesOn,
      owner: q.owner,
      computedAtISO: q.computedAtISO,
    }, ctx);
    writtenQuantityIds.push({ quantityId: q.quantityId, id: w.id });
  }

  return { planLineageId, beliefs, writtenBeliefIds, writtenQuantityIds };
}

/* ══════════════════════════════════════════════════════════════════════════
 * STEP 1 · LOAD CANONICAL RUNNER STATE · read the newest stamped row per key
 * ═══════════════════════════════════════════════════════════════════════ */

export interface LoadedRunnerState {
  readonly asOfISO: string;
  readonly beliefs: ReadonlyMap<BeliefKey, DecayedBelief<unknown>>;
  readonly quantities: ReadonlyMap<string, DecayedBelief<unknown>>;
}

/**
 * Read the belief state THIS runner currently has on record — the newest row
 * per key, decayed for store staleness (`read.ts`) — WITHOUT recomputing
 * anything. This is the read half of step 1: a caller that wants the freshest
 * possible answer calls `updateRunnerBeliefs` first and this after; a caller
 * that only wants "what do we currently believe" calls this alone and pays no
 * DB-heavy owner calls.
 */
export async function loadRunnerBeliefs(
  exec: Pick<PoolClient, 'query'> | Pool,
  userUuid: string,
  asOfISO: string = new Date().toISOString(),
): Promise<LoadedRunnerState> {
  await requireBeliefsTable(exec as Pick<PoolClient, 'query'>);
  const rows = await readAllLatestBeliefs(exec as Pick<PoolClient, 'query'>, userUuid);
  const beliefs = new Map<BeliefKey, DecayedBelief<unknown>>();
  const quantities = new Map<string, DecayedBelief<unknown>>();
  for (const row of rows) {
    const decayed = withStoreStaleness(row as StoredBelief<unknown>, asOfISO);
    if (row.registry === 'BELIEF') beliefs.set(row.beliefKey as BeliefKey, decayed);
    else quantities.set(row.beliefKey, decayed);
  }
  return { asOfISO, beliefs, quantities };
}

/** Type re-export so a caller of `loadRunnerBeliefs` can narrow a specific
 *  belief's value without importing `assemble.ts` separately. */
export type { BeliefValueByKey };
