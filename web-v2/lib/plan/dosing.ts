/**
 * lib/plan/dosing.ts · Daniels' WEEKLY quality-dosing caps, as a DETECTOR.
 *
 * `Research/01-pace-zones-vdot.md` §"Dosing rules — Daniels' caps" states how
 * much of a week may be run at each quality pace, in two separate columns:
 *
 *   | Pace | Single-workout cap                       | Weekly cap       |
 *   | M    | The lesser of 18 mi or 20% of weekly mi  | n/a              |
 *   | T    | 10% of weekly mi (typically 4-6 mi at T) | 10% of weekly mi |
 *   | I    | 8% of weekly mi (max 10K cumulative)     | 8% of weekly mi  |
 *   | R    | 5% of weekly mi (max 8K cumulative)      | 5% of weekly mi  |
 *
 * ── What was already here, and what was actually missing ───────────────────
 *
 * The three percentages are NOT new to the engine. `AT_PACE_WEEKLY_SHARE_CAP`
 * in `lib/prescription/levers.ts` has held 10/8/5 since the progression engine
 * landed, bound by `PROGRESSION.threshold-volume-cap`,
 * `.interval-rep-window-and-cap` and `.repetition-volume-cap`.
 *
 * But that constant caps ONE SESSION — its own comment says so, and its
 * citations are `Research/04`'s per-workout field tables, where the number
 * describes the volume of that workout. Nothing anywhere summed a WEEK. A week
 * carrying a tempo and a cruise session, each legally at 10%, puts 20% of the
 * week at threshold and every existing check passes it. That is the gap
 * CLAUDE.md records, and `Research/01`'s separate "Weekly cap" column is the
 * doctrine it was missing.
 *
 * So this module reuses `AT_PACE_WEEKLY_SHARE_CAP` for the percentages rather
 * than declaring a second copy that can drift from the first, and adds the two
 * things the engine genuinely had no constant for: the MARATHON-PACE ceiling,
 * and the ABSOLUTE cumulative ceilings on I and R.
 *
 * ── 2026-08-18 · this module is now an ENFORCER, in both directions ────────
 *
 * It landed as a detector, on the reasoning that turning the caps on would
 * re-prescribe live plans and that was the owner's call to make. He made it:
 * "if my plan has a chance of breaking rules, then we need to insert something
 * into the code that would never allow that."
 *
 * So the file now reads the same doctrine two ways.
 *
 *   · BACKWARDS, for the gate — `weekDosingFindings` measures a week that
 *     already exists, and every finding carries `enforced`, which
 *     `validateComposedPlan` turns into a fatal violation.
 *   · FORWARDS, for the composer — `weeklyDoseBudgetMi` / `slotDoseBudgetMi`
 *     tell the generator how many at-pace miles it may spend before it authors
 *     anything, so a violating plan is never composed in the first place.
 *
 * The second half is the important one. A gate that rejects a plan the
 * composer still produces makes generation FAIL; it does not make it correct.
 * Both halves are in this file so the number the composer sizes to and the
 * number the gate checks are the same expression — the discipline `splitDay`
 * already gives this file for miles, applied to the caps themselves.
 *
 * ── The taper is reported and NOT enforced ─────────────────────────────────
 *
 * These caps are percentages OF WEEKLY MILEAGE, and a taper cuts weekly
 * mileage while deliberately holding intensity:
 * `Research/08-pacing-and-race-week.md` §9.1 — "The largest cut is to easy
 * mileage; intensity is preserved through the taper." A session that was legal
 * at 50 mi/wk is arithmetically illegal at 30 mi/wk though nothing about the
 * session changed, and doctrine intends that session to survive. §9.2 states
 * those sessions by name and dose, and they are outside the percentage by
 * construction — see `capEnforced`, which carries the arithmetic.
 *
 * Per CLAUDE.md §"Per-finding context filters", the filter is applied PER
 * FINDING rather than by suppressing whole weeks at the surface: every finding
 * carries its own `context`, the taper's percentage findings are still
 * REPORTED, and the absolute ceilings keep binding straight through the taper
 * so "intensity is preserved" can never become "intensity is unbounded". A
 * blanket "skip taper weeks" guard would hide a genuinely oversized taper
 * session, which is the failure mode that rule exists to stop.
 *
 * ── The one doctrine tension, resolved rather than picked ──────────────────
 *
 * `Research/01`'s T row reads "10% of weekly mi (typically 4-6 mi at T)", and
 * ten percent only reaches four miles at forty miles a week. Read as two
 * independent rules they contradict each other for every runner below that.
 *
 * They are not two rules. The parenthetical sits INSIDE the "Single-workout
 * cap" cell, qualifying the percentage it follows, and it says "typically" —
 * it describes what ten percent evaluates to for the runner the row has in
 * mind, not a floor the session must reach. The floor doctrine does state for
 * that session is in the next column of the same row, in TIME: "5-15 min reps;
 * 20-60 min cumulative", which §5.2 repeats as "20 min minimum for stimulus".
 *
 * Minutes are the runner-invariant unit, and at a 9:00 T pace twenty minutes is
 * 2.2 miles — inside ten percent of a 22 mi/wk week. So for almost every real
 * low-volume runner the cap and the stimulus floor agree, and the engine's own
 * hard-coded three-MILE tempo floor was the thing that did not fit either.
 * Where they genuinely collide — a fast runner on a very small week — the CAP
 * wins: it is the safety rule, under-stimulus is recoverable in a week, and
 * `Research/00b`'s whole recovery apparatus exists because the other error is
 * not. See `sizeTempoDay` in generate.ts, which now floors on the minutes.
 *
 * ── What counts toward a bucket ────────────────────────────────────────────
 *
 * The MILES come from `splitDay` in `./intensity-distribution` — the same
 * accounting the easy-share floor uses, so the two measurements can never
 * disagree about how much of a session was hard. This module only decides WHICH
 * pace those hard miles were run at. Warm-ups, cool-downs and the jog floats
 * between reps are Z1 and are already excluded there.
 */
