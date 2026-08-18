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
import {
  fastQualityLeftTheBand,
  slowQualityNeverReachedTheBand,
  ranAboveThresholdBand,
  ranBelowThresholdBand,
  THRESHOLD_HR_CEILING_OF_TARGET,
  THRESHOLD_HR_FLOOR_OF_TARGET,
} from '@/lib/training/threshold-band';

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

describe('the recap says the right thing about a fast tempo', () => {
  // The old copy was "pushed the tempo today", which reads as approval for
  // whichever of the two explanations it was.
  it('names the band when HR went with the pace', async () => {
    const { deriveRecap } = await import('@/lib/coach/run-recap');
    const r = deriveRecap({
      type: 'tempo', phase: 'BUILD', plannedMi: 8,
      plannedPaceSPerMi: 420, plannedHrCap: 149,
      actualMi: 8, actualPaceSPerMi: 405,
      workPaceSPerMi: 405,
      actualAvgHr: 160, actualMaxHr: 172,
      splits: [
        { mile: 1, paceSPerMi: 404, avgHr: 158 },
        { mile: 2, paceSPerMi: 406, avgHr: 160 },
        { mile: 3, paceSPerMi: 405, avgHr: 161 },
        { mile: 4, paceSPerMi: 405, avgHr: 162 },
      ],
    });
    const all = r.facts.join(' ');
    expect(all).toMatch(/past threshold|bought with time/i);
    expect(all).not.toMatch(/pushed the tempo/i);
  });

  it('calls it a soft lead when HR stayed inside the band', async () => {
    const { deriveRecap } = await import('@/lib/coach/run-recap');
    const r = deriveRecap({
      type: 'tempo', phase: 'BUILD', plannedMi: 8,
      plannedPaceSPerMi: 420, plannedHrCap: 149,
      actualMi: 8, actualPaceSPerMi: 405,
      workPaceSPerMi: 405,
      actualAvgHr: 145, actualMaxHr: 152,
      splits: [
        { mile: 1, paceSPerMi: 404, avgHr: 144 },
        { mile: 2, paceSPerMi: 406, avgHr: 145 },
        { mile: 3, paceSPerMi: 405, avgHr: 146 },
        { mile: 4, paceSPerMi: 405, avgHr: 145 },
      ],
    });
    const all = r.facts.join(' ');
    expect(all).toMatch(/soft lead/i);
    expect(all).toMatch(/retest/i);
  });
});

describe('the SLOWER mirror · the branch that loops', () => {
  it('a runner who never reached the band does not read as losing fitness', () => {
    // "Refit to a lower VDOT" hands back slower targets; slower targets are
    // easier; the next sessions sit lower still on HR and pace; the detector
    // fires again. Gating on HR breaks it at exactly the right place, because
    // a runner dutifully hitting an over-soft target is the case where HR sits
    // under the band.
    expect(slowQualityNeverReachedTheBand(4, 3)).toBe(true);
  });

  it('working hard and still missing the pace IS a real signal', () => {
    // HR up in the band means the effort was there and the pace was not.
    // That one should still surface.
    expect(slowQualityNeverReachedTheBand(4, 1)).toBe(false);
  });

  it('no readable heart rate is not evidence in either direction', () => {
    expect(slowQualityNeverReachedTheBand(0, 0)).toBe(false);
  });

  it('the floor is the bottom of Friel 5a, not the ceiling', () => {
    // Zone 4 "SubThreshold, just below LT" is 95-99%; 5a "At LT" starts at
    // 100%. Below the floor is under the intensity the session existed for.
    expect(THRESHOLD_HR_FLOOR_OF_TARGET).toBe(1.0);
    expect(THRESHOLD_HR_FLOOR_OF_TARGET).toBeLessThan(THRESHOLD_HR_CEILING_OF_TARGET);
  });

  it('the two guards are mirrors and cannot both fire on one session', () => {
    const target = 149;
    for (const hr of [140, 149, 152, 158]) {
      const above = ranAboveThresholdBand(hr, target);
      const below = ranBelowThresholdBand(hr, target);
      expect(above && below).toBe(false);
    }
  });
});
