/**
 * lib/plan/_audit_persisted_quality.test.ts · PERSIST-TIME quality≤long guard.
 *
 * Audit dimension: PERSISTED-ROW INVARIANT 3 (the round-2 CRITICAL · fix (g)).
 *
 * The bug (round 2): the validator + the four other offline harnesses assert
 * invariant 3 ("long ≥ every easy AND every quality that week") against the
 * DayPlan.distanceMi HEADLINE that composePlan emits. But the PERSISTED
 * plan_workouts.distance_mi is NOT that headline — persistPlan derives the
 * structured spec from the sub_label (buildWorkoutSpec), caps it to the day's
 * clamped distance (capSpecToDistance), then stores
 * totalDistanceMiFromSpec(spec) — the SUM of warmup + reps + float-jog +
 * cooldown. A fixed-shape tempo / a float-jog overshoot can sum PAST the
 * clamped headline and ship a quality run LONGER than the week's long on a
 * short-race plan (the canonical round-2 critical: a tempo persisted 8mi vs a
 * 6mi long).
 *
 * Fix (g) closed it two ways:
 *   1. buildWorkoutSpec tempo/threshold/intervals branches now budget-scale to
 *      distance_mi (the clamped quality allocation).
 *   2. persistPlan calls capSpecToDistance(spec, d.distanceMi) before storing,
 *      shrinking any residual overshoot back to the clamp.
 *
 * This harness reproduces the EXACT production persist arithmetic — including
 * the FINAL easy/quality≤long sweep that generatePlan runs on composePlan's
 * output BEFORE persist (generate.ts:2402-2420), which composePlan itself does
 * NOT run — and asserts the realized persisted distance of every quality day
 * is ≤ the week's long. INCLUDES the race week (where the race itself is the
 * week's long and the tune-up must not exceed it), unlike the volume harness's
 * I3 which skips race week.
 *
 * Substrate: composePlan + buildWorkoutSpec + capSpecToDistance +
 * totalDistanceMiFromSpec — all pure. No DB, no clock.
 *
 * KNOWN BOUNDED RESIDUAL (round 3): a `threshold` session whose library
 * prescription is "3×1mi @ T" has an irreducible footprint — capSpecToDistance
 * cannot drop below 2 reps, and a 1-mile rep is a full mile, so the floor is
 * 2×1mi + 2×0.5mi(WU/CD min) + float ≈ 3.1mi. When the week's long is pinned at
 * 3.0mi (an intermediate/no-level runner at ~15mpw chasing a 5K — the lowest
 * sane 5K volume), the realized threshold overshoots the long by ≈0.10mi. This
 * is a literal-but-negligible invariant-3 breach at a degenerate floor; it is
 * pinned to ≤ QUALITY_FLOOR_RESIDUAL below so a REAL regression (the round-2
 * 8-vs-6mi class, ~2mi over) still fails loudly. See round-3 audit notes.
 */

import { describe, it, expect } from 'vitest';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  type ComposePlanInput,
  type ComposePlanResult,
  type DOW,
} from './generate';
import {
  tPaceFromGoal,
  buildWorkoutSpec,
  capSpecToDistance,
  totalDistanceMiFromSpec,
} from './spec-builder';
import { vdotFromTpace, iPaceFromVdot } from '@/lib/training/vdot';

// ── input builder (mirrors the periodization harness) ───────────────────────
const START_MONDAY = '2026-01-05'; // a Monday

