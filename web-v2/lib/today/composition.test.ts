/**
 * composition.test · the beat order of Today, per training state.
 *
 * These assertions exist because of one screenshot. The morning after his
 * A race, David's Today page led with yesterday's finish time at hero
 * scale and buried the run he was actually supposed to do that day in 8px
 * type inside the week strip. Underneath it, readiness rendered twice and
 * a WEEKLY VOLUME tile said "0 mi" over bars from a block that had
 * already finished.
 *
 * Every one of those is asserted against below. The point of a pure
 * selector is that "does today's work outrank yesterday's race" is a
 * question with a testable answer, instead of a question the JSX answers
 * differently in nine places.
 *
 * The fixtures are the real states from C1's conditional-layout table:
 * mid-build, taper, race week, race morning, race day + 1, recovery,
 * between blocks, no goal, injury, and a missed yesterday.
 */
import { describe, it, expect } from 'vitest';
import {
  composeToday,
  selectTodayState,
  selectRecentTreatment,
  type TodayCompositionInput,
  type TodayBeat,
} from './composition';

/* ── fixtures ────────────────────────────────────────────────────────── */

/** A mid-build Tuesday: a run on the plan, a goal race months out. */
const base: TodayCompositionInput = {
  isTodayCard: true,
  isRaceDay: false,
  dayDone: false,
  prescribed: 'run',
  coachedExternally: false,
  hasMorningBrief: true,
  decisionCount: 0,
  missedYesterday: false,
  injuryActive: false,
  readinessBand: 'ready',
  postRaceActive: false,
  daysSinceRace: null,
  hasRecentRace: false,
  raceResultAcknowledged: false,
  inRecoveryWindow: false,
  recoveryWindowAvailable: false,
  betweenBlocks: false,
  hasGoalRace: true,
  daysToGoalRace: 111,
  weekPlannedMi: 46,
  weekLoggedMi: 12,
  formLabel: 'PRODUCTIVE',
};

const at = (over: Partial<TodayCompositionInput>): TodayCompositionInput => ({ ...base, ...over });

/**
 * David's live state, Aug 17 2026: the morning after America's Finest City
 * Half, day 1 of a context-aware recovery block that prescribes easy
 * running (17 mi across 4 running days this week), no decisions pending,
 * the finish time still a provisional watch time.
 */
const davidPostRaceDay1 = at({
  prescribed: 'run',
  postRaceActive: true,
  daysSinceRace: 1,
  hasRecentRace: true,
  raceResultAcknowledged: false,
  inRecoveryWindow: true,
  recoveryWindowAvailable: true,
  betweenBlocks: true,
  weekPlannedMi: 17,
  weekLoggedMi: 0,
  formLabel: 'LOADED',
  readinessBand: 'pull-back',
});

const idx = (beats: TodayBeat[], b: TodayBeat) => beats.indexOf(b);

/* ── the complaint, asserted ─────────────────────────────────────────── */

describe("David's state · day 1 post-race, recovery block, no decisions", () => {
  const c = composeToday(davidPostRaceDay1);

  it("leads with today's work, not yesterday's race", () => {
    expect(c.hero).toBe('work');
    expect(c.beats[0]).toBe('brief');
    expect(c.beats[1]).toBe('work');
    expect(idx(c.beats, 'work')).toBeLessThan(idx(c.beats, 'recent'));
  });

  it('demotes the race to a line that still carries the confirm', () => {
    expect(c.recent.treatment).toBe('line');
    expect(c.recent.needsConfirm).toBe(true);
  });

  it('renders no decision beat when the queue is empty', () => {
    expect(c.beats).not.toContain('decision');
  });

  it('renders readiness exactly once, and folds the pull-back into the hero', () => {
    expect(c.readiness.readouts).toEqual(['header']);
    expect(c.readiness.modifiesWork).toBe(true);
  });

  it('suppresses every tile · the whole row disappears', () => {
    expect(c.tiles.show).toBe(false);
    expect(c.tiles.count).toBe(0);
    expect(c.tiles.gap).toBe(false);
    expect(c.tiles.raceDay).toBe(false);
    expect(c.tiles.volume).toBe(false);
    expect(c.tiles.form).toBe(false);
  });

  it('states the week volume as a fact in context instead of a dead tile', () => {
    expect(c.context.volumeLine).toBe('0 mi logged so far');
    expect(c.context.strip).toBe('recovery');
  });

  it('is the whole page · nine cards became five beats', () => {
    expect(c.beats).toEqual(['brief', 'work', 'context', 'recent']);
  });
});

