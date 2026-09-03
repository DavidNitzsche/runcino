/**
 * lib/adaptation/canonical/_magnitude_bounds.test.ts · A PROPOSAL MAY NOT
 * EXCEED ITS OWN LIMIT, AND MAY NOT POINT THE WAY IT SAYS IT DOES NOT.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Replaying the engine against the owner's real training produced this record
 * on 2026-07-27:
 *
 *     lever      LONG_RUN
 *     decision   REGRESS
 *     magnitude  +1.5 long_run_mi   (limit 1, LONG_RUN_MAX_STEP_MI)
 *     reason     "The long run eases from 12 mi to 13.5 mi."
 *
 * An increase, labelled a regression, half a mile past the cap the record
 * itself names, under a sentence saying the opposite. Three defects in one row.
 *
 * `evaluate.ts` already computed `INV_WITHIN_LEVER_BOUND` and had already
 * marked that record `passed: false`. NOTHING READ IT. That is Rule 20 in its
 * purest form: the rule was written down, correctly, and was not in force,
 * because no check asserted it. Six test files and 171 cases were green over a
 * record the engine itself knew was invalid.
 *
 * So this file asserts the invariants rather than merely computing them, and it
 * asserts them across every lever and BOTH directions:
 *
 *   1 · |magnitude.value| <= |magnitude.limit|, for every moving decision
 *   2 · the magnitude describes the move from `beforeValue` to
 *       `proposedAfterValue`, so a record cannot carry a number unrelated to
 *       its own proposal
 *   3 · the sign agrees with the decision word, per unit — smaller seconds per
 *       mile is faster, larger miles is further
 *   4 · a HOLD or a REFUSE proposes nothing at all
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · Whether a limit is the RIGHT limit. It reads `magnitude.limit` out of the
 *   record, so a lever that named a limit of 100 miles would pass every case
 *   here. Binding those constants to the contract is a different check; this
 *   one asks only whether the engine obeys the bound it declares.
 * · Whether the DECISION was right. A wrong-but-well-formed REGRESS passes.
 *   The real replay is where that is asked.
 * · A lever branch no case below reaches. Coverage is asserted by liveness,
 *   which counts the moving verdicts actually produced and fails on too few,
 *   but it cannot know about a branch nobody wrote a case for.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation, directionOf } from './evaluate';
import { CANONICAL_LEVERS, measured } from './input';
import type { CanonicalDecisionRecord } from './decision-record';
import { NON_MOVING_DECISIONS } from './decision-record';
import {
  baseInput, session, week, longRun, threeGoodWeeks, twoGoodLongRuns,
  twoFasterThresholdSessions, THRESHOLD_ANCHOR_SEC,
} from './_fixtures';

/* ══════════════════════════════════════════════════════════════════════════
 * THE PREDICATES  ·  written once, used by both the corpus and the oracle
 * ═══════════════════════════════════════════════════════════════════════ */

type Checkable = {
  readonly lever: string;
  readonly decision: CanonicalDecisionRecord['decision'];
  readonly magnitude: CanonicalDecisionRecord['magnitude'];
  readonly beforeValue: number;
  readonly proposedAfterValue: number | null;
};

/** Invariant 1 · the movement never exceeds the bound the record names. */
export function withinBound(v: Checkable): boolean {
  if (v.magnitude === null) return true;
  return Math.abs(v.magnitude.value) <= Math.abs(v.magnitude.limit) + 1e-9;
}

/** Invariants 2, 3 and 4 · delegated to the engine's own resolver (Rule 16). */
const directionOk = (v: Checkable): boolean => directionOf(v).ok;

const describeFailure = (v: Checkable): string =>
  `${v.lever} ${v.decision} · `
  + (v.magnitude
    ? `${v.magnitude.value} ${v.magnitude.unit} (limit ${v.magnitude.limit}, ${v.magnitude.limitConstant})`
    : 'no magnitude')
  + ` · ${v.beforeValue} to ${v.proposedAfterValue}`;

/* ══════════════════════════════════════════════════════════════════════════
 * THE CORPUS  ·  every lever, both directions, real `evaluateAdaptation`
 * ═══════════════════════════════════════════════════════════════════════ */

const SEEN: CanonicalDecisionRecord[] = [];
const run = (input: Parameters<typeof evaluateAdaptation>[0]) => {
  const out = evaluateAdaptation(input);
  SEEN.push(...out.records);
  return out.records;
};

