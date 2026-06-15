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

import type { WorkoutType } from './run-purpose';
import { effortSlowdownPct } from '@/lib/training/heat-model';

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
  /**
   * E6: the run's workout type, when known. The heat slowdown is a pace
   * fact and is unaffected by this field · but for easy/long/recovery/
   * shakeout runs pace is not the axis the runner trains on (effort/HR is),
   * so the runner-facing `summary` + `coachTipForNextTime` reframe around
   * effort instead of "costs you X% on pace". Omitted/null preserves the
   * pace framing · the back-compat default and the right read for quality +
   * race, where pace IS the axis. Any runner.
   */
  workoutType?: WorkoutType | null;
  /**
   * 'pre' (default) frames forward — "your pace will sit slower, hold the
   * effort". 'post' frames as a past reading for the run recap — no
   * imperatives, no "will" (David 2026-06-12: the recap was reading like
   * pre-run advice instead of responding to the run).
   */
  phase?: 'pre' | 'post';
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
 * Solar / sun adjustment. Direct sun on cloudless days adds ~5°F to the
 * effective temperature in trained runners (Sources 7 & 17 in Research/06).
 *
 * 2026-06-09 state-audit fix: the temp→slowdown curve that used to live
 * here sat ~2× above the cited Research/06 mid-pack column (70°F → 8%
 * vs doctrine 4%; 80°F → 17% vs 7.5%), and the dewpoint multiplier
 * (≤1.75×) compounded on top — verdict bands were forgiving warm-day
 * quality misses by 3-4× what the research supports. The slowdown now
 * comes from lib/training/heat-model.ts (the verbatim doctrine table +
 * additive §12 dewpoint surcharge + the documented duration scale),
 * shared with applyHeatToPace so post-run verdicts and the race
 * projection price the same physics identically.
 */
function solarEffectiveBump(c: WeatherInput): number {
  const cloud = c.cloudCoverPct ?? null;
  const cond = (c.conditions ?? '').toLowerCase();
  if (cond === 'clear' || (cloud != null && cloud < 25)) return 5;
  if (cond === 'partly cloudy' || (cloud != null && cloud < 60)) return 2;
  return 0;
}

// Band assignment from slowdown % only. UX bands, recalibrated
// 2026-06-09 to the doctrine table so the felt labels land where they
// used to (70°F dry still reads "hot"): the % thresholds halved with
// the table (old 2/6/12 over a ~2× curve ≈ new 2/4/8 over doctrine).
//   neutral < 2% · warm 2–4% · hot 4–8% · extreme ≥ 8%
function bandFor(slowdownPct: number): HeatBand {
  if (slowdownPct < 2) return 'neutral';
  if (slowdownPct < 4) return 'warm';
  if (slowdownPct < 8) return 'hot';
  return 'extreme';
}

// E6: easy / long / recovery / shakeout are run by effort or HR, not by the
// clock · heat makes those paces drift slower by design, so the "costs you
// X% on pace" framing miscoaches them (the runner reads a pace tax on a run
// where pace isn't the target). Quality + race — and unknown, for back-compat
// — keep the pace framing because pace IS the training axis there.
function isEffortRun(t: WorkoutType | null | undefined): boolean {
  return t === 'easy' || t === 'long' || t === 'recovery' || t === 'shakeout';
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

  // Base slowdown from the doctrine table (mid-pack column — post-run
  // judgments don't carry the runner's tier; mid-pack is the honest
  // population default), plus the §12 dewpoint surcharge, scaled by run
  // duration. One shared formula with applyHeatToPace — see
  // lib/training/heat-model.ts.
  const slowdownPct = Math.round(
    effortSlowdownPct({
      tempF: tEff,
      dewpointF: td,
      durationS: input.durationS,
      tier: 'mid_pack',
    }) * 10,
  ) / 10;

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
  // Trailing framing only when material. E6: pace-cost for quality/race
  // (pace is the axis); effort framing for easy/long/recovery/shakeout
  // (pace drifts slower by design · the runner trains those by feel/HR).
  const isPost = input.phase === 'post';
  if (slowdownPct >= 2) {
    if (isEffortRun(input.workoutType)) {
      // Post: read it (past, no imperative). Pre: forward cue.
      summary += isPost
        ? ` Warm enough to cost a little pace — the heat, not lost fitness.`
        : ` Your pace will sit slower in this · that's the heat, not lost fitness. Hold the effort.`;
    } else {
      summary += isPost
        ? ` Cost you about ${Math.round(slowdownPct)}% on pace — the heat, not fitness.`
        : ` Costs you about ${Math.round(slowdownPct)}% on pace.`;
    }
  }

  // Coach tip · what to do next time. Runner-to-runner, no jargon.
  // E6: easy/long/recovery/shakeout get effort/HR-first advice (chasing a
  // pace number in heat just turns an easy run hard); quality/race keep the
  // pace-aware advice because the workout is defined by pace.
  let coachTipForNextTime: string | null = null;
  const effort = isEffortRun(input.workoutType);
  if (heatBand === 'warm') {
    if (effort) {
      coachTipForNextTime = isPost
        ? `Next time it's this warm, start earlier and run by feel — the pace looks after itself.`
        : `Run these by effort, not the watch · let the pace drift slower and keep it truly easy. A little salt before the long ones helps.`;
    } else {
      coachTipForNextTime = `Try to start earlier next time when it's warm like this. Drink something with salt in it before long ones.`;
    }
  } else if (heatBand === 'hot') {
    coachTipForNextTime = effort
      ? `Go by effort and HR, not pace · heat like this makes the watch lie. Start earlier when you can, and drink 16-24 oz with salt the hour before.`
      : `Start earlier next time. Heat like this is rough on the body · drink 16-24 oz with salt the hour before, and don't chase pace in the first miles.`;
  } else if (heatBand === 'extreme') {
    coachTipForNextTime = effort
      ? `Forget the pace in this · run by effort and cut it short if your HR won't settle. Move the run earlier next time.`
      : `Move hard runs out of this window. Pace targets don't really work when it's this hot. If you're racing somewhere warm, give yourself 10-14 days running in the heat to get used to it.`;
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
