/**
 * The shape of a coaching recommendation.
 *
 * Five parts: **action · change · reason · consequence · confidence.**
 *
 * ## Why this exists
 *
 * The app reliably produces an action and usually a reason. It almost never
 * says what the change PROTECTS, and it never states how sure it is — even
 * though both are now computed. The fitness model returns a range and a
 * confidence tier; the adaptation model returns high/medium/low. Both get
 * discarded at the copy layer, so a guess and a certainty read identically to
 * the runner. That is the gap this closes.
 *
 * Consequence is the field that changes how coaching lands. "Run 30 easy
 * instead of 50" is an instruction. "Run 30 easy instead of 50, which keeps
 * Friday's long run intact" is a coach. Same decision, and only one of them
 * tells the runner what they are buying.
 *
 * ## The rule that keeps this from becoming a form
 *
 * `Design/coach-voice-brief.md` warns that a composer emitting the same
 * structure every time is a template, and templates stop being heard. So the
 * five fields are DATA, not a script. `renderShort` speaks only what carries
 * information right now:
 *
 *   · `change` is spoken only when something actually changed.
 *   · `consequence` is spoken only when there is a real tradeoff to name.
 *   · `confidence` is spoken only when it is NOT high — certainty is the
 *     unmarked case, and announcing it every time is how a coach starts
 *     sounding defensive.
 *
 * The full five parts always exist on the object, for the detail view, the
 * coach log, and the audit trail. What gets said is a subset.
 *
 * The final tone rule from the voice brief still governs: as the consequence
 * gets bigger, the writing gets simpler.
 */

/** How sure the coach is. Sourced from the model that produced the finding —
 *  never invented at the copy layer. */
export type RecommendationConfidence = 'high' | 'medium' | 'low';

/**
 * Where a fact came from. The outside brief's framing, adopted because we have
 * a live defect it describes: a VDOT inferred from weekly mileage at cold start
 * is persisted and then read back by three consumers as though it were
 * measured. A fact that carries its provenance cannot be laundered that way.
 */
export type Provenance =
  /** The runner told us. */
  | 'reported'
  /** A device or service recorded it. */
  | 'recorded'
  /** The engine derived it from other facts. Carries confidence. */
  | 'inferred'
  /** Sources disagree and we have not resolved which is right. */
  | 'conflicting'
  /** We looked and it is not there. Distinct from zero. */
  | 'missing';

export interface EvidenceItem {
  /** Plain-language statement of the fact, as the runner could verify it. */
  fact: string;
  provenance: Provenance;
  /** Only meaningful for `inferred`. */
  confidence?: RecommendationConfidence;
}

export interface Recommendation {
  /** What to do. Always present, always concrete. */
  action: string;
  /** How this differs from the plan. Null when nothing changed — which is
   *  itself a common and correct outcome, not a gap. */
  change: string | null;
  /** The strongest relevant evidence, in one line the runner can check. */
  reason: string;
  /** What the change protects or enables. Null when there is genuinely no
   *  tradeoff to name; do not invent one to fill the field. */
  consequence: string | null;
  confidence: RecommendationConfidence;
  /** The facts behind it, with provenance. Powers the detail view and the
   *  auditability requirement — "which observations mattered". */
  evidence: EvidenceItem[];
  /** Set when this recommendation supersedes an earlier one, so the runner can
   *  see that the coach changed its mind and why. */
  supersedes?: { previousAction: string; whyChanged: string };
}

/* ------------------------------------------------------------- rendering */

/**
 * The line the runner sees. One to three sentences, in the coach register.
 *
 * Speaks only the fields carrying information. See the header for why.
 */
export function renderShort(r: Recommendation): string {
  const parts: string[] = [r.action.trim()];

  if (r.change) parts.push(r.change.trim());
  parts.push(r.reason.trim());
  if (r.consequence) parts.push(r.consequence.trim());

  // Confidence is spoken only when it is not high. Hedging a certainty is how
  // a coach stops sounding like one.
  if (r.confidence === 'low') {
    parts.push('That read is provisional · there is not much to go on yet.');
  } else if (r.confidence === 'medium') {
    parts.push('Reasonably confident, not certain.');
  }

  return parts
    .map((s) => (/[.?!]$/.test(s) ? s : `${s}.`))
    .join(' ');
}

/**
 * The expanded view: everything, including what was NOT known.
 *
 * Missing evidence is rendered rather than omitted, because "we looked and it
 * is not there" is information the runner needs in order to judge the advice.
 * An empty evidence list silently reads as a confident conclusion.
 */
export function renderDetail(r: Recommendation): {
  headline: string;
  reason: string;
  consequence: string | null;
  confidence: RecommendationConfidence;
  knew: EvidenceItem[];
  didNotKnow: EvidenceItem[];
} {
  return {
    headline: r.change ? `${r.action} — ${r.change}` : r.action,
    reason: r.reason,
    consequence: r.consequence,
    confidence: r.confidence,
    knew: r.evidence.filter((e) => e.provenance !== 'missing'),
    didNotKnow: r.evidence.filter((e) => e.provenance === 'missing'),
  };
}

