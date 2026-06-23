/**
 * PARITY-1 guard — the prod loader seeds bestRecentVdot from self-reported PRs, matching the sim.
 */
import { describe, it, expect } from 'vitest';
import { bestVdotFromRaceHistory } from './race-history';
import { vdotFromRace } from './vdot';

describe('bestVdotFromRaceHistory', () => {
  it('picks the best recent PR and matches raw vdotFromRace (sim parity)', () => {
    const v = bestVdotFromRaceHistory([
      { distance: 'half', timeSec: 5400, whenRaced: '<6mo' },   // 1:30 HM
      { distance: '5k', timeSec: 1200, whenRaced: '6-12mo' },    // 20:00 5K (slower-VDOT)
    ]);
    expect(v).toBe(vdotFromRace(5400, 13.109));   // HM is the stronger signal, raw (no marathon correction)
  });

  it('drops stale (>365d) and malformed entries; undefined when none usable', () => {
    expect(bestVdotFromRaceHistory([{ distance: 'marathon', timeSec: 10800, whenRaced: '2+yr' }])).toBeUndefined(); // 3yr → stale
    expect(bestVdotFromRaceHistory([{ distance: 'half', timeSec: 0, whenRaced: '<6mo' }])).toBeUndefined();         // bad time
    expect(bestVdotFromRaceHistory([])).toBeUndefined();
    expect(bestVdotFromRaceHistory(null)).toBeUndefined();
  });

  it('resolves "other" distance via otherDistanceMi', () => {
    // otherDistanceMi=13.109 (HM) → same VDOT as a 'half' entry, confirming the "other" path resolves.
    expect(bestVdotFromRaceHistory([{ distance: 'other', otherDistanceMi: 13.109, timeSec: 5400, whenRaced: '<6mo' }]))
      .toBe(vdotFromRace(5400, 13.109));
  });
});
