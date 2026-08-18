/**
 * lib/race/representativeness.ts · was this race a measurement of fitness?
 *
 * Implements rule 8 of `Design/adaptive-progression-engine.md` (David, locked
 * 2026-08-17):
 *
 *   poor_race + conditions_normal + tapered + well_paced + maximal
 *       → meaningful downward re-anchor
 *   poor_race + hilly|hot|fatigued|badly_paced
 *       → reduce confidence, smaller adjustment
 *
 *   "One noisy race should not destroy a stable fitness model."
 *
 * `detectFitnessRegression` (lib/plan/adapt.ts) re-anchors an athlete's whole
 * pace structure downward when a race lands 1.5 VDOT under the plan's anchor,
 * and on race-sourced evidence it AUTO-APPLIES. Before this file existed it
 * never asked whether the race was representative: a hot day, a hilly course, a
 * blown pacing job, a head cold, or a C race jogged as a workout all overwrote a
 * stable fitness model at full authority.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 *
 * Authority is NOT a hand-tuned confidence dial. It is a residual:
 *
 *     authority = unexplained_fraction × effort_class_multiplier × premise_gate
 *
 * 1 · UNEXPLAINED FRACTION. The race under-ran what the anchor predicted by
 *     some percentage. Doctrine can PRICE part of that shortfall — course
 *     elevation, heat, dewpoint, wind, altitude, pacing dispersion — using
 *     models this app already owns. Whatever doctrine cannot explain is what
 *     the result actually says about fitness.
 *
 *         unexplained = 1 − explained_pct / observed_shortfall_pct
 *
 *     A race run clean and simply slower has nothing to explain it, so the
 *     fraction is 1.0 and the re-anchor lands exactly as it does today. A race
 *     whose shortfall is fully priced by the conditions moves the fitness model
 *     not at all. This is `Research/06` §10's "race time conversion to neutral
 *     equivalent" read as a confidence question rather than a time correction —
 *     see the double-counting note below for why it is not applied as both.
 *
 * 2 · EFFORT CLASS. `Research/00b` §"Recovery by Effort (A vs. B vs. C Race)"
 *     grades what a race WAS: an A race is "Maximum, full taper, peak day"; a C
 *     race is "Strong effort, no taper … treat like a hard workout". The engine
 *     already reads that table's recovery scale (`RECOVERY_EFFORT_SCALE`,
 *     A 1.0 / B 0.65 / C 0.35). The same grading is the honest authority
 *     multiplier: a hard workout with a number on it is not a fitness test.
 *
 *     Taper state and fatigue are folded into this ONE multiplier rather than
 *     applied as separate penalties, because the doctrine table's own columns
 *     bind them together — "Taper before" and "Effort given" are two columns of
 *     one row. An athlete who raced a declared A race on loaded legs did not
 *     run an A race; the class is downgraded and priced once. Penalising
 *     priority AND taper AND fatigue separately would be three charges for one
 *     fact.
 *
 * 3 · PREMISE GATE. Illness zeroes authority outright. A race run sick is not a
 *     slow measurement of fitness, it is not a measurement of fitness. There is
 *     no magnitude to tune, so none is invented.
 *
 * ── Double counting · what this file deliberately does NOT do ─────────────
 *
 * Three separate traps, each guarded:
 *
 * A · UPSTREAM — TRACED, AND IT IS CLEAN. `vdotFromRace(finishS, distanceMi)`
 *     in `lib/training/vdot.ts` is pure Daniels math on RAW elapsed seconds:
 *     no weather, terrain or altitude term appears anywhere in that file. Both
 *     writers of `races.actual_result.finishS` store a raw time — the manual
 *     chip entry (`app/api/race/result/route.ts` via `manualResultPatch`) and
 *     the watch auto-provisional (`lib/race/auto-result.ts`, raw moving/elapsed
 *     seconds). `bestRecentVdot`'s race branch passes `finish_seconds` through
 *     untouched; every modifier on the anchor side is a staleness/evidence-class
 *     one, never environmental. So this file is the FIRST and ONLY place a race
 *     is priced for conditions.
 *
 *     THE ONE ASYMMETRY TO WATCH: `lib/training/vdot-inputs.ts` DOES
 *     grade-adjust training RUNS before they reach `bestRecentVdot`
 *     (`resolveRunTerrain` → `finishSec = rawSec / terrain.factor`), and
 *     deliberately does NOT do so for races. If terrain is ever added to that
 *     file's race branch, it will stack with `course_elevation` here. Callers
 *     declare any upstream pricing via `alreadyPricedFor` and the matching
 *     factor is skipped rather than charged twice.
 *
 * B · WITHIN THIS FILE. Doctrine offers two levers for a compromised race:
 *     correct the time to a neutral equivalent (`Research/06` §10), or shrink
 *     the adjustment (`Design/adaptive-progression-engine.md` rule 8). Doing
 *     both would discount the same conditions twice. Rule 8 is the canonical
 *     instruction for this code path, so authority-scaling is the only lever
 *     used here; the neutral-equivalent formula is used solely to SIZE the
 *     explanation, never to rewrite the finish time.
 *
 * C · BETWEEN FACTORS. Heat expresses itself partly AS a late-race fade, so a
 *     hot race would be charged once for heat and again for "bad pacing". The
 *     pacing attribution is therefore net of the heat already priced.
 *
 *     Composition is MULTIPLICATIVE, matching `Research/01` §"Combined
 *     conditions" ("Add adjustments multiplicatively, not additively") and the
 *     rule `lib/terrain/grade-adjust.ts#composeEffortFactor` already enforces
 *     for the heat×grade pair. That function covers two factors; this one
 *     composes six, so it applies the same stated rule rather than routing
 *     through it — see `composeSlowdown` below, which is the single place
 *     stacking happens in this file.
 *
 *     TWO DOCTRINE SOURCES DISAGREE, AND THE MORE SPECIFIC ONE WINS FOR ITS
 *     OWN CASE. `Research/06` §10 gives an explicitly-labelled "additive
 *     approximation" and then states one exception with a worked number:
 *     "Heat and altitude slightly compound (not strictly additive); when both
 *     >5%, reduce expected gains by ~10% — i.e., a 6% heat + 6% altitude
 *     condition ≈ 11% (not 12%)". Multiplicative composition gives 12.4% there,
 *     so for that pair — and only that pair — doctrine's stated haircut is
 *     applied on top. General rule from `Research/01`; the named exception from
 *     the doc that names it.
 *
 * ── Purity ────────────────────────────────────────────────────────────────
 *
 * No database, no network, no clock. Everything the diagnosis needs is passed
 * in by `lib/plan/adapt.ts`, which owns the fetching. That keeps this file
 * exhaustively testable and keeps the change inside adapt.ts to a call plus an
 * authority-scaled magnitude.
 *
 * Doctrine gate: see `REPRESENTATIVENESS.*` in lib/doctrine/registry.ts. Every
 * band below is read out of `Research/` at run time, never hand-copied.
 */
