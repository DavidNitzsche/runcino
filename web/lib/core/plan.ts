/**
 * lib/core/plan.ts — Slice 1+ planner
 *
 * When a GPX track is provided (any source): terrain-aware even_effort pacing
 * via Minetti GAF + segment-based phase derivation.
 *
 * When no GPX: even splits (original behavior).
 *
 * In both cases: rule-based gel placement, missing-field flags, warnings.
 */

import { formatHMS, formatPace, FT_PER_M, M_PER_MI } from '../time';
import { parseGpx } from '../gpx';
import { buildSegments } from '../pacing';
import type { GpxTrack, Segment } from '../types';
import type {
  CourseResearch,
  GelPlacement,
  MilePlan,
  RacePlan,
  RacePhase,
  SegmentSummary,
  TrackPoint,
  WatchCoord,
  WatchGelTrigger,
  WatchMileMarker,
  WatchPayload,
  WatchPhase,
  WeatherConditions,
} from './types';

interface PlannerInput {
  course: CourseResearch;
  raceDate: string;
  goalFinishS: number;
  nutritionNotes: string;
  weather: WeatherConditions | null;
  gpxText: string | null;
  gpxSource: RacePlan['gpx_source'];
}

export function buildPlan(input: PlannerInput): RacePlan {
  const { course, raceDate, goalFinishS, nutritionNotes, weather, gpxText, gpxSource } = input;
  const totalMiles = course.distance_mi;

  // ── Gel placement (time-based, works for both terrain and flat) ──────────────
  const pacePerMile = goalFinishS / totalMiles;
  const gels = placeGels(totalMiles, pacePerMile, nutritionNotes);

  // ── Terrain path (GPX available) ─────────────────────────────────────────────
  let track: GpxTrack | null = null;
  let segments: Segment[] = [];
  let phases: RacePhase[] | null = null;
  let segments_summary: SegmentSummary[] | null = null;
  let track_points: TrackPoint[] | null = null;

  if (gpxText) {
    try {
      track = parseGpx(gpxText);
      segments = buildSegments(track, {
        goalFinishS,
        strategy: 'even_effort',
        toleranceSPerMi: 10,
      });
      phases = derivePhases(segments, gels, totalMiles);
      segments_summary = buildSegmentsSummary(segments, track);
      track_points = downsampleTrack(track, 500);
    } catch (err) {
      console.warn('GPX processing failed (falling back to even splits):', err);
      track = null;
      segments = [];
    }
  }

  // Always provide phases — generic quarter-splits when no GPX
  if (!phases) {
    phases = genericPhases(totalMiles, gels);
  }

  // ── Mile-by-mile table ────────────────────────────────────────────────────────
  const gelsByMile = new Map(gels.map(g => [Math.round(g.at_mile), g]));

  const miles: MilePlan[] = [];
  for (let mile = 1; mile <= Math.ceil(totalMiles); mile++) {
    const cumulative_s = segments.length > 0
      ? paceAtMile(segments, mile, totalMiles)
      : pacePerMile * Math.min(mile, totalMiles);

    // For terrain pacing: find the segment that contains this mile marker
    const segForMile = segments.find(s => s.endMi >= mile && s.startMi < mile);
    const target_pace_s = segForMile ? segForMile.targetPaceSPerMi : pacePerMile;

    miles.push({
      mile,
      target_pace_s,
      target_pace_display: formatPace(target_pace_s),
      cumulative_s,
      cumulative_display: formatHMS(cumulative_s),
      is_aid_station: isNearAidStation(mile, course.aid_station_miles),
      gel: gelsByMile.get(mile) ?? null,
    });
  }

  // ── Missing fields + warnings ─────────────────────────────────────────────────
  const missing_fields: string[] = [];
  if (course.total_gain_ft === null && !gpxText)
    missing_fields.push('Elevation gain/loss (not verified — terrain pacing unavailable)');
  if (course.aid_station_miles === null)
    missing_fields.push('Aid station locations (not verified — 💧 markers not shown)');
  if (course.start_coords === null)
    missing_fields.push('Start coordinates (not verified — weather forecast unavailable)');
  if (!gpxText && !course.gpx_url)
    missing_fields.push('Course GPX (not found — using even splits; upload your own Garmin/Strava GPX for terrain pacing)');

  const warnings: string[] = [
    ...course.course_warnings,
    ...(course.primary_source_url === null
      ? ['⚠ No primary source (official race domain) found — all facts are secondary source']
      : []),
  ];

  const effectiveGpxSource = segments.length > 0 ? gpxSource : null;

  // Build watch payload with coordinate triggers
  const watch_payload = buildWatchPayload({
    course,
    raceDate,
    goalFinishS,
    pacePerMile,
    phases,
    gels,
    track,
    gpxSource: effectiveGpxSource,
  });

  return {
    race_date: raceDate,
    goal_finish_s: goalFinishS,
    goal_display: formatHMS(goalFinishS),
    avg_pace_display: `${formatPace(pacePerMile)}/mi`,
    course,
    weather,
    gpx_available: segments.length > 0,
    gpx_source: effectiveGpxSource,
    phases,
    segments_summary,
    track_points,
    miles,
    gels,
    missing_fields,
    warnings,
    watch_payload,
    generated_at: new Date().toISOString(),
    slice: 'slice-1',
  };
}

