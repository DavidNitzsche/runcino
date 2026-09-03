/**
 * lib/plan/runner-instruction.ts · RUNNERLANG-1 (2026-09-02)
 *
 * THE RUNNER READS AN INSTRUCTION, NOT THE ENGINE'S VOCABULARY.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 *
 * The owner, on his own composed block:
 *
 *   "Remove phrases such as 'Conversational', 'Z2 HR cap', engine taxonomy,
 *    internal rule names, unsupported coaching shorthand. Replace them with
 *    direct running instructions that tell me what to do."
 *
 * `Conversational.` and `Z2 HR cap.` were the two most-printed sentences in
 * the composed plan. Neither is an instruction. "Conversational" is an
 * adjective standing in for one, and "Z2 HR cap" names a zone MODEL at a
 * runner who can only watch a number. So the prose's job is the part a stat
 * row cannot carry: how the effort should feel, what to prioritise, what to
 * do when the pace and the effort disagree, and how to finish.
 *
 * ── WHY THIS IS A SUBSTITUTION TABLE AND NOT A COMPOSER ────────────────────
 *
 * The owner's binding constraint: "All explanations must derive from
 * structured canonical decisions. Do not create a separate prose brain."
 *
 * So there is NO judgement in this file. It is one fixed table plus one
 * counter. What decides the words is which retired phrase was present, and
 * nothing else — no branch on runner state, no score, no conditional tone.
 *
 * Every replacement is a PHRASE swap that leaves the surrounding sentence
 * standing, never a deletion. That is the lesson of the citation scrub, which
 * turned "Cruise intervals · Research/04 §5.3." into "Cruise intervals.3." and
 * passed a test asserting only the ABSENCE of "Research/".
 * `_runner_instruction.test.ts` asserts the SHAPE of every output — against
 * the real authored strings, not invented ones.
 *
 * ── NO NUMBER IS INJECTED INTO PROSE, DELIBERATELY ─────────────────────────
 *
 * "Keep your heart rate under 151" is what the owner asked to read, and he
 * reads it — on the HR row, which owns it (`workout_spec.hr_cap_bpm`, rendered
 * `Keep it under · 151 bpm`). It is not written into a sentence here, because
 * two rules point the same way:
 *
 *   · Rule 10. A plan row authored fourteen weeks out and stamped with a
 *     ceiling derived from that day's LTHR goes stale the moment the anchor
 *     moves — which it did, 162 to 168, mid-block. The row's ceiling is
 *     re-derived at read time. Prose carrying a baked number would be the one
 *     copy nothing re-derives.
 *   · Rule 17 and the design contract. `/api/v5/today` renders the day note
 *     AND the poster's HR row on one screen. The number in both is the same
 *     defect as average heart rate printing three times on Today.
 *
 * The number lives in the row that owns it. This file owns the verb.
 *
 * ── WHERE THIS RUNS ────────────────────────────────────────────────────────
 *
 * At the READ, on `plan_workouts.notes`, exactly as `stripResearchCitations`
 * does and for the reason that one was done that way: it repairs every row
 * already in the table with no data write and no re-authoring. The authoring
 * sites were fixed in the same change, so a plan composed from today forward
 * never carries a retired phrase and this pass is a byte-identical no-op on
 * it.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ─────────────────────────────────────
 *
 *   · A PHRASE NOBODY LISTED. This is a fixed table. Shorthand written in
 *     words that are not in it passes through untouched. `coach-lexicon.ts`'s
 *     `shorthand` band is the file-wide half of the same job and is what stops
 *     a retired phrase being re-typed at an authoring site; neither can grade
 *     prose it has never seen.
 *   · A SENTENCE ASSEMBLED AT RUN TIME. If a composer joins two clean
 *     fragments into "conversational pace", no literal ever existed and
 *     nothing here sees it. `scanLayerOne` over the composed `why` can.
 *   · WHETHER THE REPLACEMENT IS GOOD COACHING. It asserts that a swap
 *     happened and that the result is well-formed. The copy itself was
 *     reviewed by hand and is not measurable here.
 *   · A CALLER THAT FORGOT TO CALL IT. `BlockScopedSpeaker` cannot discover a
 *     site that appends a block sentence per row without asking it;
 *     `_runner_instruction.test.ts` pins the one caller by reading its source,
 *     which is the same wiring guard `_week_note_scrub.test.ts` uses.
 */

/** One retired phrase, and the instruction that replaces it. */
export interface InstructionRewrite {
  id: string;
  /**
   * The retired phrase, lower-case, matched case-insensitively. Never
   * includes a trailing full stop unless the phrase spans two sentences, so
   * the swap cannot strand or duplicate punctuation.
   */
  find: RegExp;
  /** The instruction that replaces it. Sentence case; see `matchCase`. */
  to: string;
  why: string;
}

/**
 * THE TABLE.
 *
 * Ordered longest-first: a phrase that contains another must be tried before
 * the one it contains, or the outer form is half-rewritten. `Conversational.
 * Z2 HR cap.` before `Conversational`; `at a conversational pace` before
 * `conversational pace`, which would otherwise produce "at a easy enough".
 *
 * Every `find` here was read off an authoring site in this repo on
 * 2026-09-02. None was invented, and the test asserts the composed result for
 * each of those real strings rather than for a fixture.
 */
