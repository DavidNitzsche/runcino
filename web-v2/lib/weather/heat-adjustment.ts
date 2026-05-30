/**
 * Heat adjustment · Research/06 (Maughan / Ely / Vihma).
 *
 * Ports the slim subset of legacy/web/lib/weather-slowdown.ts that the
 * v2 plan-builder + post-run surface need:
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
 * What this DOES NOT do (deferred): dewpoint / humidity, wind, altitude,
 * AQI, race-day bail triggers. Those live in legacy/web/lib/weather-
 * slowdown.ts and will port when the post-run surface needs them.
 */

/** Marathon slowdown by Tair, by runner ability tier. Slowdown % vs
 *  50°F baseline. Same canonical table as legacy doctrine. */
const MAUGHAN_HEAT_SLOWDOWN: ReadonlyArray<{
  tairF: number;
  elitePct: number;
  midPaceMarathonerPct: number;
  slowMarathonerPct: number;
}> = [
  { tairF: 40, elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
  { tairF: 50, elitePct: 0,    midPaceMarathonerPct: 0,    slowMarathonerPct: 0    },
  { tairF: 60, elitePct: 0.5,  midPaceMarathonerPct: 1.5,  slowMarathonerPct: 2.5  },
  { tairF: 65, elitePct: 1.0,  midPaceMarathonerPct: 2.5,  slowMarathonerPct: 4.0  },
  { tairF: 70, elitePct: 1.5,  midPaceMarathonerPct: 4.0,  slowMarathonerPct: 6.0  },
  { tairF: 75, elitePct: 2.5,  midPaceMarathonerPct: 5.5,  slowMarathonerPct: 8.5  },
  { tairF: 80, elitePct: 3.5,  midPaceMarathonerPct: 7.5,  slowMarathonerPct: 11.5 },
  { tairF: 85, elitePct: 4.5,  midPaceMarathonerPct: 10.0, slowMarathonerPct: 15.0 },
  { tairF: 90, elitePct: 6.0,  midPaceMarathonerPct: 13.0, slowMarathonerPct: 19.0 },
];

export type AbilityTier = 'elite' | 'mid_pack' | 'slow';

/**
 * Distance scaling. Maughan is marathon-calibrated; heat impact scales
 * with race duration (cumulative heat load). Half ≈ 0.5×, 5K ≈ 0.2×,
 * ultras compound the other way.
 */
function distanceScale(raceDistanceMi: number): number {
  if (raceDistanceMi >= 50) return 1.5;
  if (raceDistanceMi >= 22) return 1.0;
  if (raceDistanceMi >= 11) return 0.5;
  if (raceDistanceMi >= 5)  return 0.3;
  return 0.2;
}

/**
 * Infer ability tier from VDOT. Daniels: VDOT ≥ 60 ~ elite marathon
 * (sub-3:00); 45-60 ~ mid-pack (3:00-4:30); below 45 ~ slow.
 */
export function abilityTierFromVdot(vdot: number | null | undefined): AbilityTier {
  const v = vdot ?? 50;
  if (v >= 60) return 'elite';
  if (v >= 45) return 'mid_pack';
  return 'slow';
}

/** Linear interpolation between Maughan bracket points. */
function interpolatePct(tempF: number, key: 'elitePct' | 'midPaceMarathonerPct' | 'slowMarathonerPct'): number {
  if (tempF <= 50) return 0;
  if (tempF >= 90) return MAUGHAN_HEAT_SLOWDOWN[MAUGHAN_HEAT_SLOWDOWN.length - 1][key];
  for (let i = 0; i < MAUGHAN_HEAT_SLOWDOWN.length - 1; i++) {
    const lo = MAUGHAN_HEAT_SLOWDOWN[i];
    const hi = MAUGHAN_HEAT_SLOWDOWN[i + 1];
    if (tempF >= lo.tairF && tempF <= hi.tairF) {
      const t = (tempF - lo.tairF) / (hi.tairF - lo.tairF);
      return lo[key] + (hi[key] - lo[key]) * t;
    }
  }
  return 0;
}

/**
 * Apply heat slowdown to a planned pace. Returns the adjusted seconds-
 * per-mile. Returns input unchanged when tempF is null/unknown.
 *
 * Cite: Research/06 §1 Heat Adjustment. Distance-scaled per
 *       cumulative-heat-load principle.
 */
export function applyHeatToPace(
  paceSPerMi: number,
  tempF: number | null | undefined,
  raceDistanceMi: number,
  abilityTier: AbilityTier = 'mid_pack',
): number {
  if (tempF == null || !isFinite(tempF)) return paceSPerMi;
  const key = abilityTier === 'elite' ? 'elitePct'
            : abilityTier === 'slow'  ? 'slowMarathonerPct'
            :                           'midPaceMarathonerPct';
  const rawPct = interpolatePct(tempF, key);
  const scaled = rawPct * distanceScale(raceDistanceMi);
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
