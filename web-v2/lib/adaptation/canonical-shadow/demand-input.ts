/**
 * lib/adaptation/canonical-shadow/demand-input.ts · BUILDING THE DEMAND
 * MODEL'S INPUT OUT OF WHAT THE LOADER ALREADY HAS.
 *
 * `live-input.ts` used to hand arbitration `absent('no weekly demand model is
 * wired into this app yet')`, and the consequence was stated in its own
 * comment: rule 1 — the week-level demand test, the only thing that can defer
 * a progression because the WEEK is full rather than because a lever held —
 * could not fire on any live evaluation. This file is what removes that.
 *
 * It contains no model. `lib/plan/adjudication/weekly-demand.ts` prices weeks
 * and `canonical/demand-ceiling.ts` is the seam onto it; this file's whole job
 * is to turn plan rows and run rows into that model's INPUT, honestly.
 *
 * ── RULE 8 · WHICH SIDE EACH READER IS ON, STATED PER READER ───────────────
 *
 * The demand model's header sets the rule and this file has to obey it in both
 * directions at once:
 *
 *   HABIT · FILTERED. `demonstratedWeeks` is the ceiling's only input and asks
 *     what he NORMALLY absorbs, so weeks the plan itself authored as a
 *     cutback, a race week, a taper or a recovery block are excluded. The
 *     filter is `prescribedNonNormalWeek` from the canonical engine's own
 *     `input.ts` — the same two-witness reconciliation (the week's flag AND
 *     the authoring plan's mode) every lever in this engine already uses, so
 *     there is one definition of "not a normal week" inside this engine rather
 *     than a second one here (Rule 16). A taper week must never raise the
 *     ceiling, and a recovery week must never lower it.
 *
 *   ABSORBED LOAD · UNFILTERED. `longestRunPrior30dMi` (the spike anchor,
 *     whose 30-day window `Research/00a` writes into its own citation), the
 *     acute-to-chronic reading, the race behind him and the weeks since his
 *     last cutback. These price the COST of a week, and a taper week is a real
 *     week his legs really did. Filtering them would make a safety-relevant
 *     reading more permissive in exactly the case it exists for.
 *
 * ── RULE 11 · WHERE THIS FILE REFUSES ──────────────────────────────────────
 *
 * Every context term is `null` when it cannot be read and a real value when it
 * can. Nothing is defaulted. In particular:
 *
 *   · quality minutes come from `qualityMinutesOfWeek`, which returns null for
 *     an unreadable spec rather than a partial sum. The literal `0` this
 *     loader used to pass for `nextWeekQualityMinutes` was the defect that
 *     made a pace correction cost nothing.
 *   · `lastRace` is `'NONE'` only when the race table was actually read and
 *     held no race before that date. Unread is null.
 *   · `absorbed` is `true` only for a week that was fully readable and
 *     actually run; everything else is `null`, never `false`. A week nobody
 *     has judged does not raise a ceiling.
 *
 * ── RULE 22 · WHAT A GATE OVER THIS FILE CANNOT FAIL ON ────────────────────
 *
 * · WHETHER `absorbed` IS TRUE IN THE SENSE THE MODEL MEANS. This app has no
 *   injury or illness feed wired into the canonical engine, so "he ran a full
 *   readable normal week" is the strongest evidence available and it is
 *   WEAKER than "he absorbed it". A week he ran and was hurt by reads as
 *   absorbed here, and that raises his ceiling. It is the single most
 *   important thing about this file that no test can check, and it is the
 *   reason the definition is written out on `absorbedVerdict` rather than
 *   buried in an expression.
 * · WHETHER THE AUTHORED SPEC DESCRIBES THE SESSION HE ACTUALLY RAN. Quality
 *   minutes are read from the prescription.
 * · THE LOOKBACK BEING LONG ENOUGH. A 12-week window cannot reconstruct an
 *   acute-to-chronic reading for its own oldest weeks, so those weeks price
 *   without a full context and the comparison degrades to BASE_ONLY. That is
 *   the designed, symmetric, stated behaviour — but nothing here can tell you
 *   whether a longer window would have found a bigger absorbed week.
 */
