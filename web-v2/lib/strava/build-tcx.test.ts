/**
 * Regression · a run with no GPS route must still carry a <Track>.
 *
 * 2026-08-21. Every treadmill push David made after 2026-07-15 reached
 * Strava, got an upload id back, and then died. GET /uploads/{id} on all
 * six, read days later with his own token:
 *
 *   { "error": null,
 *     "status": "There was an error processing your activity.",
 *     "activity_id": null }
 *
 * Cause: buildTcx emitted laps and no trackpoints at all when
 * routePolyline was null. Strava's TCX processor cannot build an activity
 * from that. Every outdoor push in the same window succeeded, which is
 * what made it look like the pipeline was fine.
 *
 * These tests fail against the old builder: assertions 1-4 all require
 * trackpoints that the pre-fix code never produced.
 */
import { describe, it, expect } from 'vitest';
import { buildTcx } from './build-tcx';

/** The real 2026-08-18 treadmill run, from prod. */
const TREADMILL = {
  runId: 'trd_A52AE3D4-AF74-44DF-84F6-41C8EAF082C2',
  startLocalIso: '2026-08-18T22:39:58.000Z',
  durationSec: 2254,
  distanceMi: 4.01,
  avgHr: 125,
  maxHr: 140,
  avgCadenceSpm: null,
  routePolyline: null,
  elevGainFt: 212,
  splits: null,
  phases: [{
    type: 'work',
    label: '4.0 mi easy',
    actualDurationSec: 2254,
    actualDistanceMi: 4.01,
    avgHr: 125,
    maxHr: 140,
    avgCadence: null,
  }],
};

function trackpoints(xml: string): string[] {
  return xml.match(/<Trackpoint>[\s\S]*?<\/Trackpoint>/g) ?? [];
}

describe('buildTcx · indoor run with no route', () => {
  it('emits a Track with trackpoints (the file Strava rejected had none)', () => {
    const xml = buildTcx(TREADMILL);
    expect(xml).toContain('<Track>');
    expect(trackpoints(xml).length).toBeGreaterThan(100);
  });

  it('omits Position rather than inventing coordinates', () => {
    const xml = buildTcx(TREADMILL);
    expect(xml).not.toContain('<Position>');
    expect(xml).not.toContain('<LatitudeDegrees>');
  });

  it('carries the belt distance and lands on the run total', () => {
    const xml = buildTcx(TREADMILL);
    const dists = [...xml.matchAll(/<DistanceMeters>([\d.]+)<\/DistanceMeters>/g)]
      .map((m) => Number(m[1]));
    // Lap total is first; trackpoint cumulative distances follow.
    const last = dists[dists.length - 1];
    expect(last).toBeCloseTo(4.01 * 1609.344, 0);
    // Strictly non-decreasing — Strava derives pace from this.
    const tpDists = dists.slice(1);
    for (let i = 1; i < tpDists.length; i++) {
      expect(tpDists[i]).toBeGreaterThanOrEqual(tpDists[i - 1]);
    }
  });

  it('spans the whole run and never runs time backwards', () => {
    const xml = buildTcx(TREADMILL);
    const times = [...xml.matchAll(/<Time>([^<]+)<\/Time>/g)].map((m) => Date.parse(m[1]));
    expect(times.length).toBeGreaterThan(100);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
    const spanSec = (times[times.length - 1] - times[0]) / 1000;
    expect(spanSec).toBeCloseTo(2254, 0);
  });

  it('does not paint the lap average HR onto every trackpoint', () => {
    // Rule 1 · a modelled number must never look measured. The lap carries
    // the real average; a flat per-point trace would read as a recording.
    const xml = buildTcx(TREADMILL);
    const tps = trackpoints(xml).join('');
    expect(tps).not.toContain('HeartRateBpm');
    expect(xml).toContain('<AverageHeartRateBpm><Value>125</Value></AverageHeartRateBpm>');
  });

  it('climbs monotonically, because a fixed incline never descends', () => {
    const xml = buildTcx(TREADMILL);
    const alts = [...xml.matchAll(/<AltitudeMeters>([\d.]+)<\/AltitudeMeters>/g)]
      .map((m) => Number(m[1]));
    expect(alts.length).toBeGreaterThan(100);
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i]).toBeGreaterThanOrEqual(alts[i - 1]);
    }
    expect(alts[alts.length - 1] - alts[0]).toBeCloseTo(212 * 0.3048, 1);
  });

  it('omits altitude entirely when the run reports no elevation gain', () => {
    const xml = buildTcx({ ...TREADMILL, elevGainFt: null });
    expect(xml).not.toContain('<AltitudeMeters>');
    expect(trackpoints(xml).length).toBeGreaterThan(100);
  });

  it('splits the track across multi-phase indoor sessions', () => {
    // The 2026-07-23 treadmill run carried 9 phases.
    const xml = buildTcx({
      ...TREADMILL,
      durationSec: 900,
      distanceMi: 2,
      phases: [
        { type: 'warmup', label: 'wu', actualDurationSec: 300, actualDistanceMi: 0.6, avgHr: 110, maxHr: 120, avgCadence: null },
        { type: 'work', label: 'rep', actualDurationSec: 300, actualDistanceMi: 0.8, avgHr: 160, maxHr: 172, avgCadence: null },
        { type: 'recovery', label: 'rec', actualDurationSec: 300, actualDistanceMi: 0.6, avgHr: 130, maxHr: 145, avgCadence: null },
      ],
    });
    const laps = xml.match(/<Lap StartTime=/g) ?? [];
    expect(laps.length).toBe(3);
    // Every lap gets its own trackpoints, not just the first.
    for (const lapXml of xml.split('<Lap StartTime=').slice(1)) {
      expect(lapXml).toContain('<Trackpoint>');
    }
  });

  it('leaves the outdoor path alone', () => {
    // A polyline still produces positioned trackpoints.
    const xml = buildTcx({
      ...TREADMILL,
      routePolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    });
    expect(xml).toContain('<LatitudeDegrees>');
    expect(xml).toContain('<LongitudeDegrees>');
  });

  it('never emits an empty Track element', () => {
    // Zero duration is the one case with nothing to say. It must produce
    // no <Track> at all rather than an empty one.
    const xml = buildTcx({
      ...TREADMILL,
      durationSec: 0,
      distanceMi: 0,
      phases: [],
    });
    expect(xml).not.toContain('<Track>');
  });
});
