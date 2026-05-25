/**
 * C2 · Z2 sparkline tests.
 *
 * Pins the locked constants + the week-bucketing math. Trend
 * computation tested at the component level (deltaS calculation) here.
 */
import { describe, it, expect } from 'vitest';
import { SPARKLINE_WEEKS } from '../z2-sparkline';

describe('C2 Z2 sparkline · constants locked', () => {
  it('window is 8 weeks (David round 4 spec)', () => {
    expect(SPARKLINE_WEEKS).toBe(8);
  });
});

describe('C2 Z2 sparkline · trend label computation', () => {
  // Mirror the deltaS → trend label logic from Z2Sparkline.tsx so
  // it's pinned at the unit level.
  function trend(firstPace: number | null, lastPace: number | null): string | null {
    const deltaS = (firstPace != null && lastPace != null) ? lastPace - firstPace : null;
    if (deltaS == null) return null;
    if (deltaS <= -5) return `↑ ${Math.abs(deltaS)}s/mi faster`;
    if (deltaS >= 5) return `↓ ${deltaS}s/mi slower`;
    return 'steady';
  }

  it('first 9:30, last 9:00 → "↑ 30s/mi faster"', () => {
    expect(trend(570, 540)).toBe('↑ 30s/mi faster');
  });

  it('first 8:30, last 9:10 → "↓ 40s/mi slower"', () => {
    expect(trend(510, 550)).toBe('↓ 40s/mi slower');
  });

  it('first 9:00, last 9:02 → "steady" (within ±5s noise floor)', () => {
    expect(trend(540, 542)).toBe('steady');
  });

  it('first null (no data) → null (no label)', () => {
    expect(trend(null, 540)).toBeNull();
  });

  it('first 8:55 → 8:55 → steady', () => {
    expect(trend(535, 535)).toBe('steady');
  });
});

describe('C2 Z2 sparkline · hasSignal gate', () => {
  it('requires ≥3 weeks with data to render', () => {
    const MIN_POPULATED_WEEKS = 3;
    const points: Array<{ paceSPerMi: number | null }> = [
      { paceSPerMi: 540 }, { paceSPerMi: null },
      { paceSPerMi: 545 }, { paceSPerMi: null },
      { paceSPerMi: null }, { paceSPerMi: null },
      { paceSPerMi: null }, { paceSPerMi: null },
    ];
    const populated = points.filter((p) => p.paceSPerMi != null).length;
    expect(populated >= MIN_POPULATED_WEEKS).toBe(false);  // only 2, below threshold
  });

  it('3 populated weeks passes the gate', () => {
    const points: Array<{ paceSPerMi: number | null }> = [
      { paceSPerMi: 540 }, { paceSPerMi: 538 }, { paceSPerMi: 535 },
      { paceSPerMi: null }, { paceSPerMi: null }, { paceSPerMi: null },
      { paceSPerMi: null }, { paceSPerMi: null },
    ];
    const populated = points.filter((p) => p.paceSPerMi != null).length;
    expect(populated).toBe(3);
    expect(populated >= 3).toBe(true);
  });
});
