/**
 * The single status vocabulary · web recomposition deck Decision 3b.
 *
 * Locks the ruling: tier word + gap value, four words wide, unclosable
 * reads BEHIND and raises a flag rather than inventing a fifth word.
 */
import { describe, it, expect } from 'vitest';
import { resolveGoalStatus, formatGapClock, ON_PACE_DEAD_BAND_SEC } from './goal-status';

const traj = (o: Partial<{ gapSec: number | null; gapVdot: number; reachable: boolean; aheadOfGoal: boolean }>) => ({
  gapSec: 0, gapVdot: 0, reachable: true, aheadOfGoal: false, ...o,
});

describe('formatGapClock', () => {
  it('renders sub-minute, minute and hour gaps', () => {
    expect(formatGapClock(48)).toBe('48');
    expect(formatGapClock(1908)).toBe('31:48');
    expect(formatGapClock(3852)).toBe('1:04:12');
  });
  it('is always positive · direction is carried by the word, not the number', () => {
    expect(formatGapClock(-1908)).toBe('31:48');
  });
});

describe('resolveGoalStatus · the four words', () => {
  it('BEHIND carries the gap · the deck example', () => {
    const r = resolveGoalStatus({ trajectory: traj({ gapSec: 1908, gapVdot: 4.2, reachable: false }) });
    expect(r?.word).toBe('BEHIND');
    expect(r?.label).toBe('BEHIND · 31:48');
    expect(r?.unclosable).toBe(false);
  });

  it('AHEAD signs the gap negative so consumers can do arithmetic', () => {
    const r = resolveGoalStatus({ trajectory: traj({ gapSec: 95, aheadOfGoal: true, reachable: true }) });
    expect(r?.word).toBe('AHEAD');
    expect(r?.gapSec).toBe(-95);
    expect(r?.label).toBe('AHEAD · 1:35');
  });

  it('ON PACE inside the dead band states no number', () => {
    const r = resolveGoalStatus({ trajectory: traj({ gapSec: 12, reachable: true }) });
    expect(r?.label).toBe('ON PACE');
    expect(r?.gapLabel).toBeNull();
  });

  it('ON PACE outside the dead band still carries the number', () => {
    const r = resolveGoalStatus({ trajectory: traj({ gapSec: ON_PACE_DEAD_BAND_SEC + 15, reachable: true }) });
    expect(r?.label).toBe('ON PACE · 45');
  });

  it('WATCHING is the unreachable-but-close band', () => {
    const r = resolveGoalStatus({ trajectory: traj({ gapSec: 40, gapVdot: 1.2, reachable: false }) });
    expect(r?.word).toBe('WATCHING');
    expect(r?.label).toBe('WATCHING · 40');
  });
});

describe('resolveGoalStatus · unclosable', () => {
  it('reads BEHIND · not a fifth word · and raises the renegotiation flag', () => {
    const r = resolveGoalStatus({
      trajectory: traj({ gapSec: 1908, gapVdot: 4.2, reachable: false }),
      unclosable: true,
    });
    expect(r?.word).toBe('BEHIND');
    expect(r?.label).toBe('BEHIND · 31:48');
    expect(r?.unclosable).toBe(true);
  });

  it('overrides a softer tier · an unclosable gap is never dressed as WATCHING', () => {
    const r = resolveGoalStatus({
      trajectory: traj({ gapSec: 40, gapVdot: 1.2, reachable: false }),
      unclosable: true,
    });
    expect(r?.tier).toBe('behind');
    expect(r?.word).toBe('BEHIND');
  });

  it('overrides even a reachable trajectory when the engine says unclosable', () => {
    const r = resolveGoalStatus({
      trajectory: traj({ gapSec: 5, reachable: true }),
      unclosable: true,
    });
    expect(r?.word).toBe('BEHIND');
  });
});

describe('resolveGoalStatus · fallback without a trajectory', () => {
  it('uses goal versus current-fitness projection on the shipped thresholds', () => {
    const goalSec = 10800; // 3:00:00
    expect(resolveGoalStatus({ goalSec, projectionSec: 10700 })?.word).toBe('AHEAD');
    expect(resolveGoalStatus({ goalSec, projectionSec: 11000 })?.word).toBe('ON PACE');
    expect(resolveGoalStatus({ goalSec, projectionSec: 11400 })?.word).toBe('WATCHING');
    expect(resolveGoalStatus({ goalSec, projectionSec: 12708 })?.label).toBe('BEHIND · 31:48');
  });

  it('returns null when there is nothing honest to say', () => {
    expect(resolveGoalStatus({})).toBeNull();
    expect(resolveGoalStatus({ goalSec: 10800, projectionSec: null })).toBeNull();
    expect(resolveGoalStatus({ goalSec: null, projectionSec: 11000 })).toBeNull();
  });
});

describe('resolveGoalStatus · the retired dialects', () => {
  it('never emits pill or prose wording', () => {
    const reads = [
      resolveGoalStatus({ trajectory: traj({ gapSec: 1908, gapVdot: 4.2, reachable: false }) }),
      resolveGoalStatus({ trajectory: traj({ gapSec: 5, reachable: true }) }),
      resolveGoalStatus({ trajectory: traj({ gapSec: 40, gapVdot: 1.2, reachable: false }) }),
      resolveGoalStatus({ trajectory: traj({ gapSec: 95, aheadOfGoal: true, reachable: true }) }),
    ];
    const banned = ['On track', 'Off track', 'Watching ·', 'on pace', 'off pace', 'HIGH', 'MEDIUM', 'LOW'];
    for (const r of reads) {
      expect(r).not.toBeNull();
      for (const b of banned) expect(r!.label).not.toContain(b);
      expect(['AHEAD', 'ON PACE', 'WATCHING', 'BEHIND']).toContain(r!.word);
    }
  });
});