import { AT_PACE_WEEKLY_SHARE_CAP } from '@/lib/prescription/levers';
import {
  splitDay,
  SPEC_PROBE_T_PACE_SEC,
  type IntensityDay,
  type IntensityWeek,
} from './intensity-distribution';
import { extractFinishSegment, extractLongSegments } from './spec-builder';
import { parseSegments, parseZones, primaryZone, segmentMi } from './prescription-parser';
import { ZONE_DOSE_PACE, tightestDosePace, type DosePace } from './zone-anchors';
import type { PaceZone } from '@/lib/workout-catalogue/types';

/** The four quality paces doctrine doses. E carries a share band, not a cap.
 *  Declared in `./zone-anchors` alongside the zone table it is derived from, so
 *  the buckets and the zones cannot drift; re-exported here unchanged because
 *  this module is where every consumer looks for it. */
export type { DosePace };

export const DOSE_PACES: readonly DosePace[] = ['M', 'T', 'I', 'R'] as const;

/** `DosePace` → the family name `AT_PACE_WEEKLY_SHARE_CAP` keys on. M is absent
 *  there: doctrine gives marathon pace no percentage-of-week share cap. */
const LEVER_FAMILY: Record<DosePace, keyof typeof AT_PACE_WEEKLY_SHARE_CAP | null> = {
  M: null,
  T: 'threshold',
  I: 'interval',
  R: 'repetition',
};

/**
 * The marathon-pace ceiling on ONE session: `Research/01` §"Dosing rules —
 * Daniels' caps", row M — "The lesser of 18 mi or 20% of weekly mi".
 *
 * New here because the progression engine never needed it: its levers only
 * drive threshold and interval sessions, so marathon-pace work — which the
 * engine authors as long-run finishes and taper MP blocks — had no cap of any
 * kind. Both halves bind, and the lesser wins: 20% of a 100 mi week is 20 mi,
 * which the 18 mi ceiling forbids.
 *
 * Doctrine writes "n/a" in the WEEKLY column for M, and that silence is
 * recorded rather than filled in — see `weeklyShareCap` below. Bound by
 * DOSING.marathon-pace-workout-ceiling.
 */
export const MARATHON_PACE_WORKOUT_CAP = { absMi: 18, pctOfWeekly: 0.20 } as const;

