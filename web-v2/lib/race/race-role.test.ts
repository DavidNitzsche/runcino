/**
 * lib/race/race-role.test.ts · the recommendation matrix, on the day-gap
 * grid, plus the card copy contract (coach voice, standing-pat sentence).
 *
 * Doctrine under test: Research/REVIEW_NOTES.md A2 (2026-08-28) — a half at
 * exactly 4 weeks pre-marathon is a B-effort race or becomes the week −3 MP
 * session; A-effort is sanctioned at 5-6 weeks only (Research/02 §12.3);
 * B-race recovery is 7-10 days, not 14 (Research/00b).
 *
 * The live case that motivated the mechanism: Run Malibu (half, 2026-11-08,
 * priority B) exactly 28 days before CIM (A marathon, 2026-12-06).
 */
import { describe, it, expect } from 'vitest';
import {
  HALF_B_EFFORT_GAP_DAYS,
  HALF_HONEST_RACE_GAP_DAYS,
  HALF_NONMARATHON_MIN_HONEST_GAP_DAYS,
  RACE_ROLE_FIRE_WINDOW_DAYS,
  ROLE_POST_QUALITY_FREE_DAYS,
  SHORT_TUNEUP_MIN_HONEST_GAP_DAYS,
  isRaceRole,
  raceRoleCard,
  recommendRaceRole,
  weeksPhrase,
  type RaceRole,
} from './race-role';

const halfBeforeMarathon = (gapToADays: number | null) =>
  recommendRaceRole({ category: 'hm', priority: 'B', gapToADays, aRaceIsMarathon: true });

describe('half before an A marathon · the A2 partition', () => {
  const MATRIX: Array<[number, RaceRole]> = [
    // < 26 days · closer than the sanction window → the MP long with a bib.
    [7, 'mp_workout'], [14, 'mp_workout'], [21, 'mp_workout'], [25, 'mp_workout'],
    // 26-30 days · ~4 weeks → B effort (A-effort recovery eats week -3).
    [26, 'b_effort'], [28, 'b_effort'], [30, 'b_effort'],
    // 31-42 days · 5-6 weeks → race it honestly (recovery clears week -3).
    [31, 'race'], [35, 'race'], [42, 'race'],
    // > 42 days · clear of the collision entirely → race it.
    [49, 'race'], [56, 'race'],
  ];
  for (const [gap, role] of MATRIX) {
    it(`${gap} days out → ${role}`, () => {
      expect(halfBeforeMarathon(gap)?.role).toBe(role);
    });
  }

  it('the bands are contiguous · every gap in [1..60] gets exactly one recommendation', () => {
    for (let gap = 1; gap <= 60; gap++) {
      const rec = halfBeforeMarathon(gap);
      expect(rec, `gap ${gap}`).not.toBeNull();
      expect(isRaceRole(rec!.role)).toBe(true);
    }
  });

  it('Run Malibu · half exactly 28 days before CIM → B effort', () => {
    const rec = halfBeforeMarathon(28);
    expect(rec?.role).toBe('b_effort');
    expect(rec?.citation).toContain('REVIEW_NOTES');
  });
});

describe('who never gets a card', () => {
  it('a C race is already decided · null at every gap', () => {
    for (const gap of [7, 21, 28, 35, 42, 56]) {
      expect(recommendRaceRole({ category: 'hm', priority: 'C', gapToADays: gap, aRaceIsMarathon: true })).toBeNull();
      expect(recommendRaceRole({ category: '10k', priority: 'C', gapToADays: gap, aRaceIsMarathon: true })).toBeNull();
    }
  });
  it('an A race is not a tune-up', () => {
    expect(recommendRaceRole({ category: 'hm', priority: 'A', gapToADays: 28, aRaceIsMarathon: true })).toBeNull();
  });
  it('no A race behind it · nothing to protect, nothing to recommend', () => {
    expect(halfBeforeMarathon(null)).toBeNull();
  });
  it('unresolvable or non-tune-up distance categories', () => {
    for (const category of [null, 'm', 'ultra', 'weird']) {
      expect(recommendRaceRole({ category, priority: 'B', gapToADays: 28, aRaceIsMarathon: true })).toBeNull();
    }
  });
  it('a gap of zero or negative days (race at/after the A race) is not mid-block', () => {
    expect(halfBeforeMarathon(0)).toBeNull();
    expect(halfBeforeMarathon(-7)).toBeNull();
  });
});

