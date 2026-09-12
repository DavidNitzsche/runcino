/**
 * RACEPROT-PROGRESSION-1 (2026-09-11) · the sibling defect to RACEPROT-VERIFY-1
 * (`_overshoot_race_recency.test.ts`), found by an independent reviewer of the
 * now-merged `fix/race-week-protection-tuneup-gaps` branch. Same shape, three
 * more sites:
 *
 *   1. `progression-pass.ts`'s `weekRowNoStepReason` — a B/C tune-up week did
 *      not pause progression the way a goal-race week does, because it only
 *      checked the raw `plan_weeks.is_race_week` column (which is only ever
 *      true for the GOAL race's week — `race-week.ts`'s own header).
 *   2. `progression-pass.ts`'s prior-lookback query (`diagnoseProgressionWeek`)
 *      — the same column-only pattern let a tune-up week's deliberately-eased
 *      session be read as the "last normal prescription" a struggling
 *      runner's next step gets compared against.
 *   3. `app/api/plan/replan/route.ts`'s sick-ladder — a B/C tune-up scheduled
 *      inside the ladder's first three weeks would still have its volume
 *      scaled and (week 1) its `race_week_tuneup`-typed rows converted to a
 *      generic easy day, contradicting the file's own header comment
 *      ("Race-week rows are never touched by the ladder").
 *
 * All three are fixed the same way `dose-guard.ts`/`adapt.ts`/`mutate.ts`
 * already fixed this exact gap: `weekContainsRace` (race-week.ts), the
 * day-level detector, instead of the raw column.
 *
 * Scenario used throughout: David's real upcoming Santa Monica 10k tune-up
 * (2026-09-13, `pln_7636bcc0a201bf2d`, `wk_76b0f9f77292f000`), the same one
 * RACEPROT-VERIFY-1 verified against — is_race_week false, a taper/shakeout
 * week of ordinary-typed days around one `type: 'race'` row.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { weekRowNoStepReason, priorLookbackEligible } from './progression-pass';

/** Santa Monica 10k's week, shaped like David's real one: is_race_week is the
 *  tune-up default (false), and the taper/recovery days around the race are
 *  ordinary 'easy'/'shakeout' rows — exactly what the old column-only guard
 *  could not see. Mirrors `_overshoot_race_recency.test.ts`'s fixture. */
const TUNEUP_WEEK_DAY_TYPES = ['rest', 'easy', 'easy', 'shakeout', 'race', 'rest', 'easy'];
const ORDINARY_WEEK_DAY_TYPES = ['rest', 'threshold', 'easy', 'easy', 'rest', 'easy', 'long'];
const GOAL_TAPER_WEEK_DAY_TYPES = ['rest', 'easy', 'easy', 'rest', 'shakeout', 'race', 'rest'];

describe('RACEPROT-PROGRESSION-1 · weekRowNoStepReason sees a B/C tune-up week the way it sees the goal race week', () => {
  it('THE INCIDENT · a tune-up week used to take a progression step; it does not now', () => {
    const row = {
      is_cutback: false,
      is_race_week: false, // is_race_week: only the GOAL race's week
      phase: 'BUILD',
      days: TUNEUP_WEEK_DAY_TYPES.map((type) => ({ type })),
    };
    // Pre-fix this returned null (BUILD phase, no cutback, is_race_week
    // false) — the week read as an ordinary step-eligible week.
    expect(weekRowNoStepReason(row)).toBe('RACE_WEEK');
  });

  it('every row in that same tune-up week reads RACE_WEEK, not just the race row itself', () => {
    for (const phase of ['BUILD', 'QUALITY', null]) {
      expect(
        weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase, days: TUNEUP_WEEK_DAY_TYPES.map((type) => ({ type })) }),
        `phase=${phase}`,
      ).toBe('RACE_WEEK');
    }
  });

  it('an ordinary week with no race anywhere in it is unaffected', () => {
    expect(weekRowNoStepReason({
      is_cutback: false, is_race_week: false, phase: 'BUILD',
      days: ORDINARY_WEEK_DAY_TYPES.map((type) => ({ type })),
    })).toBeNull();
  });

  it('THE GOAL RACE CASE IS UNCHANGED · is_race_week=true still short-circuits to RACE_WEEK', () => {
    // No `days` supplied at all — the exact shape every existing caller
    // (load-adaptation-engine.ts, the test suites) already uses.
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: true, phase: null })).toBe('RACE_WEEK');
    // And with `days` supplied, same answer either way.
    expect(weekRowNoStepReason({
      is_cutback: false, is_race_week: true, phase: 'TAPER',
      days: GOAL_TAPER_WEEK_DAY_TYPES.map((type) => ({ type })),
    })).toBe('RACE_WEEK');
  });

  it('CUTBACK still wins over a race check, exactly as before', () => {
    expect(weekRowNoStepReason({
      is_cutback: true, is_race_week: false, phase: 'BUILD',
      days: TUNEUP_WEEK_DAY_TYPES.map((type) => ({ type })),
    })).toBe('CUTBACK');
  });

  it('TAPER/RECOVERY phase labels still resolve when there is no race in the week', () => {
    expect(weekRowNoStepReason({
      is_cutback: false, is_race_week: false, phase: 'TAPER',
      days: ORDINARY_WEEK_DAY_TYPES.map((type) => ({ type })),
    })).toBe('TAPER');
    expect(weekRowNoStepReason({
      is_cutback: false, is_race_week: false, phase: 'RECOVERY',
      days: ORDINARY_WEEK_DAY_TYPES.map((type) => ({ type })),
    })).toBe('RECOVERY');
  });

  it('omitting `days` entirely never regresses a non-race week (backward compatibility for the one caller that cannot supply it)', () => {
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase: 'BUILD' })).toBeNull();
    expect(weekRowNoStepReason({ is_cutback: false, is_race_week: false, phase: 'TAPER' })).toBe('TAPER');
  });

  it('THE SOURCE · weekRowNoStepReason resolves race-week through the shared detector, not the raw column alone', () => {
    const src = fs.readFileSync(path.join(__dirname, 'progression-pass.ts'), 'utf8');
    const at = src.indexOf('export function weekRowNoStepReason');
    expect(at, 'weekRowNoStepReason has moved · re-point this test').toBeGreaterThan(0);
    const body = src.slice(at, at + 1200);
    expect(body).toContain('weekContainsRace');
    expect(body, 're-introduced the column-only guard this fixed').not.toMatch(
      /if\s*\(\s*r\.is_race_week\s*===\s*true\s*\)/,
    );
  });
});

