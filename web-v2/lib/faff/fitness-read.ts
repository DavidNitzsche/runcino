/**
 * lib/faff/fitness-read.ts — the coach's read of what the runner can race,
 * as one row under "Where you are" on Today.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * `lib/fitness/fitness-model.ts` answers "what can this athlete race today?"
 * as a RANGE with a confidence tier, and it has been correct, tested and
 * unreachable since it was written. Its only importer is `/api/coach/read`,
 * and nothing calls that. This file is the reading side.
 *
 * David ruled the placement: under "Where you are", beside readiness and week
 * mileage. That section already answers "where am I", and it is the only
 * group on Today whose rows are about the RUNNER rather than about today's
 * session. So this is a row in an existing group, not a new section — which
 * is also why there is no empty-header case to defend here. `TodayBeforeV5`
 * already guards the whole group behind `!model.whereYouAre.isEmpty`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE ONE · A MODELLED NUMBER MUST NEVER LOOK MEASURED
 *
 * Nothing measured this. A range at the half is Daniels' table walked from a
 * VDOT that was itself inverted out of one finish time, and the band around it
 * is measurement error priced out of Research/02 §13.7. Every value this file
 * emits therefore ships `modelled: true`, which is what makes VoiceOver say
 * "estimated" before the figure now that the amber tilde is retired.
 *
 * The mark is gone, so the WORDS carry the provenance:
 *
 *   · The label says what the number is. "Half fitness", not "Half".
 *   · The value is always a RANGE. There is no reading of "1:39:00 – 1:44:30"
 *     on which that is a result. A single time would be exactly the `1:38:17`
 *     the doctrine forbids.
 *   · The sub names the evidence it came off and how far that evidence goes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE THREE · A REFUSAL IS A CORRECT ANSWER
 *
 * `low` does not render as a number with a hedge attached. It renders as a
 * refusal: the row keeps its label, states in one line why there is no read,
 * and carries NO value at all. `V5Row.value = null` draws nothing — it is not
 * `FaffValue.unreadable`, which is the fault-red dash and means "we tried to
 * read something that should be there". Nothing is broken when a runner has
 * not raced recently; there is simply nothing to say, and saying so is the
 * answer.
 *
 * Same for no estimate at all. The difference between the two is only which
 * sentence explains it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE TWO IS NOT THIS ROW'S TO BREAK
 *
 * A recommendation must name the convergence of three independent domains.
 * This row makes no recommendation and prescribes nothing — it reports one
 * measurement and how well it is known. It must therefore never grow an
 * instruction, and `lib/coach/recommendation.ts` output deliberately does not
 * appear here: on live data its PROGRESS arm renders `verdict.summary` and its
 * STAY / MODIFY / PROTECT arms render a SINGLE weakest dimension, so its copy
 * cannot honestly claim convergence. See the report that landed with this
 * file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE FOUR · COACH VOICE
 *
 * David, 2026-08-21: "I want this section to always feel like a quick text
 * from a coach." That was said about "Why this run" and `lib/faff/why-voice.ts`
 * holds the rules, but he said "not just this, but for anything ever in this
 * section", and the same standard is applied here:
 *
 *   1. No interpuncts. Ever.
 *   2. Two sentences at most.
 *   3. Second person where it is natural.
 *   4. Connect the second clause to the first, or drop it.
 *   5. Never say the same thing twice in different words.
 *   6. No hype, no exclamation marks, no emoji, no em dashes, never scold.
 */

import type { FitnessEstimate, RaceKey } from '@/lib/fitness/fitness-model';
import type { V5Row } from '@/lib/faff/v5-today';

/** Canonical distances, in the same order the model keys them. Matches
 *  `RACE_DISTANCES` in fitness-model.ts. */
const KEY_DISTANCE_MI: Record<RaceKey, number> = {
  '5k': 3.10686,
  '10k': 6.21371,
  hm: 13.1094,
  m: 26.2188,
};

/** What the runner calls each one. */
const KEY_LABEL: Record<RaceKey, string> = {
  '5k': '5K fitness',
  '10k': '10K fitness',
  hm: 'Half fitness',
  m: 'Marathon fitness',
};

/**
 * Report the range at the ANCHOR's own distance, not at the goal's.
 *
 * The band is sized on how precisely the measurement we actually hold pins
 * fitness, and fitness-model.ts keys that width on the anchor's distance for
 * exactly that reason (see its `basePctForAnchorDistance` note). Rendering a
 * marathon range off a half anchor would carry a half-sized error bar onto a
 * distance whose own prediction error is larger, and quietly overstate how
 * well a marathon time is known. The goal distance already has its own
 * surface, which prices its own interval.
 */
function nearestKey(anchorDistanceMi: number | null): RaceKey {
  if (anchorDistanceMi == null || !Number.isFinite(anchorDistanceMi)) return 'hm';
  let best: RaceKey = 'hm';
  let bestGap = Infinity;
  for (const k of Object.keys(KEY_DISTANCE_MI) as RaceKey[]) {
    const gap = Math.abs(KEY_DISTANCE_MI[k] - anchorDistanceMi);
    if (gap < bestGap) { bestGap = gap; best = k; }
  }
  return best;
}

