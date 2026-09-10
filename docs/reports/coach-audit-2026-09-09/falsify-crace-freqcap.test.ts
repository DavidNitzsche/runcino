/**
 * FALSIFICATION SCRIPT — preserved evidence artifact, not part of the app's
 * test suite. Written for the Coach forensic audit's v2.1 correction pass
 * (2026-09-10) to settle, by direct execution rather than source-reading,
 * a disagreement between the Coach and Brain audits over whether
 * `embedMidBlockRaces`' frequency-cap branch in
 * `web-v2/lib/plan/generate.ts` still produces the literal string
 *   'Off. Race week for a tune-up · rest is the work now.'
 * on current main, and under what exact conditions.
 *
 * To reproduce: copy this file into a detached worktree of the SHA you
 * want to test at `web-v2/lib/plan/_falsify_crace_freqcap.test.ts`
 * (it must live under `web-v2/lib/plan/` to resolve the `./generate`
 * import), symlink `node_modules`, then:
 *   npx vitest run lib/plan/_falsify_crace_freqcap.test.ts --reporter=verbose --silent=false
 *
 * Originally run against origin/main @ 9f082e33929c670c091920006b0602e85de5dc68.
 * Results (see docs/audit-2026-09-09-coach-forensic-audit-v2.1.md §2.1):
 *   - REALISTIC sweep (qualityDows: [2, 4], freqs 3-7): 140 configs, 0 hits.
 *   - EDGE-CASE sweep (qualityDows: [], freqs 2-3):      56 configs, 18 hits,
 *     all priority C, zero priority B.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type DOW,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';

const START_MONDAY = '2026-08-31';
const TARGET = 'Race week for a tune-up';

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

function cimInput(
  midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>,
  trainingDaysPerWeek: number | null,
  qualityDows: DOW[],
): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 14 * 7 - 1),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 30.5,
    easyDayMedianMi: 6,
    recentLongMi: 13,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows,
    availableDows: null,
    trainingDaysPerWeek,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: fixtureTPaceFromGoalPace(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 45.1,
    midBlockRaces,
  };
}

function build(
  midBlockRaces: NonNullable<ComposePlanInput['midBlockRaces']>,
  trainingDaysPerWeek: number | null,
  qualityDows: DOW[],
) {
  const input = cimInput(midBlockRaces, trainingDaysPerWeek, qualityDows);
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  return composed;
}

function sweep(qualityDows: DOW[], freqs: number[]) {
  const priorities = ['B', 'C'] as const;
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const weekOffsets = [3, 7];

  const hits: string[] = [];
  let total = 0;

  for (const priority of priorities) {
    for (const wi of weekOffsets) {
      for (const dow of weekdays) {
        for (const freq of freqs) {
          total++;
          const raceDateISO = addDays(START_MONDAY, wi * 7 + dow);
          const race = {
            slug: `race-${priority}-${wi}-${dow}-${freq}`,
            name: `Test ${priority} race`,
            date: raceDateISO,
            distanceMi: priority === 'B' ? 13.1 : 6.2,
            goalPaceSec: null,
            priority,
          };
          let composed;
          try {
            composed = build([race], freq, qualityDows);
          } catch (e) {
            hits.push(`ERROR priority=${priority} wi=${wi} dow=${dow} freq=${freq}: ${(e as Error).message}`);
            continue;
          }
          for (const w of composed.weeks) {
            for (const d of w.days) {
              if (typeof d.notes === 'string' && d.notes.includes(TARGET)) {
                hits.push(
                  `HIT priority=${priority} raceDow=${dow} raceWeekIdx=${wi} freq=${freq} -> ` +
                  `weekIdx=${composed.weeks.indexOf(w)} dow=${d.dow} notes="${d.notes}"`,
                );
              }
            }
          }
        }
      }
    }
  }

  return { total, hits };
}

describe('FALSIFY: frequency-cap tune-up-rest sentence, current main', () => {
  it('REALISTIC: qualityDows=[2,4] (standard shape), freq 3-7 -> expect 0 hits', () => {
    const { total, hits } = sweep([2, 4] as DOW[], [3, 4, 5, 6, 7]);
    console.log(`REALISTIC · TOTAL CONFIGS: ${total} · TOTAL HITS: ${hits.length}`);
    for (const h of hits) console.log(h);
    expect(true).toBe(true);
  });

  it('EDGE CASE: qualityDows=[] (no quality days authored), freq 2-3 -> expect hits, all C', () => {
    const { total, hits } = sweep([] as DOW[], [2, 3]);
    console.log(`EDGE CASE · TOTAL CONFIGS: ${total} · TOTAL HITS: ${hits.length}`);
    for (const h of hits) console.log(h);
    expect(true).toBe(true);
  });
});
