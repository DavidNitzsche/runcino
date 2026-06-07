/**
 * lib/coach/weather-adjust.ts · environmental pace + effort correction.
 *
 * Doctrine: Research/06-weather-adjustments.md
 *   · Maughan / Ely / Vihma marathon-slowdown synthesis
 *   · RunnersConnect dewpoint adjustment (validated against Maughan/Otani)
 *   · Tair+Td sum framework as a single-number heat-stress index
 *
 * Inputs the coach uses anywhere it needs to judge a run honestly:
 *   - air temperature (°F) · primary heat signal
 *   - dewpoint (°F) · evaporative-cooling limit
 *   - solar load · direct sun adds ~5°F effective
 *   - wind · headwind/tailwind cost
 *
 * Outputs:
 *   - slowdownPct · how much slower than 50°F reference an honest effort
 *     would land at this temp (so we don't penalize the runner)
 *   - heatBand · "neutral" | "warm" | "hot" | "extreme" · drives copy
 *   - shouldFlagInRecap · true when conditions were material enough that
 *     ignoring them in the post-run analysis would be unfair
 *   - coachTipForNextTime · forward-looking advice (e.g. "start earlier")
 *     when relevant
 *
 * Citations: see CITATION_WEATHER · always returned with any output that
 * carries an environmental adjustment so consumers can show the doctrine.
 */

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
}

export type HeatBand = 'neutral' | 'warm' | 'hot' | 'extreme';

export interface WeatherJudgment {
  /** % slower than the 50°F reference for an honest effort. 0 if neutral. */
  slowdownPct: number;
  /** Plain-language band the heat falls in. */
  heatBand: HeatBand;
  /** Tair + Td combined heat-stress index (°F). null if Td unknown. */
  heatStressF: number | null;
  /** Whether the conditions were material enough to surface in a recap. */
  shouldFlagInRecap: boolean;
  /** One-line summary of the conditions for display. */
  summary: string;
  /** Forward-looking advice ("start earlier next time") when applicable. */
  coachTipForNextTime: string | null;
  /** Research citations to attach to any UI that uses these numbers. */
  citation: typeof CITATION_WEATHER;
}

/**
 * Estimate dewpoint from temperature and relative humidity if dewpoint
 * isn't directly supplied. Magnus-Tetens approximation, °F in / °F out.
 * Good to ±1°F in the running range we care about.
 */
export function estimateDewpointF(tempF: number, humidityPct: number): number {
  const T = (tempF - 32) * 5 / 9;
  const a = 17.625;
  const b = 243.04;
  const rh = Math.max(1, Math.min(100, humidityPct)) / 100;
  const alpha = Math.log(rh) + (a * T) / (b + T);
  const tdC = (b * alpha) / (a - alpha);
  return tdC * 9 / 5 + 32;
}

/**
 * Maughan / Ely / Vihma temperature-only slowdown for a mid-pack
 * marathoner. Returns % slower than 50°F reference. Approximated from
 * the lookup table in Research/06.
 */
function slowdownFromTemp(tempF: number): number {
  if (tempF <= 50) return 0;
  // Piecewise linear synthesis of the Research/06 table, mid-pack column:
  //   55°F → ~1.5%   ·   60°F → 3%    ·   65°F → 5%
  //   70°F → 8%      ·   75°F → 12%   ·   80°F → 17%
  //   85°F → 23%     ·   90°F → 30%
  if (tempF <= 55) return ((tempF - 50) / 5) * 1.5;
  if (tempF <= 60) return 1.5 + ((tempF - 55) / 5) * 1.5;
  if (tempF <= 65) return 3.0 + ((tempF - 60) / 5) * 2.0;
  if (tempF <= 70) return 5.0 + ((tempF - 65) / 5) * 3.0;
  if (tempF <= 75) return 8.0 + ((tempF - 70) / 5) * 4.0;
  if (tempF <= 80) return 12.0 + ((tempF - 75) / 5) * 5.0;
  if (tempF <= 85) return 17.0 + ((tempF - 80) / 5) * 6.0;
  if (tempF <= 90) return 23.0 + ((tempF - 85) / 5) * 7.0;
  return 30.0 + (tempF - 90) * 1.4;  // open-ended above 90
}

