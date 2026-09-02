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
 * ── BOTH DIRECTIONS (2026-08-17, round 2) ────────────────────────────────
 *
 * This module shipped gating only the DOWNWARD re-anchor, because downward is
 * where the bug had been observed. `detectPrBank` — the upward mirror, which
 * auto-applies `recompute_paces` and rewrites every future unsealed pace target
 * — had no gate at all. That is the more dangerous half: an over-read of
 * fitness prescribes work the runner cannot absorb, where an under-read only
 * prescribes work that is too easy.
 *
 * Rule 8 does not say "downward". It says a race must be DIAGNOSED before it
 * moves the fitness model, and the reasons it lists are symmetric facts about a
 * race day. A net-downhill point-to-point, a dead-aft wind, a course short of
 * its nominal distance, or a watch time nobody has confirmed all produce the
 * same observation — "the runner ran faster than the anchor predicted" —
 * without the runner having got fitter. **A race that was aided is no more a
 * fitness reading than a race that was sabotaged.**
 *
 * So `assessRepresentativeness` now carries a `direction`:
 *
 *   downward · the race under-ran the anchor. Doctrine prices what SLOWED it
 *              (heat, hills, wind, altitude, pacing) and grades what the race
 *              WAS (effort class, illness, fuelling).
 *   upward   · the race over-ran the anchor. Doctrine prices what HELPED it
 *              (net descent, tailwind) and gates on whether the result is a
 *              confirmed measurement at all.
 *
 * The two limbs deliberately do NOT share their factor sets, because most
 * factors are not sign-symmetric — see `priceAids` and the effort-class note in
 * `assessRepresentativeness` for the per-factor reasoning. What IS shared is
 * the shape: residual authority, multiplicative composition, a premise gate,
 * and `authorityScaledVdot` moving the anchor part of the way.
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
  maughanSlowdownPctForVdot,
  solarEffectiveBumpF,
  durationHeatScale,
  type AbilityTier,
} from '@/lib/training/heat-model';
import { courseElevationCostSec } from '@/lib/training/elevation-model';
import { REPRESENTATIVE_FLOOR, UNREPRESENTATIVE_FLOOR } from './effort-authority';
import {
  recoveryEffortScale,
  TAPER_RACE_WEEK_PCT_OF_PEAK,
  distanceCategoryOf,
  type RacePriority,
} from '@/lib/plan/goal-tiers';
import type { TrainingFormLabel } from '@/lib/coach/training-form';

// ── Factors ────────────────────────────────────────────────────────────────

export type RepresentativenessFactor =
  | 'course_elevation' | 'heat' | 'humidity' | 'wind' | 'altitude'
  | 'pacing' | 'taper_state' | 'fatigue' | 'illness' | 'not_maximal' | 'fuelling'
  // ── aid factors · only ever charged on an UPWARD read ───────────────────
  | 'net_downhill' | 'tailwind' | 'unconfirmed_result';

/**
 * Which way the race moved against the anchor, and therefore which set of
 * facts is capable of explaining it away.
 *
 *   'downward' · the race ran SLOWER than the anchor predicted.
 *   'upward'   · the race ran FASTER than the anchor predicted.
 *
 * Callers may state it; `assessRepresentativeness` otherwise infers it from
 * `raceVdot` against `anchorVdot`, which is the same comparison by a monotonic
 * transform of the same two numbers.
 */
