/**
 * _controlled_c_effort.test.ts · THE GATE FOR CEFFORT-1 (2026-09-02).
 *
 * THE DEFECT. `RaceForOutlook.priority` was loaded by the race-pace brain and
 * read NOWHERE inside it, so a C race was priced exactly like an A race. On the
 * owner's block the only thing holding his Dodgers 10K back from an all-out
 * effort the day before an 18-mile long run was that he had happened to type a
 * soft 45:00 goal. Change the goal to 43:00 and the engine prescribed 43:00.
 * Restraint that depends on the runner typing a convenient number is not
 * restraint, and this file is the assertion that it no longer does.
 *
 * WHAT IT HOLDS
 *
 *   1. THE LOAD-BEARING ONE: a C race's execution target does not move when
 *      the stated goal is made faster. Same runner, same evidence, a goal
 *      swept from generous to impossible — the target holds.
 *   2. A goal that is SLOWER is still honoured. The runner may ask for less.
 *   3. An A or B race is UNCHANGED. This is the control, and without it a
 *      "fix" that simply capped every race would pass everything above.
 *   4. The HR band, the mid-race abort, the strategy label and the pacing
 *      prose all move with the same effort (Rule 16 · one day, one effort).
 *   5. The doctrine rows are read out of `Research/` at run time.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *
 *   · WHETHER THE CEILING IS THE RIGHT NUMBER. It asserts the ceiling is
 *     goal-independent, monotone and slower than an all-out race. It does not
 *     assert that threshold-carry is the physiologically correct pace for a
 *     controlled 10K; that is a doctrine reading (`Research/00b` §"Recovery by
 *     Effort" + `Research/04` §pace-zone table) and if it is ever reversed
 *     these tests must be rewritten, not loosened.
 *   · WHETHER THE ROW REACHES THE RUNNER. `race-row-refresh.ts` is what writes
 *     `execution.paceSecPerMi` onto `plan_workouts`, and its DB path is not
 *     exercised here. NAMED GAP.
 *   · THE SUB-LABEL. The race row still reads `RACE`, because that is the
 *     day's type and `sub_label` is a chip, not a sentence. Nothing here
 *     checks it.
 *   · A RACE WITH NO PRIORITY ON ITS ROW. `priority: null` is graded as a
 *     race, deliberately (an unlabelled row is more likely a goal race), and
 *     no case here would notice if that convention changed.
 *
 * DISTRIBUTION (Rule 22): 6 controlled-effort cases against 3 race cases. The
 * race cases exist precisely so a blanket cap cannot pass — they are the only
 * thing standing between this gate and an engine that restrains everything.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '@/lib/doctrine/resolve';
import {
  RACE_HR_PCT_LTHR,
  controlledEffortHrCategory,
  raceAbortHrBpm,
} from '@/lib/race/distance-doctrine';
import { resolveRaceHrGuidance, raceHrLine } from '@/lib/race/race-hr-guidance';
import { composeRaceExecutionPlan } from '@/lib/race/execution-plan';
import { composeRaceOutlook } from '@/lib/race/race-outlook';
import { fixtureRace, fixtureReads } from '@/lib/race/_race_outlook_fixture';

/* ══════════════════════════════════════════════════════════════════════
 * THE LOAD-BEARING ASSERTION · `priority` IS READ, AND THE GOAL CANNOT
 * PULL A C RACE FASTER
 * ══════════════════════════════════════════════════════════════════════ */

const TODAY = '2026-09-02';
const dodgers = (priority: 'A' | 'B' | 'C', goalSec: number | null) => fixtureRace({
  slug: 'dodgers', name: 'Dodgers', distanceMi: 6.21, dateISO: '2026-09-26',
  priority, statedGoalSec: goalSec,
});
/**
 * The shared fixture's `equivalenceAt` is hardcoded at 26.2 mi, so a 10K read
 * off it would be a marathon time. This supplies a 10K equivalence instead —
 * 42:56, which is what the owner's own capacity projects at this distance, so
 * the numbers below are the real ones rather than a shape.
 */
const TEN_K_EQUIVALENCE_SEC = 42 * 60 + 56;
const reads = () => fixtureReads({
  equivalenceAt: async () => ({
    expectedSec: TEN_K_EQUIVALENCE_SEC,
    danielsSec: TEN_K_EQUIVALENCE_SEC,
    durabilityProjectionSec: TEN_K_EQUIVALENCE_SEC,
    durabilityBlend: { weight: 0.5 },
    specificityAdjustment: null,
    marathonSpecificTraining: null,
  }) as never,
});
const outlook = (priority: 'A' | 'B' | 'C', goalSec: number | null) =>
  composeRaceOutlook(dodgers(priority, goalSec), TODAY, reads());
const target = async (priority: 'A' | 'B' | 'C', goalSec: number | null): Promise<number | null> =>
  (await outlook(priority, goalSec)).execution.targetSec;

