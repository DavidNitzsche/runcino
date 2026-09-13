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
  heatFactCard, courseChangedFactCard, courseChangedChoiceCard, chipLockFactCard, twoARacesChoiceCard,
  collidingARacePair, A_RACE_COLLISION_DAYS,
  type V5DecisionCardOut, type V5CourseElevationDetailOut,
} from './race-card';
import { computeCourseImpact } from './course-impact';
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

  // 2026-09-11 · CIM elevation-integrity fix
  // (docs/design/cim-elevation-semantic-trace-2026-09-11.md). The old test
  // here just checked the fact shape existed for a bare race-name string.
  // The bug this fix closes was exactly that "Acknowledge" and "Not now"
  // traced to the SAME outcome — a fact card carrying no data at all, so
  // there was nothing for the two buttons to meaningfully diverge on. These
  // tests assert the replacement: a high/medium-confidence conflict is
  // INFORMATIONAL (one answer, real numbers), a low-confidence one is a
  // real CHOICE (two answers with genuinely different actions).
  const cimResolvedDetail: V5CourseElevationDetailOut = {
    oldNetFt: -340, oldGainFt: 100, oldSecondsImpact: 0,
    newNetFt: -304, newGainFt: 723, newSecondsImpact: 54,
    confidence: 'high', resolved: true, reasons: ['dense track, distance matches, no dropouts or altitude spikes'],
  };
  const cimUnresolvedDetail: V5CourseElevationDetailOut = {
    oldNetFt: -340, oldGainFt: 100, oldSecondsImpact: 0,
    newNetFt: -304, newGainFt: 723, newSecondsImpact: 54,
    confidence: 'low', resolved: false, reasons: ['only 8 elevation samples per mile · too coarse for gross gain'],
  };

  it('course changed, resolver already trusts the measurement → fact, ONE answer, no safe/stretch, no take', () => {
    const spec = courseChangedFactCard('CIM', cimResolvedDetail);
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
    expect(card.shape).toBe('fact');
    expect(card.trigger).toBe('course_changed');
    assertNoSafeStretchOrTake(card);
    // The whole point of the fix: no second button pretending to be a
    // different choice than the first.
    expect(card.answers).toHaveLength(1);
    expect(card.answers[0].action).toBe('acknowledge');
    // The resolver's own numbers travel through unrecomputed — the numbers
    // themselves render as a tile on the phone (RaceDecisionCardV5), not
    // restated in the sentence, so they are never said twice (Rule 17).
    expect(card.courseElevationDetail).toEqual(cimResolvedDetail);
    // The copy names the actual seconds impact and never claims to move
    // "the projection" (course elevation has zero input into
    // race-projection.ts's trajectory-based Projected figure — Rule 16) —
    // it names the course chunk of the goal gap instead.
    expect(card.question).toContain('54 second');
    expect(card.question.toLowerCase()).toContain('course chunk');
    expect(card.question.toLowerCase()).not.toContain('projection');
    expect(card.question).toContain('No verification date is on record');
  });

  it('course changed, resolver confidence is low → choice, TWO answers with genuinely different actions', () => {
    const spec = courseChangedChoiceCard('CIM', cimUnresolvedDetail);
    const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;
    expect(card.shape).toBe('choice');
    expect(card.trigger).toBe('course_changed');
    assertNoSafeStretchOrTake(card);
    expect(card.answers).toHaveLength(2);
    const actions = card.answers.map(a => a.action).sort();
    expect(actions).toEqual(['keep_curated_elevation', 'use_measured_elevation']);
    // Each answer names its own numbers, not a generic label — this is the
    // "two DISTINCT, named choices with their exact, different effects"
    // requirement, not a relabelled Acknowledge/Not-now.
    const useLabel = card.answers.find(a => a.action === 'use_measured_elevation')!.label;
    const keepLabel = card.answers.find(a => a.action === 'keep_curated_elevation')!.label;
    expect(useLabel).toContain('723 ft gain');
    expect(keepLabel).toContain('100 ft gain');
    expect(useLabel).not.toBe(keepLabel);
    expect(card.courseElevationDetail).toEqual(cimUnresolvedDetail);
    // NATURAL-COACHING-3 (2026-09-12) · this card's own question text
    // ("...isn't dense enough for us to trust it...") carried the same
    // first-person-plural slip as its fact-card sibling above. Pinned here
    // too, since the two cards compose their questions independently.
    expect(card.question).not.toMatch(/\bwe\b|\bus\b/i);
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

  // ── RENDERED ACCEPTANCE CASE · David's real CIM state ──────────────────
  //
  // Per the task's verification requirement and Rule 13 ("a fix to something
  // the runner sees is verified by rendering it, with real data"). No
  // `DATABASE_URL_RO` is available in this environment (disclosed in
  // `docs/design/cim-elevation-semantic-trace-2026-09-11.md`'s access
  // disclosure) — this fixture is RECONSTRUCTED FROM KNOWN VALUES already
  // established and cited in that trace document, not a live query:
  //
  //   curated (course_library, migration 130 + the seed JSON)  · gain 100 ft, net -340 ft
  //   measured (David's own GPS track, cited from a prior live-DB
  //     read at ownership-scorecard.md:828 / closure-cross-surface.md:285) · gain 723 ft, net -304 ft
  //   goal (ADAPTATION-REAL-REPLAY.md:4)                        · 3:00:00 (10,800 s)
  //   distance (cim.json expected_facts)                        · 26.2 mi
  //
  // `computeCourseImpact()` — the REAL, shared function, imported here, not
  // reimplemented — is what turns those into the +54s/0s the card carries,
  // exactly the way `detectCourseChanged` in `app/api/v5/races/route.ts`
  // computes it. This test proves the whole pipe end to end: real numbers in,
  // through the real seconds-impact function, into the actual rendered card.
  describe('rendered acceptance case · CIM (reconstructed from known values, not a live query)', () => {
    const GOAL_SEC = 3 * 3600; // 3:00:00
    const DISTANCE_MI = 26.2;
    const CURATED = { elevationGainFt: 100, netElevationFt: -340 };
    const MEASURED = { elevationGainFt: 723, netElevationFt: -304 };

    it('computeCourseImpact confirms the trace doc\'s own hand-derived numbers', () => {
      const oldImpact = computeCourseImpact({ distanceMi: DISTANCE_MI, goalSec: GOAL_SEC, ...CURATED });
      const newImpact = computeCourseImpact({ distanceMi: DISTANCE_MI, goalSec: GOAL_SEC, ...MEASURED });
      // Curated's net-downhill credit floors to 0 (course-impact.ts's own UX
      // floor); measured's real climbing survives the same floor at +54.
      expect(oldImpact.seconds).toBe(0);
      expect(newImpact.seconds).toBe(54);
    });

    it('CIM, high confidence (the resolver has already adopted the measured value) → the informational card the runner actually sees', () => {
      const oldImpact = computeCourseImpact({ distanceMi: DISTANCE_MI, goalSec: GOAL_SEC, ...CURATED });
      const newImpact = computeCourseImpact({ distanceMi: DISTANCE_MI, goalSec: GOAL_SEC, ...MEASURED });
      const detail: V5CourseElevationDetailOut = {
        oldNetFt: CURATED.netElevationFt, oldGainFt: CURATED.elevationGainFt, oldSecondsImpact: oldImpact.seconds,
        newNetFt: MEASURED.netElevationFt, newGainFt: MEASURED.elevationGainFt, newSecondsImpact: newImpact.seconds,
        confidence: 'high', resolved: true,
        reasons: ['dense track, distance matches, no dropouts or altitude spikes'],
      };
      const spec = courseChangedFactCard('California International Marathon', detail);
      const card = composeRaceCard({ assessment: assessment({}), factOrChoice: spec })!;

      // What David would actually see on his phone: one shape, one answer,
      // never a fake choice between two backend values he cannot evaluate.
      expect(card.shape).toBe('fact');
      expect(card.answers).toHaveLength(1);
      expect(card.answers[0].label).toBe('Acknowledge');
      expect(card.answers[0].action).toBe('acknowledge');
      // The +54s correction, computed by the real function, reaches the card.
      expect(card.courseElevationDetail?.newSecondsImpact).toBe(54);
      expect(card.courseElevationDetail?.oldSecondsImpact).toBe(0);
      // The tile numbers the phone renders (RaceDecisionCardV5's
      // `elevationTile`) — the real curated vs. measured figures, unrounded
      // math already done upstream.
      expect(card.courseElevationDetail?.oldGainFt).toBe(100);
      expect(card.courseElevationDetail?.newGainFt).toBe(723);
      expect(card.courseElevationDetail?.oldNetFt).toBe(-340);
      expect(card.courseElevationDetail?.newNetFt).toBe(-304);
      // Never claims to move "the projection" — course elevation has zero
      // input into race-projection.ts's trajectory-based Projected figure
      // (trace doc §6). Names the course chunk instead.
      expect(card.question.toLowerCase()).not.toContain('projection');
      expect(card.question.toLowerCase()).toContain('course chunk');
      // The honestly-disclosed schema gap (trace doc §5) — no invented date.
      expect(card.question).toContain('No verification date is on record');
      // NATURAL-COACHING-3 (2026-09-12) · coach voice states facts; it does
      // not speak as "we"/"us" doing something to the runner. This was the
      // only first-person-plural phrasing found across `lib/training`,
      // `lib/race`, `lib/faff` and `lib/coach`'s runner-facing strings.
      expect(card.question).not.toMatch(/\bwe\b|\bus\b/i);
    });
  });
});
