/**
 * lib/training/durability-anchor.ts · HOW WELL DOES THIS RUNNER'S FITNESS
 * HOLD UP OVER MARATHON-LENGTH EFFORT, NOT JUST HALF-MARATHON-LENGTH ONE?
 *
 * Part of the fitness-vector rebuild the owner ordered 2026-08-30/31, away
 * from a single VDOT scalar toward a set of independent anchors, each with
 * its own confidence and decay. This file is the DURABILITY anchor and
 * nothing else — it does not touch VDOT, pace selection, or plan
 * composition. See the module-boundary note near the bottom for exactly
 * what is deliberately NOT wired here yet.
 *
 * ── The concrete question this answers ──────────────────────────────────
 *
 * Every generic race-equivalence formula in this app (Riegel via
 * `Research/02` §2, and the VDOT tables downstream of it) assumes a
 * population-average "fatigue exponent" of 1.06: `T2 = T1 · (D2/D1)^1.06`.
 * That number is a CROSS-SPORT MEAN Riegel fit from world records (§2.2);
 * it says nothing about any one runner's own aerobic durability, and
 * `Research/02` §2.3 states plainly that it is not reliable for everyone:
 * Vickers & Vertosick (2016), cited in that section, found Riegel
 * "dramatically underestimates marathon time... for half of runners" when
 * extrapolating from a half marathon.
 *
 * This runner's own races put him on the slow side of that population
 * assumption. Measured 2026-08-31 against his real `races` rows (see the
 * `.audit.test.ts` sibling of this file for the live numbers): his races
 * fit closer to exponent ~1.10 than to 1.06, which means a marathon
 * prediction built off his half-marathon fitness using the population
 * formula runs OPTIMISTIC — it promises a faster marathon than his own
 * history says he can hold. Two independent kinds of evidence bear on this:
 *
 *   1. RACE EXPONENT · his own fitted Riegel exponent from his race history,
 *      shrunk toward the population default in proportion to how much
 *      evidence backs the personal fit (`fitRaceExponent`).
 *   2. DECOUPLING · how much his heart rate drifts relative to pace across
 *      the second half of his long runs, corroborated over multiple
 *      qualifying runs (`aggregateDecoupling`).
 *
 * Both are read fresh from source data on every call (Rule 10) — nothing
 * here is persisted, and there is no new table or column.
 *
 * ── Why this file does not export a generic `{value, confidence,
 *    observed_at, half_life, provenance}` Anchor type ─────────────────────
 *
 * That was the shape floated for the fitness-vector rebuild in general. Two
 * things were checked before departing from it:
 *
 *   · Whether a sibling reader already IN FLIGHT tonight
 *     (`lib/training/pace-corpus.ts`'s `resolveEasyPaceCorpus` /
 *     `resolveThresholdPaceCorpus`, and `lib/training/vdot-corpus.ts`'s
 *     `corroboratedCorpusVdot`) had already established that generic shape
 *     for its own anchors, in which case this file should match it. It has
 *     not: every one of those readers returns a discriminated union —
 *     `{ok:true, ...fields, supporting}` vs `{ok:false, reason,
 *     observations}` — not a `{value, confidence}` pair, and none of them
 *     carries `observed_at`/`half_life`/`provenance` as named fields. That
 *     shape is this codebase's actual established convention for a fresh,
 *     computed-at-read-time evidence reader, and it is Rule 11 enforced BY
 *     THE TYPE SYSTEM: the refusal branch carries no value field at all, so
 *     `read.value` does not compile until the caller has branched. A bare
 *     `{value, confidence: 0}` cannot express "I don't know" as a fact
 *     distinct from "I measured a weak signal" — exactly the collapse Rule
 *     11 exists to forbid. So the shape below follows THAT convention
 *     (`RaceExponentRead`, `DecouplingRead`, each `ok:true | ok:false`)
 *     rather than the generic scaffold.
 *
 *   · Whether the two inputs the owner's own instructions described as "two
 *     inputs to one anchor" collapse honestly into one scalar. They do not:
 *     a Riegel exponent (dimensionless, centred near 1.0-1.2) and a
 *     decoupling coefficient (a drift percentage, centred near 0-15) are
 *     different units answering different questions from different
 *     evidence (races vs. training splits) on different corroboration
 *     rules. Forcing them into one number would either need an invented
 *     weighting nothing grounds, or would silently let one input's data
 *     availability set the whole anchor's confidence (e.g. a runner with no
 *     long-run splits history but a great race history reading as
 *     "unknown durability", when race evidence alone is real evidence).
 *     `DurabilityAnchor` below carries both as separate named sub-reads,
 *     each independently confident-or-refused, and leaves any collapse
 *     into a single number to whichever consumer actually needs one (Phase
 *     3 wiring, not this file).
 *
 * Both sub-reads DO carry a `value`/`confidence` pair on their `ok:true`
 * branch, in the shape the owner's own instructions named — that part of
 * the ask is honoured exactly; only the outer envelope departs from the
 * generic scaffold, and this comment states why.
 *
 * ── Units ──────────────────────────────────────────────────────────────
 *
 * The design brief offered velocity in m/s "or an equivalent pace
 * representation, matching what the pace-evidence-reader work already
 * established." `pace-corpus.ts` and `vdot-corpus.ts` both key everything
 * on `paceSecPerMi` (seconds per mile) — never m/s — so race finish times
 * here are read and reasoned about in seconds and miles throughout, for the
 * same reason: it is the unit every existing race/run reader in this
 * codebase already speaks, and introducing m/s would mean every consumer
 * doing a conversion this file could have done once.
 *
 * ── Rule 8 · this file does not filter for taper or recovery ─────────────
 *
 * Rule 8's corollary splits readers by the question they ask: HABIT
 * ("what does this runner normally do") is filtered; CAPABILITY / TISSUE
 * RESPONSE ("what has this runner's aerobic system actually done under
 * sustained load") is not. Both sub-reads here are capability questions —
 * a race result is a discrete graded event, not a rolling habit window, and
 * `computeDecouplingTrend` (the sibling this file's decoupling read reuses
 * the per-run math from) has never filtered for taper/race-week either; it
 * filters for workout TYPE (quality days) and for HEAT, both real
 * contaminants of the specific physiological signal being read, not for
 * "was this a normal week." Reused here rather than re-derived (see
 * "DECOUPLING · reused machinery" below).
 *
 * ── Decay moves CONFIDENCE, never `value` (course-corrected 2026-08-31) ───
 *
 * The first pass of this file blended staleness straight into the number a
 * caller would spend: `value = confidence * rawFit + (1-confidence) *
 * prior`, with `confidence` itself carrying a clock-driven recency term. That
 * meant a personal exponent fitted from five clean races would drift back
 * toward the population prior on ELAPSED CALENDAR TIME ALONE, with no new
 * evidence at all — exactly the collapse Rule 8 and Rule 11 both exist to
 * forbid elsewhere in this codebase, applied here to a THIRD fact nothing
 * upstream had named: "we haven't recently reconfirmed this" is not the same
 * claim as "the runner got less durable," and a reader that cannot tell them
 * apart reports the first as if it were the second.
 *
 * Fixed by splitting the single confidence number into two, in both
 * sub-reads:
 *
 *   · an EVIDENCE score — count, distance spread, evidence QUALITY
 *     (`lib/race/effort-authority.ts` grading for races; run-to-run
 *     consistency for decoupling) — computed ENTIRELY from the evidence
 *     itself, with no clock term. This is the only thing `value` blends on.
 *   · a FRESHNESS score — how long since the evidence was last refreshed,
 *     decaying on `DURABILITY_HALF_LIFE_DAYS`.
 *
 * The reported `confidence` blends both (so a stale-but-strong read is
 * honestly flagged as less trustworthy right now), but `value` blends ONLY
 * on the evidence score. A runner who races once in March and never again
 * keeps his March-fitted exponent as `value` in August — appropriately LESS
 * confident about it, never a different number. The estimate moves only when
 * new evidence arrives: a new race, a new pattern of decoupling readings, a
 * named interruption. Never as a function of the calendar alone.
 */

import { pool } from '@/lib/db/pool';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { parseRaceTime, predictRaceTime } from '@/lib/training/vdot';
import { assessRaceRepresentativeness } from '@/lib/race/representativeness-inputs';
import { splitsWithHrAndPace, DECOUPLING_SPLIT_SHAPES } from '@/lib/runs/run-shape';
import { roundTo } from '@/lib/format/run';
import { applyHeatToPace } from '@/lib/weather/heat-adjustment';
import { resolveThresholdHr } from '@/lib/training/lthr';
import { RACE_HR_PCT_LTHR } from '@/lib/race/distance-doctrine';
import { distanceMiFromLabel } from '@/lib/race/distance';
import { isProvisionalResult } from '@/lib/coach/races-state';
import {
  isGradedRacePriority,
  selectionAuthority,
  RUNNER_REPORTED_AUTHORITY_CAP,
  type AuthorityTier,
} from '@/lib/race/effort-authority';
import { CORROBORATION_MIN_OBSERVATIONS } from '@/lib/training/vdot-corpus';
import { computeAerobicDecoupling } from '@/lib/training/aerobic-decoupling';
import { reconcileSplitsTotal } from '@/lib/runs/coherence';
import type { RunData } from '@/lib/runs/run-shape';
import { HEAT_CONFOUND_TEMP_F } from '@/lib/coach/easy-discipline';
import { getCanonicalRunIds, isoDaysBefore } from '@/lib/runs/volume';
import {
  runDaySql,
  runDateKeySql,
  runDistanceMiSql,
  runSplitsSql,
  runWorkoutTypeSql,
  runTypeSql,
  runTempFSql,
} from '@/lib/runs/run-shape';

