/**
 * lib/coach/forecasts.ts · slope detection + band crossing.
 *
 * The killer feature. Other apps say "this is bad." This one says
 * "this is bad AND here's what will happen if it persists."
 *
 * For each pillar with enough history, computes the recent slope
 * (linear regression over the last 7 days), then projects when the
 * trajectory crosses into the next band. Surfaces a forward-looking
 * message in coach voice.
 *
 * Confidence rules:
 *   · high   · slope is consistent + R² > 0.5 + slope direction
 *              matches the last 3 days
 *   · medium · slope is consistent OR R² > 0.4
 *   · low    · trajectory exists but noisy
 *
 * Returns empty array when there isn't enough signal for any pillar.
 *
 * Doctrine: Research/15 §Recovery-Scores · "a single low reading is  // was §monitoring · heading: ## Recovery Scores (interpretation of wearable monitoring)
 * noise; a 3-day persistent trend is signal." We surface predictions
 * only when the trend is persistent.
 */

import type { ReadinessHistory } from './readiness-history';

export type ForecastPillar = 'sleep' | 'hrv' | 'rhr' | 'load' | 'hrv_cv' | 'wrist_temp';

export interface Forecast {
  pillar: ForecastPillar;
  daysUntilBandChange: number | null;
  projectedBand: string;
  message: string;
  confidence: 'high' | 'medium' | 'low';
  /** 2026-06-03 · 'good' when the trajectory leads to a better state
   *  (sleep climbing back to target, RHR settling toward baseline,
   *  HRV CV stabilizing, wrist temp returning to baseline). 'bad' when
   *  the trajectory leads to a worse state. UI colors the chip
   *  accordingly so the runner can tell which forecasts are positive
   *  vs warning without parsing the message. */
  direction: 'good' | 'bad';
}

interface SlopeFit {
  slope: number;        // value per day
  intercept: number;
  rSquared: number;
}

/**
 * Linear regression over [{ x: dayIdx, y: value }]. Returns null when
 * fewer than 4 points or zero variance.
 */
function linearFit(points: Array<{ x: number; y: number }>): SlopeFit | null {
  if (points.length < 4) return null;
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  // R²
  const meanY = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  if (ssTot === 0) return null;  // constant series
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const rSquared = 1 - ssRes / ssTot;
  return { slope, intercept, rSquared };
}

/**
 * Compute confidence from fit + persistence.
 */
function classifyConfidence(fit: SlopeFit, last3DirectionMatches: boolean): Forecast['confidence'] {
  if (last3DirectionMatches && fit.rSquared > 0.5) return 'high';
  if (last3DirectionMatches || fit.rSquared > 0.4) return 'medium';
  return 'low';
}

function last3MatchDirection(values: number[], slope: number): boolean {
  if (values.length < 4) return false;
  const last4 = values.slice(-4);
  const directions = last4.slice(1).map((v, i) => v - last4[i]);
  const sign = slope > 0 ? 1 : -1;
  // 2 of 3 last day-deltas should match direction
  const matches = directions.filter((d) => Math.sign(d) === sign).length;
  return matches >= 2;
}

/**
 * Compute days until a value (extrapolated linearly) crosses a threshold.
 * Returns null when the slope direction won't reach the threshold.
 */
function daysUntilCross(currentValue: number, threshold: number, slope: number): number | null {
  if (slope === 0) return null;
  const diff = threshold - currentValue;
  const days = diff / slope;
  if (days <= 0 || days > 21) return null;  // capped at 3 weeks
  return Math.round(days);
}

// ─── per-pillar forecasts ────────────────────────────────────────────