/**
 * Absolute cumulative ceilings on I and R, stated in the same cells as their
 * percentages: "8% of weekly mi (max 10K cumulative)" and "5% of weekly mi
 * (max 8K cumulative)".
 *
 * These bind INDEPENDENTLY of the percentage and matter at the top of the
 * volume range, where a share cap stops protecting anyone: 8% of a 100 mi week
 * is 8 miles of VO2 work, which this ceiling cuts to 6.2. Kilometres because
 * that is the unit doctrine states them in — converting in the constant would
 * put a rounding decision between the doc and the claim that reads it.
 *
 * Bound by DOSING.interval-repetition-cumulative-ceilings.
 */
export const CUMULATIVE_CEILING_KM: Partial<Record<DosePace, number>> = { I: 10, R: 8 };

const MI_PER_KM = 1 / 1.609344;

/** The share of weekly mileage this pace may occupy, or null where doctrine
 *  states none (M's weekly cell reads "n/a"). */
export function weeklyShareCap(pace: DosePace): number | null {
  const family = LEVER_FAMILY[pace];
  return family ? AT_PACE_WEEKLY_SHARE_CAP[family] : null;
}

/** The types whose prescription can declare a zone of its own. A long run's
 *  zone is its FINISH segment, which `extractFinishSegment` reads; an easy day
 *  has no zone to declare. */
const ZONED_TYPES = new Set(['threshold', 'tempo', 'intervals', 'vo2max', 'race_week_tuneup']);

/**
 * ZONE-R-1 (2026-08-19) · the bucket a prescription's own declared zone spends
 * against, or null when it declares none.
 *
 * This module used to carry two hand-written regexes for this — one for "@ MP",
 * one for "5K pace" — because those were the two places the label and the type
 * disagreed loudly enough to notice. They were right and they were not general:
 * a `threshold` row prescribing §5.4's sub-threshold intervals, an `intervals`
 * row prescribing §7.4's 200 m repeats and a `threshold` row prescribing
 * §14.2's 10K work all read as their type's default and were charged to the
 * wrong cap — the last two by nearly a factor of two.
 *
 * `parseZones` is the SAME reading `buildWorkoutSpec` paces the session off, so
 * a session cannot be run at one pace and charged to another.
 */
function declaredDosePace(subLabel: string | null | undefined): DosePace | null {
  const zones = parseZones(subLabel).filter((z): z is PaceZone => z in ZONE_DOSE_PACE);
  return zones.length ? tightestDosePace(zones) : null;
}

/** Which pace a day's hard miles are run at, or null when it doses nothing. */
export function dosePaceOf(day: IntensityDay): DosePace | null {
  if (ZONED_TYPES.has(day.type)) {
    const declared = declaredDosePace(day.subLabel);
    if (declared) return declared;
  }
  switch (day.type) {
    // Raced, not dosed. `validate.ts` draws the same line for the long-run cap
    // ("it is the race, not a training long run"); without it a marathon race
    // day would read as a 26.2 mi marathon-pace workout.
    case 'race':
      return null;

    case 'long': {
      // Research/01 §"Pace conversion from a race time": T is "~half-marathon
      // pace to 15K pace", so an @HM finish doses T and an @MP finish doses M.
      const finish = extractFinishSegment(day.subLabel ?? null);
      if (!finish) return null;
      return finish.tag === 'M' ? 'M' : 'T';
    }

    // A continuous block the prescription declares "@ MP" is marathon pace, not
    // threshold — the same distinction spec-builder draws (DOCTRINE-TAPERMP-1),
    // and deliberately the same regex, because label/spec drift has been paid
    // for twice in this codebase.
    case 'tempo':
      return /@\s*MP\b/i.test(String(day.subLabel ?? '')) ? 'M' : 'T';

    case 'threshold':
      return 'T';

    case 'intervals':
    case 'vo2max':
      return 'I';

    // The tune-up emits a `threshold` SPEC whatever its rep pace, so the spec
    // kind cannot classify it. spec-builder picks that pace off the
    // prescription; this reads the same prescription rather than re-deriving it
    // from a pace number that depends on which VDOT was threaded.
    case 'race_week_tuneup':
      return /5\s*k\s*pace|@\s*I\b/i.test(String(day.subLabel ?? '')) ? 'I' : 'T';

    // Only ever a STANDALONE strides session. Strides appended to an easy run
    // are "Not a workout" (Research/04 §7.2) and `splitDay` already returns zero
    // hard miles for them, so they cannot reach this bucket by that route.
    case 'strides':
      return 'R';

    default:
      return null;
  }
}

