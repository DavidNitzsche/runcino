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

import { stripResearchCitations } from '@/lib/plan/strip-citations';
import {
  layerOne, EXPLANATION_MODEL_VERSION, type CoachingExplanation,
} from './explanation';

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
  /**
   * THE COACHING THESIS' LIMITER, structured — not its sentence.
   *
   * Set on the day the thesis is about (a quality day, or the day the
   * resolver itself named as addressing the limiter) and null on every other.
   *
   * It REPLACES the phase opener rather than joining it, because they are the
   * same beat: "you're in the part of the block where the hard sessions do the
   * work" and "holding pace late is the thing to move" both answer why this
   * week looks like this, and printing both is Rule 17's exact failure. The
   * thesis clause is the stronger of the two — it names what the work is FOR,
   * off the Runner Model's own capacities, where the phase opener names only
   * where in the calendar the runner is standing.
   *
   * ── WHY THIS IS A CAPACITY AND NOT A SENTENCE (changed 2026-09-02) ───────
   *
   * It used to be the string from `coaching-thesis.ts#thesisLeadClause`, and
   * that string put Layer 3 on Layer 1. Measured on the owner's live account
   * on 2026-09-02, through the real route, on three consecutive days:
   *
   *     "Durability is the limiter right now, and this is the session that
   *      moves it. Keep it conversational throughout."
   *
   * "Limiter" is engine taxonomy. `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md`
   * is explicit that Layer 3 "must never leak directly into Layer 1", and the
   * review brief §4 lists "Coaching Thesis taxonomy" among the things Today
   * must not show. `check-coach-voice.sh` could not see it and never could:
   * the sentence is assembled at run time from fragments that are each clean,
   * which its own header names as its blind spot.
   *
   * So the thesis hands over WHICH capacity is limiting — its claim, which it
   * owns — and this module says it in runner language, which is the register,
   * which this module owns. Constitution §P, and the same split the header of
   * this file already declared. There is exactly one composer of the sentence
   * the runner reads, which is the point of Rule 16.
   */
  thesisLimiter?: 'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY' | 'UNKNOWN' | null;
  /** True when TODAY's session is one the thesis named as addressing the
   *  limiter. Changes the tail of the lead, nothing else. */
  thesisServesToday?: boolean;
  /**
   * The catalogue's own name for today's session, taken from the row's
   * persisted `selection_rationale`
   * (`coaching-thesis.ts#coachSafeSessionName`), when there is one. Replaces
   * `dayNote` as the body, so the sentence the runner reads about WHICH
   * session this is comes from the selector's own record rather than from
   * free-text notes. Null on a row authored before that field existed, and the
   * body then falls back to `dayNote` exactly as before.
   */
  thesisSessionName?: string | null;
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
 * THE LIMITER, IN RUNNER LANGUAGE.
 *
 * One phrase per capacity, saying the same thing the thesis says without the
 * word that names the mechanism. A runner can act on "holding your pace late
 * in a race"; nobody can act on "durability is the limiter".
 *
 * The tail is the only thing `servesToday` changes, and it is a real
 * distinction the runner can check against the day in front of them: this
 * session moves it, or the block does and today is something else.
 *
 * UNKNOWN returns null rather than a sentence. Rule 11 — "we could not name
 * it" is a fact, but it is not a reason to run today's session, and printing
 * a hedge in the opener would make the honest phase sentence sound weaker
 * than it is. The phase opener takes the slot instead.
 */
const LIMITER_IN_RUNNER_WORDS: Record<'THRESHOLD' | 'HIGH_INTENSITY' | 'DURABILITY', string> = {
  THRESHOLD: 'the pace you can hold for a long stretch is the thing to move right now',
  HIGH_INTENSITY: 'your top-end speed is the thing to move right now',
  DURABILITY: 'holding your pace late in a race is the thing to move right now',
};

export function thesisOpener(
  limiter: WhyFacts['thesisLimiter'],
  servesToday: boolean,
): string | null {
  if (!limiter || limiter === 'UNKNOWN') return null;
  const claim = LIMITER_IN_RUNNER_WORDS[limiter];
  return servesToday
    ? `${claim}, and this is the session that does it`
    : `${claim}, so that is what the block is building toward`;
}

/**
 * One or two sentences a coach would actually type.
 *
 * Order is reason, then instruction. The reason comes from the phase and the
 * race behind it; the instruction from the day's own note, or the type's
 * fact, or the fallback — whichever the engine actually authored.
 */
export function composeWhy(f: WhyFacts): string {
  const e = explainWhy(f, { decisionVersion: 'unversioned' });
  return e ? layerOne(e) : '';
}

/**
 * THE SAME SENTENCE, AS A TYPED EXPLANATION.
 *
 * `composeWhy` above is now a thin renderer over this, so there is ONE
 * composer and the contract is not a parallel description of a string built
 * somewhere else. `layerOne` joins verdict and reason with a single space,
 * which is byte-for-byte what the old `sentence(lead) + " " + sentence(body)`
 * produced - verified against the owner's live payload on seven consecutive
 * days in `_voice_live.audit.test.ts`.
 *
 * WHY THE CONTRACT IS WIRED HERE RATHER THAN "PREPARED FOR LATER". Rule 21:
 * "wired, tested and inert is this codebase's signature failure", and
 * `check-generated-content.sh` GUARD 5 catches it - `explanation.ts` was a
 * test-only orphan on its first prebuild run, which is exactly the
 * `lib/plan/block-preview.ts` shape that guard was written for. A contract
 * with no caller is the coaching thesis's old problem with better types.
 *
 * `spoken` is deliberately absent: this sentence is read on a screen, never
 * spoken. See `CoachingExplanation.spoken` for why inventing one would have
 * been worse than saying there is not one.
 */
