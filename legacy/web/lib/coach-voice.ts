/**
 * V6 · Coach voice rules + shared phrase constants
 *
 * ONE coach across all surfaces. Three voice modes, each tied to a
 * specific function, and a small set of shared phrases that lock in
 * what already works in the surfaces that get it right.
 *
 * Imported anywhere coach-voice copy is emitted. Future surfaces MUST
 * use the helpers here so drift doesn't accumulate session-by-session.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      THE THREE VOICE MODES
 * ─────────────────────────────────────────────────────────────────────
 *
 * The coach speaks in three modes. They aren't different coaches, they
 * are one coach doing different things. Humans do this too: a doctor
 * uses "you" when asking how you feel, "we" when proposing treatment,
 * and impersonal voice when reading the chart aloud.
 *
 * 1. SECOND-PERSON ("you", "your")
 *    Used when speaking TO THE RUNNER about their body, state, or felt
 *    experience.
 *
 *    Examples that already work:
 *    · PostRaceCard: "Your body is repairing micro-tears from race effort"
 *    · E1 gap:      "It's been 8 days since your last run. Everything OK?"
 *    · V5 Z2:       "Your easy runs are too hard"
 *
 *    Do NOT use second-person to report a data finding. "You ran 3
 *    threshold workouts faster" is the wrong frame, let the data
 *    speak in impersonal voice and let "you" be reserved for the
 *    runner's body/state.
 *
 * 2. IMPERSONAL OBSERVATION
 *    Used when REPORTING WHAT THE DATA SHOWS. No "you", no "we", 
 *    let the math carry the weight.
 *
 *    Examples that already work:
 *    · L7 signals: "3 threshold workouts trended faster at controlled HR"
 *    · V3:         "Two corroborating signals, fitness moving up"
 *    · C8:         "Preserves: Aerobic stimulus · Sacrifices: 3 mi of time-on-feet"
 *
 *    Quantify when possible. Numbers are durable; adjectives aren't.
 *
 * 3. "WE" / "OUR", COACH AS NARRATOR
 *    Used when THE COACH is making a recommendation, verdict, or
 *    revision. "We'd" is the marker that the coach is taking a stance.
 *
 *    Examples that already work:
 *    · Race feasibility:  "We'd revise to 'aggressive' if a race in 4 weeks pushes VDOT to 47"
 *    · L7 verdict:        "What would change our mind: a reversal in any firing signal"
 *    · Max HR validation: "We'd raise the estimate if a validated peak comes in 3+ bpm above current"
 *
 *    "We" is the verdict voice. Use it sparingly, only when the coach
 *    is actively proposing or revising. Otherwise prefer impersonal.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      THE FALSIFIER CONTRACT
 * ─────────────────────────────────────────────────────────────────────
 *
 * Per CLAUDE.md Rule 2, every adaptive verdict carries a falsifier, a
 * named observation that would change the coach's mind. Three surfaces
 * already converge on the canonical prefix:
 *
 *   "What would change our mind: {observation}."
 *
 * AdaptiveVdotBanner.tsx · CoachReadsCard.tsx · MaxHrValidationBanner.tsx
 * all use it inline. New adaptive surfaces MUST use FALSIFIER_PREFIX
 * (below) and the formatFalsifier() helper to lock the structure.
 *
 * Verb discipline inside the falsifier observation:
 *   Use ONLY `revise` (when the verdict itself would change category) or
 *   `weaken` (when evidence strength would drop without changing
 *   category). Drop the other five we found in audit: reconsider, switch,
 *   raise, drop, lift, flag. One verb per job, pick one.
 *
 * Surfacing discipline:
 *   Inline text, not tooltip. HTML title-attribute falsifiers fail Rule 2
 *   because most runners never hover. If the surface can render the
 *   verdict, it can render the falsifier underneath.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      SHARED-PHRASE DISCIPLINE
 * ─────────────────────────────────────────────────────────────────────
 *
 * The same architectural state should use the same phrase across
 * surfaces. Three states had drifted in audit; the constants below
 * replace the variants. New surfaces import them.
 *
 * NB: the "investigate" family splits into TWO distinct states, not
 * one. Conflating them flattens real diagnostic information:
 *
 *   COLLECTING_EVIDENCE, system hasn't seen enough yet to call it.
 *                          Path forward is more data. ("a second
 *                          corroborating signal would lift this to
 *                          a stronger read")
 *
 *   SIGNALS_CONFLICTED, system sees enough data but the signals
 *                          disagree. Path forward is resolution, not
 *                          more data. ("[Signal A] suggests fitness
 *                          up, [Signal B] suggests fitness flat.
 *                          Resolution pending.")
 *
 * These two states need different runner-facing language because they
 * suggest different next-steps. A surface using the wrong one tells
 * the runner the wrong thing about what they should do.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      CROSS-REFERENCE DISCIPLINE (V7)
 * ─────────────────────────────────────────────────────────────────────
 *
 * Cross-references let one surface acknowledge a related finding from
 * another surface in language, without restating it.  They're how the
 * system stops sounding like a stack of independent cards and starts
 * sounding like one coach speaking across multiple aspects of training.
 *
 * THREE RULES, read these before adding any cross-reference:
 *
 *   1. EARNED, NOT DECORATIVE.
 *      Cross-references fire when one surface's finding INFORMS another's
 *      recommendation, not when they're topically related.  Topic overlap
 *      is not enough.  The two findings must be linked by evidence the
 *      runner could verify.
 *
 *      Good: C6 yellow + V5 firing + V5's elevated easy effort plausibly
 *            explains the readiness flag → cross-ref earned.
 *      Bad:  C6 yellow + V5 silent → no cross-ref ("they're both about
 *            effort" is topic overlap, not informing).
 *
 *      Every cross-reference site needs a clear relevance check in code.
 *      If you can't write the check, you don't have a cross-reference;
 *      you have a thematic suggestion that doesn't belong.
 *
 *   2. RELATION STRENGTH IS A HIERARCHY (see formatCrossReference docs
 *      for the four relation strengths and when each fires).  Pick the
 *      weakest relation that's still accurate.  A weaker relation is
 *      always safer than an overclaimed stronger one.
 *
 *   3. ONE CROSS-REFERENCE PER SURFACE PER RENDER.
 *      A card pulling from three other surfaces ("consistent with V5,
 *      tied to the max HR work, contributing to V3") is a coach trying
 *      too hard.  If two cross-references would fire on the same render,
 *      pick the strongest relation per the hierarchy and drop the
 *      others.  Coherent > comprehensive.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      WHAT THIS MODULE IS NOT
 * ─────────────────────────────────────────────────────────────────────
 *
 * This is NOT a content templating engine. The coach's actual words, 
 * the noun for the observation, the specific number, the runner's race
 * name, those belong in the surface module. This file owns the SHAPE
 * of the sentence (prefix, verb choice, falsifier structure), not the
 * content of the observation.
 *
 * If you need to add a fourth voice mode or fourth verb, that's a real
 * change, discuss before adding. The point of this file is to STOP the
 * drift, not to grow a vocabulary.
 */