import { acwrFromDailyMileage, ACWR_CHRONIC_DAYS, type AcwrResult } from '@/lib/coach/acwr';
import { coverageDaysFrom } from '@/lib/runs/volume';
import { raceWindowFor } from '@/lib/coach/easy-discipline';
import { qualityMinutesOfWeek } from '@/lib/plan/adjudication/quality-minutes';
import type {
  DemonstratedWeek,
  WeekDemandContext,
} from '@/lib/adaptation/canonical/demand-ceiling';
import type { WeekObservation } from '@/lib/adaptation/canonical/input';
import { prescribedNonNormalWeek } from '@/lib/adaptation/canonical/input';

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS);

/** One day of running, as this loader already holds it. */
export interface RunDay {
  readonly dateISO: string;
  /** `null` is unreadable, never zero. */
  readonly distanceMi: number | null;
}

/** One authored session, as this loader already holds it. */
export interface AuthoredSession {
  readonly dateISO: string;
  readonly distanceMi: number | null;
  readonly isQuality: boolean;
  readonly isLong: boolean;
  readonly spec: Record<string, unknown> | null;
}

/** One race he actually ran, read from the race table. */
export interface RanRace {
  readonly dateISO: string;
  readonly distanceMi: number | null;
}

export interface DemandSubstrate {
  readonly asOfISO: string;
  readonly runs: readonly RunDay[];
  readonly sessions: readonly AuthoredSession[];
  /** Plan weeks by start date, for the cutback cadence. */
  readonly cutbackWeekStarts: readonly string[];
  /**
   * Races before `asOfISO`, or `null` when the race table was NOT read. Rule
   * 11: an empty array is "read, and he has not raced", which is a different
   * fact and prices the post-race term at a measured zero.
   */
  readonly racesRun: readonly RanRace[] | null;
  /** The plan's own week observations, for the Rule 8 habit filter. */
  readonly weekObservations: readonly WeekObservation[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE CONTEXT TERMS · one function each, so each can say which side of
 * Rule 8's corollary it sits on
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * His longest single run in the 30 days before `atISO`. LITERAL, unfiltered.
 *
 * RULE 8, SPIKE-ANCHOR SIDE. `Research/00a` writes its own window into the
 * citation, and CLAUDE.md names this exact reader as the worked example of a
 * quantity whose habit half is filtered and whose spike anchor is not.
 *
 * `null` when the window holds no readable run — which is unknown, not zero: a
 * spike ratio against a zero anchor is infinite, and reporting a 12-mile long
 * run as an infinite spike because the sync dropped a week is the collapse
 * Rule 11 forbids.
 */
export function longestRunPrior30d(runs: readonly RunDay[], atISO: string): number | null {
  const from = addDays(atISO, -30);
  let best: number | null = null;
  for (const r of runs) {
    if (r.dateISO >= atISO || r.dateISO < from) continue;
    if (r.distanceMi === null) continue;
    if (best === null || r.distanceMi > best) best = r.distanceMi;
  }
  return best;
}

/**
 * The acute-to-chronic reading as it stood at `atISO`.
 *
 * RULE 8, ABSORBED-LOAD SIDE. Acute load is supposed to move with recent load;
 * that is what makes it acute.
 *
 * Computed through `acwrFromDailyMileage`, which is the app's ONE
 * implementation (Rule 16) and returns its own refusal reason rather than a
 * number when coverage is too thin. `coverageDays` is measured from the oldest
 * run this loader actually holds, so a window that cannot support the ratio
 * says so instead of dividing by days the loader never looked at.
 */
export function acuteChronicAt(runs: readonly RunDay[], atISO: string): AcwrResult {
  const byDay = new Map<string, number>();
  let firstISO: string | null = null;
  for (const r of runs) {
    if (r.dateISO >= atISO) continue;
    if (r.distanceMi === null) continue;
    byDay.set(r.dateISO, (byDay.get(r.dateISO) ?? 0) + r.distanceMi);
    if (firstISO === null || r.dateISO < firstISO) firstISO = r.dateISO;
  }
  const yesterday = addDays(atISO, -1);
  return acwrFromDailyMileage(
    byDay, yesterday, coverageDaysFrom(firstISO, yesterday, ACWR_CHRONIC_DAYS),
  );
}

/**
 * The race behind him at `atISO`, with the no-quality window doctrine gives it.
 *
 * RULE 8, ABSORBED-LOAD SIDE — this reader exists to look at race weeks.
 * The window comes from `raceWindowFor`, which is the app's one owner of
 * `Research/00b` §"Recovery by Distance" · "Total recovery days (no quality)".
 */
export function lastRaceAt(
  races: readonly RanRace[] | null,
  atISO: string,
): { daysSince: number; noQualityWindowDays: number } | 'NONE' | null {
  if (races === null) return null;
  let latest: RanRace | null = null;
  for (const r of races) {
    if (r.dateISO >= atISO) continue;
    if (latest === null || r.dateISO > latest.dateISO) latest = r;
  }
  if (latest === null) return 'NONE';
  return {
    daysSince: daysBetween(atISO, latest.dateISO),
    noQualityWindowDays: raceWindowFor(latest.distanceMi, true),
  };
}

/**
 * Weeks since his last authored cutback, at `atISO`.
 *
 * RULE 8, ABSORBED-LOAD SIDE. Time since the tissue last got a break.
 * `null` when the plan carries no week rows at all, which is unknown; where it
 * carries rows and none is a cutback, the answer is weeks since the earliest
 * week the plan speaks about, which the model's own field doc names as the
 * correct substitute ("where he has never had one, supply weeks since the
 * block opened, which is the same question").
 */
export function weeksSinceCutbackAt(
  cutbackWeekStarts: readonly string[],
  allWeekStarts: readonly string[],
  atISO: string,
): number | null {
  const priorCutbacks = cutbackWeekStarts.filter((w) => w < atISO).sort();
  const from = priorCutbacks.length > 0
    ? priorCutbacks[priorCutbacks.length - 1]
    : [...allWeekStarts].filter((w) => w < atISO).sort()[0];
  if (from === undefined) return null;
  return Math.max(0, Math.floor(daysBetween(atISO, from) / 7));
}

/* ══════════════════════════════════════════════════════════════════════════
 * ONE WEEK
 * ═══════════════════════════════════════════════════════════════════════ */

const daysOfWeek = (ws: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(ws, i));

/** The context for the week beginning `weekStartISO`, as it stood at its start. */
export function contextForWeek(
  sub: DemandSubstrate,
  weekStartISO: string,
): WeekDemandContext {
  const days = daysOfWeek(weekStartISO);
  const hard = sub.sessions
    .filter((s) => days.includes(s.dateISO) && (s.isQuality || s.isLong))
    .map((s) => days.indexOf(s.dateISO))
    .sort((a, b) => a - b);
  const allWeekStarts = sub.weekObservations.map((w) => w.weekStartISO);

  return {
    weekStartISO,
    // An EMPTY array is a measured fact — an all-easy week — and the model
    // prices its stacking at 0. This loader always knows where the plan put
    // the hard days, so it is never null here, and that is worth stating: the
    // null branch exists for callers that do not hold the prescriptions.
    hardSessionDayOrdinals: hard,
    longestRunPrior30dMi: longestRunPrior30d(sub.runs, weekStartISO),
    acwr: acuteChronicAt(sub.runs, weekStartISO),
    lastRace: lastRaceAt(sub.racesRun, weekStartISO),
    weeksSinceLastCutback: weeksSinceCutbackAt(sub.cutbackWeekStarts, allWeekStarts, weekStartISO),
    // INJURY · read, never detected. Nothing in the canonical engine resolves
    // safety, and the owner scoped automatic injury intervention out of this
    // programme. The model treats injury as the one NON-required component and
    // excludes it from both sides of the ceiling comparison anyway, so a null
    // here narrows nothing — but it is named in `unknownComponents` and
    // travels out onto the decision record rather than passing silently.
    safety: null,
  };
}

/**
 * The four quantities of a PRESCRIBED week: what the plan is asking for.
 *
 * `qualityMinutes` is null when any session in the week carries a spec the
 * parser cannot price. That is a refusal and it propagates: the model reports
 * `intensity` unknown, `demandIndex` null, and the ceiling resolver refuses
 * rather than comparing a week priced without its quality against a ceiling
 * priced with it.
 */
export function prescribedWeekQuantities(
  sub: DemandSubstrate,
  weekStartISO: string,
): { weeklyMi: number | null; longRunMi: number | null; qualityMinutes: number | null; why: string } {
  const days = daysOfWeek(weekStartISO);
  const inWeek = sub.sessions.filter((s) => days.includes(s.dateISO));
  const q = qualityMinutesOfWeek(inWeek.map((s) => ({ dateISO: s.dateISO, spec: s.spec, isQuality: s.isQuality, isLong: s.isLong })));
  return {
    weeklyMi: inWeek.reduce((a, s) => a + (s.distanceMi ?? 0), 0),
    longRunMi: Math.max(0, ...inWeek.filter((s) => s.isLong).map((s) => s.distanceMi ?? 0), 0),
    qualityMinutes: q.minutes,
    why: q.why,
  };
}

/**
 * Did he ABSORB this week, as far as this loader can honestly say.
 *
 * Three states and the middle one is the point. `true` means the week was
 * fully readable, was actually run, was PRICEABLE, and was a NORMAL week the
 * plan did not author as a cutback, a race week, a taper or a recovery block.
 * Anything else is `null` — unknown — and unknown does not raise the ceiling.
 *
 * `false` is never returned, and that is deliberate rather than an oversight:
 * this loader has no evidence that would justify saying "he demonstrably did
 * NOT absorb this week". Returning false would be a judgement it cannot make,
 * and it would read identically to unknown at the model's only decision point
 * (`absorbed === true`), so the honest value is the one that says less.
 *
 * A week whose QUALITY cannot be priced is unknown here rather than passed
 * through carrying an unpriceable term. The alternative was considered and
 * rejected: such a week degrades the whole comparison to BASE_ONLY for every
 * other week AND is still skipped on BASE_ONLY, so it costs the basis without
 * buying any evidence. Excluding it is the restrictive direction and it is
 * named, which is the trade this file takes deliberately.
 */
export function absorbedVerdict(
  w: WeekObservation,
  qualityMinutes: number | null,
  qualityWhy: string,
): { absorbed: true | null; why: string } {
  const nonNormal = prescribedNonNormalWeek(w);
  if (nonNormal.nonNormal) {
    return { absorbed: null, why: `RULE 8 · not a normal week. ${nonNormal.detail}` };
  }
  if (!w.dataComplete || !w.completedMi.ok) {
    return { absorbed: null, why: 'the week could not be read in full, so nothing about it is demonstrated' };
  }
  if (w.completedMi.value <= 0) {
    return { absorbed: null, why: 'he ran nothing in this week, so it demonstrates no capacity' };
  }
  if (qualityMinutes === null) {
    return { absorbed: null, why: `the week's quality work could not be priced: ${qualityWhy}` };
  }
  return {
    absorbed: true,
    why:
      `${w.completedMi.value} readable miles and ${qualityMinutes} quality minutes in a normal `
      + 'week. NOTE: this loader reads "he ran a full readable normal week", which is weaker '
      + 'than "he absorbed it" — no injury or illness feed reaches this engine.',
  };
}

/**
 * Weeks he has already run, as the ceiling's evidence.
 *
 * Each carries the COMPLETED numbers, because a ceiling is about what he
 * carried and not about what he was asked to carry, and its own reconstructed
 * context so the comparison can run on FULL_CONTEXT where the window allows.
 */
export function demonstratedWeeksFrom(sub: DemandSubstrate): DemonstratedWeek[] {
  const out: DemonstratedWeek[] = [];
  for (const w of sub.weekObservations) {
    const days = daysOfWeek(w.weekStartISO);
    const runsInWeek = sub.runs.filter((r) => days.includes(r.dateISO));
    const longest = Math.max(0, ...runsInWeek.map((r) => r.distanceMi ?? 0), 0);

    // Quality minutes for a week he RAN: the authored work of the quality
    // sessions that have a matching activity. A prescribed session with no
    // activity was not run and contributes nothing, which is a measured zero.
    const ranQuality = sub.sessions.filter((s) =>
      days.includes(s.dateISO)
      && (s.isQuality || s.isLong)
      && runsInWeek.some((r) => r.dateISO === s.dateISO && r.distanceMi !== null));
    const q = qualityMinutesOfWeek(ranQuality.map((s) => ({ dateISO: s.dateISO, spec: s.spec, isQuality: s.isQuality, isLong: s.isLong })));
    const verdict = absorbedVerdict(w, q.minutes, q.why);

    out.push({
      weekStartISO: w.weekStartISO,
      // Only a week the verdict called ABSORBED is ever read by the model, and
      // reaching that branch has already proven all three of these are real.
      weeklyMi: w.completedMi.ok ? w.completedMi.value : 0,
      longRunMi: longest,
      qualityMinutes: q.minutes ?? 0,
      absorbed: verdict.absorbed,
      context: contextForWeek(sub, w.weekStartISO),
    });
  }
  return out;
}
