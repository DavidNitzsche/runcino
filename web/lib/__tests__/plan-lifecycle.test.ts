/**
 * plan-lifecycle · pure decision rules.
 *
 * Tests lifecycleCheck() in isolation — no DB. Confirms:
 *   - first-time (no plan)
 *   - transition (goal passed)
 *   - transition (new A-race)
 *   - rewrite (state drift ≥40% with no mutations)
 *   - continue (steady state)
 */

import { describe, it, expect } from 'vitest';
import { lifecycleCheck } from '../../coach/plan-lifecycle';
import type { CoachState } from '../coach-state';
import type { Plan } from '../../coach/plan-types';

function makeState(overrides: Partial<CoachState> = {}): CoachState {
  const base: CoachState = {
    now: '2026-05-11',
    races: { nextA: null, nextAny: null, inWindow: [], recent: [], raceCount30d: 0 },
    volume: {
      last7Mi: 25, last28Mi: 100, last7Days: [],
      weeklyAvg4w: 25, weeklyAvg8w: 25,
      longestLast28Mi: 10, longestTrainingRunLast28Mi: 10, preRaceLongestTrainingMi: null,
      deltaPct4v4: 0,
    },
    intensity: { easyMi14d: 40, hardMi14d: 10, easyShare14d: 0.8 },
    recovery: {
      daysSinceLastRun: 1, consecutiveRunDays: 4, yesterday: null, today: null,
      hrv7dAvgMs: null, rhrBpm: null, sleep7dAvgHrs: null, strengthDaysThisWeek: null,
    },
    flags: { heavyBlockSuspected: false, rebuildAfterBreak: false, healthKitAvailable: false },
    checkin: null,
    recoveryWindowEndsISO: null,
    prefs: { longRunDow: 6, qualityDows: [2, 4], restDow: 1, level: null, isDefaults: true },
  };
  return { ...base, ...overrides };
}

function makePlan(overrides: Partial<Plan> = {}): Plan {
  const base: Plan = {
    id: 'p1',
    userId: 'me',
    mode: 'race-prep',
    raceId: 'r1',
    goalISO: '2026-08-01',
    authoredISO: '2026-05-01T12:00:00Z',
    authoredFromState: {
      weeklyAvg4w: 25,
      weeklyAvg8w: 25,
      longestTrainingRunLast28Mi: 10,
      level: 'intermediate',
      longRunDow: 6,
      qualityDows: [2, 4],
      restDow: 1,
    },
    phases: [],
    weeks: [],
    archivedISO: null,
  };
  return { ...base, ...overrides };
}

describe('lifecycleCheck', () => {
  it('first-time when no plan exists', () => {
    expect(lifecycleCheck(null, makeState())).toBe('first-time');
  });

  it('transition when goalISO has passed', () => {
    const plan = makePlan({ goalISO: '2026-04-01' });
    expect(lifecycleCheck(plan, makeState())).toBe('transition');
  });

  it('transition when a new A-race is set that the plan doesn\'t represent', () => {
    const plan = makePlan({ goalISO: '2026-08-01', raceId: 'old-race' });
    const state = makeState({
      races: {
        nextA: {
          slug: 'new-race', name: 'New A',
          date: '2026-09-15', distanceMi: 13.1,
          goalDisplay: '', goalFinishS: null, priority: 'A', daysAway: 100,
        },
        nextAny: null, inWindow: [], recent: [], raceCount30d: 0,
      },
    });
    expect(lifecycleCheck(plan, state)).toBe('transition');
  });

  it('rewrite when state drift ≥40% with no mutations applied', () => {
    const plan = makePlan({ goalISO: '2026-08-01' });
    const state = makeState({
      volume: {
        last7Mi: 50, last28Mi: 200, last7Days: [],
        weeklyAvg4w: 50, weeklyAvg8w: 50,  // 100% drift from authored 25
        longestLast28Mi: 15, longestTrainingRunLast28Mi: 15, preRaceLongestTrainingMi: null,
        deltaPct4v4: null,
      },
    });
    expect(lifecycleCheck(plan, state)).toBe('rewrite');
  });

  it('continue when state is on-plan', () => {
    const plan = makePlan({ goalISO: '2026-08-01' });
    expect(lifecycleCheck(plan, makeState())).toBe('continue');
  });
});
