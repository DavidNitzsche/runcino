/**
 * EVERY RACE COUNTS, AT THE WEIGHT IT EARNED · selection-time rule 8.
 *
 * `lib/training/vdot-inputs.ts` admitted only `priority IN ('A','B')` and
 * `bestRecentVdot` dropped `'C'` again. That read like data hygiene. It was the
 * only thing standing between the candidate pool and a jogged C race, because
 * `assessRaceRepresentativeness` was never consulted on the selection path —
 * its only callers were the two re-anchor detectors in `lib/plan/adapt.ts`.
 *
 * Two things had to be true before the filter could open, and both are tested
 * here:
 *
 *   1 · A low-authority race must not become the anchor that sets every
 *       prescribed pace, while still counting when it is all the runner has.
 *   2 · `supersededLead` must key on a race that carries real authority, not on
 *       the freshest race's DATE — otherwise a parkrun jogged as a workout
 *       becomes "the field test" and demotes every legitimate training lead.
 *
 * Doctrine: `Research/00b` §"Recovery by Effort (A vs. B vs. C Race)" grades
 * what a race WAS (A 1.0 · B 0.65 · C 0.35); `Research/01` §"Triggers to
 * retest" licenses "Update VDOT from race" only for a result that was
 * "all-out, well-paced". See `lib/race/effort-authority.ts`.
 */

import { describe, it, expect } from 'vitest';
import { bestRecentVdot, vdotFromRace, predictRaceTime } from './vdot';
import {
  REPRESENTATIVE_FLOOR,
  UNREPRESENTATIVE_FLOOR,
  selectionAuthority,
} from '@/lib/race/effort-authority';
import { RECOVERY_EFFORT_SCALE } from '@/lib/plan/goal-tiers';

const HM = 13.1094;
const TEN_K = 6.21371;
const M = 26.2188;

type Race = Parameters<typeof bestRecentVdot>[0][number];
type Run = NonNullable<Parameters<typeof bestRecentVdot>[3]>[number];

const race = (over: Partial<Race> & Pick<Race, 'slug' | 'date'>): Race => ({
  name: over.slug,
  priority: 'A',
  distance_mi: HM,
  finish_seconds: 6120,
  ...over,
} as Race);

const tempo = (id: string, date: string, over: Partial<Run> = {}): Run => ({
  id,
  date,
  workout_type: 'tempo',
  distance_mi: 5,
  finish_seconds: 2100,
  zone: 'threshold',
  ...over,
} as Run);

// ── The owner's real calendar ────────────────────────────────────────────────
// Finish times are the exact Daniels inversions of the stated VDOTs, so each
// round-trips to the number in his history rather than to a number chosen here.
const BIG_SUR = race({
  slug: 'big-sur', date: '2026-04-26', priority: 'hilly_excluded',
  distance_mi: M, finish_seconds: 13028, // 3:37:08 → VDOT 42.8
});
const SOMBRERO = race({
  slug: 'sombrero', date: '2026-05-03', priority: 'C',
  distance_mi: HM, finish_seconds: 6037, // 1:40:37 → VDOT 44.8
});
const AFC = race({
  slug: 'afc', date: '2026-08-16', priority: 'A',
  distance_mi: HM, finish_seconds: 6120, // 1:42:00 → VDOT 44.1
});
/** A 44.1-VDOT runner races 10K all-out in 46:01. 50:00 is a jog. */
const DODGERS_JOGGED = race({
  slug: 'dodgers', date: '2026-09-26', priority: 'C',
  distance_mi: TEN_K, finish_seconds: 3000, // 50:00 → VDOT 40.0
});