export function explainWhy(
  f: WhyFacts,
  opts: { decisionVersion: string },
): CoachingExplanation | null {
  const parts = whyClauses(f);
  if (!parts.verdict) return null;
  return {
    id: 'why:' + opts.decisionVersion,
    modelVersion: EXPLANATION_MODEL_VERSION,
    decisionVersion: opts.decisionVersion,
    surfaceEvent: 'TODAY_BEFORE',
    intent: 'PRESCRIBE',
    verdict: parts.verdict,
    reason: parts.reason,
    /* THE CERTAINTY IS THE THESIS'S PRESENCE, AND NOTHING MORE.
     *
     * A day the thesis named is a day the Runner Model holds an evidenced
     * capacity belief about, so the sentence is SUPPORTED. A day carrying
     * only the phase opener is the calendar talking, which is true but is not
     * a claim about this runner - TENTATIVE. Nothing here is entitled to say
     * ESTABLISHED: this module renders a decision, it does not weigh the
     * evidence behind it (Rule 22, and the contract header's third bullet). */
    certainty: f.thesisLimiter && f.thesisLimiter !== 'UNKNOWN' ? 'SUPPORTED' : 'TENTATIVE',
    facts: [],
    accessibilitySummary: [parts.verdict, parts.reason].filter(Boolean).join(' '),
    detail: { headline: 'Why this run', paragraphs: [], evidenceLabels: [] },
  };
}

/** The two clauses, before they become either a string or an explanation. */
function whyClauses(f: WhyFacts): { verdict: string; reason?: string } {
  // THE THESIS OWNS THE OPENER WHEN IT HAS ONE. See `WhyFacts.thesisLimiter`
  // for why it replaces the phase opener rather than joining it.
  const lead = thesisOpener(f.thesisLimiter, f.thesisServesToday === true) || opener(f);
  const isRest = /^\s*(off|rest)\b/i.test(f.dayNote ?? '') || /^rest day/i.test(f.fallback ?? '');

  // A rest day needs no instruction. "You're eight days on from AFC, so this
  // week is still about absorbing it." is the whole message; adding "Off.
  // Still recovering." says it a second time in fragments.
  if (lead && isRest) return { verdict: sentence(lead) };

  // THE CITATION SCRUB, WHICH THIS COMPOSER NEVER HAD.
  //
  // `dayNote` is `plan_workouts.notes` verbatim, and the plan engine writes
  // its doctrine references into that column: on the owner's account 601 rows
  // carry a `Research/` reference, e.g. "Long run with race-pace segment
  // (middle 5 mi @ HMP per Research/22 §3 advanced template)" and
  // `applyCourseGuidance`'s "· Research/11 §net-downhill adjustments".
  //
  // (`WhyFacts.phaseRationale` is authored the same way and would need the
  // same scrub, but this composer never reads it — the field is declared,
  // passed in by /api/v5/today, and unused. Left alone rather than quietly
  // wired up: making it appear on screen is a content change, not a fix.)
  //
  // Every other runner-facing consumer of engine prose already scrubs — the
  // coach log, adaptation reasons, workout proposals, session-moved pushes,
  // the morning brief. This one, which is the "Why this run" line on Today,
  // did not, so it printed internal citations straight at the runner. The
  // locked voice doctrine `strip-citations.ts` cites in its own header is
  // unambiguous: "rooted in research is for the engine, not the runner".
  //
  // Scrubbed at the three sources rather than on the joined output, so a
  // citation can never survive by sitting across a join seam.
  const dayNote = f.dayNote ? stripResearchCitations(f.dayNote) : null;
  const fallback = f.fallback ? stripResearchCitations(f.fallback) : null;

  // The selector's own name for the session outranks the free-text note, and
  // says the same words with better provenance — see `thesisSessionName`.
  let body = deInterpunct(
    f.thesisSessionName?.trim() || dayNote?.trim() || fallback?.trim() || '',
  );

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
    // RUNNERLANG-1 (2026-09-02) · the note no longer opens "Conversational",
    // so the two rules that gave THAT fragment a verb are re-pointed at the
    // fragment that replaced it. Kept rather than deleted: the job here is
    // "an opening fragment reads as a note to self", and the new opener is
    // one too.
    .replace(/^easy enough to talk\b/i, 'Keep it easy enough to talk')
    .replace(/^easy the whole way\b/i, 'Keep it easy the whole way')
    .replace(/^easy means easy\b/i, 'Easy means easy')
    .replace(/^\s*,\s*/, '')
    .trim();

  if (!lead) return { verdict: body ? sentence(body) : '' };
  if (!body) return { verdict: sentence(lead) };
  return { verdict: sentence(lead), reason: sentence(body) };
}
