/**
 * lib/coach/easy-discipline.ts · is the runner running his easy days too hard?
 *
 * The highest-value observation the app had never made. The owner has run this
 * year at 67% easy, and his easy days average 81% of max HR against Daniels'
 * 65-78 ceiling. Every ingredient was already here — HR on the run rows, HRmax
 * from `loadEffectiveMaxHr`, the pace band on `workout_spec`, the doctrine in
 * `Research/01` and `Research/03` — and nothing ever put them together. Easy
 * days are supposed to SHED fatigue; easy days run at threshold-adjacent
 * effort accumulate it, which is the likeliest mechanism behind threshold work
 * stalling across a block.
 *
 * ── Three rules this module is built around ───────────────────────────────
 *
 * 1 · PATTERN, NEVER A SCOLD. The owner deliberately gutted the reactive coach
 *     layer (`feedback_no_reactive_coach`: the plan stands, the score informs)
 *     and will not accept a system that grades every run. So this fires only
 *     on a SUSTAINED pattern — a clear majority of qualifying easy days, spread
 *     across at least three distinct weeks, with the most recent one recent
 *     enough to still be a habit rather than history. It goes quiet again the
 *     moment the pattern breaks, and it says so once when it does. Closing the
 *     loop matters more than opening it.
 *
 * 2 · HR FIRST, PACE SECOND — AND THE FILTERS KNOW THE DIFFERENCE. `Research/01`
 *     defines easy by %HRmax and by pace band. HR is the honest governor, so
 *     the HR basis is tried first. But the per-run context filters are
 *     BASIS-AWARE, which is the part that makes this trustworthy: heat raises
 *     HR at a fixed effort (`Research/03` confounders, +5-20 bpm at ≥25 °C) and
 *     therefore invalidates an HR reading — but heat does not make a runner go
 *     FASTER, so a hot day that was also run faster than the band is a stronger
 *     pace signal, not a weaker one. Terrain, race-recency, illness and a
 *     layoff return distort both. See FILTER_INVALIDATES below; the table IS
 *     the argument.
 *
 * 3 · PER-FINDING CONTEXT FILTERS (CLAUDE.md, locked 2026-05-19 round 4). Each
 *     contributing run gets its own filter pass. A window-level guard is not
 *     enough and the locked rule was written about almost exactly this finding:
 *     the V5 Z2 sub-finding picked up a taper workout 3 days pre-Big Sur —
 *     T-band pace, sub-Z4 HR — that looked precisely like "easy days too hard"
 *     and was actually intentional taper conservation. A run that fails a
 *     filter is EXCLUDED from the pattern, never counted against him.
 *
 * ── What the evidence supports, and what it does not ──────────────────────
 *
 * A high easy HR is not automatically a fault, and this module refuses to
 * pretend otherwise. Three different worlds produce the same number:
 *
 *   · the runner is choosing to run easy days hard          → discipline
 *   · the prescribed pace band is too fast for him          → the band is wrong
 *   · fatigue, heat or illness is inflating HR at true easy → context
 *
 * They are separated by asking what the PACE was doing at the same time.
 * Faster than the band AND over the HR ceiling is a discipline finding. Inside
 * the band but over the ceiling is NOT — that is evidence the band or the
 * runner's fitness anchor needs re-examining, and the copy says so instead of
 * blaming him. `EasyDisciplineFinding.caveats` carries the honest limits of
 * whichever read fired.
 *
 * ── Coherence with the app's own prescription ─────────────────────────────
 *
 * `hrCapEasy` (lib/plan/spec-builder.ts) prescribes MAX(0.89·LTHR, 0.78·HRmax).
 * For the owner that is max(144, 140) = 144 bpm = 80.4 %HRmax, i.e. the app's
 * own cap PERMITS more than Daniels' 78% ceiling allows. A detector that flags
 * 81% while the app tells him 80% is fine would be incoherent, and the runner
 * would be right to ignore it. So the ceiling used here is
 *
 *     ceilingBpm = max(doctrine 78% of HRmax, the cap the app actually gave him)
 *
 * which makes it structurally impossible for this module to accuse him of
 * doing what the app told him to do. The divergence itself is recorded as a
 * doctrine-registry violation (`HR.easy-cap-not-above-daniels`) rather than
 * fixed here — see that claim's `exempt` entry for the blast radius.
 *
 * Pure functions only below the DB shell at the bottom; the composers are what
 * the tests lock.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadEffectiveMaxHr } from '@/lib/training/max-hr';
import { weatherContext } from '@/lib/weather/heat-adjustment';
import { distanceMiFromLabel } from '@/lib/race/distance';

/* ═══════════════════════ Doctrine-bound constants ═══════════════════════ */

/**
 * Daniels' easy ceiling as a fraction of HRmax.
 * `Research/01` §"Daniels training paces (E, M, T, I, R)" · row E, col %HRmax
 * → 65-78. Corroborated by `Research/03` §8 row "E (Easy)" → 65-78%.
 *
 * NOTE a doctrine self-contradiction, deliberately resolved toward leniency:
 * `Research/00b` §"Recovery Run vs. Easy Run" gives easy as 60-70 %HRmax and
 * recovery as ≤60%, which is far STRICTER. Where two passages disagree about
 * how hard it is fair to accuse a runner of running, this module takes the
 * more permissive one. An accusation should clear the highest bar doctrine
 * offers, not the lowest.
 * Watched by `PACE.easy-hr-ceiling-observational`.
 */
