/**
 * lib/postrun-siege/_race_recency.test.ts · THE WEEK AFTER A RACE.
 *
 * CLAUDE.md, per-finding context filters, locked 2026-05-19 round 4: a surface
 * that aggregates N findings runs N filter applications, one per finding, and
 * inheritance is semantic rather than automatic.
 *
 * `deriveRecap` had no race-recency input at all, so every finding ran
 * unfiltered. Two of them state a CAUSE that a recent race changes, and both
 * are findings a runner reads constantly in the week after one — the week the
 * app is most likely to be asked why the heart rate is high.
 *
 * The filter changes the CAUSE and nothing else. The distance, the pace, the
 * heart rate and the split spread are all still stated exactly as measured: a
 * race does not make a run unmeasurable.
 */
import { describe, it, expect } from 'vitest';
import { deriveRecap, type RecapInput } from '@/lib/coach/run-recap';
import { expectedDaysForAnchor } from '@/lib/coach/recovery-phase';
import { checkCoachVoice } from './invariants';

const MARATHON = 26.2;
const FIVE_K = 3.1;

const easyOverCap = (o: Partial<RecapInput> = {}): string => deriveRecap({
  type: 'easy', phase: 'RECOVERY', plannedMi: 5, actualMi: 5,
  actualPaceSPerMi: 560, actualDurationSec: 2800,
  plannedPaceSPerMi: 555, plannedHrCap: 145,
  actualAvgHr: 152, actualMaxHr: 160,
  ...o,
} as RecapInput).facts.join(' ');

const longWithDrift = (o: Partial<RecapInput> = {}): string => deriveRecap({
  type: 'long', phase: 'RECOVERY', plannedMi: 12, actualMi: 12,
  actualPaceSPerMi: 540, actualDurationSec: 6480,
  actualAvgHr: 150, actualMaxHr: 168,
  splits: Array.from({ length: 12 }, (_, i) => ({
    mile: i + 1, paceSPerMi: i >= 8 ? 600 : 520, hr: 138 + i * 3,
  })),
  ...o,
} as RecapInput).facts.join(' ');

describe('RACE RECENCY · the finding stands, the instruction does not', () => {
  it('with no race behind it, the copy is byte-identical to before', () => {
    expect(easyOverCap()).toContain('Slow it down next time');
    expect(longWithDrift()).toContain('Usually fuel or water');
    expect(longWithDrift()).toContain('Worth checking your fueling');
  });

  it('the day after a marathon, the heart rate is the race and not the pace', () => {
    const f = easyOverCap({ daysSinceRace: 1, raceDistanceMi: MARATHON });
    // The measurement is still stated, exactly.
    expect(f).toContain('152');
    expect(f).toContain('145');
    // The scold is gone.
    expect(f).not.toContain('Slow it down next time');
    expect(f).not.toContain("actually easy");
    expect(f).toContain('race still in the legs');
    expect(checkCoachVoice([f])).toEqual([]);
  });

  it('the week after a marathon, a long-run drift is not a fuelling problem', () => {
    const f = longWithDrift({ daysSinceRace: 5, raceDistanceMi: MARATHON });
    expect(f).toContain('HR climbed');
    expect(f).not.toContain('Usually fuel or water');
    expect(f).not.toContain('Worth checking your fueling');
    expect(f).toContain('still paying it back');
    expect(f).toContain('the endurance comes back last');
    expect(checkCoachVoice([f])).toEqual([]);
  });

  it('the window is the doctrine one, and it is distance-keyed', () => {
    // A marathon buys three weeks; a 5K buys six days. The same run on the
    // same day reads differently depending on which race is behind it,
    // because Research/00b says those are different recoveries.
    expect(expectedDaysForAnchor('race', MARATHON)).toBe(21);
    expect(expectedDaysForAnchor('race', FIVE_K)).toBe(6);

    const day10 = { daysSinceRace: 10 };
    expect(easyOverCap({ ...day10, raceDistanceMi: MARATHON })).toContain('race still in the legs');
    expect(easyOverCap({ ...day10, raceDistanceMi: FIVE_K })).toContain('Slow it down next time');
  });

  it('the last day inside the window is inside it, the next day is not', () => {
    const inside = expectedDaysForAnchor('race', MARATHON);
    expect(easyOverCap({ daysSinceRace: inside, raceDistanceMi: MARATHON }))
      .toContain('race still in the legs');
    expect(easyOverCap({ daysSinceRace: inside + 1, raceDistanceMi: MARATHON }))
      .toContain('Slow it down next time');
  });

  it('a half-known race leaves the filter off rather than guessing a window', () => {
    for (const o of [
      { daysSinceRace: 2, raceDistanceMi: null },
      { daysSinceRace: null, raceDistanceMi: MARATHON },
      { daysSinceRace: -3, raceDistanceMi: MARATHON },
      { daysSinceRace: 2, raceDistanceMi: 0 },
      { daysSinceRace: Number.NaN, raceDistanceMi: MARATHON },
    ]) {
      expect(easyOverCap(o as Partial<RecapInput>), JSON.stringify(o))
        .toContain('Slow it down next time');
    }
  });

  it('heat still wins, because it is the more specific explanation', () => {
    // A runner in the week after a race still runs in weather, and a hot day
    // explains an elevated heart rate more precisely than a race does.
    const f = easyOverCap({
      daysSinceRace: 2, raceDistanceMi: MARATHON,
      weather: { tempF: 92, humidityPct: 70, windMph: 2, conditions: 'clear',
                 cloudCoverPct: 10, durationS: 2800 } as never,
    });
    expect(f).toContain('it was hot');
    expect(f).not.toContain('race still in the legs');
  });

  it('the numbers that are not about cause do not move', () => {
    // Distance and pace are measurements. A race does not make a run
    // unmeasurable, and the lead line is identical either way.
    const before = deriveRecap({
      type: 'easy', phase: 'RECOVERY', plannedMi: 5, actualMi: 5.2,
      actualPaceSPerMi: 560, actualAvgHr: 152, actualMaxHr: 160,
    }).facts[0];
    const after = deriveRecap({
      type: 'easy', phase: 'RECOVERY', plannedMi: 5, actualMi: 5.2,
      actualPaceSPerMi: 560, actualAvgHr: 152, actualMaxHr: 160,
      daysSinceRace: 1, raceDistanceMi: MARATHON,
    }).facts[0];
    expect(after).toBe(before);
  });
});
