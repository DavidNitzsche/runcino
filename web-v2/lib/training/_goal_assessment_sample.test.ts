/**
 * A printout of the goal assessment across the verdict ladder.
 *
 * Not an assertion suite (that is `_goal_assessment.test.ts`). This exists so
 * the copy can be READ rather than inferred from field names — the house voice
 * is a product requirement, and a voice nobody ever sees drifts.
 */
import { describe, it, expect } from 'vitest';
import { assessGoal } from './goal-assessment';
import { predictRaceTime, formatRaceTime } from './vdot';

const MI_M = 26.2188;
const MI_5K = 3.10686;
const TODAY = '2026-08-18';

const secFor = (v: number, d: number) => Math.round(predictRaceTime(v, d)!);
const isoIn = (w: number) =>
  new Date(Date.parse(TODAY + 'T12:00:00Z') + w * 7 * 86400000).toISOString().slice(0, 10);

describe('goal assessment · sample output', () => {
  it('prints the ladder', () => {
    const cases = [
      ['comfortable  · M', { distanceMi: MI_M, goalSec: secFor(43, MI_M), goalDateISO: isoIn(12), todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 45 }],
      ['realistic    · M', { distanceMi: MI_M, goalSec: secFor(47.5, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 45 }],
      ['ambitious    · M', { distanceMi: MI_M, goalSec: secFor(49, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 45 }],
      ['aggressive   · M', { distanceMi: MI_M, goalSec: secFor(51, MI_M), goalDateISO: isoIn(16), todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 45 }],
      ['out-of-reach · M', { distanceMi: MI_M, goalSec: 12000, goalDateISO: isoIn(5), todayISO: TODAY, currentVdot: 34, recentWeeklyMi: 18, context: { anchorAgeDays: 120, anchorDistanceMi: 3.1 } }],
      ['no-date goal · 5K', { distanceMi: MI_5K, goalSec: secFor(52, MI_5K), goalDateISO: null, todayISO: TODAY, currentVdot: 46, recentWeeklyMi: 30 }],
      ['cold start   · M', { distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(20), todayISO: TODAY, currentVdot: null }],
      ['date passed  · M', { distanceMi: MI_M, goalSec: secFor(50, MI_M), goalDateISO: isoIn(-3), todayISO: TODAY, currentVdot: 46 }],
    ] as const;

    const lines: string[] = [];
    for (const [label, input] of cases) {
      const a = assessGoal(input as Parameters<typeof assessGoal>[0]);
      lines.push(`\n${label}  →  ${a.feasibility}`);
      lines.push(`  goal ${formatRaceTime(a.goalSec)} · today's fitness ${formatRaceTime(a.currentEquivalentSec) ?? 'n/a'}` +
        ` · safe ${formatRaceTime(a.safeTargetSec) ?? 'n/a'} · stretch ${formatRaceTime(a.stretchTargetSec) ?? 'n/a'}` +
        ` · reporting against ${formatRaceTime(a.reportAgainstSec) ?? 'n/a'}`);
      lines.push(`  "${a.statement}"`);
      for (const c of a.cautions) lines.push(`   · ${c}`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});
