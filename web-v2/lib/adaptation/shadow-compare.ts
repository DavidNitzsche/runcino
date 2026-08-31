/**
 * lib/adaptation/shadow-compare.ts · THE PACE SHADOW-COMPARE MECHANISM.
 *
 * Authorized by `docs/PRODUCT_DECISIONS.md` 2026-09-01 §2: "PACE-only
 * shadow-compare. Withheld: any live mutation, any other lever." This file
 * is the wiring the decision names but that did not exist yet — everything
 * up to here (`adaptation-engine.ts`, `load-adaptation-engine.ts`) computes a
 * proposal; nothing persisted one or compared it against what the live,
 * mutating engine (`lib/plan/adapt.ts`) actually did the same cycle.
 *
 * ── WHAT THIS FILE DOES ───────────────────────────────────────────────────
 *
 *   1. Runs `resolveAdaptationProposals` (read-only, unchanged) and pulls out
 *      the PACE arm only — PROGRESS, HOLD or INSUFFICIENT_EVIDENCE. VOLUME,
 *      DURATION, DENSITY and SAFETY proposals are read for context but never
 *      persisted here; that is out of tonight's authorization.
 *   2. Runs `detectAdaptations` (also read-only — it is a detector; ONLY
 *      `applyAdaptations` writes) and reads whether the LIVE engine fired a
 *      `training_lead` trigger / `recompute_paces` action this same cycle —
 *      the live engine's closest equivalent to a capacity-led PACE move.
 *   3. Builds one `ShadowCompareRecord` comparing the two.
 *   4. Persists it — see the DDL note below.
 *
 * ── ZERO PLAN MUTATION, AND HOW THAT IS ENFORCED RATHER THAN ASSERTED ───────
 *
 * Every read in this file goes through functions that already do not write
 * (`resolveAdaptationProposals`, `detectAdaptations`). Nothing here calls
 * `applyAdaptations`, `tryAdaptiveBump`, or any `plan_workouts` UPDATE.
 * `_shadow_compare.test.ts` proves this the same way
 * `_adaptation_engine.audit.test.ts` already proves it for the read side: it
 * runs the WHOLE cycle against the DATABASE_URL_RO role, which cannot write
 * at the Postgres permission level — if a future edit introduced a write
 * anywhere in this call graph, the role refuses and the test fails loudly,
 * rather than this file's own say-so being the only guarantee (Rule 18).
 * A second, independent check snapshots `plan_workouts` row count and
 * `updated_at`-equivalent state for the account before and after N cycles
 * and asserts no change.
 *
 * ── PERSISTENCE — BLOCKED ON DDL APPROVAL ───────────────────────────────────
 *
 * The decision doc says "persists proposed before/after values and reasons
 * somewhere real (a table, a jsonb column)" and separately: "check for
 * additive-only options first; if this needs actual DDL, STOP and flag it as
 * a blocker rather than running it, since DDL needs the account owner's
 * explicit per-statement go per CLAUDE.md."
 *
 * Checked, and rejected, in order:
 *
 *   · `plan_proposals` / `plan_workout_proposals` — LIVE actionable-proposal
 *     tables with real accept/apply consumers (`goal_gap_cron`'s
 *     `goal_outlook` pending rows drive the live goal-decision card). A
 *     shadow row risks a consumer that filters on `status` alone.
 *   · `coach_intents` — the historical MUTATION-ONLY log CLAUDE.md Rule 21
 *     measures ("zero upward adaptations across 309 rows"). Writing
 *     non-mutating shadow rows here corrupts that exact measurement.
 *   · `training_plans.adaptation_log` — Rule 6 (multi-writer jsonb) risk: the
 *     live `adapt.ts` pass already writes this column's `{n, ts}` shape with
 *     no field-level merge; a second writer here is the defect Rule 6 names.
 *
 * No safe additive-only home exists. The correct persistence is a NEW table
 * — `db/migrations/160_adaptation_shadow_log.sql`, drafted, additive-only
 * (one `CREATE TABLE`, no `ALTER` on anything existing), **NOT RUN**. This is
 * the STOP the decision doc asked for: flagged here and in the handback
 * report, not run without David's explicit go.
 *
 * So `persist()` below has two postures, chosen at call time by probing
 * `to_regclass('public.adaptation_shadow_log')`:
 *
 *   · TABLE EXISTS (once the migration is approved and applied) → INSERT.
 *   · TABLE ABSENT (now, and until then) → append one JSON line to a
 *     git-tracked file. This is REAL, inspectable persistence for tonight's
 *     verification run — but it is explicitly NOT the production answer: a
 *     Railway/Vercel-style deploy has an EPHEMERAL filesystem, so a file
 *     write from the cron route would not survive the next deploy or even
 *     the next cold start. The file path is only used for the one-off local
 *     verification runs in this handback; the cron wiring below skips
 *     persistence entirely when the table is absent, rather than pretending
 *     a file write in production is durable.
 *
 * Either way this file never fails the caller: persistence failure is
 * caught, logged, and swallowed — exactly the `updateCoachLog` /
 * `reanchorLthr` pattern already used in `run-adaptations/route.ts` for
 * every best-effort step in that loop.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pool } from '@/lib/db/pool';
import { resolveAdaptationProposals } from './load-adaptation-engine';
import type {
  AdaptationDecision,
  AdaptationProposal,
  AdaptationReasonCode,
  EngineRefusal,
  PaceMagnitude,
  PacePhaseOutcome,
} from './adaptation-engine';

/** What the LIVE, mutating engine (`lib/plan/adapt.ts`) did for pace this
 *  same cycle — read-only, via `detectAdaptations`, never `applyAdaptations`.
 *  `training_lead` / `recompute_paces` is the live engine's only pace-moving
 *  mechanism that is evidence-led rather than race-derived (`pr_bank` moves
 *  paces off a RACE, which is a different question this comparison does not
 *  ask — see the header). */
