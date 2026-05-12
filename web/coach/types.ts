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
  /** Canonical doctrine source. The `Research/...` form is the
   *  current source of truth (per docs/COACH_BUILD_PLAN.md); the two
   *  legacy `docs/...md` paths remain only until the last legacy
   *  citation migrates. */
  doc:
    | 'docs/coaching-research.md'
    | 'docs/amp-research.md'
    | `Research/${string}`;
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
  /** One sentence in voice — the default the UI shows on the card. */
  rationale: string;
  /** Optional 1-paragraph plain-English explanation. The UI surfaces
   *  this when the user asks "Why?". Reads like the Coach explaining
   *  themselves; cites principles in plain language, no §-numbers. */
  explanation?: string;
  /** Internal audit trail — the research sections that justify the
   *  answer. NOT rendered in the default UI; available to consumers
   *  that want to expose a deep "show me the source" mode. */
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

// ─────────────────────────────────────────────────────────────────────
// Stage 7 · UI consumption layer (stub types)
//
// These types describe what the mockups in /designs/*.html consume. Each
// is paired with a Coach method (bodySystems, trajectory14wk, etc.)
// that currently returns placeholder data so UI work can proceed.
// When the real engine work lands, the SHAPES stay; only the values
// flowing through them change.
// ─────────────────────────────────────────────────────────────────────

/** A single recovery-tracked body system (Glycogen / Muscle / Connective
 *  / CNS / Immune). Surfaces on Overview "Your Body" card and Health
 *  page. Drives the 5-row progress display + healed-date estimates. */
export interface BodySystem {
  /** Stable identifier for the system. UI uses this to look up the
   *  doctrine card it expands to. */
  id: 'glycogen' | 'muscle' | 'connective' | 'bone' | 'cns' | 'immune';
  /** Human label shown on the card. */
  label: string;
  /** Time window from peak stress (e.g. "5-10d"). */
  windowLabel: string;
  /** State string the UI maps to color. `done` = healed; `building` =
   *  in repair; `stressed` = freshly hit. */
  state: 'done' | 'building' | 'stressed';
  /** 0–1 — fraction healed since the stressor event. */
  readiness: number;
  /** ISO date string for the projected full-heal date. `null` when the
   *  system is already healed (state === 'done' and readiness === 1). */
  healedByISO: string | null;
  /** Days remaining until healed. 0 once healed. */
  daysToHealed: number;
}

/** Output of `Coach.bodySystems()` — the full 5-row picture. */
export interface BodySystemsReport {
  /** Days since the most recent A-priority race / heavy stressor. */
  daysSincePeakStress: number;
  /** Top-level chip on the card (e.g. "REBUILDING", "RECOVERED"). */
  contextLabel: string;
  systems: BodySystem[];
  /** ISO date when the SLOWEST system reaches 100%. UI surfaces this
   *  as "Quality work returns ~MAY 24". */
  qualityReturnsISO: string;
  /** Plain-English narrative the UI may render verbatim. */
  rationale: string;
}

/** One data point on the 14-week PATH-TO-A-RACE trajectory chart. */
export interface TrajectoryPoint {
  /** ISO date of the week-starting Monday. */
  weekStartISO: string;
  /** Week label like "WK 1" or "PEAK". */
  label: string;
  /** Planned weekly miles. */
  plannedMi: number;
  /** Actual miles run, if past; null for future weeks. */
  actualMi: number | null;
  /** Training phase for this week. */
  phase: 'past' | 'base' | 'build' | 'peak' | 'taper' | 'race';
  /** True if this is the projected PEAK week. */
  isPeak: boolean;
  /** True if this is the A-race week. */
  isRaceWeek: boolean;
}

/** Output of `Coach.trajectory14wk()` — the data backing the PATH chart. */
export interface Trajectory14wk {
  /** Race the trajectory points toward. */
  raceName: string;
  /** ISO race date. */
  raceDateISO: string;
  /** Total weeks in the build (typically 14, but variable). */
  totalWeeks: number;
  /** Total days from today to race day. */
  daysToRace: number;
  points: TrajectoryPoint[];
  /** Summary stats the UI surfaces in the strip below the chart. */
  summary: {
    totalBuildMi: number;
    peakWeekMi: number;
    longRunMaxMi: number;
    qualityDays: number;
    racePaceMi: number;
    cutbacks: number;
  };
  /** Plain-English headline (e.g. "98 days · 5 phases · peaks at 44 mi/wk"). */
  rationale: string;
}

/** A single key workout that "proves" race-readiness — the workouts
 *  that validate the build before race day. */
export interface ProofSession {
  /** ISO date of the proof session. */
  dateISO: string;
  /** Workout name in display case (e.g. "First T tempo"). */
  label: string;
  /** Workout structure (e.g. "4 × 1MI @ T"). */
  structure: string;
  /** Phase tag (e.g. "BUILD-WK 2", "PEAK-WK 1"). */
  phaseTag: string;
  /** Target pace as a display string (e.g. "7:00/MI"). */
  targetPaceDisplay: string;
  /** Color/priority tag for UI styling. `milestone` for training
   *  proofs, `race` for B-races used as fitness checks. */
  priority: 'milestone' | 'race';
}

