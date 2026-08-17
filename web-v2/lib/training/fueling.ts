/**
 * Training fueling — slim port of legacy/web/lib/training-fueling.ts.
 *
 * Computes a gel + carb plan for any prescribed run based on duration,
 * workout type, and the runner's product preferences (fuel_brand,
 * fuel_gel_carbs_g, fuel_target_g_per_hr in users + profile).
 *
 * Doctrine: Research/18-fueling-products.md
 *   §1  carb intake by duration (60-90 g/hr for 2-3+ hours)
 *   §3  product profiles (Maurten 100 = 25g; GU = 22g; Beta Fuel = 44g)
 *   §11 during-race fueling BY DISTANCE (5K 0 · 10K 0-30 · HM 30-60 ·
 *       M 60-90) — read through lib/race/distance-doctrine.ts
 *   §13 gut training (Costa et al.) — long-run ramp toward race target
 *
 * 2026-08-17 doctrine-conformance audit · `DEFAULT_RACE_TARGET_G_PER_HR =
 * 75` was the MARATHON row applied to every race. A half-marathoner was
 * prescribed roughly double the §11 half band (30-60) and 15 g/hr past
 * §1's GI-distress threshold. The rate is now keyed to the race distance,
 * and the Costa ramp only ever climbs (see rampedTargetGPerHr).
 *
 * Why ported now: the schema has fuel_brand / fuel_gel_carbs_g /
 * fuel_target_g_per_hr columns but no consumer in v2. The prescription
 * for a 16mi long run currently says "long run · easy pace" — it
 * should say "long run · 4 Maurten 100s, take at 30/60/90/120 min."
 */

import { raceCarbsPerHourTarget } from '@/lib/race/distance-doctrine';

export const DEFAULT_GEL_CARBS_G = 22;

export type WorkoutFuelingType = 'easy' | 'long' | 'quality' | 'race' | 'rest';

export interface FuelingInput {
  durationEstMin: number;        // total run duration (min)
  distanceMi?: number | null;
  workoutType: WorkoutFuelingType;
  tempF?: number | null;          // heat reduces gut tolerance (§1)
  daysToARace?: number | null;
  raceFuelTargetGPerHr?: number | null;
  /** Distance of the goal RACE (mi) — not this run's distance. Sets the
   *  race-day target the gut-training ramp aims at (Research/18 §11 by
   *  distance). Null/absent → no ramp, the run's own duration governs. */
  raceDistanceMi?: number | null;
  gelCarbsG?: number | null;
  gelLabel?: string | null;       // "Maurten 100" → "2 Maurten 100s"
}

export interface FuelingPlan {
  needed: boolean;
  gels: number;
  atMins: number[];
  carbsTotalG: number;
  shortLine: string;             // "2 Maurten 100s, at 30 + 60 min"
  why: string;
  citation: string;
  // Wire fields for the watch's WatchFueling struct (strict decode — the
  // watch requires all of these when a fueling object is present).
  gPerHr: number;                // effective intake rate after heat penalty
  isRehearsal: boolean;          // inside the 56d Costa gut-training ramp
  heatAdjusted: boolean;         // heat penalty actually reduced the rate
}

/** Base carbs/hr by duration + workout type (Research/18 §1). */
function baseCarbsPerHr(durationMin: number, type: WorkoutFuelingType): number {
  if (type === 'rest') return 0;
  if (durationMin < 60) return 0;           // <1h: no fuel needed
  if (durationMin < 90) {
    return type === 'long' ? 30 : 0;        // easy/quality 1-1.5h: optional
  }
  if (durationMin < 120) return 40;         // 1.5-2h: 40 g/hr
  if (durationMin < 150) return 50;         // 2-2.5h: 50 g/hr
  if (durationMin < 180) return 60;         // 2.5-3h: 60 g/hr
  return 75;                                  // 3h+: 75 g/hr (build toward race target)
}

/** Heat penalty — high-temp + intensity reduce gut tolerance (§1). */
function heatGutPenalty(tempF: number | null | undefined): number {
  if (tempF == null) return 0;
  if (tempF >= 80) return 0.20;   // -20%
  if (tempF >= 75) return 0.15;
  if (tempF >= 70) return 0.10;
  return 0;
}

/** Race-aware ramp (Costa et al., §13). Long runs in the last 8 weeks
 *  before a race ramp toward race-day target so the gut is rehearsed.
 *
 *  The ramp only ever climbs. A 5K or 10K goal race has a race-day target
 *  of 0 g/hr (§11 :369-370); rehearsing THAT on a three-hour long run
 *  would strip the fuel the run's own duration requires (§1 :17-19).
 *  Rehearsal is an addition to the duration floor, never a subtraction. */
function rampedTargetGPerHr(
  base: number,
  workoutType: WorkoutFuelingType,
  daysToARace: number | null | undefined,
  raceTarget: number | null,
): number {
  if (raceTarget == null) return base;
  if (workoutType !== 'long' || daysToARace == null) return base;
  if (daysToARace > 56) return base;            // outside the ramp window
  // Linear ramp from base → raceTarget over the last 8 weeks (56 days).
  const t = Math.max(0, Math.min(1, (56 - daysToARace) / 56));
  return Math.max(base, Math.round(base + (raceTarget - base) * t));
}

