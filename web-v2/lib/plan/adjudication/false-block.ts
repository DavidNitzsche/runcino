/**
 * lib/plan/adjudication/false-block.ts · IS THIS BLOCKING SENTENCE A DEFECT IN
 * THE PLAN, OR AN ARTEFACT OF THE READING?
 *
 * ── WHY THIS IS A MODULE AND NOT THREE LINES IN THE REPLAY ─────────────────
 *
 * It started as a local helper inside `_promotion_replay.script.ts`, which
 * needs a production database to run. A classifier that can only be exercised
 * against production is a classifier nothing in CI can falsify, and Rule 18 is
 * explicit that a check nobody has made fail is a hypothesis. So it lives here,
 * pure, and `_false_block.test.ts` breaks it on purpose.
 *
 * ── WHAT A FALSE BLOCK IS ──────────────────────────────────────────────────
 *
 * A block is FALSE when the gate is correct about its own predicate and the
 * predicate is not a defect of the plan. It is the most expensive kind of gate
 * failure this project has, because it is INDISTINGUISHABLE FROM A REAL
 * FINDING at the point of reading: the sentence is true, the reasoning is
 * sound, and acting on it makes the product worse. Six of seven active
 * production plans were refused authoring by one of these.
 *
 * Two shapes are decidable from the verdict alone, and both are that shape:
 *
 *   1 · NOTHING TO ADVANCE FROM. `progression` fires because no decision chose
 *       PUSH. That is a real defect for a runner who could have advanced and
 *       was held anyway. It is a FALSE block when no decision COULD have:
 *       every PUSH option in the block was unrankable, which
 *       `heuristicRankScore` correctly returns for UNKNOWN evidence. The
 *       runner has nothing to advance FROM, and Rule 21's sentence about a
 *       safety system in a coach's clothes is being read at a runner who has
 *       never run.
 *
 *   2 · NOTHING LEFT TO ADJUDICATE. `wholeBlockCoherence` fires on an empty
 *       trace set. A real defect when the block HAS weeks and none were
 *       traced — that is the silent zero the clause exists to own. A FALSE
 *       block when the block has no future weeks at all: a plan whose last
 *       week is behind us is finished, not incoherent. One live plan is in
 *       exactly this state.
 *
 * ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not unblock anything. Both sentences still block, and softening
 * either would reopen the empty-set hole. This names the sentence so a reader
 * — or a future caller deciding whether to route a plan here at all — can tell
 * the two apart. Per the standing instruction: do not merge a fatal promotion
 * gate until the visible failure path works, and the first thing a visible
 * failure path needs is to stop crying wolf.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · IT CANNOT FIND A FALSE BLOCK IN A DIMENSION IT DOES NOT NAME. A sentence
 *   from any of the other nine returns `unclassified`, which means "this
 *   classifier has nothing to say" and NOT "this is definitely a real defect".
 *   The label is deliberately not `true`, because a green tick nobody earned
 *   is exactly what this module exists to complain about.
 * · IT CANNOT TELL WHETHER A `progression` BLOCK ON A RANKED PUSH WAS RIGHT.
 *   If any PUSH option was rankable and the block still never advanced, this
 *   reports `unclassified` — and the honest reading of that is "a coach
 *   declined a decision it could have taken", which is Rule 21's question and
 *   not a false block.
 * · IT CANNOT SEE A FALSE BLOCK THAT PROMOTED. A plan wrongly ALLOWED through
 *   produces no sentence to classify. Nothing here looks at the other error.
 */
import type { DecisionTrace } from './contract';

export type BlockVerdict =
  | 'FALSE · nothing to advance from'
  | 'FALSE · no future weeks left in this block'
  | 'unclassified';

/**
 * The exact substrings `checkPromotion` emits, kept here so a change to either
 * sentence breaks the classifier loudly instead of silently retiring it.
 *
 * `_false_block.test.ts` asserts that the real gate still produces sentences
 * these match — a scanner keyed on prose that has drifted reports clean
 * because it looked at nothing, which is the failure Rule 18 §2 names.
 */
export const PROGRESSION_NO_ADVANCE_MARKER = 'advances anything';
export const BLOCK_IS_OVER_MARKER = 'a block that is over';

