/**
 * _hr_zone_bucket.test.ts · ZONES-SUM-1 (2026-08-24)
 *
 * `hr-zone-bucket.ts` had NO TEST FILE. It is the function that decides what
 * the TIME IN ZONES bar says on every surface, it made a claim in its own doc
 * comment — "returns z1-z5 percentages summing to 100" — and nothing anywhere
 * checked that claim. It was false: five independent `Math.round` calls over
 * one denominator can land on 99 or 101, and one production row does
 * (2026-08-23 · `{z1:15,z2:37,z3:21,z4:12,z5:14}`).
 *
 * The second half is worse. With nothing to count the function returned five
 * ZEROS, which is not a distribution but the absence of one wearing a
 * distribution's shape. Those zeros were written to `runs.data`, and five
 * canonical rows now carry them beside a MEASURED average of 135-145 bpm — a
 * run with a heart rate spent its time in some zone. `reconcileHrZones`
 * catches that on the read; the refusal here stops it being written.
 */
import { describe, it, expect } from 'vitest';
import { apportionToHundred, bucketHrSamplesByZone, type RawSplit } from './hr-zone-bucket';
import { computeZones } from '@/lib/training/zones';

const TABLE = computeZones({ lthr: 162 })!;

/** N samples at one bpm, in a single split. */
function split(...runs: Array<[bpm: number, n: number]>): RawSplit[] {
  const hrSamples: Array<{ bpm: number }> = [];
  for (const [bpm, n] of runs) for (let i = 0; i < n; i++) hrSamples.push({ bpm });
  return [{ hrSamples }];
}
const sum = (z: { z1: number; z2: number; z3: number; z4: number; z5: number }) =>
  z.z1 + z.z2 + z.z3 + z.z4 + z.z5;

describe('apportionToHundred', () => {
  it('the 99 that shipped · three thirds now add to 100', () => {
    // 1/3 each rounds to 33 three times = 99. Largest remainder gives the
    // spare point to the first tied share.
    expect(apportionToHundred([1, 1, 1, 0, 0])).toEqual([34, 33, 33, 0, 0]);
  });

  it('the 101 case · every share just over a half', () => {
    // 5 × 20% is exact, but shift the weights so several round up.
    const out = apportionToHundred([167, 167, 167, 167, 332])!;
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('sums to exactly 100 across a wide sweep of count vectors', () => {
    // Exhaustive-ish: every combination of small counts. This is the
    // assertion the module never had.
    for (let a = 0; a <= 7; a++)
      for (let b = 0; b <= 7; b++)
        for (let c = 0; c <= 7; c++)
          for (let d = 0; d <= 7; d++)
            for (let e = 0; e <= 7; e++) {
              const out = apportionToHundred([a, b, c, d, e]);
              if (a + b + c + d + e === 0) { expect(out).toBeNull(); continue; }
              expect(out!.reduce((x, y) => x + y, 0), `[${a},${b},${c},${d},${e}]`).toBe(100);
            }
  });

  it('never moves a share more than one point from its naive rounding', () => {
    for (const v of [[1, 1, 1, 0, 0], [7, 3, 11, 2, 1], [1, 999, 1, 1, 1], [5, 5, 5, 5, 1]]) {
      const total = v.reduce((a, b) => a + b, 0);
      const out = apportionToHundred(v)!;
      v.forEach((c, i) => {
        expect(Math.abs(out[i] - Math.round((c / total) * 100)), `zone ${i} of [${v}]`)
          .toBeLessThanOrEqual(1);
      });
    }
  });

  it('a zone with no time in it stays at zero · never rounded up to fill a gap', () => {
    // The point that would otherwise be the tidiest place to put the
    // remainder is exactly the one that would be a lie.
    const out = apportionToHundred([1, 1, 1, 0, 0])!;
    expect(out[3]).toBe(0);
    expect(out[4]).toBe(0);
  });

  it('is deterministic · the same run draws the same chart every time', () => {
    const v = [13, 13, 13, 13, 13];
    expect(apportionToHundred(v)).toEqual(apportionToHundred(v));
  });

  it('RULE THREE · nothing to distribute is a refusal, not five zeros', () => {
    expect(apportionToHundred([0, 0, 0, 0, 0])).toBeNull();
    expect(apportionToHundred([])).toBeNull();
  });
});

describe('bucketHrSamplesByZone', () => {
  it('a real distribution sums to 100', () => {
    // LTHR 162 · Friel bands. Spread readings across the range.
    const z = bucketHrSamplesByZone(split([110, 40], [135, 30], [150, 15], [158, 10], [172, 5]), TABLE)!;
    expect(z).not.toBeNull();
    expect(sum(z)).toBe(100);
  });

  it('sums to 100 on the count vectors that used to produce 99', () => {
    for (const n of [3, 6, 7, 9, 11, 13, 14, 17, 23]) {
      const per = Math.max(1, Math.floor(n / 3));
      const z = bucketHrSamplesByZone(split([110, per], [135, per], [150, per]), TABLE)!;
      expect(sum(z), `n=${n}`).toBe(100);
    }
  });

  it('no zone table · refuses rather than returning an empty distribution', () => {
    expect(bucketHrSamplesByZone(split([140, 10]), null)).toBeNull();
  });

  it('no usable samples · refuses', () => {
    expect(bucketHrSamplesByZone([], TABLE)).toBeNull();
    expect(bucketHrSamplesByZone([{ hrSamples: [] }], TABLE)).toBeNull();
    // Sentinel readings the watch ships before HR is ready, and out-of-band
    // junk. Neither is a measurement, so neither makes a distribution.
    expect(bucketHrSamplesByZone(split([0, 20]), TABLE)).toBeNull();
    expect(bucketHrSamplesByZone(split([12, 5], [255, 5]), TABLE)).toBeNull();
  });

  it('one bpm all run · 100% in one zone, 0 everywhere else', () => {
    const z = bucketHrSamplesByZone(split([135, 200]), TABLE)!;
    expect(sum(z)).toBe(100);
    expect(Object.values(z).filter((v) => v === 100)).toHaveLength(1);
  });

  it('the heat offset shifts the bands without breaking the sum', () => {
    for (const bump of [0, 3, 6, 10]) {
      const z = bucketHrSamplesByZone(split([132, 7], [148, 7], [161, 7]), TABLE, bump)!;
      expect(sum(z), `bump ${bump}`).toBe(100);
    }
  });
});
