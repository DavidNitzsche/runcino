/**
 * Tests for lib/watch-workout.ts · the structured workout converter
 * that powers GET /api/watch/today.
 *
 * Locks the watchOS payload shape so future agents can't quietly
 * shift fields the watch is reading.
 */
import { describe, expect, it } from 'vitest';
import { buildWatchWorkout, parseDurationSec } from '../watch-workout';
import type { PlanWeekDay } from '../synthetic-plan';

const TODAY = '2026-05-19';

function day(
  type: PlanWeekDay['type'],
  label: string,
  distanceMi: number,
): PlanWeekDay {
  return { dow: 'Mon', date: TODAY, type, label, distanceMi };
}

describe('parseDurationSec', () => {
  it('parses minutes', () => {
    expect(parseDurationSec('15 min')).toBe(900);
    expect(parseDurationSec('7 min')).toBe(420);
    expect(parseDurationSec('3.5 min')).toBe(210);
  });

  it('parses seconds', () => {
    expect(parseDurationSec('90 sec')).toBe(90);
    expect(parseDurationSec('30 sec')).toBe(30);
  });

  it('parses miles with a pace assumption', () => {
    // 1 mile at 6:30/mi pace (390 s/mi) = 390 seconds
    expect(parseDurationSec('1 mi', 390)).toBe(390);
    expect(parseDurationSec('0.5 mi', 390)).toBe(195);
  });

  it('falls back to 5 min on unparseable input rather than crashing', () => {
    expect(parseDurationSec('???')).toBe(300);
    expect(parseDurationSec('')).toBe(300);
  });
});

describe('buildWatchWorkout · rest / race / unsupported', () => {
  it('rest day returns null (caller renders rest-day UI)', () => {
    expect(buildWatchWorkout(day('rest', 'Rest', 0), TODAY, null)).toBeNull();
  });

  it('race day returns null · race-day pacing deferred from MVP', () => {
    expect(buildWatchWorkout(day('race', 'AFC Half', 13.1), TODAY, null)).toBeNull();
  });
});

describe('buildWatchWorkout · easy / recovery / long', () => {
  it('easy day produces a single-phase workout', () => {
    const out = buildWatchWorkout(day('easy', 'Easy', 5), TODAY, null);
    expect(out).not.toBeNull();
    expect(out!.phases.length).toBe(1);
    expect(out!.phases[0].type).toBe('work');
    expect(out!.phases[0].haptic).toBe('start');
    expect(out!.phases[0].targetPaceSPerMi).toBeGreaterThan(0);
  });

  it('long run produces a single-phase workout', () => {
    const out = buildWatchWorkout(day('long', 'Long Run', 12), TODAY, null);
    expect(out).not.toBeNull();
    expect(out!.phases.length).toBe(1);
    expect(out!.totalEstimatedMinutes).toBeGreaterThan(60);
  });

  it('workoutId is stable for the same (date, label) input', () => {
    const a = buildWatchWorkout(day('easy', 'Easy', 5), TODAY, null);
    const b = buildWatchWorkout(day('easy', 'Easy', 5), TODAY, null);
    expect(a!.workoutId).toBe(b!.workoutId);
    expect(a!.workoutId).toContain(TODAY);
  });
});

describe('buildWatchWorkout · structured interval workouts', () => {
  it('Threshold · Cruise Intervals expands to warmup + 5×(work,recovery) + cooldown', () => {
    const out = buildWatchWorkout(
      day('quality', 'Threshold · Cruise Intervals', 7),
      TODAY,
      null,
    );
    expect(out).not.toBeNull();
    // 1 warmup + 5×(work + recovery) + 1 cooldown = 12 phases
    expect(out!.phases.length).toBe(12);
    expect(out!.phases[0].type).toBe('warmup');
    expect(out!.phases[0].haptic).toBe('start');
    expect(out!.phases[out!.phases.length - 1].type).toBe('cooldown');
  });

  it('interval labels count up correctly (1/5, 2/5, ...)', () => {
    const out = buildWatchWorkout(
      day('quality', 'Threshold · Cruise Intervals', 7),
      TODAY,
      null,
    );
    const workPhases = out!.phases.filter((p) => p.type === 'work');
    expect(workPhases.length).toBe(5);
    expect(workPhases[0].label).toBe('Interval 1/5');
    expect(workPhases[4].label).toBe('Interval 5/5');
  });

  it('work phases have pace target + tolerance · recovery does not', () => {
    const out = buildWatchWorkout(
      day('quality', 'Threshold · Cruise Intervals', 7),
      TODAY,
      null,
    );
    const work = out!.phases.find((p) => p.type === 'work')!;
    const rec = out!.phases.find((p) => p.type === 'recovery')!;
    expect(work.targetPaceSPerMi).toBeGreaterThan(0);
    expect(work.tolerancePaceSPerMi).toBeGreaterThan(0);
    expect(rec.targetPaceSPerMi).toBeNull();
    expect(rec.tolerancePaceSPerMi).toBeUndefined();
  });

  it('VO2max Intervals expands correctly (6×3min work + 2min rec)', () => {
    const out = buildWatchWorkout(
      day('quality', 'Intervals', 6),
      TODAY,
      null,
    );
    // 1 warmup + 6×(work + recovery) + 1 cooldown = 14 phases
    expect(out!.phases.length).toBe(14);
    const workPhases = out!.phases.filter((p) => p.type === 'work');
    expect(workPhases.length).toBe(6);
    // Each work interval is 3 min = 180s
    expect(workPhases[0].durationSec).toBe(180);
  });

  it('haptic on first phase is always "start" regardless of phase type', () => {
    // Even structured workouts whose first phase is "warmup" should
    // have haptic="start", it's the workout-opening cue.
    const out = buildWatchWorkout(
      day('quality', 'Intervals', 6),
      TODAY,
      null,
    );
    expect(out!.phases[0].haptic).toBe('start');
  });
});

describe('buildWatchWorkout · payload shape invariants', () => {
  it('every phase has type + label + durationSec + haptic', () => {
    const out = buildWatchWorkout(
      day('quality', 'Threshold · HM Blocks', 10),
      TODAY,
      null,
    )!;
    for (const phase of out.phases) {
      expect(phase.type).toBeTruthy();
      expect(phase.label).toBeTruthy();
      expect(phase.durationSec).toBeGreaterThan(0);
      expect(phase.haptic).toBeTruthy();
    }
  });

  it('totalEstimatedMinutes matches sum of phase durations', () => {
    const out = buildWatchWorkout(
      day('quality', 'Threshold · Cruise Intervals', 7),
      TODAY,
      null,
    )!;
    const sumSec = out.phases.reduce((s, p) => s + p.durationSec, 0);
    expect(out.totalEstimatedMinutes).toBe(Math.round(sumSec / 60));
  });

  it('completionEndpoint is the canonical path', () => {
    const out = buildWatchWorkout(day('easy', 'Easy', 5), TODAY, null)!;
    expect(out.completionEndpoint).toBe('/api/watch/workouts/complete');
  });

  it('expiresAt is roughly tomorrow morning', () => {
    const out = buildWatchWorkout(day('easy', 'Easy', 5), TODAY, null)!;
    const expires = new Date(out.expiresAt);
    const todayMid = new Date(TODAY + 'T12:00:00Z');
    const hoursAhead = (expires.getTime() - todayMid.getTime()) / (1000 * 60 * 60);
    // Tomorrow 08:00 UTC = today midday + ~20h.  Generous range
    // because we don't bet on exact timezone math in tests.
    expect(hoursAhead).toBeGreaterThan(12);
    expect(hoursAhead).toBeLessThan(40);
  });
});