/**
 * The pace a quality SLOT will dose, from its type alone.
 *
 * `dosePaceOf` above answers the same question for a day that already has a
 * prescription; this answers it for a slot the composer has only chosen the
 * TYPE of, before there is a sub_label to read. The two must agree on the types
 * they share, which `_dosing_doctrine.test.ts` asserts directly.
 *
 * A `tempo` slot the composer is about to fill with a marathon-pace block is
 * the one case the type cannot settle — DOCTRINE-TAPERMP-1 authors it — so the
 * caller passes `atMarathonPace` when it knows.
 */
export function slotDosePace(type: string, atMarathonPace = false): DosePace | null {
  switch (type) {
    case 'tempo':      return atMarathonPace ? 'M' : 'T';
    case 'threshold':  return 'T';
    case 'intervals':
    case 'vo2max':     return 'I';
    case 'strides':    return 'R';
    // VARIETY-R3-1 (2026-08-28) · the composer-internal `speed` pseudo-type —
    // the 5K/10K third quality day. It is §7 repetition work and spends
    // Daniels' R budget (`Research/01` §"Dosing rules": "R | 5% of weekly mi
    // (max 8K cumulative)"), which is also what keeps `duplicatePaceFamily`
    // honest: a week may run I + T + R because they are three different
    // budgets, never two sessions of any one of them.
    case 'speed':      return 'R';
    // The tune-up's pace depends on its prescription (5K-pace vs race-pace
    // reps), which the slot does not have yet. Doctrine states its dose by name
    // in Research/08 §9.2 and it only ever lands in a taper or race week, where
    // the percentage caps do not govern — see `capEnforced`.
    case 'race_week_tuneup': return null;
    default:           return null;
  }
}

/**
 * DOCTRINE-DOSING-2 · a week may not run two sessions of the same pace family.
 *
 * `Research/04-workout-vocabulary.md` §5.2 Frequency ("1×/week or alternating
 * with cruise intervals"), §6.2 Frequency ("Every 7-10 days"), §6.3 ("Weekly
 * during VO2max block") and §16 ("Two threshold sessions back-to-back") all say
 * the same thing from different directions, and `Research/01`'s weekly cap
 * column is what makes it arithmetic: one full-dose session already spends the
 * family's whole weekly allowance.
 *
 * Returns the offending pace, or null when the slot list is legal. Exported so
 * the composer's own invariant test can assert it over every archetype rather
 * than trusting the table by eye.
 */
export function duplicatePaceFamily(types: readonly string[]): DosePace | null {
  const seen = new Set<DosePace>();
  for (const t of types) {
    const p = slotDosePace(t);
    if (!p) continue;
    if (seen.has(p)) return p;
    seen.add(p);
  }
  return null;
}

/** One session's hard miles, attributed to a pace. */
export interface DayDose {
  pace: DosePace;
  mi: number;
  subLabel: string | null;
}

/** Every dosed session in a week, plus the week's own running mileage. */
export interface WeekDose {
  /** Sum of every running day's distance, EXCLUDING a race day. */
  weeklyMi: number;
  sessions: DayDose[];
  /** Total dosed miles per pace. */
  byPace: Record<DosePace, number>;
}

/**
 * GRAMMAR-SEQ-1 (2026-08-19) · one day's doses, which for most days is one.
 *
 * An unequal-step session runs several zones in one workout — §10.2's combo is
 * "4 mi T + 6×400 R", §13.2's ladder walks mile pace to HM pace — and charging
 * the whole thing to one bucket is wrong in both directions. Charged to the
 * LOOSEST it under-reports the R content; charged to the TIGHTEST it reports
 * six four-hundreds as four and a half miles of R work, which would ban the
 * session on any week under ninety miles.
 *
 * `Research/01`'s caps are per PACE — "5% of weekly mi" at R, "8%" at I — so
 * the honest reading is per segment, and that is what this does: each step's
 * mileage goes to its own zone's bucket, scaled so the buckets still sum to the
 * hard miles `splitDay` measured. The two accountings therefore cannot disagree
 * about how much of the day was hard; they only disagree about how to label it.
 *
 * The SELECTOR stays conservative on purpose. `sessionAllowanceMi` prices the
 * whole sequence against its tightest zone's cap before the session is ever
 * offered, so what a plan is charged here can never exceed what it was allowed
 * there — the two are not in tension, they are a bound and a measurement.
 */
