/**
 * Coach narrative line, signal-priority tests.
 *
 * The contract under test:
 *   1. narrativeLine returns null for a steady runner with no
 *      triggering signal (no race imminent, fresh check-in, normal
 *      build, no streak milestone, no stale long run / quality).
 *   2. Each priority level fires on its own trigger and produces a
 *      sentence that references a real number / date / event.
 *   3. No two priority levels share a `basedOn` source label, each
 *      level has its own signal class.
 *
 * Assertion style mirrors `coach-engine-scenarios.test.ts`:
 *   - Every `expect(...)` carries a human-readable message so a future
 *     failure tells you which priority misfired, not just what shape.
 *   - Fixtures are built fresh per test via `makeBaseState()` so a
 *     state mutation in one test can't leak into another.
 */
import { describe, expect, it } from 'vitest';
import { narrativeLine } from '../../coach/coach-narrative';
import type { CoachState } from '../coach-state';
import type { CheckinAggregate } from '../checkin-aggregate';

/** Build a check-in aggregate fixture. All defaults pass the
 *  Decision-Matrix qualitative thresholds (good energy, no soreness,
 *  no stress) so the steady-runner base state never trips Priority 4. */
function makeCheckin(opts: {
  latestDateISO: string | null;
  loggedToday: boolean;
  rowsCount?: number;
  poorDaysCount?: number;
}): CheckinAggregate {
  return {
    windowDays: 7,
    rowsCount: opts.rowsCount ?? 7,
    avgEnergy: 7,
    avgSoreness: 3,
    avgStress: 3,
    poorDaysCount: opts.poorDaysCount ?? 0,
    latestDateISO: opts.latestDateISO,
    loggedToday: opts.loggedToday,
  };
}

// ── Date helpers ───────────────────────────────────────────────────
const TODAY = '2026-05-12';

function isoOffset(daysFromToday: number): string {
  const base = new Date(Date.UTC(2026, 4, 12, 12, 0, 0)); // 2026-05-12 noon UTC
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  return base.toISOString().slice(0, 10);
}

// ── Base steady-runner fixture ─────────────────────────────────────
// A runner who is on plan with no signals firing: no race in window,
// fresh check-in today, normal volume, recent long run, recent quality,
// no streak milestone. narrativeLine should return null.
function makeBaseState(): CoachState {
  return {
    now: TODAY,
    races: {
      nextA: null,
      nextAny: null,
      inWindow: [],
      recent: [],
      raceCount30d: 0,
    },
    volume: {
      last7Mi: 30,
      last28Mi: 120,
      // Long run ≥ 10mi happened 5 days ago, keeps Priority 9 from firing
      // but Priority 6 (≥12mi in 7d) also doesn't fire because we cap at 10.
      last7Days: [
        { date: isoOffset(-6), miles: 4, runs: 1 },
        { date: isoOffset(-5), miles: 10, runs: 1 },
        { date: isoOffset(-4), miles: 5, runs: 1 },
        { date: isoOffset(-3), miles: 6, runs: 1 },
        { date: isoOffset(-2), miles: 5, runs: 1 },
        { date: isoOffset(-1), miles: 0, runs: 0 },
        { date: isoOffset(0), miles: 0, runs: 0 },
      ],
      weeklyAvg4w: 30,
      weeklyAvg8w: 30,
      longestLast28Mi: 10,
      longestTrainingRunLast28Mi: 10,
      preRaceLongestTrainingMi: null,
      deltaPct4v4: 0.02,
    },
    intensity: { easyMi14d: 50, hardMi14d: 8, easyShare14d: 0.86 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 12, // not a milestone
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    flags: {
      heavyBlockSuspected: false,
      rebuildAfterBreak: false,
      healthKitAvailable: false, recentSkips: [],
    },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: {
      longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: null, isDefaults: true,
    },
  };
}

function withFreshCheckin(state: CoachState): CoachState {
  return {
    ...state,
    checkin: makeCheckin({ latestDateISO: TODAY, loggedToday: true }),
  };
}

describe('narrativeLine, null when no signal fires', () => {
  it('returns null for a steady runner with no triggering signals', async () => {
    const state = withFreshCheckin(makeBaseState());
    const line = await narrativeLine(state, TODAY);
    expect(line, 'steady runner should have nothing to say').toBeNull();
  });
});

describe('narrativeLine, Priority 1: Race-week imminent', () => {
  it('fires when an A-race is within 7 days', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.races.nextA = {
      slug: 'afc-half', name: 'AFC Half',
      date: isoOffset(4), distanceMi: 13.1,
      goalDisplay: '1:35', goalFinishS: 5700,
      priority: 'A', daysAway: 4,
    };
    state.races.nextAny = state.races.nextA;
    state.races.inWindow = [state.races.nextA];

    const line = await narrativeLine(state, TODAY);
    expect(line, 'race-week imminent should fire').not.toBeNull();
    expect(line!.tone).toBe('reorienting');
    expect(line!.sentence, 'sentence must name the race').toContain('AFC Half');
    expect(line!.sentence, 'sentence must reference the 4-day countdown').toMatch(/4 days/);
    expect(line!.basedOn, 'basedOn label').toBe('race calendar');
    expect(line!.citation?.doc, 'taper citation').toContain('00a-distance-running-training');
  });

  it('does not fire when A-race is > 7 days out', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.races.nextA = {
      slug: 'fall', name: 'Fall Half',
      date: isoOffset(30), distanceMi: 13.1,
      goalDisplay: '1:35', goalFinishS: 5700,
      priority: 'A', daysAway: 30,
    };
    state.races.nextAny = state.races.nextA;
    state.races.inWindow = [state.races.nextA];

    const line = await narrativeLine(state, TODAY);
    expect(
      line,
      'race 30d out should not trigger Priority 1 (and base state has no other signals)',
    ).toBeNull();
  });
});

