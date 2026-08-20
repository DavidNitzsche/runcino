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
 *     phone's own decoder defaults an ABSENT `modelled` key to `true` (over-
 *     marking is the safe failure), so this file explicitly stamps `false`
 *     on every value below, because every number Today shows the runner IS
 *     measured or IS the day's real prescription — a dose, a pace band, an
 *     HR cap, a logged split, a biometric reading. Today carries no
 *     projections (those live on Races/Paces); see the composer's own header
 *     comment on `num()` for the one place this needs a human to re-check it
 *     if that ever stops being true.
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
}

export interface V5Step {
  id: string;
  main: string;
  sub: V5Number | null;
}

export interface V5Group {
  id: string;
  title: string;
  note: string | null;
  steps: V5Step[];
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

export type V5TodayStateWire =
  | 'before_run' | 'after_run' | 'changed_overnight' | 'injury_flare'
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

  askedVsRan: V5Row[];
  verdict: string | null;
  zoneShares: number[] | null;
  zoneTarget: number | null;
  elevation: number[] | null;
  onTheBelt: V5Stat[] | null;
  shoesWorn: V5Row | null;
  whatThisDidToTheWeek: V5Row[];
  runId: string | null;

  changed: V5Convergence | null;
  injury: V5Injury | null;
  weekOff: V5WeekOff | null;
  offSeason: V5OffSeason | null;

