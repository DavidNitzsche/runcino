/**
 * lib/race/auto-result.test.ts
 *
 * 2026-08-17 · race-lifecycle falsifiers:
 *
 *   F1  the matched-run patch carries EXACTLY its intended keys — the
 *       jsonb || merge preserves everything else (Rule 6). Simulated
 *       writer-A-then-writer-B: provisional write does not clobber a
 *       field a prior writer set.
 *   F2  a later MANUAL chip entry overwrites finishS/finishDisplay,
 *       flips provisional:false / source:'manual', and PRESERVES the
 *       matched runId as provenance.
 *   F3  matcher prefers a workoutType='race' tagged run over a closer
 *       untagged run; respects the ±12% distance window and day ±1;
 *       unresolvable race distance only matches a tagged race run.
 *   F4  finish seconds resolve through the moving-time COALESCE ladder
 *       (movingTimeS → movingSec → elapsedTimeS); avgHrBpm only present
 *       when the run carries avgHr.
 */
import { describe, expect, it, vi } from 'vitest';

// auto-result → result-chain → pool / runner-tz / projection-snapshots /
// coach cache. The functions under test are pure; mock the DB-touching
// modules so importing the chain never opens a pg pool.
vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-17'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));
vi.mock('@/lib/training/projection-snapshots', () => ({
  recordProjectionSnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/coach/cache', () => ({
  bustBriefingCacheForEvent: vi.fn().mockResolvedValue(undefined),
}));

import { pickMatchingRaceRun, provisionalResultPatch, type RunCandidate } from './auto-result';
import { manualResultPatch } from './result-chain';

const run = (id: string, data: Record<string, unknown>): RunCandidate => ({ id, data });

/** Simulate Postgres `COALESCE(actual_result,'{}'::jsonb) || patch`:
 *  a right-biased shallow key merge. */
const jsonbMerge = (
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> => ({ ...(existing ?? {}), ...patch });

// ── F3 · matcher ─────────────────────────────────────────────────────────────

describe('pickMatchingRaceRun', () => {
  const afc = { date: '2026-08-16', distanceMi: 13.1 };

  it('matches the AFC watch run (tagged race, 13.2mi, same day)', () => {
    const raceRun = run('r-race', { date: '2026-08-16', distanceMi: 13.2, workoutType: 'race' });
    const picked = pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-shakeout', { date: '2026-08-15', distanceMi: 3.0 }),
      raceRun,
    ]);
    // The 3-mi shakeout is outside the distance window anyway; the race
    // run matches on day 0 + 0.1mi delta.
    expect(picked?.id).toBe('r-race');
  });

  it('prefers a workoutType=race run over a CLOSER untagged run', () => {
    const picked = pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-untagged', { date: '2026-08-16', distanceMi: 13.1 }),          // exact distance
      run('r-tagged', { date: '2026-08-16', distanceMi: 13.9, workoutType: 'race' }), // worse distance, tagged
    ]);
    expect(picked?.id).toBe('r-tagged');
  });

  it('rejects runs outside the ±12% distance window', () => {
    // 12% of 13.1 = 1.572 → 15.0mi is out; 14.5 is in.
    expect(pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-long', { date: '2026-08-16', distanceMi: 15.0 }),
    ])).toBeNull();
    expect(pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-ok', { date: '2026-08-16', distanceMi: 14.5 }),
    ])?.id).toBe('r-ok');
  });

  it('rejects runs more than 1 day from the race date', () => {
    expect(pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-far', { date: '2026-08-14', distanceMi: 13.1 }),
    ])).toBeNull();
    // ±1 day allowed (startLocal→UTC drift)
    expect(pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-drift', { date: '2026-08-17', distanceMi: 13.1 }),
    ])?.id).toBe('r-drift');
  });

  it('with an unresolvable race distance, only a tagged race run matches', () => {
    expect(pickMatchingRaceRun(afc.date, null, [
      run('r-untagged', { date: '2026-08-16', distanceMi: 13.1 }),
    ])).toBeNull();
    expect(pickMatchingRaceRun(afc.date, null, [
      run('r-tagged', { date: '2026-08-16', distanceMi: 13.1, workoutType: 'race' }),
    ])?.id).toBe('r-tagged');
  });

  it('falls back to startLocal date when data.date is absent', () => {
    expect(pickMatchingRaceRun(afc.date, afc.distanceMi, [
      run('r-sl', { startLocal: '2026-08-16T06:58:00', distanceMi: 13.2, workoutType: 'race' }),
    ])?.id).toBe('r-sl');
  });
});

