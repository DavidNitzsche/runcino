/**
 * lib/plan/reanchor-proposal.ts · THE RE-ANCHOR, RAISED AS A QUESTION.
 *
 * REANCHORPROPOSES-1 (2026-09-05). Until today `reanchorActivePlan` calculated
 * a repricing and WROTE it, from an unattended cron, declaring
 * `authority: 'COACHING_ADAPTATION'` and then handing `mutatePlan` a named hold
 * that let the write through anyway. David:
 *
 *   "The current state is contradictory: COACHING_ADAPTATION is supposedly
 *    refused, while a named hold allows reanchor to continue changing workouts.
 *    A hold that continues writing is an exemption with better paperwork."
 *
 * The calculation is unchanged. What changed is where it lands: a row in
 * `plan_workout_proposals`, which the runner accepts or dismisses. Nothing in
 * `lib/plan/adaptation-authority.ts` was opened to do it —
 * `AUTOMATIC_ADAPTATION_AUTHORITY` is still the literal `false`, and a proposal
 * is not a mutation.
 *
 * `lib/plan/reprice-payload.ts` carries the shape and the argument for why one
 * coordinated proposal is the right unit rather than seventy-seven cards.
 *
 * ── WHAT THIS FILE CANNOT DO, SAID PLAINLY (Rule 22) ───────────────────────
 *
 * It cannot make the runner tap accept. Pace re-anchoring is the one upward
 * adaptation path in this engine that fired end to end, and after this change
 * it does not move a pace until he consents. That is the intended outcome of
 * the owner's ruling and it is stated in the handback rather than left to be
 * discovered. What it must never do is go QUIET — a re-anchor that warrants a
 * change and raises no card is the failure mode, so every branch below returns
 * a named status and the cron reports it (Rule 11: a refusal that nobody can
 * see is indistinguishable from nothing having happened).
 */

import { pool } from '@/lib/db/pool';
import { attempt } from '@/lib/db/read';
import { resolveDateRangeExecutions } from '@/lib/execution/day-resolver';
import { stripResearchCitations } from './strip-citations';
import { describesEvidence } from '@/lib/brain/objective';
import {
  REPRICE_ACTION_KIND,
  asRepricePayload,
  type RepriceAnchorMove,
  type RepriceArm,
  type RepricePayload,
} from './reprice-payload';

/**
 * A repricing the runner said no to stays said-no-to for this long, provided
 * the engine still believes the same thing.
 *
 * Not a physiological number and not doctrine: it is a nagging budget. Without
 * it the daily cron re-raises an identical card every morning after a dismissal,
 * which is the exact annoyance the whole proposal flow was built to end ("I
 * dont want to wake up to change runs · that was annoying", 2026-06-04). The
 * moment the engine's answer CHANGES the quiet ends, because that is a new
 * question rather than the same one repeated.
 */
export const REPRICE_DISMISSAL_QUIET_DAYS = 7;

/** Two repricings are "the same question" when their prices agree this closely. */
const SAME_QUESTION_SEC_PER_MI = 2;

/**
 * What happened, in the vocabulary a cron response and a log line can both use.
 *
 * Rule 11 · every branch is distinguishable. `unchanged` (the engine looked and
 * the prices do not move), `no_target` (nothing left in the block to reprice)
 * and `read_failed` are three different facts, and the one that must never be
 * silent is the last.
 */
export type RepriceProposalOutcome =
  | { status: 'written'; proposalId: number; payload: RepricePayload; supersededId: number | null }
  | { status: 'unchanged'; existingProposalId: number | null; reason: string }
  | { status: 'quiet_after_dismissal'; dismissedProposalId: number; untilISO: string }
  | { status: 'no_target'; reason: string }
  | { status: 'refused'; reason: string }
  | { status: 'read_failed'; error: Error };

