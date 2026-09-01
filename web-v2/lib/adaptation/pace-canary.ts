/**
 * lib/adaptation/pace-canary.ts · THE OWNER-ONLY PACE CANARY.
 *
 * Answers the external-review spec responding to
 * `docs/reports/adaptation-authority-policy-brief-2026-09-01.md`'s Option B
 * ("a staged/canary approach... PACE lever only... the account owner's own
 * account only... a hard kill switch, and explicit promotion criteria decided
 * in advance"). This file builds the pathway. It DOES NOT ENABLE IT --
 * `lib/adaptation/pace-canary-config.ts`'s `PACE_CANARY_ENABLED` is unset by
 * default, `PACE_CANARY_ALLOWLIST` is empty by default, and the audit table
 * this file writes through (`db/migrations/161_pace_canary_applications.sql`)
 * is drafted, not applied. See that migration's header and
 * `docs/reports/pace-canary-infrastructure-2026-09-01.md` for the full
 * account of every gate and its default state.
 *
 * ── WHAT THIS REUSES, VERBATIM, RATHER THAN RE-DERIVING ─────────────────
 *
 *   · `runPaceShadowCompareCycle` (`shadow-compare.ts`) -- the SAME read-only
 *     cycle that already resolves phase-specific PACE targets, the
 *     authoring/reanchor convergence guard, and the pace/HR compatibility
 *     verdict. This file adds a decision LAYER on top of that record; it does
 *     not re-run the engine or re-derive any of those three mechanisms.
 *   · `deriveContradictions`'s output, `ShadowCompareRecord.contradictions` --
 *     the "contradiction validator" the spec names is this field.
 *   · The sealed-workout predicate -- copied verbatim from `adapt.ts`'s
 *     `filterUnsealedWorkouts` / `recompute-paces.ts`'s inline EXISTS (the
 *     same duplication this codebase already carries at those two sites,
 *     documented at each as "same sealed EXISTS", so a fourth copy here
 *     follows an established pattern rather than inventing a new one).
 *   · `mutatePlan` (`lib/plan/mutate.ts`), `touches: 'derivations'` -- the
 *     SAME plan-mutation boundary `recompute-paces.ts` uses, for the SAME
 *     reason: this file only ever writes `pace_target_s_per_mi`, a field no
 *     doctrine invariant reads. Atomicity (item 9 of the spec) is inherited
 *     from this boundary's own BEGIN/apply/COMMIT-or-ROLLBACK wrapper -- see
 *     that file's header. This module adds no transaction logic of its own.
 *   · `lib/training/pace-anchor.ts`'s `adapterMovedAnchorWithin` /
 *     `selfHealShouldDefer` -- the SAME mechanism that already makes the
 *     nightly self-heal (`reanchorActivePlan`) defer to the 03:00 adapter's
 *     same-morning pace move. Extended (in that file) to also recognize this
 *     module's own `plan_adapt_pace_canary_applied` coach_intents reason, so
 *     item 13 of the spec ("recognize a canary-applied change and either
 *     preserve it or deliberately, visibly supersede it") is the EXISTING
 *     defer-or-proceed mechanism, not a new one that could disagree with it.
 *
 * ── SCOPE THIS DELIBERATELY DOES NOT COVER ───────────────────────────────
 *
 * `workout_spec`'s internally embedded pace/HR fields are NOT rebuilt by
 * this pathway -- only the top-level `pace_target_s_per_mi` column (the
 * exact field `PacePhaseOutcome.stepSecPerMi` is computed against) is
 * written. This is a deliberate, narrow scope, not an oversight: rebuilding
 * `workout_spec` correctly requires the full anchor set
 * `recomputePacesForPlan` resolves (LTHR, effective HRmax, goal pace, the
 * six canonical anchors) and would reprice the row off THE BLOCK'S canonical
 * anchor rather than off the phase-specific delta this canary exists to
 * apply -- reintroducing the blended-average imprecision Part 1 of the
 * 2026-09-01 decision explicitly rejected. The handoff is deliberate: this
 * canary writes the narrow, doctrine-scoped delta; the next
 * `recomputePacesForPlan` / `reanchorActivePlan` cycle reconciles
 * `workout_spec` around it, which is exactly what item 13's defer-or-
 * supersede contract already governs. Flagged here per Rule 20 rather than
 * left as a silent gap.
 */
