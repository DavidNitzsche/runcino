/**
 * Faster-than-prescribed quality work · which explanation?
 *
 * Running under target pace has two causes that call for opposite responses:
 * the targets are soft (a fitness lead), or the session was overcooked (an
 * execution problem). The engine assumed the first unconditionally and told
 * the runner "pace targets are too soft · refit VDOT" — which validates
 * overcooking and, on rebuild, hands back faster targets that make the next
 * session hotter still.
 *
 * Heart rate tells them apart. Research/03 §6 (Friel): zone 5a, "At LT", is
 * 100-102% of LTHR. Above that the session left the band it was prescribed for.
 */

import { describe, it, expect } from 'vitest';
import { fastQualityLeftTheBand, THRESHOLD_HR_CEILING_OF_TARGET } from './drift-monitor';

describe('the discriminator', () => {
  it('a majority of sessions above the band reads as overcooked', () => {
    expect(fastQualityLeftTheBand(4, 3)).toBe(true);
  });

  it('a minority does not', () => {
    expect(fastQualityLeftTheBand(4, 1)).toBe(false);
  });

  it('an exact split does not — the finding needs a majority behind it', () => {
    expect(fastQualityLeftTheBand(4, 2)).toBe(false);
  });

  it('no readable heart rate is NOT evidence of overcooking', () => {
    // Defaulting the other way would silently suppress every legitimate refit
    // for runners who train without a strap.
    expect(fastQualityLeftTheBand(0, 0)).toBe(false);
  });
});

describe('the band edge is the doctrine one', () => {
  it('sits at the top of Friel zone 5a, not at the target itself', () => {
    // 100-102% of LTHR is AT threshold. Treating the bare target as the
    // ceiling would call every session that ran 1 bpm hot an overcook.
    expect(THRESHOLD_HR_CEILING_OF_TARGET).toBeGreaterThan(1);
    expect(THRESHOLD_HR_CEILING_OF_TARGET).toBeCloseTo(1.02, 5);
  });

  it('a session 1% over target is inside the band; 3% over is not', () => {
    const target = 149;
    expect(target * 1.01 > target * THRESHOLD_HR_CEILING_OF_TARGET).toBe(false);
    expect(target * 1.03 > target * THRESHOLD_HR_CEILING_OF_TARGET).toBe(true);
  });
});
