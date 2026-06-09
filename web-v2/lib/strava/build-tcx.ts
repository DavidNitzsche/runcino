/**
 * build-tcx.ts — build a Strava-compatible TCX file from a run.
 *
 * TCX (Training Center XML) supports LAP-LEVEL metadata which is what
 * makes the push interesting vs Strava-native: each phase (warmup, rep,
 * recovery, cooldown) becomes a Lap with its own time + distance + HR
 * average, so Strava renders them as separate splits in the activity feed.
 *
 * Input: a strava_activities row's data jsonb (the same shape /api/runs/[id]
 * surfaces). We accept the loosely-typed shape because it varies by source
 * (Faff watch / HK importer / manual entry).
 *
 * TCX docs: https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd
 *
 * NOTES on what we ship:
 * - Lap data when phases exist (Faff watch runs).
 * - Single-lap when no phases (Apple Watch Workouts, manual).
 * - HR + cadence per-lap averages (not per-second; Strava re-derives).
 * - GPS track from route_polyline when present.
 * - Altitude is SYNTHESIZED (Option C): a smooth half-sine profile whose
 *   total climb equals the run's real elevGainFt. A polyline carries no
 *   elevation, and Strava's DEM on the sparse summary polyline spiked to
 *   600-1400ft on a flat (56ft) run — so we hand Strava a clean profile
 *   with the correct total gain instead of letting it DEM the sparse track.
 * - Pace/splits are SYNTHESIZED too: trackpoint times are distributed
 *   evenly along the polyline (proportional to distance), so Strava derives
 *   a ~constant pace (e.g. 8:01/mi). Real per-mile variation would need the
 *   watch's per-split timing, which isn't threaded through here (known
 *   limitation, accepted 2026-06-09).
 */
import { decodePolyline } from '@/lib/route/polyline';

interface BuildOpts {
  runId: string;
  startLocalIso: string;
  durationSec: number;
  distanceMi: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadenceSpm?: number | null;
  routePolyline?: string | null;
  elevGainFt?: number | null;
  phases?: Array<{
    type: string;
    label?: string | null;
    actualDurationSec?: number;
    actualDistanceMi?: number;
    avgHr?: number | null;
    maxHr?: number | null;
    avgCadence?: number | null;
  }>;
}

