/**
 * /api/plan — Orchestrator.
 *
 * Pipeline:
 * 1. Parse GPX immediately if uploaded (ground truth for geometry)
 * 2. Research race website (logistics: aid stations, warnings) with GPX context
 * 3. Weather (parallel with research when GPX already parsed)
 * 4. Override course geometry fields from GPX (authoritative)
 * 5. Build terrain-aware (or even-split when no GPX) plan
 * 6. Return RacePlan JSON
 */

import { researchCourse, type GpxContext } from '../../../lib/core/research';
import { buildPlan } from '../../../lib/core/plan';
import { fetchNoaaWeather } from '../../../lib/weather';
import { parseGpx } from '../../../lib/gpx';
import { parseHMS, M_PER_MI } from '../../../lib/time';
import type { PlanRequest, WeatherConditions, RacePlan } from '../../../lib/core/types';

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: PlanRequest & { gpx_text?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { race_name, race_date, goal_time, nutrition_notes, gpx_text } = body;

  if (!race_name?.trim()) return new Response('Missing race_name', { status: 400 });
  if (!race_date?.trim()) return new Response('Missing race_date', { status: 400 });

  const goalFinishS = parseHMS(goal_time ?? '');
  if (!goalFinishS) return new Response('Invalid goal_time — use h:mm:ss', { status: 400 });

  // ── Step 1: Parse GPX immediately if provided ──────────────────────────────
  // Parsing is fast (<100ms) — do it before research so we can pass GPX context
  // to Claude, which lets it cross-check against the official course data.
  let gpxText: string | null = gpx_text?.trim() || null;
  let gpxSource: RacePlan['gpx_source'] = gpxText ? 'user_upload' : null;
  let preTrack = null;
  let gpxContext: GpxContext | undefined;

  if (gpxText) {
    try {
      preTrack = parseGpx(gpxText);
      const first = preTrack.points[0];
      const last = preTrack.points[preTrack.points.length - 1];
      gpxContext = {
        distanceMi: preTrack.totalDistanceM / M_PER_MI,
        gainFt: preTrack.smoothedGainFt,
        lossFt: preTrack.smoothedLossFt,
        startLat: first.lat,
        startLon: first.lon,
        finishLat: last.lat,
        finishLon: last.lon,
      };
      console.log(`[GPX] User upload parsed: ${gpxContext.distanceMi.toFixed(2)}mi, +${Math.round(gpxContext.gainFt)}ft/-${Math.round(gpxContext.lossFt)}ft`);
    } catch (err) {
      console.warn('[GPX] Failed to pre-parse user GPX:', err instanceof Error ? err.message : err);
      gpxText = null;
      gpxSource = null;
    }
  }

  // ── Step 2: Research (race logistics + cross-check GPX) ────────────────────
  let course;
  try {
    course = await researchCourse(race_name.trim(), race_date.trim(), gpxContext);
  } catch (err) {
    return new Response(
      `Research failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 502 }
    );
  }

  console.log('\n=== FAFF.RUN RESEARCH OUTPUT ===');
  console.log(JSON.stringify(course, null, 2));
  console.log('=== END RESEARCH OUTPUT ===\n');

  // ── Step 3: Weather (now that we have coords from research or GPX) ──────────
  let weather: WeatherConditions | null = null;
  const coords = gpxContext
    ? { lat: gpxContext.startLat, lon: gpxContext.startLon }
    : course.start_coords;

  if (coords) {
    try {
      const w = await fetchNoaaWeather(coords.lat, coords.lon, race_date, '07:00');
      weather = {
        narrative: w.narrative,
        start_temp_f: w.start_period.temperature_f,
        finish_temp_f: w.second_period?.temperature_f ?? null,
        wind_summary: w.start_period.wind_speed_mph_max
          ? `${w.start_period.wind_direction} ${w.start_period.wind_speed_mph_min ?? w.start_period.wind_speed_mph_max}–${w.start_period.wind_speed_mph_max} mph`
          : null,
        precip_pct: w.start_period.precipitation_pct > 0 ? w.start_period.precipitation_pct : null,
      };
    } catch (err) {
      console.warn('Weather fetch failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }

  // ── Step 4: Apply GPX geometry to course object ────────────────────────────
  // GPX is ground truth — override research estimates with measured values.
  if (gpxText && preTrack) {
    const first = preTrack.points[0];
    const last = preTrack.points[preTrack.points.length - 1];
    const gpxDistanceMi = preTrack.totalDistanceM / M_PER_MI;

    course.start_coords = { lat: first.lat, lon: first.lon };
    course.finish_coords = { lat: last.lat, lon: last.lon };

    // Only override distance if within 20% of research value (guards against partial GPX files)
    const researchDist = course.distance_mi;
    if (Math.abs(gpxDistanceMi - researchDist) / researchDist < 0.20) {
      course.distance_mi = Math.round(gpxDistanceMi * 100) / 100;
      course.distance_m = Math.round(preTrack.totalDistanceM);
      console.log(`[GPX] Distance: ${researchDist.toFixed(2)}mi → ${course.distance_mi}mi`);
    } else {
      console.warn(`[GPX] Distance mismatch — research: ${researchDist.toFixed(2)}mi, GPX: ${gpxDistanceMi.toFixed(2)}mi`);
    }

    // Always use GPX elevation (it's measured, not estimated)
    course.total_gain_ft = Math.round(preTrack.smoothedGainFt);
    course.total_loss_ft = Math.round(preTrack.smoothedLossFt);
    course.net_elevation_ft = Math.round(preTrack.smoothedGainFt - preTrack.smoothedLossFt);
    console.log(`[GPX] Elevation: +${course.total_gain_ft}ft / -${course.total_loss_ft}ft`);
  } else {
    console.log('[GPX] No GPX — even splits');
  }

  // ── Step 5: Build plan ─────────────────────────────────────────────────────
  const plan = buildPlan({
    course,
    raceDate: race_date,
    goalFinishS,
    nutritionNotes: nutrition_notes?.trim() ?? '',
    weather,
    gpxText,
    gpxSource,
  });

  return Response.json(plan);
}

