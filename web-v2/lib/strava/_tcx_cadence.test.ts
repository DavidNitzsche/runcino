import { describe, it, expect } from 'vitest';
import { tcxCadence, buildTcx } from './build-tcx';

/**
 * The round trip is the proof. This app writes both-feet, TCX means per-leg,
 * and `pullSync` doubles what comes back — so an unhalved emitter published
 * double and the importer's doubling could never restore it.
 */
describe('TCX cadence · per-leg on the wire, both-feet in the app', () => {
  it('halves a real cadence', () => {
    expect(tcxCadence(166)).toBe(83);
    expect(tcxCadence(172)).toBe(86);
  });

  it('survives the round trip through the importer\'s doubling', () => {
    // pullSync doubles Strava's per-leg value back to both-feet.
    for (const bothFeet of [140, 152, 166, 172, 180]) {
      const roundTripped = tcxCadence(bothFeet) * 2;
      expect(Math.abs(roundTripped - bothFeet)).toBeLessThanOrEqual(1);
    }
  });

  it('CONTROL · the unhalved value would land outside a plausible per-leg range', () => {
    // 166 both-feet published raw reads as 166 per-leg, i.e. 332 steps/min.
    // Nothing runs at 332. This is what shipped.
    expect(166).toBeGreaterThan(120);        // implausible as per-leg
    expect(tcxCadence(166)).toBeLessThan(120); // plausible as per-leg
  });

  it('the emitted document carries the halved figure, not the stored one', () => {
    const xml = buildTcx({
      startIso: '2026-08-24T14:00:00Z',
      durationSec: 2065,
      distanceMi: 4.02,
      avgCadenceSpm: 166,
      laps: [{ startIso: '2026-08-24T14:00:00Z', durationSec: 2065, distanceMi: 4.02, avgCadence: 166 }],
    } as never);
    expect(xml).toContain('<Cadence>83</Cadence>');
    expect(xml).not.toContain('<Cadence>166</Cadence>');
  });
});
