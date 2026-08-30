/**
 * _restore_continuity.test.ts · CONTINUOUS-RESTORE-1 · no cliff at 70%.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `RampBaseEvidence.lifted` is `0.70 × sustained > mean`. It was a BEHAVIOURAL
 * SWITCH in five places, two of which decided how big the first weeks of a
 * build are:
 *
 *   · `volumeCurve` gated Research/22 §14's three-week restoration on it.
 *   · `composeForUserInternal` gated passing `rampBaseMi` at all on it, so when
 *     it was false the volume curve fell back to the 28-day mean and the whole
 *     RAMPBASE-1 mechanism silently disengaged.
 *
 * So one comparison of two near-identical numbers decided between "restored to
 * full volume in three weeks" and "geometric crawl from a depressed mean", with
 * an infinitely sharp discontinuity at the threshold. A runner at 69% of
 * sustained was restored; a runner at 71% was not. THE FITTER RUNNER GOT THE
 * WORSE PLAN.
 *
 * Live, 2026-08-30: the owner's CIM authoring sat at 70.3% of sustained —
 * 0.1 mi the wrong side — and lost the ladder. The number that pushed him over
 * was the good week he had just run.
 *
 * ── WHAT THIS GATE ASSERTS ──────────────────────────────────────────────────
 *
 * Walk a runner across the boundary in 0.1 mi increments and require that the
 * authored week volumes move CONTINUOUSLY and MONOTONICALLY. Continuity says
 * the cliff is gone; monotonicity says it was not merely relocated — a fitter
 * runner may never receive a smaller plan.
 */
import { describe, it, expect } from 'vitest';
import {
  composePlan,
  resolveRampBase,
  restoreSteps,
  RAMP_BASE_RESUME_FRACTION,
  RESUME_SEQUENCE,
  RESTORE_STEP_FRACTION,
} from './generate';

const SUSTAINED = 45;
/** The old cliff sat exactly here. */
const RESUME_LEVEL = SUSTAINED * RAMP_BASE_RESUME_FRACTION; // 31.5

/**
 * A 16-block history whose rank-3 week is `SUSTAINED` and whose four most
 * recent blocks are all `recentMi` — so the 28-day mean IS `recentMi`, and
 * sweeping it walks the runner straight across the threshold.
 */
function seriesAt(recentMi: number): number[] {
  return [recentMi, recentMi, recentMi, recentMi, 45, 45, 45, 40, 40, 40, 40, 40, 40, 40, 40, 40];
}

function evidenceAt(recentMi: number) {
  return resolveRampBase({
    meanWeeklyMi: recentMi,
    weeklySeries: seriesAt(recentMi),
    allowedInterruptionWeeks: 4,
    peakWeeklyMi: 52.3,
  });
}

/** The CIM shape: a marathon build authored out of a half's recovery. */
function composeAt(recentMi: number) {
  const evidence = evidenceAt(recentMi);
  const r = composePlan({
    raceDistanceMi: 26.2, goalSec: 10800, goalPaceSec: 412,
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level: 'advanced',
    recentWeeklyMi: recentMi, easyDayMedianMi: 6, recentLongMi: 13,
    recentQualityDistanceMi: 8, recentQualityPerWeek: 2, bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0, restDow: 6, qualityDows: [2, 4],
    trainingDaysPerWeek: 6, crossModes: [],
    rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
    tPaceSec: 400, lthr: 162, maxHr: 188,
    rampBaseEvidence: evidence,
    rampBaseMi: evidence.baseMi,
  } as never) as { weeks: Array<{ weeklyMi: number }> };
  return { evidence, vols: r.weeks.slice(0, 3).map((w) => w.weeklyMi) };
}

describe('CONTINUOUS-RESTORE-1 · restoreSteps is doctrine, continuously', () => {
  it('a runner AT 70% of sustained gets Research/22 §14 exactly', () => {
    expect(restoreSteps(RESUME_LEVEL, SUSTAINED))
      .toEqual(RESUME_SEQUENCE.map((f) => Math.round(SUSTAINED * f * 10) / 10));
  });

  it('the step rate is read out of the sequence, not hand-copied', () => {
    expect(RESTORE_STEP_FRACTION).toBeCloseTo(0.15, 10);
    expect(RESUME_SEQUENCE[2] - RESUME_SEQUENCE[1]).toBeCloseTo(RESTORE_STEP_FRACTION, 10);
  });

  it('a runner already at their sustained level has nothing to restore', () => {
    expect(restoreSteps(SUSTAINED, SUSTAINED)).toEqual([]);
    expect(restoreSteps(SUSTAINED + 5, SUSTAINED)).toEqual([]);
  });

  it('a runner at 99% of sustained gets a one-week nudge, not a special case', () => {
    const steps = restoreSteps(SUSTAINED * 0.99, SUSTAINED);
    expect(steps.length).toBe(2);
    expect(steps[steps.length - 1]).toBe(SUSTAINED);
  });

  it('every ladder ends at the sustained level and never steps down', () => {
    for (let pct = 0.70; pct <= 1.0; pct += 0.01) {
      const steps = restoreSteps(SUSTAINED * pct, SUSTAINED);
      if (steps.length === 0) continue;
      expect(steps[steps.length - 1]).toBe(SUSTAINED);
      for (let i = 1; i < steps.length; i++) {
        expect(steps[i], `pct=${pct.toFixed(2)}`).toBeGreaterThan(steps[i - 1]);
      }
    }
  });
});

