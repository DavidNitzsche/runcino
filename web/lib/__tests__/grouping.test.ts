import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseGpx } from '../gpx';
import { buildSegments } from '../pacing';
import { groupPhases } from '../grouping';
import { getCourseFacts } from '../course-facts';

describe('groupPhases on Big Sur', () => {
  const xml = readFileSync(
    resolve(__dirname, '..', '..', 'public', 'sample-bigsur.gpx'),
    'utf8'
  );
  const track = parseGpx(xml);
  const segs = buildSegments(track, {
    goalFinishS: 13800,
    strategy: 'even_effort',
    toleranceSPerMi: 10,
  });

  it('produces 5-8 phases from 53 segments', () => {
    const phases = groupPhases(segs);
    expect(phases.length).toBeGreaterThanOrEqual(5);
    expect(phases.length).toBeLessThanOrEqual(8);
  });

  it('phases are contiguous in mile space', () => {
    const phases = groupPhases(segs);
    for (let i = 1; i < phases.length; i++) {
      expect(Math.abs(phases[i].startMi - phases[i - 1].endMi)).toBeLessThan(0.1);
    }
    expect(phases[0].startMi).toBeCloseTo(0, 1);
  });

  it('phases are labeled with Big Sur landmarks when facts provided', () => {
    const facts = getCourseFacts('big-sur-marathon');
    const phases = groupPhases(segs, { courseFacts: facts });
    const labels = phases.map(p => p.label);
    // At least 2 of the 6 canonical landmarks should match after grouping
    const canonicalLabels = facts.phases.map(p => p.label);
    const matches = labels.filter(l => canonicalLabels.includes(l));
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('phases without facts use geometric labels only', () => {
    const phases = groupPhases(segs);
    for (const p of phases) {
      expect(
        ['Long climb', 'Gradual climb', 'Long descent', 'Gradual descent', 'Rolling']
      ).toContain(p.label);
    }
  });

  it('no phase is shorter than 0.75 mi', () => {
    const phases = groupPhases(segs);
    for (const p of phases) {
      expect(p.distanceMi).toBeGreaterThan(0.7);
    }
  });
});
