/**
 * lib/plan/_label_truth.test.ts · LABELTRUTH-1 (2026-08-29).
 *
 * THE LABEL A RUNNER READS IS THE SPEC THEIR WATCH RUNS.
 *
 * `sub_label` is the only carrier of a session between compose and persist,
 * and `buildWorkoutSpec` parses it back out to build what the watch executes.
 * When the two disagree the runner is told one workout and given another, and
 * this codebase has paid for that twice already — both times as a point fix on
 * the site that drifted.
 *
 * This is the sweep that would have caught both. It walks the archetype grid,
 * composes and finalizes every plan, and for every day whose label states a
 * single homogeneous rep set it asserts the count in the label is the count in
 * the spec. On its first run, 2026-08-29: 920 of 8,181 rep-bearing days — 11% —
 * disagreed. A beginner on a 15 mi/wk block read "6×1 min surges" off a spec
 * their watch ran three of, because `timeRepSpec` clamps a rep set to what the
 * day can hold (rightly) and left the label alone (not rightly), and because
 * the composer authored that label before every ramp ceiling and taper rescale
 * had finished moving the day's mileage.
 *
 * A SEQUENCE is deliberately out of scope. §9.2's Mona fartlek is
 * "2×90s + 4×60s + 4×30s + 4×15s" and its spec's `rep_count` is the TOTAL step
 * count, 14, not the leading group's 2 — comparing those two rewrites the hard
 * group from two reps to fourteen. That is not a hypothetical: the reconcile
 * pass this gate exists to protect did exactly that on its first run, and this
 * sweep is what caught it before it left the branch.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import { composePlan, finalizeComposedPlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { tPaceFromGoal, buildWorkoutSpec } from './spec-builder';
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

describe('LABELTRUTH-1 · the reps a runner reads are the reps the watch runs', () => {
  it('the reps a runner reads are the reps the watch runs', () => {
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
        if (!label || !(d.distanceMi > 0)) continue;
        // "N×..." or "N x ..." at the head of a rep clause
        const groups = label.match(/\d+\s*[×x]\s*\d/g) ?? [];
        // A sequence (Mona: "2×90s + 4×60s + 4×30s + 4×15s") has several
        // groups and its spec rep_count is the TOTAL step count, so comparing
        // it to the first group's number is meaningless.
        if (groups.length !== 1) continue;
        const m = label.match(/(\d+)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(m\b|km|mi|s\b|min)/i);
        if (!m) continue;
        // AUTHORING-CANONICAL-1 · price the probe spec the way the ENGINE
        // prices it. `input.tPaceSec` is a goal-derived scalar this harness
        // invented; `composePlan` prices every day from the canonical anchors,
        // and a rep-count clamp is pace-dependent, so probing at the wrong
        // pace reports drift that does not exist on any real row.
        const a = c.paceAnchors ?? null;
        let spec: any;
        try {
          spec = buildWorkoutSpec(
            d.type, d.distanceMi, a?.thresholdSecPerMi ?? input.tPaceSec ?? 0, null, label,
            null, null,
            a?.intervalSecPerMi ?? null,
            a?.easyCeilingSecPerMi ?? null,
            false, null, a,
          ).spec;
        } catch { continue; }
        const specReps = spec?.rep_count;
        if (specReps == null) continue;
        checked++;
        const labelReps = Number(m[1]);
        if (labelReps !== specReps) {
          note('REP-COUNT-DRIFT', `${tag} ${d.type} label="${label}" -> spec rep_count=${specReps} (label says ${labelReps})`);
        }
      }
    }
    // A floor, so a sweep that silently stops composing anything cannot pass.
    expect(checked, 'the sweep found no rep-bearing days at all').toBeGreaterThan(3000);
    const drift = f['REP-COUNT-DRIFT'];
    expect(
      drift?.n ?? 0,
      drift ? `${drift.n} of ${checked} rep-bearing days carry a label the spec contradicts:\n  ${drift.ex.join('\n  ')}` : '',
    ).toBe(0);
  });
});