// ─── Cumulative time at mile marker using segments ────────────────────────────

function paceAtMile(segments: Segment[], targetMile: number, totalMiles: number): number {
  let elapsed = 0;
  for (const seg of segments) {
    if (seg.endMi <= targetMile) {
      elapsed += (seg.distanceM / M_PER_MI) * seg.targetPaceSPerMi;
    } else if (seg.startMi < targetMile) {
      const fraction = (targetMile - seg.startMi) / (seg.endMi - seg.startMi);
      elapsed += fraction * (seg.distanceM / M_PER_MI) * seg.targetPaceSPerMi;
      break;
    }
  }
  return elapsed;
}

// ─── Phase derivation ─────────────────────────────────────────────────────────

function derivePhases(
  segments: Segment[],
  gels: GelPlacement[],
  totalMiles: number,
): RacePhase[] {
  if (segments.length === 0) return genericPhases(totalMiles, gels);

  const THRESHOLD_FT = 30;   // elevation swing to trigger new phase
  const MIN_PHASE_MI = 1.0;
  const MAX_PHASES = 10;

  // Build cumulative elevation at each segment boundary
  let cumEle = 0;
  const cumEles: number[] = [0];
  for (const seg of segments) {
    cumEle += seg.gainFt - seg.lossFt;
    cumEles.push(cumEle);
  }

  // Find turning points
  const boundaries: number[] = [0];
  let lastEleAtBoundary = 0;
  let currentDir: 'up' | 'down' | 'flat' = 'flat';

  for (let i = 1; i < segments.length; i++) {
    const g = segments[i].meanGradePct;
    const newDir = g > 0.8 ? 'up' : g < -0.8 ? 'down' : 'flat';

    if (newDir !== 'flat' && newDir !== currentDir) {
      const eleDelta = Math.abs(cumEles[i] - lastEleAtBoundary);
      const miSinceLastBoundary =
        segments[i].startMi - segments[boundaries[boundaries.length - 1]].startMi;

      if (eleDelta >= THRESHOLD_FT && miSinceLastBoundary >= MIN_PHASE_MI) {
        boundaries.push(i);
        lastEleAtBoundary = cumEles[i];
        currentDir = newDir;
      }
    } else if (newDir !== 'flat') {
      currentDir = newDir;
    }
  }
  boundaries.push(segments.length);

  // Merge if too many
  while (boundaries.length - 1 > MAX_PHASES) {
    let minMi = Infinity;
    let minIdx = 1;
    for (let i = 1; i < boundaries.length - 1; i++) {
      const mi = segments[boundaries[i] - 1].endMi - segments[boundaries[i - 1]].startMi;
      if (mi < minMi) { minMi = mi; minIdx = i; }
    }
    boundaries.splice(minIdx, 1);
  }

  // Build phase objects
  const phases: RacePhase[] = [];
  const total = boundaries.length - 1;

  for (let p = 0; p < total; p++) {
    const startIdx = boundaries[p];
    const endIdx = boundaries[p + 1];
    const pSegs = segments.slice(startIdx, endIdx);
    if (pSegs.length === 0) continue;

    const startMi = pSegs[0].startMi;
    const endMi = pSegs[pSegs.length - 1].endMi;
    const gainFt = pSegs.reduce((s, seg) => s + seg.gainFt, 0);
    const lossFt = pSegs.reduce((s, seg) => s + seg.lossFt, 0);
    const netFt = gainFt - lossFt;
    const totalM = pSegs.reduce((s, seg) => s + seg.distanceM, 0);
    const weightedPace = pSegs.reduce((s, seg) => s + seg.targetPaceSPerMi * seg.distanceM, 0) / totalM;

    const phaseGels = gels.filter(g => g.at_mile >= startMi && g.at_mile < endMi);
    const { name, strategy_note } = namingPhase(p, total, netFt, gainFt, lossFt);

    phases.push({
      index: p,
      name,
      start_mi: Math.round(startMi * 10) / 10,
      end_mi: Math.round(Math.min(endMi, totalMiles) * 10) / 10,
      avg_pace_s: weightedPace,
      avg_pace_display: formatPace(weightedPace),
      gain_ft: Math.round(gainFt),
      loss_ft: Math.round(lossFt),
      net_ft: Math.round(netFt),
      gels: phaseGels,
      strategy_note,
    });
  }

  return phases;
}