export const EASY_HRMAX_CEILING_PCT = 0.78;

/** The floor of the same band · used only to describe it in the copy. */
export const EASY_HRMAX_FLOOR_PCT = 0.65;

/**
 * Heat confound threshold, absolute. `Research/03` §"Limitations and
 * Confounders" · row "Heat (≥25°C)" → HR rises +5-20 bpm at fixed effort.
 * 25 °C = 77 °F. Watched by `HR.heat-confounds-easy-read`.
 */
export const HEAT_CONFOUND_TEMP_C = 25;
export const HEAT_CONFOUND_TEMP_F = HEAT_CONFOUND_TEMP_C * 1.8 + 32;

/**
 * Terrain confound threshold, in net climb per mile.
 *
 * `Research/01` §"Hills (Grade-Adjusted Pace)" · the +2% row of the multiplier
 * table is the first grade whose pace cost reaches 10% (multiplier 1.10, +48
 * s/mi at an 8:00 base). On rolling terrain that returns to its start, climb
 * and descent are roughly equal, so an average uphill grade of g implies net
 * gain per mile of about (g/2) × 5280 ft. At g = 2% that is 52.8 ft/mi, which
 * this rounds to 50.
 *
 * TODO(elevation-agent) · this is a PROXY. A grade-adjusted pace is landing in
 * `lib/training/vdot-inputs.ts` / `lib/runs/` this session; when
 * `EasyRunObservation.gapSPerMi` is populated the proxy is skipped entirely and
 * the real GAP-vs-raw delta is used (see `TERRAIN_CONFOUND_GAP_PCT`). Until
 * then net climb is the only terrain signal on the run rows, and it undercounts
 * a genuinely hilly out-and-back whose net gain is near zero.
 * Watched by `TERRAIN.hill-confounds-easy-read`.
 */
export const TERRAIN_CONFOUND_FT_PER_MI = 50;

/**
 * When a real grade-adjusted pace IS available, terrain counts as a confound
 * once GAP and raw pace diverge by this fraction — the same 10% cost the +2%
 * row of the doctrine table describes, expressed as a ratio instead of ft/mi.
 */
export const TERRAIN_CONFOUND_GAP_PCT = 0.1;

/**
 * A run shorter than this is a shakeout, a warm-up or a mis-synced fragment,
 * not an easy day. `Research/00b` §"Recovery Run vs. Easy Run" puts an easy run
 * at 45-90 min; 2 miles is well under any reading of that and keeps 1.3-mile
 * "Cruise Miles" rows out of the pattern. Engineering floor, not physiology —
 * no registry claim.
 */
export const MIN_EASY_RUN_MI = 2;

/**
 * Cardiac drift. `Research/03` §"Limitations and Confounders" · row "Cardiac
 * drift (>30 min steady)" → HR rises +5-15% over 60 min at fixed effort. A long
 * easy run therefore legitimately averages a higher HR than a short one, so
 * past this duration the HR reading is not comparable and the run contributes
 * to the pace basis only. Watched by `HR.drift-confounds-easy-read`.
 */
export const DRIFT_CONFOUND_MINUTES = 60;

/* ═══════════════════════ Policy constants (not doctrine) ════════════════ */
/* These decide how much evidence is enough before speaking. They are
 * statistical-confidence choices, not claims about physiology, so they carry
 * no registry entry — inventing a citation for them would be exactly the
 * citation rot the doctrine gate exists to catch. Each names its trade-off. */

/** How far back to look. Long, because a runner with one or two easy days a
 *  week needs months to produce a readable sample after filtering. */
export const WINDOW_DAYS = 90;

/** Below this many qualifying runs there is no pattern, only anecdotes.
 *  Raising it makes the module quieter and slower; lowering it risks calling
 *  three bad days a habit. */
export const MIN_QUALIFYING_RUNS = 5;

/** Qualifying runs must span at least this many distinct calendar weeks. This
 *  is what makes it a PATTERN rather than one rough training block, and it is
 *  the guard that a raw run count cannot provide. */
export const MIN_DISTINCT_WEEKS = 3;

/** A clear majority · two thirds. A bare 51% is noise at these sample sizes. */
export const OVER_CEILING_MAJORITY = 2 / 3;

/**
 * The most recent qualifying run must be no older than this or the pattern is
 * history, not a habit. 28 days is one full load-plus-cutback cycle
 * (`Research/00b` §"Frequency" · "3 weeks load → 1 week cutback"), so a runner
 * who has been through a whole cycle without a qualifying easy day gets
 * silence rather than a stale accusation.
 */
export const MAX_STALENESS_DAYS = 28;

/* ═════════════════════════════ Types ════════════════════════════════════ */

/** Which read a filter destroys. The whole design is in this distinction. */
export type EasyBasis = 'hr' | 'pace';

