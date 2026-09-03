/**
 * lib/adaptation/canonical-shadow/run-live-shadow-evaluation.ts · THE ONE
 * LIVE, READ-ONLY ENTRY POINT INTO THE CANONICAL ADAPTATION ENGINE.
 *
 * David's own words: "Wire the canonical Adaptation Engine into live shadow
 * evaluation only... Keep live automatic mutation disabled... Complete
 * historical replay, shadow evaluation, and owner-visible proposals."
 * Historical replay (`scripts/adaptation-real-replay/`) and the engine
 * itself (`lib/adaptation/canonical/`) are already built. This file is what
 * was missing: running `evaluateAdaptation` against the runner's CURRENT
 * live state, on the existing cron cadence, and persisting what it decided.
 *
 * ── THIS IS THE ONE AUTHORIZED IMPORTER OF `canonical/evaluate.ts` ─────────
 *
 * `lib/adaptation/canonical/_cannot_mutate.test.ts` guard 4 forbids any
 * importer of `lib/adaptation/canonical` from outside that directory. This
 * file is now the ONE deliberate, narrowly-scoped exception — see that
 * test's own updated header for exactly how the allowlist is shaped (by
 * FILE and by IMPORTED SYMBOL, not by directory), and
 * `_never_mutates_plan.test.ts` in this directory for the falsified proof
 * that this file itself cannot write anything but its own shadow-log row.
 *
 * ── WHY THIS IS SAFE TO CALL evaluateAdaptation() AT ALL ───────────────────
 *
 * `evaluateAdaptation` is pure (`evaluate.ts`'s own header: "it takes plain
 * values and returns plain values... structurally incapable, not carefully
 * behaved"). This file's ENTIRE job is building its input read-only
 * (`live-input.ts`, over the fenced `read-only-db.ts` connection) and
 * recording its output (`shadow-log-writer.ts`, allow-listed to one INSERT
 * shape against one table). Nothing here ever calls a lever's proposed
 * `planDiff` against a real plan row. Nothing here ever imports a
 * plan-writing function — `_never_mutates_plan.test.ts` proves that from
 * source, the same discipline `_cannot_mutate.test.ts` already applies to
 * the engine itself.
 *
 * ── RULE 23 · THIS JOB ENSURES ITS OWN PRECONDITIONS ────────────────────────
 *
 * It does not assume the LTHR re-anchor or any other job has already run
 * this cycle. `live-input.ts` reads the plan's CURRENTLY authored threshold
 * pace directly — whatever it is at the moment this function runs — and
 * refuses loudly (a `skipped` result naming why) rather than silently
 * proceeding when the plan or its evidence cannot be read. Being invoked
 * late, early, or twice in one day changes nothing about correctness: the
 * idempotency key (`athlete · plan version · evidence version · lever ·
 * boundary`) already de-duplicates identical evidence, and a second run
 * against unchanged evidence is a no-op write, not a double-count.
 */
import { evaluateAdaptation } from '@/lib/adaptation/canonical/evaluate';
import type { CanonicalDecisionRecord } from '@/lib/adaptation/canonical/decision-record';
import { buildLiveCanonicalInput } from './live-input';
import { roQuery, readOnlyConnectionConfigured } from './read-only-db';
import { insertShadowRecord, CANONICAL_ADAPTATION_SHADOW_LOG_TABLE } from './shadow-log-writer';

export interface LiveShadowEvaluationResult {
  readonly userUuid: string;
  readonly ran: boolean;
  /** Present when `ran` is false, or when it ran but persisted nothing. */
  readonly detail: string;
  readonly records: readonly {
    lever: CanonicalDecisionRecord['lever'];
    decision: CanonicalDecisionRecord['decision'];
    persisted: boolean;
  }[];
}

let tableExists: boolean | null = null;

/** Probed once per process, mirroring `shadow-compare.ts`'s own posture —
 *  cheap, and re-probing every cycle would cost more than the rare case of
 *  a migration landing mid-process is worth. */
async function shadowLogTableExists(): Promise<boolean> {
  if (tableExists != null) return tableExists;
  try {
    const r = await roQuery<{ reg: string | null }>(
      `SELECT to_regclass('public.${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE}')::text AS reg`,
    );
    tableExists = r.rows[0]?.reg != null;
  } catch {
    tableExists = false;
  }
  return tableExists;
}

/** Test-only reset, mirroring `_resetShadowTableProbeForTests` in
 *  `shadow-compare.ts`. Never called from application code. */
export function _resetTableProbeForTests(): void {
  tableExists = null;
}

async function previouslyEmittedKeysFor(userUuid: string): Promise<ReadonlySet<string>> {
  if (!(await shadowLogTableExists())) return new Set();
  try {
    const r = await roQuery<{ idempotency_key: string }>(
      `SELECT DISTINCT idempotency_key FROM ${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE}
        WHERE user_uuid = $1::uuid
        ORDER BY idempotency_key`,
      [userUuid],
    );
    return new Set(r.rows.map((row) => row.idempotency_key));
  } catch (e) {
    // Rule 11 · a failed read of prior keys is not the same as "no prior
    // keys". Treated as empty ONLY because the consequence of getting this
    // wrong is bounded and named: at worst one already-raised, already-
    // suppressed record is written again on the same evidence, which the
    // idempotency key on the ROW ITSELF still records honestly (Rule 16 —
    // the row says what it is, whether or not the caller could dedupe it
    // against history). Logged rather than silently swallowed.
    console.warn('[canonical-shadow] could not read prior idempotency keys:', e instanceof Error ? e.message : e);
    return new Set();
  }
}