describe('the doctrine numbers are read, not invented', () => {
  it('effort class is Research/00b\'s own recovery scale · A 1.0 · B 0.65 · C 0.35', () => {
    expect(selectionAuthority('A')).toBe(RECOVERY_EFFORT_SCALE.A);
    expect(selectionAuthority('B')).toBe(RECOVERY_EFFORT_SCALE.B);
    expect(selectionAuthority('C')).toBe(RECOVERY_EFFORT_SCALE.C);
    // Deleting the distinction would be the actual mistake · it must stay ordered.
    expect(selectionAuthority('A')).toBeGreaterThan(selectionAuthority('B'));
    expect(selectionAuthority('B')).toBeGreaterThan(selectionAuthority('C'));
  });

  it('the two tier floors are the doctrine B and C rows', () => {
    expect(REPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.B);
    expect(UNREPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.C);
  });

  it('an UNGRADED priority falls to the lowest graded row, never the highest', () => {
    // `recoveryEffortScale` maps the unrecognised to A, which is right for
    // recovery duration (over-resting is the safe error) and wrong for
    // authority. Grading `hilly_excluded` as an A race would assert what the A
    // row says — "Maximum, full taper, peak day" — about a row whose whole
    // content is that the course did the talking.
    for (const p of ['hilly_excluded', 'training_run', 'unknown', '', null]) {
      expect(selectionAuthority(p)).toBe(RECOVERY_EFFORT_SCALE.C);
    }
  });
});

describe('1 · membership is open · every race is a candidate', () => {
  const TODAY = '2026-06-01';

  it('a C race is in the pool at all · it used to be dropped twice over', () => {
    const { considered } = bestRecentVdot([SOMBRERO], TODAY);
    expect(considered.map((c) => c.source)).toEqual(['race']);
    expect(considered[0]).toMatchObject({ source: 'race', vdot_raw: 44.8 });
  });

  it('a C race that is the ONLY candidate anchors the runner', () => {
    const { best } = bestRecentVdot([SOMBRERO], TODAY);
    expect(best?.source).toBe('race');
    expect(best?.vdot).toBe(44.8);
  });

  it('an ungraded (hilly_excluded) race is a candidate too, at the C weight', () => {
    const { best, considered } = bestRecentVdot([BIG_SUR], '2026-05-20');
    expect(considered).toHaveLength(1);
    expect(considered[0]).toMatchObject({
      source: 'race', vdot_raw: 42.8, authority: RECOVERY_EFFORT_SCALE.C,
      authority_tier: 'compromised',
    });
    expect(best?.vdot).toBe(42.8);
  });
});

describe('2 · authority scales RANK, and never the number', () => {
  const TODAY = '2026-06-01';

  it('a C race does not outrank an A race even when it reads HIGHER', () => {
    // Sombrero (C, 44.8) is a full 0.7 VDOT above AFC-shaped evidence at 44.1.
    // Max-wins would take it. This is the exact shape of the hazard.
    const goalRace = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { best, considered } = bestRecentVdot([SOMBRERO, goalRace], TODAY);

    const c = considered.find((x) => x.source === 'race' && x.slug === 'sombrero')!;
    expect(c.vdot).toBeGreaterThan(best!.vdot); // magnitude alone would have won
    expect(best).toMatchObject({ source: 'race', slug: 'goal-hm' });
  });

  it('the demoted race keeps its own honest VDOT · rank moved, the number did not', () => {
    // A scaled VDOT would be a fabricated performance. `Research/06` §10 offers
    // a neutral-equivalent time correction and rule 8 declines it in favour of
    // scaling the ADJUSTMENT; selection scales the RANK for the same reason.
    const goalRace = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { considered } = bestRecentVdot([SOMBRERO, goalRace], TODAY);
    const c = considered.find((x) => x.source === 'race' && x.slug === 'sombrero')!;
    expect(c.vdot_raw).toBe(vdotFromRace(SOMBRERO.finish_seconds!, SOMBRERO.distance_mi!));
    expect(c.vdot).toBe(c.vdot_raw);
  });

  it('a B race is representative · it still competes on value against an A race', () => {
    const b = race({ slug: 'tune-up', date: '2026-05-20', priority: 'B', finish_seconds: 6037 });
    const a = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { best } = bestRecentVdot([b, a], TODAY);
    expect(best).toMatchObject({ slug: 'tune-up', authority_tier: 'representative' });
  });

  it('the demotion is inert when there is no better-graded race to prefer', () => {
    // Two C races and nothing else · value decides, exactly as before.
    const slowerC = race({ slug: 'other-c', date: '2026-05-10', priority: 'C', finish_seconds: 6400 });
    const { best } = bestRecentVdot([SOMBRERO, slowerC], TODAY);
    expect(best).toMatchObject({ slug: 'sombrero', authority_tier: 'compromised' });
  });

  it('demotion is not deletion · the evidence stays auditable in `considered`', () => {
    const a = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' });
    const { considered } = bestRecentVdot([SOMBRERO, a], TODAY);
    expect(considered).toHaveLength(2);
    expect(considered.map((c) => c.source === 'race' && c.slug)).toEqual(['goal-hm', 'sombrero']);
  });
});

