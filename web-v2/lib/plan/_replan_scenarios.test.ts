/**
 * lib/plan/_replan_scenarios.test.ts · the "Change the plan" sheet's two
 * doctrine helpers, the voice its copy is written in, and (RACEPROT-2) the
 * five scenario functions' race-week protection.
 *
 * The scenarios' full DB-backed path needs a live plan and is exercised end to
 * end against the QA accounts. What is checkable here without a database:
 *
 *   1. the two arithmetic guards agree with the validator that will judge them
 *   2. the sentences the runner reads obey the brief's tone rules
 *   3. the module is deterministic · no clock, no locale, no randomness
 *   4. every scenario protects a B/C tune-up's race week the same way it
 *      already protected the GOAL race's — not by re-implementing the
 *      scenarios against a live plan, but by calling the exported, pure
 *      functions directly against a constructed `PlanShape` (the same
 *      "reproducible from a fixture, falsifiable without a connection"
 *      posture `race-week-role.ts`'s own resolver takes)
 *
 * (2) and (3) are source scans, the same posture `_no_strength_rows.test.ts`
 * and the mutation boundary's own writer scan take: a rule that can only be
 * checked by reading is a rule that stops being checked.
 *
 * (4)'s tune-up fixture is modelled on the runner's real Santa Monica 10K week
 * (`_race_week_label.test.ts`'s own header cites the live row shape this is
 * copied from): week starting 2026-09-07, `is_race_week` FALSE, a 6.2 mi day
 * typed `race` on 2026-09-13 — the exact week RACEWEEK-2 measured as
 * `pln_9a57561debb776e5`'s week 2, and the shape every other `isRaceWeek`
 * defect in this file this round was found against.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { repoRoot } from '@/lib/doctrine/resolve';
import { weekContainsRace } from '@/lib/plan/race-week';
import {
  cutbackLongTarget,
  reentryCeilingMi,
  weekMiles,
  dosingWeekOf,
  planCutback,
  planExtraDay,
  planTravel,
  nextFutureWeekIdx,
  REQUESTED_CUTBACK_LONG_CUT_BAND,
  REENTRY_ACWR_CEILING,
  REENTRY_ACWR_CHRONIC_WEEKS,
  REENTRY_SMALL_STEP_MI,
  LONG_RUN_WOW_MAX_PCT,
  type PlanShape,
  type PlanWeekShape,
  type PlanDayRow,
} from './replan-scenarios';

// ── fixtures · a real tune-up week, a real goal week, an ordinary week ──────

/** A day row, defaults filled in so a case only states what it means. */
function mkDay(over: {
  id: string; dateISO: string; dow: number; type: string; distanceMi?: number;
  isQuality?: boolean; isLong?: boolean; subLabel?: string | null;
}): PlanDayRow {
  return {
    id: over.id,
    weekId: 'w',
    dateISO: over.dateISO,
    dow: over.dow,
    type: over.type,
    distanceMi: over.distanceMi ?? 0,
    isQuality: over.isQuality ?? false,
    isLong: over.isLong ?? false,
    subLabel: over.subLabel ?? null,
    paceTargetSPerMi: null,
    spec: null,
  };
}

/** A week, `containsRace` computed the same way `loadPlanShapeUncached` does —
 *  never hardcoded true/false, so a fixture cannot silently drift from what
 *  the real loader would produce. */
function mkWeek(over: {
  id: string; weekIdx: number; startISO: string; endISO: string;
  phase?: string; isRaceWeek?: boolean; isCutback?: boolean; days: PlanDayRow[];
}): PlanWeekShape {
  const isRaceWeek = over.isRaceWeek ?? false;
  return {
    id: over.id,
    weekIdx: over.weekIdx,
    startISO: over.startISO,
    endISO: over.endISO,
    phase: over.phase ?? 'BUILD',
    isRaceWeek,
    isCutback: over.isCutback ?? false,
    containsRace: weekContainsRace({ isRaceWeek, days: over.days }),
    days: over.days,
  };
}

function mkShape(weeks: PlanWeekShape[]): PlanShape {
  return {
    planId: 'pln_test', userUuid: 'u_test', mode: 'race-prep', raceId: null,
    goalISO: weeks.length ? weeks[weeks.length - 1].endISO : null,
    weeks,
  };
}