/* ------------------------------------------------------------ composition */

/**
 * Confidence is the WEAKEST link, never an average.
 *
 * A recommendation resting on one high-confidence fact and one low-confidence
 * fact is a low-confidence recommendation: the weak link is load-bearing, and
 * averaging it away is exactly the false precision the doctrine forbids.
 */
export function combineConfidence(
  parts: ReadonlyArray<RecommendationConfidence | null | undefined>,
): RecommendationConfidence {
  const known = parts.filter((p): p is RecommendationConfidence => p != null);
  if (known.length === 0) return 'low';
  if (known.includes('low')) return 'low';
  if (known.includes('medium')) return 'medium';
  return 'high';
}

/**
 * A recommendation that changes nothing.
 *
 * "Proceed as planned" is a real coaching decision and deserves the same
 * structure as an intervention — the runner should be able to see that the
 * coach looked and chose not to act, rather than inferring it from silence.
 */
export function proceedAsPlanned(args: {
  action: string;
  reason: string;
  consequence?: string | null;
  confidence: RecommendationConfidence;
  evidence: EvidenceItem[];
}): Recommendation {
  return {
    action: args.action,
    change: null,
    reason: args.reason,
    consequence: args.consequence ?? null,
    confidence: args.confidence,
    evidence: args.evidence,
  };
}

/* ------------------------------------------- adaptation → recommendation */

/**
 * Turn an adaptation verdict into something the runner can read and act on.
 *
 * This is the bridge that makes the adaptation model visible. Without it the
 * classifier is a number in a log; with it, "you are absorbing this block, so
 * next week asks for more" reaches the person doing the running.
 *
 * The consequence lines are the part worth reading carefully. Each one names
 * what the decision BUYS, because that is the difference between a coach and a
 * scheduler — and on the two holding bands it is also the difference between
 * an instruction that sounds like a demotion and one that sounds like a plan.
 */
export function recommendFromAdaptation(verdict: {
  band: 'strong' | 'normal' | 'marginal' | 'poor';
  confidence: RecommendationConfidence;
  decision: 'STAY' | 'PROGRESS' | 'MODIFY' | 'PROTECT';
  summary: string;
  dimensions: ReadonlyArray<{ dimension: string; score: number | null; detail: string }>;
}): Recommendation {
  const evidence: EvidenceItem[] = verdict.dimensions.map((d) =>
    d.score == null
      ? { fact: `${d.dimension.replace(/_/g, ' ')} could not be read`, provenance: 'missing' as const }
      : { fact: d.detail || `${d.dimension.replace(/_/g, ' ')} read normally`, provenance: 'inferred' as const, confidence: verdict.confidence },
  );

  /* 2026-09-02 · the pain / illness / injury veto branch stood here, and it
   * is gone with the vetoes themselves (`lib/adaptation/adaptation-model.ts`).
   * It authored three sentences — "Running stays off the plan while this is
   * active", "Skip the session. Recovery is the work today", "Do not run this
   * one through" — off a symptom the runner had logged. That is the app
   * telling him how his body is, which is the one thing the 2026-09-02 ruling
   * removes. The verdict now speaks only about the training. */

  const weakest = verdict.dimensions
    .filter((d) => d.score != null && d.detail)
    .sort((a, b) => a.score! - b.score!)[0];

  switch (verdict.decision) {
    case 'PROGRESS':
      return verdict.band === 'strong'
        ? {
            action: 'Take the step up in next week’s work.',
            change: 'Slightly more than the plan had penciled in.',
            reason: verdict.summary,
            consequence: 'You have earned more stimulus, and unused capacity is training you never get back.',
            confidence: verdict.confidence,
            evidence,
          }
        : proceedAsPlanned({
            action: 'Stay on the planned progression.',
            reason: verdict.summary,
            confidence: verdict.confidence,
            evidence,
          });

    case 'STAY':
      return {
        action: 'Hold this week’s work where it is.',
        change: 'The planned step up is deferred, not cancelled.',
        reason: weakest?.detail
          ? `The last block has not been fully absorbed yet · ${weakest.detail}.`
          : 'The last block has not been fully absorbed yet.',
        consequence:
          'Repeating a stimulus you have not finished adapting to is how the next one lands better.',
        confidence: verdict.confidence,
        evidence,
      };

    case 'MODIFY':
      return {
        action: 'Ease the coming week rather than adding to it.',
        change: 'Below what the plan had scheduled.',
        reason: weakest?.detail
          ? `The current load is not producing the response it should · ${weakest.detail}.`
          : 'The current load is not producing the response it should.',
        consequence:
          'Backing off now protects the rest of the block. Pushing into this usually costs more weeks than it saves.',
        confidence: verdict.confidence,
        evidence,
      };

    case 'PROTECT':
      return {
        action: 'Back the week off and let recovery catch up.',
        change: 'Below what the plan had scheduled.',
        reason: weakest?.detail ?? verdict.summary,
        consequence: 'This is the cheapest version of this problem. The next one costs weeks.',
        confidence: verdict.confidence,
        evidence,
      };
  }
}
