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
 * Doctrine: Research/15 § monitoring · "a single low reading is
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

  // Bands per Research/15: < 5 stable · 5-7 watch · >= 7 destabilizing.
  let threshold: number, projectedBand: string;
  if (currentValue < 5 && fit.slope > 0) {
    threshold = 5; projectedBand = 'watch';
  } else if (currentValue < 7 && fit.slope > 0) {
    threshold = 7; projectedBand = 'destabilizing';
  } else if (currentValue >= 5 && fit.slope < 0) {
    threshold = currentValue >= 7 ? 7 : 5;
    projectedBand = currentValue >= 7 ? 'watch' : 'stable';
  } else {
    return null;
  }
  const days = daysUntilCross(currentValue, threshold, fit.slope);
  if (days == null) return null;

  const direction = fit.slope > 0 ? 'rising' : 'falling';
  const ratePerDay = Math.abs(fit.slope).toFixed(2);
  const message = `HRV CV ${direction} ${ratePerDay}%/day · projected to cross into ${projectedBand} band in ~${days} day${days === 1 ? '' : 's'} if trajectory holds.`;
  return {
    pillar: 'hrv_cv',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
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

  const direction = fit.slope > 0 ? 'building' : 'shrinking';
  const ratePerDay = (Math.abs(fit.slope) * 60).toFixed(0);  // min/day
  const message = `Sleep ${direction} ${ratePerDay} min/day · ${projectedBand === 'on target' ? 'back on target' : `crosses into ${projectedBand}`} in ~${days} day${days === 1 ? '' : 's'} if pattern holds.`;
  return {
    pillar: 'sleep',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
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

  const baseline = recent.reduce((s, p) => s + p.value, 0) / recent.length;
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

  const direction = fit.slope > 0 ? 'climbing' : 'settling';
  const ratePerDay = Math.abs(fit.slope).toFixed(1);
  const message = `RHR ${direction} ${ratePerDay} bpm/day · ${projectedBand === 'back to baseline' ? 'returns to baseline' : `enters ${projectedBand} band`} in ~${days} day${days === 1 ? '' : 's'}.`;
  return {
    pillar: 'rhr',
    daysUntilBandChange: days,
    projectedBand,
    message,
    confidence: classifyConfidence(fit, dirMatch),
  };
}

function forecastWristTemp(history: ReadinessHistory): Forecast | null {
  // wrist temp lives on health-state not history · this helper takes
  // history but for now wrist temp forecasts are computed inline at
  // the brief composer level. Return null here · placeholder for the
  // shape so callers don't have to special-case.
  void history;
  return null;
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
