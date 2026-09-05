/**
 * WEEKLYDEMAND-CITE-1 · every cited number is read OUT OF the cited document.
 *
 * Rule 18: "a check that hardcodes both sides only proves the test agrees with
 * itself." So nothing below asserts `LONG_RUN_SPIKE_RATIO === 1.10`. It parses
 * `Research/00a-distance-running-training.md` at run time, pulls 110 out of the
 * table row the module cites, and compares the engine against THAT. Edit the
 * doc and the engine has to move; edit the engine and this fails.
 *
 * Every anchor is a VERBATIM heading, never a line number, exactly as
 * `lib/doctrine/registry.ts` claims are written. Line numbers rot on the next
 * edit; a heading survives everything except a change to what the section says,
 * which is precisely when a human should be re-reading.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · The FIVE POLICY_ASSUMPTION magnitudes. `STACK_UPLIFT_PER_PAIR`,
 *     `ADAPTATION_UPLIFT_AT_DANGER`, `RECOVERY_DEBT_UPLIFT`,
 *     `INJURY_UPLIFT_BY_SEVERITY` and `NIGGLE_UPLIFT_AT_MAX_SEVERITY` have no
 *     document behind them, so there is nothing to read them out of. All this
 *     file can do is assert they are LABELLED as ours, which it does, and that
 *     is the whole of the defence. If one of those five is wrong, every test
 *     in this directory still passes.
 *   · Whether a citation is APT. It proves the quoted text exists and the
 *     numbers match. It cannot tell that the table is the right table, which
 *     is exactly the failure `52174bcd` shipped: two adjacent columns, the
 *     wrong one encoded, every citation resolving.
 *   · Whether a caller actually supplies `noQualityWindowDays` from
 *     `raceWindowFor`. It checks that the two agree; it cannot check that the
 *     caller called it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEMAND_CITATIONS,
  LONG_RUN_SPIKE_RATIO,
  LONG_RUN_SPIKE_RISK_UPLIFT,
  HARD_SESSION_SPACING_H,
  CUTBACK_CADENCE_WEEKS,
  CUTBACK_OVERDUE_RAMP_WEEKS,
  ADAPTATION_CURVE,
  STACK_UPLIFT_PER_PAIR,
  ADAPTATION_UPLIFT_AT_DANGER,
  RECOVERY_DEBT_UPLIFT,
  INJURY_UPLIFT_BY_SEVERITY,
  NIGGLE_UPLIFT_AT_MAX_SEVERITY,
} from './weekly-demand';
import { ACWR_BANDS } from '@/lib/coach/tier-rules';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

function doc(rel: string): string {
  return readFileSync(path.join(REPO, rel), 'utf8');
}

/** The text under a heading, up to the next heading of the same or higher level. */
function section(src: string, heading: string): string {
  const i = src.indexOf(heading);
  expect(i, `anchor not found verbatim: ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(i + heading.length);
  const j = rest.search(/\n#{2,3} /);
  return j < 0 ? rest : rest.slice(0, j);
}

describe('WEEKLYDEMAND-CITE-1 · liveness', () => {
  it('reads real documents with real content in them', () => {
    const files = new Set(Object.values(DEMAND_CITATIONS).map((c) => c.source));
    expect(files.size).toBeGreaterThanOrEqual(3);
    let read = 0;
    for (const f of files) {
      const src = doc(f);
      expect(src.length, `${f} is empty`).toBeGreaterThan(2000);
      read += 1;
    }
    // A scanner that looked at nothing and reported clean is the worst outcome
    // available, because it also reports confidence.
    expect(read).toBe(files.size);
  });

  it('every anchor resolves VERBATIM in the file it names', () => {
    for (const [key, c] of Object.entries(DEMAND_CITATIONS)) {
      const src = doc(c.source);
      expect(src.includes(c.section), `${key}: ${c.source} has no ${c.section}`).toBe(true);
    }
  });
});

describe('WEEKLYDEMAND-CITE-1 · the long-run spike figures come out of Research/00a', () => {
  const vp = section(
    doc('Research/00a-distance-running-training.md'),
    '### Volume progression rules',
  );

  it('the 110% threshold is the document\'s own number', () => {
    const m = />(\d+)% of longest run in the prior 30 d raises overuse injury risk by ~(\d+)%/
      .exec(vp);
    expect(m, 'the single-session spike row has changed shape').not.toBeNull();
    expect(LONG_RUN_SPIKE_RATIO).toBeCloseTo(Number(m![1]) / 100, 6);
  });

  it('the 64% risk uplift is the document\'s own number', () => {
    const m = />(\d+)% of longest run in the prior 30 d raises overuse injury risk by ~(\d+)%/
      .exec(vp);
    expect(LONG_RUN_SPIKE_RISK_UPLIFT).toBeCloseTo(Number(m![2]) / 100, 6);
  });

  it('the down-week cadence is the upper bound of the document\'s own band', () => {
    const m = /Down weeks \| Every (\d+)[–-](\d+) wk, reduce by (\d+)[–-](\d+)%/.exec(vp);
    expect(m, 'the down-weeks row has changed shape').not.toBeNull();
    expect(CUTBACK_CADENCE_WEEKS).toBe(Number(m![2]));
    // The ramp width reuses the band's own upper bound rather than inventing a
    // second number, which is the only claim being made about it.
    expect(CUTBACK_OVERDUE_RAMP_WEEKS).toBe(CUTBACK_CADENCE_WEEKS);
  });
});

describe('WEEKLYDEMAND-CITE-1 · the stacking rules come out of Research/00a', () => {
  const pl = section(
    doc('Research/00a-distance-running-training.md'),
    '### Practical load rules',
  );

  it('the 48 h hard-session spacing is the document\'s own number', () => {
    const m = /Hard-session spacing \| (\d+) h between hard sessions/.exec(pl);
    expect(m, 'the hard-session-spacing row has changed shape').not.toBeNull();
    expect(HARD_SESSION_SPACING_H).toBe(Number(m![1]));
  });

  it('the document really does say stress is added one at a time', () => {
    // This is what licenses a NON-ADDITIVE interaction term at all. If the
    // sentence goes, the shape of the stacking component loses its argument
    // and the magnitude has nothing left holding it up.
    expect(pl).toMatch(
      /Add stress one-at-a-time \| Either add mileage OR add intensity in a given week, not both/,
    );
  });

  it('the document really does name past injury as the strongest predictor', () => {
    expect(pl).toMatch(/Past injury \| Strongest predictor of next injury/);
  });
});

describe('WEEKLYDEMAND-CITE-1 · the ACWR curve sits on Gabbett\'s own edges', () => {
  const ac = section(
    doc('Research/15-wearable-data.md'),
    '### Acute:Chronic Workload Ratio (ACWR)',
  );

  it('ACWR_BANDS matches the zone table it claims to copy', () => {
    const detraining = /\| < (\d*\.?\d+) \| Detraining/.exec(ac);
    const sweet = /\| (\d*\.?\d+) [–-] (\d*\.?\d+) \| Sweet spot/.exec(ac);
    const danger = /\| > (\d*\.?\d+) \| Danger zone/.exec(ac);
    expect(detraining, 'the zone table has changed shape').not.toBeNull();
    expect(sweet).not.toBeNull();
    expect(danger).not.toBeNull();
    expect(ACWR_BANDS.detraining).toBeCloseTo(Number(detraining![1]), 6);
    expect(ACWR_BANDS.caution).toBeCloseTo(Number(sweet![2]), 6);
    expect(ACWR_BANDS.danger).toBeCloseTo(Number(danger![1]), 6);
  });

  it('the three inner control points ARE those edges, not a second copy', () => {
    const xs = ADAPTATION_CURVE.map(([x]) => x);
    expect(xs).toContain(ACWR_BANDS.detraining);
    expect(xs).toContain(ACWR_BANDS.caution);
    expect(xs).toContain(ACWR_BANDS.danger);
  });

  it('the two outer control points are DERIVED from the table, not chosen', () => {
    const bandWidth = ACWR_BANDS.danger - ACWR_BANDS.caution;
    expect(ADAPTATION_CURVE[0][0]).toBeCloseTo(ACWR_BANDS.detraining - bandWidth, 9);
    expect(ADAPTATION_CURVE[ADAPTATION_CURVE.length - 1][0])
      .toBeCloseTo(ACWR_BANDS.danger + bandWidth, 9);
  });

  it('the document still asks for a slope rather than a stop-light', () => {
    // The whole reason the response is interpolated instead of stepped.
    expect(ac).toMatch(/a directional sanity check, not a stop-light/);
    expect(ac).toMatch(/a ratio of 1\.4 in itself is not a verdict/);
  });

  it('the whole sweet spot is flat at zero, in both directions', () => {
    const at = (x: number) => ADAPTATION_CURVE.find(([a]) => a === x)?.[1];
    expect(at(ACWR_BANDS.detraining)).toBe(0);
    expect(at(ACWR_BANDS.caution)).toBe(0);
  });
});

describe('WEEKLYDEMAND-CITE-1 · the post-race window is Research/00b\'s own column', () => {
  const rd = section(doc('Research/00b-recovery-protocols.md'), '### Recovery by Distance');

  it('the column this model cites is the one it names, not its neighbour', () => {
    // 52174bcd: the engine encoded "total recovery days (no quality)" and spent
    // it as "days of zero/very-light running". Both columns exist and both are
    // asserted present here so the distinction stays visible.
    expect(rd).toMatch(/Total recovery days \(no quality\)/);
    expect(rd).toMatch(/Days of zero\/very-light running/);
  });

  it('raceWindowFor supplies the upper bound of THAT column, per distance', () => {
    // `LastRaceContext.noQualityWindowDays` is documented as coming from
    // `raceWindowFor(distanceMi, true)` in lib/coach/easy-discipline.ts, which
    // this module cannot import (it opens a database). So the agreement is
    // checked against that function's source text instead of left as prose.
    const rows: ReadonlyArray<readonly [RegExp, RegExp]> = [
      [/\| Marathon \| (\d+)[–-](\d+) \|/, /isAfter \? (\d+) : \d+; \/\/ marathon/],
      [/\| Half marathon \| (\d+)[–-](\d+) \|/, /isAfter \? (\d+) : \d+; \/\/ half/],
      [/\| 10K \| (\d+)[–-](\d+) \|/, /isAfter \? (\d+) : \d+; \/\/ 10K/],
      [/\| 5K \| (\d+)[–-](\d+) \|/, /isAfter \? (\d+) : \d+; \/\/ 5K/],
    ];
    const src = readFileSync(
      path.join(REPO, 'web-v2', 'lib', 'coach', 'easy-discipline.ts'), 'utf8');
    let checked = 0;
    for (const [docRe, srcRe] of rows) {
      const d = docRe.exec(rd);
      const s = srcRe.exec(src);
      expect(d, `Research/00b row changed: ${docRe}`).not.toBeNull();
      expect(s, `raceWindowFor changed shape: ${srcRe}`).not.toBeNull();
      expect(Number(s![1]), `${docRe} upper bound`).toBe(Number(d![2]));
      checked += 1;
    }
    expect(checked).toBe(rows.length);
  });
});

describe('WEEKLYDEMAND-CITE-1 · the five uncalibrated numbers are labelled as ours', () => {
  // Rule 22 in force: this cannot tell whether they are RIGHT. It can only
  // stop one of them being quietly re-described as physiology, which is the
  // specific defect the owner named.
  const SRC = readFileSync(path.join(__dirname, 'weekly-demand.ts'), 'utf8');

  it('each carries an explicit POLICY note in its own docblock', () => {
    for (const name of [
      'STACK_UPLIFT_PER_PAIR',
      'ADAPTATION_UPLIFT_AT_DANGER',
      'RECOVERY_DEBT_UPLIFT',
      'INJURY_UPLIFT_BY_SEVERITY',
      'NIGGLE_UPLIFT_AT_MAX_SEVERITY',
    ]) {
      const at = SRC.indexOf(`export const ${name}`);
      expect(at, `${name} is not exported`).toBeGreaterThan(0);
      const docblock = SRC.slice(Math.max(0, at - 1400), at);
      const last = docblock.lastIndexOf('/**');
      expect(last, `${name} has no docblock`).toBeGreaterThanOrEqual(0);
      expect(docblock.slice(last), `${name} does not declare itself POLICY`)
        .toMatch(/POLICY\./);
    }
  });

  it('the two CITED constants do NOT claim to be policy', () => {
    for (const name of ['LONG_RUN_SPIKE_RATIO', 'LONG_RUN_SPIKE_RISK_UPLIFT',
      'HARD_SESSION_SPACING_H', 'CUTBACK_CADENCE_WEEKS']) {
      const at = SRC.indexOf(`export const ${name}`);
      const docblock = SRC.slice(Math.max(0, at - 900), at);
      const last = docblock.lastIndexOf('/**');
      expect(docblock.slice(last), `${name} should be marked CITED`).toMatch(/CITED\./);
    }
  });

  it('the five are real, finite and positive', () => {
    for (const v of [STACK_UPLIFT_PER_PAIR, ADAPTATION_UPLIFT_AT_DANGER,
      RECOVERY_DEBT_UPLIFT, NIGGLE_UPLIFT_AT_MAX_SEVERITY,
      INJURY_UPLIFT_BY_SEVERITY.minor, INJURY_UPLIFT_BY_SEVERITY.moderate,
      INJURY_UPLIFT_BY_SEVERITY.major]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    // A worse injury never costs less than a milder one.
    expect(INJURY_UPLIFT_BY_SEVERITY.moderate)
      .toBeGreaterThan(INJURY_UPLIFT_BY_SEVERITY.minor);
    expect(INJURY_UPLIFT_BY_SEVERITY.major)
      .toBeGreaterThan(INJURY_UPLIFT_BY_SEVERITY.moderate);
  });
});
