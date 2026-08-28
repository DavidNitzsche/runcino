/**
 * lib/coach/weather-adjust.ts · heat-vs-fitness signal for HR-drift reading.
 *
 * 2026-08-27 · no pace or effort advice is built here any more. The runner
 * paces off feel and conditions on the day; nothing in this app should
 * adjust, widen, or advise a pace target because of heat. What's left is
 * the one legitimate use of this physics: telling a real fitness fade
 * apart from an HR rise that heat alone explains (heatAwareDrift, in
 * heat-band.ts). `slowdownPct`/`shouldFlagInRecap` feed only that gate.
 *
 * Doctrine: Research/06-weather-adjustments.md
 *   · Maughan / Ely / Vihma marathon-slowdown synthesis
 *   · RunnersConnect dewpoint adjustment (validated against Maughan/Otani)
 *   · Tair+Td sum framework as a single-number heat-stress index
 *
 * Inputs:
 *   - air temperature (°F) · primary heat signal
 *   - dewpoint (°F) · evaporative-cooling limit
 *   - solar load · direct sun adds ~5°F effective
 *   - wind · headwind/tailwind cost
 *
 * Outputs:
 *   - slowdownPct · how much slower than 50°F reference an honest effort
 *     would land at this temp
 *   - heatBand · "neutral" | "warm" | "hot" | "extreme"
 *   - shouldFlagInRecap · true when conditions were material enough to
 *     change how HR drift gets read
 *
 * Citations: see CITATION_WEATHER.
 */

import type { WorkoutType } from './run-purpose';
import { heatEffort, estimateDewpointF } from '@/lib/training/heat-model';
import { heatBandForConditions } from './heat-gate';

export const CITATION_WEATHER = {
  slug: 'research-06-weather-adjustments',
  label: 'Research/06 · Weather Adjustments',
};

export interface WeatherInput {
  /**
   * Headline temperature (°F). For span-enriched runs callers should
   * pass `tempF_peak` here · the recap is about conditions the runner
   * actually fought through, not start-line conditions.
   */
  tempF: number | null;
  /** Optional thermal arc · when present the engine quotes the climb. */
  tempF_start?: number | null;
  tempF_end?: number | null;
  /** Hottest hour the run touched · the recap's preferred reading. */
  tempF_peak?: number | null;
  dewpointF?: number | null;
  windMph?: number | null;
  humidityPct?: number | null;
  conditions?: string | null;      // 'clear' | 'cloudy' | 'rain' | ...
  cloudCoverPct?: number | null;   // 0-100
  /**
   * Run duration in seconds. The Maughan/Vihma slowdown table is
   * anchored to marathon-distance performance · most heat penalty
   * comes from cumulative dehydration + core-temp + glycogen-
   * acceleration effects that take HOURS to bite. For sub-marathon
   * efforts the actual cost is smaller · scaled in judgeWeather
   * via durationScalingFactor(). Pass when known · falls back to
   * full marathon-distance penalty when null.
   */
  durationS?: number | null;
  /** Accepted for call-site compatibility. Unused since no copy is built
   *  from workout type any more. */
  workoutType?: WorkoutType | null;
  /** Accepted for call-site compatibility. Unused since no copy is built
   *  from phase any more. */
  phase?: 'pre' | 'post';
}

/**
 * 2026-08-17 · re-sourced. This is now a presentation mapping of the
 * Research/06:141-148 WBGT flag table (see lib/coach/heat-gate.ts), not a
 * scale of its own. `null` on the wire means WBGT could not be computed.
 */
export type HeatBand = 'neutral' | 'warm' | 'hot' | 'extreme';

export interface WeatherJudgment {
  /** % slower than the 50°F reference an honest effort costs at these
   *  conditions. Not applied to any displayed pace or target — read only
   *  by the HR-drift relabeling (heatAwareDrift), which distinguishes
   *  thermoregulatory HR rise from real fitness fade. */
  slowdownPct: number;
  /** Plain-language band the heat falls in. Null when humidity is unknown. */
  heatBand: HeatBand | null;
  /** Tair + Td combined heat-stress index (°F). null if Td unknown. */
  heatStressF: number | null;
  /** Whether the conditions were material enough to affect how HR drift
   *  gets read. */
  shouldFlagInRecap: boolean;
  /** Research citations to attach to any UI that uses these numbers. */
  citation: typeof CITATION_WEATHER;
}

/**
 * Dewpoint estimator · re-exported from the shared heat model, where it
 * moved on 2026-08-17 so every consumer resolves a missing dewpoint the
 * same way. Kept here because heat-gate and drift-monitor import it from
 * this module.
 */
export { estimateDewpointF };

export function judgeWeather(input: WeatherInput): WeatherJudgment {
  // Prefer the PEAK temperature the run actually fought through. The
  // legacy `tempF` field is the start-line snapshot · adequate for short
  // runs, misleading on anything over 60 minutes in a warming forecast.
  const t = input.tempF_peak ?? input.tempF;
  const tStart = input.tempF_start ?? input.tempF;
  if (t == null) {
    return {
      slowdownPct: 0,
      heatBand: null,
      heatStressF: null,
      shouldFlagInRecap: false,
      citation: CITATION_WEATHER,
    };
  }

  // 2026-08-17 · this function used to bump the temperature for sun and
  // resolve the dewpoint itself before calling the shared model — the two
  // steps applyHeatToPace happened not to do, which is how the same
  // afternoon read +6.4% on Targets and +9.35% here. All of it now happens
  // inside the model; this passes the weather it has and nothing else.
  // mid_pack column: post-run judgments don't carry the runner's tier, and
  // mid-pack is the honest population default.
  const heat = heatEffort({
    tempF: t,
    dewpointF: input.dewpointF,
    humidityPct: input.humidityPct,
    conditions: input.conditions,
    cloudCoverPct: input.cloudCoverPct,
    durationS: input.durationS,
    tier: 'mid_pack',
  });
  const slowdownPct = Math.round((heat?.slowdownPct ?? 0) * 10) / 10;
  const td = heat?.dewpointF ?? null;

  // The word comes off the doctrine WBGT flag table, not off the slowdown %
  // (cluster 6 · four taxonomies, none of them doctrine's). Null when
  // humidity is unknown and WBGT genuinely cannot be computed — the copy
  // below then states the temperature and stops, rather than reaching for an
  // invented scale.
  const bandReading = heatBandForConditions({
    tairF: t,
    humidityPct: input.humidityPct,
    cloudCoverPct: input.cloudCoverPct,
    conditions: input.conditions,
  });
  const heatBand = bandReading.band;
  const heatStressF = td != null ? Math.round(t + td) : null;

  // Material when slowdown >= 2% or extreme dewpoint, or when sun bumped
  // the effective temperature into a higher band than the raw reading.
  // Feeds heatAwareDrift's HR-drift relabeling only — no pace/effort copy
  // is built from this any more.
  const shouldFlagInRecap = slowdownPct >= 2 || (td != null && td >= 65);

  return {
    slowdownPct,
    heatBand,
    heatStressF,
    shouldFlagInRecap,
    citation: CITATION_WEATHER,
  };
}
