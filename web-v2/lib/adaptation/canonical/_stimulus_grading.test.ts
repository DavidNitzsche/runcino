/**
 * lib/adaptation/canonical/_stimulus_grading.test.ts · FIVE OUTCOMES, SEVEN
 * CONDITIONS, ONE NOISY CHANNEL.
 *
 * Every case runs the REAL `gradeStimulus`. Nothing is mocked.
 *
 * ── RULE 22 · THE DISTRIBUTION, STATED UP FRONT ────────────────────────────
 *
 * The failure this file is written against is a suite that only knows how to
 * withhold credit. So the cases are counted per outcome at the bottom and the
 * count is ASSERTED, not just reported: every one of the five grades must have
 * at least two cases, and FULL and SUBSTANTIAL together must not be
 * outnumbered more than two to one by the three non-crediting grades.
 *
 * Without that assertion a future contributor could add nine more INSUFFICIENT
 * cases and leave the crediting paths exactly as thin as they were, which is
 * how 29 files came to know how to hold a runner back and 2 to accelerate one.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · Whether the grade a coach would give matches the grade the rules produce.
 *   Every case here asserts the RULES were followed, not that the verdict is
 *   wise. The replay ledger is where that question is asked.
 * · A wrong upstream segmentation. Condition 7 is a flag this file trusts.
 * · The tolerance constants themselves. Cases sit clearly inside or outside
 *   the bands, so moving 3% to 4% would not fail anything here.
 */
import { describe, it, expect } from 'vitest';
import { gradeStimulus, type StimulusInput, type StimulusGrade } from './stimulus';
import { measured, absent } from './input';

/** A session that meets every one of the seven conditions. */
const clean = (o?: Partial<StimulusInput>): StimulusInput => ({
  prescribedWorkSeconds: 1200,
  completedWorkSeconds: measured(1200),
  prescribedSegments: 4,
  acceptableSegments: measured(4),
  targetWorkPaceSecPerMi: 430,
  actualWorkPaceSecPerMi: measured(429),
  meanWorkHrBpm: measured(168),
  hrCeilingBpm: measured(172),
  hrReliable: true,
  majorLateCollapse: measured(false),
  prescribedRecoverySeconds: 240,
  actualRecoverySeconds: measured(240),
  dataCompleteAndSegmented: true,
  paceDiscountFlags: [],
  ...o,
});

const seen: StimulusGrade[] = [];
const grade = (i: StimulusInput): StimulusGrade => {
  const g = gradeStimulus(i).grade;
  seen.push(g);
  return g;
};

describe('FULL · the work was done as prescribed', () => {
  it('every condition met', () => {
    expect(grade(clean())).toBe('FULL');
  });

  it('faster than target, controlled, HR under the ceiling', () => {
    // The doctrine's Example A: 6:49/6:48/6:47/6:45 at controlled HR.
    expect(grade(clean({ actualWorkPaceSecPerMi: measured(421) }))).toBe('FULL');
  });
});

describe('SUBSTANTIAL · conditions explain it, the stimulus survived', () => {
  it('heat slowed the pace, HR and structure support the session', () => {
    const g = grade(clean({
      actualWorkPaceSecPerMi: measured(450),
      paceDiscountFlags: ['HEAT_WITHOUT_SUPPORTED_ADJUSTMENT'],
    }));
    expect(g).toBe('SUBSTANTIAL');
    expect(gradeStimulus(clean({
      actualWorkPaceSecPerMi: measured(450),
      paceDiscountFlags: ['HEAT_WITHOUT_SUPPORTED_ADJUSTMENT'],
    })).discountedChannel).toBe('PACE');
  });

  it('the HR strap failed, but pace was on target and the work complete', () => {
    const g = grade(clean({ hrReliable: false, meanWorkHrBpm: absent('no strap') }));
    expect(g).toBe('SUBSTANTIAL');
  });
});

describe('PARTIAL · a meaningful portion missed, stated without scolding', () => {
  it('only 70% of the prescribed work duration', () => {
    expect(grade(clean({ completedWorkSeconds: measured(840) }))).toBe('PARTIAL');
  });

  it('GUARD · HR in range must not validate a substantially underperformed session', () => {
    // Q12's first failure sentence. HR sits perfectly inside the band and only
    // half the work happened. If this returns anything crediting, the engine
    // will treat half a session as evidence a lever should move.
    const g = grade(clean({
      completedWorkSeconds: measured(600),
      acceptableSegments: measured(2),
      meanWorkHrBpm: measured(168),
      actualWorkPaceSecPerMi: measured(429),
    }));
    expect(g).toBe('PARTIAL');
  });

  it('the sentence never scolds', () => {
    const a = gradeStimulus(clean({ completedWorkSeconds: measured(840) }));
    expect(a.reason).toBe(
      'You completed useful work, but not enough of the intended session to receive the full training effect.',
    );
    expect(a.reason).not.toMatch(/should have|failed|only managed/i);
  });
});