export type EasyRunExclusion =
  /** Hot enough that HR is elevated at a fixed effort. HR only. */
  | 'heat'
  /** Hilly enough that both HR and pace mean something different. */
  | 'terrain'
  /** Inside a taper or a post-race recovery window · both reads distorted. */
  | 'race_recency'
  /** Logged illness overlapping the run · both reads distorted. */
  | 'illness'
  /** First runs back after a layoff · both reads distorted. */
  | 'layoff_return'
  /** Long enough for cardiac drift to inflate average HR. HR only. */
  | 'cardiac_drift'
  /** No HR on the row. HR only. */
  | 'no_hr'
  /** No pace on the row. Pace only. */
  | 'no_pace'
  /** Too short to be an easy day at all. Both. */
  | 'too_short';

/**
 * Which basis each exclusion invalidates. THE TABLE IS THE ARGUMENT — read it
 * before changing anything else in this file.
 *
 * The asymmetric rows are the interesting ones. `heat` and `cardiac_drift`
 * raise heart rate at a fixed effort, so they poison an HR read; neither makes
 * a runner faster, so a hot or long day still run faster than the easy band is
 * evidence for the pace read rather than against it. Everything else changes
 * what the runner was legitimately trying to do, and disqualifies both.
 */
export const FILTER_INVALIDATES: Record<EasyRunExclusion, readonly EasyBasis[]> = {
  heat: ['hr'],
  cardiac_drift: ['hr'],
  no_hr: ['hr'],
  no_pace: ['pace'],
  terrain: ['hr', 'pace'],
  race_recency: ['hr', 'pace'],
  illness: ['hr', 'pace'],
  layoff_return: ['hr', 'pace'],
  too_short: ['hr', 'pace'],
};

/** One completed easy/recovery run, already loaded. Everything optional is
 *  genuinely optional — a run row missing weather or elevation degrades to a
 *  softer filter, it does not crash the finding. */
export interface EasyRunObservation {
  dateISO: string;
  distanceMi: number;
  /** Average moving pace, seconds per mile. */
  paceSPerMi: number | null;
  /** Grade-adjusted pace, when the elevation work has landed. See the TODO on
   *  TERRAIN_CONFOUND_FT_PER_MI. Null today. */
  gapSPerMi?: number | null;
  avgHrBpm: number | null;
  durationSec: number | null;
  tempF: number | null;
  /** The runner's own recent typical temperature, for the relative heat read
   *  via the shared `weatherContext` model. Null skips the relative test. */
  baselineTempF?: number | null;
  elevGainFt: number | null;
  /** Absolute days to the nearest race, past or future. Null = no race near. */
  daysFromNearestRace: number | null;
  /** Days that race window covers, from doctrine (taper length before, total
   *  recovery days after). Null falls back to a conservative 14. */
  raceWindowDays?: number | null;
  illness?: boolean;
  /** True when this is one of the first runs back after a break. */
  layoffReturn?: boolean;
}

/** Per-run verdict. `exclusions` is the audit trail — every filter that fired,
 *  so a human can see exactly why a run was or was not counted. */
export interface EasyRunVerdict {
  dateISO: string;
  exclusions: EasyRunExclusion[];
  hrEligible: boolean;
  paceEligible: boolean;
  avgHrBpm: number | null;
  pctHrMax: number | null;
  paceSPerMi: number | null;
  /** HR above the coherent ceiling · null when not HR-eligible. */
  overHrCeiling: boolean | null;
  /** Pace faster than the prescribed easy floor · null when not pace-eligible. */
  fasterThanBand: boolean | null;
}

export interface EasyDisciplineInput {
  todayISO: string;
  /** From `loadEffectiveMaxHr`. Null disables the HR basis entirely. */
  maxHrBpm: number | null;
  /** `workout_spec.hr_cap_bpm` — the cap the app actually showed him. Used to
   *  keep the ceiling coherent; see the module header. */
  prescribedEasyCapBpm: number | null;
  /** `[lo, hi]` seconds per mile from `workout_spec`. Null disables the pace
   *  basis. `lo` is the FAST end — running below it is running the easy day
   *  faster than prescribed. */
  easyPaceBandSPerMi: [number, number] | null;
  runs: EasyRunObservation[];
}

export type EasyDisciplineState = 'established' | 'quiet';

export type EasyQuietReason =
  /** Enough evidence, and the majority is now under the ceiling. Speak once. */
  | 'resolved'
  /** Not enough qualifying runs, or not spread over enough weeks. Say nothing. */
  | 'insufficient_evidence'
  /** Newest qualifying run is too old to describe a current habit. */
  | 'stale'
  /**
   * The pace basis would have fired, but the heart rate on those same runs
   * sits inside the easy window. HR is the governor (`Research/03`), so the
   * evidence does not support "easy days too hard" — it points at the pace
   * band being slower than this runner's easy actually is. Silence, not a
   * scold, and not a line re-opening the pace formula either.
   */
  | 'hr_contradicts_pace'
  /** Neither basis is available at all. */
  | 'no_basis';

