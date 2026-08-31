/**
 * THE LINE THE RUNNER SHOULD NOT HAVE READ ON 2026-08-30.
 *
 * First night of a fourteen-week marathon block. The card said:
 *
 *   "The end of recovery cut this week from 45 to 38 miles.
 *    Recovery block finished · rebuilt toward cim."
 *
 * Both halves are wrong, in different ways.
 *
 * THE NUMBER (Rule 16 · one quantity, one name). His authored week
 * 2026-08-31 -> 09-06 is 45 miles. The 38 is not that week and not any week
 * he was shown: it is the ELAPSED week 08-24 -> 08-30 as re-emitted by the
 * incoming block, which by design does not author days already in the past
 * (`persistsComposedDay`: `dateISO < todayISO && !sealed` -> false). The
 * outgoing recovery block held all seven of those days (45 mi); the incoming
 * one holds five (38 mi), missing 08-25's easy 7. `milesIn` read that
 * structural silence as a prescription of zero — Rule 11's exact shape, a
 * missing input read as a measured value — and the subtraction turned a
 * bookkeeping artifact into a seven-mile "cut".
 *
 * THE FRAMING (the hero statement). The block that replaced recovery is 45%
 * bigger than it, and the app opened on the word "cut". "That's what the app
 * is for. To push."
 *
 * WHAT THIS FILE CANNOT FAIL ON (Rule 22):
 *   - It cannot see the CRON's own `reasons.message` (owned elsewhere:
 *     app/api/cron/plan-drift/route.ts), only what this module does with it.
 *   - It cannot see rows already persisted with the wrong numbers. His live
 *     row stores thisWeekMiTo: 38 forever; the guarantee that he stops
 *     READING it is `describeDelta`'s, and the legacy-row case is asserted
 *     explicitly below because it is the only one that fixes his phone.
 *   - It asserts sentences, not screens. Rule 13's render is separate.
 *   - The distribution here is deliberately two-sided: a genuine mid-week
 *     RISE must still be reported as a rise (Rule 22 — a gate that only
 *     knows how to suppress will pass an engine that only suppresses).
 */
import { describe, it, expect } from 'vitest';
import {
  computeDelta, describeDelta,
  type PlanPrescription, type PrescribedDay, type PlanDelta,
} from './plan-delta';

function day(dateISO: string, distanceMi: number, over: Partial<PrescribedDay> = {}): PrescribedDay {
  return {
    dateISO, type: distanceMi > 0 ? 'easy' : 'rest', distanceMi,
    paceTargetSPerMi: null, subLabel: null, workoutSpec: null,
    isQuality: false, isLong: false, notes: null,
    ...over,
  };
}

const WEEK0 = '2026-08-24';
const WEEK1 = '2026-08-31';
/** Sunday night. The rebuild fired at 2026-08-31T03:40Z = 08-30 20:40 local. */
const TODAY = '2026-08-30';

/** The archived recovery block: all seven days of 08-24 -> 08-30, 45 miles. */
const RECOVERY: PlanPrescription = {
  planId: 'pln_0e635603799fd7b1', mode: 'recovery', raceId: null, goalISO: null,
  weeks: [{ startISO: WEEK0, phase: 'RECOVERY', isRaceWeek: false, isCutback: false }],
  days: [
    day('2026-08-24', 4), day('2026-08-25', 7), day('2026-08-26', 7),
    day('2026-08-27', 7), day('2026-08-28', 7), day('2026-08-29', 0),
    day('2026-08-30', 13, { type: 'long', isLong: true }),
  ],
};

/**
 * The authored marathon block. Week 0 carries only the five days the
 * generator re-emitted (38 mi); week 1 is the real first build week, 45 mi.
 * These are his production rows, not a shape invented for the test.
 */
const BUILD: PlanPrescription = {
  planId: 'pln_9a57561debb776e5', mode: 'race-prep', raceId: 'cim', goalISO: '2026-12-06',
  weeks: [
    { startISO: WEEK0, phase: 'BUILD', isRaceWeek: false, isCutback: false },
    { startISO: WEEK1, phase: 'BUILD', isRaceWeek: false, isCutback: false },
  ],
  days: [
    day('2026-08-24', 4), day('2026-08-26', 7), day('2026-08-27', 7),
    day('2026-08-28', 7), day('2026-08-30', 13, { type: 'long', isLong: true }),
    day('2026-08-31', 4.5), day('2026-09-01', 8.5, { type: 'threshold', isQuality: true }),
    day('2026-09-02', 5), day('2026-09-03', 6.5, { type: 'intervals', isQuality: true }),
    day('2026-09-04', 5.5), day('2026-09-05', 0),
    day('2026-09-06', 15, { type: 'long', isLong: true }),
  ],
};

describe('the fixture is his real plan (liveness)', () => {
  it('week 0 as re-emitted is 38 and week 1 is 45', () => {
    const sum = (from: string, to: string) =>
      BUILD.days.filter((d) => d.dateISO >= from && d.dateISO <= to)
        .reduce((s, d) => s + (d.distanceMi ?? 0), 0);
    expect(sum('2026-08-24', '2026-08-30')).toBe(38);
    expect(sum('2026-08-31', '2026-09-06')).toBe(45);
    expect(RECOVERY.days.reduce((s, d) => s + (d.distanceMi ?? 0), 0)).toBe(45);
  });
});

