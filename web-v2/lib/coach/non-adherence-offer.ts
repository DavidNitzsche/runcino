/**
 * lib/coach/non-adherence-offer.ts · F077 — what the coach offers once
 * `lib/training/training-consistency.ts` says quality sessions have kept
 * failing to land.
 *
 * Rule 16 split from the reader on purpose: `training-consistency.ts`
 * answers ONE question ("is this happening right now") and carries no
 * opinion about what to do about it. This file is the "what to do about it"
 * half, and nothing else. It decides WHICH FRAMING TO LEAD WITH; it never
 * decides FOR the runner, and it never touches the stated goal.
 *
 * ── The behaviour, already ruled (not invented here) ───────────────────
 * `for coaching consult/consult-log/2026-09-14-019-f077-non-adherence-
 * design.md` §2, citing `docs/PUSH_THE_RUNNER_FORWARD_DOCTRINE.md` verbatim:
 * "After repeated non-adherence, the app should ask for recommitment or
 * recalibration. It should not keep rewriting the plan around behavior that
 * makes its evidence uninterpretable." Two real, explicit options, always
 * both offered, never a forced choice and never a silent adaptation:
 *
 *   · RECOMMIT    — keep the prescription as written; the gap was
 *                   circumstantial.
 *   · RECALIBRATE — restructure the block's quality density/frequency to
 *                   match what has actually been delivered.
 *
 * Explicitly NOT a goal renegotiation — that stays Goal Feasibility's own
 * call (`docs/BRAIN_CONSTITUTION.md` §29), fed by this signal as evidence,
 * never decided by it.
 *
 * ── The escalation, per consult-log 2026-09-15-025 Ruling 2 ────────────
 * "RECOMMIT must not be an infinite, consequence-free loop" (2026-09-14-019
 * §3). The first ask is genuine. If the SAME pattern recurs after a runner
 * has already recommitted once, the default framing shifts toward
 * RECALIBRATE — still offered as a real choice, never forced, never
 * auto-applied. Named there as the weakest-grounded of the delegated
 * rulings (no physiological citation, only doctrine's own stated LOW
 * tolerance for repeating an unchanged ask), confirmed fine to ship as a
 * small, reversible UX behaviour.
 *
 * ── What this file does NOT do ──────────────────────────────────────────
 * It does not persist offer history — `priorOffers` is a parameter, supplied
 * by whichever surface wires this to a real store. It does not render or
 * word the coach's sentence. It does not decide a RECALIBRATE block's
 * re-evaluation point (doctrine: "Temporary recovery must not silently
 * become a permanent lower trajectory") — that needs a stated review-window
 * mechanism this pass does not build. All three are named in
 * `programme-internal-working/00-master-programme/
 * F077-TRAINING-CONSISTENCY-2026-09-14.md` as the explicit Phase 2 UI/
 * persistence boundary this session did not cross.
 */

export type NonAdherenceChoice = 'RECOMMIT' | 'RECALIBRATE';

/** One past occasion this same recurring pattern was offered and answered.
 *  Supplied by the caller — this module has no storage of its own. */
export interface NonAdherenceOfferHistoryEntry {
  readonly offeredAtISO: string;
  readonly choice: NonAdherenceChoice;
}

export interface NonAdherenceOfferState {
  /** Mirrors `TrainingConsistencyVerdict.triggersNonAdherenceOffer` — carried
   *  rather than re-derived, so this file never grows its own opinion about
   *  when to fire (Rule 16). */
  readonly shouldOffer: boolean;
  /** Which choice the coach should lead with. Both options are always real
   *  and both are always offered when `shouldOffer` is true — this never
   *  narrows the runner's actual choice, only the sentence's emphasis.
   *  Null when `shouldOffer` is false. */
  readonly defaultFraming: NonAdherenceChoice | null;
  /** How many times this exact recurring pattern has previously been
   *  answered RECOMMIT. Narration only. */
  readonly priorRecommitCount: number;
}

/**
 * Per consult-log 2026-09-15-025 Ruling 2 — "Two." The first ask (zero prior
 * RECOMMITs on record) is genuine and leads with RECOMMIT. The SECOND ask —
 * i.e. `priorRecommitCount >= RECOMMIT_CYCLE_THRESHOLD - 1` — is where the
 * default framing shifts toward RECALIBRATE rather than repeating an
 * unchanged ask a third time.
 */
export const RECOMMIT_CYCLE_THRESHOLD = 2;

/**
 * PURE. Rule 18: falsifiable with a hand-built history array, no database
 * and no clock.
 */
export function resolveNonAdherenceOffer(
  triggersNonAdherenceOffer: boolean,
  priorOffers: readonly NonAdherenceOfferHistoryEntry[],
): NonAdherenceOfferState {
  if (!triggersNonAdherenceOffer) {
    return { shouldOffer: false, defaultFraming: null, priorRecommitCount: 0 };
  }
  const priorRecommitCount = priorOffers.filter((o) => o.choice === 'RECOMMIT').length;
  const defaultFraming: NonAdherenceChoice =
    priorRecommitCount >= RECOMMIT_CYCLE_THRESHOLD - 1 ? 'RECALIBRATE' : 'RECOMMIT';
  return { shouldOffer: true, defaultFraming, priorRecommitCount };
}
