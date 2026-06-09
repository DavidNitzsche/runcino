/**
 * lib/training/race-conditions.ts · Conditions chunk for the Targets GapPanel.
 *
 * Returns the heat-driven seconds penalty for a given race, derived from
 * either a real day-forecast (when the race is within ~16 days AND we
 * have lat/lng) or a climate-normals fallback (when the race is too
 * far out OR we don't have GPS but DO have a parseable location string).
 *
 * Hands the temperature off to lib/weather/heat-adjustment.ts (the
 * production Maughan model) · we do NOT re-derive heat impact here.
 * This file is the surface that turns (race + runner) into the right
 * temp + ability tier + distance for that model.
 *
 * Inputs:
 *   · raceSlug          · for caching / logging
 *   · raceDateISO       · "2026-08-15"
 *   · location          · "San Diego, CA" / "London, UK" / null
 *   · raceLat, raceLng  · from course_geometry.bbox (or null)
 *   · distanceMi        · scales Maughan's marathon-anchored slowdown
 *   · goalSec           · the runner's A-target → goal pace
 *   · vdot              · drives ability tier (elite/mid/slow)
 *
 * Output:
 *   · seconds           · whole-seconds penalty added to goal time
 *   · source            · 'forecast' | 'climate' | null (no data)
 *   · heatBand          · 'neutral' | 'warm' | 'hot' | 'extreme'
 *   · tempF             · the temp the model used
 *   · summary           · one-line copy for the doctrine drawer
 *
 * Null when neither forecast nor climate normals resolve · the panel
 * hides the Conditions chunk gracefully in that case.
 */

import { applyHeatToPace, abilityTierFromVdot } from '@/lib/weather/heat-adjustment';
import { fetchDayForecast } from '@/lib/weather/openmeteo';
import { climateNormalForLocation } from '@/lib/training/climate-normals';

export interface RaceConditionsInput {
  raceSlug: string;
  raceDateISO: string;
  location: string | null;
  raceLat: number | null;
  raceLng: number | null;
  distanceMi: number;
  goalSec: number;
  vdot: number | null | undefined;
}

export interface RaceConditionsResult {
  seconds: number | null;
  source: 'forecast' | 'climate' | null;
  heatBand: 'neutral' | 'warm' | 'hot' | 'extreme';
  tempF: number | null;
  summary: string;
  /** Non-null when tempF > 85°F — heat illness is a real risk above that
   *  threshold regardless of predicted pace impact. */
  safetyMessage: string | null;
}

/** Maximum days ahead Open-Meteo's forecast API covers (~16d). Beyond
 *  that we fall back to climate normals. */
const FORECAST_HORIZON_DAYS = 14;

function heatBandFor(tempF: number | null): RaceConditionsResult['heatBand'] {
  if (tempF == null) return 'neutral';
  if (tempF < 60) return 'neutral';
  if (tempF < 70) return 'warm';
  if (tempF < 80) return 'hot';
  return 'extreme';
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO + (fromISO.length === 10 ? 'T00:00:00Z' : ''));
  const to = Date.parse(toISO + (toISO.length === 10 ? 'T00:00:00Z' : ''));
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86400000);
}

/**
 * Build the seconds penalty for the Conditions chunk.
 *
 * Algorithm:
 *  1. Determine which temperature signal to use:
 *     a. If race ≤14d away AND we have lat/lng → fetch the day forecast
 *        and use the max temp (the hottest hour the runner faces).
 *     b. Else → climate normals via location string.
 *  2. Call applyHeatToPace to get adjusted pace for the race-day temp.
 *  3. Convert (adjusted − goal pace) × distance into total-seconds delta.
 *  4. Compose a one-line summary for the doctrine drawer.
 */
export async function computeRaceConditions(
  input: RaceConditionsInput,
): Promise<RaceConditionsResult> {
  // 2026-06-03 · `today` is server UTC here because RaceConditionsInput
  // doesn't carry a userUuid. For races more than a day out the off-by-1
  // doesn't matter (forecast lookup, climate fallback). Callers that
  // need per-runner-TZ precision should pass `todayISO` directly via the
  // input. Keeping the helper signature stable for now · upgrade path
  // is to add `input.todayISO` and pass `await runnerToday(userUuid)`
  // from the caller. See TZ refactor doctrine.
  const todayISO = new Date().toISOString().slice(0, 10);
  const daysUntil = daysBetween(todayISO, input.raceDateISO);
  const ability = abilityTierFromVdot(input.vdot);

  let tempF: number | null = null;
  let source: 'forecast' | 'climate' | null = null;

  // 1a · forecast path
  if (
    daysUntil >= 0 && daysUntil <= FORECAST_HORIZON_DAYS &&
    input.raceLat != null && input.raceLng != null
  ) {
    try {
      const forecast = await fetchDayForecast(input.raceLat, input.raceLng, input.raceDateISO);
      if (forecast?.temp_max_f != null) {
        tempF = forecast.temp_max_f;
        source = 'forecast';
      }
    } catch {
      // fall through to climate
    }
  }

  // 1b · climate-normals fallback
  if (tempF == null) {
    const norm = climateNormalForLocation(input.location, input.raceDateISO);
    if (norm?.tempF != null) {
      tempF = norm.tempF;
      source = 'climate';
    }
  }

  if (tempF == null || !input.distanceMi || !input.goalSec) {
    return {
      seconds: null,
      source,
      heatBand: 'neutral',
      tempF: null,
      summary: 'No race-day weather signal · Conditions chunk hidden.',
      safetyMessage: null,
    };
  }

  // 2 · apply Maughan model
  const goalPaceSPerMi = input.goalSec / input.distanceMi;
  const adjustedPaceSPerMi = applyHeatToPace(
    goalPaceSPerMi,
    tempF,
    input.distanceMi,
    ability,
  );

  // 3 · convert delta-pace × distance to total-seconds
  const deltaPerMi = adjustedPaceSPerMi - goalPaceSPerMi;
  const seconds = Math.max(0, Math.round(deltaPerMi * input.distanceMi));

  // 4 · summary copy
  const heatBand = heatBandFor(tempF);
  const summary = buildSummary(seconds, tempF, source, heatBand);
  const safetyMessage = tempF > 85
    ? 'At this temperature, heat illness is a real risk. Run early, carry water, back off effort if you feel dizzy or stop sweating.'
    : null;

  return { seconds, source, heatBand, tempF: Math.round(tempF), summary, safetyMessage };
}

function buildSummary(
  seconds: number,
  tempF: number,
  source: 'forecast' | 'climate' | null,
  heatBand: RaceConditionsResult['heatBand'],
): string {
  const tempLabel = `${Math.round(tempF)}°F`;
  const sourceLabel = source === 'forecast'
    ? 'race-day forecast'
    : source === 'climate'
      ? 'typical race-morning'
      : 'unknown signal';
  if (heatBand === 'neutral') {
    return `${tempLabel} ${sourceLabel} · neutral conditions. ` +
      `Maughan adds about ${seconds}s · the day is not the bottleneck.`;
  }
  if (heatBand === 'warm') {
    return `${tempLabel} ${sourceLabel} · warm but workable. ` +
      `Maughan adds about ${seconds}s · execute, don't fight it.`;
  }
  if (heatBand === 'hot') {
    return `${tempLabel} ${sourceLabel} · hot. ` +
      `Maughan adds about ${seconds}s · earlier corral + extra fluids ` +
      `claw some back.`;
  }
  return `${tempLabel} ${sourceLabel} · extreme heat. ` +
    `Maughan adds about ${seconds}s · race-day reality check, not a stall.`;
}
