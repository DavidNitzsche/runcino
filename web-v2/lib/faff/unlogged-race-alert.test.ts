/**
 * Unlogged-race alert keying (2026-08-17 · retro front door fix).
 *
 * The lock: the alert keys on actual_result ABSENCE (finishSource !==
 * 'actual_result'), not on display finishTime — races-state's
 * run-match auto-fill populates finishTime for any date+distance-matched
 * training run, which suppressed the alert forever.
 */
import { describe, it, expect } from 'vitest';
import { computeUnloggedRaceAlert, type UnloggedAlertRace } from './unlogged-race-alert';

const NOW = Date.parse('2026-08-17T12:00:00Z');

function race(over: Partial<UnloggedAlertRace>): UnloggedAlertRace {
  return {
    slug: 'afc-half',
    name: 'AFC Half',
    date: '2026-08-15',
    priority: 'A',
    finishSource: null,
    ...over,
  };
}

describe('computeUnloggedRaceAlert', () => {
  it('fires for a run_match auto-filled finish (the old !finishTime check never did)', () => {
    const a = computeUnloggedRaceAlert([race({ finishSource: 'run_match' })], NOW);
    expect(a).toEqual({ slug: 'afc-half', name: 'AFC Half', daysSince: 2 });
  });

  it('fires when there is no finish at all', () => {
    expect(computeUnloggedRaceAlert([race({})], NOW)).not.toBeNull();
  });

  it('suppresses once actual_result carries the finish', () => {
    expect(computeUnloggedRaceAlert([race({ finishSource: 'actual_result' })], NOW)).toBeNull();
  });

  it('ignores C-priority and unprioritized races', () => {
    expect(computeUnloggedRaceAlert([race({ priority: 'C' })], NOW)).toBeNull();
    expect(computeUnloggedRaceAlert([race({ priority: null })], NOW)).toBeNull();
  });

  it('goes quiet after 30 days', () => {
    expect(computeUnloggedRaceAlert([race({ date: '2026-07-10' })], NOW)).toBeNull();
  });

  it('empty and null inputs return null', () => {
    expect(computeUnloggedRaceAlert([], NOW)).toBeNull();
    expect(computeUnloggedRaceAlert(null, NOW)).toBeNull();
  });
});