function namingPhase(
  idx: number,
  total: number,
  netFt: number,
  gainFt: number,
  lossFt: number,
): { name: string; strategy_note: string } {
  if (idx === 0) {
    return {
      name: 'Opening Miles',
      strategy_note: 'Settle in. Hold back — adrenaline will push you too fast early.',
    };
  }
  if (idx === total - 1) {
    return {
      name: 'Final Push',
      strategy_note: 'Empty the tank. Leave nothing on the course.',
    };
  }
  if (netFt > 150) {
    return {
      name: gainFt > 300 ? 'Major Climb' : 'Climb',
      strategy_note: 'Shorten your stride, stay relaxed. Run by effort, not pace.',
    };
  }
  if (netFt < -150) {
    return {
      name: lossFt > 300 ? 'Big Descent' : 'Descent',
      strategy_note: 'Let gravity help. Protect your quads — you need them later.',
    };
  }
  if (netFt > 50) {
    return {
      name: 'Rolling Uphill',
      strategy_note: 'Steady effort. Stay relaxed through the undulations.',
    };
  }
  if (netFt < -50) {
    return {
      name: 'Rolling Downhill',
      strategy_note: 'Recover here. Float downhill, don\'t brake.',
    };
  }
  return {
    name: 'Cruise Miles',
    strategy_note: 'Cruise control. Bank time and stay patient.',
  };
}

/** Generic 4-phase plan when no GPX is available. */
function genericPhases(totalMiles: number, gels: GelPlacement[]): RacePhase[] {
  const splits = [0, totalMiles * 0.25, totalMiles * 0.5, totalMiles * 0.75, totalMiles];
  const names = ['Opening Miles', 'Early Race', 'Mid Race', 'Final Push'];
  const notes = [
    'Settle in. Hold back — adrenaline will push you too fast.',
    'Find your rhythm. This is your target effort.',
    'Stay patient. The race starts at mile 20.',
    'Empty the tank. Leave nothing on the course.',
  ];

  return splits.slice(0, -1).map((start, i) => {
    const end = splits[i + 1];
    const phaseGels = gels.filter(g => g.at_mile >= start && g.at_mile < end);
    return {
      index: i,
      name: names[i],
      start_mi: Math.round(start * 10) / 10,
      end_mi: Math.round(end * 10) / 10,
      avg_pace_s: 0,       // filled at plan build time — set by caller
      avg_pace_display: '', // filled at plan build time
      gain_ft: 0,
      loss_ft: 0,
      net_ft: 0,
      gels: phaseGels,
      strategy_note: notes[i],
    };
  });
}

