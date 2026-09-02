/**
 * lib/faff/explanation.ts · the typed coaching explanation contract.
 *
 * `docs/0901/coaching-voice-and-explanations-review-brief-2026-09-02.md` §3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND THE ONE THING IT MUST NEVER BECOME
 *
 * An explanation CONSUMES a canonical decision. It never calculates capacity,
 * readiness, prescription, grading, feasibility or adaptation. Every field
 * below is a rendering of something another owner already decided, and the
 * `BRAIN_CONSTITUTION.md` ownership table says who that is for each one.
 *
 * If this file ever computes a number, it has become a second coaching brain
 * and the answer is to delete the computation, not to caveat it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY IT SHIPS WITH ONE CONSUMER AND NOT TWELVE
 *
 * The brief's own §1 gap 1 reads: "Coaching Thesis has no live consumer.
 * `resolveCoachingThesis` exists only in its own module/tests." That was
 * true for weeks. A typed contract with no caller is the same failure with
 * better types, and this codebase has a name for it — CLAUDE.md Rule 21:
 * "Wired, tested and inert is this codebase's signature failure."
 *
 * So this ships attached to the ONE sentence a runner actually reads today:
 * `V5Today.why`, the "About" block on Today
 * (`native-v2/Faff/Faff/ViewsV5/TodayBeforeV5.swift:549`). `explainToday`
 * below produces the explanation, `layerOne` renders the string the existing
 * wire field already carries, and `lib/faff/why-voice.ts#composeWhy` remains
 * the register. No new wire field, therefore no app release — which is the
 * distinction that cost two earlier reports their conclusion: a STRING into
 * a field the app already renders needs no release, a new STRUCTURED field
 * does. `Thesis`, `reviewTrigger` and `limiter` took an app release to
 * decode; this deliberately takes none.
 *
 * Migrating Run Detail, Watch, notifications and the race outlook onto it is
 * the next increment and is NOT done. Stated plainly rather than implied:
 * see the handback's blocking/non-blocking split.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VERSIONING
 *
 * `modelVersion` identifies THIS contract's shape and the composition rules
 * in this file. `decisionVersion` identifies the canonical decision being
 * explained, and is supplied by the caller from whatever owns that decision
 * — for Today that is the coaching thesis's own review trigger and the plan
 * row's identity. Two surfaces rendering the same decision must carry the
 * same pair, which is what makes the brief's cross-surface matrix checkable
 * rather than assertable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE CANNOT FAIL ON (Rule 22)
 *
 *   · IT CANNOT TELL YOU THE VERDICT IS RIGHT. It renders whatever decision
 *     it is handed. A wrong prescription explained perfectly still ships.
 *   · IT HAS ONE LIVE CONSUMER. Every other surface still authors its own
 *     prose, so a contradiction between Today and Run Detail is invisible
 *     here.
 *   · `certainty` IS SUPPLIED, NOT DERIVED. If a caller passes ESTABLISHED
 *     over one sparse session, nothing in this file objects. The owning
 *     resolver is responsible for that word.
 */

import { scanLayerOne, scanPunctuation, type LexiconFinding } from './coach-lexicon';

/** The contract's own shape version. Bump on any field or rule change. */
export const EXPLANATION_MODEL_VERSION = 'expl-1';

export type ExplanationFactKind = 'OBSERVED' | 'MODELLED' | 'STATED' | 'DECISION';

/**
 * How much the coach is entitled to sound like it knows.
 *
 * The brief's §7 test: "uncertainty tone matches certainty enum". The
 * mapping is not decorative — `certaintyHedge` below is the only place a
 * hedge is allowed to come from, so a TENTATIVE decision cannot be rendered
 * in a confident sentence by a surface that felt like it.
 */
export type Certainty = 'ESTABLISHED' | 'SUPPORTED' | 'TENTATIVE' | 'UNKNOWN';

export type MessageIntent =
  | 'PRESCRIBE' | 'INTERPRET' | 'EXPLAIN_CHANGE' | 'EXPLAIN_HOLD'
  | 'REQUEST_DECISION' | 'REFUSE' | 'WARN' | 'ACKNOWLEDGE';