// ─────────────────────────────────────────────────────────────────────
//                         CANONICAL PREFIXES
// ─────────────────────────────────────────────────────────────────────

/** The lead-in for every falsifier surface. Used inline (not tooltip). */
export const FALSIFIER_PREFIX = 'What would change our mind:';

// ─────────────────────────────────────────────────────────────────────
//                         SHARED-STATE PHRASES
// ─────────────────────────────────────────────────────────────────────

/** When the system hasn't seen enough data yet to make a call. Path
 *  forward is more data, not resolution. Use the headline form
 *  (`Collecting evidence`) as the lead-in; compose the rest per surface.
 *  Replaces: "signals stable", "noise floor", "within ±5 s/mi". */
export const COLLECTING_EVIDENCE = 'Collecting evidence';

/** When the system has seen enough data but signals disagree.  Path
 *  forward is resolution (additional evidence to break the tie), not
 *  more of the same.  Use the headline form (`Signals are mixed`) as
 *  the lead-in; compose the per-signal detail per surface.
 *  Replaces: "signals disagree", "evidence inconclusive". */
export const SIGNALS_CONFLICTED = 'Signals are mixed';

/** When a signal would have fired but is suspended due to injury mark.
 *  Replaces: "silenced", "paused", "L7 disabled", etc. */
