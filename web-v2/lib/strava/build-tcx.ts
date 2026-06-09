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
 * - Pace comes from the run's per-mile splits when present: trackpoint
 *   times are laid on a per-mile grid so each mile runs at its real split
 *   pace, and Strava renders the true profile (e.g. a tempo's fast block).
 *   Falls back to even distribution (constant pace) when no splits exist.
 *   A monotonic-time guard prevents Strava speed spikes from near-duplicate
 *   polyline points.
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
  /** Per-mile splits ({mile, durationSec}) → per-mile pace on the track. */
  splits?: Array<{ mile: number; durationSec: number }> | null;
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
    ? trackpointsFromPolyline(opts.routePolyline, firstStartMs, lastEndMs, totalMeters, gainMeters, opts.splits ?? null, opts.durationSec)
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
  splits: Array<{ mile: number; durationSec: number }> | null,
  durationSec: number,
): Array<{ timeMs: number; lat: number; lng: number; cumDistM: number; altitudeM: number | null }> {
  const pts = decodePolyline(encoded);
  if (pts.length < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineMeters(pts[i - 1], pts[i]));
  const polyTotal = cum[cum.length - 1] || 1;
  const span = Math.max(1, endMs - startMs);
  const distScale = totalMeters > 0 ? totalMeters / polyTotal : 1;

  // Time grid → time fraction [0,1] at a given cumulative distance d (m).
  // With per-mile splits we lay a per-mile grid so each mile runs at its
  // real split pace (Strava shows the true profile, e.g. a tempo). Assumes
  // contiguous 1-mile splits (watch data). The tail beyond the last split
  // takes the remaining time (durationSec − Σsplits). Without usable splits
  // we fall back to even distribution (time ∝ distance → constant pace).
  const MILE_M = 1609.344;
  let timeFrac: (d: number) => number;
  if (Array.isArray(splits) && splits.length > 0 && durationSec > 0 && totalMeters > 0) {
    const dur = splits.map((s) => Math.max(0, Number(s.durationSec) || 0));
    const nS = dur.length;
    const cumSec: number[] = [0];
    for (let m = 0; m < nS; m++) cumSec.push(cumSec[m] + dur[m]);
    const splitSum = cumSec[nS];
    const tailDist = Math.max(0, totalMeters - nS * MILE_M);
    const tailDur = Math.max(0, durationSec - splitSum);
    timeFrac = (d: number) => {
      let sec: number;
      if (tailDist <= 0 || d <= nS * MILE_M) {
        const mi = Math.min(nS - 1, Math.max(0, Math.floor(d / MILE_M)));
        const within = Math.max(0, Math.min(1, (d - mi * MILE_M) / MILE_M));
        sec = cumSec[mi] + within * dur[mi];
      } else {
        const within = Math.min(1, (d - nS * MILE_M) / tailDist);
        sec = splitSum + within * tailDur;
      }
      return Math.min(1, sec / durationSec);
    };
  } else {
    timeFrac = (d: number) => (totalMeters > 0 ? Math.min(1, d / totalMeters) : 0);
  }

  const out = pts.map((p, i) => {
    const cumScaled = cum[i] * distScale;
    const progress = Math.min(1, cum[i] / polyTotal);
    return {
      timeMs: startMs + timeFrac(cumScaled) * span,
      lat: p[0],
      lng: p[1],
      cumDistM: cumScaled,
      // Option C: smooth half-sine profile. sin(π·progress) rises to the
      // peak at the midpoint and returns to 0, so the total positive climb
      // equals gainMeters — no spikes, correct total gain. null → omit
      // altitude (let Strava DEM) when the run's gain is unknown.
      altitudeM: gainMeters != null ? gainMeters * Math.sin(Math.PI * progress) : null,
    };
  });

  // Monotonic-time guard: near-duplicate polyline points yield equal (or
  // out-of-order) times → Strava renders speed spikes. Force a small
  // strictly-increasing minimum step.
  const MIN_STEP_MS = 100;
  for (let i = 1; i < out.length; i++) {
    if (out[i].timeMs <= out[i - 1].timeMs) out[i].timeMs = out[i - 1].timeMs + MIN_STEP_MS;
  }
  return out;
}
