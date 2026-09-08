/**
 * lib/health/checkin-refusal.ts · INJURYCHECKIN-1.
 *
 * "THERE IS NOTHING HERE TO ACT ON" IS AN ANSWER, NOT A FAILURE TO ANSWER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * The injury-flare screen (13a) draws off `runner_injuries` — a diagnosed
 * musculoskeletal issue — and its "How does it feel today" check-in POSTs to
 * `/api/niggle/recovery`, which reads `niggles`. Those are two tables with
 * two independent lifecycles: nothing in the app writes `runner_injuries`
 * from the phone at all (there is no caller anywhere for `POST /api/injuries`).
 * So a runner with an OPEN INJURY and no active niggle taps a check-in row
 * and the route answers `404 {error:'no active niggle'}` — deterministically,
 * every time, on a perfectly healthy network.
 *
 * The phone collapsed every non-2xx into `V5WriteSettlement.didNotLand`,
 * whose copy reads "The coach may not have it yet. Trying again is safe."
 * That sentence is TRUE of a lost response and FALSE of this: retrying a
 * request that structurally cannot succeed is not safe, it is a loop. Rule
 * 11 — "don't know", "measured zero" and "the read failed" are three facts —
 * pointed one layer deeper than TODAYWRITE-2 took it: a semantically
 * meaningful 4xx is a fourth fact, and it is the only one of the four the
 * SERVER can state in words.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CONTRACT
 *
 * A route that cannot succeed answers 4xx with a `refusal` STRING the phone
 * can print, plus `retryable: false`. `V5WriteSettlement.refused` is keyed on
 * the presence of that string and NOT on the status code, on purpose:
 *
 *   · a 404 from a mistyped path, a proxy, or a route that has not learned
 *     this contract carries no `refusal`, and must keep settling as
 *     `.didNotLand` — the phone genuinely does not know what happened.
 *   · a route that DOES carry one has said, in words, that the request can
 *     never succeed as sent. That is the only case allowed to suppress the
 *     Retry, so the server has to opt in rather than the phone having to
 *     guess from a number.
 *
 * SCOPE, AND WHAT THIS DOES NOT FIX. The `runner_injuries` / `niggles`
 * disconnect above is real and is NOT addressed here — unifying those two
 * models is an architectural question with a plan surface, a safety read and
 * a return-to-running ladder hanging off it. What is fixed is the FAILURE
 * MODE: given the disconnect, the screen now says something true.
 */

export type RecoveryKind = 'niggle' | 'sick';

/**
 * The sentence the runner reads. Both hold in BOTH worlds this 404 covers,
 * which is why neither of them says "you never flagged one":
 *
 *   · nothing was ever open (the injury/niggle disconnect above), and
 *   · something WAS open and this very runner just cleared it — a "gone" or
 *     "recovered" that landed and lost its answer, retried. The retry is the
 *     one that 404s, and telling that runner "there was none" would be the
 *     same class of fabrication this whole change exists to stop.
 *
 * Coach voice: states the fact, names both readings, promises nothing.
 */
export const NOTHING_OPEN_REFUSAL: Record<RecoveryKind, string> = {
  niggle:
    'Nothing is open to check in on. Either this was already cleared, or there was no niggle flagged.',
  sick:
    'Nothing is open to check in on. Either this was already cleared, or there was no illness on file.',
};

/** The body shape. `error` stays for existing callers and logs. */
export function nothingOpenBody(kind: RecoveryKind) {
  return {
    error: kind === 'niggle' ? 'no active niggle' : 'no active sick episode',
    /** The phone prints this verbatim. Presence is what marks it permanent. */
    refusal: NOTHING_OPEN_REFUSAL[kind],
    /** Explicit, so nothing downstream has to infer it from a status code. */
    retryable: false as const,
  };
}
