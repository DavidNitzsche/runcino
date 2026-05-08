/**
 * plan-validator tests — assert that the validator catches the
 * specific bug classes we shipped patches for in May 2026:
 *
 *   1. 7-day GA stretch (consecutive non-rest days)
 *   2. 26mi long run from race contamination (long-run spike)
 *   3. 30 days of rest (weekly mileage floor)
 *   4. Sat-hardcoded long for Sun-runner (long-run-day preference)
 *   5. Quality during recovery window (post-race blackout)
 *
 * Each test constructs a CoachToday-shaped plan + minimal CoachState
 * that triggers ONE specific rule, then asserts the validator
 * returns that issue. Future engine changes that re-introduce any
 * of these patterns fail in CI immediately.
 *
 * The fixtures here are minimal — only the fields the validator
 * reads. Helps keep tests focused on rules, not engine internals.
 */
import { describe, expect, it } from 'vitest';
import { validatePlan, type PlanIssue } from '../plan-validator';
import type { CoachState } from '../../lib/coach-state';
import type { CoachToday } from '../../lib/coach-engine';

// ── Test fixtures ────────────────────────────────────────────

function baseState(overrides: Partial<{
  weeklyAvg4w: number;
  weeklyAvg8w: number;
  longestLast28Mi: number;
  longRunDow: number | null;
  recoveryWindowEndsISO: string | null;
}> = {}): CoachState {
  return {
    now: '2026-05-08',
    races: { nextA: null, nextAny: null, inWindow: [], recent: [], racesForVdot: [], raceCount30d: 0 },
    volume: {
      last7Mi: 25,
      last28Mi: 120,
      last7Days: [],
      weeklyAvg4w: overrides.weeklyAvg4w ?? 30,
      weeklyAvg8w: overrides.weeklyAvg8w ?? 30,
      longestLast28Mi: overrides.longestLast28Mi ?? 8,
      deltaPct4v4: 0,
    },
    intensity: { easyMi14d: 50, hardMi14d: 12, easyShare14d: 0.80 },
    recovery: {
      daysSinceLastRun: 1,
      consecutiveRunDays: 0,
      yesterday: null,
      today: null,
      hrv7dAvgMs: null,
      rhrBpm: null,
      sleep7dAvgHrs: null,
      strengthDaysThisWeek: null,
    },
    runner: {
      age: 40,
      sex: 'unspecified',
      hrmaxBpm: null,
      rhrBpm: null,
      resolvedHrmaxBpm: 180,
      longRunDow: overrides.longRunDow ?? null,
    },
    rpe: { recent: [], avg7d: null, avgPrior7d: null, drift: null, recentHeavy: false },
    flags: { heavyBlockSuspected: false, rebuildAfterBreak: false, healthKitAvailable: false },
    recoveryWindowEndsISO: overrides.recoveryWindowEndsISO ?? null,
  };
}

