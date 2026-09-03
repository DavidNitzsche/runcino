/**
 * lib/adaptation/canonical/contract-constants.ts · EVERY NUMBER THE CONTRACT
 * STATES WITH A "~", NAMED, WITH ITS CITATION.
 *
 * `docs/ADAPTATION_ENGINE_CONTRACT.md` (locked 2026-09-03) writes its bounds
 * as approximations: "~21-28 days", "~3-5 s/mi", "≥~95%", "≤~5%", "≤~1 mile".
 * A tilde in a doc is a judgement the engine has to resolve to a number
 * exactly once. Resolving it at a call site instead would give this engine two
 * opinions about the same bound the first time a second call site appeared,
 * which is a Rule 16 violation waiting to happen, so every one of them lives
 * here with the sentence it came from.
 *
 * ── HOW A "~" IS RESOLVED, AND IN WHICH DIRECTION ───────────────────────────
 *
 * Where the contract gives a RANGE for an EVIDENCE BAR (how much proof is
 * required), this file takes the value that demands MORE proof, because the
 * contract's governing sentence for every lever is that evidence must be
 * corroborated before an anchor moves.
 *
 * Where the contract gives a RANGE for a MOVEMENT BOUND (how far a proposal
 * may go), this file takes the SMALLER movement as the ordinary step and keeps
 * the larger as the ceiling that "stronger and more numerous evidence" unlocks.
 * That is the contract's own construction for threshold pace and it is applied
 * uniformly.
 *
 * Neither direction is a safety reflex. Rule 21 is explicit that the bar to go
 * up may not be higher than the bar to come down, and this engine has no
 * downward-only lever to be asymmetric against: every constant below governs a
 * PROPOSAL, and the same constant decides PROGRESS and HOLD. A bar that is hard
 * to clear produces a HOLD naming exactly what is missing, never silence.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ─────────────────────
 *
 * A test can prove a constant equals the number in the doc. It cannot prove the
 * number is the right coaching answer, and it cannot prove the doc's sentence
 * was read correctly when the sentence is ambiguous. Where the contract is
 * genuinely ambiguous, the ambiguity is written into the comment rather than
 * silently resolved, so the next reader argues with the reasoning instead of
 * discovering the number.
 */

/** The contract this engine implements. Stamped into every decision record. */
export const CANONICAL_ADAPTATION_CONTRACT_VERSION = '1.0.0';

/** The document every constant below is read out of. */
export const CONTRACT_DOC = 'docs/ADAPTATION_ENGINE_CONTRACT.md';

/** The companion that supplies the seven stimulus conditions and Q13. */
export const BASELINE_DOC = 'docs/PROGRESSIVE_BASELINE_DOCTRINE.md';

/* ══════════════════════════════════════════════════════════════════════════
 * THRESHOLD PACE  ·  contract "Per-lever evidence contracts · Threshold pace",
 * and PROGRESSIVE_BASELINE_DOCTRINE.md Q20.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * "Normally ≥2 independent qualifying sessions within ~21-28 days, on separate
 * days" · contract, Threshold pace.
 *
 * Two, not three. This is the one place this engine deliberately sits BELOW the
 * older `PACE_PROGRESS_MIN_SESSIONS` (which imports
 * `CORROBORATION_MIN_OBSERVATIONS`, three). The contract is the newer document,
 * it is specific to this lever, and it says two. Recorded here rather than
 * quietly reconciled because it is a real divergence between two live engines:
 * the older one is the shadow path's bar, this one is the contract's.
 */
export const THRESHOLD_MIN_QUALIFYING_SESSIONS = 2;

/**
 * "within ~21-28 days" · the EVIDENCE WINDOW.
 *
 * Resolved to 28, the WIDER end. This is the one range where "more proof" and
 * "wider window" point in opposite directions and the wider window wins,
 * because a narrower window does not raise the quality bar, it just discards
 * qualifying sessions for being three weeks old rather than four. The bar that
 * actually governs quality is `THRESHOLD_MIN_QUALIFYING_SESSIONS` plus the
 * stimulus grade, not the calendar.
 *
 * The lower edge is kept as a named value because the contract states it, and
 * because a future confidence model may want to weight a 21-day corroboration
 * above a 28-day one. Nothing reads it yet, and it is exported rather than
 * dropped so that fact is visible.
 */
export const THRESHOLD_EVIDENCE_WINDOW_DAYS = 28;
export const THRESHOLD_EVIDENCE_WINDOW_DAYS_TIGHT = 21;

/**
 * "Bounded: ~3-5 s/mi ordinary confirmed update; larger needs stronger and more
 * numerous evidence."
 *
 * 3 is the ORDINARY step, 5 the ceiling that stronger evidence unlocks. The
 * contract's own two-tier construction, made explicit.
 */
export const THRESHOLD_ORDINARY_STEP_SEC_PER_MI = 3;
export const THRESHOLD_MAX_STEP_SEC_PER_MI = 5;