/** What the pace evidence says about WHY the HR is high. The distinction that
 *  keeps this from being a scold when the prescription is the problem. */
export type EasyRead =
  /** Faster than the band and over the ceiling. A discipline finding. */
  | 'ran_faster_than_band'
  /** Inside the band but over the ceiling. The band, or the fitness anchor
   *  behind it, is the more likely explanation than the runner's choices. */
  | 'in_band_but_high_hr'
  /** Pace basis only · HR was not readable over this window. */
  | 'pace_only';

export interface EasyDisciplineFinding {
  state: EasyDisciplineState;
  quietReason: EasyQuietReason | null;
  basis: EasyBasis | null;
  read: EasyRead | null;
  verdicts: EasyRunVerdict[];
  /** Runs that survived the filters for the basis that fired. */
  qualifying: number;
  /** Of those, how many were over the ceiling / faster than the band. */
  over: number;
  distinctWeeks: number;
  meanPctHrMax: number | null;
  meanPaceSPerMi: number | null;
  /** The coherent HR ceiling actually applied, in bpm. */
  ceilingBpm: number | null;
  /** What the runner should aim at · the doctrine ceiling, in bpm. */
  targetBpm: number | null;
  /** The prescribed easy band echoed back, so the composers need only the
   *  finding. `lo` is the fast end. */
  easyPaceBandSPerMi: [number, number] | null;
  /** Honest limits of this read. Never empty when something fired. */
  caveats: string[];
}

/* ═══════════════════════ Per-run context filtering ══════════════════════ */