export const INJURY_SUSPENDED =
  'Signal suspended while injury is marked. Resumes when activity resumes.';

// ─────────────────────────────────────────────────────────────────────
//                         FALSIFIER VERB CONSTANTS
// ─────────────────────────────────────────────────────────────────────

/** Used when an observation would flip the verdict's CATEGORY (e.g.,
 *  "stretch" → "aggressive", "ahead" → "on-track"). */
export const WOULD_REVISE = "we'd revise" as const;

/** Used when an observation would lower evidence STRENGTH without
 *  changing category (e.g., a single contradicting signal in a
 *  three-signal verdict). */
export const WOULD_WEAKEN = 'would weaken this read' as const;

// ─────────────────────────────────────────────────────────────────────
//                         EVIDENCE-SOURCE NAMING
// ─────────────────────────────────────────────────────────────────────

/** Canonical names for the four signal sources. Use these in falsifier
 *  observations + diagnostic copy so the runner sees the same noun
 *  everywhere. */
export const EVIDENCE_SOURCES = {
  THRESHOLD: 'threshold workout',
  Z2: 'Z2 pace',
  INTERVAL: 'interval session',
  RACE: 'race result',
} as const;

// ─────────────────────────────────────────────────────────────────────
//                         HELPER BUILDERS
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a falsifier line in canonical form.
 *
 *   formatFalsifier(["A reversal in any firing signal in the next 2 weeks"])
 *     → "What would change our mind: a reversal in any firing signal in the next 2 weeks."
 *
 *   formatFalsifier([
 *     "A single faster threshold in the next 2 weeks",
 *     "5+ s/mi Z2 improvement"
 *   ])
 *     → "What would change our mind: a single faster threshold in the next 2 weeks OR 5+ s/mi Z2 improvement."
 *
 * Rules enforced:
 *   · Prefix is FALSIFIER_PREFIX (canonical).
 *   · First observation gets lower-cased initial letter so the prefix flows.
 *   · Multiple observations joined with " OR " (caps OR, the runner sees
 *     it as a real disjunction, not buried prose).
 *   · Trailing period if not already terminated.
 *
 * Caller writes the OBSERVATIONS in canonical voice (impersonal observation
 * or "we'd revise" verdict-frame). This helper handles the wrapping.
 */
export function formatFalsifier(observations: string[]): string {
  if (observations.length === 0) {
    throw new Error('formatFalsifier requires at least one observation.');
  }
  const cleaned = observations.map((o) => o.trim().replace(/\.$/, ''));
  const first = cleaned[0].charAt(0).toLowerCase() + cleaned[0].slice(1);
  const rest = cleaned.slice(1);
  const body = [first, ...rest].join(' OR ');
  return `${FALSIFIER_PREFIX} ${body}.`;
}

/**
 * Build a "we'd revise if..." threshold falsifier, the most common
 * verdict-flip frame across race feasibility + max HR validation.
 *
 *   formatRevisionThreshold({
 *     trigger: 'a race in the next 4 weeks',
 *     pushes:  'VDOT',
 *     to:      '+2',
 *     newCategory: 'aggressive',
 *   })
 *     → "we'd revise to 'aggressive' if a race in the next 4 weeks pushes VDOT +2."
 *
 * Returns the observation only, wrap with formatFalsifier(...) if it's
 * the whole falsifier line, or combine with other observations.
 */
export function formatRevisionThreshold(args: {
  /** What event would trigger the revision. */
  trigger: string;
  /** The field that would move (e.g., "VDOT", "max HR estimate"). */
  pushes: string;
  /** Where the field moves to (e.g., "+2 points", "47.5"). */
  to: string;
  /** The new verdict category, quoted in single quotes. */
  newCategory: string;
}): string {
  return `${WOULD_REVISE} to '${args.newCategory}' if ${args.trigger} pushes ${args.pushes} ${args.to}`;
}

