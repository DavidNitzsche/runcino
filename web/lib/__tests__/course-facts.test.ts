import { describe, expect, it } from 'vitest';
import {
  getCourseFacts,
  shippableLandmarks,
  shippablePhases,
  validateCourseFactsStructure,
  validateGpxAgainstCourse,
} from '../course-facts';
import type { GpxTrack } from '../types';

describe('getCourseFacts', () => {
  it('returns Big Sur facts', () => {
    const facts = getCourseFacts('big-sur-marathon');
    expect(facts.race.name).toBe('Big Sur International Marathon');
    expect(facts.race.expected_facts.distance_mi).toBe(26.22);
  });
});

describe('validateCourseFactsStructure', () => {
  it('passes on Big Sur', () => {
    const facts = getCourseFacts('big-sur-marathon');
    expect(() => validateCourseFactsStructure(facts)).not.toThrow();
  });

  it('throws if landmarks are out of order', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.landmarks.push({ ...facts.landmarks[0], at_mi: 0.1 });
    expect(() => validateCourseFactsStructure(facts)).toThrow(/out of order/i);
  });

  it('throws if a phase lacks a source citation', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.phases[0].sources = [];
    expect(() => validateCourseFactsStructure(facts)).toThrow(/no source citation/i);
  });

  it('throws if a landmark lacks a source', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.landmarks[0].sources = [];
    expect(() => validateCourseFactsStructure(facts)).toThrow(/no source citation/i);
  });

  it('throws if first phase does not start at 0', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.phases[0].start_mi = 0.5;
    expect(() => validateCourseFactsStructure(facts)).toThrow(/start at 0\.0/i);
  });
});

describe('shippableLandmarks', () => {
  it('returns only landmarks with primary_source_verified citations', () => {
    const facts = getCourseFacts('big-sur-marathon');
    const safe = shippableLandmarks(facts);
    expect(safe.length).toBeGreaterThan(0);
    for (const l of safe) {
      expect(l.sources.some(s => s.confidence === 'primary_source_verified')).toBe(true);
    }
  });

  it('filters out unverified rumors if any', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.landmarks.push({
      at_mi: 15,
      kind: 'landmark',
      label: 'TEST · rumored thing',
      note: 'test',
      sources: [{ url: 'https://example.com', confidence: 'unverified_rumor', verified_at: '2026-04-19' }],
    });
    const safe = shippableLandmarks(facts);
    expect(safe.find(l => l.label.startsWith('TEST'))).toBeUndefined();
  });
});

describe('shippablePhases', () => {
  it('returns all phases when all have primary citations', () => {
    const facts = getCourseFacts('big-sur-marathon');
    const safe = shippablePhases(facts);
    expect(safe.length).toBe(facts.phases.length);
  });

  it('throws if a phase lacks primary-source citation', () => {
    const facts = structuredClone(getCourseFacts('big-sur-marathon'));
    facts.phases[0].sources = [
      { url: 'https://wiki', confidence: 'secondary_source', verified_at: '2026-04-19' },
    ];
    expect(() => shippablePhases(facts)).toThrow(/lack primary-source/i);
  });
});

describe('validateGpxAgainstCourse', () => {
  it('flags a short GPX as error', () => {
    const facts = getCourseFacts('big-sur-marathon');
    const shortTrack: GpxTrack = {
      points: [],
      totalDistanceM: 30_000,  // 18.6 mi, short
      rawGainFt: 2000,
      rawLossFt: 2000,
      smoothedGainFt: 1800,
      smoothedLossFt: 1800,
    };
    const result = validateGpxAgainstCourse(shortTrack, facts);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/distance/i);
  });

  it('passes a correctly-sized GPX', () => {
    const facts = getCourseFacts('big-sur-marathon');
    const track: GpxTrack = {
      points: [],
      totalDistanceM: 42195,
      rawGainFt: 2200,
      rawLossFt: 2500,
      smoothedGainFt: 2100,
      smoothedLossFt: 2450,
    };
    const result = validateGpxAgainstCourse(track, facts);
    expect(result.ok).toBe(true);
  });
});