/* ── the invariant that must hold in every state ─────────────────────── */

const EVERY_STATE: Array<[string, TodayCompositionInput]> = [
  ['mid-build', base],
  ['taper', at({ daysToGoalRace: 14 })],
  ['race week', at({ daysToGoalRace: 4 })],
  ['race morning', at({ isRaceDay: true, daysToGoalRace: 0 })],
  ['race day, run logged', at({ dayDone: true, daysToGoalRace: 0, postRaceActive: true, daysSinceRace: 0, hasRecentRace: true })],
  ['day 1 post-race', davidPostRaceDay1],
  ['day 5 post-race', at({ ...davidPostRaceDay1, daysSinceRace: 5, readinessBand: 'moderate' })],
  ['recovery, race out of window', at({ inRecoveryWindow: true, recoveryWindowAvailable: true, betweenBlocks: true, weekPlannedMi: 23, weekLoggedMi: 9 })],
  ['between blocks', at({ betweenBlocks: true, hasGoalRace: false, daysToGoalRace: null, prescribed: 'none', weekPlannedMi: 0, weekLoggedMi: 0 })],
  ['no goal', at({ hasGoalRace: false, daysToGoalRace: null })],
  ['injury', at({ injuryActive: true, prescribed: 'rest', decisionCount: 1 })],
  ['missed yesterday', at({ missedYesterday: true })],
  ['coached externally', at({ coachedExternally: true, prescribed: 'none', hasGoalRace: false, daysToGoalRace: null })],
  ['rest day mid-build', at({ prescribed: 'rest' })],
  ['another day in the strip', at({ isTodayCard: false })],
];

describe('invariants across every state C1 lists', () => {
  it('readiness resolves to exactly one readout', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      expect(c.readiness.readouts, name).toHaveLength(1);
      expect(c.readiness.readouts, name).toEqual(['header']);
    }
  });

  it('every beat appears at most once', () => {
    for (const [name, input] of EVERY_STATE) {
      const { beats } = composeToday(input);
      expect(new Set(beats).size, name).toBe(beats.length);
    }
  });

  it("beat 1 answers 'what am I doing today' except on race morning", () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      if (c.state === 'race-morning') {
        expect(c.hero, name).toBe('race');
        continue;
      }
      // The race takes the top only the day of, or when there is no plan
      // row at all to lead with.
      if (c.hero === 'recent') {
        expect(input.daysSinceRace, name).toBeLessThanOrEqual(1);
        continue;
      }
      expect(c.hero, name).toBe('work');
      const work = idx(c.beats, 'work');
      const recent = idx(c.beats, 'recent');
      if (recent >= 0) expect(work, name).toBeLessThan(recent);
    }
  });

  it('the work beat is always on the page', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      if (c.state === 'race-morning') continue;
      expect(c.beats, name).toContain('work');
    }
  });

  it('never renders a decision beat with an empty queue', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      if (input.decisionCount === 0) expect(c.beats, name).not.toContain('decision');
      else if (c.state !== 'race-morning') expect(c.beats, name).toContain('decision');
    }
  });

  it('never renders a tile row with nothing in it', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      expect(c.tiles.show, name).toBe(c.tiles.count > 0);
    }
  });

  it('never renders a volume tile that has nothing true to say', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      if (c.tiles.volume) {
        expect(input.weekPlannedMi + input.weekLoggedMi, name).toBeGreaterThan(0);
      }
    }
  });

  it('never states a volume line and a volume tile at the same time', () => {
    for (const [name, input] of EVERY_STATE) {
      const c = composeToday(input);
      expect(c.tiles.volume && c.context.volumeLine != null, name).toBe(false);
    }
  });
});