const DAY_MS = 86_400_000;
const daysBetween = (aISO: string, bISO: string) =>
  Math.round((Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / DAY_MS);

/** ISO week key · groups runs so MIN_DISTINCT_WEEKS means what it says. */
export function weekKeyOf(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Run one run through every filter. Each filter asks its own question about
 * THIS observation — the parent window's guards do not propagate (CLAUDE.md
 * §"Per-finding context filters").
 */
export function classifyEasyRun(
  r: EasyRunObservation,
  ceilingBpm: number | null,
  maxHrBpm: number | null,
  easyPaceBandSPerMi: [number, number] | null,
): EasyRunVerdict {
  const ex: EasyRunExclusion[] = [];

  // ── too short · not an easy day at all ──────────────────────────────────
  if (!(r.distanceMi >= MIN_EASY_RUN_MI)) ex.push('too_short');

  // ── heat · Research/03 confounders. Absolute OR relative-to-acclimatised.
  // The relative test consumes the SHARED heat model (weatherContext) rather
  // than reimplementing one, so this module and the post-run surfaces price
  // the same physics. A runner acclimatised to 90 °F summers would never trip
  // the relative test, which is why the absolute doctrine threshold stands
  // alongside it rather than being replaced by it.
  const hotAbsolute = r.tempF != null && r.tempF >= HEAT_CONFOUND_TEMP_F;
  const rel =
    r.tempF != null && r.baselineTempF != null
      ? weatherContext({ actualTempF: r.tempF, baselineTempF: r.baselineTempF })
      : null;
  const hotRelative = rel != null && rel.hrBumpBpm > 0;
  if (hotAbsolute || hotRelative) ex.push('heat');

  // ── terrain · GAP when it exists, net climb as the documented proxy ─────
  const gapDelta =
    r.gapSPerMi != null && r.paceSPerMi != null && r.paceSPerMi > 0
      ? Math.abs(r.gapSPerMi - r.paceSPerMi) / r.paceSPerMi
      : null;
  const hilly =
    gapDelta != null
      ? gapDelta >= TERRAIN_CONFOUND_GAP_PCT
      : r.elevGainFt != null &&
        r.distanceMi > 0 &&
        r.elevGainFt / r.distanceMi >= TERRAIN_CONFOUND_FT_PER_MI;
  if (hilly) ex.push('terrain');

  // ── race recency · taper before, recovery after. Both reads distorted;
  // this is the exact case the locked per-finding rule was written about.
  const raceWindow = r.raceWindowDays ?? 14;
  if (r.daysFromNearestRace != null && Math.abs(r.daysFromNearestRace) <= raceWindow) {
    ex.push('race_recency');
  }

  if (r.illness) ex.push('illness');
  if (r.layoffReturn) ex.push('layoff_return');

  // ── cardiac drift · long runs average higher HR at the same effort ──────
  if (r.durationSec != null && r.durationSec > DRIFT_CONFOUND_MINUTES * 60) {
    ex.push('cardiac_drift');
  }

  if (r.avgHrBpm == null || maxHrBpm == null) ex.push('no_hr');
  if (r.paceSPerMi == null || easyPaceBandSPerMi == null) ex.push('no_pace');

  const blocks = (basis: EasyBasis) => ex.some((e) => FILTER_INVALIDATES[e].includes(basis));
  const hrEligible = !blocks('hr');
  const paceEligible = !blocks('pace');

  const pctHrMax =
    r.avgHrBpm != null && maxHrBpm ? Math.round((r.avgHrBpm / maxHrBpm) * 1000) / 10 : null;

  return {
    dateISO: r.dateISO,
    exclusions: ex,
    hrEligible,
    paceEligible,
    avgHrBpm: r.avgHrBpm,
    pctHrMax,
    paceSPerMi: r.paceSPerMi,
    overHrCeiling:
      hrEligible && r.avgHrBpm != null && ceilingBpm != null ? r.avgHrBpm > ceilingBpm : null,
    fasterThanBand:
      paceEligible && r.paceSPerMi != null && easyPaceBandSPerMi != null
        ? r.paceSPerMi < easyPaceBandSPerMi[0]
        : null,
  };
}

/* ═══════════════════════════ The detector ═══════════════════════════════ */

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * The gate. Pure. Returns `established` only when a clear majority of
 * qualifying easy days, spread across several weeks and recent enough to be a
 * habit, sit over the ceiling; `quiet` with `quietReason: 'resolved'` when
 * there is enough evidence to say the pattern has BROKEN.
 *
 * The ordering matters: HR is tried first because `Research/03` calls it the
 * honest governor, and the pace basis is the fallback rather than a second
 * opinion. Only one basis ever fires.
 */
export function detectEasyDiscipline(i: EasyDisciplineInput): EasyDisciplineFinding {
  const doctrineCeiling =
    i.maxHrBpm != null ? Math.round(i.maxHrBpm * EASY_HRMAX_CEILING_PCT) : null;
  // Coherence · never accuse him of exceeding a cap looser than the one the
  // app itself printed on the workout. See the module header.
  const ceilingBpm =
    doctrineCeiling == null
      ? null
      : i.prescribedEasyCapBpm != null
        ? Math.max(doctrineCeiling, i.prescribedEasyCapBpm)
        : doctrineCeiling;

  const inWindow = i.runs.filter((r) => {
    const age = daysBetween(r.dateISO, i.todayISO);
    return age >= 0 && age <= WINDOW_DAYS;
  });
  const verdicts = inWindow.map((r) =>
    classifyEasyRun(r, ceilingBpm, i.maxHrBpm, i.easyPaceBandSPerMi),
  );

  const quiet = (
    quietReason: EasyQuietReason,
    extra: Partial<EasyDisciplineFinding> = {},
  ): EasyDisciplineFinding => ({
    state: 'quiet',
    quietReason,
    basis: null,
    read: null,
    verdicts,
    qualifying: 0,
    over: 0,
    distinctWeeks: 0,
    meanPctHrMax: null,
    meanPaceSPerMi: null,
    ceilingBpm,
    targetBpm: doctrineCeiling,
    easyPaceBandSPerMi: i.easyPaceBandSPerMi,
    caveats: [],
    ...extra,
  });

  const hrSet = verdicts.filter((v) => v.hrEligible && v.overHrCeiling != null);
  const paceSet = verdicts.filter((v) => v.paceEligible && v.fasterThanBand != null);

  const usable = (set: EasyRunVerdict[]) => {
    if (set.length < MIN_QUALIFYING_RUNS) return false;
    if (new Set(set.map((v) => weekKeyOf(v.dateISO))).size < MIN_DISTINCT_WEEKS) return false;
    return true;
  };

  const basis: EasyBasis | null = usable(hrSet) ? 'hr' : usable(paceSet) ? 'pace' : null;
  if (basis == null) {
    return quiet(hrSet.length + paceSet.length === 0 ? 'no_basis' : 'insufficient_evidence');
  }

  const set = basis === 'hr' ? hrSet : paceSet;
  const over = set.filter((v) => (basis === 'hr' ? v.overHrCeiling : v.fasterThanBand)).length;
  const distinctWeeks = new Set(set.map((v) => weekKeyOf(v.dateISO))).size;
  const meanPctHrMax = mean(set.map((v) => v.pctHrMax).filter((x): x is number => x != null));
  const meanPaceSPerMi = mean(set.map((v) => v.paceSPerMi).filter((x): x is number => x != null));

  const newest = set.reduce((a, v) => (v.dateISO > a ? v.dateISO : a), set[0].dateISO);
  const stale = daysBetween(newest, i.todayISO) > MAX_STALENESS_DAYS;

  const common = {
    verdicts,
    qualifying: set.length,
    over,
    distinctWeeks,
    meanPctHrMax,
    meanPaceSPerMi,
    ceilingBpm,
    targetBpm: doctrineCeiling,
    easyPaceBandSPerMi: i.easyPaceBandSPerMi,
  };

  if (stale) return quiet('stale', common);

  if (over / set.length < OVER_CEILING_MAJORITY) {
    // Enough evidence, and the majority is UNDER. This is the resolve path —
    // the only quiet reason that is worth saying out loud.
    return { ...quiet('resolved', common), basis };
  }

  // ── which story does the pace evidence support? ─────────────────────────
  let read: EasyRead = 'pace_only';
  const caveats: string[] = [];
  if (basis === 'hr') {
    const paced = set.filter((v) => v.fasterThanBand != null);
    const fasterCount = paced.filter((v) => v.fasterThanBand).length;
    if (paced.length > 0 && fasterCount / paced.length >= OVER_CEILING_MAJORITY) {
      read = 'ran_faster_than_band';
    } else {
      read = 'in_band_but_high_hr';
      caveats.push(
        'These runs were inside the prescribed pace band, so the band may be set too fast ' +
          'for current fitness, or fatigue may be carrying over. High easy HR on its own is ' +
          'not proof of a discipline problem.',
      );
    }
    if (i.prescribedEasyCapBpm != null && doctrineCeiling != null && i.prescribedEasyCapBpm > doctrineCeiling) {
      caveats.push(
        `The plan's own easy cap is ${i.prescribedEasyCapBpm} bpm, above the ${doctrineCeiling} bpm ` +
          'doctrine ceiling. The looser number was used so this never counts obedience as a fault.',
      );
    }
  } else {
    // ── the HR veto ───────────────────────────────────────────────────────
    // The pace basis is a FALLBACK for when HR cannot be read, not a way to
    // overrule HR that can. If enough of these same runs carry a heart rate
    // and it averages inside the easy window, then by this module's own
    // stated hierarchy the runs WERE easy and the pace band is the thing out
    // of step. Saying "you ran them too hard" here would be false, and saying
    // "your band is too slow" would re-open a pace formula the owner closed
    // (feedback_easy_pace_anchored_current_vdot). So: silence, with the
    // contradiction recorded for whoever reads the finding.
    const withHr = set.filter((v) => v.pctHrMax != null);
    const hrMean = mean(withHr.map((v) => v.pctHrMax as number));
    if (
      withHr.length >= Math.ceil(MIN_QUALIFYING_RUNS / 2) &&
      hrMean != null &&
      hrMean / 100 <= EASY_HRMAX_CEILING_PCT
    ) {
      return {
        ...quiet('hr_contradicts_pace', common),
        basis: 'pace',
        caveats: [
          `These easy days ran faster than the prescribed band, but their heart rate averaged ` +
            `${Math.round(hrMean)}% of max, inside the ${Math.round(EASY_HRMAX_FLOOR_PCT * 100)} to ` +
            `${Math.round(EASY_HRMAX_CEILING_PCT * 100)} easy window. Heart rate is the governor, ` +
            'so the evidence does not support running them too hard.',
        ],
      };
    }
    caveats.push(
      'Heart rate is not the basis here. Heat, terrain or race weeks disqualified too many ' +
        'easy days over this window for the HR read to be trustworthy, so this rests on pace ' +
        'against the prescribed band.',
    );
  }

  const dropped = verdicts.length - set.length;
  if (dropped > 0) {
    caveats.push(
      `${dropped} of ${verdicts.length} easy days in the window were set aside as context ` +
        '(heat, terrain, race weeks, illness or a layoff return) and were not counted.',
    );
  }

  return {
    state: 'established',
    quietReason: null,
    basis,
    read,
    caveats,
    ...common,
  };
}

/* ═════════════════════════════ Coach voice ══════════════════════════════ */
/* Short, direct, no hype, no exclamation marks, no emoji, no em dashes.
 * Every line carries a NUMBER, the DOCTRINE, and an ACTION — a line that only
 * carries a number is a dashboard, not a coach. */

const fmtPace = (s: number): string => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const countWord = (n: number): string =>
  (
    [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'ten', 'eleven', 'twelve',
    ] as const
  )[n] ?? String(n);

/**
 * The line that opens the finding. One entry, once, when the pattern
 * establishes.
 */
export function composeEasyDisciplineEntry(f: EasyDisciplineFinding): {
  title: string;
  body: string;
} {
  const band = f.easyPaceBandSPerMi;
  const n = countWord(f.over);
  if (f.basis === 'hr') {
    const pct = f.meanPctHrMax != null ? Math.round(f.meanPctHrMax) : null;
    const lo = Math.round(EASY_HRMAX_FLOOR_PCT * 100);
    const hi = Math.round(EASY_HRMAX_CEILING_PCT * 100);
    const head =
      pct != null
        ? `Your last ${n} easy days averaged ${pct}% of max. Easy is ${lo} to ${hi}.`
        : `Your last ${n} easy days ran over the easy ceiling. Easy is ${lo} to ${hi}.`;
    if (f.read === 'in_band_but_high_hr') {
      return {
        title: 'EASY DAYS',
        body:
          `${head} You were inside the pace band, so this is the band or the fatigue, ` +
          'not your discipline. Run the easy ones to the HR cap and let the pace fall where it wants.',
      };
    }
    const target = f.targetBpm;
    return {
      title: 'EASY DAYS',
      body:
        `${head} ` +
        (target != null
          ? `Run the easy ones under ${target} and let the pace fall where it wants.`
          : 'Run the easy ones slower and let the pace fall where it wants.'),
    };
  }

  const avg = f.meanPaceSPerMi != null ? fmtPace(f.meanPaceSPerMi) : null;
  const bandTxt = band ? `${fmtPace(band[0])} to ${fmtPace(band[1])}` : 'the easy band';
  const head =
    avg != null
      ? `${n.charAt(0).toUpperCase() + n.slice(1)} of your last ${countWord(f.qualifying)} easy days ran faster than the easy band, averaging ${avg}.`
      : `${n.charAt(0).toUpperCase() + n.slice(1)} of your last ${countWord(f.qualifying)} easy days ran faster than the easy band.`;
  return {
    title: 'EASY DAYS',
    body: `${head} Easy is ${bandTxt}. Run them at ${band ? fmtPace(band[0]) : 'the band'} or slower and let the heart rate settle.`,
  };
}

/** The line that closes it. Closing the loop matters more than opening it. */
export function composeEasyDisciplineResolved(f: EasyDisciplineFinding): {
  title: string;
  body: string;
} {
  const under = f.qualifying - f.over;
  if (f.basis === 'hr' && f.meanPctHrMax != null) {
    return {
      title: 'EASY DAYS',
      body: `Easy days are back under the ceiling · ${countWord(under)} of ${countWord(f.qualifying)} in range, averaging ${Math.round(f.meanPctHrMax)}% of max. That is the aerobic work doing its job. Keep them there.`,
    };
  }
  return {
    title: 'EASY DAYS',
    body: `Easy days are back in the band · ${countWord(under)} of ${countWord(f.qualifying)} in range. That is the aerobic work doing its job. Keep them there.`,
  };
}

/* ═══════════════════════════ DB shell ═══════════════════════════════════ */
/* Best-effort, never throws, mirrors the house posture in coach-log.ts and
 * morning-brief.ts. Everything above is pure and is what the tests lock. */

interface RunRow {
  data: {
    date?: string;
    startLocal?: string;
    distanceMi?: number | string;
    paceSPerMi?: number | string;
    avgHr?: number | null;
    durationSec?: number | string;
    movingTimeS?: number | string;
    elevGainFt?: number | string | null;
    tempF?: number | string | null;
    weather?: { temp_f?: number | null } | null;
    workoutType?: string | null;
  };
}

const EASY_TYPES = new Set(['easy', 'recovery', 'shakeout']);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Load the finding for a user. Reads only; writes are `updateCoachLog`'s job.
 * Returns null when the shape cannot be loaded at all — callers treat null and
 * `state: 'quiet'` the same way (say nothing).
 */
export async function loadEasyDiscipline(
  userId: string,
  todayArg?: string,
): Promise<EasyDisciplineFinding | null> {
  try {
    const todayISO = todayArg ?? (await runnerToday(userId));
    const fromISO = new Date(Date.parse(`${todayISO}T00:00:00Z`) - WINDOW_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);

    const maxHr = await loadEffectiveMaxHr(userId, todayISO).catch(() => ({ bpm: null }));

    // The prescription the app actually gave him · newest easy spec wins.
    const spec = await pool
      .query<{ hr_cap_bpm: number | null; lo: number | null; hi: number | null }>(
        `SELECT (workout_spec->>'hr_cap_bpm')::int              AS hr_cap_bpm,
                (workout_spec->>'pace_target_s_per_mi_lo')::int AS lo,
                (workout_spec->>'pace_target_s_per_mi_hi')::int AS hi
           FROM plan_workouts
          WHERE user_uuid = $1 AND type IN ('easy','recovery') AND workout_spec IS NOT NULL
          ORDER BY date_iso DESC
          LIMIT 1`,
        [userId],
      )
      .catch(() => ({ rows: [] as { hr_cap_bpm: number | null; lo: number | null; hi: number | null }[] }));
    const s = spec.rows[0];
    const band: [number, number] | null = s?.lo != null && s?.hi != null ? [s.lo, s.hi] : null;

    const rows = await pool
      .query<RunRow>(
        `SELECT data FROM runs
          WHERE user_uuid = $1
            AND NOT (data ? 'mergedIntoId')
            AND (data->>'type') = 'Run'
            AND COALESCE(data->>'date', LEFT(data->>'startLocal',10)) BETWEEN $2 AND $3
          ORDER BY 1`,
        [userId, fromISO, todayISO],
      )
      .catch(() => ({ rows: [] as RunRow[] }));

    // Races · doctrine windows come from the plan rows that carry them. A race
    // the runner has not logged simply leaves daysFromNearestRace null, which
    // is the conservative direction (the run stays in the pattern) — so the
    // race read is taken from the races table, which is the source of truth
    // for race dates per CLAUDE.md.
    // 2026-08-19 · race-shape audit · resolve the distance through the shared
    // label parser, not the raw jsonb field. `meta.distanceMi` is NULL on
    // every race row written before 2026-07-06 (the standard write path stored
    // distanceLabel only), so `(meta->>'distanceMi')::float8` returned null and
    // `raceWindowFor(null)` defaulted to 13.1 — the HALF window. A day-20 run
    // after a MARATHON therefore fell outside the 14-day half window and was
    // graded as ordinary easy training, in the middle of a 28-day recovery
    // block that Research/00b says is still recovery. Read-time resolution, no
    // migration: `distanceMiFromLabel` is the same superset parser the race
    // routes write through, so a label-only row lights up immediately.
    const races = await pool
      .query<{ d: string; dist: number | null; label: string | null; name: string | null }>(
        `SELECT (meta->>'date') AS d, (meta->>'distanceMi')::float8 AS dist,
                (meta->>'distanceLabel') AS label, (meta->>'name') AS name
           FROM races WHERE user_uuid = $1 AND (meta->>'date') IS NOT NULL`,
        [userId],
      )
      .catch(() => ({ rows: [] as { d: string; dist: number | null; label: string | null; name: string | null }[] }));
    const raceDistanceMi = (r: { dist: number | null; label: string | null; name: string | null }): number | null =>
      (r.dist != null && Number.isFinite(r.dist) && r.dist > 0)
        ? r.dist
        : (distanceMiFromLabel(r.label) ?? distanceMiFromLabel(r.name));

    const sick = await pool
      .query<{ a: string; b: string | null }>(
        `SELECT to_char(logged_at,'YYYY-MM-DD') AS a, to_char(cleared_at,'YYYY-MM-DD') AS b
           FROM sick_episodes WHERE COALESCE(user_uuid, user_id) = $1`,
        [userId],
      )
      .catch(() => ({ rows: [] as { a: string; b: string | null }[] }));

    // Baseline temperature · the runner's own recent typical, for the shared
    // relative-heat model. Median is the honest centre here; a single 97 °F
    // day should not drag the baseline it is being compared against.
    const temps = rows.rows
      .map((r) => num(r.data.weather?.temp_f ?? r.data.tempF))
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    const baselineTempF = temps.length ? temps[Math.floor(temps.length / 2)] : null;

    const dateOf = (r: RunRow) => r.data.date ?? (r.data.startLocal ?? '').slice(0, 10);
    const allDates = rows.rows.map(dateOf).filter(Boolean).sort();

    const runs: EasyRunObservation[] = [];
    for (const r of rows.rows) {
      const d = r.data;
      const dateISO = dateOf(r);
      if (!dateISO) continue;
      if (!EASY_TYPES.has(String(d.workoutType ?? '').toLowerCase())) continue;

      // Nearest race, and the doctrine window that race carries.
      let daysFromNearestRace: number | null = null;
      let raceWindowDays: number | null = null;
      for (const race of races.rows) {
        const gap = Math.abs(daysBetween(race.d, dateISO));
        if (daysFromNearestRace == null || gap < daysFromNearestRace) {
          daysFromNearestRace = gap;
          raceWindowDays = raceWindowFor(raceDistanceMi(race), daysBetween(race.d, dateISO) > 0);
        }
      }

      const illness = sick.rows.some(
        (e) => dateISO >= e.a && (e.b == null || dateISO <= e.b),
      );

      // Layoff return · first run back after a gap. A heuristic about data
      // shape rather than a claim about physiology, so no registry entry.
      const idx = allDates.indexOf(dateISO);
      const prev = idx > 0 ? allDates[idx - 1] : null;
      const layoffReturn = prev != null && daysBetween(prev, dateISO) >= 10;

      runs.push({
        dateISO,
        distanceMi: num(d.distanceMi) ?? 0,
        paceSPerMi: num(d.paceSPerMi),
        gapSPerMi: null, // TODO(elevation-agent) · populate when GAP lands.
        avgHrBpm: num(d.avgHr),
        durationSec: num(d.durationSec) ?? num(d.movingTimeS),
        tempF: num(d.weather?.temp_f ?? d.tempF),
        baselineTempF,
        elevGainFt: num(d.elevGainFt),
        daysFromNearestRace,
        raceWindowDays,
        illness,
        layoffReturn,
      });
    }

    return detectEasyDiscipline({
      todayISO,
      maxHrBpm: maxHr.bpm ?? null,
      prescribedEasyCapBpm: s?.hr_cap_bpm ?? null,
      easyPaceBandSPerMi: band,
      runs,
    });
  } catch (e) {
    console.warn('[easy-discipline] loadEasyDiscipline failed:', e);
    return null;
  }
}

/**
 * How many days around a race are context rather than training.
 *
 * Before: `Research/08` §9.1 "Taper duration by distance" upper bound.
 * After: `Research/00b` §"Recovery by Distance" · "Total recovery days (no
 * quality)" upper bound — the column the 52174bcd incident proved is easy to
 * confuse with its neighbour, so it is named explicitly here.
 * Watched by `RACE.easy-read-context-window`.
 */
export function raceWindowFor(distanceMi: number | null, isAfter: boolean): number {
  // 2026-08-19 · race-shape audit · the `?? 13.1` default is a LAST resort and
  // is now reached only when a race row carries no numeric distance, no label
  // and no parseable name — `loadEasyDiscipline` resolves label→miles before
  // calling. It stays rather than returning null because the caller's contract
  // is "how many days of context does this race carry", and the half's window
  // is the middle of the table: guessing short would grade a marathon's third
  // week as ordinary training (the bug), guessing long would silence real
  // 5K-week observations for a month.
  const d = distanceMi ?? 13.1;
  if (d >= 25) return isAfter ? 28 : 21; // marathon
  if (d >= 12) return isAfter ? 14 : 14; // half
  if (d >= 6) return isAfter ? 7 : 10; // 10K
  return isAfter ? 5 : 7; // 5K
}
