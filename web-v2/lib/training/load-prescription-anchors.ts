/**
 * lib/training/load-prescription-anchors.ts · the Pace Prescription layer's DB
 * shell, and the ONE seam the live plan flex calls.
 *
 * `prescription-resolver.ts` is pure by construction — no pool, no query, no
 * `userId` — because that is what makes its goal isolation a compile error
 * rather than a review finding. Something still has to fetch. This file is that
 * something, and it is the house pattern rather than a new one:
 * `activity-evidence.ts` / `load-activity-evidence.ts` and
 * `adaptation-engine.ts` / `load-adaptation-engine.ts` split the same way, for
 * the same reason.
 *
 * NOT A NEW OWNER (Constitution §9's checklist, answered):
 *
 *   · What question does it answer? None of its own. It answers
 *     `composePaceAnchors`' question by fetching that function's inputs.
 *   · Who currently answers it? Pace Prescription (§G), and it still does.
 *   · Does it create a source of truth? No — it holds no formula. Every number
 *     it returns came out of the four canonical capacity resolvers and then
 *     through `resolveCapacityPrescription`. Delete this file and the answers
 *     do not change; only the plumbing does.
 *
 * ── WHY IT DOES NOT CONSULT READINESS ───────────────────────────────────────
 *
 * Deliberate, and the single most important thing about this file. It calls
 * `resolveCapacityPrescription`, not `resolvePrescription`, so no readiness
 * signal reaches it. Its caller rewrites every unrun day of a fourteen-week
 * block; readiness answers "what is appropriate TODAY" (§D), and stamping this
 * morning's readiness onto November's rows would be the exact collapse §D and
 * the 2026-08-31 "capacity, current state and prescription stay three separate
 * concepts" decision forbid. A tired Tuesday does not make the runner slower in
 * November, and it must not write a slower November.
 *
 * The day's readiness still governs the day. It is applied where the day is
 * served, not where the block is priced.
 *
 * ── RULE 11 · THREE STATES, AND NO SILENT FALLBACK ──────────────────────────
 *
 * The return type is `PaceAnchorRead`, whose refusal branch carries no
 * `anchors` field at all, so a caller cannot read one without branching. A
 * refusal must never be answered by reaching for the old VDOT cascade: that is
 * "sometimes old, sometimes new" (Constitution §8) and it is how a coherence
 * defect would become invisible. The correct response to a refusal is to leave
 * the plan alone and say so.
 *
 * ── RULE 22 · WHAT THIS CANNOT FAIL ON ──────────────────────────────────────
 *
 *   · It cannot be more right than the four capacity resolvers it calls. Every
 *     blind spot named in `capacity-resolver.ts`'s own Rule 22 section — no
 *     direct high-intensity reader, uncalibrated confidence, the instrument
 *     blind spot — passes through this file untouched.
 *   · It has no upward lever of its own, because a prescription layer has none.
 *     Progression is the Adaptation Engine's (§I), and nothing here proposes
 *     any.
 *   · The coherence gate checks the ORDER of the six anchors, never their
 *     magnitude. A set that is uniformly 90 s/mi too slow is perfectly ordered
 *     and passes.
 */

import { runnerToday } from '@/lib/runtime/runner-tz';
import {
  resolveThresholdCapacity,
  resolveHighIntensityCapacity,
  resolveEasyCeiling,
  resolveDurability,
} from '@/lib/training/capacity-resolver';
import {
  composePaceAnchors,
  type PaceAnchorRead,
  type ResolvedCapacity,
} from '@/lib/training/prescription-resolver';

/**
 * The six anchors for one runner, today. THE canonical answer to "what pace is
 * each zone worth for this runner" (Constitution §5, §G).
 *
 * Takes a `userId` and a date and NOTHING ELSE — same seal as the four capacity
 * resolvers underneath it, so no caller can hand a goal, a race, a plan or a
 * readiness reading into the pricing of a block.
 */
export async function resolvePrescribedPaceAnchors(
  userId: string,
  todayISO?: string,
): Promise<PaceAnchorRead> {
  const today = todayISO ?? await runnerToday(userId);
  const [threshold, highIntensity, easyCeiling, durability] = await Promise.all([
    resolveThresholdCapacity(userId, today),
    resolveHighIntensityCapacity(userId, today),
    resolveEasyCeiling(userId, today),
    resolveDurability(userId, today),
  ]);
  const capacity: ResolvedCapacity = { threshold, highIntensity, easyCeiling, durability };
  return composePaceAnchors(capacity);
}

/**
 * The threshold capacity's derived VDOT, for the two consumers that still
 * legitimately speak VDOT: `achievableRaceTarget` (Race Prediction's own input,
 * §J) and the audit stamp.
 *
 * DERIVED DISPLAY, NOT A SOURCE. `ThresholdCapacityEstimate.vdot` is
 * `vdotFromTpace` of an already-resolved pace — the pace is the belief and this
 * is a projection of it onto a scale other services still read. Null when the
 * runner sits outside the table's [30,85] range, which is a real answer and not
 * a failure (Rule 11).
 */
export async function resolveThresholdVdot(
  userId: string,
  todayISO?: string,
): Promise<number | null> {
  const today = todayISO ?? await runnerToday(userId);
  return (await resolveThresholdCapacity(userId, today)).vdot;
}