function forecastHrvCv(history: ReadinessHistory): Forecast | null {
  const series = history.hrvPlews?.cvSeries ?? [];
  if (series.length < 7) return null;
  const recent = series.slice(-7);
  const points = recent.map((p, i) => ({ x: i, y: p.pct }));
  const fit = linearFit(points);
  if (!fit) return null;
  const currentValue = recent.at(-1)!.pct;
  const dirMatch = last3MatchDirection(recent.map((p) => p.pct), fit.slope);

  // 2026-06-16 · #20 · bands per Research/03 §CV (RMSSDcv, raw RMSSD):
  // ≤10 stable · 10–14 watch (acute perturbation) · >14 destabilizing
  // (NFOR). cvSeries is now raw-RMSSD CV (readiness-history.ts). The old
  // 5/7 cutoffs were raw-RMSSD-literature numbers applied to the rolling-
  // LnRMSSD CV, so this forecaster could never project a real crossing.
  const WATCH = 10, DESTABILIZING = 14;
  let threshold: number, projectedBand: string;
  if (currentValue < WATCH && fit.slope > 0) {
    threshold = WATCH; projectedBand = 'watch';
  } else if (currentValue < DESTABILIZING && fit.slope > 0) {
    threshold = DESTABILIZING; projectedBand = 'destabilizing';
  } else if (currentValue >= WATCH && fit.slope < 0) {
    threshold = currentValue >= DESTABILIZING ? DESTABILIZING : WATCH;
    projectedBand = currentValue >= DESTABILIZING ? 'watch' : 'stable';
  } else {
    return null;
  }
  const days = daysUntilCross(currentValue, threshold, fit.slope);
  if (days == null) return null;

  // 2026-06-03 · plain-English message + good/bad direction. HRV CV
  // rising = bad (nervous system destabilizing). Falling = good.
  const ratePerDay = Math.abs(fit.slope).toFixed(2);
  const trendDir: 'good' | 'bad' = fit.slope > 0 ? 'bad' : 'good';
  const message = fit.slope > 0
    ? `HRV variability is rising · +${ratePerDay}%/day. On pace to cross the ${projectedBand === 'destabilizing' ? `${DESTABILIZING}%` : `${WATCH}%`} line in about ${days} day${days === 1 ? '' : 's'} · watch for nervous system destabilization.`
    : `HRV variability is settling · −${ratePerDay}%/day. On pace to drop back into the ${projectedBand === 'stable' ? 'stable' : 'normal'} band in about ${days} day${days === 1 ? '' : 's'}.`;
  return {
    pillar: 'hrv_cv',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
    direction: trendDir,
  };
}

function forecastSleep(history: ReadinessHistory): Forecast | null {
  const series = history.sleep ?? [];
  if (series.length < 5) return null;
  const recent = series.slice(-7);
  const points = recent.map((p, i) => ({ x: i, y: p.value }));
  const fit = linearFit(points);
  if (!fit) return null;
  if (Math.abs(fit.slope) < 0.05) return null;  // less than 3min/day, ignore
  const currentValue = recent.at(-1)!.value;
  const dirMatch = last3MatchDirection(recent.map((p) => p.value), fit.slope);

  // Bands: target 7.5h healthy · 6.5-7.5 watch · < 6.5 deficit.
  let threshold: number, projectedBand: string;
  if (currentValue >= 7.5 && fit.slope < 0) {
    threshold = 7.5; projectedBand = 'watch';
  } else if (currentValue >= 6.5 && fit.slope < 0) {
    threshold = 6.5; projectedBand = 'deficit';
  } else if (currentValue < 7.5 && fit.slope > 0) {
    threshold = currentValue < 6.5 ? 6.5 : 7.5;
    projectedBand = currentValue < 6.5 ? 'watch' : 'on target';
  } else {
    return null;
  }
  const days = daysUntilCross(currentValue, threshold, fit.slope);
  if (days == null) return null;

  // 2026-06-03 · plain-English message + good/bad direction. Sleep
  // climbing toward target = good. Sleep falling away from target = bad.
  const ratePerDay = (Math.abs(fit.slope) * 60).toFixed(0);  // min/day
  const trendDir: 'good' | 'bad' = fit.slope > 0 ? 'good' : 'bad';
  const message = fit.slope > 0
    ? `Sleep is recovering · adding about ${ratePerDay} min/night. On pace to hit your 7.5h target in about ${days} day${days === 1 ? '' : 's'}.`
    : projectedBand === 'deficit'
      ? `Sleep is slipping · losing about ${ratePerDay} min/night. On pace to drop below 6.5h in about ${days} day${days === 1 ? '' : 's'} · the real-deficit line.`
      : `Sleep is slipping · losing about ${ratePerDay} min/night. On pace to drop below 7.5h in about ${days} day${days === 1 ? '' : 's'}.`;
  return {
    pillar: 'sleep',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
    direction: trendDir,
  };
}

