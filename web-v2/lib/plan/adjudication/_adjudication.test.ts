/**
 * ADJUDICATION-1 · the plan-adjudication layer, enforced.
 *
 * The point of this file is that the reasoning is IMPOSSIBLE TO SKIP, not that
 * it is documented somewhere. Every test below fails if a caller tries to reach
 * production without doing the thing.
 *
 * The fixtures are David's REAL demonstrated history, read from production on
 * 2026-09-04 and pinned here so this suite runs without a database:
 *
 *   peak completed week          47.5 mi  (2026-07-20)
 *   longest completed run        18.0 mi  (2026-07-25)
 *   largest COMPLETED MP dose     5   mi  (inside the 07-25 eighteen)
 *   most stressors in a week      2
 *   week after the 18-miler       4.2 mi against 52 prescribed
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): `expectedAbsorbed` is a labelled
 * HEURISTIC, so this suite cannot tell whether 0.70 is the right number for an
 * ALLOWED prescription. It can only tell whether the comparison was MADE and
 * whether the ranking is coherent. Calibrating those four numbers needs
 * outcomes we do not have yet, and pretending otherwise would be the same
 * "confident, well-formed, wrong" failure the layer exists to stop.
 */
import { describe, it, expect } from 'vitest';
import {
  athleteEvidenceFor, classifyStep, detectStackedStress, expectedAbsorbed,
  rankOptions, adjudicate, checkPromotion,
  type DemonstratedHistory, type PlannedWeek,
} from './adjudicate';
import type { DecisionTrace, DoctrineCitation, OptionAppraisal } from './contract';

/** David, measured. */
const DAVID: DemonstratedHistory = {
  peakWeeklyMi: 47.5,
  longestRunMi: 18.0,
  maxCompletedMpMi: 5,
  maxStressorsInAWeek: 2,
  after: [{
    dateISO: '2026-07-25',
    what: '18.00 mi long run — his longest of 2026',
    distanceMi: 18.0, avgPaceSecPerMi: 481, avgHrBpm: 155, executed: true,
    next7DaysMi: 4.2,
    notes: 'The plan asked 52 mi the following week. He ran 4.2 — three fragments '
      + 'inside thirty minutes on 08-01, then six days of nothing.',
  }],
};

/** The live 2026-10-26 week, exactly as authored today. */
const PEAK_WEEK: PlannedWeek = {
  weekStartISO: '2026-10-26',
  weeklyMi: 60.0,
  longestMi: 21.5,
  stressors: ['6 mi @ T', '9×3 min @ I', '21.5 mi long run'],
  mpMi: 0,
  isTaper: false,
  isRaceWeek: false,
};

describe('ADJUDICATION-1 · supported-for-him is not permitted-by-a-table', () => {
  it('a prescription at or under what he has done is SUPPORTED', () => {
    expect(classifyStep(18.0, 18.0).cls).toBe('SUPPORTED');
    expect(classifyStep(16.0, 18.0).cls).toBe('SUPPORTED');
  });

  it('an ordinary progression step is still SUPPORTED', () => {
    expect(classifyStep(19.5, 18.0).cls).toBe('SUPPORTED');   // +8.3%
  });

  it('a real reach is ALLOWED at best — a table permits it, he has not shown it', () => {
    expect(classifyStep(21.5, 18.0).cls).toBe('ALLOWED');     // +19.4%
  });

  it('a quantity he has never approached is CONDITIONAL and must be EARNED', () => {
    // The live preview's 11-22 proposal: 10 miles at marathon pace against a
    // demonstrated maximum of 5.
    const e = athleteEvidenceFor('a 10-mile marathon-pace block', 10, DAVID.maxCompletedMpMi, []);
    expect(e.evidenceClass).toBe('CONDITIONAL');
    expect(e.stepOverDemonstrated).toBeCloseTo(1.0, 2);       // +100%
    expect(e.why).toMatch(/never approached/);
    expect(e.why).toMatch(/EARNED/);
  });

  it('UNKNOWN is an absence, never a pass (Rule 11)', () => {
    expect(classifyStep(20, null).cls).toBe('UNKNOWN');
    expect(expectedAbsorbed('UNKNOWN')).toBeNull();
  });
});