export type RepresentativenessDirection = 'downward' | 'upward';

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
  /** Which limb of the model ran. */
  direction: RepresentativenessDirection;
  /** Each factor that reduced authority, with how much and why. */
  detractors: RepresentativenessDetractor[];
  /** One plain-language line for the coach voice. */
  summary: string;
  /**
   * How short of the anchor's prediction the race actually ran, in percent of
   * predicted time. 0 when the race met or beat the prediction, and always 0 on
   * an upward read (see `observedSurplusPct`).
   */
  observedShortfallPct: number;
  /**
   * How far INSIDE the anchor's prediction the race ran, in percent of
   * predicted time. The upward mirror of `observedShortfallPct`, and 0 on a
   * downward read. Two fields rather than one signed one: every consumer of a
   * shortfall wants it non-negative, and a sign flip in a percentage is exactly
   * the kind of quiet error this module exists to stop.
   */
  observedSurplusPct: number;
  /**
   * How much of that deviation doctrine prices to conditions and execution
   * (downward) or to course and conditions aid (upward).
   */
  explainedPct: number;
  /**
   * The effort class the race is judged AS, after taper and fatigue downgrades.
   * Not necessarily the priority the athlete declared. Reported on both limbs;
   * only CHARGED on the downward one — see `assessRepresentativeness`.
   */
  effectiveEffortClass: RacePriority;
}

// ── Doctrine-derived constants ─────────────────────────────────────────────

/**
 * The two doctrine tier floors — `Research/00b` §"Recovery by Effort (A vs. B
 * vs. C Race)"'s B and C rows.
 *
 * 2026-08-17 · MOVED, NOT CHANGED. They now live in `./effort-authority.ts`
 * and are re-exported here so every existing importer is untouched and there is
 * exactly one definition of each. The move exists because SELECTION
 * (`lib/training/vdot.ts#bestRecentVdot`) needs the same floors, and this file
 * imports `predictRaceTime` from that one — a direct import back would close a
 * cycle through the hottest file in the fitness model. `effort-authority.ts` is
 * a leaf: it imports only `lib/plan/goal-tiers.ts`, which imports nothing.
 *
 * See that file for what the anchor-free half of rule 8 can and cannot charge.
 */
export { REPRESENTATIVE_FLOOR, UNREPRESENTATIVE_FLOOR } from './effort-authority';

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
 *
 * The same threshold gates the AID side, and the table supports that directly:
 * its key column is "Net elevation gain", so a course whose net DROP clears the
 * flat row is, by doctrine's own measure, not a flat course either. The
 * magnitude of the help is not a mirror of the cost — the doc's own rule of
 * thumb says "downhills do not symmetrically refund the cost", which is the
 * asymmetry the engine encodes once as `DESCENT_GIVEBACK_FRACTION`
 * — but the question "is this course flat" has one answer for both directions.
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
 * `Research/06` §6, the SAME table's "Tailwind benefit" columns. Doctrine
 * publishes both limbs of the wind effect and states the asymmetry in words
 * directly above it — "a headwind costs roughly 2× what an equal tailwind gives
 * back" — so the aid side is a transcription, not an inversion of the cost
 * side. Magnitudes here; the doc writes them negative because it states them as
 * a change to finish time.
 *
 * Only reachable on an UPWARD read, and only when the caller can actually say
 * the wind was behind the runner. `representativeness-inputs.ts` reports
 * `windRelation: 'unknown'`, which doctrine's own out-and-back rule resolves to
 * a NET LOSS — so an unknown wind is never scored as help.
 */