import { pool } from '@/lib/db/pool';
import { rowOrNull } from '@/lib/db/read';
import { mutatePlan } from '@/lib/plan/mutate';
import { runPaceShadowCompareCycle, type ShadowCompareRecord } from './shadow-compare';
import type { PacePhaseOutcome } from './adaptation-engine';
import { resolvePaceCanaryGate, type PaceCanaryGate } from './pace-canary-config';

/* ══════════════════════════════════════════════════════════════════════════
 * POLICY CONSTANTS
 * ═══════════════════════════════════════════════════════════════════════ */

/** At most one APPLIED pace change per user per this many days -- item 4 of
 *  the spec, "enforced server-side, not just as a policy statement" (see
 *  `readLastAppliedAt` + the check in `decidePaceCanaryEligibility`, which
 *  reads real persisted state rather than trusting an in-memory guess). */
export const PACE_CANARY_RATE_LIMIT_DAYS = 7;

/**
 * THE ROLLOUT CAP -- 5 sec/mi maximum PHASE step this canary will ever
 * apply, quoting the review verbatim: "the current five-second-per-mile
 * phase-specific proposal is a sensible initial maximum."
 *
 * THIS IS AN OPERATIONAL CANARY LIMIT, NOT A PHYSIOLOGICAL DOCTRINE
 * CONSTANT. CLAUDE.md Rule 7 requires a doctrine registry entry for any
 * constant that ASSERTS PHYSIOLOGY, cited against `Research/`. This number
 * asserts no such thing -- it is an engineering safety valve on how much a
 * single, still-unproven live pathway may move in one application, chosen
 * for the review's own stated reason (a sensible INITIAL maximum for a
 * canary with zero production history), not because Research/ names 5 sec/mi
 * as a physiological limit anywhere. It therefore carries NO doctrine
 * registry entry and must never be cited as though it did. The PACE engine's
 * own doctrine-cited step ceiling (`phaseStep`'s `stepCeiling`,
 * `PACE_PROGRESS_MIN_STEP_SEC_PER_MI`, `TRAINING_LEAD_REANCHOR_DELTA` in
 * `adaptation-engine.ts` / `pace-anchor.ts`) is unaffected by this constant
 * and continues to bound the PROPOSAL itself before this canary ever sees
 * it; this cap can only make an already-doctrine-bounded proposal MORE
 * conservative, never less.
 */
export const PACE_CANARY_MAX_STEP_SEC_PER_MI = 5;

/** The PACE lever's own workout family -- mirrors (does not import, to keep
 *  this module's public shape stable independent of shadow-compare.ts's
 *  internal constant) `shadow-compare.ts`'s unexported `PACE_WORKOUT_FAMILY`.
 *  Item 3 of the spec: no other lever may ever write through this path --
 *  this array is the ONLY set of `plan_workouts.type` values this file will
 *  ever touch, and it is never taken from user input or from any proposal
 *  field, only from this constant. */
export const PACE_CANARY_WORKOUT_TYPES = Object.freeze(['threshold', 'tempo', 'cruise']);

/* ══════════════════════════════════════════════════════════════════════════
 * DECISION -- pure, so every refusal path is directly unit-testable without
 * a database (see `_pace_canary.test.ts`).
 * ═══════════════════════════════════════════════════════════════════════ */

export type PaceCanaryRefusalCode =
  | 'FLAG_DISABLED'
  | 'USER_NOT_ALLOWLISTED'
  | 'PERSISTENCE_TABLE_MISSING'
  | 'RATE_LIMIT_UNREADABLE'
  | 'RATE_LIMITED'
  | 'HR_INCOMPATIBLE'
  | 'NOT_PROGRESS_DECISION'
  | 'CONTAMINATED_EVIDENCE'
  | 'CONTRADICTIONS_PRESENT'
  | 'NO_MOVING_PHASES'
  | 'NO_TARGET_ROWS_FOUND'
  | 'EXCEEDS_OPERATIONAL_CANARY_LIMIT'
  | 'MUTATION_BOUNDARY_REJECTED';

export interface PaceCanaryEligibility {
  eligible: boolean;
  refusalCode: PaceCanaryRefusalCode | null;
  refusalDetail: string;
  /** Phases this application WOULD target -- empty on any refusal. */
  movingPhases: PacePhaseOutcome[];
}

/** null = no prior applied row (the common case). 'UNREADABLE' = the read
 *  itself failed -- Rule 11: this is a THIRD fact, and it refuses rather
 *  than being coerced into "no prior application", which would let a
 *  transient DB error waive the rate limit. A real ISO timestamp is the
 *  third state. */