/**
 * Build a "would weaken this read" reversal observation, the most
 * common evidence-strength frame across L7 + V3.
 *
 *   formatReversal('a single slow threshold workout')
 *     → "a single slow threshold workout would weaken this read"
 */
export function formatReversal(observation: string): string {
  const cleaned = observation.trim().replace(/\.$/, '');
  return `${cleaned} ${WOULD_WEAKEN}`;
}

/** Four relation strengths a cross-reference can carry.  Pick the
 *  WEAKEST that is still accurate.  See per-relation rules in the
 *  formatCrossReference docstring. */
export type CrossReferenceRelation =
  | 'see also'         // Same training aspect, no causal claim.
  | 'consistent with'  // Independent surfaces, compatible findings.
  | 'contributing to'  // Related finding plausibly causes the current.
  | 'tied to';         // Shared underlying data event.

/** Structured result of formatCrossReference, text plus navigation
 *  target.  The text is the lower-case clause to embed mid-sentence;
 *  the href is the link target for web (anchor) or iPhone (deep link).
 *  Renderers wrap the text in a link element using href. */
export interface CrossReference {
  /** Lower-case clause designed to be embedded mid-sentence. */
  text: string;
  /** Navigation target: surface path, optionally with #anchor fragment.
   *  Web: anchor link; iPhone: deep link URI.  Always present, the
   *  related surface is by definition reachable.  Renderers can ignore
   *  if the link UX isn't ready. */
  href: string;
}

/**
 * Build a cross-reference clause acknowledging a related finding from
 * another surface, V7 building block.
 *
 * The point: when one surface's finding INFORMS another's recommendation,
 * the informed surface should ACKNOWLEDGE the informant without
 * RESTATING it.  This helper builds the clause + the navigation target
 * so the runner can jump to the related surface.
 *
 * RELEVANCE CHECK REQUIRED.  Cross-references are earned, not decorative
 * (see "CROSS-REFERENCE DISCIPLINE" section at top of file).  Every
 * caller must demonstrate that the two findings inform each other.  If
 * the check is missing, the cross-reference is wrong, even if the
 * topics match.
 *
 * FREQUENCY CAP.  At most one cross-reference per surface per render.
 * If two would fire, the surface picks the strongest relation and drops
 * the rest.  Enforced by convention in caller code, the helper itself
 * builds one at a time.
 *
 * ─────────────────────────────────────────────────────────────────────
 * RELATION STRENGTH USAGE RULES (locked in V7 round)
 * ─────────────────────────────────────────────────────────────────────
 *
 * `see also`, INFORMATIONAL POINTER.  Same training aspect, no causal
 *     claim.  Use when the related finding gives the runner additional
 *     context but doesn't explain or modify the current finding.
 *     Example: V3 trajectory ON-TRACK + C9 projection chart →
 *     "see also the projection chart on /races" (both describe race
 *     trajectory; neither informs the other).
 *
 * `consistent with`, CORROBORATION (default).  Independent surfaces
 *     producing compatible findings.  No causal claim, just that they
 *     agree.  Use when both surfaces observe the same pattern from
 *     different angles.
 *     Example: V5 firing + C6 yellow + V5 plausibly contributes →
 *     "consistent with the Z2 stimulus check on /overview" (both
 *     register elevated effort; corroboration without causation).
 *
 * `contributing to`, CAUSAL, REQUIRES EVIDENCE.  Related finding
 *     plausibly causes the current.  Only fires when the caller can
 *     point to concrete evidence (timing, mechanism) supporting the
 *     causal claim.  Grammatically asymmetric: the related finding
 *     takes the subject position ("the X on Y is contributing to this").
 *     Example: Signal 4 PR fired + L7 verdict bumped → VDOT explainer
 *     shows "the [PR name] on /races is contributing to this" (the
 *     PR directly fed the bump-points calculation).
 *
 * `tied to`, STRUCTURAL LINK.  Shared underlying data event causes
 *     both findings to change together.  Use when both surfaces read
 *     from the same data source and a change there ripples through.
 *     Example: max HR validation accepted → Z2 sparkline notes
 *     "tied to the max HR validation on /profile" (zones recalibrate
 *     because of the validation; structural, not causal).
 *
 * ─────────────────────────────────────────────────────────────────────
 *
 * EXAMPLES:
 *
 *   formatCrossReference({
 *     relatedLabel: 'Z2 stimulus check',
 *     surface:      '/overview',
 *     anchor:       'z2-stimulus',
 *     relation:     'consistent with',
 *   })
 *     → { text: 'consistent with the Z2 stimulus check on /overview',
 *         href: '/overview#z2-stimulus' }
 *
 *   formatCrossReference({
 *     relatedLabel: 'Disney HM',
 *     surface:      '/races',
 *     relation:     'contributing to',
 *   })
 *     → { text: 'the Disney HM on /races is contributing to this',
 *         href: '/races' }
 *
 * Used inside C6 readiness copy:
 *   "Yellow. Watch effort if HR runs high, {text}."
 *
 * Used in VDOT explainer:
 *   "L7 verdict bumped +0.6 VDOT, {text}."
 */
