/**
 * Heat adjustment · Research/06 (Maughan / Ely / Vihma).
 *
 *   - applyHeatToPace(paceSPerMi, tempF, raceDistanceMi, abilityTier)
 *       → adjusted seconds per mile for upcoming/race workouts when
 *         forecast/historical temp is known.
 *
 *   - weatherContext({ actualTempF, baselineTempF })
 *       → for post-run surfacing: "Temp 78°F vs your typical 60°F →
 *         HR ~5 bpm elevated is expected." Returns null when no
 *         meaningful deviation.
 *
 * Cite: Research/06-weather-adjustments.md §1 Heat Adjustment by Air
 *       Temperature (Maughan / Ely / Vihma marathon-slowdown synthesis).
 *
 * 2026-06-09 state-audit fix: the temp→slowdown table + modifiers now
 * live in lib/training/heat-model.ts, shared with judgeWeather so the
 * race projection and the post-run verdicts price the same physics
 * identically. The old per-distance step scale (HM = 0.5×, 5K = 0.2×)
 * was an uncited engine invention that halved the doctrine table for
 * race projections — replaced by the documented duration scale
 * (effort time = pace × distance), HM ≈ 0.85×.
 */
import {
  maughanSlowdownPct,
  durationHeatScale,
  abilityTierFromVdot,
  type AbilityTier,
} from '@/lib/training/heat-model';

export { abilityTierFromVdot, type AbilityTier };

/**
 * Apply heat slowdown to a planned pace. Returns the adjusted seconds-
 * per-mile. Returns input unchanged when tempF is null/unknown.
 *
 * Cite: Research/06 §1 Heat Adjustment, duration-scaled per
 *       lib/training/heat-model.ts (engine-documented modifier).
 */
export function applyHeatToPace(
  paceSPerMi: number,
  tempF: number | null | undefined,
  raceDistanceMi: number,
  abilityTier: AbilityTier = 'mid_pack',
): number {
  if (tempF == null || !isFinite(tempF)) return paceSPerMi;
  const rawPct = maughanSlowdownPct(tempF, abilityTier);
  // Effort duration estimated from the pace being adjusted · the
  // marathon-anchored table applies in full at 2h+, scaled below.
  const estDurationS = paceSPerMi > 0 && raceDistanceMi > 0
    ? paceSPerMi * raceDistanceMi
    : null;
  const scaled = rawPct * durationHeatScale(estDurationS);
  return Math.round(paceSPerMi * (1 + scaled / 100));
}

/** Same as applyHeatToPace but returns a *range* (lo/hi) when the
 *  workout doesn't have a fixed start time — caller forecasts the
 *  workout window and passes the [min, max] temps. */
export function applyHeatToPaceRange(
  paceSPerMi: number,
  tempFMin: number | null | undefined,
  tempFMax: number | null | undefined,
  raceDistanceMi: number,
  abilityTier: AbilityTier = 'mid_pack',
): { lo: number; hi: number } {
  const lo = applyHeatToPace(paceSPerMi, tempFMin, raceDistanceMi, abilityTier);
  const hi = applyHeatToPace(paceSPerMi, tempFMax, raceDistanceMi, abilityTier);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/**
 * Post-run weather context. For an activity completed at tempF with a
 * recent-baseline avg of baselineTempF, returns a one-line explainer +
 * an estimated HR-elevation in bpm when the day was notably hotter.
 *
 * Null when delta is too small to matter (< 8°F) or temps are unknown.
 *
 * HR elevation rule of thumb (Research/06 §1):
 *   ~1 bpm per 1°F above ~60°F for endurance-pace running, capped at
 *   ~10 bpm at 80°F+. Cardiac drift is independent and additive over
 *   long workouts.
 */
export function weatherContext(input: {
  actualTempF: number | null;
  baselineTempF: number | null;
}): { message: string; hrBumpBpm: number } | null {
  const a = input.actualTempF;
  const b = input.baselineTempF;
  if (a == null || b == null) return null;
  const delta = a - b;
  if (Math.abs(delta) < 8) return null;
  if (delta > 0) {
    // Hotter than baseline. Cap bump at 10 bpm; 1 bpm/°F over baseline.
    const bump = Math.min(10, Math.round(delta));
    return {
      message: `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. HR ~${bump} bpm elevated is expected.`,
      hrBumpBpm: bump,
    };
  }
  // Cooler than baseline — opposite signal. Useful for "felt easier"
  // narratives, not as critical as the heat case.
  return {
    message: `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. HR ~${Math.min(5, Math.abs(Math.round(delta / 2)))} bpm lower is plausible.`,
    hrBumpBpm: -Math.min(5, Math.abs(Math.round(delta / 2))),
  };
}
