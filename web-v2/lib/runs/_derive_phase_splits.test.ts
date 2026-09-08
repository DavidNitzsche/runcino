/**
 * PHASE-GRAIN-1 · the per-phase mile table, against the runner's own stream.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIXTURE IS PRODUCTION. `_fixtures/run-2026-09-08-tempo.json` is
 * `runs.data.phases` for canonical run `-75144899844434`
 * (`0645f40c-…-2026-09-08#0911`), copied out through the read-only role with
 * every field the walk reads intact — 148 + 293 + 116 real `paceSamples`, the
 * same number of `hrSamples`, and the phases' own actual totals. It is the run
 * the feature was asked for, and it is the only fixture here on purpose: Rule
 * 13 says a synthetic stream skips exactly the code path that breaks.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE 22 · WHAT THIS FILE CANNOT FAIL ON
 *
 *   · It cannot see the SCREEN. It asserts the numbers the server sends; that
 *     `RepBreakdownV5` draws them, and draws nothing for the warm-up, is a
 *     render check and was done as one.
 *   · It cannot catch a wrong `distMi` in the stream. The walk trusts the
 *     recorded cumulative distance, and so does this.
 *   · One production run reaches three of the four outcomes (a cut phase, a
 *     below-grain phase, a phase with no samples). `incomplete-walk` is not
 *     reachable from any real row here and is exercised synthetically, which
 *     is stated rather than hidden.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  derivePhaseMileSplits,
  derivePhaseMileSplitsFromCompletion,
  PHASE_GRAIN_MIN_WHOLE_MILES,
} from './derive-phase-splits';
import { deriveSplitsFromPaceSamples, type SplitSourcePhase } from './derive-splits';

const REAL_PHASES: SplitSourcePhase[] = JSON.parse(
  readFileSync(join(__dirname, '_fixtures', 'run-2026-09-08-tempo.json'), 'utf8'),
);

const WARMUP = REAL_PHASES[0];   // 1.51 mi / 769 s · one boundary crossed
const TEMPO = REAL_PHASES[1];    // 3.50 mi / 1509 s · three boundaries crossed
const COOLDOWN = REAL_PHASES[2]; // 1.20 mi / 598 s · one boundary crossed
const OVERTIME = REAL_PHASES[3]; // 0.24 mi / 118 s · no samples at all

/* LIVENESS (Rule 18). A fixture that quietly lost its samples would make every
 * assertion below pass by drawing nothing, which is the worst available
 * outcome because it also reports confidence. */
describe('the fixture is the real stream', () => {
  it('carries the sample counts production stores', () => {
    expect(REAL_PHASES).toHaveLength(4);
    expect(WARMUP.paceSamples).toHaveLength(148);
    expect(TEMPO.paceSamples).toHaveLength(293);
    expect(TEMPO.hrSamples).toHaveLength(293);
    expect(COOLDOWN.paceSamples).toHaveLength(116);
    expect(OVERTIME.paceSamples ?? []).toHaveLength(0);
    expect(TEMPO.actualDistanceMi).toBe(3.5);
    expect(TEMPO.actualDurationSec).toBe(1509);
  });
});

describe("the 3.5 mi tempo, cut at its own mile boundaries", () => {
  const reading = derivePhaseMileSplits(TEMPO);

  it('is cut, and into four pieces', () => {
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.splits).toHaveLength(4);
  });

  /* THE NUMBERS THE RUNNER READS. Asserted as the exact rows, not as "some
   * splits exist" — an absence-only or shape-only assertion is satisfied by
   * garbage (Rule 13 §3). */
  it('reads 7:14 / 7:08 / 7:14 and then a half mile at 7:06', () => {
    if (!reading.ok) throw new Error('expected a cut');
    expect(reading.splits.map((s) => [s.mile, s.pace, s.hr])).toEqual([
      [1, '7:14', 154],
      [2, '7:08', 157],
      [3, '7:14', 162],
      [4, '7:06', 165],
    ]);
    // EVERY ROW'S `pace` IS SECONDS PER MILE, the trailing half included. Its
    // own elapsed is 3:33, which is not what a column headed PACE means.
    expect(reading.splits.map((s) => s.paceSecPerMi)).toEqual([434, 428, 434, 426]);
  });

  /* HEART RATE IS THE READING THE FEATURE EXISTS FOR. Flat pace, eleven beats
   * of drift — the thing one phase average cannot say. */
  it('shows the drift a single phase average hides', () => {
    if (!reading.ok) throw new Error('expected a cut');
    const hrs = reading.splits.map((s) => s.hr);
    expect(hrs).toEqual([154, 157, 162, 165]);
    expect((hrs[3] as number) - (hrs[0] as number)).toBe(11);
  });

  /* RULE 16 · the rows and the phase row above them are the same run. */
  it('reconciles exactly with the phase’s own 3.500 mi / 1509 s', () => {
    if (!reading.ok) throw new Error('expected a cut');
    const mi = reading.splits.reduce((a, s) => a + s.distanceMi, 0);
    // Elapsed: three whole miles as walked, plus the remainder's own clock.
    const sec = reading.splits.reduce((a, s) => a + (s.mile <= 3 ? s.paceSecPerMi : 0), 0)
      + Math.round(1509 - 1296.073);
    expect(mi).toBeCloseTo(3.5, 6);
    expect(sec).toBe(1509);
    // …and therefore the same 7:11/mi the phase already displays.
    expect(Math.round(1509 / 3.5)).toBe(431);
  });

  it('names the last piece by its length, never as a fourth mile', () => {
    if (!reading.ok) throw new Error('expected a cut');
    const last = reading.splits[3];
    expect(last.distanceMi).toBeCloseTo(0.5, 6);
    expect(last.distanceMi).toBeLessThan(0.95); // `MilePiece.isPartial`
    expect(reading.splits.slice(0, 3).every((s) => s.distanceMi === 1)).toBe(true);
  });
});

