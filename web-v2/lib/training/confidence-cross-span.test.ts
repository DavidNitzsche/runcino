/**
 * CI-CROSS-1 · `Research/02` §13.7's bands are keyed on the SPAN, not the
 * target.
 *
 * `vdotAnchorDistanceMi` was threaded into `computeConfidenceInterval` in
 * 2026-06, destructured, and never read — so a marathon-goal runner anchored on
 * a 5K PR got the same ±3% symmetric band as one anchored on a half.
 */
import { describe, it, expect } from 'vitest';
import { computeConfidenceInterval, CROSS_SPAN_CI_PCT } from './goal-projection';

const MARATHON = 26.2188;
const HALF = 13.1;
const TEN_K = 6.21371;
const FIVE_K = 3.10686;

// A 3:20 marathon projection.
const PROJ = 12_000;

describe('CI-CROSS-1 · the anchor distance is the left-hand side of §13.7', () => {
  it('an unknown anchor changes nothing · not knowing the span is not evidence about it', () => {
    const before = computeConfidenceInterval({ centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track' });
    const after = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track', vdotAnchorDistanceMi: null,
    });
    expect(after).toEqual(before);
    expect(before!.pct).toBe(3.0);
    expect(before!.method).toBe('research-span');
  });

  it('marathon off a 5K anchor, no marathon block · ±10% ONE-SIDED', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ,
      raceDistanceMi: MARATHON,
      status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K,
      marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock); // 10.0
    expect(ci.method).toBe('research-span-cross');
    expect(ci.oneSided).toBe(true);
    // The band opens toward SLOW only: doctrine states the error runs one way.
    expect(ci.lo).toBe(PROJ);
    expect(ci.hi).toBe(PROJ + 1200); // 3:20:00 → 3:40:00
  });

  it('an unknown block reads as no block · doctrine says which way to lean (§14.7)', () => {
    const unknown = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: null,
    })!;
    expect(unknown.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock);
    expect(unknown.oneSided).toBe(true);
  });

  it('marathon off a 5K anchor WITH a marathon block · ±5% symmetric', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: true,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonTrained); // 5.0
    expect(ci.oneSided).toBeUndefined();
    expect(ci.lo).toBe(PROJ - 600);
    expect(ci.hi).toBe(PROJ + 600);
  });

  it('§13.1 reads a 10K anchor into the same row · "sub-half-marathon input"', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDistanceMi: TEN_K, marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.shortToMarathonNoBlock);
  });

  it('marathon off a HALF anchor stays at the ±3% same-distance band', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track', vdotAnchorDistanceMi: HALF,
    })!;
    expect(ci.pct).toBe(3.0);
  });

  it('a span whose doctrine row is TIGHTER than the target default never narrows the band', () => {
    // §13.7's "5K → 10K, recent input" is ±1.5%; the engine's same-distance
    // 10K default is ±2.0% (that row plus §11.1's input-noise margin). A
    // cross-distance prediction must not read tighter than a same-distance one.
    const ci = computeConfidenceInterval({
      centerSec: 2400, raceDistanceMi: TEN_K, status: 'on-track', vdotAnchorDistanceMi: FIVE_K,
    })!;
    expect(ci.pct).toBe(2.0);
    expect(ci.method).toBe('research-span');
  });

  it('the stale-input override still wins outright', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'on-track',
      vdotAnchorDateISO: '2020-01-01', vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: false,
    })!;
    expect(ci.method).toBe('research-span-stale');
    expect(ci.pct).toBe(CROSS_SPAN_CI_PCT.staleInput);
  });

  it('status scaling still applies on top of the cross-span row', () => {
    const ci = computeConfidenceInterval({
      centerSec: PROJ, raceDistanceMi: MARATHON, status: 'off-track',
      vdotAnchorDistanceMi: FIVE_K, marathonSpecificTraining: false,
    })!;
    expect(ci.pct).toBe(15.0); // 10.0 × 1.5
  });
});
