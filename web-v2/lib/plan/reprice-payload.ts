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
 * ── THIS FILE HAS NO IMPORTS, DELIBERATELY ─────────────────────────────────
 *
 * `lib/plan/workout-proposals.ts`, `lib/plan/reanchor-proposal.ts` and
 * `lib/faff/v5-proposals.ts` all need this shape. Two of those are read by a
 * client graph check (`scripts/check-client-graph.sh`), and a type module that
 * pulls in a database pool three hops down is exactly the edge that kept `main`
 * undeployed for a day (Rule 19). A pure type module cannot grow one.
 */

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