function forecastRhr(history: ReadinessHistory): Forecast | null {
  const series = history.rhr ?? [];
  if (series.length < 5) return null;
  const recent = series.slice(-7);
  const points = recent.map((p, i) => ({ x: i, y: p.value }));
  const fit = linearFit(points);
  if (!fit) return null;
  if (Math.abs(fit.slope) < 0.2) return null;  // less than 0.2 bpm/day, ignore

  // 2026-06-03 · UNIFIED BASELINE per David's call. Use the stable
  // baseline (mean of last 30d EXCLUDING the recent 7) instead of the
  // last-7 local mean. Slope math still uses the recent 7 (that's the
  // regression's local center) but the comparator the runner sees ·
  // "X bpm above your Y bpm baseline" · now matches the driver row +
  // BODY tile. Three surfaces, one number per pillar.
  //
  // Falls back to the 7-day local mean if there aren't ≥14 days · cold-
  // start runners (or runners with sparse data) just see the local center.
  const recent7 = series.slice(-7);
  const localMean = recent7.reduce((s, p) => s + p.value, 0) / recent7.length;
  const baseline = series.length >= 14
    ? series.slice(-30, -7).reduce((s, p) => s + p.value, 0) / Math.max(1, series.slice(-30, -7).length)
    : localMean;
  const currentValue = recent.at(-1)!.value;
  const dirMatch = last3MatchDirection(recent.map((p) => p.value), fit.slope);

  // Bands: within ±5 bpm of baseline = normal. +5 / +8 = elevated.
  let threshold: number, projectedBand: string;
  if (currentValue < baseline + 5 && fit.slope > 0) {
    threshold = baseline + 5; projectedBand = 'elevated';
  } else if (currentValue < baseline + 8 && fit.slope > 0) {
    threshold = baseline + 8; projectedBand = 'sustained elevated';
  } else if (currentValue > baseline && fit.slope < 0) {
    threshold = baseline; projectedBand = 'back to baseline';
  } else {
    return null;
  }
  const days = daysUntilCross(currentValue, threshold, fit.slope);
  if (days == null) return null;

  // 2026-06-03 · plain-English message + good/bad direction. RHR
  // climbing = bad (rising RHR = under-recovered / stressed).
  // Settling toward baseline = good.
  const ratePerDay = Math.abs(fit.slope).toFixed(1);
  const baselineRounded = Math.round(baseline);
  const trendDir: 'good' | 'bad' = fit.slope > 0 ? 'bad' : 'good';
  const message = fit.slope > 0
    ? projectedBand === 'sustained elevated'
      ? `RHR is rising · +${ratePerDay} bpm/night. On pace to climb 8+ bpm above your ${baselineRounded} bpm baseline in about ${days} day${days === 1 ? '' : 's'} · sustained-elevated band.`
      : `RHR is rising · +${ratePerDay} bpm/night. On pace to climb 5 bpm above your ${baselineRounded} bpm baseline in about ${days} day${days === 1 ? '' : 's'} · worth watching.`
    : `RHR is settling · −${ratePerDay} bpm/night. On pace to return to your ${baselineRounded} bpm baseline in about ${days} day${days === 1 ? '' : 's'}.`;
  return {
    pillar: 'rhr',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
    direction: trendDir,
  };
}

