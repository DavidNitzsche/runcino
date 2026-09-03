/**
 * lib/audit/sentence-repetition-registry.ts · SENTENCEREP-1 (2026-09-03)
 *
 * The argued exemptions to Rule 17's one-sentence-per-week rule, and nothing
 * else. The rule, the corpus and the assertions live in
 * `lib/plan/_sentence_repetition.test.ts`; this file exists so an exemption
 * has to be written down, named and argued in a place greps find, rather than
 * buried as a magic string inside the check that is supposed to enforce it.
 *
 * ── THE RULE THE EXEMPTIONS ARE EXEMPTIONS FROM ─────────────────────────────
 *
 * A runner-facing sentence may appear on at most ONE row of any one week of an
 * authored block. The week is the screen: `/plan` draws a week at a time and
 * the design contract's own line is that no content is printed twice on one
 * screen. A sentence that has to be said on three of a week's six rows is not
 * a fact about those rows, it is a fact about the block, and Rule 17 says
 * where it goes: "If a surface repeats a sentence per row, the sentence
 * belongs to the block, not the row."
 *
 * ── THE ONE ARGUMENT THAT EARNS AN EXEMPTION ────────────────────────────────
 *
 * A PRESCRIPTION IS NOT PROSE. "Finish with 6 relaxed 20-second strides" is
 * not an explanation the runner reads once and carries; it is the instruction
 * for that session, and a row it has been cut from is a row that no longer
 * tells the runner to run strides. Same for the duration on a race-week easy
 * day. Suppressing either would not be concision, it would be deletion — the
 * citation-scrub failure in a new costume.
 *
 * Nothing else earns one. "It reads better with it there" does not, and
 * neither does "the composer would be awkward to change". Both are arguments
 * for editing the composer.
 *
 * ── RATCHET ────────────────────────────────────────────────────────────────
 *
 * The list may shrink and may never silently grow. Every entry must MATCH A
 * REAL FINDING in the corpus: an exemption whose target has been fixed fails
 * the gate until it is deleted. That is the clause that stops this file
 * becoming the place repetition goes to be forgiven.
 */

export interface SentenceRepeatExemption {
  /** Stable id. Named for the argument, not for the string. */
  id: string;
  /**
   * Matched against the NORMALISED sentence (lower-case, whitespace
   * collapsed, trailing space trimmed) and anchored, so a pattern cannot
   * quietly widen into a prefix that forgives its neighbours.
   */
  pattern: RegExp;
  /** Why this repetition is a prescription and not prose. */
  reason: string;
}

export const SENTENCE_REPEAT_EXEMPTIONS: readonly SentenceRepeatExemption[] = [
  {
    id: 'prescription.strides',
    pattern: /^finish with \d+ relaxed \d+-second strides, full recovery between\.$/,
    reason:
      'The strides prescription. `Research/04` §7.2 puts strides on 2-4 days a week, so two '
      + 'easy days in one week legitimately carry it, and the REP COUNT is the phase\'s dose '
      + '(band floor in BASE, band top by RACE-SPECIFIC). Cut the second occurrence and that '
      + 'row silently stops prescribing strides. The instruction is the content.',
  },
  {
    id: 'prescription.race-week-easy-duration',
    pattern: /^\d+ min easy\.$/,
    reason:
      'The duration IS the prescription on a race-week easy day. `Research/08` §9.3 gives T-4 '
      + 'and T-3 easy runs in minutes rather than miles, and two rows in that week can land on '
      + 'the same number. A row whose duration has been suppressed as a repeat is a row with no '
      + 'prescription on it.',
  },
];
