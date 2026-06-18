import { describe, it, expect } from 'vitest';
import { heatAwareDrift, heatAdjustedStatus, type DriftBand } from './heat-band';

const FLAT: DriftBand = { text: 'STAYED FLAT', color: '#86efa0' }; // --mint-readiness
const HELD: DriftBand = { text: 'HELD STEADY', color: '#86efa0' }; // --mint-readiness
const SOME: DriftBand = { text: 'SOME DRIFT', color: '#F3AD38' /* --warn-text */ };
const FADE: DriftBand = { text: 'LATE FADE', color: '#FC4D64' /* --over-text */ };

describe('heatAwareDrift', () => {
  it('relabels LATE FADE -> HEAT DRIFT on a warm+ day (>=2%)', () => {
    const r = heatAwareDrift(FADE, 2);
    expect(r.text).toBe('HEAT DRIFT');
    expect(r.heatExpected).toBe(true);
    expect(r.color).toBe('#F3AD38');
  });

  it('relabels SOME DRIFT -> HEAT DRIFT on a warm+ day', () => {
    expect(heatAwareDrift(SOME, 6).text).toBe('HEAT DRIFT');
  });

  // The real Jun 8 easy run: hrDelta +11 bpm -> LATE FADE, 78F sunny ->
  // judgeWeather slowdownPct 14.5%. The card must read HEAT DRIFT, not LATE FADE.
  it('Jun 8 real case · LATE FADE at slowdownPct 14.5 -> HEAT DRIFT', () => {
    const r = heatAwareDrift(FADE, 14.5);
    expect(r.text).toBe('HEAT DRIFT');
    expect(r.heatExpected).toBe(true);
  });

  it('does NOT relabel below the 2% gate (cool day keeps LATE FADE)', () => {
    expect(heatAwareDrift(FADE, 1.9).text).toBe('LATE FADE');
    expect(heatAwareDrift(FADE, 0).heatExpected).toBeUndefined();
  });

  it('does NOT relabel non-rise verdicts even when hot', () => {
    expect(heatAwareDrift(FLAT, 14.5).text).toBe('STAYED FLAT');
    expect(heatAwareDrift(HELD, 14.5).text).toBe('HELD STEADY');
  });
});

describe('heatAdjustedStatus (regression guard)', () => {
  it('cool day · symmetric +/- tolerance band', () => {
    expect(heatAdjustedStatus(420, 425, 0)).toBe('on');
    expect(heatAdjustedStatus(420, 450, 0)).toBe('slow');
    expect(heatAdjustedStatus(420, 400, 0)).toBe('fast');
  });

  it('hot day widens only the slow side', () => {
    // target 420, slowdown 12% -> effectiveTarget ~470; 450 is now "on".
    expect(heatAdjustedStatus(420, 450, 12)).toBe('on');
    // faster than original target - tolerance is still "fast".
    expect(heatAdjustedStatus(420, 400, 12)).toBe('fast');
  });
});