export interface ProofSessionsReport {
  /** Race the proof points lead up to. */
  raceName: string;
  /** Total upcoming proofs in the build. */
  totalProofs: number;
  buildLengthWk: number;
  sessions: ProofSession[];
  /** The most recent COMPLETED proof — surfaces as "▲ LATEST PROOF". */
  latestCompleted: {
    dateISO: string;
    label: string;
    summary: string;
    onTarget: boolean;
  } | null;
}

/** Output of `Coach.raceFitnessPrediction()` — the GOAL vs FITNESS vs
 *  HEADROOM tile-row on /races. */
export interface RaceFitnessPrediction {
  raceName: string;
  raceDateISO: string;
  raceDistanceMi: number;
  /** Goal time in seconds (user-set). */
  goalTimeS: number;
  /** Display string of goal time, "1:35:00". */
  goalDisplay: string;
  /** Goal pace in s/mi. */
  goalPaceSPerMi: number;
  /** What current VDOT-anchored fitness predicts (seconds). */
  predictedTimeS: number;
  predictedDisplay: string;
  predictedPaceSPerMi: number;
  /** Anchored VDOT used for the prediction. */
  vdot: number;
  /** Headroom: goalPace − predictedPace, in s/mi (positive = room to
   *  spare; negative = fitness short). */
  headroomSPerMi: number;
  /** Confidence band based on data quality + race specificity. */
  confidence: 'high' | 'medium' | 'low';
  /** Stretch goal (faster than goal, what's possible if everything
   *  clicks). */
  stretchDisplay: string;
  /** Plain-English rationale. */
  rationale: string;
}

/** A single day's deltas in the WEEK STRIP — actual vs planned. */
export interface DayDelta {
  /** ISO date. */
  dateISO: string;
  /** Day-of-week label ("MON", "TUE", ...). */
  dayLabel: string;
  /** Planned distance in miles, 0 if rest day. */
  plannedMi: number;
  /** Actual distance in miles, null if future. */
  actualMi: number | null;
  /** miles delta — actualMi − plannedMi. Null when actualMi is null. */
  deltaMi: number | null;
  /** UI chip label, e.g. "+5.4 vs plan" or "ON PLAN". */
  pinLabel: string | null;
  /** Severity of the delta — drives chip color. */
  severity: 'good' | 'neutral' | 'warn' | 'over' | null;
  /** Coach engine workout type (recovery / general_aerobic / threshold /
   *  long_steady / rest / etc) — drives the day-cell label so each day
   *  shows what's actually prescribed, not a generic "Easy". */
  type: string;
  /** Coach engine display label ("Recovery run", "Long easy",
   *  "Threshold intervals", etc) — preferred over per-day fallbacks. */
  label: string;
  /** Quality flag — drives chip styling on quality days. */
  isQuality: boolean;
  /** Long-run flag — drives chip styling + axis emphasis on long days. */
  isLong: boolean;
}

export interface WeekDeltasReport {
  /** ISO of the Monday this week starts on. */
  weekStartISO: string;
  /** Sum of planned miles for the week. */
  plannedWeekMi: number;
  /** Sum of actual miles logged so far. */
  loggedWeekMi: number;
  /** Projection of where the week will land if remaining days run as
   *  planned + observed average. */
  projectedWeekMi: number;
  /** Net delta vs plan (loggedWeekMi − plannedWeekMi). */
  netDeltaMi: number;
  /** Per-day breakdown, MON→SUN. */
  days: DayDelta[];
  /** Highest-signal headline (e.g. "+8.1 over plan"). */
  rationale: string;
}

/** A single Coach-engine derived rule the user can inspect. Surfaces
 *  on the /profile COACH DETAILS card. */
export interface EngineDetail {
  /** Stable id (e.g. 'long_run_cap', 'easy_share'). */
  id: string;
  /** Display label, ALL CAPS. */
  label: string;
  /** Display value, e.g. "8.2 MI", "≥80%". */
  valueDisplay: string;
  /** Plain-English explanation in Coach voice. */
  explanation: string;
  /** Doctrine source label (e.g. "from VDOT 49.2"). */
  sourceLabel: string;
  /** Internal id of the doctrine module that owns this rule. */
  doctrineModule: string;
}

export interface EngineDetailsReport {
  details: EngineDetail[];
  /** Plan integrity — count of doctrine rules passed / total. */
  planIntegrity: {
    rulesPassed: number;
    rulesTotal: number;
    allPassing: boolean;
    /** Plain-English summary line. */
    summary: string;
  };
}

/** Output of `Coach.runRead()` — the Coach Read card on a single run's
 *  detail page. Speaks in voice; surfaces decision deltas. */
export interface RunReadReport {
  /** One-line verdict / hero phrase (e.g. "Recovery run, but you
   *  absorbed more."). */
  verdict: string;
  /** 1-2 sentence Coach-voice body. */
  body: string;
  /** Optional pin label that appears next to the card title (e.g.
   *  "+12% BASELINE UNLOCKED"). null when no engine state changed. */
  unlockPin: string | null;
  /** Decision deltas the Coach is making as a result of this run. */
  deltas: Array<{
    label: string;
    wasDisplay: string;
    nowDisplay: string;
  }>;
}

/** Output of `Coach.coachRead()` — the Coach Read mini-takeaway under
 *  a race recap. Single verdict + one body sentence. */
export interface CoachReadReport {
  verdict: string;
  body: string;
  /** Optional chip — "ON TRACK", "AHEAD OF PLAN", etc. */
  pin: string | null;
}