export interface WriteReanchorProposalInput {
  userUuid: string;
  planId: string;
  arm: RepriceArm;
  todayISO: string;
  fromVdot: number | null;
  toVdot: number | null;
  /** `measured_vdot`, or the canonical threshold's own source mode. */
  toSource: string;
  measured: boolean;
  /** What the block is priced at now, keyed as the Rule 10 stamp records it. */
  pricedAnchors: Record<string, unknown> | null;
  /** What the repricing would price it at. */
  liveAnchors: {
    thresholdSecPerMi: number | null;
    intervalSecPerMi: number | null;
    repetitionSecPerMi: number | null;
    easyCeilingSecPerMi: number | null;
    shakeoutCeilingSecPerMi: number | null;
    marathonSecPerMi: number | null;
  };
  /** One sentence, in the coach's voice, naming what was measured. */
  reason: string;
  /** The trigger's own record, rendered by the details sheet. */
  evidence: Record<string, unknown>;
}

/** The six canonical anchors, stamp key beside live key. One list. */
const ANCHOR_PAIRS = [
  ['threshold_s_per_mi', 'thresholdSecPerMi'],
  ['interval_s_per_mi', 'intervalSecPerMi'],
  ['repetition_s_per_mi', 'repetitionSecPerMi'],
  ['easy_ceiling_s_per_mi', 'easyCeilingSecPerMi'],
  ['shakeout_ceiling_s_per_mi', 'shakeoutCeilingSecPerMi'],
  ['marathon_s_per_mi', 'marathonSecPerMi'],
] as const;

/**
 * What the block is priced at right now, which is a WIDER question than the
 * drift gate's.
 *
 * `anchorsMovedFromStamp` compares against `pace_recompute.anchors` only,
 * because its question is "has anything moved since the last recompute". This
 * one asks "what is this block priced at", and a block authored canonically and
 * never recomputed answers that from `pace_authoring.anchors`. The two are
 * deliberately separate reads with separate names rather than one function used
 * for both questions (Rule 16 cuts both ways: two questions, two names).
 */
export function pricedAnchorsOf(authoredState: Record<string, unknown> | null): Record<string, unknown> | null {
  const st = (authoredState ?? {}) as Record<string, any>;
  const rungs = [st.pace_recompute?.anchors, st.pace_authoring?.anchors, st.pace_anchors];
  for (const r of rungs) {
    if (r != null && typeof r === 'object') return r as Record<string, unknown>;
  }
  return null;
}

/**
 * Every anchor whose BOTH sides are known, with no magnitude filter.
 *
 * `anchorsMovedFromStamp` applies `REANCHOR_ANCHOR_DELTA_S_PER_MI` because it
 * is answering "is this worth acting on". This is answering "what would the
 * runner see change", and filtering there would print a card claiming fewer
 * moves than the accept will actually make.
 */
export function anchorMovesBetween(
  priced: Record<string, unknown> | null,
  live: WriteReanchorProposalInput['liveAnchors'],
): RepriceAnchorMove[] {
  if (priced == null) return [];
  const out: RepriceAnchorMove[] = [];
  for (const [stampKey, liveKey] of ANCHOR_PAIRS) {
    const was = priced[stampKey] != null ? Number(priced[stampKey]) : null;
    const now = live[liveKey];
    if (was == null || !Number.isFinite(was)) continue;
    if (now == null || !Number.isFinite(now)) continue;
    out.push({ key: stampKey, fromSecPerMi: was, toSecPerMi: now });
  }
  return out;
}

/**
 * THE ONE DIRECTION-BEARING QUANTITY.
 *
 * Mean signed change in seconds per mile across the anchors that have both
 * sides. NEGATIVE IS FASTER. Computed here and nowhere else, so the card, the
 * log line and any future surface cannot each decide which way a repricing
 * points (Rule 16 · the three-projections defect, in miniature).
 */
export function meanAnchorDelta(moves: readonly RepriceAnchorMove[]): number | null {
  const known = moves.filter((m) => m.fromSecPerMi != null);
  if (known.length === 0) return null;
  const sum = known.reduce((a, m) => a + (m.toSecPerMi - (m.fromSecPerMi as number)), 0);
  return sum / known.length;
}

