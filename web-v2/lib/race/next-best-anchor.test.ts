/**
 * The hard constraint: answering "did not count" falls back to the NEXT-BEST
 * anchor, never to the old, faster (pre-race) paces.
 */
import { describe, it, expect } from 'vitest';
import { nextBestVdotExcludingRace } from './next-best-anchor';
import { predictRaceTime } from '@/lib/training/vdot';
import type { RaceVdotInput, RunVdotInput } from '@/lib/training/vdot-inputs';

const HALF_MI = 13.1094;
const TODAY = '2026-08-19';

/** Build a race candidate whose vdotFromRace round-trips to (approximately)
 *  the target VDOT, `daysAgo` before TODAY. */
function raceAt(slug: string, targetVdot: number, daysAgo: number): RaceVdotInput {
  const finishSeconds = Math.round(predictRaceTime(targetVdot, HALF_MI)!);
  const d = new Date(Date.parse(TODAY + 'T12:00:00Z') - daysAgo * 86400000);
  return {
    slug,
    name: slug,
    date: d.toISOString().slice(0, 10),
    priority: 'A',
    distance_mi: HALF_MI,
    finish_seconds: finishSeconds,
    provisional: false,
    provisionalSource: null,
    runner_authority_tier: null,
  };
}

describe('nextBestVdotExcludingRace — the hard constraint', () => {
  it('excludes the flagged race entirely and falls to whatever remains, ' +
     'even when that is SLOWER than a since-expired pre-race anchor', () => {
    // The plan's anchor before this race was effectively VDOT 52 — but that
    // evidence ('ancient') is now 200 days old, well past the fade-visible
    // window (VDOT_FULL_VALUE_DAYS 56 + FADE_TAIL_DAYS 28 = 84), so it has
    // already aged out of the candidate pool on its own.
    const ancient = raceAt('ancient', 52, 200);
    // The flagged race: a fast recent result that lifted the anchor to 58.
    const flagged = raceAt('flagged', 58, 3);
    // The next-best HONEST evidence still in the window: a slower race.
    const recentSlower = raceAt('recent-slower', 47, 20);

    const result = nextBestVdotExcludingRace(
      [ancient, flagged, recentSlower],
      [],
      'flagged',
      TODAY,
      4,
    );

    // Not the flagged race's own VDOT.
    expect(result.vdot).not.toBeCloseTo(58, 0);
    // Not reverted to the old (now-expired) pre-race anchor, even though
    // that anchor (52) is FASTER than what's left (47).
    expect(result.vdot).not.toBeCloseTo(52, 0);
    // It is the next-best anchor actually still in evidence.
    expect(result.vdot).toBeCloseTo(47, 0);
    expect(result.source).toBe('race');
    expect(result.refId).toBe('recent-slower');
  });

  it('never selects the excluded race even when it is the fastest candidate remaining in-window', () => {
    const flagged = raceAt('flagged', 60, 2);
    const other = raceAt('other', 50, 10);
    const result = nextBestVdotExcludingRace([flagged, other], [], 'flagged', TODAY, 4);
    expect(result.refId).not.toBe('flagged');
    expect(result.vdot).toBeCloseTo(50, 0);
  });

  it('falls back to a training run when no race evidence remains', () => {
    const flagged = raceAt('flagged', 55, 2);
    const runs: RunVdotInput[] = [{
      id: 'run_1',
      date: new Date(Date.parse(TODAY + 'T12:00:00Z') - 5 * 86400000).toISOString().slice(0, 10),
      workout_type: 'tempo',
      distance_mi: 6,
      finish_seconds: Math.round(6 * 390), // ~6:30/mi tempo
      avg_hr: null,
      max_hr: null,
      zone: 'threshold',
      raw_finish_seconds: null,
      terrain_delta_seconds: 0,
    }];
    const result = nextBestVdotExcludingRace([flagged], runs, 'flagged', TODAY, 4);
    expect(result.source).toBe('run');
    expect(result.refId).toBe('run_1');
    expect(result.vdot).not.toBeNull();
  });

  it('returns a null anchor (not a fabricated one) when nothing remains at all', () => {
    const flagged = raceAt('flagged', 55, 2);
    const result = nextBestVdotExcludingRace([flagged], [], 'flagged', TODAY, 4);
    expect(result.vdot).toBeNull();
    expect(result.source).toBeNull();
    expect(result.candidate).toBeNull();
  });
});