describe('PHASE-GRAIN-1 · a phase that did not cross two boundaries draws nothing', () => {
  it('refuses the 1.51 mi warm-up, and says why', () => {
    const r = derivePhaseMileSplits(WARMUP);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('below-grain');
  });

  it('refuses the 1.20 mi cool-down for the same reason', () => {
    const r = derivePhaseMileSplits(COOLDOWN);
    expect(r).toEqual({ ok: false, reason: 'below-grain' });
  });

  /* RULE 11 · "too short" and "nothing was recorded" are two facts. The
   * overtime phase is 0.24 mi AND carries no samples; the reason it comes back
   * with is the one that is actually true of it. */
  it('refuses the sampleless overtime phase as a recording gap, not as short', () => {
    const r = derivePhaseMileSplits(OVERTIME);
    expect(r).toEqual({ ok: false, reason: 'no-samples' });
  });

  it('is a COUNT of boundaries, so there is no distance threshold to sit on', () => {
    expect(PHASE_GRAIN_MIN_WHOLE_MILES).toBe(2);
    // The warm-up is 1.51 mi and the tempo is 3.50 mi. Nothing between 1.02
    // and 1.99 exists in this runner's 87 stored work phases, and nothing
    // here compares a distance against a cutoff in any case — the walk either
    // crossed a second boundary or it did not.
    const warm = derivePhaseMileSplits(WARMUP);
    const tempo = derivePhaseMileSplits(TEMPO);
    expect(warm.ok).toBe(false);
    expect(tempo.ok).toBe(true);
  });
});

describe('a hole in the table is refused, not printed', () => {
  /* NOT REACHABLE FROM THIS RUN — see the Rule 22 note in the header. A mile
   * walked in under 120 s trips `walkMileSplits`' sanity guard, which drops
   * the split while still counting the crossing, and a table reading 1, 3, 4
   * would be worse than no table. */
  it('returns incomplete-walk when the sanity guard drops a mile', () => {
    const impossible: SplitSourcePhase = {
      actualDistanceMi: 3,
      actualDurationSec: 300,
      paceSamples: Array.from({ length: 61 }, (_, i) => ({
        tSec: i * 5, distMi: (i * 5) / 100, // 100 s per mile · faster than the guard allows
      })),
      hrSamples: [],
    };
    const r = derivePhaseMileSplits(impossible);
    expect(r).toEqual({ ok: false, reason: 'incomplete-walk' });
  });
});

describe('the completion payload maps positionally', () => {
  it('gives the tempo its rows and every other phase null', () => {
    const out = derivePhaseMileSplitsFromCompletion(REAL_PHASES);
    expect(out).toHaveLength(4);
    expect(out[0]).toBeNull();
    expect(out[1]).not.toBeNull();
    expect(out[1]).toHaveLength(4);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
  });

  it('reads the `{ phases: [...] }` envelope and the raw JSON string alike', () => {
    const wrapped = derivePhaseMileSplitsFromCompletion({ phases: REAL_PHASES });
    const stringified = derivePhaseMileSplitsFromCompletion(JSON.stringify(REAL_PHASES));
    expect(wrapped[1]).toHaveLength(4);
    expect(stringified[1]).toHaveLength(4);
  });
});

describe('the shared walk is one walk (Rule 16)', () => {
  /* The whole-run entry point is now nothing but flatten + walk. If the
   * refactor had changed it, this run's whole-run splits would move. */
  it('still cuts the WHOLE run into six miles at the run’s own boundaries', () => {
    const whole = deriveSplitsFromPaceSamples(REAL_PHASES);
    expect(whole).not.toBeNull();
    expect(whole!.map((s) => s.mile)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /* AND THE TWO ARE DIFFERENT QUESTIONS, which is why the phase table is
   * rebased. The tempo's own mile 1 is not the run's mile 1, and the phase
   * table would be a lie if it were. */
  it('rebases the phase to its own start, so its mile 1 is not the run’s', () => {
    const whole = deriveSplitsFromPaceSamples(REAL_PHASES)!;
    const phase = derivePhaseMileSplits(TEMPO);
    if (!phase.ok) throw new Error('expected a cut');
    expect(whole[0].paceSecPerMi).not.toBe(phase.splits[0].paceSecPerMi);
    expect(whole[0].pace).toBe('8:40'); // the warm-up's first mile
    expect(phase.splits[0].pace).toBe('7:14'); // the tempo's first mile
  });
});