function makeDay(date: string, type: string, distanceMi: number, isQuality = false, isLong = false): CoachToday['next30Days'][number] {
  return {
    date, type: type as CoachToday['next30Days'][number]['type'], label: type,
    distanceMi,
    paceTargetSPerMi: null, hrZone: null, description: '',
    isQuality, isLong, isToday: false,
    raceName: null, racePriority: null,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('validatePlan', () => {
  it('returns no issues for a clean plan', () => {
    const issues = validatePlan({
      next30Days: [
        makeDay('2026-05-11', 'rest', 0),
        makeDay('2026-05-12', 'general_aerobic', 4),
        makeDay('2026-05-13', 'threshold', 8, true),
        makeDay('2026-05-14', 'general_aerobic', 4),
        makeDay('2026-05-15', 'rest', 0),
        makeDay('2026-05-16', 'general_aerobic', 5),
        makeDay('2026-05-17', 'long_steady', 10, false, true),
      ],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 100,
        phase: 'BUILD', totalMi: 31, longRunMi: 10, qualityCount: 1,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ longestLast28Mi: 11 }));  // long-run cap 12.1mi → 10mi prescription is fine
    expect(issues).toHaveLength(0);
  });

  it('catches 7 consecutive non-rest days for low tier (max 5)', () => {
    const days = [
      makeDay('2026-05-11', 'general_aerobic', 4),
      makeDay('2026-05-12', 'general_aerobic', 4),
      makeDay('2026-05-13', 'general_aerobic', 4),
      makeDay('2026-05-14', 'general_aerobic', 4),
      makeDay('2026-05-15', 'general_aerobic', 4),
      makeDay('2026-05-16', 'general_aerobic', 4),
      makeDay('2026-05-17', 'long_steady', 8, false, true),
    ];
    const issues = validatePlan({ next30Days: days, buildCurve: [], weekShape: [] }, baseState({ weeklyAvg4w: 30 }));
    const consecIssue = issues.find(i => i.rule === 'consecutive_non_rest_days');
    expect(consecIssue).toBeDefined();
    expect(consecIssue?.severity).toBe('error');
  });

  it('catches a 26mi long run when training-only longest is 8mi', () => {
    const issues = validatePlan({
      next30Days: [makeDay('2026-05-17', 'long_steady', 26, false, true)],
      buildCurve: [],
      weekShape: [],
    }, baseState({ longestLast28Mi: 8 }));
    const spikeIssue = issues.find(i => i.rule === 'long_run_spike');
    expect(spikeIssue).toBeDefined();
    expect(spikeIssue?.severity).toBe('error');
    expect(spikeIssue?.message).toContain('26.0');
  });

  it('catches a Sat long run when runner prefers Sunday (longRunDow=0)', () => {
    const issues = validatePlan({
      next30Days: [makeDay('2026-05-16', 'long_steady', 10, false, true)],  // 2026-05-16 is Sat
      buildCurve: [],
      weekShape: [],
    }, baseState({ longRunDow: 0 }));
    const prefIssue = issues.find(i => i.rule === 'long_run_day_preference');
    expect(prefIssue).toBeDefined();
    expect(prefIssue?.severity).toBe('error');
  });

  it('catches quality during the post-race recovery window', () => {
    const issues = validatePlan({
      next30Days: [makeDay('2026-05-12', 'threshold', 8, true)],
      buildCurve: [],
      weekShape: [],
    }, baseState({ recoveryWindowEndsISO: '2026-05-15' }));
    const blackoutIssue = issues.find(i => i.rule === 'post_race_quality_blackout');
    expect(blackoutIssue).toBeDefined();
    expect(blackoutIssue?.severity).toBe('error');
  });

  it('catches two quality days back-to-back (hard-easy alternation)', () => {
    const days = [
      makeDay('2026-05-11', 'rest', 0),
      makeDay('2026-05-12', 'threshold', 8, true),
      makeDay('2026-05-13', 'vo2', 7, true),  // adjacent quality
      makeDay('2026-05-14', 'general_aerobic', 4),
    ];
    const issues = validatePlan({ next30Days: days, buildCurve: [], weekShape: [] }, baseState());
    const alternationIssue = issues.find(i => i.rule === 'hard_easy_alternation');
    expect(alternationIssue).toBeDefined();
    expect(alternationIssue?.severity).toBe('error');
  });

  it('catches a too-low BUILD week (5 mi when avg is 30)', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 84,
        phase: 'BUILD', totalMi: 5, longRunMi: 2, qualityCount: 1,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30 }));
    const floorIssue = issues.find(i => i.rule === 'weekly_mileage_floor');
    expect(floorIssue).toBeDefined();
    expect(floorIssue?.severity).toBe('warn');
  });

  it('catches a BUILD week with 0 quality sessions', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 84,
        phase: 'BUILD', totalMi: 30, longRunMi: 8, qualityCount: 0,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30 }));
    const cadIssue = issues.find(i => i.rule === 'quality_cadence');
    expect(cadIssue).toBeDefined();
  });

  it('accepts BASE phase with 2 quality (Pfitz-aligned)', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 80,
        phase: 'BASE', totalMi: 30, longRunMi: 10, qualityCount: 2,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30, longestLast28Mi: 10 }));
    const cadIssue = issues.find(i => i.rule === 'quality_cadence');
    expect(cadIssue).toBeUndefined();
  });

  it('flags BASE_MAINTENANCE with 2 quality (above the 1-Q cap for outside-window)', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 100,
        phase: 'BASE_MAINTENANCE', totalMi: 30, longRunMi: 10, qualityCount: 2,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30, longestLast28Mi: 10 }));
    const cadIssue = issues.find(i => i.rule === 'quality_cadence' && i.severity === 'error');
    expect(cadIssue).toBeDefined();
  });

  it('catches a BUILD week with too many quality sessions (3)', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 84,
        phase: 'BUILD', totalMi: 30, longRunMi: 8, qualityCount: 3,
        hasMpBlock: false, isRaceWeek: false,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30 }));
    const cadIssue = issues.find(i => i.rule === 'quality_cadence' && i.severity === 'error');
    expect(cadIssue).toBeDefined();
    expect(cadIssue?.message).toContain('3 quality');
  });

  it('skips race weeks for the floor + quality rules (TAPER expected)', () => {
    const issues = validatePlan({
      next30Days: [],
      buildCurve: [{
        weekStartISO: '2026-05-11', weekIndex: 0, daysToRace: 7,
        phase: 'TAPER', totalMi: 12, longRunMi: 4, qualityCount: 0,
        hasMpBlock: false, isRaceWeek: true,
      }],
      weekShape: [],
    }, baseState({ weeklyAvg4w: 30 }));
    expect(issues.filter(i => i.rule === 'weekly_mileage_floor')).toHaveLength(0);
    expect(issues.filter(i => i.rule === 'quality_cadence')).toHaveLength(0);
  });
});

// Surface a friendly summary if any test prints diagnostic info.
function summarizeIssues(issues: PlanIssue[]): string {
  return issues.map(i => `[${i.severity}] ${i.rule}: ${i.message}`).join('\n');
}
// re-export so the IDE doesn't strip
export { summarizeIssues };
