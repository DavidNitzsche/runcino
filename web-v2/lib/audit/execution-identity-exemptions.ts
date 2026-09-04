/**
 * EXECID-SCAN-1 (2026-09-04) · which files may ask "did the runner run on this
 * DATE" from raw SQL, instead of asking the canonical resolver whether a run
 * actually executed that date's prescription.
 *
 * ── THE BUG CLASS ──────────────────────────────────────────────────────────
 *
 * Three separate fixes closed date-coincidence-as-completion in three separate
 * places, each believing it was the last one:
 *
 *   · WORKOUT-EXECUTION-ID-1 (2026-09-03) — DISPLAY. A friend's unrelated
 *     4.48mi easy run rendered as `INTERVALS · done` over a hill session David
 *     had not yet run.
 *   · EXECUTION-IDENTITY-1 — EVIDENCE. The same run feeding the adaptation
 *     engine as if it were the prescribed session.
 *   · SEALING-IDENTITY-1 (2026-09-04) — SEALING. The same run freezing that
 *     prescription's fields against any further write.
 *
 * And then SEALDATE-1 (2026-09-04) found a FOURTH: `app/api/plan/undo/route.ts`
 * still ran the raw date-keyed scan, under a comment asserting it used "the
 * SAME definition `isDaySealed` uses" — true when written, false the moment
 * SEALING-IDENTITY-1 migrated `isDaySealed` and left the route behind.
 *
 * Every one of these was a surface that STOPPED CALLING (or never called) the
 * shared resolver. `_sealing_identity.test.ts` is a behaviour test on `seal.ts`
 * and passes with full marks while a route re-derives the question next door —
 * Rule 16 says so in as many words: "a behavioural test alone cannot catch a
 * surface that stops calling the shared resolver." That is what this scanner is
 * for. It reads the SQL, not the output.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A query that selects a DAY KEY out of `runs`, scoped to one runner, is
 * asking "which days did this runner run". That is a legitimate question for
 * mileage, load, streaks and volume — and an illegitimate one for completion,
 * grading, sealing or evidence, where the only correct owner is
 * `lib/execution/day-resolver.ts`. The scanner cannot read intent, so every
 * such query is either obviously load/volume-shaped or carries an argued
 * exemption here saying which question it asks.
 *
 * Every entry is a RATCHET: it may shrink, never grow, and one whose file no
 * longer trips the scanner fails until it is deleted (Rule 18).
 */
export interface ExecutionIdentityExemption {
  readonly file: string;
  readonly reason: string;
}

export const EXECUTION_IDENTITY_EXEMPTIONS: readonly ExecutionIdentityExemption[] = [
  {
    file: 'app/api/plan/undo/route.ts',
    reason:
      'SEALDATE-1 · the date-keyed SQL here is now only a cheap CANDIDATE scan; every surviving '
      + 'candidate is put through isDaySealed() (the canonical resolver) before it can refuse an '
      + 'undo, so date coincidence alone no longer completes anything. The raw query is retained '
      + 'because it also carries the watch_completion coach_intents arm, which the resolver does '
      + 'not read — dropping it would silently narrow a second, different guard (Rule 11: "no '
      + 'matching run" and "the run row has not arrived yet" are two facts).',
  },
];
