/**
 * lib/faff/v5-today.ts — the pure composer behind `GET /api/v5/today`.
 *
 * `native-v2/Faff/Faff/DesignV5/APIV5.swift` is the wire contract; this file
 * is written to match it byte for byte. Every property name below is the
 * wire key unless noted (V5Today's own `CodingKeys` on the Swift side names
 * every key explicitly, and every one of them equals the property name — so
 * there is nothing to translate).
 *
 * ── The four rules, and how this file keeps them ─────────────────────────
 *
 * 1 · A modelled number must never look measured. Every number that reaches
 *     the phone is a `V5Number { text, modelled }` — never a bare string. The
 *     phone's own decoder defaults an ABSENT `modelled` key to `true`, because
 *     over-marking is the safe failure.
 *
 *     This header used to claim that "Today carries no projections" and that
 *     every value below could therefore be stamped `false`. That was wrong,
 *     and it was wrong about the biggest number on the panel. Today's PACE
 *     BAND, its HR CEILING and every step's pace/HR target come from
 *     `derivePaces()` / `prescriptionFor()`, which hang off
 *     `tPaceFromGoal(goal_seconds, …)` — the runner's typed goal time — and
 *     off the LTHR zone model. Those now ship `modelled: true`.
 *
 *     What still ships `false` here is a read of something that happened (a
 *     logged distance, time, split, heart rate, biometric) or the plan's own
 *     prescribed dose. If you add a number to this file, name its basis at
 *     the call site and say why in a comment — never rely on a default.
 *     `scripts/check-modelled-mark.sh` fails the build on the shapes that
 *     get this wrong silently.
 *
 * 2 · One signal never changes a session. `changed` (the `changed_overnight`
 *     payload) is built ONLY from a `coach_intents` row whose persisted
 *     verdict names ≥3 converging domains (`MIN_CONVERGING_DOMAINS`,
 *     matching `CONVERGENCE.redMinDomains` in lib/coach/convergence.ts,
 *     the actual gate that decided whether the plan mutated last night).
 *     Fewer than three and the whole `changed` object is omitted — never a
 *     partial one — which is the client-side enforcement the design contract
 *     asks for repeated at the point the payload is built, not just trusted
 *     upstream.
 *
 * 3 · A refusal is a correct answer, not an empty state. `notOnPhoneYet` is
 *     the refusal for coached / just-run / distance-goal-without-a-race —
 *     `state` is set and every other Today field is left at its safe empty
 *     default rather than partially populated. `injury`, `weekOff` and
 *     `offSeason` are the same idea for their own screens: a quiet panel and
 *     a stated reason, never the data-outage look.
 *
 * 4 · Coach voice. Every string this file authors is short, direct, states a
 *     fact, and never scolds. Where a sentence is already authored elsewhere
 *     (`derivePurpose`, `deriveRecap`, `convergenceCopyFromPhrases`) this
 *     file quotes it rather than re-writing it, so the voice cannot fork.
 */

// The only import this file has. `lib/runs/run-shape.ts` imports nothing
// itself, so the composer stays pure and unit-testable without a database.
import { reconcilePaceWithClock } from '../runs/run-shape';
import type { PostRunWire } from '@/lib/postrun/wire';

// ─────────────────────────────────────────────────────────────────────────
// Wire types — one-to-one with APIV5.swift
// ─────────────────────────────────────────────────────────────────────────

export interface V5Number {
  text: string | null;
  modelled: boolean;
}

export interface V5Stat {
  label: string;
  value: V5Number;
  tone: string | null;
}

export interface V5Row {
  id: string;
  label: string;
  sub: string | null;
  value: V5Number | null;
  action: string | null;
  /**
   * How the engine wants the VALUE inked — `'attention' | 'signal' | 'fault'`,
   * or omitted for neutral. See `V5Tone` in APIV5.swift: absent is the safe
   * default (can only under-mark), and the phone never derives this itself —
   * it holds a formatted string, not the band. Optional so every existing
   * call site (which has nothing to say) stays exactly as it was.
   */
  tone?: string | null;
}

export interface V5Step {
  id: string;
  main: string;
  sub: V5Number | null;
  /** Per-step ink, same contract as `V5Row.tone`. Optional/omitted = neutral. */
  tone?: string | null;
}

export interface V5Group {
  id: string;
  title: string;
  note: string | null;
  steps: V5Step[];
  /**
   * PRERUN-1 · how to EXECUTE this group, and what to do when it goes wrong.
   * The approved 5a design's `groupFooter`. See `V5Group.footer` in APIV5.swift.
   *
   * `spec-card.ts` has written one of these per step since it shipped — "Same
   * pace on every rep. If the last one slips, the target was too fast." — and
   * this composer read every other field on the step and dropped that one. The
   * screen was left holding numbers with no instruction attached to them, on
   * the surface whose whole job is telling a runner what to go and do.
   *
   * ONE per group, not one per step: three notes stacked under three rows is a
   * wall of prose, and within a group every step shares a role anyway. The
   * WORK step's note wins because that is the step the session is named after.
   */
  footer?: string | null;
  /**
   * True for the group carrying the actual work, as against the warm up and
   * cool down around it. See `V5Group.isWork` in APIV5.swift — the client
   * used to infer this from POSITION, which breaks on two work blocks or
   * none, so the engine says which. Optional; a group that isn't structured
   * warm/work/cool (none exist yet) can leave it unset.
   */
  isWork?: boolean;
}

export type V5DayStateWord = 'easy' | 'rest' | 'quality' | 'race' | 'phase' | 'long';

export interface V5Panel {
  dayState: V5DayStateWord;
  quiet: boolean;
  place: string;
  /**
   * The panel's own line, beside the week line.
   *
   * Not literally a date any more. Today fills it with the PHASE — the week
   * strip already highlights which day it is and the place label already says
   * TODAY, so spending the panel's one prominent line on "Thursday 20 August"
   * was spending it on the thing the runner is least likely to be asking.
   * Where they are in the block is the thing.
   */
  dateLine: string;
  weekLine: string | null;
  kicker: string | null;
  type: string;
  dose: V5Number | null;
  stats: V5Stat[];
}

export interface V5WeekStripDay {
  id: string;
  dateISO: string;
  letter: string;
  number: string;
  dayState: V5DayStateWord;
  isToday: boolean;
  isDone: boolean;
  isRest: boolean;
}

export interface V5ConvergedDomain {
  id: string;
  domain: string;
  value: V5Number;
  baseline: string;
}

export interface V5Convergence {
  updatedAt: string;
  wasType: string | null;
  coachLine: string;
  converged: V5ConvergedDomain[];
  movedTo: V5Row | null;
}

export interface V5Injury {
  area: string;
  since: string;
  verdict: string;
  whatChanged: V5Row[];
  checkIn: V5Row[];
  returnAvailable: boolean;
}

export interface V5WeekOff {
  reason: string;
  fromISO: string;
  toISO: string;
  coachLine: string;
  nextUp: V5Row | null;
}

export interface V5OffSeason {
  sinceLastRace: string | null;
  silenceReason: string;
  weeklyRange: string | null;
}

/**
 * A sick day is not an injury (see `app/api/v5/today/route.ts`'s sick block
 * for the full comparison). Same shape as `V5Injury` on the wire — a quiet
 * panel, a verdict, a check-in list — but sourced from `sick_episodes`
 * (systemic illness: symptoms + fever, self-reported) rather than
 * `runner_injuries` (a diagnosed musculoskeletal issue), and the check-in
 * options are a daily TREND (better/same/worse/recovered) that POSTs to
 * `/api/sick/recovery`, not a one-shot better/same/worse note. `recovered`
 * clears the episode server-side and Today reverts on its own next load —
 * there is no `returnAvailable`/ladder screen the way injury has one.
 */
export interface V5Sick {
  symptoms: string[];
  hasFever: boolean;
  since: string;
  verdict: string;
  checkIn: V5Row[];
}

export type V5TodayStateWire =
  | 'before_run' | 'after_run' | 'changed_overnight' | 'injury_flare' | 'sick'
  | 'week_off' | 'off_season' | 'race_day' | 'not_on_phone_yet';

export interface V5Today {
  dateISO: string;
  state: V5TodayStateWire;
  panel: V5Panel;
  weekStrip: V5WeekStripDay[];
  groups: V5Group[];
  why: string | null;
  /// THE COACHING THESIS (BRAIN_CONSTITUTION §F), additive 2026-09-01.
  ///
  /// The strategic frame `why` is composed FROM on a quality day, carried
  /// structurally as well so the phone holds the claim and not only the
  /// sentence. Rule 17: `why` and `thesis.coachLine` are ALTERNATIVES on this
  /// screen, never siblings — the About section draws one of them, and since
  /// the route composes `why` out of the thesis on every quality day, the
  /// runner never reads the same strategy twice.
  ///
  /// Null when the thesis could not resolve, and on states that do not
  /// prescribe. Optional so a pre-existing context builder stays valid.
  thesis?: ThesisWire | null;
  whereYouAre: V5Row[];
  beforeYouGo: V5Row[];
  /// Present only when the active plan carries an unacknowledged pace-drop
  /// event (`lib/plan/pace-drop-event.ts`) — the coach-line entry point onto
  /// 18a (`V5Route.pacesMoved`), never shown on a state that has nothing new
  /// to say. See `app/api/v5/today/route.ts`'s pace-note block.
  paceNote: V5Row | null;
  /// 2026-08-28 · the block-transition coach note, on the morning it landed.
  /// Non-null only while a fresh `auto_applied` block-transition proposal row
  /// stands (recovery→build handoff and its lifecycle siblings; the same 24h
  /// window the web notice card uses). `title` is the decision card's own
  /// headline ("Recovery is done"), `body` the proposal's composed message.
  /// The push notification (`renderBlockStarted`) is the lock-screen half of
  /// this; the note is what the runner finds when they open Today.
  blockNote: { title: string; body: string } | null;