/**
 * What "stronger and more numerous" means, so the larger step is machine
 * evaluable rather than prose. One more qualifying session than the ordinary
 * bar, all of them FULL rather than defensible SUBSTANTIAL.
 *
 * The contract does not define this phrase. That is stated plainly rather than
 * hidden: this is the engine's resolution of an undefined term, chosen to be
 * the smallest reading that still means "more than ordinary", and it is the
 * single most arguable number in this file.
 */
export const THRESHOLD_STRONG_EVIDENCE_MIN_SESSIONS = THRESHOLD_MIN_QUALIFYING_SESSIONS + 1;

/**
 * "no same-day oscillation" · once a threshold decision has moved the anchor on
 * a given day, a second evaluation that same day may not move it back.
 */
export const THRESHOLD_NO_OSCILLATION_WINDOW_DAYS = 1;

/**
 * The smallest anchor movement worth making, s/mi. Below this the evidence has
 * not established a change and the lever HOLDS.
 *
 * Not a contract number, and it was added because the historical replay
 * produced a "PROGRESS" of 0.3 s/mi from two faster sessions and one slower
 * one. Arithmetically correct, and coaching nonsense: it relabels noise as
 * progress, and repeated across evaluations it is exactly the bouncing anchor
 * the contract forbids ("no same-day oscillation ... it must not make the
 * anchor bounce").
 *
 * One second per mile is the resolution below which a threshold pace is not
 * meaningfully different. The contract's own ordinary step is 3, so this floor
 * never blocks a change the contract would call an update; it only refuses to
 * dress rounding as a decision.
 */
export const THRESHOLD_MIN_MEANINGFUL_STEP_SEC_PER_MI = 1;

/* ══════════════════════════════════════════════════════════════════════════
 * WEEKLY VOLUME  ·  contract "Per-lever evidence contracts · Weekly volume".
 * ═══════════════════════════════════════════════════════════════════════ */

/** "≥3 consecutive non-cutback weeks at ≥~95% of prescribed volume." */
export const VOLUME_MIN_CONSECUTIVE_WEEKS = 3;

/**
 * "at ≥~95% of prescribed volume" · resolved to 0.95 exactly.
 *
 * Note this is a HIGHER bar than PROGRESSIVE_BASELINE_DOCTRINE.md Q9's
 * earned-peak criterion, which asks for "two of the preceding three
 * non-cutback weeks at ≥90%". The two are different questions and both are
 * kept: Q9 authorises a week the BASELINE already planned, this authorises the
 * engine to propose a week the baseline did NOT plan. Proposing new load
 * carries the higher bar. Q9's number is not re-typed here because this engine
 * does not evaluate the earned peak.
 */
export const VOLUME_WEEK_COMPLETION_MIN_FRAC = 0.95;

/**
 * Rule 9 · the REPRESENTATION tolerance on a completion bar. Not a band.
 *
 * `completed / prescribed >= 0.95` is a comparison between a bar and a
 * quotient, and IEEE-754 does not let the quotient sit exactly on the bar: for
 * **267 of the 1,999 prescriptions between 0.1 and 199.9 miles**, a week
 * completed at precisely 95% of its own prescription evaluates to
 * 0.9499999999999999 and fails. Whether the runner clears the criterion then
 * depends on the third decimal place of a number nobody chose, which is Rule
 * 9's cliff in its purest form — and it hid inside the counterfactual ladder,
 * where five decision points credited at "exactly the bar" reported
 * `Week completed at 95%, below the 95% bar`.
 *
 * This is not a widened threshold and must never become one. Contract Q21
 * writes the bar as "≥~95%", and 1e-9 is a hundred million times smaller than
 * the smallest difference any prescription can express; the closest the owner
 * ever came on real data was 0.9023, forty-eight thousandths away. It exists so
 * that 0.95 means 0.95.
 */
export const COMPLETION_FRACTION_EPSILON = 1e-9;

/** "Movement: ≤~5% above the affected prescribed week." */
export const VOLUME_MAX_STEP_FRAC = 0.05;

/** "one upward step per cutback cycle." */
export const VOLUME_MAX_STEPS_PER_CUTBACK_CYCLE = 1;

/* ══════════════════════════════════════════════════════════════════════════
 * LONG-RUN DISTANCE  ·  contract "Per-lever evidence contracts · Long-run
 * distance".
 * ═══════════════════════════════════════════════════════════════════════ */

/** "The two most recent relevant prescribed long runs at ≥~95% of distance." */
export const LONG_RUN_LOOKBACK_COUNT = 2;
export const LONG_RUN_COMPLETION_MIN_FRAC = 0.95;

/** "Movement: ≤~1 mile ordinary." */
export const LONG_RUN_MAX_STEP_MI = 1.0;

/** "one increase per cutback cycle." */
export const LONG_RUN_MAX_STEPS_PER_CUTBACK_CYCLE = 1;