export interface LiveShadowObservation {
  /** Rule 11 · false when `detectAdaptations` itself FAILED to read — not
   *  when it read cleanly and found no pace-moving trigger. Those are
   *  opposite facts and `agreesWithLive` below must not average them. */
  readable: boolean;
  trainingLeadFired: boolean;
  recomputePacesFired: boolean;
  reason: string | null;
}

export interface ShadowCompareRecord {
  userUuid: string;
  todayISO: string;
  resolvedAt: string;
  modelVersion: string;
  engine: {
    readable: boolean;
    /** 'NO_PACE_PROPOSAL' when the engine could not even construct a HOLD —
     *  no phase read at all (Rule 11: this is a THIRD state, not folded into
     *  HOLD, exactly like the engine's own `INSUFFICIENT_EVIDENCE`). */
    decision: AdaptationDecision | 'NO_PACE_PROPOSAL';
    reasonCodes: AdaptationReasonCode[];
    explanation: string | null;
    previous: PaceMagnitude | null;
    proposed: PaceMagnitude | null;
    confidence: number | null;
    /** Part 1 of the 2026-09-01 decision — every phase, its own delta. */
    phaseBreakdown: PacePhaseOutcome[];
    refusals: EngineRefusal[];
  };
  live: LiveShadowObservation;
  /** Precomputed once here so a later dashboard query never re-derives it
   *  from the two raw sides (Rule 16 — one quantity, one name). Null when
   *  the engine could not read the runner at all — agreement is not a
   *  meaningful question about a failed read. */
  agreesWithLive: boolean | null;
}

type PaceProposal = Extract<AdaptationProposal, { target: 'PACE' }>;
const isPaceProposal = (p: AdaptationProposal): p is PaceProposal => p.target === 'PACE';

const paceProposalOf = (
  proposals: readonly AdaptationProposal[],
  deferred: readonly AdaptationProposal[],
): PaceProposal | null =>
  proposals.find(isPaceProposal) ?? deferred.find(isPaceProposal) ?? null;

/**
 * ONE CYCLE, for one runner. Read-only start to finish — see the header for
 * how that is enforced rather than assumed.
 */
