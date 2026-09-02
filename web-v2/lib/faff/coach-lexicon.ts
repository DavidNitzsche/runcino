/**
 * lib/faff/coach-lexicon.ts · THE runner-facing language list. One list.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS: THERE WERE FOUR LISTS AND THEY DISAGREED
 *
 * Audited 2026-09-02, before this file was written. The words a coach may not
 * say were written down in four places, none of which knew about the others:
 *
 *   1 · `scripts/check-coach-voice.sh` guards 4-5 — 35 hype terms, 13
 *       scolding terms, 12 app-voice terms, inline in an awk program. The
 *       ONLY one of the four that blocks a build.
 *   2 · `scripts/voice-eval/run.mjs` — `BANNED_PHRASES`, 10 jargon terms,
 *       disjoint from (1). Not wired into any npm script that runs.
 *   3 · `web-v2/scripts/voice-eval/scenarios.json` — per-scenario
 *       `must_avoid` arrays. Its own README calls it "smoke-grade, not a
 *       regression-blocker"; nothing invokes it.
 *   4 · Per-test private copies — `lib/plan/_training_lead.test.ts` has a
 *       12-word hype list, `lib/faff/goal-status.test.ts` an 8-label list,
 *       `lib/faff/glance-adapter.test.ts` a 4-word one. Each retyped.
 *
 * None of the four contained "bail", "cook the back half", "don't get fancy",
 * "bury yourself" or "junk mile" — all of which were live in shipped copy on
 * the morning this was written. Rule 16 is the diagnosis: one quantity, one
 * name. A prohibited-word list is a quantity.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FORMAT CONTRACT — DO NOT BREAK IT
 *
 * `scripts/check-coach-voice.sh` PARSES THIS FILE at build time and builds
 * its awk word lists out of what it finds. It is a shell script on a cold
 * container with no TypeScript toolchain, so it reads the source text. That
 * is deliberate, and it is Rule 18's rule: a check that hardcodes both sides
 * only proves the test agrees with itself. The gate reads the list from here;
 * this file is the single side.
 *
 * So every entry MUST be one line, in exactly this shape:
 *
 *     { band: 'hype', term: "nailed it", why: "..." },
 *
 *   · `band:` in SINGLE quotes, one of the BAND values below.
 *   · `term:` in DOUBLE quotes, lower-case, no interpolation, no regex.
 *     Double quotes because several terms contain an apostrophe.
 *   · `why:` free text. Read by humans; the gate ignores it.
 *
 * `_coach_lexicon.test.ts` asserts the shell parser and this module agree
 * term-for-term, so a format slip fails loudly rather than silently shrinking
 * the gate to nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BANDS, AND WHERE EACH IS ENFORCED
 *
 *   hype       · praise that is about the app being pleased, not the runner
 *                being informed. Blocked EVERYWHERE a runner can read.
 *   scolding   · copy that grades obedience. Blocked everywhere.
 *   macho      · the register the brief calls punitive: "bail", "cook the
 *                back half", "don't get fancy", "bury yourself". Direct is
 *                good; making training sound like compliance or failure is
 *                not. Blocked everywhere.
 *   app-voice  · what software says when it has nothing to say. Blocked
 *                everywhere.
 *   jargon     · engine taxonomy. NOT blocked everywhere, and that is the
 *                point — see the next block. Blocked in LAYER 1 only.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY `jargon` IS SPLIT IN TWO, AND WHY THAT IS NOT A LOOPHOLE
 *
 * `docs/PRODUCT_UX_SIMPLIFICATION_DOCTRINE.md` names three layers and one
 * mistake: "Layer 3 — Engine … must never leak directly into Layer 1."
 * Layer 2 is the "Why?" affordance, and naming a mechanism there is the
 * whole point of Layer 2 existing.
 *
 * So a jargon term is a defect in a Layer-1 sentence and legitimate in a
 * Layer-2 one. A file-wide string scan cannot tell those apart — it does not
 * know which field a literal ends up in. Two enforcement paths, therefore:
 *
 *   · `jargonAlways` (VDOT, ACWR, TSB, CTL/ATL, source_mode, z-score) are
 *     proprietary tokens with no runner meaning at ANY layer. The shell gate
 *     blocks them in every literal it scans.
 *   · The rest ("limiter", "readiness score", "evidence count", "confidence
 *     interval") are blocked in Layer 1 by `scanLayerOne`, which runs over
 *     `CoachingExplanation`'s Layer-1 fields and over the real composed
 *     `why` in `_voice_live.audit.test.ts`.
 *
 * That second path is also the only one that can see the defect this file
 * was written for. `check-coach-voice.sh`'s own header states what it cannot
 * fail on: "a sentence assembled at run time from fragments that are
 * individually clean". Today's live "why" is exactly that — on 2026-09-02 it
 * read
 *
 *     "Durability is the limiter right now, and this is the session that
 *      moves it. Keep it conversational throughout."
 *
 * and not one literal anywhere in the repo contains that sentence. The shell
 * gate was green over it every day it shipped.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE CANNOT FAIL ON (Rule 22)
 *
 *   · IT CANNOT GRADE TONE. Every band is a fixed phrase list. A scold, a
 *     pat on the back or a lecture written in words nobody listed reads as
 *     clean. This narrows the failure mode; it does not close it, and a
 *     reviewer's eye is still the only thing that can.
 *   · IT HAS NO OPINION ABOUT TRUTH. A sentence can pass every band and be
 *     wrong. Rule 16's "a sentence asserting a fact about a measurement is
 *     gated on that measurement" is a different check and lives with the
 *     composer that makes the claim.
 *   · IT CANNOT SEE COPY IT IS NOT POINTED AT. `scanLayerOne` runs where a
 *     caller calls it. Nothing here discovers new surfaces.
 *   · EVERY MATCH IS A PLAIN SUBSTRING, so a term short enough to sit inside
 *     an ordinary word would fire on that word. `ctl` and `atl` were dropped
 *     from the jargon band for exactly that reason before this shipped —
 *     "greatly" contains "atl". Keep terms long enough to be unambiguous.
 *   · THIS FILE IS EXCLUDED FROM THE SHELL GATE'S OWN SCAN, because it is a
 *     list of the forbidden words and would otherwise report itself. That
 *     exclusion is named in `check-coach-voice.sh`; the cost is that real
 *     runner copy could hide here, and nothing would catch it. There is no
 *     runner copy in this file and there must never be.
 *   · THE `jargon` SPLIT IS A JUDGEMENT, NOT A MEASUREMENT. A term in the
 *     Layer-1-only half can sit in a Layer-1 field of a surface that never
 *     calls `scanLayerOne`, and nothing will say so.
 */

