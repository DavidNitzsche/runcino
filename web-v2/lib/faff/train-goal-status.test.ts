/**
 * Train and Goal state ONE verdict in ONE vocabulary.
 *
 * The live defect this locks: on 2026-08-17 Train's PROJECTION card read
 * "3:31:48 PROJECTED FINISH TODAY · 32 min behind" while the Goal page read
 * "PROJECTED 3:19:04 · BEHIND 19:04". Both numbers were defensible —
 * today's fitness vs the race-day trajectory — but each carried its own
 * verdict wording, so a runner reading two pages got two answers.
 *
 * The fix is not to delete one number. It is: ONE verdict, from
 * lib/faff/goal-status, fed identical inputs on both pages; and the two
 * NUMBERS labelled as the distinct facts they are.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGoalStatus } from './goal-status';

/** Drop block and line comments so source guards assert on code alone. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

const TRAIN = join(__dirname, '../../components/faff-app/views/TrainView.tsx');
const TARGETS = join(__dirname, '../../components/faff-app/views/TargetsView.tsx');

/** The owner's live numbers on 2026-08-17. */
const GOAL_SEC = 3 * 3600;            // 3:00:00
const TODAY_FITNESS_SEC = 3 * 3600 + 31 * 60 + 48;  // 3:31:48
const RACE_DAY_SEC = 3 * 3600 + 19 * 60 + 4;        // 3:19:04

const liveTrajectory = {
  gapSec: RACE_DAY_SEC - GOAL_SEC,    // 1144 = 19:04
  gapVdot: 2.1,
  reachable: false,
  aheadOfGoal: false,
};

describe('the shared resolver on the live inputs', () => {
  const read = resolveGoalStatus({
    trajectory: liveTrajectory,
    goalSec: GOAL_SEC,
    projectionSec: TODAY_FITNESS_SEC,
  });

  it('produces the one verdict both pages must show', () => {
    expect(read).not.toBeNull();
    expect(read!.label).toBe('BEHIND · 19:04');
  });

  it('is driven by the race-day trajectory, not today\'s fitness', () => {
    // 3:31:48 vs goal is 31:48. The verdict must not quote that number.
    expect(read!.gapLabel).toBe('19:04');
    expect(read!.gapLabel).not.toBe('31:48');
  });

  it('gives the same answer whichever page asks, given the same inputs', () => {
    const asTargets = resolveGoalStatus({
      trajectory: liveTrajectory, goalSec: GOAL_SEC, projectionSec: TODAY_FITNESS_SEC,
    });
    const asTrain = resolveGoalStatus({
      trajectory: liveTrajectory, goalSec: GOAL_SEC, projectionSec: TODAY_FITNESS_SEC,
    });
    expect(asTrain).toEqual(asTargets);
  });

  it('never softens an unclosable gap on one page only', () => {
    const renegotiating = resolveGoalStatus({
      trajectory: { ...liveTrajectory, reachable: true, gapVdot: 0.2 },
      goalSec: GOAL_SEC,
      projectionSec: TODAY_FITNESS_SEC,
      unclosable: true,
    });
    expect(renegotiating!.word).toBe('BEHIND');
  });
});

describe('TrainView has adopted the shared vocabulary', () => {
  // Code only · the fix comments quote the retired wording deliberately.
  const src = stripComments(readFileSync(TRAIN, 'utf8'));

  it('imports the shared resolver and chip', () => {
    expect(src).toMatch(/resolveGoalStatus/);
    expect(src).toMatch(/from '@\/lib\/faff\/goal-status'/);
    expect(src).toMatch(/import \{ StatusChip \}/);
  });

  it('feeds the resolver the same four inputs TargetsView feeds it', () => {
    // 2026-08-30 · THIS ASSERTION WAS BEING SATISFIED BY THE BUG.
    //
    // It used to look for the bare substring 'goalSec:' anywhere in each file.
    // TargetsView passes `goalSec` to the resolver as a SHORTHAND property, so
    // the only literal `goalSec:` in that file was
    // `JSON.stringify({ goalSec: suggested.sec, source: 'renegotiate' })` —
    // the goal-renegotiation button's request body. Deleting the violation
    // turned this test red, which is the wrong way round: a check that passes
    // because a defect is present is worse than no check.
    //
    // It now reads the resolver's ARGUMENT OBJECT out of each file and compares
    // the key sets, which is what "the same inputs" actually means.
    const targets = stripComments(readFileSync(TARGETS, 'utf8'));
    const argKeys = (source: string, where: string): string[] => {
      const i = source.indexOf('resolveGoalStatus({');
      expect(i, `${where} does not call resolveGoalStatus`).toBeGreaterThan(-1);
      let depth = 1;
      let j = i + 'resolveGoalStatus({'.length;
      for (; j < source.length && depth > 0; j++) {
        if (source[j] === '{') depth++;
        else if (source[j] === '}') depth--;
      }
      const body = source.slice(i + 'resolveGoalStatus({'.length, j - 1);
      // Top-level keys only · shorthand (`goalSec,`) counts as the key it names.
      return body
        .split('\n')
        .map((l) => l.trim())
        .map((l) => /^([A-Za-z_$][\w$]*)\s*[:,]/.exec(l)?.[1] ?? null)
        .filter((k): k is string => k != null)
        .sort();
    };
    expect(argKeys(src, 'TrainView')).toEqual(['goalSec', 'projectionSec', 'trajectory', 'unclosable']);
    expect(argKeys(targets, 'TargetsView')).toEqual(['goalSec', 'projectionSec', 'trajectory', 'unclosable']);
  });

  it('both pages read the pending goal-outlook note through the shared predicate', () => {
    // Or one page can call an unclosable gap "watching" while the other calls
    // it BEHIND. `isGoalOutlookKind` covers the live `goal_outlook` kind AND
    // the retired `goal_renegotiation` rows still standing in prod, so neither
    // page may hardcode either literal.
    const targets = stripComments(readFileSync(TARGETS, 'utf8'));
    for (const [name, s] of [['TrainView', src], ['TargetsView', targets]] as const) {
      expect(s, `${name} must use the shared kind predicate`).toMatch(/isGoalOutlookKind\s*\(/);
      expect(s, `${name} hardcodes a proposal kind instead of using the predicate`)
        .not.toMatch(/kind === 'goal_(renegotiation|outlook)'/);
    }
  });

  it('no longer writes its own verdict from goal.delta', () => {
    expect(src).not.toMatch(/chipLabel\s*=\s*isWatching\s*\?\s*'watching'\s*:\s*goal\.delta/);
  });

  it('labels the two numbers as two distinct facts', () => {
    // Today's-fitness number is named as such, and the race-day number is
    // named separately — neither presents as "the" projection.
    expect(src).toMatch(/FROM TODAY'S FITNESS/);
    expect(src).toMatch(/On race day/);
    expect(src).not.toMatch(/PROJECTED FINISH TODAY/);
  });
});
