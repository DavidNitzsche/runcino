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
 *         meaningful deviation. The bpm figure comes from Research/03's
 *         confounder table, NOT from Research/06 — see below.
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
  effortSlowdownPct,
  abilityTierFromVdot,
  type AbilityTier,
  type HeatConditions,
} from '@/lib/training/heat-model';

export { abilityTierFromVdot, type AbilityTier };

/**
 * The weather beyond air temperature, when the caller has it. Every field is
 * optional; supply what you know and the shared model handles the rest.
 *
 * 2026-08-17: this parameter is the cluster-5 fix. Before it, applyHeatToPace
 * had no way to be told about humidity or sun, so it silently priced every
 * race and every prescription as a dry overcast day while the post-run
 * verdict — same doctrine table, same duration scale — priced the sun and the
 * dewpoint. That is where the +6.4% / +9.35% split on one half marathon came
 * from.
 */
export type HeatContext = Pick<
  HeatConditions,
  'dewpointF' | 'humidityPct' | 'conditions' | 'cloudCoverPct' | 'intervalStyle'
>;

/**
 * Apply heat slowdown to a planned pace. Returns the adjusted seconds-
 * per-mile. Returns input unchanged when tempF is null/unknown.
 *
 * Cite: Research/06 §1 Heat Adjustment + §12 dewpoint surcharge, duration-
 *       scaled per lib/training/heat-model.ts (engine-documented modifier).
 */
export function applyHeatToPace(
  paceSPerMi: number,
  tempF: number | null | undefined,
  raceDistanceMi: number,
  abilityTier: AbilityTier = 'mid_pack',
  ctx: HeatContext = {},
): number {
  if (tempF == null || !isFinite(tempF)) return paceSPerMi;
  // Effort duration estimated from the pace being adjusted · the
  // marathon-anchored table applies in full at 2h+, scaled below.
  const estDurationS = paceSPerMi > 0 && raceDistanceMi > 0
    ? paceSPerMi * raceDistanceMi
    : null;
  const pct = effortSlowdownPct({
    ...ctx,
    tempF,
    durationS: estDurationS,
    tier: abilityTier,
  });
  return Math.round(paceSPerMi * (1 + pct / 100));
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
  ctx: HeatContext = {},
): { lo: number; hi: number } {
  const lo = applyHeatToPace(paceSPerMi, tempFMin, raceDistanceMi, abilityTier, ctx);
  const hi = applyHeatToPace(paceSPerMi, tempFMax, raceDistanceMi, abilityTier, ctx);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

/**
 * Research/03 §"Limitations and Confounders" · the row that actually carries
 * a bpm number for heat: "Heat (≥25°C) | Rises | +5–20 bpm" at fixed effort.
 * 25°C is 77°F. Below it, doctrine states no heat HR confounder.
 *
 * ── 2026-08-17 · doctrine-conformance audit, cluster 5 ────────────────────
 *
 * `weatherContext` used to document itself as "~1 bpm per 1°F above ~60°F,
 * capped at ~10 bpm at 80°F+", attributed to Research/06 §1. Research/06 §1
 * is the Maughan pace-slowdown table and contains no bpm claim anywhere; the
 * rate was not in any Research/ file. The code did not implement its own
 * comment either — it counted degrees above the RUNNER'S OWN BASELINE, not
 * above 60°F, so on a runner whose typical run is 70°F a 78°F morning read
 * "+8 bpm" while the comment's rule says +18.
 *
 * FIXED, not deleted: the surface is worth keeping (a runner needs to know a
 * hot day explains the HR), so it now reports the doctrine BAND at the
 * doctrine THRESHOLD instead of a made-up rate. Cardiac drift is a separate
 * confounder in the same table and is not folded in here.
 */
export const HEAT_HR_CONFOUNDER = {
  /** Research/03 · "Heat (≥25°C)" · 25°C in °F. */
  thresholdF: 77,
  /** Research/03 · "+5–20 bpm". */
  bandBpm: [5, 20] as const,
  /** Top of the Research/06 §1 slowdown table · where the band's top lands. */
  bandTopAtF: 90,
};

/**
 * Expected HR elevation at fixed effort for a given air temperature, per
 * Research/03's confounder table. Zero below the doctrine threshold — a
 * pleasant morning has no heat confounder, whatever the runner is used to.
 * Interpolated across the stated band between the threshold and the top of
 * the Research/06 §1 table; the interpolation is the engine's, the two
 * endpoints are doctrine's.
 */
export function heatHrBumpBpm(tempF: number): number {
  const { thresholdF, bandBpm, bandTopAtF } = HEAT_HR_CONFOUNDER;
  if (!isFinite(tempF) || tempF < thresholdF) return 0;
  const t = Math.min(1, (tempF - thresholdF) / (bandTopAtF - thresholdF));
  return Math.round(bandBpm[0] + (bandBpm[1] - bandBpm[0]) * t);
}

/**
 * Post-run weather context. For an activity completed at tempF with a
 * recent-baseline avg of baselineTempF, returns a one-line explainer + the
 * HR elevation doctrine expects at that temperature.
 *
 * Null when the day was not notably different from the runner's normal
 * (< 8°F either way) or temps are unknown — the runner's own baseline decides
 * whether the day is WORTH MENTIONING; Research/03 decides the NUMBER.
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
    const bump = heatHrBumpBpm(a);
    if (bump === 0) {
      // Warmer than usual but below doctrine's heat threshold · say so
      // without attaching a bpm number nothing supports.
      return {
        message: `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. Warmer than usual, not hot enough to move your HR much.`,
        hrBumpBpm: 0,
      };
    }
    return {
      message: `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. HR ~${bump} bpm elevated is expected.`,
      hrBumpBpm: bump,
    };
  }
  // Cooler than baseline — Research/03's "Cold (<5°C) · −3–5 bpm easy" row is
  // the mirror confounder, and it only applies below 41°F. Above that we can
  // say the day was easier on the body without pricing it.
  const coolBump = a < 41 ? -4 : 0;
  return {
    message: coolBump !== 0
      ? `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. HR ~${Math.abs(coolBump)} bpm lower is plausible.`
      : `Temp ${Math.round(a)}°F vs your typical ${Math.round(b)}°F. Cooler than usual · the day was on your side.`,
    hrBumpBpm: coolBump,
  };
}
