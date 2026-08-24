/**
 * FITNESS MODEL (A) · "what can this athlete race today?"
 *
 * Design/adaptive-progression-engine.md §A. The doctrine's demand, verbatim:
 *
 *     Output is a range with a confidence level:
 *         HM fitness estimate: 1:38-1:40
 *         confidence: high
 *     Never `1:38:17`. Fake precision is a lie about how well we know the number.
 *
 * and its conformance note on where the code stood when it was locked:
 *
 *     `bestRecentVdot` already assembles `considered[]` - a full candidate
 *     distribution - and discards everything but `[0]` (`vdot.ts:1091`).
 *     **The range is nearly free.**
 *
 * This module spends that. It is a pure widening of an existing read:
 *
 *   THE POINT ESTIMATE DOES NOT MOVE. `resolveFitness` takes the already-selected
 *   `best` candidate and republishes `best.vdot` byte-identically. It re-runs no
 *   selection, applies no adjustment, and has no opinion about which candidate
 *   should have won. Every prescribed pace in the app is anchored on that number
 *   and none of them shift because this file exists. What is new is the band
 *   around it and the honesty about how well it is known.
 *
 * WHAT THE BAND IS MADE OF. Four inputs, every width in cited units:
 *
 *   1. Measurement error of the anchor itself (Research/02 §13.7 span table,
 *      §4.3 reported accuracy).
 *   2. Age of the anchor (Research/01 §"Freshness window", the same 28/56/84
 *      day bands `bestRecentVdot` already ranks on).
 *   3. Whether the anchor is a race or a training estimate (Research/01
 *      §"Testing cadence" - a training read is a "+1 VDOT estimated" LEAD, not
 *      a verdict, so it cannot claim a band tighter than that quantum).
 *   4. Whether independent evidence agrees. Two reads that disagree by 5% do
 *      not license a 2% band no matter how fresh either one is.
 *
 * NON-GOAL · this file does not decide anything. It reports. Nothing here
 * prescribes, projects, or writes. Fitness is evidence; per doctrine rules 1
 * and 2, no amount of elapsed calendar time or completed plan touches it, and
 * there is no input on this function through which either could.
 */

import {
  predictRaceTime,
  VDOT_FULL_VALUE_DAYS,
  VDOT_EXPIRY_DAYS,
  FRESH_RACE_PRECEDENCE_DAYS,
  type VdotCandidate,
} from '../training/vdot';

// ---------------------------------------------------------------------------
// Constants · every one of these is read out of the research, not chosen here.
// ---------------------------------------------------------------------------

/**
 * Research/02 §13.7 "Confidence Intervals to Report with Predictions", keyed by
 * distance. These are the SAME three numbers already shipped in
 * `goal-projection.ts:computeConfidenceInterval` (2.0 / 2.5 / 3.0 on the
 * ≤6.5 / ≤16 / >16 mi buckets). Reused rather than re-derived so the fitness
 * band and the goal band speak in one voice.
 *
 * WHY KEYED ON THE ANCHOR'S DISTANCE, where the goal band keys on the TARGET's.
 * The two functions ask different questions. `computeConfidenceInterval` asks
 * "how precisely can we predict a race at distance D", so the span it is
 * pricing ends at D. This function asks "how precisely does the measurement we
 * actually hold pin the runner's fitness", so the span it is pricing starts at
 * the anchor. The ladder runs the same direction either way: Research/02 §4.3
 * says VDOT errors are "typically 1-3% in well-trained runners" over 5K to
 * half, and that a marathon read assumes a runner "can sustain ~84-86% VO2max
 * for the duration - true only for runners with a marathon-specific aerobic
 * block". A marathon result is the noisiest read of underlying VDOT there is
 * (pacing, fuelling and glycogen all sit between the fitness and the finish
 * time), so a marathon anchor earns the widest bucket. Same table, honest
 * reading of it from the other end.
 */