const anchoredAt = (sec: number) =>
  baseInput({ belief: { ...baseInput().belief, thresholdPaceSecPerMi: sec } });

const CASES: Array<{ name: string; input: Parameters<typeof evaluateAdaptation>[0] }> = [
  {
    name: 'threshold PROGRESS · two faster corroborating sessions',
    input: baseInput({ qualitySessions: twoFasterThresholdSessions() }),
  },
  {
    name: 'threshold PROGRESS · three FULL sessions unlock the larger step',
    input: baseInput({
      qualitySessions: [
        session('a', '2026-08-22', { workPaceSecPerMi: measured(410) }),
        session('b', '2026-08-27', { workPaceSecPerMi: measured(409) }),
        session('c', '2026-09-01', { workPaceSecPerMi: measured(408) }),
      ],
    }),
  },
  {
    name: 'threshold PROGRESS · evidence far past the bound is clipped to it',
    input: baseInput({
      qualitySessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(300) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(299) }),
      ],
    }),
  },
  {
    name: 'threshold REGRESS · two slower sessions',
    input: baseInput({
      qualitySessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(440) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(442) }),
      ],
    }),
  },
  {
    name: 'threshold REGRESS · evidence far past the bound is clipped to it',
    input: baseInput({
      qualitySessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(600) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(610) }),
      ],
    }),
  },
  {
    name: 'volume PROGRESS · three completed weeks',
    input: baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }),
  },
  {
    name: 'volume REGRESS · three missed weeks',
    input: baseInput({
      weeks: [week('2026-08-17', 47, 30), week('2026-08-24', 48, 31), week('2026-08-31', 48, 29)],
    }),
  },
  {
    name: 'volume REGRESS · a catastrophic window is still bounded by the step',
    input: baseInput({
      weeks: [week('2026-08-17', 47, 1), week('2026-08-24', 48, 1), week('2026-08-31', 48, 1)],
    }),
  },
  {
    name: 'long run PROGRESS · two completed long runs, with room in the week',
    // `nextWeekPrescribedMi` is raised because `longRunCoherent` caps the long
    // run at LONG_RUN_MAX_SHARE_OF_WEEK. At the fixture's 48 mi week, 16 + 1 is
    // 35.4% of the week and the lever correctly holds — which is a real branch,
    // and it is NOT the one this case is here to reach.
    input: baseInput({
      longRuns: twoGoodLongRuns(),
      plan: { ...baseInput().plan, nextWeekPrescribedMi: 58 },
    }),
  },
  {
    name: 'long run HOLD · the same evidence with no room in the week',
    input: baseInput({ longRuns: twoGoodLongRuns(), weeks: threeGoodWeeks() }),
  },
  {
    name: 'long run REGRESS · both short of the affected distance',
    input: baseInput({
      longRuns: [longRun('a', '2026-08-23', 18, 14.0), longRun('b', '2026-08-30', 18, 14.4)],
    }),
  },
  {
    name: 'long run · both short of a LARGER prescription than this week asks for',
    input: baseInput({
      plan: { ...baseInput().plan, nextWeekLongRunMi: 12 },
      longRuns: [longRun('a', '2026-07-19', 19, 18.0), longRun('b', '2026-07-26', 17, 9.09)],
    }),
  },
  {
    name: 'long run REGRESS · a catastrophic window is still bounded by the step',
    input: baseInput({
      longRuns: [longRun('a', '2026-08-23', 18, 2.0), longRun('b', '2026-08-30', 18, 1.5)],
    }),
  },
  {
    name: 'a week with no prescribed volume and no prescribed long run',
    input: baseInput({
      plan: { ...baseInput().plan, nextWeekPrescribedMi: 0, nextWeekLongRunMi: 0 },
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
    }),
  },
  {
    name: 'nothing at all · every lever refuses or holds',
    input: baseInput(),
  },
  {
    name: 'the read failed · every lever refuses',
    input: baseInput({ readable: false }),
  },
  {
    name: 'the anchor is already very fast',
    input: anchoredAt(360),
  },
];