describe('3 · only a race with authority supersedes a training lead', () => {
  const TODAY = '2026-06-01';
  const LEAD = tempo('lead', '2026-05-20');

  it('a jogged C race does NOT demote a training lead that preceded it', () => {
    const jogged = race({
      slug: 'parkrun', date: '2026-05-25', priority: 'C',
      distance_mi: TEN_K, finish_seconds: 3000,
    });
    const { best } = bestRecentVdot([jogged], TODAY, undefined, [LEAD]);
    expect(best?.source).toBe('run');
  });

  it('an A race still does · the rule is unchanged for every race that could reach it before', () => {
    const goal = race({ slug: 'goal-hm', date: '2026-05-25', priority: 'A' });
    const { best } = bestRecentVdot([goal], TODAY, undefined, [LEAD]);
    expect(best).toMatchObject({ source: 'race', slug: 'goal-hm' });
  });

  it('a B race still does', () => {
    const tuneUp = race({ slug: 'tune-up', date: '2026-05-25', priority: 'B' });
    const { best } = bestRecentVdot([tuneUp], TODAY, undefined, [LEAD]);
    expect(best).toMatchObject({ source: 'race', slug: 'tune-up' });
  });

  it('a C race AFTER an A race does not un-supersede the leads the A race resolved', () => {
    // The freshest AUTHORITATIVE race is the A one, so leads before it stay
    // demoted even though a C race is more recent than all of them.
    const goal = race({ slug: 'goal-hm', date: '2026-05-22', priority: 'A' });
    const jogged = race({
      slug: 'parkrun', date: '2026-05-28', priority: 'C',
      distance_mi: TEN_K, finish_seconds: 3000,
    });
    const { best } = bestRecentVdot([goal, jogged], TODAY, undefined, [LEAD]);
    expect(best).toMatchObject({ source: 'race', slug: 'goal-hm' });
  });
});

/**
 * ── THE ROW THAT WAS ALREADY LEAKING ───────────────────────────────────────
 *
 * `bestRecentVdot` skipped `priority === 'C'` and nothing else, so an UNGRADED
 * priority — `hilly_excluded`, `training_run`, or any string a past import
 * wrote — walked into the pool at FULL authority. Only the SQL filter in
 * `vdot-inputs.ts` held it back, and the whole point of this work is that the
 * SQL filter is going away.
 *
 * These cases therefore isolate the two RULE changes from the membership
 * change: the row is admitted by the old code and the new code alike, so what
 * differs is only what authority does with it. Big Sur is real: it is on the
 * owner's calendar as `hilly_excluded`, over a course measured at 2067 ft of
 * gross gain.
 */
describe('an ungraded race is graded, not trusted', () => {
  const TODAY = '2026-05-20';
  const GOAL = race({ slug: 'goal-hm', date: '2026-04-20', priority: 'A' }); // 44.1
  /** Same course, run fast enough to read ABOVE the A race. */
  const UNGRADED_FAST = race({
    slug: 'downhill', date: '2026-04-28', priority: 'hilly_excluded',
    distance_mi: HM, finish_seconds: 6037, // 1:40:37 → VDOT 44.8
  });

  it('it does not outrank a graded race, however large its number', () => {
    const { best, considered } = bestRecentVdot([GOAL, UNGRADED_FAST], TODAY);
    const u = considered.find((c) => c.source === 'race' && c.slug === 'downhill')!;
    expect(u.vdot).toBeGreaterThan(best!.vdot);
    expect(best).toMatchObject({ slug: 'goal-hm' });
  });

  it('it does not supersede a training lead · it is not the field test', () => {
    const lead = tempo('lead', '2026-04-25');
    const { best } = bestRecentVdot([UNGRADED_FAST], TODAY, undefined, [lead]);
    expect(best).toMatchObject({ source: 'run', id: 'lead' });
  });

  it('it does not license training reads above the graded race it lost to', () => {
    const lead = tempo('lead', '2026-05-05');
    const { considered } = bestRecentVdot([GOAL, UNGRADED_FAST], TODAY, undefined, [lead]);
    const run = considered.find((c) => c.source === 'run')!;
    // The A race + the doctrinal +1 · never the ungraded 44.8 + 1.
    expect(run.vdot_raw).toBeCloseTo(44.1 + 1.0, 5);
  });
});