import { predictRaceTime } from '@/lib/training/vdot';
import {
  abilityTierFromVdot,
  dewpointAddPct,
  estimateDewpointF,
  maughanSlowdownPct,
  solarEffectiveBumpF,
  durationHeatScale,
  type AbilityTier,
} from '@/lib/training/heat-model';
import { courseElevationCostSec } from '@/lib/training/elevation-model';
import {
  RECOVERY_EFFORT_SCALE,
  recoveryEffortScale,
  TAPER_RACE_WEEK_PCT_OF_PEAK,
  distanceCategoryOf,
  type RacePriority,
} from '@/lib/plan/goal-tiers';
import type { TrainingFormLabel } from '@/lib/coach/training-form';

// ── Factors ────────────────────────────────────────────────────────────────

export type RepresentativenessFactor =
  | 'course_elevation' | 'heat' | 'humidity' | 'wind' | 'altitude'
  | 'pacing' | 'taper_state' | 'fatigue' | 'illness' | 'not_maximal' | 'fuelling';

export interface RepresentativenessDetractor {
  factor: RepresentativenessFactor;
  /** How much authority this factor removed, 0..1. */
  authorityCost: number;
  /** Plain-language reason, carrying the number that drove it. */
  detail: string;
}

export interface RepresentativenessRead {
  /** 0..1 — how much authority this result should carry over the fitness model. */
  authority: number;
  tier: 'representative' | 'compromised' | 'unrepresentative';
  /** Each factor that reduced authority, with how much and why. */
  detractors: RepresentativenessDetractor[];
  /** One plain-language line for the coach voice. */
  summary: string;
  /**
   * How short of the anchor's prediction the race actually ran, in percent of
   * predicted time. 0 when the race met or beat the prediction.
   */
  observedShortfallPct: number;
  /** How much of that shortfall doctrine prices to conditions and execution. */
  explainedPct: number;
  /**
   * The effort class the race is judged AS, after taper and fatigue downgrades.
   * Not necessarily the priority the athlete declared.
   */
  effectiveEffortClass: RacePriority;
}

// ── Doctrine-derived constants ─────────────────────────────────────────────

/**
 * `Research/00b` §"Recovery by Effort (A vs. B vs. C Race)". The B row —
 * "Hard but not depleted; 1-week taper" — is doctrine's boundary between a
 * result that stands as a performance and one that carries a caveat. A read at
 * or above it is representative.
 */
export const REPRESENTATIVE_FLOOR = RECOVERY_EFFORT_SCALE.B;

/**
 * The C row — "Strong effort, no taper … treat like a hard workout" — is
 * doctrine's own marker for "this barely counts as a race". Below it a result
 * does not move the fitness model at all.
 */
export const UNREPRESENTATIVE_FLOOR = RECOVERY_EFFORT_SCALE.C;

/**
 * `Research/06` §10 "Combined adjustment formula (additive approximation)":
 * "Heat and altitude slightly compound (not strictly additive); when both >5%,
 * reduce expected gains by ~10%".
 */
export const HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT = 5;
export const HEAT_ALTITUDE_COMPOUND_HAIRCUT = 0.10;

/**
 * MATERIALITY GATES · `Research/06` §11 "When to slow paces", verbatim:
 *
 *     Apply Td/Tair table whenever (Tair + Td) > 110°F or Td > 60°F
 *     Apply altitude table whenever elevation > 3,000 ft
 *     Apply wind table whenever sustained wind > 10 mph
 *
 * Doctrine does not merely supply curves, it says WHEN they apply. Without
 * these gates a 52°F, 3 mph, 40 ft race accumulates a fraction of a percent
 * from each model and quietly costs a clean result a tenth of its authority —
 * which is the exact failure this whole module exists to prevent, arriving
 * from the other direction. Below these thresholds the correct adjustment is
 * zero, not a small number.
 */
