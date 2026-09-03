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

  /* ────────────────────────────────────────────────────────────────────────
   * …AND THE SAME QUESTION ASKED OF EVERY ARCHETYPE, not one fixture.
   *
   * Rule 15: a mechanism the corpus cannot reach is untested. The walk above
   * proves the fix on the block the defect was found in; this proves the CLASS
   * is gone. Sixteen distance × level walks, 134 base-volume points each,
   * measuring every backward step in every week's long run.
   *
   * Two numbers, because they are two different findings:
   *
   *   · CATEGORICAL steps — a drop of MORE than one mile — are the formula
   *     switch, and there must be none. Against the ternary this reports 46 of
   *     them, the worst a THREE-mile collapse (a 10K beginner's week 13 long
   *     falling 9 → 6 for half a mile of reported base), and whole blocks
   *     stepping down together at one input.
   *
   *   · The ratchet counts what is LEFT: 107 single-mile steps, every one of
   *     them in a deload week, and all of them the same arithmetic —
   *     `round(weeklyMi × longCap / peakWeeklyMi)` where the deload week's own
   *     volume was already rounded to a whole mile, so its ratio to the peak
   *     jitters by a mile as the block grows. That is rounding, not a
   *     threshold: there is no branch to fall off and the magnitude is bounded
   *     by the rounding itself. It is named and held rather than excused, so
   *     it can be closed later and can never grow.
   * ──────────────────────────────────────────────────────────────────────── */
  const CORPUS_DISTANCES: Array<readonly [string, number, number]> = [
    ['5k', 3.107, 1200], ['10k', 6.21, 2500], ['hm', 13.1, 5400], ['m', 26.2, 10800],
  ];
  const CORPUS_LEVELS = ['beginner', 'intermediate', 'advanced', 'advanced_plus'] as const;
  /** RATCHET · single-mile deload rounding steps. May shrink, never grow. */
  const LONG_ROUNDING_STEPS_ALLOWED = 107;

  function corpusLongs(distMi: number, goalSec: number, level: string, recentMi: number): number[] {
    const r = composePlan({
      raceDistanceMi: distMi, goalSec, goalPaceSec: Math.round(goalSec / distMi),
      raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level,
      recentWeeklyMi: recentMi, easyDayMedianMi: 5, recentLongMi: Math.min(12, recentMi * 0.3),
      recentQualityDistanceMi: 6, recentQualityPerWeek: 2, bestRecentVdot: 48,
      isMidBlock: true,
      longRunDow: 0, restDow: 6, qualityDows: [2, 4],
      trainingDaysPerWeek: 5, crossModes: [],
      rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
      rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
      tPaceSec: 400, lthr: 162, maxHr: 188,
    } as never) as { weeks: Array<{ isRaceWeek?: boolean; days: Array<{ isLong?: boolean; type: string; distanceMi: number }> }> };
    return r.weeks
      .filter((w) => !w.isRaceWeek)
      .map((w) => Math.max(0, ...w.days.filter((d) => d.isLong && d.type !== 'race').map((d) => d.distanceMi)));
  }

  it('no archetype anywhere loses more than a rounding step of long run', () => {
    const categorical: string[] = [];
    let steps = 0;
    let walks = 0;
    let points = 0;
    for (const [name, mi, goal] of CORPUS_DISTANCES) {
      for (const lvl of CORPUS_LEVELS) {
        walks++;
        let prev: number[] | null = null;
        let prevMi = 0;
        for (let base = 14; base <= 80.001; base += 0.5) {
          let cur: number[];
          try { cur = corpusLongs(mi, goal, lvl, base); } catch { prev = null; continue; }
          points++;
          if (prev) {
            const width = Math.min(prev.length, cur.length);
            for (let k = 0; k < width; k++) {
              const drop = prev[k] - cur[k];
              if (drop <= 1e-9) continue;
              steps++;
              if (drop > 1.0001) {
                categorical.push(
                  `${name}/${lvl} wk${k + 1} long ${prev[k]} → ${cur[k]} mi (−${drop.toFixed(1)}) ` +
                  `as the base went ${prevMi} → ${base} mi/wk`,
                );
              }
            }
          }
          prev = cur;
          prevMi = base;
        }
      }
    }
    // Liveness · a sweep that composed nothing reports clean, which is the
    // worst outcome available (Rule 18 clause 2).
    expect(walks, 'the corpus sweep walked no archetypes').toBe(CORPUS_DISTANCES.length * CORPUS_LEVELS.length);
    expect(points, 'the corpus sweep composed no plans').toBeGreaterThan(2000);
    for (const s of categorical.slice(0, 20)) console.log(`  CATEGORICAL ${s}`);
    console.log(
      `\nLONGSIZE corpus · ${walks} walks · ${points} plans · ${steps} backward steps, ` +
      `${categorical.length} of them larger than a rounding step`,
    );
    expect(
      categorical.length,
      `${categorical.length} archetype(s) lose MORE than a mile of long run for half a mile of ` +
      'reported base. That is a formula switching, not rounding — see CATEGORICAL above',
    ).toBe(0);
    expect(
      steps,
      `the deload-week rounding residual grew from ${LONG_ROUNDING_STEPS_ALLOWED} to ${steps}. ` +
      'This ratchet may shrink and never grow: something has added a new backward step to the ' +
      'long-run curve',
    ).toBeLessThanOrEqual(LONG_ROUNDING_STEPS_ALLOWED);
  }, 300_000);
});

