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
  whereYouAre: V5Row[];
  beforeYouGo: V5Row[];
  /// Present only when the active plan carries an unacknowledged pace-drop
  /// event (`lib/plan/pace-drop-event.ts`) — the coach-line entry point onto
  /// 18a (`V5Route.pacesMoved`), never shown on a state that has nothing new
  /// to say. See `app/api/v5/today/route.ts`'s pace-note block.
  paceNote: V5Row | null;

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
  }>;
  /** Workout phases, so reps colour at their true pace. Empty on a steady run. */
  routePhases: Array<{ mi: number; sec: number }>;
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
import { fmtMi, fmtClock, fmtPaceSlash as fmtPace } from '@/lib/format/run';
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



const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * "Thursday 20 August" — day, then date, then month.
 *
 * The design's own sample data writes it that way, and Block's panel already
 * did ("20 August") while Today wrote "Thursday August 20". Two date formats
 * on two tabs of the same app is the kind of thing nobody reports and everyone
 * notices.
 */
export function dateLineFor(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return `${DOW_FULL[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_FULL[d.getUTCMonth()]}`;
}

/** dayState the phone's 6-gradient vocabulary accepts. `plannedType` is the
 *  raw `plan_workouts.type` (or GlanceWeekDay.plannedType) column value. */