// ─── Track downsampling ───────────────────────────────────────────────────────

function downsampleTrack(track: GpxTrack, maxPts: number): TrackPoint[] {
  const { points } = track;
  if (points.length <= maxPts) {
    return points.map(p => ({
      lat: p.lat,
      lon: p.lon,
      distMi: p.distM / M_PER_MI,
      eleFt: p.eleM * FT_PER_M,
    }));
  }
  const step = points.length / maxPts;
  const out: TrackPoint[] = [];
  for (let i = 0; i < maxPts; i++) {
    const p = points[Math.round(i * step)];
    out.push({ lat: p.lat, lon: p.lon, distMi: p.distM / M_PER_MI, eleFt: p.eleM * FT_PER_M });
  }
  // Always include last point
  const last = points[points.length - 1];
  out.push({ lat: last.lat, lon: last.lon, distMi: last.distM / M_PER_MI, eleFt: last.eleM * FT_PER_M });
  return out;
}

// ─── Elevation chart data ────────────────────────────────────────────────────

function buildSegmentsSummary(segments: Segment[], track: GpxTrack): SegmentSummary[] {
  return segments.map(seg => {
    // Find a track point near the segment start to get elevation
    const targetM = seg.startMi * M_PER_MI;
    const pt = track.points.find(p => p.distM >= targetM) ?? track.points[0];
    return {
      startMi: seg.startMi,
      endMi: seg.endMi,
      eleFt: pt.eleM * FT_PER_M,
      gradePct: seg.meanGradePct,
      targetPaceS: seg.targetPaceSPerMi,
    };
  });
}

// ─── Gel placement ────────────────────────────────────────────────────────────

function placeGels(
  totalMiles: number,
  pacePerMile: number,
  nutritionNotes: string,
): GelPlacement[] {
  const hasCaffeine = /caffeine|caffeinated/i.test(nutritionNotes);
  const gelLabel = parseGelLabel(nutritionNotes);
  const cafLabel = parseCafLabel(nutritionNotes) ?? gelLabel + ' (caffeine)';

  const totalRaceS = pacePerMile * totalMiles;

  // Shorter races: first gel later, longer interval; ultras: standard interval capped at 12
  const FIRST_GEL_S = totalRaceS < 90 * 60 ? 40 * 60   // short race: 40 min
                    : 45 * 60;                            // marathon+: 45 min
  const GEL_INTERVAL_S = 32 * 60;
  const MAX_GELS = 12;                                    // cap for ultras
  const LAST_GEL_CUTOFF_S = totalRaceS - 55 * 60;        // no gel in final ~55 min

  // Race too short for any gels
  if (FIRST_GEL_S >= LAST_GEL_CUTOFF_S) return [];

  const gels: GelPlacement[] = [];
  let gelNumber = 1;
  let nextGelTimeS = FIRST_GEL_S;

  while (nextGelTimeS < LAST_GEL_CUTOFF_S && gelNumber <= MAX_GELS) {
    const atMile = Math.round(nextGelTimeS / pacePerMile * 10) / 10;
    if (atMile > totalMiles - 1) break;
    const useCaffeine = hasCaffeine && (gelNumber === 2 || gelNumber === 4);
    gels.push({ number: gelNumber, at_mile: atMile, caffeine: useCaffeine, label: useCaffeine ? cafLabel : gelLabel });
    gelNumber++;
    nextGelTimeS += GEL_INTERVAL_S;
  }
  return gels;
}