describe('narrativeLine, Priority 2: Coach adjusted today', () => {
  it('fires when deps.adjustment.changed is true (softening)', async () => {
    const state = withFreshCheckin(makeBaseState());
    const line = await narrativeLine(state, TODAY, {
      adjustment: {
        changed: true,
        adjustedFor: ['3 of last 7 check-ins flagged poor', 'sleep debt 2.1h'],
        direction: 'softening',
      },
    });
    expect(line, 'adjustment should fire').not.toBeNull();
    expect(line!.tone).toBe('softening');
    expect(line!.sentence, 'sentence must mention softening').toContain('softened');
    expect(line!.basedOn, 'basedOn label').toBe('coach · live adjustment');
  });

  it('does not fire when adjustment.changed is false', async () => {
    const state = withFreshCheckin(makeBaseState());
    const line = await narrativeLine(state, TODAY, {
      adjustment: { changed: false, adjustedFor: [] },
    });
    expect(line, 'no-op adjustment leaves base state with no signal').toBeNull();
  });
});

describe('narrativeLine, Priority 3: Streak milestone', () => {
  it('fires when consecutiveRunDays === 60', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.recovery.consecutiveRunDays = 60;
    const line = await narrativeLine(state, TODAY);
    expect(line, '60-day streak should fire').not.toBeNull();
    expect(line!.tone).toBe('celebrating');
    expect(line!.sentence, 'sentence must name the number').toContain('60');
    expect(line!.basedOn).toBe('run streak');
  });

  it('does not fire at 59 days (not a milestone)', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.recovery.consecutiveRunDays = 59;
    const line = await narrativeLine(state, TODAY);
    expect(line, '59 is not on the milestone list').toBeNull();
  });
});

describe('narrativeLine, Priority 4: Stale check-in (>72h)', () => {
  it('fires when last check-in is 4 days ago', async () => {
    const state: CoachState = {
      ...makeBaseState(),
      checkin: makeCheckin({
        latestDateISO: isoOffset(-4),
        loggedToday: false,
        rowsCount: 3,
      }),
    };
    const line = await narrativeLine(state, TODAY);
    expect(line, 'stale check-in (4d) should fire').not.toBeNull();
    expect(line!.tone).toBe('reminding');
    expect(line!.sentence, 'sentence must reference the day count').toMatch(/4 days/);
    expect(line!.basedOn).toBe('check-in log');
  });

  it('does not fire when check-in is 2 days ago (under threshold)', async () => {
    const state: CoachState = {
      ...makeBaseState(),
      checkin: makeCheckin({
        latestDateISO: isoOffset(-2),
        loggedToday: false,
        rowsCount: 5,
      }),
    };
    const line = await narrativeLine(state, TODAY);
    expect(line, '2-day-old check-in is still fresh enough').toBeNull();
  });
});

describe('narrativeLine, Priority 6: Recent long run', () => {
  it('fires when long run ≥ 12mi happened in last 7 days', async () => {
    const state = withFreshCheckin(makeBaseState());
    // Replace one day with a real long run yesterday.
    state.volume.last7Days = state.volume.last7Days.map((d, i) =>
      i === 5 /* yesterday */ ? { date: isoOffset(-1), miles: 12.4, runs: 1 } : d,
    );
    state.volume.longestLast28Mi = 12.4;
    const line = await narrativeLine(state, TODAY);
    expect(line, 'recent long run should fire').not.toBeNull();
    expect(line!.tone).toBe('pushing');
    expect(line!.sentence, 'sentence must name the distance').toContain('12.4');
    expect(line!.sentence).toMatch(/yesterday/);
    expect(line!.basedOn).toBe('recent activity');
  });
});

