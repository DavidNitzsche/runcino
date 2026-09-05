/**
 * ADJUDICATION-WIRE-1 · THE GATE ON THE WIRING.
 *
 * `_adjudication.test.ts` next door proves the LAYER reasons correctly. This
 * file proves it is REACHED. Those are different claims and the second is the
 * one David asked for:
 *
 *   "Wire checkPromotion into the real plan-authoring and adaptation-promotion
 *    paths. Until that happens, this is a tested prototype, not a functioning
 *    brain safeguard."
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS GATE CANNOT FAIL ON (Rule 22)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Written down because Rule 22's finding is that a gate inherits the instinct
 * of whoever wrote it, and the honest list is longer than the covered one.
 *
 *   · WHETHER THE VERDICTS ARE RIGHT. It asserts the layer was consulted and
 *     that its refusals bind. Whether +19% on a demonstrated longest run
 *     SHOULD be ALLOWED rather than CONDITIONAL is `_adjudication.test.ts`'s
 *     question, and calibrating those bands needs outcomes nobody has.
 *   · EXECUTION QUALITY. The whole layer compares distances. A runner who
 *     survived 18 miles once and a runner who does them monthly are identical
 *     evidence to it, and nothing here can tell them apart.
 *   · PACE. No decision below is about how fast anything is prescribed.
 *   · A PROMOTION THAT DOES NOT GO THROUGH `tryAdaptiveBump`. There is no such
 *     path today (`_seal_single_seam.test.ts` GUARD 3 is what keeps it that
 *     way) but this file would not see one appear.
 *   · WHETHER THE BUMP GATE ACTUALLY RUNS IN PRODUCTION. It cannot, today: the
 *     seam is pinned false and `tryAdaptiveBump` returns above it. The call
 *     site is asserted STATICALLY, in the position `_seal_single_seam.test.ts`
 *     requires, and that is the strongest available claim about code that is
 *     deliberately unreachable.
 *   · THE TWO READINGS THE APP HAS NO READER FOR. `maxCompletedMpMi` and
 *     `maxStressorsInAWeek` are exempted with arguments; this file checks the
 *     arguments exist and are stale-checked, not that the gap is acceptable.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * WHICH CORPUS REACHES THE NEW CODE (Rule 15)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * MEASURED, not assumed, and the answer is uncomfortable, so it is stated
 * rather than buried:
 *
 *   · `_sweep_allusers.test.ts` (11,598 archetypes) and
 *     `_maint_invariants.test.ts` CANNOT reach any adjudication decision. They
 *     construct a `PlanValidationContext` with no `demonstratedHistory` — their
 *     `Arc` fixture type has no history fields at all, which is Rule 15's
 *     original finding verbatim — so every archetype lands in the ABSENT-
 *     HISTORY branch and is excused by the `fixture` entry. Adding archetypes
 *     would not help; the corpus cannot express a runner with a history.
 *   · THE CASE THAT DOES REACH IT is this file, and only this file. Every
 *     decision path below is driven from a `demonstratedHistory` built here
 *     from David's real pinned numbers.
 *
 * That is a real coverage gap and closing it means giving the sweep's `Arc` a
 * history, which is the same fix Rule 15 already prescribes for the four
 * mechanisms it found dark. It is not closed here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { validateComposedPlan, PlanValidationError } from '../validate';
import type { PlanValidationContext } from '../validate';
import type { ComposePlanResult, ComposedWeek, BlockPlan } from '../generate';
import { requiredSeparationDays } from '../validate';
import { extractLongSegments } from '../spec-builder';
import {
  adjudicatePlanBlock, plannedWeeksFromComposed,
  REFUSAL_NO_HISTORY, REFUSAL_UNKNOWN_QUANTITY, LONG_RUN_IS_A_STRESSOR_MI,
  type DemonstratedHistoryInput,
} from './from-plan';
import {
  ADJUDICATION_HISTORY_EXEMPTIONS, ADJUDICATION_QUANTITY_EXEMPTIONS,
  historyExemptionFor, UNNAMED_CALLER,
} from './caller-registry';
import { adjudicatePromotion, refusedForAbsentHistory } from './promotion';

const WEB = join(__dirname, '..', '..', '..');
const src = (rel: string): string => readFileSync(join(WEB, rel), 'utf8');
/** A claim about CODE must not be satisfied, or broken, by prose about it. */
const code = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · David's real demonstrated history, pinned
 * ═══════════════════════════════════════════════════════════════════════ */

