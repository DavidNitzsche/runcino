/**
 * lib/faff/why-voice.ts — "Why this run", in a coach's voice.
 *
 * David, 2026-08-21: "I want this section to always feel like a quick text
 * from a coach. More conversational. Not just this, but for anything ever in
 * this section."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, AND IT WAS NOT THE FACTS
 *
 * The section read:
 *
 *   Post-race recovery · Americas Finest City. Easy running only · no
 *   quality. Conversational pace · should feel like nothing.
 *
 * Every claim in that is correct and cited. It reads like a database because
 * of two things that have nothing to do with correctness:
 *
 *   THE INTERPUNCT. `·` is UI punctuation. It separates fields on a stats
 *   plate, where there is no grammar to carry the join. Nobody speaks it. In
 *   prose it turns a sentence into a record, and there were three of them in
 *   three sentences.
 *
 *   THE STAPLE. Three independently-authored fragments joined with full
 *   stops, each starting cold. No "so", no "and", no second person — nothing
 *   that makes one clause follow from the last. A person writing this would
 *   have said "you" once and used one connective.
 *
 * So this module does not invent a single claim. It takes the parts the
 * engine already authored — the phase rationale, the day's own note, the
 * type's own fact — and writes them the way someone would type them into a
 * message. Same physiology, different register.
 *
 * THE RULES, which apply to anything that ever fills this section:
 *
 *   1. No interpuncts. Ever. Comma, semicolon, or a rewrite.
 *   2. Two sentences at most. A text is short or it is an email.
 *   3. Second person where it is natural. It is advice to a person.
 *   4. Connect the second clause to the first, or drop it.
 *   5. Never say the same thing twice in different words.
 *   6. Coach voice still governs: no hype, no exclamation marks, no emoji,
 *      no em dashes, and never scold.
 */

export interface WhyFacts {
  /** RECOVERY · BASE · QUALITY · RACE-SPECIFIC · TAPER, or null. */
  phase: string | null;
  /** The runner's most recent A/B race, if there is one behind them. */
  lastRaceName: string | null;
  daysSinceRace: number | null;
  /** The generator's own sentence for this day. */
  dayNote: string | null;
  /** The generator's own reason for this phase. */
  phaseRationale: string | null;
  /** `derivePurpose`'s text — the floor when nothing better exists. */
  fallback: string | null;
}

/** An interpunct is a field separator. Prose gets a comma. */
export function deInterpunct(s: string): string {
  return s
    .replace(/\s*·\s*/g, ', ')
    // A comma before "and"/"but"/"so" reads fine; a comma before "no" from
    // "easy running only · no quality" reads better as one clause.
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentence case with the original's own capitals kept. */
function sentence(s: string): string {
  const t = s.trim().replace(/\s*\.\s*$/, '');
  if (!t) return '';
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

/** "eight days", "three weeks" — words, because a text does not use digits
 *  for small counts. */
function spellSpan(days: number): string {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
             'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'];
  if (days <= 13) return `${w[days] ?? days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  return `${w[weeks] ?? weeks} week${weeks === 1 ? '' : 's'}`;
}

/**
 * The opening clause. This is the sentence that answers WHY, and it is the
 * one the old copy never had — it opened on what the run IS.
 */
function opener(f: WhyFacts): string | null {
  const phase = (f.phase ?? '').toUpperCase();
  const recent = f.lastRaceName && f.daysSinceRace != null && f.daysSinceRace <= 28
    ? { name: f.lastRaceName, span: spellSpan(f.daysSinceRace) }
    : null;

  if (phase.startsWith('RECOVERY')) {
    return recent
      ? `You're ${recent.span} on from ${recent.name}, so this week is still about absorbing it`
      : `You're still absorbing the last race, so this week stays gentle`;
  }
  if (phase.startsWith('TAPER')) {
    return `The work is done, so this week is about arriving fresh`;
  }
  if (phase.startsWith('RACE')) {
    return `You're close enough now that the sessions look like the race`;
  }
  if (phase.startsWith('BASE')) {
    return `This is base, so the week's total matters more than any single run`;
  }
  if (phase.startsWith('QUALITY')) {
    return `You're in the part of the block where the hard sessions do the work`;
  }
  return null;
}

/**
 * One or two sentences a coach would actually type.
 *
 * Order is reason, then instruction. The reason comes from the phase and the
 * race behind it; the instruction from the day's own note, or the type's
 * fact, or the fallback — whichever the engine actually authored.
 */
export function composeWhy(f: WhyFacts): string {
  const lead = opener(f);
  const isRest = /^\s*(off|rest)\b/i.test(f.dayNote ?? '') || /^rest day/i.test(f.fallback ?? '');

  // A rest day needs no instruction. "You're eight days on from AFC, so this
  // week is still about absorbing it." is the whole message; adding "Off.
  // Still recovering." says it a second time in fragments.
  if (lead && isRest) return sentence(lead);

  let body = deInterpunct(f.dayNote?.trim() || f.fallback?.trim() || '');

  // THE VERDICT IS A LABEL, NOT A SENTENCE. `derivePurpose` opens with a bare
  // noun — "Easy day.", "Tempo.", "Long run.", "Intervals." — which works as
  // a heading above the facts and reads as a stub inside prose. The screen
  // already carries the session type in 56pt Archivo directly above this, so
  // repeating it here is the third time the runner has been told.
  body = body.replace(/^(easy day|rest day|long run|tempo|intervals|mixed effort|shake the legs|race day)\.\s*/i, '');

  // Rule 5 · do not repeat what the opener already carried.
  if (lead) {
    const said = lead.toLowerCase();
    if (/absorb|gentle/.test(said)) body = body.replace(/^recovery easy,\s*/i, '');
    if (/total matters/.test(said)) body = body.replace(/the week's volume is what matters[^.]*\.?\s*/i, '');
    if (/hard sessions do the work/.test(said)) body = body.replace(/these sessions pay off[^.]*\.?\s*/i, '');
  }

  // Rule 2 · two sentences. With an opener the body gets one, and it is the
  // first, because the engine writes its most specific claim first.
  const parts = body.split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
  body = (lead ? parts.slice(0, 1) : parts.slice(0, 2)).join(' ');

  // A trailing fragment reads as a note to self. Give it a verb.
  body = body
    .replace(/^conversational pace\b/i, 'Keep it conversational')
    .replace(/^conversational\b/i, 'Keep it conversational')
    .replace(/^easy means easy\b/i, 'Easy means easy')
    .replace(/^\s*,\s*/, '')
    .trim();

  if (!lead) return body ? sentence(body) : '';
  if (!body) return sentence(lead);
  return `${sentence(lead)} ${sentence(body)}`;
}