export type SurfaceEvent =
  | 'TODAY_BEFORE' | 'TODAY_AFTER' | 'PLAN_REVIEW' | 'WORKOUT_DETAIL'
  | 'RACE_OUTLOOK' | 'NOTIFICATION' | 'WATCH_LOBBY' | 'WATCH_LIVE'
  | 'MISSED_RUN' | 'MODIFIED_RUN' | 'ILLNESS' | 'INJURY';

export interface ExplanationFact {
  kind: ExplanationFactKind;
  /** Stable machine code. Never rendered. */
  code: string;
  /** What the runner would read if this fact is surfaced. */
  display: string;
  evidenceIds?: string[];
}

export interface CoachingExplanation {
  id: string;
  modelVersion: string;
  decisionVersion: string;
  surfaceEvent: SurfaceEvent;
  intent: MessageIntent;
  /** Clause 1 · the plain answer. Required; there is no explanation without one. */
  verdict: string;
  /** Clause 2 · the most decision-relevant evidence. */
  reason?: string;
  /** Clause 3 · what changes or stays the same. */
  consequence?: string;
  /** Clause 4 · only when the runner must actually do something. */
  action?: { label: string; semanticAction: string };
  certainty: Certainty;
  facts: ExplanationFact[];
  /** Holds, refusals, exclusions and uncertainty, without leaking resolvers. */
  whyNot?: Array<{ code: string; display: string }>;
  /**
   * OPTIONAL, and that is a Rule 11 decision rather than a convenience.
   *
   * The brief's shape has this required. It cannot be, because a surface with
   * no spoken channel would then have to INVENT a cue — and the first
   * consumer is exactly that case: Today's "About" block is read on a screen,
   * never spoken, and its sentence is routinely longer than a wrist cue may
   * be. The available answers were fabricate one, truncate one (which changes
   * the meaning silently), or say there is not one. Absent is the honest
   * answer and it is distinguishable from empty.
   */
  spoken?: { short: string; transition?: string; urgent?: string };
  accessibilitySummary: string;
  detail: { headline: string; paragraphs: string[]; evidenceLabels: string[] };
}

/**
 * A REFUSAL IS NOT A FAILURE, and this is the type that keeps them apart.
 *
 * Rule 11. A composer that cannot honestly say anything returns `null`, and
 * the surface stays silent — the brief's own §7 line, "a null explanation
 * remains silent". A composer that WAS able to decide something but the
 * decision is "not enough evidence" returns an explanation with
 * `intent: 'REFUSE'` and `certainty: 'UNKNOWN'`, which is a sentence worth
 * printing. Those are different facts and this contract can express both.
 */
export type MaybeExplanation = CoachingExplanation | null;

// ─────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────

/**
 * The hedge that belongs to each certainty, and the ONLY source of one.
 *
 * ESTABLISHED gets no hedge on purpose: "decisive when the evidence is
 * decisive" is in the brief's voice character, and a coach that hedges
 * everything has told the runner nothing.
 */
export function certaintyHedge(c: Certainty): string | null {
  switch (c) {
    case 'ESTABLISHED': return null;
    case 'SUPPORTED': return null;
    case 'TENTATIVE': return 'This is one session, so treat it as a lead rather than a conclusion.';
    case 'UNKNOWN': return 'There is not enough evidence to say yet.';
  }
}

/**
 * Layer 1 — the short answer, at most three clauses.
 *
 * Verdict, then reason, then consequence. Action is NOT rendered into prose:
 * the brief is explicit that a decision card appears "only if runner action
 * is truly required", and a button is a control, not a sentence.
 *
 * Two sentences is the working ceiling `why-voice.ts` already set for this
 * screen ("a text is short or it is an email"), and this respects it: the
 * consequence is dropped rather than a third sentence printed, unless the
 * reason is absent.
 */
export function layerOne(e: CoachingExplanation): string {
  const parts = [e.verdict, e.reason, e.consequence]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return parts.slice(0, 2).join(' ');
}