/** `1:41:53`, hours always. A range edge is a race time. */
function clock(sec: number): string {
  const t = Math.round(sec);
  return `${Math.floor(t / 3600)}:` +
    String(Math.floor((t % 3600) / 60)).padStart(2, '0') + ':' +
    String(t % 60).padStart(2, '0');
}

/**
 * "eight days", "three weeks". Words, not digits, because a text does not
 * write "8" for a small count. Mirrors `spellSpan` in why-voice.ts, which is
 * module-private there; the duplication is two lines and the alternative is
 * an export that exists only for this.
 */
function spellSpan(days: number): string {
  const w = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
    'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen'];
  if (days <= 13) return `${w[days] ?? days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  return `${w[weeks] ?? weeks} week${weeks === 1 ? '' : 's'}`;
}

/** What the anchor was, in the runner's words. `considered[0]` is the anchor
 *  by construction and its `source` is `race:<slug>` or `run:<id>`. */
interface Anchor {
  isRace: boolean;
  ageDays: number;
}

function anchorOf(e: FitnessEstimate): Anchor | null {
  const first = e.considered[0];
  if (!first) return null;
  return { isRace: first.source.startsWith('race:'), ageDays: first.ageDays };
}

/**
 * The race name, lifted out of the model's own basis line rather than
 * re-derived. `buildBasis` opens every line with "Anchored on <label>, N days
 * ago." and that label is already the runner-facing name of the race. Reading
 * it back beats threading the candidate through, and it cannot drift from what
 * the model thinks the anchor is.
 */
function anchorNameFromBasis(basis: string): string | null {
  const m = /^Anchored on (.+?), \d+ days? ago\./.exec(basis);
  const name = m?.[1]?.trim();
  if (!name) return null;
  // The model falls back to these when a race has no name or a run has no
  // type. They read as prose mid-sentence, not as something to name.
  if (/^(a recent race|a training run|an? .* run)$/i.test(name)) return null;
  return name;
}

export const FITNESS_ROW_ID = 'fitness';

/**
 * One row, or null when the row should not be drawn at all.
 *
 * Null is reserved for "this runner has no fitness story yet" — a brand new
 * account with nothing logged. That is different from a refusal: a refusal
 * says we looked and there is nothing current, which is worth a line to
 * someone who HAS been training. Someone who has never run anything does not
 * need to be told their fitness is unknown.
 */
export function buildFitnessRow(
  estimate: FitnessEstimate | null,
  opts: { hasAnyTraining: boolean },
): V5Row | null {
  if (!estimate) {
    if (!opts.hasAnyTraining) return null;
    return {
      id: FITNESS_ROW_ID,
      label: 'Race fitness',
      sub: 'Nothing recent enough to say what you could race. A race or a time trial puts a number here.',
      value: null,
      action: null,
    };
  }

  const anchor = anchorOf(estimate);
  const key = nearestKey(estimate.anchorDistanceMi);

  if (estimate.confidence === 'low') {
    return {
      id: FITNESS_ROW_ID,
      label: 'Race fitness',
      sub: refusalLine(estimate, anchor),
      value: null,
      action: null,
    };
  }

  const { loSec, hiSec } = estimate.races[key];
  return {
    id: FITNESS_ROW_ID,
    label: KEY_LABEL[key],
    // RULE ONE. Modelled, always. Nothing measured a range, and the band is
    // Research/02 §13.7 measurement error walked through Daniels' table.
    value: { text: `${clock(loSec)} – ${clock(hiSec)}`, modelled: true },
    sub: readLine(estimate, anchor),
    action: null,
  };
}

/** The sub for a real read. Two sentences at most, second person, connected. */
function readLine(e: FitnessEstimate, anchor: Anchor | null): string {
  const name = anchorNameFromBasis(e.basis);
  const span = anchor ? spellSpan(anchor.ageDays) : null;

  const where = anchor?.isRace
    ? (name && span ? `That comes off ${name} ${span} ago`
      : span ? `That comes off your last race ${span} ago`
        : 'That comes off your last race')
    : (span ? `That comes off a training run ${span} ago` : 'That comes off your recent training');

  if (e.confidence === 'high') {
    // Certainty is the unmarked case. Name what agrees, not how sure we are
    // — announcing confidence every time is how a coach starts sounding
    // defensive.
    return `${where}, and your other recent results agree.`;
  }

  // Medium. One clause of evidence, one of what the evidence does not cover.
  // The range itself is already doing the hedging, so the words do not repeat
  // it.
  return anchor?.isRace
    ? `${where}, and you have not raced since.`
    : `${where}, so it is a lead rather than a result. A race would settle it.`;
}

/** RULE THREE. The sub for a refusal. Says what is missing, never apologises. */
function refusalLine(e: FitnessEstimate, anchor: Anchor | null): string {
  const span = anchor ? spellSpan(anchor.ageDays) : null;

  if (/disagree/i.test(e.basis)) {
    return 'Your recent results disagree too much to put a number on it. The next race settles it.';
  }
  if (anchor && !anchor.isRace) {
    return 'Only training to go on, which shows what you can hold, not what you can race. A race or a time trial puts a number here.';
  }
  return span
    ? `Your last race is ${span} back now, too old to say what you would run today. A tune-up would refresh it.`
    : 'Nothing current enough to say what you could race today. A tune-up would refresh it.';
}
