/**
 * lib/plan/reprice-payload.ts · WHAT A COORDINATED REPRICING LOOKS LIKE ON THE
 * WIRE AND IN THE ROW.
 *
 * REANCHORPROPOSES-1 (2026-09-05). David: "The current state is contradictory:
 * COACHING_ADAPTATION is supposedly refused, while a named hold allows reanchor
 * to continue changing workouts. A hold that continues writing is an exemption
 * with better paperwork."
 *
 * ── WHY THIS IS ONE PROPOSAL AND NOT N CARDS ───────────────────────────────
 *
 * A re-anchor is not a per-workout decision. It re-prices the WHOLE remaining
 * block off one moved anchor: on the owner's live plan that is 77 future
 * pace-bearing days, and every one of them changes for the same reason and by
 * the same arithmetic. `plan_workout_proposals` is per-workout by construction
 * (`plan_workout_id TEXT NOT NULL`, and `writeWorkoutProposals` writes one row
 * per workout id), so writing this the ordinary way would have put SEVENTY-SEVEN
 * identical cards on Today.
 *
 * That is Rule 17 at its worst — the runner reads the same sentence 77 times —
 * and it is also incoherent: accepting 40 of them and dismissing 37 would leave
 * a block priced off two different anchors, which is precisely the Rule 16
 * failure the pace layer was consolidated to remove. A repricing is one
 * decision. It is accepted whole or not at all.
 *
 * ── SO WHAT A COORDINATED PROPOSAL NEEDS, AND HOW MUCH OF IT EXISTS ────────
 *
 * Needed:                                            Have it?
 *   1. One row that names MANY affected workouts.    YES · `action_payload`
 *      is jsonb with no constraint, so the affected
 *      set and the anchors ride in the payload. No
 *      migration was required, and none was made.
 *   2. Somewhere for the card to hang, since the
 *      column is NOT NULL and the expiry and dedupe
 *      indexes are keyed on it.                      YES · the EARLIEST future
 *      unsealed pace-bearing day. That is the first
 *      day the new pricing would take effect, so it
 *      is the honest anchor rather than an arbitrary
 *      one, and expiry then means "this repricing is
 *      stale, compute a fresh one", which is what
 *      you want.
 *   3. An accept that applies the WHOLE set.         YES · the accept route
 *      branches on the kind before it builds an
 *      `AdaptationAction`, because there is no
 *      per-workout action that describes this.
 *   4. A direction and a headline the phone can      YES · added to
 *      draw.                                         `lib/faff/v5-proposals.ts`.
 *
 * NOT had, and stated rather than faked: there is no way to accept HALF of it,
 * and there should not be. If a future decision genuinely needs partial
 * acceptance, that is a different feature and it needs a real many-to-many
 * table, not this payload with a filter bolted on.
 *
 * ── THIS FILE IMPORTS NOTHING THAT REACHES A SERVER ────────────────────────
 *
 * `lib/plan/workout-proposals.ts`, `lib/plan/reanchor-proposal.ts` and
 * `lib/faff/v5-proposals.ts` all need this shape. Two of those are read by a
 * client graph check (`scripts/check-client-graph.sh`), and a type module that
 * pulls in a database pool three hops down is exactly the edge that kept `main`
 * undeployed for a day (Rule 19).
 *
 * Until 2026-09-08 this said "NO IMPORTS, DELIBERATELY", which was a stronger
 * claim than the reason behind it and is now weakened HONESTLY rather than
 * quietly broken (Rule 20's corollary: gate the sentence or fix the sentence).
 * The one import is `@/lib/format/run`, which has no imports of its own at all
 * and is already on `v5-proposals.ts`'s own client path. It is here because
 * `repriceSubject` below has to ask `fmtPace` whether a pace change is even
 * visible, and moving that question anywhere else would put a second copy of
 * `fmtPace(a) !== fmtPace(b)` in the codebase — the exact Rule 16 collision
 * the function exists to close. Nothing server-only may follow it.
 */
import { fmtPace, paceDisplayChanges } from '@/lib/format/run';

/** The action kind a coordinated repricing is stored under. One definition. */
export const REPRICE_ACTION_KIND = 'reprice';

/** Which self-heal arm produced the repricing. */
export type RepriceArm = 'race-prep' | 'maintenance' | 'canonical-prior';

/** One anchor's before and after, in seconds per mile. */
export interface RepriceAnchorMove {
  /** The engine's own key, e.g. `threshold_s_per_mi`. */
  key: string;
  /** What the block is priced at now. Null when it was never stamped. */
  fromSecPerMi: number | null;
  toSecPerMi: number;
}

