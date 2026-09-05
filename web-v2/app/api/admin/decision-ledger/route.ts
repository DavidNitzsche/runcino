/**
 * GET /api/admin/decision-ledger
 *
 * THE OPERATOR'S READ OF THE DURABLE DECISION LEDGER AND THE REASSESSMENT
 * SCHEDULE. Read-only, admin-gated, the same posture every other
 * `/api/admin/audit-*` route in this codebase already uses.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT A RUNNER SURFACE ────────────────────
 *
 * CLAUDE.md Rule 21's census — 309 production intents, zero upward
 * adaptations — had to be reconstructed sideways out of `coach_intents`
 * because the engine's own log could not answer it. `plan_decision_ledger`
 * now can, and this route is the one place that answer is actually READ:
 *
 *     GET /api/admin/decision-ledger
 *     → { census: { UP, DOWN, NEUTRAL, UNKNOWN }, decisions: [...], schedule: [...] }
 *
 * It is an OPERATOR diagnostic, not a runner screen, for the reason the
 * neighbouring canonical-shadow route already argues at length: a decision
 * ledger is engine state, and putting engine state in front of the runner is
 * surface area that does not change what he should do next
 * (`docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`). A runner-facing history of
 * "what the coach did and why" is a real product idea and a real decision, and
 * it is named here rather than quietly built past.
 *
 * ── IT CANNOT CHANGE ANYTHING ──────────────────────────────────────────────
 *
 * GET only. Every function it calls is a SELECT. There is no POST, no accept,
 * no dismiss and no re-run: the ledger records decisions, and a surface that
 * could also MAKE one would be a second door past `mutatePlan`.
 *
 * ── RULE 11 · IT REPORTS THREE STATES AND NEVER FLATTENS THEM ──────────────
 *
 * `table_absent` (migration 166/167 not applied here), `failed` (the read
 * broke) and a real empty result are three different answers, and an operator
 * told the wrong one of them is worse off than one told nothing. Each is
 * reported by name, with the reason the reader gave.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/session';
import { directionCensus, loadRecentDecisions } from '@/lib/brain/ledger/decision-ledger';
import { loadLiveQueue } from '@/lib/ops/reassessment-scheduler';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const limitRaw = Number(new URL(req.url).searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 500) : 50;

  const [census, history, queue] = await Promise.all([
    directionCensus(userUuid),
    loadRecentDecisions(userUuid, limit),
    loadLiveQueue(userUuid),
  ]);

  return NextResponse.json({
    ok: history.state === 'read',
    /* Rule 21's question, answered from the engine's own log. */
    census: census.state === 'measured' ? census.counts : null,
    censusState: census.state,
    censusNote: census.state === 'measured' ? null : census.why,

    decisions: history.state === 'read'
      ? history.rows.map((r) => ({
        at: r.at,
        plan_id: r.planId,
        plan_lineage_id: r.planLineageId,
        lever: r.lever,
        direction: r.direction,
        decision: r.decision,
        authority: r.authority,
        authority_verdict: r.authorityVerdict,
        mutation_outcome: r.mutationOutcome,
        scope: r.scope,
        /* The three columns a person needs to judge a decision without opening
         * the code: what happened, who did it, and what it rested on. */
        provenance: r.provenance,
        explanation: r.explanation,
        evidence: r.evidence,
        model_version: r.modelVersion,
        superseded_at: r.supersededAt,
        undone_at: r.undoneAt,
        undo_reason: r.undoReason,
      }))
      : [],
    decisionsState: history.state,
    decisionsNote: history.state === 'read' ? null : history.why,

    schedule: queue.state === 'ok'
      ? queue.value.map((i) => ({
        kind: i.kind,
        status: i.status,
        assess_on_iso: i.assessOnISO,
        overdue_after_iso: i.overdueAfterISO,
        reason_code: i.reasonCode,
        reason_detail: i.reasonDetail,
        required_evidence: i.requiredEvidence,
        attempts: i.attempts,
        last_error: i.lastError,
        next_retry_at: i.nextRetryAt,
        plan_version: i.planVersion,
        lever: i.lever,
      }))
      : [],
    scheduleState: queue.state,
    scheduleNote: queue.state === 'ok' ? null : queue.why,
  });
}
