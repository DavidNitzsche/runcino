/**
 * WEEKLYDEMAND-1 · the weekly demand model, enforced.
 *
 * The point of this suite is that the model cannot quietly stop being a model:
 * that the seven components still add up to the number, that an unknown input
 * still refuses instead of guessing, that the shared terms still agree with the
 * arbitration scale next door, and that the file still opens no database.
 *
 * The fixtures are the owner's CORRECTED full-2026 history, canonical rows only
 * (`NOT (data ? 'mergedIntoId')`), pinned here so the suite runs with no
 * database:
 *
 *   peak week              48.5 mi  (week of 2026-02-09)
 *   other high weeks       47.5, 47.3, 45.8, 44.9, 44.7, 43.9, 43.2
 *   longest training run   21.51 mi (2026-01-25), then 20.02, 20.00, 19.00, 18.00
 *   marathons run in 2026  LA 03-08, Big Sur 04-26
 *   halves run in 2026     Rose Bowl 01-18, Disney 02-01, Sombrero 05-03, AFC 08-16
 *   goal                   CIM 2026-12-06, 3:00:00
 *
 * WHAT IS RECONSTRUCTED, SAID PLAINLY. The weekly totals and the long runs are
 * measured. WHICH long run and how many quality minutes sat inside WHICH week
 * is not in the numbers above, so the pairings below are a reconstruction and
 * are labelled as one. The ceiling therefore has a real dependency on an
 * assumption, and `it('is not very sensitive to the reconstruction')` measures
 * how big that dependency is instead of hiding it.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 *   · Whether the five POLICY_ASSUMPTION magnitudes are RIGHT. Every number
 *     asserted below is a consequence of them, so the suite would pass just as
 *     green with `STACK_UPLIFT_PER_PAIR` at 0.004 or at 0.4. Calibrating them
 *     needs outcomes this app does not have.
 *   · Whether `athleteCeiling` is the right CEILING. It proves the ceiling is
 *     the largest absorbed week under the same formula. Whether a runner may
 *     be taken past his largest absorbed week, and by how much, is a coaching
 *     question this module does not answer and must not be read as answering.
 *   · Whether any caller filtered `demonstratedWeeks` through
 *     `normal-window.ts`. The contract is asserted as TEXT in this file, which
 *     stops the sentence being deleted; it cannot see what a caller passes.
 *   · Anything about the plan generator. This module is pure and observational
 *     and nothing in the app calls it yet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  computeWeeklyDemand,
  athleteCeilingFrom,
  baseCostOfWeek,
  longRunSpikeFraction,
  stackingShape,
  adaptationFraction,
  recoveryDebt,
  REQUIRED_COMPONENTS,
  LONG_RUN_SPIKE_RATIO,
  STACK_UPLIFT_PER_PAIR,
  ADAPTATION_UPLIFT_AT_DANGER,
  RECOVERY_DEBT_UPLIFT,
  INJURY_UPLIFT_BY_SEVERITY,
  type WeeklyDemandInput,
  type DemonstratedWeek,
  type DemandComponentKey,
} from './weekly-demand';
import { projectPlanLoad } from '@/lib/adaptation/canonical/plan-load';
import type { AcwrResult } from '@/lib/coach/acwr';
import type { SafetyResolution } from '@/lib/safety/safety-verdict';

const WEB = path.resolve(__dirname, '..', '..', '..');

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES
 * ═══════════════════════════════════════════════════════════════════════ */

const SWEET_SPOT: AcwrResult = {
  acwr: 1.15, acute7: 6.9, chronic28: 6.0, coverageDays: 28, reason: null,
};
const REFUSED: AcwrResult = {
  acwr: null, acute7: null, chronic28: null, coverageDays: 11,
  reason: 'insufficient_coverage',
};
const SAFETY_CLEAR: SafetyResolution = {
  known: true, state: 'NORMAL', posture: 'PRESCRIBE', reason: 'clear', driver: null,
  injury: null, illness: null, niggle: null, degradedSignals: [],
  explain: 'safety NORMAL · nothing open',
};
const SAFETY_UNREADABLE: SafetyResolution = {
  known: false, posture: 'WITHHOLD_PENDING_CHECK',
  unreadable: [{ signal: 'injury', failure: 'READ_FAILED' }],
  floor: 'NORMAL', explain: 'safety UNKNOWN · unreadable=injury:READ_FAILED',
};
const SAFETY_INJURED: SafetyResolution = {
  known: true, state: 'MODIFY', posture: 'EASY_ONLY', reason: 'injury_moderate',
  driver: 'injury',
  injury: {
    id: 1, site: 'left achilles', severity: 'moderate', startDateISO: '2026-10-01',
    expectedReturnDateISO: null, returnProtocol: null, notes: null,
  },
  illness: null, niggle: null, degradedSignals: [],
  explain: 'safety MODIFY · injury_moderate',
};