export function dayDoses(day: IntensityDay): DayDose[] {
  const qualityMi = splitDay(day).qualityMi;
  if (qualityMi <= 0) return [];
  const subLabel = day.subLabel ?? null;

  if (ZONED_TYPES.has(day.type)) {
    const segs = parseSegments(subLabel);
    if (segs) {
      // The probe pace only converts time-stated steps into a SHARE of the
      // session; the shares are rescaled to `qualityMi` below, so its value
      // cannot move the total. It is the same probe `splitDay` reads the spec
      // with, so a time-stated step is weighed the same way on both sides.
      const byPace = new Map<DosePace, number>();
      let sum = 0;
      for (const seg of segs) {
        const mi = segmentMi(seg, SPEC_PROBE_T_PACE_SEC) ?? 0;
        if (!(mi > 0)) continue;
        sum += mi;
        // A step that declares no zone inherits the session's own — §9.2's 30 s
        // Mona reps carry no zone because the doc names only the ends of the
        // ramp, and they are still part of that session's dose.
        const zone = (seg.zone ?? primaryZone(subLabel)) as PaceZone | null;
        const p = zone ? ZONE_DOSE_PACE[zone] : null;
        if (!p) continue;
        byPace.set(p, (byPace.get(p) ?? 0) + mi);
      }
      if (sum > 0 && byPace.size > 0) {
        const k = qualityMi / sum;
        return [...byPace.entries()]
          .map(([pace, mi]) => ({ pace, mi: Number((mi * k).toFixed(2)), subLabel }))
          .filter((d) => d.mi > 0);
      }
    }
  }

  // VARIETY-LONG-1 (2026-08-28) · a progression long doses TWO buckets. Its
  // sub_label carries the segments — "LONG · 3mi @ M + 2mi @ T" — and charging
  // the whole day to `dosePaceOf`'s single headline (the first segment's M)
  // would leave the T tail uncounted against Daniels' 10%, which is the same
  // one-bucket collapse GRAMMAR-SEQ-1 fixed for the ladders. Each segment goes
  // to its own bucket ('M'/'HM'/'T' → M/T per Research/01's T band), scaled to
  // the same `qualityMi` `splitDay` measured so the two accountings agree.
  // Single-segment longs take the fallback below, exactly as before.
  if (day.type === 'long') {
    const segs = extractLongSegments(subLabel);
    if (segs.length >= 2) {
      const byPace = new Map<DosePace, number>();
      let sum = 0;
      for (const seg of segs) {
        sum += seg.mi;
        const p: DosePace = seg.tag === 'M' ? 'M' : 'T';
        byPace.set(p, (byPace.get(p) ?? 0) + seg.mi);
      }
      if (sum > 0 && byPace.size > 0) {
        const k = qualityMi / sum;
        return [...byPace.entries()]
          .map(([pace, mi]) => ({ pace, mi: Number((mi * k).toFixed(2)), subLabel }))
          .filter((d) => d.mi > 0);
      }
    }
  }

  const pace = dosePaceOf(day);
  return pace ? [{ pace, mi: qualityMi, subLabel }] : [];
}

export function weekDose(week: IntensityWeek): WeekDose {
  const sessions: DayDose[] = [];
  const byPace: Record<DosePace, number> = { M: 0, T: 0, I: 0, R: 0 };
  let weeklyMi = 0;

  for (const day of week.days) {
    // A race is not training volume, so it is neither a dose nor part of the
    // denominator the doses are measured against.
    if (day.type === 'race') continue;
    weeklyMi += Math.max(0, day.distanceMi ?? 0);

    for (const d of dayDoses(day)) {
      byPace[d.pace] = Number((byPace[d.pace] + d.mi).toFixed(2));
      sessions.push(d);
    }
  }

  return { weeklyMi: Number(weeklyMi.toFixed(2)), sessions, byPace };
}

