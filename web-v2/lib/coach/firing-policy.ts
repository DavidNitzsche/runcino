/**
 * lib/coach/firing-policy.ts · the shared classifier for "should the coach
 * say this, and how loudly."
 *
 * Doctrine: `Design/execution-memory-firing.md` Part 3 · "When the coach
 * speaks", locked 2026-08-17. That document is the spec; this module is a
 * direct, literal implementation of its firing test — it does not
 * reinterpret it. Read Part 3 before changing anything below.
 *
 * ── The problem this fixes ─────────────────────────────────────────────
 *
 * Every coach message currently decides its own fate. There is no shared
 * policy — each detector (easy-discipline, heat-gate, decision-cards,
 * push-notification templates, coach-log) invents its own answer to "is
 * this worth interrupting for," so the same category of finding can land
 * at wildly different loudness depending only on which file happened to
 * compose it. This module is the ONE place that answers that question, so
 * a detector's job shrinks to "describe what happened," not "decide how
 * loud to be about it."
 *
 * ── The four levels ─────────────────────────────────────────────────────
 *
 *   INTERRUPT  · rare, high bar. Unrequested AND timing matters enough to
 *                intrude. Only five categories ever qualify — see
 *                `InterruptCategory`. Nothing else may reach this level,
 *                no matter how important it feels.
 *   SURFACE    · the athlete already opened the relevant screen. Most
 *                coaching belongs here.
 *   AVAILABLE  · useful, not worth volunteering. Explanatory depth behind
 *                "Why this workout?" / "View analysis".
 *   SILENT     · the most common response to normal training. No message
 *                is not a bug — the app being comfortable doing nothing is
 *                what makes the messages it does send credible.
 *
 * ── The firing test, verbatim ───────────────────────────────────────────
 *
 *   Did something change?              no  → probably silence
 *   Does the athlete need to know?     no  → store it
 *   Does knowing NOW change what they should do?  yes → potentially interrupt
 *   Is it useful only because they are already looking?  → surface it
 *   Is it mostly explanatory depth?    → make it available
 *
 * `classifyFinding` below asks these questions IN THIS ORDER, because the
 * order is the doctrine, not an implementation detail: "changed" and
 * "positive messages meet the same bar" gate everything else, INTERRUPT is
 * checked before SURFACE so nothing downgrades a genuine interrupt, and
 * SURFACE is checked before AVAILABLE so a detector that sets both flags by
 * accident degrades toward the louder, safer answer rather than the
 * quieter one.
 *
 * ── What this module is deliberately NOT ────────────────────────────────
 *
 * It does not decide the words (that's each detector's composer, e.g.
 * `composeEasyDisciplineEntry`). It does not decide whether to persist the
 * finding as memory (Part 2 of the same doc; `coach-log.ts` / a future
 * memory layer owns that). It does not decide WHERE on screen a SURFACE
 * finding renders — only that it is SURFACE-worthy. And per the locked
 * rule, it cannot make readiness act: nothing produced here may reach back
 * and change a plan. A caller that mutates state off a classifier result
 * has misused this module.
 */

/** The four firing levels, in the doctrine's own naming. */
export type FiringLevel = 'INTERRUPT' | 'SURFACE' | 'AVAILABLE' | 'SILENT';

/**
 * The five qualifying categories for INTERRUPT, verbatim from Part 3:
 * "safety or injury; a material workout change before execution;
 * significant weather intervention; an important schedule conflict;
 * genuinely time-sensitive race execution." A finding reaches INTERRUPT
 * only by declaring one of these — there is no "important enough" escape
 * hatch. If a finding does not fit one of these five, it cannot interrupt,
 * full stop, no matter how urgent it feels to the detector that produced
 * it.
 */
export type InterruptCategory =
  | 'safety_or_injury'
  | 'material_workout_change_before_execution'
  | 'significant_weather_intervention'
  | 'important_schedule_conflict'
  | 'time_sensitive_race_execution';

