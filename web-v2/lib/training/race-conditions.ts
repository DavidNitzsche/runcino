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
import { heatBandForConditions } from '@/lib/coach/heat-gate';
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
  /** 2026-06-09 · race gun time, local (races.meta.startTime · the
   *  inline-editable Gun chip on the race detail page · free text like
   *  "7:00 AM"). When present, the forecast path prices the temps the
   *  runner will actually race through (start → finish window) instead
   *  of the day's max — a 7 AM start in August is ~10°F cooler than the
   *  daily high, and the old daily-max read produced a phantom heat
   *  jump the moment a race crossed into the 14-day forecast horizon.
   *  Null → daily max (conservative legacy behavior). */
  startTimeLocal?: string | null;
  /**
   * The RUNNER's today (runnerToday(userUuid)). Supply it whenever a
   * user is in scope — `daysUntil` drives the forecast-vs-climate switch
   * and the race-week copy, and a server-UTC "today" moves that boundary
   * for anyone not living in UTC. Omitted → server UTC, documented below.
   */
  todayISO?: string | null;
}

export interface RaceConditionsResult {
  seconds: number | null;
  source: 'forecast' | 'climate' | null;
  /** Doctrine WBGT flag word · null when humidity is unknown and WBGT
   *  genuinely cannot be computed (Research/06:141-148). */
  heatBand: 'neutral' | 'warm' | 'hot' | 'extreme' | null;
  tempF: number | null;
  summary: string;
  /** Non-null when tempF > 85°F — heat illness is a real risk above that
   *  threshold regardless of predicted pace impact. */
  safetyMessage: string | null;
}

/** Maximum days ahead Open-Meteo's forecast API covers (~16d). Beyond
 *  that we fall back to climate normals. */
const FORECAST_HORIZON_DAYS = 14;

/**
 * 2026-08-17 · doctrine-conformance audit, cluster 6. This used to be a
 * Tair ladder of its own — neutral <60, warm <70, hot <80, extreme — one of
 * four heat taxonomies in the app and none of them doctrine's. At 72°F it
 * said "hot" while the phone's fallback (60/75/85) said "warm" about the
 * same conditions. The word now comes off Research/06:141-148's WBGT flag
 * table via the one shared reader, and is null when the forecast carries no
 * humidity and WBGT genuinely cannot be computed.
 */
function heatBandFor(
  tempF: number | null,
  conditions: string | null,
  humidityPct: number | null,
  cloudCoverPct: number | null,
): RaceConditionsResult['heatBand'] {
  return heatBandForConditions({ tairF: tempF, humidityPct, cloudCoverPct, conditions }).band;
}

/** Parse a local race start time → fractional hour 0-23.99.
 *  Accepts the shapes the race-detail Gun chip stores (free text ·
 *  races.meta.startTime): "07:00", "7:00", "7:00 AM", "7am", "6:53AM".
 *  Null on anything unparseable so callers fall back to daily max. */
export function parseStartHour(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] != null ? parseInt(m[2], 10) : 0;
  const mer = m[3]?.[0] ?? null; // 'a' | 'p' | null
  if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null;
  if (mer === 'p' && h < 12) h += 12;
  if (mer === 'a' && h === 12) h = 0;
  if (h < 0 || h > 23) return null;
  return h + min / 60;
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
  // 2026-08-17 · the upgrade path the 2026-06-03 note described is taken:
  // callers with a user in scope pass `todayISO` from runnerToday(), and
  // both of them now do (api/targets/projection, faff-app/seed). Server
  // UTC survives only as the fallback for a caller with no user — which
  // is off by a day for a Pacific runner every evening, and matters most
  // in exactly the case where precision counts: the 14-day forecast
  // boundary and the race-week copy.
  const todayISO = input.todayISO ?? new Date().toISOString().slice(0, 10);
  const daysUntil = daysBetween(todayISO, input.raceDateISO);
  const ability = abilityTierFromVdot(input.vdot);

  let tempF: number | null = null;
  let source: 'forecast' | 'climate' | null = null;
  // 2026-08-17 · the sky and the moisture the race is run under. The forecast
  // carries both; this file never read them, so the Conditions chunk priced
  // every race as a dry overcast day while the post-run verdict priced the
  // sun and the dewpoint, and the heat WORD came off a Tair scale of this
  // file's own invention (60/70/80) that disagreed with the phone's (60/75/85).
  let skyConditions: string | null = null;
  let humidityPct: number | null = null;
  let cloudCoverPct: number | null = null;

  // 1a · forecast path. With a known start time, price the race window
  // (start → projected finish) and take its hotter edge; without one,
  // fall back to the day's max (conservative).
  if (
    daysUntil >= 0 && daysUntil <= FORECAST_HORIZON_DAYS &&
    input.raceLat != null && input.raceLng != null
  ) {
    try {
      const startHour = parseStartHour(input.startTimeLocal);
      const raceWindow = startHour != null && input.goalSec > 0
        ? { durationMin: Math.ceil(input.goalSec / 60), startHourOverride: startHour }
        : null;
      const forecast = await fetchDayForecast(
        input.raceLat, input.raceLng, input.raceDateISO, raceWindow,
      );
      if (raceWindow && (forecast?.temp_start_f != null || forecast?.temp_end_f != null)) {
        tempF = Math.max(forecast.temp_start_f ?? -Infinity, forecast.temp_end_f ?? -Infinity);
        source = 'forecast';
        skyConditions = forecast?.conditions ?? null;
        humidityPct = forecast?.humidity_pct ?? null;
        cloudCoverPct = forecast?.cloud_cover_pct ?? null;
      } else if (forecast?.temp_max_f != null) {
        tempF = forecast.temp_max_f;
        source = 'forecast';
        skyConditions = forecast?.conditions ?? null;
        humidityPct = forecast?.humidity_pct ?? null;
        cloudCoverPct = forecast?.cloud_cover_pct ?? null;
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
      heatBand: null,
      tempF: null,
      summary: 'No race-day weather signal · Conditions chunk hidden.',
      safetyMessage: null,
    };
  }

  // 2 · apply the shared heat model, with the sky and moisture the race
  //     will actually be run under. On the climate-normals path there is no
  //     humidity, so the dewpoint surcharge and the WBGT band both degrade
  //     to unknown rather than being guessed at.
  const goalPaceSPerMi = input.goalSec / input.distanceMi;
  const adjustedPaceSPerMi = applyHeatToPace(
    goalPaceSPerMi,
    tempF,
    input.distanceMi,
    ability,
    { conditions: skyConditions, humidityPct, cloudCoverPct },
  );

  // 3 · convert delta-pace × distance to total-seconds
  const deltaPerMi = adjustedPaceSPerMi - goalPaceSPerMi;
  const seconds = Math.max(0, Math.round(deltaPerMi * input.distanceMi));

  // 4 · summary copy
  const heatBand = heatBandFor(tempF, skyConditions, humidityPct, cloudCoverPct);
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
  if (heatBand == null) {
    // No humidity for this race, so no WBGT and no heat word · state the
    // temperature and the seconds, claim nothing about the band.
    return `${tempLabel} ${sourceLabel}. ` +
      `Maughan adds about ${seconds}s · humidity unknown this far out.`;
  }
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