describe('4 · a demoted race cannot launder itself back in through the training cap', () => {
  const TODAY = '2026-06-01';

  it('a demoted C race does not raise the training soft-cap ceiling', () => {
    // Without this, a C race barred from the headline would still hand every
    // training run a ceiling of C + 1 — the demoted race, one level down.
    const a = race({ slug: 'goal-hm', date: '2026-05-10', priority: 'A' }); // 44.1
    const fastC = race({
      slug: 'downhill-10k', date: '2026-05-12', priority: 'C',
      distance_mi: TEN_K, finish_seconds: 2700, // 45:00 → VDOT 45.3
    });
    const { considered } = bestRecentVdot([a, fastC], TODAY, undefined, [tempo('t', '2026-05-25')]);
    const run = considered.find((c) => c.source === 'run')!;
    expect(run.vdot_raw).toBeCloseTo(44.1 + 1.0, 5); // capped to the A race, not to the C one
  });

  it('but a C race that is the only race DOES set the ceiling · a floor you have beats a guess you don\'t', () => {
    const { considered } = bestRecentVdot([SOMBRERO], TODAY, undefined, [tempo('t', '2026-05-25')]);
    const run = considered.find((c) => c.source === 'run')!;
    expect(run.vdot_raw).toBeCloseTo(44.8 + 1.0, 5);
  });
});

/**
 * ── THE OWNER'S CHAIN ──────────────────────────────────────────────────────
 *
 * Three ways today, then the day after Dodgers. The point of the 28 September
 * case is that today's safety is a coincidence of the calendar, not of the
 * filter: the two races the filter catches are 106 and 113 days old and the
 * 84-day freshness window would catch them anyway.
 */
describe('the owner · 2026-08-17', () => {
  const TODAY = '2026-08-17';
  const ALL = [BIG_SUR, SOMBRERO, AFC];
  const RUNS = [tempo('t-jul', '2026-07-20'), tempo('t-aug', '2026-08-09')];

  it('opening the filter changes nothing today · the window already excluded both', () => {
    const { best, considered } = bestRecentVdot(ALL, TODAY, undefined, RUNS);
    // Big Sur (113 d) and Sombrero (106 d) are past VDOT_EXPIRY_DAYS = 84.
    expect(considered.filter((c) => c.source === 'race').map((c) => c.slug)).toEqual(['afc']);
    expect(best).toMatchObject({ source: 'race', slug: 'afc', vdot: 44.1 });
  });

  it('and the anchor is the race, because both leads predate it', () => {
    const { best } = bestRecentVdot(ALL, TODAY, undefined, RUNS);
    expect(best?.source).toBe('race');
    expect(best?.age_days).toBe(1);
  });
});

