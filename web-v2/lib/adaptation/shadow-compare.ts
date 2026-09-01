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
 * ── EXPANDED 2026-09-01, SECOND PASS ─────────────────────────────────────
 *
 * The migration this file writes through (`db/migrations/
 * 160_adaptation_shadow_log.sql`) is now APPLIED. This pass adds the fields
 * the audit-required shape names beyond the original draft: the
 * authoring/reanchor convergence guard (Part 3,
 * `authoring-convergence.ts`), the pace/HR compatibility verdict (Part 4,
 * `pace-hr-compatibility.ts` + `pace-hr-evidence.ts`), the capacity belief
 * and its evidence dates, representative/excluded observations, named
 * contradictions, and a per-cycle zero-mutation checksum carried IN the
 * record rather than proven only by a separate test.
 *
 * ── WHAT THIS FILE DOES ───────────────────────────────────────────────────
 *
 *   1. Checksums the account's `plan_workouts` BEFORE touching anything.
 *   2. Runs `resolveAdaptationProposals` (read-only, unchanged) and pulls out
 *      the PACE arm only — PROGRESS, HOLD or INSUFFICIENT_EVIDENCE. VOLUME,
 *      DURATION, DENSITY and SAFETY proposals are read for context but never
 *      persisted here; that is out of tonight's authorization.
 *   3. Resolves the authoring/reanchor convergence state (Part 3) — whether
 *      this plan's evidence is contaminated by still pricing off the legacy
 *      cascade.
 *   4. Resolves the pace/HR compatibility verdict (Part 4) against the
 *      controlled sessions backing the proposal, and — if it refuses —
 *      reflects that refusal in `finalDecision`, never as a silent pass-
 *      through.
 *   5. Runs `detectAdaptations` (also read-only — it is a detector; ONLY
 *      `applyAdaptations` writes) and reads whether the LIVE engine fired a
 *      `training_lead` trigger / `recompute_paces` action this same cycle —
 *      the live engine's closest equivalent to a capacity-led PACE move.
 *   6. Builds one `ShadowCompareRecord` comparing all of the above.
 *   7. Checksums `plan_workouts` again and stamps whether they matched.
 *   8. Persists it — see the DDL note below.
 *
 * ── ZERO PLAN MUTATION, AND HOW THAT IS ENFORCED RATHER THAN ASSERTED ───────
 *
 * Every read in this file goes through functions that already do not write
 * (`resolveAdaptationProposals`, `detectAdaptations`,
 * `resolveAuthoringReanchorConvergence`, `resolveHrCheckedSessions`,
 * `resolveLthrContext`, `checkPaceHrCompatibility`). Nothing here calls
 * `applyAdaptations`, `tryAdaptiveBump`, or any `plan_workouts` UPDATE.
 * Three independent layers now prove this, not just assert it:
 *
 *   1. The RO-role fence · `_shadow_compare.audit.test.ts` runs the whole
 *      cycle against the `DATABASE_URL_RO` role, which cannot write at the
 *      Postgres permission level (Rule 18).
 *   2. The test-level checksum · an independent before/after checksum of
 *      the account's live `plan_workouts`, taken outside this file.
 *   3. THE PER-CYCLE, IN-BAND CHECKSUM (new this pass) · every record
 *      carries its OWN before/after `plan_workouts` checksum, taken by this
 *      file itself, bracketing its own work. A mismatch here in PRODUCTION
 *      — not just in a test run — would be the loudest possible signal that
 *      something in this "read-only" path started writing, and it would be
 *      sitting in the very row that claims to be shadow evidence.
 *
 * ── PERSISTENCE ─────────────────────────────────────────────────────────
 *
 * `db/migrations/160_adaptation_shadow_log.sql` is APPLIED (2026-09-01) —
 * see that file's header for the seven-criterion review that preceded it,
 * and `docs/reports/shadow-log-production-2026-09-01.md` for the full
 * account. `persistShadowCompareRecord` still probes for the table
 * (`to_regclass`, cached per-process) so a rollback (`DROP TABLE`) degrades
 * this file to the pre-migration file-fallback posture automatically, with
 * no code change needed — that graceful-degradation path was built before
 * the table existed and is kept as the disablement mechanism the migration
 * review names.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pool } from '@/lib/db/pool';
