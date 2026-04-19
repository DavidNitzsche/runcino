import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyStrategy, buildSegments, segmentCourse } from '../pacing';
import { parseGpx } from '../gpx';
import { M_PER_MI } from '../time';

describe('segmentCourse', () => {
  const xml = readFileSync(
    resolve(__dirname, '..', '..', 'public', 'sample-bigsur.gpx'),
    'utf8'
  );

  it('produces ~45-55 segments at 800m on Big Sur', () => {
    // On our synthetic GPX the haversine sum underestimates the mile-
    // indexed path (great-circle is shorter than the actual winding
    // road). The real 2024 GPX will measure ~53. Either is acceptable.
    const track = parseGpx(xml);
    const segs = segmentCourse(track, 800);
    expect(segs.length).toBeGreaterThan(40);
    expect(segs.length).toBeLessThan(60);
  });

  it('segments are contiguous in distance', () => {
    const track = parseGpx(xml);
    const segs = segmentCourse(track);
    for (let i = 1; i < segs.length; i++) {
      const deltaMi = Math.abs(segs[i].startMi - segs[i - 1].endMi);
      expect(deltaMi).toBeLessThan(0.01); // within 50 ft rounding
    }
  });

  it('has a positive-grade segment around Hurricane Point (mile 10-12)', () => {
    const track = parseGpx(xml);
    const segs = segmentCourse(track);
    const climbSegs = segs.filter(s => s.startMi >= 10 && s.endMi <= 12.5);
    expect(climbSegs.length).toBeGreaterThan(0);
    const maxGrade = Math.max(...climbSegs.map(s => s.meanGradePct));
    expect(maxGrade).toBeGreaterThan(3.0); // should be clearly uphill
  });
});

describe('applyStrategy — even effort', () => {
  const xml = readFileSync(
    resolve(__dirname, '..', '..', 'public', 'sample-bigsur.gpx'),
    'utf8'
  );

  it('scales paces so sum of (dist × pace) equals goal time', () => {
    const track = parseGpx(xml);
    const segs = buildSegments(track, {
      goalFinishS: 13800,       // 3:50:00
      strategy: 'even_effort',
      toleranceSPerMi: 10,
    });
    const totalS = segs.reduce(
      (t, s) => t + (s.distanceM / M_PER_MI) * s.targetPaceSPerMi, 0
    );
    expect(Math.abs(totalS - 13800)).toBeLessThan(2);  // within 2 seconds
  });

  it('Hurricane climb pace is slower than flat pace', () => {
    const track = parseGpx(xml);
    const totalMi = track.totalDistanceM / M_PER_MI;
    const flatPace = 13800 / totalMi;
    const segs = buildSegments(track, {
      goalFinishS: 13800,
      strategy: 'even_effort',
      toleranceSPerMi: 10,
    });
    const climbSegs = segs.filter(s => s.startMi >= 10 && s.endMi <= 12);
    const maxClimbPace = Math.max(...climbSegs.map(s => s.targetPaceSPerMi));
    expect(maxClimbPace).toBeGreaterThan(flatPace + 30); // at least 30s/mi slower
  });

  it('Bixby descent pace is faster than flat pace', () => {
    const track = parseGpx(xml);
    const totalMi = track.totalDistanceM / M_PER_MI;
    const flatPace = 13800 / totalMi;
    const segs = buildSegments(track, {
      goalFinishS: 13800,
      strategy: 'even_effort',
      toleranceSPerMi: 10,
    });
    const descSegs = segs.filter(s => s.startMi >= 12 && s.endMi <= 14);
    const minDescPace = Math.min(...descSegs.map(s => s.targetPaceSPerMi));
    expect(minDescPace).toBeLessThan(flatPace - 10);
  });
});

describe('applyStrategy — even split', () => {
  it('assigns the same pace everywhere', () => {
    const xml = readFileSync(
      resolve(__dirname, '..', '..', 'public', 'sample-bigsur.gpx'),
      'utf8'
    );
    const track = parseGpx(xml);
    const segs = buildSegments(track, {
      goalFinishS: 13800,
      strategy: 'even_split',
      toleranceSPerMi: 10,
    });
    const paces = new Set(segs.map(s => s.targetPaceSPerMi));
    expect(paces.size).toBe(1);
  });
});