describe('CONTINUOUS-RESTORE-1 · the base never sits below demonstrated volume', () => {
  it('CURRENTVOL-1 · the owner\'s own numbers · base is his real week, not the lagging mean', () => {
    // sustained 45, resume level 31.5, 28-day mean 31.6 — 0.1 mi the wrong side
    // of the old cliff — while the seven days ending that morning were 34.7.
    const e = resolveRampBase({
      meanWeeklyMi: 31.6,
      weeklySeries: [34.7, 28.4, 23.2, 39.9, 4.2, 47.5, 39.7, 43.3, 0, 27.9, 47.4, 40, 45, 39.8, 40.6, 37.5],
      allowedInterruptionWeeks: 4,
      peakWeeklyMi: 52.3,
    });
    expect(e.sustainedMi).toBe(45);
    expect(e.lifted).toBe(false);          // the old switch is still OFF for him …
    expect(e.heldMi).toBe(34.7);
    expect(e.baseMi).toBe(34.7);           // … and it no longer decides anything
    expect(e.returning).toBe(true);
    expect(restoreSteps(e.baseMi, e.sustainedMi)).toEqual([34.7, 41.5, 45]);
  });

  it('one freak week cannot set the base · bounded by the sustained level', () => {
    const e = resolveRampBase({
      meanWeeklyMi: 20,
      weeklySeries: [80, 10, 10, 10, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20],
      allowedInterruptionWeeks: 4,
    });
    expect(e.heldMi).toBeLessThanOrEqual(e.sustainedMi);
    expect(e.baseMi).toBeLessThanOrEqual(e.sustainedMi);
  });

  it('a genuine layoff still belongs to the comeback protocols', () => {
    const e = resolveRampBase({
      meanWeeklyMi: 4,
      weeklySeries: [0, 0, 2, 3, 5, 6, 8, 40, 44, 47, 40, 43, 45, 41, 39, 42],
      allowedInterruptionWeeks: 4,
    });
    expect(e.lifted).toBe(false);
    expect(e.returning).toBe(false);   // the ladder must not fire here
    expect(e.heldMi).toBe(0);
    expect(e.baseMi).toBe(4);
  });

  it('the base is never below the 28-day mean · the floor only ever adds', () => {
    for (let m = 5; m <= 60; m += 0.5) {
      const e = evidenceAt(m);
      expect(e.baseMi, `mean=${m}`).toBeGreaterThanOrEqual(e.meanMi - 1e-9);
    }
  });
});

describe('CONTINUOUS-RESTORE-1 · no step change across the 70% boundary', () => {
  /**
   * 0.1 mi of input either side of the old cliff. `volumeCurve` rounds weeks to
   * whole miles, so one mile of movement per step is rounding; the defect this
   * catches moved week 1 by about six.
   */
  const STEP_MI = 0.1;
  const MAX_JUMP_MI = 1.5;
  const LO = RESUME_LEVEL - 2.0;   // 29.5
  const HI = RESUME_LEVEL + 2.0;   // 33.5

  const points: Array<{ recentMi: number; lifted: boolean; vols: number[] }> = [];
  for (let m = LO; m <= HI + 1e-9; m += STEP_MI) {
    const recentMi = Math.round(m * 10) / 10;
    const { evidence, vols } = composeAt(recentMi);
    points.push({ recentMi, lifted: evidence.lifted, vols });
  }

  it('the sweep actually crosses the old cliff', () => {
    expect(points.some((p) => p.lifted)).toBe(true);
    expect(points.some((p) => !p.lifted)).toBe(true);
  });

  it('week 1, 2 and 3 volumes are CONTINUOUS across it', () => {
    for (let i = 1; i < points.length; i++) {
      for (let k = 0; k < 3; k++) {
        const jump = Math.abs(points[i].vols[k] - points[i - 1].vols[k]);
        expect(
          jump,
          `week ${k + 1} jumped ${jump.toFixed(1)} mi between recentMi=${points[i - 1].recentMi} ` +
          `(lifted=${points[i - 1].lifted}, vols=${points[i - 1].vols.join('/')}) and ` +
          `recentMi=${points[i].recentMi} (lifted=${points[i].lifted}, vols=${points[i].vols.join('/')})`,
        ).toBeLessThanOrEqual(MAX_JUMP_MI);
      }
    }
  });

  it('a fitter runner never gets a smaller plan', () => {
    for (let i = 1; i < points.length; i++) {
      for (let k = 0; k < 3; k++) {
        expect(
          points[i].vols[k],
          `week ${k + 1} SHRANK as the runner got fitter: recentMi=${points[i - 1].recentMi} ` +
          `→ ${points[i - 1].vols[k]} mi, recentMi=${points[i].recentMi} → ${points[i].vols[k]} mi`,
        ).toBeGreaterThanOrEqual(points[i - 1].vols[k] - 1e-9);
      }
    }
  });
});