function forecastWristTemp(history: ReadinessHistory): Forecast | null {
  // Research/15 §Spotting-Illness-Early · rises 24-48h pre-illness · the  // was §wrist temp · heading: ## Spotting Illness Early
  // forecaster surfaces the trajectory before the runner feels it.
  // This is HIGH-VALUE · wrist temp moves earlier than HRV.
  //
  // Bands relative to runner's own 14-day baseline:
  //   delta < +0.2°C  · normal
  //   delta +0.2..0.4 · watch (early signal)
  //   delta >= +0.4   · illness-risk band
  const series = history.wristTemp ?? [];
  if (series.length < 7) return null;
  const recent = series.slice(-7);
  const points = recent.map((p, i) => ({ x: i, y: p.value }));
  const fit = linearFit(points);
  if (!fit) return null;
  if (Math.abs(fit.slope) < 0.05) return null;  // need a meaningful trend (0.05°C/day = 0.35/wk)

  // Baseline = mean of prior 14 days (excluding the recent 7).
  const priorWindow = series.slice(-21, -7);
  if (priorWindow.length < 7) return null;
  const baseline = priorWindow.reduce((s, p) => s + p.value, 0) / priorWindow.length;
  const currentValue = recent.at(-1)!.value;
  const currentDelta = currentValue - baseline;
  const dirMatch = last3MatchDirection(recent.map((p) => p.value), fit.slope);

  // Determine projected band crossing.
  let threshold: number, projectedBand: string;
  if (currentDelta < 0.2 && fit.slope > 0) {
    threshold = baseline + 0.2; projectedBand = 'watch';
  } else if (currentDelta < 0.4 && fit.slope > 0) {
    threshold = baseline + 0.4; projectedBand = 'illness-risk';
  } else if (currentDelta > 0 && fit.slope < 0) {
    threshold = currentDelta >= 0.4 ? baseline + 0.4 : baseline + 0.2;
    projectedBand = currentDelta >= 0.4 ? 'watch' : 'back to baseline';
  } else {
    return null;
  }
  const days = daysUntilCross(currentValue, threshold, fit.slope);
  if (days == null) return null;

  // 2026-06-03 · plain-English message + good/bad direction. Wrist
  // temp rising = bad (early illness signal per Research/15).
  // Falling back toward baseline = good.
  const ratePerDay = Math.abs(fit.slope).toFixed(2);
  const sign = currentDelta >= 0 ? '+' : '';
  const trendDir: 'good' | 'bad' = fit.slope > 0 ? 'bad' : 'good';
  const message = fit.slope > 0
    ? projectedBand === 'illness-risk'
      ? `Wrist temp is rising · +${ratePerDay}°C/night, currently ${sign}${currentDelta.toFixed(2)}°C above your baseline. On pace to cross +0.4°C in about ${days} day${days === 1 ? '' : 's'} · the illness-risk threshold per Research/15.`
      : `Wrist temp is rising · +${ratePerDay}°C/night, currently ${sign}${currentDelta.toFixed(2)}°C above your baseline. On pace to cross +0.2°C in about ${days} day${days === 1 ? '' : 's'} · the early-watch threshold.`
    : `Wrist temp is falling · −${ratePerDay}°C/night. On pace to return to baseline in about ${days} day${days === 1 ? '' : 's'}.`;
  return {
    pillar: 'wrist_temp',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
    direction: trendDir,
  };
}

/**
 * Build the forecasts array for the readiness brief.
 *
 * Generic mechanism · scans all per-pillar series, returns one entry
 * per pillar where a meaningful trend is detected.
 */
export function buildForecasts(history: ReadinessHistory): Forecast[] {
  const all = [
    forecastHrvCv(history),
    forecastSleep(history),
    forecastRhr(history),
    forecastWristTemp(history),
  ].filter((f): f is Forecast => f != null);
  // Sort: high confidence first, then medium, then low.
  const order: Record<Forecast['confidence'], number> = { high: 0, medium: 1, low: 2 };
  return all.sort((a, b) => order[a.confidence] - order[b.confidence]);
}