import { resolveAdaptationProposals } from './load-adaptation-engine';
import { sessionDemonstratesControl } from './adaptation-engine';
import type {
  AdaptationDecision,
  AdaptationProposal,
  AdaptationReasonCode,
  EngineRefusal,
  PaceMagnitude,
  PacePhaseOutcome,
  QualitySessionRead,
} from './adaptation-engine';
import {
  resolveAuthoringReanchorConvergence,
  type AuthoringReanchorConvergence,
} from './authoring-convergence';
import { checkPaceHrCompatibility, type PaceHrCompatibilityResult } from './pace-hr-compatibility';
import { resolveHrCheckedSessions, resolveLthrContext } from './pace-hr-evidence';

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

/** Capacity belief, evidence mode, confidence, and evidence dates — the
 *  audit-required shape's own words. `resolveThresholdCapacity`'s output,
 *  verbatim, plus a best-effort date lookup per evidence id. */
export interface CapacityBeliefRead {
  paceSecPerMi: number;
  vdot: number | null;
  confidence: number;
  sourceMode: string;
  evidenceIds: string[];
  reasons: string[];
}

export interface EvidenceDateRead {
  activityId: string;
  /** null when this id could not be matched to a dated session in this
   *  cycle's own evidence window — named, never guessed at (Rule 11). */
  dateISO: string | null;
}

/** One quality session that contributed (or was read and excluded) —
 *  compact projection of `QualitySessionRead`, not the type itself, so this
 *  record stays a stable wire/DB shape independent of the engine's own
 *  internal type evolving. */
export interface ObservationRead {
  activityId: string;
  dateISO: string;
  capacity: string;
  executionQuality: string;
  controlled: boolean;
}

export interface ContradictionRead {
  code: string;
  detail: string;
}

export interface ShadowCompareRecord {
  userUuid: string;
  planId: string | null;
  todayISO: string;
  resolvedAt: string;
  modelVersion: string;

  /** Part 3 · authoring/reanchor convergence guard. */
  convergence: AuthoringReanchorConvergence;

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

  /** The PACE lever's own scope — fixed by the lever, carried as data. */
  workoutFamily: readonly string[];

  /** Capacity belief, evidence mode, confidence, evidence dates. Null only
   *  when the engine itself could not read the runner (`engine.readable`
   *  false) — a capacity belief about a runner we could not see is not a
   *  fact worth stamping (Rule 11). */
  capacityBelief: CapacityBeliefRead | null;
  evidenceDates: EvidenceDateRead[];

  /** Representative and excluded observations (the Rule 8 / normal-window
   *  split), plus the aggregate window numbers `EvidenceLookback` already
   *  computes — never re-derived here. */
  representativeObservations: ObservationRead[];
  excludedObservations: {
    windowDays: number;
    representativeDays: number;
    excludedDays: number;
    reachedOuterBound: boolean;
    stalenessFactor: number;
  } | null;

  /** Part 4 · pace/HR compatibility. Null when there was no pace proposal
   *  to check against (`engine.decision === 'NO_PACE_PROPOSAL'`). */
  hrCompatibility: PaceHrCompatibilityResult | null;

  /** Named, never silently resolved. See `deriveContradictions` below. */
  contradictions: ContradictionRead[];

  /** The shadow pipeline's OWN final call — `engine.decision` after Part
   *  4's HR compatibility check is applied. Equal to `engine.decision`
   *  whenever HR compatibility does not refuse; `REFUSED_HR_INCOMPATIBLE`
   *  when it does. `engine.decision` is NEVER overwritten — it stays the
   *  literal, traceable PACE-engine output; this is a separate fact. */
  finalDecision: AdaptationDecision | 'NO_PACE_PROPOSAL' | 'REFUSED_HR_INCOMPATIBLE';
  finalDecisionReason: string | null;

  live: LiveShadowObservation;
  /** Precomputed once here so a later dashboard query never re-derives it
   *  from the two raw sides (Rule 16 — one quantity, one name). Null when
   *  the engine could not read the runner at all — agreement is not a
   *  meaningful question about a failed read. */
  agreesWithLive: boolean | null;

