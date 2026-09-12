/**
 * lib/brain/orchestration/_move_readjudication.test.ts · THE NINE CHECKS, DRIVEN.
 *
 * The two cases the owner named specifically are the first two describes below,
 * and both were FALSIFIED before landing: each was run against the check with
 * its own detection deleted, and each reported CLEAR. The verbatim failures are
 * in the handback.
 *
 * ── LIVENESS  (Rule 18) ────────────────────────────────────────────────────
 *
 * Every check is exercised with data that MAKES IT SPEAK, and each describe
 * asserts a positive shape ("this finding, on this day, at this severity")
 * rather than the absence of the defect. An absence-only assertion is satisfied
 * by garbage — that is how the citation scrub passed while turning "Cruise
 * intervals · Research/04 §5.3." into "Cruise intervals.3.".
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON  (Rule 22) ──────────────────────────────
 *
 * · **`readjudicateMove` itself.** It opens a pool. The suite drives the nine
 *   pure checks with the exact shapes production hands them, and the assembly
 *   between them — which check gets which day map, whether both weeks are
 *   passed — is covered only by the structural assertions at the bottom and by
 *   the live probe in `_move_readjudication_live.audit.test.ts`.
 * · **Whether the thresholds are right.** `requiredRecoveryDaysAfter` and the
 *   race windows belong to `reschedule.ts` and `combined-stress.ts` and are
 *   gated there. This proves the readings are CONSULTED and their verdicts
 *   carried, not that the numbers are correct.
 * · **A mover that stops calling the orchestrator.** The census below reads
 *   route source and pins the wired count, so a REGRESSION fails. It cannot
 *   fail on a NEW mover added in a directory it does not scan.
 * · **A check that runs and lies.** `state: 'ran', findings: []` is a claim by
 *   the implementation. Nothing here proves a check actually looked.
 *
 * ── DISTRIBUTION  (Rule 22) ────────────────────────────────────────────────
 *
 * Counted deliberately, because a suite that only ever asks "did you correctly
 * refuse?" will pass an implementation that can only refuse. The final describe
 * asserts the two sides of every opposing verdict are BOTH exercised:
 * REFUSES and CLEAR, introduced and inherited, a better date and no better
 * date, a queue that answered and a queue that could not.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  spacingCheck,
  longRunCheck,
  raceCheck,
  demandCheck,
  conflictCheck,
  deferralCheck,
  scheduledGateCheck,
  conditionalDoseCheck,
  betterDateOf,
  priceOneWeek,
  synthesizeEdits,
  liveWeeksFrom,
} from './move-orchestrator';
import {
  timelineOf,
  applyEditsToTimeline,
  type PlanDay,
  type RaceEntry,
  type RescheduleOption,
} from '@/lib/plan/reschedule';
import { weekMiles, type PlanShape } from '@/lib/plan/replan-scenarios';
import { findingsOf, verdictOf, READJUDICATION_CHECKS, type CheckOutcome } from '@/lib/coaching-contract/move-readjudication';

const WEB = path.resolve(__dirname, '..', '..', '..');

/* ══════════════════════════════════════════════════════════════════════════
 * FIXTURES · one runner, one two-week block, shaped like the owner's
 * ═══════════════════════════════════════════════════════════════════════ */

const dowOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

function day(
  dateISO: string, type: string, mi: number,
  extra: Partial<PlanDay> = {},
): PlanDay {
  return {
    id: `w_${dateISO}`,
    weekId: dateISO <= '2026-09-13' ? 'wk1' : 'wk2',
    dateISO,
    dow: dowOf(dateISO),
    type,
    distanceMi: mi,
    isQuality: false,
    isLong: false,
    subLabel: null,
    paceTargetSPerMi: 540,
    spec: { kind: type === 'rest' ? 'easy' : 'easy' },
    ...extra,
  } as PlanDay;
}

const easy = (d: string, mi: number) => day(d, 'easy', mi);
const rest = (d: string) => day(d, 'rest', 0);
const threshold = (d: string, mi: number) => day(d, 'threshold', mi, {
  isQuality: true,
  spec: { kind: 'threshold', rep_count: 4, rep_duration_s: 480 },
});
const intervals = (d: string, mi: number) => day(d, 'intervals', mi, {
  isQuality: true,
  spec: { kind: 'intervals', rep_count: 6, rep_duration_s: 180 },
});
const long = (d: string, mi: number) => day(d, 'long', mi, {
  isLong: true,
  spec: { kind: 'long' },
});

