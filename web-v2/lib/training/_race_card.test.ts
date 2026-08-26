/**
 * lib/training/_race_card.test.ts · the Races card.
 *
 * 2026-08-26 · a pure `assessGoal()` verdict (no discrete trigger) no longer
 * produces a card at all — `composeRaceCard` returns `null` unless one of
 * the four real fact/choice triggers fired. See `race-card.ts`'s own header
 * for the full "we don't need ANY of this" removal. What remains to test:
 *   1. The four fact/choice triggers still compose to the right shape.
 *   2. None of them EVER emits a `safeTarget`/`stretchTarget` pair or a
 *      target-naming answer (the split `docs/faff-iphone-design-contract.md`
 *      §2 exists for: "A 'Take 3:16:45' button under 'is it hot on race
 *      morning' answers a question nobody asked").
 *   3. Absent a fact/choice, `composeRaceCard` returns `null` — no verdict
 *      ever synthesises a card of its own.
 */
import { describe, it, expect } from 'vitest';
import {
  composeRaceCard,
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

describe('race-card', () => {
  // ── the four FACT/CHOICE triggers — never a safe/stretch pair, never a
  //    target-naming answer ──────────────────────────────────────────────
  it('race-morning heat → fact, no safe/stretch, no take', () => {
    const spec = heatFactCard('CIM', 78);
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('heat');
    assertNoSafeStretchOrTake(card);
    expect(card.answers.map(a => a.action).sort()).toEqual(['acknowledge', 'repace']);
  });

  it('course changed → fact, no safe/stretch, no take', () => {
    const spec = courseChangedFactCard('CIM');
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('course_changed');
    assertNoSafeStretchOrTake(card);
  });

  it('chip-time lock approaching → fact, no safe/stretch, no take', () => {
    const spec = chipLockFactCard('QA Tune-up 10K');
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('chip_lock');
    assertNoSafeStretchOrTake(card);
    expect(card.answers.map(a => a.action).sort()).toEqual(['confirm', 'leave']);
  });

  it('two A races conflicting → choice, no safe/stretch, no take', () => {
    const spec = twoARacesChoiceCard({ slug: 'cim', name: 'CIM' }, { slug: 'nyc', name: 'NYC Marathon' });
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
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

  // ── NO card without a real trigger ─────────────────────────────────────
  //
  // 2026-08-26 · David, mid-session, escalating past each smaller fix in
  // turn: "there is no reason that in Aug I have to accept defeat on a race
  // in December" → "if we fix this right then this decision card shouldnt
  // even come up... there is no decision" → "my point is that we dont even
  // need ANY of this." A pure verdict (no discrete event behind it) used to
  // synthesise a "NEEDS A DECISION" card of its own, for every feasibility
  // value, on every load. It no longer does, for any of them — a verdict is
  // not a trigger, and `Goal`/`Projected`/`Gap` on the panel already carry
  // the honest read.
  const everyFeasibility: GoalFeasibility[] = [
    'comfortable', 'realistic', 'ambitious', 'aggressive', 'out-of-reach',
    'open-ended', 'date-passed', 'unreadable',
  ];

  for (const feasibility of everyFeasibility) {
    it(`${feasibility} verdict with no fact/choice trigger → no card at all`, () => {
      const card = composeRaceCard({ assessment: assessment({ feasibility }), factOrChoice: null });
      expect(card).toBeNull();
    });
  }

  it('still no card even for a runner returning from injury — that is not a discrete trigger either', () => {
    const card = composeRaceCard({
      assessment: assessment({ feasibility: 'out-of-reach' }),
      factOrChoice: null,
      returningFromInjury: true,
    });
    expect(card).toBeNull();
  });

  it('a fact/choice trigger always wins over an absent one, even an "ahead" verdict', () => {
    const spec = heatFactCard('CIM', 90);
    const card = composeRaceCard({ assessment: assessment({ feasibility: 'comfortable' }), factOrChoice: spec })!;
    expect(card.shape).toBe('fact');
    expect(card.verdict).toBe('comfortable'); // verdict still travels, unlike the shape
  });
});