  /** Zero-mutation proof, carried per-record — see the file header. */
  mutation: {
    checksumBefore: string;
    checksumAfter: string;
    verified: boolean;
  };
}

type PaceProposal = Extract<AdaptationProposal, { target: 'PACE' }>;
const isPaceProposal = (p: AdaptationProposal): p is PaceProposal => p.target === 'PACE';

const paceProposalOf = (
  proposals: readonly AdaptationProposal[],
  deferred: readonly AdaptationProposal[],
): PaceProposal | null =>
  proposals.find(isPaceProposal) ?? deferred.find(isPaceProposal) ?? null;

const PACE_WORKOUT_FAMILY = Object.freeze(['threshold', 'tempo', 'cruise']);

/**
 * The SAME md5(string_agg(...)) checksum `_shadow_compare.audit.test.ts`
 * uses, promoted out of the test file so a production record can carry the
 * same proof it was verified with, rather than a different, weaker one.
 */
export async function checksumActivePlanWorkouts(userUuid: string): Promise<string> {
  const r = await pool.query<{ checksum: string | null; n: number }>(
    `SELECT md5(COALESCE(string_agg(
        pw.id || ':' || COALESCE(pw.pace_target_s_per_mi::text, '') || ':'
          || COALESCE(pw.distance_mi::text, '') || ':' || COALESCE(pw.type, ''),
        ',' ORDER BY pw.id
      ), '')) AS checksum, COUNT(*)::int AS n
       FROM plan_workouts pw
       JOIN training_plans tp ON tp.id = pw.plan_id
      WHERE tp.user_uuid = $1::uuid AND tp.archived_iso IS NULL`,
    [userUuid],
  );
  return `${r.rows[0]?.checksum ?? ''}:${r.rows[0]?.n ?? 0}`;
}

function evidenceDatesFor(
  evidenceIds: readonly string[],
  sessions: readonly QualitySessionRead[],
): EvidenceDateRead[] {
  const byId = new Map(sessions.map((s) => [s.activityId, s.dateISO] as const));
  return evidenceIds.map((activityId) => ({ activityId, dateISO: byId.get(activityId) ?? null }));
}

/**
 * Contradictions worth naming rather than silently resolving.
 *
 *   · HR compatibility refuses a proposal the PACE engine itself would have
 *     progressed — the exact case Part 4 requires reflecting, not hiding.
 *   · The engine proposed PROGRESS while the plan's evidence is still
 *     contaminated by the legacy cascade (Part 3) — the proposal may be
 *     comparing an old-cascade `prescribed` against a canonical-resolver
 *     `believed`, per `docs/reports/pace-shadow-compare-2026-09-01.md` §3.
 */
function deriveContradictions(args: {
  engineDecision: AdaptationDecision | 'NO_PACE_PROPOSAL';
  hrCompat: PaceHrCompatibilityResult | null;
  convergence: AuthoringReanchorConvergence;
}): ContradictionRead[] {
  const out: ContradictionRead[] = [];
  if (args.engineDecision === 'PROGRESS' && args.hrCompat?.verdict === 'INCOMPATIBLE_REFUSE') {
    out.push({
      code: 'HR_COMPATIBILITY_REFUSES_PROGRESS',
      detail: 'The PACE engine proposed PROGRESS; the pace/HR compatibility check refused it. '
        + 'finalDecision reflects the refusal — see finalDecisionReason.',
    });
  }
  if (args.engineDecision === 'PROGRESS'
    && (args.convergence.state === 'AUTHORED_TOO_RECENTLY' || args.convergence.state === 'REANCHOR_STATUS_UNKNOWN')) {
    out.push({
      code: 'PROGRESS_ON_UNCONVERGED_EVIDENCE',
      detail: `The PACE engine proposed PROGRESS while convergence state is ${args.convergence.state}. `
        + 'The prescribed pace this proposal compared against may still reflect the legacy VDOT '
        + 'cascade rather than the canonical resolvers — exclude this record from any "readiness '
        + 'for authority" aggregate.',
    });
  }
  return out;
}

/**
 * ONE CYCLE, for one runner. Read-only start to finish — see the header for
 * how that is enforced rather than assumed.
 */
