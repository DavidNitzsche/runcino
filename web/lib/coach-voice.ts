/**
 * V6 · Coach voice rules + shared phrase constants
 *
 * ONE coach across all surfaces. Three voice modes — each tied to a
 * specific function — and a small set of shared phrases that lock in
 * what already works in the surfaces that get it right.
 *
 * Imported anywhere coach-voice copy is emitted. Future surfaces MUST
 * use the helpers here so drift doesn't accumulate session-by-session.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      THE THREE VOICE MODES
 * ─────────────────────────────────────────────────────────────────────
 *
 * The coach speaks in three modes. They aren't different coaches — they
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
 *    threshold workouts faster" is the wrong frame — let the data
 *    speak in impersonal voice and let "you" be reserved for the
 *    runner's body/state.
 *
 * 2. IMPERSONAL OBSERVATION
 *    Used when REPORTING WHAT THE DATA SHOWS. No "you", no "we" —
 *    let the math carry the weight.
 *
 *    Examples that already work:
 *    · L7 signals: "3 threshold workouts trended faster at controlled HR"
 *    · V3:         "Two corroborating signals — fitness moving up"
 *    · C8:         "Preserves: Aerobic stimulus · Sacrifices: 3 mi of time-on-feet"
 *
 *    Quantify when possible. Numbers are durable; adjectives aren't.
 *
 * 3. "WE" / "OUR" — COACH AS NARRATOR
 *    Used when THE COACH is making a recommendation, verdict, or
 *    revision. "We'd" is the marker that the coach is taking a stance.
 *
 *    Examples that already work:
 *    · Race feasibility:  "We'd revise to 'aggressive' if a race in 4 weeks pushes VDOT to 47"
 *    · L7 verdict:        "What would change our mind: a reversal in any firing signal"
 *    · Max HR validation: "We'd raise the estimate if a validated peak comes in 3+ bpm above current"
 *
 *    "We" is the verdict voice. Use it sparingly — only when the coach
 *    is actively proposing or revising. Otherwise prefer impersonal.
 *
 * ─────────────────────────────────────────────────────────────────────
 *                      THE FALSIFIER CONTRACT
 * ─────────────────────────────────────────────────────────────────────
 *
 * Per CLAUDE.md Rule 2, every adaptive verdict carries a falsifier — a
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
 *   raise, drop, lift, flag. One verb per job — pick one.
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
 *   COLLECTING_EVIDENCE  — system hasn't seen enough yet to call it.
 *                          Path forward is more data. ("a second
 *                          corroborating signal would lift this to
 *                          a stronger read")
 *
 *   SIGNALS_CONFLICTED   — system sees enough data but the signals
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
 *                      WHAT THIS MODULE IS NOT
 * ─────────────────────────────────────────────────────────────────────
 *
 * This is NOT a content templating engine. The coach's actual words —
 * the noun for the observation, the specific number, the runner's race
 * name — those belong in the surface module. This file owns the SHAPE
 * of the sentence (prefix, verb choice, falsifier structure), not the
 * content of the observation.
 *
 * If you need to add a fourth voice mode or fourth verb, that's a real
 * change — discuss before adding. The point of this file is to STOP the
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
 *   · Multiple observations joined with " OR " (caps OR — the runner sees
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
 * Build a "we'd revise if..." threshold falsifier — the most common
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
 * Returns the observation only — wrap with formatFalsifier(...) if it's
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
 * Build a "would weaken this read" reversal observation — the most
 * common evidence-strength frame across L7 + V3.
 *
 *   formatReversal('a single slow threshold workout')
 *     → "a single slow threshold workout would weaken this read"
 */
export function formatReversal(observation: string): string {
  const cleaned = observation.trim().replace(/\.$/, '');
  return `${cleaned} ${WOULD_WEAKEN}`;
}

/**
 * Build a cross-reference clause acknowledging a related finding from
 * another surface — V7 building block.
 *
 * The point: when two surfaces share a contributing factor, the second
 * surface should ACKNOWLEDGE the first without RESTATING it. This
 * helper builds a lower-case clause designed to be embedded inside a
 * surface's own sentence.
 *
 * Example:
 *
 *   formatCrossReference({
 *     relatedLabel: 'Z2 stimulus check',
 *     surface:      '/overview',
 *     relation:     'consistent with',
 *   })
 *     → "consistent with the Z2 stimulus check on /overview"
 *
 *   Used inside C6 readiness copy:
 *   "Yellow. Watch effort if HR runs high early — consistent with the
 *    Z2 stimulus check on /overview."
 *
 * RELATIONS:
 *   · `consistent with`   — same pattern showing up in two surfaces
 *                            (V5 firing + C6 yellow: both observing
 *                            elevated effort).
 *   · `tied to`           — causal / structural link
 *                            (suspect-ceiling banner + Z2 sparkline:
 *                            zones recalibrated changes the sparkline).
 *   · `contributing to`   — related finding feeds the current one
 *                            (Signal 4 PR contributing to L7 bump).
 *   · `see also`          — pointer-only, no causal claim
 *                            (E1/E4 gap + L7 signals suspended).
 *
 * Pick the weakest relation that's still accurate. "Consistent with"
 * is the default because it claims pattern-co-occurrence without
 * asserting causation.
 */
export function formatCrossReference(args: {
  /** Brief noun-phrase naming the related finding. Should be the same
   *  label the related surface uses for itself. */
  relatedLabel: string;
  /** Surface path where the related finding lives (e.g., '/overview',
   *  '/profile', or component name). */
  surface: string;
  /** How this finding relates to the current one. Default: 'consistent with'. */
  relation?: 'consistent with' | 'tied to' | 'contributing to' | 'see also';
}): string {
  const relation = args.relation ?? 'consistent with';
  return `${relation} the ${args.relatedLabel} on ${args.surface}`;
}

/**
 * Build a diagnosis line — observation + evidence pair. Used by
 * surfaces that NAME what they see and then cite the supporting
 * observation.
 *
 *   formatDiagnosis({
 *     observation: 'Your easy runs are too hard',
 *     evidence:    '<40% of easy mileage landed in Z2 across the last 4 weeks',
 *   })
 *     → "Your easy runs are too hard. <40% of easy mileage landed in Z2 across the last 4 weeks."
 *
 * Just structural — keeps the period-then-space + sentence-cap discipline.
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