function parseGelLabel(notes: string): string {
  const sis = notes.match(/sis\s+go\s+(\w+)/i);
  if (sis) return `SiS GO ${sis[1]}`;
  const brand = notes.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+gel/);
  if (brand) return brand[1];
  return 'Gel';
}

function parseCafLabel(notes: string): string | null {
  if (/sis\s+go\s+caffeine/i.test(notes)) return 'SiS GO Caffeine';
  if (/caffeine/i.test(notes)) return 'Caffeine gel';
  return null;
}

function isNearAidStation(mile: number, aidMiles: number[] | null): boolean {
  if (!aidMiles) return false;
  return aidMiles.some(a => Math.abs(a - mile) <= 0.4);
}

// ─── Watch payload builder ─────────────────────────────────────────────────────

/** Find the track coordinate closest to a given distance in miles. */
function coordAtMile(track: GpxTrack, targetMi: number): WatchCoord | null {
  const targetM = targetMi * M_PER_MI;
  let closest = track.points[0];
  let minDelta = Math.abs(track.points[0].distM - targetM);
  for (const pt of track.points) {
    const delta = Math.abs(pt.distM - targetM);
    if (delta < minDelta) { minDelta = delta; closest = pt; }
    if (pt.distM > targetM + 200) break; // no need to look further
  }
  return { lat: closest.lat, lon: closest.lon };
}

function buildWatchPayload(input: {
  course: CourseResearch;
  raceDate: string;
  goalFinishS: number;
  pacePerMile: number;
  phases: RacePhase[] | null;
  gels: GelPlacement[];
  track: GpxTrack | null;
  gpxSource: RacePlan['gpx_source'];
}): WatchPayload {
  const { course, raceDate, goalFinishS, pacePerMile, phases, gels, track, gpxSource } = input;

  // Trigger radius: tighter for official GPX, looser for OSRM (less accurate)
  const triggerRadius = gpxSource === 'official_download' ? 80
    : gpxSource === 'user_upload' ? 80
    : gpxSource === 'community_gpx' ? 100   // real GPS data, slightly looser than official
    : gpxSource === 'osrm_synthetic' ? 150
    : 0;

  // Build watch phases with coordinate triggers
  const watchPhases: WatchPhase[] = (phases ?? []).map(phase => ({
    index: phase.index,
    name: phase.name,
    start_mi: phase.start_mi,
    end_mi: phase.end_mi,
    avg_pace_s: phase.avg_pace_s,
    avg_pace_display: phase.avg_pace_display,
    gain_ft: phase.gain_ft,
    loss_ft: phase.loss_ft,
    strategy_note: phase.strategy_note,
    gels: phase.gels,
    start_coord: track ? coordAtMile(track, phase.start_mi) : null,
    end_coord: track ? coordAtMile(track, phase.end_mi) : null,
  }));

  // Build gel triggers with coordinates
  const watchGels: WatchGelTrigger[] = gels.map(gel => ({
    number: gel.number,
    at_mile: gel.at_mile,
    caffeine: gel.caffeine,
    label: gel.label,
    coord: track ? coordAtMile(track, gel.at_mile) : null,
    trigger_radius_m: triggerRadius,
  }));

  // Build mile marker coordinates (every integer mile)
  const totalMiles = course.distance_mi;
  const mile_markers: WatchMileMarker[] = [];
  for (let m = 1; m <= Math.ceil(totalMiles); m++) {
    mile_markers.push({
      mile: m,
      coord: track ? coordAtMile(track, Math.min(m, totalMiles)) : null,
    });
  }

  return {
    race_name: course.race_name,
    race_date: raceDate,
    total_miles: totalMiles,
    goal_finish_s: goalFinishS,
    goal_display: formatHMS(goalFinishS),
    avg_pace_s: pacePerMile,
    gpx_source: gpxSource,
    phases: watchPhases,
    gels: watchGels,
    mile_markers,
  };
}