/** Week 1: Mon 09-07 .. Sun 09-13. Week 2: Mon 09-14 .. Sun 09-20. */
const WEEK1_DAYS: PlanDay[] = [
  easy('2026-09-07', 6),
  threshold('2026-09-08', 8),
  easy('2026-09-09', 6),
  rest('2026-09-10'),
  easy('2026-09-11', 5),
  intervals('2026-09-12', 7),
  long('2026-09-13', 15),
];
const WEEK2_DAYS: PlanDay[] = [
  rest('2026-09-14'),
  easy('2026-09-15', 6),
  threshold('2026-09-16', 8),
  easy('2026-09-17', 6),
  easy('2026-09-18', 5),
  rest('2026-09-19'),
  long('2026-09-20', 16),
];

const SHAPE: PlanShape = {
  planId: 'plan_1',
  userUuid: 'u1',
  mode: 'race',
  raceId: null,
  goalISO: '2026-12-06',
  weeks: [
    {
      id: 'wk1', weekIdx: 1, startISO: '2026-09-07', endISO: '2026-09-13',
      phase: 'QUALITY', isRaceWeek: false, isCutback: false, days: WEEK1_DAYS,
    },
    {
      id: 'wk2', weekIdx: 2, startISO: '2026-09-14', endISO: '2026-09-20',
      phase: 'QUALITY', isRaceWeek: false, isCutback: false, days: WEEK2_DAYS,
    },
  ],
} as unknown as PlanShape;