export function dayStateWordFor(plannedType: string | null | undefined): V5DayStateWord {
  const t = (plannedType ?? '').toLowerCase();
  if (t === 'long') return 'long';
  if (t === 'race' || t === 'race_week_tuneup') return 'race';
  if (['threshold', 'tempo', 'intervals', 'fartlek', 'progression', 'vo2max', 'quality'].includes(t)) return 'quality';
  if (t === 'rest' || t === '' || t === 'unplanned') return 'rest';
  return 'easy';
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
  // sub_label carries the runner-facing name for quality/tuneup sessions
  // ("THRESHOLD", "FIELD TEST") — prefer it, but only when it IS a name.
  if (subLabelIsName(subLabel)) return deshout(String(subLabel).trim());

  // Otherwise name the session from its own type column. This stays finer
  // grained than `dayStateWordFor`, which collapses every quality variant to
  // the single gradient word "quality" — the gradient has six buckets, the
  // headline does not have to.
  const t = (plannedType ?? '').trim().toLowerCase();
  switch (t) {
    case 'long': return 'Long';
    case 'race': return 'Race';
    case 'race_week_tuneup': return 'Tune-up';
    case 'threshold': return 'Threshold';
    case 'tempo': return 'Tempo';
    case 'intervals': return 'Intervals';
    case 'fartlek': return 'Fartlek';
    case 'progression': return 'Progression';
    case 'vo2max': return 'VO2 max';
    case 'quality': return 'Quality';
    case 'recovery': return 'Recovery';
    case 'rest': case '': case 'unplanned': return 'Rest';
    default: return 'Easy';
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
}

export interface V5PrescriptionLike {
  type: string;
  headline: string;
  why: string;
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
  }>;
  routePhases: Array<{ mi: number; sec: number }>;
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

  whereYouAre: V5Row[];   // readiness/week-status rows
  beforeYouGo: V5Row[];   // shoe pick, fuel, move/skip rows
  /// See `V5Today.paceNote`. Only set on the content states (before_run /
  /// race_day / changed_overnight / after_run) — never on a refusal state,
  /// which already has its own thing to say.
  paceNote: V5Row | null;

  raceDay: boolean;

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
      return rd ? `${s.reps} × ${rd}` : `${s.reps} reps`;
    }
    const dist = fmtMi(s.distance_mi);
    if (dist) return dist;
    // No structural distance/reps to report (a rest day's single "Today"
    // step, or a duration-only step) — the note is the real content, not
    // the bare structural label.
    return s.duration ?? s.note ?? s.label;
  };
  const stepSub = (s: V5PrescriptionStepLike): V5Number | null => {
    const text = s.pace_target ?? s.hr_target ?? null;
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

  const warm = rx.steps.filter((s) => s.label.toLowerCase() === 'warmup');
  const cool = rx.steps.filter((s) => s.label.toLowerCase() === 'cooldown');
  const work = rx.steps.filter((s) => s.label.toLowerCase() !== 'warmup' && s.label.toLowerCase() !== 'cooldown');

  const groups: V5Group[] = [];
  if (warm.length > 0) {
    groups.push({
      id: 'warmup', title: 'Warm up',
      note: fmtMi(warm.reduce((s, x) => s + (x.distance_mi ?? 0), 0)),
      steps: warm.map((s, i) => toStep(s, i, 'warmup')),
      // Never the work — the engine says so explicitly rather than leaving
      // the client to infer it from this group's position in the list.
      isWork: false,
    });
  }
  if (work.length > 0) {
    const workMi = work.reduce((s, x) => s + (x.distance_mi ?? (x.reps ?? 0) * (x.rep_distance_mi ?? 0)), 0);
    groups.push({
      id: 'work', title: warm.length > 0 || cool.length > 0 ? 'Work' : rx.headline,
      note: fmtMi(workMi),
      steps: work.map((s, i) => toStep(s, i, 'work')),
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
      steps: cool.map((s, i) => toStep(s, i, 'cooldown')),
      isWork: false,
    });
  }
  return groups;
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
  if (askedMiText) {
    askedVsRan.push({
      id: 'distance', label: 'Distance',
      sub: `asked ${askedMiText}`,
      value: num(fmtMi(r.distanceMi), false),
      action: null,
    });
  }

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
  const askedPaceText = r.askedPaceSPerMi != null ? fmtPace(r.askedPaceSPerMi) : 'by feel';
  askedVsRan.push({
    id: 'pace', label: 'Pace', sub: askedPaceText,
    // RULE ONE. `?? '—'` pre-formatted the dash HERE and shipped it as a
    // measured string, which defeats the whole type: the phone's own
    // `FaffValue.from(text:modelled:)` turns a NULL text into `.unreadable`
    // and paints it fault red. A dash we typed is a measured value that
    // happens to look like a dash. Null is the honest wire shape.
    value: num(fmtPace(shownPaceSPerMi), false),
    action: null,
  });
  askedVsRan.push({
    id: 'heart', label: 'Heart',
    sub: r.askedHrCap != null ? `under ${r.askedHrCap}` : null,
    value: num(r.avgHr != null ? `${r.avgHr}` : null, false),
    action: null,
    // A stated ceiling is the one band this row's own sub-text already
    // asserts ("under 146") — exceeding it is unambiguous, no heat/taper
    // reasoning required. But `askedHrCap` is display-resolved from three
    // different meanings (see `askedHrIsHardCap`'s doc comment) and only ONE
    // of them is actually a ceiling; grading against the other two would
    // paint a threshold session that reached its own LTHR reference as a
    // miss, when reaching it was the point.
    tone: (r.askedHrIsHardCap && r.askedHrCap != null && r.avgHr != null && r.avgHr > r.askedHrCap)
      ? 'attention' : null,
  });
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

  const onTheBelt: V5Stat[] | null = r.indoor
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
    { label: 'Distance', value: num(fmtMi(r.distanceMi), false), tone: null },
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

  const doneMi = Math.round((r.weekDoneMi) * 10) / 10;
  const whatThisDidToTheWeek: V5Row[] = [
    {
      id: 'week-total', label: 'This week',
      sub: r.weekPlannedMi != null ? `${doneMi} of ${r.weekPlannedMi} mi done` : `${doneMi} mi done`,
      value: r.weekPlannedMi != null && r.weekPlannedMi > 0
        ? num(`${Math.round((doneMi / r.weekPlannedMi) * 100)}%`, false)
        : null,
      action: null,
    },
  ];
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
  whereYouAre: [],
  beforeYouGo: [],
  paceNote: null,
  askedVsRan: [],
  verdict: null,
  facts: [],
  win: null,
  conditionsNote: null,
  coachTip: null,
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
    t.whereYouAre = ctx.whereYouAre;
    t.beforeYouGo = [];
    t.paceNote = ctx.paceNote;
    t.askedVsRan = built.askedVsRan;
    t.verdict = ctx.recentRun.verdict;
    // QUOTED, NEVER RE-WRITTEN. One voice, one composer — the same rule
    // `coachLine` keeps above. This branch's only job is to stop dropping them.
    t.facts = ctx.recentRun.facts;
    t.win = ctx.recentRun.win;
    t.conditionsNote = ctx.recentRun.conditionsNote;
    t.coachTip = ctx.recentRun.coachTip;
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
    type: displayTypeFor(ctx.todayPlan?.type, ctx.todayPlan?.subLabel),
    dose: ctx.prescription ? num(fmtMi(ctx.prescription.total_mi) ?? ctx.prescription.headline, false) : null,
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
  t.groups = buildGroups(ctx.prescription);
  t.why = ctx.why;
  t.whereYouAre = ctx.whereYouAre;
  t.beforeYouGo = ctx.beforeYouGo;
  t.paceNote = ctx.paceNote;
  t.changed = changed;
  t.weekStrip = buildWeekStrip(ctx);
  return t;
}