/**
 * Dewpoint multiplier · evaporative-cooling impairment. Anchored at the
 * RunnersConnect / Otani table. Multiplies temperature slowdown.
 */
function dewpointMultiplier(dewpointF: number): number {
  if (dewpointF < 55) return 1.0;
  if (dewpointF < 60) return 1.05;
  if (dewpointF < 65) return 1.15;
  if (dewpointF < 70) return 1.30;
  if (dewpointF < 75) return 1.50;
  return 1.75;  // >=75°F dewpoint: hostile to evaporation
}

/**
 * Solar / sun adjustment. Direct sun on cloudless days adds ~5°F to the
 * effective temperature in trained runners (Sources 7 & 17 in Research/06).
 */
/**
 * 2026-06-04 · scale the marathon-distance pace tax down for shorter
 * efforts. The Maughan/Vihma table represents 26.2-mile race-pace
 * degradation · most of that comes from cumulative dehydration,
 * core-temp rise, and accelerated glycogen depletion · effects that
 * accumulate over hours.
 *
 * For a 36-minute tempo at 79°F effective the table says ~16% but
 * the actual cost is closer to 8-9% · the runner doesn't accumulate
 * the full thermal debt. Linear ramp from 40% of the table at very
 * short efforts up to 100% at marathon-distance duration.
 *
 *   sub-30min  → 0.45   (mostly direct-heat effect, little accumulation)
 *   30 min     → 0.55
 *   60 min     → 0.70
 *   90 min     → 0.85
 *   120+ min   → 1.00   (full marathon-distance penalty)
 *
 * Returns 1.0 when durationS is unknown · keeps the published table
 * intent as the safe default.
 *
 * Cite: Research/06-weather-adjustments.md §"Distance scaling"
 * (annotation 2026-06-04, David's QC).
 */
function durationScalingFactor(durationS: number | null | undefined): number {
  if (!durationS || durationS <= 0) return 1.0;
  const TWO_HOURS = 7200;
  const t = Math.min(1, durationS / TWO_HOURS);
  // Anchored ramp: factor(0s) → 0.40, factor(2hr+) → 1.00.
  return Math.max(0.40, Math.min(1.0, 0.40 + 0.60 * t));
}

function solarEffectiveBump(c: WeatherInput): number {
  const cloud = c.cloudCoverPct ?? null;
  const cond = (c.conditions ?? '').toLowerCase();
  if (cond === 'clear' || (cloud != null && cloud < 25)) return 5;
  if (cond === 'partly cloudy' || (cloud != null && cloud < 60)) return 2;
  return 0;
}

// Band assignment from slowdown % only — Research/06 doctrine:
//   neutral < 2% · warm 2–6% · hot 6–12% · extreme ≥ 12%
function bandFor(slowdownPct: number): HeatBand {
  if (slowdownPct < 2) return 'neutral';
  if (slowdownPct < 6) return 'warm';
  if (slowdownPct < 12) return 'hot';
  return 'extreme';
}

