import { describe, it, expect } from 'vitest';
import { resolveViewedPlanDay, viewedDayIsUnresolved } from './viewed-day';
import { dayStateWordFor, displayTypeFor } from './v5-today';

/**
 * WHAT THIS FILE CANNOT FAIL ON (Rule 22).
 *
 * It exercises the RESOLVER, not the route. It cannot see the route calling
 * `loadPlanWeek` with the wrong arguments, cannot see a caller that stops
 * calling `resolveViewedPlanDay` and re-derives the day inline, and cannot
 * see the Swift side rendering the resolved day wrongly. The route-level
 * guarantee is `_stepped_day_route.test.ts`; the on-screen guarantee is the
 * simulator render Rule 13 requires, and neither this file nor that one is a
 * substitute for it.
 *
 * It also cannot fail on a WRONG-but-present prescription: it asserts the row
 * for the viewed date is returned, not that the row's contents are correct.
 *
 * Liveness: every `it` below asserts on a non-empty fixture; a fixture that
 * silently emptied would fail the first expectation rather than pass vacuously.
 */

/** The owner's real week, 2026-08-31 -> 09-06, plan pln_9a57561debb776e5. */
const WEEK = [
  { date_iso: '2026-08-31', type: 'easy', sub_label: 'EASY · 6×20s strides', is_today: false, plan_workout_id: 'wko_6da44c11918e27a9' },
  { date_iso: '2026-09-01', type: 'threshold', sub_label: '4×1 mi @ T pace · 1 min jog', is_today: false, plan_workout_id: 'wko_eaa8cfd7cb94310b' },
  { date_iso: '2026-09-02', type: 'easy', sub_label: 'EASY · 6×20s strides', is_today: false, plan_workout_id: 'wko_76449f2a57157a93' },
  { date_iso: '2026-09-03', type: 'intervals', sub_label: '10×60s hills', is_today: false, plan_workout_id: 'wko_e346d05fc84e0977' },
  { date_iso: '2026-09-04', type: 'easy', sub_label: 'EASY', is_today: false, plan_workout_id: 'wko_5ebc710e85c948b0' },
  { date_iso: '2026-09-05', type: 'rest', sub_label: 'REST', is_today: false, plan_workout_id: 'wko_5d7919457f8a04bd' },
  { date_iso: '2026-09-06', type: 'long', sub_label: 'LONG', is_today: false, plan_workout_id: 'wko_d1886a7e60cc12c5' },
];

/** What `loadPlanWeek` manufactures for a date the block does not prescribe. */
const SYNTHESISED = { date_iso: '2026-12-25', type: 'rest', sub_label: 'REST', is_today: false, plan_workout_id: null };

describe('resolveViewedPlanDay · the screen is about the day being viewed', () => {
  it('THE REPORTED DEFECT · stepping to Monday 2026-08-31 resolves the easy 4.5, not nothing', () => {
    expect(WEEK.length).toBe(7); // liveness
    const day = resolveViewedPlanDay(WEEK, '2026-08-31');
    expect(day).not.toBeNull();
    expect(day!.type).toBe('easy');
    expect(day!.sub_label).toBe('EASY · 6×20s strides');
  });

  it('the runner\'s real today is NOT in this week, and that must not matter', () => {
    // 2026-08-30 is the Sunday before. The week window for a Monday starts on
    // the Monday, so `is_today` marks no row in this array at all — which is
    // exactly the state that produced REST on the owner's phone.
    expect(WEEK.some((d) => d.is_today)).toBe(false);
    expect(resolveViewedPlanDay(WEEK, '2026-08-31')).not.toBeNull();
  });

  it('resolves every day of the week to its own row', () => {
    for (const d of WEEK) {
      expect(resolveViewedPlanDay(WEEK, d.date_iso)?.date_iso).toBe(d.date_iso);
    }
  });

  it('a date outside the loaded week resolves to null rather than to a neighbour', () => {
    expect(resolveViewedPlanDay(WEEK, '2026-08-30')).toBeNull();
    expect(resolveViewedPlanDay(WEEK, '2026-09-07')).toBeNull();
  });

  it('tolerates a full timestamp where an ISO date is expected', () => {
    expect(resolveViewedPlanDay(WEEK, '2026-09-01T00:00:00Z')?.type).toBe('threshold');
  });
});

describe('Rule 11 · rest, absent, and unread are three different facts', () => {
  it('a REST row is resolved and is not "unresolved"', () => {
    const rest = resolveViewedPlanDay(WEEK, '2026-09-05');
    expect(rest!.type).toBe('rest');
    expect(viewedDayIsUnresolved({ planLoaded: true, viewedDay: rest })).toBe(false);
  });

  it('and a synthesised one is, despite being byte-identical in every field the screen reads', () => {
    const rest = resolveViewedPlanDay(WEEK, '2026-09-05')!;
    expect(SYNTHESISED.type).toBe(rest.type);
    expect(SYNTHESISED.sub_label).toBe(rest.sub_label);
    expect(viewedDayIsUnresolved({ planLoaded: true, viewedDay: SYNTHESISED }))
      .not.toBe(viewedDayIsUnresolved({ planLoaded: true, viewedDay: rest }));
  });

  it('a date the live plan does not prescribe IS unresolved', () => {
    const none = resolveViewedPlanDay(WEEK, '2026-12-25');
    expect(none).toBeNull();
    expect(viewedDayIsUnresolved({ planLoaded: true, viewedDay: none })).toBe(true);
  });

  it('THE ONE THE FIRST FIX MISSED · a SYNTHESISED rest day is unresolved too', () => {
    // `loadPlanWeek` never returns a short array — it fills every gap with
    // `type: 'rest'`. So stepping past the end of the block found a day, and
    // that day claimed to be a rest day. Verified against the live account on
    // 2026-08-30: /api/v5/today?date=2026-12-25 answered "Rest" on a block
    // whose last prescribed day is 2026-12-06.
    expect(SYNTHESISED.type).toBe('rest');           // it looks exactly like one
    expect(SYNTHESISED.plan_workout_id).toBeNull();  // and is not one
    expect(viewedDayIsUnresolved({ planLoaded: true, viewedDay: SYNTHESISED })).toBe(true);
  });

  it('a REAL rest row is still a rest day, not an absence', () => {
    // The direction that must not regress: over-firing would relabel every
    // genuine rest day in every block as "nothing set".
    const real = resolveViewedPlanDay(WEEK, '2026-09-05')!;
    expect(real.plan_workout_id).not.toBeNull();
    expect(viewedDayIsUnresolved({ planLoaded: true, viewedDay: real })).toBe(false);
  });

  it('a failed or absent plan read is NOT an assertion that the day is empty', () => {
    // The third fact. Without this branch a Postgres blip renders as "nothing
    // prescribed", which is the same lie in a different direction.
    expect(viewedDayIsUnresolved({ planLoaded: false, viewedDay: null })).toBe(false);
  });

  it('the two states must not render as the same word', () => {
    // This is the assertion the defect actually violated: `dayStateWordFor`
    // and `displayTypeFor` answer 'rest' / 'Rest' for BOTH a rest row and a
    // missing one, so the composer cannot tell them apart from these alone
    // and must be handed the flag. Asserting the collision is deliberate —
    // it is what forces the composer to carry `todayPlanUnresolved`.
    expect(dayStateWordFor('rest')).toBe('rest');
    expect(dayStateWordFor(undefined)).toBe('rest');
    expect(displayTypeFor('rest', 'REST')).toBe('Rest');
    expect(displayTypeFor(undefined, null)).toBe('Rest');
  });
});
