/**
 * Tests for lib/coach/acknowledge.ts · the acknowledge-what-you-asked
 * loop (coach-experience pass, 2026-08-17).
 *
 * Locks:
 *   · classifyEffortRead band boundaries (RPE 8 = wrecked, 6-7 = hard,
 *     chips + morning subjective equivalents)
 *   · the acknowledge-sentence matrix (deterministic per
 *     (yesterday category, band, today category))
 *   · subjectivePullbackSignal gating — PLANNED-EASY + actually-ran +
 *     WRECKED-equivalent post-run read ONLY. Quality/long days reading
 *     hard must NOT fire (that is the training); morning subjective
 *     alone must NOT fire (it has its own override in readiness-brief).
 *
 * Voice: every sentence asserted here is runner-facing · no citations,
 * no exclamation marks, no em dashes.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyEffortRead,
  categorizeWorkoutType,
  composeAcknowledgeSentence,
  acknowledgeSentenceFor,
  subjectivePullbackSignal,
  type YesterdaySignals,
} from './acknowledge';

const base: YesterdaySignals = {
  yesterdayISO: '2026-08-16',
  ranMi: 6.2,
  plannedType: 'easy',
  plannedLabel: null,
  rpe: null,
  checkinRating: null,
  checkinExecution: null,
  checkinBody: null,
  subjectiveRating: null,
};

describe('classifyEffortRead', () => {
  it('returns null with no subjective signal at all', () => {
    expect(classifyEffortRead(base)).toBeNull();
  });
  it('RPE 8 is wrecked · RPE 7 is hard · RPE 5 is solid', () => {
    expect(classifyEffortRead({ ...base, rpe: 8 })).toBe('wrecked');
    expect(classifyEffortRead({ ...base, rpe: 7 })).toBe('hard');
    expect(classifyEffortRead({ ...base, rpe: 5 })).toBe('solid');
  });
  it('rating wrecked / body cooked are WRECKED-equivalent', () => {
    expect(classifyEffortRead({ ...base, checkinRating: 'wrecked' })).toBe('wrecked');
    expect(classifyEffortRead({ ...base, checkinBody: 'cooked' })).toBe('wrecked');
  });
  it('struggling execution chips read hard, clean chips read solid', () => {
    expect(classifyEffortRead({ ...base, checkinExecution: 'pushed', checkinRating: 'tired' })).toBe('hard');
    expect(classifyEffortRead({ ...base, checkinExecution: 'walled' })).toBe('hard');
    expect(classifyEffortRead({ ...base, checkinExecution: 'chatty', checkinRating: 'solid', checkinBody: 'fresh' })).toBe('solid');
  });
  it('morning-after subjective ≤ 2/10 is WRECKED-equivalent', () => {
    expect(classifyEffortRead({ ...base, subjectiveRating: 2 })).toBe('wrecked');
    expect(classifyEffortRead({ ...base, subjectiveRating: 6 })).toBe('solid');
  });
});

describe('categorizeWorkoutType', () => {
  it('buckets plan types', () => {
    expect(categorizeWorkoutType('tempo')).toBe('quality');
    expect(categorizeWorkoutType('vo2max')).toBe('quality');
    expect(categorizeWorkoutType('long')).toBe('long');
    expect(categorizeWorkoutType('recovery')).toBe('easy');
    expect(categorizeWorkoutType('rest')).toBe('rest');
    expect(categorizeWorkoutType(null)).toBe('rest');
    expect(categorizeWorkoutType('race')).toBe('other');
  });
});

describe('composeAcknowledgeSentence matrix', () => {
  it('quality wrecked → easy today · the canonical example', () => {
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'quality', yesterdayName: 'tempo', band: 'wrecked', todayCategory: 'easy',
    })).toBe("You called yesterday's tempo a grind · today stays truly easy.");
  });
  it('quality wrecked → quality today asks for honesty, never re-prescribes', () => {
    const s = composeAcknowledgeSentence({
      yesterdayCategory: 'quality', yesterdayName: 'intervals', band: 'wrecked', todayCategory: 'quality',
    });
    expect(s).toBe("Yesterday's intervals took more than it should · be honest with the first reps today.");
  });
  it('easy wrecked names the mismatch and points at the morning call', () => {
    const s = composeAcknowledgeSentence({
      yesterdayCategory: 'easy', yesterdayName: 'easy day', band: 'wrecked', todayCategory: 'quality',
    });
    expect(s).toContain('easy day');
    expect(s).toContain("this morning's call");
  });
  it('long wrecked → absorb day', () => {
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'long', yesterdayName: 'long run', band: 'wrecked', todayCategory: 'rest',
    })).toBe('The long run took real work · today is about absorbing it, nothing more.');
  });
  it('hard quality → easy today frames payback', () => {
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'quality', yesterdayName: 'threshold', band: 'hard', todayCategory: 'easy',
    })).toBe("Yesterday's threshold cost something · today's easy miles pay it back.");
  });
  it('solid reads acknowledge cleanly per category', () => {
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'quality', yesterdayName: 'tempo', band: 'solid', todayCategory: 'easy',
    })).toBe("Yesterday's tempo landed and you came out clean · good sign.");
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'long', yesterdayName: 'long run', band: 'solid', todayCategory: 'easy',
    })).toBe('Long run banked and the body took it well.');
    expect(composeAcknowledgeSentence({
      yesterdayCategory: 'easy', yesterdayName: 'easy day', band: 'solid', todayCategory: 'quality',
    })).toBe("Yesterday's easy stayed easy · exactly right.");
  });
  it('voice · no em dashes, no exclamation marks, no citations, anywhere in the matrix', () => {
    const cats = ['quality', 'long', 'easy', 'other'] as const;
    const bands = ['wrecked', 'hard', 'solid'] as const;
    const todays = ['easy', 'quality', 'long', 'rest', 'other'] as const;
    for (const y of cats) for (const b of bands) for (const t of todays) {
      const s = composeAcknowledgeSentence({
        yesterdayCategory: y, yesterdayName: 'tempo', band: b, todayCategory: t,
      });
      expect(s).not.toMatch(/—|!|Research\//);
      expect(s.length).toBeGreaterThan(10);
    }
  });
});

describe('acknowledgeSentenceFor', () => {
  it('null when nothing was reported', () => {
    expect(acknowledgeSentenceFor(base, 'easy')).toBeNull();
  });
  it('uses the sub_label as the session name when short', () => {
    const s = acknowledgeSentenceFor(
      { ...base, plannedType: 'tempo', plannedLabel: 'Cruise Intervals', rpe: 9 },
      'easy',
    );
    expect(s).toBe("You called yesterday's cruise intervals a grind · today stays truly easy.");
  });
});

describe('subjectivePullbackSignal · adapter gating', () => {
  it('fires on RPE ≥ 8 on a planned-easy day that was run', () => {
    const r = subjectivePullbackSignal({ ...base, rpe: 8 });
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('RPE 8');
  });
  it('fires on body cooked / rating wrecked on a planned-easy day', () => {
    expect(subjectivePullbackSignal({ ...base, checkinBody: 'cooked' }).fired).toBe(true);
    expect(subjectivePullbackSignal({ ...base, checkinRating: 'wrecked' }).fired).toBe(true);
  });
  it('does NOT fire on a quality or long day — those are allowed to read hard', () => {
    expect(subjectivePullbackSignal({ ...base, plannedType: 'tempo', rpe: 9 }).fired).toBe(false);
    expect(subjectivePullbackSignal({ ...base, plannedType: 'long', checkinBody: 'cooked' }).fired).toBe(false);
  });
  it('does NOT fire when the day was not actually run', () => {
    expect(subjectivePullbackSignal({ ...base, ranMi: 0, rpe: 9 }).fired).toBe(false);
  });
  it('does NOT fire on RPE 7 (hard, not wrecked)', () => {
    expect(subjectivePullbackSignal({ ...base, rpe: 7 }).fired).toBe(false);
  });
  it('does NOT fire from the morning subjective rating alone — that signal has its own override', () => {
    expect(subjectivePullbackSignal({ ...base, subjectiveRating: 1 }).fired).toBe(false);
  });
  it('reason is plain English · no citations', () => {
    const r = subjectivePullbackSignal({ ...base, rpe: 9 });
    expect(r.reason).not.toMatch(/Research\/|—|!/);
  });

  it('rides readiness_pullback · one vote of several, never a vote on its own', async () => {
    // 2026-08-19 · the subjective pillar joins the convergence rule's evidence
    // as ONE DOMAIN of five. It used to be able to fire the trigger alone
    // (`subjectiveFired` was its own limb of a four-way OR); under the owner's
    // convergence ruling it cannot, and lib/coach/_convergence.test.ts proves
    // that for every domain including this one.
    //
    // The kind stays propose-first by default — an amber convergence is a
    // banner and touches nothing. Only a convergent-RED downgrade carries
    // `forceApplyNow`, which is the owner's "settled the night before".
    const { PROPOSE_FIRST_TRIGGERS } = await import('@/lib/plan/adapt');
    expect(PROPOSE_FIRST_TRIGGERS.has('readiness_pullback')).toBe(true);

    const { gradeConvergence } = await import('@/lib/coach/convergence');
    const v = gradeConvergence(
      {
        hrvLnRolling: Array.from({ length: 30 }, () => Math.log(60)),
        hrvLnBaseline: Math.log(60),
        hrvLnSd60d: 0.1,
        rhrDaily: Array.from({ length: 30 }, () => 48),
        rhrBaseline: 48,
        sleepNightly: Array.from({ length: 30 }, () => 8.2),
        acwrDaily: Array.from({ length: 30 }, () => 1.0),
        subjectiveWreckedOnEasy: true,
        baselineDays: 60,
        weeklyMpw: 45,
      },
      {
        daysToNextRace: null, daysSinceLastRace: null, postRaceWindowDays: 14,
        inPlannedCutback: false, illnessActive: false, daysSinceTravel: null,
        heatFlaggedDaysRecent: 0, alcoholLastNight: false,
      },
    );
    expect(v.converging).toEqual(['subjective']);
    expect(v.grade).toBe('green');
  });
});
