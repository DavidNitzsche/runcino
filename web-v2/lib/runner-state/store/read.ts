/**
 * lib/runner-state/store/read.ts · THE CURRENT BELIEF IS THE NEWEST ROW.
 *
 * `schema.ts`'s header already argues the append-only shape; this file is
 * where "current" gets a definition: `ORDER BY stored_at DESC LIMIT 1` per
 * `(user_uuid, registry, belief_key)`.
 *
 * ── STORE STALENESS IS A SECOND, SEPARATE DECAY FROM THE OWNER'S OWN ───────
 *
 * `lib/adaptation/volume-evidence/weight.ts#recencyWeight` and
 * `lib/training/durability-anchor.ts#recencyWeight` already decay confidence
 * for evidence AGING INSIDE A RESOLVER — a threshold session run three weeks
 * ago counts for less than one run yesterday, and that discount is baked into
 * the `confidence` a belief carried the moment it was stamped. This file is
 * not a third copy of that (Rule 16): it answers a different question —
 * "how stale is this CACHED ROW", which is about the belief store's own
 * freshness, not the runner's evidence. A belief stamped nine days ago and
 * never refreshed is a worse answer today than it was the day it was written,
 * REGARDLESS of what its own internal evidence weighting said at write time,
 * because nine more days of unobserved training could have moved the
 * runner. `docs/PRODUCT_COACHING_DOCTRINE.md`'s decay-confidence-not-value
 * rule is the same shape one level up: never touches `reading.value`, only
 * `confidence`, and only on the way OUT of the store — the stored row is
 * never rewritten (Rule 10: recompute at read time, or refuse or label; this
 * is the "label" posture, applied to the store's own age rather than the
 * physiological anchor already stamped on the reading).
 *
 * `STORE_STALENESS_HALF_LIFE_DAYS` is an engineering default, not a doctrine
 * citation — there is no `Research/` table for "how long may a cached belief
 * go unread before a consumer should trust it less." Fourteen days is chosen
 * because it is half of `sustainedWeeklyMileage`'s own four-week look-back:
 * a belief that has not been refreshed for as long as its own evidence window
 * is stale enough to say so. A future session with a firmer number should
 * replace this constant rather than add a second one beside it.
 */
import type { PoolClient } from 'pg';
import { RUNNER_BELIEFS_TABLE } from './schema';
import { fromRow, type RawBeliefRow, type StoredBelief, type BeliefRegistry } from './record';

export const STORE_STALENESS_HALF_LIFE_DAYS = 14;

/** How much of a stored confidence survives `ageDays` since it was computed.
 *  1 at age 0, asymptotic toward 0, never negative, never above 1. */
export function storeStalenessFactor(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / STORE_STALENESS_HALF_LIFE_DAYS);
}

function ageDaysOf(computedAtISO: string, asOfISO: string): number {
  const computed = Date.parse(computedAtISO);
  const asOf = Date.parse(asOfISO);
  if (!Number.isFinite(computed) || !Number.isFinite(asOf)) return 0;
  return Math.max(0, (asOf - computed) / 86_400_000);
}

/**
 * Apply the store's own staleness discount to an already-loaded belief. Pure
 * — takes the belief and an as-of instant, returns a new object. Never mutates
 * the stored row; `read.ts`'s callers decide whether to spend the raw or the
 * decayed confidence, and both are visible on the returned value (`confidence`
 * is decayed, `rawConfidence` and `ageDays` are carried so a caller or a test
 * can see exactly what happened).
 */
export interface DecayedBelief<T> extends StoredBelief<T> {
  readonly rawConfidence: number | null;
  readonly ageDays: number;
}

export function withStoreStaleness<T>(belief: StoredBelief<T>, asOfISO: string): DecayedBelief<T> {
  const ageDays = ageDaysOf(belief.computedAtISO, asOfISO);
  const rawConfidence = belief.confidence;
  const confidence = rawConfidence == null ? null : rawConfidence * storeStalenessFactor(ageDays);
  return { ...belief, confidence, rawConfidence, ageDays };
}

/** The newest row for one key, undecayed. Null when nothing has ever been
 *  stamped for this runner and key — itself a fact (Rule 11): "never stored"
 *  is not the same as "stored ABSENT", and a caller that wants to tell them
 *  apart can — `readLatestBelief` returning null is the first, a stored row
 *  whose `reading.ok === false` is the second. */
export async function readLatestBelief<T>(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  registry: BeliefRegistry,
  beliefKey: string,
): Promise<StoredBelief<T> | null> {
  const r = await exec.query<RawBeliefRow>(
    `SELECT * FROM ${RUNNER_BELIEFS_TABLE}
      WHERE user_uuid = $1::uuid AND registry = $2 AND belief_key = $3
      ORDER BY stored_at DESC LIMIT 1`,
    [userUuid, registry, beliefKey],
  );
  const row = r.rows[0];
  return row ? fromRow<T>(row) : null;
}

/** The newest row for EVERY key this runner has ever had stamped — the whole
 *  belief state, in one query, for step 1 of the orchestrator. `DISTINCT ON`
 *  rather than a self-join: one scan, ordered the same way `readLatestBelief`
 *  orders a single key, so the two cannot disagree about what "latest" means. */
export async function readAllLatestBeliefs(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
): Promise<ReadonlyArray<StoredBelief<unknown>>> {
  const r = await exec.query<RawBeliefRow>(
    `SELECT DISTINCT ON (registry, belief_key) *
       FROM ${RUNNER_BELIEFS_TABLE}
      WHERE user_uuid = $1::uuid
      ORDER BY registry, belief_key, stored_at DESC`,
    [userUuid],
  );
  return r.rows.map((row) => fromRow<unknown>(row));
}

/** Every row ever stamped for one plan lineage, oldest first — the
 *  rebuild-survival proof's raw material: a lineage that carries continuously
 *  across a rebuild has rows spanning both the replaced and the successor
 *  plan under the SAME `plan_lineage_id`. */
export async function readLineageHistory(
  exec: Pick<PoolClient, 'query'>,
  userUuid: string,
  planLineageId: string,
): Promise<ReadonlyArray<StoredBelief<unknown>>> {
  const r = await exec.query<RawBeliefRow>(
    `SELECT * FROM ${RUNNER_BELIEFS_TABLE}
      WHERE user_uuid = $1::uuid AND plan_lineage_id = $2
      ORDER BY stored_at ASC`,
    [userUuid, planLineageId],
  );
  return r.rows.map((row) => fromRow<unknown>(row));
}
