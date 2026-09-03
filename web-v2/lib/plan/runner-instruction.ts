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

/**
 * ── RUNNERLANG-2 (2026-09-03) · THE SENTENCE THAT RODE EVERY ROW ────────────
 *
 * RUNNERLANG-1 replaced the WORDS and left the REPETITION exactly where it
 * was. Measured on a freshly composed fourteen-week marathon block, after
 * that change:
 *
 *   33  easy enough to talk in full sentences.
 *   33  if the heart rate drifts up, slow down even when the pace still looks right.
 *   28  off.
 *   27  sleep, mobility, fuel.
 *
 * `Conversational. Z2 HR cap.` was printed 33 times. Its replacement is
 * printed 33 times. The owner's complaint was not only that the words were
 * wrong, it was that the plan says the same thing over and over, and a
 * substitution table cannot see that. Which is Rule 20's corollary exactly:
 * the rule was written down, the instance was fixed, and the gap stayed open
 * because nothing could count.
 *
 * ── THE SPLIT ──────────────────────────────────────────────────────────────
 *
 * Rule 17: "If a surface repeats a sentence per row, the sentence belongs to
 * the block, not the row." So each of these strings is one of two things and
 * never both:
 *
 *   · A STANDING INSTRUCTION. True of every easy day in the block, and
 *     therefore said once, on the first row it applies to, through
 *     `BlockScopedSpeaker` — the same mechanism and the same precedent as the
 *     terrain sentence, which went from eleven rows to one.
 *   · A ROLE LINE. True of THIS row and not its neighbours, so it earns its
 *     place on the row. The role is read off decisions the composer has
 *     already made — what the day sits next to, and whether it is the week's
 *     longest easy run — and nothing else. No branch on runner state, no
 *     score, no tone. `easyDayRole` is a pure function of four booleans, which
 *     is the whole of the judgement in this file.
 *
 * The `plain` role is deliberately the EMPTY STRING. A day with nothing
 * specific to say about it says nothing: the row already carries its distance,
 * its pace band and its HR ceiling, and those are what the runner acts on.
 * Printing a generic sentence over them is the bloat, not a service.
 *
 * ── WHAT THIS COSTS, STATED PLAINLY ────────────────────────────────────────
 *
 * A runner who opens the app in week eight never reads the standing sentence,
 * because it was said in week one. That is the same trade the terrain fix
 * made and the same one a coach makes out loud. A fourteen-week block is not
 * improved by repeating it thirty-three times.
 *
 * ── AND WHY THIS ONE RUNS AT AUTHORING, WHERE RUNNERLANG-1 RAN AT THE READ ─
 *
 * RUNNERLANG-1 is a per-string swap, so the read is the right place for it:
 * it repairs every row already in `plan_workouts` with no data write. THIS
 * pass cannot go there. "Said once" needs the whole block in hand, and
 * `week-loader.ts` loads ONE WEEK at a time — and `/api/v5/today` calls the
 * same loader and then picks a single day out of it. A week-scoped speaker at
 * the read would therefore blank the note on Today for every runner whose
 * today is not the first day of their week, which is six days in seven. That
 * is a worse defect than the one it fixes, so it is not done.
 *
 * The consequence, stated rather than hidden: the block already persisted
 * keeps its repetition until it is next authored. Measured on the owner's
 * live block as `faff_readonly` on 2026-09-03, 103 rows, all with notes:
 * "Conversational." 35 and "Z2 HR cap." 35, which `renderRunnerInstruction`
 * turns into 35 of each replacement. Re-authoring is what spends this fix.
 */

/** A sentence true of every row of its kind in the block. Said once. */
export interface StandingInstruction {
  /** `BlockScopedSpeaker` key. Stable: it is what makes "once" mean once. */
  id: string;
  /** The exact seed the composer writes on the row, so the pass can find it. */
  text: string;
}

/**
 * Every sentence the composer may write on many rows that is true of the KIND
 * of row rather than of this row. Said once each, in calendar order, by
 * `applyRunnerVoice`.
 *
 * ── ONE SENTENCE PER ENTRY, AND WHY ────────────────────────────────────────
 *
 * The match is on a whole SENTENCE, never a substring, so an entry that
 * spanned two sentences could be half-consumed by another entry and leave
 * wreckage — "Off. Sleep, mobility, fuel." losing its "Off." to a bare "Off."
 * entry is the citation scrub's "Cruise intervals.3." all over again. Entries
 * are single sentences and the pass rebuilds the note from the sentences that
 * survive, so a partial match is not expressible.
 *
 * ── HOW A ROW READS AFTERWARDS ─────────────────────────────────────────────
 *
 * The first row of the block that would have carried a sentence keeps it,
 * exactly where the composer put it. Every later row loses that sentence and
 * keeps everything else it was carrying, which is usually its own
 * prescription. A rest row whose entire note was standing text ends up bare,
 * and that is correct: the row already says REST, and Rule 17 plus the UX
 * doctrine both say a row with nothing particular to add adds nothing.
 *
 * Adding an entry here is how a newly-repeated sentence is retired. Deleting
 * the sentence from the composer instead is also correct, and is the better
 * answer when the sentence was never worth saying at all.
 */
