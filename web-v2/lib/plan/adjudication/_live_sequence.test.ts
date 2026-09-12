/**
 * THE SEQUENCE GATE'S LIVE ENTRY POINT.
 *
 * WHAT THIS ASSERTS
 *   · The loader's stressor count matches the ADJUDICATION LAYER'S OWN, which
 *     is pinned by `_cim_trace.test.ts`. This is the load-bearing one, and the
 *     reason it exists is that my first cut did not: it excluded an ordinary
 *     long run, counted the owner's 2026-09-21 week as 2 stressors instead of
 *     3, and reported NO FINDING on the one week the gate was written for. It
 *     did not disagree loudly. It reported clean.
 *   · A past week is never a finding — a complaint about a week already run is
 *     not a decision.
 *   · The session a fix would name is never the long run and never a race.
 *
 * WHAT IT CANNOT FAIL ON (Rule 22)
 *   · Whether the DETECTOR's thresholds are right. It checks that the live
 *     block is fed to the detector in the shape the detector expects.
 *   · Whether anything raises the finding to the runner. Zero findings on a
 *     healthy block is the correct output and is indistinguishable here from a
 *     gate that can no longer see one — which is why the fixture below is a
 *     week built to violate.
 */
import { describe, it, expect } from 'vitest';
import { stressorNameOf, findSequenceFindings, withContainsRace, type LiveWeek } from './live-sequence';

const wk = (
  weekStartISO: string, weeklyMi: number, stressors: string[], rows: LiveWeek['rows'],
): LiveWeek => ({
  weekStartISO, weeklyMi, longestMi: 17, stressors, mpMi: 0,
  isTaper: false, isRaceWeek: false, rows,
});

const row = (id: string, dateISO: string, type: string, distanceMi: number, stressor: string | null) =>
  ({ id, dateISO, type, distanceMi, stressor });

describe('live sequence · the count is the layer’s own', () => {
  it('counts an ordinary long run as a stressor', () => {
    // `_cim_trace.test.ts` builds the 09-14 week as ['threshold', '16.5 mi
    // long'] — two — and 09-21 as ['Dodgers 10k', 'tempo', '17 mi long'] —
    // three. A loader that counts differently makes the detector answer a
    // question nobody asked.
    expect(stressorNameOf('long', null, false, true)).toBe('long');
    expect(stressorNameOf('long', 'LONG', null, null)).toBe('long');
  });

  it('names a fast-finish long separately, since it is both halves at once', () => {
    expect(stressorNameOf('long', 'LONG · FAST FINISH', null, true)).toBe('fast-finish long');
    expect(stressorNameOf('long', 'LONG MP', null, true)).toBe('fast-finish long');
  });

  it('counts the hard session types and nothing else', () => {
    expect(stressorNameOf('tempo', null, null, null)).toBe('tempo');
    expect(stressorNameOf('intervals', null, null, null)).toBe('interval');
    expect(stressorNameOf('race', null, null, null)).toBe('race');
    expect(stressorNameOf('easy', null, null, null)).toBeNull();
    expect(stressorNameOf('recovery', null, null, null)).toBeNull();
    expect(stressorNameOf('rest', null, null, null)).toBeNull();
    expect(stressorNameOf('easy', 'STRIDES', false, false)).toBeNull();
  });
});

/**
 * RACEWEEK-CONSOLIDATION-1 (2026-09-11) · `loadPlannedWeeks` used to populate
 * `LiveWeek.isRaceWeek` purely from `plan_weeks.is_race_week` — the GOAL
 * race's week and nothing else — with no other race signal reaching
 * `adjudicate.ts` for a real, live block at all. `withContainsRace` is the
 * fix: it derives `containsRace` from the week's own rows via
 * `weekContainsRace` (`race-week.ts`), the same day-level `type === 'race'`
 * check `v5-block.ts`'s `weekFlag` already uses for the identical question,
 * rather than growing a second definition.
 *
 * FALSIFIED: deleting the `days: wk.rows.map(...)` line (or passing `days:
 * []`) makes the tune-up case below read `containsRace: false`, silently
 * reverting to the pre-fix blindness this loader shipped with.
 */
describe('live sequence · withContainsRace', () => {
  it('a goal week resolves containsRace true through isRaceWeek alone, no rows needed', () => {
    const w = wk('2026-11-30', 20, ['race · 26.2 mi'], [row('r1', '2026-12-06', 'race', 26.2, 'race')]);
    expect(withContainsRace({ ...w, isRaceWeek: true }).containsRace).toBe(true);
  });

  it('a B/C tune-up embedded mid-block resolves containsRace true from its own rows, with isRaceWeek false', () => {
    const w = wk('2026-09-21', 41, ['tempo', '17 mi long'], [
      row('r1', '2026-09-22', 'easy', 5, null),
      row('r2', '2026-09-24', 'tempo', 6, 'tempo'),
      row('r3', '2026-09-27', 'race', 6.21, 'race'),
    ]);
    const out = withContainsRace(w);
    expect(out.isRaceWeek).toBe(false);
    expect(out.containsRace).toBe(true);
  });

  it('an ordinary week with no race day at all resolves containsRace false', () => {
    const w = wk('2026-09-07', 40, ['threshold', 'long'], [
      row('r1', '2026-09-08', 'threshold', 8, 'threshold'),
      row('r2', '2026-09-14', 'long', 16, 'long'),
    ]);
    expect(withContainsRace(w).containsRace).toBe(false);
  });
});

describe('live sequence · findings', () => {
  const history = [
    wk('2026-09-07', 40, ['threshold', 'long'], []),
    wk('2026-09-14', 40, ['threshold', 'long'], []),
    wk('2026-09-21', 40, ['threshold', 'long'], []),
  ];
  const offender = wk('2026-09-28', 52, ['tempo', 'interval', 'long'], [
    row('r_long', '2026-10-04', 'long', 18, 'long'),
    row('r_tempo', '2026-09-30', 'tempo', 9.5, 'tempo'),
    row('r_int', '2026-09-29', 'interval', 7, 'interval'),
    row('r_easy', '2026-09-28', 'easy', 5, null),
  ]);

  it('finds a week that adds mileage and intensity together', () => {
    const f = findSequenceFindings([...history, offender], '2026-09-05');
    expect(f).toHaveLength(1);
    expect(f[0].weekStartISO).toBe('2026-09-28');
    expect(f[0].stressorsBefore).toBe(2);
    expect(f[0].stressorsAfter).toBe(3);
  });

  it('names the largest non-race, non-long stressor', () => {
    // Never the long run: it is the aerobic spine of the block, and cutting it
    // to satisfy an INTENSITY check is Rule 12's mistake in a second costume.
    const f = findSequenceFindings([...history, offender], '2026-09-05');
    expect(f[0].targetRowId).toBe('r_tempo');
  });

  it('never names a race the runner entered', () => {
    const raced = wk('2026-09-28', 52, ['race', 'interval', 'long'], [
      row('r_long', '2026-10-04', 'long', 18, 'long'),
      row('r_race', '2026-10-03', 'race', 13.1, 'race'),
      row('r_int', '2026-09-29', 'interval', 7, 'interval'),
    ]);
    const f = findSequenceFindings([...history, raced], '2026-09-05');
    expect(f[0].targetRowId).toBe('r_int');
  });

  it('says nothing about a week already run', () => {
    expect(findSequenceFindings([...history, offender], '2026-10-30')).toHaveLength(0);
  });
});