/**
 * Everything the engine calculated, stored so the card can be drawn and the
 * accept can be argued against it.
 *
 * ── RULE 10 · THE ANCHORS TRAVEL WITH THE DERIVATION ───────────────────────
 *
 * `anchorMoves` is the stamp. It is what the runner was shown, and it is what
 * an accept compares itself against — an accept that lands materially different
 * numbers says so in its response rather than quietly applying them, because a
 * card that promised one thing and did another is the failure Rule 13 is about.
 */
export interface RepricePayload {
  kind: typeof REPRICE_ACTION_KIND;
  planId: string;
  arm: RepriceArm;
  /** The VDOT the block is priced at now. Null when never stamped. */
  fromVdot: number | null;
  /**
   * The VDOT the repricing would use. Null for a runner outside Daniels'
   * [30,85] table, which the recompute handles: it prices from the ANCHORS and
   * reads this only for the race-target input and the stamp.
   */
  toVdot: number | null;
  /**
   * How well `toVdot` is known — `measured_vdot`, or the canonical threshold's
   * own `source_mode`. NEVER laundered: the canonical-prior arm carries its own
   * mode, because nothing was measured there and saying otherwise is the exact
   * fabrication `reanchorOffCanonicalPrior`'s GUARD 2 exists to prevent.
   */
  toSource: string;
  /** True only on the two arms that read a measured VDOT. */
  measured: boolean;
  /** Every anchor that would move, with both sides. Empty is not written. */
  anchorMoves: RepriceAnchorMove[];
  /**
   * Mean signed change across `anchorMoves`, seconds per mile. NEGATIVE IS
   * FASTER, because a pace is seconds per mile and fewer seconds is quicker.
   *
   * This is the direction-bearing quantity and it is the only one: two
   * surfaces must not each decide which way a repricing points (Rule 16).
   */
  meanAnchorDeltaSecPerMi: number;
  /** Future unsealed pace-bearing days the repricing would touch. */
  workoutsAffected: number;
  /** Future days skipped because a run already exists on them (Rule 15). */
  workoutsSealed: number;
  /** ISO instant the calculation was made. */
  computedAt: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * WHICH ANCHOR A SENTENCE IS ALLOWED TO NAME (REPRICESUBJECT-1, 2026-09-08)
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * Proposal 12 in the owner's production account, raised 2026-09-08, headlined
 * "76 sessions ahead move to faster paces" and then explained itself:
 *
 *   "Your recent training puts your threshold at 7:10 per mile. This block is
 *    written at 7:10 per mile."
 *
 * Both numbers are 7:10 because his threshold did not move. Its anchor went
 * 430 -> 430, and so did interval (401), repetition (365) and marathon (472).
 * What actually moved was the easy ceiling (502 -> 492) and the shakeout
 * ceiling (532 -> 522), ten seconds per mile faster each, which is what drove
 * `meanAnchorDeltaSecPerMi` to -3.33 and made the headline correct. Neither
 * of those two anchors was named anywhere on the card.
 *
 * David, reading it on his phone: "are paces already at 7:10?"
 *
 * Every sentence generator involved hardcoded THRESHOLD as its subject, so a
 * repricing driven by any other anchor narrated the one number that had
 * measurably stayed still. Rule 16: a sentence asserting a fact about a
 * measurement must be gated on that measurement or not said.
 *
 * ── THE RULE THIS ENCODES ──────────────────────────────────────────────────
 *
 * A repricing sentence names an anchor that ACTUALLY MOVED, where "moved"
 * means the runner would see a different pace on the screen — `fmtPace`
 * rounds to the second, so 430.0 and 430.4 are both "7:10" and claiming a
 * move between them is claiming something unobservable. That comparison is
 * `paceDisplayChanges` in `lib/format/run.ts` and it is the same one the
 * drift monitor's `isRunnerVisibleDrift` asks.
 *
 * Threshold keeps first refusal WHEN IT MOVED. It is the anchor a marathoner
 * reasons in, every existing sentence is built around it, and preferring it
 * keeps the common case byte-identical to what shipped. It loses that claim
 * the moment it stands still, which is the whole of the fix.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * The six anchors as the runner hears them named, keyed by the engine's own
 * stamp key. One label per anchor, in one place, so the card and the log
 * cannot call the same number two things (Rule 16).
 *
 * `_ceiling` anchors are deliberately named as ceilings rather than as "easy
 * pace": they are the SLOWEST-permitted end of a band, and calling a ceiling a
 * pace is how a limit gets read as a target.
 */
export const REPRICE_ANCHOR_LABEL: Readonly<Record<string, string>> = {
  threshold_s_per_mi: 'threshold',
  interval_s_per_mi: 'interval pace',
  repetition_s_per_mi: 'repetition pace',
  easy_ceiling_s_per_mi: 'easy ceiling',
  shakeout_ceiling_s_per_mi: 'shakeout ceiling',
  marathon_s_per_mi: 'marathon pace',
};

/**
 * Canonical anchor order, used ONLY as a deterministic tie-break when two
 * anchors moved by exactly the same amount — which is not hypothetical: on
 * proposal 12 the easy and shakeout ceilings both moved exactly 10 s/mi, and
 * an arbitrary winner there would make the sentence depend on iteration order.
 * Matches `ANCHOR_PAIRS` in `lib/plan/reanchor-proposal.ts`.
 */
const ANCHOR_ORDER: readonly string[] = [
  'threshold_s_per_mi',
  'interval_s_per_mi',
  'repetition_s_per_mi',
  'easy_ceiling_s_per_mi',
  'shakeout_ceiling_s_per_mi',
  'marathon_s_per_mi',
];

/** The anchor a repricing sentence may name, with the two numbers it may cite. */
export interface RepriceSubject {
  /** The engine's own key, e.g. `easy_ceiling_s_per_mi`. */
  key: string;
  /** How the runner hears it named, e.g. `easy ceiling`. */
  label: string;
  fromSecPerMi: number;
  toSecPerMi: number;
}

/**
 * Pick the anchor a sentence is entitled to talk about, or refuse.
 *
 * Returns `null` when NO anchor moved visibly — three facts, not one
 * (Rule 11): a caller that gets null must not invent a subject. What the
 * sentence generators do with a null is THEIRS to decide, not this
 * function's claim — as of 2026-09-08, `repriceReason` in
 * `reanchor-plan.ts` actually falls back to its ORIGINAL threshold-pair
 * wording in that case (which can print two identical numbers; that is
 * the exact defect this file exists to route around when a real mover
 * exists). This path is currently UNREACHABLE from both live writers —
 * `writeReanchorProposal` refuses as `unchanged` when every anchor moves
 * &lt;1 s/mi, and `autoProposeForUnexplainedDrift` returns early when no
 * visible finding exists — so no shipped card can reach it today. Stated
 * here rather than left to contradict `reanchor-plan.ts`'s own header,
 * which describes the fallback correctly (found by independent review).
 *
 * Selection, in order:
 *   1. threshold, if it moved visibly — the anchor a marathoner reasons in,
 *      and the case every shipped sentence was written for;
 *   2. otherwise the largest absolute move among the anchors that DID move;
 *   3. ties broken by `ANCHOR_ORDER`, so the answer is deterministic.
 */
export function repriceSubject(
  moves: readonly RepriceAnchorMove[] | null | undefined,
): RepriceSubject | null {
  if (moves == null) return null;
  const candidates: RepriceSubject[] = [];
  for (const m of moves) {
    const from = m.fromSecPerMi;
    const to = m.toSecPerMi;
    // Both sides must be PRINTABLE, not merely present: a sentence citing a
    // pace `fmtPace` refuses to render would print "null per mile".
    if (from == null || fmtPace(from) == null || fmtPace(to) == null) continue;
    if (!paceDisplayChanges(from, to)) continue;
    candidates.push({
      key: m.key,
      label: REPRICE_ANCHOR_LABEL[m.key] ?? 'training paces',
      fromSecPerMi: from,
      toSecPerMi: to,
    });
  }
  if (candidates.length === 0) return null;
  const threshold = candidates.find((c) => c.key === 'threshold_s_per_mi');
  if (threshold != null) return threshold;
  const rank = (k: string) => {
    const i = ANCHOR_ORDER.indexOf(k);
    return i === -1 ? ANCHOR_ORDER.length : i;
  };
  return candidates.reduce((best, c) => {
    const dc = Math.abs(c.toSecPerMi - c.fromSecPerMi);
    const db = Math.abs(best.toSecPerMi - best.fromSecPerMi);
    if (dc > db) return c;
    if (dc < db) return best;
    return rank(c.key) < rank(best.key) ? c : best;
  });
}

/** Narrow an untyped `action_payload.reprice` without trusting it. */
export function asRepricePayload(v: unknown): RepricePayload | null {
  if (v == null || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.kind !== REPRICE_ACTION_KIND) return null;
  if (typeof r.planId !== 'string' || r.planId === '') return null;
  if (typeof r.meanAnchorDeltaSecPerMi !== 'number' || !Number.isFinite(r.meanAnchorDeltaSecPerMi)) return null;
  if (!Array.isArray(r.anchorMoves) || r.anchorMoves.length === 0) return null;
  if (typeof r.workoutsAffected !== 'number') return null;
  return v as RepricePayload;
}