describe('10K and 5K mid-build', () => {
  for (const category of ['10k', '5k'] as const) {
    it(`${category} · race it by default (5-7 easy days, high-value anchor)`, () => {
      for (const gap of [SHORT_TUNEUP_MIN_HONEST_GAP_DAYS, 28, 42, 56]) {
        expect(recommendRaceRole({ category, priority: 'B', gapToADays: gap, aRaceIsMarathon: true })?.role).toBe('race');
      }
    });
    it(`${category} · inside ${SHORT_TUNEUP_MIN_HONEST_GAP_DAYS} days of the A race → B effort`, () => {
      for (const gap of [7, 14, SHORT_TUNEUP_MIN_HONEST_GAP_DAYS - 1]) {
        expect(recommendRaceRole({ category, priority: 'B', gapToADays: gap, aRaceIsMarathon: true })?.role).toBe('b_effort');
      }
    });
  }
});

describe('half before a NON-marathon A race · no week -3 MP session to protect', () => {
  it('never recommends mp_workout (MP is a marathon concept)', () => {
    for (let gap = 1; gap <= 60; gap++) {
      const rec = recommendRaceRole({ category: 'hm', priority: 'B', gapToADays: gap, aRaceIsMarathon: false });
      expect(rec?.role, `gap ${gap}`).not.toBe('mp_workout');
    }
  });
  it('inside four weeks → B effort · outside → race', () => {
    expect(recommendRaceRole({ category: 'hm', priority: 'B', gapToADays: HALF_NONMARATHON_MIN_HONEST_GAP_DAYS - 1, aRaceIsMarathon: false })?.role).toBe('b_effort');
    expect(recommendRaceRole({ category: 'hm', priority: 'B', gapToADays: HALF_NONMARATHON_MIN_HONEST_GAP_DAYS, aRaceIsMarathon: false })?.role).toBe('race');
  });
});

describe('constants agree with themselves', () => {
  it('B-effort and honest-race bands are contiguous and ordered', () => {
    expect(HALF_B_EFFORT_GAP_DAYS[1] + 1).toBe(HALF_HONEST_RACE_GAP_DAYS[0]);
    expect(HALF_HONEST_RACE_GAP_DAYS[0]).toBeGreaterThan(HALF_B_EFFORT_GAP_DAYS[1]);
  });
  it('an honest race never owes less recovery than a B effort', () => {
    for (const cat of ['hm', '10k', '5k'] as const) {
      expect(ROLE_POST_QUALITY_FREE_DAYS[cat].race).toBeGreaterThanOrEqual(ROLE_POST_QUALITY_FREE_DAYS[cat].b_effort);
    }
  });
  it('the fire window is a band around 14 days', () => {
    expect(RACE_ROLE_FIRE_WINDOW_DAYS[0]).toBeLessThanOrEqual(14);
    expect(RACE_ROLE_FIRE_WINDOW_DAYS[1]).toBeGreaterThanOrEqual(14);
  });
});

describe('card copy · coach voice', () => {
  const cardFor = (gap: number) => {
    const rec = halfBeforeMarathon(gap)!;
    return raceRoleCard({
      raceName: 'Run Malibu', aRaceName: 'CIM', gapToADays: gap,
      recommendation: rec, category: 'hm',
    });
  };

  it('Malibu at 28 days · title, B-effort body, accept verb', () => {
    const card = cardFor(28);
    expect(card.title).toBe('Run Malibu, four weeks out');
    expect(card.body).toContain('Race it at B effort. Hard, not all out.');
    expect(card.body).toContain('CIM');
    expect(card.acceptVerb).toBe('RUN IT AT B EFFORT');
  });

  it('every role · the body says what standing pat means (the card expires)', () => {
    for (const gap of [21, 28, 35]) {
      expect(cardFor(gap).body).toContain('Leave this and the plan stands as authored');
    }
  });

  it('coach voice · no em dashes, no exclamation marks, no emoji', () => {
    for (const gap of [21, 28, 35]) {
      const card = cardFor(gap);
      for (const text of [card.title, card.body, card.acceptVerb]) {
        expect(text).not.toMatch(/—/);
        expect(text).not.toMatch(/!/);
        expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      }
    }
  });

  it('mp_workout and race verbs', () => {
    expect(cardFor(21).acceptVerb).toBe('MAKE IT THE MP LONG');
    expect(cardFor(35).acceptVerb).toBe('RACE IT HONESTLY');
  });

  it('weeksPhrase rounds to the spoken week', () => {
    expect(weeksPhrase(28)).toBe('four weeks');
    expect(weeksPhrase(30)).toBe('four weeks');
    expect(weeksPhrase(35)).toBe('five weeks');
    expect(weeksPhrase(21)).toBe('three weeks');
    expect(weeksPhrase(7)).toBe('one week');
  });
});