export function classifyBlock(
  sentence: string,
  traces: readonly DecisionTrace[],
  futureWeeks: number,
): BlockVerdict {
  if (sentence.startsWith('progression ·') && sentence.includes(PROGRESSION_NO_ADVANCE_MARKER)) {
    // Rule 11 · `traces.length === 0` is a different fact and is owned by
    // `wholeBlockCoherence`. `every` on an empty array is vacuously true, so
    // without this guard an empty block would be reported as "nothing to
    // advance from" as well, which is two dimensions' findings under one name.
    const noneCouldAdvance = traces.length > 0 && traces.every((t) => {
      const push = t.options.find((o) => o.option === 'PUSH');
      return push == null || push.heuristicRankScore == null;
    });
    if (noneCouldAdvance) return 'FALSE · nothing to advance from';
  }
  if (sentence.startsWith('wholeBlockCoherence ·') && sentence.includes(BLOCK_IS_OVER_MARKER)
    && futureWeeks === 0) {
    return 'FALSE · no future weeks left in this block';
  }
  return 'unclassified';
}

/**
 * COLDSTART-PROMO-1 (2026-09-06) · THE DIAGNOSIS EARNS THE DISPOSITION.
 *
 * `classifyBlock` names a sentence FALSE. It does not, by itself, change what
 * a REPORT built on `checkPromotion`'s output says for the plan that sentence
 * belongs to — and that gap is exactly what the read-only production replay
 * found: one of seven active plans has zero future weeks, `classifyBlock`
 * already reads it correctly as "finished, not incoherent", and the replay
 * still printed **BLOCKED** for it, because nothing between the diagnosis and
 * the report ever asked the question this function is. `_promotion_replay
 * .script.ts` is the one caller today, and it takes `mayPromote` /
 * `blockedBecause` / `traces` off a `PlanAdjudication` it already has.
 *
 * DELIBERATELY NOT ADDED TO `PlanAdjudication`/`checkPromotion` ITSELF. That
 * was the first draft, and it broke a guard nothing about the disposition
 * question should have touched: `checkPromotion` (`adjudicate.ts`) is
 * reachable from the live `run-adaptations` cron today, via
 * `lib/adaptation/volume-evidence/{respond,weight}.ts`'s import of
 * `STEP_SUPPORTED_MAX`/`VOLUME_ADDITION_THRESHOLD` — unrelated to promotion,
 * but a real edge. `false-block.ts` is registered in
 * `lib/audit/generated-content-registry.ts`'s `MODULE_ORPHANS` as
 * `'runtime code must never import it'`, and having `adjudicate.ts` import
 * this file would have made that literally false — `_generated_content_gate
 * .test.ts`'s staleness guard caught it immediately (Rule 18: a gate that
 * has never failed is a hypothesis; this one fired on the first real
 * violation). Keeping `resolveDisposition` a free function that a REPORTER
 * calls, rather than a field `checkPromotion` computes, keeps the promotion
 * gate's live reachability exactly as it was.
 *
 * `mayPromote` is untouched by this and stays exactly as strict as it always
 * was (`_false_block.test.ts`: "a finished block must still not promote") —
 * this only tells a caller WHICH kind of not-promoted it is looking at.
 *
 * `'TERMINAL'` requires EVERY sentence in `blockedBecause` to be the
 * no-future-weeks false block, not merely one of several. `checkPromotion`
 * cannot currently produce a mixed set — every other blocking clause is
 * gated on `traces.length > 0`, which is false whenever this one fires — but
 * that is a structural fact about today's clauses, not a guarantee this
 * function can lean on, so it reads defensively rather than assuming it.
 * `_false_block.test.ts` calls this directly with a hand-built mixed set to
 * prove the `every` (not `some`) is load-bearing, since `checkPromotion`
 * itself cannot currently construct that shape to falsify it against.
 */
export type PlanDisposition = 'PROMOTED' | 'TERMINAL' | 'BLOCKED';

export function resolveDisposition(
  mayPromote: boolean,
  blockedBecause: readonly string[],
  traces: readonly DecisionTrace[],
  futureWeeks: number,
): PlanDisposition {
  if (mayPromote) return 'PROMOTED';
  const allTerminal = blockedBecause.length > 0 && blockedBecause.every(
    (b) => classifyBlock(b, traces, futureWeeks) === 'FALSE · no future weeks left in this block',
  );
  return allTerminal ? 'TERMINAL' : 'BLOCKED';
}