/** The same numbers `_adjudication.test.ts` pins, read from production 2026-09-04. */
const DAVID: DemonstratedHistoryInput = {
  peakWeeklyMi: 47.5,
  longestRunMi: 18.0,
  maxCompletedMpMi: 5,
  maxStressorsInAWeek: 2,
  after: [],
  windowDescribed: 'pinned production readings, 2026-09-04',
};

/** Everything the two absent readers can answer, as production sees them. */
const DAVID_AS_PRODUCTION_SEES_HIM: DemonstratedHistoryInput = {
  ...DAVID, maxCompletedMpMi: null, maxStressorsInAWeek: null,
};

const TODAY = '2026-06-07';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const easyDay = (mi: number): any =>
  ({ dow: 1, type: 'easy', distanceMi: mi, isQuality: false, isLong: false, subLabel: 'EASY', notes: '' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const longDay = (mi: number, subLabel = 'LONG'): any =>
  ({ dow: 0, type: 'long', distanceMi: mi, isQuality: false, isLong: true, subLabel, notes: '' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const intervalDay = (mi = 6): any =>
  ({ dow: 2, type: 'intervals', distanceMi: mi, isQuality: true, isLong: false, subLabel: 'INTERVALS', notes: '' });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const thresholdDay = (mi = 6): any =>
  ({ dow: 4, type: 'threshold', distanceMi: mi, isQuality: true, isLong: false, subLabel: 'THRESHOLD', notes: '' });

function week(
  startISO: string, phase: string, weeklyMi: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  days: any[], isRaceWeek = false,
): ComposedWeek {
  return { startISO, phase, weeklyMi, days, isRaceWeek };
}

function blocks(): BlockPlan {
  return {
    totalWeeks: 5,
    phases: [
      { label: 'QUALITY', weeks: 2, rationale: '', citation: '' },
      { label: 'TAPER', weeks: 3, rationale: '', citation: '' },
    ],
  };
}

/**
 * A five-week marathon block whose taper is sized FROM the peak, so both
 * fixtures below satisfy the taper band whatever their week-1 volume is
 * (`Research/08` §9.1 · marathon 36-60% off peak; bottoming at 55% of peak is
 * a 45% drop, comfortably inside it at either size).
 *
 * That parameterisation is the point. The two fixtures differ ONLY in week 1,
 * so any difference in verdict is attributable to week 1 and to nothing else.
 */
function blockAround(weekOne: ComposedWeek, peakMi: number, longMi: number): ComposePlanResult {
  const weeks: ComposedWeek[] = [
    weekOne,
    week('2026-06-14', 'QUALITY', 40, [longDay(16), intervalDay(), easyDay(6), easyDay(6), easyDay(6)]),
    week('2026-06-21', 'TAPER', Math.round(peakMi * 0.75),
      [longDay(Math.min(14, longMi)), easyDay(5), easyDay(5), easyDay(6)]),
    week('2026-06-28', 'TAPER', Math.round(peakMi * 0.55),
      [longDay(10), easyDay(4), easyDay(4), easyDay(4)]),
    week('2026-07-05', 'TAPER', 12, [easyDay(4), easyDay(4), easyDay(4)], true),
  ];
  return { weeks, blocks: blocks(), totalWeeks: 5, vols: weeks.map((w) => w.weeklyMi), authoredState: {} };
}

/**
 * A block whose week 1 is inside everything he has done: 40 mi against a 47.5
 * peak week, a 16 mi long against an 18.0 longest, two stressors against two.
 */
function supportedBlock(): ComposePlanResult {
  return blockAround(
    week('2026-06-07', 'QUALITY', 40, [longDay(16), intervalDay(), easyDay(6), easyDay(6), easyDay(6)]),
    40, 16,
  );
}

/**
 * THE 2026-10-26 WEEK, transplanted to week 1: 60 mi, a 21.5 mi long run and
 * three named stressors, against a 47.5 mi peak week and an 18.0 mi longest
 * run. Every component is individually legal — 21.5 is inside the marathon
 * long-run cap, the doses fit Daniels' percentages, nothing collides — and
 * nothing in this repository except the adjudication asks what they cost
 * together. The test below proves that, rather than assuming it.
 */
function simultaneousPeakBlock(): ComposePlanResult {
  return blockAround(
    week('2026-06-07', 'QUALITY', 60, [
      longDay(21.5), intervalDay(9), thresholdDay(6), easyDay(8), easyDay(8), easyDay(7.5),
    ]),
    60, 21.5,
  );
}

const CTX = (over: Partial<PlanValidationContext> = {}): PlanValidationContext => ({
  level: 'advanced',
  isSteppingStoneToMarathon: false,
  priorPlanPeakLongMi: null,
  todayISO: TODAY,
  trailingAvgWeeklyMi: null,
  ...over,
});

/**
 * Validated against the MARATHON row on purpose. §1's long-run cap is 20 mi for
 * a half and 25 for a marathon, and the simultaneous-peak fixture below carries
 * a 21.5 mi long — so on the half row §1 would reject it and every assertion
 * about §12 would be measuring the wrong gate. The "and the SAME week passes
 * every other check" test is what proves that did not happen.
 */
function violationsOf(plan: ComposePlanResult, ctx: PlanValidationContext): string[] {
  try {
    validateComposedPlan(plan, 26.2, 'race-prep', ctx);
    return [];
  } catch (e) {
    if (e instanceof PlanValidationError) return e.violations;
    throw e;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * LIVENESS  ·  Rule 18 clause 2
 * ═══════════════════════════════════════════════════════════════════════ */

describe('LIVENESS · the scan opened real files and the fixture reaches §12', () => {
  const SCANNED = [
    'lib/plan/validate.ts',
    'lib/plan/generate.ts',
    'lib/plan/mutate.ts',
    'lib/plan/adaptive-ramp.ts',
    'app/api/plan/simulate/route.ts',
    'lib/plan/adjudication/from-plan.ts',
    'lib/plan/adjudication/caller-registry.ts',
    'lib/plan/adjudication/promotion.ts',
  ];

  it('every file this gate reasons about exists and is substantial', () => {
    let read = 0;
    for (const rel of SCANNED) {
      expect(existsSync(join(WEB, rel)), `${rel} is gone. This gate is asserting things `
        + 'about a file that does not exist, which is how a scanner reports clean on nothing.').toBe(true);
      expect(src(rel).length).toBeGreaterThan(500);
      read++;
    }
    expect(read, 'the scan read zero files').toBe(SCANNED.length);
  });

  it('and the fixture block genuinely reaches an adjudication decision', () => {
    // Without this, every behavioural assertion below could be passing because
    // the layer refused for a reason unrelated to what is being tested.
    const a = adjudicatePlanBlock({
      weeks: plannedWeeksFromComposed(supportedBlock().weeks, {
        mpMilesOf: () => 0,
        isRaceWeek: (w) => w.isRaceWeek === true,
      }),
      history: DAVID,
      todayISO: TODAY,
    });
    expect(a.traces.length, 'the fixture produced no decision traces, so nothing below '
      + 'is evidence about the adjudicator').toBeGreaterThan(0);
    expect(a.mayPromote).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §12 IS UNCONDITIONAL  ·  the `onDosing` lesson, enforced
 * ═══════════════════════════════════════════════════════════════════════ */

describe('§12 runs on every path · not an advisory sink', () => {
  it('validate.ts calls the adjudicator, and not behind an opts callback', () => {
    const v = code(src('lib/plan/validate.ts'));
    expect(v, 'validateComposedPlan no longer calls adjudicatePlanBlock. The layer is a '
      + 'prototype again.').toMatch(/adjudicatePlanBlock\(\{/);
    // The failure mode `onDosing` documents: a check nobody requests never runs.
    expect(v, 'the adjudication grew a callback. `onDosing`\'s own comment records what that '
      + 'costs: "no production caller ever passed the callback, so the check was declared and '
      + 'never ran." A gate that has to be requested is not a gate.')
      .not.toMatch(/opts[?.]*\.\s*onAdjudicat/i);
    expect(v, 'the adjudication became conditional on the caller supplying a history. That is '
      + 'the silent pass Rule 11 forbids: the refusal must be PRODUCED and then classified, '
      + 'never skipped.').not.toMatch(/if\s*\(\s*ctx\.demonstratedHistory\s*\)/);
  });

  it('the three production callers all NAME themselves', () => {
    // A production caller that stays silent inherits the `fixture` exemption,
    // which is the one soft edge in the registry. This is what bounds it.
    const sites: Array<{ rel: string; caller: string }> = [
      { rel: 'lib/plan/generate.ts', caller: 'plan/generate' },
      { rel: 'lib/plan/mutate.ts', caller: 'plan/mutate' },
      { rel: 'app/api/plan/simulate/route.ts', caller: 'api/plan/simulate' },
    ];
    for (const s of sites) {
      const c = code(src(s.rel));
      expect(c, `${s.rel} calls validateComposedPlan without naming itself. An anonymous `
        + 'production caller silently takes the fixture exemption and authors without being '
        + 'adjudicated.').toMatch(new RegExp(`adjudicationCaller:\\s*'${s.caller}'`));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * OUTCOME 1  ·  a real finding is FATAL, on every path, for every caller
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a real adjudication finding is fatal and cannot be exempted', () => {
  it('BLOCKS the simultaneous-peak week · the one nothing else in this repo checks', () => {
    const v = violationsOf(simultaneousPeakBlock(), CTX({
      adjudicationCaller: 'plan/generate',
      demonstratedHistory: DAVID_AS_PRODUCTION_SEES_HIM,
    }));
    expect(v.join(' ')).toMatch(/Adjudication ·/);
    expect(v.join(' ')).toMatch(/peak in volume, long run AND stressor count/);
  });

  it('…and the SAME week passes every other check in the file', () => {
    // Falsifies the alternative explanation. If §1 or §10 were what rejected
    // this block, the assertion above would be measuring the wrong gate.
    const v = violationsOf(simultaneousPeakBlock(), CTX({ adjudicationCaller: 'fixture' }));
    expect(v.filter((x) => !x.startsWith('Adjudication ·')),
      'a check other than §12 rejects the simultaneous-peak fixture, so the assertion above '
      + 'is not evidence about the adjudicator').toEqual([]);
  });

  it('an EXEMPT caller is still blocked by it · the allowlist cannot reach this branch', () => {
    for (const caller of ['plan/mutate', 'api/plan/simulate', 'fixture'] as const) {
      expect(historyExemptionFor(caller), `${caller} should be exempt for the fixture below `
        + 'to mean anything').not.toBeNull();
      const v = violationsOf(simultaneousPeakBlock(), CTX({
        adjudicationCaller: caller,
        demonstratedHistory: DAVID_AS_PRODUCTION_SEES_HIM,
      }));
      expect(v.join(' '), `${caller} escaped a REAL adjudication finding. The allowlist excuses `
        + 'an ABSENT HISTORY and nothing else.').toMatch(/peak in volume, long run AND stressor count/);
    }
  });

  it('a supported block is NOT blocked · the gate discriminates', () => {
    // Rule 22's own instruction. A gate that only ever refuses would pass an
    // engine that can only refuse, and this is the assertion that says it does
    // not simply reject everything it is shown.
    expect(violationsOf(supportedBlock(), CTX({
      adjudicationCaller: 'plan/generate',
      demonstratedHistory: DAVID_AS_PRODUCTION_SEES_HIM,
    }))).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * OUTCOME 2  ·  Rule 11 · an absent history is a RECORDED refusal
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 11 · "we could not look" never reads as "it passed"', () => {
  it('the layer REFUSES, by name, and names the absent inputs', () => {
    const a = adjudicatePlanBlock({
      weeks: plannedWeeksFromComposed(supportedBlock().weeks, {
        mpMilesOf: () => 0, isRaceWeek: (w) => w.isRaceWeek === true,
      }),
      history: null,
      todayISO: TODAY,
    });
    expect(a.mayPromote).toBe(false);
    expect(a.blockedBecause.length).toBeGreaterThan(0);
    const only = a.blockedBecause.join(' ');
    expect(only).toContain(REFUSAL_NO_HISTORY);
    for (const q of ['peakWeeklyMi', 'longestRunMi', 'maxCompletedMpMi', 'maxStressorsInAWeek']) {
      expect(only, `the refusal does not name ${q}. "Something was missing" is not a fact a `
        + 'reader can act on.').toContain(q);
    }
    // And the whole refusal carries the history prefix, so a caller cannot
    // mistake a symptom for an unexemptible finding.
    for (const b of a.blockedBecause) expect(b.startsWith(REFUSAL_NO_HISTORY)).toBe(true);
  });

  it('THE PRODUCTION AUTHORING PATH CANNOT AUTHOR WITHOUT ONE', () => {
    // The load-bearing assertion of this whole change.
    const v = violationsOf(supportedBlock(), CTX({ adjudicationCaller: 'plan/generate' }));
    expect(v.join(' ')).toContain(REFUSAL_NO_HISTORY);
  });

  it('and an all-null history is the same fact as no history at all', () => {
    const v = violationsOf(supportedBlock(), CTX({
      adjudicationCaller: 'plan/generate',
      demonstratedHistory: {
        peakWeeklyMi: null, longestRunMi: null, maxCompletedMpMi: null,
        maxStressorsInAWeek: null, after: [], windowDescribed: 'nothing was readable',
      },
    }));
    expect(v.join(' ')).toContain(REFUSAL_NO_HISTORY);
  });

  it('a MEASURED ZERO is not a refusal · the cold-start runner still gets a plan', () => {
    // `recentPeakWeeklyMileage` returns 0 for a runner with no runs, and that is
    // a real fact rather than a failed read. The layer reads it as UNKNOWN — an
    // honest absence — and does not block, because refusing to author for a
    // first-time runner because he has never run is not a safety property.
    const v = violationsOf(supportedBlock(), CTX({
      adjudicationCaller: 'plan/generate',
      demonstratedHistory: {
        peakWeeklyMi: 0, longestRunMi: 0, maxCompletedMpMi: null,
        maxStressorsInAWeek: null, after: [], windowDescribed: 'no runs on file',
      },
    }));
    expect(v).toEqual([]);
  });

  it('the exempt callers are excused from THIS refusal and are still adjudicated', () => {
    for (const caller of ['plan/mutate', 'api/plan/simulate', 'fixture'] as const) {
      expect(violationsOf(supportedBlock(), CTX({ adjudicationCaller: caller }))).toEqual([]);
    }
    // And an unnamed caller takes the fixture entry, which is the documented
    // soft edge the static scan above bounds.
    expect(UNNAMED_CALLER).toBe('fixture');
    expect(violationsOf(supportedBlock(), CTX())).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * OUTCOME 3  ·  one reading missing, per quantity
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 11 · a reading the app cannot take is recorded, not assumed', () => {
  it('names the absent quantity and what was searched', () => {
    const a = adjudicatePlanBlock({
      weeks: plannedWeeksFromComposed(supportedBlock().weeks, {
        mpMilesOf: () => 0, isRaceWeek: (w) => w.isRaceWeek === true,
      }),
      history: DAVID_AS_PRODUCTION_SEES_HIM,
      todayISO: TODAY,
    });
    expect(a.unknownQuantities).toContain('maxStressorsInAWeek');
    expect(a.blockedBecause.join(' ')).toContain(REFUSAL_UNKNOWN_QUANTITY);
    expect(a.blockedBecause.join(' '), 'the refusal does not say what was searched, so a reader '
      + 'cannot tell a gap from an oversight').toContain('pinned production readings');
  });

  it('a LONGEST-RUN read failure is fatal and has no exemption', () => {
    // `demonstratedLongMi` returns null ONLY when the read failed. It has no
    // entry in ADJUDICATION_QUANTITY_EXEMPTIONS and must not get one: authoring
    // a block off a history we could not read is the defect, not the check.
    const v = violationsOf(supportedBlock(), CTX({
      adjudicationCaller: 'plan/generate',
      demonstratedHistory: { ...DAVID_AS_PRODUCTION_SEES_HIM, longestRunMi: null },
    }));
    expect(v.join(' ')).toContain(REFUSAL_UNKNOWN_QUANTITY);
    expect(v.join(' ')).toContain('longestRunMi');
  });

  it('one unexplained gap makes the whole refusal stand', () => {
    expect(ADJUDICATION_QUANTITY_EXEMPTIONS['longestRunMi'],
      'longestRunMi acquired an exemption. It is the one demonstrated maximum this app CAN '
      + 'read, so a null there is a failed read and must refuse.').toBeUndefined();
    expect(ADJUDICATION_QUANTITY_EXEMPTIONS['peakWeeklyMi']).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE RATCHETS  ·  Rule 18 clause 4 · shrink only, stale entries fail
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the exemption allowlists are ratchets', () => {
  it('the production authoring path is NEVER exempt', () => {
    expect(
      ADJUDICATION_HISTORY_EXEMPTIONS['plan/generate'],
      'plan/generate has been given an absent-history exemption. That is the ONE path that '
      + 'authors a block a runner will actually run, and excusing it makes this whole change '
      + 'decorative. Supply the history instead.',
    ).toBeUndefined();
    expect(historyExemptionFor('plan/generate')).toBeNull();
  });

  it('every exemption is an argument, not a shrug', () => {
    for (const [k, why] of Object.entries(ADJUDICATION_HISTORY_EXEMPTIONS)) {
      expect(why!.length, `${k}'s exemption is too short to be an argument`).toBeGreaterThan(200);
    }
    for (const [k, why] of Object.entries(ADJUDICATION_QUANTITY_EXEMPTIONS)) {
      expect(why.length, `${k}'s exemption is too short to be an argument`).toBeGreaterThan(200);
      expect(why, `${k}'s exemption does not say what was searched`).toMatch(/lib\/|Nothing/);
    }
  });

  it('STALENESS · an exempt caller that starts supplying a history fails until deleted', () => {
    const files: Record<string, string> = {
      'plan/mutate': 'lib/plan/mutate.ts',
      'api/plan/simulate': 'app/api/plan/simulate/route.ts',
    };
    for (const [caller, rel] of Object.entries(files)) {
      if (ADJUDICATION_HISTORY_EXEMPTIONS[caller as keyof typeof ADJUDICATION_HISTORY_EXEMPTIONS] == null) continue;
      expect(
        code(src(rel)),
        `${rel} now passes demonstratedHistory, so its entry in ADJUDICATION_HISTORY_EXEMPTIONS `
        + 'is stale. Delete the entry — an exemption whose target is clean is how an allowlist '
        + 'quietly stops meaning anything (Rule 18).',
      ).not.toMatch(/demonstratedHistory\s*:/);
    }
  });

  it('STALENESS · a quantity exemption fails once generate.ts reads that quantity', () => {
    const g = code(src('lib/plan/generate.ts'));
    for (const q of Object.keys(ADJUDICATION_QUANTITY_EXEMPTIONS)) {
      expect(
        g,
        `lib/plan/generate.ts now supplies ${q} rather than null, so its entry in `
        + 'ADJUDICATION_QUANTITY_EXEMPTIONS is stale. Delete it.',
      ).toMatch(new RegExp(`${q}:\\s*null`));
    }
  });

  it('every quantity exemption names a quantity the layer can actually emit', () => {
    const a = adjudicatePlanBlock({
      weeks: plannedWeeksFromComposed(simultaneousPeakBlock().weeks, {
        mpMilesOf: () => 3, isRaceWeek: (w) => w.isRaceWeek === true,
      }),
      history: {
        peakWeeklyMi: 47.5, longestRunMi: 18, maxCompletedMpMi: null,
        maxStressorsInAWeek: null, after: [], windowDescribed: 'probe',
      },
      todayISO: TODAY,
    });
    // Both exempted names must be reachable, or the entries are excusing
    // something that can never happen.
    expect([...a.unknownQuantities].sort())
      .toEqual(['maxCompletedMpMi', 'maxStressorsInAWeek']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ONE QUANTITY, ONE NAME  ·  Rule 16
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 16 · the wiring re-derives nothing', () => {
  it('"a long run is a stressor" agrees with the separation ruling it quotes', () => {
    // `LONG_RUN_IS_A_STRESSOR_MI` claims to be the distance at which
    // `requiredSeparationDays` starts asking for more than one easy day. Read
    // it out of that function rather than hardcoding both sides (Rule 18).
    const below = requiredSeparationDays({
      type: 'long', isQuality: false, isLong: true,
      distanceMi: LONG_RUN_IS_A_STRESSOR_MI - 0.1, raceGoalPaceSec: null, longRunKind: null,
    });
    const at = requiredSeparationDays({
      type: 'long', isQuality: false, isLong: true,
      distanceMi: LONG_RUN_IS_A_STRESSOR_MI, raceGoalPaceSec: null, longRunKind: null,
    });
    expect(below.max, 'the separation ruling no longer changes at '
      + `${LONG_RUN_IS_A_STRESSOR_MI} mi, so the stressor threshold is quoting a rule that moved`)
      .toBe(1);
    expect(at.max).toBe(2);
  });

  it('the marathon-pace dose is read through spec-builder, not re-parsed', () => {
    const v = code(src('lib/plan/validate.ts'));
    expect(v, 'validate.ts stopped reading extractLongSegments for the MP dose. A second parser '
      + 'is a second chance to disagree about the dose with §10\'s dosing census.')
      .toMatch(/extractLongSegments\(subLabel\)/);
    expect(v).toMatch(/isRaceWeek:\s*\(w\)\s*=>\s*weekContainsRace\(w\)/);
  });

  it('an MP dose in a label reaches the layer', () => {
    const b = supportedBlock();
    b.weeks[0].days[0] = longDay(16, 'LONG · 10mi @ M');
    const weeks = plannedWeeksFromComposed(b.weeks, {
      // The real reader, wired the same way validate.ts wires it.
      mpMilesOf: (label) => extractLongSegments(label)
        .filter((x) => x.tag === 'M').reduce((a, x) => a + x.mi, 0),
      isRaceWeek: (w) => w.isRaceWeek === true,
    });
    expect(weeks[0].mpMi).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 · THE PROMOTION PATH
 * ═══════════════════════════════════════════════════════════════════════ */

describe('the promotion gate · wired where a promotion would land', () => {
  const SUPPORTED_POST_BUMP = {
    weekStartISO: '2026-06-07', weeklyMi: 44, longestMi: 17,
    stressors: ['6 mi threshold'], mpMi: 0, isTaper: false, isRaceWeek: false,
  };
  const OVERREACHING_POST_BUMP = {
    weekStartISO: '2026-06-07', weeklyMi: 62, longestMi: 21.5,
    stressors: ['6 mi threshold', '9 mi intervals', '21.5 mi long'],
    mpMi: 0, isTaper: false, isRaceWeek: false,
  };

  it('permits a bump the runner\'s own history supports', () => {
    const v = adjudicatePromotion({
      weekAfterPromotion: SUPPORTED_POST_BUMP, history: DAVID, todayISO: TODAY,
    });
    expect(v.ok, v.ok ? '' : v.because.join(' | ')).toBe(true);
  });

  it('REFUSES a bump that would push the week past what he has done', () => {
    const v = adjudicatePromotion({
      weekAfterPromotion: OVERREACHING_POST_BUMP, history: DAVID, todayISO: TODAY,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.because.join(' ')).toMatch(/peak in volume, long run AND stressor count/);
  });

  it('REFUSES on an absent history, and says that is why', () => {
    const v = adjudicatePromotion({
      weekAfterPromotion: SUPPORTED_POST_BUMP, history: null, todayISO: TODAY,
    });
    expect(v.ok).toBe(false);
    expect(refusedForAbsentHistory(v)).toBe(true);
  });

  it('the call site is in tryAdaptiveBump, AFTER the seam and BEFORE the write', () => {
    // The gate is unreachable today (the seam is pinned false), so this is the
    // strongest available claim about it. `_seal_single_seam.test.ts` GUARD 3
    // requires the seam check to be first; this requires the adjudication to
    // sit between it and applyAdaptations.
    const c = code(src('lib/plan/adaptive-ramp.ts'));
    const fn = c.indexOf('export async function tryAdaptiveBump');
    expect(fn, 'tryAdaptiveBump is gone or renamed').toBeGreaterThan(-1);
    const seam = c.indexOf('automaticPlanMutationIsAuthorised', fn);
    // The CALL, not the import. An earlier draft of this assertion searched for
    // the bare name and passed while the call had been replaced by a stub, on
    // the strength of the destructured import line above it. Rule 18: the gate
    // was falsified, did not fail, and was corrected.
    const adj = c.indexOf('adjudicateProposedBump({', fn);
    const apply = c.indexOf('applyAdaptations', fn);
    expect(adj, 'tryAdaptiveBump no longer consults the adjudication layer. It is the only '
      + 'upward lever in the engine and the only automatic path that can push a week past a '
      + 'verdict authoring already gave.').toBeGreaterThan(-1);
    expect(seam).toBeLessThan(adj);
    expect(adj).toBeLessThan(apply);
  });

  it('and the seam is still SHUT · this change enables nothing', () => {
    expect(
      code(src('lib/plan/adaptation-authority.ts')),
      'the adaptation seam was opened. Wiring a gate onto the promotion path is not a decision '
      + 'to promote, and these are two separate decisions the owner makes.',
    ).toMatch(/export const AUTOMATIC_ADAPTATION_AUTHORITY\s*:\s*false\s*=\s*false\s*;/);
  });

  it('the promotion gate writes nothing', () => {
    const p = code(src('lib/plan/adjudication/promotion.ts'));
    for (const verb of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+\w+\s+SET\b/i, /\bDELETE\s+FROM\b/i]) {
      expect(p, `the promotion gate performs a write (${verb}). It reads a plan to judge it.`)
        .not.toMatch(verb);
    }
    // Rule 14 · and it says which population it reads.
    expect(p).toMatch(/archived_iso IS NULL/);
  });
});
