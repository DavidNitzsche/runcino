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
 *     the largest absorbed week under the same formula, on a stated basis
 *     applied to both sides. Whether a runner may be taken past his largest
 *     absorbed week, and by how much, is a coaching question this module does
 *     not answer and must not be read as answering.
 *   · Whether the reconstructed contexts in `DAVID_WEEKS_IN_CONTEXT` are TRUE.
 *     Two of the five fields are invented and labelled as invented, and their
 *     sensitivity is measured rather than hidden — but no assertion here can
 *     check them against run history the suite has not got. The FULL_CONTEXT
 *     numbers are therefore evidence about the MACHINERY, not about the
 *     runner, and `it('RULE 8 · a filtering caller drops two of these weeks')`
 *     states how far the answer moves under a different admissible input.
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
  compareToAthleteCeiling,
  ceilingCostOf,
  priceWeek,
  demonstratedWeekAsInput,
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
  type WeekCostInput,
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
 * The owner's demonstrated weeks, with NO reconstructed context.
 *
 * Weekly totals and long-run distances are measured; the PAIRING of the two,
 * and the quality minutes, are reconstructed. `context: null` is the honest
 * state of this fixture: nothing here pins where his hard days fell or what
 * his prior-30-day longest was going into each week. So a comparison against
 * this set degrades to BASE_ONLY on BOTH sides, which is the point.
 */
const DAVID_WEEKS: readonly DemonstratedWeek[] = [
  { weekStartISO: '2026-01-19', weeklyMi: 45.8, longRunMi: 21.51, qualityMinutes: 30, absorbed: true, context: null },
  { weekStartISO: '2026-02-09', weeklyMi: 48.5, longRunMi: 20.02, qualityMinutes: 40, absorbed: true, context: null },
  { weekStartISO: '2026-02-16', weeklyMi: 47.5, longRunMi: 18.00, qualityMinutes: 40, absorbed: true, context: null },
  { weekStartISO: '2026-02-23', weeklyMi: 47.3, longRunMi: 16.00, qualityMinutes: 35, absorbed: true, context: null },
  // The 07-20 week: he ran 4.2 mi in the seven days that followed, against 52
  // prescribed. Run, and NOT absorbed. It must not raise the ceiling.
  { weekStartISO: '2026-07-20', weeklyMi: 44.9, longRunMi: 18.00, qualityMinutes: 30, absorbed: false, context: null },
  // Nobody has judged this one. Unknown does not raise the ceiling either.
  { weekStartISO: '2026-08-03', weeklyMi: 43.2, longRunMi: 14.00, qualityMinutes: 20, absorbed: null, context: null },
];

/**
 * The same weeks WITH context, so the FULL_CONTEXT path is reachable at all.
 *
 * Rule 15: a mechanism the corpus cannot reach is untested however many cases
 * pass, and with `DAVID_WEEKS` alone every ceiling in this suite would take
 * the degraded branch. What each field is, said plainly, because the ceiling
 * now has a real dependency on it:
 *
 *   lastRace                MEASURED. The 2026 race calendar is pinned in the
 *                           header: Rose Bowl half 01-18, Disney half 02-01.
 *                           Days are counted to each week's Monday start.
 *   longestRunPrior30dMi    MEASURED for three of the four, from the pinned
 *                           21.51 mi on 2026-01-25. RECONSTRUCTED for the
 *                           01-19 week, whose 30-day lookback runs into 2025.
 *   hardSessionDayOrdinals  RECONSTRUCTED. Every week here carries quality
 *                           minutes and a long run, so two hard days is the
 *                           floor, not a guess about the shape. A mid-week
 *                           quality day and a weekend long run is [2, 6].
 *                           `it('is not very sensitive to the hard-day
 *                           reconstruction')` measures what this costs.
 *   acwr                    RECONSTRUCTED NEUTRAL. Sweet spot, contributes 0.
 *   weeksSinceLastCutback   RECONSTRUCTED NEUTRAL. Inside cadence, contributes 0.
 *
 * The two neutral fields are chosen neutral rather than favourable BECAUSE
 * they are invented: a reconstruction must not be able to raise the ceiling
 * through a term nobody measured.
 */
