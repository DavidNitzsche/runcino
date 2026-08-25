/**
 * lib/training/_race_card.test.ts · the Races decision card, both axes.
 *
 * Walks all eight design-doc trigger values and asserts:
 *   1. The card shape matches the design contract's table exactly.
 *   2. No `fact` or `choice` card EVER emits a `safeTarget`/`stretchTarget`
 *      pair or an answer whose `action` is `take` (a target-naming answer).
 *   3. A `decision` card's safe/stretch targets, when present, always carry
 *      `modelled: true` — rule one, structurally, not by convention.
 *
 * That is the whole point of the trigger/verdict split
 * (`docs/faff-iphone-design-contract.md` §2): "A 'Take 3:16:45' button under
 * 'is it hot on race morning' answers a question nobody asked."
 */
import { describe, it, expect } from 'vitest';
import {
  composeRaceCard, buildDecisionCard, decisionTriggerForVerdict,
  heatFactCard, courseChangedFactCard, chipLockFactCard, twoARacesChoiceCard,
  collidingARacePair, A_RACE_COLLISION_DAYS,
  type V5DecisionCardOut,
} from './race-card';
import type { GoalAssessment, GoalFeasibility } from './goal-assessment';

function assessment(overrides: Partial<GoalAssessment>): GoalAssessment {
  return {
    distanceMi: 26.2188,
    goalSec: 3 * 3600 + 15 * 60,
    goalDateISO: '2026-12-06',
    weeksAvailable: 12,
    buildWeeks: 10,
    currentVdot: 48,
    currentEquivalentSec: 3 * 3600 + 20 * 60,
    requiredVdot: 50,
    requiredVdotRatePerWeek: 0.1,
    plausibleVdotRatePerWeek: { conservative: 0.1, max: 0.3 },
    feasibility: 'realistic',
    safeTargetSec: 3 * 3600 + 18 * 60,
    stretchTargetSec: 3 * 3600 + 10 * 60,
    reportAgainstSec: 3 * 3600 + 15 * 60,
    reportingAgainstSafeTarget: false,
    weeksToReach: null,
    statement: 'test statement',
    cautions: [],
    basis: 'projected',
    ...overrides,
  };
}

function assertNoSafeStretchOrTake(card: V5DecisionCardOut) {
  expect(card.safeTarget).toBeNull();
  expect(card.stretchTarget).toBeNull();
  for (const a of card.answers) {
    expect(a.action).not.toBe('take');
    expect(a.targetSec).toBeNull();
  }
}