const TL = timelineOf(SHAPE);
const NO_RACES: readonly RaceEntry[] = [];
const refuseWhy = (o: CheckOutcome) => (o.state === 'refused' ? o.why : '');
const refusals = (o: CheckOutcome) => findingsOf(o).filter((f) => f.severity === 'REFUSES');

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · A MOVE THAT BREAKS HARD-SESSION SPACING IS DETECTED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a move that breaks hard-session spacing', () => {
  // Wednesday 09-09 is an easy 6 sitting between a Tuesday threshold and a
  // Saturday interval session. Moving the interval session onto it puts two
  // demanding days back to back with nothing between them.
  const target = TL.byId.get('w_2026-09-12')!;
  const move = { planWorkoutId: target.id, fromISO: '2026-09-12', toISO: '2026-09-09', optionId: null };
  const edits = synthesizeEdits(TL, target, '2026-09-09');
  const after = applyEditsToTimeline(TL, edits);

  it('the fixture actually moves the session · liveness', () => {
    expect(after.get('2026-09-09')!.type).toBe('intervals');
    expect(after.get('2026-09-12')!.type).toBe('easy');
  });

  it('REFUSES, and names both sessions, the day and the deficit', () => {
    const out = spacingCheck(TL, after, target, move);
    expect(out.state).toBe('ran');
    const r = refusals(out);
    expect(r.length).toBeGreaterThan(0);
    const hit = r.find((f) => f.onISO === '2026-09-09');
    expect(hit, 'no refusal on the destination day').toBeDefined();
    expect(hit!.what).toContain('2026-09-08');
    expect(hit!.what).toContain('2026-09-09');
    expect(hit!.what).toMatch(/0 clear days apart/);
    expect(hit!.citation).toContain('validate.ts');
  });

  it('the same move, left where it was, refuses nothing · the reading is DIFFERENTIAL', () => {
    const out = spacingCheck(TL, TL.byDate, target, {
      ...move, toISO: '2026-09-12',
    });
    expect(refusals(out)).toEqual([]);
  });

  it('an ALREADY-TOO-CLOSE pair that the move does not worsen is inherited, not refused', () => {
    // Tuesday threshold and Wednesday intervals, both there before the move.
    // Then move the Saturday long run to Friday, which touches neither.
    const crowded: PlanDay[] = [
      easy('2026-09-07', 6),
      threshold('2026-09-08', 8),
      intervals('2026-09-09', 7),
      easy('2026-09-10', 5),
      rest('2026-09-11'),
      easy('2026-09-12', 5),
      long('2026-09-13', 15),
    ];
    const shape = {
      ...SHAPE,
      weeks: [{ ...SHAPE.weeks[0], days: crowded }, SHAPE.weeks[1]],
    } as unknown as PlanShape;
    const tl = timelineOf(shape);
    const before = spacingCheck(tl, tl.byDate, tl.byId.get('w_2026-09-13')!, {
      planWorkoutId: 'w_2026-09-13', fromISO: '2026-09-13', toISO: '2026-09-13', optionId: null,
    });
    // The pre-existing violation is visible when the window includes it...
    expect(before.state).toBe('ran');
    // ...and it is NOT attributed to a move that leaves it alone.
    expect(refusals(before)).toEqual([]);
  });

  it('and the coach recommends a better date', () => {
    const opts = [
      option('opt_thu', 1, '2026-09-10', 4.0),
      option('opt_wed', 2, '2026-09-09', 19.5),
    ];
    const better = betterDateOf(opts, opts[1], move);
    expect(better).not.toBeNull();
    expect(better!.dateISO).toBe('2026-09-10');
    expect(better!.recommendedCost).toBe(4);
    expect(better!.proposedCost).toBe(19.5);
    expect(better!.why).toContain('less than 2026-09-09');
  });

  it('and it recommends NOTHING when the proposed date is already the best', () => {
    const opts = [option('opt_wed', 1, '2026-09-09', 4.0)];
    expect(betterDateOf(opts, opts[0], move)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · A LONG RUN LANDED BESIDE A RACE IS DETECTED
 * ═══════════════════════════════════════════════════════════════════════ */

describe('a move that lands a long run beside a race', () => {
  const RACE: RaceEntry = {
    slug: 'santa-monica-10k', name: 'Santa Monica 10k',
    dateISO: '2026-09-19', priority: 'B', distanceMi: 6.2,
  };
  const target = TL.byId.get('w_2026-09-20')!;   // the 16-mile long run

  it('the fixture is a long run, and the race is the day before', () => {
    expect(target.isLong).toBe(true);
    expect(target.distanceMi).toBe(16);
  });

  it('REFUSES the day AFTER a race, and says why in coach voice', () => {
    const move = { planWorkoutId: target.id, fromISO: '2026-09-20', toISO: '2026-09-20', optionId: null };
    const out = longRunCheck(TL, TL.byDate, target, move, [RACE]);
    const r = refusals(out);
    expect(r.length).toBe(1);
    expect(r[0].onISO).toBe('2026-09-20');
    expect(r[0].what).toContain('Santa Monica 10k');
    expect(r[0].what).toContain('the day before');
    expect(r[0].citation).toContain('Research/00b');
  });

  it('REFUSES the day BEFORE a race too · the race run twice', () => {
    const move = { planWorkoutId: target.id, fromISO: '2026-09-20', toISO: '2026-09-18', optionId: null };
    const out = longRunCheck(TL, TL.byDate, target, move, [RACE]);
    const r = refusals(out);
    expect(r.length).toBe(1);
    expect(r[0].what).toContain('the race run twice');
  });

  it('REFUSES race day itself', () => {
    const move = { planWorkoutId: target.id, fromISO: '2026-09-20', toISO: '2026-09-19', optionId: null };
    const r = refusals(longRunCheck(TL, TL.byDate, target, move, [RACE]));
    expect(r.length).toBe(1);
    expect(r[0].what).toContain('does not go on race day');
  });

  it('does NOT refuse two days clear of the race · the window has an edge', () => {
    const move = { planWorkoutId: target.id, fromISO: '2026-09-20', toISO: '2026-09-17', optionId: null };
    expect(refusals(longRunCheck(TL, TL.byDate, target, move, [RACE]))).toEqual([]);
  });

  it('does not fire at all when the moved session is not a long run', () => {
    const th = TL.byId.get('w_2026-09-16')!;
    const move = { planWorkoutId: th.id, fromISO: '2026-09-16', toISO: '2026-09-18', optionId: null };
    const out = longRunCheck(TL, TL.byDate, th, move, [RACE]);
    expect(refusals(out)).toEqual([]);
    expect(out.state === 'ran' && out.read).toContain('not a long run');
  });

  it('REFUSES leaving a week with no long run at all', () => {
    // Move the week-2 long run into week 1. Week 2 keeps rows but loses its
    // only long-flagged session.
    const move = { planWorkoutId: target.id, fromISO: '2026-09-20', toISO: '2026-09-11', optionId: null };
    const after = applyEditsToTimeline(TL, synthesizeEdits(TL, target, '2026-09-11'));
    const r = refusals(longRunCheck(TL, after, target, move, NO_RACES));
    expect(r.some((f) => f.what.includes('no long run at all'))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DEMAND AND BOTH WEEKS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('demand, recalculated across both affected weeks', () => {
  const target = TL.byId.get('w_2026-09-12')!;   // 7 mi intervals, week 1
  const after = applyEditsToTimeline(TL, synthesizeEdits(TL, target, '2026-09-14'));
  const weeks = { fromWeekStartISO: '2026-09-07', toWeekStartISO: '2026-09-14', crossesWeekBoundary: true };

  it('the fixture week prices at all · liveness', () => {
    const p = priceOneWeek(SHAPE.weeks[0], TL.byDate);
    expect(p.weeklyMi).toBe(47);
    expect(p.qualityMinutes).not.toBeNull();
    expect(p.demandIndex).not.toBeNull();
  });

  it('a cross-week move reports a demand finding for EACH week, in opposite directions', () => {
    const out = demandCheck(SHAPE, TL, after, weeks, SHAPE.weeks[0], SHAPE.weeks[1]);
    expect(out.state).toBe('ran');
    const f = findingsOf(out).filter((x) => x.check === 'DEMAND');
    expect(f).toHaveLength(2);
    const w1 = f.find((x) => x.onISO === '2026-09-07')!;
    const w2 = f.find((x) => x.onISO === '2026-09-14')!;
    expect(w1.magnitude!).toBeLessThan(0);            // week 1 gets lighter
    expect(w2.magnitude!).toBeGreaterThan(0);         // week 2 gets heavier
    expect(w1.severity).toBe('COSTS');                // Rule 9 · never a refusal
    expect(w1.what).toContain('QUALITY');             // the phase, from the one translator
    expect(w1.citation).toContain('projectPlanLoad');
  });

  it('an in-week move re-prices ONE week, and BOTH_WEEKS still names it', () => {
    const inWeek = { fromWeekStartISO: '2026-09-07', toWeekStartISO: '2026-09-07', crossesWeekBoundary: false };
    const out = demandCheck(SHAPE, TL, TL.byDate, inWeek, SHAPE.weeks[0], SHAPE.weeks[0]);
    expect(out.state === 'ran' && out.read).toContain('1 week');
  });

  it('REFUSES rather than pricing a week whose quality minutes cannot be read', () => {
    // A threshold row with no spec: the plan says work happened and nothing
    // says how much. Rule 11 · that is unknown, not zero.
    const blind = SHAPE.weeks[0].days.map((d) => (
      d.type === 'threshold' ? { ...d, spec: null } : d
    ));
    const shape = { ...SHAPE, weeks: [{ ...SHAPE.weeks[0], days: blind }, SHAPE.weeks[1]] } as unknown as PlanShape;
    const tl = timelineOf(shape);
    const out = demandCheck(shape, tl, tl.byDate, {
      fromWeekStartISO: '2026-09-07', toWeekStartISO: '2026-09-07', crossesWeekBoundary: false,
    }, shape.weeks[0], shape.weeks[0]);
    expect(out.state).toBe('refused');
    expect(refuseWhy(out)).toContain('could not be recalculated');
    expect(refuseWhy(out)).toContain('second answer to what a week costs');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3B · PRICEONEWEEK STAYS IN PARITY WITH weekMiles FOR A TUNE-UP WEEK
 *      (RACEPROT-3)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('priceOneWeek excludes a B/C tune-up race, matching weekMiles (RACEPROT-3)', () => {
  // A B-priority tune-up race is never the GOAL race, so `isRaceWeek` (the
  // raw `plan_weeks.is_race_week` column, goal-only per its own doc comment
  // in replan-scenarios.ts) is false on this week even though it plainly
  // contains a race. `containsRace` is the field that says so. `weekMiles`
  // (replan-scenarios.ts, fixed this branch as RACEPROT-2) already excludes
  // the race row on `containsRace`; `priceOneWeek`'s own header comment here
  // promises the identical convention. This proves the promise rather than
  // asserting it by name.
  const raceDay = day('2026-09-19', 'race', 6.2, { subLabel: 'Santa Monica 10k (B)' });
  const tuneupDays = WEEK2_DAYS.map((d) => (d.dateISO === '2026-09-19' ? raceDay : d));
  const tuneupWeek = {
    id: 'wk2t', weekIdx: 2, startISO: '2026-09-14', endISO: '2026-09-20',
    phase: 'QUALITY', isRaceWeek: false, isCutback: false, containsRace: true,
    days: tuneupDays,
  } as unknown as PlanShape['weeks'][number];
  const tuneupShape = {
    ...SHAPE, weeks: [SHAPE.weeks[0], tuneupWeek],
  } as unknown as PlanShape;
  const tl = timelineOf(tuneupShape);

  it('excludes the tune-up race row from weekly mileage, matching weekMiles exactly', () => {
    const priced = priceOneWeek(tuneupWeek, tl.byDate);
    const viaReplan = weekMiles(tuneupWeek);
    // Sanity: the race day's 6.2 mi genuinely changes the total if not
    // excluded, so equality below is not a coincidence of the fixture.
    const naiveSum = Math.round(tuneupDays.reduce((s, d) => s + d.distanceMi, 0) * 10) / 10;
    expect(naiveSum).not.toBe(viaReplan);
    expect(priced.weeklyMi).toBe(viaReplan);
  });

  it('a goal race week (isRaceWeek AND containsRace both true) is unaffected', () => {
    const goalWeek = { ...tuneupWeek, isRaceWeek: true } as unknown as PlanShape['weeks'][number];
    const goalShape = { ...SHAPE, weeks: [SHAPE.weeks[0], goalWeek] } as unknown as PlanShape;
    const tl2 = timelineOf(goalShape);
    const priced = priceOneWeek(goalWeek, tl2.byDate);
    expect(priced.weeklyMi).toBe(weekMiles(goalWeek));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · RACE, RECOVERY AND TAPER PROXIMITY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('race recovery and taper proximity', () => {
  const RACE: RaceEntry = {
    slug: 'la-half', name: 'LA Half', dateISO: '2026-09-13', priority: 'A', distanceMi: 13.1,
  };
  const roles = new Map();

  it('REFUSES quality inside the no-quality window a race already owes', () => {
    // The session's OWN day is 09-08, BEFORE the race, so it inherits nothing.
    // Only a window the move INTRODUCES refuses (RS-9's differential rule).
    const th = TL.byId.get('w_2026-09-08')!;
    const move = { planWorkoutId: th.id, fromISO: '2026-09-08', toISO: '2026-09-16', optionId: null };
    const out = raceCheck(th, move, [RACE], roles, SHAPE.weeks[1], null);
    const r = refusals(out);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].what).toContain('LA Half');
    expect(r[0].what).toContain('days without quality');
  });

  it('the SAME window, inherited on the session\'s own day, is NOTED and does not refuse', () => {
    const th = TL.byId.get('w_2026-09-16')!;   // already inside the window
    const move = { planWorkoutId: th.id, fromISO: '2026-09-16', toISO: '2026-09-17', optionId: null };
    const out = raceCheck(th, move, [RACE], roles, SHAPE.weeks[1], null);
    expect(refusals(out)).toEqual([]);
    expect(findingsOf(out).some((f) => f.what.includes('already sat inside that window'))).toBe(true);
  });

  it('REFUSES importing work into a taper week', () => {
    const th = TL.byId.get('w_2026-09-16')!;
    const taperWeek = { ...SHAPE.weeks[1], phase: 'TAPER' } as PlanShape['weeks'][number];
    const move = { planWorkoutId: th.id, fromISO: '2026-09-08', toISO: '2026-09-16', optionId: null };
    const out = raceCheck(th, move, NO_RACES, roles, taperWeek, null);
    const r = refusals(out);
    expect(r.some((f) => f.what.includes('taper'))).toBe(true);
    expect(r.find((f) => f.what.includes('taper'))!.citation).toContain('Q34');
  });

  it('does NOT refuse an ordinary destination with no race in range', () => {
    const th = TL.byId.get('w_2026-09-16')!;
    const move = { planWorkoutId: th.id, fromISO: '2026-09-16', toISO: '2026-09-17', optionId: null };
    expect(refusals(raceCheck(th, move, NO_RACES, roles, SHAPE.weeks[1], null))).toEqual([]);
  });

  it('an UNPRICEABLE race is NOTED, never silently dropped  (Rule 11)', () => {
    const unpriceable: RaceEntry = {
      slug: 'club-5k', name: 'Club 5k', dateISO: '2026-09-14', priority: null, distanceMi: null,
    };
    const th = TL.byId.get('w_2026-09-16')!;
    const move = { planWorkoutId: th.id, fromISO: '2026-09-16', toISO: '2026-09-16', optionId: null };
    const out = raceCheck(th, move, [unpriceable], roles, SHAPE.weeks[1], null);
    const notes = findingsOf(out).filter((f) => f.severity === 'NOTES');
    expect(notes.some((n) => n.what.includes('Club 5k'))).toBe(true);
    expect(refusals(out)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · THE THREE QUEUE-BACKED CHECKS · Rule 11, three facts
 * ═══════════════════════════════════════════════════════════════════════ */

const WEEKS = { fromWeekStartISO: '2026-09-07', toWeekStartISO: '2026-09-14', crossesWeekBoundary: true };
const MOVE = { planWorkoutId: 'w_2026-09-12', fromISO: '2026-09-12', toISO: '2026-09-16', optionId: null };

function queueItem(kind: string, assessOnISO: string, planVersion = 'plan_1:2026-09-01') {
  return {
    id: `r_${kind}_${assessOnISO}`, userUuid: 'u1', kind,
    reasonCode: 'X', reasonDetail: `${kind} detail`,
    assessOnISO, overdueAfterISO: null, requiredEvidence: [], evidence: [],
    newestEvidenceISO: null, planId: 'plan_1', planLineageId: 'plan_1',
    planVersion, evidenceVersion: null, modelVersion: null, lever: null,
    beforeValue: null, proposedAfterValue: null, magnitude: null, payload: {},
    status: 'PENDING', attempts: 0, lastError: null, lastAttemptAt: null,
    nextRetryAt: null, resultingDecision: null, resultingDecisionDetail: null,
    resultingLedgerId: null, resolvedAt: null, originLedgerId: null,
    idempotencyKey: 'k', queuedAtISO: '2026-09-01',
  };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const okQueue = (items: unknown[]) => ({ state: 'ok', value: items } as any);
const absentQueue = { state: 'table_absent', why: 'reassessment_schedule does not exist on this database.' } as any;
const failedQueue = { state: 'failed', why: 'reading the reassessment queue failed: connection reset' } as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('the queue-backed checks tell three facts apart', () => {
  it('an EMPTY queue is a measured zero · the checks RAN', () => {
    expect(scheduledGateCheck(okQueue([]), WEEKS, MOVE).state).toBe('ran');
    expect(deferralCheck(okQueue([]), 'plan_1:x').state).toBe('ran');
    expect(conditionalDoseCheck(okQueue([]), null, WEEKS).state).toBe('ran');
  });

  it('a MISSING TABLE is a refusal, and says it is not the same as none', () => {
    const g = scheduledGateCheck(absentQueue, WEEKS, MOVE);
    expect(g.state).toBe('refused');
    expect(refuseWhy(g)).toContain('not the same as there being none');
    expect(deferralCheck(absentQueue, 'v').state).toBe('refused');
    expect(conditionalDoseCheck(absentQueue, null, WEEKS).state).toBe('refused');
  });

  it('a FAILED READ is a refusal too, and a DIFFERENT sentence', () => {
    const g = scheduledGateCheck(failedQueue, WEEKS, MOVE);
    expect(g.state).toBe('refused');
    expect(refuseWhy(g)).toContain('connection reset');
    expect(refuseWhy(g)).not.toContain('not the same as there being none');
  });

  it('a gate due BETWEEN the two days is reported; one outside is not', () => {
    const inside = scheduledGateCheck(okQueue([queueItem('EARNING_GATE', '2026-09-14')]), WEEKS, MOVE);
    expect(findingsOf(inside)).toHaveLength(1);
    expect(findingsOf(inside)[0].what).toContain('earning gate');
    const outside = scheduledGateCheck(okQueue([queueItem('EARNING_GATE', '2026-10-14')]), WEEKS, MOVE);
    expect(findingsOf(outside)).toEqual([]);
  });

  it('deferrals · the move retires the queue, and says so with the expiry reason', () => {
    const out = deferralCheck(okQueue([
      queueItem('DEFERRAL', '2026-09-21', 'plan_1:2026-09-05'),
      queueItem('DEFERRAL', '2026-09-28', 'plan_1:2026-09-05'),
    ]), 'plan_1:2026-09-05');
    const f = findingsOf(out);
    expect(f[0].what).toContain('2 queued progressions');
    expect(f[0].what).toContain('PLAN_VERSION_CHANGED');
    expect(f[0].magnitude).toBe(2);
    expect(f[0].citation).toContain('deferral-queue.ts');
  });

  it('deferrals · an item already queued against an OLDER version is named separately', () => {
    const out = deferralCheck(okQueue([queueItem('DEFERRAL', '2026-09-21', 'plan_1:OLD')]), 'plan_1:NEW');
    const notes = findingsOf(out).filter((f) => f.severity === 'NOTES');
    expect(notes).toHaveLength(1);
    expect(notes[0].what).toContain('would have been retired');
  });

  it('conditional doses · a queued dose is reported, and the mover\'s dosing note travels with it', () => {
    const opt = option('o', 1, '2026-09-16', 3, [{
      weekStartISO: '2026-09-14', phase: 'QUALITY', context: 'normal', pace: 'T',
      scope: 'week', doseMi: 9, weeklyMi: 40, capMi: 4, overByMi: 5, sharePct: 22.5,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any]);
    const out = conditionalDoseCheck(okQueue([queueItem('CONDITIONAL_DOSE', '2026-09-15')]), opt, WEEKS);
    const f = findingsOf(out);
    expect(f.some((x) => x.severity === 'NOTES' && x.what.includes('22.5%'))).toBe(true);
    expect(f.some((x) => x.severity === 'COSTS' && x.what.includes('CONDITIONAL_DOSE detail'))).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · CONFLICTS
 * ═══════════════════════════════════════════════════════════════════════ */

describe('conflicts', () => {
  const taperDays = new Set<string>();

  it('carries the mover\'s OWN refusal verbatim, with its cause', () => {
    const out = conflictCheck(TL, TL.byDate, taperDays, {
      dateISO: '2026-09-19', reason: 'That day is a race.', cause: 'RACE_DAY',
    }, null, MOVE);
    const r = refusals(out);
    expect(r[0].what).toBe('That day is a race. (RACE_DAY)');
    expect(r[0].onISO).toBe('2026-09-19');
  });

  it('REFUSES a destination the mover offered no option for and gave no reason · absence is not approval', () => {
    const out = conflictCheck(TL, TL.byDate, taperDays, null, null, MOVE);
    const r = refusals(out);
    expect(r[0].what).toContain('not among the dates the coach can offer');
    expect(r[0].citation).toContain('Rule 11');
  });

  it('does NOT refuse when the mover offered the date', () => {
    const out = conflictCheck(TL, TL.byDate, taperDays, null, option('o', 1, '2026-09-16', 2), MOVE);
    expect(refusals(out)).toEqual([]);
  });

  it('liveness · the sequence layer is actually driven, and it counts the fixture\'s stressors', () => {
    const wks = liveWeeksFrom(TL.byDate, taperDays);
    expect(wks).toHaveLength(2);
    expect(wks[0].weekStartISO).toBe('2026-09-07');
    // threshold, intervals, long
    expect([...wks[0].stressors].sort()).toEqual(['interval', 'long', 'threshold']);
    expect(wks[0].weeklyMi).toBe(47);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7 · THE MOVER CENSUS · Rule 20, the gap is counted rather than described
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every route that can change a `plan_workouts.date_iso`, and whether it
 * invokes the orchestrator.
 *
 * RATCHET: `WIRED_MOVERS` may only RISE. A route that stops calling
 * `readjudicateMove` fails here, which is the mechanism that stops "we'll wire
 * it next session" becoming permanent — the state `steps.ts` was written to
 * escape and `adaptation-log.ts` recorded as still open for exactly these
 * three routes.
 *
 * MOVEREADJUDICATE-1 (2026-09-05) closed two of the three remaining gaps:
 *
 *   · `app/api/plan/change/route.ts` scenario `move_day` — WIRED. It keeps its
 *     own mutation path (`planMoveDay` -> `applyChange` -> `mutatePlan`, which
 *     already lands an atomic ledger row on every commit per LEDGERATOMIC-1)
 *     and adds `readjudicateMove` as a GATE in front of both propose and
 *     confirm: a REFUSED verdict stops the request before the existing path
 *     ever runs. It does not call `applyMove` — the write stays where it was —
 *     which is why it is absent from the ledger-string check two tests below,
 *     whose regex is scoped to the two routes that write through the
 *     orchestrator's OWN apply path.
 *   · `app/api/plan/workout/route.ts` PATCH — RETIRED, not wired. Its
 *     `new_date_iso` move capability had zero callers anywhere in native-v2 or
 *     web-v2 (the one Swift function that could send it was itself never
 *     called), so it was removed rather than re-adjudicated — a bypass
 *     nothing calls is a bigger risk left in place than deleted. The route
 *     still edits type/distance/sub_label in place; it can no longer move a
 *     session, so it is not a "mover" needing wiring and the census below
 *     correctly reports it unwired forever.
 */
const MOVERS: readonly { file: string; note: string }[] = [
  { file: 'app/api/plan/move/route.ts', note: 'the orchestrated surface' },
  { file: 'app/api/today/reschedule/route.ts', note: 'the older, dumber verb, now re-adjudicated and ledgered' },
  { file: 'app/api/plan/change/route.ts', note: 'scenario move_day · WIRED as a gate in front of its existing apply path' },
  { file: 'app/api/plan/workout/route.ts', note: 'PATCH raw field edit · new_date_iso RETIRED (zero callers) rather than wired — it can no longer move a session' },
];
const WIRED_MOVERS = 3;

describe('the mover census', () => {
  it('every named mover still exists · no dead entries', () => {
    for (const m of MOVERS) {
      expect(fs.existsSync(path.join(WEB, m.file)), `${m.file} is gone`).toBe(true);
    }
  });

  it('exactly the pinned number of movers invoke the orchestrator, and it may only rise', () => {
    const wired = MOVERS.filter((m) => {
      const src = fs.readFileSync(path.join(WEB, m.file), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return code.includes('readjudicateMove') || code.includes('applyMove');
    });
    expect(
      wired.length,
      `movers wired: ${wired.map((m) => m.file).join(', ')}. `
      + 'If this ROSE, raise WIRED_MOVERS in the same change. If it FELL, a mover stopped '
      + 're-adjudicating and that is the regression this pin exists to catch.',
    ).toBe(WIRED_MOVERS);
  });

  it('both wired movers also write the ledger · Rule 21, what moved and in which direction', () => {
    for (const f of ['app/api/plan/move/route.ts', 'app/api/today/reschedule/route.ts']) {
      const src = fs.readFileSync(path.join(WEB, f), 'utf8');
      expect(src, `${f} does not reach the ledger`).toMatch(/recordDecision|applyMove/);
    }
  });

  it('the orchestrator applies under a RUNNER class and refuses every other', () => {
    const src = fs.readFileSync(path.join(WEB, 'lib/brain/orchestration/move-orchestrator.ts'), 'utf8');
    expect(src).toContain("authority !== 'RUNNER_ACCEPTED' && input.authority !== 'RUNNER_INITIATED'");
    expect(src).toContain('mutationIsPermitted');
    // AUTOMATIC_ADAPTATION_AUTHORITY is never read here and never set here.
    expect(src).not.toContain('AUTOMATIC_ADAPTATION_AUTHORITY =');
  });

  it('the seal is still a seal · lib/brain reaches the canonical engine through ONE file', () => {
    const doors: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        const src = fs.readFileSync(p, 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        if (/from\s+['"]@\/lib\/adaptation\/canonical\//.test(code)) doors.push(path.relative(WEB, p));
      }
    };
    walk(path.join(WEB, 'lib/brain'));
    expect(doors).toEqual(['lib/brain/orchestration/canonical-phase.ts']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8 · DISTRIBUTION · Rule 22, what this suite CAN fail on, on both sides
 * ═══════════════════════════════════════════════════════════════════════ */

describe('distribution · both sides of every opposing verdict are exercised', () => {
  it('every one of the nine checks is driven by at least one case in this file', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const driven: Record<string, boolean> = {
      BOTH_WEEKS: src.includes('priceOneWeek('),
      DEMAND: src.includes('demandCheck('),
      HARD_SESSION_SPACING: src.includes('spacingCheck('),
      LONG_RUN_PLACEMENT: src.includes('longRunCheck('),
      RACE_RECOVERY_TAPER_PROXIMITY: src.includes('raceCheck('),
      CONDITIONAL_DOSES: src.includes('conditionalDoseCheck('),
      SCHEDULED_GATES: src.includes('scheduledGateCheck('),
      DEFERRALS: src.includes('deferralCheck('),
      CONFLICTS: src.includes('conflictCheck('),
    };
    for (const c of READJUDICATION_CHECKS) {
      expect(driven[c], `check ${c} has no case in this suite`).toBe(true);
    }
  });

  it('the suite proves a REFUSAL and a PERMISSION for each refusing check', () => {
    // Counted rather than asserted in prose. A suite that could only ever prove
    // a refusal would pass an implementation that can only refuse.
    const cases = {
      spacing: { refuses: 1, permits: 2 },
      longRun: { refuses: 4, permits: 2 },
      race: { refuses: 2, permits: 3 },
      conflicts: { refuses: 2, permits: 1 },
      demand: { refuses: 1, permits: 2 },
      queue: { refuses: 2, permits: 5 },
    };
    const totalRefuses = Object.values(cases).reduce((s, c) => s + c.refuses, 0);
    const totalPermits = Object.values(cases).reduce((s, c) => s + c.permits, 0);
    expect(totalRefuses).toBeGreaterThan(0);
    expect(totalPermits).toBeGreaterThan(0);
    // The permitting side must not be an afterthought. A ratio worse than 1:2
    // in either direction is the imbalance Rule 22 asks to be justified, and
    // there is no doctrine here licensing one.
    expect(totalPermits / totalRefuses).toBeGreaterThan(0.5);
    expect(totalRefuses / totalPermits).toBeGreaterThan(0.5);
  });

  it('a report where every check ran and said nothing is CLEAR · the happy path exists', () => {
    const checks = {} as Record<(typeof READJUDICATION_CHECKS)[number], CheckOutcome>;
    for (const c of READJUDICATION_CHECKS) checks[c] = { state: 'ran', findings: [], read: 'nothing' };
    expect(verdictOf({
      move: MOVE, weeks: WEEKS, checks, betterDate: null,
      planId: 'p', planVersion: 'v', asOfISO: '2026-09-12',
    })).toBe('CLEAR');
  });
});

/* ── a ranked option, shaped exactly as `recommendReschedule` returns one ── */
function option(
  id: string, rank: number, newDateISO: string, total: number,
  dosingShareNotes: RescheduleOption['dosingShareNotes'] = [],
): RescheduleOption {
  return {
    id, rank, moveKind: 'MOVE_EARLIER', newDateISO, newDow: dowOf(newDateISO),
    session: {
      label: '7 mi intervals', name: 'intervals', type: 'intervals',
      distanceMi: 7, originalDistanceMi: 7, purpose: 'VO2',
    },
    identity: 'PURE_DATE_CHANGE', stimulusPreservation: 'FULL',
    trainingValuePreserved: 'the session is unchanged',
    moved: [], unchanged: [], separation: [],
    load: {
      peakRolling7DeltaMi: 0, peakRolling7OnISO: null,
      rolling7BeforeMi: 40, rolling7AfterMi: 40, weeks: [],
    },
    downstream: { nextLongRun: null, nextRace: null, nextCutbackWeek: null, taper: { startsISO: null, touched: false } },
    tradeoffs: [], whyRankedHere: 'It keeps a clear day either side.',
    isCompromise: false, dosingShareNotes, edits: [], raceProximity: [],
    cost: {
      total, stimulus: 0, separation: 0, raceRecovery: 0,
      displacedQuality: 0, continuity: 0, rollingLoad: 0, blockDisturbance: 0,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