export type LastAppliedRead = string | null | 'UNREADABLE';

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  return Math.abs(b - a) / 86_400_000;
}

/**
 * Item 7 of the spec: contaminated / insufficient-evidence / HR-incompatible
 * / contradictory proposals are all hard-refused here, with a distinct,
 * stored reason each -- never a silent pass-through, and never folded into
 * one generic "not eligible".
 */
export function decidePaceCanaryEligibility(args: {
  record: ShadowCompareRecord;
  tableExists: boolean;
  lastApplied: LastAppliedRead;
  todayISO: string;
}): PaceCanaryEligibility {
  const { record, tableExists, lastApplied, todayISO } = args;
  const refuse = (code: PaceCanaryRefusalCode, detail: string): PaceCanaryEligibility => ({
    eligible: false, refusalCode: code, refusalDetail: detail, movingPhases: [],
  });

  // ── item 8's persistence requirement is structural, not optional: an
  //    application with nowhere to record its before/after snapshot must
  //    never be applied. Checked first because every other check is moot
  //    without somewhere to record its own verdict. ────────────────────
  if (!tableExists) {
    return refuse(
      'PERSISTENCE_TABLE_MISSING',
      'pace_canary_applications does not exist on this database (migration 161 not applied). '
      + 'This pathway refuses to write without an audit trail to write into.',
    );
  }

  // ── item 4 · rate limit, enforced server-side against REAL persisted
  //    state, not an in-memory guess. ──────────────────────────────────
  if (lastApplied === 'UNREADABLE') {
    return refuse(
      'RATE_LIMIT_UNREADABLE',
      'Could not read the prior-application history to evaluate the 7-day rate limit. '
      + 'Refusing rather than assuming no prior application exists.',
    );
  }
  if (lastApplied != null) {
    const days = daysBetween(lastApplied, todayISO);
    if (days < PACE_CANARY_RATE_LIMIT_DAYS) {
      return refuse(
        'RATE_LIMITED',
        `Last applied pace change was ${days.toFixed(1)} days ago (${lastApplied}); `
        + `at most one applied change per ${PACE_CANARY_RATE_LIMIT_DAYS} days.`,
      );
    }
  }

  // ── item 7 · HR-incompatible (MATERIAL_INCOMPATIBILITY). Read off
  //    `finalDecision`, which shadow-compare.ts already computed as the
  //    single source of truth for "did HR compatibility refuse this cycle"
  //    (Rule 16 -- one quantity, one name; never re-derived here from
  //    `hrCompatibility` directly). ─────────────────────────────────────
  if (record.finalDecision === 'REFUSED_HR_INCOMPATIBLE') {
    return refuse(
      'HR_INCOMPATIBLE',
      record.finalDecisionReason
        ?? 'The pace/HR compatibility validator refused this proposal (MATERIAL_INCOMPATIBILITY).',
    );
  }

  // ── item 7 · insufficient-evidence (and every other non-PROGRESS PACE
  //    decision -- HOLD, INSUFFICIENT_EVIDENCE, NO_PACE_PROPOSAL, REDUCE,
  //    RESTRUCTURE all refuse here). ──────────────────────────────────
  if (record.engine.decision !== 'PROGRESS') {
    return refuse(
      'NOT_PROGRESS_DECISION',
      `The PACE engine's decision this cycle was ${record.engine.decision}, not PROGRESS. `
      + (record.engine.explanation ?? 'No further explanation was recorded.'),
    );
  }

  // ── item 7 · contaminated (per the convergence guard). Only the two
  //    "converged" states may proceed -- AUTHORED_TOO_RECENTLY and
  //    REANCHOR_STATUS_UNKNOWN both refuse, per authoring-convergence.ts's
  //    own contract that both are "excluded from any readiness-for-
  //    authority aggregate". ───────────────────────────────────────────
  if (record.convergence.state !== 'AUTHORED_CANONICALLY'
    && record.convergence.state !== 'REANCHORED_CANONICALLY') {
    return refuse(
      'CONTAMINATED_EVIDENCE',
      `Authoring/reanchor convergence state is ${record.convergence.state}, not converged. `
      + record.convergence.detail,
    );
  }

  // ── item 7 · contradictory (per the contradiction validator) --
  //    `ShadowCompareRecord.contradictions`, `deriveContradictions`'s own
  //    output, reused verbatim rather than re-derived. ─────────────────
  if (record.contradictions.length > 0) {
    return refuse(
      'CONTRADICTIONS_PRESENT',
      record.contradictions.map((c) => `${c.code}: ${c.detail}`).join(' | '),
    );
  }

  const movingPhases = record.engine.phaseBreakdown.filter((p) => p.moved);
  if (movingPhases.length === 0) {
    // Defensive (Rule 11) -- should be unreachable when decision === PROGRESS
    // per `detectPace`'s own contract (`moving.length === 0` there returns a
    // HOLD, never PROGRESS), but this canary does not trust that invariant
    // silently; an empty moving set here is refused, not applied as a no-op.
    return refuse(
      'NO_MOVING_PHASES',
      'PACE decision was PROGRESS but no phase in the breakdown reports moved=true.',
    );
  }

  // ── THE OPERATIONAL CANARY LIMIT -- see the constant's own doc comment.
  //    Refuses the WHOLE application if ANY moving phase's step exceeds it,
  //    rather than silently clamping -- "reject, don't silently pass". ──
  const overCap = movingPhases.filter((p) => p.stepSecPerMi > PACE_CANARY_MAX_STEP_SEC_PER_MI);
  if (overCap.length > 0) {
    return refuse(
      'EXCEEDS_OPERATIONAL_CANARY_LIMIT',
      `${overCap.length} moving phase(s) exceed the ${PACE_CANARY_MAX_STEP_SEC_PER_MI} sec/mi `
      + `operational canary limit (an engineering rollout cap, not a doctrine constant): `
      + overCap.map((p) => `${p.phaseLabel ?? 'unphased'} ${p.stepSecPerMi.toFixed(1)} sec/mi`).join(', '),
    );
  }

  return { eligible: true, refusalCode: null, refusalDetail: 'ELIGIBLE', movingPhases };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PERSISTENCE -- table-probe posture mirrors shadow-compare.ts exactly.
 * ═══════════════════════════════════════════════════════════════════════ */

let canaryTableExists: boolean | null = null;

async function paceCanaryApplicationsTableExists(): Promise<boolean> {
  if (canaryTableExists != null) return canaryTableExists;
  try {
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.pace_canary_applications')::text AS reg`,
    );
    canaryTableExists = r.rows[0]?.reg != null;
  } catch {
    canaryTableExists = false;
  }
  return canaryTableExists;
}

