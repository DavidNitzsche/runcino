/**
 * lib/brain/proposal/generate/from-reprice.ts · A BLOCK REPRICING, AS ONE
 * DECISION WITH ITS PARTS NAMED.
 *
 * ── WHAT CHANGES HERE, AND WHY IT MATTERS ──────────────────────────────────
 *
 * `staleness.ts:actionFromPending` already turns a `reprice` row into a
 * COORDINATED action, and deliberately leaves `parts` EMPTY. Its reason was
 * good: a repricing is applied by `applyReanchorProposal` against canonical
 * anchors, not by replaying N per-row writes, so enumerating seventy-seven
 * parts would have been a second description of a change this file does not
 * own.
 *
 * That reason still holds for ROWS. It does not hold for ANCHORS.
 * `RepricePayload.anchorMoves` is a short list — threshold, marathon, interval,
 * easy — each with both sides, and each is a PACE_CHANGE in the union's own
 * vocabulary. Enumerating those is not a second description of the write; it is
 * the first description of WHAT MOVED. Without it the whole repricing lands in
 * the ledger as one PLAN_STRUCTURE row and the question "did the threshold
 * anchor go up this month" is unanswerable from the engine's own record, which
 * is Rule 21's complaint word for word.
 *
 * So: parts are the ANCHORS, and they name NO ROWS. `before: []` is not an
 * omission — a pace anchor is not a plan row, the staleness check has nothing
 * to compare for it, and claiming a row would make the accept path refuse a
 * card because a day it never touched happened to move.
 *
 * ── DIRECTION IS READ ONCE, FROM ONE FIELD ─────────────────────────────────
 *
 * `meanAnchorDeltaSecPerMi` is the payload's own direction-bearing quantity and
 * its header says so: "two surfaces must not each decide which way a repricing
 * points (Rule 16)". A pace is seconds per mile, so NEGATIVE IS FASTER. The
 * parts each carry their own direction from their own delta, because threshold
 * can move faster while marathon moves slower, and a part that inherited the
 * mean would be labelled a push while asking for less.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE REPRICING IS RIGHT. `reanchor-plan.ts` decides that.
 * · WHETHER THE PARTS ARE WHAT GETS APPLIED. They are not, and that is stated
 *   rather than implied: the accept route branches on the row's kind before it
 *   builds an action, and `executor-map.ts` sends COORDINATED to REPRICE_APPLY.
 *   A future reader who applies `plannedWrites` to this action would write
 *   nothing, because the parts name no rows — which is the safe failure, not
 *   a silent partial one.
 * · AN ANCHOR THE PAYLOAD DID NOT RECORD. Empty `anchorMoves` is never written
 *   (the payload's own contract), and an empty list here yields a COORDINATED
 *   with no parts, which is exactly what the previous behaviour always was.
 */

import type { RepriceAnchorMove, RepricePayload } from '@/lib/plan/reprice-payload';
import type { BrainAction } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';

/**
 * One repricing, as the coordinated decision it is.
 *
 * `describe` is the sentence the card carries. It is composed here rather than
 * on the surface so the phone and the ledger read the same words (Rule 16), and
 * it deliberately does not name a weekday: the change is about the BLOCK, and
 * the card's own date already says where it starts (Rule 17).
 */
export function actionFromReprice(payload: RepricePayload): BrainAction {
  const parts = payload.anchorMoves
    .map(paceChangeFromAnchor)
    .filter((p): p is BrainAction => p !== null);

  const d = payload.meanAnchorDeltaSecPerMi;
  const n = payload.workoutsAffected;
  const sessions = n === 1 ? '1 session ahead'
    : n > 1 ? `${n} sessions ahead`
      : 'Every session ahead';
  /* Verb agreement only shows up when you read the rendered string, which is
   * why it is decided here and not left to a template. */
  const describe = !Number.isFinite(d) || (d > -1 && d < 1)
    ? `${sessions} ${n === 1 ? 'gets' : 'get'} updated paces`
    : d < 0 ? `${sessions} move to faster paces`
      : `${sessions} move to easier paces`;

  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'COORDINATED',
    direction: directionOfDelta(d),
    /* The card hangs on the first affected day, and the row that day belongs to
     * is not what is being compared — the repricing's own apply path re-resolves
     * the anchors at accept time (Rule 10's recompute posture). So the head
     * names no rows either, and the accept route says why it skips the generic
     * staleness check for this kind. */
    before: [],
    describe,
    parts,
  };
}

/** One anchor move, as the pace change it is. Null when it did not move. */
function paceChangeFromAnchor(m: RepriceAnchorMove): BrainAction | null {
  if (typeof m.toSecPerMi !== 'number' || !Number.isFinite(m.toSecPerMi)) return null;
  const delta = m.fromSecPerMi === null ? 0 : m.toSecPerMi - m.fromSecPerMi;
  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'PACE_CHANGE',
    direction: directionOfDelta(delta),
    lever: leverOfAnchorKey(m.key),
    before: [],
    to: { unit: 'sec_per_mi', value: Math.round(m.toSecPerMi) },
  };
}

/**
 * NEGATIVE IS FASTER, and a second under a second is neither.
 *
 * The one-second dead band is the payload's own: `actionShapeOfEngineKind`
 * has used it since the reprice lane was written, and two readers of one
 * quantity disagreeing about where neutral starts is a Rule 16 collision.
 */
function directionOfDelta(delta: number): 'MORE' | 'LESS' | 'NEUTRAL' {
  if (!Number.isFinite(delta)) return 'NEUTRAL';
  return delta <= -1 ? 'MORE' : delta >= 1 ? 'LESS' : 'NEUTRAL';
}

/**
 * `threshold_s_per_mi` and friends, as the lever the runner reads.
 *
 * REPRICESUBJECT-1 (2026-09-08) · `shakeout_ceiling_s_per_mi` used to fall
 * through to THRESHOLD, which is visible in proposal 12's stored payload:
 * two parts both labelled THRESHOLD, one NEUTRAL (the real threshold, 430 ->
 * 430) and one MORE (the shakeout ceiling, 532 -> 522). One label, two
 * numbers, opposite directions — Rule 16 exactly. A shakeout ceiling is the
 * slow end of the easy family, so it reads as EASY.
 *
 * The unmatched fall-through is still THRESHOLD, because `RepricePayload`'s
 * six anchors are all matched above and a seventh anchor arriving here is a
 * change that should be made deliberately rather than absorbed silently.
 */
function leverOfAnchorKey(key: string): 'THRESHOLD' | 'MARATHON' | 'INTERVAL' | 'EASY' {
  const k = key.toLowerCase();
  if (k.includes('marathon')) return 'MARATHON';
  if (k.includes('interval') || k.includes('vo2') || k.includes('rep')) return 'INTERVAL';
  if (k.includes('easy') || k.includes('shakeout')) return 'EASY';
  return 'THRESHOLD';
}