describe('RACEPROT-PROGRESSION-1 · priorLookbackEligible protects a tune-up week the prior-prescription reader would otherwise read as normal', () => {
  it("THE INCIDENT · a tune-up week's easy day was usable as the prior 'normal' prescription; it is not now", () => {
    expect(priorLookbackEligible({
      weekIsRaceWeek: false, // is_race_week: only the GOAL race's week
      weekDayTypes: TUNEUP_WEEK_DAY_TYPES,
    })).toBe(false);
  });

  it('every non-race-machinery day in that same tune-up week is excluded too', () => {
    // The predicate is per-week, not per-row: any candidate whose WEEK
    // contains a race is excluded, whatever that candidate's own type is.
    for (const dayTypes of [TUNEUP_WEEK_DAY_TYPES, GOAL_TAPER_WEEK_DAY_TYPES]) {
      expect(priorLookbackEligible({ weekIsRaceWeek: false, weekDayTypes: dayTypes })).toBe(false);
    }
  });

  it('an ordinary week with no race anywhere in it is unaffected · still eligible', () => {
    expect(priorLookbackEligible({
      weekIsRaceWeek: false,
      weekDayTypes: ORDINARY_WEEK_DAY_TYPES,
    })).toBe(true);
  });

  it('THE GOAL RACE CASE IS UNCHANGED · is_race_week=true still excludes the week', () => {
    expect(priorLookbackEligible({
      weekIsRaceWeek: true,
      weekDayTypes: GOAL_TAPER_WEEK_DAY_TYPES,
    })).toBe(false);
  });

  it('a row with no readable week (week_id null → empty day types) is unchanged by this fix · still eligible', () => {
    // Mirrors `overshootShaveEligible`'s equivalent case: `weekContainsRace`
    // on an unreadable week (no column, no days) returns false, same as the
    // pre-fix `COALESCE(wk.is_race_week, false) = false` did for a null
    // column — the "no week" case is not what this fix changes.
    expect(priorLookbackEligible({ weekIsRaceWeek: null, weekDayTypes: [] })).toBe(true);
  });

  it('THE SOURCE · the prior-lookback filter resolves eligibility through the shared detector, not the raw column alone', () => {
    const src = fs.readFileSync(path.join(__dirname, 'progression-pass.ts'), 'utf8');
    const at = src.indexOf('const priorCandidateRows');
    expect(at, 'the prior-lookback query has moved · re-point this test').toBeGreaterThan(0);
    const block = src.slice(at, at + 3000);
    expect(block).toContain('priorLookbackEligible');
    // The raw-column-only guard this replaced must not have come back.
    expect(block, 're-introduced the column-only guard this fixed').not.toMatch(
      /COALESCE\(wk\.is_race_week,\s*false\)\s*=\s*false/,
    );
  });
});

describe('RACEPROT-PROGRESSION-1 · the replan sick-ladder never touches a week that carries any race, goal or tune-up', () => {
  it("THE SOURCE · the sick-ladder loop's skip check reads through weekContainsRace, not the raw column alone", () => {
    const routePath = path.join(__dirname, '..', '..', 'app', 'api', 'plan', 'replan', 'route.ts');
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toContain("import { weekContainsRace } from '@/lib/plan/race-week'");
    const at = src.indexOf('for (let i = 0; i < weeks.length; i++)');
    expect(at, 'the sick-ladder loop has moved · re-point this test').toBeGreaterThan(0);
    const block = src.slice(at, at + 600);
    expect(block).toContain('weekContainsRace');
    // The bare column check this replaced ("if (wk.is_race_week) continue")
    // must not have come back — it is exactly the RACEPROT-VERIFY-1 shape,
    // and this file's own header comment ("Race-week rows are never touched
    // by the ladder") is the invariant it silently violated.
    expect(block, 're-introduced the column-only guard this fixed').not.toMatch(
      /if\s*\(\s*wk\.is_race_week\s*\)\s*continue/,
    );
  });
});
