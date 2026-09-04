/**
 * build-workout.ts
 *
 * Builds the WatchWorkout JSON the watch decodes from applicationContext.
 *
 * Wire contract: docs/coach/WATCH_CONTRACT.md + the watch's Swift struct
 * at legacy/native/Faff/FaffWatch Watch App/WatchWorkoutModels.swift.
 *
 * The payload feeds the SAME prescription module the iPhone modal uses
 * (lib/training/prescriptions.ts), so what the watch executes matches
 * what you see on the phone exactly. For repeat blocks (cruise intervals,
 * threshold reps, etc.) the recovery folds out into individual phases:
 *
 *   warmup → work₁ → recovery₁ → work₂ → recovery₂ → ... → workN → cooldown
 *
 * Wire field names ARE NOT the same as the prescription module — watch
 * uses `type` (not `kind`) and a specific haptic enum. Don't free-style
 * the field names; the Swift decoder will refuse them.
 */
import { pool } from '@/lib/db/pool';
import { logReadFailure, rowOrNull } from '@/lib/db/read';
import {
  prescriptionFor,
  narrowToPrescriptionType,
  type PrescriptionStep,
} from '@/lib/training/prescriptions';
import { expandSpecToPhases, type ExpandedPhase } from '@/lib/training/expand-spec';
import { resolvePrescribedPaceAnchors } from '@/lib/training/load-prescription-anchors';
// SPECSUMMARY-1 · the ONE owner of "what family of session is this", shared
// with the phone's card so the two surfaces cannot name it differently.
import { specFamilyPhrase } from '@/lib/training/spec-card';
import {
  classifySession,
  hrCapBreached,
  sessionToleranceSec,
  paceShapeFor,
  phaseToleranceSec,
  type SessionClass,
  type PaceShape,
} from '@/lib/training/execution-semantics';
import { parseRaceTime as parseRaceGoalSec, formatRaceTime } from '@/lib/training/vdot';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { buildRacePacing, type CourseGeometryInput } from '@/lib/race/pacing';
import { raceOpeningSegments } from '@/lib/race/distance-doctrine';
import { computeFueling, type WorkoutFuelingType } from '@/lib/training/fueling';
import { aerobicCeilingBpm, prescribedHrTargetBpm, hrRoleForRepDuration } from '@/lib/training/zones';
import { computeRaceFueling } from '@/lib/race/execution-plan';
import { resolveRaceFuel } from '@/lib/race/fuel-resolve';
import { distanceMiFromLabel as sharedDistanceMiFromLabel } from '@/lib/race/distance';
import { loadSettings } from '@/lib/coach/settings';
// 0821 watch design · the lobby's week page reads the SAME loader
// /api/plan/week and /api/v5/today read. Nothing about the week is
// re-derived here — see projectWeekStrip.
import { loadPlanWeek, type PlanWeekResult } from '@/lib/plan/week-loader';
import { resolveWatchSafetyGate } from '@/lib/watch/safety-stop';
// SAFETYSTOP-1 · the canonical safety owner. `build-workout.ts` used to be
// author number four for injury and illness; it is a consumer now.
import { resolveSafety } from '@/lib/safety/load-safety';
import type { SafetyResolution } from '@/lib/safety/safety-verdict';
import { adjustPhasesForHeat, heatNote, recordHeatEasing } from '@/lib/watch/heat';
import { runFacts } from '@/lib/runs/run-facts';
import { runAvgHr } from '@/lib/runs/run-shape';
import { resolveDayExecutions } from '@/lib/execution/day-resolver';
import { terrainAdjustedTargetSPerMi, treadmillEffectiveGradePct } from '@/lib/terrain/grade-adjust';
import { fmtMi, fmtMi2 } from '@/lib/format/run';

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.faff.run';

// ── Wire-format types (must match Swift WatchPhase/WatchWorkout) ───────

export type WatchPhaseType = 'warmup' | 'work' | 'recovery' | 'cooldown';
export type WatchHaptic =
  | 'start'
  | 'transition-work'
  | 'transition-recovery'
  | 'transition-cooldown'
  | 'end';
export type WatchRepUnit = 'time' | 'distance';

export interface WatchPhase {
  type: WatchPhaseType;
  label: string;
  durationSec: number;                // required, even for distance reps (estimate)
  targetPaceSPerMi?: number | null;
  tolerancePaceSPerMi?: number | null;
  /**
   * PACE-SHAPE-1 (2026-09-01) · WHAT `targetPaceSPerMi` MEANS on this phase.
   *
   * Additive and optional, so a deployed watch that has never heard of it
   * decodes the payload unchanged and keeps its old behaviour. New builds
   * grade off it, which is the whole point: without it the wrist had no way to
   * tell "hold 430, both sides" from "do not go faster than 502", and graded
   * both as a two-sided band. A correct 534 s/mi cool-down under a 502 ceiling
   * came back `missed`, and a between-rep jog that carries no prescribed pace
   * at all was one legacy row away from being graded too.
   *
   *   · `window`  — hold it, ±`tolerancePaceSPerMi`. Quality reps, race pace.
   *   · `ceiling` — do not go FASTER than it. Warm-up, cool-down, easy, long.
   *   · `none`    — no prescribed pace. Recovery jogs. Never pace-graded.
   *   · `effort`  — a target that is not a pace. Never pace-graded.
   *
   * `lib/training/execution-semantics.ts` is the owner; this field is that
   * module's `paceShapeFor` serialised, never a second derivation.
   */
  paceShape?: PaceShape;
  haptic: WatchHaptic;
  repUnit?: WatchRepUnit;
  distanceMi?: number | null;
  /** HR target for work phases on quality sessions (intervals/threshold/tempo).
   *  Sourced from workout_spec.lthr_bpm → profile.lthr → null.
   *  Null on warmup/recovery/cooldown and on easy/long workouts. */
  hrTargetBpm?: number | null;
  /** HR-ROLE-1 (2026-09-03) · WHAT `hrTargetBpm` means, mirroring `paceShape`.
   *  Used to read "floor/ceiling semantics are a face-display decision" —
   *  which is exactly the bug: a rendering surface cannot correctly choose
   *  between "target" and "reference" from the bpm number alone, and every
   *  short rep (a 60s hill) was rendering the same precise-looking number as
   *  a 15-minute tempo repeat, inviting a runner to chase a signal that
   *  Research/03 §13 says has not caught up to the effort yet.
   *
   *    · 'target'        — hover near it. The rep is long enough (≥ the
   *                         kinetics floor below) for HR to reach something
   *                         close to steady state.
   *    · 'observational' — the number is real and worth reading AFTER the
   *                         rep, never worth CHASING during it. Render it
   *                         quietly, never as a live target.
   *
   *  `null` only when `hrTargetBpm` itself is null. Never independently
   *  re-derive this on a consumer — see `hrRoleFor` below, the one place
   *  that decides it, off `HR_REP_KINETICS_FLOOR_SEC` — the SAME floor
   *  `lib/coach/reading-scope.ts` already uses to gate whether a post-run
   *  verdict may even be drawn from a rep this short. */
  hrRole?: 'target' | 'observational' | null;
  /** TREADMILL-HILL-1 (2026-09-03) · a belt speed + incline for a WORK phase
   *  that has no `targetPaceSPerMi` because it is prescribed by effort — a
   *  hill repeat, whose outdoor pace target is deliberately absent since a
   *  flat-ground number is unreachable on varying grade (Research/04 §8.1).
   *  On a treadmill the grade IS fixed, so a pace+incline pair is meaningful
   *  again — this is that pair, present ONLY when the phase's own label
   *  names it a hill rep (`/hill/i.test(label)`) and canonical pace anchors
   *  were resolvable. Never present for a genuinely paced phase (redundant
   *  with `targetPaceSPerMi`) or a non-hill effort phase (no doctrine band
   *  to convert). `inclinePct` is the doctrine-cited midpoint of Research/04
   *  §8.3's 4-6% grade band for medium hill repeats (60-90s, matching this
   *  app's only hill-rep shape); `speedMph` is that grade applied to the
   *  midpoint of the runner's threshold/interval anchors (the "5K-10K
   *  effort" band's own two named ends) via the SAME treadmill grade model
   *  `lib/terrain/grade-adjust.ts` already uses for post-run judging —
   *  reused, not re-derived. Built at prescription time so the treadmill
   *  flow can read a real number instead of falling back to a flat default
   *  that ignores the hill structure entirely (found live, 2026-09-03: a
   *  runner's actual hill session opened at a flat 8.0mph with no incline
   *  because `LiveRunTreadmillV5.swift`'s own default only knows
   *  `targetPaceSPerMi`). */
  treadmillInclinePct?: number | null;
  treadmillSpeedMph?: number | null;
  /** 2026-06-08 · True on the long-run HM/M finish segment. Optional on the
   *  wire — old watch builds omit/ignore it (field defaults to false there);
   *  new builds route it to the FINISH face instead of the rep face. */
  isFinishSegment?: boolean;
  /** DOCTRINE-STRIDES-1 · 2026-08-17 · True on each stride of an easy run's
   *  stride set. Optional on the wire, same contract as isFinishSegment —
   *  builds that predate strides see plain short time-based work phases and
   *  execute them correctly; builds that know the flag can route them to a
   *  dedicated stride face. */
  isStrideSegment?: boolean;
  /** 2026-06-09 Phase 2 (3.2) · one-line contingency label for this phase
   *  ("HR over 167 and climbing · finish easy, the stimulus is banked").
   *  Optional on the wire — old builds ignore it; new builds render it in
   *  gray under the phase target and use the workout-level `rules` array
   *  for breach detection. Never an instruction to stop · the watch
   *  OFFERS, the runner chooses. */
  ruleLabel?: string | null;
  /** 0821 watch design · B7 · the same bail in the two registers the
   *  board draws it in. `ruleEvidence` is the quiet factual half
   *  ("Heart rate over 167 and still climbing"); `ruleJudgement` is the
   *  coach's half ("The stimulus is already banked · forcing the rest of
   *  the reps buys fatigue, not fitness"). `ruleLabel` is UNCHANGED and
   *  still carries the whole line — deployed watches read it and must
   *  keep working. Null on a rule whose registers cannot be separated
   *  honestly. */
  ruleEvidence?: string | null;
  ruleJudgement?: string | null;
}

export interface WatchWorkout {
  workoutId: string;
  name: string;
  summary: string;
  totalEstimatedMinutes: number;
  phases: WatchPhase[];
  completionEndpoint: string;
  expiresAt: string;
  readinessScore?: number | null;
  readinessLabel?: string | null;
  distanceMi?: number | null;
  paceLabel?: string | null;
  isRace: boolean;
  goalSec?: number | null;
  /** 2026-09-01 · race-day HR guidance from the race-pace brain. Additive;
   *  the watch decodes what it knows. Informational unless the runner's own
   *  evidence backs the band. */
  raceHr?: {
    expectedLoBpm: number;
    expectedHiBpm: number;
    earlyCeilingBpm: number;
    earlyThroughMi: number;
    lateAllowanceBpm: number;
    checkpointMi: number | null;
    checkpointAbortBpm: number | null;
    informationalOnly: boolean;
  } | null;
  strategyLabel?: string | null;
  gelsMi?: number[] | null;
  fueling?: { needed: boolean; gels: number; atMins: number[]; gPerHr: number; totalCarbsG: number; isRehearsal: boolean; heatAdjusted: boolean; shortLine: string; why: string } | null;
  hrCeilingBpm?: number | null;
  /** ANCHOR-SPLIT-1 · 2026-08-30 · where `hrCeilingBpm` came from.
   *  'prescribed' — the plan authored it (`workout_spec.hr_cap_bpm`), and it is
   *  the same number the recap grades against. 'derived' — the plan authored
   *  none and this was computed from the runner's live threshold, so nothing
   *  may present it as a limit the plan set. Null when there is no ceiling.
   *  Rule 11: absent and 145 are different facts. Optional + additive — a
   *  deployed watch that does not decode it behaves exactly as before. */
  hrCeilingSource?: 'prescribed' | 'derived' | null;
  displayHint?: string | null;
  /** 2026-08-24 · heat · the lobby's one sentence about today's conditions,
   *  e.g. "84 degrees, dewpoint 66. Targets eased for the heat." Present ONLY
   *  when the targets on this payload were actually eased, so its presence is
   *  the fact and its absence is not a silent failure. Nothing on a running
   *  face mentions weather — a runner mid-effort cannot act on a temperature,
   *  and the band already carries the adjustment. Optional + additive: a watch
   *  that does not decode it is unaffected. See lib/watch/heat.ts. */
  heatNote?: string | null;
  /** 2026-06-09 Phase 2 (3.2) · contingency rules from workout_spec.rules
   *  (spec-builder composeContingencyRules). Optional + additive on the
   *  wire. Shape: {kind: 'pass'|'bail'|'abort', metric: 'hr'|'pace',
   *  op: '<='|'>', value, scope: 'work'|'finish'|'overall'|'mile-5',
   *  action: string|null, label}. The watch detects breaches and offers
   *  CONTINUE / TAKE THE BAIL; outcomes ride the completion payload's
   *  optional `rule_outcomes`.
   *
   *  2026-08-21 · 0821 design · B7 · each bail/abort rule additionally
   *  carries `evidence` and `judgement` (both string|null) beside the
   *  untouched `label`. See splitRuleRegisters. Kept as a loose record
   *  array because the shape is the SPEC's, read straight out of the
   *  authored jsonb — narrowing it here would assert a contract this
   *  builder does not own. */
  rules?: Array<Record<string, unknown>> | null;
  /** 2026-07-07 · units audit — the runner's distance display preference
   *  (profile.user_settings.units_distance, 'mi'/'km'). Optional +
   *  additive: absent/unrecognized reads as 'mi' on the watch (its
   *  existing behavior, unchanged for every runner who hasn't opted into
   *  km). All numeric phase fields on the wire (distanceMi,
   *  targetPaceSPerMi, etc.) stay in miles / seconds-per-mile regardless
   *  of this flag — it's a DISPLAY hint only, so the watch's GPS tracking
   *  and pace-drift math are untouched; only the last-mile string
   *  formatting step converts. */
  unitsDistance?: 'mi' | 'km';
  /** 0821 watch design · B5 · the lines the coach says in the ear, and
   *  draws on the wrist for the seconds it is saying them. Handful per
   *  session, never a script. Optional + additive: a deployed watch that
   *  does not know the key runs exactly as it ran before. */
  spokenCues?: WatchSpokenCue[] | null;
}

// ── 0821 watch design · B5 · spoken cues ────────────────────────────────
//
// Design rule 10: "A spoken cue is always also drawn. Audio is a delivery
// route, never a second content channel. Two runners — headphones in,
// headphones in a pocket — get the same sentence." So there is ONE field,
// carrying ONE sentence, and the watch is expected to speak it and draw it
// off the same string. There is deliberately no `audioText` twin: the
// moment two strings exist, they diverge.
//
// The trigger has to be evaluable on the wrist with no network and no
// server round-trip, so it is expressed against things the watch already
// tracks: covered distance, the phase cursor, and the fraction of the
// session's planned distance that is behind the runner.

/** How the watch decides the cue is due. Exactly one of `atMi`,
 *  `phaseIndex`, `atFraction` is non-null, named by this discriminator —
 *  a flat struct rather than a tagged union, because the watch's decoders
 *  are lenient-optional and a union would be the one shape they cannot
 *  express. */
export type WatchCueTrigger = 'distance' | 'phase' | 'fraction';

export interface WatchSpokenCue {
  /** Stable within one session. The watch fires each id at most once,
   *  which is what makes a cue a cue rather than a nag. */
  id: string;
  /** The sentence. Spoken AND drawn, verbatim, same string. */
  text: string;
  trigger: WatchCueTrigger;
  /** trigger 'distance' · fire when covered distance crosses this, in
   *  MILES (the wire is miles everywhere · unitsDistance is display only). */
  atMi?: number | null;
  /** trigger 'phase' · fire as this index of `phases` becomes current. */
  phaseIndex?: number | null;
  /** trigger 'fraction' · 0..1 of the session's planned distance. Used
   *  where the meaningful position is proportional (halfway) rather than
   *  a fixed mile. */
  atFraction?: number | null;
  /** Seconds the line holds the screen. The design gives a spoken cue
   *  three seconds and then hands the screen back. */
  holdSec: number;
}

// ── 0821 watch design · additive lobby fields ───────────────────────────
//
// Three boards in the 0821 handoff need state the payload never carried.
// All of it is ADDITIVE and OPTIONAL: a deployed watch that does not know
// these keys decodes exactly what it decoded before. camelCase throughout,
// per the wire contract (`routePolyline` / `6616d766` — a snake_case read
// silently dropped every GPS track for a day).
//
//   · weekStrip    → lobby page 3, "This week"
//   · sessionMoved → lobby variant, "the session already moved"
//   · dayState     → the two structured empty states (Rest day / No session)

/** One day of the lobby's week strip. `state` is the design's three-way
 *  read; `isPast` is carried alongside it so a past day nobody ran is not
 *  drawn as though it were still to come. */