/**
 * The runner's real Santa Monica 10K week, verbatim in shape to
 * `_race_week_label.test.ts`'s `tuneUpWeek` fixture: `is_race_week` FALSE,
 * a 6.2 mi `race` day on the Sunday. Filled out with a plausible build week
 * around it (rest / easy / easy / rest / shakeout / race) so the scenario
 * functions under test have real days to reason about.
 */
const TUNEUP_WEEK: PlanWeekShape = mkWeek({
  id: 'wk_tuneup', weekIdx: 1, startISO: '2026-09-07', endISO: '2026-09-13', phase: 'BUILD',
  days: [
    mkDay({ id: 'tu_mon', dateISO: '2026-09-07', dow: 1, type: 'rest' }),
    mkDay({ id: 'tu_tue', dateISO: '2026-09-08', dow: 2, type: 'easy', distanceMi: 6 }),
    mkDay({ id: 'tu_wed', dateISO: '2026-09-09', dow: 3, type: 'rest' }),
    mkDay({ id: 'tu_thu', dateISO: '2026-09-10', dow: 4, type: 'easy', distanceMi: 5 }),
    mkDay({ id: 'tu_fri', dateISO: '2026-09-11', dow: 5, type: 'rest' }),
    mkDay({ id: 'tu_sat', dateISO: '2026-09-12', dow: 6, type: 'easy', distanceMi: 4 }),
    mkDay({ id: 'tu_sun', dateISO: '2026-09-13', dow: 0, type: 'race', distanceMi: 6.2 }),
  ],
});

/** The goal race's own (taper) week · `is_race_week` TRUE. Regression anchor:
 *  every fix below has to leave this path byte-identical. */
const GOAL_WEEK: PlanWeekShape = mkWeek({
  id: 'wk_goal', weekIdx: 14, startISO: '2026-11-30', endISO: '2026-12-06', phase: 'TAPER',
  isRaceWeek: true,
  days: [
    mkDay({ id: 'g_mon', dateISO: '2026-11-30', dow: 1, type: 'rest' }),
    mkDay({ id: 'g_tue', dateISO: '2026-12-01', dow: 2, type: 'easy', distanceMi: 4 }),
    mkDay({ id: 'g_wed', dateISO: '2026-12-02', dow: 3, type: 'rest' }),
    mkDay({ id: 'g_thu', dateISO: '2026-12-03', dow: 4, type: 'easy', distanceMi: 3 }),
    mkDay({ id: 'g_fri', dateISO: '2026-12-04', dow: 5, type: 'rest' }),
    mkDay({ id: 'g_sat', dateISO: '2026-12-05', dow: 6, type: 'shakeout', distanceMi: 2 }),
    mkDay({ id: 'g_sun', dateISO: '2026-12-06', dow: 0, type: 'race', distanceMi: 26.2 }),
  ],
});

/** An ordinary build week · no race anywhere in it. */
const ORDINARY_WEEK: PlanWeekShape = mkWeek({
  id: 'wk_ord', weekIdx: 2, startISO: '2026-09-14', endISO: '2026-09-20', phase: 'BUILD',
  days: [
    mkDay({ id: 'o_mon', dateISO: '2026-09-14', dow: 1, type: 'rest' }),
    mkDay({ id: 'o_tue', dateISO: '2026-09-15', dow: 2, type: 'easy', distanceMi: 8 }),
    mkDay({ id: 'o_wed', dateISO: '2026-09-16', dow: 3, type: 'rest' }),
    mkDay({ id: 'o_thu', dateISO: '2026-09-17', dow: 4, type: 'easy', distanceMi: 8 }),
    mkDay({ id: 'o_fri', dateISO: '2026-09-18', dow: 5, type: 'rest' }),
    mkDay({ id: 'o_sat', dateISO: '2026-09-19', dow: 6, type: 'easy', distanceMi: 6 }),
    mkDay({ id: 'o_sun', dateISO: '2026-09-20', dow: 0, type: 'long', distanceMi: 16, isLong: true }),
  ],
});

const TODAY_WELL_BEFORE = '2026-08-01';