export const HEAT_GATE_SUM_F = 110;
export const HEAT_GATE_DEWPOINT_F = 60;
export const ALTITUDE_GATE_FT = 3000;
export const WIND_GATE_MPH = 10;

/**
 * `Research/02` §13.2 "Course Profile" · the table's own flat row is
 * "Flat (< 100 ft / 30m) | 0%". A course under it is not a hill.
 */
export const FLAT_COURSE_GAIN_FT = 100;

/**
 * The heat gate needs a dewpoint. When neither a measured dewpoint nor a
 * humidity to estimate one from is available, the gate degrades to air
 * temperature alone, at the first temperature the Maughan table itself is
 * non-zero (`Research/06` §1: 50°F and below is 0% for every tier, 60°F is the
 * first row that costs anything). Documented degradation, not a guess.
 */
export const HEAT_GATE_TAIR_ONLY_F = 60;

/**
 * `Research/06` §6 §"Crosswind": "Pure crosswind costs ~25-30% of equivalent
 * headwind". The conservative end.
 */
export const CROSSWIND_FRACTION_OF_HEADWIND = 0.25;

/**
 * `Research/06` §6 §"Out-and-back rule of thumb": a steady wind on an
 * out-and-back nets "flat-wind course minus 30-40% of headwind cost", i.e. the
 * tailwind leg refunds only part. The conservative end of the residual.
 */
export const OUT_AND_BACK_HEADWIND_RESIDUAL = 0.60;

/**
 * `Research/06` §6 headwind table, at the two pace anchors doctrine states
 * (6:00/mi and 8:00/mi). Read out of the doc by the doctrine gate; kept here so
 * the model runs without filesystem access.
 */
export const HEADWIND_COST_S_PER_MI: ReadonlyArray<{ mph: number; at6: number; at8: number }> = [
  { mph: 5,  at6: 3,  at8: 5   },
  { mph: 10, at6: 12, at8: 18  },
  { mph: 15, at6: 24, at8: 35  },
  { mph: 20, at6: 40, at8: 58  },
  { mph: 25, at6: 60, at8: 85  },
  { mph: 30, at6: 85, at8: 120 },
];

/**
 * `Research/06` §7 §"Race performance loss by elevation (sea-level
 * acclimatized)", the "Endurance event slowdown" column for the acute case and
 * the "After 3 weeks acclimatization" midpoint for the acclimated one.
 */
export const ALTITUDE_SLOWDOWN_PCT: ReadonlyArray<{ ft: number; acute: number; acclimated: number }> = [
  { ft: 1000,  acute: 0,    acclimated: 0    },
  { ft: 2500,  acute: 1,    acclimated: 0.75 },
  { ft: 4000,  acute: 2.5,  acclimated: 2    },
  { ft: 5000,  acute: 4,    acclimated: 3    },
  { ft: 6000,  acute: 5.5,  acclimated: 4    },
  { ft: 7000,  acute: 7.5,  acclimated: 5.75 },
  { ft: 8000,  acute: 10,   acclimated: 7.5  },
  { ft: 9000,  acute: 13,   acclimated: 10   },
  { ft: 10000, acute: 16.5, acclimated: 12.5 },
];

/**
 * `Research/08` §2.2 "Diaz / Hettinga 5-km segment framework" — the CV band a
 * runner of a given standard is EXPECTED to show. Dispersion inside the band is
 * normal racing; only the excess above the band's ceiling is a pacing failure.
 *
 * Keyed by the heat model's ability tier so the app has one ability vocabulary
 * rather than two. Doctrine's rows are marathon finish times; the mapping is
 * `abilityTierFromVdot`'s own (VDOT ≥60 ≈ sub-3:00, 45-60 ≈ 3:00-4:30).
 */
export const PACING_CV_CEILING_PCT: Record<AbilityTier, number> = {
  elite: 5,      // ceiling of the "National-class" row (3-5%)
  mid_pack: 10,  // ceiling of the "3:00-3:30" row (7-10%)
  slow: 15,      // ceiling of the "4:00-5:00+" row (10-15%+)
};

/** The doctrine row each tier's ceiling is the top of · read by the gate. */
export const PACING_CV_DOC_ROW: Record<AbilityTier, string> = {
  elite: 'National-class',
  mid_pack: '3:00-3:30',
  slow: '4:00-5:00+',
};

// ── Inputs ─────────────────────────────────────────────────────────────────

/** Per-mile split, as `races.actual_result.miles[]` stores it. */
export interface RaceSplit {
  mile: number;
  /** Seconds per mile. Null when the split was flagged unreliable. */
  paceSPerMi: number | null;
}

/** How the course wind lay relative to the runner. */
export type WindRelation = 'head' | 'tail' | 'cross' | 'out_and_back' | 'unknown';

export interface RaceWeatherInput {
  /** Air temperature °F over the race window. */
  tempF?: number | null;
  /** Measured dewpoint °F. Falls back to `humidityPct`. */
  dewpointF?: number | null;
  /** Relative humidity 0-100, used only to estimate a missing dewpoint. */
  humidityPct?: number | null;
  /** 'clear' | 'partly cloudy' | … · drives the solar bump. */
  conditions?: string | null;
  /** 0-100 · drives the solar bump when `conditions` is absent. */
  cloudCoverPct?: number | null;
  /** Sustained wind, mph. */
  windMph?: number | null;
  windRelation?: WindRelation | null;
}