const BASE_PCT_SHORT = 2.0; // anchor ≤ 6.5 mi
const BASE_PCT_MID = 2.5;   // anchor ≤ 16 mi
const BASE_PCT_LONG = 3.0;  // anchor > 16 mi
const MID_DISTANCE_MI = 6.5;
const LONG_DISTANCE_MI = 16;

/**
 * Research/02 §13.7 final row: "Cross-prediction with > 6-month-old input |
 * ±8%". `computeConfidenceInterval` already implements this override at
 * STALE_DAYS = 180; mirrored here at the same threshold so the two bands agree
 * about what "stale" costs.
 *
 * In practice `bestRecentVdot` expires candidates at VDOT_EXPIRY_DAYS (84), so
 * this fires only for a caller that hands us a candidate from outside that
 * window. It is kept because the alternative - silently pricing a 200-day-old
 * result at the fresh-anchor rate - is exactly the fake precision the doctrine
 * forbids.
 */
const STALE_INPUT_DAYS = 180;
const STALE_INPUT_PCT = 8.0;

/**
 * Staleness ladder. The BANDS are Research/01 §"Freshness window"'s own four
 * rows, and they are not restated here - they are the constants `bestRecentVdot`
 * already ranks candidates on, imported above:
 *
 *   ≤ 28 d  FRESH_RACE_PRECEDENCE_DAYS  "Fresh signal. Use without adjustment."
 *   ≤ 56 d  VDOT_FULL_VALUE_DAYS        "Slightly stale. Still usable..."
 *   ≤ 84 d  VDOT_EXPIRY_DAYS            "Stale... Use only as a floor..."
 *
 * The MULTIPLIERS are the 1.0 / 1.25 / 1.5 ladder already shipped in
 * `computeConfidenceInterval`'s status scaling. Reused deliberately: doctrine
 * grades staleness in three steps and the codebase already owns a three-step
 * uncertainty ladder, so this borrows that rather than inventing a fourth set
 * of numbers for the same shape of judgement.
 */
const MULT_FRESH = 1.0;
const MULT_SLIGHTLY_STALE = 1.25;
const MULT_FLOOR_ONLY = 1.5;

/**
 * Research/01 §"Testing cadence": "Tempo runs feel notably easier (sustained) |
 * +1 VDOT estimated; field-test within 2 weeks", and §"Triggers to retest" says
 * the same for a sustained HR drop. A training read is licensed to LEAD the
 * last hard proof of fitness by one VDOT point, and that point is explicitly
 * unconfirmed until a race or field test lands.
 *
 * So a training-anchored estimate carries an error a race-anchored one does
 * not. ADDITIVE, not a floor: the two are independent sources. Every timed
 * effort carries the §13.7 measurement error above, and a training read carries
 * that PLUS the confirmation gap - the amount doctrine says it may be leading
 * the runner's real, proven fitness by. A max() of the two would let a long
 * training anchor's own measurement error swallow the confirmation gap and
 * report exactly as tightly as a race, which is the claim doctrine denies.
 *
 * Numerically the same 1.0 as `vdot.ts:TRAINING_ESTIMATE_SOFT_CAP_VDOT`, and
 * for the same reason from the same passage - that constant bounds how far a
 * training read may move the point estimate, this one bounds how tightly a
 * training read may claim to know it. Declared locally rather than imported so
 * this module adds no export to vdot.ts.
 */
const TRAINING_ANCHOR_EXTRA_HALF_WIDTH_VDOT = 1.0;

/**
 * Research/02 §4.3: "For 5K-half-marathon predictions VDOT errors are typically
 * 1-3% in well-trained runners." Two independent reads that land inside that
 * 3% are agreeing to within the measurement's own noise, which is the strongest
 * corroboration evidence can offer. Past it they are telling different stories
 * and the band has to hold both.
 */
const AGREEMENT_MAX_PCT = 3.0;

/**
 * The widest band the standard machinery can produce on its own: the longest
 * anchor bucket at the stalest multiplier. A band wider than this got that way
 * because the evidence disagrees, which is a low-confidence read by definition.
 * Derived, not chosen, so it tracks the constants above if they ever move.
 */
