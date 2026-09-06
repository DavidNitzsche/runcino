/**
 * lib/runner-state/store/record.ts · THE PERSISTED SHAPE, AND THE ONE PLACE A
 * `Belief<T>` (OR A QUANTITY READING) IS SERIALIZED TO AND FROM A ROW.
 *
 * `belief.ts` defines what a belief IS. `schema.ts` defines what a ROW is.
 * This file is the only bridge between them, so there is exactly one place
 * that decides "what does `reading_ok = false` mean when I read it back" —
 * never re-decided per call site, which is the same discipline
 * `ledger-entry.ts` applies to `plan_decision_ledger`'s columns.
 *
 * Nothing here calls a database and nothing here calls an owner. `import
 * type` only from `belief.ts`, so this module is as pure as that one.
 */
import type {
  Belief,
  BeliefEstimate,
  BeliefImmovable,
  BeliefKey,
  BeliefLever,
  BeliefTension,
  EvidenceRecency,
  EvidenceRef,
  Rule8Side,
} from '../belief';
import type { Measured } from '@/lib/adaptation/canonical/input';
import type { QuantityId } from '../quantity-owners';

/** Which vocabulary `belief_key` is drawn from. See `schema.ts`'s own CHECK. */
export type BeliefRegistry = 'BELIEF' | 'QUANTITY';

/**
 * The full row, deserialized. Generic over `T` the same way `Belief<T>` is —
 * the caller who asked for `THRESHOLD_PACE` knows it is a number, and nothing
 * in this file needs to know that to store or retrieve it.
 */
export interface StoredBelief<T> {
  readonly userUuid: string;
  readonly registry: BeliefRegistry;
  /** A `BeliefKey` when `registry === 'BELIEF'`, a `QuantityId` when `'QUANTITY'`. */
  readonly beliefKey: BeliefKey | QuantityId;
  readonly planLineageId: string;
  readonly reading: Measured<BeliefEstimate<T>>;
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
  /** Rule 10 · when the owner resolved this, not when it was written. */
  readonly computedAtISO: string;
  readonly modelVersion: string;
  /** When this row was written. Only `read.ts` sets it (from the DB default). */
  readonly storedAtISO?: string;
}

/** The raw shape `pg` hands back — every jsonb column already parsed by the
 *  driver, every other column in its Postgres wire type. */
export interface RawBeliefRow {
  readonly user_uuid: string;
  readonly registry: string;
  readonly belief_key: string;
  readonly plan_lineage_id: string;
  readonly reading_ok: boolean;
  readonly reading_value: unknown;
  readonly reading_absent_reason: unknown;
  readonly confidence: number | string | null;
  readonly source_mode: string | null;
  readonly supporting: unknown;
  readonly contradicting: unknown;
  readonly tension: unknown;
  readonly recency: unknown;
  readonly rule8_side: string;
  readonly moves_up_on: unknown;
  readonly moves_down_on: unknown;
  readonly never_moves_on: unknown;
  readonly owner_module: string;
  readonly owner_symbol: string;
  readonly owner_answers: string;
  readonly computed_at: string | Date;
  readonly model_version: string;
  readonly stored_at: string | Date;
}

function isoOf(v: string | Date): string {
  return typeof v === 'string' ? v : v.toISOString();
}

/** Row -> typed belief. The one deserialization path. */
export function fromRow<T>(row: RawBeliefRow): StoredBelief<T> {
  const reading: Measured<BeliefEstimate<T>> = row.reading_ok
    ? { ok: true, value: row.reading_value as BeliefEstimate<T> }
    : { ok: false, why: row.reading_absent_reason as { kind: 'ABSENT' | 'FAILED'; what: string } };
  return {
    userUuid: row.user_uuid,
    registry: row.registry as BeliefRegistry,
    beliefKey: row.belief_key as BeliefKey | QuantityId,
    planLineageId: row.plan_lineage_id,
    reading,
    confidence: row.confidence == null ? null : Number(row.confidence),
    sourceMode: row.source_mode,
    supporting: (row.supporting as EvidenceRef[]) ?? [],
    contradicting: (row.contradicting as EvidenceRef[]) ?? [],
    tension: (row.tension as BeliefTension | null) ?? null,
    recency: (row.recency as EvidenceRecency | null) ?? null,
    rule8Side: row.rule8_side as Rule8Side,
    movesUpOn: (row.moves_up_on as BeliefLever[]) ?? [],
    movesDownOn: (row.moves_down_on as BeliefLever[]) ?? [],
    neverMovesOn: (row.never_moves_on as BeliefImmovable[]) ?? [],
    owner: { module: row.owner_module, symbol: row.owner_symbol, answers: row.owner_answers },
    computedAtISO: isoOf(row.computed_at),
    modelVersion: row.model_version,
    storedAtISO: isoOf(row.stored_at),
  };
}

/** The bound INSERT parameters, in `schema.ts`'s column order (minus `id`
 *  and `stored_at`, which the table assigns). One definition so `write.ts`
 *  and any future writer cannot drift on column order. */
export function toInsertParams(args: {
  readonly userUuid: string;
  readonly registry: BeliefRegistry;
  readonly beliefKey: string;
  readonly planLineageId: string;
  readonly reading: Measured<BeliefEstimate<unknown>>;
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
  readonly modelVersion: string;
}): unknown[] {
  const readingOk = args.reading.ok;
  return [
    args.userUuid,
    args.registry,
    args.beliefKey,
    args.planLineageId,
    readingOk,
    readingOk ? JSON.stringify((args.reading as { ok: true; value: unknown }).value) : null,
    readingOk ? null : JSON.stringify((args.reading as { ok: false; why: unknown }).why),
    args.confidence,
    args.sourceMode,
    JSON.stringify(args.supporting),
    JSON.stringify(args.contradicting),
    args.tension == null ? null : JSON.stringify(args.tension),
    args.recency == null ? null : JSON.stringify(args.recency),
    args.rule8Side,
    JSON.stringify(args.movesUpOn),
    JSON.stringify(args.movesDownOn),
    JSON.stringify(args.neverMovesOn),
    args.owner.module,
    args.owner.symbol,
    args.owner.answers,
    args.computedAtISO,
    args.modelVersion,
  ];
}

/**
 * `Belief<T>` (from `belief.ts`, already built by a loader) -> the store's
 * write args. Pure reshaping — every field is carried through unchanged, none
 * computed, which is the whole point: the store never re-derives what a
 * loader already resolved from the registered owner.
 */
export function fromBelief<T>(
  belief: Belief<T>,
  ctx: { userUuid: string; planLineageId: string; modelVersion: string },
): Parameters<typeof toInsertParams>[0] {
  return {
    userUuid: ctx.userUuid,
    registry: 'BELIEF',
    beliefKey: belief.key,
    planLineageId: ctx.planLineageId,
    reading: belief.reading as Measured<BeliefEstimate<unknown>>,
    confidence: belief.confidence,
    sourceMode: belief.sourceMode,
    supporting: belief.supporting,
    contradicting: belief.contradicting,
    tension: belief.tension,
    recency: belief.recency,
    rule8Side: belief.rule8Side,
    movesUpOn: belief.movesUpOn,
    movesDownOn: belief.movesDownOn,
    neverMovesOn: belief.neverMovesOn,
    owner: belief.owner,
    computedAtISO: belief.lastUpdatedISO,
    modelVersion: ctx.modelVersion,
  };
}
