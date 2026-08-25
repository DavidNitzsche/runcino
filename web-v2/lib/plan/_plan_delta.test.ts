/**
 * THE LINE THE RUNNER SHOULD HAVE READ ON 2026-08-25.
 *
 * The incident: the `plan-drift` cron fired `long_drift`, archived a fourteen-
 * day recovery block mid-flight and authored a seven-day one. The week went
 * from 23 miles to 38 and the long run from 7 to 13. Nothing on any surface
 * said so; the runner found out because the week counter reset.
 *
 * Those numbers are the fixture. `describeDelta` has to produce a sentence a
 * person can act on from them, and `samePrescription` has to be able to tell
 * the difference between a rebuild that did that and one that did nothing.
 *
 * The gate direction that matters: `samePrescription` returning TRUE wrongly
 * suppresses a real change, which is the dangerous failure. So most of what is
 * asserted below is that it says FALSE for every field a runner could notice.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDelta, describeDelta, samePrescription, prescriptionFingerprint,
  dayFingerprint, EMPTY_PRESCRIPTION,
  type PlanPrescription, type PrescribedDay,
} from './plan-delta';

const MON = '2026-08-24'; // the week containing the incident
const TODAY = '2026-08-25';

function day(dateISO: string, over: Partial<PrescribedDay> = {}): PrescribedDay {
  return {
    dateISO,
    type: 'easy',
    distanceMi: 4,
    paceTargetSPerMi: 537,
    subLabel: null,
    workoutSpec: null,
    isQuality: false,
    isLong: false,
    notes: null,
    ...over,
  };
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

/** A week whose days sum to `weekMi` with a long run of `longMi`. */
function block(
  planId: string,
  weekStarts: string[],
  shape: { weekMi: number; longMi: number },
): PlanPrescription {
  const days: PrescribedDay[] = [];
  for (const start of weekStarts) {
    const filler = (shape.weekMi - shape.longMi) / 4;
    days.push(day(start, { type: 'rest', distanceMi: 0 }));
    days.push(day(addDays(start, 1), { distanceMi: filler }));
    days.push(day(addDays(start, 2), { distanceMi: filler }));
    days.push(day(addDays(start, 3), { type: 'rest', distanceMi: 0 }));
    days.push(day(addDays(start, 4), { distanceMi: filler }));
    days.push(day(addDays(start, 5), { distanceMi: filler }));
    days.push(day(addDays(start, 6), { type: 'long', distanceMi: shape.longMi, isLong: true }));
  }
  return {
    planId,
    mode: 'recovery',
    raceId: null,
    goalISO: '2026-12-06',
    weeks: weekStarts.map((s) => ({ startISO: s, phase: 'RECOVERY', isRaceWeek: false, isCutback: false })),
    days,
  };
}

/** The block he was in: fourteen days, 23 miles a week, 7-mile long run. */
const FOURTEEN_DAY = block('pln_old', [MON, addDays(MON, 7)], { weekMi: 23, longMi: 7 });
/** What the cron wrote: seven days, 38 miles, 13-mile long run. */
const SEVEN_DAY = block('pln_new', [MON], { weekMi: 38, longMi: 13 });