export const INSTRUCTION_REWRITES: readonly InstructionRewrite[] = [
  {
    id: 'easy.conversational-z2-hr-cap',
    find: /conversational\.\s+z2 hr cap\./g,
    to: 'Easy enough to talk in full sentences. If the heart rate drifts up, slow down even when the pace still looks right.',
    why: 'The two most-printed sentences in the block, and neither was an instruction. '
      + 'The replacement says how the effort should feel and what to do when the pace '
      + 'and the effort disagree. The ceiling itself stays on the HR row.',
  },
  {
    id: 'easy.z2-hr-cap',
    find: /z2 hr cap\./g,
    to: 'If the heart rate drifts up, slow down even when the pace still looks right.',
    why: 'The same phrase standing alone. A zone label is not a ceiling a runner can watch.',
  },
  {
    id: 'easy.at-easy-conversational-pace',
    find: /at easy conversational pace/g,
    to: 'at an easy pace you can talk through',
    why: 'The long-run seed. Kept as a prepositional phrase so the sentence around it stands.',
  },
  {
    id: 'easy.at-a-conversational-pace',
    find: /at a conversational pace/g,
    to: 'at a pace you can talk through',
    why: 'The first-run note. Same shape, different article.',
  },
  {
    id: 'easy.conversational-effort-throughout',
    find: /conversational effort throughout/g,
    to: 'talk in full sentences the whole way',
    why: 'An adjective and an adverb with no action in them. The talk test IS the action.',
  },
  {
    id: 'easy.conversational-throughout',
    find: /conversational throughout/g,
    to: 'easy the whole way, talking in full sentences',
    why: 'The form that rode every long run in the owner\'s block.',
  },
  {
    id: 'easy.conversational-no-surges',
    find: /conversational, no surges/g,
    to: 'talk in full sentences, and no surges',
    why: 'A recovery day. "No surges" was already an instruction and is kept.',
  },
  {
    id: 'easy.conversational-nothing-more',
    find: /conversational, nothing more/g,
    to: 'talk in full sentences, and nothing faster',
    why: 'The race-morning warm-up, where the same phrase stood in for the same instruction.',
  },
  {
    id: 'easy.conversational-pace',
    find: /conversational pace/g,
    to: 'easy enough to talk in full sentences',
    why: 'The bare noun phrase, which is the form the Today why line opened with.',
  },
  {
    id: 'easy.conversational',
    find: /\bconversational\b/g,
    to: 'easy enough to talk in full sentences',
    why: 'The bare adjective. Last, so every longer form above claims its match first.',
  },
];

/**
 * Carry the matched text's capitalisation onto the replacement.
 *
 * "Recovery easy · conversational, no surges." and "Conversational, no
 * surges." are the same phrase in two positions, and a fixed-case replacement
 * gets one of them wrong. Mechanical, and the only transformation in this file
 * that is not a table lookup.
 */
function matchCase(matched: string, replacement: string): string {
  const first = matched[0];
  if (!first || !replacement) return replacement;
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement[0].toLowerCase() + replacement.slice(1);
}

/**
 * Rewrite a runner-facing instruction. Pure, idempotent, and byte-identical on
 * text carrying none of the retired phrases.
 *
 * Returns the input unchanged — not null, not empty — for anything it does not
 * recognise. A substitution that can empty its input is the citation-scrub bug
 * again.
 */
export function renderRunnerInstruction(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let out = raw;
  for (const r of INSTRUCTION_REWRITES) {
    // A FRESH REGEX PER CALL. The table's entries carry /g, and a shared
    // `lastIndex` across calls makes a global regex skip matches on every
    // other invocation — which in production looks exactly like "the rewrite
    // works locally and misses half the rows".
    const re = new RegExp(r.find.source, r.find.flags + (r.find.flags.includes('i') ? '' : 'i'));
    out = out.replace(re, (m) => matchCase(m, r.to));
  }
  // A swap next to an existing separator can double a space. Collapse that,
  // and nothing else: no sentence is dropped, no punctuation is rewritten.
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return out;
}

/**
 * RULE 17 · A SENTENCE THAT BELONGS TO THE BLOCK IS SAID ONCE.
 *
 * "If a surface repeats a sentence per row, the sentence belongs to the block,
 * not the row." The terrain instruction is the worked example: the owner's CIM
 * course drops 304 ft, and `applyCourseGuidance` appended the same twenty-word
 * sentence to eleven long runs, then a second one to the taper's.
 *
 * A coach says "run the downhills" when prescribing the block and then trusts
 * the runner. The instruction is still authored from the same structured
 * decision — measured course elevation, gated on
 * `elevationIsTrustedForAdjustment` — it is simply stated at the point it
 * becomes true and not restated.
 *
 * Two DIFFERENT instructions may each be said once, because they are two
 * different facts: "find this terrain" holds through the build, and "downhill
 * running stays short and easy from here" is a state change inside the taper
 * that the runner has to be told about. Keyed by `id`, so a genuine change of
 * instruction is never swallowed as a repeat.
 */
export class BlockScopedSpeaker {
  private said = new Set<string>();

  /**
   * The sentence, the first time this `id` comes up in the block. The empty
   * string every time after, so a caller appends nothing.
   */
  say(id: string, sentence: string): string {
    if (this.said.has(id)) return '';
    this.said.add(id);
    return sentence;
  }

  /** What has been said. For assertions, and for explaining why a row is bare. */
  spoken(): readonly string[] {
    return Array.from(this.said);
  }
}