export type LexiconBand = 'hype' | 'scolding' | 'macho' | 'app-voice' | 'jargon';

export interface LexiconEntry {
  band: LexiconBand;
  /** Lower-case, matched as a plain substring against lower-cased copy. */
  term: string;
  why: string;
  /**
   * `jargon` only. True when the term is a proprietary token with no runner
   * meaning at any layer, so the file-wide shell gate blocks it too. Absent
   * (falsey) means Layer 1 only — legitimate under a "Why?" affordance.
   */
  always?: true;
}

/* eslint-disable max-len */
export const COACH_LEXICON: LexiconEntry[] = [
  // ── hype ────────────────────────────────────────────────────────────────
  // Carried over verbatim from check-coach-voice.sh guards 4, which is where
  // they were enforced before this file existed. Nothing was dropped.
  { band: 'hype', term: "amazing", why: "The coach is not pleased with the runner. It is informing them." },
  { band: 'hype', term: "awesome", why: "Same." },
  { band: 'hype', term: "incredible", why: "Same." },
  { band: 'hype', term: "epic", why: "Same." },
  { band: 'hype', term: "fantastic", why: "Same." },
  { band: 'hype', term: "superb", why: "Same." },
  { band: 'hype', term: "crushed it", why: "Hype, and it describes nothing about the session." },
  { band: 'hype', term: "crushing it", why: "Same." },
  { band: 'hype', term: "smashed it", why: "Same." },
  { band: 'hype', term: "nailed it", why: "Shipped once as a poster verb and was removed; glance-adapter.test.ts still guards it." },
  { band: 'hype', term: "great job", why: "Generic praise a chatbot produces." },
  { band: 'hype', term: "well done", why: "Same." },
  { band: 'hype', term: "congrats", why: "Same." },
  { band: 'hype', term: "congratulations", why: "Same." },
  { band: 'hype', term: "keep it up", why: "Filler. Says nothing the runner can act on." },
  { band: 'hype', term: "you got this", why: "Motivational filler." },
  { band: 'hype', term: "way to go", why: "Same." },
  { band: 'hype', term: "beast mode", why: "Same, plus the macho register." },
  { band: 'hype', term: "woohoo", why: "Same." },
  { band: 'hype', term: "hooray", why: "Same." },
  { band: 'hype', term: "so proud", why: "The coach does not have feelings about the runner to report." },
  { band: 'hype', term: "proud of you", why: "Same." },
  { band: 'hype', term: "solid work", why: "A pat on the back is a pat on the back whichever adjective carries it." },
  { band: 'hype', term: "solid effort", why: "Same." },
  { band: 'hype', term: "solid execution", why: "Same." },
  { band: 'hype', term: "good sign", why: "Same." },
  { band: 'hype', term: "strong sign", why: "Same." },
  { band: 'hype', term: "good rep", why: "Same." },
  { band: 'hype', term: "nice work", why: "Same." },
  { band: 'hype', term: "exactly right", why: "Same." },
  { band: 'hype', term: "you delivered", why: "Same." },
  { band: 'hype', term: "keep doing what", why: "Same." },
  { band: 'hype', term: "well played", why: "Same." },
  { band: 'hype', term: "exactly the setup", why: "Same." },

  // ── scolding ────────────────────────────────────────────────────────────
  { band: 'scolding', term: "you failed", why: "A missed run is stated, never judged." },
  { band: 'scolding', term: "you should have", why: "Grades a decision already made. Nothing to act on." },
  { band: 'scolding', term: "you did not bother", why: "Same, with contempt." },
  { band: 'scolding', term: "you didn't bother", why: "Same." },
  { band: 'scolding', term: "no excuses", why: "Compliance language." },
  { band: 'scolding', term: "not good enough", why: "Same." },
  { band: 'scolding', term: "disappointing", why: "Same." },
  { band: 'scolding', term: "you keep missing", why: "Same." },
  { band: 'scolding', term: "unacceptable", why: "Same." },
  { band: 'scolding', term: "be honest with yourself", why: "Same." },
  { band: 'scolding', term: "stop making excuses", why: "Same." },
  { band: 'scolding', term: "you let", why: "Same." },
  { band: 'scolding', term: "slacking", why: "Same." },

  // ── macho ───────────────────────────────────────────────────────────────
  // NEW 2026-09-02. Every one of these was live in shipped copy on the day
  // this list was written, and none of the four previous lists held any of
  // them. The file:line each was found at is in the `why`.
  { band: 'macho', term: "bail if", why: "session-cue.ts:132,166. Say stop the session or end the rep. BAIL survives only as the literal race-emergency control label." },
  { band: 'macho', term: "cook the back half", why: "session-cue.ts:158. Threat register, and it is not what happens." },
  { band: 'macho', term: "get fancy", why: "run-purpose.ts:116. Scolds a decision the runner has not made yet." },
  { band: 'macho', term: "bury yourself", why: "run-purpose.ts:145. Dramatises a normal training error." },
  { band: 'macho', term: "junk mile", why: "run-purpose.ts:216. Names easy running as waste, which contradicts Rule 12." },
  { band: 'macho', term: "hit the count", why: "session-cue.ts:173. Training is not a quota." },
  { band: 'macho', term: "harden up", why: "Compliance register." },
  { band: 'macho', term: "push through", why: "The one instruction a coach must never give blind. Conditions decide." },
  { band: 'macho', term: "no pain no gain", why: "Same." },
  { band: 'macho', term: "don't overthink", why: "run-purpose.ts:167. Dismisses the runner's own read of the session." },
  { band: 'macho', term: "went in the book", why: "acknowledge.ts:179, coach-log.ts:210, morning-brief.ts:138. Ledger voice, not coach voice." },
  { band: 'macho', term: "system is firing", why: "morning-brief.ts:91, readiness-brief.ts:785,1323. A dashboard narrating its own score." },
  // The full stop is load-bearing: "Send it to Strava" is a button that does
  // what it says, and the term has to miss it. Narrowness beats a `// ok:`.
  { band: 'macho', term: "send it.", why: "readiness-brief.ts:785. Slang standing in for an instruction, printed beside a pace band it contradicts." },
  { band: 'macho', term: "don't hold back", why: "readiness-brief.ts:785. Same, and it is the opposite of a pace band." },

  // ── app voice ───────────────────────────────────────────────────────────
  { band: 'app-voice', term: "something went wrong", why: "Software with nothing to say." },
  { band: 'app-voice', term: "please try again", why: "Same." },
  { band: 'app-voice', term: "try again in a moment", why: "Same." },
  { band: 'app-voice', term: "oops", why: "Same." },
  { band: 'app-voice', term: "malformed", why: "Names the request model at a runner." },
  { band: 'app-voice', term: "check back", why: "Tells the runner to come back and service the screen." },
  { band: 'app-voice', term: "no data available", why: "Rule 11: say which of absent, zero or failed this is." },
  { band: 'app-voice', term: "an error occurred", why: "Same." },
  { band: 'app-voice', term: "unable to load", why: "Same." },
  { band: 'app-voice', term: "failed to load", why: "Same." },
  { band: 'app-voice', term: "please reload", why: "Same." },
  { band: 'app-voice', term: "invalid input", why: "Same." },

  // ── jargon · always, at every layer ─────────────────────────────────────
  // Proprietary tokens. There is no layer at which these mean anything to a
  // runner, so the file-wide shell gate blocks them too.
  { band: 'jargon', term: "vdot", why: "A Daniels table index. The runner has a pace, not an index.", always: true },
  { band: 'jargon', term: "acwr", why: "readiness-brief.ts:1292 said 'taper drops ACWR by design' at a runner.", always: true },
  // `tsb`, `ctl` and `atl` all belong here on the merits and NONE of them is
  // here, because every match in this file is a plain substring with no word
  // boundary and a three-letter term fires inside ordinary words ("greatly"
  // contains "atl"). `_coach_lexicon.test.ts` enforces a four-character floor
  // so the next person cannot re-add them without meeting this argument.
  { band: 'jargon', term: "training stress balance", why: "Training-load model internals, spelled out.", always: true },
  { band: 'jargon', term: "source_mode", why: "An engine field name.", always: true },
  { band: 'jargon', term: "z-score", why: "Same.", always: true },
  { band: 'jargon', term: "sourcemode", why: "Same, camel-cased.", always: true },

  // ── jargon · Layer 1 only ───────────────────────────────────────────────
  // Legitimate under a "Why?" affordance, a defect in the one-line answer.
  { band: 'jargon', term: "limiter", why: "The live Today why opened 'Durability is the limiter right now' on 2026-09-02. Layer-3 taxonomy in the Layer-1 sentence." },
  { band: 'jargon', term: "readiness score", why: "UX doctrine demotes the number unless it changes action." },
  { band: 'jargon', term: "evidence count", why: "Brief section 2: never in Layer 1." },
  { band: 'jargon', term: "confidence interval", why: "Same. Categorical certainty instead." },
  { band: 'jargon', term: "training stress", why: "Model vocabulary." },
  { band: 'jargon', term: "aerobic decoupling", why: "Same." },
  { band: 'jargon', term: "taxonomy", why: "Same." },
];
/* eslint-enable max-len */