/* ══════════════════════════════════════════════════════════════════════════
 * SHARED CONSTANTS
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * The POPULATION ENDURANCE PRIOR both sub-shrinkage-blends below fall back
 * toward when a runner's own evidence is thin. Its CURRENT VALUE is a real
 * citation — `Research/02-race-time-prediction.md` §2.1's Riegel formula,
 * `T2 = T1 × (D2 / D1)^1.06`, restated at §1 as the general form's `b`:
 * "fatigue exponent (≈ 1.06 for most runners, 1500m-marathon)".
 *
 * But the NAME is deliberately "prior", not "constant" or "law". 1.06 is a
 * cross-sport mean Riegel fit from world records (§2.2) — a population
 * average, not a claim about any one runner, and `Research/02` §2.3 itself
 * documents wide per-runner variance around it (Vickers & Vertosick 2016:
 * Riegel "dramatically underestimates marathon time... for half of
 * runners" extrapolating from a half). This constant is the CURRENT BEST
 * value for that prior, exactly the way `CORROBORATION_MIN_OBSERVATIONS`
 * (`vdot-corpus.ts`) is the current best convention for a corroboration
 * count: doctrine-grounded where doctrine speaks (the number itself), but
 * explicitly a starting point a future pass could refine — conditioning the
 * prior on distance specialization or training-history shape would not
 * contradict Research/02, it would pick a narrower population subgroup's
 * mean to fall back to. Nothing here should be read as claiming 1.06 is
 * unrevisable physiology.
 *
 * Bound by `DURABILITY.population-endurance-prior` in
 * `lib/doctrine/registry.ts`.
 */
export const POPULATION_ENDURANCE_PRIOR = 1.06;

/**
 * How slowly the durability anchor's CONFIDENCE fades with no fresh
 * evidence, in days. Governs `value` NOWHERE — see "Decay moves CONFIDENCE,
 * never `value`" above.
 * THIS NUMBER IS A CONVENTION, NOT A RESEARCH FINDING, in the same sense
 * `CORROBORATION_MIN_OBSERVATIONS` is one
 * (`vdot-corpus.ts`) — no `Research/` file models a decay half-life for a
 * cross-distance endurance trait. What grounds the SHAPE is the owner's own
 * instruction that this anchor should move far more slowly than a speed
 * anchor's 3-4 week half-life: aerobic durability (how well the tissue and
 * cardiovascular system hold up over hours, not the ceiling pace they can
 * hit for minutes) is a slower-changing structural property than fitness at
 * any one pace, and a single race or a single long run should not swing it.
 * 12 weeks = 84 days.
 *
 * Reused as the freshness half-life inside BOTH sub-reads' confidence
 * functions below, so "how much should a reading from N days ago still
 * count toward CONFIDENCE" answers the same question the anchor itself is
 * named for, rather than inventing a second decay rate that could drift
 * from it. It is never an input to either `value`.
 */
export const DURABILITY_HALF_LIFE_DAYS = 84;

/** Weight of a reading `n` days old, on the anchor's own half-life.
 *
 *  EXPORTED 2026-08-31 so `lib/training/capacity-resolver.ts` can fade its own
 *  confidence on the SAME curve rather than writing a second exponential decay
 *  three files away (Rule 16 · one quantity, one name — "how much does an
 *  N-day-old reading still count toward confidence" is one question). The
 *  half-life is always the CALLER's, passed in; this function owns the shape,
 *  never the rate. It is never an input to any `value`. */