describe('computeDelta · a day the new block MAY NOT author is not a day it cut', () => {
  it('does not read the elapsed week as having lost seven miles', () => {
    const delta = computeDelta(RECOVERY, BUILD, TODAY);
    // The honest answer: nothing about the elapsed week changed. Both blocks
    // prescribe the same 45 miles for it; only one of them is allowed to say so.
    expect(delta.thisWeekMiFrom).toBe(45);
    expect(delta.thisWeekMiTo).toBe(45);
  });

  it('the long run is likewise unchanged, not lost', () => {
    const delta = computeDelta(RECOVERY, BUILD, TODAY);
    expect(delta.longRunMiFrom).toBe(13);
    expect(delta.longRunMiTo).toBe(13);
  });

  it('carries the elapsed day only, so a mid-week rebuild reads 45 not 38', () => {
    const delta = computeDelta(RECOVERY, BUILD, '2026-08-26');
    // 08-25 is the one day BUILD does not author, and on the 26th it is past,
    // so it is carried from RECOVERY: 38 + 7 = 45. Nothing changed, and the
    // sentence says nothing, which is the correct answer.
    expect(delta.thisWeekMiTo).toBe(45);
    expect(delta.thisWeekMiFrom).toBe(45);
  });

  it('a FUTURE day the new block dropped still counts as dropped', () => {
    // Falsification in the other direction, and the one that matters: if the
    // union reached forward, a block that genuinely removed a session from
    // the rest of the week would go silent. Today is the 24th, so 08-25 is
    // now in the FUTURE and must NOT be carried.
    const delta = computeDelta(RECOVERY, BUILD, '2026-08-24');
    expect(delta.thisWeekMiTo).toBe(38);
    expect(delta.thisWeekMiFrom).toBe(45);
    expect(describeDelta(delta, 'volume_drift')).toMatch(/cut this week from 45 to 38 miles/);
  });

  it('a genuine mid-week RISE is still reported as a rise', () => {
    const bigger: PlanPrescription = {
      ...BUILD,
      days: BUILD.days.map((d) => (d.dateISO >= '2026-08-27' && d.dateISO <= '2026-08-30'
        ? { ...d, distanceMi: (d.distanceMi ?? 0) + 3 } : d)),
    };
    const delta = computeDelta(RECOVERY, bigger, '2026-08-27');
    expect((delta.thisWeekMiTo ?? 0)).toBeGreaterThan(delta.thisWeekMiFrom ?? 0);
    expect(describeDelta(delta, 'volume_drift')).toMatch(/raised/);
  });
});

describe('describeDelta · a block swap is not a cut', () => {
  /** Exactly the delta persisted on his row id 60, reasons.plan_delta. */
  const LIVE_ROW: PlanDelta = {
    thisWeekMiFrom: 45, thisWeekMiTo: 38,
    longRunMiFrom: 13, longRunMiTo: 13,
    daysChangedFromToday: 98,
    lastDayFrom: '2026-08-30', lastDayTo: '2026-12-06',
    weeksFrom: 1, weeksTo: 15,
    unchanged: false,
  };

  it('THE REPORTED DEFECT · never says "cut" for a recovery-to-build swap', () => {
    const said = describeDelta(LIVE_ROW, 'recovery_complete');
    expect(said).not.toBeNull();
    expect(said).not.toMatch(/\bcut\b/);
  });

  it('never states 38 as a quantity belonging to his week', () => {
    // Rule 16. The number is real arithmetic on the wrong population, and it
    // does not match the plan rendered beside it.
    expect(describeDelta(LIVE_ROW, 'recovery_complete')).not.toMatch(/\b38\b/);
    expect(describeDelta(LIVE_ROW, 'recovery_complete')).not.toMatch(/45 to 38/);
  });

  it('does not fall back to "changed 98 days from today on"', () => {
    // The other way this sentence goes wrong once the week clause is gone.
    // 98 is arithmetic showing through, not something a coach says.
    expect(describeDelta(LIVE_ROW, 'recovery_complete')).not.toMatch(/98/);
  });

  it('says what is now in place, forward-looking, with a checkable number', () => {
    const said = describeDelta(LIVE_ROW, 'recovery_complete') ?? '';
    expect(said).toMatch(/15/);            // the block's own week count
    expect(said).toMatch(/week/i);
    expect(said.endsWith('.')).toBe(true);
  });

  it('holds for the sibling block-replacement kinds', () => {
    for (const kind of ['race_graduate', 'plan_elapsed', 'maintenance_to_raceprep']) {
      const said = describeDelta(LIVE_ROW, kind) ?? '';
      expect(said, kind).not.toMatch(/\bcut\b/);
      expect(said, kind).not.toMatch(/\b38\b/);
    }
  });

  it('a DRIFT rebuild inside one block still reports its week honestly', () => {
    // The suppression is scoped to block swaps. A same-block rebuild compares
    // like with like and must keep saying so, in both directions.
    expect(describeDelta(LIVE_ROW, 'volume_drift')).toMatch(/45 to 38/);
    expect(describeDelta({ ...LIVE_ROW, thisWeekMiFrom: 38, thisWeekMiTo: 45 }, 'volume_drift'))
      .toMatch(/raised/);
  });

  it('an unchanged plan still says nothing at all', () => {
    expect(describeDelta({ ...LIVE_ROW, unchanged: true }, 'recovery_complete')).toBeNull();
  });

  it('coach voice · no em dash, no exclamation, no hype', () => {
    const said = describeDelta(LIVE_ROW, 'recovery_complete') ?? '';
    expect(said).not.toMatch(/[—!]/);
  });
});
