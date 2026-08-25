/**
 * lib/faff/recap-voice.ts — the run, said once.
 *
 * David, 2026-08-25, reading the recap on his own easy four miles:
 * "none of this is really natural sounding and sort of just says the same
 * shit over and over."
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT HE WAS LOOKING AT
 *
 *   Steady the whole way
 *   Easy done.
 *   Easy 4 mi at 8:34/mi. Run by feel · the right way to take an easy day.
 *   88°F · hot for running. Warm enough to cost a little pace. Heat does
 *   that · your fitness is fine.
 *   Forget the pace in this · run by effort and cut it short if your HR
 *   won't settle. Move the run earlier next time.
 *
 * Five strings, five composers, none able to see the others. What they say:
 *
 *   · "Steady the whole way", "Easy done." and "the right way to take an
 *     easy day" are one judgement, three times.
 *   · "hot for running", "warm enough to cost a little pace" and "heat does
 *     that" are one condition, three times.
 *   · "Run by feel" in the facts and "run by effort" in the tip are the same
 *     instruction — and the tip is advice about a run already finished.
 *
 * This module invents nothing. It decides which authored part still has
 * something to add once the parts before it have been said.
 *
 * THE RULES, the same six `why-voice.ts` follows, because they are rules
 * about writing rather than about one section:
 *
 *   1. No interpuncts. Ever. Comma, semicolon, or a rewrite.
 *   2. Two sentences at most in any one part.
 *   3. Second person where it is natural.
 *   4. Connect the second clause to the first, or drop it.
 *   5. Never say the same thing twice in different words.
 *   6. Coach voice: no hype, no exclamation marks, no emoji, no em dashes,
 *      and never scold.
 *
 * WHAT IT WILL NOT DO
 *
 * It never rewrites a NUMBER and never merges two facts into a claim neither
 * made. Dropping a sentence that repeats one already on screen is safe;
 * restating "8:34/mi" in its own words is how a recap starts lying. Every
 * string it emits is one the engine already wrote, or is dropped whole.
 */

import { deInterpunct } from './why-voice';

export interface RecapParts {
  /** `deriveWin` — the single best thing about the session, or null. */
  win: string | null;
  /** `deriveRecap`'s verdict — one clause on how it went. */
  verdict: string | null;
  /** Its facts, in the order it wrote them. */
  facts: string[];
  /** Its conditions note. Null on a neutral day. */
  conditionsNote: string | null;
  /** The only part that is about NEXT time. */
  coachTip: string | null;
}

export interface RecapVoice {
  headline: string | null;
  body: string[];
}

/** A sentence about a run not yet run. */
const FORWARD =
  /\b(next time|tomorrow|next run|from here|going forward|next week|rest of the week|in future)\b/i;

/** Words carrying no information about which sentence a clause is. */
const NOISE = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'is', 'it', 'that', 'this',
  'was', 'were', 'be', 'for', 'on', 'at', 'your', 'you', 'with', 'as',
  'so', 'but', 'or', 'its', 'run', 'today',
]);

function contentWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w && w.length > 2 && !NOISE.has(w)) out.add(w);
  }
  return out;
}

/**
 * True when a clause mostly restates something already said.
 *
 * Deliberately generous — a dropped sentence that had a little new in it
 * costs a shorter recap; a kept one that had nothing is what he read. A
 * sentence carrying a NUMBER is never dropped here, because a number is the
 * one thing that cannot be a restatement.
 */
function restates(candidate: string, said: Set<string>): boolean {
  if (/\d/.test(candidate)) return false;
  const words = contentWords(candidate);
  if (words.size === 0) return true;
  let overlap = 0;
  for (const w of words) if (said.has(w)) overlap++;
  return overlap / words.size >= 0.6;
}

function sentences(s: string): string[] {
  return s.split(/(?<=[.?])\s+/).map((x) => x.trim()).filter(Boolean);
}

export function composeRecap(p: RecapParts): RecapVoice {
  const said = new Set<string>();
  const remember = (t: string) => { for (const w of contentWords(t)) said.add(w); };

  const headline = p.win ? deInterpunct(p.win) : null;
  if (headline) remember(headline);

  const body: string[] = [];

  // 1 · A WIN IS A VERDICT, BETTER WRITTEN. When both exist the verdict is
  //     the same judgement in flatter words. The lexical test cannot see it —
  //     "Steady the whole way" and "Easy done." share no words — so this is a
  //     rule about what the two PARTS are.
  if (!headline && p.verdict) {
    const v = deInterpunct(p.verdict);
    body.push(v); remember(v);
  }

  // 2 · A FACT'S FIRST SENTENCE CARRIES IT. What follows is usually the
  //     engine defending the fact rather than stating one. A later sentence
  //     survives only when it carries a number of its own.
  for (const f of p.facts) {
    const kept: string[] = [];
    sentences(deInterpunct(f)).forEach((sentence, i) => {
      if (kept.length >= 2) return;
      if (i > 0 && !/\d/.test(sentence)) return;
      if (restates(sentence, said)) return;
      kept.push(sentence); remember(sentence);
    });
    if (kept.length) body.push(kept.join(' '));
  }

  // 3 · CONDITIONS SAY THE CONDITION, ONCE. Three sentences about heat, the
  //     second and third reassurance he did not ask for.
  if (p.conditionsNote) {
    const first = sentences(deInterpunct(p.conditionsNote))[0];
    if (first && !restates(first, said)) { body.push(first); remember(first); }
  }

  // 4 · THE TIP IS THE ONLY PART ABOUT NEXT TIME, so it may only say things
  //     still actionable. "Run by effort and cut it short" is an instruction
  //     for a run already finished. Where nothing in a tip looks forward, the
  //     whole thing is advice about the past and is dropped.
  if (p.coachTip) {
    const forward = sentences(deInterpunct(p.coachTip))
      .filter((x) => FORWARD.test(x))
      .filter((x) => !restates(x, said));
    if (forward.length) { const t = forward.slice(0, 2).join(' '); body.push(t); remember(t); }
  }

  return { headline, body };
}
