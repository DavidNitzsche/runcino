/**
 * lib/health/_resync_preview.test.ts · DECISION 3's six fields, falsified.
 */
import { describe, it, expect } from 'vitest';
import { buildResyncPreview, type ResyncCandidate, type CurrentStoredRow } from './resync-preview';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const NOW = '2026-09-06T12:00:00.000Z';

describe('DECISION-3 · buildResyncPreview · the six fields', () => {
  it('a corrupted day (the REQUESTSTORM-2 shape) reports every field and WOULD CHANGE', () => {
    const candidates: ResyncCandidate[] = [
      { dateISO: '2026-08-23', recomputedTotalKcal: 812.4, sourceSampleCount: 1470 },
    ];
    const current = new Map<string, CurrentStoredRow>([
      ['2026-08-23', { dateISO: '2026-08-23', storedTotalKcal: 11.4 }],
    ]);
    const report = buildResyncPreview(USER, candidates, current, NOW);
    expect(report.rows).toHaveLength(1);
    const r = report.rows[0];
    expect(r.dateISO).toBe('2026-08-23');
    expect(r.currentStoredKcal).toBe(11.4);
    expect(r.onDeviceRecomputedKcal).toBe(812.4);
    expect(r.deltaKcal).toBeCloseTo(801.0, 5);
    expect(r.sourceSampleCount).toBe(1470);
    expect(r.upsertIdentity).toEqual({ userId: USER, sampleType: 'active_energy', sampleDate: '2026-08-23' });
    expect(r.wouldChange).toBe(true);
    expect(report.wouldChange).toHaveLength(1);
    expect(report.unchanged).toHaveLength(0);
  });

  it('a day that already agrees is UNCHANGED, not silently dropped from the report', () => {
    const candidates: ResyncCandidate[] = [
      { dateISO: '2026-08-24', recomputedTotalKcal: 650.0, sourceSampleCount: 1200 },
    ];
    const current = new Map<string, CurrentStoredRow>([
      ['2026-08-24', { dateISO: '2026-08-24', storedTotalKcal: 650.0 }],
    ]);
    const report = buildResyncPreview(USER, candidates, current, NOW);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].wouldChange).toBe(false);
    expect(report.wouldChange).toHaveLength(0);
    expect(report.unchanged).toHaveLength(1);
  });

  it('a date with no current stored row is a would-INSERT, and delta is null, never coerced to the raw total (Rule 11)', () => {
    const candidates: ResyncCandidate[] = [
      { dateISO: '2026-08-25', recomputedTotalKcal: 500.0, sourceSampleCount: 900 },
    ];
    const report = buildResyncPreview(USER, candidates, new Map(), NOW);
    const r = report.rows[0];
    expect(r.currentStoredKcal).toBeNull();
    expect(r.deltaKcal).toBeNull();
    expect(r.wouldChange).toBe(true);
  });

  it('a sub-cent floating rounding difference does not read as a change · Rule 9, no hair-trigger cliff', () => {
    const candidates: ResyncCandidate[] = [
      { dateISO: '2026-08-26', recomputedTotalKcal: 650.001, sourceSampleCount: 1000 },
    ];
    const current = new Map<string, CurrentStoredRow>([
      ['2026-08-26', { dateISO: '2026-08-26', storedTotalKcal: 650.0 }],
    ]);
    const report = buildResyncPreview(USER, candidates, current, NOW);
    expect(report.rows[0].wouldChange).toBe(false);
  });

  it('multiple dates split correctly into wouldChange and unchanged', () => {
    const candidates: ResyncCandidate[] = [
      { dateISO: '2026-08-23', recomputedTotalKcal: 812.4, sourceSampleCount: 1470 },
      { dateISO: '2026-08-24', recomputedTotalKcal: 650.0, sourceSampleCount: 1200 },
      { dateISO: '2026-08-17', recomputedTotalKcal: 700.0, sourceSampleCount: 1100 },
    ];
    const current = new Map<string, CurrentStoredRow>([
      ['2026-08-23', { dateISO: '2026-08-23', storedTotalKcal: 11.4 }],
      ['2026-08-24', { dateISO: '2026-08-24', storedTotalKcal: 650.0 }],
      ['2026-08-17', { dateISO: '2026-08-17', storedTotalKcal: 0.1 }],
    ]);
    const report = buildResyncPreview(USER, candidates, current, NOW);
    expect(report.rows).toHaveLength(3);
    expect(report.wouldChange.map((r) => r.dateISO).sort()).toEqual(['2026-08-17', '2026-08-23']);
    expect(report.unchanged.map((r) => r.dateISO)).toEqual(['2026-08-24']);
  });
});