describe('the 2026-08-25 incident, as a sentence', () => {
  it('says what moved, in miles, in coach voice', () => {
    const delta = computeDelta(FOURTEEN_DAY, SEVEN_DAY, TODAY);
    expect(delta.thisWeekMiFrom).toBe(23);
    expect(delta.thisWeekMiTo).toBe(38);
    expect(delta.longRunMiFrom).toBe(7);
    expect(delta.longRunMiTo).toBe(13);

    const line = describeDelta(delta, 'long_drift');
    expect(line).toBe('Drift raised this week from 23 to 38 miles, and the long run from 7 to 13.');
  });

  it('holds the coach-voice rules', () => {
    const line = describeDelta(computeDelta(FOURTEEN_DAY, SEVEN_DAY, TODAY), 'long_drift') ?? '';
    expect(line).not.toMatch(/!/);           // no exclamation marks
    expect(line).not.toMatch(/[—–]/);        // no em or en dashes
    expect(line).not.toMatch(/\p{Extended_Pictographic}/u); // no emoji
    // Never scolds. The runner did not do anything wrong by having his plan
    // rebuilt for him at half past nine in the morning.
    expect(line.toLowerCase()).not.toMatch(/you should|you need to|too (much|little)/);
    expect(line.length).toBeLessThan(120);
  });

  it('notices the block got shorter, which is what reset his week counter', () => {
    const delta = computeDelta(FOURTEEN_DAY, SEVEN_DAY, TODAY);
    expect(delta.weeksFrom).toBe(2);
    expect(delta.weeksTo).toBe(1);
    expect(delta.lastDayFrom).toBe(addDays(MON, 13));
    expect(delta.lastDayTo).toBe(addDays(MON, 6));
  });

  it('says "cut" when the numbers go the other way', () => {
    const line = describeDelta(computeDelta(SEVEN_DAY, FOURTEEN_DAY, TODAY), 'volume_drift');
    expect(line).toBe('Drift cut this week from 38 to 23 miles, and the long run from 13 to 7.');
  });

  it('names the trigger honestly and never guesses at one', () => {
    const delta = computeDelta(FOURTEEN_DAY, SEVEN_DAY, TODAY);
    expect(describeDelta(delta, 'replan')).toMatch(/^Your settings raised/);
    expect(describeDelta(delta, 'race_date_changed')).toMatch(/^The new race date raised/);
    // A kind this module has never heard of gets the neutral subject, NOT a
    // fabricated cause. "Drift raised your week" about a settings change would
    // be telling the runner something untrue about his own training.
    expect(describeDelta(delta, 'some_future_kind')).toMatch(/^The plan raised/);
  });
});

describe('samePrescription · the gate that stops a no-op rebuild', () => {
  it('is true only when the two blocks are genuinely identical', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    // Different plan ids, identical content. The plan id is deliberately NOT
    // part of the fingerprint: every rebuild mints a new one, so including it
    // would make the gate structurally incapable of ever firing.
    expect(a.planId).not.toBe(b.planId);
    expect(samePrescription(a, b)).toBe(true);
    expect(describeDelta(computeDelta(a, b, TODAY), 'staleness')).toBeNull();
  });

  it('is false for the incident', () => {
    expect(samePrescription(FOURTEEN_DAY, SEVEN_DAY)).toBe(false);
  });

  // THE IMPORTANT DIRECTION. Each of these is a field a runner can read as an
  // instruction. A fingerprint that ignored any one of them would let a real
  // change be silently suppressed, which is strictly worse than a gate that
  // never fires.
  const noticeable: Array<[string, Partial<PrescribedDay>]> = [
    ['distance', { distanceMi: 9 }],
    ['type', { type: 'tempo' }],
    ['target pace', { paceTargetSPerMi: 400 }],
    ['quality flag', { isQuality: true }],
    ['long flag', { isLong: true }],
    ['sub-label', { subLabel: '4 x 1 mile @ T' }],
    ['notes', { notes: 'hills' }],
    ['workout spec', { workoutSpec: { reps: 6, distanceMi: 0.5 } }],
  ];
  for (const [what, over] of noticeable) {
    it(`is false when the ${what} moves`, () => {
      const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
      const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
      b.days[1] = { ...b.days[1], ...over };
      expect(samePrescription(a, b)).toBe(false);
    });
  }

  it('is false when the block re-points at a different race', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = { ...block('pln_b', [MON], { weekMi: 23, longMi: 7 }), raceId: 'cim-2026' };
    // This is the race_graduate case. The days can legitimately come out
    // identical while the block now targets a different race, and archiving the
    // old one is exactly right there.
    expect(samePrescription(a, b)).toBe(false);
  });

  it('is false when the week shape moves but the days do not', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    b.weeks = [{ ...b.weeks[0], isCutback: true }];
    expect(samePrescription(a, b)).toBe(false);
  });

  it('is false when a day is added or removed', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    b.days = b.days.slice(0, -1);
    expect(samePrescription(a, b)).toBe(false);
  });

  it('never fires against an empty side', () => {
    // A first authoring and an empty result are both cases where "nothing
    // changed" is a lie, and where rolling back would leave the runner with no
    // plan at all.
    expect(samePrescription(EMPTY_PRESCRIPTION, SEVEN_DAY)).toBe(false);
    expect(samePrescription(SEVEN_DAY, EMPTY_PRESCRIPTION)).toBe(false);
    expect(samePrescription(EMPTY_PRESCRIPTION, EMPTY_PRESCRIPTION)).toBe(false);
  });

  it('is stable against jsonb key order, which Postgres does not promise', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    a.days[1] = { ...a.days[1], workoutSpec: { reps: 6, restS: 90, distanceMi: 0.5 } };
    b.days[1] = { ...b.days[1], workoutSpec: { distanceMi: 0.5, reps: 6, restS: 90 } };
    expect(samePrescription(a, b)).toBe(true);
  });

  it('does NOT reorder arrays inside a spec · a resequenced workout is a change', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    a.days[1] = { ...a.days[1], workoutSpec: { segments: ['warmup', 'tempo', 'cooldown'] } };
    b.days[1] = { ...b.days[1], workoutSpec: { segments: ['tempo', 'warmup', 'cooldown'] } };
    expect(samePrescription(a, b)).toBe(false);
  });

  it('ignores row order · the same days read back in any order are the same block', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = { ...block('pln_b', [MON], { weekMi: 23, longMi: 7 }) };
    b.days = [...b.days].reverse();
    // `plan_workouts` is read with no ORDER BY, so this is not hypothetical.
    expect(samePrescription(a, b)).toBe(true);
  });

  it('treats 7 and 7.0 as the same distance', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7.0 });
    expect(dayFingerprint(a.days[6])).toBe(dayFingerprint(b.days[6]));
    expect(samePrescription(a, b)).toBe(true);
  });
});

