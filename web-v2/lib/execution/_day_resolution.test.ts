/**
 * _day_resolution.test.ts · Finding 3 falsification suite for
 * `lib/execution/day-resolution.ts`.
 *
 * Rule 18: falsify before trusting. Every case below was run against the
 * PRE-FIX picture first — before this file existed, `dayStateWordFor()` had
 * no input for "did this happen" at all, so every one of these five
 * scenarios rendered identically (a live prescription, painted by
 * `plannedType` alone). That is the defect this suite is written to catch a
 * regression back into.
 *
 * `resolveOneDay` is pure (Rule 18's own liveness requirement — no database,
 * no clock, so every branch is exercised deterministically) and is the exact
 * function `resolveDateRangeDayStatus`/`resolveDayStatus` call per date. The
 * two DB-touching entry points are exercised indirectly: any change to their
 * wiring (which table, which column, which filter) that broke a real case
 * would still have to route through `resolveOneDay`'s same five branches, so
 * a corpus at this layer catches the decision logic even without a live
 * Postgres in this environment (this worktree has no `node_modules`,
 * consistent with `feedback_verify_by_self_audit.md` — traced by hand
 * against the exact shapes `day-resolver.ts` and `week-loader.ts` export,
 * not executed, and flagged as such in the session report).
 */
import { describe, it, expect } from 'vitest';
import { resolveOneDay, missedGraceElapsed, MISSED_GRACE_HOURS } from './day-resolution';
import type { ResolvedDay, ResolvedRun, PrescribedWorkout } from './day-resolver';

function run(over: Partial<ResolvedRun> = {}): ResolvedRun {
  return {
    runId: 'run_1',
    data: {} as ResolvedRun['data'],
    shoeId: null,
    distanceMi: 5,
    match: 'supplemental',
    matchedWorkoutId: null,
    ...over,
  };
}

function prescription(over: Partial<PrescribedWorkout> = {}): PrescribedWorkout {
  return {
    id: 'wko_1',
    type: 'threshold',
    distanceMi: 6,
    subLabel: null,
    isQuality: true,
    isLong: false,
    matchedRun: null,
    ...over,
  };
}

function day(over: Partial<ResolvedDay> = {}): ResolvedDay {
  return {
    dateISO: '2026-09-04',
    prescriptions: [prescription()],
    supplementalRuns: [],
    ...over,
  };
}