/** Which doctrine rule a finding breached. */
export type DosingScope = 'weekly' | 'single-workout' | 'cumulative';

/**
 * Is this cap a PERCENTAGE of the week's mileage, or an ABSOLUTE ceiling?
 *
 * The distinction decides which weeks a cap governs, so it is carried on the
 * finding rather than re-derived by every caller. See `capEnforced` below.
 */
export type DosingBasis = 'percentage' | 'absolute';

/**
 * The context that decides what a finding MEANS. Applied per finding, never as
 * a whole-week suppression — see the module header.
 */
export type DosingContext = 'training' | 'taper' | 'race-week';

export interface DosingFinding {
  weekStartISO: string | null;
  phase: string | null;
  context: DosingContext;
  pace: DosePace;
  scope: DosingScope;
  /** Miles prescribed at this pace — one session, or the week's total. */
  doseMi: number;
  /** The week's running mileage the cap is a percentage of. */
  weeklyMi: number;
  /** The cap in miles, after resolving percentage and absolute ceilings. */
  capMi: number;
  overByMi: number;
  /** The dose as a share of weekly mileage, in percent. */
  sharePct: number;
  /** Whether the breached cap is a share of weekly mileage or an absolute
   *  ceiling. Decides enforceability — see `capEnforced`. */
  basis: DosingBasis;
  /** True when the engine may never author this. See `capEnforced`. */
  enforced: boolean;
  message: string;
}

/**
 * DOSING-GATE-1 (2026-08-18) · WHICH breaches the engine may never author.
 *
 * The dosing caps come in two kinds and they do not govern the same weeks.
 *
 * ── Absolute ceilings bind everywhere ──────────────────────────────────────
 *
 * "max 10K cumulative" (I) and "max 8K cumulative" (R) are stated in
 * kilometres, not in percent, so nothing about a week's size changes what they
 * allow. `MARATHON_PACE_WORKOUT_CAP.absMi` is the same: doctrine's "the lesser
 * of 18 mi or 20% of weekly mi" is TWO caps sharing a cell, and only the second
 * half is a percentage. These are enforced in every week, whatever its phase.
 *
 * ── Percentage caps bind on TRAINING weeks ─────────────────────────────────
 *
 * A taper is defined as a volume cut with intensity HELD:
 * `Research/08-pacing-and-race-week.md` §9.1 — "The largest cut is to easy
 * mileage; intensity is preserved through the taper." A cap expressed as a
 * share of weekly mileage therefore tightens every week of the taper precisely
 * BECAUSE the taper is working, on a session doctrine intends to survive
 * unchanged.
 *
 * That is not an inference from the rule. It is what §9.2 prescribes by name:
 * the marathon taper's -3 week is "80-90% peak" volume carrying "14-16 mi w/
 * 10-12 mi at MP", and its -2 week is "60-70% peak" carrying "6-8 mi at MP".
 * Eight marathon-pace miles on a week at 60% of a 55-mile peak is 24% of that
 * week — outside `Research/01`'s 20% by construction, in a session §9.2 states
 * in the imperative. Enforcing the percentage there would make the engine
 * unable to author the taper doctrine tells it to author.
 *
 * A race week is the same argument twice over: its largest number is the race,
 * which `weekDose` already excludes from both sides of the ratio, so what is
 * left is a shakeout-sized denominator against a tune-up whose dose §9.2 also
 * states by name ("3-4 mi w/ 4-6 x 1 min at 5K pace").
 *
 * So percentage caps are ENFORCED on training weeks and REPORTED on taper and
 * race weeks. Reported, not dropped: a genuinely oversized taper session is
 * still a finding a human should see, and suppressing the measurement is the
 * failure mode CLAUDE.md §"Per-finding context filters" exists to stop. The
 * absolute ceilings keep binding through the taper, so "intensity is
 * preserved" can never become "intensity is unbounded".
 */
export function capEnforced(context: DosingContext, basis: DosingBasis): boolean {
  return basis === 'absolute' || context === 'training';
}

/** A week as this module needs it. Structural, so every composer fits. */
export interface DosingWeek extends IntensityWeek {
  startISO?: string;
}

