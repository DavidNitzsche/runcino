/**
 * GET/POST /api/admin/canonical-adaptation-shadow
 *
 * OWNER-VISIBLE surface for the canonical Adaptation Engine's live shadow
 * evaluation. David's own words: "Complete historical replay, shadow
 * evaluation, and owner-visible proposals." This is what "owner-visible"
 * means tonight — read on for exactly what that is and is not.
 *
 * ── WHAT THIS IS, AND WHY IT IS ENOUGH FOR TONIGHT ──────────────────────
 *
 * A read-only diagnostic endpoint, admin-gated, the same posture every
 * other `/api/admin/audit-*` route already uses in this codebase
 * (`audit-races`, `audit-coach-intents`, `audit-weather`). It shows, per
 * lever, the MOST RECENT canonical decision record: what the engine
 * decided, why, what evidence it read and excluded, and what would change
 * its mind. It does NOT:
 *
 *   · apply anything — reading `canonical_adaptation_shadow_log` cannot
 *     touch a plan row, and nothing here calls a mutating function
 *   · surface as a card or a banner the runner has to act on — it is a
 *     diagnostic view, reached deliberately, not pushed
 *   · promise interactivity beyond what this route already gives — no
 *     accept/dismiss action exists, because nothing is proposed to the
 *     runner yet
 *
 * A FULLER surface — a real screen on the phone, a card in the coach log,
 * an accept/dismiss action — needs a native build (per CLAUDE.md, iPhone is
 * the product surface; the web frontend is paused), a decision about WHERE
 * in the existing screen inventory a canonical-engine section belongs
 * (`docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`'s "what decision does this
 * help the runner make" test), and — per the presentation rulings this
 * route already applies to its OWN wording (Q37-Q39) — real product
 * judgement about whether "the coach is now shadow-evaluating a fourth
 * lever" is something the runner should see AT ALL before it can act, or
 * whether it stays an operator-only diagnostic until PROGRESS actually
 * fires even once (which, per the replay findings in
 * `docs/MASTER_CORE_PRODUCT_PROGRAM.md`, it has not, honestly, yet). That
 * is a real decision, not a small one, and it is named here rather than
 * quietly built past.
 *
 * ── WORDING FOLLOWS THE PRESENTATION RULINGS (Q37-Q39) ──────────────────
 *
 * Confidence never appears as a raw decimal in the top-level `records`
 * (Q39) — the `confidence` object already IS the doctrine's own shape
 * (sentence, limitation, counts), and `rawConfidenceRedacted` marks where
 * the auditable-only number lives instead, reachable only with
 * `?detail=1`. No content implies a plan change unless the record's own
 * `decision` says so (Q38's own rule, restated for this surface).
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { requireAdmin } from '@/lib/auth/session';
import { runAndPersistCanonicalShadowEvaluation } from '@/lib/adaptation/canonical-shadow/run-live-shadow-evaluation';

export const dynamic = 'force-dynamic';

interface ShadowRow {
  lever: string;
  decision: string;
  reason: string;
  gap: string;
  before_value: string;
  proposed_after_value: string | null;
  confidence: unknown;
  what_would_change_it: unknown;
  suppressed_by: unknown;
  evidence_included: unknown;
  evidence_excluded: unknown;
  evaluated_at_iso: string;
  boundary: string;
  idempotency_key: string;
}

async function tableExists(): Promise<boolean> {
  try {
    const r = await pool.query<{ reg: string | null }>(
      `SELECT to_regclass('public.canonical_adaptation_shadow_log')::text AS reg`,
    );
    return r.rows[0]?.reg != null;
  } catch {
    return false;
  }
}

async function latestPerLever(userUuid: string) {
  const r = await pool.query<ShadowRow>(
    `SELECT DISTINCT ON (lever) lever, decision, reason, gap,
            before_value::text AS before_value, proposed_after_value::text AS proposed_after_value,
            confidence, what_would_change_it, suppressed_by,
            evidence_included, evidence_excluded, evaluated_at_iso::text AS evaluated_at_iso,
            boundary, idempotency_key
       FROM canonical_adaptation_shadow_log
      WHERE user_uuid = $1::uuid
      ORDER BY lever, evaluated_at_iso DESC`,
    [userUuid],
  );
  return r.rows;
}

function present(row: ShadowRow, detail: boolean) {
  const confidence = row.confidence as {
    supportingCount?: number; contradictingCount?: number; windowDays?: number;
    sentence?: string; limitation?: string | null; rawConfidence?: number;
  } | null;
  return {
    lever: row.lever,
    decision: row.decision,
    // Q38 · never implies a plan change unless the decision itself says so.
    // `decision` already carries that fact; this route adds nothing beyond
    // it that a reader could mistake for a promise.
    reason: row.reason,
    gap: row.gap,
    beforeValue: Number(row.before_value),
    proposedAfterValue: row.proposed_after_value != null ? Number(row.proposed_after_value) : null,
    confidence: confidence ? {
      sentence: confidence.sentence ?? null,
      limitation: confidence.limitation ?? null,
      supportingCount: confidence.supportingCount ?? null,
      contradictingCount: confidence.contradictingCount ?? null,
      windowDays: confidence.windowDays ?? null,
      // Q39 · raw decimals stay out of the normal view; `?detail=1` is the
      // "auditable decision detail" the ruling explicitly allows to carry
      // them.
      ...(detail ? { rawConfidence: confidence.rawConfidence ?? null } : { rawConfidenceRedacted: true }),
    } : null,
    whatWouldChangeIt: row.what_would_change_it,
    suppressedBy: row.suppressed_by,
    evaluatedAtISO: row.evaluated_at_iso,
    boundary: row.boundary,
    ...(detail ? {
      evidenceIncluded: row.evidence_included,
      evidenceExcluded: row.evidence_excluded,
      idempotencyKey: row.idempotency_key,
    } : {}),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  if (!(await tableExists())) {
    return NextResponse.json({
      ok: true,
      records: [],
      note: 'canonical_adaptation_shadow_log does not exist yet on this database '
        + '(migration 164 not applied) — the live evaluation code is wired and will '
        + 'persist here once the migration lands.',
    });
  }

  const detail = new URL(req.url).searchParams.get('detail') === '1';
  const rows = await latestPerLever(userUuid);
  return NextResponse.json({
    ok: true,
    records: rows.map((r) => present(r, detail)),
    note: rows.length === 0
      ? 'No canonical shadow evaluation has run for this account yet. POST to this '
        + 'endpoint to run one on demand, or wait for the next run-adaptations cron cycle.'
      : null,
  });
}

/**
 * On-demand evaluation, per the task's own "on a schedule (or on-demand)".
 * Operational, self-execute per CLAUDE.md's three-bucket rule: this is a
 * diagnostic endpoint the agent built, running read-only evidence gathering
 * plus one write to a table with no consumer but this mechanism — not an
 * externally-consequential action, and not a decision requiring a pause.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const userUuid = auth;

  const result = await runAndPersistCanonicalShadowEvaluation(userUuid);
  return NextResponse.json({ ok: result.ran, ...result });
}
