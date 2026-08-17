import { describe, it, expect } from 'vitest';
import { computeWeekMileage, type WeekDayInput } from './week-mileage';

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Mon-Sun week; the runner over-ran Tue and under-ran Thu. */
const WEEK: WeekDayInput[] = [
  { dateISO: '2026-08-10', plannedMi: 6, doneMi: 6.2, type: 'easy' },
  { dateISO: '2026-08-11', plannedMi: 8, doneMi: 9.4, type: 'tempo' },
  { dateISO: '2026-08-12', plannedMi: 5, doneMi: 5, type: 'easy' },
  { dateISO: '2026-08-13', plannedMi: 10, doneMi: 7, type: 'intervals' },
  { dateISO: '2026-08-14', plannedMi: 0, doneMi: 0, type: 'rest' },
  { dateISO: '2026-08-15', plannedMi: 6, doneMi: 0, type: 'easy' },
  { dateISO: '2026-08-16', plannedMi: 16, doneMi: 0, type: 'long' },
];

describe('computeWeekMileage', () => {
  it('reports actual miles run, not planned miles of completed days', () => {
    // The Today bug: summing plannedMi over done days gives 29 and calls
    // it "done". The runner actually ran 27.6.
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-13' });
    expect(w.actualMi).toBe(27.6);
    const oldTodayNumber = WEEK
      .filter((d) => (d.doneMi ?? 0) > 0)
      .reduce((s, d) => s + (d.plannedMi ?? 0), 0);
    expect(oldTodayNumber).toBe(29);
    expect(w.actualMi).not.toBe(oldTodayNumber);
  });

  it('keeps planned and actual as separate numbers', () => {
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-13' });
    expect(w.plannedMi).toBe(51);
    expect(w.actualMi).toBe(27.6);
  });

  it('compares mid-week against planned-to-date, not the whole week', () => {
    // Wednesday. Planned so far = 6 + 8 + 5 = 19; run = 20.6. The runner
    // is AHEAD. Against the full 51-mile week they would read 30 miles
    // behind, which is not a fact about their training.
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-12' });
    expect(w.plannedToDateMi).toBe(19);
    expect(w.actualToDateMi).toBe(20.6);
    expect(w.vsPlanToDateMi).toBe(1.6);
    expect(w.vsPlanToDateMi).toBeGreaterThan(0);
  });

  it('compares like with like — both sides restricted to the same days', () => {
    // Wednesday, but Thursday's run has already synced (a late upload, or
    // a runner in a timezone ahead of the server). Charging the full-week
    // actual against a to-date plan would report +8.6 miles ahead, which
    // is a number nobody ran this week so far.
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-12' });
    expect(w.actualMi).toBe(27.6);        // whole window
    expect(w.actualToDateMi).toBe(20.6);  // through Wednesday
    expect(w.vsPlanToDateMi).toBe(round1(w.actualToDateMi - w.plannedToDateMi));
  });

  it('counts the whole week once the week is over', () => {
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-16' });
    expect(w.plannedToDateMi).toBe(51);
    expect(w.vsPlanToDateMi).toBe(-23.4);
  });

  it('counts days run and quality sessions off actual execution', () => {
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-13' });
    expect(w.daysRun).toBe(4);
    expect(w.daysPlanned).toBe(6);
    // tempo + intervals were run; the long run was not.
    expect(w.hardSessionsDone).toBe(2);
  });

  it('does not credit a planned-but-unrun quality session', () => {
    const w = computeWeekMileage(
      [{ dateISO: '2026-08-16', plannedMi: 16, doneMi: 0, type: 'long' }],
      { todayISO: '2026-08-16' },
    );
    expect(w.hardSessionsDone).toBe(0);
    expect(w.actualMi).toBe(0);
  });

  it('compares ISO day strings without constructing a Date', () => {
    // String comparison on YYYY-MM-DD is exact and timezone-free. A Date
    // round-trip here is how the calendar off-by-one class gets in.
    const w = computeWeekMileage(WEEK, { todayISO: '2026-08-10' });
    expect(w.plannedToDateMi).toBe(6);
  });

  it('treats a missing todayISO as the whole window', () => {
    const w = computeWeekMileage(WEEK);
    expect(w.plannedToDateMi).toBe(w.plannedMi);
  });

  it('handles empty, null and malformed input without inventing miles', () => {
    expect(computeWeekMileage([]).actualMi).toBe(0);
    const junk = computeWeekMileage([
      { plannedMi: null, doneMi: undefined },
      { plannedMi: Number.NaN, doneMi: -3 },
      {},
    ]);
    expect(junk.actualMi).toBe(0);
    expect(junk.plannedMi).toBe(0);
    expect(junk.daysRun).toBe(0);
  });

  it('rounds to one decimal, matching every mileage surface', () => {
    const w = computeWeekMileage([
      { dateISO: '2026-08-10', plannedMi: 3.33, doneMi: 3.33 },
      { dateISO: '2026-08-11', plannedMi: 3.33, doneMi: 3.34 },
    ], { todayISO: '2026-08-11' });
    expect(w.actualMi).toBe(6.7);
    expect(w.plannedMi).toBe(6.7);
  });

  it('agrees with the Train-style actual sum over the same days', () => {
    // TrainView sums d.doneMi directly. The helper must be byte-identical
    // so adopting it changes no number on that surface.
    const trainStyle = Math.round(WEEK.reduce((s, d) => s + (d.doneMi ?? 0), 0) * 10) / 10;
    expect(computeWeekMileage(WEEK, { todayISO: '2026-08-16' }).actualMi).toBe(trainStyle);
  });
});
