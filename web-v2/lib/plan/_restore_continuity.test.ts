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
  it('a runner AT 70% of sustained, coming back from NOT running, gets Research/22 §14 exactly', () => {
    // ENTRY-CONTINUOUS-1 · "coming back from NOT running" is now stated as the
    // demonstrated volume it always meant: nothing held.
    expect(restoreSteps(RESUME_LEVEL, SUSTAINED, 0))
      .toEqual(RESUME_SEQUENCE.map((f) => Math.round(SUSTAINED * f * 10) / 10));
  });

  it('POSTRACE-RESTORE-1 · a runner who never stopped does not re-run the week he just ran', () => {
    // §14's first rung is the week a runner spends coming BACK from not
    // running. Someone who ran through their post-race window has just spent
    // it, and Research/00b — the protocol that actually governs a post-race
    // runner — restores far faster (30-40% -> 50-60% -> 70-80% of peak).
    //
    // ENTRY-CONTINUOUS-1 (2026-08-30) · this used to be a BOOLEAN third
    // argument, and the boolean was the last cliff in the ladder: it was
    // `heldMi >= baseMi`, so a runner holding a hundredth of a mile less than
    // the re-entry level repeated it and one holding a hundredth more skipped
    // it, a whole `RESTORE_STEP_FRACTION` of sustained apart. The argument is
    // now the demonstrated volume itself and both of these cases still fall
    // out of it — a runner coming back from NOT running holds nothing, and one
    // who ran through holds the base.
    const spent = restoreSteps(RESUME_LEVEL, SUSTAINED, RESUME_LEVEL);
    const fresh = restoreSteps(RESUME_LEVEL, SUSTAINED, 0);
    expect(spent).toEqual(fresh.slice(1));
    expect(spent[0]).toBeGreaterThan(RESUME_LEVEL);
    // Both still arrive at the sustained level.
    expect(spent[spent.length - 1]).toBe(SUSTAINED);
  });

  it('ENTRY-CONTINUOUS-1 · the entry rung moves with the runner, it does not flip', () => {
    // Walk the demonstrated volume across the re-entry level in hundredths and
    // require the first authored week to move continuously and monotonically.
    // Against the boolean this fails at the crossing with a 6.75 mi step —
    // falsified that way before landing, per Rule 18.
    const STEP_MI = SUSTAINED * 0.15;
    let prev = -Infinity;
    for (let held = RESUME_LEVEL - 2 * STEP_MI; held <= RESUME_LEVEL + 1e-9; held += 0.01) {
      // `baseMi` is `max(mean, resumeLevel, heldMi)`, so at or below the
      // re-entry level the start IS the re-entry level.
      const first = restoreSteps(RESUME_LEVEL, SUSTAINED, held)[0];
      expect(first, `held=${held.toFixed(2)}`).toBeGreaterThanOrEqual(prev - 1e-9);
      if (Number.isFinite(prev)) {
        expect(
          first - prev,
          `the entry rung jumps ${(first - prev).toFixed(2)} mi for 0.01 mi of demonstrated ` +
          `volume at held=${held.toFixed(2)} · the boolean is back`,
        ).toBeLessThan(0.2);
      }
      prev = first;
    }
    // And the two ends are still doctrine: nothing held → §14's re-entry week;
    // holding the level → one step above it.
    expect(restoreSteps(RESUME_LEVEL, SUSTAINED, 0)[0]).toBe(Math.round(RESUME_LEVEL * 10) / 10);
    expect(restoreSteps(RESUME_LEVEL, SUSTAINED, RESUME_LEVEL)[0])
      .toBe(Math.round((RESUME_LEVEL + STEP_MI) * 10) / 10);
  });

  it('the step rate is read out of the sequence, not hand-copied', () => {
    expect(RESTORE_STEP_FRACTION).toBeCloseTo(0.15, 10);
    expect(RESUME_SEQUENCE[2] - RESUME_SEQUENCE[1]).toBeCloseTo(RESTORE_STEP_FRACTION, 10);
  });

  it('a runner already at their sustained level has nothing to restore', () => {
    expect(restoreSteps(SUSTAINED, SUSTAINED, 0)).toEqual([]);
    expect(restoreSteps(SUSTAINED + 5, SUSTAINED, SUSTAINED + 5)).toEqual([]);
  });

  it('a runner at 99% of sustained gets a one-week nudge, not a special case', () => {
    const steps = restoreSteps(SUSTAINED * 0.99, SUSTAINED, 0);
    expect(steps.length).toBe(2);
    expect(steps[steps.length - 1]).toBe(SUSTAINED);
  });

  it('every ladder ends at the sustained level and never steps down', () => {
    for (let pct = 0.70; pct <= 1.0; pct += 0.01) {
      const start = SUSTAINED * pct;
      // Both ends of the entry question: nothing demonstrated, and holding the
      // start level. Everything between is a straight line between the two.
      for (const held of [0, start]) {
        const steps = restoreSteps(start, SUSTAINED, held);
        if (steps.length === 0) continue;
        expect(steps[steps.length - 1], `pct=${pct.toFixed(2)} held=${held.toFixed(1)}`).toBe(SUSTAINED);
        for (let i = 1; i < steps.length; i++) {
          expect(steps[i], `pct=${pct.toFixed(2)} held=${held.toFixed(1)}`).toBeGreaterThan(steps[i - 1]);
        }
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
    // He ran that 34.7 · the re-entry rung is behind him, so the build's first
    // week steps UP rather than repeating the recovery week it replaces.
    expect(e.heldByCurrent).toBe(true);
    expect(restoreSteps(e.baseMi, e.sustainedMi, e.heldMi)).toEqual([41.5, 45]);
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
   * 0.1 mi of input either side of the old cliff.
   *
   * THE BOUND. `volumeCurve` rounds weeks to whole miles, so a mile of movement
   * is rounding. The ceiling is ONE restoration step, because that is the
   * largest jump the ladder can legitimately produce: crossing the level at
   * which the runner has demonstrably already spent the re-entry week
   * (POSTRACE-RESTORE-1) drops the ladder's leading rung, which advances each
   * later week by exactly one step. That boundary is a real change in the
   * runner's situation — has he been running at this volume or not — and both
   * sides still arrive at the same sustained level, one week apart.
   *
   * What it still catches is the defect it was written for: the old
   * `lifted` switch turned the entire ladder ON and OFF, so week 2 fell from
   * 38 to 36 and week 3 from 45 to 41 as the runner got FITTER. Monotonicity
   * below is the assertion that names that directly.
   */
  const STEP_MI = 0.1;
  const MAX_JUMP_MI = SUSTAINED * RESTORE_STEP_FRACTION + 1.0;
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

/* ══════════════════════════════════════════════════════════════════════════
 * LONGSIZE-CONTINUOUS-1 (2026-08-30) · Rule 9 · the long run is a session,
 * not a formula choice.
 *
 * The 5k/10k/hm long-run sizer picked between two DIFFERENT formulas on
 * `round(peakWeeklyMi × longShare) < peakLongMiBand[0]`, and the branch it
 * left on crossing was always the smaller of the two — so a runner whose block
 * peaks slightly HIGHER was handed a slightly SHORTER long run. Rule 9 calls
 * that the fitter runner getting the worse plan, and here it lands on the one
 * session a distance block is built around.
 *
 * The walk moves the block's base through the whole neighbourhood of the old
 * threshold and requires every week's long run to move monotonically with it.
 * Falsified against the branch before landing: with the ternary restored it
 * reports the step and the base it happened at.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('LONGSIZE-CONTINUOUS-1 · more volume never buys a shorter long run', () => {
  /** A half-marathon block, the shape the old branch was written for (RC2-2:
   *  an advanced HM at a 0.25 share reaches only 14 against a band floor of
   *  15). The block's peak is walked by moving the reported base. */
  function longsAt(recentMi: number): number[] {
    const r = composePlan({
      raceDistanceMi: 13.1, goalSec: 5400, goalPaceSec: 412,
      raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level: 'advanced',
      recentWeeklyMi: recentMi, easyDayMedianMi: 6, recentLongMi: 12,
      recentQualityDistanceMi: 8, recentQualityPerWeek: 2, bestRecentVdot: 48,
      isMidBlock: true,
      longRunDow: 0, restDow: 6, qualityDows: [2, 4],
      trainingDaysPerWeek: 6, crossModes: [],
      rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
      rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
      tPaceSec: 400, lthr: 162, maxHr: 188,
    } as never) as { weeks: Array<{ isRaceWeek?: boolean; days: Array<{ isLong?: boolean; type: string; distanceMi: number }> }> };
    return r.weeks
      .filter((w) => !w.isRaceWeek)
      .map((w) => Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
  }

  it('the long run never SHRINKS as the block gets bigger', () => {
    const walk: Array<{ mi: number; longs: number[] }> = [];
    for (let mi = 26; mi <= 72.001; mi += 0.5) {
      walk.push({ mi: Math.round(mi * 10) / 10, longs: longsAt(mi) });
    }
    expect(walk.length, 'the walk composed nothing').toBeGreaterThan(20);
    const width = Math.min(...walk.map((w) => w.longs.length));
    expect(width, 'the walk produced no comparable weeks').toBeGreaterThan(3);
    for (let i = 1; i < walk.length; i++) {
      for (let k = 0; k < width; k++) {
        expect(
          walk[i].longs[k],
          `week ${k + 1}'s long run SHRANK from ${walk[i - 1].longs[k]}mi to ${walk[i].longs[k]}mi ` +
          `when the runner's base went ${walk[i - 1].mi} → ${walk[i].mi} mi/wk. Two formulas with a ` +
          'threshold between them — `max(share, driven)` on one side and `share` alone on the ' +
          'other — and a max is never the smaller of the two it chose between',
        ).toBeGreaterThanOrEqual(walk[i - 1].longs[k] - 1e-9);
      }
    }
  }, 120_000);
});