export interface WatchWeekStripDay {
  dateIso: string;
  /** 0=Sun .. 6=Sat */
  dow: number;
  /** The strip's 10 pt day letter — the one annotation exception in the
   *  design's type floor, read as a row rather than individually. */
  letter: string;
  state: 'done' | 'today' | 'remaining';
  isPast: boolean;
  /** plan_workouts.type · 'rest' on a synthesised rest day. */
  type: string;
  plannedMi: number;
  /** Canonical actual mileage for the day. Null when nothing was run. */
  doneMi: number | null;
}

/** The lobby's "This week" page · seven days plus `18 of 42 mi`.
 *  Projected verbatim from `lib/plan/week-loader.ts:loadPlanWeek` — the
 *  same loader `/api/plan/week` and `/api/v5/today` read, so the watch's
 *  week and the phone's week cannot disagree. Nothing is re-derived here. */
export interface WatchWeekStrip {
  weekStartIso: string;
  weekEndIso: string;
  /** Miles actually run across the window, one decimal. */
  milesDone: number;
  /** Miles the plan asked for across the window, one decimal. */
  milesPlanned: number;
  days: WatchWeekStripDay[];
}

/** Lobby variant · the session ALREADY changed, and the reason is stated
 *  once. Deliberately carries no score: the design refuses to put a
 *  readiness number on the lobby, because a score at 6am is a thing to
 *  argue with. `readinessScore` / `readinessLabel` on WatchWorkout are
 *  untouched and separate — this is not them. */
export interface WatchSessionMoved {
  /** The coach's own reason, citation-scrubbed at source. "Six hours of sleep" */
  reason: string | null;
  /** What the day used to be. "was six miles" / "was cruise intervals" */
  wasLine: string | null;
  /** The two composed into the one line the board draws.
   *  "Six hours of sleep · was six miles" */
  line: string;
  originalType: string | null;
  originalSubLabel: string | null;
  originalDistanceMi: number | null;
  /** AdaptationInfo.kind · 'downgrade' | 'reschedule' | 'shave' | … */
  kind: string | null;
  adaptedAt: string | null;
}

/** One row of the lobby's post-run recap — "Distance / asked 7 mi / 3.14 mi",
 *  "Heart / under 145 / 121", "Effort / — / 4 of 10". Same three rows
 *  `/api/v5/today`'s `askedVsRan` composes (lib/faff/v5-today.ts,
 *  buildRecentRun) — built from the same canonical readers below so the
 *  watch and the phone cannot disagree about today's run. `sub`/`value` are
 *  precomposed strings, same convention as `WatchDayState.coachLine`: this
 *  is prose the server already formatted, not a number the watch reformats. */
export interface WatchCompletedRow {
  id: string;
  label: string;
  sub: string | null;
  value: string | null;
  tone: 'attention' | null;
}

/** The lobby draws this instead of the Start board once today's session is
 *  already run — asked-vs-ran, not the phone's full recap (no elevation,
 *  weather, shoes, splits; those stay screen real estate the wrist doesn't
 *  have). `distanceMi`/`durationSec`/`paceSPerMi` are raw numbers so the
 *  watch's own WFmt formatters render them, same convention as every other
 *  numeric field on this payload. */
export interface WatchCompletedRun {
  distanceMi: number;
  durationSec: number | null;
  paceSPerMi: number | null;
  avgHr: number | null;
  rows: WatchCompletedRow[];
}

/** Why there is no prescribed session. `rest` is a planned rest day and is
 *  its own board; every other value is the No-session board. */
export type WatchDayStateKind = 'rest' | 'no_session';
export type WatchNoSessionReason =
  | 'injury' | 'sick' | 'week_off' | 'off_season' | 'no_plan' | 'nothing_scheduled';

/** The two structured empty states. The flat `message` string stays on the
 *  response beside this, unchanged, so deployed watches keep working. */
export interface WatchDayState {
  kind: WatchDayStateKind;
  /** Null on `rest`. */
  reason: WatchNoSessionReason | null;
  /** Display lede · "Nothing today" / "Week off" / "Off-season". */
  title: string;
  /** The reasoned coach sentence, composed to the copy rules (8–40 words,
   *  second person, no exclamation marks, no em dashes — separator `·`).
   *  A clause whose evidence is missing is DROPPED rather than guessed. */
  coachLine: string;
  /** The board's one target. Rest day offers the run it did not ask for;
   *  No session offers a plain unprescribed run, which is a real thing this
   *  product records rather than a fallback. */
  actionLabel: 'Run anyway' | 'Just run';
  actionKind: 'run_anyway' | 'just_run';
  /** Evidence behind `coachLine`, carried separately so the watch can
   *  recompose it. Null when unknown — never a zero standing in for one. */
  weekMilesDone: number | null;
  weekMilesPlanned: number | null;
  /** "Sunday" · the day this week's long run falls on. */
  longRunDayName: string | null;
  longRunIsPast: boolean;
  longRunDone: boolean;
  /** "Monday" + its date · when the block resumes. Week-off only. */
  resumesDayName: string | null;
  resumesIso: string | null;
  /** The next running day in THIS week's window after today, if any.
   *  Rest-day and no-session boards look forward with this rather than
   *  backward-only (miles this week, the long run) — a runner staring at
   *  an empty day wants to know what's next, not just what's past.
   *  Null when the window has nothing left (e.g. today is the week's last
   *  day) — never guessed past the loaded week. */
  nextWorkout: WatchNextWorkout | null;
}

/** One upcoming day, surfaced on the Rest / No-session boards. */
export interface WatchNextWorkout {
  /** "Thursday" */
  dayName: string;
  dateIso: string;
  /** plan_workouts.type — "easy" · "long" · "tempo" · "intervals" · … */
  type: string;
  distanceMi: number;
  /** 1 = tomorrow, 2 = "in 2 days", etc. Always >= 1. */
  daysAway: number;
}

/** Fields that ride BOTH branches of the response. Every one optional. */
export interface WatchTodayGlance {
  weekStrip?: WatchWeekStrip | null;
  sessionMoved?: WatchSessionMoved | null;
  /** Present on the message branch always. Present on the WORKOUT branch
   *  only when a genuine no-session condition holds (open injury, logged
   *  sick day, travel week) — the workout still ships beside it, so an old
   *  build runs the session and a 0821 build draws the No-session board. */
  dayState?: WatchDayState | null;
  /** Present only when today's own session is already run — the same "did
   *  this day happen" predicate the week strip's today entry uses. Rides
   *  beside `workout`, never replaces it: the lobby still knows what was
   *  asked, it also now knows it already happened. */
  completedToday?: WatchCompletedRun | null;
}

export type WatchTodayResponse =
  | ({ workout: WatchWorkout; message?: undefined } & WatchTodayGlance)
  | ({ workout?: undefined; message: string } & WatchTodayGlance);

// ── Parsers ─────────────────────────────────────────────────────────────

/** "6:47" → 407 · "6:47 /mi" → 407 · null otherwise */
function parsePaceSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d+):(\d{2})/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

/** Range like "7:47-8:37 /mi" → { target: midpoint, tolerance: half-range }.
 *  Single value like "6:47" → { target: 407, tolerance: 8 } */
function parsePaceTarget(
  s: string | null | undefined,
  defaultTolerance = 8,
): { targetSec: number | null; toleranceSec: number | null } {
  if (!s) return { targetSec: null, toleranceSec: null };
  const rangeMatch = String(s).match(/(\d+):(\d{2})\s*-\s*(\d+):(\d{2})/);
  if (rangeMatch) {
    const lo = (+rangeMatch[1]) * 60 + (+rangeMatch[2]);
    const hi = (+rangeMatch[3]) * 60 + (+rangeMatch[4]);
    return {
      targetSec: Math.round((lo + hi) / 2),
      toleranceSec: Math.round((hi - lo) / 2),
    };
  }
  const single = parsePaceSec(s);
  if (single != null) return { targetSec: single, toleranceSec: defaultTolerance };
  return { targetSec: null, toleranceSec: null };
}

/** "2:00" → 120 seconds */
function parseDurationSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d+):(\d{2})$/);
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

// Rough pace estimates by phase type, used for durationSec on distance reps
// when the prescription doesn't carry one explicitly.
function estimatePaceSecPerMi(type: WatchPhaseType, isEasy: boolean): number {
  if (type === 'warmup' || type === 'cooldown' || isEasy) return 9 * 60;
  return 7 * 60;
}

// ── Step → WatchPhase mapping ───────────────────────────────────────────

/** Map a prescription step's label keyword to the watch's phase type. */
function classifyStep(step: PrescriptionStep): WatchPhaseType {
  const l = step.label.toLowerCase();
  if (l.includes('warmup')) return 'warmup';
  if (l.includes('cooldown')) return 'cooldown';
  if (l.includes('recovery')) return 'recovery';
  // 'easy build', 'easy run', 'reps', 'rep', 'tempo', 'race', 'marathon-pace',
  // 'strides', 'today (rest)' all become 'work'
  return 'work';
}

function isEasyStep(step: PrescriptionStep): boolean {
  const l = step.label.toLowerCase();
  return l.includes('easy') || l.includes('warmup') || l.includes('cooldown') || l.includes('recovery');
}

/** Convert one prescription step to one or more WatchPhases.
 *  Repeat blocks (step.recovery present) expand to N reps + (N-1) recoveries. */
function stepToPhases(step: PrescriptionStep, sessionClass: SessionClass): WatchPhase[] {
  const phaseType = classifyStep(step);
  const easy = isEasyStep(step);
  const defaultTolerance = sessionToleranceSec(sessionClass);
  // `toleranceSec` from the parse is only consulted for an explicit RANGE
  // string ("6:50-7:10"), which states its own half-width; a single-pace
  // string falls back to the owner's table via `tolOf` below.
  const { targetSec } = parsePaceTarget(step.pace_target, defaultTolerance);
  /* PACE-SHAPE-1 · this legacy path builds phases from the generic
   * prescription template rather than from an authored spec, and it was the
   * one place a recovery could still ship a pace target (`recPace` below).
   * The shape is asked of the SAME owner the spec path uses, so the two paths
   * cannot disagree about what a warm-up's number means. */
  const shapeOf = (t: WatchPhaseType, target: number | null) =>
    paceShapeFor(t, sessionClass, { hasTarget: target != null && target > 0 });
  const tolOf = (t: WatchPhaseType, target: number | null) =>
    phaseToleranceSec(t, sessionClass, { hasTarget: target != null && target > 0 });

  // Repeat block: N reps (with recovery between, skipping after the last rep)
  if (step.recovery && step.reps != null && step.reps > 0) {
    const reps = step.reps;
    const repDistMi = step.rep_distance_mi ?? 1;
    const repPaceSec = targetSec ?? estimatePaceSecPerMi('work', false);
    const repDurSec = Math.round(repPaceSec * repDistMi);
    const recDurSec = parseDurationSec(step.recovery.duration) ?? 120;
    const recPace = parsePaceTarget(step.recovery.pace_target, 30);

    const phases: WatchPhase[] = [];
    for (let i = 0; i < reps; i++) {
      phases.push({
        type: 'work',
        label: `Interval`,
        durationSec: repDurSec,
        targetPaceSPerMi: targetSec,
        tolerancePaceSPerMi: tolOf('work', targetSec),
        paceShape: shapeOf('work', targetSec),
        haptic: 'transition-work',
        repUnit: 'distance',
        distanceMi: repDistMi,
      });
      if (i < reps - 1) {
        phases.push({
          type: 'recovery',
          label: `Recovery ${i + 1}/${reps - 1}`,
          durationSec: recDurSec,
          // A recovery carries no prescribed pace (RECOVERY-BYFEEL-1) and is
          // never pace-graded. `recPace` is left computed but unused rather
          // than deleted, so the parse still validates the legacy string.
          targetPaceSPerMi: null,
          tolerancePaceSPerMi: null,
          paceShape: 'none',
          haptic: 'transition-recovery',
          repUnit: 'time',
        });
      }
    }
    return phases;
  }

  // Simple distance step (warmup, cooldown, easy run, tempo, MP finish, race)
  if (step.distance_mi != null && step.distance_mi > 0) {
    const paceSec = targetSec ?? estimatePaceSecPerMi(phaseType, easy);
    const durSec = Math.round(paceSec * step.distance_mi);
    const haptic: WatchHaptic =
      phaseType === 'warmup'   ? 'start'
    : phaseType === 'cooldown' ? 'transition-cooldown'
    :                            'transition-work';
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: tolOf(phaseType, targetSec),
      paceShape: shapeOf(phaseType, targetSec),
      haptic,
      repUnit: 'distance',
      distanceMi: step.distance_mi,
    }];
  }

  // Pure duration step (no reps, no distance) — e.g. shakeout strides set
  if (step.duration) {
    const durSec = parseDurationSec(step.duration) ?? 60;
    return [{
      type: phaseType,
      label: step.label,
      durationSec: durSec,
      targetPaceSPerMi: targetSec,
      tolerancePaceSPerMi: tolOf(phaseType, targetSec),
      paceShape: shapeOf(phaseType, targetSec),
      haptic: phaseType === 'cooldown' ? 'transition-cooldown' : 'transition-work',
      repUnit: 'time',
    }];
  }

  return [];
}

// ── Pace label helpers ──────────────────────────────────────────────────

/**
 * The plan's own zone tag · "T" / "I" / "L" / "E" / "R".
 *
 * WATCH-TYPE-1 (2026-08-25) · this switched on the RAW `plan_workouts.type`
 * and returned the empty string for four types the generator actually emits —
 * `race_week_tuneup`, `fartlek`, `progression`, `vo2max` — plus `recovery`.
 * The empty string is not inert on the wrist. `WatchLobbyAdapter.ramp`
 * (WatchRouterV5.swift:1331) reads this tag to decide the session's identity
 * ACROSS THE WHOLE PRODUCT, and its default arm is `.easy`: a race-week
 * tune-up and a VO2max session both arrived on the wrist wearing the easy
 * ramp. `isThreshold` (:838) reads it too, so the tune-up also lost the
 * average-pace row a threshold block is judged by.
 *
 * Narrowed through the SAME function the phone narrows through, so the two
 * surfaces cannot name a session differently. Every type that already
 * resolved is byte-identical; only the ones that returned "" change.
 */
export function paceLabelFor(rawType: string): string {
  switch (narrowToPrescriptionType(rawType)) {
    case 'easy':       return 'E';
    case 'long':       return 'L';
    case 'tempo':      return 'T';   // tempo is run at threshold effort (Daniels T), not marathon
    case 'threshold':  return 'T';
    case 'intervals':  return 'I';
    case 'race':       return 'R';
    case 'shakeout':   return 'E';
    default:           return '';
  }
}

/**
 * The session's NAME, used only when the row carries no `sub_label`.
 *
 * WATCH-TYPE-1 · the old default arm upper-cased the first character of the
 * raw column and stopped, so a race-week tune-up was announced on the wrist
 * as "Race_week_tuneup". Named explicitly where the product has a name for
 * it; the default now at least reads as prose rather than as a column value.
 */