for (const c of CASES) run(c.input);

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · LIVENESS  ·  Rule 18. A gate that scanned nothing must not report clean.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('liveness · the corpus actually produced moving proposals', () => {
  it('states how many records it read, and how many of them move', () => {
    const moving = SEEN.filter((r) => !NON_MOVING_DECISIONS.has(r.decision));
    // eslint-disable-next-line no-console
    console.log(`MAGNITUDE CORPUS · ${SEEN.length} records, ${moving.length} moving`);
    expect(SEEN.length).toBe(CASES.length * CANONICAL_LEVERS.length);
    // A bound check over zero bounded proposals is the "reported clean because
    // it looked at nothing" outcome Rule 18 calls the worst available.
    expect(moving.length, 'no proposal moved, so nothing was bounded').toBeGreaterThanOrEqual(8);
  });

  it('and it reaches BOTH directions on every lever · Rule 22', () => {
    for (const lever of CANONICAL_LEVERS) {
      const forLever = SEEN.filter((r) => r.lever === lever);
      const up = forLever.filter((r) => r.decision === 'PROGRESS').length;
      const down = forLever.filter((r) => r.decision === 'REGRESS').length;
      expect(up, `${lever} · no PROGRESS record, so the upward bound is unchecked`)
        .toBeGreaterThanOrEqual(1);
      expect(down, `${lever} · no REGRESS record, so the downward bound is unchecked`)
        .toBeGreaterThanOrEqual(1);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE INVARIANTS, ASSERTED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('|magnitude| <= limit, on every lever and in every direction', () => {
  it('no record exceeds the bound it names', () => {
    const bad = SEEN.filter((r) => !withinBound(r)).map(describeFailure);
    expect(bad).toEqual([]);
  });

  it('no record carries a magnitude that is not its own move', () => {
    const bad = SEEN
      .filter((r) => !NON_MOVING_DECISIONS.has(r.decision) && !directionOk(r))
      .map((r) => `${describeFailure(r)} · ${directionOf(r).detail}`);
    expect(bad).toEqual([]);
  });

  it('no REGRESS proposes an increase and no PROGRESS proposes a decrease', () => {
    for (const r of SEEN) {
      if (NON_MOVING_DECISIONS.has(r.decision)) continue;
      const m = r.magnitude!;
      // Smaller seconds per mile is FASTER; larger miles is FURTHER.
      const improves = m.unit === 'sec_per_mi' ? m.value < 0 : m.value > 0;
      expect(improves, describeFailure(r)).toBe(r.decision === 'PROGRESS');
    }
  });

  it('a HOLD or a REFUSE proposes nothing', () => {
    for (const r of SEEN) {
      if (!NON_MOVING_DECISIONS.has(r.decision)) continue;
      expect(r.magnitude, describeFailure(r)).toBeNull();
      expect(r.proposedAfterValue, describeFailure(r)).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · THE INVARIANT LIST THE ENGINE ITSELF EMITS
 *
 * The record carries `invariants`, and until this file nothing asserted them.
 * A computed `passed: false` that nobody reads is not an invariant.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('every invariant the record computes is asserted, not merely recorded', () => {
  it('no record ships with a failed invariant', () => {
    const failures = SEEN.flatMap((r) => r.invariants
      .filter((i) => !i.passed)
      .map((i) => `${r.lever} ${r.decision} · ${i.id} · ${i.detail}`));
    expect(failures).toEqual([]);
  });

  // The WHOLE-INPUT refusal — `readable: false` — is the one record shape that
  // carries no invariants, and that is correct rather than exempted: it never
  // reaches a lever, so there is no verdict to bound and no proposal whose
  // direction could disagree with anything. It is asserted separately below
  // rather than waved through, because an untested exemption is how a gate
  // stops meaning anything (Rule 18).
  it('and both bound invariants are present on every record a lever produced', () => {
    const fromLevers = SEEN.filter((r) => r.invariants.length > 0);
    expect(fromLevers.length, 'no record carried invariants at all')
      .toBe((CASES.length - 1) * CANONICAL_LEVERS.length);
    for (const r of fromLevers) {
      const ids = r.invariants.map((i) => i.id);
      expect(ids, `${r.lever} ${r.decision}`).toContain('INV_WITHIN_LEVER_BOUND');
      expect(ids, `${r.lever} ${r.decision}`).toContain('INV_DIRECTION_MATCHES_DECISION');
    }
  });

  it('the failed-read refusal carries no invariants, and no proposal either', () => {
    const failed = evaluateAdaptation(baseInput({ readable: false })).records;
    expect(failed.length).toBe(CANONICAL_LEVERS.length);
    for (const r of failed) {
      expect(r.decision).toBe('REFUSE');
      expect(r.invariants).toEqual([]);
      expect(r.magnitude).toBeNull();
      expect(r.proposedAfterValue).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · FALSIFICATION  ·  Rule 18. Every predicate is made to fail on purpose.
 *
 * The 2026-07-27 record is reconstructed verbatim as the second case, so this
 * gate is demonstrated against the defect it was written for rather than
 * against an abstraction.
 * ═══════════════════════════════════════════════════════════════════════ */

describe('ORACLE · each predicate is shown failing on a planted violation', () => {
  const planted = (o: Partial<Checkable>): Checkable => ({
    lever: 'LONG_RUN',
    decision: 'REGRESS',
    magnitude: {
      unit: 'long_run_mi',
      value: -1,
      limit: 1,
      limitConstant: 'LONG_RUN_MAX_STEP_MI',
      limitCitation: 'test',
    },
    beforeValue: 12,
    proposedAfterValue: 11,
    ...o,
  });

  it('the well-formed control passes every predicate', () => {
    const ok = planted({});
    expect(withinBound(ok)).toBe(true);
    expect(directionOk(ok)).toBe(true);
  });

  it('THE REAL DEFECT · the 2026-07-27 record fails both predicates', () => {
    // Verbatim: REGRESS, +1.5 long_run_mi against a limit of 1, 12 mi to 13.5.
    const real = planted({
      magnitude: {
        unit: 'long_run_mi',
        value: 1.5,
        limit: 1,
        limitConstant: 'LONG_RUN_MAX_STEP_MI',
        limitCitation: 'test',
      },
      proposedAfterValue: 13.5,
    });
    expect(withinBound(real), 'the bound check must see +1.5 against a limit of 1').toBe(false);
    expect(directionOk(real), 'the direction check must see a REGRESS raising a value').toBe(false);
  });

  it('a magnitude inside its bound but pointing the wrong way is still caught', () => {
    // The half-mile version the bound check alone could NOT have seen.
    const subtle = planted({
      magnitude: {
        unit: 'long_run_mi',
        value: 0.5,
        limit: 1,
        limitConstant: 'LONG_RUN_MAX_STEP_MI',
        limitCitation: 'test',
      },
      proposedAfterValue: 12.5,
    });
    expect(withinBound(subtle), 'inside the bound').toBe(true);
    expect(directionOk(subtle), 'and still the wrong direction').toBe(false);
  });

  it('a threshold PROGRESS that makes the anchor SLOWER is caught', () => {
    // Seconds per mile invert, so this is the sign trap the unit exists for.
    const slower = planted({
      lever: 'THRESHOLD_PACE',
      decision: 'PROGRESS',
      magnitude: {
        unit: 'sec_per_mi',
        value: 3,
        limit: 3,
        limitConstant: 'THRESHOLD_ORDINARY_STEP_SEC_PER_MI',
        limitCitation: 'test',
      },
      beforeValue: THRESHOLD_ANCHOR_SEC,
      proposedAfterValue: THRESHOLD_ANCHOR_SEC + 3,
    });
    expect(withinBound(slower)).toBe(true);
    expect(directionOk(slower)).toBe(false);
  });

  it('a threshold REGRESS that makes the anchor FASTER is caught', () => {
    const faster = planted({
      lever: 'THRESHOLD_PACE',
      decision: 'REGRESS',
      magnitude: {
        unit: 'sec_per_mi',
        value: -3,
        limit: 3,
        limitConstant: 'THRESHOLD_ORDINARY_STEP_SEC_PER_MI',
        limitCitation: 'test',
      },
      beforeValue: THRESHOLD_ANCHOR_SEC,
      proposedAfterValue: THRESHOLD_ANCHOR_SEC - 3,
    });
    expect(directionOk(faster)).toBe(false);
  });

  it('a magnitude unrelated to its own before and after is caught', () => {
    expect(directionOk(planted({ proposedAfterValue: 4 }))).toBe(false);
  });

  it('a HOLD carrying a proposal is caught', () => {
    expect(directionOk(planted({ decision: 'HOLD' }))).toBe(false);
  });

  it('a moving decision carrying NO magnitude is caught', () => {
    expect(directionOk(planted({ magnitude: null }))).toBe(false);
  });

  it('a weekly-volume PROGRESS that lowers the week is caught', () => {
    expect(directionOk(planted({
      lever: 'WEEKLY_VOLUME',
      decision: 'PROGRESS',
      magnitude: {
        unit: 'weekly_mi',
        value: -2.4,
        limit: 2.4,
        limitConstant: 'VOLUME_MAX_STEP_FRAC',
        limitCitation: 'test',
      },
      beforeValue: 48,
      proposedAfterValue: 45.6,
    }))).toBe(false);
  });
});