  notOnPhoneYet: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Rule 1 as a function. The ONLY way a number reaches V5Today.
//
// Every call site in this file passes `modelled: false` explicitly — Today
// has no projected numbers (see the file header). If a future addition to
// this composer computes something genuinely modelled (a projected finish, a
// training-derived pace not yet confirmed by a race), it must call
// `num(text, true)` and say so in a comment, never rely on this default.
// ─────────────────────────────────────────────────────────────────────────

export function num(text: string | null, modelled: boolean): V5Number {
  return { text, modelled };
}

const MIN_CONVERGING_DOMAINS = 3; // CONVERGENCE.redMinDomains, lib/coach/convergence.ts

// ─────────────────────────────────────────────────────────────────────────
// Small formatting helpers
// ─────────────────────────────────────────────────────────────────────────

export function fmtMi(mi: number | null | undefined): string | null {
  if (mi == null || !isFinite(mi) || mi <= 0) return null;
  const rounded = Math.round(mi * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} mi`;
}

export function fmtPace(sPerMi: number | null | undefined): string | null {
  if (sPerMi == null || !isFinite(sPerMi) || sPerMi <= 0) return null;
  const m = Math.floor(sPerMi / 60);
  const s = Math.round(sPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}/mi`;
}

export function fmtClock(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec <= 0) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
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

/** Title-case display type ("Easy" / "Threshold" / "Long" / "Race" / "Rest").
 *  The client uppercases it at the call site (design contract, V5Panel.type
 *  doc comment) — this stays Title Case so it also reads fine anywhere the
 *  client does NOT uppercase (e.g. inside a coach-voice sentence). */
export function displayTypeFor(plannedType: string | null | undefined, subLabel?: string | null): string {
  if (subLabel && subLabel.trim() && subLabel.trim().toUpperCase() !== 'REST') {
    // sub_label already carries the runner-facing name for quality/tuneup
    // sessions ("THRESHOLD", "FIELD TEST") — title-case it rather than
    // re-deriving from the raw type column.
    const s = subLabel.trim();
    return s.charAt(0) + s.slice(1).toLowerCase();
  }
  const word = dayStateWordFor(plannedType);
  switch (word) {
    case 'long': return 'Long';
    case 'race': return 'Race';
    case 'quality': return 'Quality';
    case 'rest': return 'Rest';
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
  askedHrCap: number | null;
  effortAsked: { lo: number; hi: number } | null;
  effortLogged: number | null;
  verdict: string | null;
  zoneShares: number[] | null;
  zoneTarget: number | null;
  elevationSamples: number[] | null;
  elevGainFt: number | null;
  weekDoneMi: number;
  weekPlannedMi: number | null;
  shoeWorn: { id: string; name: string; mi: number } | null;
  niggleFlagged: string | null;
}

export interface V5TodayContext {
  todayISO: string;
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
  convergence: V5ConvergenceCtx | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Sub-builders
// ─────────────────────────────────────────────────────────────────────────

function buildGroups(rx: V5PrescriptionLike | null): V5Group[] {
  if (!rx || rx.steps.length === 0) return [];

  const stepMain = (s: V5PrescriptionStepLike): string => {
    if (s.reps != null && s.reps > 0) {
      const rd = fmtMi(s.rep_distance_mi);
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
    return text ? num(text, false) : null;
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
    });
  }
  if (work.length > 0) {
    const workMi = work.reduce((s, x) => s + (x.distance_mi ?? (x.reps ?? 0) * (x.rep_distance_mi ?? 0)), 0);
    groups.push({
      id: 'work', title: warm.length > 0 || cool.length > 0 ? 'Work' : rx.headline,
      note: fmtMi(workMi),
      steps: work.map((s, i) => toStep(s, i, 'work')),
    });
  }
  if (cool.length > 0) {
    groups.push({
      id: 'cooldown', title: 'Cool down',
      note: fmtMi(cool.reduce((s, x) => s + (x.distance_mi ?? 0), 0)),
      steps: cool.map((s, i) => toStep(s, i, 'cooldown')),
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

  const converged: V5ConvergedDomain[] = c.verdict.converging.map((domain, i) => {
    const reading = c.readings[domain];
    return {
      id: `${domain}-${i}`,
      domain: domainDisplayName(domain),
      value: num(reading?.value ?? '—', false),
      baseline: reading?.baseline ?? '',
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
  panelStats: V5Stat[];
  panelKicker: string | null;
  shoesWorn: V5Row | null;
  whatThisDidToTheWeek: V5Row[];
} {
  const askedVsRan: V5Row[] = [];

  const askedPaceText = r.askedPaceSPerMi != null ? fmtPace(r.askedPaceSPerMi) : 'by feel';
  askedVsRan.push({
    id: 'pace', label: 'Pace', sub: askedPaceText,
    value: num(fmtPace(r.paceSPerMi) ?? '—', false),
    action: null,
  });
  askedVsRan.push({
    id: 'heart', label: 'Heart',
    sub: r.askedHrCap != null ? `under ${r.askedHrCap}` : null,
    value: num(r.avgHr != null ? `${r.avgHr}` : '—', false),
    action: null,
  });
  askedVsRan.push({
    id: 'effort', label: 'Effort',
    sub: r.effortAsked ? `${r.effortAsked.lo} to ${r.effortAsked.hi}` : null,
    value: r.effortLogged != null ? num(`${r.effortLogged} of 10`, false) : null,
    // Effort is the only tappable row (design contract, 5b) — present a
    // verb only when it has not been logged yet.
    action: r.effortLogged == null ? 'log_effort' : null,
  });

  const onTheBelt: V5Stat[] | null = r.indoor
    ? [
        { label: 'Speed', value: num(r.speedMph != null ? r.speedMph.toFixed(1) : '—', false), tone: null },
        { label: 'Incline', value: num(r.inclinePct != null ? `${r.inclinePct.toFixed(1)}%` : '—', false), tone: null },
      ]
    : null;

  // On a treadmill run elevation is absent — the design replaces the route
  // card entirely rather than showing an empty one (Gap B12).
  const elevation = r.indoor ? null : r.elevationSamples;

  const panelStats: V5Stat[] = [
    { label: 'Distance', value: num(fmtMi(r.distanceMi) ?? '—', false), tone: null },
    { label: 'Time', value: num(fmtClock(r.durationSec) ?? '—', false), tone: null },
    { label: 'Pace', value: num(fmtPace(r.paceSPerMi) ?? '—', false), tone: null },
  ];

  const panelKicker = r.indoor ? 'Treadmill · indoor, no GPS' : null;

  const shoesWorn: V5Row | null = r.shoeWorn
    ? { id: r.shoeWorn.id, label: r.shoeWorn.name, sub: `${fmtMi(r.shoeWorn.mi) ?? '0 mi'} on them`, value: null, action: 'change_shoe' }
    : null;

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
  } else {
    whatThisDidToTheWeek.push({
      id: 'flag-niggle', label: 'Flag a niggle',
      sub: 'Anything that felt wrong', value: null, action: 'flag_niggle',
    });
  }

  return { askedVsRan, onTheBelt, elevation, panelStats, panelKicker, shoesWorn, whatThisDidToTheWeek };
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
  askedVsRan: [],
  verdict: null,
  zoneShares: null,
  zoneTarget: null,
  elevation: null,
  onTheBelt: null,
  shoesWorn: null,
  whatThisDidToTheWeek: [],
  runId: null,
  changed: null,
  injury: null,
  weekOff: null,
  offSeason: null,
  notOnPhoneYet: null,
});

export function composeV5Today(ctx: V5TodayContext): V5Today {
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
      weekLine: `Logged ${fmtClock(ctx.recentRun.durationSec) ?? ''}`,
      kicker: built.panelKicker,
      type: displayTypeFor(ctx.todayPlan?.type, ctx.todayPlan?.subLabel),
      dose: null,
      stats: built.panelStats,
    };
    t.groups = buildGroups(ctx.prescription);
    t.why = ctx.why;
    t.whereYouAre = ctx.whereYouAre;
    t.beforeYouGo = [];
    t.askedVsRan = built.askedVsRan;
    t.verdict = ctx.recentRun.verdict;
    t.zoneShares = ctx.recentRun.zoneShares;
    t.zoneTarget = ctx.recentRun.zoneTarget;
    t.elevation = built.elevation;
    t.onTheBelt = built.onTheBelt;
    t.shoesWorn = built.shoesWorn;
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
      ...(ctx.paceBandStat ? [{ label: 'Pace band', value: num(ctx.paceBandStat, false), tone: null }] : []),
      ...(ctx.hrCapStat ? [{ label: 'HR ceiling', value: num(ctx.hrCapStat, false), tone: null }] : []),
      ...(ctx.effortStat ? [{ label: 'Effort', value: num(ctx.effortStat, false), tone: null }] : []),
    ],
  };
  t.groups = buildGroups(ctx.prescription);
  t.why = ctx.why;
  t.whereYouAre = ctx.whereYouAre;
  t.beforeYouGo = ctx.beforeYouGo;
  t.changed = changed;
  t.weekStrip = buildWeekStrip(ctx);
  return t;
}
