/**
 * adaptation-stability-report.ts · Stage 1 stability report for the PACE
 * adaptation shadow-compare mechanism.
 *
 * Reads `adaptation_shadow_log` (`db/migrations/160_adaptation_shadow_log.sql`,
 * applied and live 2026-09-01 — see `docs/reports/shadow-log-production-
 * 2026-09-01.md`) and compiles the Stage 1 stability criteria named in
 * `docs/reports/adaptation-authority-policy-brief-2026-09-01.md`'s external
 * review response:
 *
 *   1. Consecutive scheduled evaluation days so far (target 7)
 *   2. Successful, uncontaminated evaluation cycles (target 5) —
 *      "uncontaminated" = the authoring/reanchor convergence guard
 *      (`lib/adaptation/authoring-convergence.ts`) classified the plan as
 *      canonically reanchored, not one of the contaminated/unready states
 *   3. Plan mutations or checksum violations (HARD FAIL if nonzero)
 *   4. Unresolved contradictions (from `deriveContradictions` in
 *      `lib/adaptation/shadow-compare.ts`, persisted per-row)
 *   5. Any MATERIAL_INCOMPATIBILITY (`INCOMPATIBLE_REFUSE`) verdict
 *      nonetheless treated as a valid PROGRESS proposal (HARD FAIL if found)
 *   6. Unexplained oscillation between PROGRESS and HOLD across consecutive
 *      days — "unexplained" defined concretely below, not eyeballed
 *   7. Any material proposal change day-over-day, checked by the same
 *      explain-the-change mechanism as #6, applied generally
 *   8. Phone/Watch targets staying canonical and consistent — checked to the
 *      extent the stored data actually supports (see PHONE/WATCH section —
 *      full historical reconstruction is NOT possible; that limitation is
 *      stated plainly rather than papered over)
 *   9. Shadow-log retention/pruning health
 *
 * ── WHAT "UNEXPLAINED" MEANS, CONCRETELY (#6 and #7) ────────────────────────
 *
 * A day-over-day change (decision flip, or a material change in the proposed
 * pace/phase targets) counts as EXPLAINED when at least one of these is true
 * between the two consecutive calendar days being compared:
 *
 *   · NEW EVIDENCE       — the set of representative-observation activity ids
 *     changed, or the capacity belief's own evidenceIds changed.
 *   · CHANGED RUNNER STATE — the capacity belief's confidence, paceSecPerMi,
 *     or sourceMode changed, or the convergence state changed, or the HR
 *     compatibility verdict changed.
 *   · PHASE TRANSITION   — the set of phase labels present in the phase
 *     breakdown changed, or the set of phases marked `moved` changed.
 *
 * A change with none of those three present is flagged UNEXPLAINED. This is
 * a real, falsifiable predicate over the persisted row — see
 * `explainDayOverDayChange()` below — not a description of a check that
 * exists only in prose.
 *
 * ── READ-ONLY, ENFORCED NOT ASSERTED ────────────────────────────────────────
 *
 * This script opens its OWN connection pool against `DATABASE_URL_RO` (the
 * Postgres role that cannot INSERT/UPDATE/DELETE at the permission level —
 * see `docs/reports/shadow-log-production-2026-09-01.md` §2 for the
 * empirical proof that role carries no write grant). It never imports
 * `lib/db/pool` (the writable pool), never imports
 * `lib/adaptation/shadow-compare.ts`, `lib/adaptation/adaptation-engine.ts`,
 * or `lib/plan/adapt.ts` — this file only reads already-persisted rows and
 * runs pure arithmetic over them. If every query in this file were run by
 * hand against the RO role, nothing on the runner's phone could change.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────
 *
 *   npx tsx scripts/adaptation-stability-report.ts                # owner, text
 *   npx tsx scripts/adaptation-stability-report.ts <user-uuid>     # another user
 *   npx tsx scripts/adaptation-stability-report.ts --json          # machine-readable
 *
 * Re-run this at any point — now, day 7, day 14 — to see CURRENT status. It
 * is not a one-time report; every number below is computed fresh from
 * whatever is in the table at the moment it runs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

// ── env loading, same minimal pattern as scripts/dump-watch-json.ts ────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const l of readFileSync(envPath, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const OWNER_UUID = '0645f40c-951d-4ccc-b86e-9979cd26c795';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const USER_UUID = argv.find((a) => !a.startsWith('--')) ?? OWNER_UUID;

// ── policy targets, named per the brief, never re-typed as bare numbers ────
const TARGET_CONSECUTIVE_DAYS = 7;
const TARGET_ELIGIBLE_CYCLES = 5;
const DAY_CAP = 14;

const CANONICAL_CONVERGENCE_STATES = new Set(['AUTHORED_CANONICALLY', 'REANCHORED_CANONICALLY']);
const CONTAMINATED_CONVERGENCE_STATES = new Set(['AUTHORED_TOO_RECENTLY', 'REANCHOR_STATUS_UNKNOWN']);

// The one benign `engine_explanation` string `shadow-compare.ts` writes when
// the engine READ the runner fine but there was simply no priced
// threshold/tempo/cruise row ahead — as opposed to a genuine read failure,
// whose explanation is built from `proposals.refusals` or the literal
// fallback "Could not read the runner." Best-effort text match, named as
// such rather than presented as a guaranteed distinction — see the
// ELIGIBILITY section below for how a wrong guess here is bounded.
const BENIGN_NO_PROPOSAL_EXPLANATION = 'No priced threshold/tempo/cruise row ahead in the active plan.';

export interface ShadowRow {
  id: string;
  userUuid: string;
  planId: string | null;
  todayIso: string;
  resolvedAt: string;
  modelVersion: string;
  planAuthoredIso: string | null;
  lastCanonicalReanchorAt: string | null;
  convergenceState: string;
  convergenceDetail: string | null;
  engineDecision: string;
  engineExplanation: string | null;
  enginePrevious: { unit: string; value: number } | null;
  engineProposed: { unit: string; value: number } | null;
  engineConfidence: number | null;
  phaseBreakdown: Array<{ phaseLabel: string | null; moved: boolean; proposedSecPerMi: number }>;
  phasesMoved: string[];
  finalDecision: string;
  finalDecisionReason: string | null;
  capacityBelief: {
    paceSecPerMi: number; vdot: number | null; confidence: number;
    sourceMode: string; evidenceIds: string[];
  } | null;
  evidenceDates: Array<{ activityId: string; dateISO: string | null }>;
  representativeObservations: Array<{ activityId: string }>;
  hrCompatVerdict: string | null;
  hrCompatReason: string | null;
  contradictions: Array<{ code: string; detail: string }>;
  mutationChecksumBefore: string | null;
  mutationChecksumAfter: string | null;
  zeroMutationVerified: boolean | null;
  source: string;
}

function newPool(connectionString: string | undefined): Pool {
  const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]|^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)[:/]/
    .test(connectionString ?? '');
  return new Pool({
    connectionString,
    ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
    max: 4,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
}

async function fetchRows(pool: Pool, userUuid: string): Promise<ShadowRow[]> {
  const r = await pool.query(
    `SELECT
       id::text AS id, user_uuid AS "userUuid", plan_id AS "planId",
       today_iso::text AS "todayIso", resolved_at::text AS "resolvedAt",
       model_version AS "modelVersion",
       plan_authored_iso::text AS "planAuthoredIso",
       last_canonical_reanchor_at::text AS "lastCanonicalReanchorAt",
       convergence_state AS "convergenceState", convergence_detail AS "convergenceDetail",
       engine_decision AS "engineDecision", engine_explanation AS "engineExplanation",
       engine_previous AS "enginePrevious", engine_proposed AS "engineProposed",
       engine_confidence AS "engineConfidence",
       COALESCE(phase_breakdown, '[]'::jsonb) AS "phaseBreakdown",
       COALESCE(phases_moved, '{}') AS "phasesMoved",
       final_decision AS "finalDecision", final_decision_reason AS "finalDecisionReason",
       capacity_belief AS "capacityBelief",
       COALESCE(evidence_dates, '[]'::jsonb) AS "evidenceDates",
       COALESCE(representative_observations, '[]'::jsonb) AS "representativeObservations",
       hr_compat_verdict AS "hrCompatVerdict", hr_compat_reason AS "hrCompatReason",
       COALESCE(contradictions, '[]'::jsonb) AS "contradictions",
       mutation_checksum_before AS "mutationChecksumBefore",
       mutation_checksum_after AS "mutationChecksumAfter",
       zero_mutation_verified AS "zeroMutationVerified",
       source
     FROM adaptation_shadow_log
     WHERE user_uuid = $1::uuid
     ORDER BY today_iso ASC, resolved_at ASC`,
    [userUuid],
  );
  return r.rows as ShadowRow[];
}

interface AllUsersSummaryRow {
  userUuid: string; nRows: number; nDays: number; lastConvergence: string; lastDecision: string;
}

async function fetchAllUsersSummary(pool: Pool): Promise<AllUsersSummaryRow[]> {
  const r = await pool.query(
    `SELECT user_uuid AS "userUuid", COUNT(*)::int AS "nRows",
            COUNT(DISTINCT today_iso)::int AS "nDays",
            (ARRAY_AGG(convergence_state ORDER BY resolved_at DESC))[1] AS "lastConvergence",
            (ARRAY_AGG(final_decision ORDER BY resolved_at DESC))[1] AS "lastDecision"
       FROM adaptation_shadow_log
      GROUP BY user_uuid
      ORDER BY "nRows" DESC`,
  );
  return r.rows as AllUsersSummaryRow[];
}

/** One row per calendar day — the LATEST `resolved_at` row for that day, since
 *  a day can carry more than one persisted cycle (manual verification runs
 *  alongside the automated cron, observed in real production data on
 *  2026-08-31). Per-day analyses (streaks, oscillation, day-over-day change)
 *  use this deduped series; the hard-fail scans below deliberately do NOT
 *  dedupe — a violation on ANY row is a violation regardless of how many
 *  other rows exist that same day. */