/* ══════════════════════════════════════════════════════════════════════════
 * LADDER-LENGTH-1 (2026-09-02) · Rule 9 · the return ladder's LENGTH.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * `restoreSteps` walked `v += stepMi` and asked `v < sustainedMi - 1e-9` each
 * time round, so it emitted a rung whenever the last full doctrine step landed
 * a hair short of the sustained level. `volumeCurve` spends one plan week per
 * rung and starts its geometric climb after them, so a rung worth a tenth of a
 * mile cost a whole climbing week.
 *
 * MEASURED on the owner's real CIM block, 2026-09-02, walking his demonstrated
 * volume in 0.02 mi increments (sustained 46.4, base 34.2):
 *
 *   held 32.44 -> ladder [39.4, 46.3, 46.4] -> block 662.5 mi -> wk4 = 42.0
 *   held 32.46 -> ladder [39.5, 46.4]       -> block 672.0 mi -> wk4 = 47.5
 *
 * 9.5 mi of block total and 5.5 mi on one authored week, for two hundredths of
 * a mile of history — and 46.3 and 46.4 author the same whole week, 46.
 *
 * AND THE BOUNDARY WAS DOCTRINE'S OWN NUMBER. `first` is
 * `max(start, held + step)` with `start` floored at 0.70 x sustained, so
 * `ceil`'s boundary sits at `held == 0.70 x sustained` — `Research/22` §14's
 * resume level and `Research/00b`'s reverse-taper level, which is to say the
 * level this engine's own recovery blocks prescribe — and equivalently at
 * `start == 0.85 x sustained`, which is `RESUME_SEQUENCE[1]`. Two of doctrine's
 * three published rungs sat ON the threshold.
 *
 * ── WHAT THIS GATE ASSERTS ─────────────────────────────────────────────────
 *
 * Walk the demonstrated volume across the old boundary and require the LADDER
 * LENGTH not to change and the composed block not to step. Falsified against
 * the unfixed loop before landing (see the numbers above).
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · The residual boundary. The count is still discrete and still moves, now at
 *   `first == 0.775 x sustained`; this walk does not cover it, deliberately —
 *   its whole claim is that the boundary is no longer where doctrine parks
 *   runners, not that it is gone. Measured there on the same block: 14.5 mi.
 * · The 0.1 mi quantisation of `heldMi` itself, which moves an authored week by
 *   up to a mile. That is the engine's own output resolution, it is monotone,
 *   and MAX_TOTAL_STEP_MI admits it.
 * · Any runner the ladder never reaches: `returning` false, no history, or an
 *   interruption past the allowance. Those go to the comeback protocols and
 *   this file says nothing about them.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('LADDER-LENGTH-1 · the ladder does not gain a week for a tenth of a mile', () => {
  it('Research/22 §14 is exact, and now sits in the middle of its basin', () => {
    // Entry at the resume level with nothing held: doctrine's own row, and the
    // gap is exactly two steps. Under `ceil` that was one ULP from a third rung.
    expect(restoreSteps(RESUME_LEVEL, SUSTAINED, 0))
      .toEqual(RESUME_SEQUENCE.map((f) => Math.round(SUSTAINED * f * 10) / 10));
    // A hair either side of doctrine's own case returns the same LENGTH.
    for (const eps of [-0.05, -0.01, 0, 0.01, 0.05]) {
      expect(
        restoreSteps(RESUME_LEVEL + eps, SUSTAINED, 0).length,
        `the ladder changed length ${eps} mi from doctrine's own entry rung`,
      ).toBe(RESUME_SEQUENCE.length);
    }
  });

  it('a ladder of more than one step spends no week on a vestigial rung', () => {
    // The old loop's signature: [39.4, 46.3, 46.4] — two steps after the entry
    // rung, of which the second moved the runner 0.1 mi and authored the same
    // whole week (46) as the one before it. Even division makes every step of a
    // multi-step ladder at least 0.75 of a doctrine step by construction.
    //
    // HONEST SCOPE, and it is why this reads `s.length > 2`: a ladder of ONE
    // step is the arrival, and for a runner already within a step of sustained
    // that arrival is legitimately small (held 37.7 of a 45 sustained gives
    // [44.5, 45]). That is `Research/22` §14's one-week nudge, it predates this
    // change, and it is unchanged by it — the defect was a SPARE rung, not a
    // short final one.
    const MIN_STEP_MI = SUSTAINED * RESTORE_STEP_FRACTION * 0.5;
    for (let h = 0; h <= SUSTAINED; h += 0.1) {
      const held = Math.round(h * 10) / 10;
      const s = restoreSteps(Math.max(RESUME_LEVEL, held), SUSTAINED, held);
      if (s.length <= 2) continue;
      for (let i = 1; i < s.length; i++) {
        expect(
          s[i] - s[i - 1],
          `held=${held.toFixed(1)} · ladder ${JSON.stringify(s)} spends a plan week moving the ` +
          `runner from ${s[i - 1]} to ${s[i]} — less than half of doctrine's own ` +
          `${(SUSTAINED * RESTORE_STEP_FRACTION).toFixed(2)} mi step`,
        ).toBeGreaterThanOrEqual(MIN_STEP_MI);
      }
    }
  });

  it('the ladder LENGTH is continuous across the old `ceil` boundary', () => {
    // held == 0.70 x sustained is where the old boundary sat.
    let prev: number | null = null;
    const flips: string[] = [];
    for (let h = RESUME_LEVEL - 1.5; h <= RESUME_LEVEL + 1.5 + 1e-9; h += 0.02) {
      const held = Math.round(h * 10) / 10;            // the engine's own resolution
      const start = Math.max(33, RESUME_LEVEL, held);  // baseMi, mean pinned above the lift
      const n = restoreSteps(start, SUSTAINED, held).length;
      if (prev != null && n !== prev) flips.push(`${held} (${prev} -> ${n} rungs)`);
      prev = n;
    }
    expect(
      flips,
      `the ladder changed length inside a 3 mi neighbourhood of doctrine's own resume level ` +
      `(${RESUME_LEVEL} mi): ${flips.join(', ')}. Against the unfixed loop this reports a flip at ` +
      '31.5 — 2 rungs at or above the resume level, 3 rungs a tenth below it',
    ).toEqual([]);
  });

  it('the composed block does not step across it either', () => {
    /** The CIM shape, with the 28-day mean PINNED so only the demonstrated
     *  volume moves — the axis the defect actually lives on. */
    function blockAt(heldMi: number) {
      const series = [heldMi, heldMi, 45, 45, 45, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40];
      const evidence = resolveRampBase({
        meanWeeklyMi: 33, weeklySeries: series, allowedInterruptionWeeks: 4, peakWeeklyMi: 52.3,
      });
      const r = composePlan({
        raceDistanceMi: 26.2, goalSec: 10800, goalPaceSec: 412,
        raceDateISO: '2026-12-06', startMondayISO: '2026-08-31', level: 'advanced',
        recentWeeklyMi: 33, easyDayMedianMi: 6, recentLongMi: 13,
        recentQualityDistanceMi: 8, recentQualityPerWeek: 2, bestRecentVdot: 48,
        isMidBlock: true,
        longRunDow: 0, restDow: 6, qualityDows: [2, 4],
        trainingDaysPerWeek: 6, crossModes: [],
        rxQuality: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
        rxRaceSpecific: { threshold: '4×1mi @ T pace · 60s jog', intervals: '5×3 min @ I pace · 90s jog', tempo: 'continuous tempo', families: {} },
        tPaceSec: 400, lthr: 162, maxHr: 188,
        rampBaseEvidence: evidence, rampBaseMi: evidence.baseMi,
      } as never) as { vols: number[] };
      return { vols: r.vols, total: Math.round(r.vols.reduce((a, b) => a + b, 0) * 10) / 10 };
    }

    // One authored mile per week is the engine's own rounding; the block-total
    // ceiling admits that on the weeks the ladder actually touches. The 9.5 mi
    // the old loop produced is far outside it.
    const MAX_TOTAL_STEP_MI = 3.0;
    const MAX_WEEK_STEP_MI = 1.5;
    const walk: Array<{ held: number; vols: number[]; total: number }> = [];
    for (let h = RESUME_LEVEL - 1.5; h <= RESUME_LEVEL + 1.5 + 1e-9; h += 0.02) {
      const held = Math.round(h * 100) / 100;
      walk.push({ held, ...blockAt(held) });
    }
    // Liveness · a walk that composed nothing reports clean (Rule 18 clause 2).
    expect(walk.length, 'the walk composed nothing').toBeGreaterThan(100);
    expect(
      new Set(walk.map((w) => w.total)).size,
      'the walk produced one constant block — it is not reaching the ladder at all',
    ).toBeGreaterThan(1);

    for (let i = 1; i < walk.length; i++) {
      const d = Math.abs(walk[i].total - walk[i - 1].total);
      expect(
        d,
        `block total stepped ${d.toFixed(1)} mi between held=${walk[i - 1].held} ` +
        `(${walk[i - 1].total} mi) and held=${walk[i].held} (${walk[i].total} mi). ` +
        'Against the unfixed loop this reports 9.5 mi at the resume level, where the ladder ' +
        'gains a rung worth a tenth of a mile and the climb loses a week',
      ).toBeLessThanOrEqual(MAX_TOTAL_STEP_MI);
      const width = Math.min(walk[i].vols.length, walk[i - 1].vols.length);
      for (let k = 0; k < width; k++) {
        const dw = Math.abs(walk[i].vols[k] - walk[i - 1].vols[k]);
        expect(
          dw,
          `week ${k + 1} stepped ${dw.toFixed(1)} mi between held=${walk[i - 1].held} and ` +
          `held=${walk[i].held} · ${walk[i - 1].vols.join('/')} -> ${walk[i].vols.join('/')}`,
        ).toBeLessThanOrEqual(MAX_WEEK_STEP_MI);
      }
    }
  }, 120_000);
});