const MAX_STANDARD_PCT = BASE_PCT_LONG * MULT_FLOOR_ONLY;

/** Canonical distances, matching `goalDistanceMiFromCode` in vdot.ts. */
const RACE_DISTANCES = {
  '5k': 3.10686,
  '10k': 6.21371,
  hm: 13.1094,
  m: 26.2188,
} as const;

/**
 * Reporting granularity, per distance. The doctrine's whole complaint is
 * `1:38:17`, so nothing here is allowed to resolve finer than 10 seconds, and
 * the long events resolve at 30. Rounding is always OUTWARD (floor the fast
 * edge, ceil the slow edge) so presenting the band can only ever widen it.
 * Rounding a range inward would manufacture confidence at the display layer,
 * which is the same lie one step later.
 */
const ROUND_SEC = {
  '5k': 10,
  '10k': 10,
  hm: 30,
  m: 30,
} as const;

export type RaceKey = keyof typeof RACE_DISTANCES;
export type FitnessConfidence = 'high' | 'medium' | 'low';

export interface FitnessEstimate {
  /** The point estimate. Exactly `best.vdot` from `bestRecentVdot`, unchanged. */
  vdot: number;
  /**
   * Faster edge of the band. NOTE THE ORIENTATION: "lo" and "hi" name the
   * finishing TIME, not the VDOT number, matching the sibling
   * `ConfidenceInterval { lo, hi }` in goal-projection.ts, which is in seconds.
   * The faster edge is therefore the HIGHER VDOT, and `vdotLo >= vdot >= vdotHi`
   * holds numerically. One orientation across the codebase beats two.
   */
  vdotLo: number;
  /** Slower edge of the band. The LOWER VDOT. See `vdotLo`. */
  vdotHi: number;
  confidence: FitnessConfidence;
  /**
   * The anchor's own race distance, in miles.
   *
   * Already the input to every width decision in this file, and it was the one
   * thing a consumer could not recover from the output: `considered` carries
   * no distance, and `races` prices every key off the same two band edges, so
   * nothing downstream could tell whether this read came off a 10K or a
   * marathon. A surface that wants to report the range at the distance the
   * evidence actually covers needs to know which one that is. Reported, not
   * decided — same posture as `basis`.
   */
  anchorDistanceMi: number | null;
  /** Why the band is this wide, in one plain line the runner could verify. */
  basis: string;
  /** Provenance of every candidate that informed the band. */
  considered: Array<{ vdot: number; source: string; ageDays: number; weight: number }>;
  /** Race-equivalent times at canonical distances, as ranges. */
  races: Record<RaceKey, { loSec: number; hiSec: number }>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Invert `predictRaceTime` onto the VDOT scale, clamped to Daniels' published
 * [30, 85]. Deliberately NOT `vdotFromRace`, which returns null outside the
 * table: a band edge that runs off the end of the table should sit ON the end
 * of the table, not annihilate the whole estimate. Clamping is the honest
 * degradation ("we can't see past the table"); null would throw away a real
 * reading because its error bar is wide.
 */
function vdotForTime(sec: number, distanceMi: number): number {
  const slowest = predictRaceTime(30, distanceMi);
  const fastest = predictRaceTime(85, distanceMi);
  if (slowest != null && sec >= slowest) return 30;
  if (fastest != null && sec <= fastest) return 85;
  let lo = 30;
  let hi = 85;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const t = predictRaceTime(mid, distanceMi);
    if (t == null) break;
    // Higher VDOT predicts a faster (smaller) time.
    if (t > sec) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/** Research/02 §13.7 bucket for the anchor's own distance. */
function basePctForAnchorDistance(distanceMi: number): number {
  if (distanceMi <= MID_DISTANCE_MI) return BASE_PCT_SHORT;
  if (distanceMi <= LONG_DISTANCE_MI) return BASE_PCT_MID;
  return BASE_PCT_LONG;
}

/** Research/01 §"Freshness window" ladder. */
function freshnessMultiplier(ageDays: number): number {
  if (ageDays <= FRESH_RACE_PRECEDENCE_DAYS) return MULT_FRESH;
  if (ageDays <= VDOT_FULL_VALUE_DAYS) return MULT_SLIGHTLY_STALE;
  return MULT_FLOOR_ONLY;
}

/**
 * Descriptive provenance weight for a candidate. This does NOT size the band -
 * every width above comes from a cited percentage. Weight exists so a consumer
 * (and the runner) can see at a glance which evidence carried the read.
 *
 * THE ORDERING IS NOT FREE-CHOSEN. It has to agree with the ordering
 * `bestRecentVdot` already selects on, or the app would show a weight column
 * that contradicts its own anchor. Two rules come from there:
 *
 *   · A race outranks a training estimate at equal freshness. Research/01
 *     §"Triggers to retest": only a race or field test updates VDOT.
 *   · FLOOR-ONLY DEMOTION - a candidate past the full-value window ranks below
 *     EVERY in-window candidate however strong it is (vdot.ts's `demoted`
 *     predicate, Research/01 §"Freshness window": "use only as a floor"). So a
 *     70-day-old race must weigh less than a fresh training run, not more.
 *
 * That second rule is the binding constraint on the numbers: the heaviest
 * floor-only candidate (race × FLOOR_ONLY_WEIGHT) must come in under the
 * lightest in-window one (run × RECENT_WEIGHT = 0.375). `_fitness_model.test.ts`
 * asserts that invariant rather than the individual values, so the ladder can
 * be retuned without silently inverting against the selector.
 */
const SOURCE_WEIGHT_RACE = 1.0;
const SOURCE_WEIGHT_RUN = 0.5;
const FRESH_WEIGHT = 1.0;       // ≤ 28 d
const RECENT_WEIGHT = 0.75;     // ≤ 56 d
const FLOOR_ONLY_WEIGHT = 0.3;  // ≤ 84 d · under 0.375, per the demotion rule
const EXPIRED_WEIGHT = 0.15;    // > 84 d · past what the selector will anchor on

function candidateWeight(c: VdotCandidate): number {
  const source = c.source === 'race' ? SOURCE_WEIGHT_RACE : SOURCE_WEIGHT_RUN;
  const fresh =
    c.age_days <= FRESH_RACE_PRECEDENCE_DAYS ? FRESH_WEIGHT
      : c.age_days <= VDOT_FULL_VALUE_DAYS ? RECENT_WEIGHT
        : c.age_days <= VDOT_EXPIRY_DAYS ? FLOOR_ONLY_WEIGHT
          : EXPIRED_WEIGHT;
  return Math.round(source * fresh * 100) / 100;
}

/** Stable, readable provenance string: which record produced this candidate. */
function provenanceOf(c: VdotCandidate): string {
  return c.source === 'race' ? `race:${c.slug}` : `run:${c.id}`;
}

/** Human label for the anchor, for the basis line. */
function anchorLabel(c: VdotCandidate): string {
  if (c.source === 'race') return c.name?.trim() || 'a recent race';
  const t = (c.workout_type ?? '').trim().toLowerCase();
  return t ? `a ${t} run` : 'a training run';
}

function pluralDays(n: number): string {
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Widen `bestRecentVdot`'s scalar into the doctrine's range + confidence.
 *
 * Takes the already-computed selection rather than the raw races/runs on
 * purpose. Re-running selection here would create a second place in the app
 * that decides what the runner's fitness is, and the two would drift. Feeding
 * it `bestRecentVdot`'s own output makes "the point estimate is unchanged" true
 * by construction instead of true by test.
 *
 * Returns null when there is no candidate at all - a runner with no evidence
 * has no fitness estimate, and inventing a band around nothing would be the
 * same lie in a wider costume. (Callers holding a `belowTableAnchor` still have
 * an honest demonstrated pace; that path is `AnchorPace`, not this one.)
 */
export function resolveFitness(input: {
  /** `bestRecentVdot(...).best` - the selected anchor, unchanged. */
  best: VdotCandidate | null;
  /** `bestRecentVdot(...).considered` - the full candidate distribution. */
  considered: VdotCandidate[];
}): FitnessEstimate | null {
  const { best } = input;
  if (!best) return null;

  const considered = input.considered ?? [];
  const anchorDistMi = best.distance_mi;
  const anchorAge = best.age_days;

  // --- 1 · corroboration -----------------------------------------------------
  // A candidate corroborates when it is independent evidence still inside the
  // full-value window (Research/01: past 56 days a result is "use only as a
  // floor", which is not a cross-check). Identity comparison first because
  // `best` IS `considered[0]` by construction; the index fallback covers a
  // caller that reconstructed the array.
  //
  // A TRAINING READ IS A FLOOR, NOT A CROSS-CHECK (2026-08-24). This filter
  // used to accept any in-window candidate, which read a slow training run as
  // evidence DISAGREEING with the anchor. It is not, and `vdot.ts` says so in
  // its own words at `vdotFromRun`: "bestRecentVdot takes the MAX, so this can
  // only RAISE current fitness from honest training, never lower it." Every
  // run candidate is built under that max-only contract - it is a "virtual
  // race" reading of a run that was not a race, admitted by the honesty gate
  // on workout type OR avg HR ≥ 80% of max. So a run that comes in LOW says
  // "the runner did not demonstrate more than this today", which is
  // consistent with a faster anchor, not in conflict with it.
  //
  // This module already cites the doctrine that settles it, three constants
  // up in `candidateWeight`: Research/01 §"Triggers to retest" - only a race
  // or field test updates VDOT. A source that cannot update the point estimate
  // cannot be the thing that widens the band around it either.
  //
  // Found on live data. David's anchor is a chip-timed A half from 8 days ago
  // (1:41:53). His only other in-window candidates are training runs, two of
  // them easy running inside a post-race recovery block that cleared the HR
  // gate in August heat. Reading those as disagreement priced the band at ±8%
  // and dropped the tier to `low`: an HM range of 1:33:30-1:50:30 around a
  // half he had just run. The band was 17 minutes wide because the model was
  // asking easy runs how fast he can race.
  const corroborating = considered.filter((c, i) => {
    if (c === best) return false;
    // Reconstructed array: `considered[0]` is the anchor by construction, so a
    // structurally-equal clone at index 0 is the anchor too. Without this, an
    // anchor would corroborate itself - evidenceCount 2 at zero spread, which
    // reads as agreement and would hand out an unearned 'high'.
    if (i === 0 && c.source === best.source && c.vdot === best.vdot
      && c.age_days === best.age_days) return false;
    if (c.source !== 'race') return false;
    return c.age_days <= VDOT_FULL_VALUE_DAYS;
  });
  const evidenceCount = 1 + corroborating.length;

  // Disagreement, priced in percent of finish time at the anchor's distance so
  // it is directly comparable with the §13.7 span percentages.
  //
  // MEASURED IN BOTH DIRECTIONS. This used to seed the reduce at `best.vdot`
  // on the stated grounds that "the anchor is the maximum of the distribution,
  // so every corroborating read is at or below it". That is not true, and
  // David's own data is the counterexample: `bestRecentVdot`'s fresh-race
  // precedence seats his 44.1 half from 8 days ago above training reads of
  // 45.1, so `considered` runs ABOVE the anchor. The seed silently discarded
  // any such candidate instead of pricing it. Now the spread is the largest
  // absolute deviation among corroborating races, either side - a fresher race
  // that reads slower than an older one is a genuine disagreement whichever
  // way round the two land, and the band has to hold both. This can only ever
  // widen a band, never narrow one, which is the safe direction for a module
  // whose whole job is to not overstate how well it knows the number.
  const anchorSec = predictRaceTime(best.vdot, anchorDistMi);
  let spreadPct = 0;
  if (anchorSec != null && anchorSec > 0 && corroborating.length > 0) {
    for (const c of corroborating) {
      const otherSec = predictRaceTime(c.vdot, anchorDistMi);
      if (otherSec == null) continue;
      spreadPct = Math.max(spreadPct, Math.abs((otherSec - anchorSec) / anchorSec) * 100);
    }
  }

  // --- 2 · band width --------------------------------------------------------
  const basePct = basePctForAnchorDistance(anchorDistMi);
  const staleOverride = anchorAge > STALE_INPUT_DAYS;
  const mult = freshnessMultiplier(anchorAge);
  let pct = staleOverride ? STALE_INPUT_PCT : basePct * mult;

  // Disagreement widening. A symmetric band centred on the anchor reaches
  // halfway to a corroborating read that sits `spreadPct` away when its
  // half-width is spreadPct/2. Half rather than all of it: the slower read is
  // evidence that fitness may be lower, not proof that it is - the anchor won
  // selection on the engine's own doctrine and keeps its centre.
  //
  // SYMMETRY IS A CHOICE, and it is the shipped one. `computeConfidenceInterval`
  // is symmetric too, and defers its §13.1 one-sided-pessimism case for the
  // same reason: selecting the maximum of a distribution genuinely biases the
  // point estimate upward, so a rigorous band would widen the slow edge harder.
  // `bestRecentVdot` already carries that bias's antidotes (the +1 training soft
  // cap, floor-only demotion, the stale fade), and matching the sibling
  // function's shape beats a second convention. Recorded here as a known
  // refinement, not an oversight.
  const disagreementPct = spreadPct / 2;
  pct = Math.max(pct, disagreementPct);

  const centerSec = anchorSec;
  let vdotLo = best.vdot; // faster edge · higher VDOT
  let vdotHi = best.vdot; // slower edge · lower VDOT
  if (centerSec != null && centerSec > 0) {
    vdotLo = vdotForTime(centerSec * (1 - pct / 100), anchorDistMi);
    vdotHi = vdotForTime(centerSec * (1 + pct / 100), anchorDistMi);
  }

  // Training-anchor confirmation gap, added on top of the measurement error.
  // An unconfirmed training read is uncertain by everything a race is uncertain
  // by, plus the +1 VDOT quantum it may be leading proven fitness by.
  const trainingAnchored = best.source === 'run';
  if (trainingAnchored) {
    vdotLo = Math.min(85, vdotLo + TRAINING_ANCHOR_EXTRA_HALF_WIDTH_VDOT);
    vdotHi = Math.max(30, vdotHi - TRAINING_ANCHOR_EXTRA_HALF_WIDTH_VDOT);
  }

  // The band must contain the point estimate even where table clamping bit.
  vdotLo = Math.round(Math.max(vdotLo, best.vdot) * 10) / 10;
  vdotHi = Math.round(Math.min(vdotHi, best.vdot) * 10) / 10;

  // --- 3 · confidence --------------------------------------------------------
  // Low first: any single disqualifier decides, regardless of what else is
  // strong. Per CLAUDE.md's per-finding context rule, each test asks its own
  // question rather than inheriting a verdict from the band width alone.
  const staleAnchor = anchorAge > VDOT_FULL_VALUE_DAYS;
  const uncorroboratedTraining = trainingAnchored && evidenceCount < 2;
  const bandExceedsStandard = pct >= MAX_STANDARD_PCT;

  let confidence: FitnessConfidence;
  if (staleAnchor || uncorroboratedTraining || bandExceedsStandard) {
    confidence = 'low';
  } else if (
    best.source === 'race'
    && anchorAge <= FRESH_RACE_PRECEDENCE_DAYS
    && evidenceCount >= 2
    && spreadPct <= AGREEMENT_MAX_PCT
  ) {
    confidence = 'high';
  } else {
    confidence = 'medium';
  }

  // --- 4 · race-equivalent ranges -------------------------------------------
  const races = {} as Record<RaceKey, { loSec: number; hiSec: number }>;
  for (const key of Object.keys(RACE_DISTANCES) as RaceKey[]) {
    const dist = RACE_DISTANCES[key];
    const grain = ROUND_SEC[key];
    const fast = predictRaceTime(vdotLo, dist);
    const slow = predictRaceTime(vdotHi, dist);
    const loSec = fast != null ? Math.floor(fast / grain) * grain : 0;
    const hiSecRaw = slow != null ? Math.ceil(slow / grain) * grain : 0;
    races[key] = { loSec, hiSec: Math.max(loSec, hiSecRaw) };
  }

  // --- 5 · basis -------------------------------------------------------------
  const basis = buildBasis({
    best, anchorAge, evidenceCount, spreadPct, staleAnchor,
    trainingAnchored, staleOverride,
    disagreementDrove: disagreementPct > (staleOverride ? STALE_INPUT_PCT : basePct * mult),
    // Whether there was in-window training to look at, so the no-cross-check
    // line can say WHICH kind of evidence is missing. "Nothing else recent"
    // would be false on a runner with thirty logged runs and one race.
    hasInWindowTraining: considered.some(
      (c) => c !== best && c.source === 'run' && c.age_days <= VDOT_FULL_VALUE_DAYS),
  });

  return {
    vdot: best.vdot,
    vdotLo,
    vdotHi,
    confidence,
    anchorDistanceMi: Number.isFinite(anchorDistMi) ? anchorDistMi : null,
    basis,
    considered: considered.map((c) => ({
      vdot: c.vdot,
      source: provenanceOf(c),
      ageDays: c.age_days,
      weight: candidateWeight(c),
    })),
    races,
  };
}

/**
 * One line, coach voice: short, direct, no hype, no em dashes. It has to name
 * the anchor and the single biggest reason the band is the width it is, because
 * "confidence: low" without a reason is not something a runner can act on or
 * check. Anything the line claims is visible in the returned fields.
 */
function buildBasis(a: {
  best: VdotCandidate;
  anchorAge: number;
  evidenceCount: number;
  spreadPct: number;
  staleAnchor: boolean;
  trainingAnchored: boolean;
  staleOverride: boolean;
  disagreementDrove: boolean;
  hasInWindowTraining: boolean;
}): string {
  const head = `Anchored on ${anchorLabel(a.best)}, ${pluralDays(a.anchorAge)}.`;

  // Spread is always rounded UP, never to nearest. Rounding a disagreement down
  // reports better agreement than the evidence shows, which is the same lie as
  // `1:38:17` at a smaller scale, and it can print "agrees within 3 percent"
  // next to a confidence the 3% agreement bound just denied.
  const spread = Math.max(1, Math.ceil(a.spreadPct));

  if (a.disagreementDrove) {
    return `${head} Recent efforts disagree by about ${spread} percent, so the range is wider than the anchor alone would give.`;
  }
  if (a.staleOverride) {
    return `${head} That is well past the point where a result still reads as current fitness.`;
  }
  if (a.staleAnchor) {
    return `${head} Past eight weeks a result counts as a floor, not a current read.`;
  }
  if (a.trainingAnchored && a.evidenceCount < 2) {
    return `${head} Training reads are an estimate until a race or time trial confirms them.`;
  }
  if (a.trainingAnchored) {
    return `${head} No race in the window, so the range holds the gap a training read can be out by.`;
  }
  if (a.evidenceCount >= 2) {
    const others = a.evidenceCount - 1;
    return `${head} ${others === 1 ? 'One other recent effort agrees' : `${others} other recent efforts agree`} within ${spread} percent.`;
  }
  // The anchor is a race and no other race is in the window. Say that, rather
  // than "nothing else recent" — training is not nothing, it just is not the
  // kind of evidence that can confirm a race (Research/01 §"Triggers to
  // retest": only a race or field test updates VDOT).
  if (a.hasInWindowTraining) {
    return `${head} No other race in the window to check it against, and training runs cannot confirm a race.`;
  }
  return `${head} Nothing else recent to cross-check it against.`;
}