/** Terms the file-wide shell gate blocks, by band. */
export function shellBands(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    hype: [], scolding: [], macho: [], 'app-voice': [], jargon: [],
  };
  for (const e of COACH_LEXICON) {
    if (e.band === 'jargon' && !e.always) continue; // Layer 1 only
    out[e.band].push(e.term);
  }
  return out;
}

export interface LexiconFinding {
  band: LexiconBand;
  term: string;
  why: string;
}

/**
 * Every prohibited term present in `text`, across the bands given.
 *
 * Plain lower-cased substring matching, exactly as the shell gate does it, so
 * the two agree by construction rather than by two people being careful.
 */
export function scanCopy(
  text: string | null | undefined,
  bands: readonly LexiconBand[] = ['hype', 'scolding', 'macho', 'app-voice'],
): LexiconFinding[] {
  if (!text) return [];
  const low = text.toLowerCase();
  const found: LexiconFinding[] = [];
  for (const e of COACH_LEXICON) {
    if (!bands.includes(e.band)) continue;
    if (low.includes(e.term)) found.push({ band: e.band, term: e.term, why: e.why });
  }
  return found;
}

/**
 * The Layer-1 scan: every band, including the Layer-1-only half of `jargon`.
 *
 * This is the one that can see a sentence assembled at run time, which is the
 * defect class the shell gate names as its own blind spot.
 */
export function scanLayerOne(text: string | null | undefined): LexiconFinding[] {
  return scanCopy(text, ['hype', 'scolding', 'macho', 'app-voice', 'jargon']);
}

/**
 * PUNCTUATION, which is the other half of rule four and was previously only
 * enforced by the shell gate and by a dozen private copies inside test files.
 *
 * Exclamation mark, em dash, emoji. The interpunct is NOT here: it is house
 * punctuation on a stats plate and a defect only in prose, and
 * `lib/faff/why-voice.ts` owns that distinction (`deInterpunct`).
 */
export function scanPunctuation(text: string | null | undefined): string[] {
  if (!text) return [];
  const bad: string[] = [];
  if (/[A-Za-z]!/.test(text)) bad.push('exclamation mark');
  if (/—/.test(text.trim()) && text.trim() !== '—') bad.push('em dash');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text)) bad.push('emoji');
  return bad;
}
