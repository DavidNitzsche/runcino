import { describe, expect, it } from 'vitest';
import { FLAT_COST, gaf, gradeAdjustmentFactor, minettiCost } from '../minetti';

describe('minettiCost', () => {
  it('returns 3.6 J/(kg·m) at flat', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6, 3);
  });

  it('FLAT_COST constant matches', () => {
    expect(FLAT_COST).toBeCloseTo(3.6, 3);
  });

  it('clamps extreme downhill to -45%', () => {
    const deep = minettiCost(-0.6);
    const cap = minettiCost(-0.45);
    expect(deep).toBe(cap);
  });

  it('clamps extreme uphill to +45%', () => {
    const steep = minettiCost(0.6);
    const cap = minettiCost(0.45);
    expect(steep).toBe(cap);
  });

  it('is monotonically increasing from moderate downhill upward', () => {
    // Minetti curve has a minimum around -10% (least costly downhill),
    // so we test monotonic increase from -5% upward.
    const samples = [-0.05, 0.0, 0.02, 0.05, 0.1, 0.15];
    for (let i = 1; i < samples.length; i++) {
      expect(minettiCost(samples[i])).toBeGreaterThan(minettiCost(samples[i - 1]));
    }
  });
});

describe('gradeAdjustmentFactor', () => {
  it('returns 1.0 on flat', () => {
    expect(gaf(0)).toBeCloseTo(1.0, 3);
  });

  it('makes downhills feel easier', () => {
    expect(gaf(-5)).toBeLessThan(1.0);   // -5% grade < 1.0
    expect(gaf(-5)).toBeGreaterThan(0.7); // but not crazy small
  });

  // Reference values from Minetti (2002) cost-of-running polynomial.
  // These are metabolic cost ratios C(g) / C(0), NOT "percent harder."
  it('produces canonical Minetti GAF values', () => {
    expect(gaf(0)).toBeCloseTo(1.00, 2);
    expect(gaf(3)).toBeCloseTo(1.17, 1);
    expect(gaf(5)).toBeCloseTo(1.30, 1);
    expect(gaf(8)).toBeCloseTo(1.51, 1);
    expect(gaf(10)).toBeCloseTo(1.66, 1);
  });

  it('Hurricane Point (+5%) has GAF ~1.30', () => {
    // Real value per Minetti's polynomial. This is the metabolic cost
    // ratio — a 1.30x GAF means you bleed ~30% more energy per second
    // than flat. Runners often cite "1.8x as hard" for 5% climbs, but
    // that's folk wisdom; the measured value is 1.30.
    expect(gradeAdjustmentFactor(5)).toBeGreaterThan(1.25);
    expect(gradeAdjustmentFactor(5)).toBeLessThan(1.35);
  });
});