async function persistOne(userUuid: string, r: CanonicalDecisionRecord): Promise<boolean> {
  if (!(await shadowLogTableExists())) return false;
  try {
    // The table name is written LITERALLY here rather than through
    // `${CANONICAL_ADAPTATION_SHADOW_LOG_TABLE}` on purpose: `writesIn()`
    // (`_cannot_mutate.test.ts`, reused by this directory's own
    // `_never_mutates_plan.test.ts` guard 1) scans SOURCE TEXT for
    // `INSERT INTO <literal table name>` and cannot see through a template
    // interpolation. An interpolated name would make the one real write in
    // this whole directory invisible to the exact gate meant to watch it —
    // safe by omission, but omission is not what Rule 18 asks for. The
    // assertion two lines down is what keeps this literal from silently
    // drifting away from the constant `shadow-log-writer.ts` itself is
    // allow-listed to.
    if (CANONICAL_ADAPTATION_SHADOW_LOG_TABLE !== 'canonical_adaptation_shadow_log') {
      throw new Error(
        'CANONICAL_ADAPTATION_SHADOW_LOG_TABLE no longer matches the literal table name written '
        + 'in this INSERT — keep them in sync, never edit just one of the two.',
      );
    }
    await insertShadowRecord(
      `INSERT INTO canonical_adaptation_shadow_log (
         user_uuid, plan_id,
         contract_version, plan_version, evidence_version, evaluated_at_iso, boundary, idempotency_key,
         lever, belief, race, goal, gap,
         evidence_included, evidence_excluded, contradictory, window_days, confidence,
         decision, before_value, proposed_after_value, magnitude, affected_workout_ids, plan_diff, invariants,
         reason, what_would_change_it, rollback, suppressed_by,
         source
       ) VALUES (
         $1,$2, $3,$4,$5,$6,$7,$8, $9,$10,$11,$12,$13,
         $14,$15,$16,$17,$18, $19,$20,$21,$22,$23,$24,$25,
         $26,$27,$28,$29, $30
       )`,
      [
        userUuid, r.planVersion,
        r.contractVersion, r.planVersion, r.evidenceVersion, r.evaluatedAtISO, r.boundary, r.idempotencyKey,
        r.lever, JSON.stringify(r.belief), JSON.stringify(r.race), JSON.stringify(r.goal), r.gap,
        JSON.stringify(r.evidenceIncluded), JSON.stringify(r.evidenceExcluded), JSON.stringify(r.contradictory),
        r.windowDays, JSON.stringify(r.confidence),
        r.decision, r.beforeValue, r.proposedAfterValue,
        r.magnitude ? JSON.stringify(r.magnitude) : null,
        r.affectedWorkoutIds, JSON.stringify(r.planDiff), JSON.stringify(r.invariants),
        r.reason, JSON.stringify(r.whatWouldChangeIt), r.rollback ? JSON.stringify(r.rollback) : null,
        r.suppressedBy ? JSON.stringify(r.suppressedBy) : null,
        'cron_run_adaptations_canonical_shadow',
      ],
    );
    return true;
  } catch (e) {
    console.warn(`[canonical-shadow] insert failed for ${userUuid} · ${r.lever}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * ONE cycle, for one athlete. Never throws — every failure is caught,
 * logged, and reported in the result, matching every other best-effort step
 * the `run-adaptations` cron already wires in (`updateCoachLog`,
 * `reanchorLthr`, `runAndPersistPaceShadowCompare`).
 */
export async function runAndPersistCanonicalShadowEvaluation(
  userUuid: string,
): Promise<LiveShadowEvaluationResult> {
  if (!readOnlyConnectionConfigured()) {
    return {
      userUuid, ran: false,
      detail: 'DATABASE_URL_RO is not configured · live canonical shadow evaluation cannot run.',
      records: [],
    };
  }

  let built: Awaited<ReturnType<typeof buildLiveCanonicalInput>>;
  try {
    built = await buildLiveCanonicalInput(userUuid);
  } catch (e) {
    return {
      userUuid, ran: false,
      detail: `Building live input failed: ${e instanceof Error ? e.message : String(e)}`,
      records: [],
    };
  }
  if (!built.input) {
    return { userUuid, ran: false, detail: built.refusal ?? 'No input could be built.', records: [] };
  }

  const previouslyEmittedKeys = await previouslyEmittedKeysFor(userUuid);

  // The engine itself never throws (its own header: a refusal is a
  // successful output). No try/catch is needed around the pure call, but
  // one wraps it anyway — a defensive boundary this file's own header
  // promises ("never throws"), proven rather than assumed.
  let evaluation: ReturnType<typeof evaluateAdaptation>;
  try {
    evaluation = evaluateAdaptation(built.input, previouslyEmittedKeys);
  } catch (e) {
    return {
      userUuid, ran: false,
      detail: `evaluateAdaptation threw, which its own contract says never happens: ${e instanceof Error ? e.message : String(e)}`,
      records: [],
    };
  }

  const results: LiveShadowEvaluationResult['records'] = [];
  for (const r of evaluation.records) {
    const persisted = await persistOne(userUuid, r);
    results.push({ lever: r.lever, decision: r.decision, persisted });
  }

  const anyTable = await shadowLogTableExists();
  return {
    userUuid, ran: true,
    detail: anyTable
      ? `${results.filter((r) => r.persisted).length}/${results.length} records persisted.`
      : `evaluated but not persisted — canonical_adaptation_shadow_log does not exist yet `
        + `(migration 164 not applied on this database).`,
    records: results,
  };
}
