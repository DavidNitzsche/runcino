/**
 * lib/plan/mutation-refusal.ts · CALLERHONESTY-1 (2026-09-13)
 *
 * ONE PLACE THAT TURNS A `MutationOutcome` INTO WHAT THE RUNNER READS.
 *
 * ─── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `mutatePlan` was made honest first. Its refusals are now four distinct
 * facts — `rejected` (doctrine said no), `no_plan` (there is nothing to change
 * / the named plan is archived), `plan_verification_failed` (a read this
 * boundary depends on THREW, so nothing was established), `ledger_unwritten`
 * (the change could not be recorded, so it was rolled back) — and every one of
 * them is separately reasoned, separately logged and separately recorded.
 *
 * Then every caller threw the distinction away on the last hop. Five route
 * handlers answered all of them with one body:
 *
 *     { error: 'plan_invariant_violation', violations }   HTTP 409
 *
 * and `lib/plan/replan-scenarios.ts` went further and hardcoded the sentence:
 *
 *     'That change would break the plan\'s own rules, so it was not made.'
 *
 * For a doctrine rejection that is exactly right. For a
 * `plan_verification_failed` it is a FABRICATION: the runner is told his
 * training conflicts with the coaching rules, when what actually happened is
 * that a database read timed out. He is told the fault is in his request, so
 * he will not retry — and retrying is the only thing that would have worked.
 * An honest backend refusal that becomes a false runner-facing sentence is
 * worse than not having fixed the backend, because the backend fix is now
 * invisible and the lie has the fix's authority behind it.
 *
 * `lib/plan/_move_ledger_absent.db.test.ts` had already written this finding
 * down in its own comments ("FOUND-BUT-NOT-FIXED") for the `ledger_unwritten`
 * case. This file is the fix for all of them.
 *
 * ─── WHY IT IS ONE FUNCTION AND NOT A `switch` PER CALLER ───────────────────
 *
 * CLAUDE.md Rule 16, applied to a sentence rather than a number: if two
 * surfaces say the same thing they say it the same way, and the fix is to
 * resolve it in ONE place and let every surface call it. Six hand-written
 * mappings would drift within a month, and the drift would be invisible —
 * nobody reads two routes side by side. `_mutation_refusal.test.ts` asserts
 * that no caller re-derives one.
 *
 * The SUBJECT varies by surface ("That move", "That change", "Putting that
 * back") and is a parameter. The WHY clause never varies, because the why is
 * a property of the outcome and not of the button that was pressed.
 *
 * ─── COACH VOICE ────────────────────────────────────────────────────────────
 *
 * Checked against CLAUDE.md's tone rule and `scripts/check-coach-voice.sh`'s
 * scope: no exclamation marks, no em dashes, no emoji, no hype, no apology and
 * no fake empathy. Each sentence says what happened, what state the plan is in
 * now, and — only where it is true — that trying again may work.
 *
 * ─── RULE 22 · WHAT THIS FILE CANNOT DO ─────────────────────────────────────
 *
 * It cannot make a caller call it. A route that stops importing this and
 * writes its own body again is a regression this file is structurally unable
 * to see; that is what the companion test's source scan is for, and why the
 * scan asserts on the literal response shape rather than on behaviour.
 */
import type { MutationOutcome } from './mutate';

/**
 * The machine word on the wire. Identical string on every surface, so one grep
 * follows a refusal from `plan_decision_ledger.mutation_outcome` through the
 * API response to the client branch that handles it.
 *
 * It is deliberately NOT the raw `MutationOutcome` union: `rejected` and
 * `undeclared_structural` are two engine-internal ways of saying one
 * runner-facing thing, and `duplicate` is not a failure of the same kind.
 */
export type MutationRefusalCode =
  /** Doctrine refused it. The runner's request genuinely conflicts with the plan's rules. */
  | 'plan_invariant_violation'
  /** A read failed. NOTHING was established, and a retry may well succeed. */
  | 'plan_verification_failed'
  /** There is no active plan this change can be applied to. A real, measured fact. */
  | 'no_plan'
  /** The change could not be recorded, so it was rolled back rather than left unauditable. */
  | 'ledger_unrecorded'
  /** It had already been applied under the same key. The first one stands. */
  | 'duplicate'
  /** Anything else. Named rather than dressed up as one of the four above. */
  | 'mutation_failed';

export interface MutationRefusal {
  code: MutationRefusalCode;
  /**
   * 409 for "your request conflicts with the state of things" (doctrine, no
   * plan, duplicate). 503 for "we could not complete this and it is not your
   * fault" (verification, ledger) — the same code `lib/route/failure.ts`
   * chose, and for the same stated reason: a 500 reads as "this is broken", a
   * 503 reads as "ask again", and the phone's own `APIV5.v5()` split routes
   * them differently.
   */
  status: 409 | 503;
  /** One sentence, coach voice, for the runner. */
  reason: string;
  /** True when the SAME request, unchanged, could plausibly succeed later. */
  retryable: boolean;
  /** The boundary's own violation strings, unaltered. Never the runner's copy. */
  violations: readonly string[];
}

