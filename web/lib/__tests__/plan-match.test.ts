/**
 * plan-match — match logic + completion threshold + shoe-type mapping.
 *
 * Covers the regression points in BUGFIX_RUN_COMPLETION_WORKFLOW:
 *   - same-day distance-tolerant matching (±15%)
 *   - rest days don't match (a rogue easy 5-miler on a rest day stays
 *     unmatched)
 *   - 60% completion threshold
 *   - shoe-type mapping picks the right RunType for each WorkoutType
 *
 * Synthetic fixtures (no DB / no Strava). Verifies the contract the
 * /api/strava/sync route depends on, plus the UI completion pins on
 * /overview and /workout/[date].
 */

import { describe, it, expect } from 'vitest';
import {
  activityMatchesWorkout,
  findActivityForWorkout,
  findWorkoutForActivity,
  findWorkoutForDate,
  buildPlanMatches,
  isWorkoutComplete,
  runTypeForWorkout,
  getCompletedMileageByDate,
  COMPLETION_MIN_FRACTION,
} from '../plan-match';
import {
  plannedActivityTitle,
  nameAlreadyMatchesPlan,
  formatActivityDate,
} from '../strava-writeback';
import type { Plan, PlanWorkout, PlanWeek } from '../../coach/plan-types';
import type { NormalizedActivity } from '../../app/api/strava/activities/route-shared';

// ── Fixtures ──────────────────────────────────────────────────────

function makeWorkout(over: Partial<PlanWorkout>): PlanWorkout {
  return {
    id: 'w-' + (over.dateISO ?? 'x'),
    dateISO: '2026-04-14',
    dow: 2,
    type: 'easy',
    distanceMi: 6,
    paceTargetSPerMi: 540,
    durationMin: null,
    isQuality: false,
    isLong: false,
    notes: '',
    subLabel: null,
    originalDateISO: '2026-04-14',
    originalType: 'easy',
    originalDistanceMi: 6,
    mutations: [],
    ...over,
  };
}

function makeActivity(over: Partial<NormalizedActivity>): NormalizedActivity {
  return {
    id: 100,
    name: 'Morning Run',
    type: 'Run',
    sportType: 'Run',
    workoutType: 0,
    startLocal: '2026-04-14T07:00:00Z',
    date: '2026-04-14',
    distanceMi: 6.1,
    movingTimeS: 3300,
    elapsedTimeS: 3300,
    paceSPerMi: 540,
    avgHr: 142,
    maxHr: 152,
    avgCadence: 174,
    elevGainFt: 60,
    avgSpeedMph: 6.5,
    startLatLng: null,
    endLatLng: null,
    summaryPolyline: null,
    kudosCount: 0,
    achievementCount: 0,
    sufferScore: null,
    canonicalFinishS: null,
    canonicalDistanceMi: null,
    canonicalLabel: null,
    ...over,
  };
}