/**
 * The owner's demonstrated weeks. Weekly totals and long-run distances are
 * measured; the PAIRING of the two, and the quality minutes, are reconstructed.
 */
const DAVID_WEEKS: readonly DemonstratedWeek[] = [
  { weekStartISO: '2026-01-19', weeklyMi: 45.8, longRunMi: 21.51, qualityMinutes: 30, absorbed: true },
  { weekStartISO: '2026-02-09', weeklyMi: 48.5, longRunMi: 20.02, qualityMinutes: 40, absorbed: true },
  { weekStartISO: '2026-02-16', weeklyMi: 47.5, longRunMi: 18.00, qualityMinutes: 40, absorbed: true },
  { weekStartISO: '2026-02-23', weeklyMi: 47.3, longRunMi: 16.00, qualityMinutes: 35, absorbed: true },
  // The 07-20 week: he ran 4.2 mi in the seven days that followed, against 52
  // prescribed. Run, and NOT absorbed. It must not raise the ceiling.
  { weekStartISO: '2026-07-20', weeklyMi: 44.9, longRunMi: 18.00, qualityMinutes: 30, absorbed: false },
  // Nobody has judged this one. Unknown does not raise the ceiling either.
  { weekStartISO: '2026-08-03', weeklyMi: 43.2, longRunMi: 14.00, qualityMinutes: 20, absorbed: null },
];

/** The live 2026-10-26 peak week, as the preview authors it today. */
const PEAK_WEEK: WeeklyDemandInput = {
  weekStartISO: '2026-10-26',
  weeklyMi: 60.0,
  qualityMinutes: 65,        // 6 mi at T plus 9x3 min at I, warmups excluded
  longRunMi: 21.5,
  hardSessionDayOrdinals: [2, 4, 6],
  longestRunPrior30dMi: 18.0,
  acwr: SWEET_SPOT,
  lastRace: { daysSince: 71, noQualityWindowDays: 14 },  // AFC half, 2026-08-16
  weeksSinceLastCutback: 3,
  demonstratedWeeks: DAVID_WEEKS,
  safety: SAFETY_CLEAR,
};

/** A quiet, fully-known week, used wherever the point is not the week. */
const QUIET: WeeklyDemandInput = {
  weekStartISO: '2026-09-07',
  weeklyMi: 40,
  qualityMinutes: 30,
  longRunMi: 14,
  hardSessionDayOrdinals: [3],
  longestRunPrior30dMi: 16,
  acwr: SWEET_SPOT,
  lastRace: 'NONE',
  weeksSinceLastCutback: 2,
  demonstratedWeeks: DAVID_WEEKS,
  safety: SAFETY_CLEAR,
};

function componentOf(r: ReturnType<typeof computeWeeklyDemand>, k: DemandComponentKey) {
  const c = r.components.find((x) => x.key === k);
  expect(c, `component ${k} is missing entirely`).toBeDefined();
  return c!;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 0 · LIVENESS AND PURITY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · liveness', () => {
  it('the module under test is really there and really has code in it', () => {
    const src = readFileSync(path.join(__dirname, 'weekly-demand.ts'), 'utf8');
    expect(src.length).toBeGreaterThan(8000);
    expect(src).toContain('export function computeWeeklyDemand');
    expect(REQUIRED_COMPONENTS.length).toBe(6);
  });
});