export function recencyWeight(daysAgo: number, halfLifeDays: number): number {
  if (!(daysAgo >= 0)) return 1;
  return Math.pow(2, -daysAgo / halfLifeDays);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · RACE EXPONENT — fitted personal Riegel exponent, shrunk toward the
 *     population endurance prior IN PROPORTION TO EVIDENCE ONLY
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * How many corroborating graded races the shrinkage weighting treats as
 * "fully evidenced" — beyond this count, more races stop adding to
 * `countScore`. CONVENTION, not doctrine: `Research/02` names no race
 * count for a personal fit. Six is the smallest number past the 2-race
 * algebraic minimum that lets a runner's OWN full graded race history
 * (this runner has 5) approach — but not automatically reach — full
 * count-confidence; it does not saturate on his exact count by
 * construction, because that would be tuning the constant to one runner's
 * data rather than arguing it independently.
 */
export const RACE_EXPONENT_SATURATION_RACES = 6;

/**
 * The log-distance spread that counts as "fully evidenced" for the
 * spread component of confidence. Set to the 5K-to-marathon span
 * (`Research/02` §2.1's own distance range for Riegel: "1500m to
 * marathon"), `ln(26.2/3.1)`, because a fit spanning that range covers the
 * distances doctrine designed the formula for. A fit built from two
 * distances close together (e.g. two halves) cannot see whether the
 * runner's time-distance curve BENDS, which is exactly what a personal
 * exponent different from 1.06 would show up as.
 */
export const RACE_EXPONENT_SPREAD_TARGET_LN = Math.log(26.2 / 3.1);

/**
 * Half-life, in days, for how much a WIDE calendar span between the
 * earliest and latest race in the fit costs the FRESHNESS component of
 * confidence (never `value` — see the file header). CONVENTION. Chosen at
 * roughly one marathon training block (`Research/08`'s own marathon-block
 * framing runs 16-20 weeks) because that is the span over which the
 * owner's own worked example in this task's brief said fitness itself may
 * plausibly have shifted between two races, confounding a fit that assumes
 * both races measure the same underlying durability. A wide span therefore
 * lowers how much the read should be TRUSTED right now; it does not change
 * the fitted number itself, which is arithmetic on the races as they stand.
 */
export const RACE_EXPONENT_TIME_COHERENCE_HALFLIFE_DAYS = 120;

/**
 * The RMS log-residual (natural-log scale, so 0.02 ≈ a 2% typical error)
 * past which two or more races disagree badly enough with a single clean
 * power-law fit that the consistency component of the evidence score reads
 * zero — i.e. the races look more like different conditions/pacing/effort
 * than like one stable durability trait. CONVENTION for the THRESHOLD
 * placement, grounded in a real number: `Research/02` §2.3's own reported
 * accuracy table gives "Half → marathon | ±3-8%" as the error band for
 * exactly the distance pair this runner's evidence mostly spans, and 8% is
 * its upper (loosest) edge — a personal fit disagreeing with its own races
 * by MORE than doctrine's own reported ceiling for that extrapolation is
 * disagreeing more than typical measurement noise would explain.
 */
export const RACE_EXPONENT_CONSISTENCY_LOOSE_LN = Math.log(1.08);

/**
 * 2026-09-02 · ENDPOINT COVERAGE — a CONVENTION for model stability, not a
 * physiological finding. With two distinct distances the regression passes
 * through the long-end cluster exactly, so ONE marathon sets the exponent and
 * its residual is zero by construction: the consistency score cannot see it,
 * the count score credits every half as evidence about the curve's slope.
 * The evidence score therefore also asks how many observations sit at EACH
 * end of the distance spread; a single long-end observation scores 0 here,
 * three or more score 1. The marathon-anchor audit (2026-09-02) found the
 * owner's whole 7:55 vs 7:40 marathon-pace difference resting on one race.
 */
export const RACE_EXPONENT_ENDPOINT_SATURATION = 3;

export type RaceExponentFitReason =
  | 'SINGLE_LONG_END_OBSERVATION'
  | 'SINGLE_SHORT_END_OBSERVATION'
  | 'REPRESENTATIVENESS_APPLIED'
  | 'REPRESENTATIVENESS_UNAVAILABLE_FOR_SOME';

export type RaceExponentReason =
  | 'no_races'
  | 'insufficient_races'
  | 'insufficient_distance_spread';

/** One race, as the exponent fit sees it — already resolved to a single
 *  finish time and authority weight. */
export interface DurabilityRaceObservation {
  slug: string;
  date: string;
  distanceMi: number;
  finishSec: number;
  priority: string | null;
  /** `selectionAuthority(priority)`, capped downward by any runner-reported
   *  authority tier — see `raceObservationsFromRows` below — and, since
   *  2026-09-02 (Phase 1 of the brain completion), MULTIPLIED by the race's
   *  representativeness authority (`assessRaceRepresentativeness`), the same
   *  effort-class pipeline the fitness ceiling reads. A hot, hilly, untapered
   *  or badly paced race is not a full-weight point on a distance-time curve. */
  weight: number;
  /**
   * 2026-09-02 · what representativeness did to this observation. `finishSec`
   * above is the CORRECTED time (the seconds doctrine explains — course,
   * heat, taper, pacing — removed, `Research/02` §11.2 "discard … without
   * correction"); `rawFinishSec` is what was run. Null when the assessor could
   * not read the race row (Rule 11: reported, weight and time left as they
   * were, `representativenessReason` says so).
   */
  representativeness?: {
    authority: number;
    tier: 'representative' | 'compromised' | 'unrepresentative';
    explainedPct: number;
    rawFinishSec: number;
    detractors: string[];
  } | null;
  representativenessReason?: 'ASSESSED' | 'ASSESSOR_UNAVAILABLE' | 'NOT_ASSESSED';
}

/**
 * The VDOT a finish time implies at a distance — the inverse of
 * `predictRaceTime`, by bisection on the Daniels table. Used only to give the
 * representativeness assessor its `raceVdot` / `anchorVdot` inputs.
 */
export function vdotForFinish(distanceMi: number, finishSec: number): number | null {
  if (!(distanceMi > 0) || !(finishSec > 0)) return null;
  let lo = 20; let hi = 85;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const t = predictRaceTime(mid, distanceMi);
    if (t == null) return null;
    if (t > finishSec) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The race-exponent read. Refusal carries no `value` (Rule 11). */
export type RaceExponentRead =
  | {
      ok: true;
      /** The number a caller should actually spend — the fitted exponent,
       *  shrunk toward `POPULATION_ENDURANCE_PRIOR` by `evidenceScore`
       *  ONLY. Never moves on elapsed time alone — see the file header. */
      value: number;
      /** How much to TRUST `value` right now — blends `evidenceScore` with
       *  how fresh the evidence is. Falls with staleness; `value` does not. */
      confidence: number;
      /** The evidence-only score `value`'s blend weight actually uses:
       *  count, distance spread, average race-authority quality, and
       *  cross-race consistency. No clock term. Exposed so a caller (or a
       *  human) can see WHY `value` sits where it does without re-deriving
       *  it — the same transparency `supporting` gives for which races. */
      evidenceScore: number;
      /** The RAW weighted log-log fit, unshrunk. Reported for transparency
       *  and for the audit test; not the number to prescribe from. */
      rawFittedExponent: number;
      /** Echoed so a caller can show what `value` is being blended toward
       *  without importing this module's constant under a different name.
       *  Named `*Prior*`, not `*Exponent*` — see `POPULATION_ENDURANCE_PRIOR`'s
       *  own header for why. */
      populationPrior: number;
      /** Weighted RMS log-residual of the fit — null when fewer than 3
       *  races (2 races always fit exactly; a residual there would be a
       *  fake "perfect fit" signal, not a real consistency reading). */
      rmsLogResidual: number | null;
      races: number;
      /** 2026-09-02 · how many observations sit at the shortest and the
       *  longest distance; a long end of ONE means one race set the slope. */
      endpointCounts?: { short: number; long: number };
      endpointScore?: number;
      reasons?: RaceExponentFitReason[];
      /** Count of distinct race distances (rounded to the nearest mile) in
       *  the fit. Needs >= 2 for a slope to exist at all. */
      distinctDistances: number;
      /** The evidence ledger — every race that supported this read, in the
       *  same spirit as `CorpusRead.supporting` (`vdot-corpus.ts`): a later
       *  caller (or a human) can ask "why does this number look like this"
       *  without re-deriving the fit. */
      supporting: DurabilityRaceObservation[];
    }
  | {
      ok: false;
      reason: RaceExponentReason;
      races: number;
    };

/**
 * Pure · the personal Riegel exponent from a set of already-resolved race
 * observations, shrunk toward the population prior by EVIDENCE ALONE, with
 * a separately-reported confidence that also folds in freshness.
 *
 * Every judgement about which races QUALIFY (graded priority, curated
 * finish time, non-provisional) has already happened upstream
 * (`loadRaceObservationsForDurability`) — this function's only job is the
 * weighted log-log regression, the evidence score, and the shrinkage,
 * which is why it is testable without a fixture.
 *
 * ── Why one regression covers both the 2-race and 3+-race cases ─────────
 *
 * The brief described these as different procedures — a "direct algebraic
 * solve" at 2 races, a "log-log linear regression" at 3+. They are the
 * same procedure. A weighted least-squares fit of `ln T = ln a + b·ln D`
 * through exactly 2 distinct x-values reduces EXACTLY to the two-point
 * slope `ln(T2/T1) / ln(D2/D1)` regardless of the weights or how many
 * points sit at each of the two x-values (extra points at the same
 * distance just refine that cluster's weighted-mean y). So a single
 * `fitRaceExponent` handles the whole range, and there is nothing to keep
 * in sync between two implementations.
 *
 * ── evidenceScore drives `value`. confidence adds freshness on top ──────
 *
 * `value` blends `rawFittedExponent` toward `POPULATION_ENDURANCE_PRIOR`
 * using `evidenceScore` — count, distance spread, average race-authority
 * QUALITY (`selectionAuthority`/`o.weight`, already computed upstream —
 * three questionable C-race fits therefore pull LESS weight than two clean
 * A-race ones, on top of already being down-weighted inside the regression
 * itself), and cross-race CONSISTENCY (the fit's own residual — races that
 * disagree with a single clean power law more than doctrine's own reported
 * error band look like different conditions/pacing rather than different
 * fitness, and that lowers evidence quality rather than being silently
 * averaged in at full trust). None of evidenceScore's four components read
 * a clock. `confidence`, the field a caller actually sees, additionally
 * blends in FRESHNESS (time-span coherence between races, recency of the
 * latest one) — so a caller is honestly told a stale read deserves less
 * trust, without the stale read's NUMBER silently sliding toward the prior
 * on elapsed time alone. See the file header for the incident this fixes.
 */
export function fitRaceExponent(
  observations: readonly DurabilityRaceObservation[],
  opts: { today?: string } = {},
): RaceExponentRead {
  const usable = observations.filter(
    (o) => Number.isFinite(o.distanceMi) && o.distanceMi > 0
      && Number.isFinite(o.finishSec) && o.finishSec > 0
      && Number.isFinite(o.weight) && o.weight > 0,
  );
  if (usable.length === 0) return { ok: false, reason: 'no_races', races: 0 };
  if (usable.length < 2) return { ok: false, reason: 'insufficient_races', races: usable.length };

  const distinctMi = new Set(usable.map((o) => Math.round(o.distanceMi)));
  if (distinctMi.size < 2) {
    return { ok: false, reason: 'insufficient_distance_spread', races: usable.length };
  }

  // Weighted log-log regression. See header for why this single procedure
  // also covers the 2-distinct-distance case exactly.
  const n = usable.length;
  const lnD = usable.map((o) => Math.log(o.distanceMi));
  const lnT = usable.map((o) => Math.log(o.finishSec));
  const w = usable.map((o) => o.weight);
  const sw = w.reduce((s, x) => s + x, 0);
  const lnDbar = usable.reduce((s, _o, i) => s + w[i] * lnD[i], 0) / sw;
  const lnTbar = usable.reduce((s, _o, i) => s + w[i] * lnT[i], 0) / sw;
  let num = 0;
  let den = 0;
  usable.forEach((_o, i) => {
    num += w[i] * (lnD[i] - lnDbar) * (lnT[i] - lnTbar);
    den += w[i] * (lnD[i] - lnDbar) * (lnD[i] - lnDbar);
  });
  const rawFittedExponent = den > 0 ? num / den : POPULATION_ENDURANCE_PRIOR;
  const lnA = lnTbar - rawFittedExponent * lnDbar;

  // ── EVIDENCE SCORE — no clock term. Drives `value` only. ────────────────
  const countScore = clamp01((n - 2) / (RACE_EXPONENT_SATURATION_RACES - 2));

  const minMi = Math.min(...usable.map((o) => o.distanceMi));
  const maxMi = Math.max(...usable.map((o) => o.distanceMi));
  const spreadLn = Math.log(maxMi / minMi);
  const spreadScore = clamp01(spreadLn / RACE_EXPONENT_SPREAD_TARGET_LN);

  // Average race-authority QUALITY, unweighted across the included races —
  // `o.weight` is already `selectionAuthority(priority)` (A 1.0 / B 0.65 /
  // C 0.35), capped by any runner-reported downgrade, so it is already on a
  // [0,1] authority scale and needs no rescaling.
  const qualityScore = clamp01(usable.reduce((s, o) => s + o.weight, 0) / n);

  // Weighted RMS log-residual — only meaningful with a real degree of
  // freedom (n >= 3; at n == 2 the fit always passes exactly through both
  // points regardless of how well they agree, so a residual there would be
  // a fake "perfect fit" signal, not evidence of consistency).
  let rmsLogResidual: number | null = null;
  let consistencyScore = 0; // unused unless residualComputable flips true, below — excluded from the average, not defaulted in
  let residualComputable = false;
  if (n >= 3) {
    let ssRes = 0;
    usable.forEach((o, i) => {
      const predicted = lnA + rawFittedExponent * lnD[i];
      const resid = lnT[i] - predicted;
      ssRes += w[i] * resid * resid;
    });
    rmsLogResidual = Math.sqrt(ssRes / sw);
    consistencyScore = clamp01(1 - rmsLogResidual / RACE_EXPONENT_CONSISTENCY_LOOSE_LN);
    residualComputable = true;
  }

  // Average only the components that are actually meaningful — at n == 2
  // there is no consistency signal to average in (see above), so it is
  // excluded rather than defaulted to a value that would misreport as
  // either full or zero confidence for information that does not exist.
  // Endpoint coverage (CONVENTION, see RACE_EXPONENT_ENDPOINT_SATURATION).
  const byDistance = new Map<number, number>();
  for (const o of usable) byDistance.set(Math.round(o.distanceMi), (byDistance.get(Math.round(o.distanceMi)) ?? 0) + 1);
  const distancesSorted = [...byDistance.keys()].sort((a, b) => a - b);
  const nShort = byDistance.get(distancesSorted[0]) ?? 0;
  const nLong = byDistance.get(distancesSorted[distancesSorted.length - 1]) ?? 0;
  const endpointScore = clamp01((Math.min(nShort, nLong) - 1) / (RACE_EXPONENT_ENDPOINT_SATURATION - 1));
  const fitReasons: RaceExponentFitReason[] = [];
  if (nLong === 1) fitReasons.push('SINGLE_LONG_END_OBSERVATION');
  if (nShort === 1) fitReasons.push('SINGLE_SHORT_END_OBSERVATION');
  if (usable.some((o) => o.representativenessReason === 'ASSESSED')) fitReasons.push('REPRESENTATIVENESS_APPLIED');
  if (usable.some((o) => o.representativenessReason === 'ASSESSOR_UNAVAILABLE')) fitReasons.push('REPRESENTATIVENESS_UNAVAILABLE_FOR_SOME');

  const evidenceComponents = residualComputable
    ? [countScore, spreadScore, qualityScore, consistencyScore, endpointScore]
    : [countScore, spreadScore, qualityScore, endpointScore];
  const evidenceScore = clamp01(evidenceComponents.reduce((s, x) => s + x, 0) / evidenceComponents.length);

  const value = evidenceScore * rawFittedExponent + (1 - evidenceScore) * POPULATION_ENDURANCE_PRIOR;

  // ── FRESHNESS — clock-only, folds into `confidence`, never into `value`. ─
  const dates = usable.map((o) => Date.parse(o.date + 'T12:00:00Z')).filter((t) => Number.isFinite(t));
  const timeSpanDays = dates.length >= 2 ? (Math.max(...dates) - Math.min(...dates)) / 86_400_000 : 0;
  const coherenceScore = recencyWeight(timeSpanDays, RACE_EXPONENT_TIME_COHERENCE_HALFLIFE_DAYS);

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(today + 'T12:00:00Z');
  const daysSinceLatest = dates.length > 0 ? (todayMs - Math.max(...dates)) / 86_400_000 : Infinity;
  const recencyScore = recencyWeight(daysSinceLatest, DURABILITY_HALF_LIFE_DAYS);
  const freshnessScore = clamp01((coherenceScore + recencyScore) / 2);

  const confidence = clamp01((evidenceScore + freshnessScore) / 2);

  return {
    ok: true,
    value,
    confidence,
    evidenceScore,
    rawFittedExponent,
    populationPrior: POPULATION_ENDURANCE_PRIOR,
    rmsLogResidual,
    races: n,
    distinctDistances: distinctMi.size,
    endpointCounts: { short: nShort, long: nLong },
    endpointScore,
    reasons: fitReasons,
    supporting: [...usable].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * The runner's own downgrade of a race's authority
 * (`races.actual_result.authority_tier` with `authority_source:'runner'`),
 * capping `selectionAuthority(priority)` downward only — never upward.
 * Same read `lib/training/vdot-inputs.ts`'s private `runnerAuthorityTier`
 * performs (not imported from there: that helper is unexported, and this
 * module does not touch `vdot-inputs.ts`, which is in flight elsewhere
 * tonight — see the file header's scope note). Duplicated logic, single
 * source of truth for the FIELD NAMES it reads
 * (`RUNNER_REPORTED_AUTHORITY_CAP`, imported).
 */
const RUNNER_AUTHORITY_TIERS: readonly AuthorityTier[] = ['representative', 'compromised', 'unrepresentative'];
function runnerAuthorityCap(ar: Record<string, unknown>): number | null {
  if (ar.authority_source !== 'runner') return null;
  const t = ar.authority_tier;
  if (typeof t !== 'string' || !(RUNNER_AUTHORITY_TIERS as readonly string[]).includes(t)) return null;
  if (t === 'representative') return null; // a floor-lowering lever only
  return RUNNER_REPORTED_AUTHORITY_CAP[t as Exclude<AuthorityTier, 'representative'>];
}

/**
 * Race candidates for the durability fit, read from `races` the same way
 * `lib/training/vdot-inputs.ts`'s race loader does (CLAUDE.md's Race-data
 * source-of-truth ladder), with two narrowings specific to a cross-distance
 * time regression rather than a single fitness-ceiling selection:
 *
 *   · RUNGS 1-2 ONLY. `vdot-inputs.ts` falls back to a Strava date+distance
 *     MATCH against `runs` when neither `actual_result.finishS` nor
 *     `meta.finishTime` is populated (rung 3) — a provisional stand-in
 *     appropriate for "give the fitness ceiling SOME anchor". A
 *     cross-distance regression needs the opposite: a training run
 *     mistaken for a race is exactly the contamination CLAUDE.md's
 *     Race-data checklist exists to keep out of a race-result reader. This
 *     fit refuses rather than guesses.
 *   · GRADED PRIORITY ONLY (`isGradedRacePriority`), where
 *     `bestRecentVdot`'s selection instead grades an ungraded row at the C
 *     row via `selectionAuthority`. That convention is argued for FITNESS
 *     SELECTION (an ungraded race is still real effort evidence). It does
 *     NOT transfer here: this app's own `hilly_excluded` label exists
 *     specifically to flag a course whose time is not standard-course
 *     comparable, which is the one thing a Riegel-style distance-time fit
 *     depends on. Down-weighting a hilly race to C (0.35) would still let
 *     a non-flat finish time distort the fitted curve; excluding it
 *     entirely is the correct read of what the label means for THIS
 *     question. `training_run` (the other non-graded label) is excluded
 *     for the same reason `vdot-inputs.ts` avoids rung 3 above — it is not
 *     a race.
 */
export async function loadRaceObservationsForDurability(
  userUuid: string,
): Promise<DurabilityRaceObservation[]> {
  const rows = await pool.query<{
    slug: string;
    meta: Record<string, unknown> | null;
    actual_result: Record<string, unknown> | null;
  }>(
    `SELECT slug, meta, actual_result FROM races WHERE user_uuid = $1`,
    [userUuid],
  ).then((r) => r.rows);

  const out: DurabilityRaceObservation[] = [];
  for (const r of rows) {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    const ar = (r.actual_result ?? {}) as Record<string, unknown>;
    const priority = (m.priority as string) ?? null;
    if (!isGradedRacePriority(priority)) continue;

    const distanceMi = m.distanceMi != null ? Number(m.distanceMi) : distanceMiFromLabel(m.distanceLabel as string);
    if (distanceMi == null || !(distanceMi > 0)) continue;

    // Rungs 1-2 only — see header note above.
    let finishSec: number | null = ar.finishS != null ? Number(ar.finishS) : null;
    if (!finishSec || !(finishSec > 0)) finishSec = parseRaceTime(m.finishTime as string);
    if (!finishSec || !(finishSec > 0)) continue;

    // An unconfirmed watch time is not solid enough for a precision
    // distance-time regression — excluded rather than downweighted (Rule 11:
    // "don't know how good this number is" is a different fact from "this
    // number is weak evidence").
    if (isProvisionalResult(ar)) continue;

    const date = (m.date as string) ?? '';
    if (!date) continue;

    let weight = selectionAuthority(priority);
    const cap = runnerAuthorityCap(ar);
    if (cap != null) weight = Math.min(weight, cap);

    out.push({ slug: r.slug, date, distanceMi, finishSec, priority, weight, representativenessReason: 'NOT_ASSESSED' });
  }
  return applyRepresentativeness(userUuid, out);
}

/**
 * 2026-09-02 · REPRESENTATIVENESS IS SPENT, NOT JUST COMPUTED (Phase 1 of the
 * brain completion; the marathon-anchor audit of the same date is the
 * incident). The fit used to weight by declared priority alone and regress on
 * RAW finish times: a 69 °F, 722-ft half entered at full weight beside a
 * February PR half, and the whole seven-month spread was read as curve
 * shape. `Research/02` §11.2: "Discard any race run in heat > 18 °C, on a hilly
 * course, or in a depleted state without correction"; §11.4: "Best when both
 * races are recent, on flat courses, in similar weather."
 *
 * The anchor VDOT the assessor prices each race against is the best VDOT the
 * runner's own admitted races imply — self-contained, so this module does not
 * reach for the Runner Model and create a cycle. A race that reads FASTER than
 * that anchor is priced on the upward limb (aids), a slower one on the
 * downward limb (conditions); only the downward limb's explained seconds are
 * removed from the time.
 */
async function applyRepresentativeness(
  userUuid: string,
  observations: DurabilityRaceObservation[],
): Promise<DurabilityRaceObservation[]> {
  const vdots = observations.map((o) => vdotForFinish(o.distanceMi, o.finishSec));
  const anchorVdot = Math.max(...vdots.filter((v): v is number => v != null && Number.isFinite(v)), 0);
  if (!(anchorVdot > 0)) return observations;
  const out: DurabilityRaceObservation[] = [];
  for (let i = 0; i < observations.length; i++) {
    const o = observations[i];
    const raceVdot = vdots[i];
    let read: Awaited<ReturnType<typeof assessRaceRepresentativeness>> = null;
    try {
      read = raceVdot == null ? null : await assessRaceRepresentativeness({
        userId: userUuid, raceSlug: o.slug, raceDateISO: o.date, distanceMi: o.distanceMi,
        finishS: o.finishSec, anchorVdot, raceVdot,
      });
    } catch {
      read = null;
    }
    if (!read) {
      out.push({ ...o, representativeness: null, representativenessReason: 'ASSESSOR_UNAVAILABLE' });
      continue;
    }
    const explained = read.direction === 'downward' ? Math.max(0, read.explainedPct) : 0;
    out.push({
      ...o,
      weight: o.weight * Math.max(0, Math.min(1, read.authority)),
      finishSec: Math.round(o.finishSec / (1 + explained / 100)),
      representativeness: {
        authority: read.authority,
        tier: read.tier,
        explainedPct: explained,
        rawFinishSec: o.finishSec,
        detractors: read.detractors.map((d) => `${d.factor}:${d.authorityCost}`),
      },
      representativenessReason: 'ASSESSED',
    });
  }
  return out;
}

export async function resolveRaceExponent(userUuid: string): Promise<RaceExponentRead> {
  const today = await runnerToday(userUuid);
  const observations = await loadRaceObservationsForDurability(userUuid);
  return fitRaceExponent(observations, { today });
}

/**
 * Riegel's stated validity window, `Research/02` §2.1: "1500m to marathon."
 * Same bounds `lib/training/vdot.ts`'s own private `RIEGEL_MIN/MAX_DISTANCE_MI`
 * and `lib/race/coach-goal.ts`'s (now-legacy) copy already carry — a third,
 * still-module-local pair rather than a shared export, matching the existing
 * convention for this specific pair rather than fixing it as a drive-by.
 */
const RIEGEL_MIN_DISTANCE_MI = 0.93;
const RIEGEL_MAX_DISTANCE_MI = 26.22;

/**
 * Project a race time at `targetDistanceMi` through THIS read's fitted
 * exponent: `T = T1 × (Dtarget/D1)^value`, anchored on whichever supporting
 * race sits closest to the target in log-distance (the smaller
 * extrapolation) — same anchor-selection rule `lib/race/coach-goal.ts`'s
 * (legacy) `predictWithPersonalExponent` used for its own two-race fit.
 *
 * 2026-09-01 · relocated here from `lib/race/coach-goal.ts` (where it was
 * first built, as `deriveCoachGoal`'s bridge onto this file's canonical
 * exponent) so `lib/training/goal-projection.ts` can call the SAME function —
 * importing it from `coach-goal.ts` would cycle back through
 * `goal-projection.ts` (`coach-goal.ts` imports
 * `marathonSpecificityAdjustment` from there). `coach-goal.ts` re-exports
 * this name unchanged, so its own callers and `coach-goal-durability.test.ts`
 * needed no edits. One function, one name, callable from both the coach-set
 * A/B/C tiers and the goal-projection trajectory — Rule 16.
 *
 * `read.value` is ALREADY the shrunk-toward-population number
 * (this file's own header: decay and thin evidence move `confidence`, never
 * `value`) — this function performs no further shrinkage or clamping of its
 * own. Null when the read refused (Rule 11: `RaceExponentRead.ok === false`
 * carries no `value`), carries no supporting races (should not happen when
 * `ok === true`; checked defensively anyway), or the target sits outside
 * Riegel's validity window.
 */
export function projectWithDurabilityExponent(
  read: RaceExponentRead,
  targetDistanceMi: number,
): { sec: number; anchorDistanceMi: number } | null {
  if (!read.ok) return null;
  if (!targetDistanceMi || targetDistanceMi <= 0) return null;
  if (targetDistanceMi < RIEGEL_MIN_DISTANCE_MI || targetDistanceMi > RIEGEL_MAX_DISTANCE_MI) return null;
  if (read.supporting.length === 0) return null;
  const anchor = [...read.supporting].sort(
    (a, b) =>
      Math.abs(Math.log(targetDistanceMi / a.distanceMi)) -
      Math.abs(Math.log(targetDistanceMi / b.distanceMi)),
  )[0];
  const t = anchor.finishSec * Math.pow(targetDistanceMi / anchor.distanceMi, read.value);
  return Number.isFinite(t) && t > 0
    ? { sec: Math.round(t), anchorDistanceMi: anchor.distanceMi }
    : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · DECOUPLING — corroborated Pa:HR drift across qualifying long runs
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Reused machinery, not re-derived. Per-run decoupling math is
 * `computeAerobicDecoupling` (`lib/training/aerobic-decoupling.ts`) —
 * Research/03 §12's protocol, gated on `DECOUPLING_PROTOCOL_MIN_MINUTES`
 * (60 minutes, doctrine-cited, NOT the design brief's own "~75 minute"
 * guess — the codebase already carries a citation-verified number for
 * exactly this floor, so that one wins per the brief's own instruction to
 * "prefer that citation"). The steady-state / workout-type / plan-quality
 * exclusion and the heat exclusion below mirror
 * `lib/training/decoupling-trend.ts`'s `computeDecouplingTrend` query
 * verbatim in shape, because building a second, slightly different
 * exclusion query for the same underlying signal is exactly the kind of
 * drift Rule 16 exists to prevent — two readers of "long-run decoupling"
 * must exclude the same contamination the same way. What differs from that
 * sibling is the AGGREGATION: `computeDecouplingTrend` compares first-3 vs
 * last-3 to answer a TREND question over a 60-day window; this file
 * answers a LEVEL question (what does the runner's durability currently
 * read AS), over a wider window sized to the anchor's own long half-life,
 * so `resolveDurabilityAnchor` below has a name for the level to combine
 * with the race-exponent read rather than only a direction.
 *
 * HEAT NORMALIZATION, and why EXCLUSION rather than the ADJUSTMENT
 * mechanism in `lib/weather/heat-adjustment.ts` / `lib/coach/heat-gate.ts`.
 * The brief asked for conditions to be normalized "per this codebase's
 * existing heat-gate.ts/heat-adjustment.ts machinery" — but those two files
 * ADJUST a PACE for an upcoming/graded effort (a different question: "what
 * pace should this heat produce"). `decoupling-trend.ts` already answers
 * THIS exact question — "does heat contaminate a decoupling reading" — and
 * its own header states the reasoning: Research/03 §12 says heat
 * "manufactures 2-5% of decoupling on its own," comfortably larger than the
 * swings this reader turns on, and "a contaminated point is worse than a
 * missing one." Building a second, adjustment-based heat treatment for the
 * same signal, alongside the sibling's exclusion-based one, would be two
 * different answers to one question (Rule 16) — so this file reuses
 * `HEAT_CONFOUND_TEMP_F` (`lib/coach/easy-discipline.ts`, itself the same
 * 77°F / 25°C doctrine threshold `heat-adjustment.ts`'s own
 * `HEAT_HR_CONFOUNDER.thresholdF` uses) and excludes exactly as the sibling
 * does.
 *
 * ── LONGITUDINAL, not a single-run reading ────────────────────────────────
 *
 * One long run's decoupling is weak evidence about a runner's durability on
 * its own — a single hard-paced finish, a bad-sleep night, a slightly
 * dehydrated start can each manufacture a one-off drift reading that has
 * nothing to do with the underlying trait. `aggregateDecoupling` refuses
 * below `CORROBORATION_MIN_OBSERVATIONS` qualifying runs for exactly this
 * reason (same discipline `vdot-corpus.ts` argues for a single training
 * session), and its confidence's evidence component explicitly rewards
 * MULTIPLE COMPARABLE runs AGREEING with each other (the consistency score,
 * below) — not merely the count clearing the corroboration floor. A count
 * of 8 runs whose readings scatter from 1% to 15% is worse evidence than a
 * count of 4 that all read 6-7%, and the two must not report the same
 * confidence.
 *
 * ── NAMED FOLLOW-UP, not built here: drift ONSET ──────────────────────────
 *
 * This reader captures MAGNITUDE (how much HR outpaces pace across the back
 * half) but not ONSET (how many minutes into the run the relationship
 * starts breaking down). Two runners can share the same average drift with
 * very different real durability: one whose HR:pace ratio holds flat for
 * 90 minutes and only slips in the final 20 has a materially different
 * limiter than one who starts drifting at minute 30 and drifts steadily the
 * whole way. `computeAerobicDecoupling`'s two-halves design cannot see this
 * distinction by construction — it only ever compares one mean to another.
 * Building an onset read means walking the per-mile series for a breakpoint
 * rather than a fixed halfway split, which is a genuinely bigger lift than
 * anything else in this file (a new statistical method, not a reuse of
 * existing machinery) and was deliberately left out of this pass rather
 * than built partially. The magnitude-only read here is real, corroborated
 * evidence on its own; onset is additive precision for a later pass, not a
 * prerequisite for this one to be trustworthy.
 */

/** How far back this reader looks for qualifying long runs. CONVENTION,
 *  same style as `fitness-model.ts`'s `STALE_INPUT_DAYS` — Research/03 §12
 *  states the per-run protocol, not a corpus lookback window. Wider than
 *  `decoupling-trend.ts`'s 60-day trend window on purpose: that window is
 *  sized to show recent movement; this one is sized to gather enough
 *  corroborating observations for a LEVEL that is meant to move on the
 *  anchor's own 12-week half-life, not week to week. 180 days ≈ 6 months,
 *  matching `fitness-model.ts`'s own "stale beyond half a year" line. */
export const DECOUPLING_LOOKBACK_DAYS = 180;

/** Count of qualifying observations past which more stop adding to
 *  confidence. CONVENTION — a runner logging long runs 1-2x/week reaches
 *  this within the lookback window without the constant being tuned to
 *  exactly the owner's own cadence. */
export const DECOUPLING_SATURATION_OBSERVATIONS = 8;

/** Standard deviation, in drift percentage points, below which the
 *  consistency component of confidence is full and above which it is
 *  zero. CONVENTION: a spread under `LOW_PP` says the readings are
 *  describing one stable trait; a spread past `HIGH_PP` is wider than
 *  Research/03 §12's own gap between adjacent interpretation bands (the
 *  5-8-10 ladder), i.e. wide enough that the observations disagree about
 *  which BAND the runner is even in. */
const DECOUPLING_CONSISTENCY_LOW_PP = 2;
const DECOUPLING_CONSISTENCY_HIGH_PP = 6;

export type DecouplingReason = 'no_observations' | 'insufficient_corroboration';

export interface DecouplingObservation {
  /** `runs.id`. */
  id: string;
  date: string;
  /** From `computeAerobicDecoupling`. Positive = HR climbed faster than
   *  pace across the run's second half. */
  driftPct: number;
  durationMin: number;
}

/** The decoupling read. Refusal carries no `value` (Rule 11). */
export type DecouplingRead =
  | {
      ok: true;
      /** Mean drift % across qualifying observations. Positive = weaker
       *  aerobic durability (HR outpaces pace over the back half). Moves
       *  ONLY when the mean over qualifying runs moves — never as a
       *  function of elapsed time alone (see the file header). */
      value: number;
      /** How much to TRUST `value` right now — blends `evidenceScore` with
       *  how fresh the qualifying runs are. Falls with staleness; `value`
       *  does not. */
      confidence: number;
      /** The evidence-only score (count past corroboration, cross-run
       *  consistency) — no clock term. Exposed for the same transparency
       *  reason `RaceExponentRead.evidenceScore` is. */
      evidenceScore: number;
      /** Standard deviation across qualifying observations, percentage
       *  points — what `evidenceScore`'s consistency component actually
       *  read. Reported so a caller can see WHY confidence is low without
       *  re-deriving it from `supporting`. */
      stddevPct: number;
      observations: number;
      /** The evidence ledger — every qualifying long run, in the same
       *  spirit as `CorpusRead.supporting`. */
      supporting: DecouplingObservation[];
    }
  | {
      ok: false;
      reason: DecouplingReason;
      observations: number;
    };

/**
 * Pure · the corroborated decoupling level from a set of already-qualified
 * per-run drift readings.
 *
 * Every judgement about which runs QUALIFY (steady-state, non-quality,
 * non-heat, >= the protocol duration) has already happened upstream — this
 * function's only job is the aggregate and its confidence.
 */
export function aggregateDecoupling(
  observations: readonly DecouplingObservation[],
  opts: { today?: string; minObservations?: number } = {},
): DecouplingRead {
  const minObservations = opts.minObservations ?? CORROBORATION_MIN_OBSERVATIONS;
  const usable = observations.filter((o) => Number.isFinite(o.driftPct));
  if (usable.length === 0) return { ok: false, reason: 'no_observations', observations: 0 };
  if (usable.length < minObservations) {
    return { ok: false, reason: 'insufficient_corroboration', observations: usable.length };
  }

  const sorted = [...usable].sort((a, b) => a.date.localeCompare(b.date));
  const mean = sorted.reduce((s, o) => s + o.driftPct, 0) / sorted.length;
  const variance = sorted.reduce((s, o) => s + (o.driftPct - mean) * (o.driftPct - mean), 0) / sorted.length;
  const stddev = Math.sqrt(variance);

  // ── EVIDENCE SCORE — no clock term. Drives `value` only (`value` is the
  // mean above, which already never reads a clock — this score exists so
  // `confidence` can report evidence quality on the SAME footing the race
  // exponent read does). "Multiple comparable runs AGREEING", not just
  // clearing the corroboration floor — see the file's LONGITUDINAL note.
  const countScore = clamp01(
    (sorted.length - minObservations) / (DECOUPLING_SATURATION_OBSERVATIONS - minObservations),
  );
  const consistencyScore = clamp01(
    1 - (stddev - DECOUPLING_CONSISTENCY_LOW_PP)
      / (DECOUPLING_CONSISTENCY_HIGH_PP - DECOUPLING_CONSISTENCY_LOW_PP),
  );
  const evidenceScore = clamp01((countScore + consistencyScore) / 2);

  // ── FRESHNESS — clock-only, folds into `confidence`, never into `value`.
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(today + 'T12:00:00Z');
  const latestMs = Math.max(...sorted.map((o) => Date.parse(o.date + 'T12:00:00Z')));
  const daysSinceLatest = (todayMs - latestMs) / 86_400_000;
  const freshnessScore = recencyWeight(daysSinceLatest, DURABILITY_HALF_LIFE_DAYS);

  const confidence = clamp01((evidenceScore + freshnessScore) / 2);

  return {
    ok: true,
    value: mean,
    confidence,
    evidenceScore,
    stddevPct: stddev,
    observations: sorted.length,
    supporting: sorted,
  };
}

/**
 * Pure · one candidate long-run row, reduced to a qualifying observation or
 * excluded — heat first (the condition normalization the brief asked for;
 * see the header note above for why this is exclusion, not the
 * `heat-adjustment.ts` pace-adjustment mechanism), then the per-run
 * decoupling math itself. Split out from `loadDecouplingObservations` so
 * the heat normalization is independently testable without a database: a
 * hot and a cool run with IDENTICAL splits must produce different
 * inclusion outcomes, and that claim should not require a live connection
 * to check.
 */
export function qualifyingDecouplingObservation(row: {
  id: string;
  date: string;
  distanceMi: number;
  splits: unknown;
  tempF: number | null;
}): DecouplingObservation | null {
  if (row.tempF != null && Number.isFinite(row.tempF) && row.tempF >= HEAT_CONFOUND_TEMP_F) return null;
  // `distanceMi` and `splits` are two members of ONE arithmetic family
  // (`splits.total-vs-distance`, lib/runs/derived-registry.ts) — reading
  // both without reconciling them is exactly the shape
  // check-derived-consistency.sh exists to catch, and it is a real defect
  // here specifically: a splits array that does not decompose this run
  // (`splits-adopt.ts`'s own header names a production row whose splits
  // summed to 12.0 mi against a stated 1.00 mi) would hand a fabricated
  // half/second-half comparison to a durability read. Refuses only on an
  // EXPLICIT mismatch (`false`); `null` means the array carries no
  // per-split distance to check, which is most historical shapes and not
  // itself a contradiction — same posture `thresholdSegmentFromSplits`
  // (pace-corpus.ts) takes on the identical guard.
  const coherent = reconcileSplitsTotal({ splits: row.splits } as RunData, row.distanceMi);
  if (coherent === false) return null;
  const splits = Array.isArray(row.splits) ? row.splits as Parameters<typeof computeAerobicDecoupling>[0] : null;
  const result = computeAerobicDecoupling(splits, row.distanceMi);
  if (!result) return null;
  return { id: row.id, date: row.date, driftPct: result.driftPct, durationMin: result.durationMin };
}

/**
 * Long-run rows over `DECOUPLING_LOOKBACK_DAYS`, filtered exactly as
 * `computeDecouplingTrend` filters them (canonical dedup, non-quality
 * workout type, no plan-prescribed quality that day, distance prefilter),
 * then reduced through `qualifyingDecouplingObservation` per run. See the
 * header above for why this mirrors that sibling rather than inventing a
 * second exclusion query.
 *
 * NO `.catch()` — throws on a query failure, same posture
 * `lib/training/vdot-inputs.ts`'s race loader states for itself ("the
 * caller refuses to generate rather than producing" a read built on a
 * silently-emptied query). `decoupling-trend.ts`'s own sibling query DOES
 * swallow to `[]` (an accepted, argued exemption for THAT file's "over-
 * exclusion is the safe direction" trend read) — copying that swallow here
 * would collapse "the corpus genuinely has no qualifying runs" and "the
 * query broke" into the same `no_observations` refusal, which is exactly
 * the two-facts-as-one-value collapse Rule 11 exists to forbid.
 */
export async function loadDecouplingObservations(userUuid: string): Promise<DecouplingObservation[]> {
  const today = await runnerToday(userUuid);
  const fromISO = isoDaysBefore(today, DECOUPLING_LOOKBACK_DAYS);
  const canonicalIds = await getCanonicalRunIds(userUuid, fromISO, today);
  if (canonicalIds.length === 0) return [];

  const rows = await pool.query<{
    id: string; date: string; mi: number | string; splits: unknown; temp_f: string | null;
  }>(
    `SELECT r.id::text, ${runDateKeySql('r')} AS date, ${runDistanceMiSql('r')} AS mi,
            ${runSplitsSql('r')} AS splits, ${runTempFSql('r')} AS temp_f
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND r.id = ANY($3::bigint[])
        AND ${runDistanceMiSql('r')} >= 4
        AND (${runDateKeySql('r')})::date >= $2::date - ($4 || ' days')::interval
        AND COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '')
              NOT IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek')
        AND NOT EXISTS (
          SELECT 1
            FROM plan_workouts pw
            JOIN training_plans tp ON tp.id = pw.plan_id
           WHERE tp.user_uuid = $1::uuid
             AND pw.date_iso = ${runDaySql('r')}
             AND pw.type IN ('race', 'intervals', 'threshold', 'tempo', 'fartlek', 'race_week_tuneup')
        )
      ORDER BY (${runDateKeySql('r')})::date ASC`,
    [userUuid, today, canonicalIds, String(DECOUPLING_LOOKBACK_DAYS)],
  ).then((r) => r.rows);

  const out: DecouplingObservation[] = [];
  for (const r of rows) {
    const obs = qualifyingDecouplingObservation({
      id: r.id,
      date: r.date,
      distanceMi: Number(r.mi),
      splits: r.splits,
      tempF: r.temp_f != null ? Number(r.temp_f) : null,
    });
    if (obs) out.push(obs);
  }
  return out;
}

export async function resolveDecoupling(userUuid: string): Promise<DecouplingRead> {
  const today = await runnerToday(userUuid);
  const observations = await loadDecouplingObservations(userUuid);
  return aggregateDecoupling(observations, { today });
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE COMBINED ANCHOR
 * ══════════════════════════════════════════════════════════════════════ */

export interface DurabilityAnchor {
  raceExponent: RaceExponentRead;
  decoupling: DecouplingRead;
  /** `DURABILITY_HALF_LIFE_DAYS`, carried on the anchor so a caller does
   *  not need a second import to know how this anchor should decay. */
  halfLifeDays: number;
  /** When this anchor was computed. Rule 10: nothing about this anchor is
   *  persisted, so this is the freshness of the READ, not of an aging
   *  write — every call recomputes both sub-reads from source data. */
  computedAt: string;
}

/**
 * Compute-at-read-time, per Rule 10 — no table, no column, no cache. Every
 * call re-derives both sub-reads from `races` and `runs` directly.
 *
 * Deliberately NOT wired into `resolveCurrentTPace`, `generate.ts`, race
 * prediction, or any plan-authoring path. That is Phase-3-equivalent
 * wiring work, scoped out of this file on purpose (see the file header) —
 * this module's job is to be a trustworthy, standalone, independently
 * testable reader that a later wiring pass can call.
 */
export async function resolveDurabilityAnchor(userUuid: string): Promise<DurabilityAnchor> {
  const [raceExponent, decoupling] = await Promise.all([
    resolveRaceExponent(userUuid),
    resolveDecoupling(userUuid),
  ]);
  return {
    raceExponent,
    decoupling,
    halfLifeDays: DURABILITY_HALF_LIFE_DAYS,
    computedAt: new Date().toISOString(),
  };
}


/* ══════════════════════════════════════════════════════════════════════════
 * TRAINING DURABILITY · marathon rehearsals as predictor observations
 * (2026-09-02 · Phase 1 of the brain completion)
 *
 * `Research/02` §12.2, Fast Finish Long Run: "when 3–5 of these are completed
 * in the final 8–12 weeks, holding goal MP for the final 6–10 miles after
 * 8–10 miles of easy pace is a strong predictor. Failing this workout is a
 * clear signal that the goal is too aggressive… low false positives (rarely
 * passes a runner who can't deliver the marathon)." §12.4, Race-Effort Tempo:
 * "8–12 miles at projected marathon pace, in the final 3–5 weeks… a binary
 * go/no-go signal." §12.5's matrix grades the fast-finish long run "Accurate"
 * for every runner type, Speedster included — which is exactly the type the
 * race exponent alone cannot tell apart from a badly paced marathon.
 *
 * This is the evidence Brief 06 names ("sustained race-specific work, quality
 * performed late in long runs") and the mechanism the doctrine calls "earned":
 * a marathon pace the runner has HELD, controlled and at marathon heart rate,
 * over the rehearsal distance doctrine specifies, on the number of occasions
 * doctrine specifies, is a demonstrated pace. It caps the exponent-derived
 * prescription from the fast side (`marathonPaceFromDurability`), never the
 * slow side, and it refuses below the corroboration bar. Pacing control is
 * read from the runner's own mile splits, effort from heart rate against the
 * marathon band `RACE_HR_PCT_LTHR.m`, and heat is priced out with the same
 * model race conditions use.
 * ═══════════════════════════════════════════════════════════════════════ */

/** `Research/02` §12.2 · "3–5 of these". */
export const MARATHON_REHEARSAL_MIN_SESSIONS = 3;
/** `Research/02` §12.2 · "the final 8–12 weeks". */
export const MARATHON_REHEARSAL_WINDOW_DAYS = 84;
/** `Research/02` §12.2 · "the final 6–10 miles". */
export const MARATHON_REHEARSAL_MIN_SEGMENT_MI = 6;
/** `Research/02` §12.2 · "after 8–10 miles of easy pace". */
export const MARATHON_REHEARSAL_MIN_PRECEDING_MI = 8;
/** `Research/02` §12.4 · "8–12 miles at projected marathon pace". */
export const MARATHON_TEMPO_MIN_SEGMENT_MI = 8;
/** CONVENTION for model stability · `Research/08` §2 gives elite even pacing
 *  a CV of 1.5–3%; a segment in which any mile sits more than this far from
 *  the segment mean is not a HELD pace (a warm-up mile or a fade leaking into
 *  the window fails this where a CV would average it away). */
export const MARATHON_REHEARSAL_MAX_MILE_DEVIATION_PCT = 5;
/** CONVENTION · a marathon-pace tempo (§12.4) is followed by a cool-down, not
 *  by the rest of a long run: a held opening that fades into nine slower
 *  miles is a run that went out too hard, not a rehearsal. */
export const MARATHON_TEMPO_MAX_TRAILING_MI = 3;
/** CONVENTION · a rehearsal segment is a step UP in pace from the miles before
 *  it (§12.2 "progress from marathon pace"; §12.4 a tempo after its warm-up);
 *  a segment slower than what preceded it is the back half of a positive
 *  split, not a rehearsal. Percent faster than the preceding miles' mean. */
export const MARATHON_REHEARSAL_MIN_STEP_FASTER_PCT = 3;
/** CONVENTION for model stability · a rehearsal read below this confidence
 *  (three sessions whose paces disagree by more than the pacing convention)
 *  is REPORTED beside the exponent carry but not SPENT on the prescription. */
export const MARATHON_REHEARSAL_SPEND_CONFIDENCE = 0.5;
/** CONVENTION · the marathon HR band (`RACE_HR_PCT_LTHR.m` = 0.88–0.95) with
 *  a two-point allowance either side for mile-average noise. A steady run at
 *  easy-plus effort (≤ 85%) is not a marathon rehearsal. */
export const MARATHON_REHEARSAL_HR_TOLERANCE = 0.02;

export interface MarathonRehearsalObservation {
  id: string;
  date: string;
  kind: 'fast_finish_long' | 'mp_tempo';
  segmentMi: number;
  precedingMi: number;
  /** Heat-normalised to a 50 °F day, seconds per mile. */
  paceSecPerMi: number;
  rawPaceSecPerMi: number;
  meanHrPctLthr: number;
  cvPct: number;
  tempF: number | null;
}

export type TrainingDurabilityReason = 'no_observations' | 'insufficient_corroboration' | 'no_lthr';

export type TrainingDurabilityRead =
  | {
      ok: true;
      /** The median demonstrated marathon-effort pace, s/mi, heat-normalised. */
      demonstratedPaceSecPerMi: number;
      confidence: number;
      observations: number;
      supporting: MarathonRehearsalObservation[];
      reasons: string[];
    }
  | { ok: false; reason: TrainingDurabilityReason; observations: number };

/** Standard-day pace for a segment run at `tempF`, via the race heat model. */
function heatNormalisedPace(paceSecPerMi: number, tempF: number | null, distanceMi: number): number {
  if (tempF == null || !Number.isFinite(tempF)) return paceSecPerMi;
  const hotFactor = applyHeatToPace(1000, tempF, distanceMi) / 1000;
  const coolFactor = applyHeatToPace(1000, 50, distanceMi) / 1000;
  return (paceSecPerMi / hotFactor) * coolFactor;
}

/**
 * Pure · does this run contain a marathon rehearsal? Scans the mile splits
 * for the longest contiguous window (≥ 6 mi) whose pace is held (CV ≤ the
 * convention) at marathon heart rate; classes it fast-finish when it closes
 * the run after ≥ 8 preceding miles, MP-tempo when it is ≥ 8 mi anywhere.
 */
export function qualifyingMarathonRehearsal(row: {
  id: string; date: string; distanceMi: number; splits: unknown; tempF: number | null; lthrBpm: number;
}): MarathonRehearsalObservation | null {
  if (!(row.lthrBpm > 0)) return null;
  if (row.tempF != null && Number.isFinite(row.tempF) && row.tempF >= HEAT_CONFOUND_TEMP_F) return null;
  const splits = splitsWithHrAndPace(row.splits, { shapes: DECOUPLING_SPLIT_SHAPES });
  if (splits.length < MARATHON_REHEARSAL_MIN_SEGMENT_MI + 1) return null;
  const [bandLo, bandHi] = RACE_HR_PCT_LTHR.m;
  const lo = bandLo - MARATHON_REHEARSAL_HR_TOLERANCE;
  const hi = bandHi + MARATHON_REHEARSAL_HR_TOLERANCE;
  let best: MarathonRehearsalObservation | null = null;
  for (let start = 0; start < splits.length; start++) {
    for (let end = splits.length; end - start >= MARATHON_REHEARSAL_MIN_SEGMENT_MI; end--) {
      const w = splits.slice(start, end);
      const paces = w.map((x) => x.paceSec);
      const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
      const maxDevPct = Math.max(...paces.map((x) => Math.abs(x - mean) / mean)) * 100;
      if (maxDevPct > MARATHON_REHEARSAL_MAX_MILE_DEVIATION_PCT) continue;
      const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) * (b - mean), 0) / paces.length);
      const cv = (sd / mean) * 100;
      const hrPct = w.reduce((a, x) => a + x.hr, 0) / w.length / row.lthrBpm;
      if (hrPct < lo || hrPct > hi) continue;
      const segmentMi = w.length;
      const precedingMi = start;
      const closes = end === splits.length;
      // A rehearsal is a SEGMENT inside a run (§12.2 "after 8–10 miles of
      // easy pace"; §12.4 a tempo with its warm-up and cool-down). A whole
      // steady run at marathon heart rate is a long run, not a rehearsal —
      // it demonstrates the effort but not the shape doctrine grades.
      const spansWholeRun = precedingMi === 0 && closes;
      const trailingMi = splits.length - end;
      if (precedingMi > 0) {
        const before = splits.slice(0, start).map((x) => x.paceSec);
        const beforeMean = before.reduce((a, b) => a + b, 0) / before.length;
        if (mean > beforeMean * (1 - MARATHON_REHEARSAL_MIN_STEP_FASTER_PCT / 100)) continue;
      }
      const kind: MarathonRehearsalObservation['kind'] | null =
        closes && precedingMi >= MARATHON_REHEARSAL_MIN_PRECEDING_MI ? 'fast_finish_long'
        : !spansWholeRun && segmentMi >= MARATHON_TEMPO_MIN_SEGMENT_MI && trailingMi <= MARATHON_TEMPO_MAX_TRAILING_MI ? 'mp_tempo'
        : null;
      if (!kind) continue;
      const obs: MarathonRehearsalObservation = {
        id: row.id, date: row.date, kind, segmentMi, precedingMi,
        paceSecPerMi: Math.round(heatNormalisedPace(mean, row.tempF, row.distanceMi)),
        rawPaceSecPerMi: Math.round(mean), meanHrPctLthr: roundTo(hrPct, 3),
        cvPct: roundTo(cv, 1), tempF: row.tempF,
      };
      if (!best || obs.segmentMi > best.segmentMi) best = obs;
      break; // longest window from this start found
    }
  }
  return best;
}

export async function loadMarathonRehearsals(userUuid: string, todayISO?: string): Promise<{ observations: MarathonRehearsalObservation[]; lthrBpm: number | null }> {
  const today = todayISO ?? await runnerToday(userUuid);
  const lthr = await resolveThresholdHr(userUuid);
  if (!lthr) return { observations: [], lthrBpm: null };
  const fromISO = isoDaysBefore(today, MARATHON_REHEARSAL_WINDOW_DAYS);
  const canonicalIds = await getCanonicalRunIds(userUuid, fromISO, today);
  if (canonicalIds.length === 0) return { observations: [], lthrBpm: lthr.bpm };
  const rows = await pool.query<{ id: string; date: string; mi: number | string; splits: unknown; temp_f: string | null }>(
    `SELECT r.id::text, ${runDateKeySql('r')} AS date, ${runDistanceMiSql('r')} AS mi,
            ${runSplitsSql('r')} AS splits, ${runTempFSql('r')} AS temp_f
       FROM runs r
      WHERE r.user_uuid = $1::uuid
        AND r.id = ANY($3::bigint[])
        AND ${runDistanceMiSql('r')} >= $4
        AND (${runDateKeySql('r')})::date >= $2::date
        AND COALESCE(${runWorkoutTypeSql('r')}, ${runTypeSql('r')}, '') <> 'race'
      ORDER BY (${runDateKeySql('r')})::date ASC`,
    [userUuid, fromISO, canonicalIds, MARATHON_TEMPO_MIN_SEGMENT_MI],
  ).then((r) => r.rows);
  const observations: MarathonRehearsalObservation[] = [];
  for (const r of rows) {
    const obs = qualifyingMarathonRehearsal({
      id: r.id, date: r.date, distanceMi: Number(r.mi), splits: r.splits,
      tempF: r.temp_f != null ? Number(r.temp_f) : null, lthrBpm: lthr.bpm,
    });
    if (obs) observations.push(obs);
  }
  return { observations, lthrBpm: lthr.bpm };
}

/** Pure · the read. Median demonstrated pace; refuses below the doctrine bar. */
export function aggregateMarathonRehearsals(
  observations: readonly MarathonRehearsalObservation[],
  opts: { lthrBpm: number | null; minSessions?: number } = { lthrBpm: null },
): TrainingDurabilityRead {
  if (!opts.lthrBpm) return { ok: false, reason: 'no_lthr', observations: observations.length };
  const min = opts.minSessions ?? MARATHON_REHEARSAL_MIN_SESSIONS;
  if (observations.length === 0) return { ok: false, reason: 'no_observations', observations: 0 };
  if (observations.length < min) return { ok: false, reason: 'insufficient_corroboration', observations: observations.length };
  const paces = [...observations].map((o) => o.paceSecPerMi).sort((a, b) => a - b);
  const mid = Math.floor(paces.length / 2);
  const median = paces.length % 2 ? paces[mid] : Math.round((paces[mid - 1] + paces[mid]) / 2);
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
  const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) * (b - mean), 0) / paces.length);
  const countScore = clamp01((observations.length - min + 1) / 3);
  const consistencyScore = clamp01(1 - (sd / mean) / 0.05);
  const confidence = clamp01((countScore + consistencyScore) / 2);
  const reasons = [
    `${observations.length} rehearsals in the final ${MARATHON_REHEARSAL_WINDOW_DAYS} days`,
    ...(observations.some((o) => o.kind === 'fast_finish_long') ? ['FAST_FINISH_LONG_RUNS'] : []),
    ...(observations.some((o) => o.kind === 'mp_tempo') ? ['MARATHON_PACE_TEMPOS'] : []),
  ];
  return { ok: true, demonstratedPaceSecPerMi: median, confidence, observations: observations.length, supporting: [...observations], reasons };
}

export async function resolveTrainingDurability(userUuid: string, todayISO?: string): Promise<TrainingDurabilityRead> {
  const { observations, lthrBpm } = await loadMarathonRehearsals(userUuid, todayISO);
  return aggregateMarathonRehearsals(observations, { lthrBpm });
}