export const BLOCK_STANDING_SENTENCES: readonly StandingInstruction[] = [
  // ── the easy day · the two sentences RUNNERLANG-1 put on 33 rows ─────────
  { id: 'easy.talk-test', text: 'Easy enough to talk in full sentences.' },
  { id: 'easy.hr-drift', text: 'If the heart rate drifts up, slow down even when the pace still looks right.' },
  // ── the long run's own talk test · once per week, every week ─────────────
  { id: 'long.talk-test', text: 'Easy the whole way, talking in full sentences.' },
  // ── the medium-long run's PURPOSE ────────────────────────────────────────
  //
  // A purpose is the definition of a block-level sentence: it is true of the
  // session kind, not of this Wednesday. The instruction halves of that note
  // ("Easy to steady", the embedded threshold segment, "let the last few miles
  // drift up") stay on the row, because they are what the runner does.
  { id: 'mlr.purpose', text: 'Aerobic strength under fatigue, without the cost of a long run.' },
  // ── rest ────────────────────────────────────────────────────────────────
  //
  // Eight sentences across six authoring sites, and a low-frequency week can
  // hold four to six rest rows. "Off." was printed six times in one post-race
  // week, over six rows that also all said "Post-race recovery."
  { id: 'rest.off', text: 'Off.' },
  { id: 'rest.sleep-mobility-fuel', text: 'Sleep, mobility, fuel.' },
  { id: 'rest.sleep-hydrate-mobilize', text: 'Sleep, hydrate, mobilize.' },
  { id: 'rest.post-race', text: 'Post-race recovery.' },
  { id: 'rest.between-sessions', text: 'The day between sessions is where the adaptation happens.' },
  { id: 'rest.not-a-run-day', text: 'Not one of your run days this week.' },
  // ── taper and race week ─────────────────────────────────────────────────
  //
  // `Research/08` §9.3 gives T-4 and T-3 an easy run in minutes. The composer
  // wrote the same two sentences on both rows; the DURATION differs and stays.
  { id: 'raceweek.talk-test', text: 'Talk in full sentences the whole way.' },
  { id: 'raceweek.strides-optional', text: 'Strides optional at end.' },
  { id: 'taper.rest-is-the-work', text: 'Taper week · rest is the work now.' },
  { id: 'raceweek.tuneup-rest', text: 'Race week for a tune-up · rest is the work now.' },
  { id: 'raceweek.too-few-days', text: 'Too few run days this week to fit the tune-up · rest is the work now.' },
];

/**
 * What this easy day is FOR, relative to the sessions around it. Read off the
 * composed week, never off the runner.
 */
export type EasyDayRole = 'volume' | 'recovery' | 'between' | 'primer' | 'plain';

/**
 * One line per role. Each says something the neighbouring rows do not, which
 * is the only reason a row-level sentence is allowed to exist.
 *
 * `plain` is empty on purpose. See the header.
 */
export const EASY_DAY_ROLE_LINES: Readonly<Record<EasyDayRole, string>> = {
  volume: 'The week\'s longest easy run. This is where the aerobic volume comes from.',
  recovery: 'Recovery day after the long run. Slower than your normal easy pace.',
  between: 'Aerobic day between sessions. Keep it honest so tomorrow\'s work is there.',
  primer: 'Short and easy. The session is tomorrow.',
  plain: '',
};

/**
 * The role, from facts the composer already resolved.
 *
 * Priority is fixed and ordered so the SHARPEST fact wins: being the week's
 * longest easy run is a property of the week's own shape and it is what the
 * runner needs to hear about that day, even when it also happens to sit next
 * to a session.
 *
 * `recovery` sits ABOVE `primer`, and that order was measured rather than
 * guessed. With the long run on Sunday and quality on Tuesday, Monday is both
 * the day after the long run AND the day before a session; with `primer`
 * first, `recovery` fired ZERO times across a whole fourteen-week block and
 * the single most important easy day in the week was told "the session is
 * tomorrow" instead. Rule 22: a verdict no case can reach is decoration. The
 * long run is the week's largest stress, so recovering from it is the fact
 * that governs the day.
 *
 * Pure and total. No default branch that could swallow a new fact silently.
 */
export function easyDayRole(f: {
  /** This row is the longest easy run of its week (ties broken by the caller). */
  isLongestEasyOfWeek: boolean;
  /** Tomorrow is the long run or a quality session. */
  nextIsHard: boolean;
  /** Yesterday was the long run. */
  prevWasLong: boolean;
  /** Yesterday was a quality session. */
  prevWasQuality: boolean;
}): EasyDayRole {
  if (f.isLongestEasyOfWeek) return 'volume';
  if (f.prevWasLong) return 'recovery';
  if (f.nextIsHard) return 'primer';
  if (f.prevWasQuality) return 'between';
  return 'plain';
}