describe('ADJUDICATION-1 · stacked stress is detected automatically', () => {
  it('THE WEEK NOTHING IN THIS REPO WAS CHECKING · 2026-10-26', () => {
    const s = detectStackedStress(PEAK_WEEK, DAVID);
    expect(s).not.toBeNull();
    expect(s!.simultaneousPeak).toBe(true);
    expect(s!.volumeOverDemonstratedMax).toBeCloseTo(0.263, 2);  // 60.0 vs 47.5
    expect(s!.longRunOverDemonstratedMax).toBeCloseTo(0.194, 2); // 21.5 vs 18.0
    expect(s!.why).toMatch(/Volume, longest run AND stressor count all peak in the same week/);
  });

  it('an ordinary two-stressor week at a sane volume is not flagged', () => {
    expect(detectStackedStress({
      ...PEAK_WEEK, weeklyMi: 46, longestMi: 17,
      stressors: ['5 mi @ T', '17 mi long run'],
    }, DAVID)).toBeNull();
  });

  it('one reach alone is a normal training decision, not a simultaneous peak', () => {
    const s = detectStackedStress({
      ...PEAK_WEEK, weeklyMi: 46, longestMi: 21.5, stressors: ['21.5 mi long run'],
    }, DAVID);
    expect(s).not.toBeNull();
    expect(s!.simultaneousPeak).toBe(false);
  });
});

describe('ADJUDICATION-1 · three options, and the default is to ADVANCE', () => {
  const push = (cls: Parameters<typeof expectedAbsorbed>[0]): OptionAppraisal => ({
    option: 'PUSH', describe: 'p', evidenceClass: cls, expectedAbsorbedFrac: expectedAbsorbed(cls), risk: '',
  });
  const hold: OptionAppraisal = {
    option: 'HOLD', describe: 'h', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: expectedAbsorbed('SUPPORTED'), risk: '',
  };
  const pull: OptionAppraisal = {
    option: 'PULL_BACK', describe: 'b', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: expectedAbsorbed('SUPPORTED'), risk: '',
  };

  it('A SUPPORTED PUSH WINS · the layer advances when the evidence is there', () => {
    // This is the direction that matters most. An adjudicator that always holds
    // is the disposition Rule 21 measured at zero upward adaptations.
    expect(rankOptions([hold, push('SUPPORTED'), pull])[0].option).toBe('PUSH');
  });

  it('a CONDITIONAL push loses to a supported hold — without anyone writing "be careful"', () => {
    // 1.0 × 0.50 = 0.50 against 0.85 × 0.95 = 0.81. The preference falls out of
    // expected adaptation, not out of a safety rule.
    expect(rankOptions([hold, push('CONDITIONAL'), pull])[0].option).toBe('HOLD');
  });

  it('and pulling back never wins on its own — it has to be earned too', () => {
    expect(rankOptions([hold, push('ALLOWED'), pull])[0].option).not.toBe('PULL_BACK');
  });
});

