/**
 * 2026-07-06 · P1-43 fix · pins judgeEasyRunHr — the server-side easy-run HR
 * read that replaces the phone panel's hardcoded `let lthrish = 162`.
 *
 * Doctrine: Research/03-heart-rate-zones.md §6 (Friel zones · Z2 upper =
 * 0.89 × LTHR) + Research/06-weather-adjustments.md §1 (heat HR bump).
 */
import { describe, it, expect } from 'vitest';
import { judgeEasyRunHr, lthrZones, computeZones } from './zones';

describe('judgeEasyRunHr', () => {
  it('aerobic · easy run under the Z2 ceiling', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 162 });
    expect(j).toEqual({ verdict: 'aerobic', deltaBpm: -22, easyCeilingBpm: 144 });
  });

  it('gray-zone · between Z2 upper and threshold (too hard for an easy day)', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 152, thresholdBpm: 162 });
    expect(j!.verdict).toBe('gray-zone');
    expect(j!.deltaBpm).toBe(-10);
  });

  it('above-threshold · quality effort wearing an easy label', () => {
    const j = judgeEasyRunHr({ avgHrBpm: 165, thresholdBpm: 162 });
    expect(j!.verdict).toBe('above-threshold');
    expect(j!.deltaBpm).toBe(3);
  });

  it('P1-43 archetypes · the same avg HR judges differently per physiology', () => {
    // Young beginner · LTHR 185 · easy at 170: the old panel said "+8 vs
    // threshold" against the constant 162. Against THEIR threshold it is
    // 15 bpm UNDER — Z3/Z4 gray-zone, not an over-threshold alarm.
    const young = judgeEasyRunHr({ avgHrBpm: 170, thresholdBpm: 185 });
    expect(young!.verdict).toBe('gray-zone');
    expect(young!.deltaBpm).toBe(-15);
    // 60-year-old · LTHR 145 · running 155: the constant said "-7, green".
    // Against THEIR threshold it is a hard effort.
    const older = judgeEasyRunHr({ avgHrBpm: 155, thresholdBpm: 145 });
    expect(older!.verdict).toBe('above-threshold');
    expect(older!.deltaBpm).toBe(10);
  });

  it('heat bump shifts the bands up (per-finding context filter)', () => {
    // 148 vs LTHR 162: ceiling 144 → gray-zone on a cool day…
    expect(judgeEasyRunHr({ avgHrBpm: 148, thresholdBpm: 162 })!.verdict).toBe('gray-zone');
    // …but aerobic with a +5 heat bump (thermoregulation, not effort).
    const hot = judgeEasyRunHr({ avgHrBpm: 148, thresholdBpm: 162, heatBumpBpm: 5 });
    expect(hot!.verdict).toBe('aerobic');
    expect(hot!.easyCeilingBpm).toBe(149);
    // The display delta stays anchored on the un-bumped threshold.
    expect(hot!.deltaBpm).toBe(-14);
  });

  it('implausible inputs → null · skip the judgment, never fabricate', () => {
    expect(judgeEasyRunHr({ avgHrBpm: 250, thresholdBpm: 162 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 40, thresholdBpm: 162 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 100 })).toBeNull();
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 240 })).toBeNull();
  });

  it('ceiling matches the Friel Z2 upper the zone table publishes', () => {
    const z2upper = lthrZones(162).zones.find((z) => z.idx === 2)!.upper;
    expect(judgeEasyRunHr({ avgHrBpm: 140, thresholdBpm: 162 })!.easyCeilingBpm).toBe(z2upper);
  });
});

describe('computeZones bounds (unchanged · guards the resolver gates)', () => {
  it('accepts plausible LTHR, rejects implausible', () => {
    expect(computeZones({ lthr: 162 })!.method).toBe('lthr-friel');
    expect(computeZones({ lthr: 90 })).toBeNull();
    expect(computeZones({ maxHr: 190 })!.method).toBe('pct-mhr');
  });
});
