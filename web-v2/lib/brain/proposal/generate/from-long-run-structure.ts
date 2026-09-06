/**
 * lib/brain/proposal/generate/from-long-run-structure.ts · THE LONG RUN'S OWN
 * PROGRESSION AXIS, AS AN ACTION.
 *
 * ── WHAT THIS TRANSLATES ───────────────────────────────────────────────────
 *
 * `lib/brain/proposal/evidence/long-run-structure.ts` reads whether the
 * runner's recent long runs have earned a race-pace finish segment. This turns
 * that verdict into a `BrainAction` — a `LONG_RUN_STRUCTURE_CHANGE` on
 * PROPOSE, and a `HOLD` on everything else, because a decision not to add the
 * segment yet is still a decision (Rule 11: silence and "not yet" are opposite
 * facts, and Rule 21 needs to be able to count the second one).
 *
 * A `REFUSE` verdict produces no action at all — the evidence reader could not
 * read the last two long runs, which is a data problem rather than a coaching
 * judgement, and `docs/ADAPTATION_PROGRESSION_DOCTRINE.md`'s "the calendar
 * proposes, the runner earns it" has nothing to say about a session nobody
 * could read.
 *
 * ── WHY THIS IS NOT `from-progression.ts` ──────────────────────────────────
 *
 * `actionFromProgression`'s `long_run_duration` arm exists ONLY as a type-safe
 * placeholder — `resolveWeekProgression` never sets that lever, and the arm's
 * own comment says so. Reusing its `describe` construction (rep count and
 * minutes) would print nonsense for a long run, which has neither. This file
 * is the real translation the placeholder was left waiting for.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE EVIDENCE VERDICT IS RIGHT. It is handed one.
 * · WHETHER THE PROPOSED SEGMENT FITS THE WEEK'S DOSING CAPS. `validateAction`
 *   and the accept-time dosing check are what refuse an over-large ask; this
 *   only states what the evidence reader sized.
 * · WHETHER ANY WRITER MAY SHOW THIS TO THE RUNNER. `write.ts`'s
 *   `WRITER_REFUSES` withholds `LONG_RUN_STRUCTURE_CHANGE` under the
 *   2026-09-02 reshape ruling regardless of what this file produces, and that
 *   is unrelated to whether the evidence behind it is real.
 */

import type { LongRunStructureEvidence } from '../evidence/long-run-structure';
import type { BrainAction, RowBefore } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';

/**
 * One evidence reading, as the action it is.
 *
 * Returns null only for `REFUSE` — a data problem, not a coaching decision,
 * and `docs/PLAN_SIMPLIFICATION_DOCTRINE.md` invariant 11 ("missing or
 * unreliable data cannot silently create a more aggressive plan") is
 * satisfied structurally here: a REFUSE cannot reach the PROPOSE branch
 * because `resolveLongRunStructureEvidence` never returns both at once.
 */
export function actionFromLongRunStructure(
  evidence: LongRunStructureEvidence,
  before: readonly RowBefore[],
): BrainAction | null {
  const base = { schemaVersion: ACTION_SCHEMA_VERSION, before } as const;

  if (evidence.decision === 'REFUSE') return null;

  if (evidence.decision === 'HOLD') {
    return { ...base, kind: 'HOLD', direction: 'NEUTRAL', because: evidence.reason };
  }

  // PROPOSE. Both fields are always set by `resolveLongRunStructureEvidence`
  // on this branch; the fallbacks exist only so a malformed evidence object
  // fails `validateAction` downstream rather than throwing here.
  return {
    ...base,
    kind: 'LONG_RUN_STRUCTURE_CHANGE',
    direction: 'MORE',
    to: evidence.proposedSubLabel ?? 'LONG',
    describe: evidence.proposedDescribe ?? evidence.reason,
  };
}