  askedVsRan: V5Row[];
  verdict: string | null;
  /// The recap's own supporting sentences, under the verdict. One or two,
  /// plain English, already composed by `lib/coach/run-recap.ts` — quoted
  /// verbatim, never re-worded here, the same contract `coachLine` keeps.
  facts: string[];
  /// The four-to-ten word line `lib/coach/run-win.ts` writes when the run has
  /// a real thing to point at. Null far more often than not, and a null is the
  /// engine declining, not a gap to fill.
  win: string | null;
  /// What the weather did to the session, when it did anything. Null on a
  /// neutral day, and a neutral day must draw nothing rather than a heading.
  conditionsNote: string | null;
  /// Forward-looking, and the only sentence here that is about next time.
  coachTip: string | null;
  /**
   * THE READING · the four instrument values the run recorded.
   *
   * Run detail has drawn these since it was written and the post-run Today
   * screen never had them on the wire at all. Quantities, not sentences: the
   * phone owns the words and the units, so a wording change never touches the
   * payload — the same seam `RepBreakdownV5` and `WristDecisionsV5` keep.
   *
   * Null means the run recorded nothing, and the phone draws NO ROW rather
   * than a zero or a dash we typed.
   */
  hrAvg: number | null;
  hrMax: number | null;
  cadenceAvg: number | null;
  /**
   * Air temperature, F. MODELLED, and the phone marks it so — nothing on the
   * wrist or in the phone has a thermometer, so a run's temperature is a
   * weather read for a grid square and an hour bucket.
   */
  tempF: number | null;
  /**
   * WHAT THE SESSION WAS, canonically — easy, long, tempo, intervals, race,
   * race_week_tuneup and the rest of `lib/training/workout-type.ts`.
   *
   * The screen composes itself from this. `panel.dayState` is the coarse
   * four-way bucket (easy / quality / long / race) and cannot tell a tempo
   * from a rep set, which is a distinction that changes what is honest to
   * show: an average heart rate summarises a tempo block and describes no
   * part of a rep session.
   */
  workoutType: string | null;
  /**
   * THE SAME READING, SCOPED TO THE WORK · what a session made of pieces shows
   * instead of the whole-run figures.
   *
   * `lib/runs/work-averages.ts` is the one place this is computed, shared with
   * run detail. Null when the run recorded no work phase, which is every
   * steady run — and there the whole-run figures are the honest ones.
   */
  hrAvgWork: number | null;
  cadenceAvgWork: number | null;
  paceWork: string | null;
  zoneShares: number[] | null;
  zoneTarget: number | null;
  /// Every zone the session asked for, ascending. A race prescribes a SET —
  /// a half is Z4 AND Z5 (Research/08 §6.1 × Research/03 §4) — and `zoneTarget`
  /// is null whenever that set is not a single zone. Empty asserts nothing.
  zoneTargets: number[] | null;
  elevation: number[] | null;
  /** The garage, for the shoe menu. Empty when nothing is logged. */
  shoeOptions: V5Row[];
  /** Encoded route for the map. Null when the run has none. */
  routePolyline: string | null;
  /** Per-mile splits, for the map's colouring and its legend. */
  routeSplits: Array<{
    mile: number; pace: string | null; hr: number | null;
    cadence: number | null; elev_change_ft: number | null;
    /** The mile's real length. Null when the source did not record one. */
    distanceMi: number | null;
  }>;
  /** Workout phases, so reps colour at their true pace. Empty on a steady run. */
  routePhases: Array<{
    mi: number; sec: number; type: string | null;
    /** VERDICT-1 · the canonical per-phase verdict (`hit` / `fast` / `slow` /
     *  `incomplete`) and its word. Null when the phase was not pace-graded. */
    verdict?: string | null; status_label?: string | null;
  }>;
  /** The runner's own HR zone bands. Empty at cold start. */
  hrZones: Array<{ label: string; lower: number | null; upper: number | null }>;
  /** The pace window the session asked for, seconds per mile. */
  paceBand: { lo: number; hi: number } | null;
  /** True only when an instrument measured the climb. See lib/runs/elevation.ts. */
  elevGainMeasured: boolean;
  /**
   * The run's MEASURED climb, in feet.
   *
   * Sent because the phone used to derive it by summing the elevation
   * profile, which meant a run with no per-split elevation reported a climb
   * of zero while its own row recorded 128 ft. The profile is a picture; this
   * is the measurement.
   */
  elevGainFt: number | null;
  onTheBelt: V5Stat[] | null;
  shoesWorn: V5Row | null;
  whatThisDidToTheWeek: V5Row[];
  /**
   * THE CANONICAL POST-RUN INTERPRETATION.
   *
   * Composed by `lib/postrun/experience.ts` and loaded by
   * `lib/postrun/load.ts` — the SAME object `/api/runs/[id]` returns under the
   * same key. Two surfaces, one answer, and `decisionVersion` on it is what
   * lets a test prove they render the same decision rather than assert it.
   *
   * Null on a run this route could not compose one for, and the phone then
   * draws no briefing rather than an empty one.
   */
  postRun: PostRunWire | null;
  runId: string | null;

  changed: V5Convergence | null;
  injury: V5Injury | null;
  sick: V5Sick | null;
  weekOff: V5WeekOff | null;
  offSeason: V5OffSeason | null;