export function buildTcx(opts: BuildOpts): string {
  const startUtc = toUtcIso(opts.startLocalIso);
  const totalMeters = opts.distanceMi * 1609.344;

  // Lap structure: if phases exist, one lap per phase. Otherwise one
  // single-lap activity.
  const laps = (opts.phases && opts.phases.length > 0)
    ? laneLapsFromPhases(opts.phases, startUtc)
    : [{
        startUtc,
        durationSec: opts.durationSec,
        distanceMeters: totalMeters,
        avgHr: opts.avgHr ?? null,
        maxHr: opts.maxHr ?? null,
        avgCadence: opts.avgCadenceSpm ?? null,
        intensity: 'Active' as const,
        notes: null as string | null,
      }];

  // GPS track from the route polyline, distributed across the lap timeline.
  // No polyline → empty track → no <Track> emitted (byte-identical to the
  // laps-only output we shipped before).
  const firstStartMs = Date.parse(laps[0].startUtc);
  const lastEndMs = Date.parse(laps[laps.length - 1].startUtc)
    + laps[laps.length - 1].durationSec * 1000;
  // Option C elevation: synthesize altitude from the run's real total gain
  // (feet → meters). null when unknown → trackpoints omit altitude → DEM.
  const gainMeters = opts.elevGainFt != null ? opts.elevGainFt * 0.3048 : null;
  const track = opts.routePolyline
    ? trackpointsFromPolyline(opts.routePolyline, firstStartMs, lastEndMs, totalMeters, gainMeters)
    : [];

  const lapXml = laps.map((lap, i) => {
    const isLast = i === laps.length - 1;
    const lapStartMs = Date.parse(lap.startUtc);
    const lapEndMs = lapStartMs + lap.durationSec * 1000;
    const lapTps = track.filter((tp) =>
      tp.timeMs >= lapStartMs && (isLast ? tp.timeMs <= lapEndMs : tp.timeMs < lapEndMs));
    const trackXml = lapTps.length > 0
      ? `\n      <Track>${lapTps.map((tp) => `
        <Trackpoint><Time>${new Date(tp.timeMs).toISOString()}</Time><Position><LatitudeDegrees>${tp.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${tp.lng.toFixed(6)}</LongitudeDegrees></Position>${tp.altitudeM != null ? `<AltitudeMeters>${tp.altitudeM.toFixed(1)}</AltitudeMeters>` : ''}<DistanceMeters>${tp.cumDistM.toFixed(1)}</DistanceMeters></Trackpoint>`).join('')}
      </Track>`
      : '';
    return `
    <Lap StartTime="${lap.startUtc}">
      <TotalTimeSeconds>${lap.durationSec.toFixed(1)}</TotalTimeSeconds>
      <DistanceMeters>${lap.distanceMeters.toFixed(2)}</DistanceMeters>
      <Calories>0</Calories>
      ${lap.avgHr != null ? `<AverageHeartRateBpm><Value>${Math.round(lap.avgHr)}</Value></AverageHeartRateBpm>` : ''}
      ${lap.maxHr != null ? `<MaximumHeartRateBpm><Value>${Math.round(lap.maxHr)}</Value></MaximumHeartRateBpm>` : ''}
      <Intensity>${lap.intensity}</Intensity>
      ${lap.avgCadence != null ? `<Cadence>${Math.round(lap.avgCadence)}</Cadence>` : ''}
      <TriggerMethod>Manual</TriggerMethod>${trackXml}
      ${lap.notes ? `<Notes>${xmlEsc(lap.notes)}</Notes>` : ''}
    </Lap>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd"
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Activities>
    <Activity Sport="Running">
      <Id>${startUtc}</Id>${lapXml}
      <Creator xsi:type="Device_t">
        <Name>Faff</Name>
        <UnitId>0</UnitId>
        <ProductID>1</ProductID>
        <Version><VersionMajor>1</VersionMajor><VersionMinor>0</VersionMinor><BuildMajor>0</BuildMajor><BuildMinor>0</BuildMinor></Version>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

/**
 * Convert phase records into TCX laps with cumulative start times.
 * Recovery + rest phases get intensity='Resting' which gives them a
 * different visual treatment in Strava's lap view.
 */
function laneLapsFromPhases(
  phases: NonNullable<BuildOpts['phases']>,
  workoutStartUtc: string,
) {
  const result: Array<{
    startUtc: string;
    durationSec: number;
    distanceMeters: number;
    avgHr: number | null;
    maxHr: number | null;
    avgCadence: number | null;
    intensity: 'Active' | 'Resting';
    notes: string | null;
  }> = [];

  let cursorMs = new Date(workoutStartUtc).getTime();

  for (const p of phases) {
    const dur = Number(p.actualDurationSec) || 0;
    const dist = (Number(p.actualDistanceMi) || 0) * 1609.344;
    if (dur === 0) continue;

    const isResting = p.type === 'recovery' || p.type === 'rest';
    result.push({
      startUtc: new Date(cursorMs).toISOString(),
      durationSec: dur,
      distanceMeters: dist,
      avgHr: typeof p.avgHr === 'number' ? p.avgHr : null,
      maxHr: typeof p.maxHr === 'number' ? p.maxHr : null,
      avgCadence: typeof p.avgCadence === 'number' ? p.avgCadence : null,
      intensity: isResting ? 'Resting' : 'Active',
      notes: p.label ?? null,
    });
    cursorMs += dur * 1000;
  }

  // If everything got filtered out (no usable durations), fall back to
  // one single-lap stub so the activity isn't empty.
  if (result.length === 0) {
    result.push({
      startUtc: workoutStartUtc,
      durationSec: 1,
      distanceMeters: 0,
      avgHr: null, maxHr: null, avgCadence: null,
      intensity: 'Active',
      notes: null,
    });
  }
  return result;
}

/** Convert local ISO to UTC ISO. Naive — assumes runner is in their local TZ. */
function toUtcIso(localIso: string): string {
  const d = new Date(localIso);
  if (isNaN(d.getTime())) {
    return new Date().toISOString();
  }
  return d.toISOString();
}

function xmlEsc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const EARTH_M = 6371008.8; // mean Earth radius, meters

function haversineMeters(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2
    + Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a[0])) * Math.cos(toRad(b[0]));
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Decode a Google-encoded polyline into TCX trackpoints. The polyline has
 * no timestamps, so we synthesize a time + cumulative distance per point,
 * distributed proportional to along-track (haversine) distance and scaled
 * to the run's [startMs, endMs] window. Cumulative distance is rescaled to
 * the run's reported total so the track ends exactly at the activity
 * distance. Gives Strava a correct route map; pace re-derives from the
 * synthesized time/distance (no per-point speed to do better).
 */
function trackpointsFromPolyline(
  encoded: string,
  startMs: number,
  endMs: number,
  totalMeters: number,
  gainMeters: number | null,
): Array<{ timeMs: number; lat: number; lng: number; cumDistM: number; altitudeM: number | null }> {
  const pts = decodePolyline(encoded);
  if (pts.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineMeters(pts[i - 1], pts[i]));
  const polyTotal = cum[cum.length - 1] || 1;
  const span = Math.max(1, endMs - startMs);
  const distScale = totalMeters > 0 ? totalMeters / polyTotal : 1;
  return pts.map((p, i) => {
    const progress = Math.min(1, cum[i] / polyTotal);
    return {
      timeMs: startMs + progress * span,
      lat: p[0],
      lng: p[1],
      cumDistM: cum[i] * distScale,
      // Option C: smooth half-sine profile. sin(π·progress) rises to the
      // peak at the midpoint and returns to 0, so the total positive climb
      // equals gainMeters — no spikes, correct total gain. null → omit
      // altitude (let Strava DEM) when the run's gain is unknown.
      altitudeM: gainMeters != null ? gainMeters * Math.sin(Math.PI * progress) : null,
    };
  });
}