export function labelFor(t: string): string {
  switch (t) {
    case 'easy':             return 'Easy';
    case 'long':             return 'Long';
    case 'tempo':            return 'Tempo';
    case 'threshold':        return 'Threshold';
    case 'intervals':        return 'Intervals';
    case 'race':             return 'Race';
    case 'shakeout':         return 'Shakeout';
    case 'race_week_tuneup': return 'Tune-up';
    case 'fartlek':          return 'Fartlek';
    case 'progression':      return 'Progression';
    case 'recovery':         return 'Recovery';
    case 'vo2max':
    case 'vo2':
    case 'interval':
    case 'track':            return 'Intervals';
    default:
      return t
        .replace(/[_-]+/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

// ── Profile helpers ─────────────────────────────────────────────────────

// 2026-06-03 · parseRaceGoalSec used to live inline here as a local
// fork · removed because it mis-parsed "1:30" as 90 seconds (MM:SS)
// instead of 5400 (H:MM). Now uses parseRaceTime from vdot.ts (imported
// at module top) which has the heuristic fix.

// 2026-07-07 · ultra-honesty audit · delegate to the shared parser (was a
// local fork with no ultra branches — already returned null on unmatched,
// no 13.1 fallthrough bug). Race-type watch payloads only exist for a
// GENERATED plan's race day, which the generator now refuses to build for
// an ultra target — but resolving a real ultra distanceMi here still
// matters for any other race-metadata read on this path (fueling, pacing
// display) that isn't gated the same way.
function distanceMiFromLabel(label: string | null | undefined): number | null {
  return sharedDistanceMiFromLabel(label);
}

// ── Main entrypoint ─────────────────────────────────────────────────────


/**
 * MOVED 2026-09-01 to `lib/training/execution-semantics.ts`, which is now THE
 * owner of the session classification, the grading tolerance and what a phase's
 * pace target means. Re-exported here so the wrist builder's existing callers
 * and `_session_class.test.ts` keep their import path, and so a grep for
 * `classifySession` still lands on the wire.
 *
 * The reason it moved: the phone routed the SAME decision off
 * `strictPrescriptionType` and got a different answer for `tempo` (±20 s/mi on
 * the card, ±8 on the wrist, 21 live plan rows). One function, one answer.
 */
export { classifySession, type SessionClass } from '@/lib/training/execution-semantics';

// ── 0821 watch design · lobby builders ──────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function dowOfIso(iso: string): number {
  return new Date(iso + 'T12:00:00Z').getUTCDay();
}

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
];

/** Prose distance for a coach sentence. Whole numbers up to twenty are
 *  spelled ("was six miles"); anything else stays a figure ("34 miles",
 *  "6.5 miles"). This is the rule the design's own two examples follow —
 *  it is coach register, not telemetry, and telemetry never comes through
 *  here. */
export function milesInWords(mi: number): string {
  const rounded = Math.round(mi * 10) / 10;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.05;
  const n = Math.round(rounded);
  const word = isWhole && n >= 1 && n <= 20 ? SMALL_NUMBERS[n] : String(rounded);
  const unit = isWhole && n === 1 ? 'mile' : 'miles';
  return `${word} ${unit}`;
}

/** Project `loadPlanWeek`'s result onto the wire. NOTHING is re-derived:
 *  the days, the actuals and the window all come from the shared loader. */
export function projectWeekStrip(week: PlanWeekResult): WatchWeekStrip | null {
  if (!week.week_start_iso || !week.week_end_iso || week.days.length === 0) return null;
  let milesDone = 0;
  let milesPlanned = 0;
  const days: WatchWeekStripDay[] = week.days.map((d) => {
    const doneMi = d.done_mi != null ? Math.round(d.done_mi * 10) / 10 : null;
    // Same "did this day happen" predicate /api/v5/today's week strip uses,
    // so the two strips cannot disagree about a day.
    const ran = d.completedRunId != null || (d.done_mi != null && d.done_mi >= 0.5);
    milesDone += doneMi ?? 0;
    milesPlanned += Number(d.distance_mi) || 0;
    return {
      dateIso: d.date_iso,
      dow: d.dow,
      letter: DAY_LETTERS[d.dow] ?? '',
      state: d.is_today ? 'today' : ran ? 'done' : 'remaining',
      isPast: d.is_past,
      type: d.type,
      plannedMi: Math.round((Number(d.distance_mi) || 0) * 10) / 10,
      doneMi,
    };
  });
  return {
    weekStartIso: week.week_start_iso,
    weekEndIso: week.week_end_iso,
    milesDone: Math.round(milesDone * 10) / 10,
    milesPlanned: Math.round(milesPlanned * 10) / 10,
    days,
  };
}

/** This week's long run and whether it has already happened. Prefers the
 *  authored `long` row; falls back to the week's biggest planned day. Null
 *  when the week has nothing that reads as a long run. */
function longRunOfWeek(week: PlanWeekResult): { dayName: string; isPast: boolean; done: boolean } | null {
  const candidates = week.days.filter((d) => Number(d.distance_mi) > 0);
  if (candidates.length === 0) return null;
  const long = candidates.find((d) => d.type === 'long')
    ?? candidates.reduce((a, b) => (Number(b.distance_mi) > Number(a.distance_mi) ? b : a));
  if (!long) return null;
  return {
    dayName: DAY_NAMES[long.dow] ?? '',
    isPast: long.is_past,
    done: long.completedRunId != null || (long.done_mi != null && long.done_mi >= 0.5),
  };
}

/** The first running day after `todayIso` still inside this loaded window,
 *  in words. Null when the window has nothing left after today — this never
 *  reaches into a week that wasn't loaded to find one. */
function nextWorkoutOfWeek(week: PlanWeekResult, todayIso: string): WatchNextWorkout | null {
  const todayMs = Date.parse(todayIso + 'T00:00:00Z');
  const upcoming = week.days
    .filter((d) => Number(d.distance_mi) > 0 && d.type !== 'rest' && d.date_iso > todayIso)
    .sort((a, b) => a.date_iso.localeCompare(b.date_iso));
  const next = upcoming[0];
  if (!next) return null;
  const daysAway = Math.round((Date.parse(next.date_iso + 'T00:00:00Z') - todayMs) / 86_400_000);
  return {
    dayName: DAY_NAMES[next.dow] ?? '',
    dateIso: next.date_iso,
    type: next.type,
    distanceMi: Math.round((Number(next.distance_mi) || 0) * 10) / 10,
    daysAway: Math.max(1, daysAway),
  };
}

/** The Rest-day board. "Nothing today · you ran 34 miles this week and the
 *  long one was Sunday. Resting is the work."
 *
 *  Every clause is dropped rather than guessed when its evidence is absent:
 *  a week with nothing in it does not get told it ran zero miles, and a long
 *  run that was scheduled and missed is not reported as having happened. */
export function buildRestDayState(week: WatchWeekStrip | null, raw: PlanWeekResult | null, today: string): WatchDayState {
  const long = raw ? longRunOfWeek(raw) : null;
  const nextWorkout = raw ? nextWorkoutOfWeek(raw, today) : null;
  const milesDone = week?.milesDone ?? null;
  const clauses: string[] = [];
  if (milesDone != null && milesDone >= 0.5) {
    clauses.push(`you ran ${milesInWords(milesDone)} this week`);
  }
  if (long) {
    if (long.isPast && long.done) clauses.push(`the long one was ${long.dayName}`);
    else if (!long.isPast) clauses.push(`the long one is ${long.dayName}`);
  }
  const evidence = clauses.length === 2
    ? `${clauses[0]} and ${clauses[1]}`
    : clauses[0] ?? null;
  const coachLine = evidence
    ? `Nothing today · ${evidence}. Resting is the work.`
    : 'Nothing today. Resting is the work.';
  return {
    kind: 'rest',
    reason: null,
    title: 'Nothing today',
    coachLine,
    actionLabel: 'Run anyway',
    actionKind: 'run_anyway',
    weekMilesDone: milesDone,
    weekMilesPlanned: week?.milesPlanned ?? null,
    longRunDayName: long?.dayName ?? null,
    longRunIsPast: long?.isPast ?? false,
    longRunDone: long?.done ?? false,
    resumesDayName: null,
    resumesIso: null,
    nextWorkout,
  };
}

/** The No-session board · off-season, a week off, an open injury, a logged
 *  sick day, or no plan at all. One sentence per reason, each of them a
 *  reason rather than a refusal, and the target is always a plain run: an
 *  unprescribed run is a real thing this product records, not a fallback. */
export function buildNoSessionState(
  reason: WatchNoSessionReason,
  opts: {
    week: WatchWeekStrip | null;
    raw: PlanWeekResult | null;
    today: string;
    resumesIso?: string | null;
    injurySite?: string | null;
  },
): WatchDayState {
  const resumesIso = opts.resumesIso ?? null;
  const resumesDayName = resumesIso ? (DAY_NAMES[dowOfIso(resumesIso)] ?? null) : null;
  const site = opts.injurySite ? String(opts.injurySite).toLowerCase() : null;
  const nextWorkout = opts.raw ? nextWorkoutOfWeek(opts.raw, opts.today) : null;

  let title: string;
  let coachLine: string;
  switch (reason) {
    case 'week_off':
      title = 'Week off';
      coachLine = resumesDayName
        ? `The block resumes ${resumesDayName}. Walk, swim, or do nothing. None of it goes in the book.`
        : 'The block resumes when you get back. Walk, swim, or do nothing. None of it goes in the book.';
      break;
    case 'off_season':
      title = 'Off-season';
      coachLine = 'No block is running. Run it if you want it. Nothing today is measured against a plan.';
      break;
    case 'injury':
      title = 'Not today';
      coachLine = site
        ? `The ${site} is still open, so nothing is prescribed. Anything you run today is a plain run.`
        : 'Nothing is prescribed while this settles. Anything you run today is a plain run.';
      break;
    case 'sick':
      title = 'Not today';
      coachLine = 'You logged a sick day, so nothing is prescribed. Anything you run today is a plain run.';
      break;
    case 'no_plan':
      title = 'No session';
      coachLine = 'No plan is running. Anything you run today is a plain run, recorded and nothing more.';
      break;
    default:
      title = 'No session';
      coachLine = 'Nothing on the calendar today. Anything you run is a plain run, recorded and nothing more.';
      break;
  }

  const long = opts.raw ? longRunOfWeek(opts.raw) : null;
  return {
    kind: 'no_session',
    reason,
    title,
    coachLine,
    actionLabel: 'Just run',
    actionKind: 'just_run',
    weekMilesDone: opts.week?.milesDone ?? null,
    weekMilesPlanned: opts.week?.milesPlanned ?? null,
    longRunDayName: long?.dayName ?? null,
    longRunIsPast: long?.isPast ?? false,
    longRunDone: long?.done ?? false,
    resumesDayName,
    resumesIso,
    nextWorkout,
  };
}

// ── 0821 · B5 · composing the cues ──────────────────────────────────────

/** Minimum miles between two cues. Two lines inside the same mile is a
 *  script, and a script is the thing the design says a cue is not. */
const CUE_MIN_SPACING_MI = 1.0;
/** The design's own count: "a handful per session, not a script." */
const CUE_MAX = 3;
/** Design § 7 · the line holds the board for the three seconds it is spoken. */
const CUE_HOLD_SEC = 3;

interface CueCandidate extends WatchSpokenCue {
  /** Where this lands in miles, for ordering + spacing only. Never on the wire. */
  _atMiResolved: number;
}

/** Miles of planned distance BEFORE a phase index. Used to order a
 *  phase-triggered cue against the distance-triggered ones. Falls back to
 *  the duration share when the phases carry no distances. */
function milesBeforePhase(phases: WatchPhase[], index: number, totalMi: number): number {
  let mi = 0;
  let haveDistance = false;
  for (let i = 0; i < index && i < phases.length; i++) {
    if (phases[i].distanceMi != null) { mi += Number(phases[i].distanceMi); haveDistance = true; }
  }
  if (haveDistance) return mi;
  const totalSec = phases.reduce((s, p) => s + (p.durationSec || 0), 0);
  if (totalSec <= 0) return 0;
  let sec = 0;
  for (let i = 0; i < index && i < phases.length; i++) sec += phases[i].durationSec || 0;
  return (sec / totalSec) * totalMi;
}

/**
 * The lines the coach says in the ear and draws on the wrist.
 *
 * Rules this obeys, all of them from the 0821 handoff:
 *   · ONE string per cue · spoken and drawn are the same sentence (rule 10).
 *   · At most three per session, at least a mile apart. The design's word
 *     is "a handful", and the failure mode is a script.
 *   · A cue that would reference a target the payload does not carry is
 *     DROPPED, not softened. A session with no pace band gets no line
 *     telling the runner to hold a pace band.
 *   · Coach register · second person, present tense, no exclamation marks,
 *     no em dashes ( · is the joiner), never scolding.
 *
 * Deterministic and pure — no DB, no clock, no LLM. Same session in, same
 * cues out, which is what makes the once-per-id contract on the wrist mean
 * anything.
 */
export function composeSpokenCues(opts: {
  sessionClass: SessionClass;
  distanceMi: number;
  phases: WatchPhase[];
}): WatchSpokenCue[] {
  const { sessionClass, phases } = opts;
  const totalMi = Number(opts.distanceMi) || 0;
  if (totalMi <= 0) return [];
  if (sessionClass === 'rest' || sessionClass === 'other') return [];

  const workIdx = phases
    .map((p, i) => ({ p, i }))
    .filter((x) => x.p.type === 'work');
  const finish = phases.map((p, i) => ({ p, i })).find((x) => x.p.isFinishSegment);
  const hasFinish = finish != null && finish.p.targetPaceSPerMi != null;

  const out: CueCandidate[] = [];
  const atDistance = (id: string, atMi: number, text: string) => {
    out.push({ id, text, trigger: 'distance', atMi: Math.round(atMi * 10) / 10, holdSec: CUE_HOLD_SEC, _atMiResolved: atMi });
  };
  const atFraction = (id: string, f: number, text: string) => {
    out.push({ id, text, trigger: 'fraction', atFraction: f, holdSec: CUE_HOLD_SEC, _atMiResolved: f * totalMi });
  };
  const atPhase = (id: string, index: number, text: string) => {
    out.push({
      id, text, trigger: 'phase', phaseIndex: index, holdSec: CUE_HOLD_SEC,
      _atMiResolved: milesBeforePhase(phases, index, totalMi),
    });
  };

  // The one line every distance-anchored session ends on. The design gives
  // it verbatim, so it is used verbatim.
  const LAST_TWO = 'Last two miles. Hold what you have · this is the part that counts.';

  switch (sessionClass) {
    case 'easy': {
      if (totalMi >= 3) {
        atDistance('easy-effort', 1,
          'Easy day. If you cannot hold a conversation, you are running it too hard.');
      }
      break;
    }
    case 'long': {
      atFraction('long-halfway', 0.5,
        'Halfway. Nothing is decided yet · a long run is made in its last third.');
      if (hasFinish) {
        atPhase('long-finish', finish!.i,
          'The finish starts here. Race pace from now to the door, and no faster.');
      } else if (totalMi >= 6) {
        atDistance('long-last-two', totalMi - 2, LAST_TWO);
      }
      break;
    }
    case 'threshold': {
      if (workIdx.length > 0) {
        atPhase('threshold-open', workIdx[0].i,
          'Threshold is comfortably hard. If the first rep burns, the pace is wrong, not your legs.');
      }
      if (workIdx.length > 1) {
        atPhase('threshold-last', workIdx[workIdx.length - 1].i,
          'Last one. Run it at the pace of the first · that is the whole point of the session.');
      }
      break;
    }
    case 'interval': {
      if (workIdx.length > 0) {
        atPhase('interval-open', workIdx[0].i,
          'First rep sets the session. Run the pace you can repeat, not the pace you have today.');
      }
      if (workIdx.length > 1) {
        atPhase('interval-last', workIdx[workIdx.length - 1].i,
          'Last rep. Match the first one · a set of reps is read by its slowest.');
      }
      break;
    }
    case 'race': {
      // Only when the opening phase actually carries a target. Telling a
      // runner to hold a pace nobody sent is the unfalsifiable claim.
      const openHasTarget = phases.find((p) => p.type === 'work')?.targetPaceSPerMi != null;
      if (openHasTarget && totalMi >= 3) {
        atDistance('race-open', 1,
          'First mile. Hold the opening pace you were given · time taken early is paid back twice.');
      }
      atFraction('race-halfway', 0.5,
        'Halfway. The second half is the race · hold the pace and stay patient.');
      if (totalMi >= 6) atDistance('race-last-two', totalMi - 2, LAST_TWO);
      break;
    }
  }

  // Order by where they land, keep them a mile apart, cap the handful.
  const kept: CueCandidate[] = [];
  for (const c of out.sort((a, b) => a._atMiResolved - b._atMiResolved)) {
    if (c._atMiResolved < 0 || c._atMiResolved > totalMi) continue;
    const prev = kept[kept.length - 1];
    if (prev && c._atMiResolved - prev._atMiResolved < CUE_MIN_SPACING_MI) continue;
    kept.push(c);
    if (kept.length >= CUE_MAX) break;
  }
  return kept.map(({ _atMiResolved, ...cue }) => cue);
}

// ── 0821 · B7 · the bail in two registers ───────────────────────────────

/** Seconds-per-mile → "7:10". */
function paceMmSs(sPerMi: number): string {
  const s = Math.round(sPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The bail, split into what was measured and what the coach makes of it.
 *
 * The board draws these in two different registers: the evidence quietly
 * first, then the judgement in the coach's voice. `label` — the one string
 * the deployed watch reads — is NOT touched by any of this; these ride
 * beside it.
 *
 * Composed from the rule's OWN structured fields (kind / metric / value /
 * scope / action), not by re-authoring the label, so a rule stored months
 * ago in `workout_spec.rules` splits correctly today with no migration.
 * The fallback for a shape this does not recognise is the label's own `·`
 * break, which is where the two registers already sit in every rule the
 * spec-builder writes; and where there is no break, the judgement is null
 * rather than invented.
 *
 * `pass` rules get nothing: they are post-run confirmation criteria, not a
 * decision offered to a runner mid-session, and there is no judgement to
 * make about a threshold nobody has crossed yet.
 */
export function splitRuleRegisters(
  rule: Record<string, unknown>,
): { evidence: string | null; judgement: string | null } {
  const none = { evidence: null, judgement: null };
  const kind = String(rule.kind ?? '');
  if (kind !== 'bail' && kind !== 'abort') return none;

  const metric = String(rule.metric ?? '');
  const scope = String(rule.scope ?? '');
  const action = rule.action == null ? null : String(rule.action);
  const value = Number(rule.value);
  const checkpointMi = /^mile-(\d+(?:\.\d+)?)$/.exec(scope)?.[1] ?? null;

  if (Number.isFinite(value)) {
    if (metric === 'hr' && action === 'drop_to_easy') {
      return {
        evidence: `Heart rate over ${Math.round(value)} and still climbing`,
        judgement: 'The stimulus is already banked · forcing the rest of the reps buys fatigue, not fitness.',
      };
    }
    if (metric === 'hr' && action === 'cut_finish_half') {
      return {
        evidence: `Heart rate over ${Math.round(value)} through the finish`,
        judgement: 'Cut the finish in half and jog the rest home · the long run itself is already in the bank.',
      };
    }
    if (metric === 'hr' && action === 'switch_to_b_goal' && checkpointMi) {
      return {
        evidence: `Mile ${checkpointMi} heart rate over ${Math.round(value)}`,
        judgement: 'The A goal is gone from here · run the B plan and finish the race that is still in front of you.',
      };
    }
    if (metric === 'pace' && action === 'switch_to_b_goal' && checkpointMi) {
      return {
        evidence: `Mile ${checkpointMi} pace slower than ${paceMmSs(value)}`,
        judgement: 'The A goal is out of reach at this pace · switch to the B plan and hold that instead.',
      };
    }
  }

  // Unrecognised shape · fall back to the label's own break. Never guess a
  // judgement that is not written down.
  const label = typeof rule.label === 'string' ? rule.label : null;
  if (!label) return none;
  const at = label.indexOf(' · ');
  if (at < 0) return { evidence: label.trim(), judgement: null };
  return {
    evidence: label.slice(0, at).trim() || null,
    judgement: label.slice(at + 3).trim() || null,
  };
}

/** The No-session board's reason, and the safety resolution behind it.
 *
 *  ── SAFETYSTOP-1 (2026-09-02) · THIS USED TO BE AUTHOR NUMBER FOUR ─────────
 *
 *  It ran its own `runner_injuries` and `sick_episodes` point reads, "mirroring
 *  `lib/coach/glance-state.ts`" by its own admission — a fourth independent
 *  answer to a question `docs/BRAIN_CONSTITUTION.md` gives exactly one owner.
 *  Both reads are gone. Injury and illness now come from
 *  `lib/safety/load-safety.ts:resolveSafety`, which is that owner, and this
 *  function does nothing but translate its verdict into the board's vocabulary.
 *
 *  WEEK OFF STAYS HERE, and that is not an oversight. A travel week is a
 *  SCHEDULING fact about the calendar, not a statement about the runner's body,
 *  and the safety owner correctly has no opinion about it.
 *
 *  THE OLD `.catch(() => null)` PER READ IS ALSO GONE. It made a healthy runner
 *  and a failed database read the same fact — Rule 11 — and its comment argued
 *  for it ("a Postgres blip must not cost the runner their workout"). The
 *  owner's `SafetyResolution` carries that distinction as a TYPE now, and the
 *  caller spends it: an unresolved check withholds the session rather than
 *  quietly prescribing one. */
async function loadNoSessionReason(
  safety: SafetyResolution,
  today: string,
  planId: string | null,
): Promise<{
  reason: WatchNoSessionReason;
  resumesIso: string | null;
  injurySite: string | null;
} | null> {
  // Injury and illness · the canonical owner, not a fourth reader.
  //
  // The BOARD is driven by `driver` rather than by posture: it names WHICH
  // signal owns the day, and the two questions are separate. A niggle can move
  // the posture without there being a "Not today" board to draw for it, and
  // the workout gate below reads posture on its own.
  if (safety.known) {
    if (safety.driver === 'injury' && safety.injury) {
      return { reason: 'injury', resumesIso: null, injurySite: safety.injury.site ?? null };
    }
    if (safety.driver === 'illness') {
      return { reason: 'sick', resumesIso: null, injurySite: null };
    }
  }

  // Week off · `replan-scenarios.ts`'s travel scenario zeroes the window's
  // rows and labels them AWAY. That is the only deliberate break this engine
  // can currently NAME — a planned zero week has no distinct signal and is
  // deliberately not guessed at, here or on the phone.
  if (planId) {
    const away = (await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM plan_workouts
        WHERE plan_id = $1 AND date_iso = $2::text AND sub_label = 'AWAY'`,
      [planId, today],
    ).catch(() => ({ rows: [{ n: '0' }] }))).rows[0];
    if (Number(away?.n) > 0) {
      const next = (await pool.query<{ date_iso: string }>(
        `SELECT date_iso::text AS date_iso FROM plan_workouts
          WHERE plan_id = $1 AND date_iso > $2 AND sub_label IS DISTINCT FROM 'AWAY'
          ORDER BY date_iso ASC LIMIT 1`,
        [planId, today],
      ).catch(() => ({ rows: [] as Array<{ date_iso: string }> }))).rows[0];
      return { reason: 'week_off', resumesIso: next?.date_iso ?? null, injurySite: null };
    }
  }
  return null;
}

/** Lobby variant · "the session already moved".
 *
 *  Reads `lib/coach/adaptation-info.ts` for THIS plan and pulls the row for
 *  today's workout. Emits nothing at all when the day was not adapted, or
 *  when the adaptation left nothing honest to say — silence beats an
 *  unfalsifiable claim, and a lobby that announces a change it cannot name
 *  is worse than one that says nothing.
 *
 *  The loader's only entry point is plan-wide (one LATERAL join over the
 *  plan's workouts, the same call `loadTrainingState` already makes), so
 *  this reads the plan and keeps one row. Calling it is the instruction:
 *  re-deriving "was it adapted" from `original_*` here would be a second
 *  answer to a question that already has one. */
async function loadSessionMoved(
  planId: string,
  workoutId: string | null,
  currentDistanceMi: number,
): Promise<WatchSessionMoved | null> {
  if (!workoutId) return null;
  const { loadAdaptationInfoByPlanIds } = await import('@/lib/coach/adaptation-info');
  type AInfo = import('@/lib/coach/adaptation-info').AdaptationInfo;
  const byId = await loadAdaptationInfoByPlanIds([planId]).catch(() => new Map<string, AInfo>());
  const info = byId.get(String(workoutId));
  if (!info || !info.wasAdapted) return null;

  // "was six miles" when the dose moved; otherwise the name it used to
  // carry. Distance leads because that is the change the runner is standing
  // in the dark about to execute.
  const distanceChanged = info.originalDistanceMi != null
    && Math.abs(info.originalDistanceMi - currentDistanceMi) > 0.05;
  const priorName = info.originalSubLabel ?? info.originalType ?? null;
  const wasLine = distanceChanged && info.originalDistanceMi != null
    ? `was ${milesInWords(info.originalDistanceMi)}`
    : priorName
      ? `was ${priorName.toLowerCase()}`
      : null;

  const reason = info.reason?.trim() ? info.reason.trim().replace(/\s*[.·]\s*$/, '') : null;
  if (!reason && !wasLine) return null;
  const line = reason && wasLine ? `${reason} · ${wasLine}` : (reason ?? wasLine!);

  return {
    reason,
    wasLine,
    line,
    originalType: info.originalType,
    originalSubLabel: info.originalSubLabel,
    originalDistanceMi: info.originalDistanceMi,
    kind: info.kind,
    adaptedAt: info.adaptedAt,
  };
}

/** Today's asked-vs-ran, for the lobby's recap. Same canonical readers
 *  `/api/v5/today` uses for the same day (runFacts on the elapsed basis,
 *  runAvgHr, the post_run_rpe id-ladder) — deliberately re-run here rather
 *  than shared through a common function, because the phone route's version
 *  is entangled with elevation twins, weather and shoe resolution this
 *  payload has no use for. The QUERIES are the shared thing; the composition
 *  is trimmed to the three rows the wrist has room to draw. `wo` is the
 *  `plan_workouts` row `buildWatchToday` already fetched for today — no
 *  second read of it here. */
async function loadCompletedRun(
  userId: string,
  today: string,
  wo: { id?: string | null; distance_mi: number | string | null; pace_target_s_per_mi: number | null; workout_spec: any },
): Promise<WatchCompletedRun | null> {
  // WORKOUT-EXECUTION-ID-1 (2026-09-03) · replaces TWO-RUNS-ONE-DAY-1, which
  // did not hold — see the long explanation on its sibling in
  // app/api/v5/today/route.ts. Same root cause here: `plannedWorkoutType` is
  // populated on ~1 of 276 of David's own rows, so the old ORDER BY was
  // almost always inert and this face kept drawing the day's biggest run as
  // "today's session, done" regardless of whether it had anything to do with
  // `wo`. Now uses the one canonical resolver and requires an EXACT or
  // LEGACY-TYPE match against THIS specific `plan_workouts` row — not merely
  // "a run exists on this date" — before the wrist calls it complete.
  const resolved = await resolveDayExecutions(userId, today).catch((err: unknown) => {
    console.warn('[watch/build-workout] day resolver unreadable:',
      err instanceof Error ? err.message : err);
    return null;
  });
  const matched = wo.id
    ? resolved?.prescriptions.find((p) => p.id === wo.id)?.matchedRun ?? null
    : null;
  if (!matched) return null;
  const runRow = { id: matched.runId, data: matched.data as Record<string, any> };

  const data = runRow.data ?? {};
  // Elapsed basis — the lobby's own hero prints the elapsed clock beside
  // the distance, so its pace has to be the elapsed pace. Same reasoning
  // as /api/v5/today's own comment on this exact read (route.ts, the
  // 2026-08-23 3:37/mi fiction).
  const facts = runFacts(data, { basis: 'elapsed' });
  const distanceMi = facts.distanceMi ?? 0;
  const durationSec = facts.timeSec;
  const paceSPerMi = facts.paceSecPerMi;
  const avgHr = runAvgHr(data);

  const askedMi = wo.distance_mi != null ? Number(wo.distance_mi) : null;
  const spec = wo.workout_spec ?? null;
  const askedHrCap: number | null = spec
    ? Number(spec.hr_cap_bpm ?? spec.hr_target_bpm ?? spec.lthr_bpm) || null
    : null;
  // Only `hr_cap_bpm` is a genuine "stay under this" ceiling — see
  // V5RecentRunCtx.askedHrIsHardCap's doc in lib/faff/v5-today.ts for why
  // the other two fallbacks are display-only and wrong to grade against.
  const askedHrIsHardCap = Boolean(spec && Number(spec.hr_cap_bpm) > 0);

  // Same id-ladder /api/v5/today's route uses (fixed 2026-08-24): a watch
  // row files its effort under its own primary key, a Strava row under
  // `data.activityId` — matching only one spelling strands the other.
  const rpeIds = Array.from(new Set(
    [data.activityId, data.id, runRow.id].filter((v) => v != null).map(String),
  ));
  const rpeRow = (await pool.query<{ rpe: number | null }>(
    `SELECT rpe FROM post_run_rpe
      WHERE (user_uuid = $1 OR user_id::text = $1::text)
        AND activity_id = ANY($2::text[])
      ORDER BY (notes IS DISTINCT FROM 'auto-imported from strava') DESC,
               logged_at DESC
      LIMIT 1`,
    [userId, rpeIds],
  ).catch(() => ({ rows: [] as any[] }))).rows[0];
  const effortLogged = rpeRow?.rpe ?? null;

  return {
    distanceMi, durationSec, paceSPerMi, avgHr,
    rows: composeCompletedRows({ distanceMi, askedMi, avgHr, askedHrCap, askedHrIsHardCap, effortLogged }),
  };
}

/**
 * The recap board's rows, as pure composition.
 *
 * Split out of `loadCompletedRun` so the thing the runner READS can be
 * asserted without a database. Rule 15's point, applied narrowly: the row
 * list was only reachable through four live queries, so nothing had ever
 * checked what the four rows say when they are drawn together — which is the
 * only question that matters and exactly where WATCH-DUP-HR-1 was hiding.
 */
export function composeCompletedRows(input: {
  distanceMi: number;
  askedMi: number | null;
  avgHr: number | null;
  askedHrCap: number | null;
  askedHrIsHardCap: boolean;
  effortLogged: number | null;
}): WatchCompletedRow[] {
  const { distanceMi, askedMi, avgHr, askedHrCap, askedHrIsHardCap, effortLogged } = input;
  const rows: WatchCompletedRow[] = [];

  // Distance — only when the gap from what was asked is material. Same
  // threshold /api/v5/today's askedVsRan row uses: a quarter mile, or a
  // tenth of the ask on a short session.
  if (askedMi != null && distanceMi > 0) {
    const gap = Math.abs(distanceMi - askedMi);
    const material = gap > Math.max(0.25, askedMi * 0.1);
    const askedText = fmtMi(askedMi);
    if (material && askedText) {
      rows.push({
        id: 'distance', label: 'Distance',
        sub: `asked ${askedText}`,
        value: fmtMi2(distanceMi),
        tone: null,
      });
    }
  }

  // Heart — only when the plan set a genuine ceiling, never a target to
  // hover near or a bare LTHR reference (askedHrIsHardCap above).
  const heartRowCarriesAvgHr = askedHrCap != null && askedHrIsHardCap && avgHr != null;
  if (askedHrCap != null && askedHrIsHardCap) {
    rows.push({
      id: 'heart', label: 'Heart',
      sub: `under ${askedHrCap}`,
      value: avgHr != null ? `${avgHr}` : null,
      // F-14 · THE cap comparison, from THE owner — the wrist row and the
      // phone row and the recap all read one function now.
      tone: hrCapBreached(avgHr, askedHrCap) ? 'attention' : null,
    });
  }

  // Effort — always present. `effortAsked` (a prescribed band) is not
  // computed anywhere in this app yet, watch or phone — v5-today.ts still
  // hands its own row a hardcoded null. `sub` stays null here on the same
  // terms until that lands.
  rows.push({
    id: 'effort', label: 'Effort',
    sub: null,
    value: effortLogged != null ? `${effortLogged} of 10` : null,
    tone: null,
  });

  // Heart rate, avg — a plain reading, not an asked-vs-ran row.
  //
  // WATCH-DUP-HR-1 (2026-08-30) · this fired UNCONDITIONALLY whenever an
  // average existed, including when the `heart` row three lines up had just
  // drawn the same number. Rendered on the owner's own 2026-08-30 long run,
  // the lobby recap read:
  //
  //     Heart              under 145        159
  //     Effort                          7 of 10
  //     Heart rate, avg                 159 bpm
  //
  // One number, twice, two rows apart, on the smallest screen this product
  // has. The precedent cited above — "the phone's own TodayAfterV5 draws it
  // the same way" — is true and does not transfer: on the phone the two live
  // in different SECTIONS with other content between them, and here they are
  // adjacent rows in one four-row list. Rule 17: if two components can both
  // draw a value, one of them yields, and it yields on the rendered text.
  //
  // The `heart` row yields nothing and wins: it carries the same reading PLUS
  // what was asked for and the tone that grades it. This row keeps its job
  // for the case it was actually built for — a session with no hard cap
  // (quality days, an uncapped easy day), where nothing else reports the
  // average at all.
  if (avgHr != null && !heartRowCarriesAvgHr) {
    rows.push({
      id: 'hr_avg', label: 'Heart rate, avg',
      sub: null,
      value: `${avgHr} bpm`,
      tone: null,
    });
  }

  return rows;
}

/**
 * The easy/long HR ceiling, and where it came from.
 *
 * ── ANCHOR-SPLIT-1 (2026-08-30) · SPEC FIRST, LIVE DERIVATION AS FALLBACK ──
 *
 * This read the LIVE `profile.lthr` and never once looked at the ceiling the
 * plan actually prescribed. The recap row (`loadCompletedRun`) reads the
 * authored `workout_spec.hr_cap_bpm`. So ONE payload carried two answers to
 * "what is today's ceiling", under one name.
 *
 * Measured against the owner's real rows: at `profile.lthr` 162 both say 145
 * and the split is invisible. The moment the re-anchor cron moves him to 168
 * the running face says 151 while every spec row in the block still says 145 —
 * six beats apart, on the surface where being wrong changes what his body does
 * mid-run, and in the direction that lets him run an easy day too hard while
 * the recap then grades him against the tighter number and marks him down for
 * obeying his own watch. Rule 16.
 *
 * WHY SPEC-FIRST IS NOT A RULE 10 VIOLATION. Rule 10 says a persisted derived
 * value must carry its anchor or be recomputed, and this deliberately reads a
 * frozen one. That tension resolves on `db3fb5e7`: `recompute-paces.ts` now
 * reads the LIVE `profile.lthr` instead of the frozen `authored_state.lthr_bpm`,
 * so the spec is REFRESHED when the anchor moves rather than re-cemented at
 * authoring. Spec-first plus a working cascade is correct; spec-first with a
 * broken cascade was the bug.
 *
 * THAT CASCADE IS THE DEPENDENCY, AND IT IS GATED — this is not a promise in a
 * comment. It is `ANCHOR-STALE-2` in `lib/audit/anchor-derivation-registry.ts`,
 * enforced by `scripts/check-anchor-derivation.sh` in `prebuild`, which scans
 * the call shape rather than trusting prose (Rule 20: gate the claim or delete
 * the sentence). If the recompute is ever changed back to a frozen anchor, that
 * gate fails before this ceiling can go stale behind it. Do not "fix" this back
 * to a live read to compensate: a live read here is what produced the
 * two-number session in the first place.
 *
 * Within one session the runner sees one number, and it is the one the plan
 * prescribed for THIS workout. The quality-HR path already resolves spec-first
 * (`specHrBpm ?? lthr`); this ceiling was the lone outlier, so this is the
 * consistent answer rather than a new convention.
 *
 * RULE 11 · "the plan prescribed 145" and "the plan prescribed nothing so the
 * watch worked one out" are different facts, and the payload said the same
 * thing for both. On 2026-08-24 the spec authored NO cap (`hr_cap_bpm: null`,
 * written by `replan-scenarios.ts` on a replanned day) and the wrist showed 145
 * anyway — a number nothing had prescribed.
 *
 * The derived ceiling is KEPT rather than refused, because a replanned easy day
 * with no aerobic guidance at all is the worse outcome and that null is an
 * incomplete spec rather than a considered "run this uncapped". So it ships,
 * and it ships labelled. The half that already behaves correctly is untouched:
 * `loadCompletedRun`'s grading row requires `spec.hr_cap_bpm > 0`, so a derived
 * ceiling can never become an "under 145" the runner is marked against.
 */
export function resolveHrCeiling(input: {
  sessionClass: SessionClass;
  longHasFinish: boolean;
  specCeilingBpm: number | null;
  lthr: number | null;
  maxHr: number | null;
}): { bpm: number | null; source: 'prescribed' | 'derived' | null } {
  const { sessionClass, longHasFinish, specCeilingBpm, lthr, maxHr } = input;
  // Only easy/long, where staying aerobic is the discipline. A long run with an
  // HM/M finish is excluded: the finish is run at race pace, well above the
  // aerobic ceiling, so a workout-level cap would red-alert through the whole
  // finish and coach the opposite of the prescription (Audit D / D1).
  if ((sessionClass !== 'easy' && sessionClass !== 'long') || longHasFinish) {
    return { bpm: null, source: null };
  }
  if (specCeilingBpm != null) return { bpm: specCeilingBpm, source: 'prescribed' };
  // ZONE-BANDS-1 · the shared Friel Z2 ceiling. Was a hand-written 0.89, which
  // gave 144 at LTHR 162 while the band's real top is 145 — so the watch capped
  // an easy run one beat tighter than the plan asked for.
  const derived = lthr  ? aerobicCeilingBpm(lthr)
                : maxHr ? Math.round(maxHr * 0.78)  // %HRmax fallback, no LTHR
                : null;
  return derived != null ? { bpm: derived, source: 'derived' } : { bpm: null, source: null };
}

export async function buildWatchToday(
  userId: string,
  /** Override "today" for testing/smoke. Defaults to PT-adjusted now. */
  overrideDate?: string,
): Promise<WatchTodayResponse> {
  // 2026-06-06 · Audit C C6 · runner timezone (profile.timezone), not the
  // deprecated -7h Pacific hack. The hack is correct only for Pacific-PDT;
  // web coach-state migrated to runnerToday on 2026-06-03, watch/iPhone
  // (this builder) had not. Fixes "today's workout" for every non-Pacific user.
  //
  // WATCH-HEAT-DATE-1 (2026-08-25) · the runner's REAL today is resolved even
  // when the caller overrode the date, because one thing on this path is only
  // true for today: the weather. See the heat block in step 6b.
  const actualToday = await runnerToday(userId);
  const today = overrideDate ?? actualToday;
  const isActualToday = today === actualToday;

  // 1. Find today's plan workout
  const plan = (await pool.query(
    `SELECT id, race_id FROM training_plans
      WHERE user_uuid = $1 AND archived_iso IS NULL
      ORDER BY authored_iso DESC LIMIT 1`,
    [userId]
  )).rows[0];
  // 0821 · the lobby's week page. Loaded here so BOTH branches of the
  // response can carry it — a rest day still has a week behind it, and the
  // rest board's own sentence is built out of the same rows. Best-effort:
  // never fail the payload over the week strip.
  // The real today, not `overrideDate` — see `is_today: dISO === today` in
  // `loadPlanWeek`. Same shape as the bug fixed in `app/api/v5/today/route.ts`
  // 2026-08-25: passing one date for both "which day is today" and "which
  // week to window on" marks the OVERRIDDEN date as today instead of the
  // real one, whenever a caller ever passes `overrideDate`.
  const rawWeek: PlanWeekResult | null = await loadPlanWeek(userId, actualToday, today).catch(() => null);
  const weekStrip = rawWeek ? projectWeekStrip(rawWeek) : null;

  if (!plan) {
    // No plan row at all. Off-season is the one this product can NAME: a
    // runner who has been on a race-prep block before is between blocks,
    // not a runner the product has never coached. Mirrors /api/v5/today's
    // own race-mode gate.
    const everRacePrep = (await pool.query(
      `SELECT 1 FROM training_plans
        WHERE user_uuid = $1 AND (mode = 'race-prep' OR race_id IS NOT NULL) LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as unknown[] }))).rows.length > 0;
    return {
      message: "No active plan.",
      weekStrip,
      dayState: buildNoSessionState(everRacePrep ? 'off_season' : 'no_plan', { week: weekStrip, raw: rawWeek, today }),
    };
  }

  // 0821 · injury / sick / travel — the No-session board's reasons. Resolved
  // BEFORE the plan row is read, because an open injury owns the day whether
  // or not the calendar still carries a session for it. When a workout DOES
  // exist it still ships beside this, so a deployed watch runs the session
  // unchanged and a 0821 build draws No session instead.
  // SAFETYSTOP-1 · the canonical owner is asked ONCE, here, and its answer
  // drives both the No-session board and whether a runnable workout may leave.
  //
  // NOT wrapped in `.catch(() => null)`. `resolveSafety` already answers a
  // failed read as `known: false` / `WITHHOLD_PENDING_CHECK`, which is a
  // verdict this code must ACT on — swallowing it into a null would restore
  // exactly the Rule 11 collapse this change removes. If it throws outright
  // that is a real fault and the route's own error handler should see it.
  const safety = await resolveSafety(userId);
  // The outer `.catch(() => null)` that used to sit here is GONE, and the
  // coercion gate is what made me look: it started reporting this line as a
  // blind indirect the moment `loadNoSessionReason` stopped guarding its own
  // reads. It was right. While that function ran two swallowed point reads of
  // its own, the outer catch was redundant; now that injury and illness come
  // from the safety owner, it would be the ONLY handler — swallowing, blind,
  // the one failure nothing else can see.
  //
  // What remains inside that function is the AWAY week-off pair, both still
  // individually guarded with their own argued exemption. So it can now only
  // throw on a programming error, and a programming error on the wrist's
  // critical path should reach the route's handler rather than quietly become
  // "no board".
  const noSession = await loadNoSessionReason(safety, today, String(plan.id));

  // A calendar day can briefly carry more than one row (e.g. an authored rest
  // placeholder plus a run moved in via /api/today/reschedule). Pick the
  // primary RUNNING row over rest/strength so the hero never shows "Rest day"
  // for a day that actually has a run. Mirrors the /api/plan/week priority.
  const wo = (await pool.query(
    `SELECT id::text AS id, date_iso, dow, type, distance_mi, sub_label, workout_spec, pace_target_s_per_mi
       FROM plan_workouts
      WHERE plan_id = $1 AND date_iso = $2::text
      ORDER BY CASE type
                 WHEN 'race' THEN 6 WHEN 'long' THEN 5
                 WHEN 'intervals' THEN 4 WHEN 'tempo' THEN 4 WHEN 'threshold' THEN 4
                 WHEN 'race_week_tuneup' THEN 4 WHEN 'fartlek' THEN 4 WHEN 'progression' THEN 4
                 WHEN 'easy' THEN 3 WHEN 'recovery' THEN 3 WHEN 'shakeout' THEN 3
                 WHEN 'cross' THEN 2 WHEN 'strength' THEN 1 WHEN 'rest' THEN 0 ELSE 2
               END DESC,
               distance_mi DESC
      LIMIT 1`,
    [plan.id, today]
  )).rows[0];

  // `message` stays byte-identical on every one of these branches — it is
  // what every deployed watch renders, and the structured `dayState` beside
  // it is purely additive.
  const noSessionState = noSession
    ? buildNoSessionState(noSession.reason, {
        week: weekStrip, raw: rawWeek, today,
        resumesIso: noSession.resumesIso, injurySite: noSession.injurySite,
      })
    : null;


  if (!wo) {
    return {
      message: "Nothing on the calendar today.",
      weekStrip,
      dayState: noSessionState
        ?? buildNoSessionState('nothing_scheduled', { week: weekStrip, raw: rawWeek, today }),
    };
  }
  if (wo.type === 'rest') {
    return {
      message: "Rest day. Recover hard.",
      weekStrip,
      // A no-session reason outranks a planned rest day: "Week off" is a
      // truer answer than "Nothing today" when the whole window is zeroed.
      dayState: noSessionState ?? buildRestDayState(weekStrip, rawWeek, today),
    };
  }

  const distanceMi = Number(wo.distance_mi) || 0;
  if (distanceMi <= 0) {
    return {
      message: "Rest day. Recover hard.",
      weekStrip,
      dayState: noSessionState ?? buildRestDayState(weekStrip, rawWeek, today),
    };
  }

  // 2. Pull profile inputs for the prescription (LTHR + race goal)
  const prof = (await pool.query(
    `SELECT lthr FROM profile
      WHERE user_uuid = $1
      ORDER BY (user_uuid=$1) DESC LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }))).rows[0];
  const lthr = prof?.lthr ?? null;
  // 2026-08-28 · DEAD READ FIX. This was `SELECT hrmax FROM profile`, a
  // column deprecated by Cluster 3 that nothing writes — NULL for every
  // runner, forever — so the %HRmax fallback for the easy-run HR ceiling
  // below could never fire and an LTHR-less runner got NO HR guidance on
  // the wrist. loadEffectiveMaxHr is the canonical resolver (user override
  // → 12-month observed ceiling → manual stored), same source every other
  // surface uses.
  const maxHr = await import('@/lib/training/max-hr')
    .then((m) => m.loadEffectiveMaxHr(userId, today))
    .then((eff) => eff.bpm)
    .catch(() => null);

  // 2026-07-07 · units audit — loadSettings already defaults to 'mi'/'F'
  // internally on any read failure (settings.ts DEFAULT_SETTINGS), so this
  // never throws; the .catch is belt-and-suspenders consistent with every
  // other best-effort query in this function.
  const unitsDistance = (await loadSettings(userId).catch(() => null))?.units_distance ?? 'mi';

  const raceRow = (await pool.query(
    `SELECT meta FROM races
      WHERE user_uuid = $1
        AND meta->>'priority' = 'A'
        AND meta->>'goalDisplay' IS NOT NULL
        AND (meta->>'date')::date >= $2::date
      ORDER BY (meta->>'date') ASC LIMIT 1`,
    [userId, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const goal_distance_mi = raceRow
    ? (Number(raceRow.meta?.distanceMi) || distanceMiFromLabel(raceRow.meta?.distanceLabel))
    : null;

  /* SECOND-OWNER-1 (2026-09-02) · THE WRIST'S SPEC-LESS TEMPLATE IS PRICED
   * FROM THE CANONICAL ANCHORS, NOT FROM THE RUNNER'S TYPED GOAL.
   *
   * `prescriptionFor` used to be handed `{ lthr, goal_seconds,
   * goal_distance_mi }` and derived its entire pace ladder from
   * `tPaceFromGoal(goal_seconds, goal_distance_mi)`. On the owner's own
   * account that is a 3:00:00 CIM goal producing a 412 s/mi marathon pace
   * against a canonical 472, and a 394 s/mi threshold against 430 — on the
   * device he executes the session on. The goal SECONDS read is deleted along
   * with it; only the race DISTANCE survives, and it sizes fuelling, not pace.
   *
   * `resolvePrescribedPaceAnchors` takes `(userId, today)` and nothing else,
   * so the wrist and the phone are now priced off one resolver. A REFUSED
   * anchor set yields no anchors and the template prescribes by effort — never
   * by a substituted number. */
  const anchorRead = await resolvePrescribedPaceAnchors(userId, today);
  const paceAnchors = anchorRead.ok ? anchorRead.anchors : null;
  if (!anchorRead.ok) {
    logReadFailure(
      `watch/build-workout · pace anchors REFUSED (${anchorRead.reason})`,
      new Error(anchorRead.detail),
    );
  }

  // 3. Weekly mileage — the number `prescriptionFor` doses every quality
  // session against.
  //
  // ── LOWVOL-5 (2026-08-19) · THE PROXY COULD NEVER LOSE ────────────────────
  //
  // This read `Number(weeklyMiRow?.mi) || 30` against a proxy of
  // `Math.max(distanceMi * 6, 25)` and took the HIGHER of the two. Three
  // fabrications stacked: an empty SUM yields NULL → 0 → the `|| 30` asserted a
  // thirty-mile week for a runner with no plan rows at all; the proxy asserted
  // that today's distance is one seventh of a six-day week; and the `Math.max`
  // meant a real, read, ten-mile week could never win against either. A 10
  // mi/wk runner was dosed as a 30 mi/wk runner on every spec-less row.
  //
  // The plan's own summed week IS the week whenever it has rows, so it is used
  // whenever it is non-zero. The proxy stays only for the case it was built
  // for — no rows in the window to read — and is no longer allowed to override
  // a number we actually have.
  //
  // ── WATCH-WEEK-1 (2026-08-25) · TWO SURFACES, TWO WEEKS ──────────────────
  //
  // The window was a hardcoded Monday-to-Sunday span computed right here. The
  // training week in this product does NOT start on Monday: it ENDS on the
  // runner's own long-run day and starts the day after
  // (lib/notifications/week-window.ts:trainingWeekWindow, locked 2026-06-16,
  // one source of truth in /api/plan/week). For a Saturday long-run runner the
  // two windows overlap by five days and disagree about two — so the phone and
  // the wrist doses the SAME quality session against two different weekly
  // volumes, and `prescriptionFor` turns that into a different rep count.
  //
  // `rawWeek` is the shared loader's answer and is already in hand above (the
  // lobby's week strip is built from it), so this reads its window rather than
  // deriving a second one. The Monday math survives ONLY as the fallback for a
  // runner whose week could not be loaded at all — an unknown window is worse
  // than an approximate one, but it must not be the default.
  const todayDow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = todayDow === 0 ? 6 : todayDow - 1;
  const planWeekStart = rawWeek?.week_start_iso ?? null;
  const planWeekEnd = rawWeek?.week_end_iso ?? null;
  const weeklyMiRow = (await (planWeekStart && planWeekEnd
    ? pool.query(
        `SELECT SUM(distance_mi)::numeric AS mi FROM plan_workouts
          WHERE plan_id = $1
            AND date_iso::date BETWEEN $2::date AND $3::date`,
        [plan.id, planWeekStart, planWeekEnd],
      )
    : pool.query(
        `SELECT SUM(distance_mi)::numeric AS mi FROM plan_workouts
          WHERE plan_id = $1
            AND date_iso::date BETWEEN ($2::date - $3::int) AND ($2::date - $3::int + 6)`,
        [plan.id, today, daysSinceMonday],
      ))
    // LOWVOL-5 · a failed read is unknown, not thirty miles. It still falls to
    // the proxy below, same as an empty window, so it logs — otherwise a
    // fabricated weekly volume and a genuinely planless week are one value.
    .catch((e) => { logReadFailure('watch/build-workout · weekly mi', e); return { rows: [{ mi: null }] }; })).rows[0];
  const realWeeklyMi = Number(weeklyMiRow?.mi) || 0;
  const proxyWeeklyMi = Math.max(distanceMi * 6, 25);
  const weeklyMi = realWeeklyMi > 0 ? realWeeklyMi : proxyWeeklyMi;

  // 4. Generate the same prescription the iPhone modal uses · used as
  //    a fallback (and to source the headline / pacing strings when
  //    workout_spec is absent).
  //
  // WATCH-TYPE-1 (2026-08-25) · this was `wo.type as WorkoutType`, and the
  // cast was lying. `prescriptionFor`'s switch implements nine types; the
  // generator emits at least five more. `race_week_tuneup`, `fartlek`,
  // `progression`, `recovery` and `vo2max` reached the `default` arm and came
  // back as `total_mi: 0`, headline "No workout scheduled" — which is not an
  // internal detail on this path, because `summary` is built from that
  // headline UNCONDITIONALLY. A runner standing at the door on race-week
  // tune-up morning read "5.0 mi · No workout scheduled" on their wrist. When
  // the row also had no `workout_spec` to expand, `prescription.steps` was
  // empty too, so the whole session collapsed to one open 9:00/mi work phase
  // carrying that same headline as its label and no pace target at all.
  //
  // `narrowToPrescriptionType` is the phone's own narrowing, lifted into
  // `prescriptions.ts` on 2026-08-24 for exactly this caller and then not
  // wired to it. A tune-up is a threshold session, a fartlek and a
  // progression are tempo, a recovery run is easy, a vo2max is intervals.
  const prescriptionType = narrowToPrescriptionType(wo.type);
  const prescription = prescriptionFor(
    prescriptionType,
    weeklyMi,
    { lthr, anchors: paceAnchors, raceDistanceMi: goal_distance_mi },
    distanceMi,
  );

  const sessionClass = classifySession(
    wo.type,
    (wo.workout_spec ?? null) as Record<string, unknown> | null,
  );

  // Tolerance · THE owner, not a literal. `lib/training/execution-semantics.ts`
  // holds the one table; this used to be one of five copies that had already
  // drifted apart (see that module's header for the spread and the doctrine).
  const defaultTolerance = sessionToleranceSec(sessionClass);

  // 5. Expand to phases · PREFER workout_spec (authored truth) over
  //    prescriptionFor() (generic template). Per iPhone agent's
  //    2026-06-02 brief · workout_spec is the single source of truth.
  //    When the spec is absent (pre-migration rows, easy/rest days
  //    without quality structure), fall back to the prescription
  //    template so older plans + simple types still render.
  const phases: WatchPhase[] = [];
  // Easy-pace anchor · P1-47 fix 2026-07-06. WU/CD/recovery targets must be
  // the runner's OWN easy pace, not goal race pace + 90 or a 9:00/mi
  // constant (a no-goal 12:00/mi runner was handed a 9:00/mi warmup target;
  // an ambitious slow runner was pushed even harder). The plan's authored
  // easy/long spec bands ARE the runner's E-pace — the generator derives
  // them from current fitness (bestRecentVdot → T-pace + 80..120 · PACE-E-1
  // · Research/01-pace-zones-vdot.md §E-pace). Prefer the nearest easy spec
  // in THIS plan, then the nearest long spec (long IS easy effort · Rule 16
  // in spec-builder). No band anywhere → null → expandSpecToPhases emits
  // by-feel phases (no pace target) instead of a fabricated number.
  const easyBandRow = (await pool.query<{ lo: number | null; hi: number | null }>(
    `SELECT (workout_spec->>'pace_target_s_per_mi_lo')::float AS lo,
            (workout_spec->>'pace_target_s_per_mi_hi')::float AS hi
       FROM plan_workouts
      WHERE plan_id = $1
        AND workout_spec->>'kind' IN ('easy', 'long')
        AND workout_spec->>'pace_target_s_per_mi_lo' IS NOT NULL
        AND workout_spec->>'pace_target_s_per_mi_hi' IS NOT NULL
      ORDER BY (workout_spec->>'kind' = 'easy') DESC,
               ABS(date_iso::date - $2::date) ASC,
               -- EASYBAND-TIE-1 (2026-09-01) · same tiebreak as the
               -- identical query in app/api/v5/today/route.ts — on an exact
               -- distance tie, prefer the FUTURE neighbor. Recompute only
               -- ever rewrites unsealed rows with date_iso >= "today", so a
               -- future row can never be staler than a past one. Must stay
               -- identical to the phone's query (see header comment above).
               (date_iso::date > $2::date) DESC
      LIMIT 1`,
    [plan.id, today]
  ).catch(() => ({ rows: [] }))).rows[0];
  const easyPaceAnchor = easyBandRow && easyBandRow.lo != null && easyBandRow.hi != null
    ? Math.round((Number(easyBandRow.lo) + Number(easyBandRow.hi)) / 2)
    : null;
  /* WU/CD-CEIL-1 (2026-09-01) · `lo` is the FAST edge of the authored band —
   * the ceiling `docs/PRODUCT_DECISIONS.md` 2026-08-31 says a warm-up or
   * cool-down should be judged against, not the midpoint above. Mirrors the
   * identical fix in `app/api/v5/today/route.ts` so the watch and the phone
   * carry the SAME warm-up/cool-down target (Rule 16) instead of the phone
   * moving off the old reused-midpoint number while the watch stayed on it. */
  const easyCeilingSec = easyBandRow && easyBandRow.lo != null
    ? Math.round(Number(easyBandRow.lo))
    : null;
  const expanded = wo.workout_spec
    ? expandSpecToPhases({
        spec: wo.workout_spec,
        totalMi: distanceMi,
        easyPaceSec: easyPaceAnchor,
        easyCeilingSec,
        // RECOVERY-BYFEEL-1 (2026-09-01) · this anchor no longer reaches the
        // rep-to-rep jog inside `expandReps`/`expandSteps` — see the field
        // doc on `ExpandSpecInput.recoveryPaceSec`. A jog between reps of the
        // same session now goes by feel, on the wrist as on the phone.
        recoveryPaceSec: easyPaceAnchor,
        toleranceSec: defaultTolerance,
        workPhaseLabel: wo.type === 'race'     ? 'Race effort'
                      : wo.type === 'shakeout' ? 'Shakeout'
                      : undefined,
      })
    : null;
  // HR target for work phases on quality sessions: prefer spec-embedded HR field
  // (snapshot from plan generation) → fall back to live profile lthr → null.
  // Field precedence: intervals/threshold → lthr_bpm; tempo → hr_target_bpm.
  // Both fields are present in the spec depending on type (spec-builder.ts emits
  // lthr_bpm for threshold/intervals, hr_target_bpm for tempo). COALESCE both
  // so the watch matches what glance-adapter, seed, and recap already read.
  // Gated to intervals/threshold/tempo so easy/long work phases never show a
  // quality HR target (those sessions use hrCeilingBpm at the workout level).
  //
  // B7 (2026-09-02) · `lthr_bpm` IS AN ANCHOR, `hr_target_bpm` IS A TARGET.
  // The old COALESCE read them as one quantity, and `spec-builder` writes
  // `lthr_bpm: lthr` verbatim — the runner's raw LTHR. So a threshold row on
  // the reference runner's live block carried WORK TARGET 168 beside its own
  // pass rule of `avgHr <= 164`: the wrist asked for a heart rate the row then
  // marked as a fail. One name for two quantities is what let that stand
  // (Rule 16); they are read apart now and the anchor goes to the owner.
  const specTargetBpm = wo.workout_spec
    ? (Number((wo.workout_spec as Record<string, unknown>)?.hr_target_bpm) || null)
    : null;
  const specAnchorBpm = wo.workout_spec
    ? (Number((wo.workout_spec as Record<string, unknown>)?.lthr_bpm) || null)
    : null;
  const isQualityWorkout = sessionClass === 'threshold' || sessionClass === 'interval';
  const isIntervalWorkout = sessionClass === 'interval';
  // B7 (2026-09-02) · THE WRIST NO LONGER OWNS AN HR DERIVATION.
  //
  // Three fractions lived here — `maxHr * 0.95`, `maxHr * 0.87` and the
  // interval uplift `rawHrTarget * 1.05`. All three are now resolved by
  // `prescribedHrTargetBpm` in `lib/training/zones.ts`, the zone owner, from
  // the doctrine tables it already holds. The values are unchanged: §8's
  // I-row floor (0.95) and the long-standing conservative T figure (0.87) for
  // the %HRmax lane, and the centre of Friel Z5b ("Aerobic capacity, VO2max
  // work 3-5 min", 103-106% LTHR) for the interval uplift — which is 1.05,
  // exactly the multiplier that was typed here.
  //
  // The uplift is the one worth naming: `rawHrTarget * 1.05` did not match a
  // scan for `lthr * <fraction>`, so a fraction of LTHR was being applied on
  // the wrist that the ownership gate could not see at all.
  //
  // WATCH-TYPE-1 · the second arm read the RAW column (`wo.type === 'tempo'`)
  // while the gate above it reads `sessionClass`. Same doctrine row, two
  // answers: a `threshold` row, a `race_week_tuneup`, a `fartlek` and a
  // `progression` are all T-intensity and all fell through to null, so a
  // runner with no LTHR on file got an HR reference on a tempo and none on
  // the identical threshold session. Keyed off the class, like its gate.
  const workIntensity = isIntervalWorkout ? 'interval' as const : 'threshold' as const;
  // The anchor this row was authored against, else the live profile. An
  // authored anchor wins so the wrist and the plan cannot be priced off two
  // different LTHRs on the same session.
  const effectiveLthr = isQualityWorkout ? (specAnchorBpm ?? lthr ?? null) : null;
  const workHrTargetBpm: number | null = !isQualityWorkout
    ? null
    // A row that carries an explicit TARGET is honoured verbatim — the plan
    // already asked the owner for it, and re-deriving here would be a second
    // answer to a settled question.
    : specTargetBpm
      ?? prescribedHrTargetBpm({ intensity: workIntensity, lthr: effectiveLthr, maxHr })?.bpm
      ?? null;

  if (expanded && expanded.length > 0) {
    // workout_spec drove the phase list · convert ExpandedPhase →
    // WatchPhase (same shape, just need to add haptic + repUnit + hrTargetBpm).
    for (const p of expanded) {
      const phaseDurationSec = p.durationSec ?? Math.round((p.distanceMi ?? 0) * (p.targetPaceSPerMi ?? 540));
      const phaseHrTargetBpm = p.type === 'work' ? workHrTargetBpm : null;
      // TREADMILL-HILL-1 · see WatchPhase.treadmillInclinePct's doc comment.
      // Scoped to WORK phases the phase's own label names as a hill rep and
      // that carry no pace target at all — never a paced phase (redundant)
      // and never a non-hill effort phase (no doctrine band to convert).
      let treadmillInclinePct: number | null = null;
      let treadmillSpeedMph: number | null = null;
      if (p.type === 'work' && p.targetPaceSPerMi == null && /hill/i.test(p.label)
          && paceAnchors?.thresholdSecPerMi && paceAnchors?.intervalSecPerMi) {
        const DOCTRINE_HILL_INCLINE_PCT = 5; // Research/04 §8.3 · medium hill repeats, midpoint of the 4-6% band
        const flatTargetSPerMi = Math.round((paceAnchors.thresholdSecPerMi + paceAnchors.intervalSecPerMi) / 2);
        const effGrade = treadmillEffectiveGradePct(DOCTRINE_HILL_INCLINE_PCT);
        const gradedPaceSPerMi = Math.round(terrainAdjustedTargetSPerMi(flatTargetSPerMi, effGrade, 'treadmill'));
        if (gradedPaceSPerMi > 0) {
          treadmillInclinePct = DOCTRINE_HILL_INCLINE_PCT;
          treadmillSpeedMph = Math.round((3600 / gradedPaceSPerMi) * 10) / 10;
        }
      }
      /* TREADMILL-STRUCTURE-1 (2026-09-03) · warm-up, recovery and cooldown
       * used to leave incline/speed null, so the treadmill screen's OWN
       * unexplained flat default (1.0mph belt speed, 1% incline hardcoded in
       * Swift with no citation) filled the gap. David's ask: "intentional
       * treadmill incline values... rather than relying on an unexplained
       * client default." `TREADMILL_AIR_RESISTANCE_GRADE_PCT` — 1% is the
       * doctrine constant this app already uses everywhere else to mean "a
       * treadmill at this incline runs like flat outdoor ground" (its own
       * comment: "a treadmill run at 1% is a FLAT run, not a 1% climb") — so
       * it is the correct, cited incline for every NON-hill treadmill phase,
       * not a guess reinvented here. `treadmillEffectiveGradePct(1)` floors
       * to 0, so the pace conversion is a no-op on the number; the point is
       * that 1% now arrives as a named, sourced server value instead of an
       * undocumented client constant.
       *
       * Warm-up / cooldown already carry a real pace target (`p.targetPaceSPerMi`)
       * — convert IT through the same terrain math the hill reps use, rather
       * than inventing a second formula.
       *
       * Recovery carries no pace target at all (it is a jog, not a paced
       * segment) — priced off `paceAnchors.shakeoutCeilingSecPerMi`, doctrine's
       * own recovery-jog band, the same anchor `establishedPaceFor` uses for a
       * shakeout/recovery domain elsewhere in this codebase. Never priced off
       * the work-rep pace: a recovery jog run at hill-rep speed would not
       * recover anything. */
      if (treadmillInclinePct == null) {
        const TREADMILL_NON_HILL_INCLINE_PCT = 1; // TERRAIN.treadmill-air-resistance-grade
        let flatBasisSPerMi: number | null = null;
        if ((p.type === 'warmup' || p.type === 'cooldown') && p.targetPaceSPerMi != null && p.targetPaceSPerMi > 0) {
          flatBasisSPerMi = p.targetPaceSPerMi;
        } else if (p.type === 'recovery' && paceAnchors?.shakeoutCeilingSecPerMi) {
          flatBasisSPerMi = paceAnchors.shakeoutCeilingSecPerMi;
        }
        if (flatBasisSPerMi != null && flatBasisSPerMi > 0) {
          const effGrade = treadmillEffectiveGradePct(TREADMILL_NON_HILL_INCLINE_PCT);
          const gradedPaceSPerMi = Math.round(terrainAdjustedTargetSPerMi(flatBasisSPerMi, effGrade, 'treadmill'));
          if (gradedPaceSPerMi > 0) {
            treadmillInclinePct = TREADMILL_NON_HILL_INCLINE_PCT;
            treadmillSpeedMph = Math.round((3600 / gradedPaceSPerMi) * 10) / 10;
          }
        }
      }
      phases.push({
        type: p.type,
        label: p.label,
        durationSec: phaseDurationSec,
        targetPaceSPerMi: p.targetPaceSPerMi ?? null,
        // PACE-SHAPE-1 · the tolerance and the shape come from ONE owner, and
        // they are asked the same question with the same arguments, so they
        // cannot disagree about whether this phase is pace-graded at all.
        tolerancePaceSPerMi: phaseToleranceSec(p.type, sessionClass, {
          hasTarget: p.targetPaceSPerMi != null && p.targetPaceSPerMi > 0,
          byEffort: p.isStrideSegment === true,
        }),
        paceShape: paceShapeFor(p.type, sessionClass, {
          hasTarget: p.targetPaceSPerMi != null && p.targetPaceSPerMi > 0,
          byEffort: p.isStrideSegment === true,
        }),
        haptic: p.type === 'warmup'   ? 'start'
              : p.type === 'recovery' ? 'transition-recovery'
              : p.type === 'cooldown' ? 'transition-cooldown'
              :                         'transition-work',
        repUnit: p.distanceMi != null ? 'distance' : 'time',
        distanceMi: p.distanceMi ?? null,
        hrTargetBpm: phaseHrTargetBpm,
        hrRole: phaseHrTargetBpm != null ? hrRoleForRepDuration(phaseDurationSec) : null,
        treadmillInclinePct,
        treadmillSpeedMph,
        // Emit ONLY when true so non-finish phases omit it on the wire
        // (JSON.stringify drops undefined) — keeps the optional-field contract.
        isFinishSegment: p.isFinishSegment ? true : undefined,
        isStrideSegment: p.isStrideSegment ? true : undefined,
      });
    }
  } else {
    // Fallback · workout_spec absent or unrecognized kind.
    for (const step of prescription.steps) {
      phases.push(...stepToPhases(step, sessionClass));
    }
  }
  if (phases.length === 0) {
    // Last-resort fallback: single open work phase covering the planned distance
    phases.push({
      type: 'work',
      label: prescription.headline,
      durationSec: Math.round(distanceMi * 9 * 60),
      targetPaceSPerMi: null, tolerancePaceSPerMi: null, paceShape: 'none',
      haptic: 'start', repUnit: 'distance', distanceMi,
    });
  }

  // 6. Patch haptics: first phase = 'start', last phase = 'transition-cooldown'
  //    (the engine treats the last cooldown as the wind-down marker)
  if (phases.length > 0) {
    phases[0].haptic = 'start';
    const last = phases[phases.length - 1];
    if (last.type === 'cooldown') last.haptic = 'transition-cooldown';
  }

  // 6b. Heat · David 2026-08-24, decision 1: current temperature, or this
  //     feature does not get built. Runs AFTER the phase list is final and
  //     BEFORE totals are computed, so an eased distance phase's estimate
  //     moves with its target. Race is skipped inside; every failure path
  //     leaves the phases untouched. See lib/watch/heat.ts.
  //
  // ── WATCH-HEAT-DATE-1 (2026-08-25) · TOMORROW'S BAND, TODAY'S WEATHER ────
  //
  // This endpoint takes an optional `?date=`, and the PHONE uses it: tapping
  // any tile in the week strip calls `API.fetchWatchWorkout(date:)`
  // (TodayView.swift:701 and :3263) to preview that day's session. `today` is
  // then the tile's date, but `adjustPhasesForHeat` reads CURRENT conditions —
  // the only conditions there are. Two things followed, and both are the
  // failure this whole mechanism was built to stop:
  //
  //   1. The preview showed Thursday's targets eased by Monday's temperature,
  //      with a `heatNote` naming Monday's degrees as though they were
  //      Thursday's. A number the runner cannot check, presented as fact.
  //   2. Worse, `recordHeatEasing` then WROTE that easing against Thursday's
  //      date. Come Thursday the pre-run card read it back and eased a cool
  //      morning's band, and the recap read `targetAlreadyHeatEased` and
  //      declined to price the heat that was actually there. One tap on a
  //      future tile silently corrupted that day's whole heat ledger — and
  //      tapping a PAST tile did the same to a run already in the book.
  //
  // Current conditions are evidence about NOW. On any other date there is no
  // observation, so there is no adjustment and nothing is recorded: the
  // preview shows the authored band and says nothing about weather. RULE
  // THREE — a refusal is a correct answer.
  // TURNED OFF · David 2026-08-26, reversing the 2026-08-24 decision above
  // after running under it: "it changed the paces based on that weather. I
  // dont want to do that." The band the lobby shows is the authored one,
  // full stop — no live weather read, no easing, no note. `heat.ts` and
  // `recordHeatEasing` are left in place rather than deleted; this is the
  // one call site that turns the mechanism on, and it is now permanently
  // off. `preHeatSec` and `heat` stay so the totals math three lines below
  // doesn't need its own special case for a heat-less phase list.
  const preHeatSec = phases.reduce((s, p) => s + p.durationSec, 0);
  const heat = null as Awaited<ReturnType<typeof adjustPhasesForHeat>> | null;
  // Remember what we asked for, so the recap does not price the same heat a
  // second time when it grades this run against the band we just eased.
  // Fire-and-forget: see lib/watch/heat.ts.
  //
  // `today` here is NOT necessarily today. It is `overrideDate ?? runnerToday`,
  // and the phone passes `?date=` whenever it previews another day's workout,
  // while `adjustPhasesForHeat` above reads CURRENT conditions with no date at
  // all. Recording unconditionally therefore stamped, for example, a
  // `heat-<Saturday>` easing computed from Wednesday's weather. That is the
  // production data: 40 rows in one day across nine date keys, past and future.
  //
  // `recordHeatEasing` now refuses any date that is not the runner's today and
  // writes once per decision instead of once per call, so a preview still SHOWS
  // its easing and simply leaves no coaching record behind. The guard lives in
  // heat.ts rather than here on purpose: this is one of two callers of the
  // easing path, and a rule that only some callers apply is the shape of the
  // bug, not the fix.
  //
  // Firing a write from a GET handler is defensible once both guards hold. The
  // record is not a decision about the runner; it is a receipt for the payload
  // THIS request just handed the watch, and no other process knows what was
  // handed over. It is idempotent, scoped to the day being lived, and never
  // blocks the response.
  if (heat?.applied) void recordHeatEasing(userId, today, heat);

  // 7. Workout-level fields
  const totalSec = phases.reduce((s, p) => s + p.durationSec, 0);
  const totalEstimatedMinutes = Math.round(totalSec / 60);
  // 2026-06-07 · Audit D / D1 · long runs with an HM/M finish segment
  // suppress the easy HR ceiling + foreground pace. The finish is run at
  // race pace (HR well above the 89%-LTHR easy ceiling), so a workout-level
  // ceiling would red-alert through the entire finish — coaching the
  // opposite of the prescription. The easy build is run by feel.
  const longHasFinish = sessionClass === 'long'
    && wo.workout_spec != null
    && Number((wo.workout_spec as Record<string, unknown>)?.finish_mi) > 0;
  // The ceiling the runner runs under, and where it came from. See
  // `resolveHrCeiling` — spec first, live derivation only when the plan
  // authored none, and the two are never presented as the same fact.
  const specCeilingBpm = wo.workout_spec
    ? Number((wo.workout_spec as Record<string, unknown>)?.hr_cap_bpm) || null
    : null;
  const ceiling = resolveHrCeiling({ sessionClass, longHasFinish, specCeilingBpm, lthr, maxHr });
  const hrCeilingBpm = ceiling.bpm;
  const hrCeilingSource = ceiling.source;

  /* SPECSUMMARY-1 (2026-09-01) · the summary describes THE SPEC, not a template.
   *
   * This was `${distanceMi.toFixed(1)} mi · ${prescription.headline}`, and
   * `prescription` is `prescriptionFor(...)` — the generic template whose rep
   * distance is a literal and whose rep count is dosed off weekly mileage.
   * SPECFIRST-1 closed exactly this split for the phone's card on 2026-08-24
   * (`lib/training/spec-card.ts`'s header records the 40-of-41 measurement)
   * and never reached this line, so the wire kept describing a different
   * workout: "Intervals · 6 × 800m" over ten 60-second hills, "Threshold ·
   * 4 × 1 mile reps" over nine sub-threshold kilometres, and a marathon-pace
   * finish over four long runs whose specs carry none.
   *
   * `specFamilyPhrase` is the ONE owner of that phrase and it names a family
   * rather than a structure — the structure is `workout.name`, which is the
   * authored `sub_label`, and saying it twice is Rule 17.
   *
   * The template survives as the fallback for a row with NO spec, which is
   * its stated job (`expand-spec.ts`'s header: "prescriptionFor() becomes a
   * fallback ONLY when spec is null"). `expanded` is the same discriminator
   * the phase list above already routed on, so the summary can no longer
   * describe a session the phases do not run. */
  const summary = expanded && expanded.length > 0
    ? `${distanceMi.toFixed(1)} mi · ${specFamilyPhrase(wo.workout_spec, prescriptionType)}`
    : `${distanceMi.toFixed(1)} mi · ${prescription.headline}`;

  const workout: WatchWorkout = {
    workoutId: `${userId}-${today}`,
    name: wo.sub_label || labelFor(wo.type),
    summary,
    totalEstimatedMinutes,
    phases,
    completionEndpoint: `${DEFAULT_BASE_URL}/api/watch/workouts/complete`,
    // 2026-06-02 · Flag 6 from watch audit · sliding 14h window from
    // issue time. Replaces the end-of-day-UTC stamp that clipped
    // runners starting workouts near midnight UTC even when they
    // were inside the real "today" window. Watch agent enforces this
    // on start (refuses + re-fetches when stale). Covers:
    //   · early-AM (issued 6PM → valid until 8AM next-day)
    //   · late-PM (issued 8AM → valid until 10PM same-day)
    // 14h covers both extremes. Doctrine:
    //   designs/briefs/backend-response-to-watch-2026-06-02.md
    //
    // 2026-06-09 · race-killer F5 — RACE payloads get end-of-day validity
    // instead. The 14h guard exists to stop *yesterday's training run*
    // recording against today's plan; on race morning it inverts into
    // "phone dead at the corral + last sync > 14h → watch refuses to
    // start THE RACE" (WorkoutRootView.swift:51). A race workout is
    // pinned to its calendar date, so the stale-day risk the guard
    // covers doesn't exist — validity through end-of-day-+8h closes the
    // corral-refusal hole without re-opening Flag 6 for training days.
    //
    // 2026-06-09 · RK-2 · no fractional seconds in either form: deployed
    // watch builds parse expiresAt with a default ISO8601DateFormatter,
    // which rejects ".000Z" — the gate had never fired on fractional
    // stamps, making F5's expiry (and Flag 6 itself) dead on arrival.
    expiresAt: (wo.type === 'race'
      ? new Date(Date.parse(today + 'T23:59:59Z') + 8 * 3600 * 1000).toISOString()
      : new Date(Date.now() + 14 * 3600 * 1000).toISOString()
    ).replace(/\.\d{3}Z$/, 'Z'),
    distanceMi,
    paceLabel: paceLabelFor(wo.type),
    isRace: wo.type === 'race',
    hrCeilingBpm,
    hrCeilingSource,
    // Long runs foreground HR (the easy-aerobic discipline) — EXCEPT when
    // they carry an HM/M finish, where pace is the target (D1).
    //
    // WATCH-TYPE-1 · keyed off `sessionClass`, not the raw column, so it can
    // no longer disagree with `longHasFinish` and `hrCeilingBpm` — both of
    // which already read the class. A row typed `easy` whose spec says
    // `kind: 'long'` used to get the long-run ceiling and the easy-run hint at
    // the same time, and the lobby ramp reads this field when the pace label
    // does not settle it (WatchRouterV5.swift:1337).
    displayHint: sessionClass === 'long'      ? (longHasFinish ? 'pace' : 'hr')
             : sessionClass === 'threshold'   ? 'tempo'
             : null,
    unitsDistance,
    // Null unless the targets above were actually eased. `heatNote` returns
    // null for every not-applied outcome, so this cannot claim an adjustment
    // that did not happen.
    heatNote: heat ? heatNote(heat) : null,
  };

  // 2026-06-09 Phase 2 (3.2) · thread contingency rules from the spec.
  // Workout-level array for breach detection + the bail label pinned on
  // the phases it scopes to (work phases for quality, the finish segment
  // for longs). Optional + additive on the wire · old builds ignore both.
  const specRules = Array.isArray((wo.workout_spec as Record<string, unknown> | null)?.rules)
    ? ((wo.workout_spec as Record<string, unknown>).rules as Array<Record<string, unknown>>)
    : null;
  if (specRules && specRules.length > 0) {
    // 0821 · B7 · evidence and judgement ride BESIDE the untouched label.
    // Spread-then-add: nothing the spec authored is dropped or rewritten,
    // and a deployed watch reading only `label` sees exactly what it saw.
    const decorated: Array<Record<string, unknown>> =
      specRules.map((r) => ({ ...r, ...splitRuleRegisters(r) }));
    workout.rules = decorated;
    const bail = decorated.find((r) => r.kind === 'bail');
    if (bail) {
      const registers = splitRuleRegisters(bail);
      for (const p of workout.phases) {
        const scoped = (bail.scope === 'work' && p.type === 'work' && !p.isFinishSegment)
          || (bail.scope === 'finish' && p.isFinishSegment);
        if (!scoped) continue;
        p.ruleLabel = String(bail.label);
        p.ruleEvidence = registers.evidence;
        p.ruleJudgement = registers.judgement;
      }
    }
  }

  // 2026-06-09 · race-killers F3 + F16 — make the race payload race-ready.
  if (wo.type === 'race') {
    // The goal belongs to THE race this plan targets (plan.race_id), not
    // "the next priority-A race" loaded above for prescription templates —
    // on a B-race day those diverge and the watch would pace the wrong race.
    // ── MIDGOAL-2 (2026-08-30) · THE RACE ON THE START LINE, NOT THE ONE ────
    //                              THE BLOCK IS BUILT FOR
    //
    // Both of the old sources named the runner's GOAL race, never the race
    // they are actually standing on:
    //   · `plan.race_id` is the block's target (David's block: CIM).
    //   · `raceRow` is "next priority-A race carrying a goal" — CIM again.
    // A mid-block tune-up is embedded as a `race` row (MIDRACE-1) and is by
    // definition neither. So on the Santa Monica 10K start line the watch
    // resolved CIM's meta and shipped a 3:00:00 marathon goal on a 10K:
    // `workout.goalSec` fed LiveRaceFace's goal-delta row, `strategyLabel`
    // read "3:00:00 goal", and the gel ladder was sized and filtered at 26.22
    // miles. Only the pace target escaped, and only because the
    // `|raceDistMi - distanceMi| < 0.5` guard below happened to fail closed.
    //
    // The race a runner is running today is the one whose date is today.
    // `plan_workouts` carries no race identity of its own, so the date IS the
    // join, and it is exact: the embedder only ever converts the day the race
    // falls on. Falls back to the old chain, so a plan whose race day is the
    // target race resolves exactly as before.
    // `rowOrNull`, not `.catch(() => [])`: this read decides WHICH RACE the
    // watch paces, so "no race is dated today" and "the lookup failed" must
    // not be the same value (lib/db/read.ts · a failure is not an answer).
    // Both still fall through to the plan race, but only one of them is silent.
    const todaysRace = await rowOrNull<{ slug: string; meta: Record<string, unknown> | null }>(
      'watch/todays-race',
      pool.query(
        `SELECT slug, meta FROM races
          WHERE user_uuid = $1 AND meta->>'date' = $2
          ORDER BY (meta->>'priority' = 'A') DESC LIMIT 1`,
        [userId, wo.date_iso ?? today],
      ),
    );
    const planRace = plan.race_id
      ? (await pool.query<{ meta: Record<string, unknown> | null }>(
          `SELECT meta FROM races WHERE user_uuid = $1 AND slug = $2 LIMIT 1`,
          [userId, String(plan.race_id)],
        ).catch(() => ({ rows: [] }))).rows[0]
      : null;
    const raceMeta = (todaysRace?.meta ?? planRace?.meta ?? raceRow?.meta ?? null) as Record<string, unknown> | null;
    const statedGoalSec = raceMeta ? parseRaceGoalSec(raceMeta.goalDisplay as string) : null;
    const raceDistMi = raceMeta
      ? (Number(raceMeta.distanceMi) || distanceMiFromLabel(raceMeta.distanceLabel as string | null) || distanceMi)
      : distanceMi;

    // 2026-08-17 · coaching-loop reconciliation · the watch paces the
    // EFFECTIVE target, never a goal >5% faster than the current
    // projection. The stated goal is the stretch; a runner chasing a
    // fantasy split card from the gun is the §18.2 blow-up (Research/08).
    // No snapshot → goal fallback. Resolver: lib/race/effective-race-target.ts.
    let raceGoalSec = statedGoalSec;
    if (statedGoalSec != null && raceDistMi > 0) {
      try {
        const { loadEffectiveRaceTarget } = await import('@/lib/race/effective-race-target');
        const eff = await loadEffectiveRaceTarget(userId, statedGoalSec, raceDistMi, {
          slug: todaysRace?.slug ?? (plan.race_id ? String(plan.race_id) : null),
        });
        raceGoalSec = eff.targetSec;
        // 2026-09-01 · P0 · race-day HR guidance rides along, additive. The
        // wrist may show the expected range; it never alarms on it.
        const hr = eff.outlook?.execution.hr ?? null;
        if (hr) {
          workout.raceHr = {
            expectedLoBpm: hr.expectedRangeBpm[0],
            expectedHiBpm: hr.expectedRangeBpm[1],
            earlyCeilingBpm: hr.earlyCeilingBpm,
            earlyThroughMi: hr.earlyThroughMi,
            lateAllowanceBpm: hr.lateAllowanceBpm,
            checkpointMi: hr.checkpointMi,
            checkpointAbortBpm: hr.checkpointAbortBpm,
            informationalOnly: hr.informationalOnly,
          };
        }
      } catch { /* resolver is additive — stated goal stands on failure */ }
    }

    // MIDGOAL-2 · a race the runner never gave a time to still gets a number
    // to run, from the same derivation the plan row and the race screen use
    // (lib/race/coach-goal.ts behind loadCoachGoalForRace) — never a second
    // one. Only reached when there is no stated goal, and the loader refuses
    // on its own the instant one exists, so a stated goal can never be
    // renegotiated here. An effort framing (a C race, a mountain course)
    // returns no time and the watch carries no goal, which is the doctrine
    // answer rather than a gap. Fail-open: a throw leaves raceGoalSec null,
    // byte-identical to before.
    let raceGoalIsCoachSet = false;
    if (raceGoalSec == null && todaysRace && raceDistMi > 0) {
      try {
        const { loadCoachGoalForRace } = await import('@/lib/race/coach-goal-load');
        const meta = raceMeta ?? {};
        const coach = await loadCoachGoalForRace(userId, {
          slug: todaysRace.slug,
          name: (meta.name as string | null) ?? todaysRace.slug,
          priority: (meta.priority as string | null) ?? null,
          statedGoalSec: null,
          distanceMi: raceDistMi,
          metaTerrain: meta.terrain,
          elevationGainFt: meta.elevationGainFt != null ? Number(meta.elevationGainFt) : null,
          goalFraming: meta.goalFraming,
          daysAway: 0,
        });
        // B is the tier a race is paced off · Research/20 §A/B/C, the same
        // tier the plan row took. A and C are the edges of the band, not the
        // number to run.
        if (coach && coach.kind === 'time') {
          raceGoalSec = coach.bSec;
          raceGoalIsCoachSet = true;
        }
      } catch { /* additive */ }
    }

    // F3 · the race face's pace target is the runner's stated GOAL pace,
    // not the spec band midpoint. Race rows stash kind:'long' with a
    // T-anchored band (e.g. AFC: lo 397 / hi 412 → expandLong mid = 405
    // = 6:45/mi — 7 s/mi faster than the 1:30 goal and ~29 s/mi faster
    // than fitness pace). A runner obeying "on target" at the midpoint
    // through an early descent blows up late.
    //
    // When the course library carries an authored phase profile, go one
    // better: expand the race into one work phase PER COURSE PHASE with
    // grade-adjusted targets (lib/race/pacing.ts · cite Research/11
    // §grade-cost). The watch's existing phase machinery renders this
    // with zero watch-side changes — per-phase target on LiveRaceFace,
    // strip segments per course phase, haptic at each terrain change.
    // Fallback: single work phase at flat goal pace. A deliberately
    // multi-phase race SPEC (none exist today) is left untouched.
    const specWorkPhases = workout.phases.filter((p) => p.type === 'work');
    if (raceGoalSec && specWorkPhases.length === 1 && Math.abs(raceDistMi - distanceMi) < 0.5) {
      let coursePhases: WatchPhase[] | null = null;
      try {
        // MIDGOAL-3 (2026-08-30) · the LAST `?? plan.race_id` on this path.
        //
        // MIDGOAL-2 fixed `goalSec`, `strategyLabel` and the gel ladder to
        // resolve the race the runner is standing on rather than the one the
        // block is built for. This line was left, and it is the same defect
        // wearing the same disguise: the runner's Santa Monica 10K on
        // 2026-09-13 carries no `courseSlug`, so this resolved to `plan.race_id`
        // — `cim` — and asked the course library for a TWENTY-SIX MILE
        // marathon profile to pace a 10K with.
        //
        // It does not currently reach the wrist, and the reason is worth
        // stating because it is not a reason to leave it: `usablePhases`
        // (lib/race/pacing.ts) refuses geometry whose length misses the race
        // distance by more than 0.6 mi, so CIM's 26.2 fails against 6.2 and
        // the payload falls through to flat goal pace. That is the identical
        // accident MIDGOAL-2 recorded about the pace target — *"only the pace
        // target escaped, and only because a distance guard happened to fail
        // closed."* A guard that saves this one because a marathon is not a
        // 10K stops saving it the moment the block's race and the tune-up are
        // the same distance.
        //
        // A race names its own course or it has none. There is nothing to fall
        // back to, because the block's course is not this race's course — and
        // for the target race itself nothing changes, since its own meta
        // carries the slug.
        const courseSlug = String(raceMeta?.courseSlug ?? '');
        const geoRow = courseSlug
          ? (await pool.query<{ geometry_json: unknown }>(
              `SELECT geometry_json FROM course_library WHERE slug = $1 LIMIT 1`,
              [courseSlug],
            ).catch(() => ({ rows: [] }))).rows[0]
          : null;
        const pacing = buildRacePacing({
          goalSec: raceGoalSec,
          distanceMi,
          geometry: (geoRow?.geometry_json ?? null) as CourseGeometryInput | null,
        });
        if (pacing.source === 'course' && pacing.phases && pacing.phases.length > 1) {
          coursePhases = pacing.phases.map((ph, i) => ({
            type: 'work' as const,
            label: ph.label,
            distanceMi: Number((ph.end_mi - ph.start_mi).toFixed(2)),
            durationSec: Math.round((ph.end_mi - ph.start_mi) * ph.pace_s_per_mi),
            targetPaceSPerMi: ph.pace_s_per_mi,
            tolerancePaceSPerMi: 12,
            haptic: i === 0 ? ('start' as const) : ('transition-work' as const),
            repUnit: 'distance' as const,
            hrTargetBpm: null,
          }));
        }
      } catch { /* course pacing is additive — flat goal pace below */ }

      if (coursePhases) {
        workout.phases = coursePhases;
      } else {
        const race = specWorkPhases[0];
        // 2026-08-17 doctrine-conformance audit · THE SETTLE PHASE.
        // spec-builder.ts:461 justified its ±5 s/mi race band by saying
        // "the first-mile allowance is structural (watch settle phase +
        // execution plan)" — the watch settle phase did not exist. The
        // wrist prescribed flat goal pace from the gun while the phone's
        // split card said settle: two surfaces, one runner, contradicting
        // each other on race morning. Both now read the same opening
        // model (lib/race/distance-doctrine.ts · Research/08 §3.1), so
        // the watch opens +2 s/mi on a 5K and +15 on a marathon, holds
        // the early block, then repays it — summing to the goal exactly.
        const segments = raceOpeningSegments({ goalSec: raceGoalSec, distanceMi: raceDistMi });
        const raceIdx = workout.phases.indexOf(race);
        if (segments.length > 1 && raceIdx >= 0) {
          // Splice, don't replace the array — any warm-up/cool-down the
          // spec carries around the race survives.
          workout.phases.splice(raceIdx, 1, ...segments.map((s, i) => ({
            type: 'work' as const,
            label: s.label,
            distanceMi: s.distanceMi,
            durationSec: s.durationSec,
            targetPaceSPerMi: s.paceSPerMi,
            tolerancePaceSPerMi: Math.min(race.tolerancePaceSPerMi ?? 12, 12),
            haptic: i === 0 ? ('start' as const) : ('transition-work' as const),
            repUnit: 'distance' as const,
            hrTargetBpm: race.hrTargetBpm ?? null,
            // `race` is itself one of the already-built phases above, so its
            // `hrRole` was already decided by the one function — carried
            // over, not re-derived, for a segment that inherits its bpm.
            hrRole: race.hrTargetBpm != null ? (race.hrRole ?? 'target') : null,
          })));
        } else {
          race.targetPaceSPerMi = Math.round(raceGoalSec / raceDistMi);
          race.tolerancePaceSPerMi = Math.min(race.tolerancePaceSPerMi ?? 12, 12);
          if (race.distanceMi) {
            race.durationSec = Math.round(race.distanceMi * (race.targetPaceSPerMi ?? 0));
          }
        }
      }
      workout.totalEstimatedMinutes = Math.round(
        workout.phases.reduce((s, p) => s + p.durationSec, 0) / 60,
      );
    }

    // F16 · goal delta — the watch's LiveRaceFace goal-delta row and the
    // IdleView goal line (WorkoutEngine.swift:297, IdleView.swift:70)
    // decode goalSec but the server never sent it. Independent of the
    // pace targets so the delta renders even when course pacing is off.
    if (raceGoalSec) workout.goalSec = raceGoalSec;

    // F16 · gel cues — WorkoutEngine.swift:764 fires distance-anchored
    // race-day gel alerts off gelsMi; never sent before. Source is the
    // authored spec's fuel_mi, dropping cues inside the final 2 miles
    // (the generator emits fixed spacing — AFC's spec says [5, 9, 13],
    // and a gel at mile 13.0 of 13.1 is a cue nobody can use).
    // Gel-mile precedence (most specific wins):
    //   1. The runner's ENTERED race fuel (races.meta.fuelProduct / cadence
    //      / serving / rate) → computeRaceFueling places servings on THEIR
    //      cadence and we convert to course miles. This is David's "enter
    //      the fueling we will use" → the watch prompts at those miles.
    //   2. The authored spec's fuel_mi (generic generator spacing).
    //   3. The runner-level default fueling fallback (below).
    let enteredGelsMi: number[] | null = null;
    if (raceGoalSec && raceDistMi > 0) {
      const fuelDefaults = (await pool.query<{ fuel_brand: string | null; fuel_gel_carbs_g: number | null; fuel_target_g_per_hr: number | null }>(
        `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      ).then((r) => r.rows[0] ?? null).catch(() => null));
      const { fuel, fuelIsDefault } = resolveRaceFuel(raceMeta, fuelDefaults);
      // Only honor entries that are actually the runner's choice (per-race
      // OR runner-default); pure documented-default falls through to the
      // spec's authored fuel_mi so we don't override a hand-tuned plan with
      // a generic 60 g/hr ladder.
      if (!fuelIsDefault) {
        const fp = computeRaceFueling({
          goalSec: raceGoalSec,
          distanceMi: raceDistMi,
          goalPaceSPerMi: raceGoalSec / raceDistMi,
          fuel,
          isDefault: false,
        });
        const gels = fp.scheduleMi
          .map((s) => s.mi)
          .filter((mi) => mi >= 2 && mi <= raceDistMi - 2);
        if (gels.length > 0) enteredGelsMi = gels;
      }
    }

    const fuelMi = Array.isArray((wo.workout_spec as Record<string, unknown> | null)?.fuel_mi)
      ? ((wo.workout_spec as Record<string, unknown>).fuel_mi as unknown[])
          .map(Number)
          .filter((m) => Number.isFinite(m) && m >= 2 && m <= distanceMi - 2)
      : [];
    if (enteredGelsMi) workout.gelsMi = enteredGelsMi;
    else if (fuelMi.length > 0) workout.gelsMi = fuelMi;

    // RK-1 · strategy line for the race face — goal + B-target in one
    // glance. Sourced from the same plan-race meta as goalSec.
    const goalDisp = (raceMeta?.goalDisplay as string | undefined) ?? null;
    const safeDisp = (raceMeta?.goalSafeDisplay as string | undefined) ?? null;
    // MIDGOAL-2 · when the goal is the COACH's, the label says so. The runner
    // never typed this number, and a start-line label reading "45:12 goal" on
    // a race they set no goal for asserts a commitment they did not make.
    // "coach target" names the author in the only carrier this string has.
    workout.strategyLabel = goalDisp
      ? (safeDisp ? `${goalDisp} goal · ${safeDisp} safe` : `${goalDisp} goal`)
      : (raceGoalIsCoachSet && raceGoalSec
          ? `${formatRaceTime(raceGoalSec) ?? ''} coach target`.trim()
          : null);

    // RK-1 · gel fallback for races whose authored spec carries no
    // fuel_mi: convert the research-doctrine fueling plan (time-anchored)
    // to course miles via goal pace. Spec-authored positions win when
    // present (above).
    if (workout.gelsMi == null && raceGoalSec) {
      try {
        const fuelRow = (await pool.query<{
          fuel_brand: string | null;
          fuel_gel_carbs_g: number | null;
          fuel_target_g_per_hr: number | null;
        }>(
          `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
          [userId]
        ).catch(() => ({ rows: [] }))).rows[0];
        const fuel = computeFueling({
          durationEstMin: Math.round(raceGoalSec / 60),
          distanceMi: raceDistMi,
          // Race-day rate is the DISTANCE's Research/18 §11 row, not the
          // marathon row for every race (doctrine audit 2026-08-17).
          raceDistanceMi: raceDistMi,
          workoutType: 'race',
          tempF: null,
          daysToARace: 0,
          raceFuelTargetGPerHr: fuelRow?.fuel_target_g_per_hr ?? null,
          gelCarbsG: fuelRow?.fuel_gel_carbs_g ?? null,
          gelLabel: fuelRow?.fuel_brand ?? null,
        });
        if (fuel.needed && raceDistMi > 0) {
          const paceMinPerMi = (raceGoalSec / 60) / raceDistMi;
          const gels = fuel.atMins
            .map((m) => Math.round((m / paceMinPerMi) * 10) / 10)
            .filter((mi) => mi >= 2 && mi <= raceDistMi - 2);
          if (gels.length > 0) workout.gelsMi = gels;
        }
      } catch { /* gel fallback is additive */ }
    }
  }

  // 7b. RK-1 — training-run fueling. The model declared `fueling` since
  // the watch shipped, but the server never assigned it: the 30/60/90-min
  // gel haptics (WorkoutEngine.swift:628) were dead on every real long
  // run (sim fixtures set them, masking the gap). Race day is handled
  // above via gelsMi — the engine ignores time-anchored fueling there.
  // Best-effort: never fail the payload over fueling math.
  if (sessionClass !== 'race') {
    try {
      const fuelingType: WorkoutFuelingType =
        sessionClass === 'long' ? 'long'
        : sessionClass === 'threshold' || sessionClass === 'interval' ? 'quality'
        : sessionClass === 'rest' ? 'rest'
        : 'easy';

      // Runner product prefs — same source as the iPhone brief, so the
      // watch quotes the same product line ("2 Maurten 100s").
      const fuelRow = (await pool.query<{
        fuel_brand: string | null;
        fuel_gel_carbs_g: number | null;
        fuel_target_g_per_hr: number | null;
      }>(
        `SELECT fuel_brand, fuel_gel_carbs_g, fuel_target_g_per_hr FROM users WHERE id = $1 LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] }))).rows[0];

      const daysToARace = raceRow?.meta?.date
        ? Math.max(0, Math.round((Date.parse(raceRow.meta.date + 'T12:00:00Z') - Date.now()) / 86400000))
        : null;

      const fuel = computeFueling({
        durationEstMin: totalEstimatedMinutes,
        distanceMi,
        // The gut-training ramp aims at the GOAL RACE's §11 rate, so a
        // 10K goal no longer rehearses a marathon's 75 g/hr (and, since
        // the ramp only climbs, a short goal race never strips a long
        // run's own duration-driven fuel).
        raceDistanceMi: goal_distance_mi ?? null,
        workoutType: fuelingType,
        // 2026-08-24 · wired. Was null since it shipped, which is why
        // WatchFueling.heatAdjusted was permanently false on the wire. Same
        // observation that eased the targets, so fuel and pace cannot
        // disagree about the weather. Null on any failure path, which
        // computeFueling reads as "no heat correction".
        tempF: heat?.tempF ?? null,
        daysToARace,
        raceFuelTargetGPerHr: fuelRow?.fuel_target_g_per_hr ?? null,
        gelCarbsG: fuelRow?.fuel_gel_carbs_g ?? null,
        gelLabel: fuelRow?.fuel_brand ?? null,
      });

      if (fuel.needed) {
        // Time-anchored prompts (haptic at each atMins). The watch's
        // WatchFueling decode is strict — every field present.
        workout.fueling = {
          needed: fuel.needed,
          gels: fuel.gels,
          atMins: fuel.atMins,
          gPerHr: fuel.gPerHr,
          totalCarbsG: fuel.carbsTotalG,
          isRehearsal: fuel.isRehearsal,
          heatAdjusted: fuel.heatAdjusted,
          shortLine: fuel.shortLine,
          why: fuel.why,
        };
      }
    } catch {
      /* fueling is additive — a failure must not cost the workout push */
    }
  }

  // P27.5 — populate readiness on the watch payload. Before this the
  // model declared readinessScore/Label fields but the server never
  // sent them, so the watch face fell through to a hardcoded fixture.
  try {
    const { loadCoachState } = await import('@/lib/coach/state-loader');
    const { computeReadiness } = await import('@/lib/coach/readiness');
    const state = await loadCoachState(userId);
    const r = computeReadiness(state);
    // Math.round: readiness pillars carry float weights and the deployed
    // watch decodes readinessScore as a strict Int — a fractional score
    // fails the WHOLE WatchWorkout decode and the watch silently keeps
    // yesterday's session (M-13).
    workout.readinessScore = r.score != null ? Math.round(r.score) : null;
    workout.readinessLabel = r.label ?? r.band ?? null;
  } catch {
    /* don't fail the watch payload over readiness — best effort only */
  }

  // 0821 · B5 · the spoken cues. Composed LAST, after every branch that
  // can still rewrite the phase list (the race branch splices its opening
  // segments in above), because a phase-triggered cue points at an index
  // and an index that moved afterwards points at the wrong sentence.
  const spokenCues = composeSpokenCues({
    sessionClass,
    distanceMi,
    phases: workout.phases,
  });
  if (spokenCues.length > 0) workout.spokenCues = spokenCues;

  // 0821 · "the session already moved". Deliberately NOT readiness: the
  // design refuses to put a score on the lobby, so this says what changed
  // and why, once, and the score stays on the fields it already lived on.
  const sessionMoved = await loadSessionMoved(String(plan.id), wo.id ?? null, distanceMi)
    .catch(() => null);

  // Same "did this day happen" predicate the week strip's own today entry
  // uses (projectWeekStrip's `ran`, above) — reusing rawWeek's already-loaded
  // row rather than a second completion query.
  const todayWeekDay = rawWeek?.days.find((d) => d.date_iso === today);
  const ranToday = todayWeekDay
    ? (todayWeekDay.completedRunId != null || (todayWeekDay.done_mi != null && todayWeekDay.done_mi >= 0.5))
    : false;
  const completedToday = ranToday
    ? await loadCompletedRun(userId, today, wo).catch(() => null)
    : null;

  // SAFETYSTOP-1 · THE ONE GATE. Everything above composed the session; this
  // decides whether it is allowed to leave.
  //
  // This used to return the runnable `workout` beside a "Not today" board on
  // an open injury — deliberately, for a fleet of older watch builds that
  // could not draw the board. The telemetry says that fleet is one device on
  // a current build (safety-stop.ts records the query and its limits), and the
  // message branch below is the response shape EVERY build has always
  // rendered, so withholding costs nothing and strands nobody.
  //
  // THREE withholding cases land here and they are different facts: safety
  // stopped training, the check did not run, or running is licensed and this
  // particular session is not. The runner gets a different sentence for each,
  // and none of them gets a runnable session.
  //
  // `dayState` still rides along, so a build that can draw the No-session
  // board still draws it. What is gone is the runnable session underneath it.
  // The posture, mapped onto the wire. Resolved HERE rather than beside the
  // `resolveSafety` call above because it needs `isQualityWorkout`, which the
  // session composition upstream produces — and one answer to "is this
  // quality" beats a second one computed early.
  const safetyGate = resolveWatchSafetyGate(safety, isQualityWorkout);
  if (safetyGate.kind === 'withhold') {
    console.log(
      `[watch/today] safety withheld the session · why=${safetyGate.why} · ${safety.explain}`,
    );
    return {
      message: safetyGate.message,
      weekStrip,
      sessionMoved,
      dayState: noSessionState,
      completedToday,
    };
  }
  return { workout, weekStrip, sessionMoved, dayState: noSessionState, completedToday };
}