const SRC = path.join(repoRoot(), 'web-v2', 'lib', 'plan', 'replan-scenarios.ts');
const source = () => fs.readFileSync(SRC, 'utf8');
/** Source with comments removed · prose about a rule must never trip the rule. */
const code = () => source().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// ── 1 · the cutback's long run ───────────────────────────────────────────────

describe('cutbackLongTarget · deep enough to be a cutback, shallow enough to come back from', () => {
  const [lo, hi] = REQUESTED_CUTBACK_LONG_CUT_BAND;

  it('lands inside the doctrine band when the week after is not a constraint', () => {
    for (const long of [4, 6, 8, 10, 12, 16, 20, 22]) {
      const t = cutbackLongTarget(long, 0);
      expect(t, `long ${long}`).not.toBeNull();
      const cut = (long - t!) / long;
      // Strictly inside the band · no slack. The half-mile grid is the engine's
      // problem to solve, not the claim's to soften.
      expect(cut, `long ${long} cut ${(cut * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(cut, `long ${long} cut ${(cut * 100).toFixed(0)}%`).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it('never cuts so deep that the following week becomes a week-over-week jump', () => {
    for (const long of [4, 6, 8, 10, 12, 16, 20]) {
      for (const next of [0, long * 0.8, long, long * 1.1]) {
        const t = cutbackLongTarget(long, next);
        if (t == null) continue;
        if (next <= 0) continue;
        const rise = ((next - t) / t) * 100;
        expect(rise, `long ${long} → ${t} → next ${next}`).toBeLessThanOrEqual(LONG_RUN_WOW_MAX_PCT + 1e-9);
      }
    }
  });

  it('refuses rather than half-doing it when the two constraints do not overlap', () => {
    // The week after is longer than this one · any legal cut here is a jump there.
    expect(cutbackLongTarget(10, 14)).toBeNull();
    expect(cutbackLongTarget(0, 12)).toBeNull();
  });
});

// ── 2 · the travel re-entry ──────────────────────────────────────────────────

describe('reentryCeilingMi · the climb back stays under the line the validator judges it by', () => {
  /** The validator's own test, verbatim in shape: curr / mean(window ∪ curr) ≤ ceiling. */
  const acwr = (prev3: number[], curr: number) => {
    const window = [...prev3, curr];
    return curr / (window.reduce((a, b) => a + b, 0) / window.length);
  };

  it('a week capped at the ceiling is inside the acute:chronic red line', () => {
    const cases: Array<[number[], number]> = [
      [[46, 0, 0], 0],
      [[34.5, 0, 0], 0],
      [[0, 0, 27.5], 27.5],
      [[31, 32, 34], 34],
      [[10, 0, 0], 0],
    ];
    for (const [prev3, prevMi] of cases) {
      const ceiling = reentryCeilingMi(prev3, prevMi);
      const ratio = acwr(prev3, ceiling);
      const exempt = ceiling - prevMi <= REENTRY_SMALL_STEP_MI;
      if (exempt) continue; // the validator never looks at a step this small
      expect(ratio, `prev ${prev3.join(',')} ceiling ${ceiling}`)
        .toBeLessThanOrEqual(REENTRY_ACWR_CEILING + 1e-9);
    }
  });

  it('never proposes a week smaller than the small-step exemption already allows', () => {
    // Two weeks of nothing must not force the return below "four more miles than
    // last week", which doctrine's own exemption says is never a spike.
    expect(reentryCeilingMi([0, 0, 0], 0)).toBe(REENTRY_SMALL_STEP_MI);
    expect(reentryCeilingMi([0, 0, 0], 12)).toBe(12 + REENTRY_SMALL_STEP_MI);
  });

  it('uses the chronic window the validator uses', () => {
    // 1.5 × s / (4 − 1.5) = 0.6 s. If either constant moved, this moves with it.
    const s = 100;
    const expected = (REENTRY_ACWR_CEILING * s) / (REENTRY_ACWR_CHRONIC_WEEKS - REENTRY_ACWR_CEILING);
    expect(reentryCeilingMi([50, 30, 20], 0)).toBeCloseTo(expected, 6);
  });
});

// ── RACEPROT-2 · a B/C tune-up's race week is protected the same way the ────
//   goal race's is, everywhere `isRaceWeek` used to be read alone ──────────

describe('weekMiles · a tune-up race day is excluded, same as the goal race day', () => {
  it('strips the goal race day (regression, unaffected by this fix)', () => {
    // 4 + 3 + 2 = 9 · the 26.2 mi race day is excluded.
    expect(weekMiles(GOAL_WEEK)).toBe(9);
  });

  it('strips a B/C tune-up race day too', () => {
    // THE REGRESSION THIS EXISTS FOR: gating on `isRaceWeek` alone (GOAL only)
    // left this at 6 + 5 + 4 + 6.2 = 21.2 · the tune-up's own race distance
    // counted into the week's mileage while the goal race's already did not.
    expect(weekMiles(TUNEUP_WEEK)).toBe(15);
  });

  it('counts every day, race included, on a week with no race at all', () => {
    expect(weekMiles(ORDINARY_WEEK)).toBe(38);
  });
});

describe('dosingWeekOf · predicts the SAME dosing context validate.ts/dose-guard.ts will enforce', () => {
  it('reads a tune-up week as a race-week dosing context (RACEWEEK-2 semantics)', () => {
    // `dosing.ts#contextOf` reports rather than enforces percentage caps here.
    // Passing the raw GOAL-only `isRaceWeek` would have predicted 'training'
    // for this exact week and offered a change the boundary then refuses.
    expect(dosingWeekOf(TUNEUP_WEEK, new Map()).isRaceWeek).toBe(true);
  });

  it('still reads the goal week as a race-week dosing context (regression)', () => {
    expect(dosingWeekOf(GOAL_WEEK, new Map()).isRaceWeek).toBe(true);
  });

  it('reads an ordinary week as a training dosing context', () => {
    expect(dosingWeekOf(ORDINARY_WEEK, new Map()).isRaceWeek).toBe(false);
  });
});

describe('planCutback · a cutback does not apply to a week you are racing, of any priority', () => {
  it('still refuses the goal race week with its own taper-specific reason (regression)', () => {
    const shape = mkShape([GOAL_WEEK]);
    const result = planCutback(shape, GOAL_WEEK.weekIdx, TODAY_WELL_BEFORE);
    expect('unavailable' in result && result.unavailable).toBe(
      'That is race week. It is already the easiest week in the block.',
    );
  });

  it('refuses a B/C tune-up week too, with its own accurate reason', () => {
    // THE REGRESSION THIS EXISTS FOR: gating on `isRaceWeek` alone let this
    // fall through to the arithmetic below and propose cutting a week the
    // runner is racing in.
    const shape = mkShape([TUNEUP_WEEK]);
    const result = planCutback(shape, TUNEUP_WEEK.weekIdx, TODAY_WELL_BEFORE);
    expect('unavailable' in result).toBe(true);
    const reason = 'unavailable' in result ? result.unavailable : '';
    expect(reason).toMatch(/race/i);
    // Not the goal week's own "already the easiest week" reasoning, which is
    // specifically about a taper and is not true of a tune-up week.
    expect(reason).not.toBe('That is race week. It is already the easiest week in the block.');
  });

  it('still cuts back an ordinary week with no race in it (regression)', () => {
    const shape = mkShape([ORDINARY_WEEK]);
    const result = planCutback(shape, ORDINARY_WEEK.weekIdx, TODAY_WELL_BEFORE);
    expect('unavailable' in result).toBe(false);
  });
});

describe('planExtraDay · an extra day never lands inside a week you are racing, of any priority', () => {
  it('skips a B/C tune-up week and fills the free day in the ordinary week after it', () => {
    // THE REGRESSION THIS EXISTS FOR: gating on `isRaceWeek` alone let an
    // extra rest-to-easy day land on the Monday of the runner's own tune-up
    // week — his rest day before a race he is actually running that week.
    const shape = mkShape([TUNEUP_WEEK, ORDINARY_WEEK]);
    const result = planExtraDay(shape, 1 /* Monday */, TUNEUP_WEEK.weekIdx, TODAY_WELL_BEFORE);
    expect('unavailable' in result).toBe(false);
    if ('unavailable' in result) return;
    const touchedIdx = result.weeks.map((w) => w.weekIdx);
    expect(touchedIdx).not.toContain(TUNEUP_WEEK.weekIdx);
    expect(touchedIdx).toContain(ORDINARY_WEEK.weekIdx);
  });

  it('still skips the goal race week (regression)', () => {
    const nextWeek = mkWeek({
      id: 'wk_after_goal', weekIdx: GOAL_WEEK.weekIdx + 1,
      startISO: '2026-12-07', endISO: '2026-12-13', phase: 'RECOVERY',
      days: [
        mkDay({ id: 'ag_mon', dateISO: '2026-12-07', dow: 1, type: 'rest' }),
        mkDay({ id: 'ag_tue', dateISO: '2026-12-08', dow: 2, type: 'easy', distanceMi: 3 }),
        mkDay({ id: 'ag_thu', dateISO: '2026-12-10', dow: 4, type: 'easy', distanceMi: 3 }),
        mkDay({ id: 'ag_sun', dateISO: '2026-12-13', dow: 0, type: 'easy', distanceMi: 4 }),
      ],
    });
    const shape = mkShape([GOAL_WEEK, nextWeek]);
    const result = planExtraDay(shape, 1, GOAL_WEEK.weekIdx, TODAY_WELL_BEFORE);
    expect('unavailable' in result).toBe(false);
    if ('unavailable' in result) return;
    const touchedIdx = result.weeks.map((w) => w.weekIdx);
    expect(touchedIdx).not.toContain(GOAL_WEEK.weekIdx);
    expect(touchedIdx).toContain(nextWeek.weekIdx);
  });
});

describe('planTravel · booking travel over a B/C tune-up race day is refused, same as the goal race', () => {
  it('still refuses travel over the goal race day (regression)', () => {
    const shape = mkShape([GOAL_WEEK]);
    const result = planTravel(shape, '2026-12-05', '2026-12-07', TODAY_WELL_BEFORE);
    expect('unavailable' in result && result.unavailable).toMatch(/covers race week/);
  });

  it('refuses travel over a B/C tune-up race day too', () => {
    // THE REGRESSION THIS EXISTS FOR: the copy already said "race week" with
    // no "goal" qualifier, but the check only ever looked at the goal column.
    const shape = mkShape([TUNEUP_WEEK]);
    const result = planTravel(shape, '2026-09-12', '2026-09-14', TODAY_WELL_BEFORE);
    expect('unavailable' in result && result.unavailable).toMatch(/covers race week/);
  });

  it('leaves an ordinary window alone (regression)', () => {
    const shape = mkShape([ORDINARY_WEEK]);
    const result = planTravel(shape, '2026-09-15', '2026-09-16', TODAY_WELL_BEFORE);
    expect('unavailable' in result).toBe(false);
  });
});

describe('nextFutureWeekIdx · the default subject of a change is never a week you are racing', () => {
  it('skips a B/C tune-up week and defaults to the ordinary week after it', () => {
    const shape = mkShape([TUNEUP_WEEK, ORDINARY_WEEK]);
    expect(nextFutureWeekIdx(shape, TODAY_WELL_BEFORE)).toBe(ORDINARY_WEEK.weekIdx);
  });

  it('still skips the goal race week (regression)', () => {
    // Goal week listed first so `find` (array order, not weekIdx order)
    // actually has to skip past it to reach the ordinary week.
    const shape = mkShape([GOAL_WEEK, ORDINARY_WEEK]);
    expect(nextFutureWeekIdx(shape, TODAY_WELL_BEFORE)).toBe(ORDINARY_WEEK.weekIdx);
  });

  it('returns the only future week when nothing in the block is a race week', () => {
    expect(nextFutureWeekIdx(mkShape([ORDINARY_WEEK]), TODAY_WELL_BEFORE)).toBe(ORDINARY_WEEK.weekIdx);
  });
});

describe('source scan · the pre-fix pattern does not recur', () => {
  it('no site still gates a race-day exclusion on the raw GOAL-only isRaceWeek', () => {
    // The exact string every one of RACEPROT-2's fixed sites carried before:
    // excluding a race day's own distance only when `isRaceWeek` (GOAL-only)
    // was true, rather than `containsRace` (any priority). A regression here
    // would silently reopen the tune-up-week gap this file's tests above
    // exist to catch.
    expect(code()).not.toMatch(/d\.type === 'race' && week\.isRaceWeek/);
  });
});

// ── 3 · coach voice ──────────────────────────────────────────────────────────

/**
 * Every sentence this module hands a runner lives in a single-quoted literal.
 * SQL and the fingerprint builder use backticks, so scanning single quotes
 * reaches the copy and nothing else.
 */
function copyLiterals(): string[] {
  return [...code().matchAll(/'(?:[^'\\\n]|\\.)*'/g)]
    .map((m) => m[0].slice(1, -1).replace(/\\'/g, "'"))
    // Identifiers, enum members and column names are not prose.
    .filter((s) => /\s/.test(s) && s.length > 12);
}

describe('coach voice · Design/running-app-design-brief-v2.md', () => {
  it('finds the copy at all (the scan is not silently matching nothing)', () => {
    expect(copyLiterals().length).toBeGreaterThan(20);
  });

  it('no em dashes', () => {
    expect(copyLiterals().filter((s) => s.includes('—'))).toEqual([]);
  });

  it('no exclamation marks', () => {
    expect(copyLiterals().filter((s) => s.includes('!'))).toEqual([]);
  });

  it('no emoji', () => {
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    expect(copyLiterals().filter((s) => EMOJI.test(s))).toEqual([]);
  });

  it('never scolds · no "you should", "you need to", "make sure"', () => {
    const SCOLD = /\b(you should|you need to|make sure|don't forget|remember to)\b/i;
    expect(copyLiterals().filter((s) => SCOLD.test(s))).toEqual([]);
  });

  // NATURAL-COACHING-3 (2026-09-12) · internal training-tier/load jargon a
  // runner should never have to parse. Confirmed live via the design-system
  // audit's `6a-longest` render before this string was fixed. Scoped to the
  // LEADING-LABEL shape ("C race · ...", "C race. ...") that was the actual
  // defect — not every reference to the letter, since `AddRaceV5.swift`'s
  // own Priority picker literally offers "B · Tune-up" / "C · For fun" as
  // real, runner-visible values, and this file's own refusal telling a
  // runner to "Mark it B or C on the race" is naming that real control by
  // its real value, not internal jargon leaking through.
  it('no leading race-tier label ("C race ·", "C race.") in runner-facing prose', () => {
    const JARGON = /(?:^|[.!?]\s+)[ABC] race\b/;
    expect(copyLiterals().filter((s) => JARGON.test(s))).toEqual([]);
  });

  it('no "quality session" internal training-load term', () => {
    expect(copyLiterals().filter((s) => /quality session/i.test(s))).toEqual([]);
  });
});

// ── 4 · determinism ──────────────────────────────────────────────────────────

describe('determinism · same plan and same request, same rows', () => {
  it('no randomness', () => {
    expect(code()).not.toMatch(/Math\.random|randomBytes|randomUUID/);
  });

  it('no clock beyond the runner\'s own date', () => {
    // `todayISO` is passed in. A bare `new Date()` or `Date.now()` would make
    // the same request produce different rows on either side of midnight.
    expect(code()).not.toMatch(/new Date\(\s*\)/);
    expect(code()).not.toMatch(/Date\.now\(\)/);
  });

  it('no locale-dependent formatting', () => {
    expect(code()).not.toMatch(/toLocale\w*\(|Intl\./);
  });

  it('the confirm token is a plain hash of the plan and the request', () => {
    expect(code()).toMatch(/createHash\('sha256'\)/);
  });
});

// ── 5 · the boundary is the only door ────────────────────────────────────────

describe('every write goes through lib/plan/mutate.ts', () => {
  it('the module writes plan_workouts only inside a mutatePlan callback', () => {
    const src = code();
    expect(src).toMatch(/mutatePlan</);
    const writes = [...src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+plan_workouts\b/gi)];
    expect(writes.length).toBeGreaterThan(0);
    // The apply callback is the only place they can be · everything before it in
    // the file is a SELECT or pure arithmetic.
    const applyAt = src.indexOf('apply: async (tx: PoolClient)');
    expect(applyAt).toBeGreaterThan(0);
    for (const w of writes) expect(w.index!).toBeGreaterThan(applyAt);
  });

  it('does not reach for the escape hatch', () => {
    expect(code()).not.toMatch(/bypass\s*:/);
  });
});
