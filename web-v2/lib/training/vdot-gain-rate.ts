/**
 * lib/training/vdot-gain-rate.ts · THE ONE VDOT gain-rate model.
 *
 * ── Why this file exists (2026-08-18) ──────────────────────────────────────
 *
 * The engine carried THREE mutually incompatible answers to "how fast can a
 * runner's VDOT rise":
 *
 *   | where                                   | rate      | provenance          |
 *   |-----------------------------------------|-----------|---------------------|
 *   | goal-ready.ts MAX/CONSERVATIVE_RATE     | 0.167-0.25| read out of Research/01 |
 *   | fitness-trajectory.ts BASE_BUILD_RATE   | 0.35      | labelled convention |
 *   | goal-gap.ts closableSecPerWeek header   | 0.50      | FABRICATED          |
 *
 * The third one said `Per Daniels: realistic VDOT change in 1 week is ~0.5 pts`.
 * That figure appears NOWHERE in `Research/`. It was the fourth fabricated
 * citation found in this codebase (after `spec-builder#conservativeVdotFromMileage`,
 * the simulator's VDOT response curves, and BASE_BUILD_RATE's "Research/00a
 * periodization"), and it slipped the 2026-08-17 book-citation sweep only
 * because it wrote `Per Daniels:` where the sweep grepped for `Cite:`.
 *
 * It was not decorative. It justified the per-distance seconds ladder
 * (8 / 18 / 40 / 90 sec per week) that decides whether the app tells a runner
 * their goal is still reachable — so the engine kept saying "still closable"
 * roughly 1.5-2x longer than an honest read supports.
 *
 * ── What the doctrine actually says ───────────────────────────────────────
 *
 * `Research/01-pace-zones-vdot.md` §"Testing cadence — how often to
 * deliberately test" is the ONLY passage in `Research/` that puts a VDOT
 * change on a clock. Two sentences of it, together, are the whole model:
 *
 *   · "Daniels recommends reassessing fitness every 4-6 weeks during a
 *      build block."
 *   · the trigger table's improvement row: "Tempo runs feel notably easier
 *      (sustained) | +1 VDOT estimated; field-test within 2 weeks".
 *
 * One VDOT point per reassessment block, and a reassessment block is 4-6
 * weeks. That is a BAND, not a point estimate:
 *
 *      fast edge   1 pt / 4 wk = 0.250 VDOT/wk
 *      slow edge   1 pt / 6 wk = 0.167 VDOT/wk
 *
 * `Research/00a` §"Aerobic Base Development" grounds the SHAPE (adaptation
 * compounds over weeks and saturates as a trained runner nears their ceiling)
 * and states no rate — it does not mention VDOT at all. Nothing else in
 * `Research/` states a per-week improvement figure, so nothing else is used.
 *
 * ── How the three were reconciled ─────────────────────────────────────────
 *
 * To the doctrine band, everywhere. `goal-ready.ts` was already right and now
 * imports these constants instead of re-deriving them; `BASE_BUILD_RATE` and
 * `BUILD_RATE_VDOT_PER_WEEK` (both 0.35, both convention) become the doctrine
 * FAST edge, 0.25 — the most permissive rate research supports; and the 0.5
 * fabrication is deleted, with the seconds ladder it justified replaced by a
 * per-runner derivation off the Daniels table (see `closableSecPerWeek`).
 *
 * No fourth number was invented. Every constant below is either read out of
 * `Research/01` or arithmetic on two that are, and every one of them is bound
 * by `ADAPTATION.vdot-gain-rate` in lib/doctrine/registry.ts, which parses the
 * band out of the doc at run time rather than hardcoding both sides.
 *
 * ── Honesty posture ───────────────────────────────────────────────────────
 *
 * Everything derived here is MODELLED, never measured. A gain this module
 * sizes has not happened yet; it is what doctrine says a block can deliver.
 * Callers must render it as projected. That is the one sin this app has
 * already shipped once (a native "Fitness" tile that read a modelled
 * buildRatio as a measured verdict) and the reason `projectedVdot` is named
 * the way it is.
 *
 * Cite: Research/01-pace-zones-vdot.md §"Testing cadence"
 * Cite: Research/00a-distance-running-training.md §"Aerobic Base Development"
 */

import { predictRaceTime } from './vdot';

/** Doctrine's reassessment cadence, weeks. Research/01 §Testing cadence:
 *  "reassessing fitness every 4-6 weeks during a build block". */
export const ASSESSMENT_BLOCK_WEEKS_FAST = 4;
export const ASSESSMENT_BLOCK_WEEKS_SLOW = 6;

/** VDOT credited per reassessment block. Research/01 §Testing cadence trigger
 *  table, improvement row: "+1 VDOT estimated". */
export const VDOT_PER_ASSESSMENT_BLOCK = 1;

/**
 * The most a build can be modelled to deliver, VDOT points per week.
 * `VDOT_PER_ASSESSMENT_BLOCK / ASSESSMENT_BLOCK_WEEKS_FAST` = 0.25.
 *
 * This is the ceiling on MODELLED future gain everywhere in the engine. A
 * runner may of course beat it — that shows up as a measured anchor or as the
 * over-performance bonus, both of which are evidence, not projection.
 */
export const VDOT_GAIN_PER_WEEK_MAX = VDOT_PER_ASSESSMENT_BLOCK / ASSESSMENT_BLOCK_WEEKS_FAST;

