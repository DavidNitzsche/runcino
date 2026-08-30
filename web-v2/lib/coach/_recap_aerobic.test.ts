/**
 * lib/coach/_recap_aerobic.test.ts — the long-run recap may not assert a
 * heart-rate verdict it did not check, and its arithmetic must add up.
 *
 * Both falsifiers below are the owner's own runs, with his real prescribed
 * caps, not fixtures.
 *
 * ── 1 · "kept it aerobic" (the false-coaching one) ────────────────────────
 *
 * 2026-08-30. The recap said, and the same screen contradicted:
 *
 *     Long run done, 13.5 mi, avg HR 159, kept it aerobic.
 *     Heart · under 145 → 159
 *     15% in zone 2                       (z1:4 z2:15 z3:11 z4:10 z5:60)
 *
 * The clause was appended in an `else` branch with NO heart-rate condition of
 * any kind. It is the one sentence on the screen a runner would act on, and it
 * was the only one not derived from the data.
 *
 * ── 2 · the drift arithmetic ─────────────────────────────────────────────
 *
 * Same run: "climbed 13 bpm by the end (153 → 165)". 165 − 153 = 12. The
 * endpoints and the delta were each rounded independently off the unrounded
 * split averages, so a reader who subtracts the two numbers we printed gets a
 * third number we did not.
 */
import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from './run-recap';

/** Splits that put every mile at `hr`, enough of them for the drift detector. */
function flatSplits(n: number, hr: number, paceSPerMi = 540) {
  return Array.from({ length: n }, (_, i) => ({ mile: i + 1, avgHr: hr, paceSPerMi }));
}

/** Splits whose halves average `firstHr` / `lastHr`. */
function driftSplits(n: number, firstHr: number, lastHr: number, paceSPerMi = 540) {
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => ({
    mile: i + 1, avgHr: i < mid ? firstHr : lastHr, paceSPerMi,
  }));
}

const LONG = (over: Partial<RecapInput>): RecapInput => ({
  type: 'long', phase: null, plannedMi: 13, actualMi: 13.49,
  actualPaceSPerMi: 540, actualAvgHr: null, actualMaxHr: null, ...over,
});

const facts = (i: RecapInput) => deriveRecap(i).facts.join(' ');

describe('"kept it aerobic" is gated on the heart-rate evidence', () => {
  it('is NOT claimed on the 2026-08-30 long run · avg HR 159 against a 145 ceiling', () => {
    const out = facts(LONG({
      plannedHrCap: 145, actualAvgHr: 159, actualMaxHr: 179,
      splits: flatSplits(13, 159),
    }));
    expect(out).not.toMatch(/kept it aerobic/);
  });

  it('says something TRUE instead, as a fact rather than a verdict', () => {
    const out = facts(LONG({
      plannedHrCap: 145, actualAvgHr: 159, actualMaxHr: 179,
      splits: flatSplits(13, 159),
    }));
    expect(out).toMatch(/averaged 159 against the 145 ceiling/);
    // Rule four: a reading, not a scolding. No instruction to do better.
    expect(out).not.toMatch(/should have|slow it down|only work when/i);
  });

  it('IS still claimed on his 2026-06-21 long run · avg HR 141 under a 144 ceiling', () => {
    // The positive control. A gate that silences the true case as well as the
    // false one has not fixed anything, it has just stopped talking.
    const out = facts(LONG({
      actualMi: 13.15, plannedHrCap: 144, actualAvgHr: 141, actualMaxHr: 160,
      splits: flatSplits(14, 141),
    }));
    expect(out).toMatch(/kept it aerobic/);
  });

  it('claims nothing either way when the row carries no ceiling', () => {
    // Rule three: with no prescribed ceiling there is nothing to have kept
    // under, so the sentence loses a clause rather than gaining a guess.
    const out = facts(LONG({
      plannedHrCap: null, actualAvgHr: 159, splits: flatSplits(13, 159),
    }));
    expect(out).not.toMatch(/kept it aerobic/);
    expect(out).not.toMatch(/ceiling/);
    expect(out).toMatch(/Long run done/);
  });

  it('claims nothing when there is a ceiling but no heart rate to judge', () => {
    const out = facts(LONG({ plannedHrCap: 145, actualAvgHr: null }));
    expect(out).not.toMatch(/kept it aerobic/);
    expect(out).not.toMatch(/ceiling/);
  });

  it('names heat as the cause when heat is the cause, and never scolds for it', () => {
    const out = facts(LONG({
      plannedHrCap: 145, actualAvgHr: 159, splits: flatSplits(13, 159),
      weather: { tempF: 88, dewPointF: 70, slowdownPct: 5 } as RecapInput['weather'],
    }));
    expect(out).not.toMatch(/kept it aerobic/);
    expect(out).toMatch(/159 against the 145 ceiling/);
    expect(out).toMatch(/hot/);
  });
});

describe('HR drift arithmetic is self-consistent', () => {
  it('the delta equals the difference of the endpoints it prints', () => {
    // 12 splits: six at 153, six at 165. Printed endpoints 153 and 165.
    const out = facts(LONG({
      actualMi: 13.49, actualAvgHr: 159, splits: driftSplits(12, 153, 165),
    }));
    const m = out.match(/climbed (\d+) bpm by the end \((\d+) → (\d+)\)/);
    expect(m, `no drift sentence in: ${out}`).not.toBeNull();
    const [, delta, first, last] = m!;
    expect(Number(delta)).toBe(Number(last) - Number(first));
  });

  it('holds across the rounding boundary that produced the 13-vs-12 sentence', () => {
    // firstAvg 153.4 → 153, lastAvg 165.2 → 165, raw delta 11.8 → 13 was
    // impossible; the real historical shape rounds the delta UP while both
    // endpoints round DOWN. Sweep the boundary rather than trusting one case.
    for (let a = 150; a <= 156; a++) {
      for (let b = 160; b <= 168; b++) {
        const out = facts(LONG({
          actualAvgHr: 159,
          // Uneven halves make the averages fractional, which is what let the
          // three roundings disagree in the first place.
          splits: [
            ...Array.from({ length: 5 }, (_, i) => ({ mile: i + 1, avgHr: a, paceSPerMi: 540 })),
            { mile: 6, avgHr: a + 1, paceSPerMi: 540 },
            ...Array.from({ length: 5 }, (_, i) => ({ mile: i + 7, avgHr: b, paceSPerMi: 540 })),
            { mile: 12, avgHr: b + 1, paceSPerMi: 540 },
          ],
        }));
        const m = out.match(/climbed (\d+) bpm by the end \((\d+) → (\d+)\)/);
        if (!m) continue;
        const [, delta, first, last] = m;
        expect(Number(delta), `a=${a} b=${b} · ${m[0]}`).toBe(Number(last) - Number(first));
      }
    }
  });
});
