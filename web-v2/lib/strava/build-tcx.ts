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
 */

interface BuildOpts {
  runId: string;
  startLocalIso: string;
  durationSec: number;
  distanceMi: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgCadenceSpm?: number | null;
  routePolyline?: string | null;
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

  // For now we skip embedding per-trackpoint coordinates in TCX. Strava
  // accepts TCX without trackpoints and re-derives distance from laps.
  // The route polyline will be missing — that's the one trade-off vs GPX.
  // Future: decode polyline + emit <Trackpoint> blocks per coord with
  // synthesized time stamps; or fall back to GPX upload when route present.

  const lapXml = laps.map((lap, i) => `
    <Lap StartTime="${lap.startUtc}">
      <TotalTimeSeconds>${lap.durationSec.toFixed(1)}</TotalTimeSeconds>
      <DistanceMeters>${lap.distanceMeters.toFixed(2)}</DistanceMeters>
      <Calories>0</Calories>
      ${lap.avgHr != null ? `<AverageHeartRateBpm><Value>${Math.round(lap.avgHr)}</Value></AverageHeartRateBpm>` : ''}
      ${lap.maxHr != null ? `<MaximumHeartRateBpm><Value>${Math.round(lap.maxHr)}</Value></MaximumHeartRateBpm>` : ''}
      <Intensity>${lap.intensity}</Intensity>
      ${lap.avgCadence != null ? `<Cadence>${Math.round(lap.avgCadence)}</Cadence>` : ''}
      <TriggerMethod>Manual</TriggerMethod>
      ${lap.notes ? `<Notes>${xmlEsc(lap.notes)}</Notes>` : ''}
    </Lap>`).join('');

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