/**
 * Episode context, produced by the generalised episode-suppression layer
 * (`lib/coach/episode-log.ts`). A classifier call for a pattern-gated
 * finding should always carry one of these — it is what keeps "repetition
 * increases significance, not message frequency" (Part 3, non-negotiable
 * rule 13) true structurally rather than by convention.
 */
export interface EpisodeContext {
  /**
   * Has the pattern this finding describes actually established — cleared
   * whatever sample-size / duration / majority gate the detector uses
   * (e.g. easy-discipline's MIN_QUALIFYING_RUNS across MIN_DISTINCT_WEEKS)?
   * False means: the raw signal may have fired today, but there is no
   * PATTERN yet, only an anecdote. Silence.
   */
  patternEstablished: boolean;
  /**
   * Has the message for the CURRENT episode already been delivered (i.e.
   * `episode-log.ts` says there is no open write to do — an OPEN row
   * already exists and nothing has resolved since)? True silences the
   * finding regardless of every other flag. This is the structural half of
   * "one event escalates through the system only if repetition increases
   * its importance" — repetition of the SAME episode does not re-earn the
   * message, only a genuine state change (establish → resolve, or a new
   * episode after a resolve) does.
   */
  alreadyDeliveredThisEpisode?: boolean;
}

/**
 * The normalized shape every detector's finding is translated into at the
 * one call site that asks "should this fire." Deliberately small and
 * structural — detectors keep their own rich finding types (see
 * `EasyDisciplineFinding`) and adapt them into this shape only at the
 * point of decision, the same way `easy-discipline.ts` keeps its pattern
 * gate pure and lets `coach-log.ts` decide when to write.
 */
export interface CoachFindingInput {
  /**
   * Did something change since the last time this was evaluated? The
   * firing test's first question. A finding describing steady-state normal
   * training (nothing moved) should set this false and stop there — see
   * non-negotiable rule 11, "normal successful training should often
   * produce no coach message."
   */
  changed: boolean;

  /**
   * Does the athlete need to know this at all — on any screen, any day?
   * False means "store it" (Part 2 memory), not "tell them." A finding
   * that is true evidence but not actionable or informative to the runner
   * (e.g. an internal calibration adjustment with no visible consequence)
   * sets this false.
   */
  athleteNeedsToKnow: boolean;

  /**
   * Set only when this finding genuinely qualifies for INTERRUPT. Absence
   * means "does not qualify" — there is no numeric severity that promotes
   * a finding into this category by magnitude alone.
   */
  interruptCategory?: InterruptCategory;

  /**
   * True when the finding is useful only because the athlete is already on
   * the relevant screen (a run recap, the log, Today) — the ordinary shape
   * of most coaching. Checked after INTERRUPT so a finding that qualifies
   * for both is never downgraded.
   */
  usefulOnlyBecauseLooking?: boolean;

  /**
   * True when this is explanatory depth rather than a headline: full HR
   * trend, limiter analysis, why-this-workout, historical comparison, load
   * breakdown, race equivalency. Behind a "Why?" / "View analysis" tap,
   * never volunteered.
   */
  explanatoryDepth?: boolean;

  /**
   * True when the finding is praise or a positive observation. Per Part 3
   * ("Positive messages need the same threshold"), a positive finding must
   * ALSO set `meaningfulPositive` before it can reach anything above
   * SILENT — routine compliance does not buy airtime just because it is
   * nice.
   */
  isPositive?: boolean;

  /**
   * Required (and only meaningful) when `isPositive` is true. True only
   * when the observation is evidence of something — a threshold crossed, a
   * baseline moved, a pattern established enough to change what the coach
   * believes. "Four normal easy days" is false. "Four straight weeks above
   * the previous mileage ceiling" is true. See `meetsPositiveThreshold`.
   */
  meaningfulPositive?: boolean;

  /** Episode context for pattern-gated findings. Omit for one-shot,
   *  non-recurring findings (e.g. a single weather gate reading) — episode
   *  suppression only applies to detectors that track state across days. */
  episode?: EpisodeContext;
}

/**
 * The classifier. Pure, synchronous, total — every valid input maps to
 * exactly one level. Ask the firing test's questions in the doctrine's own
 * order; the order is load-bearing (see module header).
 */