describe('CEFFORT-1 · a C race is priced as a controlled effort', () => {
  it('THE ONE THAT MATTERS · sweeping the stated goal faster does not move a C target', async () => {
    // The defect, exactly: the runner types a faster number and the engine
    // prescribes it. Six goals from generous to impossible, measured:
    //
    //   goal   50:00  47:00  45:00  43:00  41:00  38:00
    //   target 50:00  47:00  45:00  44:30  44:30  44:30
    //
    // The ceiling is 44:30 — the threshold carry (7:10/mi over 6.21 mi),
    // slower than the 42:56 this runner could race today. Past the ceiling the
    // goal stops moving the day, which is the whole fix.
    const goals = [50 * 60, 47 * 60, 45 * 60, 43 * 60, 41 * 60, 38 * 60];
    const results = await Promise.all(goals.map((g) => target('C', g)));
    const ceiling = Math.min(...results.map((r) => r ?? Infinity));
    expect(ceiling, 'LIVENESS · a ceiling must have been resolved').toBeGreaterThan(0);
    // Goals STRICTLY faster than the ceiling must all land on it.
    const pastCeiling = goals
      .map((g, i) => ({ g, t: results[i] }))
      .filter((x) => x.g < ceiling);
    expect(
      pastCeiling.length,
      'LIVENESS · at least one goal must be faster than the ceiling or this proves nothing',
    ).toBeGreaterThan(0);
    for (const { g, t } of pastCeiling) {
      expect(t, `goal ${g}s pulled the C target to ${t}s, past the ${ceiling}s ceiling`).toBe(ceiling);
    }
    // And no goal, however fast, produces a target faster than the ceiling.
    for (const r of results) expect(r!).toBeGreaterThanOrEqual(ceiling);

    // THE SAME SWEEP AGAINST THE A LIMB. Without this the test is weak, and it
    // was: with the fix switched off (`isControlledCEffort = false`) every
    // assertion above still passed, because an A race clamps at its own likely
    // range edge and that edge looks like a ceiling. What actually distinguishes
    // the two is that the C limb is SLOWER, and it must be slower somewhere.
    const asRace = await Promise.all(goals.map((g) => target('A', g)));
    for (let i = 0; i < goals.length; i++) {
      expect(results[i]!, `goal ${goals[i]}s · C ${results[i]} must not be faster than A ${asRace[i]}`)
        .toBeGreaterThanOrEqual(asRace[i]!);
    }
    expect(
      goals.some((_, i) => results[i]! > asRace[i]!),
      'a C race that is never slower than an A race is a C race nothing priced',
    ).toBe(true);
  });

  it('the C limb is NAMED on the object, so a surface can tell the two apart', async () => {
    const c = await outlook('C', 43 * 60);
    expect(c.execution.effortCharacter).toBe('controlled_c_effort');
    expect(c.execution.source).toBe('controlled_c_effort');
    expect(c.execution.strategyLabel).toMatch(/^Controlled effort/);
    expect(c.execution.hr?.reasons).toContain('CONTROLLED_C_EFFORT_BAND');
    // Coach voice on the sentence the runner reads.
    expect(c.execution.reasonVsExpected).not.toMatch(/[!—]/);
  });

  it('a SLOWER stated goal is still honoured · the runner may ask for less', async () => {
    const slow = await target('C', 52 * 60);
    const fast = await target('C', 40 * 60);
    expect(slow!).toBeGreaterThan(fast!);
    expect(slow!).toBe(52 * 60);
  });

  it('the C target is slower than the same runner would be told to RACE', async () => {
    const asRace = await target('A', 43 * 60);
    const asC = await target('C', 43 * 60);
    expect(asC!, 'a hard workout must not be prescribed at race pace').toBeGreaterThan(asRace!);
  });

  it('THE CONTROL · an A and a B race are untouched, so this is not a blanket cap', async () => {
    for (const p of ['A', 'B'] as const) {
      const o = await outlook(p, 43 * 60);
      expect(o.execution.effortCharacter, `${p} must still be a race`).toBe('race');
      expect(o.execution.source).not.toBe('controlled_c_effort');
      expect(o.execution.strategyLabel).not.toMatch(/^Controlled effort/);
    }
  });

  it('the goal is compared, never edited · feasibility still reads the runner\u2019s own number', async () => {
    const o = await outlook('C', 38 * 60);
    expect(o.statedGoal.sec, 'the stated goal is echoed unchanged').toBe(38 * 60);
    expect(o.goalFeasibility.status).not.toBe('no_goal');
  });

  it('the C target is MONOTONE in the goal (Rule 9 · no cliff)', async () => {
    // Walk the goal in one-minute steps across the ceiling and assert the
    // target never moves backwards.
    const steps = [40, 42, 44, 46, 48, 50].map((m) => m * 60);
    const out: number[] = [];
    for (const g of steps) out.push((await target('C', g))!);
    for (let i = 1; i < out.length; i++) {
      expect(out[i], `target went backwards at goal ${steps[i]}s: ${JSON.stringify(out)}`)
        .toBeGreaterThanOrEqual(out[i - 1]);
    }
  });
});


