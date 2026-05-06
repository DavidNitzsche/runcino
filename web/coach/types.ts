/**
 * Coach types — shared across the doctrine and engine layers.
 *
 * Every coaching decision the app makes is wrapped in a CoachDecision so
 * the consumer can not only get the answer but also surface the reasoning
 * (a sentence the user can read) and the source (clickable citations into
 * docs/coaching-research.md or docs/amp-research.md).
 *
 * See docs/COACH_BUILD_PLAN.md for the architecture this fits into.
 */

/** Pointer back into the research markdown that justifies a doctrine
 *  constant or a decision. `doc` is repo-relative; `section` is the
 *  markdown heading path (e.g. "§3.1" or "§5.5 Threshold and tempo work").
 *  `snippet` is an optional short prose excerpt — used by the UI to
 *  render a hover-tooltip explaining the rule without leaving the page. */
export interface Citation {
  doc: 'docs/coaching-research.md' | 'docs/amp-research.md';
  section: string;
  snippet?: string;
}

/** Marker for which side of the coach answered. Mostly diagnostic — the
 *  consumer doesn't need to switch on it, but it shows up in logs and
 *  audits when we want to know whether a particular answer came from a
 *  rule lookup or a Claude call. */
export type CoachBrain = 'deterministic' | 'llm';

/** Wrapper for every value the Coach returns. Generic so the answer can
 *  be a number (taper depth %), a struct (workout prescription), a string
 *  (race-morning brief), or anything else.
 *
 *  • `answer`    — the value the consumer wants
 *  • `rationale` — one short sentence the UI can render verbatim
 *  • `citations` — at least one entry; click-throughs to research
 *  • `brain`     — which path produced it ('deterministic' | 'llm') */
export interface CoachDecision<T> {
  answer: T;
  rationale: string;
  citations: Citation[];
  brain: CoachBrain;
}

/** Minimum context every Coach call needs. Individual methods may
 *  require additional fields — those go in their dedicated input types
 *  (e.g. PrescribeWorkoutInput) defined alongside the method. */
export interface CoachBaseContext {
  /** ISO date string (YYYY-MM-DD) for "today" — explicit so the same
   *  state can be replayed deterministically in tests / retrospectives. */
  today: string;
  /** Per-user calibration overrides (Stage 4). Empty object until the
   *  retrospective loop is wired. */
  calibration?: Partial<CoachCalibration>;
}

/** Per-user calibration constants that override doctrine defaults.
 *  Populated by Stage 4 retrospective loop after the user's first race
 *  finishes. Stays empty for new users.
 *
 *  All fields optional — when missing, the coach falls back to doctrine. */
export interface CoachCalibration {
  /** Multiplier applied to the published Minetti GAP polynomial. 1.0 =
   *  pure Minetti; 1.05 = this user's hills cost 5% more energy than
   *  the curve predicts; 0.95 = they handle hills better than average. */
  gapMultiplier?: number;
  /** Multiplier on the doctrine taper-depth curve. Some athletes hold
   *  fitness through deeper tapers, others lose it fast. 1.0 default. */
  taperSensitivity?: number;
  /** Carb-tolerance offset in g/hr versus doctrine default. Negative
   *  values for sensitive guts, positive for trained. */
  carbToleranceDelta?: number;
  /** Easy-pace floor offset in s/mi vs doctrine default. */
  easyPaceFloorDelta?: number;
}
