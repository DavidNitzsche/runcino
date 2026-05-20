import { describe, expect, it } from 'vitest';
import { validateCompletion, type WatchCompletionInput } from '../watch-completion';

function validBase(): WatchCompletionInput {
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const completed = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return {
    workoutId: '2026-05-19-threshold',
    startedAt: started,
    completedAt: completed,
    status: 'completed',
    totalDistanceMi: 7.3,
    totalDurationSec: 3147,
    avgHr: 158,
    maxHr: 181,
    phases: [
      { index: 0, type: 'warmup', label: 'Warmup', targetPaceSPerMi: null, actualPaceSPerMi: 478, actualDurationSec: 600, avgHr: 132, completed: true },
      { index: 1, type: 'work', label: 'Interval 1/5', targetPaceSPerMi: 391, actualPaceSPerMi: 394, actualDurationSec: 420, avgHr: 168, completed: true },
      { index: 2, type: 'recovery', label: 'Recovery 1/5', targetPaceSPerMi: null, actualPaceSPerMi: 560, actualDurationSec: 90, avgHr: 150, completed: true },
    ],
  };
}

describe('validateCompletion', () => {
  it('accepts a well-formed completion', () => {
    expect(validateCompletion(validBase())).toBeNull();
  });

  it('accepts optional fields omitted', () => {
    const c = validBase();
    delete c.totalDistanceMi;
    delete c.avgHr;
    delete c.maxHr;
    c.phases[0].avgHr = null;
    expect(validateCompletion(c)).toBeNull();
  });

  it('rejects an empty workoutId', () => {
    const c = validBase();
    c.workoutId = '';
    expect(validateCompletion(c)?.reason).toMatch(/workoutId/);
  });

  it('rejects an unknown status', () => {
    const c = validBase();
    c.status = 'finished';
    expect(validateCompletion(c)?.reason).toMatch(/status/);
  });

  it('accepts partial and abandoned statuses', () => {
    for (const status of ['partial', 'abandoned']) {
      const c = validBase();
      c.status = status;
      expect(validateCompletion(c)).toBeNull();
    }
  });

  it('rejects completedAt before startedAt', () => {
    const c = validBase();
    c.completedAt = new Date(Date.parse(c.startedAt) - 1000).toISOString();
    expect(validateCompletion(c)?.reason).toMatch(/before startedAt/);
  });

  it('rejects a future completedAt', () => {
    const c = validBase();
    c.completedAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    expect(validateCompletion(c)?.reason).toMatch(/future/);
  });

  it('rejects a non-positive totalDurationSec', () => {
    const c = validBase();
    c.totalDurationSec = 0;
    expect(validateCompletion(c)?.reason).toMatch(/totalDurationSec/);
  });

  it('rejects an implausible avgHr', () => {
    const c = validBase();
    c.avgHr = 12;
    expect(validateCompletion(c)?.reason).toMatch(/avgHr/);
  });

  it('rejects an empty phases array', () => {
    const c = validBase();
    c.phases = [];
    expect(validateCompletion(c)?.reason).toMatch(/phases/);
  });

  it('rejects an invalid phase type', () => {
    const c = validBase();
    c.phases[1].type = 'sprint';
    expect(validateCompletion(c)?.reason).toMatch(/phases\[1\]\.type/);
  });

  it('rejects a phase with a negative index', () => {
    const c = validBase();
    c.phases[0].index = -1;
    expect(validateCompletion(c)?.reason).toMatch(/index/);
  });

  it('rejects an out-of-range phase pace', () => {
    const c = validBase();
    c.phases[1].actualPaceSPerMi = 30;
    expect(validateCompletion(c)?.reason).toMatch(/actualPaceSPerMi/);
  });

  it('rejects a non-boolean completed flag', () => {
    const c = validBase();
    // @ts-expect-error — exercising runtime guard against bad input
    c.phases[1].completed = 'yes';
    expect(validateCompletion(c)?.reason).toMatch(/completed/);
  });
});