function contextOf(week: DosingWeek): DosingContext {
  if (week.isRaceWeek) return 'race-week';
  if (String(week.phase ?? '').toUpperCase() === 'TAPER') return 'taper';
  return 'training';
}

const round = (n: number) => Number(n.toFixed(2));

/**
 * Every dosing-cap breach in one week.
 *
 * A week with no running mileage yields nothing: a percentage of zero is zero,
 * and "0 mi at T exceeds a 0 mi cap" is noise, not a finding.
 */
export function weekDosingFindings(week: DosingWeek): DosingFinding[] {
  const dose = weekDose(week);
  if (dose.weeklyMi <= 0) return [];

  const out: DosingFinding[] = [];
  const context = contextOf(week);
  const weekStartISO = week.startISO ?? null;
  const phase = week.phase ?? null;

  const push = (
    pace: DosePace,
    scope: DosingScope,
    basis: DosingBasis,
    doseMi: number,
    capMi: number,
    why: string,
  ) => {
    // A tenth of a mile of slack: the composers round day distances to one
    // decimal, so an exact-cap session can land a hundredth over. That is
    // rounding, not a dosing decision.
    if (doseMi <= capMi + 0.05) return;
    const sharePct = round((doseMi / dose.weeklyMi) * 100);
    out.push({
      weekStartISO,
      phase,
      context,
      pace,
      scope,
      doseMi: round(doseMi),
      weeklyMi: dose.weeklyMi,
      capMi: round(capMi),
      overByMi: round(doseMi - capMi),
      sharePct,
      basis,
      enforced: capEnforced(context, basis),
      message:
        `${scope === 'weekly' ? 'Week' : 'Session'} doses ${round(doseMi)} mi at ${pace} ` +
        `on ${dose.weeklyMi} mi/wk (${sharePct}%) · doctrine caps it at ${round(capMi)} mi (${why})`,
    });
  };

  for (const pace of DOSE_PACES) {
    const sharePct = weeklyShareCap(pace);

    // ── weekly total ─────────────────────────────────────────────────────────
    // THE GAP THIS MODULE EXISTS FOR. Research/01's "Weekly cap" column, summed
    // across every session in the week — the check no existing gate performs.
    if (sharePct != null) {
      push(pace, 'weekly', 'percentage', dose.byPace[pace], dose.weeklyMi * sharePct,
        `${sharePct * 100}% of weekly mi`);
    }

    // ── single workout ───────────────────────────────────────────────────────
    // Resolved per session: a week can clear the weekly total and still hold
    // one oversized session. For T/I/R this restates what `atPaceSessionCapMi`
    // already caps at authoring time, so it should be quiet — a finding here
    // means a session escaped the lever ladder (a doctrine-vocabulary session,
    // an adapt path, or a long-run finish). For M it is the only cap there is.
    for (const s of dose.sessions) {
      if (s.pace !== pace) continue;
      if (pace === 'M') {
        // Doctrine's M cell is TWO caps sharing one sentence — "the lesser of
        // 18 mi or 20% of weekly mi" — and only the second is a percentage.
        // They are reported separately so the taper, where the percentage does
        // not govern (see `capEnforced`), still cannot exceed eighteen miles.
        push(pace, 'single-workout', 'absolute', s.mi, MARATHON_PACE_WORKOUT_CAP.absMi,
          `${MARATHON_PACE_WORKOUT_CAP.absMi} mi absolute`);
        push(pace, 'single-workout', 'percentage', s.mi,
          dose.weeklyMi * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly,
          `${MARATHON_PACE_WORKOUT_CAP.pctOfWeekly * 100}% of weekly mi`);
      } else if (sharePct != null) {
        push(pace, 'single-workout', 'percentage', s.mi, dose.weeklyMi * sharePct,
          `${sharePct * 100}% of weekly mi`);
      }
    }

    // ── absolute cumulative ceiling ──────────────────────────────────────────
    // Stated in the same cell as the single-workout percentage ("max 10K
    // cumulative") and binds regardless of week size: 8% of a 100 mi week would
    // allow 8 mi of I, which this forbids.
    const ceilKm = CUMULATIVE_CEILING_KM[pace];
    if (ceilKm != null) {
      push(pace, 'cumulative', 'absolute', dose.byPace[pace], ceilKm * MI_PER_KM,
        `max ${ceilKm}K cumulative`);
    }
  }

  return out;
}