export function judgeWeather(input: WeatherInput): WeatherJudgment {
  // Prefer the PEAK temperature the run actually fought through. The
  // legacy `tempF` field is the start-line snapshot · adequate for short
  // runs, misleading on anything over 60 minutes in a warming forecast.
  const t = input.tempF_peak ?? input.tempF;
  const tStart = input.tempF_start ?? input.tempF;
  if (t == null) {
    return {
      slowdownPct: 0,
      heatBand: 'neutral',
      heatStressF: null,
      shouldFlagInRecap: false,
      summary: 'Conditions unknown',
      coachTipForNextTime: null,
      citation: CITATION_WEATHER,
    };
  }

  const td = input.dewpointF
    ?? (input.humidityPct != null ? estimateDewpointF(t, input.humidityPct) : null);

  // Effective temperature accounts for sun load.
  const tEff = t + solarEffectiveBump(input);

  // Base slowdown from temp, scaled by evaporative-cooling impairment.
  // 2026-06-04 · also scaled by run duration · the Maughan/Vihma table
  // is anchored to marathon-distance pace tax (cumulative dehydration +
  // core-temp + glycogen effects accumulate over hours). For a tempo
  // or shorter run the actual cost is much smaller. See
  // durationScalingFactor() header.
  const baseSlow = slowdownFromTemp(tEff);
  const dpMult = td != null ? dewpointMultiplier(td) : 1.0;
  const durMult = durationScalingFactor(input.durationS);
  const slowdownPct = Math.round(baseSlow * dpMult * durMult * 10) / 10;

  const heatBand = bandFor(slowdownPct);
  const heatStressF = td != null ? Math.round(t + td) : null;

  // Material when slowdown >= 2% or extreme dewpoint, or when sun bumped
  // the effective temperature into a higher band than the raw reading.
  const shouldFlagInRecap = slowdownPct >= 2 || (td != null && td >= 65);

  // When we know the run's thermal arc, lead with the climb · "65°F → 75°F"
  // tells the story far better than the peak alone. Skip the arrow when
  // the climb was <3°F (within bucket noise) or we only have one reading.
  const climbedMaterially = tStart != null && input.tempF_end != null
    && Math.abs((input.tempF_end as number) - tStart) >= 3;
  const tempPhrase = climbedMaterially
    ? `${Math.round(tStart as number)}°F → ${Math.round(input.tempF_end as number)}°F (peak ${Math.round(t)}°F)`
    : `${Math.round(t)}°F`;

  // Plain-English summary · this is what the runner reads on the run card.
  // Doctrine drives the band; the words are everyday talk. No "evaporative
  // cooling impaired", no "heat stress index", no model citations.
  let summary: string;
  if (heatBand === 'extreme') {
    summary = climbedMaterially
      ? `Started at ${Math.round(tStart as number)}°F, hit ${Math.round(input.tempF_end as number)}°F. That's seriously hot.`
      : `${Math.round(t)}°F · seriously hot.`;
  } else if (heatBand === 'hot') {
    summary = climbedMaterially
      ? `Started at ${Math.round(tStart as number)}°F, climbed to ${Math.round(input.tempF_end as number)}°F. That's hot for running.`
      : `${Math.round(t)}°F · hot for running.`;
  } else if (heatBand === 'warm') {
    summary = climbedMaterially
      ? `Got from ${Math.round(tStart as number)}°F to ${Math.round(input.tempF_end as number)}°F · a bit warm.`
      : `${Math.round(t)}°F · a bit warm.`;
  } else {
    summary = climbedMaterially
      ? `${Math.round(tStart as number)}°F to ${Math.round(input.tempF_end as number)}°F · good conditions.`
      : `${Math.round(t)}°F · good conditions.`;
  }
  // Trailing "Costs you about X% on pace" framing only when material.
  if (slowdownPct >= 2) {
    summary += ` Costs you about ${Math.round(slowdownPct)}% on pace.`;
  }

  // Coach tip · what to do next time. Runner-to-runner, no jargon.
  let coachTipForNextTime: string | null = null;
  if (heatBand === 'warm') {
    coachTipForNextTime = `Try to start earlier next time when it's warm like this. Drink something with salt in it before long ones.`;
  } else if (heatBand === 'hot') {
    coachTipForNextTime = `Start earlier next time. Heat like this is rough on the body · drink 16-24 oz with salt the hour before, and don't chase pace in the first miles.`;
  } else if (heatBand === 'extreme') {
    coachTipForNextTime = `Move hard runs out of this window. Pace targets don't really work when it's this hot. If you're racing somewhere warm, give yourself 10-14 days running in the heat to get used to it.`;
  }

  return {
    slowdownPct,
    heatBand,
    heatStressF,
    shouldFlagInRecap,
    summary,
    coachTipForNextTime,
    citation: CITATION_WEATHER,
  };
}