describe('computeDelta · the counting', () => {
  it('counts changed days from today on, not behind it', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    // MON is yesterday relative to TODAY. Changing it must not be counted:
    // Rule 15 seals a completed day and the runner is not owed a notice about
    // a day that has already happened.
    b.days[0] = { ...b.days[0], distanceMi: 99 };
    expect(computeDelta(a, b, TODAY).daysChangedFromToday).toBe(0);
    b.days[3] = { ...b.days[3], distanceMi: 99 };
    expect(computeDelta(a, b, TODAY).daysChangedFromToday).toBe(1);
  });

  it('excludes the race itself from the week total', () => {
    // A marathon is not 26.2 miles of training volume. Counting it makes race
    // week read as the biggest week of the block.
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    b.days[6] = { ...b.days[6], type: 'race', distanceMi: 26.2, isLong: false };
    const delta = computeDelta(a, b, TODAY);
    expect(delta.thisWeekMiFrom).toBe(23);
    expect(delta.thisWeekMiTo).toBe(16); // 23 minus the 7-mile long the race replaced
  });

  it('says something true when the miles hold but the days move', () => {
    const a = block('pln_a', [MON], { weekMi: 24, longMi: 8 });
    const b = block('pln_b', [MON], { weekMi: 24, longMi: 8 });
    // Same volume, same long run, one day turned into quality.
    b.days[4] = { ...b.days[4], type: 'tempo', isQuality: true };
    const delta = computeDelta(a, b, TODAY);
    expect(delta.thisWeekMiFrom).toBe(delta.thisWeekMiTo);
    const line = describeDelta(delta, 'quality_drift');
    // It must NOT claim a mileage change that did not happen.
    expect(line).toBe('Drift changed 1 day from today on. The week’s mileage held.');
  });

  it('returns null rather than inventing a line when nothing moved', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23, longMi: 7 });
    expect(describeDelta(computeDelta(a, b, TODAY), 'staleness')).toBeNull();
  });

  it('ignores sub-half-mile rounding rather than reporting 23 to 23', () => {
    const a = block('pln_a', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_b', [MON], { weekMi: 23.2, longMi: 7 });
    const line = describeDelta(computeDelta(a, b, TODAY), 'volume_drift');
    expect(line).not.toMatch(/from 23 to 23/);
  });
});

describe('prescriptionFingerprint · shape', () => {
  it('is deterministic', () => {
    expect(prescriptionFingerprint(FOURTEEN_DAY)).toBe(prescriptionFingerprint(FOURTEEN_DAY));
  });
  it('does not leak the plan id into the comparison', () => {
    const a = block('pln_aaaaaaaa', [MON], { weekMi: 23, longMi: 7 });
    const b = block('pln_bbbbbbbb', [MON], { weekMi: 23, longMi: 7 });
    expect(prescriptionFingerprint(a)).toBe(prescriptionFingerprint(b));
    expect(prescriptionFingerprint(a)).not.toContain('pln_');
  });
});