describe('ADJUDICATION-1 · doctrine conflicts are adjudicated, never cherry-picked', () => {
  const hard: DoctrineCitation = { source: 'Research/00a', section: '§spike', says: '>110% of the prior 30-day longest run', force: 'HARD_CONSTRAINT' };
  const guide: DoctrineCitation = { source: 'Research/22', section: '§marathon-int', says: 'peak long run 20-22 mi', force: 'GUIDELINE' };
  const alsoHard: DoctrineCitation = { source: 'Research/08', section: '§9.2', says: '10-12 mi at MP in the -3 week', force: 'HARD_CONSTRAINT' };

  it('a hard constraint beats a guideline, and says so', () => {
    const c = adjudicate(hard, guide);
    expect(c.resolvedInFavourOf).toBe(0);
    expect(c.because).toMatch(/HARD_CONSTRAINT/);
  });

  it('TWO HARD CONSTRAINTS WITH NO ADJUDICATION THROWS · this is the whole point', () => {
    // Picking whichever sentence supports the proposal already made is exactly
    // the failure this layer exists to stop, so it is not expressible.
    expect(() => adjudicate(hard, alsoHard)).toThrow(/no adjudication/);
    expect(() => adjudicate(hard, alsoHard)).toThrow(/agrees with the proposal already made/);
  });

  it('…and is fine once a reason is given', () => {
    expect(adjudicate(hard, alsoHard, 'the spike rule is about this week; §9.2 is about the block')
      .because).toMatch(/about this week/);
  });
});

/* ── THE PROMOTION GATE ─────────────────────────────────────────────────── */

function trace(over: Partial<DecisionTrace> = {}): DecisionTrace {
  return {
    decisionId: 'd1', dateISO: '2026-11-22', what: 'x', windowDays: 14,
    athlete: athleteEvidenceFor('x', 5, 5, []),
    stacked: null,
    options: [
      { option: 'PUSH', describe: '', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: 0.95, risk: '' },
      { option: 'HOLD', describe: '', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: 0.95, risk: '' },
      { option: 'PULL_BACK', describe: '', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: 0.95, risk: '' },
    ],
    chosen: 'PUSH', because: '', rejected: [], conflicts: [], citations: [],
    reassessOnISO: null,
    ...over,
  };
}

describe('ADJUDICATION-1 · the promotion gate BLOCKS, by name', () => {
  it('a coherent, athlete-supported set promotes', () => {
    const r = checkPromotion([trace()]);
    expect(r.mayPromote).toBe(true);
    expect(r.blockedBecause).toEqual([]);
  });

  it('BLOCKS an unsupported decision that is not marked for reassessment', () => {
    const r = checkPromotion([trace({
      decisionId: '11-22 · 10 mi @ M',
      athlete: athleteEvidenceFor('a 10-mile MP block', 10, 5, []),
    })]);
    expect(r.mayPromote).toBe(false);
    expect(r.check.athleteSpecificSupport).toBe(false);
    expect(r.blockedBecause.join(' ')).toMatch(/11-22 · 10 mi @ M/);
  });

  it('…and ALLOWS the same decision once it is conditional on evidence to come', () => {
    // Conditionality is not the problem. FIXING a distant high-load session
    // today, on evidence that does not exist yet, is.
    const r = checkPromotion([trace({
      athlete: athleteEvidenceFor('a 10-mile MP block', 10, 5, []),
      reassessOnISO: '2026-11-16',
    })]);
    expect(r.mayPromote).toBe(true);
  });

  it('BLOCKS a simultaneous-peak week that was pushed anyway', () => {
    const r = checkPromotion([trace({
      decisionId: '2026-10-26 peak week',
      stacked: detectStackedStress(PEAK_WEEK, DAVID),
      chosen: 'PUSH',
    })]);
    expect(r.mayPromote).toBe(false);
    expect(r.check.recoverability).toBe(false);
    expect(r.blockedBecause.join(' ')).toMatch(/peak in volume, long run AND stressor count/);
  });

  it('BLOCKS a decision that did not compare all three options', () => {
    const r = checkPromotion([trace({
      options: [{ option: 'PUSH', describe: '', evidenceClass: 'SUPPORTED', expectedAbsorbedFrac: 0.95, risk: '' }],
    })]);
    expect(r.mayPromote).toBe(false);
    expect(r.check.wholeBlockCoherence).toBe(false);
  });

  it('BLOCKS on nothing adjudicated at all — a silent zero is not a pass (Rule 18)', () => {
    const r = checkPromotion([]);
    expect(r.mayPromote).toBe(false);
    expect(r.blockedBecause.join(' ')).toMatch(/nothing was adjudicated at all/);
  });
});