/** Are these two repricings the same question asked twice? */
export function isSameRepricing(a: RepricePayload, b: RepricePayload): boolean {
  if (a.arm !== b.arm || a.planId !== b.planId) return false;
  const byKey = new Map(a.anchorMoves.map((m) => [m.key, m.toSecPerMi]));
  for (const m of b.anchorMoves) {
    const other = byKey.get(m.key);
    if (other == null) return false;
    if (Math.abs(other - m.toSecPerMi) > SAME_QUESTION_SEC_PER_MI) return false;
  }
  return byKey.size === b.anchorMoves.length;
}

/**
 * Raise the repricing as a card. Writes nothing to the plan.
 *
 * Idempotent across a day's re-runs: an identical pending card is left alone,
 * a materially different one supersedes it, and a card the runner dismissed
 * inside the quiet window is not re-raised while the engine's answer is
 * unchanged.
 */
export async function writeReanchorProposal(
  input: WriteReanchorProposalInput,
): Promise<RepriceProposalOutcome> {
  const moves = anchorMovesBetween(input.pricedAnchors, input.liveAnchors);
  if (moves.length === 0) {
    // Rule 11 · this is NOT "nothing changed". It is "the block records no
    // anchors to compare a change against", and a card that cannot say what
    // moves is a card the runner cannot judge. Refused, loudly, rather than
    // shown with a fabricated direction.
    return {
      status: 'refused',
      reason: 'the block records no priced anchors, so the repricing cannot say what would change',
    };
  }
  const mean = meanAnchorDelta(moves);
  if (mean == null) {
    return { status: 'refused', reason: 'no anchor has both sides, so there is no direction to show' };
  }
  if (moves.every((m) => m.fromSecPerMi != null && Math.abs(m.toSecPerMi - m.fromSecPerMi) < 1)) {
    return { status: 'unchanged', existingProposalId: null, reason: 'every anchor lands on the same second per mile' };
  }

  const why = stripResearchCitations(input.reason).trim();
  if (!describesEvidence(why)) {
    // The objective's clause, on the live path. A repricing the runner is asked
    // to accept must name what was measured; "your fitness looks different" is
    // a disposition, not a fact.
    return {
      status: 'refused',
      reason: `the reason names a disposition rather than a fact: "${why}"`,
    };
  }

  /* ── WHICH DAYS THE REPRICING WOULD TOUCH ────────────────────────────────
   *
   * The prescription side is read here; the SEALED side is asked of
   * `lib/execution/day-resolver.ts`, which owns it. This function writes NO
   * `runs` query of its own, and that is deliberate rather than incidental:
   * "a run exists on the same calendar date" is not "this prescription was
   * executed", and EXECID-SCAN-1 exists because that shortcut has been the
   * same defect in four separate places. `matchedRun` is the canonical answer.
   */
  const future = await attempt(
    'plan/reanchor-proposal · future pace-bearing days',
    pool.query<{ id: string; date_iso: string }>(
      `SELECT pw.id::text AS id, pw.date_iso::text AS date_iso
         FROM plan_workouts pw
        WHERE pw.plan_id = $1 AND pw.date_iso >= $2
          AND pw.type NOT IN ('rest','cross','strength')
        ORDER BY pw.date_iso ASC`,
      [input.planId, input.todayISO],
    ),
  );
  if (!future.ok) return { status: 'read_failed', error: future.error };
  const futureRows = future.value.rows;
  if (futureRows.length === 0) {
    return {
      status: 'no_target',
      reason: 'the block has no future pace-bearing day left to reprice',
    };
  }

  const lastISO = futureRows[futureRows.length - 1].date_iso;
  const endExclusive = (() => {
    const d = new Date(`${lastISO}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const resolved = await resolveDateRangeExecutions(input.userUuid, input.todayISO, endExclusive)
    .catch((e: unknown) => {
      // Rule 11 · a resolver that could not answer is NOT "nothing is sealed".
      // The conservative reading would seal everything and report `no_target`,
      // which reads on the cron exactly like a finished block. Reported as the
      // read failure it is.
      return e instanceof Error ? e : new Error(String(e));
    });
  if (resolved instanceof Error) return { status: 'read_failed', error: resolved };

  const unsealed = futureRows.filter((r) => {
    const day = resolved.get(r.date_iso);
    const p = day?.prescriptions.find((x) => x.id === r.id);
    return p?.matchedRun == null;
  });
  const row = unsealed[0];
  if (!row) {
    return {
      status: 'no_target',
      reason: 'every future pace-bearing day in the block has already been run',
    };
  }

  const payload: RepricePayload = {
    kind: REPRICE_ACTION_KIND,
    planId: input.planId,
    arm: input.arm,
    fromVdot: input.fromVdot,
    toVdot: input.toVdot,
    toSource: input.toSource,
    measured: input.measured,
    anchorMoves: moves,
    meanAnchorDeltaSecPerMi: mean,
    workoutsAffected: unsealed.length,
    workoutsSealed: futureRows.length - unsealed.length,
    computedAt: new Date().toISOString(),
  };

  const prior = await attempt(
    'plan/reanchor-proposal · existing reprice rows',
    pool.query<{ id: number; status: string; action_payload: { reprice?: unknown }; resolved_at: Date | null }>(
      `SELECT id, status, action_payload, resolved_at
         FROM plan_workout_proposals
        WHERE user_uuid = $1::uuid AND action_kind = $2
          AND status IN ('pending','dismissed')
        ORDER BY created_at DESC
        LIMIT 20`,
      [input.userUuid, REPRICE_ACTION_KIND],
    ),
  );
  if (!prior.ok) return { status: 'read_failed', error: prior.error };

  let supersededId: number | null = null;
  for (const p of prior.value.rows) {
    const existing = asRepricePayload(p.action_payload?.reprice);
    if (existing == null) continue;
    const same = isSameRepricing(existing, payload);
    if (p.status === 'pending') {
      if (same) {
        return { status: 'unchanged', existingProposalId: p.id, reason: 'this card is already up' };
      }
      supersededId = p.id;
      continue;
    }
    // dismissed
    if (!same || p.resolved_at == null) continue;
    const until = new Date(p.resolved_at.getTime() + REPRICE_DISMISSAL_QUIET_DAYS * 86400_000);
    if (Date.now() < until.getTime()) {
      return {
        status: 'quiet_after_dismissal',
        dismissedProposalId: p.id,
        untilISO: until.toISOString(),
      };
    }
  }

  /*
   * ONE STATEMENT, so the supersede and the insert cannot half-land.
   *
   * Ordered the other way round they would each have a failure mode the runner
   * pays for: supersede-then-insert can leave him with NO card, and
   * insert-then-supersede can leave him with TWO — and duplicate cards for one
   * decision is a defect this table has already produced once. A data-modifying
   * CTE is atomic by construction and needs no pooled client, which also keeps
   * this writer testable against a plain `query` mock.
   *
   * `expired` is the existing word for "this row's content is out of date". It
   * is deliberately NOT `dismissed`: the runner's own answers must stay
   * distinguishable from the engine's housekeeping, and the quiet window below
   * reads `dismissed` to decide whether to stay silent.
   */
  const write = await attempt(
    'plan/reanchor-proposal · supersede and insert',
    pool.query<{ id: number }>(
      `WITH superseded AS (
         UPDATE plan_workout_proposals
            SET status = 'expired', resolved_at = NOW()
          WHERE id = $8::bigint AND status = 'pending'
          RETURNING id
       )
       INSERT INTO plan_workout_proposals
         (user_uuid, plan_workout_id, workout_date_iso, action_kind,
          action_payload, reason, evidence, source)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'cron_reanchor')
       RETURNING id`,
      [
        input.userUuid, row.id, row.date_iso, REPRICE_ACTION_KIND,
        JSON.stringify({ why, reprice: payload }),
        why,
        JSON.stringify(input.evidence),
        supersededId,
      ],
    ),
  );
  if (!write.ok) return { status: 'read_failed', error: write.error };

  return {
    status: 'written',
    proposalId: write.value.rows[0].id,
    payload,
    supersededId,
  };
}