export async function runPaceShadowCompareCycle(
  userUuid: string,
  todayISO?: string,
): Promise<ShadowCompareRecord> {
  const resolvedNow = new Date().toISOString();
  const checksumBefore = await checksumActivePlanWorkouts(userUuid);

  const { input, proposals } = await resolveAdaptationProposals(userUuid, todayISO);
  const today = todayISO ?? input?.todayISO ?? proposals?.todayISO
    ?? resolvedNow.slice(0, 10);

  const convergence = await resolveAuthoringReanchorConvergence(userUuid);

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

  const finish = async (partial: Omit<ShadowCompareRecord,
    'userUuid' | 'planId' | 'todayISO' | 'resolvedAt' | 'modelVersion' | 'convergence'
    | 'workoutFamily' | 'live' | 'mutation'
  >): Promise<ShadowCompareRecord> => {
    const checksumAfter = await checksumActivePlanWorkouts(userUuid);
    return {
      userUuid, planId: convergence.planId, todayISO: today, resolvedAt: resolvedNow,
      modelVersion: proposals?.modelVersion ?? 'unknown',
      convergence,
      workoutFamily: PACE_WORKOUT_FAMILY,
      live: liveObs,
      mutation: {
        checksumBefore, checksumAfter, verified: checksumBefore === checksumAfter,
      },
      ...partial,
    };
  };

  if (!input || !proposals?.readable) {
    return finish({
      engine: {
        readable: false, decision: 'NO_PACE_PROPOSAL', reasonCodes: [],
        explanation: proposals?.refusals.map((r) => r.detail).join(' ') ?? 'Could not read the runner.',
        previous: null, proposed: null, confidence: null, phaseBreakdown: [],
        refusals: proposals?.refusals ?? [],
      },
      capacityBelief: null,
      evidenceDates: [],
      representativeObservations: [],
      excludedObservations: null,
      hrCompatibility: null,
      contradictions: [],
      finalDecision: 'NO_PACE_PROPOSAL',
      finalDecisionReason: null,
      agreesWithLive: null,
    });
  }

  const pace = paceProposalOf(proposals.proposals, proposals.deferred);
  const capacityBelief: CapacityBeliefRead = {
    paceSecPerMi: input.capacity.threshold.paceSecPerMi,
    vdot: input.capacity.threshold.vdot ?? null,
    confidence: input.capacity.threshold.confidence,
    sourceMode: input.capacity.threshold.sourceMode,
    evidenceIds: [...input.capacity.threshold.evidenceIds],
    reasons: [...input.capacity.threshold.reasons],
  };
  const evidenceDates = evidenceDatesFor(input.capacity.threshold.evidenceIds, input.pace.sessions);
  const representativeObservations: ObservationRead[] = input.pace.sessions.map((s) => ({
    activityId: s.activityId, dateISO: s.dateISO, capacity: s.capacity,
    executionQuality: s.executionQuality, controlled: sessionDemonstratesControl(s),
  }));
  const excludedObservations = {
    windowDays: input.pace.lookback.windowDays,
    representativeDays: input.pace.lookback.representativeDays,
    excludedDays: input.pace.lookback.excludedDays,
    reachedOuterBound: input.pace.lookback.reachedOuterBound,
    stalenessFactor: input.pace.lookback.stalenessFactor,
  };

  if (!pace) {
    // Nothing to say about PACE at all — no threshold/tempo/cruise row ahead
    // to price. Distinct from a HOLD, which is a read that argues against
    // moving; this is an absence of the question ever being askable.
    return finish({
      engine: {
        readable: true, decision: 'NO_PACE_PROPOSAL', reasonCodes: [],
        explanation: 'No priced threshold/tempo/cruise row ahead in the active plan.',
        previous: null, proposed: null, confidence: null, phaseBreakdown: [],
        refusals: proposals.refusals,
      },
      capacityBelief, evidenceDates, representativeObservations, excludedObservations,
      hrCompatibility: null,
      contradictions: [],
      finalDecision: 'NO_PACE_PROPOSAL',
      finalDecisionReason: null,
      agreesWithLive: null,
    });
  }

  // ── Part 4 · pace/HR compatibility, against the CONTROLLED sessions
  //    backing this proposal — the same population `detectPace` itself
  //    required to clear PACE_PROGRESS_MIN_SESSIONS before proposing. ─────
  const controlledSessions = input.pace.sessions.filter(sessionDemonstratesControl);
  let hrCompatibility: PaceHrCompatibilityResult | null = null;
  try {
    const [hrSessions, lthrContext] = await Promise.all([
      resolveHrCheckedSessions(userUuid, controlledSessions),
      resolveLthrContext(userUuid, today),
    ]);
    hrCompatibility = checkPaceHrCompatibility({
      previousSecPerMi: pace.previous.value,
      proposedSecPerMi: pace.proposed.value,
      lthrBpm: lthrContext.lthrBpm,
      sessions: hrSessions,
      lthrReanchor: lthrContext.advisory,
    });
  } catch (e) {
    // Rule 11 · a failed compatibility read is a THIRD fact — never folded
    // into "compatible" (which would silently wave a proposal through) or
    // "refused" (which would silently block one on no evidence at all).
    console.warn('[shadow-compare] pace/HR compatibility unreadable:', e instanceof Error ? e.message : e);
    hrCompatibility = null;
  }

  const engineDecision = pace.decision;
  const engineUpward = engineDecision === 'PROGRESS';
  const liveUpward = liveObs.trainingLeadFired || liveObs.recomputePacesFired;

  // ── Part 4's refusal clause, made real ───────────────────────────────
  const hrRefuses = hrCompatibility != null && !hrCompatibility.paceProposalMayProceed;
  const finalDecision: ShadowCompareRecord['finalDecision'] = hrRefuses
    ? 'REFUSED_HR_INCOMPATIBLE'
    : engineDecision;
  const finalDecisionReason = hrRefuses ? hrCompatibility!.reason : null;

  const contradictions = deriveContradictions({ engineDecision, hrCompat: hrCompatibility, convergence });

  return finish({
    engine: {
      readable: true,
      decision: engineDecision,
      reasonCodes: pace.reasonCodes,
      explanation: pace.explanation,
      previous: pace.previous,
      proposed: pace.proposed,
      confidence: pace.confidence,
      phaseBreakdown: pace.phaseBreakdown,
      refusals: proposals.refusals,
    },
    capacityBelief, evidenceDates, representativeObservations, excludedObservations,
    hrCompatibility,
    contradictions,
    finalDecision,
    finalDecisionReason,
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
  });
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

/** Where the file fallback writes. Resolved PER CALL, not at module load, so a
 *  test can redirect it to a temp directory after the module is already in the
 *  import cache. The default is the git-tracked report directory, which is why
 *  the fallback is opt-in (see `persistShadowCompareRecord`) rather than a
 *  default anyone can trip over. */
function fileLogDir(): string {
  return process.env.FAFF_SHADOW_LOG_DIR
    ?? path.join(process.cwd(), '..', 'docs', 'reports', 'adaptation-shadow-log');
}

async function persistToFile(record: ShadowCompareRecord): Promise<string> {
  const dir = fileLogDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.userUuid}.jsonl`);
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return file;
}

async function persistToTable(record: ShadowCompareRecord): Promise<void> {
  await pool.query(
    `INSERT INTO adaptation_shadow_log (
       user_uuid, plan_id, today_iso, resolved_at, model_version,
       plan_authored_iso, last_canonical_reanchor_at, convergence_state, convergence_detail,
       workout_family, phase_breakdown, phases_moved,
       engine_decision, engine_reason_codes, engine_explanation,
       engine_previous, engine_proposed, engine_confidence, engine_refusals,
       final_decision, final_decision_reason,
       capacity_belief, evidence_mode, evidence_dates,
       representative_observations, excluded_observations,
       hr_compat_verdict, hr_compat_reason, hr_compat_evidence,
       contradictions,
       live_training_lead_fired, live_recompute_paces_fired, live_reason, agrees_with_live,
       mutation_checksum_before, mutation_checksum_after, zero_mutation_verified
     ) VALUES (
       $1,$2,$3,$4,$5, $6,$7,$8,$9, $10,$11,$12, $13,$14,$15, $16,$17,$18,$19,
       $20,$21, $22,$23,$24, $25,$26, $27,$28,$29, $30, $31,$32,$33,$34, $35,$36,$37
     )`,
    [
      record.userUuid, record.planId, record.todayISO, record.resolvedAt, record.modelVersion,
      record.convergence.authoredIso, record.convergence.lastCanonicalReanchorAt,
      record.convergence.state, record.convergence.detail,
      record.workoutFamily, JSON.stringify(record.engine.phaseBreakdown),
      record.engine.phaseBreakdown.filter((p) => p.moved).map((p) => p.phaseLabel ?? 'unlabeled'),
      record.engine.decision, JSON.stringify(record.engine.reasonCodes), record.engine.explanation,
      record.engine.previous ? JSON.stringify(record.engine.previous) : null,
      record.engine.proposed ? JSON.stringify(record.engine.proposed) : null,
      record.engine.confidence, JSON.stringify(record.engine.refusals),
      record.finalDecision, record.finalDecisionReason,
      record.capacityBelief ? JSON.stringify(record.capacityBelief) : null,
      record.capacityBelief?.sourceMode ?? null,
      JSON.stringify(record.evidenceDates),
      JSON.stringify(record.representativeObservations), JSON.stringify(record.excludedObservations),
      record.hrCompatibility?.verdict ?? null, record.hrCompatibility?.reason ?? null,
      record.hrCompatibility ? JSON.stringify(record.hrCompatibility) : null,
      JSON.stringify(record.contradictions),
      record.live.trainingLeadFired, record.live.recomputePacesFired, record.live.reason,
      record.agreesWithLive,
      record.mutation.checksumBefore, record.mutation.checksumAfter, record.mutation.verified,
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
 * `allowFileFallback` DEFAULTS TO FALSE and must be opted into explicitly.
 * It used to default to true "for local verification runs", and the cost of
 * that default was that any read-only test run which happened to reach this
 * function APPENDED to the git-tracked `docs/reports/adaptation-shadow-log/
 * *.jsonl` — a test dirtying the working tree of whoever ran it, silently.
 * The cron route already passed `false` (ephemeral filesystem in production),
 * so nothing that ships relied on the old default. A caller that genuinely
 * wants a file writes `{ allowFileFallback: true }` and, if it is a test,
 * points `FAFF_SHADOW_LOG_DIR` somewhere disposable.
 *
 * With the fallback off and the table absent, this is a no-op that still
 * returns a result, so the caller can log "shadow-compare ran, nothing
 * persisted, migration pending" rather than silently doing nothing (Rule 11).
 */
export async function persistShadowCompareRecord(
  record: ShadowCompareRecord,
  opts: { allowFileFallback?: boolean } = {},
): Promise<PersistResult> {
  const allowFileFallback = opts.allowFileFallback ?? false;

  // Rule 11 · "the table is absent" and "the table exists but this INSERT
  // failed" are different facts. Collapsing them was a real bug once the
  // migration landed: a caller running over the READ-ONLY role (exactly
  // what this file's own audit test does, deliberately, to prove zero
  // mutation) gets a permission-denied INSERT against a table that DOES
  // exist, and the old code reported "table does not exist yet (migration
  // 160 pending)" — true before the migration, false and misleading after.
  // No `.catch()` here — `adaptationShadowLogTableExists()` already catches
  // its own probe failure internally and resolves `false` (never rejects),
  // so a caller-side catch would be a blind, provably-redundant coercion
  // site with nothing behind it to actually collapse (found by
  // `check-coercion.sh` when this line first carried one).
  const tableExists = await adaptationShadowLogTableExists();

  if (tableExists) {
    try {
      await persistToTable(record);
      return { posture: 'table', detail: 'adaptation_shadow_log' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[shadow-compare] table insert failed:', msg);
      if (!allowFileFallback) {
        return {
          posture: 'skipped',
          detail: `adaptation_shadow_log exists but the insert failed: ${msg}`,
        };
      }
      // fall through to the file fallback below
    }
  } else if (!allowFileFallback) {
    return {
      posture: 'skipped',
      detail: 'adaptation_shadow_log table does not exist yet (migration 160 not applied on this '
        + 'database); file fallback disabled in this caller (ephemeral filesystem in production).',
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