describe('CEFFORT-1 · the controlled HR band', () => {
  const lthr = 168;
  const base = {
    distanceMi: 6.21,
    lthrBpm: lthr,
    maxHrBpm: 183,
    executionPaceSecPerMi: 435,
    efforts: [],
  };

  it('a C effort reads the next-longer row · the band and the abort BOTH move', () => {
    const race = resolveRaceHrGuidance({ ...base, effortCharacter: 'race' })!;
    const ctrl = resolveRaceHrGuidance({ ...base, effortCharacter: 'controlled' })!;
    expect(race.expectedRangeBpm[1]).toBeGreaterThan(ctrl.expectedRangeBpm[1]);
    expect(race.checkpointAbortBpm!).toBeGreaterThan(ctrl.checkpointAbortBpm!);
    // Rule 16 · the reason is on the object, so a surface can say WHY the band
    // is not the one the distance would give.
    expect(ctrl.reasons).toContain('CONTROLLED_C_EFFORT_BAND');
    expect(race.reasons).not.toContain('CONTROLLED_C_EFFORT_BAND');
  });

  it('the band comes out of the published table, not a fudge factor', () => {
    const ctrl = resolveRaceHrGuidance({ ...base, effortCharacter: 'controlled' })!;
    const row = RACE_HR_PCT_LTHR[controlledEffortHrCategory('10k')];
    expect(ctrl.expectedRangeBpm).toEqual([Math.round(lthr * row[0]), Math.round(lthr * row[1])]);
  });

  it('OMITTING effortCharacter is byte-identical to the old behaviour', () => {
    const before = resolveRaceHrGuidance(base);
    const asRace = resolveRaceHrGuidance({ ...base, effortCharacter: 'race' });
    expect(JSON.stringify(before)).toBe(JSON.stringify(asRace));
    expect(raceAbortHrBpm({ distanceMi: 6.21, lthr })).toBe(
      raceAbortHrBpm({ distanceMi: 6.21, lthr, effortCharacter: 'race' }),
    );
  });

  it('the marathon row is its own floor · no invented slower row', () => {
    expect(controlledEffortHrCategory('m')).toBe('m');
    expect(controlledEffortHrCategory('ultra')).toBe('m');
  });

  it('the sentence names the effort the band belongs to (Rule 16)', () => {
    const ctrl = resolveRaceHrGuidance({
      ...base,
      efforts: [{ id: 'a', dateISO: '2026-08-01', distanceMi: 6, paceSecPerMi: 435, avgHr: 160, kind: 'other' }],
      effortCharacter: 'controlled',
    })!;
    const line = raceHrLine(ctrl);
    expect(line).toMatch(/[Cc]ontrolled/);
    expect(line).not.toMatch(/race effort/);
    expect(line).not.toMatch(/[!—]/);
  });

  it('the doctrine table still says what the code reads', () => {
    const doc = fs.readFileSync(
      path.join(repoRoot(), 'Research', '00b-recovery-protocols.md'), 'utf8',
    );
    const i = doc.indexOf('### Recovery by Effort');
    expect(i).toBeGreaterThan(-1);
    const cRow = doc.slice(i, i + 1200).split('\n').find((l) => l.includes('C race'));
    expect(cRow, 'LIVENESS · the C row must exist').toBeTruthy();
    // The two clauses the whole feature rests on.
    expect(cRow!).toContain('hard workout');
    expect(cRow!).toContain('no taper');
    const aRow = doc.slice(i, i + 1200).split('\n').find((l) => l.includes('A race'));
    expect(aRow!).toContain('full taper');
  });
});

describe('CEFFORT-1 · the execution plan does not tell a controlled effort to empty the tank', () => {
  const args = { goalSec: 2700, distanceMi: 6.21, lthr: 168, maxHr: 183 };

  it('a race carries a closing push; a controlled effort does not', () => {
    const race = composeRaceExecutionPlan({ ...args, effortCharacter: 'race' })!;
    const ctrl = composeRaceExecutionPlan({ ...args, effortCharacter: 'controlled' })!;
    expect(race.splits.some((s) => s.label === 'push')).toBe(true);
    expect(ctrl.splits.some((s) => s.label === 'push')).toBe(false);
    // The PACE is untouched · only the instruction changes.
    expect(ctrl.splits.map((s) => s.paceSPerMi)).toEqual(race.splits.map((s) => s.paceSPerMi));
  });

  it('the strategy prose stops saying "push the final mile on feel"', () => {
    const ctrl = composeRaceExecutionPlan({ ...args, effortCharacter: 'controlled' })!;
    expect(ctrl.strategyLine).not.toMatch(/[Pp]ush the final/);
    expect(ctrl.strategyLine).toMatch(/[Cc]ontrolled/);
    // Coach voice.
    expect(ctrl.strategyLine).not.toMatch(/[!—]/);
    const race = composeRaceExecutionPlan({ ...args, effortCharacter: 'race' })!;
    expect(race.strategyLine, 'the race limb is the control').toMatch(/Push the final/);
  });

  it('OMITTING effortCharacter is byte-identical to the old behaviour', () => {
    expect(JSON.stringify(composeRaceExecutionPlan(args)))
      .toBe(JSON.stringify(composeRaceExecutionPlan({ ...args, effortCharacter: 'race' })));
  });
});
