/**
 * lib/brain/proposal/generate/from-safety.ts · A STOP, AS AN ACTION.
 *
 * ── THE OWNERSHIP BOUNDARY, STATED FIRST BECAUSE IT IS THE WHOLE DESIGN ────
 *
 * THIS FILE DECIDES NOTHING ABOUT SAFETY. `docs/BRAIN_CONSTITUTION.md` gives
 * Safety exactly one canonical owner — `web-v2/lib/safety/**` — and that owner
 * produces `SafetyResolution`, whose UNKNOWN branch carries no `state` at all
 * so that no surface can read "we could not check" as "clear".
 *
 * That verdict is the INPUT here and it is never re-derived. `lib/watch/
 * safety-stop.ts` had to be corrected for exactly this: an early draft
 * re-derived a predicate from `posture` by hand, which was "a second answer to
 * a question that already had one", and it was wrong to write even though it
 * happened to agree.
 *
 * What this file owns is one narrow thing: turning a verdict that already says
 * STOP into a member of the action union, so the stop can travel down the same
 * lane as every other coaching decision — recorded, rendered, countable,
 * refused by the executor rather than silently unapplied.
 *
 * ── WHY A STOP NEEDS TO BE AN ACTION AT ALL ────────────────────────────────
 *
 * Because every other decision in this engine is one, and a safety withhold
 * that lives only as a message on a watch board is invisible to the ledger,
 * invisible to the direction census, and invisible to any reader asking "why
 * did this runner's volume drop in March". Rule 8's corollary is the sharp
 * version: a zero measured inside a prescribed stop and a zero measured off a
 * detrained runner are OPPOSITE FACTS, and code that cannot tell them apart has
 * lost the only thing that mattered. An action is how the first one gets
 * written down.
 *
 * ── WHY IT IS NOT UNDOABLE, AND NOT EXECUTABLE ─────────────────────────────
 *
 * `undo.ts` refuses to reverse a SAFETY_STOP and `executor-map.ts` sends it to
 * RECORD_ONLY. Both are deliberate and both are the same rule: a stop lifts
 * when the SIGNAL clears, never because a runner tapped Undo and never because
 * a proposal aged out. An accepted stop writes no plan row — the withholding is
 * done by the safety owner at read time, on every surface, every time.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 * · WHETHER THE VERDICT IS RIGHT. It is handed one.
 * · AN UNKNOWN VERDICT. `known: false` yields null, NOT a stop. That is the one
 *   place this file could have been dangerous in the other direction: a
 *   withhold-pending-check is a read failure, and manufacturing a SAFETY_STOP
 *   card out of one would tell a healthy runner to stop because the database
 *   blinked. Withholding the SESSION on an unknown verdict is correct and is
 *   `mayEmitRunnableWorkout`'s job; announcing a STOP is not.
 * · MODIFY AND CAUTION. Only STOP produces a stop. An EASY_ONLY posture is a
 *   different prescription, not a halt, and rendering it as one would overstate
 *   what the runner was told.
 * · WHETHER ANYTHING CALLS IT ON A LIVE PATH TODAY. Nothing does — see the
 *   GENERATOR gap for SAFETY_STOP in `facets.ts`, which names the in-flight
 *   canonical safety-state work this is built to meet.
 */

import type { SafetyResolution } from '@/lib/safety/safety-verdict';
import { safetyVerdictLine } from '@/lib/safety/safety-verdict';
import type { BrainAction, RowBefore } from '../action';
import { ACTION_SCHEMA_VERSION } from '../action';

/**
 * The verdict, as a stop, or null when the verdict is not a stop.
 *
 * `until` is null unless the caller knows a date the signal is expected to
 * clear on. It is NOT invented from a severity: "stop for ten days" is a
 * clinical claim and the app does not have one to make, so the honest card says
 * stop and says nothing about when.
 */
export function safetyStopFrom(args: {
  readonly resolution: SafetyResolution;
  /** The sessions this withholds. May be empty: a stop is not about one day. */
  readonly before?: readonly RowBefore[];
  /** A date the signal is known to clear on. Null unless genuinely known. */
  readonly untilISO?: string | null;
}): BrainAction | null {
  const { resolution } = args;

  /* Rule 11 · three facts, and only one of them is a stop. UNKNOWN means the
   * check did not run; it withholds the SESSION and it does not announce a
   * halt, because those are different things to read. */
  if (!resolution.known) return null;
  if (resolution.state !== 'STOP') return null;

  /* The sentence comes from the safety owner's own renderer, so the card, the
   * watch board and the ledger all read the same words (Rule 16). Composing a
   * second sentence here is how two surfaces end up describing one injury
   * differently. */
  const line = safetyVerdictLine(resolution).trim();

  return {
    schemaVersion: ACTION_SCHEMA_VERSION,
    kind: 'SAFETY_STOP',
    direction: 'STOP',
    before: args.before ?? [],
    because: line.length > 0
      ? line
      : `training is withheld: ${resolution.reason.replace(/_/g, ' ')}`,
    until: args.untilISO ?? null,
  };
}