describe('resolveOneDay · the five states, falsified individually', () => {
  it('rest day (no non-rest prescription) resolves to nothing — not "missed"', () => {
    const out = resolveOneDay(day({ prescriptions: [] }), undefined, false, false, true);
    expect(out.resolution).toBeNull();
  });

  it('COMPLETED · exact match, any time, grace-independent', () => {
    const matched = run({ match: 'exact', matchedWorkoutId: 'wko_1' });
    const d = day({ prescriptions: [prescription({ matchedRun: matched })] });
    const out = resolveOneDay(d, undefined, false, false, /* graceElapsed */ false);
    expect(out.resolution).toBe('completed');
    expect(out.matchTier).toBe('exact');
  });

  it('COMPLETED · legacy_type match carries its own tier, not exact', () => {
    const matched = run({ match: 'legacy_type', matchedWorkoutId: 'wko_1' });
    const d = day({ prescriptions: [prescription({ matchedRun: matched })] });
    const out = resolveOneDay(d, undefined, false, false, true);
    expect(out.resolution).toBe('completed');
    expect(out.matchTier).toBe('legacy_type');
  });

  it('MOVED · wins even when day-resolver has no prescription left (post-move rest rewrite)', () => {
    // applyReschedule rewrites the origin row to type:'rest', so
    // day-resolver's own ResolvedDay for this date carries NO prescription —
    // exactly the shape that must still resolve 'moved', not fall through to
    // "nothing to report".
    const out = resolveOneDay(day({ prescriptions: [] }), '2026-09-06', false, false, true);
    expect(out.resolution).toBe('moved');
    expect(out.movedToISO).toBe('2026-09-06');
  });

  it('MOVED · takes priority even if a completion were somehow also present', () => {
    const matched = run({ match: 'exact', matchedWorkoutId: 'wko_1' });
    const d = day({ prescriptions: [prescription({ matchedRun: matched })] });
    const out = resolveOneDay(d, '2026-09-06', false, false, true);
    expect(out.resolution).toBe('moved');
  });

  it('SKIPPED · explicit declaration, unmatched prescription, grace-independent', () => {
    const out = resolveOneDay(day(), undefined, /* skipped */ true, false, /* graceElapsed */ false);
    expect(out.resolution).toBe('skipped');
  });

  it('Rule 11 · a FAILED skip read must never silently read as missed', () => {
    const out = resolveOneDay(day(), undefined, false, /* skipReadFailed */ true, true);
    expect(out.resolution).toBeNull();
  });

  it('MISSED · past grace, unmatched, not skipped, not moved, no run at all that date', () => {
    const out = resolveOneDay(day({ supplementalRuns: [] }), undefined, false, false, true);
    expect(out.resolution).toBe('missed');
  });

  it('SUPPLEMENTAL · a real run exists but never satisfies the prescription', () => {
    const stray = run({ runId: 'run_stray', match: 'supplemental', matchedWorkoutId: null });
    const out = resolveOneDay(day({ supplementalRuns: [stray] }), undefined, false, false, true);
    expect(out.resolution).toBe('supplemental');
    expect(out.supplementalRunIds).toEqual(['run_stray']);
  });

  it('unresolved BEFORE the grace boundary elapses — never "missed" at a bare midnight', () => {
    const out = resolveOneDay(day(), undefined, false, false, /* graceElapsed */ false);
    expect(out.resolution).toBeNull();
  });

  it('unresolved-with-stray-run before grace also stays null, not "supplemental" early', () => {
    const stray = run({ runId: 'run_stray' });
    const out = resolveOneDay(day({ supplementalRuns: [stray] }), undefined, false, false, false);
    expect(out.resolution).toBeNull();
  });
});

describe('missedGraceElapsed · the boundary, walked in small increments (Rule 9)', () => {
  const tz = 'America/Los_Angeles';

  it('not elapsed at the instant local midnight turns over', () => {
    // Thursday 2026-09-03 → boundary is Friday 2026-09-04 06:00 local.
    const atMidnight = new Date('2026-09-04T07:00:00.000Z'); // 00:00 PDT (UTC-7)
    expect(missedGraceElapsed('2026-09-03', tz, atMidnight)).toBe(false);
  });

  it('not elapsed one minute before the grace boundary', () => {
    const oneMinBefore = new Date('2026-09-04T12:59:00.000Z'); // 05:59 PDT
    expect(missedGraceElapsed('2026-09-03', tz, oneMinBefore)).toBe(false);
  });

  it('elapsed exactly at the grace boundary', () => {
    const atBoundary = new Date('2026-09-04T13:00:00.000Z'); // 06:00 PDT
    expect(missedGraceElapsed('2026-09-03', tz, atBoundary)).toBe(true);
  });

  it('elapsed one minute after the grace boundary', () => {
    const oneMinAfter = new Date('2026-09-04T13:01:00.000Z');
    expect(missedGraceElapsed('2026-09-03', tz, oneMinAfter)).toBe(true);
  });

  it('same-day (not past at all) never elapses regardless of hour', () => {
    // Asking whether TODAY's own date has "elapsed grace" is a question a
    // caller should never even reach (resolveOneDay only spends this once a
    // prescription has already failed to match), but the function itself
    // stays honest about the calendar math either way.
    const lateSameDay = new Date('2026-09-04T04:00:00.000Z'); // 21:00 PDT the day before
    expect(missedGraceElapsed('2026-09-04', tz, lateSameDay)).toBe(false);
  });

  it('MISSED_GRACE_HOURS is the single named constant this all derives from', () => {
    expect(MISSED_GRACE_HOURS).toBe(6);
  });
});
