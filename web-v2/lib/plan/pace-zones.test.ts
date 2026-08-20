import { describe, it, expect } from 'vitest';
import { resolveZonePaces, formatDeltaLabel, formatPaceMinSec } from './pace-zones';
import { tPaceFromVdot, iPaceFromVdot, rPaceFromVdot } from '@/lib/training/vdot';

describe('resolveZonePaces — the per-zone re-anchor', () => {
  it('returns three independent zone rows, never a combined delta', () => {
    const zones = resolveZonePaces(50, 47);
    expect(zones.map((z) => z.id)).toEqual(['threshold', 'interval', 'rep']);
    expect(zones).toHaveLength(3);
  });

  it('zones move by DIFFERENT amounts on the same VDOT drop — no single headline delta', () => {
    const zones = resolveZonePaces(50, 47);
    const deltas = zones.map((z) => z.deltaSec);
    expect(deltas.every((d) => d != null)).toBe(true);
    // At least one pair of zones must disagree — a uniform delta across all
    // three would mean this module collapsed to a single number.
    const [t, i, r] = deltas as number[];
    expect(new Set([t, i, r]).size).toBeGreaterThan(1);
  });

  it('is built off the SAME bound curve functions, not a reinvented table', () => {
    const zones = resolveZonePaces(50, 47);
    const t = zones.find((z) => z.id === 'threshold')!;
    const i = zones.find((z) => z.id === 'interval')!;
    const r = zones.find((z) => z.id === 'rep')!;
    expect(t.beforeSPerMi).toBe(tPaceFromVdot(50));
    expect(t.afterSPerMi).toBe(tPaceFromVdot(47));
    expect(i.beforeSPerMi).toBe(iPaceFromVdot(50));
    expect(i.afterSPerMi).toBe(iPaceFromVdot(47));
    expect(r.beforeSPerMi).toBe(rPaceFromVdot(50));
    expect(r.afterSPerMi).toBe(rPaceFromVdot(47));
  });

  it('a fitness DROP (lower toVdot) makes every zone SLOWER (positive delta)', () => {
    const zones = resolveZonePaces(50, 47);
    for (const z of zones) expect(z.deltaSec!).toBeGreaterThan(0);
  });

  it('a fitness GAIN (higher toVdot) makes every zone FASTER (negative delta)', () => {
    const zones = resolveZonePaces(47, 52);
    for (const z of zones) expect(z.deltaSec!).toBeLessThan(0);
  });

  it('degrades to null rather than throwing when a VDOT is missing', () => {
    const zones = resolveZonePaces(null, 50);
    for (const z of zones) {
      expect(z.beforeSPerMi).toBeNull();
      expect(z.deltaSec).toBeNull();
    }
  });
});

describe('formatDeltaLabel', () => {
  it('always shows a sign', () => {
    expect(formatDeltaLabel(24)).toBe('+24 s/mi');
    expect(formatDeltaLabel(-19)).toBe('-19 s/mi');
    expect(formatDeltaLabel(0)).toBe('±0 s/mi');
  });
  it('rounds to whole seconds', () => {
    expect(formatDeltaLabel(24.6)).toBe('+25 s/mi');
  });
  it('is null when not computable', () => {
    expect(formatDeltaLabel(null)).toBeNull();
  });
});

describe('formatPaceMinSec', () => {
  it('formats m:ss', () => {
    expect(formatPaceMinSec(372)).toBe('6:12');
    expect(formatPaceMinSec(300)).toBe('5:00');
  });
  it('is null for an unreadable pace', () => {
    expect(formatPaceMinSec(null)).toBeNull();
    expect(formatPaceMinSec(0)).toBeNull();
  });
});