/** Layer 2 — the "Why?" affordance. Reason, facts, what was excluded. */
export function layerTwo(e: CoachingExplanation): string[] {
  const out: string[] = [];
  if (e.reason) out.push(e.reason);
  if (e.consequence) out.push(e.consequence);
  for (const f of e.facts) out.push(f.display);
  for (const n of e.whyNot ?? []) out.push(n.display);
  const hedge = certaintyHedge(e.certainty);
  if (hedge) out.push(hedge);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Self-check
// ─────────────────────────────────────────────────────────────────────────

export interface ExplanationDefect {
  field: string;
  problem: string;
}

/**
 * Everything about an explanation that is checkable without knowing whether
 * the coaching decision underneath it is correct.
 *
 * Used by `_voice_corpus.test.ts` over fixtures and by
 * `_voice_live.audit.test.ts` over the real payload, so a defect found in a
 * fixture and a defect found in production are the same finding.
 */
export function auditExplanation(e: CoachingExplanation): ExplanationDefect[] {
  const d: ExplanationDefect[] = [];
  const say = (field: string, problem: string) => d.push({ field, problem });

  if (!e.verdict.trim()) say('verdict', 'empty; an explanation with no answer is not one');
  if (e.modelVersion !== EXPLANATION_MODEL_VERSION) {
    say('modelVersion', `is ${e.modelVersion}, expected ${EXPLANATION_MODEL_VERSION}`);
  }
  if (!e.decisionVersion.trim()) {
    say('decisionVersion', 'empty; surfaces cannot prove they render the same decision');
  }

  // Prohibited language and punctuation, over every runner-readable field.
  const layer1Fields: Array<[string, string | undefined]> = [
    ['verdict', e.verdict],
    ['reason', e.reason],
    ['consequence', e.consequence],
    ['spoken.short', e.spoken?.short],
    ['spoken.transition', e.spoken?.transition],
    ['spoken.urgent', e.spoken?.urgent],
    ['accessibilitySummary', e.accessibilitySummary],
    ['action.label', e.action?.label],
  ];
  for (const [field, text] of layer1Fields) {
    for (const f of scanLayerOne(text) as LexiconFinding[]) {
      say(field, `${f.band}: "${f.term}" · ${f.why}`);
    }
    for (const p of scanPunctuation(text)) say(field, p);
  }
  // Layer 2 may name a mechanism; it may not shout or scold.
  for (const p of e.detail.paragraphs) {
    for (const f of scanCopyLayerTwo(p)) say('detail.paragraphs', `${f.band}: "${f.term}"`);
    for (const x of scanPunctuation(p)) say('detail.paragraphs', x);
  }

  // ── the certainty/tone contract ────────────────────────────────────────
  // UNKNOWN is the refusal shape. A refusal that reads as a conclusion is
  // the exact defect Rule 11 names, so the intent has to agree with it.
  if (e.certainty === 'UNKNOWN' && e.intent !== 'REFUSE' && e.intent !== 'WARN') {
    say('certainty', 'UNKNOWN but the intent is not REFUSE or WARN; a hedge cannot rescue a confident verdict');
  }
  if (e.intent === 'REFUSE' && e.action) {
    say('action', 'a refusal is an answer, not a retry; it must not carry an action');
  }

  // ── Rule 16 · one quantity, one name ───────────────────────────────────
  // Every MODELLED fact must be marked as modelled where the runner reads
  // it. The `~` glyph is the phone's mark; speech says the word.
  for (const f of e.facts) {
    if (f.kind !== 'MODELLED') continue;
    if (!/~/.test(f.display) && !/\b(estimate|estimated|modelled|likely range)\b/i.test(f.display)) {
      say('facts', `MODELLED fact ${f.code} renders as "${f.display}" with no modelled mark`);
    }
  }

  // ── Rule 17 · the runner reads a sentence once ─────────────────────────
  const seen = new Set<string>();
  for (const [field, text] of layer1Fields) {
    const norm = (text ?? '').trim().toLowerCase().replace(/[.\s]+$/, '');
    if (!norm) continue;
    if (field === 'spoken.short' || field === 'accessibilitySummary') continue; // shorter by design
    if (seen.has(norm)) say(field, 'repeats a sentence another field already says');
    seen.add(norm);
  }

  // Spoken guidance is short by contract; the wrist is not a paragraph. An
  // ABSENT spoken block is fine (see the field's own comment); a present one
  // that is really a paragraph is not.
  if (e.spoken && e.spoken.short.length > 90) {
    say('spoken.short', `${e.spoken.short.length} characters; spoken cues stay under 90`);
  }

  return d;
}

/** Layer 2 tolerates jargon; it does not tolerate hype, scolding or macho. */
function scanCopyLayerTwo(text: string): LexiconFinding[] {
  return scanLayerOne(text).filter((f) => f.band !== 'jargon');
}