  notOnPhoneYet: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 1 as a function. The ONLY way a number reaches V5Today.
//
// `modelled` has no default and never will. A default is how the pace band
// shipped as a hard read for as long as it did: nobody had to decide, so
// nobody did. Every call site names the basis out loud, and anything derived
// from a goal time, a zone model, a projection, a doctrine constant or a
// forecast passes `true`.
// ─────────────────────────────────────────────────────────────────────────

export function num(text: string | null, modelled: boolean): V5Number {
  return { text, modelled };
}

const MIN_CONVERGING_DOMAINS = 3; // CONVERGENCE.redMinDomains, lib/coach/convergence.ts

// ─────────────────────────────────────────────────────────────────────────
// Small formatting helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * MIGRATED 2026-08-24 · these three were the poster's own copies and the de
 * facto house style; they now re-export `lib/format/run.ts` so the recap,
 * which had its own, cannot disagree with them again. See that module for
 * the 3.05 incident and for the `6:60/mi` carry these copies both had.
 *
 * Re-exported rather than deleted because they are imported by name across
 * the app, and a rename is churn with no reader-visible benefit.
 */
import { dateWords as usDateWords } from '@/lib/format/date';
import { fmtMi, fmtMi2, fmtClock, fmtPaceSlash as fmtPace } from '@/lib/format/run';
import { canonicalSessionType } from '@/lib/training/workout-type';
import { hrCapBreached } from '@/lib/training/execution-semantics';
import type { ThesisWire } from '@/lib/training/coaching-thesis';
export { fmtMi, fmtClock, fmtPace };

const TRACK_M = [200, 300, 400, 600, 800, 1000, 1200, 1500] as const;
export function fmtRepDistance(mi: number | null | undefined): string | null {
  if (mi == null || !isFinite(mi) || mi <= 0) return null;
  // A mile is a mile. Without this guard 1.0 mi (1609.3 m) lands within 1% of
  // 1600 m and a runner reading "5 × 1 mi" would be shown "5 × 1600 m".
  if (mi >= 0.98) return fmtMi(mi);
  const m = mi * 1609.344;
  for (const t of TRACK_M) {
    if (Math.abs(m - t) / t <= 0.01) return t === 1000 ? '1 km' : `${t} m`;
  }
  // Not a track distance. Below half a mile a tenth is too coarse to be true.
  if (mi < 0.5) return `${(Math.round(mi * 100) / 100).toFixed(2)} mi`;
  return fmtMi(mi);
}



const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * "Thursday, August 20" — weekday, then month, then day.
 *
 * US order, per David 2026-08-25: "it should be Month, Day, Year formatted."
 * The words come from `lib/format/date.ts`, which is the one place that
 * decides how a date is written down — this used to keep its own `DOW_FULL`
 * and `MONTH_FULL` arrays, and it was one of six such copies.
 *
 * NO LONGER DRAWN ON TODAY. Both Today screens stopped rendering
 * `panel.dateLine` on 2026-08-25 — it repeated the date the header and the
 * week strip were already carrying. It is still composed because onboarding's
 * day-one screen reads it as its phase line (`HostsV5.dayOne`), and because a
 * client that wants a date line should get a correct one rather than none.
 */
export function dateLineFor(iso: string): string {
  return usDateWords(iso, { long: true, noYear: true });
}

/** dayState the phone's 6-gradient vocabulary accepts. `plannedType` is the
 *  raw `plan_workouts.type` (or GlanceWeekDay.plannedType) column value. */
/**
 * PRERUN-1 · the day types that are not a run.
 *
 * `plan_workouts.type` also holds `strength` (44 rows, 14 on active plans) and
 * `cross`, and David removed both as surfaces on 2026-08-17 — the run is the
 * product. Every consumer here was reading them as running days by omission:
 * `dayStateWordFor` fell through to `'easy'` and painted the easy gradient,
 * and `displayTypeFor` accepted "SESSION A" as a session NAME and drew
 * "Session a" at 56pt where "Threshold" or "Long" goes.
 *
 * They are days with no run in them, which is what the panel now says.
 */
const NON_RUN_TYPES = new Set(['strength', 'cross', 'xt', 'mobility']);

/**
 * SHAKEOUT-1 (2026-08-30) · BOTH SWITCHES WERE STRING LISTS, AND STRING LISTS
 * GO STALE SILENTLY.
 *
 * The docblock above records this bug class happening once already, for
 * `strength` / `cross`. It had happened twice more and nobody had looked:
 *
 *   · `shakeout` — 48 rows in production, and the type the generator authors
 *     for THE DAY BEFORE A GOAL RACE — was in neither list. Race eve fell to
 *     the default and painted the green EASY gradient under the headline
 *     "EASY". The word "shakeout" appeared nowhere on the screen: the three
 *     rows whose `sub_label` is `SHAKEOUT · 4×20s strides` are correctly
 *     refused as a headline by `subLabelIsName` (prescription syntax), so the
 *     sub_label could not rescue it either. Those three rows are dated
 *     2026-11-12 … 2026-11-28 — CIM race prep.
 *
 *   · `interval`, SINGULAR — 214 production rows, every one of them with a
 *     NULL `sub_label` — was in neither list, while `intervals` was in both.
 *     Two hundred and fourteen rep sessions rendered as green easy days
 *     headlined "EASY", with no sub_label to save them. This is the exact
 *     defect `lib/training/workout-type.ts` was written to end, and these two
 *     switches were simply never converted to it.
 *
 * So neither switch matches strings any more. Both canonicalise through
 * `canonicalSessionType` — the repo's ONE spelling authority, which already
 * knew `interval → intervals` — and then switch exhaustively over the
 * resulting `SessionType`. The `assertNever` at the bottom of each is the
 * actual fix: adding a member to `SESSION_TYPES` now FAILS THE TYPECHECK here
 * until both switches say what it looks like. A string list could never do
 * that, which is why this is the third time.
 */
function assertNever(x: never): never {
  throw new Error(`unhandled session type: ${String(x)}`);
}

export function dayStateWordFor(plannedType: string | null | undefined): V5DayStateWord {
  const raw = (plannedType ?? '').trim().toLowerCase();
  if (NON_RUN_TYPES.has(raw)) return 'rest';

  // `quality` is the COARSE wire bucket from lib/faff/types.ts, deliberately
  // absent from SESSION_TYPES and from its alias map (guessing which session a
  // bare "quality" meant is how a tempo becomes a rep session). It is answered
  // here rather than through the canonicaliser because `dayState` is itself
  // the coarse register — this is the one place the two taxonomies line up.
  if (raw === 'quality') return 'quality';

  const t = canonicalSessionType(raw);
  if (t == null) {
    // Not a session type we recognise. An empty column is a rest day; an
    // unfamiliar non-empty string is still a day with a run in it, which is
    // the pre-existing behaviour and the safer of the two defaults.
    return raw === '' ? 'rest' : 'easy';
  }

  switch (t) {
    case 'long':
      return 'long';
    // Race eve belongs to the race, not to the easy days. `race_week_tuneup`
    // has mapped here since it was added; `shakeout` is the same family and
    // was only ever missing.
    case 'race':
    case 'race_week_tuneup':
    case 'shakeout':
      return 'race';
    case 'tempo':
    case 'threshold':
    case 'intervals':
    case 'fartlek':
    case 'progression':
      return 'quality';
    case 'rest':
    case 'unplanned':
      return 'rest';
    case 'easy':
    case 'recovery':
      return 'easy';
    default:
      return assertNever(t);
  }
}

/** The display register holds a NAME. Prescription syntax means it does not.
 *
 *  `sub_label` is written by two different kinds of author. Some rows carry a
 *  runner-facing NAME ("THRESHOLD", "FIELD TEST", "MEDIUM-LONG"). Others carry
 *  the whole prescription, derived from the spec by `subLabelFromSpec`
 *  (lib/training/expand-spec.ts) — "2 mi WU · 4 mi @ T · 2 mi CD",
 *  "3×1mi @ T pace · 60s jog", "LONG · 4mi @ MP", "EASY · 40 MIN".
 *
 *  Both landed in `V5Panel.type`, which the phone draws at 56pt Archivo with
 *  `lineLimit(1)` and `minimumScaleFactor(0.5)` (FontsV5.swift:447). A
 *  prescription therefore shrank to 28pt and then TRUNCATED — a threshold day
 *  read "3×1MI @ T PACE · 6…" as the day's headline, losing the recovery spec
 *  mid-number. Same defect class as the `EASY (MEDIUM)` label
 *  `_sublabel_voice.test.ts` was written for: engine shorthand in the display
 *  register. That test only scans for parentheses and doubled type words, so
 *  every prescription-shaped label walked straight past it.
 *
 *  The prescription is not lost by rejecting it here — it is what `groups`
 *  (Warm up / Work / Cool down) renders directly below, in full, at body size.
 *  The headline's job is to name the day. */
/*  2026-08-24 · THE PARENTHETICAL IS NOW REJECTED HERE, AT RUN TIME.
 *
 *  The note above says `_sublabel_voice.test.ts` covers `EASY (MEDIUM)`. It
 *  does, but only as a SOURCE SCAN: it looks for `subLabel: '…'` single-quoted
 *  literals in three files. A parenthetical assembled in a template literal,
 *  rendered by `catalogue-rx.renderPrescription`, or carried in a trajectory
 *  step's `label` never appears as a literal in those three files and walks
 *  past it — and then past this gate too, because nothing here objected to a
 *  bracket. `subLabelIsName('EASY (MEDIUM)')` returned true, and the phone
 *  drew "Easy (medium)" at 56 points.
 *
 *  A run-time gate and a source scan are not substitutes for one another. The
 *  scan catches the label before it is written; this catches it however it was
 *  made. No label in the live table carries a bracket — the census returns
 *  zero rows for `sub_label ~ '\('` — so nothing legitimate is lost. */
const PRESCRIPTION_SHAPE = /[@×+/()[\]]|\b(?:WU|CD)\b|\d\s*(?:mi|km|m|s|min|sec)\b|·|\.\s|\d\s*x\s*\d/i;

/** The display budget for a one-line 56pt headline. "CRUISE INTERVALS" (16) is
 *  the longest name the generator writes and the longest that holds the line
 *  without dropping below the design's 20px Archivo floor. */
const DISPLAY_NAME_MAX = 16;

/** A `sub_label` reads as a name — short, and free of prescription syntax.
 *
 *  The floor matters as much as the ceiling: the pace-zone letters the engine
 *  uses internally ("T", "I", "M", "R") are shorthand, not names, and a
 *  one-letter 56pt headline says nothing to a runner. */
export function subLabelIsName(subLabel: string | null | undefined): boolean {
  const s = (subLabel ?? '').trim();
  if (!s) return false;
  if (s.toUpperCase() === 'REST') return false;
  if (s.length < 3 || s.length > DISPLAY_NAME_MAX) return false;
  return !PRESCRIPTION_SHAPE.test(s);
}

/** De-shout an enum. Only a string that is ENTIRELY uppercase is one — a label
 *  already written as copy ("Cruise Intervals") keeps its own casing rather
 *  than being flattened to "Cruise intervals". */
function deshout(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** Title-case display type ("Easy" / "Threshold" / "Long" / "Race" / "Rest").
 *  The client uppercases it at the call site (design contract, V5Panel.type
 *  doc comment) — this stays Title Case so it also reads fine anywhere the
 *  client does NOT uppercase (e.g. inside a coach-voice sentence). */
export function displayTypeFor(plannedType: string | null | undefined, subLabel?: string | null): string {
  // PRERUN-1 · a day with no run in it is named for that, not for its own
  // sub_label. This gate sits ABOVE the name check on purpose: "SESSION A"
  // passes every test `subLabelIsName` applies — nine characters, no
  // prescription syntax — and the phone drew "Session a" as the day's 56pt
  // headline over a card that says there is no run today.
  if (NON_RUN_TYPES.has((plannedType ?? '').trim().toLowerCase())) return 'Rest';

  // sub_label carries the runner-facing name for quality/tuneup sessions
  // ("THRESHOLD", "FIELD TEST") — prefer it, but only when it IS a name.
  if (subLabelIsName(subLabel)) return deshout(String(subLabel).trim());

  // Otherwise name the session from its own type column. This stays finer
  // grained than `dayStateWordFor`, which collapses every quality variant to
  // the single gradient word "quality" — the gradient has six buckets, the
  // headline does not have to.
  const raw = (plannedType ?? '').trim().toLowerCase();

  // See SHAKEOUT-1 on `dayStateWordFor`. `quality` is the coarse wire bucket
  // and is answered before the canonicaliser, which deliberately refuses it.
  if (raw === 'quality') return 'Quality';
  // `vo2max` canonicalises to `intervals`, which is correct as a CLASSIFICATION
  // and lossy as a HEADLINE — the runner asked for VO2 work and the screen may
  // as well say so. Answered ahead of the canonicaliser to keep the finer word.
  if (raw === 'vo2max' || raw === 'vo2' || raw === 'vo2-max') return 'VO2 max';

  const t = canonicalSessionType(raw);
  if (t == null) return raw === '' ? 'Rest' : 'Easy';

  switch (t) {
    case 'long': return 'Long';
    case 'race': return 'Race';
    case 'race_week_tuneup': return 'Tune-up';
    // The day before the race is called what it is. 48 production rows, and
    // this switch had no case for any of them.
    case 'shakeout': return 'Shakeout';
    case 'threshold': return 'Threshold';
    case 'tempo': return 'Tempo';
    case 'intervals': return 'Intervals';
    case 'fartlek': return 'Fartlek';
    case 'progression': return 'Progression';
    case 'recovery': return 'Recovery';
    case 'easy': return 'Easy';
    case 'rest': case 'unplanned': return 'Rest';
    default: return assertNever(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The composer's input context. Assembled by the route (DB I/O lives there,
// not here) so this function stays pure and unit-testable without a
// database — see lib/faff/_v5_today.test.ts.
// ─────────────────────────────────────────────────────────────────────────

export interface V5PrescriptionStepLike {
  label: string;
  distance_mi?: number;
  reps?: number;
  rep_distance_mi?: number;
  duration?: string;
  pace_target?: string;
  hr_target?: string;
  note: string;
  recovery?: { duration: string; pace_target?: string; note: string };
  /** PRERUN-1 · "hills" / "strides" / "surges". See `PrescriptionStep.rep_noun`. */
  rep_noun?: string;
  /** PRERUN-1 · "By effort". See `PrescriptionStep.effort_target`. */
  effort_target?: string;
}

export interface V5PrescriptionLike {
  type: string;
  headline: string;
  why: string;
  /**
   * RATIONALE-PERSIST-1 (2026-09-01) · `SpecCard.selectionRationale`, wired
   * through. The catalogue's own real reason this session beat the
   * alternatives, for this runner, this week — not the byte-identical
   * per-family template `why` carries. `null` on a row with none stored.
   * See `lib/training/spec-card.ts`'s field doc for the voice caveat.
   */
  selectionRationale?: string | null;
  steps: V5PrescriptionStepLike[];
  total_mi: number;
  fueling?: { needed: boolean; shortLine: string } | null;
}

export interface V5WeekOffCtx {
  reason: string;
  fromISO: string;
  toISO: string;
  nextUp: { label: string; sub: string } | null;
}

export interface V5ConvergenceCtx {
  /** "3:12 AM" — the coach_intents row's own ts, runner-local. */
  updatedAt: string;
  wasType: string | null;
  wasSubLabel: string | null;
  /** The persisted structured verdict (Gap B3) — AdaptationConvergenceRecord
   *  shape, read back as plain JSON from coach_intents.value.convergence. */
  verdict: {
    grade: 'green' | 'amber' | 'red';
    converging: string[];
    domains: Array<{ domain: string; dragging: boolean; daysSustained: number; suppressedBy: string | null; counts: boolean }>;
    rationale: string;
  };
  /** Per-domain reading + the runner's own rolling baseline, keyed by
   *  domain name — only entries for domains that COUNTED need be present. */
  readings: Record<string, { value: string; baseline: string } | undefined>;
  /** The already-composed prose (convergenceWhy's output) — quoted verbatim
   *  as coachLine, never re-written here (one voice, one composer, per
   *  lib/coach/convergence.ts's own doc comment). */
  coachLine: string;
}

export interface V5RecentRunCtx {
  runId: string;
  distanceMi: number;
  durationSec: number | null;
  paceSPerMi: number | null;
  avgHr: number | null;
  indoor: boolean;
  speedMph: number | null;
  inclinePct: number | null;
  askedPaceSPerMi: number | null;
  /**
   * The distance the plan asked for, in miles. Null on a day with no plan row.
   *
   * THE TABLE IS CALLED ASKED VS RAN AND HAD NO DISTANCE IN IT. Pace, heart
   * and effort, on a day the runner covered 11.0 miles against a prescribed 5
   * — the single largest thing that happened to that session, and the one
   * reading the screen did not carry. `plannedMi` reached `deriveRecap` and
   * was read by no branch there either; this is the same number, finally
   * arriving somewhere it is printed.
   */
  askedMi: number | null;
  askedHrCap: number | null;
  /**
   * True only when `askedHrCap` resolved from `workout_spec.hr_cap_bpm` — a
   * genuine "stay under this" ceiling (Daniels easy/long HR cap doctrine).
   * The route's own resolution falls back to `hr_target_bpm` (a number to
   * hover near, not a ceiling — set on marathon-pace blocks) and `lthr_bpm`
   * (a bare physiological reference that quality work is often SUPPOSED to
   * reach or pass) when no real cap exists. Those two are fine to DISPLAY as
   * "under {n}" context but wrong to grade against — a threshold session
   * whose avgHr lands above its own LTHR reference executed exactly as
   * asked. This flag is what lets the composer tell the difference without
   * losing the number itself.
   */
  askedHrIsHardCap: boolean;
  effortAsked: { lo: number; hi: number } | null;
  effortLogged: number | null;
  verdict: string | null;
  /**
   * The rest of what `deriveRecap` wrote, which until now stopped here.
   *
   * The recap engine returns four things — a verdict, one or two plain-English
   * facts, an optional forward-looking tip and an optional conditions note —
   * and `run-win.ts` adds a fifth. This context took the verdict and dropped
   * the others on the floor, so the sentences were composed, returned,
   * decoded by `RunRecap` on the phone, and never drawn.
   *
   * Empty array / null are honest absences: `deriveRecap` genuinely returns no
   * conditions note on a neutral day and no win when the signal is too thin.
   */
  facts: string[];
  win: string | null;
  conditionsNote: string | null;
  coachTip: string | null;
  /** The reading · see `V5Today.hrAvg`. `avgHr` is already above. */
  hrMax: number | null;
  cadenceAvg: number | null;
  tempF: number | null;
  /**
   * The canonical session type. Drives WHICH rows the post-run screen draws —
   * see `V5Today.workoutType`. Null when the run was never planned and its own
   * row carries no recognisable type; the phone then composes for a steady
   * run, which is the shape that asserts least.
   */
  workoutType: string | null;
  /**
   * THE SAME READING, SCOPED TO THE WORK · what a session made of pieces shows
   * instead of the whole-run figures.
   *
   * `lib/runs/work-averages.ts` is the one place this is computed, shared with
   * run detail. Null when the run recorded no work phase, which is every
   * steady run — and there the whole-run figures are the honest ones.
   */
  hrAvgWork: number | null;
  cadenceAvgWork: number | null;
  paceWork: string | null;
  zoneShares: number[] | null;
  zoneTarget: number | null;
  zoneTargets: number[] | null;
  elevationSamples: number[] | null;
  elevGainFt: number | null;
  /** True only when an instrument measured the climb. See lib/runs/elevation.ts. */
  elevGainMeasured: boolean;
  /**
   * The run's encoded route, when it has one. Null on a treadmill and null
   * when no GPS was recorded — both honest absences the card says out loud
   * rather than drawing an empty frame.
   */
  routePolyline: string | null;
  /**
   * WHAT THE MAP IS ALLOWED TO SAY.
   *
   * A route drawn with none of this tells the runner only where they went,
   * which they already knew. With it, the same component colours by HR zone
   * on a steady day and by phase on a structured one — the axis that matters
   * for THAT session.
   */
  routeSplits: Array<{
    mile: number; pace: string | null; hr: number | null;
    cadence: number | null; elev_change_ft: number | null;
    /** The mile's real length. Null when the source did not record one. */
    distanceMi: number | null;
  }>;
  routePhases: Array<{
    mi: number; sec: number; type: string | null;
    /** VERDICT-1 · the canonical per-phase verdict (`hit` / `fast` / `slow` /
     *  `incomplete`) and its word. Null when the phase was not pace-graded. */
    verdict?: string | null; status_label?: string | null;
  }>;
  hrZones: Array<{ label: string; lower: number | null; upper: number | null }>;
  paceBand: { lo: number; hi: number } | null;
  weekDoneMi: number;
  weekPlannedMi: number | null;
  shoeWorn: { id: string; name: string; mi: number } | null;
  /**
   * EVERY SHOE THE RUNNER COULD HAVE WORN, so the card can offer a menu.
   *
   * The row used to carry a `change_shoe` action that navigated away to the
   * whole Shoes screen — leaving the run to answer a question about the run.
   * The list is small (a garage is a handful of pairs), so it rides along and
   * the choice happens where the question is asked.
   */
  shoeOptions: Array<{ id: string; name: string; mi: number | null }>;
  niggleFlagged: string | null;
}

export interface V5TodayContext {
  /** The canonical post-run interpretation for the day's run. See
   *  `V5Today.postRun`. Null before a run, and null when it could not be
   *  composed — the surface then draws no briefing rather than an empty one. */
  postRun?: PostRunWire | null;
  todayISO: string;
  /**
   * True when `todayISO` is a day the runner has STEPPED TO, not the day it
   * actually is. Set by the route when the request carries a `date` that is
   * not the runner's own today.
   *
   * 22b's rule, enforced here rather than at the call site: the screen is not
   * in the present tense, so neither is its context. `loadGlanceState` takes
   * no date — readiness, the seven-night sleep average and week-to-date
   * mileage are all read as of NOW. Under a heading that says WED 19 AUG,
   * "Readiness 62 / 100" reads as how ready the runner was on the Wednesday.
   * It is how ready they are on the Friday they are reading it.
   *
   * This is rule one's sibling: not a modelled number wearing a measured
   * number's clothes, but a present-tense number wearing a past-tense one's.
   * It lives in the composer beside rule one's stamping and rule two's gate
   * because it is the same kind of rule, and because a second client reading
   * this endpoint would otherwise have to remember it independently.
   */
  isSteppedDay?: boolean;
  /** Race-mode gate. False → the whole payload is the notOnPhoneYet refusal. */
  raceMode: boolean;

  /** Today's plan row, or null on a synthesised rest day. */
  todayPlan: {
    type: string;
    subLabel: string | null;
    distanceMi: number;
    originalType: string | null;
    originalSubLabel: string | null;
  } | null;
  /**
   * RULE 11 · the live plan prescribes NOTHING for the day on screen.
   *
   * `todayPlan: null` is overloaded — it is also how a rest day arrives — so
   * on its own it cannot tell "the plan says rest" from "the plan says
   * nothing", and the composer rendered both as a 56pt REST. That told the
   * owner he had Monday 2026-08-31 off, on a day carrying a 4.5 mi easy.
   *
   * Set ONLY when the plan read succeeded and returned no row for this date.
   * A FAILED read must leave this false: asserting "nothing is scheduled"
   * off a Postgres blip is the same lie pointing the other way.
   */
  todayPlanUnresolved?: boolean;
  weekLine: string | null; // "Week 6 of 16"
  /** The block phase, title-cased for display ("Maintenance", "Base"). */
  phaseLine: string | null;

  weekStripDays: Array<{
    id: string;
    dateISO: string;
    plannedType: string;
    subLabel: string | null;
    isToday: boolean;
    isRest: boolean;
    isDone: boolean;
  }>;

  /** Pre-run prescription — null once the runner has logged today's run,
   *  and null on states that don't prescribe (injury/weekOff/offSeason). */
  prescription: V5PrescriptionLike | null;
  weatherKicker: string | null; // "55°F · light rain, no wind" — pre-run only
  paceBandStat: string | null;  // "8:50-9:35/mi"
  hrCapStat: string | null;     // "146 bpm"
  effortStat: string | null;    // "2-4"
  why: string | null;           // derivePurpose().verdict + facts, joined
  /// See `V5Today.thesis`. Optional so pre-existing context builders stay
  /// valid; the route sets it on every state that prescribes.
  thesis?: ThesisWire | null;

  whereYouAre: V5Row[];   // readiness/week-status rows
  beforeYouGo: V5Row[];   // shoe pick, fuel, move/skip rows
  /// See `V5Today.paceNote`. Only set on the content states (before_run /
  /// race_day / changed_overnight / after_run) — never on a refusal state,
  /// which already has its own thing to say.
  paceNote: V5Row | null;
  /// See `V5Today.blockNote`. Same content-states-only contract as paceNote.
  /// Optional (like `contingency`) so pre-existing context builders stay valid.
  blockNote?: { title: string; body: string } | null;

  raceDay: boolean;

  /**
   * PRERUN-1 · WHAT TO DO IF IT GOES WRONG.
   *
   * `workout_spec.rules` carries the authored contingencies — today, one per
   * race: "Mile 5 check: pace slower than goal +23s · switch to the B plan".
   * `lib/watch/build-workout.ts` has threaded them to the wrist since
   * 2026-06-09 and decorates each with the evidence/judgement split (0821 B7).
   * The phone read the same column for its structure and never read this key,
   * so on race morning the screen the runner reads in the corral said less
   * about their own race than the watch on their wrist did.
   *
   * Four rows in the table carry rules, three of them future-dated races, and
   * race day is the single pre-run screen where the plan for going wrong
   * matters most.
   *
   * Both registers come from `splitRuleRegisters` — the SAME function the
   * watch decorates with — so the two surfaces cannot word it differently.
   */
  contingency?: Array<{ evidence: string; judgement: string | null }> | null;

  recentRun: V5RecentRunCtx | null;

  weekOff: V5WeekOffCtx | null;
  offSeason: {
    sinceLastRace: string | null;
    silenceReason: string;
    weeklyRange: string | null;
  } | null;
  injury: {
    area: string;
    since: string;
    verdict: string;
    whatChanged: V5Row[];
    checkIn: V5Row[];
    returnAvailable: boolean;
  } | null;
  /// See `V5Sick`. Checked in the route right after `injury` — a sick day
  /// takes the same "quiet panel, not today" treatment, sourced from a
  /// different table with different fields.
  sick: {
    symptoms: string[];
    hasFever: boolean;
    since: string;
    verdict: string;
    checkIn: V5Row[];
  } | null;
  /**
   * SAFETY UNKNOWN · the canonical safety check could not run
   * (`lib/safety/safety-verdict.ts`, the `known: false` branch).
   *
   * Set ONLY by the route, and only when the resolver refused. It is NOT the
   * injury panel and must never become it: fabricating a flare out of a failed
   * read would blank a healthy runner's day, which is the failure the runner
   * named directly when he ruled on this.
   */
  safetyUnknown?: {
    /** `safetyVerdictLine` for the UNKNOWN branch. One author, one sentence. */
    verdict: string;
    /** The "Where you are" rows explaining the refusal. */
    rows: V5Row[];
  } | null;
  convergence: V5ConvergenceCtx | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-builders
// ─────────────────────────────────────────────────────────────────────────

// `V5Step.tone` is deliberately left unset by every `toStep` call below.
// This builder only ever runs off `ctx.prescription` — the PRE-run plan
// (`V5TodayContext.prescription`'s own doc comment: "null once the runner
// has logged today's run") — so there is no executed mile to be out of band
// against yet. There is no "ran" half of the per-mile comparison here for
// this composer to hold an opinion about; inventing one would be exactly
// the fabricated-band failure mode this field exists to prevent. The day
// this builder (or a sibling) starts walking REAL per-mile splits after a
// run, that is where per-step tone belongs.
function buildGroups(rx: V5PrescriptionLike | null): V5Group[] {
  if (!rx || rx.steps.length === 0) return [];

  const stepMain = (s: V5PrescriptionStepLike): string => {
    if (s.reps != null && s.reps > 0) {
      // SPECFIRST-1 · a rep is counted in the unit it was WRITTEN in. Doctrine
      // sizes a hill rep, a Mona surge and a stride in seconds (Research/04
      // §8.1, §9.2, §7.2) and a cruise interval in distance; the spec carries
      // whichever, and `spec-card.ts` puts the seconds in `duration`. Reading
      // only `rep_distance_mi` here collapsed every time-based set to a bare
      // "6 reps" — including the shakeout's "4 × 20 sec" strides, which this
      // builder has been dropping the "20 sec" from since it shipped.
      const rd = fmtRepDistance(s.rep_distance_mi) ?? s.duration ?? null;
      // PRERUN-1 · and it is counted in the thing it IS. "11 × 10s" and
      // "11 × 10s hills" are different sessions; `rep_noun` is read off the
      // expander's own phase label, so the word is the plan's, not ours.
      const unit = rd ? `${s.reps} × ${rd}` : `${s.reps} reps`;
      return s.rep_noun ? `${unit} ${s.rep_noun}` : unit;
    }
    const dist = fmtMi(s.distance_mi);
    if (dist) return dist;
    // No structural distance/reps to report (a rest day's single "Today"
    // step, or a duration-only step) — the note is the real content, not
    // the bare structural label.
    return s.duration ?? s.note ?? s.label;
  };

  /* PRERUN-1 · THE REST INTERVAL REACHES THE SCREEN.
   *
   * `PrescriptionStep.recovery` has carried the jog — its duration, its pace
   * and its own note — since the type was written, and `V5PrescriptionStepLike`
   * declares the field. This builder read every other field on the step and
   * dropped that one on the floor, so the phone rendered
   *
   *     3 × 3:00        7:46 /mi
   *
   * for a spec that reads "3×3 min @ 5K-10K race pace · 2 min jog". A rep
   * session cannot be run off that: the recovery is half the prescription and
   * two minutes' jog against thirty seconds' jog are different workouts. The
   * watch had it the whole time — `expandReps` emits the recovery as its own
   * phase and `build-workout.ts` sends it — so the wrist and the phone were
   * describing different sessions again, one register below the one
   * SPECFIRST-1 closed. Fourteen live rep sessions on active plans, every one
   * of them affected (production, 2026-08-24).
   *
   * The recovery becomes ITS OWN STEP, which is what the approved 5a design
   * does: its quality day's work group holds two rows, "3 mi at 7:22" and
   * "1 mi float · 9:05 · 9:25 /mi". A separate row rather than a suffix keeps
   * the pace of the jog in the sub column where every other pace on the screen
   * lives, and keeps the rep line short enough not to wrap.
   *
   * No wire field is added. A deployed client renders this the moment the
   * server does.
   */
  /** "1:30" / "45s" / "7:00" back to seconds. The inverse of `spec-card.ts`'s
   *  `fmtDuration`, which is the only thing that writes these strings. */
  const durationToSec = (d: string | undefined): number => {
    if (!d) return 0;
    const clock = /^(\d+):([0-5]\d)$/.exec(d);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const secs = /^(\d+)s$/.exec(d);
    return secs ? Number(secs[1]) : 0;
  };

  const recoveryStep = (s: V5PrescriptionStepLike, idx: number, groupKey: string): V5Step | null => {
    const rec = s.recovery;
    if (!rec || !rec.duration) return null;
    // A stride's recovery is a walk back, not a jog — `spec-card.ts` says so in
    // the note it wrote, and calling it a jog would tell the runner to keep
    // running through the one recovery doctrine wants fully walked
    // (Research/04 §7.2). Read the note rather than re-deciding.
    const walk = /walk/i.test(rec.note ?? '');
    return {
      id: `${groupKey}-${idx}-rec`,
      main: `${rec.duration} ${walk ? 'walk back' : 'jog'} between`,
      sub: rec.pace_target ? num(rec.pace_target, true) : null,
    };
  };
  const stepSub = (s: V5PrescriptionStepLike): V5Number | null => {
    // PRERUN-1 · `effort_target` is the last rung and exists so the column is
    // never blank on a step the plan deliberately left unnumbered. A rep under
    // 30 seconds gets no HR band (`Research/03` §13) and a `by_effort` rep
    // carries no pace, which left the target column empty — indistinguishable,
    // on a screen otherwise full of numbers, from a value that failed to load.
    const text = s.pace_target ?? s.hr_target ?? s.effort_target ?? null;
    // Same provenance as the panel's pace band and HR ceiling, and for the
    // same reason: `prescriptionFor` gets both from `paces(p)` / `hrTargets(p)`,
    // which are `tPaceFromGoal(...)` and the LTHR zone model. A step that
    // reads "7:38-7:52/mi" is a modelled target, not a measured one.
    return text ? num(text, true) : null;
  };
  const toStep = (s: V5PrescriptionStepLike, idx: number, groupKey: string): V5Step => ({
    id: `${groupKey}-${idx}`,
    main: stepMain(s),
    sub: stepSub(s),
  });

  /* The group's one execution sentence. See `V5Group.footer`.
   *
   * Most groups hold one role and therefore one sentence repeated down the
   * steps, so this de-duplicates and usually emits exactly that sentence.
   *
   * Where a group holds TWO roles it emits both, in order, and that is not a
   * nicety. A long run with a marathon-pace finish is two steps under one
   * header: "Time on feet beats pace. Fuel around 45 min in, then every 30."
   * belongs to the easy nine miles and "The point of the session. Find race
   * rhythm and hold it home." to the ten at race pace. Printing only the first
   * tells a runner to stop caring about pace on the ten miles the whole
   * session exists for — the footer would be coaching against the workout
   * above it. Seven live long runs carry a finish. The same shape covers an
   * easy day with strides.
   *
   * Two is the cap: no group emits three roles today, and a third sentence
   * would be a paragraph under a two-line tile.
   *
   * A group whose steps carry no note gets no footer rather than an empty
   * line. Nothing is composed here; the sentences are `spec-card.ts`'s, whole
   * and in its order. */
  const groupFooter = (steps: V5PrescriptionStepLike[]): string | null => {
    const seen: string[] = [];
    for (const s of steps) {
      const n = (s.note ?? '').trim();
      if (!n) continue;
      // A step whose `main` IS its note (a rest day's single line, a
      // duration-only step) must not print the same sentence twice.
      if (stepMain(s) === n) continue;
      if (!seen.includes(n)) seen.push(n);
      if (seen.length === 2) break;
    }
    return seen.length > 0 ? seen.join(' ') : null;
  };

  const warm = rx.steps.filter((s) => s.label.toLowerCase() === 'warmup');
  const cool = rx.steps.filter((s) => s.label.toLowerCase() === 'cooldown');
  const work = rx.steps.filter((s) => s.label.toLowerCase() !== 'warmup' && s.label.toLowerCase() !== 'cooldown');

  const groups: V5Group[] = [];
  if (warm.length > 0) {
    groups.push({
      id: 'warmup', title: 'Warm up',
      note: fmtMi(warm.reduce((s, x) => s + (x.distance_mi ?? 0), 0)),
      footer: groupFooter(warm),
      steps: warm.map((s, i) => toStep(s, i, 'warmup')),
      // Never the work — the engine says so explicitly rather than leaving
      // the client to infer it from this group's position in the list.
      isWork: false,
    });
  }
  if (work.length > 0) {
    const workMi = work.reduce((s, x) => s + (x.distance_mi ?? (x.reps ?? 0) * (x.rep_distance_mi ?? 0)), 0);
    /* PRERUN-1 · a time-based rep set has no miles to report, and the header
     * said nothing at all.
     *
     * "11 × 10s hills" carries no `rep_distance_mi` — doctrine sizes a hill
     * rep in seconds (Research/04 §8.1) — so this sum came to zero, `fmtMi(0)`
     * returned null, and the WORK group was the only one of the three whose
     * header had no figure beside it while Warm up and Cool down both did.
     * Eight of the fourteen live rep sessions render that way.
     *
     * The honest figure for a set counted in seconds is the time it adds up
     * to, so that is what the header states. It is the work only, not the
     * recoveries: the group's job is to say how much WORK is in it. */
    const workSec = work.reduce((s, x) => s + (x.reps ?? 1) * durationToSec(x.duration), 0);
    // 2026-08-25 · David, live: "REST DAY" three times on one screen — the
    // hero already says REST / Rest day, so a lone rest-day group titled
    // 'Rest day' (rx.headline) repeated it a third time. The single step's
    // own label stands in instead; the note underneath still says what to
    // actually do ("No running. Sleep, mobility, fuel.").
    groups.push({
      id: 'work', title: warm.length > 0 || cool.length > 0 ? 'Work' : (rx.type === 'rest' ? 'Today' : rx.headline),
      note: fmtMi(workMi) ?? (workSec > 0 ? `${fmtClock(workSec)} of work` : null),
      footer: groupFooter(work),
      steps: work.flatMap((s, i) => {
        const rec = recoveryStep(s, i, 'work');
        return rec ? [toStep(s, i, 'work'), rec] : [toStep(s, i, 'work')];
      }),
      // The group carrying the actual work — see V5Group.isWork's doc
      // comment in APIV5.swift. There is exactly one work group in this
      // builder's output today (`work` is everything that isn't warmup/
      // cooldown, collapsed into one group); if a future prescription shape
      // splits it into two work blocks, both get isWork: true here, which is
      // the whole reason this is engine-said rather than position-inferred.
      isWork: true,
    });
  }
  if (cool.length > 0) {
    groups.push({
      id: 'cooldown', title: 'Cool down',
      note: fmtMi(cool.reduce((s, x) => s + (x.distance_mi ?? 0), 0)),
      footer: groupFooter(cool),
      steps: cool.map((s, i) => toStep(s, i, 'cooldown')),
      isWork: false,
    });
  }
  return groups;
}

/** See `V5TodayContext.contingency`. A group with no rules draws nothing —
 *  never a bare "IF IT GOES WRONG" header over blank space, which is the
 *  orphan-header shape this file already fixed once for "Where you are". */
function buildContingencyGroup(rules: V5TodayContext['contingency']): V5Group[] {
  if (!rules || rules.length === 0) return [];
  return [{
    id: 'contingency',
    title: 'If it goes wrong',
    note: null,
    steps: rules.map((r, i) => ({
      id: `contingency-${i}`,
      main: r.evidence,
      // Modelled: the trigger is a number the plan DERIVED from a goal, and
      // the judgement is a rule, not a reading. Rule one — it wears the mark.
      sub: r.judgement ? num(r.judgement, true) : null,
    })),
    isWork: false,
  }];
}

function buildWeekStrip(ctx: V5TodayContext): V5WeekStripDay[] {
  return ctx.weekStripDays.map((d) => {
    const dow = new Date(d.dateISO + 'T12:00:00Z').getUTCDay();
    return {
      // Identity is the server id, never the date (design contract §5,
      // APIV5.swift's own doc comment on V5WeekStripDay.id).
      id: d.id ?? `date:${d.dateISO}`,
      dateISO: d.dateISO,
      letter: DOW_LETTER[dow],
      number: String(new Date(d.dateISO + 'T12:00:00Z').getUTCDate()),
      dayState: dayStateWordFor(d.plannedType),
      isToday: d.isToday,
      isDone: d.isDone,
      isRest: d.isRest,
    };
  });
}

function buildConvergence(c: V5ConvergenceCtx): V5Convergence | null {
  // RULE 2, enforced here — not just upstream. A payload naming fewer than
  // three converging domains is not a convergence story and must not reach
  // the client as one.
  if (c.verdict.converging.length < MIN_CONVERGING_DOMAINS) return null;

  // …and the sentence has to exist. The gate above only counted domains, so a
  // `plan_adapt_downgrade` row that carried its convergence but lost its `why`
  // produced `state: 'changed_overnight'` with three domain tiles above a
  // blank coach line: a screen that says the session changed and names
  // nothing. `TodayChangedV5` renders `coachLine` verbatim and has no fallback
  // of its own, and rightly so — the client must not compose an explanation.
  // No sentence, no story: this is an ordinary Today.
  if (!c.coachLine.trim()) return null;

  const converged: V5ConvergedDomain[] = c.verdict.converging.map((domain, i) => {
    const reading = c.readings[domain];
    // A domain that counted toward the convergence but whose own reading we
    // cannot render is unreadable, not measured. `'—'` shipped as
    // `modelled: false` claimed a hard read of a dash.
    const text = reading?.value ?? null;
    return {
      id: `${domain}-${i}`,
      domain: domainDisplayName(domain),
      value: num(text, false),
      // …and the same argument applies to the line UNDER it, which `?? ''`
      // left blank.
      //
      // The two halves of this tile come from different moments. `converging`
      // was persisted to `coach_intents` overnight, when the domain had a
      // reading worth converging on. `readings` is built at REQUEST time, and
      // every entry in the route is behind its own null guard — no
      // `hrvBaseline` this morning, no `readings.autonomic`. So a domain that
      // genuinely drove last night's decision can arrive here with nothing to
      // show for itself, and it drew as a fault-red dash over empty space,
      // directly beneath a coach line saying that domain had been dragging for
      // three days. The screen asserted the reading mattered and that it could
      // not be read, at once.
      //
      // The dash is right — `.unreadable` means exactly "we could not read
      // this", and this morning we cannot. The blank line under it was the
      // defect: Rule 3 says a refusal states its reason rather than leaving a
      // labelled row standing over nothing.
      //
      // The tile stays rather than being dropped, deliberately. It counted
      // toward the ≥3 gate above, and silently removing it would leave the
      // screen showing two tiles under a sentence about three domains — the
      // same contradiction, moved.
      baseline: reading?.baseline ?? 'No reading this morning',
    };
  });

  return {
    updatedAt: c.updatedAt,
    wasType: c.wasType,
    coachLine: c.coachLine,
    converged,
    // A downgrade driven by readiness convergence always replaces the
    // session IN PLACE (lib/plan/adapt.ts's readiness_pullback case never
    // reschedules) — movedTo is null, per the design contract's "do not
    // invent a destination."
    movedTo: null,
  };
}

function domainDisplayName(domain: string): string {
  switch (domain) {
    case 'autonomic': return 'HRV';
    case 'cardiac': return 'Resting heart rate';
    case 'sleep': return 'Sleep';
    case 'load': return 'Training load';
    case 'subjective': return 'How yesterday felt';
    default: return domain;
  }
}

function buildRecentRun(r: V5RecentRunCtx): {
  askedVsRan: V5Row[];
  onTheBelt: V5Stat[] | null;
  elevation: number[] | null;
  routePolyline: string | null;
  elevGainFt: number | null;
  elevGainMeasured: boolean;
  shoeOptions: V5Row[];
  routeSplits: V5Today['routeSplits'];
  routePhases: V5Today['routePhases'];
  hrZones: V5Today['hrZones'];
  paceBand: V5Today['paceBand'];
  panelStats: V5Stat[];
  panelKicker: string | null;
  shoesWorn: V5Row | null;
  whatThisDidToTheWeek: V5Row[];
} {
  const askedVsRan: V5Row[] = [];

  // THE ASKED DISTANCE SURVIVES, BUT ONLY WHEN IT DISAGREES.
  //
  // The poster's top line now states the distance actually run, to two places,
  // so restating it here was redundant — that is why the row went. What the
  // top line does NOT carry is what the session ASKED for, and on the day the
  // plan said 5 and the run covered 11, that is the only number that explains
  // the screen.
  //
  // The old row drew always, and its argument was that a row appearing only on
  // a bad day teaches the runner to read its absence. That argument applied
  // when this row was the only place the distance appeared at all. It is not
  // any more: the run's own distance is always on the poster. What appears
  // conditionally is the COMPARISON, and a comparison is worth making only
  // when there is a difference to see.
  //
  // No tone. Eleven against five is unambiguous arithmetic, and the screen
  // still does not know whether he felt good and added or ran a route that
  // came out long. It states both numbers and lets the verdict talk.
  const askedMiForRow = r.askedMi;
  if (askedMiForRow != null && r.distanceMi > 0) {
    const gap = Math.abs(r.distanceMi - askedMiForRow);
    // A quarter mile, or a tenth of the ask on a short session — below that it
    // is the ordinary difference between a plan and a pavement.
    const material = gap > Math.max(0.25, askedMiForRow * 0.1);
    const askedText = fmtMi(askedMiForRow);
    if (material && askedText) {
      askedVsRan.push({
        id: 'distance', label: 'Distance',
        sub: `asked ${askedText}`,
        value: num(fmtMi2(r.distanceMi), false),
        action: null,
      });
    }
  }

  // DISTANCE, PACE AND HEART ARE NOT HERE ANY MORE.
  //
  // Distance and pace are the poster's own top line, two inches above — the
  // table was restating them, and a number stated twice on one screen is a
  // number that can disagree with itself.
  //
  // Heart moved to the readings below, where it sits with max heart rate,
  // cadence and temperature. It was never in the top line, so it is not lost:
  // it is with the other things a sensor measured, rather than in a table
  // about what the session ASKED for. Nothing asked for a heart rate on an
  // easy day.
  //
  // Effort is what is left, and it is the only row here that was ever really
  // asked-versus-ran: the plan requested a band, the runner answered it, and
  // the answer is his rather than a sensor's.


  /**
   * THE PACE THIS SCREEN MAY PRINT, checked against the clock printed beside
   * it. Not `r.paceSPerMi` directly — see `reconcilePaceWithClock`.
   *
   * `runPaceSecPerMi` fixed the 3:37/mi fiction at the READ, which repaired
   * the route that goes through it. This composer takes a CONTEXT, and a
   * context is assembled by a call site: the surface sweep drove the real
   * 2026-08-23 row into it (11.01 mi, 5298s on the watch's own clock, a
   * stored 217 s/mi from a Strava moving time) and the panel printed
   * "11 mi · 1:28:18 · 3:37/mi" — three numbers, two of which disprove the
   * third, on one poster.
   *
   * The panel is the last place the contradiction can be caught, so it is
   * caught here too. Same arithmetic, one definition, no doctrine claim: a
   * row is judged only against its own other facts, so an elite and a walker
   * are both safe.
   */
  const shownPaceSPerMi = reconcilePaceWithClock(r.distanceMi, r.durationSec, r.paceSPerMi);
  // DISTANCE LEADS, because it is the first thing that can differ and the
  // only one that changes what every row under it means. A pace read across
  // 11 miles is not a pace read across the 5 that were asked for, and a
  // reader who does not know the distance moved cannot interpret the three
  // rows below.
  //
  // NO TONE, DELIBERATELY, and this is the one row where that needs saying
  // out loud. Eleven against five is unambiguous arithmetic, so unlike pace
  // there is no honest-band problem — the reason the row stays uncoloured is
  // the other rule. A runner who feels good and adds six miles has not
  // failed anything; a runner who cut a long run short for a reason the coach
  // would have agreed with has not either. Amber on this row would grade both
  // as faults, and the screen does not know which happened. It states both
  // numbers and lets the verdict — which HAS the context — do the talking.
  //
  // The row appears even when the two agree. A table called asked-vs-ran that
  // shows distance only when it went wrong is a table that means something
  // different on a good day, and the runner learns to read its absence.
  const askedMiText = fmtMi(r.askedMi);

  // Pace's tone is left unset here on purpose. There is no context-aware
  // band available to this composer for a whole-run average — no tolerance,
  // no heat adjustment, no "this is a taper session and it is SUPPOSED to be
  // slow" read reaches this function (that reasoning lives in
  // lib/coach/run-recap.ts's `deriveRecap`, which is heat/terrain/taper-aware
  // and already authors `r.verdict` in prose — but does not expose a per-
  // metric in/out-of-band boolean this composer could reuse honestly). Rule
  // one's whole point is that a naive `ran > asked` comparison here would be
  // exactly the bug this field exists to prevent — the wire contract's own
  // example is this exact row ("a client comparison would paint a
  // deliberately easy taper mile amber"). Absent stays absent until the
  // engine actually holds that judgement.
  // HEART STAYS ONLY WHEN THE SESSION ASKED FOR ONE.
  //
  // The plain reading moved to the readings below, with the other numbers a
  // sensor produced. But a hard HR CAP is not a reading, it is a prescription
  // — "stay under 146" — and exceeding it is the one unambiguous breach on
  // this table. Dropping the row wholesale would have taken that signal with
  // it, which is not what was asked for: the ask was to stop repeating what
  // the poster already says, and the poster says nothing about heart rate.
  //
  // `askedHrIsHardCap` is load-bearing. The cap is display-resolved from three
  // different meanings and only ONE is a ceiling; a threshold session that
  // reached its own LTHR reference executed exactly as asked, and inking that
  // amber would grade the point of the session as a fault.
  if (r.askedHrCap != null && r.askedHrIsHardCap) {
    askedVsRan.push({
      id: 'heart', label: 'Heart',
      sub: `under ${r.askedHrCap}`,
      value: num(r.avgHr != null ? `${r.avgHr}` : null, false),
      action: null,
      // F-14 · THE cap comparison, from THE owner. This read `avgHr > cap`
      // while `run-recap.ts`'s easy arm read `avgHr > cap + 5`, so an easy run
      // at cap 145 / avg 148 drew an amber row here and then said nothing
      // about heart rate three lines below — one screen contradicting itself.
      tone: hrCapBreached(r.avgHr, r.askedHrCap) ? 'attention' : null,
    });
  }

  const askedPaceText = r.askedPaceSPerMi != null ? fmtPace(r.askedPaceSPerMi) : 'by feel';
  askedVsRan.push({
    id: 'effort', label: 'Effort',
    sub: r.effortAsked ? `${r.effortAsked.lo} to ${r.effortAsked.hi}` : null,
    value: r.effortLogged != null ? num(`${r.effortLogged} of 10`, false) : null,
    // The engine hands over an explicit two-sided band (effortAsked.lo/hi) —
    // outside it is unambiguous, no inference required on either side.
    tone: (r.effortAsked != null && r.effortLogged != null
      && (r.effortLogged < r.effortAsked.lo || r.effortLogged > r.effortAsked.hi))
      ? 'attention' : null,
    // Effort is the only tappable row (design contract, 5b) — present a
    // verb only when it has not been logged yet.
    action: r.effortLogged == null ? 'log_effort' : null,
  });

  // 2026-08-27 · this used to always return the 2-entry array for an indoor
  // run, with `num(null, true)` entries when `beltAverages` found nothing —
  // a valid V5Stat with no printable text, not a missing one. The phone gates
  // this card on `!belt.isEmpty`, which a 2-null-entry array never is, so a
  // run with no matched completion (the coach_intents lookup above misses —
  // most often a same-day-but-different-timezone-read miss, see `completion`)
  // rendered "On the belt / SPEED / INCLINE" with both values permanently
  // blank instead of the card simply not showing. Return null outright when
  // neither number resolved, so the phone-side gate actually hides it.
  const onTheBelt: V5Stat[] | null = r.indoor && (r.speedMph != null || r.inclinePct != null)
    ? [
        // RULE ONE. There is no sensor on a treadmill session — `beltAverages`
        // rolls up the SETTINGS the runner confirmed on the console, which is
        // a self-reported figure, not a read. The live console says so in as
        // many words on the screen before this one ("Distance is from the belt
        // speed you set · nothing here measured it"); the recap said the
        // opposite by shipping the same numbers unmarked.
        { label: 'Speed', value: num(r.speedMph != null ? r.speedMph.toFixed(1) : null, true), tone: null },
        // Bare number. The screen draws the unit beside it, the same way it
        // draws "mph" beside the speed — carrying the % here too printed
        // "1.0% %".
        { label: 'Incline', value: num(r.inclinePct != null ? r.inclinePct.toFixed(1) : null, true), tone: null },
      ]
    : null;

  // On a treadmill run elevation is absent — the design replaces the route
  // card entirely rather than showing an empty one (Gap B12).
  const elevation = r.indoor ? null : r.elevationSamples;

  const panelStats: V5Stat[] = [
    // Null, not a typed dash — see the askedVsRan pace row above.
    // THE DISTANCE ACTUALLY RUN, to two places.
    //
    // `fmtMi` rounds to a tenth and drops a trailing zero, so 4.02 printed
    // "4 mi" — the PRESCRIBED distance, sitting where the run's own figure
    // goes. A run is almost never exactly what was asked for, and a poster
    // that rounds the difference away is quietly agreeing with the plan
    // instead of reporting the morning.
    { label: 'Distance', value: num(fmtMi2(r.distanceMi), false), tone: null },
    { label: 'Time', value: num(fmtClock(r.durationSec), false), tone: null },
    { label: 'Pace', value: num(fmtPace(shownPaceSPerMi), false), tone: null },
  ];

  const panelKicker = r.indoor ? 'Treadmill · indoor, no GPS' : null;

  // NOTHING ASSIGNED IS A STATE, NOT AN ABSENCE.
  //
  // The row used to be built only when a shoe was known, so a run with no
  // assignment lost the whole section — and with it the only way to say which
  // pair it was. It now draws with the question unanswered and the picker
  // attached, which is the honest-degrade half of rule three: a refusal that
  // still lets the runner act.
  const shoesWorn: V5Row | null = (r.shoeWorn == null && (r.shoeOptions ?? []).length > 0)
    ? { id: 'shoe-unknown', label: 'Not recorded', sub: 'Pick the pair you wore', value: null, action: 'change_shoe' }
    : r.shoeWorn
    // RULE THREE, the honest-degrade half, and the distinction is on the
    // INPUT rather than on `fmtMi`'s output.
    //
    // `fmtMi` returns null for a missing figure AND for zero, so `?? '0 mi'`
    // collapsed the two: a shoe with no recorded mileage and a shoe with none
    // yet run printed the same line, and only one of those is something
    // somebody actually knows.
    //
    // The first draft of this fix inverted the defect — it treated every
    // falsy `fmtMi` as unknown, which relabels a genuinely brand-new shoe as
    // untracked. `shoes.mileage` is NOT NULL DEFAULT 0, so ZERO is the common
    // case and absent is the rare one; getting that backwards would have made
    // the line wrong more often, not less.
    //
    // So: a number that is really there prints, zero included. Only a value
    // that is absent or unreadable declines. `Number()` first because a
    // Postgres `numeric` arrives over node-pg as a STRING, and
    // `Number.isFinite('212')` is false.
    ? {
        id: r.shoeWorn.id, label: r.shoeWorn.name,
        sub: r.shoeWorn.mi != null && Number.isFinite(Number(r.shoeWorn.mi))
          ? `${fmtMi(r.shoeWorn.mi) ?? '0 mi'} on them`
          : 'Mileage not tracked',
        value: null, action: 'change_shoe',
      }
    : null;

  // The menu's contents. Same line shape as the worn row, so the chosen one
  // reads identically before and after the choice.
  const shoeOptions: V5Row[] = (r.shoeOptions ?? []).map((o) => ({
    id: o.id,
    label: o.name,
    sub: o.mi != null && Number.isFinite(Number(o.mi))
      ? `${fmtMi(o.mi) ?? '0 mi'} on them`
      : 'Mileage not tracked',
    value: null,
    action: null,
  }));

  /* THE WEEKLY MILEAGE PERCENTAGE IS GONE (2026-09-02).
   *
   * It was the whole of "What this did" — "This week · 14.7 of 45 mi done ·
   * 33%" — offered as the answer to what a run changed. The post-run brief's
   * DELETE list names it: "weekly mileage percentage as the meaning of a run".
   * A completion share is a fact about the WEEK, it is already on Block, and
   * it says nothing about the session the runner just finished.
   *
   * What replaced it is `postRun` — the Evidence Engine's actual read of what
   * the run contributed, the plan's actual response, and the next action when
   * there is one. That is an answer; a percentage is a progress bar.
   *
   * The array survives because the flagged-niggle row still travels on it,
   * with the action the phone needs to undo it. */
  const whatThisDidToTheWeek: V5Row[] = [];
  if (r.niggleFlagged) {
    whatThisDidToTheWeek.push({
      id: 'niggle', label: `${r.niggleFlagged} flagged`,
      sub: 'The coach has it · it shapes tomorrow', value: null, action: 'undo_niggle',
    });
  }
  // No `flag-niggle` row in the other branch. The SCREEN owns the way to flag
  // one — an expanding body-part picker that writes — so emitting a row here
  // too put "Flag a niggle" on the screen twice, once inert and once real.

  return { askedVsRan, onTheBelt, shoeOptions, elevation, routeSplits: r.indoor ? [] : r.routeSplits, routePhases: r.indoor ? [] : r.routePhases, hrZones: r.hrZones, paceBand: r.paceBand, routePolyline: r.indoor ? null : r.routePolyline, elevGainFt: r.indoor ? null : r.elevGainFt, elevGainMeasured: r.indoor ? false : r.elevGainMeasured, panelStats, panelKicker, shoesWorn, whatThisDidToTheWeek };
}

// ─────────────────────────────────────────────────────────────────────────
// The composer
// ─────────────────────────────────────────────────────────────────────────

const EMPTY_TODAY = (todayISO: string, state: V5TodayStateWire): V5Today => ({
  dateISO: todayISO,
  state,
  panel: {
    dayState: 'rest', quiet: true, place: 'Today', dateLine: dateLineFor(todayISO),
    weekLine: null, kicker: null, type: '', dose: null, stats: [],
  },
  weekStrip: [],
  groups: [],
  why: null,
  thesis: null,
  whereYouAre: [],
  beforeYouGo: [],
  paceNote: null,
  blockNote: null,
  askedVsRan: [],
  verdict: null,
  facts: [],
  win: null,
  conditionsNote: null,
  coachTip: null,
  hrAvg: null,
  hrMax: null,
  cadenceAvg: null,
  tempF: null,
  workoutType: null,
  hrAvgWork: null,
  cadenceAvgWork: null,
  paceWork: null,
  zoneShares: null,
  zoneTarget: null,
  zoneTargets: null,
  elevation: null,
  routePolyline: null,
  elevGainFt: null,
  elevGainMeasured: false,
  shoeOptions: [],
  routeSplits: [],
  routePhases: [],
  hrZones: [],
  paceBand: null,
  onTheBelt: null,
  shoesWorn: null,
  whatThisDidToTheWeek: [],
  postRun: null,
  runId: null,
  changed: null,
  injury: null,
  sick: null,
  weekOff: null,
  offSeason: null,
  notOnPhoneYet: null,
});

export function composeV5Today(rawCtx: V5TodayContext): V5Today {
  // Applied ONCE, before any state branch reads `whereYouAre` — there are two
  // assignment sites below and a third would be easy to add without noticing.
  const ctx: V5TodayContext = rawCtx.isSteppedDay
    ? { ...rawCtx, whereYouAre: [] }
    : rawCtx;
  // RULE 3 first: the phone has no screens for coached / just-run /
  // distance-goal-without-a-race. This is a refusal, not an attempt to
  // populate a payload the client cannot render.
  if (!ctx.raceMode) {
    const t = EMPTY_TODAY(ctx.todayISO, 'not_on_phone_yet');
    t.notOnPhoneYet = 'This phone build only coaches toward a goal race. Coached, just-run and distance-goal training keep running in the app, just not here yet.';
    return t;
  }

  // ── injury_flare — a quiet panel, nothing to prescribe (RULE 3) ────────
  if (ctx.injury) {
    const t = EMPTY_TODAY(ctx.todayISO, 'injury_flare');
    t.panel.quiet = true;
    t.panel.type = 'Not today';
    t.injury = {
      area: ctx.injury.area,
      since: ctx.injury.since,
      verdict: ctx.injury.verdict,
      whatChanged: ctx.injury.whatChanged,
      checkIn: ctx.injury.checkIn,
      returnAvailable: ctx.injury.returnAvailable,
    };
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  // ── sick — a quiet panel too, but NOT the same screen as injury (RULE 3).
  // Checked second: a diagnosed injury owns the screen over a concurrent
  // sick day, which is the rarer overlap and the one where the injury's own
  // load restrictions are more specific than "rest, you're sick".
  if (ctx.sick) {
    const t = EMPTY_TODAY(ctx.todayISO, 'sick');
    t.panel.quiet = true;
    t.panel.type = 'Not today';
    t.sick = {
      symptoms: ctx.sick.symptoms,
      hasFever: ctx.sick.hasFever,
      since: ctx.sick.since,
      verdict: ctx.sick.verdict,
      checkIn: ctx.sick.checkIn,
    };
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  /* ── SAFETY UNKNOWN — a quiet panel that names a FAILURE, not an injury.
   *
   * Deliberately NOT a new `V5TodayStateWire` value. Adding one would make
   * every deployed build decode a state it has never seen, on the screen whose
   * whole job here is to be conservative. `before_run` with an empty group
   * list and a quiet panel is the shape `todayPlanUnresolved` already ships,
   * so this renders correctly on builds that shipped before it existed.
   *
   * The 56pt word is NOT CLEARED, on the same grammar as NOTHING SET: it says
   * what is true (nothing has cleared today) without saying what is not known
   * to be true (that the runner is hurt).
   */
  if (ctx.safetyUnknown) {
    const t = EMPTY_TODAY(ctx.todayISO, 'before_run');
    t.panel.quiet = true;
    t.panel.type = 'NOT CLEARED';
    t.panel.weekLine = ctx.weekLine;
    t.why = ctx.safetyUnknown.verdict;
    t.whereYouAre = ctx.safetyUnknown.rows;
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  // ── week_off — a deliberate break, still a gradient panel (rest hue) ──
  if (ctx.weekOff) {
    const t = EMPTY_TODAY(ctx.todayISO, 'week_off');
    t.panel.quiet = false;
    t.panel.dayState = 'rest';
    t.panel.type = 'Week off';
    t.panel.kicker = ctx.weekOff.reason;
    t.weekOff = {
      reason: ctx.weekOff.reason,
      fromISO: ctx.weekOff.fromISO,
      toISO: ctx.weekOff.toISO,
      coachLine: 'A zero week goes in the book. The plan resumes where you are, not where the calendar says.',
      nextUp: ctx.weekOff.nextUp
        ? { id: 'next-up', label: ctx.weekOff.nextUp.label, sub: ctx.weekOff.nextUp.sub, value: null, action: null }
        : null,
    };
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  // ── off_season — the coach has nothing honest to say yet (RULE 3) ─────
  if (ctx.offSeason) {
    const t = EMPTY_TODAY(ctx.todayISO, 'off_season');
    t.panel.quiet = true;
    t.panel.type = 'Off-season';
    t.offSeason = {
      sinceLastRace: ctx.offSeason.sinceLastRace,
      silenceReason: ctx.offSeason.silenceReason,
      weeklyRange: ctx.offSeason.weeklyRange,
    };
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  // ── after_run (incl. treadmill, 5c) ─────────────────────────────────────
  if (ctx.recentRun) {
    const built = buildRecentRun(ctx.recentRun);
    const t = EMPTY_TODAY(ctx.todayISO, 'after_run');
    t.panel = {
      dayState: dayStateWordFor(ctx.todayPlan?.type),
      quiet: false,
      place: 'Today',
      dateLine: ctx.phaseLine ?? dateLineFor(ctx.todayISO),
      // NO LINE HERE AT ALL. David, 2026-08-21: "its redundent".
      //
      // It printed the elapsed time under the word "Logged" — a duration
      // formatted as a clock, and the same figure already standing in the
      // stats row two lines below. Replacing it with the real clock time
      // fixed the nonsense and left the slot saying something the poster does
      // not need: the three numbers are the story, and a fourth quiet figure
      // beside them is furniture.
      //
      // The 0821 rule that named the duplicate — "No content is ever printed
      // twice on one screen" — is satisfied by deleting it, not by finding it
      // a different number to hold.
      weekLine: null,
      kicker: built.panelKicker,
      type: displayTypeFor(ctx.todayPlan?.type, ctx.todayPlan?.subLabel),
      dose: null,
      stats: built.panelStats,
    };
    t.groups = buildGroups(ctx.prescription);
    t.why = ctx.why;
    t.thesis = ctx.thesis ?? null;
    t.whereYouAre = ctx.whereYouAre;
    t.beforeYouGo = [];
    t.paceNote = ctx.paceNote;
    t.blockNote = ctx.blockNote ?? null;
    t.askedVsRan = built.askedVsRan;
    t.verdict = ctx.recentRun.verdict;
    // QUOTED, NEVER RE-WRITTEN. One voice, one composer — the same rule
    // `coachLine` keeps above. This branch's only job is to stop dropping them.
    t.facts = ctx.recentRun.facts;
    t.win = ctx.recentRun.win;
    t.conditionsNote = ctx.recentRun.conditionsNote;
    t.coachTip = ctx.recentRun.coachTip;
    // THE READING, straight through. `avgHr` already travelled on this
    // context for the recap's own arithmetic and stopped at the composer; the
    // other three are new. All four now reach the screen.
    t.hrAvg = ctx.recentRun.avgHr;
    t.hrMax = ctx.recentRun.hrMax;
    t.cadenceAvg = ctx.recentRun.cadenceAvg;
    t.tempF = ctx.recentRun.tempF;
    t.workoutType = ctx.recentRun.workoutType;
    t.hrAvgWork = ctx.recentRun.hrAvgWork;
    t.cadenceAvgWork = ctx.recentRun.cadenceAvgWork;
    t.paceWork = ctx.recentRun.paceWork;
    t.zoneShares = ctx.recentRun.zoneShares;
    t.zoneTarget = ctx.recentRun.zoneTarget;
    t.zoneTargets = ctx.recentRun.zoneTargets;
    t.elevation = built.elevation;
    t.routePolyline = built.routePolyline;
    t.routeSplits = built.routeSplits;
    t.routePhases = built.routePhases;
    t.hrZones = built.hrZones;
    t.paceBand = built.paceBand;
    t.elevGainFt = built.elevGainFt;
    t.elevGainMeasured = built.elevGainMeasured;
    t.onTheBelt = built.onTheBelt;
    t.shoesWorn = built.shoesWorn;
    t.shoeOptions = built.shoeOptions;
    t.whatThisDidToTheWeek = built.whatThisDidToTheWeek;
    t.postRun = ctx.postRun ?? null;
    t.runId = ctx.recentRun.runId;
    t.weekStrip = buildWeekStrip(ctx);
    return t;
  }

  // ── changed_overnight (17a) — RULE 2 gate lives inside buildConvergence ─
  const changed = ctx.convergence ? buildConvergence(ctx.convergence) : null;

  const t = EMPTY_TODAY(ctx.todayISO, changed ? 'changed_overnight' : (ctx.raceDay ? 'race_day' : 'before_run'));
  t.panel = {
    dayState: changed ? 'rest' : dayStateWordFor(ctx.todayPlan?.type),
    quiet: false,
    place: 'Today',
    dateLine: ctx.phaseLine ?? dateLineFor(ctx.todayISO),
    weekLine: changed
      ? (ctx.convergence
          ? `Updated ${ctx.convergence.updatedAt}${ctx.convergence.wasType ? ' · was ' + ctx.convergence.wasType : ''}`
          : ctx.weekLine)
      : ctx.weekLine,
    kicker: ctx.weatherKicker,
    // RULE 11 · "NOTHING SET" IS NOT "REST".
    //
    // `displayTypeFor(undefined)` answers 'Rest', which is correct for a rest
    // ROW and a fabrication for a missing one. The runner reads this word at
    // 56pt and takes the day off on it. The gradient stays the quiet one —
    // `dayState` is a six-value wire enum the phone maps to a background, and
    // an unprescribed day is visually a non-session day — but the WORD tells
    // the truth, and the About card underneath says which of the two it is.
    type: ctx.todayPlanUnresolved
      ? 'NOTHING SET'
      : displayTypeFor(ctx.todayPlan?.type, ctx.todayPlan?.subLabel),
    // David, live in the simulator, 2026-08-25: "it says REST, REST day.
    // then extra rest" — three statements of the same fact stacked at the
    // top of one screen. `type` already carries the word at 56pt; the dose
    // line's job is to add the NUMBER that word alone can't say. A rest day
    // has no number, so the fallback below reached for
    // `sessionRationale('rest').headline` — 'Rest day' — which is not new
    // information, it is `type` said again in a different case. Sitting
    // directly under a 56pt REST, that repetition is the loudest of the
    // three; the "About" section a few rows down ("Extra rest, still
    // recovering") is a real THIRD sentence but reads as pure pile-on once
    // this one is gone.
    //
    // Genuinely null, not a fabricated dash: `FaffValueText` conflates "we
    // don't know" and "there is nothing to know" only when a caller passes
    // `.unreadableIfAbsent`. The client side of this fix reads the field as
    // `.optionalValue` instead, so a rest day draws no dose row at all
    // rather than an unexplained "—".
    dose: ctx.prescription && ctx.todayPlan?.type !== 'rest'
      ? num(fmtMi(ctx.prescription.total_mi) ?? ctx.prescription.headline, false)
      : null,
    stats: [
      // RULE ONE. Both of these shipped `false` and neither is a read of
      // anything that happened.
      //
      // The pace band is `derivePaces()`, whose whole tree hangs off
      // `tPaceFromGoal(goal_seconds, goal_distance_mi)` — the runner's own
      // TYPED GOAL TIME back-solved to a threshold pace, then offset by fixed
      // Daniels constants (T+80, T+120, T-18 …). It is a model built on an
      // aspiration, and it was the largest number on the panel wearing no
      // mark at all. The design contract names this case in as many words:
      // the tilde belongs on "any training-derived (not race-confirmed) pace
      // read", and a goal-derived read is not even training-derived.
      //
      // The HR ceiling is `computeZones({ lthr }).z2.upper` — a zone-model
      // boundary off a stored LTHR. A ceiling derived from a threshold
      // estimate is not a heart rate anyone measured.
      //
      // When a genuinely race-anchored pace read exists, this is the place to
      // thread its basis through and let it ship `false`. Until then the
      // honest answer is the humble one — ValuesV5's own rule: over-marking
      // makes a measured number look modest, under-marking is the sin.
      ...(ctx.paceBandStat ? [{ label: 'Pace band', value: num(ctx.paceBandStat, true), tone: null }] : []),
      ...(ctx.hrCapStat ? [{ label: 'HR ceiling', value: num(ctx.hrCapStat, true), tone: null }] : []),
      ...(ctx.effortStat ? [{ label: 'Effort', value: num(ctx.effortStat, true), tone: null }] : []),
    ],
  };
  // RULE 17 · a surface must not contradict the sentence above it.
  //
  // On a date the block does not prescribe, `glance` still manufactures a rest
  // day of its own (`planRow?.type ?? (plan ? 'rest' : 'unplanned')` — the same
  // collapse as the week loader's), so a prescription was built and rendered a
  // rest group UNDER a hero that had just said NOTHING SET. Seen on the live
  // account at ?date=2026-08-29. The hero is the honest one; the group goes.
  t.groups = ctx.todayPlanUnresolved
    ? []
    : [...buildGroups(ctx.prescription), ...buildContingencyGroup(ctx.contingency)];
  t.why = ctx.why;
  t.thesis = ctx.thesis ?? null;
  t.whereYouAre = ctx.whereYouAre;
  t.beforeYouGo = ctx.beforeYouGo;
  t.paceNote = ctx.paceNote;
  t.blockNote = ctx.blockNote ?? null;
  t.changed = changed;
  t.weekStrip = buildWeekStrip(ctx);
  return t;
}