/* ─────────────────────────── the authoring budget ──────────────────────────
 *
 * Everything above MEASURES a week that already exists. What follows is the
 * same doctrine read forwards, for the composer: how many at-pace miles a week
 * may SPEND at each pace, and how that divides across the sessions that want
 * it.
 *
 * One module, both directions, deliberately. The number the composer sizes to
 * and the number the gate checks are then the same expression rather than two
 * expressions that agree today — the discipline `splitDay` already gives this
 * file for miles, applied to the caps themselves.
 */

/**
 * The at-pace miles a WEEK may spend at `pace`, all doctrine bounds resolved.
 *
 * `Infinity` where doctrine states no cap (M's weekly cell reads "n/a" and it
 * carries no cumulative ceiling): the engine records the silence rather than
 * inventing a number, and callers `Math.min` against their own bounds.
 */
export function weeklyDoseBudgetMi(
  weeklyMi: number,
  pace: DosePace,
  context: DosingContext = 'training',
): number {
  const share = weeklyShareCap(pace);
  const ceilKm = CUMULATIVE_CEILING_KM[pace];
  const absolute = ceilKm != null ? ceilKm * MI_PER_KM : Infinity;
  // The percentage half only governs training weeks — see `capEnforced` for
  // why, and for the doctrine that says so in the imperative.
  const pct = share != null && capEnforced(context, 'percentage')
    ? Math.max(0, weeklyMi) * share
    : Infinity;
  return Math.min(pct, absolute);
}

/** The at-pace miles ONE session may spend at `pace`, absolute halves only —
 *  M's 18 mi, and the I/R cumulative ceilings, which a single session also
 *  cannot exceed. Percentage halves are the caller's, via the budget above. */
export function sessionDoseCeilingMi(pace: DosePace): number {
  if (pace === 'M') return MARATHON_PACE_WORKOUT_CAP.absMi;
  const ceilKm = CUMULATIVE_CEILING_KM[pace];
  return ceilKm != null ? ceilKm * MI_PER_KM : Infinity;
}

/**
 * DOSING-BUDGET-1 (2026-08-18) · divide a week's at-pace budget among the
 * sessions that want it.
 *
 * `reservedMi` is what the week has already committed at this pace before the
 * structured sessions are sized — in practice the long run's marathon-pace or
 * half-marathon-pace finish, which is authored before the quality slots and is
 * every bit as much a dose of T or M as a tempo is. Charging it to the budget
 * is the whole reason a week can be planned rather than merely checked.
 *
 * `slots` is how many sessions will share what is left. It is normally ONE:
 * `Research/04-workout-vocabulary.md` §5.2 gives a continuous tempo "Frequency
 * | 1×/week or alternating with cruise intervals" and §6.2 gives mile repeats
 * "Frequency | Every 7-10 days", so doctrine does not put two sessions of the
 * same family in one week at all. Where a composer still does, the budget
 * divides rather than being spent twice — which is exactly the failure this
 * whole workstream exists to close.
 */
export function slotDoseBudgetMi(args: {
  weeklyMi: number;
  pace: DosePace;
  context?: DosingContext;
  reservedMi?: number;
  slots?: number;
}): number {
  const { weeklyMi, pace, context = 'training', reservedMi = 0, slots = 1 } = args;
  const week = weeklyDoseBudgetMi(weeklyMi, pace, context);
  const left = Math.max(0, week - Math.max(0, reservedMi));
  const n = Math.max(1, Math.floor(slots));
  return Math.min(left / n, sessionDoseCeilingMi(pace));
}

/** Every dosing-cap breach across a composed plan, week by week. */
export function planDosingFindings(weeks: DosingWeek[]): DosingFinding[] {
  return weeks.flatMap((w) => weekDosingFindings(w));
}

/** Findings counted by the context that decides what they mean. */
export function summarizeDosing(findings: DosingFinding[]): Record<DosingContext, number> {
  const out: Record<DosingContext, number> = { training: 0, taper: 0, 'race-week': 0 };
  for (const f of findings) out[f.context] += 1;
  return out;
}