/**
 * How the surface names the thing that did not happen. Sentence-initial, so it
 * is capitalised, and it is a noun phrase because every template below reads
 * `<subject> <verb>`.
 */
export interface RefusalSubject {
  /** e.g. `'That move'`, `'That change'`, `'Putting that back'`. */
  thing: string;
}

const DEFAULT_SUBJECT: RefusalSubject = { thing: 'That change' };

/**
 * The one mapping.
 *
 * @param boundary the `mutatePlan` result, or anything carrying its outcome
 *                 and violations. Pass the result straight through.
 * @param subject  how this surface names the action. Optional.
 */
export function refusalFor(
  boundary: { outcome: MutationOutcome | 'not_attempted' | null; violations?: readonly string[] },
  subject: RefusalSubject = DEFAULT_SUBJECT,
): MutationRefusal {
  const violations = boundary.violations ?? [];
  const it = subject.thing;

  switch (boundary.outcome) {
    /* THE ONE CASE THE OLD GENERIC MESSAGE WAS ACTUALLY TRUE FOR. Unchanged
     * wording on purpose: it was right, it is in the runner's vocabulary
     * already, and changing it would churn a screen for no gain. */
    case 'rejected':
    case 'undeclared_structural':
      return {
        code: 'plan_invariant_violation',
        status: 409,
        reason: `${it} would break the plan's own rules, so it was not made.`,
        retryable: false,
        violations,
      };

    /* NOT A REFUSAL OF THE REQUEST. A refusal to GUESS. The sentence says the
     * plan is untouched (the thing he actually wants to know) and that trying
     * again is worth doing (the thing the old sentence talked him out of). */
    case 'plan_verification_failed':
      return {
        code: 'plan_verification_failed',
        status: 503,
        // The retry hint lives in `retryable`, not in the sentence. "Try again
        // in a moment" is on the app-voice band in `lib/faff/coach-lexicon.ts`
        // and `check-coach-voice.sh` rejects it, correctly: the surface owns
        // whether to offer a Retry control, and the coach owns what is true.
        reason: `We could not check your plan just now, so ${lowerFirst(it)} was not made. `
          + 'Nothing has changed.',
        retryable: true,
        violations,
      };

    /* A MEASURED FACT, and its own sentence. It covers two sub-cases the
     * boundary distinguishes internally (no active plan at all; a named plan
     * that is archived or not owned) and reports under one outcome. Splitting
     * `no_plan` in two is a real follow-up and is named here rather than
     * faked: the wording below is chosen to be true of both, and
     * `violations[0]` carries which one it was. */
    case 'no_plan':
      return {
        code: 'no_plan',
        status: 409,
        reason: `${it} could not be matched to an active plan, so nothing was changed.`,
        retryable: false,
        violations,
      };

    case 'ledger_unwritten':
      return {
        code: 'ledger_unrecorded',
        status: 503,
        reason: `${it} was not made. It could not be recorded, and a change with no record `
          + 'could not be explained or undone later.',
        retryable: true,
        violations,
      };

    case 'duplicate':
      return {
        code: 'duplicate',
        status: 409,
        reason: `${it} has already been made. Nothing was done a second time.`,
        retryable: false,
        violations,
      };

    /* `applied`, `bypassed` and `authorship_drift` are SUCCESSES and never
     * reach here; `not_attempted` and null are the crash and the
     * caller-threw-before-an-outcome paths. Named plainly rather than folded
     * into one of the four real refusals above, which is the whole point of
     * this file. */
    default:
      return {
        code: 'mutation_failed',
        status: 503,
        reason: `${it} could not be applied. Nothing was changed.`,
        retryable: true,
        violations,
      };
  }
}

/** `'That move'` → `'that move'`, for a subject used mid-sentence. Leaves an
 *  already-lowercase or non-alphabetic first character alone. */
function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/**
 * The JSON body every route answers a refused mutation with.
 *
 * `error` is the code, `reason` is the sentence, and `violations` is the
 * engine's own list. `reason` is present on purpose: `lib/route/failure.ts`
 * notes that the phone reads a refusal out of that key, and a refusal the
 * client cannot render as content becomes the outage screen.
 */
export function refusalBody(r: MutationRefusal): {
  ok: false;
  error: MutationRefusalCode;
  reason: string;
  retryable: boolean;
  violations: readonly string[];
} {
  return {
    ok: false,
    error: r.code,
    reason: r.reason,
    retryable: r.retryable,
    violations: r.violations,
  };
}