describe('DIFFERENT · it became another workout, which is not failure', () => {
  it('GUARD · pace in range must not validate clearly excessive effort', () => {
    // Q12's second failure sentence. The doctrine's Example B in HR terms.
    const g = grade(clean({ meanWorkHrBpm: measured(182), hrCeilingBpm: measured(172) }));
    expect(g).toBe('DIFFERENT');
  });

  it('recoveries stretched far enough to change the workout', () => {
    expect(grade(clean({ actualRecoverySeconds: measured(400) }))).toBe('DIFFERENT');
  });

  it('slower than target with the work complete and HR low is an easier session', () => {
    // Not SUBSTANTIAL. Nothing explains the slower pace and the body was not
    // working harder, so calling it substantial is how an easy day becomes
    // threshold evidence.
    const g = grade(clean({
      actualWorkPaceSecPerMi: measured(460),
      meanWorkHrBpm: measured(150),
    }));
    expect(g).toBe('DIFFERENT');
  });
});

describe('INSUFFICIENT · never translated into a bad workout', () => {
  it('data incomplete or wrongly segmented', () => {
    expect(grade(clean({ dataCompleteAndSegmented: false }))).toBe('INSUFFICIENT');
  });

  it('BOTH channels noisy is an absence of evidence, not one noisy channel', () => {
    const g = grade(clean({
      hrReliable: false,
      paceDiscountFlags: ['TRAIL'],
    }));
    expect(g).toBe('INSUFFICIENT');
  });

  it('the work denominator itself could not be read', () => {
    expect(grade(clean({ completedWorkSeconds: absent('no duration') }))).toBe('INSUFFICIENT');
  });

  it('the sentence names the missing data and makes no judgement', () => {
    const a = gradeStimulus(clean({ dataCompleteAndSegmented: false }));
    expect(a.reason).toBe('There is not enough reliable information to judge the workout.');
    expect(a.limiting).toContain('C7_DATA_COMPLETE');
  });
});

describe('the seven conditions are all evaluated and all reported', () => {
  it('every call returns a verdict for each of the seven', () => {
    const a = gradeStimulus(clean());
    expect(a.conditions.map((c) => c.id).sort()).toEqual([
      'C1_WORK_DURATION',
      'C2_SEGMENTS_ACCEPTABLE',
      'C3_WORK_PACE',
      'C4_HR_COMPATIBLE',
      'C5_NO_LATE_COLLAPSE',
      'C6_RECOVERIES_INTACT',
      'C7_DATA_COMPLETE',
    ]);
  });

  it('an unreadable condition is UNREADABLE, never NOT_MET', () => {
    // Rule 11 · a missing strap is not a failed workout.
    const a = gradeStimulus(clean({
      majorLateCollapse: absent('no late data'),
    }));
    const c5 = a.conditions.find((c) => c.id === 'C5_NO_LATE_COLLAPSE')!;
    expect(c5.verdict).toBe('UNREADABLE');
    expect(c5.verdict).not.toBe('NOT_MET');
  });

  it('a discounted channel is DISCOUNTED, distinct from both', () => {
    const a = gradeStimulus(clean({ paceDiscountFlags: ['TRAIL'] }));
    expect(a.conditions.find((c) => c.id === 'C3_WORK_PACE')!.verdict).toBe('DISCOUNTED');
  });
});

describe('RULE 22 · the distribution of this suite across the five outcomes', () => {
  it('every grade is exercised, and the crediting paths are not outnumbered', () => {
    const count = (g: StimulusGrade) => seen.filter((s) => s === g).length;
    const dist = {
      FULL: count('FULL'),
      SUBSTANTIAL: count('SUBSTANTIAL'),
      PARTIAL: count('PARTIAL'),
      DIFFERENT: count('DIFFERENT'),
      INSUFFICIENT: count('INSUFFICIENT'),
    };
    // eslint-disable-next-line no-console
    console.log('STIMULUS CASE DISTRIBUTION', JSON.stringify(dist));

    for (const [g, n] of Object.entries(dist)) {
      expect(n, `${g} has ${n} cases`).toBeGreaterThanOrEqual(2);
    }

    const crediting = dist.FULL + dist.SUBSTANTIAL;
    const withholding = dist.PARTIAL + dist.DIFFERENT + dist.INSUFFICIENT;
    expect(
      withholding / crediting,
      `withholding ${withholding} vs crediting ${crediting}`,
    ).toBeLessThanOrEqual(2);
  });
});