describe('race-card · the eight design triggers', () => {
  // ── the four FACT/CHOICE triggers — never a decision shape, never a
  //    safe/stretch pair, never a target-naming answer ──────────────────
  it('race-morning heat → fact, no safe/stretch, no take', () => {
    const spec = heatFactCard('CIM', 78);
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec });
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('heat');
    assertNoSafeStretchOrTake(card);
    expect(card.answers.map(a => a.action).sort()).toEqual(['acknowledge', 'repace']);
  });

  it('course changed → fact, no safe/stretch, no take', () => {
    const spec = courseChangedFactCard('CIM');
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec });
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('course_changed');
    assertNoSafeStretchOrTake(card);
  });

  it('chip-time lock approaching → fact, no safe/stretch, no take', () => {
    const spec = chipLockFactCard('QA Tune-up 10K');
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec });
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('chip_lock');
    assertNoSafeStretchOrTake(card);
    expect(card.answers.map(a => a.action).sort()).toEqual(['confirm', 'leave']);
  });

  it('two A races conflicting → choice, no safe/stretch, no take', () => {
    const spec = twoARacesChoiceCard({ slug: 'cim', name: 'CIM' }, { slug: 'nyc', name: 'NYC Marathon' });
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec });
    expect(card.shape).toBe('choice');
    expect(card.trigger).toBe('two_a_races');
    assertNoSafeStretchOrTake(card);
    for (const a of card.answers) expect(a.action).toBe('choose_race');
    // each answer's id IS the race slug it targets, and both are unique
    expect(new Set(card.answers.map(a => a.id)).size).toBe(2);
  });

  // ── WHICH pair of A races is a conflict at all ────────────────────────
  //
  // David, 2026-08-25, on his phone: "needs a decision is coming up but makes
  // no sense. One is in December and one is in March." The detector asked
  // "are there two?" when the question is "do they collide?".
  describe('collidingARacePair', () => {
    const race = (slug: string, days: number) => ({ slug, name: slug.toUpperCase(), days });

    it("David's own pair — CIM 2026-12-06 and LA 2027-03-07 — is not a conflict", () => {
      // 103 and 194 days from 2026-08-25: thirteen weeks apart, a whole block.
      expect(collidingARacePair([race('cim', 103), race('la', 194)])).toBeNull();
    });

    it('two A races inside one block IS a conflict', () => {
      const pair = collidingARacePair([race('cim', 103), race('la', 145)]);
      expect(pair?.map(r => r.slug)).toEqual(['cim', 'la']);
    });

    it('one A race is never a conflict', () => {
      expect(collidingARacePair([race('cim', 103)])).toBeNull();
      expect(collidingARacePair([])).toBeNull();
    });

    it('names the colliding pair, not blindly the first two', () => {
      // No conflict between 10 and 120; a real one between 120 and 130.
      const pair = collidingARacePair([race('a', 10), race('b', 120), race('c', 130)]);
      expect(pair?.map(r => r.slug)).toEqual(['b', 'c']);
    });

    it('sorts by date first — the caller is not trusted to', () => {
      const pair = collidingARacePair([race('later', 60), race('sooner', 20)]);
      expect(pair?.map(r => r.slug)).toEqual(['sooner', 'later']);
    });

    it('the window is exclusive at the boundary', () => {
      // Exactly a block apart is exactly enough, so it is not a collision.
      expect(collidingARacePair([race('a', 0), race('b', A_RACE_COLLISION_DAYS)])).toBeNull();
      expect(collidingARacePair([race('a', 0), race('b', A_RACE_COLLISION_DAYS - 1)])).not.toBeNull();
    });
  });

  // ── the four DECISION triggers — verdict-driven, decision shape, and
  //    every safe/stretch value present carries modelled:true ────────────
  const decisionCases: Array<{ feasibility: GoalFeasibility; trigger: string | null; injury?: boolean }> = [
    { feasibility: 'comfortable', trigger: 'fitness_ahead' },
    { feasibility: 'realistic', trigger: 'fitness_ahead' },
    { feasibility: 'ambitious', trigger: 'fitness_behind' },
    { feasibility: 'aggressive', trigger: 'fitness_behind' },
    { feasibility: 'out-of-reach', trigger: 'fitness_behind' },
    { feasibility: 'unreadable', trigger: 'evidence_stale' },
    { feasibility: 'out-of-reach', trigger: 'returning_injury', injury: true },
    { feasibility: 'date-passed', trigger: 'returning_injury', injury: true },
  ];

  for (const c of decisionCases) {
    it(`${c.feasibility}${c.injury ? ' + returning from injury' : ''} → decision, trigger ${c.trigger}`, () => {
      const a = assessment({
        feasibility: c.feasibility,
        safeTargetSec: c.feasibility === 'unreadable' || c.feasibility === 'date-passed' ? null : 3 * 3600 + 18 * 60,
        stretchTargetSec: c.feasibility === 'unreadable' || c.feasibility === 'date-passed' ? null : 3 * 3600 + 10 * 60,
      });
      const card = composeRaceCard({ assessment: a, factOrChoice: null, returningFromInjury: !!c.injury });
      expect(card.shape).toBe('decision');
      expect(card.verdict).toBe(c.feasibility);
      expect(card.trigger).toBe(c.trigger);
      // safe/stretch, when present, are ALWAYS modelled — rule one.
      if (card.safeTarget) expect(card.safeTarget.modelled).toBe(true);
      if (card.stretchTarget) expect(card.stretchTarget.modelled).toBe(true);
    });
  }

  it('decisionTriggerForVerdict: out-of-reach WITHOUT an injury reads fitness_behind, not returning_injury', () => {
    expect(decisionTriggerForVerdict('out-of-reach', false)).toBe('fitness_behind');
    expect(decisionTriggerForVerdict('out-of-reach', true)).toBe('returning_injury');
  });

  it('unreadable and date-passed decision cards never fabricate a "Take X" answer', () => {
    for (const feasibility of ['unreadable', 'date-passed'] as GoalFeasibility[]) {
      const card = buildDecisionCard(assessment({ feasibility, safeTargetSec: null, stretchTargetSec: null }));
      expect(card.answers.some(a => a.action === 'take')).toBe(false);
      expect(card.safeTarget).toBeNull();
      expect(card.stretchTarget).toBeNull();
    }
  });

  it('comfortable/realistic offer the STRETCH number under "take"; behind-goal verdicts offer SAFE', () => {
    const ahead = buildDecisionCard(assessment({ feasibility: 'realistic' }));
    const takeAhead = ahead.answers.find(a => a.action === 'take')!;
    expect(takeAhead.targetSec).toBe(3 * 3600 + 10 * 60); // stretch

    const behind = buildDecisionCard(assessment({ feasibility: 'aggressive' }));
    const takeBehind = behind.answers.find(a => a.action === 'take')!;
    expect(takeBehind.targetSec).toBe(3 * 3600 + 18 * 60); // safe
  });

  it('a fact/choice trigger always wins the shape over the verdict, even an "ahead" verdict', () => {
    const spec = heatFactCard('CIM', 90);
    const card = composeRaceCard({ assessment: assessment({ feasibility: 'comfortable' }), factOrChoice: spec });
    expect(card.shape).toBe('fact');
    expect(card.verdict).toBe('comfortable'); // verdict still travels, unlike the shape
  });
});