const CTX_NEUTRAL = {
  acwr: SWEET_SPOT,
  weeksSinceLastCutback: 2,
  hardSessionDayOrdinals: [2, 6] as readonly number[],
} as const;

const DAVID_WEEKS_IN_CONTEXT: readonly DemonstratedWeek[] = [
  { ...DAVID_WEEKS[0], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 18.00, lastRace: { daysSince: 1, noQualityWindowDays: 14 } } },
  { ...DAVID_WEEKS[1], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 21.51, lastRace: { daysSince: 8, noQualityWindowDays: 14 } } },
  { ...DAVID_WEEKS[2], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 21.51, lastRace: { daysSince: 15, noQualityWindowDays: 14 } } },
  { ...DAVID_WEEKS[3], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 21.51, lastRace: { daysSince: 22, noQualityWindowDays: 14 } } },
  { ...DAVID_WEEKS[4], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 18.00, lastRace: { daysSince: 78, noQualityWindowDays: 14 } } },
  { ...DAVID_WEEKS[5], context: { ...CTX_NEUTRAL, longestRunPrior30dMi: 18.00, lastRace: { daysSince: 92, noQualityWindowDays: 14 } } },
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
      expect(r.explain).toMatch(/No demand index/);
      // The FULL_CONTEXT comparison refuses with it, because it is the same
      // six components on both sides.
      expect(compareToAthleteCeiling(
        { ...PEAK_WEEK, ...patch }, DAVID_WEEKS_IN_CONTEXT,
      )!.proposed).toBeNull();
      // BASE_ONLY reads three measured quantities and none of the context
      // terms, so it refuses on exactly those three and stands otherwise.
      // Refusing a ratio that IS honestly computable is as much a Rule 11
      // failure as inventing one that is not.
      const touchesBase = ['weeklyMi', 'qualityMinutes', 'longRunMi']
        .includes(Object.keys(patch)[0]);
      expect(r.ceiling!.basis).toBe('BASE_ONLY');
      if (touchesBase) {
        expect(r.ceiling!.proposed).toBeNull();
        expect(r.atCeiling).toBeNull();
        expect(r.explain).toMatch(/cannot be priced on the BASE_ONLY basis/);
      } else {
        expect(r.ceiling!.proposed).toBeCloseTo(86.825, 3);
        expect(r.atCeiling).toBe(true);
      }
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
  const cmp = (weeks: readonly DemonstratedWeek[] | null, proposed = PEAK_WEEK) =>
    compareToAthleteCeiling(proposed, weeks);

  it('with no reconstructed context it degrades BOTH sides to BASE_ONLY', () => {
    const c = cmp(DAVID_WEEKS)!;
    expect(c.basis).toBe('BASE_ONLY');
    expect(c.considered).toBe(4);
    expect(c.withoutContext).toEqual([
      '2026-01-19', '2026-02-09', '2026-02-16', '2026-02-23',
    ]);
    expect(c.from?.weekStartISO).toBe('2026-02-09');
    expect(c.ceiling).toBeCloseTo(baseCostOfWeek(DAVID_WEEKS[1]), 6);
    expect(c.ceiling).toBeCloseTo(66.705, 3);
    // And the PROPOSED side is on the same basis, which is the whole fix.
    expect(c.proposed).toBeCloseTo(ceilingCostOf(PEAK_WEEK, 'BASE_ONLY')!, 9);
    expect(c.proposed).toBeCloseTo(86.825, 3);
  });

  it('with context on every absorbed week it prices both sides in FULL', () => {
    const c = cmp(DAVID_WEEKS_IN_CONTEXT)!;
    expect(c.basis).toBe('FULL_CONTEXT');
    expect(c.withoutContext).toEqual([]);
    expect(c.considered).toBe(4);
    expect(c.proposed).toBeCloseTo(
      ceilingCostOf(PEAK_WEEK, 'FULL_CONTEXT')!, 9);
  });

  it('ONE absorbed week without context degrades the WHOLE comparison', () => {
    // Rule 11 at the ceiling. The alternative — drop the unreconstructable
    // week and keep FULL_CONTEXT for the rest — lowers the ceiling, and a
    // lower ceiling is the restrictive direction this model must not lean in.
    const mixed = [
      ...DAVID_WEEKS_IN_CONTEXT.slice(0, 3),
      { ...DAVID_WEEKS_IN_CONTEXT[3], context: null },
      ...DAVID_WEEKS_IN_CONTEXT.slice(4),
    ];
    const c = cmp(mixed)!;
    expect(c.basis).toBe('BASE_ONLY');
    expect(c.withoutContext).toEqual(['2026-02-23']);
    expect(c.reason).toMatch(/BOTH sides drop/);
  });

  it('a partly-reconstructed context still refuses, it does not price a zero', () => {
    // A context whose hard-day placement is unknown must NOT be read as "that
    // week had no stacking". That assumption is precisely what inflated the
    // ratio, and it is the one this branch exists to forbid.
    const halfKnown = DAVID_WEEKS_IN_CONTEXT.map((w) => (
      w.absorbed === true && w.context != null
        ? { ...w, context: { ...w.context, hardSessionDayOrdinals: null } }
        : w
    ));
    const c = cmp(halfKnown)!;
    expect(c.basis).toBe('BASE_ONLY');
    expect(c.withoutContext).toHaveLength(4);
  });

  it('a week he ran and did NOT absorb does not raise it', () => {
    const withBigUnabsorbed = cmp([
      ...DAVID_WEEKS,
      { weekStartISO: '2026-11-02', weeklyMi: 70, longRunMi: 22, qualityMinutes: 90, absorbed: false, context: null },
    ])!;
    expect(withBigUnabsorbed.ceiling).toBeCloseTo(66.705, 3);
  });

  it('a week NOBODY HAS JUDGED does not raise it either', () => {
    // PLAN_SIMPLIFICATION_DOCTRINE invariant 11: missing data may not silently
    // create a more aggressive plan, and a higher ceiling is exactly that.
    const withBigUnknown = cmp([
      ...DAVID_WEEKS,
      { weekStartISO: '2026-11-02', weeklyMi: 70, longRunMi: 22, qualityMinutes: 90, absorbed: null, context: null },
    ])!;
    expect(withBigUnknown.ceiling).toBeCloseTo(66.705, 3);
  });

  it('"did not look" and "looked and found none" are two different facts', () => {
    expect(cmp(null)).toBeNull();
    expect(cmp([])).toBeNull();
    const didNotLook = computeWeeklyDemand({ ...PEAK_WEEK, demonstratedWeeks: null });
    const foundNone = computeWeeklyDemand({ ...PEAK_WEEK, demonstratedWeeks: [] });
    expect(didNotLook.explain).toMatch(/No demonstrated weeks were supplied/);
    expect(foundNone.explain).toMatch(/No demonstrated week is marked as absorbed/);
    expect(didNotLook.atCeiling).toBeNull();
    expect(foundNone.atCeiling).toBeNull();
    expect(didNotLook.ceiling).toBeNull();
    expect(foundNone.ceiling).toBeNull();
  });

  it('is not very sensitive to the quality-minutes reconstruction', () => {
    // The pairings in DAVID_WEEKS are reconstructed. This measures how much of
    // the ceiling rests on that rather than pretending it does not.
    const lean = DAVID_WEEKS.map((w) => ({ ...w, qualityMinutes: 20 }));
    const rich = DAVID_WEEKS.map((w) => ({ ...w, qualityMinutes: 60 }));
    expect(cmp(lean)!.ceiling).toBeCloseTo(60.105, 3);
    expect(cmp(rich)!.ceiling).toBeCloseTo(73.305, 3);
    // Volume is 73% of the ceiling either way. The reconstruction moves it by
    // about a fifth across a three-fold change in assumed quality.
    expect(cmp(rich)!.ceiling! / cmp(lean)!.ceiling!).toBeLessThan(1.25);
  });

  it('is not very sensitive to the hard-day reconstruction either', () => {
    // The FULL_CONTEXT ceiling rests on an invented hard-day placement. This
    // measures that dependency across the whole plausible range rather than
    // hiding it: two hard days spread apart, versus three crowded together.
    const spread = DAVID_WEEKS_IN_CONTEXT.map((w) => (w.context == null ? w : {
      ...w, context: { ...w.context, hardSessionDayOrdinals: [0, 6] },
    }));
    const crowded = DAVID_WEEKS_IN_CONTEXT.map((w) => (w.context == null ? w : {
      ...w, context: { ...w.context, hardSessionDayOrdinals: [4, 5, 6] },
    }));
    const lo = cmp(spread)!.ceiling!;
    const hi = cmp(crowded)!.ceiling!;
    expect(cmp(spread)!.basis).toBe('FULL_CONTEXT');
    expect(hi).toBeGreaterThan(lo);
    // Worth stating plainly: this is the largest reconstruction dependency in
    // the file, larger than the quality-minutes one measured above.
    expect(hi / lo).toBeLessThan(1.30);
  });

  it('RULE 8 · a filtering caller drops two of these weeks, and it MATTERS', () => {
    // Said out loud rather than buried: the FULL_CONTEXT ceiling above comes
    // from the week of 2026-01-19, which starts ONE day after the Rose Bowl
    // half. Rule 8 says a post-race window is never his normal, so a caller
    // that has run `normal-window.ts` over this history would not have handed
    // that week over at all, nor 2026-02-09 (8 days after Disney). Both sit
    // inside the 14-day no-quality window `Research/00b` gives a half.
    //
    // This is a fixture defect the module cannot see and must not paper over,
    // so it is measured instead. The ceiling a properly-filtered caller gets
    // is materially lower, and the honest range is stated in both directions.
    const filtered = DAVID_WEEKS_IN_CONTEXT.filter((w) => {
      const r = w.context?.lastRace;
      return r == null || r === 'NONE' || r.daysSince > r.noQualityWindowDays;
    });
    expect(filtered.map((w) => w.weekStartISO))
      .toEqual(['2026-02-16', '2026-02-23', '2026-07-20', '2026-08-03']);
    const c = cmp(filtered)!;
    expect(c.basis).toBe('FULL_CONTEXT');
    expect(c.considered).toBe(2);
    expect(c.from?.weekStartISO).toBe('2026-02-16');
    expect(c.ceiling).toBeCloseTo(67.808, 3);
    expect(c.ratio!).toBeCloseTo(1.5446, 3);
    // The honest range for this runner's peak week, then: 126% to 154% on
    // FULL_CONTEXT depending on whether the two post-race weeks are admitted,
    // and 130% base-to-base. Every one of those is below the 157% the mixed
    // basis reported, which is the point — the defect could only inflate.
    const mixed = computeWeeklyDemand(PEAK_WEEK).demandIndex! / 66.705;
    expect(mixed).toBeCloseTo(1.5701, 3);
    expect(c.ratio!).toBeLessThan(mixed);
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

  it('and against his ceiling, LIKE FOR LIKE, that is 130% and not 157%', () => {
    // 157% was the mixed-basis reading: the proposed week's seven-component
    // index against a base-only ceiling. 140% was the half-fix, still mixed,
    // because the proposed base carried a long-run spike the historical base
    // had no anchor to compute. 130% is both sides on BASE_ONLY.
    const c = r.ceiling!;
    expect(c.basis).toBe('BASE_ONLY');
    expect(c.ceiling).toBeCloseTo(66.705, 3);
    expect(c.proposed).toBeCloseTo(86.825, 3);
    expect(c.ratio!).toBeCloseTo(1.3016, 3);
    expect(r.athleteCeiling).toBeCloseTo(66.705, 3);
    expect(r.atCeiling).toBe(true);
    // The old readings, kept here as the thing that must not come back.
    expect(r.demandIndex! / c.ceiling!).toBeCloseTo(1.5701, 3);
    expect(c.ratio!).toBeLessThan(r.demandIndex! / c.ceiling!);
  });

  it('and in FULL context on both sides it is 126%, off a ceiling of 83.09', () => {
    const rc = computeWeeklyDemand({
      ...PEAK_WEEK, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT,
    });
    const c = rc.ceiling!;
    expect(c.basis).toBe('FULL_CONTEXT');
    expect(c.ceiling).toBeCloseTo(83.09, 2);
    expect(c.from?.weekStartISO).toBe('2026-01-19');
    expect(c.proposed).toBeCloseTo(104.736, 2);
    expect(c.ratio!).toBeCloseTo(1.2605, 3);
    // Every ceiling this suite can compute is BELOW the old mixed reading,
    // in both directions of the basis choice. That is the defect's signature:
    // it could only ever inflate.
    expect(c.ratio!).toBeLessThan(rc.demandIndex! / 66.705);
  });

  it('the explain states which basis was used, on both branches', () => {
    expect(r.explain).toMatch(/Measured on the BASE_ONLY basis/);
    expect(r.explain).toMatch(/applied to BOTH sides by one function/);
    expect(r.explain).toMatch(/excluded from the proposed week too/);
    const rc = computeWeeklyDemand({
      ...PEAK_WEEK, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT,
    });
    expect(rc.explain).toMatch(/Measured on the FULL_CONTEXT basis/);
    expect(rc.explain).toMatch(/all six required components/);
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
    // The reading the owner said was not a demand model: weekly miles against
    // a ceiling. It sees 124% and stops. The demand model sees 130% and says
    // why, in seven components, on one basis for both sides.
    expect(60 / 48.5).toBeCloseTo(1.237, 3);
    expect(r.ceiling!.ratio!).toBeGreaterThan(60 / 48.5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7b · THE CALIBRATION WEEK
 *
 * A sane, unremarkable marathon week for this runner: 46 mi, an 18 mi long
 * run at his own recent longest, one quality session and the long run. It
 * exists so the model has a fixed point that a reader can hold against the
 * peak week, and so a future edit that quietly inflates everything by 20% has
 * something to fail on other than the week that was already contentious.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('WEEKLYDEMAND-1 · the 46 mi calibration week', () => {
  const CALIBRATION: WeeklyDemandInput = {
    ...PEAK_WEEK,
    weekStartISO: '2026-10-05',
    weeklyMi: 46,
    longRunMi: 18,
    qualityMinutes: 40,
    hardSessionDayOrdinals: [2, 6],   // two hard days, four days apart
    longestRunPrior30dMi: 18,         // at his recent longest: no spike
  };

  it('prices at 66.256, and its long run carries no spike at all', () => {
    const r = computeWeeklyDemand(CALIBRATION);
    expect(componentOf(r, 'volume').contribution).toBeCloseTo(46, 3);
    expect(componentOf(r, 'intensity').contribution).toBeCloseTo(13.2, 3);
    expect(componentOf(r, 'longRunLoad').contribution).toBeCloseTo(4.5, 3);
    expect(componentOf(r, 'longRunLoad').provenance).toBe('POLICY_ASSUMPTION');
    expect(componentOf(r, 'stacking').contribution).toBeCloseTo(2.548, 3);
    expect(componentOf(r, 'recentAdaptation').contribution).toBe(0);
    expect(componentOf(r, 'recovery').contribution).toBe(0);
    expect(r.demandIndex).toBeCloseTo(66.248, 3);
  });

  it('and sits at 95% of his ceiling, not over it', () => {
    const r = computeWeeklyDemand(CALIBRATION);
    expect(r.ceiling!.basis).toBe('BASE_ONLY');
    expect(r.ceiling!.proposed).toBeCloseTo(63.7, 3);
    expect(r.ceiling!.ceiling).toBeCloseTo(66.705, 3);
    expect(r.ceiling!.ratio!).toBeCloseTo(0.9550, 3);
    expect(r.atCeiling).toBe(false);
    // The peak week is a real step up from this one, and the like-for-like
    // comparison still says so — the fix removes an inflation, not the signal.
    const peak = computeWeeklyDemand(PEAK_WEEK);
    expect(peak.ceiling!.ratio!).toBeGreaterThan(r.ceiling!.ratio! * 1.3);
  });

  it('in FULL context it reads 77% of the same ceiling', () => {
    const r = computeWeeklyDemand({
      ...CALIBRATION, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT,
    });
    expect(r.ceiling!.basis).toBe('FULL_CONTEXT');
    expect(r.ceiling!.proposed).toBeCloseTo(66.248, 3);
    expect(r.ceiling!.ceiling).toBeCloseTo(83.09, 2);
    expect(r.ceiling!.ratio!).toBeCloseTo(0.7973, 3);
    expect(r.atCeiling).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · MIXEDBASIS-1 · THE TWO SIDES ARE COMPUTED THE SAME WAY
 *
 * The defect this section exists for, in one sentence: `demandIndex` summed
 * all seven components and the ceiling summed three, so every week with two
 * or more hard sessions was charged for its stacking while the week it was
 * measured against was not. Both sides legal, both sides arithmetically
 * correct, and the comparison meaningless — the exact shape Rule 9 says a
 * point-sampling gate cannot see, pointed at a ratio instead of a cliff.
 *
 * ── RULE 22 · WHAT THIS SECTION CANNOT FAIL ON ─────────────────────────────
 *
 *   · Whether FULL_CONTEXT or BASE_ONLY is the RIGHT basis for a given
 *     caller. It proves only that one basis is applied to both sides.
 *   · Whether the reconstructed contexts in `DAVID_WEEKS_IN_CONTEXT` are
 *     true. They are labelled as a reconstruction and their sensitivity is
 *     measured; the suite cannot check them against run history it has not
 *     got.
 *   · Whether a runner may be taken past his largest absorbed week at all.
 *     That is a coaching question and this module does not answer it.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('MIXEDBASIS-1 · one basis, both sides', () => {
  /**
   * THE FALSIFIER.
   *
   * A week identical in every field to a week he has already absorbed must
   * price at EXACTLY 100% of the ceiling. Under the mixed basis it read 141%,
   * because the proposed copy was charged three live context uplifts the
   * identical demonstrated week was not. No fixture, no reconstruction and no
   * argument about magnitudes enters: the two inputs are the same object, and
   * anything but 1.0 is the defect showing.
   */
  it('a week IDENTICAL to one he absorbed prices at exactly 100% of the ceiling', () => {
    const twin: DemonstratedWeek = {
      weekStartISO: '2026-02-09',
      weeklyMi: 48.5,
      longRunMi: 20.02,
      qualityMinutes: 40,
      absorbed: true,
      context: {
        hardSessionDayOrdinals: [2, 4, 6],
        longestRunPrior30dMi: 21,   // no spike: the point here is the four uplifts
        acwr: { acwr: 1.42, acute7: 8.5, chronic28: 6.0, coverageDays: 28, reason: null },
        lastRace: { daysSince: 4, noQualityWindowDays: 14 },
        weeksSinceLastCutback: 7,
      },
    };
    const proposed: WeekCostInput = demonstratedWeekAsInput(twin);
    const c = compareToAthleteCeiling(proposed, [twin])!;

    expect(c.basis).toBe('FULL_CONTEXT');
    expect(c.ratio).toBeCloseTo(1, 12);
    expect(c.proposed).toBe(c.ceiling);

    // And the twin is deliberately loaded: stacking, an elevated ACWR, a fresh
    // race and an overdue cutback all fire. Under the mixed basis those land on
    // the numerator alone and the same week reads 141% of itself.
    const priced = priceWeek(proposed);
    const mixed = priced.demandIndex! / baseCostOfWeek(twin);
    expect(mixed).toBeCloseTo(1.41, 3);
    expect(baseCostOfWeek(twin)).toBeCloseTo(66.705, 3);
  });

  it('an uplift on the PROPOSED week alone cannot move a BASE_ONLY ratio', () => {
    // Under the mixed basis, crowding the hard days of the proposed week
    // raised the ratio against an unchanged ceiling. On a stated basis it
    // cannot, because the basis is symmetric by construction.
    const spread = computeWeeklyDemand({ ...PEAK_WEEK, hardSessionDayOrdinals: [0, 3, 6] });
    const crowded = computeWeeklyDemand({ ...PEAK_WEEK, hardSessionDayOrdinals: [4, 5, 6] });
    expect(spread.ceiling!.basis).toBe('BASE_ONLY');
    expect(crowded.ceiling!.ratio).toBeCloseTo(spread.ceiling!.ratio!, 12);
    // The COST still moves. It is the comparison that must not.
    expect(crowded.demandIndex!).toBeGreaterThan(spread.demandIndex!);
  });

  it('on FULL_CONTEXT the same uplift moves both sides, not one', () => {
    const base = { ...PEAK_WEEK, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT };
    const spread = computeWeeklyDemand({ ...base, hardSessionDayOrdinals: [0, 3, 6] });
    const crowdedBoth = computeWeeklyDemand({
      ...base,
      hardSessionDayOrdinals: [4, 5, 6],
      demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT.map((w) => (w.context == null ? w : {
        ...w, context: { ...w.context, hardSessionDayOrdinals: [4, 5, 6] },
      })),
    });
    expect(crowdedBoth.ceiling!.ceiling!).toBeGreaterThan(spread.ceiling!.ceiling!);
    expect(crowdedBoth.ceiling!.proposed!).toBeGreaterThan(spread.ceiling!.proposed!);
  });

  it('`ceiling.proposed` is NOT `demandIndex` whenever context is live', () => {
    // Rule 16: two quantities, two names. The cost of the week includes the
    // uplifts; the like-for-like comparison does not, on either side.
    const r = computeWeeklyDemand(PEAK_WEEK);
    expect(r.demandIndex).toBeCloseTo(104.736, 2);
    expect(r.ceiling!.proposed).toBeCloseTo(86.825, 3);
    expect(r.ceiling!.proposed).not.toBeCloseTo(r.demandIndex!, 1);
  });

  it('injury is excluded from BOTH sides, not added to the proposed one', () => {
    // Injury is never reconstructable for a past week, so pricing it on the
    // proposed side alone would rebuild the defect in miniature.
    const clear = computeWeeklyDemand({
      ...PEAK_WEEK, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT, safety: SAFETY_CLEAR,
    });
    const hurt = computeWeeklyDemand({
      ...PEAK_WEEK, demonstratedWeeks: DAVID_WEEKS_IN_CONTEXT, safety: SAFETY_INJURED,
    });
    expect(hurt.demandIndex!).toBeGreaterThan(clear.demandIndex!);
    expect(hurt.ceiling!.proposed).toBeCloseTo(clear.ceiling!.proposed!, 12);
    expect(hurt.ceiling!.ratio).toBeCloseTo(clear.ceiling!.ratio!, 12);
  });

  it('every basis prices both sides through ceilingCostOf, and only there', () => {
    // Rule 18/20 pointed at the structure rather than at one number: a
    // behavioural test alone cannot catch a caller that stops going through
    // the shared function, which is the failure mode Rule 16 names.
    const src = readFileSync(path.join(__dirname, 'weekly-demand.ts'), 'utf8');
    expect((src.match(/export function ceilingCostOf/g) ?? [])).toHaveLength(1);
    const body = src.slice(
      src.indexOf('export function compareToAthleteCeiling'),
      src.indexOf('THE MODEL'),
    );
    expect(body.length).toBeGreaterThan(200);
    // Both sides, and nothing else, compute a comparable cost.
    expect((body.match(/ceilingCostOf\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(body).not.toMatch(/baseCostOfWeek\(/);
    // The removed shortcut stays removed: no declaration, and no call site.
    expect(src).not.toMatch(/function athleteCeilingFrom/);
    expect(src).not.toMatch(/athleteCeilingFrom\s*\(/);
    // ...and the note explaining WHY it was deleted rather than deprecated
    // survives, because a shortcut nobody remembers is one somebody re-adds.
    expect(src).toMatch(/`athleteCeilingFrom` IS GUARDED AS REMOVED/);
  });

  it('and the same two functions produce both sides for every basis', () => {
    for (const basis of ['BASE_ONLY', 'FULL_CONTEXT'] as const) {
      const weeks = basis === 'FULL_CONTEXT' ? DAVID_WEEKS_IN_CONTEXT : DAVID_WEEKS;
      const c = compareToAthleteCeiling(PEAK_WEEK, weeks)!;
      expect(c.basis).toBe(basis);
      expect(c.proposed).toBe(ceilingCostOf(PEAK_WEEK, basis));
      expect(c.ceiling).toBe(ceilingCostOf(demonstratedWeekAsInput(c.from!), basis));
    }
  });
});