export async function runPaceShadowCompareCycle(
  userUuid: string,
  todayISO?: string,
): Promise<ShadowCompareRecord> {
  const resolvedNow = new Date().toISOString();
  const { input, proposals } = await resolveAdaptationProposals(userUuid, todayISO);
  const today = todayISO ?? input?.todayISO ?? proposals?.todayISO
    ?? resolvedNow.slice(0, 10);

  // `detectAdaptations` is a DETECTOR — it does not write. Only
  // `applyAdaptations`, called separately by the cron route's own live path,
  // writes. Calling it here reads what the live engine WOULD decide, which is
  // exactly what "compare against what live behavior would have produced"
  // (the decision doc's words) requires.
  const { detectAdaptations } = await import('@/lib/plan/adapt');
  let live: Awaited<ReturnType<typeof detectAdaptations>> | null = null;
  let liveReadable = true;
  try {
    live = await detectAdaptations(userUuid);
  } catch (liveErr) {
    // Rule 11 · a FAILED read must never look like "the live engine looked
    // and found nothing to do" — those license opposite conclusions about
    // agreement. Named and logged, not swallowed into a bare `null`.
    liveReadable = false;
    console.warn(
      '[shadow-compare] detectAdaptations unreadable:',
      liveErr instanceof Error ? liveErr.message : liveErr,
    );
  }
  const trainingLead = live?.triggers.find((t) => t.kind === 'training_lead') ?? null;
  const recomputeAction = live?.actions.find((a) => a.kind === 'recompute_paces') ?? null;
  const liveObs: LiveShadowObservation = {
    readable: liveReadable,
    trainingLeadFired: trainingLead != null,
    recomputePacesFired: recomputeAction != null,
    reason: trainingLead?.reason ?? null,
  };

  if (!input || !proposals?.readable) {
    return {
      userUuid, todayISO: today, resolvedAt: resolvedNow,
      modelVersion: proposals?.modelVersion ?? 'unknown',
      engine: {
        readable: false, decision: 'NO_PACE_PROPOSAL', reasonCodes: [],
        explanation: proposals?.refusals.map((r) => r.detail).join(' ') ?? 'Could not read the runner.',
        previous: null, proposed: null, confidence: null, phaseBreakdown: [],
        refusals: proposals?.refusals ?? [],
      },
      live: liveObs,
      agreesWithLive: null,
    };
  }

  const pace = paceProposalOf(proposals.proposals, proposals.deferred);

  if (!pace) {
    // Nothing to say about PACE at all — no threshold/tempo/cruise row ahead
    // to price. Distinct from a HOLD, which is a read that argues against
    // moving; this is an absence of the question ever being askable.
    return {
      userUuid, todayISO: today, resolvedAt: resolvedNow, modelVersion: proposals.modelVersion,
      engine: {
        readable: true, decision: 'NO_PACE_PROPOSAL', reasonCodes: [],
        explanation: 'No priced threshold/tempo/cruise row ahead in the active plan.',
        previous: null, proposed: null, confidence: null, phaseBreakdown: [],
        refusals: proposals.refusals,
      },
      live: liveObs,
      agreesWithLive: null,
    };
  }

  const engineUpward = pace.decision === 'PROGRESS';
  const liveUpward = liveObs.trainingLeadFired || liveObs.recomputePacesFired;

  return {
    userUuid, todayISO: today, resolvedAt: resolvedNow, modelVersion: proposals.modelVersion,
    engine: {
      readable: true,
      decision: pace.decision,
      reasonCodes: pace.reasonCodes,
      explanation: pace.explanation,
      previous: pace.previous,
      proposed: pace.proposed,
      confidence: pace.confidence,
      phaseBreakdown: pace.phaseBreakdown,
      refusals: proposals.refusals,
    },
    live: liveObs,
    // AGREEMENT is defined on the one axis both sides can express: did
    // either side move upward this cycle. The live engine has no HOLD /
    // INSUFFICIENT_EVIDENCE vocabulary (§7 of the handback — "the shipped
    // engine has no way to express one"), so a HOLD-vs-silent pair still
    // counts as agreement; only PROGRESS-vs-silent or silent-vs-fired count
    // as disagreement.
    // Rule 11 again: a live read that FAILED cannot license an agreement or
    // disagreement verdict — that would be spending a failure as if it were
    // a "no" from the live engine.
    agreesWithLive: liveObs.readable ? engineUpward === liveUpward : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * PERSISTENCE — see the file header for why this is two postures.
 * ═══════════════════════════════════════════════════════════════════════ */

let shadowTableExists: boolean | null = null;

/** Probed once per process, not once per cycle — twenty users in the cron
 *  loop should cost one `to_regclass` call, not twenty. Deliberately never
 *  expires within a process lifetime: a migration landing mid-run is rare
 *  enough that the next cold start picking it up is an acceptable delay, and
 *  re-probing every cycle would be the cost this cache exists to avoid. */
async function adaptationShadowLogTableExists(): Promise<boolean> {
  if (shadowTableExists != null) return shadowTableExists;
  try {
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.adaptation_shadow_log')::text AS reg`,
    );
    shadowTableExists = r.rows[0]?.reg != null;
  } catch {
    shadowTableExists = false;
  }
  return shadowTableExists;
}

/** Reset for tests only — the module cache above must not leak between
 *  test cases that assert different postures. */
export function _resetShadowTableProbeForTests(): void {
  shadowTableExists = null;
}

const FILE_LOG_DIR = path.join(process.cwd(), '..', 'docs', 'reports', 'adaptation-shadow-log');

async function persistToFile(record: ShadowCompareRecord): Promise<string> {
  await fs.mkdir(FILE_LOG_DIR, { recursive: true });
  const file = path.join(FILE_LOG_DIR, `${record.userUuid}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

async function persistToTable(record: ShadowCompareRecord): Promise<void> {
  await pool.query(
    `INSERT INTO adaptation_shadow_log (
       user_uuid, today_iso, resolved_at, model_version,
       engine_decision, engine_reason_codes, engine_explanation,
       engine_previous, engine_proposed, engine_confidence, phase_breakdown,
       engine_refusals, live_training_lead_fired, live_recompute_paces_fired,
       live_reason, agrees_with_live
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      record.userUuid, record.todayISO, record.resolvedAt, record.modelVersion,
      record.engine.decision, JSON.stringify(record.engine.reasonCodes), record.engine.explanation,
      record.engine.previous ? JSON.stringify(record.engine.previous) : null,
      record.engine.proposed ? JSON.stringify(record.engine.proposed) : null,
      record.engine.confidence, JSON.stringify(record.engine.phaseBreakdown),
      JSON.stringify(record.engine.refusals),
      record.live.trainingLeadFired, record.live.recomputePacesFired, record.live.reason,
      record.agreesWithLive,
    ],
  );
}

export interface PersistResult {
  posture: 'table' | 'file' | 'skipped';
  detail: string;
}

/**
 * Persist one cycle's record. NEVER throws — a persistence failure is
 * best-effort and logged, matching every other non-fatal step in the cron
 * loop this is wired into (`updateCoachLog`, `reanchorLthr`).
 *
 * `allowFileFallback` defaults to true for local verification runs and is
 * set `false` from the cron route — see the header's ephemeral-filesystem
 * note. In production, absent the table, this is a no-op that still returns
 * a result so the caller can log "shadow-compare ran, nothing persisted,
 * migration pending" rather than silently doing nothing.
 */
export async function persistShadowCompareRecord(
  record: ShadowCompareRecord,
  opts: { allowFileFallback?: boolean } = {},
): Promise<PersistResult> {
  const allowFileFallback = opts.allowFileFallback ?? true;
  try {
    if (await adaptationShadowLogTableExists()) {
      await persistToTable(record);
      return { posture: 'table', detail: 'adaptation_shadow_log' };
    }
  } catch (e) {
    console.warn('[shadow-compare] table persist failed, falling back:', e instanceof Error ? e.message : e);
  }
  if (!allowFileFallback) {
    return {
      posture: 'skipped',
      detail: 'adaptation_shadow_log table does not exist yet (migration 160 pending David\'s go); '
        + 'file fallback disabled in this caller (ephemeral filesystem in production).',
    };
  }
  try {
    const file = await persistToFile(record);
    return { posture: 'file', detail: file };
  } catch (e) {
    console.warn('[shadow-compare] file persist failed:', e instanceof Error ? e.message : e);
    return { posture: 'skipped', detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Run one cycle and persist it in one call — what the cron route wires in.
 *  Never throws: any failure anywhere in this function is caught, logged,
 *  and reported as a non-fatal result, matching the rest of the cron loop. */
export async function runAndPersistPaceShadowCompare(
  userUuid: string,
  todayISO?: string,
): Promise<{ record: ShadowCompareRecord | null; persisted: PersistResult | null; error?: string }> {
  try {
    const record = await runPaceShadowCompareCycle(userUuid, todayISO);
    // `allowFileFallback: false` here — see the header. A cron route runs in
    // production, where a file write is a placebo, not persistence.
    const persisted = await persistShadowCompareRecord(record, { allowFileFallback: false });
    return { record, persisted };
  } catch (e) {
    return { record: null, persisted: null, error: e instanceof Error ? e.message : String(e) };
  }
}