export const TAILWIND_BENEFIT_S_PER_MI: ReadonlyArray<{ mph: number; at6: number; at8: number }> = [
  { mph: 5,  at6: 1.5, at8: 2  },
  { mph: 10, at6: 6,   at8: 9  },
  { mph: 15, at6: 12,  at8: 17 },
  { mph: 20, at6: 20,  at8: 28 },
  { mph: 25, at6: 30,  at8: 42 },
  { mph: 30, at6: 42,  at8: 58 },
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
  /**
   * `races.actual_result.provisional` — true when the finish time was adopted
   * from a matched watch/Strava run by `lib/race/auto-result.ts` and the runner
   * has not yet confirmed or corrected it.
   *
   * `Research/15` §"Coaching implications": "**Race PRs** measured by GPS
   * distance can over- or under-report by 1-3% on technical courses; the
   * official chip time over the certified course is canonical." An unconfirmed
   * watch time is not that. Two known error sources, both unpriceable:
   *
   *   · TIME · the patch reads a moving/elapsed time off the runner's own
   *     watch. Auto-pause and a stopped clock at aid stations make moving time
   *     read faster than the chip. (`auto-result.ts` now prefers ELAPSED for
   *     exactly this reason, which removes the systematic part; what is left is
   *     the part nobody can size.)
   *   · IDENTITY · the run was matched to the race by date ±1 day and distance
   *     ±12%. Almost always right, and when it is wrong the finish time belongs
   *     to a different effort entirely. There is no percentage that expresses
   *     "this might be the wrong run".
   *
   * PREMISE GATE, UPWARD ONLY. See `assessRepresentativeness` for why the same
   * flag is deliberately inert on the downward limb.
   */
  resultProvisional?: boolean | null;
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
  /**
   * Which limb to run. Omit and it is inferred from `raceVdot` against
   * `anchorVdot`; state it when the caller already knows (both production
   * callers do — one only ever asks about a slower race, the other only about
   * a faster one).
   */
  direction?: RepresentativenessDirection | null;
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
 * `Research/06` §6 wind effect, seconds per mile, interpolated on wind speed
 * and on the runner's own pace between doctrine's 6:00 and 8:00 anchors.
 *
 * One walker over either limb of the doc's single table. The head and tail
 * columns are separate transcriptions with the asymmetry doctrine states baked
 * into their own numbers, so the tail limb is NEVER derived from the head one.
 */
function windEffectSPerMi(
  table: ReadonlyArray<{ mph: number; at6: number; at8: number }>,
  windMph: number,
  pacePerMi: number,
): number {
  if (!isFinite(windMph) || windMph <= 0) return 0;
  const first = table[0];
  const last = table[table.length - 1];
  const at = (row: { at6: number; at8: number }) => {
    // Doctrine states the effect at 6:00/mi (360s) and 8:00/mi (480s). Slower
    // runners spend longer in the wind, so it rises with pace. Clamped
    // rather than extrapolated — beyond the stated anchors doctrine is silent.
    const t = clamp01((pacePerMi - 360) / (480 - 360));
    return row.at6 + (row.at8 - row.at6) * t;
  };
  if (windMph <= first.mph) return at(first) * (windMph / first.mph);
  if (windMph >= last.mph) return at(last);
  for (let i = 0; i < table.length - 1; i++) {
    const lo = table[i];
    const hi = table[i + 1];
    if (windMph >= lo.mph && windMph <= hi.mph) {
      const t = (windMph - lo.mph) / (hi.mph - lo.mph);
      return at(lo) + (at(hi) - at(lo)) * t;
    }
  }
  return 0;
}

const headwindCostSPerMi = (windMph: number, pacePerMi: number): number =>
  windEffectSPerMi(HEADWIND_COST_S_PER_MI, windMph, pacePerMi);

const tailwindBenefitSPerMi = (windMph: number, pacePerMi: number): number =>
  windEffectSPerMi(TAILWIND_BENEFIT_S_PER_MI, windMph, pacePerMi);

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

  const direction: RepresentativenessDirection =
    input.direction ?? (Number(input.raceVdot) > Number(input.anchorVdot) ? 'upward' : 'downward');

  // ── 1 · How far off the anchor's prediction did this race actually run? ──
  const predictedS = predictRaceTime(input.anchorVdot, distanceMi);
  const measurable = predictedS != null && predictedS > 0 && finishS > 0;
  const observedShortfallPct =
    measurable && direction === 'downward'
      ? Math.max(0, (finishS / predictedS! - 1) * 100)
      : 0;
  const observedSurplusPct =
    measurable && direction === 'upward'
      ? Math.max(0, (1 - finishS / predictedS!) * 100)
      : 0;
  const observedDeviationPct = direction === 'upward' ? observedSurplusPct : observedShortfallPct;

  // ── 2 · Price what doctrine can explain ─────────────────────────────────
  //
  // Different limbs, different facts. Slowness is explained by what made the
  // day hard; speed is explained by what made it easy. Running the downward
  // factor set against a fast race would price a hot, hilly race as LESS
  // credible when it came in FASTER than the anchor, which is nonsense —
  // adversity that failed to slow the runner is evidence FOR the result.
  const priced = direction === 'upward'
    ? priceAids({ input, distanceMi, finishS, pacePerMi, skip, detractorsOut: detractors })
    : priceConditions({ input, distanceMi, finishS, pacePerMi, skip, detractorsOut: detractors });

  // Unexplained fraction. With no deviation to explain there is nothing to
  // discount — the caller's own gate decides whether to act at all.
  const unexplained =
    observedDeviationPct > 0
      ? clamp01(1 - priced.explainedPct / observedDeviationPct)
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
  //
  // DOWNWARD ONLY, and this is the one place the two limbs are asymmetric by
  // design rather than by omission. `Research/00b`'s effort table grades how
  // COMPLETE an effort was, which is what licenses excusing a slow time: a
  // parkrun jogged off full training legs is "treat like a hard workout", so it
  // does not get to prove the runner slow.
  //
  // The same fact does not excuse a FAST time. An athlete who ran a personal
  // best without a taper, off a training week, in a race they called a B, has
  // demonstrated the performance and then some — `Research/01`'s recalibrate
  // row says "new race result → update VDOT from race" with no clause about
  // how well rested they were. Charging the effort class upward would mean the
  // engine believed a good result LESS the harder the circumstances were, which
  // inverts the evidence.
  const { cls, downgradedBy } = effectiveEffortClass(input.state, distanceMi);
  const classMultiplier = direction === 'upward' ? 1 : recoveryEffortScale(cls);
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

  // ── 4 · Premise gate ────────────────────────────────────────────────────
  //
  // UPWARD · the result has to be a measurement before it can be a fast one.
  // A provisional finish is a watch time for a run the engine MATCHED to the
  // race; nobody has confirmed it is the race, and `Research/15` says the chip
  // time over the certified course is the canonical one. Zeroed rather than
  // discounted, for the same reason illness is: there is no magnitude to tune,
  // so none is invented.
  //
  // Deliberately INERT on the downward limb, and the asymmetry is principled
  // rather than convenient. Both residual errors in a provisional time push the
  // reading FASTER than truth — a moving-time under-read, and a mis-matched run
  // that on a race weekend is overwhelmingly a shakeout or a warm-up. So a
  // provisional result that still reads 1.5 VDOT BELOW the anchor is under-
  // stating how far fitness fell: acting on it is conservative. Acting on the
  // same row upward is acting on the error itself.
  if (direction === 'upward' && input.state?.resultProvisional && !skip.has('unconfirmed_result')) {
    detractors.push({
      factor: 'unconfirmed_result',
      authorityCost: round3(authority),
      detail:
        'Finish time was adopted from a matched watch run and has not been confirmed. ' +
        'Research/15 · the chip time over the certified course is the canonical one.',
    });
    authority = 0;
  } else if (input.state?.illness && !skip.has('illness')) {
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
    direction,
    // Immaterial factors drop out of the report. The premise gates never do:
    // they are the reason the read is zero, and a zero read with no stated
    // cause is exactly the kind of unexplained suppression this module exists
    // to avoid.
    detractors: detractors.filter(
      (d) => d.authorityCost > 0 || d.factor === 'illness' || d.factor === 'unconfirmed_result',
    ),
    summary: buildSummary(direction, tier, detractors, observedDeviationPct, priced.explainedPct),
    observedShortfallPct: round3(observedShortfallPct),
    observedSurplusPct: round3(observedSurplusPct),
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
    // Rule 9 · the ability axis is interpolated off the anchor VDOT rather than
    // stepped at 45 and 60 · see maughanSlowdownPctForVdot.
    const basePct = heatMaterial
      ? maughanSlowdownPctForVdot(effectiveTempF, input.anchorVdot) * durationScale
      : 0;
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
 * The UPWARD mirror of `priceConditions` · price every way the day could have
 * handed the runner time they did not earn.
 *
 * Same contract: each detractor's `authorityCost` is TEMPORARILY the factor's
 * percentage of finish time, and `assessRepresentativeness` rescales the set
 * into authority once it knows the total.
 *
 * ── Why this is a short list, factor by factor ────────────────────────────
 *
 * The downward limb prices six things. Only two of them have an aid limb that
 * doctrine actually supports, and inventing the other four is precisely the
 * failure this module was built to stop — a small unjustified number applied to
 * every clean result is as wrong as no number applied to a compromised one.
 *
 *   · COURSE ELEVATION → yes. `courseElevationCostSec` is already SIGNED and
 *     already carries `Research/11`'s asymmetric giveback, so a net-downhill
 *     course returns negative seconds with no new model. This is the factor
 *     that matters in practice: a point-to-point that drops several hundred
 *     feet is the classic PR course.
 *   · WIND → yes, when the caller can say the wind was behind them.
 *     `Research/06` §6 publishes a "Tailwind benefit" column beside the
 *     headwind one. Note the gate: an UNKNOWN wind resolves to doctrine's
 *     out-and-back rule, which is a net LOSS, so it never scores as help.
 *   · HEAT / HUMIDITY → no. The Maughan table bottoms out at 0% ("50°F and
 *     below is 0% for every tier"). Doctrine describes cool as the absence of a
 *     penalty, never as a bonus, and there is no row to read for one.
 *   · ALTITUDE → no. `Research/06` §7 tabulates the cost of racing AT altitude
 *     against a sea-level baseline. Sea level IS the baseline; racing at it is
 *     not a tailwind. (An altitude-resident racing low is a real effect, but it
 *     needs residency data this app does not hold, and it is not in the cited
 *     table.)
 *   · PACING → no. Even splits are how a race is supposed to be run.
 *     `Research/08` §2.2 gives a band of NORMAL dispersion and charges only the
 *     excess above it; there is no credit below it, and treating good pacing as
 *     an artifact would discount exactly the races worth believing.
 *
 * ── The one this list does NOT cover, and why ────────────────────────────
 *
 * A SHORT OR UNCERTIFIED COURSE. This is a real way to over-read a race, and
 * `Research/15` gives the band ("GPS distance can over- or under-report by
 * 1-3%"). It is not priced here because the input does not exist: `raceVdot` is
 * derived from the race's NOMINAL `meta.distanceMi`, never from the watch's
 * measured distance, so a GPS over-measure cannot leak into the VDOT in the
 * first place, and nothing in the schema records whether a course was
 * certified. A genuinely short course would need a certification field on
 * `races.meta` to diagnose. Named here so the gap is a work item rather than an
 * oversight.
 */
function priceAids(args: {
  input: RepresentativenessInput;
  distanceMi: number;
  finishS: number;
  pacePerMi: number;
  skip: Set<RepresentativenessFactor>;
  detractorsOut: RepresentativenessDetractor[];
}): { explainedPct: number } {
  const { input, distanceMi, finishS, pacePerMi, skip, detractorsOut } = args;
  const push = (factor: RepresentativenessFactor, pct: number, detail: string) => {
    if (pct > 0.01) detractorsOut.push({ factor, authorityCost: pct, detail });
  };

  // ── Net descent · Research/11 via the one shared model ──────────────────
  // Gated on Research/02 §13.2's own flat row, read on the column the table is
  // keyed by ("Net elevation gain") — a net drop under 100 ft is a flat course.
  let descentPct = 0;
  const netFt = Number(input.course?.netElevationFt ?? NaN);
  if (!skip.has('net_downhill') && input.course && finishS > 0 &&
      isFinite(netFt) && netFt <= -FLAT_COURSE_GAIN_FT) {
    const sec = courseElevationCostSec({
      distanceMi,
      flatPaceSPerMi: pacePerMi,
      gainFt: input.course.elevationGainFt ?? null,
      netFt,
    });
    // Negative seconds = the course gave back more than it took. A course that
    // drops 400 ft but climbs 2000 to do it is still a hard course, and this
    // correctly prices it at zero help.
    if (sec != null && sec < 0) {
      descentPct = (-sec / finishS) * 100;
      push('net_downhill', descentPct,
        `${Math.round(-netFt)} ft of net descent over ${distanceMi.toFixed(1)} mi is worth about ` +
        `${Math.round(-sec)}s at this pace (Research/11 · a descent hands back half what the ` +
        'matching climb costs).');
    }
  }

  // ── Tailwind · Research/06 §6, gated by §11 ("sustained wind > 10 mph") ──
  let tailPct = 0;
  const w = input.weather;
  if (!skip.has('tailwind') && w?.windMph != null && pacePerMi > 0 &&
      Number(w.windMph) > WIND_GATE_MPH && w.windRelation === 'tail') {
    const mph = Number(w.windMph);
    const benefit = tailwindBenefitSPerMi(mph, pacePerMi);
    if (benefit > 0) {
      tailPct = (benefit / pacePerMi) * 100;
      push('tailwind', tailPct,
        `${Math.round(mph)} mph tailwind is worth about ${benefit.toFixed(0)}s/mi ` +
        '(Research/06 §6 · a tailwind gives back about half what the same headwind costs).');
    }
  }

  // Same composition rule as the downward limb — one function, so the two
  // directions can never drift into different stacking arithmetic.
  return { explainedPct: composeSlowdown({ course: descentPct, wind: tailPct }) };
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
  direction: RepresentativenessDirection,
  tier: RepresentativenessRead['tier'],
  detractors: RepresentativenessDetractor[],
  observedDeviationPct: number,
  explainedPct: number,
): string {
  const live = detractors
    .filter((d) => d.authorityCost > 0)
    .sort((a, b) => b.authorityCost - a.authorityCost);
  const named = live.slice(0, 3).map((d) => FACTOR_WORD[d.factor]);
  const verb = named.length > 1 ? 'account' : 'accounts';

  if (direction === 'upward') {
    if (detractors.some((d) => d.factor === 'unconfirmed_result')) {
      return 'Watch time, not a confirmed result. Confirm the finish and the paces move with it.';
    }
    if (named.length === 0) {
      return 'Nothing about the day explains this. That is a real step up in fitness.';
    }
    if (tier === 'representative') {
      return `${cap(list(named))} helped a little. Most of this is fitness, and the paces move.`;
    }
    if (tier === 'compromised') {
      return `${cap(list(named))} ${verb} for about ${Math.round(explainedPct)}% of a ` +
        `${Math.round(observedDeviationPct)}% margin. Some of it is fitness, so the paces move part of the way.`;
    }
    return `${cap(list(named))} ${verb} for this. The time stands as a result, ` +
      'but it is not a new fitness number.';
  }

  if (named.length === 0) {
    return observedDeviationPct > 0
      ? 'Clean race, clean conditions. This is a real reading of current fitness.'
      : 'Race conditions were normal. Nothing here argues with the result.';
  }

  // Did the conditions do the work, or was it what the race WAS?
  const conditionsLed = explainedPct > 0.5 && observedDeviationPct > 0;

  if (tier === 'representative') {
    return `Mostly a clean race. ${cap(list(named))} took a little off it, ` +
      'but the result still stands as fitness.';
  }

  if (tier === 'compromised') {
    return conditionsLed
      ? `${cap(list(named))} ${verb} for about ${Math.round(explainedPct)}% of a ` +
        `${Math.round(observedDeviationPct)}% shortfall. The result moves fitness, but not by much.`
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
  net_downhill: 'the net descent',
  tailwind: 'the tailwind',
  unconfirmed_result: 'the result not being confirmed',
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
 * Scale a re-anchor by how much authority the evidence earned. DIRECTION-FREE:
 * it interpolates from the anchor toward the race, so it serves the upward and
 * downward limbs identically and neither can drift from the other.
 *
 * At full authority the new anchor is the race's own VDOT — exactly the
 * behaviour before any of this existed. At partial authority the anchor moves
 * part of the way. Below the unrepresentative floor it does not move at all,
 * and the caller should record a confidence reduction instead of a fitness
 * change (rule 8: "reduce confidence, smaller adjustment").
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