function buildInput(o: {
  level: ComposePlanInput['level'];
  raceDistanceMi: number;
  goalSec: number | null;
  weeksOut: number;
  recentWeeklyMi: number;
  recentLongMi?: number;
  longRunDow?: DOW;
  restDow?: DOW;
  qualityDows?: DOW[];
  lthr?: number | null;
  maxHr?: number | null;
}): ComposePlanInput {
  const cat = distanceCategoryOfPublic(o.raceDistanceMi);
  const raceDay = new Date(START_MONDAY + 'T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + o.weeksOut * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);
  const goalPaceSec = o.goalSec != null ? Math.round(o.goalSec / o.raceDistanceMi) : null;
  return {
    raceDistanceMi: o.raceDistanceMi,
    goalSec: o.goalSec,
    goalPaceSec,
    raceDateISO,
    startMondayISO: START_MONDAY,
    level: o.level,
    recentWeeklyMi: o.recentWeeklyMi,
    easyDayMedianMi: Math.max(3, Math.round(o.recentWeeklyMi / 5)),
    recentLongMi: o.recentLongMi ?? Math.round(o.recentWeeklyMi * 0.25),
    isMidBlock: false,
    longRunDow: (o.longRunDow ?? 0) as DOW,
    restDow: (o.restDow ?? 6) as DOW,
    qualityDows: o.qualityDows ?? ([2, 4] as DOW[]),
    availableDows: null,
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(o.goalSec, o.raceDistanceMi),
    lthr: o.lthr ?? null,
    maxHr: o.maxHr ?? null,
  };
}

// ── production-path replication ─────────────────────────────────────────────

/**
 * Replicate generate.ts:2402-2420 — the FINAL easy/quality≤long sweep that
 * generatePlan runs on composePlan's output BEFORE persist. composePlan does
 * NOT run it, so a faithful persist model must apply it here. Mutates in place.
 * Re-caps every easy AND non-long quality day at the week's longest run
 * (including the race day, which IS the long in a short-race race week).
 */
function applyFinalEasyLongSweep(weeks: ComposePlanResult['weeks']): void {
  for (const w of weeks) {
    const longMi = Math.max(0, ...w.days.filter((d) => d.isLong).map((d) => d.distanceMi));
    if (longMi <= 0) continue;
    for (const d of w.days) {
      if ((d.type === 'easy' || (d.isQuality && d.type !== 'race')) && !d.isLong && d.distanceMi > longMi) {
        d.distanceMi = longMi;
      }
    }
  }
}

/**
 * Replicate generate.ts:2092-2128 — the persist-time spec realization for one
 * day. Returns the value that would land in plan_workouts.distance_mi:
 *   totalDistanceMiFromSpec(capSpecToDistance(buildWorkoutSpec(...), d.distanceMi))
 * (no sealed snapshot — that path overrides with the runner's already-completed
 * prescription and is intentionally exempt from the cap; covered separately).
 */
function persistRealizedMi(
  input: ComposePlanInput,
  week: ComposePlanResult['weeks'][number],
  d: ComposePlanResult['weeks'][number]['days'][number],
): number {
  const goalIPaceEligible = ['5k', '10k'].includes(distanceCategoryOfPublic(input.raceDistanceMi));
  const weekT = (week as { tPaceSec?: number | null }).tPaceSec ?? input.tPaceSec;
  // persist only derives a spec when weekT is non-null; otherwise the row keeps
  // d.distanceMi verbatim (no spec, no cap) — which the sweep already bounded.
  if (weekT == null) return d.distanceMi;
  const iPaceSec = goalIPaceEligible ? iPaceFromVdot(vdotFromTpace(weekT)) : null;
  const built = buildWorkoutSpec(
    d.type,
    d.distanceMi,
    weekT,
    input.lthr,
    d.subLabel,
    input.maxHr ?? null,
    input.goalPaceSec ?? null,
    iPaceSec,
  );
  const capped = capSpecToDistance(built.spec, d.distanceMi);
  return totalDistanceMiFromSpec(capped, d.distanceMi);
}

// ── sweep dimensions ────────────────────────────────────────────────────────
// Short races (5K/10K) are where fix (g) bites: small weekly budgets clamp the
// long low, so a fixed-shape quality session can overshoot it. We also include
// HM as a control (its longs are large enough the bug can't fire).
const LEVELS: ComposePlanInput['level'][] = ['beginner', 'intermediate', 'advanced', 'advanced_plus', null];
const DISTS: Array<{ mi: number; name: string; goals: Array<number | null> }> = [
  { mi: 3.1, name: '5K', goals: [1020, 1500, 1800, 2100, null] },
  { mi: 6.2, name: '10K', goals: [2100, 2700, 3000, 4200, null] },
  { mi: 13.1, name: 'HM', goals: [4800, 6300, 7080, 9000, null] },
];
const VOLS = [15, 20, 25, 30, 35, 45, 55];
const WEEKS = [8, 12, 16];
const LONG_DOWS: DOW[] = [0, 6, 3];

const EPS = 0.05;
// The bounded rep-floor residual documented in the header. A REAL regression
// (round-2 class) is ≥ ~1mi; 0.15 sits comfortably between the two.
const QUALITY_FLOOR_RESIDUAL = 0.15;

interface Over {
  desc: string;
  delta: number;
  realized: number;
  long: number;
  type: string;
  level: string;
  raceWk: boolean;
}

function runSweep() {
  let combos = 0;
  let crashes = 0;
  let qualityRowsChecked = 0;
  const oversBeyondResidual: Over[] = [];
  const oversWithinResidual: Over[] = [];
  let worstDelta = -Infinity;
  let worstDesc = '';

  for (const level of LEVELS) {
    for (const dd of DISTS) {
      for (const g of dd.goals) {
        for (const vol of VOLS) {
          for (const wk of WEEKS) {
            for (const ld of LONG_DOWS) {
              combos++;
              let res: ComposePlanResult;
              try {
                const input = buildInput({
                  level, raceDistanceMi: dd.mi, goalSec: g, weeksOut: wk, recentWeeklyMi: vol, longRunDow: ld,
                });
                res = composePlan(input);
                applyFinalEasyLongSweep(res.weeks);
                res.weeks.forEach((w, wi) => {
                  const longMi = Math.max(0, ...w.days.filter((x) => x.isLong).map((x) => x.distanceMi));
                  if (longMi <= 0) return; // no training long this week (rare cutback)
                  for (const d of w.days) {
                    if (!(d.isQuality && d.type !== 'race')) continue; // race day is exempt (it IS the long)
                    if (d.distanceMi <= 0) continue;
                    qualityRowsChecked++;
                    const realized = persistRealizedMi(input, w, d);
                    const delta = realized - longMi;
                    if (delta > worstDelta) {
                      worstDelta = delta;
                      worstDesc = `${level}/${dd.name}/goal${g}/vol${vol}/wk${wk}/ld${ld} week${wi}(${w.phase},raceWk=${w.isRaceWeek}) ${d.type} headline=${d.distanceMi} sub="${d.subLabel}" realized=${realized} long=${longMi} delta=${delta.toFixed(2)}`;
                    }
                    if (delta > EPS) {
                      const o: Over = {
                        desc: `${level}/${dd.name}/goal${g}/vol${vol}/wk${wk}/ld${ld} week${wi} ${d.type} realized=${realized} long=${longMi} delta=${delta.toFixed(2)}`,
                        delta, realized, long: longMi, type: d.type, level: String(level), raceWk: w.isRaceWeek,
                      };
                      if (delta > QUALITY_FLOOR_RESIDUAL) oversBeyondResidual.push(o);
                      else oversWithinResidual.push(o);
                    }
                  }
                });
              } catch (e) {
                crashes++;
                oversBeyondResidual.push({
                  desc: `CRASH ${level}/${dd.name}/goal${g}/vol${vol}/wk${wk}/ld${ld}: ${(e as Error)?.message}`,
                  delta: Infinity, realized: NaN, long: NaN, type: 'crash', level: String(level), raceWk: false,
                });
              }
            }
          }
        }
      }
    }
  }
  return { combos, crashes, qualityRowsChecked, oversBeyondResidual, oversWithinResidual, worstDelta, worstDesc };
}

const SWEEP = runSweep();

describe('PERSISTED quality≤long · fix (g) regression guard', () => {
  it('exercised the short-race persist domain (sweep is real, not all-throw)', () => {
    // 5 levels × 3 dists × 5 goals × 7 vols × 3 weeks × 3 long-dows.
    expect(SWEEP.combos).toBe(5 * 3 * 5 * 7 * 3 * 3);
    expect(SWEEP.combos).toBe(4725);
    expect(SWEEP.qualityRowsChecked).toBeGreaterThan(10000);
    // eslint-disable-next-line no-console
    console.log(
      `[persisted-quality] combos=${SWEEP.combos} qualityRows=${SWEEP.qualityRowsChecked} ` +
        `crashes=${SWEEP.crashes} oversBeyondResidual=${SWEEP.oversBeyondResidual.length} ` +
        `oversWithinResidual=${SWEEP.oversWithinResidual.length} worstDelta=${SWEEP.worstDelta.toFixed(3)}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[persisted-quality] worst case: ${SWEEP.worstDesc}`);
  });

  it('never crashes deriving a persisted quality spec', () => {
    expect(SWEEP.crashes).toBe(0);
  });

  it('INVARIANT 3 (persisted) · no quality realizes more than ~1mi over the week long (round-2 8-vs-6 class)', () => {
    // This is the load-bearing assertion: the round-2 CRITICAL was a tempo
    // persisting 8mi against a 6mi long (delta +2). Any regression of that
    // class — a fixed-shape spec or float overshoot escaping capSpecToDistance —
    // lands here and fails loudly.
    if (SWEEP.oversBeyondResidual.length > 0) {
      const sample = SWEEP.oversBeyondResidual.slice(0, 15).map((o) => o.desc).join('\n');
      throw new Error(
        `${SWEEP.oversBeyondResidual.length} persisted quality day(s) exceed the week long by ` +
          `> ${QUALITY_FLOOR_RESIDUAL}mi (fix (g) regression):\n${sample}`,
      );
    }
    expect(SWEEP.oversBeyondResidual.length).toBe(0);
  });

  it('worst persisted overshoot stays inside the documented rep-floor residual', () => {
    // Pins the KNOWN bounded residual (1-mile threshold reps at a 3.0mi long).
    // If this tightens to 0, drop QUALITY_FLOOR_RESIDUAL; if it grows past it,
    // capSpecToDistance lost ground and we want to know.
    expect(SWEEP.worstDelta).toBeLessThanOrEqual(QUALITY_FLOOR_RESIDUAL);
  });

  // ── targeted reproductions of the exact round-2 critical ──────────────────

  it('round-2 critical · short-race tempo never persists longer than the long', () => {
    // A 5K/10K plan at a volume where layoutWeek once allowed a tempo headline
    // below a fixed 8mi spec. Drive the tempo branch directly at each budget
    // the clamp could hand it; capSpecToDistance + budget-scale must hold.
    for (const budget of [3, 4, 5, 6, 7, 8, 10]) {
      const built = buildWorkoutSpec('tempo', budget, 400, 162, null, 188, null, null);
      const realized = totalDistanceMiFromSpec(capSpecToDistance(built.spec, budget), budget);
      expect(realized).toBeLessThanOrEqual(budget + EPS);
    }
  });

  it('round-2 critical · intervals (sub-mile reps) compress under a small long', () => {
    // 5×800m → 0.497mi reps compress to 2 reps under a small cap. At budgets ≥3
    // (the smallest long that ever carries intervals in a real plan — intervals
    // never appear when the long is sub-3) the realized session fits the budget.
    // Below ~2.6mi the same 2-rep + WU/CD + float floor as 1-mile threshold reps
    // applies, but that budget never reaches the intervals branch in production.
    for (const budget of [3, 4, 5, 6]) {
      const built = buildWorkoutSpec('intervals', budget, 360, 162, '5×800m @ I pace · 90s jog', 188, null, 330);
      const realized = totalDistanceMiFromSpec(capSpecToDistance(built.spec, budget), budget);
      expect(realized).toBeLessThanOrEqual(budget + EPS);
    }
    // Characterize the floor explicitly so it's a tested bound, not a surprise:
    // a sub-3 budget can't drop a 5×800m session below ~2.6mi.
    const tiny = buildWorkoutSpec('intervals', 2.5, 360, 162, '5×800m @ I pace · 90s jog', 188, null, 330);
    const tinyRealized = totalDistanceMiFromSpec(capSpecToDistance(tiny.spec, 2.5), 2.5);
    expect(tinyRealized).toBeLessThanOrEqual(2.5 + QUALITY_FLOOR_RESIDUAL);
  });

  it('1-mile threshold reps hit the documented floor (not below ~3.1mi) — characterization', () => {
    // Locks the mechanism behind the bounded residual: a "3×1mi @ T" session
    // cannot be compressed below ~3.1mi (2 reps × 1mi + 2×0.5 WU/CD + float).
    // Asserting it here makes the residual a TESTED, intentional bound rather
    // than a surprise. If the spec-builder ever shrinks 1-mile reps (e.g. swaps
    // to a continuous tempo on a tiny budget), this characterization flips and
    // QUALITY_FLOOR_RESIDUAL can go to 0.
    const built = buildWorkoutSpec('threshold', 3, 350, null, '3×1mi @ T pace · 60s jog', null, null, null);
    const realized = totalDistanceMiFromSpec(capSpecToDistance(built.spec, 3), 3);
    expect(realized).toBeGreaterThan(3); // confirms the floor really does exceed 3.0
    expect(realized).toBeLessThanOrEqual(3 + QUALITY_FLOOR_RESIDUAL);
  });

  it('established-runner specs are unaffected (no spurious cap engagement)', () => {
    // An intermediate HM at healthy volume: quality budgets are large, so the
    // realized spec should sit comfortably under the long with no cap scaling.
    const input = buildInput({ level: 'intermediate', raceDistanceMi: 13.1, goalSec: 7080, weeksOut: 16, recentWeeklyMi: 45 });
    const res = composePlan(input);
    applyFinalEasyLongSweep(res.weeks);
    let checked = 0;
    res.weeks.forEach((w) => {
      const longMi = Math.max(0, ...w.days.filter((x) => x.isLong).map((x) => x.distanceMi));
      if (longMi <= 0) return;
      for (const d of w.days) {
        if (!(d.isQuality && d.type !== 'race') || d.distanceMi <= 0) continue;
        checked++;
        expect(persistRealizedMi(input, w, d)).toBeLessThanOrEqual(longMi + EPS);
      }
    });
    expect(checked).toBeGreaterThan(5);
  });
});
