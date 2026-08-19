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
 * ── Why this is a detector and not an enforcer ──────────────────────────────
 *
 * Turning these caps on would re-prescribe every plan in the database,
 * including the owner's live marathon build. That is his decision, not a
 * decision for the code that discovers the gap. So this module MEASURES and
 * REPORTS, and `validateComposedPlan` treats what it returns as advisory: no
 * finding here can block a write. Enforcement is a deliberate change at that
 * caller, not a flag flipped in this file.
 *
 * ── Why the taper is reported, not exempted ────────────────────────────────
 *
 * These caps are percentages OF WEEKLY MILEAGE, and a taper cuts weekly
 * mileage while deliberately holding intensity:
 * `Research/08-pacing-and-race-week.md` §9.1 — "The largest cut is to easy
 * mileage; intensity is preserved through the taper." A session that was legal
 * at 50 mi/wk is arithmetically illegal at 30 mi/wk though nothing about the
 * session changed, and doctrine intends that session to survive.
 *
 * Per CLAUDE.md §"Per-finding context filters", the filter is applied PER
 * FINDING rather than by suppressing whole weeks at the surface: every finding
 * carries its own `context` and callers decide what each context means. A
 * blanket "skip taper weeks" guard would also hide a genuinely oversized taper
 * session, which is the failure mode that rule exists to stop.
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
import { splitDay, type IntensityDay, type IntensityWeek } from './intensity-distribution';
import { extractFinishSegment } from './spec-builder';

/** The four quality paces doctrine doses. E carries a share band, not a cap. */
export type DosePace = 'M' | 'T' | 'I' | 'R';

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

/** Which pace a day's hard miles are run at, or null when it doses nothing. */
export function dosePaceOf(day: IntensityDay): DosePace | null {
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

export function weekDose(week: IntensityWeek): WeekDose {
  const sessions: DayDose[] = [];
  const byPace: Record<DosePace, number> = { M: 0, T: 0, I: 0, R: 0 };
  let weeklyMi = 0;

  for (const day of week.days) {
    // A race is not training volume, so it is neither a dose nor part of the
    // denominator the doses are measured against.
    if (day.type === 'race') continue;
    weeklyMi += Math.max(0, day.distanceMi ?? 0);

    const pace = dosePaceOf(day);
    if (!pace) continue;
    const mi = splitDay(day).qualityMi;
    if (mi <= 0) continue;
    byPace[pace] = Number((byPace[pace] + mi).toFixed(2));
    sessions.push({ pace, mi, subLabel: day.subLabel ?? null });
  }

  return { weeklyMi: Number(weeklyMi.toFixed(2)), sessions, byPace };
}

/** Which doctrine rule a finding breached. */
export type DosingScope = 'weekly' | 'single-workout' | 'cumulative';

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
  message: string;
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

  const push = (pace: DosePace, scope: DosingScope, doseMi: number, capMi: number, why: string) => {
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
      push(pace, 'weekly', dose.byPace[pace], dose.weeklyMi * sharePct, `${sharePct * 100}% of weekly mi`);
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
        const pctCap = dose.weeklyMi * MARATHON_PACE_WORKOUT_CAP.pctOfWeekly;
        push(
          pace,
          'single-workout',
          s.mi,
          Math.min(MARATHON_PACE_WORKOUT_CAP.absMi, pctCap),
          `the lesser of ${MARATHON_PACE_WORKOUT_CAP.absMi} mi and ` +
            `${MARATHON_PACE_WORKOUT_CAP.pctOfWeekly * 100}% of weekly mi`,
        );
      } else if (sharePct != null) {
        push(pace, 'single-workout', s.mi, dose.weeklyMi * sharePct, `${sharePct * 100}% of weekly mi`);
      }
    }

    // ── absolute cumulative ceiling ──────────────────────────────────────────
    // Stated in the same cell as the single-workout percentage ("max 10K
    // cumulative") and binds regardless of week size: 8% of a 100 mi week would
    // allow 8 mi of I, which this forbids.
    const ceilKm = CUMULATIVE_CEILING_KM[pace];
    if (ceilKm != null) {
      push(pace, 'cumulative', dose.byPace[pace], ceilKm * MI_PER_KM, `max ${ceilKm}K cumulative`);
    }
  }

  return out;
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
