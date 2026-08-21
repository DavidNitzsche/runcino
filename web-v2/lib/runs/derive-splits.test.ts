import { describe, it, expect } from 'vitest';
import { deriveSplitsFromPaceSamples, type SplitSourcePhase, type PaceSample } from './derive-splits';
import { splitTimesReliable, splitsSumSeconds } from './split-coverage';

/**
 * Builds the sample stream the iPhone treadmill console now emits
 * (BeltTracker.swift): a sample every 5 s plus one at every belt-speed
 * change, `tSec` and cumulative `distMi` both relative to the PHASE start,
 * and an HR sample on the same `tSec` grid so the server's per-mile HR
 * lookup finds an exact key.
 */
function beltPhase(
  segments: Array<{ sec: number; mph: number }>,
  opts: { bpm?: number } = {},
): SplitSourcePhase {
  const paceSamples: PaceSample[] = [];
  const hrSamples: PaceSample[] = [];
  let dist = 0;
  let t = 0;
  let nextSampleAt = 0;
  let lastSpeed = NaN;
  let lastT = -1;
  const emit = (mph: number, force = false) => {
    const tSec = Math.round(t);
    if (tSec <= lastT && !force) return;
    paceSamples.push({ tSec, distMi: Math.round(dist * 1000) / 1000, paceSPerMi: Math.round(3600 / mph) });
    if (opts.bpm) hrSamples.push({ tSec, bpm: opts.bpm });
    lastT = tSec;
    lastSpeed = mph;
    nextSampleAt = t + 5;
  };
  for (const seg of segments) {
    for (let i = 0; i < seg.sec; i++) {
      t += 1;
      dist += seg.mph / 3600;
      if (t >= nextSampleAt || Math.abs(seg.mph - lastSpeed) > 1e-4) emit(seg.mph);
    }
  }
  emit(segments[segments.length - 1].mph, true);
  return {
    actualDurationSec: Math.round(t),
    actualDistanceMi: Math.round(dist * 100) / 100,
    paceSamples,
    hrSamples,
  };
}

describe('deriveSplitsFromPaceSamples · treadmill', () => {
  it('returns null for the payload every treadmill run used to send', () => {
    // No paceSamples at all. This is why all six of David's treadmill runs in
    // production carry `splits: []` — the derivation had nothing to walk.
    expect(
      deriveSplitsFromPaceSamples([
        { actualDurationSec: 2250, actualDistanceMi: 4.25 } as SplitSourcePhase,
      ]),
    ).toBeNull();
  });

  it('derives four splits from a steady 6.8 mph 37:30 session', () => {
    // David's 2026-08-20 run, if the belt had never moved.
    const phase = beltPhase([{ sec: 2250, mph: 6.8 }], { bpm: 123 });
    const splits = deriveSplitsFromPaceSamples([phase]);
    expect(splits).not.toBeNull();
    expect(splits!.map((s) => s.mile)).toEqual([1, 2, 3, 4]);
    for (const s of splits!) {
      // 6.8 mph is 8:49/mi.
      expect(s.paceSecPerMi).toBeGreaterThanOrEqual(527);
      expect(s.paceSecPerMi).toBeLessThanOrEqual(531);
      expect(s.hr).toBe(123);
    }
  });

  it('shows the speed change instead of averaging it away', () => {
    // 20 min at 6.0, then 17.5 min at 9.0. A server-side derivation from one
    // (speed, duration) pair would have to invent a flat pace across the
    // whole run — a modelled number wearing a measured number's clothes.
    const phase = beltPhase([{ sec: 1200, mph: 6.0 }, { sec: 1050, mph: 9.0 }]);
    const splits = deriveSplitsFromPaceSamples([phase])!;
    expect(splits.length).toBeGreaterThanOrEqual(4);
    // 6.0 mph is 10:00/mi, 9.0 mph is 6:40/mi. The first mile is slow, the
    // last is fast, and the transition mile sits between them.
    expect(splits[0].paceSecPerMi).toBeGreaterThan(590);
    expect(splits[0].paceSecPerMi).toBeLessThan(610);
    expect(splits[splits.length - 1].paceSecPerMi).toBeGreaterThan(390);
    expect(splits[splits.length - 1].paceSecPerMi).toBeLessThan(410);
  });

  it('walks a multi-phase interval session across the phase offsets', () => {
    const phases = [
      beltPhase([{ sec: 600, mph: 6.0 }, { sec: 300, mph: 6.4 }], { bpm: 130 }),
      beltPhase([{ sec: 480, mph: 8.8 }], { bpm: 168 }),
      beltPhase([{ sec: 120, mph: 5.4 }], { bpm: 140 }),
      beltPhase([{ sec: 480, mph: 9.1 }], { bpm: 172 }),
    ];
    const splits = deriveSplitsFromPaceSamples(phases)!;
    expect(splits).not.toBeNull();
    // Miles are numbered continuously across phases, never restarted.
    expect(splits.map((s) => s.mile)).toEqual(
      Array.from({ length: splits.length }, (_, i) => i + 1),
    );
    // Every split is a real per-mile time, not a phase duration.
    for (const s of splits) {
      expect(s.paceSecPerMi).toBeGreaterThanOrEqual(120);
      expect(s.paceSecPerMi).toBeLessThanOrEqual(3600);
    }
    // The work miles are faster than the warm-up miles.
    expect(Math.min(...splits.map((s) => s.paceSecPerMi)))
      .toBeLessThan(Math.max(...splits.map((s) => s.paceSecPerMi)));
  });

  it('survives the ingest reliability gate', () => {
    // Splits are dropped wholesale if their times over-claim the run or fall
    // more than a mile short. A treadmill run ending mid-mile must not trip
    // that — which is the failure the watch path already hit once.
    const phase = beltPhase([{ sec: 2250, mph: 6.8 }], { bpm: 123 });
    const splits = deriveSplitsFromPaceSamples([phase])!;
    const sum = splitsSumSeconds(splits);
    expect(splitTimesReliable(sum, 2250, 4.25)).toBe(true);
  });

  it('carries HR onto every split when a watch is streaming', () => {
    const phase = beltPhase([{ sec: 1800, mph: 7.0 }], { bpm: 155 });
    const splits = deriveSplitsFromPaceSamples([phase])!;
    expect(splits.every((s) => s.hr === 155)).toBe(true);
  });

  it('leaves split HR null rather than zero when no watch is present', () => {
    const phase = beltPhase([{ sec: 1800, mph: 7.0 }]);
    const splits = deriveSplitsFromPaceSamples([phase])!;
    expect(splits.every((s) => s.hr === null)).toBe(true);
  });
});