/* ── per-state order ─────────────────────────────────────────────────── */

describe('state selection', () => {
  it('reads the state off the real countdown, not a phase label', () => {
    expect(selectTodayState(at({ daysToGoalRace: 0, isRaceDay: true }))).toBe('race-morning');
    expect(selectTodayState(at({ daysToGoalRace: 3 }))).toBe('race-week');
    expect(selectTodayState(at({ daysToGoalRace: 6 }))).toBe('race-week');
    expect(selectTodayState(at({ daysToGoalRace: 7 }))).toBe('taper');
    expect(selectTodayState(at({ daysToGoalRace: 21 }))).toBe('taper');
    expect(selectTodayState(at({ daysToGoalRace: 22 }))).toBe('build');
  });

  it('separates the post-race window from the recovery block that outlives it', () => {
    expect(selectTodayState(davidPostRaceDay1)).toBe('post-race');
    expect(selectTodayState(at({ inRecoveryWindow: true, recoveryWindowAvailable: true }))).toBe('recovery');
  });

  it('an injury outranks whatever else is true', () => {
    expect(selectTodayState(at({ injuryActive: true, daysToGoalRace: 3 }))).toBe('injury');
    // …except race morning, which the runner is already standing on.
    expect(selectTodayState(at({ injuryActive: true, isRaceDay: true }))).toBe('race-morning');
  });

  it('a day the runner navigated back to is its own state', () => {
    expect(selectTodayState(at({ isTodayCard: false, isRaceDay: true }))).toBe('other-day');
  });
});

describe('race morning · the race takes the page', () => {
  const c = composeToday(at({ isRaceDay: true, daysToGoalRace: 0, decisionCount: 2, missedYesterday: true }));

  it('is the hero and essentially the only beat', () => {
    expect(c.hero).toBe('race');
    expect(c.beats).toEqual(['race']);
  });

  it('hides the week strip, the tiles and the brief', () => {
    expect(c.context.show).toBe(false);
    expect(c.context.strip).toBe('none');
    expect(c.tiles.show).toBe(false);
    expect(c.beats).not.toContain('brief');
  });

  it('still lets an injury protocol through above it', () => {
    const inj = composeToday(at({ isRaceDay: true, injuryActive: true }));
    expect(inj.beats[0]).toBe('alert');
  });
});

describe('race day itself, once the race is logged', () => {
  const c = composeToday(at({
    dayDone: true, daysToGoalRace: 0, postRaceActive: true, daysSinceRace: 0,
    hasRecentRace: true, prescribed: 'run', hasMorningBrief: false,
  }));

  it('gives the result the hero · this is the one day it earns it', () => {
    expect(c.hero).toBe('recent');
    expect(c.beats[0]).toBe('recent');
    expect(idx(c.beats, 'recent')).toBeLessThan(idx(c.beats, 'work'));
  });
});

describe('day 1 post-race with no plan row at all', () => {
  it('lets the race lead, because there is no work to lead with', () => {
    const c = composeToday(at({
      postRaceActive: true, daysSinceRace: 1, hasRecentRace: true,
      prescribed: 'none', recoveryWindowAvailable: false, weekPlannedMi: 0, weekLoggedMi: 0,
    }));
    expect(c.hero).toBe('recent');
    expect(selectRecentTreatment(at({
      postRaceActive: true, daysSinceRace: 1, hasRecentRace: true, prescribed: 'none',
    }))).toBe('hero');
  });

  it('but a prescribed rest day still outranks it · rest is the work', () => {
    const c = composeToday(at({
      postRaceActive: true, daysSinceRace: 1, hasRecentRace: true, prescribed: 'rest',
      inRecoveryWindow: true, recoveryWindowAvailable: true, weekPlannedMi: 12, weekLoggedMi: 0,
    }));
    expect(c.hero).toBe('work');
    expect(c.recent.treatment).toBe('line');
  });
});

