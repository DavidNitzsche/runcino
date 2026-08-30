/**
 * lib/plan/_label_distance_truth.test.ts · LABELTRUTH-2 (2026-08-30).
 *
 * THE DISTANCE HALF OF `_label_truth.test.ts`'S OWN GATE.
 *
 * LABELTRUTH-1 swept every rep-bearing day and found the label's REP COUNT
 * could disagree with the spec's — authored at layout time, off a budget the
 * ramp ceiling/taper rescale/long-run smoother below it in
 * `finalizeComposedPlan` could still move. `retitleReps` + a reconcile pass
 * running LAST fixed it, gated by that test.
 *
 * The same shape exists on the DISTANCE side, narrower in scope: the beginner
 * base-building branches (VARIETY-BEGIN-1's light-hills / light-surges days)
 * author `"${mi}mi E w/ …"` off `qualityMiEach` at layout time too, and
 * `qualityMiEach` and the day's final `distanceMi` are free to disagree by
 * the identical mechanism. Measured 2026-08-30, sweeping the same archetype
 * grid `_label_truth.test.ts` walks: 4 of 2,310 "mi E w/" days — every one a
 * 3.11mi/beginner/70mpw base week's dow-2 tempo or dow-4 intervals day — read
 * "8mi E w/ …" over a day that settled at 7.5mi, a clean 0.5mi rounding-level
 * drift (`Math.round(qualityMiEach * 10) / 10` at authoring time disagreeing
 * with whatever later pass moved `qualityMiEach` away from `distanceMi`).
 *
 * Fixed the same way: `retitleLeadMi` (spec-builder.ts, beside `retitleReps`)
 * restates the leading mileage against `day.distanceMi`, called from a second
 * reconcile pass in `finalizeComposedPlan` that runs immediately after
 * LABELTRUTH-1's, for the same reason — after every pass that can still move
 * a day's distance, or it would just drift again.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { composePlan, finalizeComposedPlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { tPaceFromGoal } from './spec-builder';

const START = '2026-08-31';
const addDays = (i: string, n: number) => new Date(Date.parse(i + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
function inputFor(o: any): ComposePlanInput {
  return { raceDistanceMi: o.distMi, goalSec: o.goalSec, goalPaceSec: Math.round(o.goalSec / o.distMi),
    raceDateISO: addDays(START, o.weeks * 7 - 1), startMondayISO: START, level: o.level,
    recentWeeklyMi: o.weeklyMi, easyDayMedianMi: o.easyMi ?? 4, recentLongMi: o.longMi as number, isMidBlock: false,
    longRunDow: o.longDow as DOW, restDow: 6 as DOW, qualityDows: [2, 4] as DOW[], availableDows: null,
    trainingDaysPerWeek: null, crossModes: [], rxQuality: inlinePrescriptions(distanceCategoryOrThrow(o.distMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(o.distMi)),
    tPaceSec: tPaceFromGoal(o.goalSec, o.distMi), lthr: null, maxHr: null,
    ...(o.vdot != null ? { bestRecentVdot: o.vdot } : {}), midBlockRaces: [] } as ComposePlanInput;
}
const DISTS: Array<[number, number]> = [[3.11, 1080], [6.22, 2400], [13.11, 5400], [26.22, 11400], [31.07, 16200]];
const LEVELS = ['beginner', 'intermediate', 'advanced', 'advanced_plus'] as const;
const VOLS = [15, 25, 35, 45, 55, 70];
const WEEKS = [8, 12, 16, 20];

describe('LABELTRUTH-2 · a "mi E w/" label\'s leading mileage is the day\'s own distance', () => {
  it('the leading mileage a runner reads is the distance the day was authored at', () => {
    const f: Record<string, { n: number; ex: string[] }> = {};
    const note = (k: string, ex: string) => { f[k] ??= { n: 0, ex: [] }; f[k].n++; if (f[k].ex.length < 6) f[k].ex.push(ex); };
    let checked = 0;
    for (const [distMi, goalSec] of DISTS) for (const level of LEVELS) for (const weeklyMi of VOLS) for (const weeks of WEEKS) {
      const input = inputFor({ distMi, goalSec, level, weeklyMi, weeks, longDow: 0,
        longMi: Math.max(6, Math.round(weeklyMi * 0.3)), easyMi: Math.max(3, Math.round(weeklyMi / 6)), vdot: 45 });
      let c: any; try { c = composePlan(input); finalizeComposedPlan(c, distMi, level); } catch { continue; }
      const tag = `${distMi}mi/${level}/${weeklyMi}mpw/${weeks}wk`;
      for (const w of c.weeks) for (const d of w.days as any[]) {
        const label = String(d.subLabel ?? '');
        // The exact shape VARIETY-BEGIN-1's beginner base-building branches
        // author: a leading mileage figure, then the literal "mi E w/" token
        // that opens the rep/hill-surge clause.
        const m = /^(\d+(?:\.\d+)?)mi E w\//.exec(label);
        if (!m || !(d.distanceMi > 0)) continue;
        checked++;
        const leadMi = Number(m[1]);
        const diff = Math.abs(leadMi - d.distanceMi);
        if (diff > 0.05) {
          note('LABEL-DISTANCE-DRIFT', `${tag} ${d.type} dow=${d.dow} label="${label}" -> day.distanceMi=${d.distanceMi} (label says ${leadMi}, diff ${diff.toFixed(2)}mi)`);
        }
      }
    }
    // A floor, so a sweep that silently stops matching this label shape cannot
    // pass by finding nothing. The shape is rare by construction (one beginner
    // base-week branch), so the floor is small — but not zero.
    expect(checked, 'the sweep found no "mi E w/" labelled days at all').toBeGreaterThan(50);
    const drift = f['LABEL-DISTANCE-DRIFT'];
    expect(
      drift?.n ?? 0,
      drift ? `${drift.n} of ${checked} "mi E w/" days carry a leading mileage the day's own distance contradicts:\n  ${drift.ex.join('\n  ')}` : '',
    ).toBe(0);
  });
});
