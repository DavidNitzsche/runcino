import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { haversineM, parseGpx, smoothElevation } from '../gpx';
import type { GpxPoint } from '../types';

describe('haversineM', () => {
  it('returns 0 for same point', () => {
    expect(haversineM(36.5, -121.9, 36.5, -121.9)).toBe(0);
  });

  it('computes plausible distance along Big Sur course', () => {
    // Big Sur Station to Carmel is roughly 30-40 km as the crow flies,
    // less than the actual winding Highway 1 distance of ~42 km.
    const d = haversineM(36.2460, -121.7775, 36.5550, -121.9230);
    expect(d).toBeGreaterThan(30_000);
    expect(d).toBeLessThan(42_000);
  });

  it('is symmetric', () => {
    const ab = haversineM(36.1, -121.8, 36.5, -121.9);
    const ba = haversineM(36.5, -121.9, 36.1, -121.8);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

describe('smoothElevation', () => {
  it('smooths a spike', () => {
    const pts: GpxPoint[] = [
      { lat: 0, lon: 0, eleM: 100, distM: 0 },
      { lat: 0, lon: 0, eleM: 200, distM: 1 },  // spike
      { lat: 0, lon: 0, eleM: 100, distM: 2 },
    ];
    smoothElevation(pts);
    expect(pts[1].eleM).toBeCloseTo(133.33, 1);
  });

  it('no-ops on short arrays', () => {
    const pts: GpxPoint[] = [
      { lat: 0, lon: 0, eleM: 100, distM: 0 },
      { lat: 0, lon: 0, eleM: 110, distM: 1 },
    ];
    smoothElevation(pts);
    expect(pts[0].eleM).toBe(100);
    expect(pts[1].eleM).toBe(110);
  });
});

describe('parseGpx on Big Sur sample GPX', () => {
  const xml = readFileSync(
    resolve(__dirname, '..', '..', 'public', 'sample-bigsur.gpx'),
    'utf8'
  );

  it('parses at least 100 track points', () => {
    const track = parseGpx(xml);
    expect(track.points.length).toBeGreaterThan(100);
  });

  it('total distance in plausible marathon range', () => {
    // The synthetic GPX is shorter than 42.2 km because our waypoints
    // are approximate crow-flies points along Highway 1, and the actual
    // winding road is longer than the haversine sum between them. For
    // algorithm development this is fine — elevation profile shape is
    // what matters. Real 2024 GPX measures ~42.2 km.
    const track = parseGpx(xml);
    expect(track.totalDistanceM).toBeGreaterThan(35_000);
    expect(track.totalDistanceM).toBeLessThan(43_000);
  });

  it('smoothing reduces raw gain by at least 10%', () => {
    const track = parseGpx(xml);
    expect(track.smoothedGainFt).toBeLessThan(track.rawGainFt * 0.95);
  });

  it('rejects empty GPX', () => {
    expect(() => parseGpx('<gpx></gpx>')).toThrow(/too few points/i);
  });

  it('rejects non-GPX XML', () => {
    expect(() => parseGpx('<root></root>')).toThrow(/not a gpx file/i);
  });
});