export function computeFueling(input: FuelingInput): FuelingPlan {
  const {
    durationEstMin, workoutType, tempF, daysToARace,
    raceFuelTargetGPerHr, gelCarbsG, gelLabel, distanceMi,
  } = input;

  const baseRate = baseCarbsPerHr(durationEstMin, workoutType);

  // Race-day target · Research/18 §11 (:367-376) BY DISTANCE, not the
  // marathon row for everyone. The runner's own entered rate wins, except
  // where doctrine prescribes zero (5K/10K, :369-370) — a gel inside a
  // 20-minute race is a defect, not a preference.
  const raceDistMi = input.raceDistanceMi ?? (workoutType === 'race' ? (distanceMi ?? null) : null);
  const doctrineRaceTarget = raceDistMi != null
    ? raceCarbsPerHourTarget(raceDistMi, workoutType === 'race' ? durationEstMin * 60 : null).targetGPerHr
    : null;
  const raceTarget = raceFuelTargetGPerHr ?? doctrineRaceTarget;

  const targetRate = workoutType === 'race'
    ? (doctrineRaceTarget != null && doctrineRaceTarget <= 0
        ? 0
        : Math.max(baseRate, raceTarget ?? baseRate))
    : rampedTargetGPerHr(baseRate, workoutType, daysToARace, raceTarget);

  // Heat penalty applies to high-intensity + long. Easy is unaffected
  // (less gut stress). Penalize by reducing target intake to maintain
  // tolerance.
  const heatPen = (workoutType === 'long' || workoutType === 'quality' || workoutType === 'race')
    ? heatGutPenalty(tempF) : 0;
  const effectiveRate = Math.max(0, Math.round(targetRate * (1 - heatPen)));

  const carbsTotal = Math.round((effectiveRate * durationEstMin) / 60);
  const gelG = gelCarbsG && gelCarbsG > 0 ? gelCarbsG : DEFAULT_GEL_CARBS_G;
  const initialGels = carbsTotal > 0 ? Math.max(1, Math.round(carbsTotal / gelG)) : 0;

  // Distribute evenly across the run, first gel at ~30 min.
  //
  // Long runs (≥3h) used to push the last two gels past durationEst-5
  // and the clamp would collapse them onto the same minute, producing
  // "... + 175 + 175 min" in the DayDetailModal render. Dedupe by
  // tracking which minutes we've already scheduled and fold the gel
  // count down to match the distinct slots that actually fit — "9 gels
  // at 30/50/.../170/175" is honest; "10 gels at 30/50/.../170/175/175"
  // is broken render. The total-carb target still drives the gPerHr the
  // coach voices; this is purely a presentation-of-schedule fix.
  const atMins: number[] = [];
  const seen = new Set<number>();
  if (initialGels > 0) {
    const stride = initialGels === 1 ? 0 : Math.max(20, Math.round((durationEstMin - 30) / initialGels));
    for (let i = 0; i < initialGels; i++) {
      const at = Math.min(durationEstMin - 5, 30 + i * stride);
      if (seen.has(at)) continue;
      seen.add(at);
      atMins.push(at);
    }
  }
  const gels = atMins.length;

  const productLabel = gelLabel ? `${gelLabel}` : 'gel';
  const plural = gels === 1 ? productLabel : `${productLabel}s`;
  const minsList = atMins.length > 0 ? `at ${atMins.join(' + ')} min` : '';
  const shortLine = gels > 0
    ? `${gels} ${plural}${minsList ? ', ' + minsList : ''}`
    : `No fueling needed for this ${distanceMi ? distanceMi.toFixed(1) + 'mi' : durationEstMin + ' min'}.`;

  const why = gels > 0
    ? `Aim ${effectiveRate} g/hr (${heatPen > 0 ? `heat-adjusted from ${targetRate}` : `${workoutType} baseline`}). ` +
      (workoutType === 'long' && daysToARace != null && daysToARace <= 56
        ? `Race ${daysToARace}d out · long runs rehearse race-day intake (Costa gut-training ramp).`
        : 'Spread evenly so gut sees a steady carb stream.')
    : 'Short enough or easy enough that pre-run breakfast covers the work.';

  return {
    needed: gels > 0,
    gels,
    atMins,
    carbsTotalG: carbsTotal,
    shortLine,
    why,
    citation: workoutType === 'race' && raceDistMi != null
      ? raceCarbsPerHourTarget(raceDistMi, durationEstMin * 60).citation
      : 'Research/18-fueling-products.md §1 + §11 + §13 (Costa et al.)',
    gPerHr: effectiveRate,
    isRehearsal: workoutType === 'long' && daysToARace != null && daysToARace <= 56,
    heatAdjusted: heatPen > 0,
  };
}