export function formatCrossReference(args: {
  /** Brief noun-phrase naming the related finding.  Should be the same
   *  label the related surface uses for itself. */
  relatedLabel: string;
  /** Surface path where the related finding lives (e.g., '/overview',
   *  '/profile'). */
  surface: string;
  /** Optional fragment/anchor to scroll/deep-link to within the surface.
   *  Web: appended as #fragment.  iPhone: passed through as deep-link
   *  query parameter.  When omitted, href is just the surface path. */
  anchor?: string;
  /** How the related finding relates to the current one.  Default:
   *  'consistent with' (corroboration without causation, safest). */
  relation?: CrossReferenceRelation;
}): CrossReference {
  const relation: CrossReferenceRelation = args.relation ?? 'consistent with';
  const relatedNoun = `the ${args.relatedLabel} on ${args.surface}`;

  // Grammatical asymmetry: 'contributing to' is causal, so the related
  // finding takes the subject position.  The other three relations
  // take the related finding as object.
  const text =
    relation === 'contributing to'
      ? `${relatedNoun} is contributing to this`
      : `${relation} ${relatedNoun}`;

  const href = args.anchor ? `${args.surface}#${args.anchor}` : args.surface;

  return { text, href };
}

/**
 * Build a diagnosis line, observation + evidence pair. Used by
 * surfaces that NAME what they see and then cite the supporting
 * observation.
 *
 *   formatDiagnosis({
 *     observation: 'Your easy runs are too hard',
 *     evidence:    '<40% of easy mileage landed in Z2 across the last 4 weeks',
 *   })
 *     → "Your easy runs are too hard. <40% of easy mileage landed in Z2 across the last 4 weeks."
 *
 * Just structural, keeps the period-then-space + sentence-cap discipline.
 */
export function formatDiagnosis(args: {
  observation: string;
  evidence: string;
}): string {
  const obs = args.observation.trim().replace(/\.$/, '');
  const ev = args.evidence.trim().replace(/\.$/, '');
  return `${obs}. ${ev}.`;
}

// ─────────────────────────────────────────────────────────────────────
//                         TYPES (for callers)
// ─────────────────────────────────────────────────────────────────────

/** Shape every adaptive verdict's copy must conform to. Matches the
 *  fields rendered by AdaptiveVdotBanner / CoachReadsCard / MaxHrBanner. */
export interface AdaptiveSurfaceCopy {
  /** One-line headline · diagnose or report. ≤16 words. */
  headline: string;
  /** Supporting observation · what evidence backs the headline. ≤32 words. */
  evidence: string;
  /** Recommendation · what the coach proposes. Optional (some surfaces
   *  are pure-report and don't propose action). ≤24 words. */
  recommendation?: string;
  /** Falsifier · MUST be present on adaptive surfaces per Rule 2. Built
   *  via formatFalsifier(). */
  falsifier: string;
}