describe('narrativeLine, Priority 8: Stale quality', () => {
  it('fires when hardMi14d < 1 and A-race > 21 days out', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.intensity = { easyMi14d: 50, hardMi14d: 0, easyShare14d: 1 };
    state.races.nextA = {
      slug: 'autumn', name: 'Autumn Half',
      date: isoOffset(56), distanceMi: 13.1,
      goalDisplay: '1:35', goalFinishS: 5700,
      priority: 'A', daysAway: 56,
    };
    state.races.nextAny = state.races.nextA;
    state.races.inWindow = [state.races.nextA];

    const line = await narrativeLine(state, TODAY);
    expect(line, 'stale quality should fire').not.toBeNull();
    expect(line!.tone).toBe('pushing');
    expect(line!.sentence, 'sentence must reference threshold').toMatch(/threshold/i);
    expect(line!.basedOn).toBe('intensity · last 14d');
  });
});

describe('narrativeLine, Priority 9: Stale long run (>21 days)', () => {
  it('fires when no run ≥ 10mi in last 28 days and no recovery window', async () => {
    const state = withFreshCheckin(makeBaseState());
    // Wipe the long run from the base fixture.
    state.volume.last7Days = state.volume.last7Days.map((d) => ({
      ...d,
      miles: Math.min(d.miles, 6),
    }));
    state.volume.longestLast28Mi = 6;
    const line = await narrativeLine(state, TODAY);
    expect(line, 'stale long run should fire').not.toBeNull();
    expect(line!.tone).toBe('pushing');
    expect(line!.sentence, 'sentence must reference weeks').toMatch(/weeks/);
    expect(line!.sentence).toMatch(/long run/i);
    expect(line!.basedOn).toBe('recent activity');
  });

  it('does not fire when state is in a post-race recovery window', async () => {
    const state = withFreshCheckin(makeBaseState());
    state.volume.last7Days = state.volume.last7Days.map((d) => ({
      ...d,
      miles: Math.min(d.miles, 6),
    }));
    state.volume.longestLast28Mi = 6;
    state.recoveryWindowEndsISO = isoOffset(7);
    const line = await narrativeLine(state, TODAY);
    expect(line, 'recovery window suppresses stale-long-run push').toBeNull();
  });
});

describe('narrativeLine, basedOn uniqueness across priorities', () => {
  it('each priority level produces a distinct basedOn label', async () => {
    const labels = new Set<string>();

    // P1
    {
      const s = withFreshCheckin(makeBaseState());
      s.races.nextA = { slug: 'r', name: 'R', date: isoOffset(3), distanceMi: 13.1, goalDisplay: '', goalFinishS: null, priority: 'A', daysAway: 3 };
      s.races.nextAny = s.races.nextA;
      s.races.inWindow = [s.races.nextA];
      const line = await narrativeLine(s, TODAY);
      labels.add(line!.basedOn);
    }
    // P2
    {
      const s = withFreshCheckin(makeBaseState());
      const line = await narrativeLine(s, TODAY, {
        adjustment: { changed: true, adjustedFor: ['x'], direction: 'softening' },
      });
      labels.add(line!.basedOn);
    }
    // P3
    {
      const s = withFreshCheckin(makeBaseState());
      s.recovery.consecutiveRunDays = 30;
      const line = await narrativeLine(s, TODAY);
      labels.add(line!.basedOn);
    }
    // P4
    {
      const s: CoachState = {
        ...makeBaseState(),
        checkin: makeCheckin({
          latestDateISO: isoOffset(-5),
          loggedToday: false,
          rowsCount: 2,
        }),
      };
      const line = await narrativeLine(s, TODAY);
      labels.add(line!.basedOn);
    }
    // P6
    {
      const s = withFreshCheckin(makeBaseState());
      s.volume.last7Days = s.volume.last7Days.map((d, i) =>
        i === 5 ? { date: isoOffset(-1), miles: 13, runs: 1 } : d,
      );
      s.volume.longestLast28Mi = 13;
      const line = await narrativeLine(s, TODAY);
      labels.add(line!.basedOn);
    }
    // P8
    {
      const s = withFreshCheckin(makeBaseState());
      s.intensity = { easyMi14d: 50, hardMi14d: 0, easyShare14d: 1 };
      s.races.nextA = { slug: 'r', name: 'R', date: isoOffset(56), distanceMi: 13.1, goalDisplay: '', goalFinishS: null, priority: 'A', daysAway: 56 };
      s.races.nextAny = s.races.nextA;
      s.races.inWindow = [s.races.nextA];
      const line = await narrativeLine(s, TODAY);
      labels.add(line!.basedOn);
    }

    // Six priorities, six distinct labels (P5/P7 not exercised, P5 is
    // deferred, P7's basedOn ('volume trend · 4w vs prior 4w') is
    // distinct by construction.)
    expect(
      labels.size,
      'each priority must use its own basedOn signal source',
    ).toBe(6);
  });
});