describe('the race stops being news', () => {
  it('compresses to a line from day 2 and disappears past the window', () => {
    const day = (daysSinceRace: number, postRaceActive = true) =>
      composeToday(at({
        postRaceActive, daysSinceRace, hasRecentRace: true,
        inRecoveryWindow: true, recoveryWindowAvailable: true,
        weekPlannedMi: 23, weekLoggedMi: 4,
      })).recent.treatment;
    expect(day(2)).toBe('line');
    expect(day(6)).toBe('line');
    // Outside the composed post-race window the beat is gone entirely.
    expect(day(9, false)).toBe('none');
  });

  it('drops the confirm once the chip time is locked in', () => {
    const c = composeToday(at({
      ...davidPostRaceDay1, raceResultAcknowledged: true,
    }));
    expect(c.recent.needsConfirm).toBe(false);
  });
});

describe('mid-build · the tiles that do earn their place', () => {
  const c = composeToday(base);

  it('runs work, context, tiles', () => {
    expect(c.beats).toEqual(['brief', 'work', 'context', 'tiles']);
    expect(c.context.strip).toBe('week');
  });

  it('shows the goal tiles and the volume tile, not the form trend', () => {
    expect(c.tiles.gap).toBe(true);
    expect(c.tiles.raceDay).toBe(true);
    expect(c.tiles.volume).toBe(true);
    expect(c.tiles.form).toBe(false);
    expect(c.tiles.count).toBe(3);
  });

  it('brings the form tile back only when it changes today', () => {
    expect(composeToday(at({ formLabel: 'OVERREACH' })).tiles.form).toBe(true);
    expect(composeToday(at({ formLabel: 'DETRAINING' })).tiles.form).toBe(true);
    for (const l of ['LOADED', 'PRODUCTIVE', 'RACE-READY', 'BUILDING', null]) {
      expect(composeToday(at({ formLabel: l })).tiles.form, String(l)).toBe(false);
    }
  });
});

describe('between blocks with no goal race', () => {
  const c = composeToday(at({
    betweenBlocks: true, hasGoalRace: false, daysToGoalRace: null,
    prescribed: 'none', weekPlannedMi: 0, weekLoggedMi: 0, hasMorningBrief: false,
  }));

  it('drops both goal tiles and the dead volume tile', () => {
    expect(c.tiles.show).toBe(false);
    expect(c.context.volumeLine).toBeNull();
  });

  it('still opens with the work beat, which says there is none', () => {
    expect(c.beats[0]).toBe('work');
  });
});

describe('the interruptions', () => {
  it('puts a decision under the hero, never above it', () => {
    const c = composeToday(at({ decisionCount: 2 }));
    expect(idx(c.beats, 'work')).toBeLessThan(idx(c.beats, 'decision'));
  });

  it('puts a missed yesterday under the decision, and only on today', () => {
    const c = composeToday(at({ decisionCount: 1, missedYesterday: true }));
    expect(c.beats).toEqual(['brief', 'work', 'decision', 'missed', 'context', 'tiles']);
    expect(composeToday(at({ isTodayCard: false, missedYesterday: true })).beats)
      .not.toContain('missed');
  });

  it('puts an injury protocol above everything', () => {
    const c = composeToday(at({ injuryActive: true, decisionCount: 1 }));
    expect(c.beats[0]).toBe('alert');
    expect(c.state).toBe('injury');
  });
});

describe('a day the runner navigated back to', () => {
  const c = composeToday(at({ isTodayCard: false, dayDone: true, postRaceActive: true, hasRecentRace: true, daysSinceRace: 1 }));

  it('shows that day and its week, and nothing about today', () => {
    expect(c.state).toBe('other-day');
    expect(c.beats).toContain('work');
    expect(c.beats).not.toContain('brief');
    expect(c.beats).not.toContain('recent');
    expect(c.recent.treatment).toBe('none');
  });
});