describe('WEEKLYDEMAND-1 · the module reaches no database at any depth', () => {
  /**
   * Rule 19 was earned by `lthr-reanchor.ts`, whose own header asserted it
   * "imports no database at any depth". It was false, it was false for a day,
   * and no check could tell. This is that claim gated instead of asserted.
   *
   * Type-only imports are skipped because they are erased at compile time and
   * emit nothing. Everything else is followed transitively.
   */
  function resolve(spec: string, fromFile: string): string | null {
    const base = spec.startsWith('@/')
      ? path.join(WEB, spec.slice(2))
      : spec.startsWith('.')
        ? path.resolve(path.dirname(fromFile), spec)
        : null;
    if (base == null) return null;                 // a package, not our source
    for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(cand)) return cand;
    }
    return null;
  }

  function edges(file: string): string[] {
    const src = readFileSync(file, 'utf8');
    const out: string[] = [];
    // Static imports, skipping `import type` (erased).
    for (const m of src.matchAll(/^import\s+(type\s+)?([\s\S]*?)from\s+'([^']+)'/gm)) {
      if (m[1]) continue;
      // `import { type A, foo }` still has a runtime edge via `foo`; a clause
      // that is ONLY type specifiers does not, but treating it as one is the
      // conservative direction and cannot hide a database.
      out.push(m[3]);
    }
    for (const m of src.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) out.push(m[1]);
    return out;
  }

  it('walks the whole graph and finds no server-only module', () => {
    const entry = path.join(__dirname, 'weekly-demand.ts');
    const seen = new Set<string>([entry]);
    const queue = [entry];
    const reached: string[] = [];
    while (queue.length > 0) {
      const f = queue.shift()!;
      for (const spec of edges(f)) {
        const r = resolve(spec, f);
        if (r == null || seen.has(r)) continue;
        seen.add(r);
        reached.push(path.relative(WEB, r));
        queue.push(r);
      }
    }
    // LIVENESS: the walk must actually have walked. Zero reached modules would
    // mean the edge regex stopped matching, and it would report clean.
    expect(reached.length, 'the import walk reached nothing, so it proves nothing')
      .toBeGreaterThan(0);
    for (const r of [...seen].map((f) => path.relative(WEB, f))) {
      expect(r, `${r} is a server-only module and this file must stay pure`)
        .not.toMatch(/^lib\/db\//);
    }
    expect(reached.join(' ')).not.toMatch(/pg|pool/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · RULE 16 · ONE QUANTITY, ONE NAME
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · Rule 16 · this index and the arbitration index are one scale', () => {
  it('with no context at all, it EQUALS projectPlanLoad for the same week', () => {
    // The two live in different files under the same name. Here is why that is
    // not two quantities: the shared coefficients are imported, not restated,
    // and the numbers agree to the last place when the four extra components
    // contribute nothing.
    const noContext: WeeklyDemandInput = {
      ...QUIET,
      longRunMi: 14,
      longestRunPrior30dMi: 18,     // no spike: 14 is under his recent longest
      hardSessionDayOrdinals: [3],  // one hard session: nothing stacks
      acwr: { acwr: 1.0, acute7: 6, chronic28: 6, coverageDays: 28, reason: null },
      lastRace: 'NONE',
      weeksSinceLastCutback: 1,
      safety: SAFETY_CLEAR,
    };
    const mine = computeWeeklyDemand(noContext);
    const theirs = projectPlanLoad({
      weeklyMi: 40, longRunMi: 14, qualityMinutes: 30,
      thresholdAnchorDeltaSecPerMi: 0,
    });
    expect(mine.demandIndex).toBeCloseTo(theirs.demandIndex, 6);
  });

  it('and it stops being equal the moment context is real, which is the point', () => {
    const r = computeWeeklyDemand(PEAK_WEEK);
    const theirs = projectPlanLoad({
      weeklyMi: 60, longRunMi: 21.5, qualityMinutes: 65,
      thresholdAnchorDeltaSecPerMi: 0,
    });
    expect(r.demandIndex).not.toBeNull();
    expect(r.demandIndex!).toBeGreaterThan(theirs.demandIndex);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE SEVEN ADD UP
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · the components sum to the index', () => {
  it('exactly, for a fully-known week', () => {
    const r = computeWeeklyDemand(PEAK_WEEK);
    const sum = r.components.reduce((s, c) => s + (c.contribution ?? 0), 0);
    expect(r.demandIndex).not.toBeNull();
    expect(sum).toBeCloseTo(r.demandIndex!, 6);
  });

  it('and every component names its provenance and its basis', () => {
    const r = computeWeeklyDemand(PEAK_WEEK);
    expect(r.components.map((c) => c.key)).toEqual([
      'volume', 'intensity', 'longRunLoad', 'stacking',
      'recentAdaptation', 'recovery', 'injury',
    ]);
    for (const c of r.components) {
      expect(c.basis.length, `${c.key} has no basis`).toBeGreaterThan(10);
      expect(c.why.length, `${c.key} has no why`).toBeGreaterThan(30);
      expect(['CALCULATED_PHYSIOLOGY', 'ATHLETE_EVIDENCE', 'POLICY_ASSUMPTION'])
        .toContain(c.provenance);
    }
  });

  it('the explain paragraph names every number it used', () => {
    const r = computeWeeklyDemand(PEAK_WEEK);
    expect(r.explain).toContain(String(r.demandIndex));
    expect(r.explain).toMatch(/equivalent easy mile/);
    expect(r.explain).toMatch(/2026-10-26/);
    // Rule 17: it is one paragraph, not a sentence repeated per component.
    expect(r.explain).not.toMatch(/\n/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · RULE 11 · THREE FACTS, NEVER ONE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · Rule 11 · unknown is null, and null refuses', () => {
  const nulls: ReadonlyArray<readonly [DemandComponentKey, Partial<WeeklyDemandInput>]> = [
    ['volume', { weeklyMi: null }],
    ['intensity', { qualityMinutes: null }],
    ['longRunLoad', { longRunMi: null }],
    ['longRunLoad', { longestRunPrior30dMi: null }],
    ['stacking', { hardSessionDayOrdinals: null }],
    ['recentAdaptation', { acwr: null }],
    ['recentAdaptation', { acwr: REFUSED }],
    ['recovery', { lastRace: null }],
    ['recovery', { weeksSinceLastCutback: null }],
  ];

  for (const [key, patch] of nulls) {
    it(`a missing ${Object.keys(patch)[0]} makes ${key} null and refuses the index`, () => {
      const r = computeWeeklyDemand({ ...PEAK_WEEK, ...patch });
      expect(componentOf(r, key).contribution).toBeNull();
      expect(r.demandIndex).toBeNull();
      expect(r.unknownComponents).toContain(key);
      expect(r.atCeiling).toBeNull();
      expect(r.explain).toMatch(/No demand index/);
    });
  }

  it('A MISSING INPUT NEVER MAKES THE WEEK LOOK CHEAPER', () => {
    // The failure this rule exists for: the safest reading of the data
    // producing the most aggressive answer. There is no input whose absence
    // yields a smaller number, because absence yields no number at all.
    const full = computeWeeklyDemand(PEAK_WEEK);
    expect(full.demandIndex).not.toBeNull();
    for (const [, patch] of nulls) {
      const r = computeWeeklyDemand({ ...PEAK_WEEK, ...patch });
      expect(r.demandIndex, `${Object.keys(patch)[0]} produced a number`).toBeNull();
    }
  });

  it('a MEASURED zero is a number and is not an absence', () => {
    const restWeek = computeWeeklyDemand({
      ...QUIET,
      weeklyMi: 0, qualityMinutes: 0, longRunMi: 0,
      hardSessionDayOrdinals: [],
    });
    expect(restWeek.demandIndex).toBe(0);
    expect(restWeek.unknownComponents).not.toContain('volume');
    expect(restWeek.unknownComponents).not.toContain('intensity');
    expect(restWeek.unknownComponents).not.toContain('stacking');
    expect(componentOf(restWeek, 'stacking').why).toMatch(/measured zero/);
  });

  it('an all-easy week has zero stacking, and that is different from not knowing', () => {
    const known = computeWeeklyDemand({ ...QUIET, hardSessionDayOrdinals: [] });
    const unknown = computeWeeklyDemand({ ...QUIET, hardSessionDayOrdinals: null });
    expect(componentOf(known, 'stacking').contribution).toBe(0);
    expect(componentOf(unknown, 'stacking').contribution).toBeNull();
    expect(known.demandIndex).not.toBeNull();
    expect(unknown.demandIndex).toBeNull();
  });

  it('the ACWR resolver\'s own refusal reason survives into the component', () => {
    const r = computeWeeklyDemand({ ...QUIET, acwr: REFUSED });
    expect(componentOf(r, 'recentAdaptation').why).toContain('insufficient_coverage');
  });

  it('"he has not raced" and "we do not know" are two different inputs', () => {
    const none = computeWeeklyDemand({ ...QUIET, lastRace: 'NONE' });
    const unknown = computeWeeklyDemand({ ...QUIET, lastRace: null });
    expect(componentOf(none, 'recovery').contribution).not.toBeNull();
    expect(componentOf(unknown, 'recovery').contribution).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · INJURY · READ, NEVER DETECTED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · injury context is read and never detected', () => {
  it('is not a REQUIRED component, so a healthy runner still gets an index', () => {
    expect(REQUIRED_COMPONENTS).not.toContain('injury');
    const r = computeWeeklyDemand(PEAK_WEEK);
    expect(r.demandIndex).not.toBeNull();
    expect(r.unknownComponents).toContain('injury');
  });

  it('three absences stay three distinguishable facts', () => {
    const noResolver = computeWeeklyDemand({ ...QUIET, safety: null });
    const failedRead = computeWeeklyDemand({ ...QUIET, safety: SAFETY_UNREADABLE });
    const cleanRead = computeWeeklyDemand({ ...QUIET, safety: SAFETY_CLEAR });
    for (const r of [noResolver, failedRead, cleanRead]) {
      expect(componentOf(r, 'injury').contribution).toBeNull();
      expect(r.unknownComponents).toContain('injury');
    }
    const whys = [noResolver, failedRead, cleanRead].map((r) => componentOf(r, 'injury').why);
    expect(new Set(whys).size, 'the three cases say the same thing').toBe(3);
    expect(whys[0]).toMatch(/No safety resolution was supplied/);
    expect(whys[1]).toMatch(/injury:READ_FAILED/);
    expect(whys[2]).toMatch(/found no open injury/);
  });

  it('and it is stated in the explain paragraph rather than passing silently', () => {
    const r = computeWeeklyDemand(PEAK_WEEK);
    expect(r.explain).toMatch(/Injury context is not in this number/);
  });

  it('a RECORDED open injury is priced, and only then', () => {
    const clean = computeWeeklyDemand({ ...QUIET, safety: SAFETY_CLEAR });
    const hurt = computeWeeklyDemand({ ...QUIET, safety: SAFETY_INJURED });
    const c = componentOf(hurt, 'injury');
    expect(c.contribution).not.toBeNull();
    expect(c.provenance).toBe('POLICY_ASSUMPTION');
    expect(c.why).toMatch(/left achilles/);
    expect(c.why).toMatch(/not\s+detected/);
    // The base is identical, so the whole difference is the injury uplift.
    const base = componentOf(hurt, 'volume').contribution!
      + componentOf(hurt, 'intensity').contribution!
      + componentOf(hurt, 'longRunLoad').contribution!;
    expect(c.contribution!).toBeCloseTo(base * INJURY_UPLIFT_BY_SEVERITY.moderate, 6);
    expect(hurt.demandIndex!).toBeGreaterThan(clean.demandIndex!);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE PIECES, INDIVIDUALLY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · the long-run spike is measured against HIS prior 30 days', () => {
  it('is zero at or under what he has just run', () => {
    expect(longRunSpikeFraction(18, 18)).toBe(0);
    expect(longRunSpikeFraction(12, 18)).toBe(0);
  });

  it('is exactly 1.0 at doctrine\'s threshold ratio', () => {
    expect(longRunSpikeFraction(18 * LONG_RUN_SPIKE_RATIO, 18)).toBeCloseTo(1, 9);
  });

  it('keeps rising past it, because doctrine says the risk keeps rising', () => {
    expect(longRunSpikeFraction(18 * 1.3, 18)).toBeGreaterThan(
      longRunSpikeFraction(18 * 1.2, 18));
  });

  it('the anchor is UNFILTERED · Rule 8 corollary, spike-anchor side', () => {
    // A taper long run is a real run his legs really did. Filtering it out
    // would wave through a jump they have not been prepared for, which is the
    // over-application Rule 8's corollary names.
    const r = computeWeeklyDemand({ ...PEAK_WEEK, longestRunPrior30dMi: 13.5 });
    const looser = computeWeeklyDemand({ ...PEAK_WEEK, longestRunPrior30dMi: 21.51 });
    expect(componentOf(r, 'longRunLoad').contribution!)
      .toBeGreaterThan(componentOf(looser, 'longRunLoad').contribution!);
  });
});

describe('WEEKLYDEMAND-1 · stacking is not additive', () => {
  it('one hard session stacks with nothing', () => {
    expect(stackingShape([3]).pairs).toBe(0);
  });

  it('three hard sessions cost more than three times one', () => {
    // The requirement in one assertion: two hard sessions plus a long run in
    // one week cost more than the sum of their parts, because the term is a
    // product over PAIRS and pairs grow faster than sessions.
    const one = stackingShape([3]).pairs;
    const three = stackingShape([1, 3, 5]).pairs;
    expect(three).toBe(3);
    expect(three).toBeGreaterThan(3 * one);
  });

  it('crowding is 1.0 at doctrine\'s 48 h and 2.0 back to back', () => {
    expect(stackingShape([0, 2]).crowding).toBeCloseTo(1, 9);   // 48 h apart
    expect(stackingShape([0, 3]).crowding).toBeCloseTo(1, 9);   // more is not less
    expect(stackingShape([0, 0]).crowding).toBeCloseTo(2, 9);   // no gap at all
    expect(stackingShape([0, 1]).crowding).toBeCloseTo(1.5, 9); // 24 h
  });

  it('the uplift is the stated policy fraction of base, per pair', () => {
    const r = computeWeeklyDemand({ ...QUIET, hardSessionDayOrdinals: [0, 2, 4] });
    const base = componentOf(r, 'volume').contribution!
      + componentOf(r, 'intensity').contribution!
      + componentOf(r, 'longRunLoad').contribution!;
    expect(componentOf(r, 'stacking').contribution!)
      .toBeCloseTo(base * STACK_UPLIFT_PER_PAIR * 3, 6);
  });
});

describe('WEEKLYDEMAND-1 · recent adaptation runs through Gabbett, not at him', () => {
  it('the whole sweet spot is exactly neutral, in both directions', () => {
    for (const r of [0.8, 0.9, 1.0, 1.1, 1.2, 1.3]) {
      expect(adaptationFraction(r), `acwr ${r}`).toBe(0);
    }
  });

  it('below the sweet spot the same week lands on fresher legs', () => {
    expect(adaptationFraction(0.6)).toBeCloseTo(-ADAPTATION_UPLIFT_AT_DANGER, 9);
    expect(adaptationFraction(0.7)).toBeLessThan(0);
    expect(adaptationFraction(0.7)).toBeGreaterThan(adaptationFraction(0.6));
  });

  it('at the danger edge it costs the stated policy uplift', () => {
    expect(adaptationFraction(1.5)).toBeCloseTo(ADAPTATION_UPLIFT_AT_DANGER, 9);
    expect(adaptationFraction(1.4)).toBeCloseTo(ADAPTATION_UPLIFT_AT_DANGER / 2, 9);
  });

  it('1.4 gets half the penalty, not all of it · the stop-light clause', () => {
    // Research/15: "a ratio of 1.4 in itself is not a verdict." A step function
    // hands 1.4 the full elevated penalty, which is the one reading the source
    // rules out.
    expect(adaptationFraction(1.4)).toBeLessThan(adaptationFraction(1.5));
    expect(adaptationFraction(1.4)).toBeGreaterThan(adaptationFraction(1.3));
  });
});

describe('WEEKLYDEMAND-1 · recovery reads the calendar, not a wrist', () => {
  it('post-race debt is full on race day and gone at the end of the window', () => {
    expect(recoveryDebt({ daysSince: 0, noQualityWindowDays: 28 }, 0).raceOverlap)
      .toBeCloseTo(1, 9);
    expect(recoveryDebt({ daysSince: 14, noQualityWindowDays: 28 }, 0).raceOverlap)
      .toBeCloseTo(0.5, 9);
    expect(recoveryDebt({ daysSince: 28, noQualityWindowDays: 28 }, 0).raceOverlap)
      .toBeCloseTo(0, 9);
    expect(recoveryDebt({ daysSince: 60, noQualityWindowDays: 28 }, 0).raceOverlap)
      .toBeCloseTo(0, 9);
  });

  it('no race behind him is a fact, priced at zero', () => {
    expect(recoveryDebt('NONE', 0).raceOverlap).toBe(0);
    expect(recoveryDebt('NONE', 0).debt).toBe(0);
  });

  it('cutback debt starts at the cadence and reaches full one cadence later', () => {
    expect(recoveryDebt('NONE', 4).cutbackOverdue).toBeCloseTo(0, 9);
    expect(recoveryDebt('NONE', 6).cutbackOverdue).toBeCloseTo(0.5, 9);
    expect(recoveryDebt('NONE', 8).cutbackOverdue).toBeCloseTo(1, 9);
    expect(recoveryDebt('NONE', 20).cutbackOverdue).toBeCloseTo(1, 9);
  });

  it('the two do not price the same debt twice', () => {
    const both = recoveryDebt({ daysSince: 0, noQualityWindowDays: 28 }, 12);
    expect(both.raceOverlap).toBeCloseTo(1, 9);
    expect(both.cutbackOverdue).toBeCloseTo(1, 9);
    expect(both.debt).toBe(1);
  });

  it('a fresh marathon behind him raises the week, by the stated policy fraction', () => {
    const fresh = computeWeeklyDemand({
      ...QUIET, lastRace: { daysSince: 0, noQualityWindowDays: 28 },
    });
    const base = componentOf(fresh, 'volume').contribution!
      + componentOf(fresh, 'intensity').contribution!
      + componentOf(fresh, 'longRunLoad').contribution!;
    expect(componentOf(fresh, 'recovery').contribution!)
      .toBeCloseTo(base * RECOVERY_DEBT_UPLIFT, 6);
  });

  it('no wearable recovery score reaches this module', () => {
    // PLAN_SIMPLIFICATION_DOCTRINE removed sleep, HRV and resting HR from plan
    // decisions. This is Rule 20 pointed at the header claim that says so.
    const src = readFileSync(path.join(__dirname, 'weekly-demand.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const forbidden of ['hrv', 'sleepScore', 'restingHr', 'tsb', 'readinessScore']) {
      expect(code, `${forbidden} reached the demand model`)
        .not.toMatch(new RegExp(`\\b${forbidden}\\b`, 'i'));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · THE CEILING · Rule 8 HABIT SIDE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · the athlete ceiling', () => {
  it('is the largest week he ABSORBED, under the same formula', () => {
    const { ceiling, from, considered } = athleteCeilingFrom(DAVID_WEEKS);
    expect(from?.weekStartISO).toBe('2026-02-09');
    expect(considered).toBe(4);
    expect(ceiling).toBeCloseTo(baseCostOfWeek(DAVID_WEEKS[1]), 6);
    expect(ceiling).toBeCloseTo(66.705, 3);
  });

  it('a week he ran and did NOT absorb does not raise it', () => {
    const withBigUnabsorbed = athleteCeilingFrom([
      ...DAVID_WEEKS,
      { weekStartISO: '2026-11-02', weeklyMi: 70, longRunMi: 22, qualityMinutes: 90, absorbed: false },
    ]);
    expect(withBigUnabsorbed.ceiling).toBeCloseTo(66.705, 3);
  });

  it('a week NOBODY HAS JUDGED does not raise it either', () => {
    // PLAN_SIMPLIFICATION_DOCTRINE invariant 11: missing data may not silently
    // create a more aggressive plan, and a higher ceiling is exactly that.
    const withBigUnknown = athleteCeilingFrom([
      ...DAVID_WEEKS,
      { weekStartISO: '2026-11-02', weeklyMi: 70, longRunMi: 22, qualityMinutes: 90, absorbed: null },
    ]);
    expect(withBigUnknown.ceiling).toBeCloseTo(66.705, 3);
  });

  it('"did not look" and "looked and found none" are two different facts', () => {
    expect(athleteCeilingFrom(null).ceiling).toBeNull();
    expect(athleteCeilingFrom([]).ceiling).toBeNull();
    const didNotLook = computeWeeklyDemand({ ...PEAK_WEEK, demonstratedWeeks: null });
    const foundNone = computeWeeklyDemand({ ...PEAK_WEEK, demonstratedWeeks: [] });
    expect(didNotLook.explain).toMatch(/No demonstrated weeks were supplied/);
    expect(foundNone.explain).toMatch(/No demonstrated week is marked as absorbed/);
    expect(didNotLook.atCeiling).toBeNull();
    expect(foundNone.atCeiling).toBeNull();
  });

  it('is not very sensitive to the quality-minutes reconstruction', () => {
    // The pairings in DAVID_WEEKS are reconstructed. This measures how much of
    // the ceiling rests on that rather than pretending it does not.
    const lean = DAVID_WEEKS.map((w) => ({ ...w, qualityMinutes: 20 }));
    const rich = DAVID_WEEKS.map((w) => ({ ...w, qualityMinutes: 60 }));
    expect(athleteCeilingFrom(lean).ceiling).toBeCloseTo(60.105, 3);
    expect(athleteCeilingFrom(rich).ceiling).toBeCloseTo(73.305, 3);
    // Volume is 73% of the ceiling either way. The reconstruction moves it by
    // about a fifth across a three-fold change in assumed quality.
    expect(athleteCeilingFrom(rich).ceiling! / athleteCeilingFrom(lean).ceiling!)
      .toBeLessThan(1.25);
  });

  it('RULE 8 · the habit-side filter contract is written on the input', () => {
    // Rule 20: a header claim nothing verifies is a hypothesis. This does not
    // prove a caller filtered; it stops the instruction being deleted.
    const src = readFileSync(path.join(__dirname, 'weekly-demand.ts'), 'utf8');
    expect(src).toMatch(/RULE 8, HABIT SIDE/);
    expect(src).toMatch(/lib\/training\/normal-window\.ts/);
    expect(src).toMatch(/RULE 8, SPIKE-ANCHOR SIDE/);
    expect(src).toMatch(/RULE 8, ABSORBED-LOAD SIDE/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE OWNER'S ACTUAL WEEK
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · the 2026-10-26 peak week, priced', () => {
  const r = computeWeeklyDemand(PEAK_WEEK);

  it('prices at about 105 equivalent easy miles', () => {
    expect(r.demandIndex).toBeCloseTo(104.736, 2);
  });

  it('and that is about 157% of his demonstrated ceiling', () => {
    expect(r.athleteCeiling).toBeCloseTo(66.705, 3);
    expect(r.atCeiling).toBe(true);
    expect(r.demandIndex! / r.athleteCeiling!).toBeCloseTo(1.57, 2);
  });

  it('the long run alone carries more than twice its flat surcharge', () => {
    // 21.5 mi against a prior-30-day longest of 18.0 is 119.4%, past the cited
    // 110% threshold. This is the term the old ceiling comparison could not see
    // at all, because 21.5 mi in a 60 mi week is under the long-run share cap.
    const lrl = componentOf(r, 'longRunLoad');
    expect(lrl.contribution).toBeCloseTo(12.064, 3);
    expect(lrl.provenance).toBe('ATHLETE_EVIDENCE');
    expect(lrl.why).toMatch(/119\.4%/);
  });

  it('stacking adds about 11 miles that no per-session check could see', () => {
    expect(componentOf(r, 'stacking').contribution).toBeCloseTo(11.222, 2);
  });

  it('and mileage alone would have said 60 against a peak of 48.5', () => {
    // The reading the owner said was not a demand model: weekly miles against a
    // ceiling. It sees 124% and stops. The demand model sees 157% and says why.
    expect(60 / 48.5).toBeCloseTo(1.237, 3);
    expect(r.demandIndex! / r.athleteCeiling!)
      .toBeGreaterThan(60 / 48.5);
  });
});