describe('the owner · 2026-09-28, the day after Dodgers', () => {
  const TODAY = '2026-09-28';
  // A tempo run in the block between AFC and Dodgers · genuine new evidence
  // acquired after the last hard proof, which is what a soft lead IS.
  const LEAD_AFTER_AFC = tempo('t-sep', '2026-09-20');
  const RACES = [AFC, DODGERS_JOGGED];

  it('DAMAGE · with no authority scaling, the jog deletes the lead behind it', () => {
    // A C race with no authority predicate behaves exactly as a B race does:
    // it is simply "the freshest race". Declaring Dodgers a B reproduces the
    // pre-fix behaviour through the shipped code path.
    const asIfUngraded = { ...DODGERS_JOGGED, priority: 'B' };
    const { best, considered } = bestRecentVdot([AFC, asIfUngraded], TODAY, undefined, [LEAD_AFTER_AFC]);
    const lead = considered.find((c) => c.source === 'run')!;
    expect(lead.vdot).toBeGreaterThan(best!.vdot); // the lead is the strongest evidence
    expect(best?.source).toBe('race');             // and it is demoted anyway
    expect(best).toMatchObject({ slug: 'afc' });
  });

  it('DAMAGE · and a C race that reads high would take the anchor outright', () => {
    const hardC = { ...DODGERS_JOGGED, priority: 'B', finish_seconds: 2700 }; // 45:00 → 45.3
    const { best } = bestRecentVdot([AFC, hardC], TODAY);
    expect(best).toMatchObject({ slug: 'dodgers', vdot: 45.3 });
  });

  it('FIXED · Dodgers is a candidate, graded compromised, and the anchor holds', () => {
    const { best, considered } = bestRecentVdot(RACES, TODAY, undefined, [LEAD_AFTER_AFC]);

    const dodgers = considered.find((c) => c.source === 'race' && c.slug === 'dodgers')!;
    expect(dodgers).toMatchObject({ authority: RECOVERY_EFFORT_SCALE.C, authority_tier: 'compromised' });
    expect(dodgers.vdot).toBe(40); // its own honest number, unscaled

    // The lead acquired after AFC still leads · Dodgers did not supersede it.
    expect(best).toMatchObject({ source: 'run', id: 't-sep' });
    expect(best!.vdot).toBeCloseTo(44.1 + 1.0, 5); // and it is bounded by AFC, not by Dodgers
  });

  it('FIXED · with no training runs at all, AFC anchors and Dodgers does not', () => {
    const { best } = bestRecentVdot(RACES, TODAY);
    expect(best).toMatchObject({ source: 'race', slug: 'afc', vdot: 44.1 });
  });

  it('FIXED · even a Dodgers run HARD cannot take the anchor off the A race', () => {
    const hardC = { ...DODGERS_JOGGED, finish_seconds: 2700 }; // C, 45:00 → VDOT 45.3
    const { best, considered } = bestRecentVdot([AFC, hardC], TODAY);
    const d = considered.find((c) => c.source === 'race' && c.slug === 'dodgers')!;
    expect(d.vdot).toBeGreaterThan(best!.vdot);
    expect(best).toMatchObject({ slug: 'afc' });
  });

  it('a B tune-up between AFC and Dodgers DOES supersede · authority, not priority-name', () => {
    const santaMonica = race({
      slug: 'santa-monica-10k', date: '2026-09-13', priority: 'B',
      distance_mi: TEN_K, finish_seconds: 2761, // 46:01 → the honest 10K for VDOT 44.1
    });
    // This lead sits AFTER AFC and BEFORE the B race, so AFC cannot resolve it
    // and only the B race or the jog can. The contrast below isolates which.
    const leadBetween = tempo('t-between', '2026-09-06');

    const withB = bestRecentVdot([AFC, santaMonica, DODGERS_JOGGED], TODAY, undefined, [leadBetween]);
    expect(withB.best?.source).toBe('race');

    // Drop the B race and the same lead leads again · the jog never resolved it.
    const withoutB = bestRecentVdot([AFC, DODGERS_JOGGED], TODAY, undefined, [leadBetween]);
    expect(withoutB.best).toMatchObject({ source: 'run', id: 't-between' });
  });

  it('and a lead acquired AFTER that B race still leads', () => {
    const santaMonica = race({
      slug: 'santa-monica-10k', date: '2026-09-13', priority: 'B',
      distance_mi: TEN_K, finish_seconds: 2761,
    });
    const { best } = bestRecentVdot(
      [AFC, santaMonica, DODGERS_JOGGED], TODAY, undefined, [LEAD_AFTER_AFC],
    );
    expect(best).toMatchObject({ source: 'run', id: 't-sep' });
  });

  it('sanity · the stated finish times round-trip to the stated VDOTs', () => {
    expect(vdotFromRace(AFC.finish_seconds!, AFC.distance_mi!)).toBe(44.1);
    expect(vdotFromRace(SOMBRERO.finish_seconds!, SOMBRERO.distance_mi!)).toBe(44.8);
    expect(vdotFromRace(BIG_SUR.finish_seconds!, BIG_SUR.distance_mi!)).toBe(42.8);
    expect(vdotFromRace(DODGERS_JOGGED.finish_seconds!, DODGERS_JOGGED.distance_mi!)).toBe(40);
    // and 50:00 really is a jog for him · his all-out 10K is 46:01.
    expect(predictRaceTime(44.1, TEN_K)).toBe(2761);
  });
});