/**
 * The slow edge of the same doctrine band, `1 / 6` = 0.167 VDOT/wk. Used
 * wherever the engine must state the CONSERVATIVE end of a projection (the
 * safe target, the "latest you'd be ready" date).
 */
export const VDOT_GAIN_PER_WEEK_CONSERVATIVE =
  VDOT_PER_ASSESSMENT_BLOCK / ASSESSMENT_BLOCK_WEEKS_SLOW;

/** Per-day forms, for date-crossing projections. */
export const VDOT_GAIN_PER_DAY_MAX = VDOT_GAIN_PER_WEEK_MAX / 7;
export const VDOT_GAIN_PER_DAY_CONSERVATIVE = VDOT_GAIN_PER_WEEK_CONSERVATIVE / 7;

/**
 * Ceiling on the modelled gain from ONE training block, VDOT points.
 *
 * Doctrine states no block-gain ceiling directly. The largest VDOT swing
 * `Research/01` quantifies for a short interruption of training is the
 * §"Triggers to retest" layoff row — "Returning from layoff >=2 weeks | Drop
 * ~3-5 VDOT" — so 5 points is the biggest single-block fitness movement the
 * doctrine puts a number on in either direction. The engine will not model a
 * build delivering more than that in one block.
 *
 * At `VDOT_GAIN_PER_WEEK_MAX` this ceiling binds at 20 build weeks, which is
 * longer than any block the generator sizes, so in practice the rate is what
 * is visible and the ceiling is a backstop.
 */
export const MAX_BLOCK_GAIN_VDOT = 5.0;

/**
 * The largest upward re-estimate doctrine grants off a single observation,
 * without a build behind it.
 *
 * `Research/01` §"Triggers to retest": "Last race beat predicted time by >30
 * sec/mi | Add 2-3 VDOT points; field-test". Three points is the biggest
 * one-shot correction the doc allows. It is NOT a gain rate and must never be
 * added to a projection; it exists so the goal assessment can distinguish a
 * goal that is merely beyond the modelled build (which latent, unmeasured
 * fitness of the size doctrine recognises could still cover) from one that is
 * beyond the build AND beyond that headroom, which is the honest
 * "out of reach" line.
 */
export const LATENT_VDOT_UPGRADE_MAX = 3;

/**
 * The smallest VDOT movement the engine treats as real rather than noise.
 *
 * `Research/01` §"Update logic" is explicit about the actionable quantum:
 * `if abs(new_VDOT - current_VDOT) >= 1: regenerate_all_paces()`. One point is
 * where doctrine re-derives paces. This grace is deliberately far INSIDE that
 * — a fifth of it — because it gates a display verdict ("reachable", "ahead of
 * goal"), not a pace change, and it must never swallow a difference doctrine
 * would act on.
 */
export const PROJECTION_NOISE_GRACE_VDOT = 0.2;

/**
 * Seconds of finish time that `deltaVdot` is worth, for THIS runner at THIS
 * distance, off the Daniels table.
 *
 * This replaces the hardcoded 8/18/40/90 sec-per-week ladder that the 0.5
 * fabrication justified. Two things were wrong with a fixed ladder beyond its
 * provenance: it was blind to the runner's own fitness (a VDOT point is worth
 * far more seconds to a 3:50 marathoner than to a 2:30 one), and its four
 * hardcoded rows were a per-distance doctrine table nobody was watching.
 *
 * Returns null past the Daniels validity range (`predictRaceTime` already
 * refuses beyond the marathon, Research/02 §14 rule 6) or with no usable VDOT.
 */
export function secondsPerVdotDelta(
  currentVdot: number | null | undefined,
  distanceMi: number | null | undefined,
  deltaVdot: number,
): number | null {
  if (currentVdot == null || !(currentVdot > 0)) return null;
  if (distanceMi == null || !(distanceMi > 0)) return null;
  if (!(deltaVdot > 0)) return null;
  const now = predictRaceTime(currentVdot, distanceMi);
  const fitter = predictRaceTime(currentVdot + deltaVdot, distanceMi);
  if (now == null || fitter == null) return null;
  const gain = now - fitter;
  return gain > 0 ? gain : null;
}

/**
 * Seconds of finish time a week of well-executed training can be modelled to
 * buy this runner at this distance — the honest replacement for the fabricated
 * `closableSecPerWeek` ladder.
 *
 * Sized at the FAST edge of the doctrine band deliberately: this feeds the
 * "is the goal still closable" test, and that test should fail only when even
 * the most permissive rate research supports cannot get there.
 */
export function closableSecPerWeek(
  currentVdot: number | null | undefined,
  distanceMi: number | null | undefined,
): number | null {
  return secondsPerVdotDelta(currentVdot, distanceMi, VDOT_GAIN_PER_WEEK_MAX);
}

/**
 * The distance-correct seconds equivalent of the VDOT noise grace.
 *
 * The two grace constants in fitness-trajectory.ts were calibrated at
 * half-marathon scale (0.2 VDOT, and a flat 30 sec) and applied at every
 * distance, so the seconds one could never fire correctly for a 5K runner —
 * 30 seconds is a rout over 5K and inside the noise over a marathon. There is
 * ONE grace, stated in VDOT, and the seconds form is derived per distance.
 */
export function noiseGraceSec(
  currentVdot: number | null | undefined,
  distanceMi: number | null | undefined,
): number | null {
  return secondsPerVdotDelta(currentVdot, distanceMi, PROJECTION_NOISE_GRACE_VDOT);
}