export function latestPerDay(rows: ShadowRow[]): ShadowRow[] {
  const byDay = new Map<string, ShadowRow>();
  for (const row of rows) {
    const existing = byDay.get(row.todayIso);
    if (!existing || row.resolvedAt > existing.resolvedAt) byDay.set(row.todayIso, row);
  }
  return [...byDay.values()].sort((a, b) => a.todayIso.localeCompare(b.todayIso));
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ═══════════════════════ 1 · consecutive scheduled days ═══════════════════ */

interface ConsecutiveDaysReport {
  distinctDays: number;
  firstDay: string | null;
  lastDay: string | null;
  spanDays: number;
  missingDates: string[];
  currentStreak: number;
  streakStartDate: string | null;
  target: number;
  metTarget: boolean;
}

export function consecutiveDaysReport(perDay: ShadowRow[]): ConsecutiveDaysReport {
  if (perDay.length === 0) {
    return {
      distinctDays: 0, firstDay: null, lastDay: null, spanDays: 0, missingDates: [],
      currentStreak: 0, streakStartDate: null, target: TARGET_CONSECUTIVE_DAYS, metTarget: false,
    };
  }
  const days = perDay.map((r) => r.todayIso);
  const first = days[0];
  const last = days[days.length - 1];
  const daySet = new Set(days);
  const missing: string[] = [];
  let cursor = first;
  let spanDays = 0;
  while (cursor <= last) {
    spanDays += 1;
    if (!daySet.has(cursor)) missing.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }

  // Current streak: walk backward from the LAST day present, counting
  // unbroken consecutive calendar days.
  let streak = 1;
  let streakStart = last;
  let probe = last;
  for (;;) {
    const prevDay = addDaysIso(probe, -1);
    if (!daySet.has(prevDay)) break;
    streak += 1;
    streakStart = prevDay;
    probe = prevDay;
  }

  return {
    distinctDays: days.length, firstDay: first, lastDay: last, spanDays,
    missingDates: missing, currentStreak: streak, streakStartDate: streakStart,
    target: TARGET_CONSECUTIVE_DAYS, metTarget: streak >= TARGET_CONSECUTIVE_DAYS,
  };
}

/* ═══════════════ 2 · successful, uncontaminated evaluation cycles ═════════ */

interface EligibleCyclesReport {
  eligibleDays: string[];
  ineligibleDays: Array<{ date: string; reason: string }>;
  count: number;
  target: number;
  metTarget: boolean;
}

export function eligibilityReasonFor(row: ShadowRow): string | null {
  if (!CANONICAL_CONVERGENCE_STATES.has(row.convergenceState)) {
    return `CONTAMINATED_CONVERGENCE: ${row.convergenceState} — ${row.convergenceDetail ?? 'no detail'}`;
  }
  if (row.engineDecision === 'NO_PACE_PROPOSAL' && row.engineExplanation !== BENIGN_NO_PROPOSAL_EXPLANATION) {
    // Best-effort distinguisher (see BENIGN_NO_PROPOSAL_EXPLANATION comment
    // above) — a text-match miss here fails CLOSED (treated as ineligible,
    // not silently counted as a good cycle), which is the safe direction for
    // a stability gate.
    return `ENGINE_LIKELY_UNREADABLE: explanation was "${row.engineExplanation ?? '(none)'}", `
      + 'not the known benign "no priced row ahead" text.';
  }
  return null;
}

export function eligibleCyclesReport(perDay: ShadowRow[]): EligibleCyclesReport {
  const eligibleDays: string[] = [];
  const ineligibleDays: Array<{ date: string; reason: string }> = [];
  for (const row of perDay) {
    const reason = eligibilityReasonFor(row);
    if (reason) ineligibleDays.push({ date: row.todayIso, reason });
    else eligibleDays.push(row.todayIso);
  }
  return {
    eligibleDays, ineligibleDays, count: eligibleDays.length,
    target: TARGET_ELIGIBLE_CYCLES, metTarget: eligibleDays.length >= TARGET_ELIGIBLE_CYCLES,
  };
}

/* ═══════════════════ 3 · mutation / checksum violations (HARD FAIL) ═══════ */

interface MutationViolation { id: string; todayIso: string; detail: string; }

export function mutationViolations(allRows: ShadowRow[]): MutationViolation[] {
  const out: MutationViolation[] = [];
  for (const row of allRows) {
    if (row.zeroMutationVerified !== true) {
      out.push({
        id: row.id, todayIso: row.todayIso,
        detail: `zero_mutation_verified = ${JSON.stringify(row.zeroMutationVerified)} (must be exactly true)`,
      });
      continue;
    }
    if (row.mutationChecksumBefore !== row.mutationChecksumAfter) {
      out.push({
        id: row.id, todayIso: row.todayIso,
        detail: `checksum mismatch: before=${row.mutationChecksumBefore} after=${row.mutationChecksumAfter}`,
      });
    }
  }
  return out;
}

/* ══════════════ 5 · MATERIAL_INCOMPATIBILITY accepted as PROGRESS (HARD FAIL) ═ */

interface IncompatibilityViolation { id: string; todayIso: string; finalDecision: string; }

export function materialIncompatibilityAcceptedAsProgress(allRows: ShadowRow[]): IncompatibilityViolation[] {
  return allRows
    .filter((row) => row.hrCompatVerdict === 'INCOMPATIBLE_REFUSE' && row.finalDecision !== 'REFUSED_HR_INCOMPATIBLE')
    .map((row) => ({ id: row.id, todayIso: row.todayIso, finalDecision: row.finalDecision }));
}

/* ═══════════════════ 4 · unresolved contradictions ═════════════════════════ */

interface ContradictionEntry { id: string; todayIso: string; code: string; detail: string; }

export function unresolvedContradictions(allRows: ShadowRow[]): ContradictionEntry[] {
  const out: ContradictionEntry[] = [];
  for (const row of allRows) {
    for (const c of row.contradictions ?? []) {
      out.push({ id: row.id, todayIso: row.todayIso, code: c.code, detail: c.detail });
    }
  }
  return out;
}

/* ══════════ 6 & 7 · day-over-day change explanation (shared mechanism) ═════ */

export interface ChangeExplanation { explained: boolean; reasons: string[]; }

export function explainDayOverDayChange(prev: ShadowRow, curr: ShadowRow): ChangeExplanation {
  const reasons: string[] = [];

  // NEW EVIDENCE
  const prevEvidence = new Set(prev.capacityBelief?.evidenceIds ?? []);
  const currEvidence = new Set(curr.capacityBelief?.evidenceIds ?? []);
  const evidenceChanged = prevEvidence.size !== currEvidence.size
    || [...currEvidence].some((id) => !prevEvidence.has(id));
  if (evidenceChanged) reasons.push('NEW_EVIDENCE: capacity belief evidenceIds changed');

  const prevObs = new Set(prev.representativeObservations.map((o) => o.activityId));
  const currObs = new Set(curr.representativeObservations.map((o) => o.activityId));
  const obsChanged = prevObs.size !== currObs.size || [...currObs].some((id) => !prevObs.has(id));
  if (obsChanged) reasons.push('NEW_EVIDENCE: representative observation set changed');

  // CHANGED RUNNER STATE
  const prevCap = prev.capacityBelief;
  const currCap = curr.capacityBelief;
  if ((prevCap?.sourceMode ?? null) !== (currCap?.sourceMode ?? null)) {
    reasons.push(`CHANGED_STATE: capacity sourceMode ${prevCap?.sourceMode ?? 'null'} → ${currCap?.sourceMode ?? 'null'}`);
  }
  if (prevCap && currCap) {
    if (Math.abs(prevCap.confidence - currCap.confidence) > 0.01) {
      reasons.push(`CHANGED_STATE: confidence ${prevCap.confidence.toFixed(3)} → ${currCap.confidence.toFixed(3)}`);
    }
    if (prevCap.paceSecPerMi !== currCap.paceSecPerMi) {
      reasons.push(`CHANGED_STATE: capacity pace ${prevCap.paceSecPerMi} → ${currCap.paceSecPerMi} s/mi`);
    }
  }
  if (prev.convergenceState !== curr.convergenceState) {
    reasons.push(`CHANGED_STATE: convergence ${prev.convergenceState} → ${curr.convergenceState}`);
  }
  if ((prev.hrCompatVerdict ?? null) !== (curr.hrCompatVerdict ?? null)) {
    reasons.push(`CHANGED_STATE: HR compatibility ${prev.hrCompatVerdict ?? 'null'} → ${curr.hrCompatVerdict ?? 'null'}`);
  }

  // PHASE TRANSITION
  const prevPhases = new Set(prev.phaseBreakdown.map((p) => p.phaseLabel ?? 'unphased'));
  const currPhases = new Set(curr.phaseBreakdown.map((p) => p.phaseLabel ?? 'unphased'));
  const phasesChanged = prevPhases.size !== currPhases.size || [...currPhases].some((p) => !prevPhases.has(p));
  if (phasesChanged) {
    reasons.push(`PHASE_TRANSITION: active phases {${[...prevPhases]}} → {${[...currPhases]}}`);
  }
  const prevMoved = new Set(prev.phasesMoved);
  const currMoved = new Set(curr.phasesMoved);
  const movedChanged = prevMoved.size !== currMoved.size || [...currMoved].some((p) => !prevMoved.has(p));
  if (movedChanged) {
    reasons.push(`PHASE_TRANSITION: phases-moved set {${[...prevMoved]}} → {${[...currMoved]}}`);
  }

  return { explained: reasons.length > 0, reasons };
}

/* ═══════════════════ 6 · PROGRESS/HOLD oscillation ═════════════════════════ */

interface OscillationEvent {
  fromDate: string; toDate: string; from: string; to: string;
  explanation: ChangeExplanation;
}

interface OscillationReport {
  checkedPairs: number;
  skippedNonConsecutivePairs: number;
  flips: OscillationEvent[];
  unexplainedFlips: OscillationEvent[];
}

export function oscillationReport(perDay: ShadowRow[]): OscillationReport {
  const flips: OscillationEvent[] = [];
  let checkedPairs = 0;
  let skipped = 0;
  const PROGRESS_HOLD = new Set(['PROGRESS', 'HOLD']);
  for (let i = 1; i < perDay.length; i += 1) {
    const prev = perDay[i - 1];
    const curr = perDay[i];
    if (addDaysIso(prev.todayIso, 1) !== curr.todayIso) { skipped += 1; continue; }
    checkedPairs += 1;
    if (PROGRESS_HOLD.has(prev.finalDecision) && PROGRESS_HOLD.has(curr.finalDecision)
      && prev.finalDecision !== curr.finalDecision) {
      flips.push({
        fromDate: prev.todayIso, toDate: curr.todayIso,
        from: prev.finalDecision, to: curr.finalDecision,
        explanation: explainDayOverDayChange(prev, curr),
      });
    }
  }
  return {
    checkedPairs, skippedNonConsecutivePairs: skipped, flips,
    unexplainedFlips: flips.filter((f) => !f.explanation.explained),
  };
}

/* ══════════════════ 7 · general material proposal changes ══════════════════ */

interface MaterialChangeEvent {
  fromDate: string; toDate: string; kind: string; detail: string;
  explanation: ChangeExplanation;
}

interface MaterialChangeReport {
  checkedPairs: number;
  skippedNonConsecutivePairs: number;
  changes: MaterialChangeEvent[];
  unexplainedChanges: MaterialChangeEvent[];
}

export function materialChangeReport(perDay: ShadowRow[]): MaterialChangeReport {
  const changes: MaterialChangeEvent[] = [];
  let checkedPairs = 0;
  let skipped = 0;
  for (let i = 1; i < perDay.length; i += 1) {
    const prev = perDay[i - 1];
    const curr = perDay[i];
    if (addDaysIso(prev.todayIso, 1) !== curr.todayIso) { skipped += 1; continue; }
    checkedPairs += 1;
    const explanation = explainDayOverDayChange(prev, curr);

    if (prev.finalDecision !== curr.finalDecision) {
      changes.push({
        fromDate: prev.todayIso, toDate: curr.todayIso, kind: 'DECISION_CHANGE',
        detail: `finalDecision ${prev.finalDecision} → ${curr.finalDecision}`, explanation,
      });
    }
    const prevProposed = prev.engineProposed?.value ?? null;
    const currProposed = curr.engineProposed?.value ?? null;
    if (prevProposed !== currProposed && (prevProposed !== null || currProposed !== null)) {
      changes.push({
        fromDate: prev.todayIso, toDate: curr.todayIso, kind: 'PROPOSED_PACE_CHANGE',
        detail: `engine.proposed ${prevProposed ?? 'null'} → ${currProposed ?? 'null'} s/mi`, explanation,
      });
    }
    // Per-phase target drift, matched by phaseLabel.
    const currByLabel = new Map(curr.phaseBreakdown.map((p) => [p.phaseLabel ?? 'unphased', p]));
    for (const p of prev.phaseBreakdown) {
      const label = p.phaseLabel ?? 'unphased';
      const match = currByLabel.get(label);
      if (match && match.proposedSecPerMi !== p.proposedSecPerMi) {
        changes.push({
          fromDate: prev.todayIso, toDate: curr.todayIso, kind: 'PHASE_TARGET_DRIFT',
          detail: `${label} proposed ${p.proposedSecPerMi} → ${match.proposedSecPerMi} s/mi`, explanation,
        });
      }
    }
  }
  return {
    checkedPairs, skippedNonConsecutivePairs: skipped, changes,
    unexplainedChanges: changes.filter((c) => !c.explanation.explained),
  };
}

/* ═══════════════════ 8 · phone/watch target consistency ════════════════════ */

interface PhoneWatchReport {
  liveChecksumNow: string;
  mostRecentRowTodayIso: string | null;
  mostRecentRowChecksumAfter: string | null;
  currentDayMatchesLiveNow: boolean | null;
  everyRowInternallyConsistent: boolean;
  inconsistentRowIds: string[];
  fullHistoricalReconstructionPossible: false;
  limitationNote: string;
}

async function checksumLivePlanWorkoutsNow(pool: Pool, userUuid: string): Promise<string> {
  // Deliberately the SAME formula `checksumActivePlanWorkouts` in
  // shadow-compare.ts uses, inlined here rather than imported — this script
  // must not import shadow-compare.ts at all (task constraint), and this
  // query is a pure SELECT against the RO pool regardless.
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

async function phoneWatchReport(pool: Pool, userUuid: string, allRows: ShadowRow[]): Promise<PhoneWatchReport> {
  const liveChecksumNow = await checksumLivePlanWorkoutsNow(pool, userUuid);
  const todayActualIso = new Date().toISOString().slice(0, 10);
  const mostRecentRow = allRows.length > 0 ? allRows[allRows.length - 1] : null;

  const inconsistentRowIds = allRows
    .filter((r) => r.mutationChecksumBefore !== r.mutationChecksumAfter)
    .map((r) => r.id);

  return {
    liveChecksumNow,
    mostRecentRowTodayIso: mostRecentRow?.todayIso ?? null,
    mostRecentRowChecksumAfter: mostRecentRow?.mutationChecksumAfter ?? null,
    currentDayMatchesLiveNow: mostRecentRow && mostRecentRow.todayIso === todayActualIso
      ? mostRecentRow.mutationChecksumAfter === liveChecksumNow
      : null,
    everyRowInternallyConsistent: inconsistentRowIds.length === 0,
    inconsistentRowIds,
    fullHistoricalReconstructionPossible: false,
    limitationNote:
      '`/api/v5/today` (app/api/v5/today/route.ts, "SELECT pace_target_s_per_mi, workout_spec FROM '
      + 'plan_workouts") and the watch payload (lib/watch/build-workout.ts) both read `plan_workouts` '
      + 'LIVE, and that table is mutated IN PLACE with no history/snapshot table behind it. There is '
      + 'no way to ask "what would /api/v5/today have returned on 2026-08-29" from stored data alone '
      + '— the row for that date, if it ever differed, has been overwritten. What CAN be checked, and '
      + 'is checked above: (a) every persisted shadow-compare row carries its own before/after '
      + 'plan_workouts checksum, and every mismatch there is surfaced as a HARD FAIL mutation '
      + 'violation — proving the shadow-evaluation pass itself never altered what the phone/watch '
      + 'would see; (b) whether the MOST RECENT row, if dated today, still matches what plan_workouts '
      + 'holds right now — proving nothing else has mutated the plan out from under the last '
      + 'evaluation between then and now. Neither (a) nor (b) proves what the phone/watch showed on '
      + 'any earlier date; only that this mechanism has not been the source of any drift.',
  };
}

/* ═══════════════════════ 9 · retention/pruning health ══════════════════════ */

interface RetentionReport {
  totalRows: number;
  perUserRowCounts: Array<{ userUuid: string; n: number }>;
  oldestRowResolvedAt: string | null;
  oldestRowAgeDays: number | null;
  retentionDays: number;
  maxRowsPerUser: number;
  anyUserNearCap: boolean;
  oldestRowNearRetentionBound: boolean;
  pruneHeartbeatFound: boolean;
  pruneHeartbeatNote: string;
}

async function retentionReport(pool: Pool): Promise<RetentionReport> {
  const RETENTION_DAYS = 180; // ADAPTATION_SHADOW_LOG_RETENTION_DAYS, lib/adaptation/shadow-log-retention.ts
  const MAX_ROWS_PER_USER = 400; // ADAPTATION_SHADOW_LOG_MAX_ROWS_PER_USER, same file

  const totalR = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM adaptation_shadow_log`);
  const perUserR = await pool.query<{ userUuid: string; n: number }>(
    `SELECT user_uuid AS "userUuid", COUNT(*)::int AS n FROM adaptation_shadow_log
      GROUP BY user_uuid ORDER BY n DESC`,
  );
  const oldestR = await pool.query<{ resolvedAt: string | null }>(
    `SELECT MIN(resolved_at)::text AS "resolvedAt" FROM adaptation_shadow_log`,
  );
  // Read-only SELECT of the cron-ledger heartbeat table (ops_alerts), same
  // shape lib/ops/cron-ledger.ts's lastSuccessAt() reads, inlined here so
  // this script has zero dependency on any adaptation/plan module.
  const heartbeatR = await pool.query<{ at: string | null }>(
    `SELECT MAX(created_at)::text AS at FROM ops_alerts
      WHERE kind = 'cron_ok' AND source = 'cron/prune-adaptation-shadow-log'`,
  );

  const oldestResolvedAt = oldestR.rows[0]?.resolvedAt ?? null;
  const oldestAgeDays = oldestResolvedAt
    ? (Date.now() - new Date(oldestResolvedAt).getTime()) / 86_400_000
    : null;

  const heartbeatAt = heartbeatR.rows[0]?.at ?? null;

  return {
    totalRows: totalR.rows[0]?.n ?? 0,
    perUserRowCounts: perUserR.rows,
    oldestRowResolvedAt: oldestResolvedAt,
    oldestRowAgeDays: oldestAgeDays == null ? null : Math.round(oldestAgeDays * 10) / 10,
    retentionDays: RETENTION_DAYS,
    maxRowsPerUser: MAX_ROWS_PER_USER,
    anyUserNearCap: perUserR.rows.some((r) => r.n >= MAX_ROWS_PER_USER * 0.8),
    oldestRowNearRetentionBound: oldestAgeDays != null && oldestAgeDays >= RETENTION_DAYS * 0.8,
    pruneHeartbeatFound: heartbeatAt != null,
    pruneHeartbeatNote: heartbeatAt != null
      ? `Heartbeat found: cron/prune-adaptation-shadow-log last recorded success at ${heartbeatAt}.`
      : 'No heartbeat row found in ops_alerts for cron/prune-adaptation-shadow-log. The route '
        + 'DOES stamp its own completion — app/api/cron/prune-adaptation-shadow-log/route.ts:44 '
        + 'calls lib/ops/cron-ledger.ts\'s recordCronSuccess(\'prune-adaptation-shadow-log\') on '
        + 'its success path — so an empty read here means the job has not completed successfully '
        + 'since that wiring landed, not that the ledger cannot see it. (This note used to say the '
        + 'route "never calls recordCronSuccess at all", which was true when written and stopped '
        + 'being true the same day. A stale caveat turns a real absence into a shrug.) Check the '
        + 'GitHub Actions run history for .github/workflows/prune-adaptation-shadow-log.yml '
        + '(05:00 UTC) to tell a job that is not firing from one that is failing. Separately: with '
        + 'neither bound (180 days / 400 rows) anywhere close to binding yet, this report cannot '
        + 'yet empirically prove pruning WORKS — there is nothing to prune.',
  };
}

/* ══════════════════════════ overall verdict ═══════════════════════════════ */

export type Verdict = 'PASS' | 'NOT_YET_ENOUGH_DATA' | 'NEEDS_REVIEW' | 'CAP_EXCEEDED_ESCALATE' | 'HARD_FAIL';

export interface StabilityReport {
  userUuid: string;
  generatedAt: string;
  rowCount: number;
  consecutiveDays: ConsecutiveDaysReport;
  eligibleCycles: EligibleCyclesReport;
  mutationViolations: MutationViolation[];
  materialIncompatibilityViolations: IncompatibilityViolation[];
  contradictions: ContradictionEntry[];
  oscillation: OscillationReport;
  materialChanges: MaterialChangeReport;
  phoneWatch: PhoneWatchReport;
  retention: RetentionReport;
  daysSinceFirstRecord: number | null;
  capExceeded: boolean;
  verdict: Verdict;
  verdictReasons: string[];
  allUsersSummary: AllUsersSummaryRow[];
}

export function computeVerdict(r: Omit<StabilityReport, 'verdict' | 'verdictReasons'>): { verdict: Verdict; reasons: string[] } {
  const hardFailReasons: string[] = [];
  if (r.mutationViolations.length > 0) {
    hardFailReasons.push(
      `${r.mutationViolations.length} plan-mutation/checksum violation(s) — this must be exactly zero, `
      + 'always. See mutationViolations for the row ids.',
    );
  }
  if (r.materialIncompatibilityViolations.length > 0) {
    hardFailReasons.push(
      `${r.materialIncompatibilityViolations.length} row(s) where hr_compat_verdict = `
      + 'INCOMPATIBLE_REFUSE but finalDecision was NOT REFUSED_HR_INCOMPATIBLE — a material '
      + 'incompatibility was treated as a valid progress proposal. This must never happen.',
    );
  }
  if (hardFailReasons.length > 0) return { verdict: 'HARD_FAIL', reasons: hardFailReasons };

  const reviewReasons: string[] = [];
  if (r.contradictions.length > 0) {
    reviewReasons.push(`${r.contradictions.length} unresolved contradiction(s) logged — see contradictions.`);
  }
  if (r.oscillation.unexplainedFlips.length > 0) {
    reviewReasons.push(
      `${r.oscillation.unexplainedFlips.length} unexplained PROGRESS/HOLD oscillation(s) across `
      + 'consecutive days — see oscillation.unexplainedFlips.',
    );
  }
  if (r.materialChanges.unexplainedChanges.length > 0) {
    reviewReasons.push(
      `${r.materialChanges.unexplainedChanges.length} unexplained material proposal change(s) — see `
      + 'materialChanges.unexplainedChanges.',
    );
  }
  if (r.phoneWatch.currentDayMatchesLiveNow === false) {
    reviewReasons.push(
      'The most recent shadow-compare row is dated today but its recorded after-checksum does not '
      + 'match plan_workouts as read right now — something changed the live plan since that cycle ran.',
    );
  }
  if (!r.phoneWatch.everyRowInternallyConsistent) {
    reviewReasons.push(
      `${r.phoneWatch.inconsistentRowIds.length} row(s) with a before/after checksum mismatch — this `
      + 'overlaps mutationViolations by construction; listed here too because it is the phone/watch-'
      + 'facing consequence of the same fact.',
    );
  }
  if (reviewReasons.length > 0) return { verdict: 'NEEDS_REVIEW', reasons: reviewReasons };

  if (r.eligibleCycles.metTarget) {
    return {
      verdict: 'PASS',
      reasons: [
        `${r.eligibleCycles.count} eligible, uncontaminated evaluation cycles reached (target `
        + `${TARGET_ELIGIBLE_CYCLES}), zero hard failures, zero open review items.`,
      ],
    };
  }

  if (r.capExceeded) {
    return {
      verdict: 'CAP_EXCEEDED_ESCALATE',
      reasons: [
        `${r.daysSinceFirstRecord ?? '?'} days have elapsed since the first shadow-log record `
        + `(cap: ${DAY_CAP}) and only ${r.eligibleCycles.count} of the target ${TARGET_ELIGIBLE_CYCLES} `
        + 'eligible cycles have accumulated. Per the policy brief, the day-14 cap means this now needs '
        + 'a human decision, not just more waiting — either the eligibility bar is being missed for a '
        + 'reason worth naming, or the cadence itself needs review.',
      ],
    };
  }

  return {
    verdict: 'NOT_YET_ENOUGH_DATA',
    reasons: [
      `${r.eligibleCycles.count} of ${TARGET_ELIGIBLE_CYCLES} target eligible cycles so far, `
      + `${r.consecutiveDays.currentStreak} of ${TARGET_CONSECUTIVE_DAYS} target consecutive days. `
      + `No hard failures, no open review items. Per policy: continue running, re-check at day 7 and, `
      + `if still short, day ${DAY_CAP}. This is the expected, honest state — not a failure.`,
    ],
  };
}

/* ══════════════════════════════ rendering ═══════════════════════════════ */

function printText(r: StabilityReport): void {
  const line = (s = '') => console.log(s);
  const hr = () => line('─'.repeat(78));

  line(`STAGE 1 STABILITY REPORT · adaptation_shadow_log`);
  line(`user: ${r.userUuid}    generated: ${r.generatedAt}    rows read: ${r.rowCount}`);
  hr();

  line(`VERDICT: ${r.verdict}`);
  for (const reason of r.verdictReasons) line(`  - ${reason}`);
  hr();

  line('1 · Consecutive scheduled evaluation days');
  line(`   target ${r.consecutiveDays.target} · current streak ${r.consecutiveDays.currentStreak} `
    + `(${r.consecutiveDays.streakStartDate ?? '—'} → ${r.consecutiveDays.lastDay ?? '—'}) `
    + `· met target: ${r.consecutiveDays.metTarget}`);
  line(`   distinct days seen: ${r.consecutiveDays.distinctDays} · span `
    + `${r.consecutiveDays.firstDay ?? '—'}..${r.consecutiveDays.lastDay ?? '—'} `
    + `(${r.consecutiveDays.spanDays} calendar days)`);
  if (r.consecutiveDays.missingDates.length > 0) {
    line(`   MISSING DATES within span: ${r.consecutiveDays.missingDates.join(', ')}`);
  }
  line();

  line('2 · Successful, uncontaminated evaluation cycles');
  line(`   target ${r.eligibleCycles.target} · eligible so far: ${r.eligibleCycles.count} `
    + `· met target: ${r.eligibleCycles.metTarget}`);
  line(`   eligible days: ${r.eligibleCycles.eligibleDays.join(', ') || '(none)'}`);
  for (const ineligible of r.eligibleCycles.ineligibleDays) {
    line(`   ineligible ${ineligible.date}: ${ineligible.reason}`);
  }
  line();

  line('3 · Plan mutations / checksum violations (HARD FAIL if nonzero)');
  line(`   count: ${r.mutationViolations.length}`);
  for (const v of r.mutationViolations) line(`   id ${v.id} (${v.todayIso}): ${v.detail}`);
  line();

  line('4 · Unresolved contradictions');
  line(`   count: ${r.contradictions.length}`);
  for (const c of r.contradictions) line(`   id ${c.id} (${c.todayIso}) [${c.code}]: ${c.detail}`);
  line();

  line('5 · MATERIAL_INCOMPATIBILITY accepted as valid PROGRESS (HARD FAIL if any)');
  line(`   count: ${r.materialIncompatibilityViolations.length}`);
  for (const v of r.materialIncompatibilityViolations) {
    line(`   id ${v.id} (${v.todayIso}): finalDecision was ${v.finalDecision}`);
  }
  line();

  line('6 · Unexplained PROGRESS/HOLD oscillation across consecutive days');
  line(`   consecutive day-pairs checked: ${r.oscillation.checkedPairs} `
    + `(${r.oscillation.skippedNonConsecutivePairs} pair(s) skipped — not calendar-adjacent)`);
  line(`   flips found: ${r.oscillation.flips.length} · unexplained: ${r.oscillation.unexplainedFlips.length}`);
  for (const f of r.oscillation.flips) {
    const tag = f.explanation.explained ? 'explained' : 'UNEXPLAINED';
    line(`   ${f.fromDate} (${f.from}) → ${f.toDate} (${f.to}) — ${tag}`);
    for (const reason of f.explanation.reasons) line(`      · ${reason}`);
  }
  line();

  line('7 · Material proposal changes day-over-day (same mechanism, applied generally)');
  line(`   consecutive day-pairs checked: ${r.materialChanges.checkedPairs} `
    + `(${r.materialChanges.skippedNonConsecutivePairs} pair(s) skipped)`);
  line(`   changes found: ${r.materialChanges.changes.length} `
    + `· unexplained: ${r.materialChanges.unexplainedChanges.length}`);
  for (const c of r.materialChanges.changes) {
    const tag = c.explanation.explained ? 'explained' : 'UNEXPLAINED';
    line(`   ${c.fromDate} → ${c.toDate} [${c.kind}] ${c.detail} — ${tag}`);
    for (const reason of c.explanation.reasons) line(`      · ${reason}`);
  }
  line();

  line('8 · Phone/Watch target consistency');
  line(`   live plan_workouts checksum (now): ${r.phoneWatch.liveChecksumNow}`);
  line(`   most recent shadow row: ${r.phoneWatch.mostRecentRowTodayIso ?? '—'} `
    + `checksumAfter=${r.phoneWatch.mostRecentRowChecksumAfter ?? '—'}`);
  line(`   current-day match (if most recent row is dated today): ${r.phoneWatch.currentDayMatchesLiveNow}`);
  line(`   every row internally consistent (before==after): ${r.phoneWatch.everyRowInternallyConsistent}`);
  line(`   full historical reconstruction possible: ${r.phoneWatch.fullHistoricalReconstructionPossible}`);
  line(`   NOTE: ${r.phoneWatch.limitationNote}`);
  line();

  line('9 · Shadow-log retention/pruning health');
  line(`   total rows (all users): ${r.retention.totalRows}`);
  line(`   oldest row: ${r.retention.oldestRowResolvedAt ?? '—'} (age ${r.retention.oldestRowAgeDays ?? '—'} days, `
    + `retention bound ${r.retention.retentionDays} days)`);
  line(`   any user near the ${r.retention.maxRowsPerUser}-row cap: ${r.retention.anyUserNearCap}`);
  line(`   oldest row near the retention bound: ${r.retention.oldestRowNearRetentionBound}`);
  line(`   prune heartbeat found: ${r.retention.pruneHeartbeatFound}`);
  line(`   NOTE: ${r.retention.pruneHeartbeatNote}`);
  line();

  hr();
  line('All users currently in adaptation_shadow_log (context only — verdict above is scoped to the '
    + 'requested user):');
  for (const u of r.allUsersSummary) {
    line(`   ${u.userUuid}  rows=${u.nRows} days=${u.nDays} lastConvergence=${u.lastConvergence} `
      + `lastDecision=${u.lastDecision}`);
  }
}

/* ══════════════════════════════ main ══════════════════════════════════════ */

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL_RO) {
    console.error(
      'DATABASE_URL_RO is not set. This report refuses to fall back to DATABASE_URL (the writable '
      + 'role) — read-only is a hard constraint of this tool, enforced by which role it connects as, '
      + 'not just by which queries it happens to run.',
    );
    process.exit(1);
  }
  const pool = newPool(process.env.DATABASE_URL_RO);

  try {
    const [allRows, allUsersSummary] = await Promise.all([
      fetchRows(pool, USER_UUID),
      fetchAllUsersSummary(pool),
    ]);
    const perDay = latestPerDay(allRows);

    const consecutiveDays = consecutiveDaysReport(perDay);
    const eligibleCycles = eligibleCyclesReport(perDay);
    const mutViolations = mutationViolations(allRows);
    const incompatViolations = materialIncompatibilityAcceptedAsProgress(allRows);
    const contradictions = unresolvedContradictions(allRows);
    const oscillation = oscillationReport(perDay);
    const materialChanges = materialChangeReport(perDay);
    const phoneWatch = await phoneWatchReport(pool, USER_UUID, allRows);
    const retention = await retentionReport(pool);

    const daysSinceFirstRecord = consecutiveDays.firstDay
      ? Math.round((Date.now() - new Date(`${consecutiveDays.firstDay}T00:00:00Z`).getTime()) / 86_400_000)
      : null;
    const capExceeded = daysSinceFirstRecord != null && daysSinceFirstRecord >= DAY_CAP;

    const base: Omit<StabilityReport, 'verdict' | 'verdictReasons'> = {
      userUuid: USER_UUID,
      generatedAt: new Date().toISOString(),
      rowCount: allRows.length,
      consecutiveDays, eligibleCycles,
      mutationViolations: mutViolations,
      materialIncompatibilityViolations: incompatViolations,
      contradictions, oscillation, materialChanges, phoneWatch, retention,
      daysSinceFirstRecord, capExceeded,
      allUsersSummary,
    };
    const { verdict, reasons } = computeVerdict(base);
    const report: StabilityReport = { ...base, verdict, verdictReasons: reasons };

    if (JSON_OUT) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printText(report);
    }

    // Exit code signals verdict for CI/cron use, without requiring the
    // caller to parse text: 0 = PASS or NOT_YET_ENOUGH_DATA (both are
    // "nothing alarming right now"), 1 = NEEDS_REVIEW or CAP_EXCEEDED
    // (needs a human), 2 = HARD_FAIL (needs a human urgently).
    if (verdict === 'HARD_FAIL') process.exitCode = 2;
    else if (verdict === 'NEEDS_REVIEW' || verdict === 'CAP_EXCEEDED_ESCALATE') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
