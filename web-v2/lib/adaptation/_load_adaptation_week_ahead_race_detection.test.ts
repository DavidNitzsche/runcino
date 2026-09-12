/**
 * RACEPROT-LOADADAPT-1 (2026-09-11) · the fifth site of the RACEPROT-VERIFY-1 /
 * RACEPROT-PROGRESSION-1 defect shape: a reader answers "is this week a race
 * week" off the raw `plan_weeks.is_race_week` column alone, which
 * `race-week.ts`'s own header states holds ONLY the GOAL race's week, never a
 * B/C tune-up's.
 *
 * `weekRowNoStepReason` (`progression-pass.ts`) was fixed at
 * RACEPROT-PROGRESSION-1 to detect a race anywhere in the week — goal or
 * tune-up — via `weekContainsRace`, given the week's own day `type`s as an
 * optional `days` field. That fix's own header comment named the ONE existing
 * caller left unclosed: `load-adaptation-engine.ts`'s "6a · WHAT KIND OF WEEK
 * IS AHEAD" read, which queried only the three scalar flags
 * (`is_cutback`, `is_race_week`, `phase`) and called
 * `r.rows.map(weekRowNoStepReason)` with no `days` — so `weekRowNoStepReason`
 * silently fell back to the raw column, and a B/C tune-up week's taper/
 * recovery days (typed `easy`, `is_race_week = false`) read as an ordinary
 * step-eligible week to the Adaptation Engine's VOLUME, DURATION and DENSITY
 * levers (`WeekAheadRead`).
 *
 * The fix: add `pw.type` to the SELECT (the query already joins
 * `FROM plan_workouts pw`, so this is free) and pass `days: r.rows` into every
 * `weekRowNoStepReason` call, mirroring exactly how `diagnoseProgressionWeek`
 * passes its own `weekRows` to itself.
 *
 * `weekRowNoStepReason` itself is already exhaustively unit-tested in
 * `_progression_race_week_protection.test.ts` — this file does not re-litigate
 * that predicate. What it verifies is that THIS call site now actually wires
 * real day data into it (the "THE SOURCE" checks), and that the exact
 * query-shape → reduction pipeline this call site runs produces the right
 * `WeekAheadRead` for David's real Santa Monica 10k tune-up week
 * (`wk_76b0f9f77292f000`), replicated at the row level since `resolveAdapt
 * ationProposals` is not itself unit-testable without a live database.
 *
 * Scenario used throughout: David's real upcoming Santa Monica 10k tune-up
 * (2026-09-13, `wk_76b0f9f77292f000`) — the same fixture RACEPROT-VERIFY-1 and
 * RACEPROT-PROGRESSION-1 used: is_race_week false, a taper/shakeout week of
 * ordinary-typed days around one `type: 'race'` row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { weekRowNoStepReason } from '@/lib/plan/progression-pass';

/** Santa Monica 10k's week, shaped like David's real one. */
const TUNEUP_WEEK_DAY_TYPES = ['rest', 'easy', 'easy', 'shakeout', 'race', 'rest', 'easy'];
const ORDINARY_WEEK_DAY_TYPES = ['rest', 'threshold', 'easy', 'easy', 'rest', 'easy', 'long'];
const GOAL_TAPER_WEEK_DAY_TYPES = ['rest', 'easy', 'easy', 'rest', 'shakeout', 'race', 'rest'];

/**
 * Replicates the exact `r.rows.map((row) => weekRowNoStepReason({ ...row,
 * days: r.rows }))` reduction the fixed 6a block runs, off a `plan_workouts`
 * row shape (`is_cutback`, `is_race_week`, `phase`, `type` — one row per day
 * in the window, as the query returns). Kept local rather than imported
 * because the reduction lives inline inside `resolveAdaptationProposals`,
 * which reads the database directly and is not unit-callable; this function
 * IS what "THE SOURCE" checks below pin the real file still matches.
 */
function weekAheadReasonsFor(
  rows: ReadonlyArray<{ is_cutback: boolean | null; is_race_week: boolean | null; phase: string | null; type: string | null }>,
): ReturnType<typeof weekRowNoStepReason>[] {
  return rows
    .map((row) => weekRowNoStepReason({ ...row, days: rows }))
    .filter((x): x is NonNullable<typeof x> => x != null);
}

const tuneupRows = TUNEUP_WEEK_DAY_TYPES.map((type) => ({
  is_cutback: false, is_race_week: false, phase: 'BUILD', type,
}));
const ordinaryRows = ORDINARY_WEEK_DAY_TYPES.map((type) => ({
  is_cutback: false, is_race_week: false, phase: 'BUILD', type,
}));
const goalTaperRows = GOAL_TAPER_WEEK_DAY_TYPES.map((type) => ({
  is_cutback: false, is_race_week: true, phase: 'TAPER', type,
}));

describe('RACEPROT-LOADADAPT-1 · the week-ahead read sees a B/C tune-up week the way it sees the goal race week', () => {
  it("THE INCIDENT · David's Santa Monica 10k tune-up week used to register as step-eligible; it does not now", () => {
    // Pre-fix: weekRowNoStepReason(row) with no `days` falls back to the raw
    // `is_race_week` column, which is false for every row of a tune-up week —
    // every reason comes back null and the levers see `takesProgressionStep:
    // true`. Post-fix: weekContainsRace sees the `type: 'race'` day and every
    // row in the week reads RACE_WEEK.
    const reasons = weekAheadReasonsFor(tuneupRows);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toBe('RACE_WEEK');
  });

  it('every row in that tune-up week resolves RACE_WEEK, not just the race day itself', () => {
    for (const row of tuneupRows) {
      expect(weekRowNoStepReason({ ...row, days: tuneupRows }), `type=${row.type}`).toBe('RACE_WEEK');
    }
  });

  it('an ordinary week with no race anywhere in it is unaffected · still step-eligible', () => {
    expect(weekAheadReasonsFor(ordinaryRows)).toHaveLength(0);
  });

  it('THE GOAL RACE CASE IS UNCHANGED · is_race_week=true still resolves RACE_WEEK regardless of days', () => {
    const reasons = weekAheadReasonsFor(goalTaperRows);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons[0]).toBe('RACE_WEEK');
  });

  it('THE SOURCE · the 6a week-ahead query selects pw.type', () => {
    const src = fs.readFileSync(path.join(__dirname, 'load-adaptation-engine.ts'), 'utf8');
    const at = src.indexOf('WHAT KIND OF WEEK IS AHEAD');
    expect(at, "the 6a block's header comment has moved · re-point this test").toBeGreaterThan(0);
    const block = src.slice(at, at + 2400);
    expect(block).toContain('SELECT wk.is_cutback, wk.is_race_week, ph.label AS phase, pw.type');
  });

  it('THE SOURCE · the reduction passes days into every weekRowNoStepReason call, not the bare column fallback', () => {
    const src = fs.readFileSync(path.join(__dirname, 'load-adaptation-engine.ts'), 'utf8');
    const at = src.indexOf('WHAT KIND OF WEEK IS AHEAD');
    expect(at, "the 6a block's header comment has moved · re-point this test").toBeGreaterThan(0);
    const block = src.slice(at, at + 2400);
    // The pre-fix shape this replaced: `r.rows.map(weekRowNoStepReason)` with
    // no `days` at all, silently falling back to the raw column.
    expect(block, 're-introduced the column-only fallback this fixed').not.toMatch(
      /\.map\(\s*weekRowNoStepReason\s*\)/,
    );
    expect(block).toMatch(/weekRowNoStepReason\(\{\s*\.\.\.row,\s*days:\s*r\.rows\s*\}\)/);
  });
});