// ── F4 · patch shape ─────────────────────────────────────────────────────────

describe('provisionalResultPatch', () => {
  it('builds the watch-provisional patch from the AFC run', () => {
    const p = provisionalResultPatch(run('r-race', {
      date: '2026-08-16', distanceMi: 13.2, workoutType: 'race',
      movingTimeS: 6113, avgHr: 168,
    }));
    expect(p).toEqual({
      finishS: 6113,
      finishDisplay: '1:41:53',
      source: 'watch_provisional',
      provisional: true,
      runId: 'r-race',
      avgHrBpm: 168,
    });
  });

  // 2026-08-17 round 2 · this test previously asserted the OPPOSITE of its last
  // line (moving time winning over elapsed) and it was pinning a bug. A race is
  // timed gun-to-mat; moving time subtracts every auto-pause and every stopped
  // second at an aid station, so it reads systematically FASTER than the chip
  // time it stands in for — and that bias flowed into vdotFromRace and, via
  // pr_bank, into a pace recompute. Research/15: "the official chip time over
  // the certified course is canonical". Locked by
  // EVIDENCE.chip-time-is-canonical in the doctrine registry.
  it('resolves seconds through the COALESCE ladder, ELAPSED first', () => {
    expect(provisionalResultPatch(run('r1', { movingSec: 6000 }))?.finishS).toBe(6000);
    expect(provisionalResultPatch(run('r2', { elapsedTimeS: 6200 }))?.finishS).toBe(6200);
    expect(provisionalResultPatch(run('r3', { movingTimeS: 6100, elapsedTimeS: 6200 }))?.finishS).toBe(6200);
    // Moving time still stands in when no elapsed field was ingested at all.
    expect(provisionalResultPatch(run('r4', { movingTimeS: 6100, movingSec: 6050 }))?.finishS).toBe(6100);
  });

  it('omits avgHrBpm when the run has no avgHr, and never carries undefined keys', () => {
    const p = provisionalResultPatch(run('r1', { movingTimeS: 6113 }))!;
    expect('avgHrBpm' in p).toBe(false);
    expect(Object.values(p).every((v) => v !== undefined && v !== null)).toBe(true);
  });

  it('returns null when no usable duration exists', () => {
    expect(provisionalResultPatch(run('r1', { distanceMi: 13.2 }))).toBeNull();
    expect(provisionalResultPatch(run('r1', { movingTimeS: 0 }))).toBeNull();
  });
});

// ── F1 + F2 · Rule 6 merge semantics ─────────────────────────────────────────

describe('actual_result merge (Rule 6)', () => {
  it('F1 · provisional write preserves fields a prior writer set', () => {
    // Writer A (hypothetical future writer) set a field the detector
    // doesn't know about.
    const existing = { negativeSplit: true, note: 'hilly course' };
    const patch = provisionalResultPatch(run('r-race', { movingTimeS: 6113, avgHr: 168 }))!;
    const merged = jsonbMerge(existing, patch as unknown as Record<string, unknown>);
    expect(merged.negativeSplit).toBe(true);          // preserved
    expect(merged.note).toBe('hilly course');         // preserved
    expect(merged.finishS).toBe(6113);
    expect(merged.provisional).toBe(true);
    expect(merged.source).toBe('watch_provisional');
  });

  it('F2 · a later manual chip entry overrides the watch time and clears provisional, keeping runId provenance', () => {
    const provisional = provisionalResultPatch(run('r-race', { movingTimeS: 6113, avgHr: 168 }))!;
    const afterAuto = jsonbMerge(null, provisional as unknown as Record<string, unknown>);

    // David later enters the chip time 1:41:20.
    const manual = manualResultPatch(6080, null);
    const afterManual = jsonbMerge(afterAuto, manual);

    expect(afterManual.finishS).toBe(6080);           // chip time wins
    expect(afterManual.finishDisplay).toBe('1:41:20');
    expect(afterManual.provisional).toBe(false);      // no longer provisional
    expect(afterManual.source).toBe('manual');
    expect(afterManual.runId).toBe('r-race');         // provenance preserved
    expect(afterManual.avgHrBpm).toBe(168);           // manual entry without HR keeps watch HR
  });

  it('manual patch carries avgHrBpm only when provided', () => {
    expect('avgHrBpm' in manualResultPatch(6080, null)).toBe(false);
    expect(manualResultPatch(6080, 165).avgHrBpm).toBe(165);
  });
});