/* ══════════════════════════════════════════════════════════════════════════
 * STIMULUS GRADING  ·  PROGRESSIVE_BASELINE_DOCTRINE.md Q12, seven conditions.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Q12.1 · "≥90% of prescribed work duration completed." */
export const STIMULUS_MIN_WORK_DURATION_FRAC = 0.90;

/** Q12.2 · "≥75% of prescribed work segments individually acceptable." */
export const STIMULUS_MIN_ACCEPTABLE_SEGMENT_FRAC = 0.75;

/** Q12.3 · "Session-level work pace within ~±3% of target or range." */
export const STIMULUS_WORK_PACE_TOLERANCE_FRAC = 0.03;

/**
 * Q12.6 · "Recoveries not extended enough to materially change the workout."
 *
 * The contract does not put a number on "materially". Resolved to 25% above
 * prescribed total recovery, which is the point at which a threshold session's
 * density has changed enough that it is testing a different quality. Another
 * undefined term resolved by this engine and flagged as such.
 */
export const STIMULUS_RECOVERY_INFLATION_MAX_FRAC = 0.25;

/**
 * The PARTIAL floor. Below this share of prescribed work the session is not
 * "a meaningful portion missed", it is a different session.
 *
 * Not a contract number. Q38 requires PARTIAL to mean "you completed useful
 * work, but not enough of the intended session", which presupposes a floor
 * under which the word stops being true. Set at half the prescribed work.
 */
export const STIMULUS_PARTIAL_MIN_WORK_FRAC = 0.50;

/* ══════════════════════════════════════════════════════════════════════════
 * LATE-SESSION DETERIORATION  ·  Q13.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Q13 · "Final-third grade/terrain-adjusted pace >~4-5% slower than the middle
 * third while HR is equal or higher."
 *
 * Resolved to 4%, the lower edge, because this is a DETECTOR of a problem
 * rather than a bar on evidence: firing earlier means noticing deterioration
 * sooner, and Q13 is explicit that one deteriorated session only reduces
 * confidence rather than blocking progression. The cost of the tighter number
 * is therefore a confidence reduction, not a refused proposal.
 */
export const DETERIORATION_PACE_SLOWDOWN_FRAC = 0.04;

/** Q13 · "Pace within ~2% but HR rises >~6 bpm." */
export const DETERIORATION_PACE_STABLE_FRAC = 0.02;
export const DETERIORATION_HR_RISE_BPM = 6;

/** Q13 · "Pace-to-HR decoupling >~5%." */
export const DETERIORATION_DECOUPLING_FRAC = 0.05;

/**
 * Q13 · "'Repeated' means ≥2 relevant SESSIONS in the window, not two segments
 * in one run."
 */
export const DETERIORATION_REPEATED_MIN_SESSIONS = 2;

/* ══════════════════════════════════════════════════════════════════════════
 * ARBITRATION  ·  contract "Arbitration when levers disagree".
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * What makes a proposal MATERIAL, expressed as a share of that lever's OWN
 * ordinary doctrine step.
 *
 * ── WHY THIS IS NOT A SHARE OF WEEKLY LOAD ─────────────────────────────────
 *
 * The first draft measured materiality as a share of projected weekly demand,
 * and the arbitration tests proved it unusable. Quality is roughly a quarter of
 * a week's demand, so changing its INTENSITY by one doctrine step moves the
 * weekly total by well under one percent. A threshold-pace proposal could
 * therefore never be material at any plausible bar, which made the contract's
 * own acceptance sentence unreachable:
 *
 *     "Your threshold evidence supports a faster threshold pace, but this week
 *      already contains enough total demand, so the change is deferred."
 *
 * A load index cannot answer this question, because the three levers move
 * quantities of genuinely different kinds. Half a mile on the long run and
 * three seconds per mile on the threshold anchor are both meaningful changes,
 * and no single scalar makes them comparable without flattening one of them.
 *
 * So materiality is asked in each lever's OWN units, against the bound the
 * contract already gives that lever. A change of at least half the ordinary
 * doctrine step is material; anything smaller is the "small pace correction"
 * the contract explicitly allows to proceed alongside a hold.
 *
 *   threshold pace · half of 3 s/mi   = 1.5 s/mi
 *   weekly volume  · half of 5%       = 2.5% of the affected week
 *   long run       · half of 1 mile   = 0.5 mi
 *
 * The plan-load representation is still what evaluates the COMBINED effect,
 * which is what the contract asks it for. It is simply no longer asked the one
 * question it cannot answer.
 */
export const MATERIAL_SHARE_OF_ORDINARY_STEP = 0.5;

/**
 * "Prefer one material lever per evaluation cycle so the response stays
 * attributable."
 *
 * One MATERIAL change. An atomic bundle (a threshold anchor plus repricing its
 * own threshold sessions) is one material change, not two, which is why this
 * counts materiality rather than proposals.
 */
export const MAX_MATERIAL_LEVERS_PER_CYCLE = 1;