export interface RaceCourseInput {
  /** Gross climbed feet across the course. */
  elevationGainFt?: number | null;
  /** Signed net elevation change, feet (finish − start). */
  netElevationFt?: number | null;
  /** Mean course elevation above sea level, feet. */
  altitudeFt?: number | null;
  /** True when the athlete had ≥3 weeks resident at altitude (Research/06 §7). */
  altitudeAcclimatized?: boolean | null;
}

/**
 * Training-form band on race day, re-exported straight off
 * `lib/coach/training-form.ts` so there is one vocabulary rather than two.
 * (`import type` — erased at compile time, so this file takes no runtime
 * dependency on that module's database access and stays pure.)
 *
 * The bands are `DETRAINING` (TSB > 25) · `RACE-READY` (10..25) ·
 * `PRODUCTIVE` (−10..10) · `LOADED` (−30..−10) · `OVERREACH` (≤ −30) ·
 * `BUILDING` (cold start). Only the loaded end matters here: a race run on
 * training legs was not a peak-day effort, whatever the athlete labelled it.
 */
export type FormBand = TrainingFormLabel;

export interface RaceStateInput {
  /** Race priority as stored on `races.meta->>'priority'`. */
  priority?: RacePriority | string | null;
  /**
   * Training-form band on race day, when the caller genuinely knows it.
   *
   * BEWARE READING THIS OFF `computeTrainingForm` AFTER THE RACE. That
   * function returns form as of TODAY, and a race is the single biggest
   * stress the model ever sees — a marathon spikes ATL hard enough to read
   * LOADED or OVERREACH for a fortnight afterwards. Feeding it post-hoc would
   * downgrade the effort class of every race BECAUSE the athlete raced, which
   * is circular. `lib/race/representativeness-inputs.ts` therefore leaves this
   * null and supplies `taperRatio` instead, which is measured from runs
   * strictly BEFORE the race and cannot be contaminated by it.
   */
  formBand?: FormBand | null;
  /**
   * Race-week running volume as a fraction of the peak week of the block
   * before it. Doctrine's taper is stated in exactly these terms:
   * `Research/08` §9.1 "Volume reduction (peak week)", encoded per distance as
   * `TAPER_RACE_WEEK_PCT_OF_PEAK`. A ratio at or below that is a real taper; a
   * ratio near 1.0 means the athlete raced straight off full training.
   */
  taperRatio?: number | null;
  /**
   * Illness reported across the race window. Zeroes authority — a race run sick
   * measures illness, not fitness.
   */
  illness?: boolean | null;
  /**
   * Niggle/pain severity 0-10 as the adapter records it. ≥5 is the engine's own
   * "modify the session" line, so it downgrades the effort class.
   */
  niggleSeverity?: number | null;
  /**
   * A REPORTED fuelling failure (bonk, GI shutdown, missed feeds). Never
   * inferred — a bonk shows up as a fade, and inferring it would charge the
   * same evidence twice under `pacing`. Athlete-reported only.
   */
  fuellingFailure?: boolean | null;
}

