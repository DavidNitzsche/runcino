import { describe, it, expect } from 'vitest';
import { sanitizeSplits, paceStrToSec, type SplitLike } from './split-sanity';

describe('sanitizeSplits', () => {
  // David's real 2026-07-09 tempo run (id -71886754295643). Mile 2 is the
  // GPS-spike artifact: 5:44/mi at HR 130 / cadence 109 — impossible stride.
  const davidRun: SplitLike[] = [
    { hr: 134, mile: 1, pace: '8:15', cadence: 146, elev_ft: 3,   distanceMi: 1 },
    { hr: 130, mile: 2, pace: '5:44', cadence: 109, elev_ft: -21, distanceMi: 1 },
    { hr: 165, mile: 3, pace: '6:57', cadence: 169, elev_ft: 14,  distanceMi: 1 },
    { hr: 160, mile: 4, pace: '7:05', cadence: 134, elev_ft: 7,   distanceMi: 1 },
    { hr: 162, mile: 5, pace: '7:03', cadence: 125, elev_ft: 0,   distanceMi: 1 },
    { hr: 157, mile: 6, pace: '8:27', cadence: 129, elev_ft: 4,   distanceMi: 1 },
    { hr: 158, mile: 7, pace: '7:15', cadence: 156, elev_ft: 0,   distanceMi: 0.45 },
  ];

  it('flags the impossible mile-2 split and nulls its pace, leaving the rest intact', () => {
    const out = sanitizeSplits(davidRun);
    const m2 = out.find((s) => s.mile === 2)!;
    expect(m2.unreliable).toBe(true);
    expect(m2.pace).toBeNull();
    // Non-pace metrics survive untouched.
    expect(m2.hr).toBe(130);
    expect(m2.cadence).toBe(109);
    expect(m2.elev_ft).toBe(-21);
    // Every other mile is untouched — no false positives.
    for (const mile of [1, 3, 4, 5, 6, 7]) {
      const s = out.find((x) => x.mile === mile)!;
      expect(s.unreliable, `mile ${mile} must not be flagged`).toBeUndefined();
      expect(s.pace, `mile ${mile} pace preserved`).toBe(davidRun[mile - 1].pace);
    }
  });

  it('NEVER flags a legitimately fast rep (fast pace WITH high cadence + high HR)', () => {
    // 5:30/mi interval at 182 cadence / 178 HR → stride ~1.61 m, plausible.
    const intervals: SplitLike[] = [
      { hr: 150, mile: 1, pace: '7:30', cadence: 165 },
      { hr: 178, mile: 2, pace: '5:30', cadence: 182 },
      { hr: 176, mile: 3, pace: '5:32', cadence: 181 },
      { hr: 152, mile: 4, pace: '7:40', cadence: 162 },
    ];
    const out = sanitizeSplits(intervals);
    expect(out.every((s) => !s.unreliable)).toBe(true);
    expect(out.map((s) => s.pace)).toEqual(intervals.map((s) => s.pace));
  });

  it('catches the GPS-spike signature without cadence (fast pace + easy HR vs peers)', () => {
    // Watch-derived splits have no cadence — the fallback must still catch it.
    const noCadence: SplitLike[] = [
      { mile: 1, paceSecPerMi: 495, hr: 155 },
      { mile: 2, paceSecPerMi: 320, hr: 128 }, // 175s faster than median, HR 15%+ below → flagged
      { mile: 3, paceSecPerMi: 500, hr: 160 },
      { mile: 4, paceSecPerMi: 505, hr: 158 },
    ];
    const out = sanitizeSplits(noCadence);
    expect(out.find((s) => s.mile === 2)!.unreliable).toBe(true);
    expect(out.filter((s) => s.mile !== 2).every((s) => !s.unreliable)).toBe(true);
  });

  it('is a no-op for clean runs and handles empty/short input', () => {
    const clean: SplitLike[] = [
      { hr: 150, mile: 1, pace: '8:00', cadence: 168 },
      { hr: 152, mile: 2, pace: '7:58', cadence: 170 },
      { hr: 151, mile: 3, pace: '8:02', cadence: 169 },
    ];
    expect(sanitizeSplits(clean)).toEqual(clean);
    expect(sanitizeSplits([])).toEqual([]);
    expect(sanitizeSplits(null)).toEqual([]);
    expect(sanitizeSplits(undefined)).toEqual([]);
  });

  it('paceStrToSec parses M:SS and rejects junk', () => {
    expect(paceStrToSec('5:44')).toBe(344);
    expect(paceStrToSec('12:05')).toBe(725);
    expect(paceStrToSec(344)).toBe(344);
    expect(paceStrToSec('--')).toBeNull();
    expect(paceStrToSec(null)).toBeNull();
  });
});
