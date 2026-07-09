import { describe, it, expect } from 'vitest';
import { splitTimesReliable, splitsSumSeconds } from './split-coverage';

describe('splitTimesReliable', () => {
  it("keeps David's 2026-07-09 run — 5 clean splits ending mid-mile (the regression)", () => {
    // Watch-derived splits covered miles 1–5 (2327 s); run was 5.85 mi /
    // 2807 s. The 480 s shortfall is the un-split 0.85 mi cool-down — benign.
    expect(splitTimesReliable(2327, 2807, 5.85)).toBe(true);
  });

  it('drops splits that OVER-claim time (impossible / GPS timing error)', () => {
    expect(splitTimesReliable(2900, 2807, 5.85)).toBe(false);
  });

  it('drops splits missing a WHOLE mile (shortfall > ~1 mile of time)', () => {
    // 6.0 mi / 2880 s run (480 s/mi) with only 4 miles of splits (1920 s):
    // 960 s short = 2 miles missing → genuinely truncated.
    expect(splitTimesReliable(1920, 2880, 6.0)).toBe(false);
  });

  it('keeps an exact whole-mile run whose splits sum to the duration', () => {
    expect(splitTimesReliable(2880, 2880, 6.0)).toBe(true);
  });

  it('rejects degenerate input', () => {
    expect(splitTimesReliable(0, 2807, 5.85)).toBe(false);
    expect(splitTimesReliable(2327, 0, 5.85)).toBe(false);
  });
});

describe('splitsSumSeconds', () => {
  it("sums David's stored HK splits from M:SS strings", () => {
    const hk = [
      { pace: '8:15', distanceMi: 1 }, { pace: '5:44', distanceMi: 1 },
      { pace: '6:57', distanceMi: 1 }, { pace: '7:05', distanceMi: 1 },
      { pace: '7:03', distanceMi: 1 }, { pace: '8:27', distanceMi: 1 },
      { pace: '7:15', distanceMi: 0.45 },
    ];
    // 495+344+417+425+423+507+(435*0.45=195.75) = 2806.75
    expect(Math.round(splitsSumSeconds(hk))).toBe(2807);
  });

  it('sums numeric paceSecPerMi (watch-derived shape)', () => {
    const watch = [
      { paceSecPerMi: 525 }, { paceSecPerMi: 470 }, { paceSecPerMi: 431 },
      { paceSecPerMi: 461 }, { paceSecPerMi: 440 },
    ];
    expect(splitsSumSeconds(watch)).toBe(2327);
  });
});