/* ══════════════════════════════════════════════════════════════════════════
 * LIFTEDBASE-CONTINUOUS-1 (2026-09-02) · Rule 9 · `lifted` selected an arm of
 * a maximum, and the two arms rounded differently.
 *
 * `lifted` is `resumeLevel > mean`, so `lifted ? resumeLevel : mean` IS
 * `max(resumeLevel, mean)` — but the lifted arm rounded to a tenth and the
 * other did not, so `baseMi` stepped DOWN by up to 0.05 mi at the crossing and
 * straight back up. Measured 2026-09-02 on a runner where it can bind
 * (sustained 46.4, demonstrated volume 10): mean 32.46 -> a 649.5 mi block,
 * mean 32.48 -> 648.0, mean 32.50 -> 649.5. Out and back, one authored mile,
 * for four hundredths of a mile of input.
 *
 * CANNOT FAIL ON (Rule 22): a runner whose demonstrated volume floors the base
 * above both arms — which is the reference runner, for whom the whole switch is
 * inert. That is measured separately and is exactly why this walk pins the
 * demonstrated volume low.
 * ══════════════════════════════════════════════════════════════════════════ */
describe('LIFTEDBASE-CONTINUOUS-1 · the base is monotone through the lift', () => {
  /**
   * The fixture has to be CHOSEN, not assumed — this is where the first draft
   * of this gate was wrong and reported clean against the unfixed branch.
   *
   * The defect's size is `round1(resumeLevel) - resumeLevel`, so it is INVISIBLE
   * for a sustained level whose 70% already lands on a tenth. `SUSTAINED = 45`
   * gives 31.4999…, which rounds to 31.5, a difference of 4e-15 — the walk
   * crossed the lift and measured nothing. Both sustained levels below are
   * picked so 70% of them sits mid-tenth, one rounding each way:
   *
   *   46.4 -> 32.48, rounds UP   -> the base STEPS DOWN at the crossing
   *   44.9 -> 31.43, rounds DOWN -> the base sits BELOW the 28-day mean
   */
  for (const sustained of [46.4, 44.9]) {
    const rl = sustained * RAMP_BASE_RESUME_FRACTION;
    it(`baseMi is monotone and never below the mean · sustained ${sustained}`, () => {
      // Demonstrated volume pinned LOW so nothing else can mask the arm selected.
      const series = [10, 10, sustained, sustained, sustained, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40];
      let prev = -Infinity;
      let sawLifted = false;
      let sawUnlifted = false;
      for (let m = rl - 0.4; m <= rl + 0.4 + 1e-9; m += 0.005) {
        const mean = Math.round(m * 1000) / 1000;
        const e = resolveRampBase({
          meanWeeklyMi: mean, weeklySeries: series, allowedInterruptionWeeks: 4,
        });
        if (e.lifted) sawLifted = true; else sawUnlifted = true;
        expect(
          e.baseMi,
          `baseMi FELL from ${prev} to ${e.baseMi} as the 28-day mean ROSE to ${mean} ` +
          `(lifted=${e.lifted}). Against the unfixed branch this reports the drop at ` +
          `${rl.toFixed(3)}, where the rounded resume level hands over to the raw mean`,
        ).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(
          e.baseMi,
          `baseMi ${e.baseMi} is BELOW the 28-day mean ${mean} (lifted=${e.lifted}). The lifted ` +
          'arm rounded the resume level DOWN past the mean it was supposed to beat',
        ).toBeGreaterThanOrEqual(mean - 1e-9);
        prev = e.baseMi;
      }
      expect(sawLifted && sawUnlifted, 'the walk never crossed the lift — it asserts nothing')
        .toBe(true);
    });
  }
});