function makePlan(workouts: PlanWorkout[]): Plan {
  const week: PlanWeek = {
    id: 'wk-1',
    weekIdx: 0,
    weekStartISO: '2026-04-13',
    phaseId: 'ph-1',
    isCutback: false,
    isPeak: false,
    isRaceWeek: false,
    rationale: '',
    workouts,
  };
  return {
    id: 'plan-1',
    userId: 'me',
    mode: 'race-prep',
    raceId: null,
    goalISO: '2026-06-01',
    authoredISO: '2026-04-01T00:00:00Z',
    authoredFromState: {
      weeklyAvg4w: 30,
      weeklyAvg8w: 28,
      longestTrainingRunLast28Mi: 12,
      level: 'intermediate',
      longRunDow: 0,
      qualityDows: [2, 4],
      restDow: 1,
      builderVersion: 1,
    },
    phases: [{ id: 'ph-1', label: 'BASE', startWeekIdx: 0, endWeekIdx: 0, rationale: '', citation: '' }],
    weeks: [week],
    archivedISO: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('activityMatchesWorkout', () => {
  it('matches a same-day run within ±15% distance', () => {
    const w = makeWorkout({ distanceMi: 6 });
    expect(activityMatchesWorkout(makeActivity({ distanceMi: 5.4 }), w)).toBe(true);
    expect(activityMatchesWorkout(makeActivity({ distanceMi: 6.8 }), w)).toBe(true);
  });

  it('rejects activities outside ±15% distance', () => {
    const w = makeWorkout({ distanceMi: 6 });
    // 16.7 mi (long run on a 6 mi planned day) is well outside.
    expect(activityMatchesWorkout(makeActivity({ distanceMi: 16.7 }), w)).toBe(false);
    expect(activityMatchesWorkout(makeActivity({ distanceMi: 3 }), w)).toBe(false);
  });

  it('rejects activities on other dates', () => {
    const w = makeWorkout({ dateISO: '2026-04-14', distanceMi: 6 });
    expect(activityMatchesWorkout(makeActivity({ date: '2026-04-15' }), w)).toBe(false);
  });

  it('rejects rest-day workouts even when an activity exists', () => {
    const w = makeWorkout({ type: 'rest', distanceMi: 0 });
    expect(activityMatchesWorkout(makeActivity({ distanceMi: 6 }), w)).toBe(false);
  });

  it('rejects non-run activities (ride, swim)', () => {
    const w = makeWorkout({ distanceMi: 6 });
    expect(activityMatchesWorkout(makeActivity({ type: 'Ride', sportType: 'Ride' }), w)).toBe(false);
  });
});

describe('findActivityForWorkout', () => {
  it('prefers the activity closest to planned distance', () => {
    const w = makeWorkout({ distanceMi: 6 });
    const acts = [
      makeActivity({ id: 1, distanceMi: 5.3 }),
      makeActivity({ id: 2, distanceMi: 6.1 }),  // closest
      makeActivity({ id: 3, distanceMi: 6.5 }),
    ];
    expect(findActivityForWorkout(w, acts)?.id).toBe(2);
  });

  it('falls back to the longest same-day run when none is within ±15%', () => {
    const w = makeWorkout({ distanceMi: 6 });
    const acts = [
      makeActivity({ id: 1, distanceMi: 2 }),  // way too short
      makeActivity({ id: 2, distanceMi: 16 }), // way too long but longest
    ];
    expect(findActivityForWorkout(w, acts)?.id).toBe(2);
  });

  it('returns null when no run on that date', () => {
    const w = makeWorkout({ dateISO: '2026-04-14' });
    const acts = [makeActivity({ date: '2026-04-15' })];
    expect(findActivityForWorkout(w, acts)).toBeNull();
  });
});

describe('isWorkoutComplete', () => {
  it('treats actual ≥ 60% planned as complete', () => {
    expect(isWorkoutComplete(10, 6)).toBe(true);  // exactly threshold
    expect(isWorkoutComplete(10, 10)).toBe(true);
    expect(isWorkoutComplete(10, 12)).toBe(true);
  });

  it('treats actual < 60% planned as incomplete', () => {
    expect(isWorkoutComplete(10, 5.9)).toBe(false);
    expect(isWorkoutComplete(10, 0)).toBe(false);
  });

  it('never marks a rest / zero-planned day complete', () => {
    expect(isWorkoutComplete(0, 5)).toBe(false);
  });

  it('uses the documented threshold constant', () => {
    expect(COMPLETION_MIN_FRACTION).toBe(0.6);
  });
});

describe('findWorkoutForActivity / findWorkoutForDate', () => {
  const plan = makePlan([
    makeWorkout({ dateISO: '2026-04-13', type: 'long', distanceMi: 14 }),
    makeWorkout({ dateISO: '2026-04-14', type: 'easy', distanceMi: 6 }),
    makeWorkout({ dateISO: '2026-04-15', type: 'rest', distanceMi: 0 }),
  ]);

  it('finds the workout for a given activity by date + distance', () => {
    const w = findWorkoutForActivity(plan, makeActivity({ date: '2026-04-14', distanceMi: 6.1 }));
    expect(w?.dateISO).toBe('2026-04-14');
    expect(w?.type).toBe('easy');
  });

  it('returns null when no plan workout matches', () => {
    expect(findWorkoutForActivity(plan, makeActivity({ date: '2026-04-20' }))).toBeNull();
  });

  it('findWorkoutForDate includes rest days', () => {
    expect(findWorkoutForDate(plan, '2026-04-15')?.type).toBe('rest');
  });
});

describe('buildPlanMatches', () => {
  it('only returns matches for non-rest, non-zero-distance days', () => {
    const plan = makePlan([
      makeWorkout({ dateISO: '2026-04-13', type: 'long', distanceMi: 14 }),
      makeWorkout({ dateISO: '2026-04-14', type: 'easy', distanceMi: 6 }),
      makeWorkout({ dateISO: '2026-04-15', type: 'rest', distanceMi: 0 }),
    ]);
    const acts = [
      makeActivity({ id: 1, date: '2026-04-13', distanceMi: 14.2 }),
      makeActivity({ id: 2, date: '2026-04-14', distanceMi: 5.8 }),
      makeActivity({ id: 3, date: '2026-04-15', distanceMi: 4 }), // unmatched, rest day
    ];
    const matches = buildPlanMatches(plan, acts);
    expect(matches).toHaveLength(2);
    expect(matches.map(m => m.activity.id).sort()).toEqual([1, 2]);
    expect(matches.every(m => m.isComplete)).toBe(true);
  });

  it('marks under-distance matches as incomplete', () => {
    const plan = makePlan([makeWorkout({ distanceMi: 10 })]);
    const acts = [makeActivity({ distanceMi: 5.5 })]; // 55% < 60%
    const matches = buildPlanMatches(plan, acts);
    expect(matches).toHaveLength(1);
    expect(matches[0].isComplete).toBe(false);
  });
});

describe('runTypeForWorkout', () => {
  it('maps the plan workout type to the right shoe RunType', () => {
    expect(runTypeForWorkout('easy')).toBe('easy');
    expect(runTypeForWorkout('long')).toBe('long');
    expect(runTypeForWorkout('recovery')).toBe('recovery');
    expect(runTypeForWorkout('shakeout')).toBe('recovery');
    expect(runTypeForWorkout('threshold')).toBe('tempo');
    expect(runTypeForWorkout('mp')).toBe('tempo');
    expect(runTypeForWorkout('interval')).toBe('intervals');
    expect(runTypeForWorkout('race')).toBe('race');
    expect(runTypeForWorkout('rest')).toBe('as_needed');
  });
});

describe('getCompletedMileageByDate', () => {
  it('reports per-date completed miles for planned days', () => {
    const plan = makePlan([
      makeWorkout({ dateISO: '2026-04-13', type: 'long', distanceMi: 14 }),
      makeWorkout({ dateISO: '2026-04-14', type: 'easy', distanceMi: 6 }),
    ]);
    const acts = [
      makeActivity({ date: '2026-04-13', distanceMi: 14.2 }),
      makeActivity({ date: '2026-04-14', distanceMi: 5.4 }),
    ];
    const m = getCompletedMileageByDate(plan, acts);
    expect(m.get('2026-04-13')).toBe(14.2);
    expect(m.get('2026-04-14')).toBe(5.4);
  });
});

// ── strava-writeback title generator ─────────────────────────────

describe('plannedActivityTitle', () => {
  it('generates "Type · Mon DD" for plain workouts', () => {
    const w = makeWorkout({ type: 'easy', dateISO: '2026-04-14' });
    expect(plannedActivityTitle(w)).toBe('Easy · Apr 14');
  });

  it('includes subLabel when present and not duplicative', () => {
    const w = makeWorkout({ type: 'long', dateISO: '2026-04-13', subLabel: 'Long Run · HM Finish' });
    expect(plannedActivityTitle(w)).toBe('Long Run · HM Finish · Apr 13');
  });

  it('strips duplicate type prefix from subLabel', () => {
    const w = makeWorkout({ type: 'long', dateISO: '2026-04-13', subLabel: 'Long Run · Progression' });
    expect(plannedActivityTitle(w)).toBe('Long Run · Progression · Apr 13');
  });

  it('handles threshold sessions', () => {
    const w = makeWorkout({ type: 'threshold', dateISO: '2026-04-16' });
    expect(plannedActivityTitle(w)).toBe('Threshold · Apr 16');
  });
});

describe('nameAlreadyMatchesPlan', () => {
  it('returns true on exact match', () => {
    expect(nameAlreadyMatchesPlan('Easy · Apr 14', 'Easy · Apr 14')).toBe(true);
  });

  it('returns true when the activity has appended notes', () => {
    expect(nameAlreadyMatchesPlan('Easy · Apr 14 · felt great', 'Easy · Apr 14')).toBe(true);
  });

  it('returns false on Strava default name', () => {
    expect(nameAlreadyMatchesPlan('Morning Run', 'Easy · Apr 14')).toBe(false);
  });

  it('returns false when only the type matches but not the date', () => {
    expect(nameAlreadyMatchesPlan('Easy · Apr 13', 'Easy · Apr 14')).toBe(false);
  });
});

describe('formatActivityDate', () => {
  it('formats ISO dates as "Mon DD"', () => {
    expect(formatActivityDate('2026-04-14')).toBe('Apr 14');
    expect(formatActivityDate('2026-01-01')).toBe('Jan 1');
    expect(formatActivityDate('2026-12-31')).toBe('Dec 31');
  });
});