export interface RepresentativenessInput {
  /** Race distance, miles. */
  distanceMi: number;
  /** Observed finish, seconds. Raw chip/watch time. */
  finishS: number;
  /** The plan's current fitness anchor, VDOT. */
  anchorVdot: number;
  /** VDOT derived from this race by `vdotFromRace`. */
  raceVdot: number;
  course?: RaceCourseInput | null;
  weather?: RaceWeatherInput | null;
  state?: RaceStateInput | null;
  /** Per-mile splits, for the pacing read. */
  splits?: RaceSplit[] | null;
  /**
   * DOUBLE-COUNTING GUARD. Factors already priced into `finishS` or `raceVdot`
   * by an upstream stage. Named here are SKIPPED — never charged twice.
   *
   * As of 2026-08-17 this is empty in production: `vdotFromRace` reads raw
   * elapsed time. The parameter exists so that if a future stage starts
   * normalising race times to neutral equivalents, the fix is one call-site
   * argument rather than a silent double discount.
   */
  alreadyPricedFor?: ReadonlyArray<RepresentativenessFactor> | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Linear interpolation over an ascending doctrine table. */
function interp(
  x: number,
  table: ReadonlyArray<{ ft: number; acute: number; acclimated: number }>,
  key: 'acute' | 'acclimated',
): number {
  if (x <= table[0].ft) return 0;
  const last = table[table.length - 1];
  if (x >= last.ft) return last[key];
  for (let i = 0; i < table.length - 1; i++) {
    const lo = table[i];
    const hi = table[i + 1];
    if (x >= lo.ft && x <= hi.ft) {
      const t = (x - lo.ft) / (hi.ft - lo.ft);
      return lo[key] + (hi[key] - lo[key]) * t;
    }
  }
  return 0;
}

/**
 * `Research/06` §6 headwind cost, seconds per mile, interpolated on wind speed
 * and on the runner's own pace between doctrine's 6:00 and 8:00 anchors.
 */
function headwindCostSPerMi(windMph: number, pacePerMi: number): number {
  if (!isFinite(windMph) || windMph <= 0) return 0;
  const first = HEADWIND_COST_S_PER_MI[0];
  const last = HEADWIND_COST_S_PER_MI[HEADWIND_COST_S_PER_MI.length - 1];
  const at = (row: { at6: number; at8: number }) => {
    // Doctrine states the cost at 6:00/mi (360s) and 8:00/mi (480s). Slower
    // runners spend longer in the wind, so the cost rises with pace. Clamped
    // rather than extrapolated — beyond the stated anchors doctrine is silent.
    const t = clamp01((pacePerMi - 360) / (480 - 360));
    return row.at6 + (row.at8 - row.at6) * t;
  };
  if (windMph <= first.mph) return at(first) * (windMph / first.mph);
  if (windMph >= last.mph) return at(last);
  for (let i = 0; i < HEADWIND_COST_S_PER_MI.length - 1; i++) {
    const lo = HEADWIND_COST_S_PER_MI[i];
    const hi = HEADWIND_COST_S_PER_MI[i + 1];
    if (windMph >= lo.mph && windMph <= hi.mph) {
      const t = (windMph - lo.mph) / (hi.mph - lo.mph);
      return at(lo) + (at(hi) - at(lo)) * t;
    }
  }
  return 0;
}

/**
 * Coefficient of variation of the per-mile splits, in percent — the dispersion
 * measure `Research/08` §2.2 states its bands in.
 */
export function splitCvPct(splits: RaceSplit[] | null | undefined): number | null {
  const paces = (splits ?? [])
    .map((s) => s.paceSPerMi)
    .filter((p): p is number => p != null && isFinite(p) && p > 0);
  if (paces.length < 3) return null;
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  if (mean <= 0) return null;
  const variance = paces.reduce((a, p) => a + (p - mean) ** 2, 0) / paces.length;
  return (Math.sqrt(variance) / mean) * 100;
}

/**
 * The effort class the race is judged AS.
 *
 * `Research/00b` §"Recovery by Effort" binds effort and taper in one row: an A
 * race is "Maximum, full taper, peak day". An athlete who raced on loaded or
 * overreached legs did not get the taper the row requires, so the class steps
 * down — once, here, rather than as a separate penalty stacked on priority.
 */
export function effectiveEffortClass(
  state: RaceStateInput | null | undefined,
  distanceMi?: number | null,
): {
  cls: RacePriority;
  downgradedBy: 'taper_state' | 'fatigue' | null;
} {
  const declared = String(state?.priority ?? 'A').trim().toUpperCase();
  const base: RacePriority = declared === 'B' || declared === 'C' ? (declared as RacePriority) : 'A';

  const step = (c: RacePriority): RacePriority => (c === 'A' ? 'B' : 'C');

  // OVERREACH is doctrine's deepest fatigue state · a race off it is a hard
  // workout regardless of what the calendar called it.
  if (state?.formBand === 'OVERREACH') return { cls: 'C', downgradedBy: 'fatigue' };
  if ((state?.niggleSeverity ?? 0) >= 5) return { cls: step(base), downgradedBy: 'fatigue' };
  if (state?.formBand === 'LOADED') return { cls: step(base), downgradedBy: 'taper_state' };

  // Measured taper · Research/08 §9.1 via TAPER_RACE_WEEK_PCT_OF_PEAK, the
  // same constant the plan engine tapers to and the doctrine gate already
  // watches (TAPER.depth-per-week). Only consulted when no form band was
  // supplied, so taper is never charged twice.
  const ratio = state?.taperRatio;
  if (state?.formBand == null && ratio != null && isFinite(ratio) && distanceMi != null && distanceMi > 0) {
    const tapered = TAPER_RACE_WEEK_PCT_OF_PEAK[distanceCategoryOf(distanceMi)];
    // Midpoint between a full taper and no taper at all · above it the athlete
    // raced off essentially full training.
    const partial = (tapered + 1) / 2;
    if (ratio > partial) return { cls: 'C', downgradedBy: 'taper_state' };
    if (ratio > tapered) return { cls: step(base), downgradedBy: 'taper_state' };
  }

  return { cls: base, downgradedBy: null };
}

// ── The diagnosis ──────────────────────────────────────────────────────────

/**
 * Diagnose whether a race result deserves authority over the fitness model.
 *
 * Returns a full read even when the race was fine — `authority: 1`, no
 * detractors — so callers never branch on null.
 */
export function assessRepresentativeness(
  input: RepresentativenessInput,
): RepresentativenessRead {
  const skip = new Set<RepresentativenessFactor>(input.alreadyPricedFor ?? []);
  const detractors: RepresentativenessDetractor[] = [];

  const distanceMi = Number(input.distanceMi);
  const finishS = Number(input.finishS);
  const pacePerMi = distanceMi > 0 ? finishS / distanceMi : 0;

  // ── 1 · How far short of the anchor did this race actually run? ──────────
  const predictedS = predictRaceTime(input.anchorVdot, distanceMi);
  const observedShortfallPct =
    predictedS != null && predictedS > 0 && finishS > 0
      ? Math.max(0, (finishS / predictedS - 1) * 100)
      : 0;

  // ── 2 · Price what doctrine can explain ─────────────────────────────────
  const priced = priceConditions({
    input, distanceMi, finishS, pacePerMi, skip, detractorsOut: detractors,
  });

  // Unexplained fraction. With no shortfall to explain there is nothing to
  // discount — the caller's own gate decides whether to act at all.
  const unexplained =
    observedShortfallPct > 0
      ? clamp01(1 - priced.explainedPct / observedShortfallPct)
      : 1;

  // Charge the conditions detractors against the authority they actually cost,
  // rather than against the raw slowdown percentage. A 3% heat penalty inside a
  // 10% shortfall costs 30% of authority, not 3%.
  //
  // Shares are normalised against the SUM OF THE RAW PARTS, not against
  // `explainedPct` — composition is multiplicative and carries a haircut, so
  // the composed total is not the sum of its legs, and dividing by it would
  // leave the reported shares not adding up to the authority actually lost.
  const conditionsCost = 1 - unexplained;
  const rawTotal = detractors.reduce((a, d) => a + d.authorityCost, 0);
  if (conditionsCost > 0 && rawTotal > 0) {
    for (const d of detractors) {
      d.authorityCost = round3((d.authorityCost / rawTotal) * conditionsCost);
    }
  } else {
    for (const d of detractors) d.authorityCost = 0;
  }

  // ── 3 · Effort class · what the race WAS ────────────────────────────────
  const { cls, downgradedBy } = effectiveEffortClass(input.state, distanceMi);
  const classMultiplier = recoveryEffortScale(cls);
  let authority = unexplained * classMultiplier;

  if (classMultiplier < 1 && !skip.has('not_maximal')) {
    const declared = String(input.state?.priority ?? 'A').trim().toUpperCase();
    const factor: RepresentativenessFactor =
      downgradedBy === 'fatigue' ? 'fatigue'
      : downgradedBy === 'taper_state' ? 'taper_state'
      : 'not_maximal';
    const why =
      downgradedBy === 'fatigue'
        ? (input.state?.formBand === 'OVERREACH'
            ? 'raced on overreached legs'
            : `raced carrying a niggle at ${input.state?.niggleSeverity}/10`)
        : downgradedBy === 'taper_state'
          ? 'raced on training legs, no taper'
          : `declared a ${cls} race`;
    detractors.push({
      factor,
      authorityCost: round3(unexplained * (1 - classMultiplier)),
      detail:
        `${why} · Research/00b grades this a ${cls} effort` +
        (downgradedBy && declared !== cls ? ` (declared ${declared})` : '') +
        `, worth ${Math.round(classMultiplier * 100)}% of an A-race performance.`,
    });
  }

  // ── 4 · Premise gate · illness and reported fuelling failure ────────────
  if (input.state?.illness && !skip.has('illness')) {
    detractors.push({
      factor: 'illness',
      authorityCost: round3(authority),
      detail: 'Illness reported across the race window. A race run sick measures the illness, not fitness.',
    });
    authority = 0;
  } else if (input.state?.fuellingFailure && !skip.has('fuelling')) {
    // A reported bonk is a fuelling event, not a fitness reading. Graded at the
    // C-race line rather than zeroed: the athlete still covered the distance.
    const capped = Math.min(authority, UNREPRESENTATIVE_FLOOR);
    if (capped < authority) {
      detractors.push({
        factor: 'fuelling',
        authorityCost: round3(authority - capped),
        detail: 'Fuelling failure reported. The finish records a nutrition problem, not a fitness ceiling.',
      });
      authority = capped;
    }
  }

  authority = clamp01(round3(authority));

  const tier: RepresentativenessRead['tier'] =
    authority >= REPRESENTATIVE_FLOOR ? 'representative'
    : authority >= UNREPRESENTATIVE_FLOOR ? 'compromised'
    : 'unrepresentative';

  return {
    authority,
    tier,
    // Immaterial factors drop out of the report. Illness never does: it is the
    // reason the read is zero, and a zero read with no stated cause is exactly
    // the kind of unexplained suppression this module exists to avoid.
    detractors: detractors.filter((d) => d.authorityCost > 0 || d.factor === 'illness'),
    summary: buildSummary(tier, detractors, observedShortfallPct, priced.explainedPct),
    observedShortfallPct: round3(observedShortfallPct),
    explainedPct: round3(priced.explainedPct),
    effectiveEffortClass: cls,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Price every condition doctrine can put a number on, composed per
 * `Research/06` §10 rather than summed flat.
 *
 * Each detractor's `authorityCost` is TEMPORARILY the factor's slowdown
 * percentage; `assessRepresentativeness` rescales the set into authority once
 * it knows the total. Keeping the raw percentages here is what lets the shares
 * stay proportional to the physics.
 */
function priceConditions(args: {
  input: RepresentativenessInput;
  distanceMi: number;
  finishS: number;
  pacePerMi: number;
  skip: Set<RepresentativenessFactor>;
  detractorsOut: RepresentativenessDetractor[];
}): { explainedPct: number } {
  const { input, distanceMi, finishS, pacePerMi, skip, detractorsOut } = args;
  const tier = abilityTierFromVdot(input.anchorVdot);
  const push = (factor: RepresentativenessFactor, pct: number, detail: string) => {
    if (pct > 0.01) detractorsOut.push({ factor, authorityCost: pct, detail });
  };

  // ── Course elevation · Research/11 via the one shared model ─────────────
  // Gated on Research/02 §13.2's own flat row · under 100 ft is not a hill.
  let coursePct = 0;
  const grossGainFt = Number(input.course?.elevationGainFt ?? 0);
  if (!skip.has('course_elevation') && input.course && finishS > 0 &&
      isFinite(grossGainFt) && grossGainFt >= FLAT_COURSE_GAIN_FT) {
    const sec = courseElevationCostSec({
      distanceMi,
      flatPaceSPerMi: pacePerMi,
      gainFt: input.course.elevationGainFt ?? null,
      netFt: input.course.netElevationFt ?? null,
    });
    if (sec != null && sec > 0) {
      coursePct = (sec / finishS) * 100;
      const gain = input.course.elevationGainFt ?? 0;
      push('course_elevation', coursePct,
        `${Math.round(gain)} ft of climbing over ${distanceMi.toFixed(1)} mi costs about ` +
        `${Math.round(sec)}s at this pace (Research/11 · 3.3% of pace per 1% of grade).`);
    }
  }

  // ── Heat and dewpoint · Research/06 §1, §3, §12 via heat-model ──────────
  // Decomposed into the temperature limb and the moisture limb so the two
  // factors the doctrine names separately are reported separately — but taken
  // from ONE model run, so together they equal exactly what heat-model would
  // return. They are not two independent estimates.
  let heatPct = 0;
  let humidityPct = 0;
  const w = input.weather;
  if (w?.tempF != null && isFinite(Number(w.tempF))) {
    const tempF = Number(w.tempF);
    const effectiveTempF = tempF + solarEffectiveBumpF(w.conditions, w.cloudCoverPct);
    const dewpointF =
      w.dewpointF != null && isFinite(Number(w.dewpointF))
        ? Number(w.dewpointF)
        : (w.humidityPct != null && isFinite(Number(w.humidityPct))
            ? estimateDewpointF(tempF, Number(w.humidityPct))
            : null);
    // Research/06 §11 materiality gate · below it doctrine says do not apply
    // the table at all, so the adjustment is zero rather than a small number.
    const heatMaterial = dewpointF != null
      ? (tempF + dewpointF > HEAT_GATE_SUM_F || dewpointF > HEAT_GATE_DEWPOINT_F)
      : tempF > HEAT_GATE_TAIR_ONLY_F;

    const durationScale = durationHeatScale(finishS);
    const basePct = heatMaterial ? maughanSlowdownPct(effectiveTempF, tier) * durationScale : 0;
    const dpPct = heatMaterial ? dewpointAddPct(dewpointF) * durationScale : 0;

    if (!skip.has('heat')) {
      heatPct = basePct;
      push('heat', heatPct,
        `${Math.round(tempF)}°F` +
        (effectiveTempF !== tempF ? ` (${Math.round(effectiveTempF)}°F with sun)` : '') +
        ` costs about ${basePct.toFixed(1)}% at this distance (Research/06 · Maughan).`);
    }
    if (!skip.has('humidity')) {
      humidityPct = dpPct;
      push('humidity', humidityPct,
        `Dewpoint ${dewpointF != null ? Math.round(dewpointF) : '?'}°F adds about ` +
        `${dpPct.toFixed(1)}% (Research/06 §12 · +1% per 10°F above 60°F).`);
    }
  }

  // ── Wind · Research/06 §6, gated by §11 ("sustained wind > 10 mph") ─────
  let windPct = 0;
  if (!skip.has('wind') && w?.windMph != null && pacePerMi > 0 &&
      Number(w.windMph) > WIND_GATE_MPH) {
    const mph = Number(w.windMph);
    const relation: WindRelation = (w.windRelation ?? 'unknown') as WindRelation;
    const head = headwindCostSPerMi(mph, pacePerMi);
    // A tailwind is not a detractor · it does not excuse a slow race.
    const costSPerMi =
      relation === 'head' ? head
      : relation === 'cross' ? head * CROSSWIND_FRACTION_OF_HEADWIND
      : relation === 'out_and_back' ? head * (1 - OUT_AND_BACK_HEADWIND_RESIDUAL)
      : relation === 'unknown' ? head * (1 - OUT_AND_BACK_HEADWIND_RESIDUAL)
      : 0; // 'tail'
    if (costSPerMi > 0) {
      windPct = (costSPerMi / pacePerMi) * 100;
      push('wind', windPct,
        `${Math.round(mph)} mph ${relation === 'unknown' ? 'wind (net, out-and-back rule)' : relation + 'wind'} ` +
        `costs about ${costSPerMi.toFixed(0)}s/mi (Research/06 §6).`);
    }
  }

  // ── Altitude · Research/06 §7, gated by §11 ("elevation > 3,000 ft") ────
  let altitudePct = 0;
  if (!skip.has('altitude') && input.course?.altitudeFt != null &&
      Number(input.course.altitudeFt) > ALTITUDE_GATE_FT) {
    const ft = Number(input.course.altitudeFt);
    altitudePct = interp(ft, ALTITUDE_SLOWDOWN_PCT,
      input.course.altitudeAcclimatized ? 'acclimated' : 'acute');
    if (altitudePct > 0) {
      push('altitude', altitudePct,
        `${Math.round(ft)} ft of elevation costs about ${altitudePct.toFixed(1)}% ` +
        `${input.course.altitudeAcclimatized ? 'even acclimatized' : 'unacclimatized'} (Research/06 §7).`);
    }
  }

  // ── Pacing · Research/08 §2.2 + Research/02 §13.6 ───────────────────────
  //
  // ANTI-DOUBLE-COUNT (trap C): heat expresses itself as a late-race fade, so
  // the heat already priced is subtracted from the pacing attribution. Without
  // this a hot race is charged once for the temperature and again for the fade
  // the temperature caused.
  let pacingPct = 0;
  if (!skip.has('pacing')) {
    const cv = splitCvPct(input.splits);
    if (cv != null) {
      const ceiling = PACING_CV_CEILING_PCT[tier];
      const excess = Math.max(0, cv - ceiling);
      pacingPct = Math.max(0, excess - (heatPct + humidityPct));
      if (pacingPct > 0) {
        push('pacing', pacingPct,
          `Splits varied ${cv.toFixed(1)}% against ${ceiling}% normal for this standard ` +
          `(Research/08 §2.2) · about ${pacingPct.toFixed(1)}% lost to how it was run.`);
      }
    }
  }

  return {
    explainedPct: composeSlowdown({
      course: coursePct,
      heat: heatPct,
      humidity: humidityPct,
      wind: windPct,
      altitude: altitudePct,
      pacing: pacingPct,
    }),
  };
}

/**
 * THE single place slowdown percentages stack in this file.
 *
 * `Research/01` §"Combined conditions": "Add adjustments multiplicatively, not
 * additively · final_pace = base_pace × (1 + heat_adj) × (1 + altitude_adj) ×
 * hill_factor × (1 + wind_adj)". Same rule
 * `lib/terrain/grade-adjust.ts#composeEffortFactor` enforces for heat×grade;
 * this composes six factors rather than two, so it applies the rule directly.
 *
 * Then the one stated exception. `Research/06` §10: "Heat and altitude slightly
 * compound (not strictly additive); when both >5%, reduce expected gains by
 * ~10%". The multiplicative product over-reads that specific pair, so
 * doctrine's own haircut is applied to it.
 *
 * Exported for the doctrine gate, which checks both behaviours against the
 * cited passages rather than against a hardcoded expectation.
 */
export function composeSlowdown(parts: {
  course?: number; heat?: number; humidity?: number;
  wind?: number; altitude?: number; pacing?: number;
}): number {
  const legs = [
    parts.course ?? 0, parts.heat ?? 0, parts.humidity ?? 0,
    parts.wind ?? 0, parts.altitude ?? 0, parts.pacing ?? 0,
  ].map((p) => (isFinite(p) && p > 0 ? p : 0));

  const factor = legs.reduce((acc, p) => acc * (1 + p / 100), 1);
  let pct = (factor - 1) * 100;

  const heatTotal = (parts.heat ?? 0) + (parts.humidity ?? 0);
  const altitude = parts.altitude ?? 0;
  if (heatTotal > HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT &&
      altitude > HEAT_ALTITUDE_COMPOUND_THRESHOLD_PCT) {
    pct -= (heatTotal + altitude) * HEAT_ALTITUDE_COMPOUND_HAIRCUT;
  }

  return Math.max(0, pct);
}

/**
 * One line, coach voice · short, direct, no hype, no em dashes
 * (Design/running-app-design-brief-v2.md §tone).
 */
function buildSummary(
  tier: RepresentativenessRead['tier'],
  detractors: RepresentativenessDetractor[],
  observedShortfallPct: number,
  explainedPct: number,
): string {
  const live = detractors
    .filter((d) => d.authorityCost > 0)
    .sort((a, b) => b.authorityCost - a.authorityCost);
  const named = live.slice(0, 3).map((d) => FACTOR_WORD[d.factor]);
  const verb = named.length > 1 ? 'account' : 'accounts';

  if (named.length === 0) {
    return observedShortfallPct > 0
      ? 'Clean race, clean conditions. This is a real reading of current fitness.'
      : 'Race conditions were normal. Nothing here argues with the result.';
  }

  // Did the conditions do the work, or was it what the race WAS?
  const conditionsLed = explainedPct > 0.5 && observedShortfallPct > 0;

  if (tier === 'representative') {
    return `Mostly a clean race. ${cap(list(named))} took a little off it, ` +
      'but the result still stands as fitness.';
  }

  if (tier === 'compromised') {
    return conditionsLed
      ? `${cap(list(named))} ${verb} for about ${Math.round(explainedPct)}% of a ` +
        `${Math.round(observedShortfallPct)}% shortfall. The result moves fitness, but not by much.`
      : `${cap(list(named))} ${verb} for most of this. The result moves fitness, but not by much.`;
  }

  return conditionsLed
    ? `${cap(list(named))} ${verb} for this. Fitness stays where it was. ` +
      'One noisy race does not rewrite the model.'
    : `${cap(list(named))} ${verb} for this. Fitness stays where it was until a real race says otherwise.`;
}

const FACTOR_WORD: Record<RepresentativenessFactor, string> = {
  course_elevation: 'the climbing',
  heat: 'the heat',
  humidity: 'the humidity',
  wind: 'the wind',
  altitude: 'the altitude',
  pacing: 'how it was paced',
  taper_state: 'racing without a taper',
  fatigue: 'racing on tired legs',
  illness: 'illness',
  not_maximal: 'this not being a goal race',
  fuelling: 'the fuelling',
};

function list(words: string[]): string {
  if (words.length === 0) return 'nothing measurable';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Scale a downward re-anchor by how much authority the evidence earned.
 *
 * At full authority the new anchor is the race's own VDOT — exactly today's
 * behaviour. At partial authority the anchor moves part of the way. Below the
 * unrepresentative floor it does not move at all, and the caller should record
 * a confidence reduction instead of a fitness change (rule 8: "reduce
 * confidence, smaller adjustment").
 */
export function authorityScaledVdot(
  anchorVdot: number,
  raceVdot: number,
  authority: number,
): number | null {
  if (!isFinite(anchorVdot) || !isFinite(raceVdot)) return null;
  if (!isFinite(authority) || authority < UNREPRESENTATIVE_FLOOR) return null;
  const a = clamp01(authority);
  return Math.round((anchorVdot + (raceVdot - anchorVdot) * a) * 100) / 100;
}
