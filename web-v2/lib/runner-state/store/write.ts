/**
 * lib/runner-state/store/write.ts · THE ONE INSERT INTO `runner_beliefs`.
 *
 * Append-only, per `schema.ts`'s header: no `UPDATE`, ever. "The current
 * belief" is defined at READ time (`read.ts`) as the newest row for a
 * `(user_uuid, registry, belief_key)`, never mutated in place.
 */
import type { PoolClient } from 'pg';
import { RUNNER_BELIEFS_TABLE } from './schema';
import { toInsertParams } from './record';
import type { Belief } from '../belief';
import { fromBelief } from './record';
import type { BeliefRegistry } from './record';
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { BeliefEstimate, BeliefImmovable, BeliefLever, BeliefTension, EvidenceRecency, EvidenceRef, Rule8Side } from '../belief';

const INSERT_SQL = `
  INSERT INTO ${RUNNER_BELIEFS_TABLE} (
    user_uuid, registry, belief_key, plan_lineage_id,
    reading_ok, reading_value, reading_absent_reason,
    confidence, source_mode,
    supporting, contradicting, tension, recency,
    rule8_side, moves_up_on, moves_down_on, never_moves_on,
    owner_module, owner_symbol, owner_answers,
    computed_at, model_version
  ) VALUES (
    $1::uuid, $2, $3, $4,
    $5, $6::jsonb, $7::jsonb,
    $8, $9,
    $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb,
    $14, $15::jsonb, $16::jsonb, $17::jsonb,
    $18, $19, $20,
    $21, $22
  )
  RETURNING id::text AS id, stored_at
`;

export interface WrittenBelief {
  readonly id: string;
  readonly storedAtISO: string;
}

/** Stamp any belief-shaped reading — used by both `stampBelief` (a `Belief<T>`
 *  from `belief.ts`) and `stampQuantity` (a plainer quantity reading with no
 *  `belief.ts` counterpart). One SQL statement; two thin, honest callers. */
async function insertRow(
  exec: Pick<PoolClient, 'query'>,
  params: unknown[],
): Promise<WrittenBelief> {
  const r = await exec.query<{ id: string; stored_at: string | Date }>(INSERT_SQL, params);
  const row = r.rows[0];
  if (!row) throw new Error('runner_beliefs insert returned no row');
  const storedAt = row.stored_at;
  return { id: row.id, storedAtISO: typeof storedAt === 'string' ? storedAt : storedAt.toISOString() };
}

/**
 * Persist a `Belief<T>` a loader already built from its registered owner.
 * Every field on the row is copied from the belief unchanged — this function
 * computes nothing.
 */
export async function stampBelief<T>(
  exec: Pick<PoolClient, 'query'>,
  belief: Belief<T>,
  ctx: { readonly userUuid: string; readonly planLineageId: string; readonly modelVersion: string },
): Promise<WrittenBelief> {
  const args = fromBelief(belief, ctx);
  return insertRow(exec, toInsertParams(args));
}

/**
 * Persist a QUANTITY reading (a `QuantityId` from `quantity-owners.ts`) that
 * has no `belief.ts` counterpart — a prescription ceiling such as
 * THRESHOLD_DOSE, computed by calling the registry's own OWNER function.
 * Shaped identically to `Belief<T>` on the wire (same jsonb columns) so
 * `read.ts` needs no second code path, but built from a plain args object
 * rather than requiring the caller to construct a full `Belief<T>` for a
 * quantity that `belief.ts` never claimed to model.
 */
export async function stampQuantity(
  exec: Pick<PoolClient, 'query'>,
  args: {
    readonly quantityId: string;
    readonly reading: Measured<BeliefEstimate<number>>;
    readonly confidence: number | null;
    readonly sourceMode: string | null;
    readonly supporting: readonly EvidenceRef[];
    readonly contradicting: readonly EvidenceRef[];
    readonly tension: BeliefTension | null;
    readonly recency: EvidenceRecency | null;
    readonly rule8Side: Rule8Side;
    readonly movesUpOn: readonly BeliefLever[];
    readonly movesDownOn: readonly BeliefLever[];
    readonly neverMovesOn: readonly BeliefImmovable[];
    readonly owner: { readonly module: string; readonly symbol: string; readonly answers: string };
    readonly computedAtISO: string;
  },
  ctx: { readonly userUuid: string; readonly planLineageId: string; readonly modelVersion: string },
): Promise<WrittenBelief> {
  const registry: BeliefRegistry = 'QUANTITY';
  return insertRow(exec, toInsertParams({
    userUuid: ctx.userUuid,
    registry,
    beliefKey: args.quantityId,
    planLineageId: ctx.planLineageId,
    reading: args.reading,
    confidence: args.confidence,
    sourceMode: args.sourceMode,
    supporting: args.supporting,
    contradicting: args.contradicting,
    tension: args.tension,
    recency: args.recency,
    rule8Side: args.rule8Side,
    movesUpOn: args.movesUpOn,
    movesDownOn: args.movesDownOn,
    neverMovesOn: args.neverMovesOn,
    owner: args.owner,
    computedAtISO: args.computedAtISO,
    modelVersion: ctx.modelVersion,
  }));
}