export function classifyFinding(input: CoachFindingInput): FiringLevel {
  // "Did something change?" — the first and most common exit. Nothing
  // below can promote a finding that answers this no.
  if (!input.changed) return 'SILENT';

  // Positive messages meet the same bar as everything else. This is
  // checked immediately after "changed" and before anything else, so a
  // detector cannot route around it by also setting usefulOnlyBecauseLooking
  // or an interruptCategory on a compliment that hasn't earned one.
  if (input.isPositive && !input.meaningfulPositive) return 'SILENT';

  // "Does the athlete need to know?" — false means store it, not tell it.
  if (!input.athleteNeedsToKnow) return 'SILENT';

  // Episode suppression. An already-delivered episode is administratively
  // silent regardless of every flag below — see EpisodeContext above and
  // `lib/coach/episode-log.ts` for the mechanism that computes this.
  if (input.episode?.alreadyDeliveredThisEpisode) return 'SILENT';

  // A pattern-gated finding that has not established yet has nothing to
  // say — the raw signal existing is not the same as the pattern existing.
  if (input.episode && !input.episode.patternEstablished) return 'SILENT';

  // "Does knowing NOW change what they should do? → potentially interrupt."
  // Checked first among the louder outcomes so a finding that qualifies is
  // never accidentally downgraded by also being usefulOnlyBecauseLooking.
  if (input.interruptCategory) return 'INTERRUPT';

  // "Is it useful only because they are already looking? → surface it."
  if (input.usefulOnlyBecauseLooking) return 'SURFACE';

  // "Is it mostly explanatory depth? → make it available."
  if (input.explanatoryDepth) return 'AVAILABLE';

  // The athlete needs to know, something changed, and no more specific
  // home claimed it. SURFACE is where "most coaching belongs" (Part 3) —
  // the safe default once SILENT has been ruled out, not a guess.
  return 'SURFACE';
}

/**
 * Convenience gate for the positive-message rule on its own, for detectors
 * that want to decide "is this praise worth composing at all" before
 * building a whole CoachFindingInput. Mirrors the brief's own example
 * exactly: routine compliance is false, a genuine threshold crossing is
 * true.
 */
export function meetsPositiveThreshold(meaningfulPositive: boolean): boolean {
  return meaningfulPositive;
}

/**
 * Ranking so callers can compare/sort levels without hard-coding the order
 * (e.g. decision-cards' "decisions outrank notices" ladder, or a surface
 * that wants the loudest of several classified findings). Higher = louder.
 */
export const FIRING_LEVEL_RANK: Record<FiringLevel, number> = {
  INTERRUPT: 3,
  SURFACE: 2,
  AVAILABLE: 1,
  SILENT: 0,
};

/** True when `a` is at least as loud as `b`. */
export function atLeastAsLoud(a: FiringLevel, b: FiringLevel): boolean {
  return FIRING_LEVEL_RANK[a] >= FIRING_LEVEL_RANK[b];
}

/**
 * Repetition escalation, bounded. Part 3 rule 13: "repetition should
 * increase significance, not message frequency." This raises a finding's
 * level by AT MOST one notch as occurrences accumulate — e.g. a first,
 * isolated occurrence sits at AVAILABLE (worth recording, not volunteering)
 * and a THIRD occurrence of the same shape earns SURFACE, matching the
 * doc's own worked example ("On the third repeated failure: firing:
 * SURFACE, importance: high").
 *
 * What this function will never do: manufacture INTERRUPT from repetition
 * alone. INTERRUPT is categorical (see InterruptCategory) — a pattern that
 * recurs enough times to become dangerous is not "AVAILABLE ×3", it is a
 * NEW finding with `interruptCategory: 'safety_or_injury'` (or whichever
 * category actually applies), classified fresh through `classifyFinding`.
 * This function caps its own output at SURFACE for exactly that reason.
 */
export function escalateByRepetition(base: FiringLevel, occurrence: number): FiringLevel {
  if (base === 'SILENT' || base === 'INTERRUPT') return base;
  if (occurrence >= 3 && base === 'AVAILABLE') return 'SURFACE';
  return base;
}
