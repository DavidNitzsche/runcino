/**
 * lib/runs/_pace_selfcheck.test.ts — a row may not print a pace that
 * contradicts its own clock.
 *
 * David's 2026-08-23 run stored `durationSec` 5298 over 11.01 mi — 8:01/mi,
 * from his watch — and `paceSPerMi` 217, which is 3:37/mi, from a Strava
 * moving time of 2389s that implies 16.6 mph for eleven miles.
 *
 * The recap read the second and told him "Easy 11.0 mi at 3:37/mi. A touch
 * quicker than the 9:22/mi easy target."
 */
import { describe, it, expect } from 'vitest';
import { runPaceSecPerMi } from './run-shape';

const REAL = { distanceMi: 11.01, durationSec: 5298, movingSec: 2389, paceSPerMi: 217 };

describe('runPaceSecPerMi refuses a pace its own row disproves', () => {
  it('returns the watch clock for the run that shipped 3:37/mi', () => {
    const pace = runPaceSecPerMi(REAL as never)!;
    expect(Math.round(pace)).toBe(481);            // 8:01/mi
    expect(pace).not.toBeCloseTo(217, 0);
  });

  it('keeps an ordinary paused run, because pausing is normal', () => {
    // 6 mi, 60 min elapsed, 54 min moving — nine minutes at lights. Believed.
    const pace = runPaceSecPerMi({ distanceMi: 6, durationSec: 3600, paceSPerMi: 540 } as never)!;
    expect(pace).toBe(540);
  });

  it('keeps a run with no pause at all', () => {
    const pace = runPaceSecPerMi({ distanceMi: 10, durationSec: 4800, paceSPerMi: 480 } as never)!;
    expect(pace).toBe(480);
  });

  it('rejects exactly at the boundary, not before it', () => {
    // Elapsed pace 600. A stored 300 implies half the run paused — allowed.
    expect(runPaceSecPerMi({ distanceMi: 10, durationSec: 6000, paceSPerMi: 300 } as never)).toBe(300);
    // 299 implies more than half — refused, elapsed wins.
    expect(runPaceSecPerMi({ distanceMi: 10, durationSec: 6000, paceSPerMi: 299 } as never)).toBe(600);
  });

  it('judges a row only against its own facts, so an elite is safe', () => {
    // 10 mi in 50 min, no pause. 5:00/mi is real for some runners and the
    // guard has no opinion about human speed.
    expect(runPaceSecPerMi({ distanceMi: 10, durationSec: 3000, paceSPerMi: 300 } as never)).toBe(300);
  });

  it('still derives a pace when none is stored', () => {
    expect(runPaceSecPerMi({ distanceMi: 5, movingSec: 2400 } as never)).toBe(480);
  });

  it('does not guess when the row has no clock to check against', () => {
    expect(runPaceSecPerMi({ distanceMi: 11.01, paceSPerMi: 217 } as never)).toBe(217);
    expect(runPaceSecPerMi({} as never)).toBeNull();
  });
});