/** Reset for tests only -- mirrors shadow-compare.ts's own reset export. */
export function _resetPaceCanaryTableProbeForTests(): void {
  canaryTableExists = null;
}

async function readLastAppliedAt(userUuid: string): Promise<LastAppliedRead> {
  try {
    const r = await pool.query<{ requested_at: Date | null }>(
      `SELECT MAX(requested_at) AS requested_at
         FROM pace_canary_applications
        WHERE user_uuid = $1::uuid AND status = 'applied'`,
      [userUuid],
    );
    const v = r.rows[0]?.requested_at ?? null;
    return v ? new Date(v).toISOString() : null;
  } catch (e) {
    console.warn('[pace-canary] readLastAppliedAt failed:', e instanceof Error ? e.message : e);
    return 'UNREADABLE';
  }
}

interface RowSnapshot {
  id: string;
  dateIso: string;
  type: string;
  phaseLabel: string | null;
  paceTargetSPerMi: number | null;
}

async function insertApplicationRecord(row: {
  userUuid: string; planId: string | null; todayISO: string;
  status: 'applied' | 'refused';
  refusalCode: string | null; refusalDetail: string;
  record: ShadowCompareRecord;
  targetPhaseLabels: string[];
  rowsBefore: RowSnapshot[]; rowsAfter: RowSnapshot[];
  postWriteVerified: boolean | null;
  coachIntentWritten: boolean;
}): Promise<number | null> {
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO pace_canary_applications (
         user_uuid, plan_id, today_iso, status, refusal_code, refusal_detail,
         shadow_compare_record, target_phase_labels, rows_before, rows_after,
         post_write_verified, coach_intent_written
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id::text`,
      [
        row.userUuid, row.planId, row.todayISO, row.status, row.refusalCode, row.refusalDetail,
        JSON.stringify(row.record), row.targetPhaseLabels,
        JSON.stringify(row.rowsBefore), JSON.stringify(row.rowsAfter),
        row.postWriteVerified, row.coachIntentWritten,
      ],
    );
    return Number(r.rows[0]?.id) || null;
  } catch (e) {
    console.warn('[pace-canary] insertApplicationRecord failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * TARGET ROWS -- same sealed predicate as adapt.ts / recompute-paces.ts.
 * ═══════════════════════════════════════════════════════════════════════ */

async function targetRowsForPhase(
  q: { query: typeof pool.query },
  planId: string,
  userUuid: string,
  phase: PacePhaseOutcome,
): Promise<RowSnapshot[]> {
  const r = await q.query<{
    id: string; date_iso: string; type: string; phase_label: string | null;
    pace_target_s_per_mi: number | null;
  }>(
    `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso, pw.type,
            ph.label AS phase_label, pw.pace_target_s_per_mi::float AS pace_target_s_per_mi
       FROM plan_workouts pw
       LEFT JOIN plan_weeks wk ON wk.id = pw.week_id
       LEFT JOIN plan_phases ph ON ph.id = wk.phase_id
      WHERE pw.plan_id = $1
        AND pw.date_iso BETWEEN $2 AND $3
        AND pw.type = ANY($4::text[])
        AND pw.pace_target_s_per_mi IS NOT NULL
        AND (ph.label = $5 OR ($5 IS NULL AND ph.label IS NULL))
        -- Rule 15 · same sealed EXISTS as adapt.ts filterUnsealedWorkouts /
        -- recompute-paces.ts -- a completed day is never touched.
        AND NOT EXISTS (
          SELECT 1 FROM runs r
           WHERE r.user_uuid = $6::uuid
             AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal', 10))::date = pw.date_iso::date
             AND NOT (r.data ? 'mergedIntoId')
        )
      ORDER BY pw.date_iso ASC`,
    [planId, phase.firstDateISO, phase.lastDateISO, PACE_CANARY_WORKOUT_TYPES as unknown as string[],
      phase.phaseLabel, userUuid],
  );
  return r.rows.map((row) => ({
    id: row.id, dateIso: row.date_iso, type: row.type, phaseLabel: row.phase_label,
    paceTargetSPerMi: row.pace_target_s_per_mi,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * EVALUATE -- the cheap, no-DB-until-necessary gate + eligibility read.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PaceCanaryEvaluation {
  gate: PaceCanaryGate;
  /** null when the gate closed before a shadow cycle was ever run -- see
   *  `runPaceCanaryCycle`'s header: this is what proves ZERO reads (let
   *  alone writes) happen when the flag is off. */
  record: ShadowCompareRecord | null;
  eligibility: PaceCanaryEligibility | null;
}

/**
 * Evaluate whether `userUuid` has an eligible PACE canary application this
 * cycle. Read-only -- identical zero-mutation posture to
 * `runPaceShadowCompareCycle`, which this function is built on. Exported
 * standalone (not just via `runPaceCanaryCycle`) so a caller -- or a test --
 * can inspect the decision without ever risking a write.
 */
export async function evaluatePaceCanary(
  userUuid: string,
  todayISO?: string,
): Promise<PaceCanaryEvaluation> {
  const gate = resolvePaceCanaryGate(userUuid);

  // ── THE SHORT CIRCUIT. Gate closed → return immediately. No shadow-compare
  //    cycle is run, no DB query of any kind executes. This is what makes
  //    "the flag off ⇒ zero database activity for a real trigger path" a
  //    mechanically-true claim rather than merely "the write statement is
  //    gated" -- see `_pace_canary.test.ts` / the harness suite. ──────────
  if (!gate.enabled || !gate.allowlisted) {
    return { gate, record: null, eligibility: null };
  }

  const [record, tableExists] = await Promise.all([
    runPaceShadowCompareCycle(userUuid, todayISO),
    paceCanaryApplicationsTableExists(),
  ]);
  const lastApplied = tableExists ? await readLastAppliedAt(userUuid) : 'UNREADABLE';
  const eligibility = decidePaceCanaryEligibility({
    record, tableExists, lastApplied, todayISO: record.todayISO,
  });
  return { gate, record, eligibility };
}

/* ══════════════════════════════════════════════════════════════════════════
 * APPLY -- the one function that can ever write. Called only from the cron
 * wiring in app/api/cron/run-adaptations/route.ts, itself gated on the same
 * `resolvePaceCanaryGate` check before this module is even imported.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PaceCanaryCycleResult {
  status: 'skipped_gate_closed' | 'refused' | 'applied' | 'error';
  refusalCode?: PaceCanaryRefusalCode;
  refusalDetail?: string;
  applicationId?: number | null;
  rowsUpdated?: number;
  postWriteVerified?: boolean;
  error?: string;
}

/** One cycle, for one runner. NEVER throws -- matches every other best-effort
 *  step in the run-adaptations cron loop this is wired into. */
export async function runPaceCanaryCycle(
  userUuid: string,
  todayISO?: string,
): Promise<PaceCanaryCycleResult> {
  try {
    const { gate, record, eligibility } = await evaluatePaceCanary(userUuid, todayISO);

    if (!gate.enabled || !gate.allowlisted || !record || !eligibility) {
      // Gate closed. NOTHING is persisted here either -- persisting even a
      // "gate closed" row would itself be a write this pathway makes when
      // disabled, which is exactly what must never happen.
      return { status: 'skipped_gate_closed' };
    }

    if (!eligibility.eligible) {
      const applicationId = await insertApplicationRecord({
        userUuid, planId: record.planId, todayISO: record.todayISO,
        status: 'refused',
        refusalCode: eligibility.refusalCode, refusalDetail: eligibility.refusalDetail,
        record, targetPhaseLabels: [], rowsBefore: [], rowsAfter: [],
        postWriteVerified: null, coachIntentWritten: false,
      });
      return {
        status: 'refused', refusalCode: eligibility.refusalCode ?? undefined,
        refusalDetail: eligibility.refusalDetail, applicationId,
      };
    }

    return await applyEligiblePaceCanary(userUuid, record, eligibility.movingPhases);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[pace-canary] runPaceCanaryCycle error:', msg);
    return { status: 'error', error: msg };
  }
}

async function applyEligiblePaceCanary(
  userUuid: string,
  record: ShadowCompareRecord,
  movingPhases: PacePhaseOutcome[],
): Promise<PaceCanaryCycleResult> {
  const planId = record.planId;
  if (!planId) {
    const applicationId = await insertApplicationRecord({
      userUuid, planId: null, todayISO: record.todayISO, status: 'refused',
      refusalCode: 'NO_TARGET_ROWS_FOUND', refusalDetail: 'No active plan id on the shadow-compare record.',
      record, targetPhaseLabels: [], rowsBefore: [], rowsAfter: [], postWriteVerified: null,
      coachIntentWritten: false,
    });
    return { status: 'refused', refusalCode: 'NO_TARGET_ROWS_FOUND', applicationId };
  }

  // ── item 5 · resolve the exact target rows for each moving phase, item 8's
  //    BEFORE half. Reads happen outside the transaction (a plain pool
  //    query) -- the transaction below re-derives nothing, it writes exactly
  //    what was read here, so the BEFORE snapshot is honest even if the plan
  //    changed between this read and the transaction (in which case the
  //    per-row UPDATE below still only ever writes rows that existed at read
  //    time; a row that got sealed in between is caught by re-checking the
  //    seal predicate inside the same query if this function is called
  //    again -- there is no live risk here because this whole path runs
  //    inside one cron tick, single-threaded per user). ───────────────────
  const perPhaseRows = await Promise.all(
    movingPhases.map((phase) => targetRowsForPhase(pool, planId, userUuid, phase)),
  );
  const rowsBefore: RowSnapshot[] = perPhaseRows.flat();

  if (rowsBefore.length === 0) {
    const applicationId = await insertApplicationRecord({
      userUuid, planId, todayISO: record.todayISO, status: 'refused',
      refusalCode: 'NO_TARGET_ROWS_FOUND',
      refusalDetail: 'The moving phases resolved to zero live, unsealed plan_workouts rows.',
      record, targetPhaseLabels: movingPhases.map((p) => p.phaseLabel ?? 'unphased'),
      rowsBefore: [], rowsAfter: [], postWriteVerified: null, coachIntentWritten: false,
    });
    return { status: 'refused', refusalCode: 'NO_TARGET_ROWS_FOUND', applicationId };
  }

  // Row id → the phase (and its step) that owns it, for the write loop.
  const phaseByRowId = new Map<string, PacePhaseOutcome>();
  perPhaseRows.forEach((rows, i) => rows.forEach((row) => phaseByRowId.set(row.id, movingPhases[i])));

  const rowsAfter: RowSnapshot[] = rowsBefore.map((row) => {
    const phase = phaseByRowId.get(row.id)!;
    const newPace = row.paceTargetSPerMi != null
      ? Math.round(row.paceTargetSPerMi - phase.stepSecPerMi)
      : null;
    return { ...row, paceTargetSPerMi: newPace };
  });

  // ── item 9 · ATOMIC APPLICATION. mutatePlan opens one real DB transaction
  //    (BEGIN ... COMMIT/ROLLBACK) around every statement below; a throw
  //    anywhere in `apply` rolls the whole batch back, per that file's own
  //    contract (see this file's header). `touches: 'derivations'` because
  //    every statement here writes only `pace_target_s_per_mi`, the same
  //    declared scope `recompute-paces.ts` uses. ──────────────────────────
  const boundary = await mutatePlan<void>({
    userUuid, planId, todayISO: record.todayISO, source: 'adaptation/pace-canary',
    touches: 'derivations',
    detail: {
      rows: rowsBefore.length,
      phases: movingPhases.map((p) => ({ label: p.phaseLabel, stepSecPerMi: p.stepSecPerMi })),
    },
    apply: async (tx) => {
      for (const row of rowsAfter) {
        await tx.query(
          `UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2`,
          [row.paceTargetSPerMi, row.id],
        );
      }
      // ── item 13's hook · the SAME coach_intents reason
      //    `adapterMovedAnchorWithin` (lib/training/pace-anchor.ts) now
      //    also matches, so the nightly self-heal defers to a canary-
      //    applied change exactly as it already defers to the 03:00
      //    adapter's own recompute_paces move. ONE write for the whole
      //    application (not per row) -- this is one coherent decision. ──
      await tx.query(
        `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
         VALUES ($1, $1, $2, $3, $4)`,
        [
          userUuid, 'plan_adapt_pace_canary_applied', planId,
          JSON.stringify({
            why: 'Owner-only PACE canary: phase-specific pace step applied.',
            phases: movingPhases.map((p) => ({
              phaseLabel: p.phaseLabel, stepSecPerMi: p.stepSecPerMi,
              previousSecPerMi: p.previousSecPerMi, proposedSecPerMi: p.proposedSecPerMi,
            })),
            rowIds: rowsBefore.map((r) => r.id),
          }),
        ],
      );
    },
  });

  if (!boundary.ok) {
    const applicationId = await insertApplicationRecord({
      userUuid, planId, todayISO: record.todayISO, status: 'refused',
      refusalCode: 'MUTATION_BOUNDARY_REJECTED',
      refusalDetail: boundary.violations.join(' | ') || 'Rejected by the plan mutation boundary.',
      record, targetPhaseLabels: movingPhases.map((p) => p.phaseLabel ?? 'unphased'),
      rowsBefore, rowsAfter: [], postWriteVerified: null, coachIntentWritten: false,
    });
    return { status: 'refused', refusalCode: 'MUTATION_BOUNDARY_REJECTED', applicationId };
  }

  // ── item 10 · AUTOMATIC POST-WRITE VERIFICATION. Re-read the rows fresh,
  //    on a plain (post-commit) connection -- not the transaction client,
  //    which is already released -- and confirm the live value matches what
  //    was intended. ───────────────────────────────────────────────────────
  const verifyRows = await pool.query<{ id: string; pace_target_s_per_mi: number | null }>(
    `SELECT id::text AS id, pace_target_s_per_mi::float AS pace_target_s_per_mi
       FROM plan_workouts WHERE id = ANY($1::text[])`,
    [rowsAfter.map((r) => r.id)],
  );
  const liveById = new Map(verifyRows.rows.map((r) => [r.id, r.pace_target_s_per_mi]));
  const postWriteVerified = rowsAfter.every((r) => liveById.get(r.id) === r.paceTargetSPerMi);
  if (!postWriteVerified) {
    console.error(
      '[pace-canary] POST-WRITE VERIFICATION FAILED -- the committed rows do not match what was '
      + `intended. userUuid=${userUuid} planId=${planId}. This does not undo the write; it is `
      + 'surfaced so an operator investigates immediately.',
    );
  }

  const applicationId = await insertApplicationRecord({
    userUuid, planId, todayISO: record.todayISO, status: 'applied',
    refusalCode: null, refusalDetail: 'ELIGIBLE',
    record, targetPhaseLabels: movingPhases.map((p) => p.phaseLabel ?? 'unphased'),
    rowsBefore, rowsAfter, postWriteVerified, coachIntentWritten: true,
  });

  return {
    status: 'applied', applicationId, rowsUpdated: rowsAfter.length, postWriteVerified,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ROLLBACK -- item 11, one command back to the captured prior-state snapshot.
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PaceCanaryRollbackResult {
  ok: boolean;
  detail: string;
  rowsRestored?: number;
  rowsSkippedSealed?: number;
}

/**
 * Roll back ONE applied application to its captured `rows_before` snapshot.
 * Skips any row that has since become sealed (Rule 15 -- a rollback must
 * never overwrite a day the runner has since actually run, any more than
 * the original application could have). Idempotent: rolling back an
 * already-rolled-back application refuses rather than double-writing.
 */
export async function rollbackPaceCanaryApplication(
  applicationId: number,
  reason: string,
): Promise<PaceCanaryRollbackResult> {
  // Rule 11 · `rowOrNull` keeps "no such application" (undefined) and "the
  // read itself failed" (null) as two different facts, rather than the
  // `.catch(() => ({ rows: [] }))` shape `check-swallowed-failure.sh`
  // ratchets against -- a failed read here must never be reported the same
  // way as "id doesn't exist", since one is an operator typo and the other
  // is a database outage mid-rollback.
  const appRow = await rowOrNull<{
    id: string; user_uuid: string; plan_id: string | null; status: string;
    rows_before: RowSnapshot[];
  }>(
    'pace-canary/rollback/appRow',
    pool.query(
      `SELECT id::text AS id, user_uuid::text AS user_uuid, plan_id, status, rows_before
         FROM pace_canary_applications WHERE id = $1`,
      [applicationId],
    ),
  );

  if (appRow === null) {
    return { ok: false, detail: `Could not read pace_canary_applications row ${applicationId} — the read itself failed, not a missing row.` };
  }
  if (!appRow) return { ok: false, detail: `No pace_canary_applications row with id ${applicationId}.` };
  if (appRow.status !== 'applied') {
    return { ok: false, detail: `Application ${applicationId} has status '${appRow.status}', not 'applied'.` };
  }
  const planId = appRow.plan_id;
  if (!planId) return { ok: false, detail: 'Application row carries no plan_id.' };
  const targetUserUuid = appRow.user_uuid;

  const rowsBefore = appRow.rows_before ?? [];
  if (rowsBefore.length === 0) {
    return { ok: false, detail: 'Application row carries an empty rows_before snapshot.' };
  }

  // Re-check the seal predicate NOW, at rollback time -- a day that was
  // unsealed when the canary applied may have been run since.
  const sealed = await pool.query<{ id: string }>(
    `SELECT pw.id::text AS id
       FROM plan_workouts pw
      WHERE pw.id = ANY($1::text[])
        AND EXISTS (
          SELECT 1 FROM runs r
           WHERE r.user_uuid = $2::uuid
             AND COALESCE(r.data->>'date', LEFT(r.data->>'startLocal', 10))::date = pw.date_iso::date
             AND NOT (r.data ? 'mergedIntoId')
        )`,
    [rowsBefore.map((r) => r.id), targetUserUuid],
  );
  const sealedIds = new Set(sealed.rows.map((r) => r.id));
  const toRestore = rowsBefore.filter((r) => !sealedIds.has(r.id));

  if (toRestore.length === 0) {
    return { ok: false, detail: 'Every row this application touched has since become sealed; nothing to restore.' };
  }

  const boundary = await mutatePlan<void>({
    userUuid: targetUserUuid, planId,
    todayISO: new Date().toISOString().slice(0, 10),
    source: 'adaptation/pace-canary-rollback',
    touches: 'derivations',
    detail: { applicationId, rows: toRestore.length, reason },
    apply: async (tx) => {
      for (const row of toRestore) {
        await tx.query(
          `UPDATE plan_workouts SET pace_target_s_per_mi = $1 WHERE id = $2`,
          [row.paceTargetSPerMi, row.id],
        );
      }
      await tx.query(
        `INSERT INTO coach_intents (user_id, user_uuid, reason, field, value)
         VALUES ($1, $1, $2, $3, $4)`,
        [
          targetUserUuid, 'plan_adapt_pace_canary_rolled_back', planId,
          JSON.stringify({ why: reason, applicationId, rowIds: toRestore.map((r) => r.id) }),
        ],
      );
      await tx.query(
        `UPDATE pace_canary_applications
            SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = $2
          WHERE id = $1`,
        [applicationId, reason],
      );
    },
  });

  if (!boundary.ok) {
    return { ok: false, detail: boundary.violations.join(' | ') || 'Rejected by the plan mutation boundary.' };
  }

  return {
    ok: true,
    detail: `Restored ${toRestore.length} row(s) to their pre-application pace.`,
    rowsRestored: toRestore.length,
    rowsSkippedSealed: rowsBefore.length - toRestore.length,
  };
}
