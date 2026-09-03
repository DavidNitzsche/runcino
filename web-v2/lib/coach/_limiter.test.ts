/**
 * Limiter diagnosis · doctrine tests.
 *
 * These encode `Design/adaptive-progression-engine.md` §11 and the specific
 * claims about what each signal can and cannot distinguish, so a regression
 * fails with the rule it broke rather than with a number that moved.
 *
 * The case that matters most is the last one: a wrong limiter sends the whole
 * prescription down the wrong road for a block, so several tests here assert
 * that the module DECLINES to be confident rather than that it produces an
 * answer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  diagnoseLimiter,
  CURVE_NEUTRAL_EXPONENT_BAND,
  DECOUPLING_ENDURANCE_GAP_PCT,
  DECOUPLING_HEAT_ARTIFACT_PCT,
  HARD_DAY_GAP_DAYS,
  INCOMPLETE_RECOVERY_WORKOUTS,
  DEFAULT_LIMITER,
  LEVERS,
  type LimiterInput,
} from './limiter';
import { composeWhatClosesIt } from '@/lib/plan/goal-gap';
import {
  computeAerobicDecoupling,
  DECOUPLING_PROTOCOL_MIN_MINUTES,
} from '@/lib/training/aerobic-decoupling';

/** A runner with a goal and nothing else visible. Tests add one signal at a time. */
function blank(goalDistanceMi = 26.2, goalPaceSecPerMi: number | null = 412): LimiterInput {
  return {
    goalDistanceMi,
    goalPaceSecPerMi,
    experienceLevel: 'advanced',
    blockProgressFraction: null,
    curve: null,
    fadeObservations: null,
    thresholdPaceStartSecPerMi: null,
    thresholdPaceNowSecPerMi: null,
    thresholdWindowWeeks: null,
    weeklyMiAtWindowStart: null,
    recentWeeklyMi: null,
    observedHardDayGaps: null,
    sessionsMissingPacesInARow: null,
  };
}

/** The canonical durability read's curve at exponent `b`. */
function curveAt(b: number): LimiterInput['curve'] {
  return { exponent: b, races: 2, provisional: false };
}

describe('the curve is READ from the canonical durability anchor, never fitted here', () => {
  it('limiter.ts carries no Riegel fit of its own (2026-09-01 · one exponent engine)', () => {
    const src = readFileSync(join(__dirname, 'limiter.ts'), 'utf8');
    expect(src).not.toMatch(/fitRiegelExponent|pickCurvePair|MIN_CURVE_DISTANCE_RATIO|CURVE_FRESHNESS_DAYS/);
    expect(src).not.toMatch(/Math\.log\([^)]*finishSeconds/);
  });
  it('no curve read → no shape finding', () => {
    const r = diagnoseLimiter({ ...blank(), curve: null })!;
    expect(r.ranked.find((x) => x.evidence.some((e) => /curve/i.test(e)))).toBeUndefined();
  });
});

describe('each limiter fires from its characteristic evidence', () => {
  it('endurance · a curve steeper than doctrine\'s neutral band', () => {
    const r = diagnoseLimiter({ ...blank(), curve: curveAt(1.14) })!;
    expect(r.primary).toBe('endurance');
    expect(r.levers[0]).toMatch(/long-run duration/i);
  });

  it('endurance · aerobic decoupling in the band doctrine calls an endurance gap', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 18, lateFadeSecPerMi: null, decouplingPct: DECOUPLING_ENDURANCE_GAP_PCT + 2, cadence: null },
        { distanceMi: 20, lateFadeSecPerMi: null, decouplingPct: DECOUPLING_ENDURANCE_GAP_PCT + 3, cadence: null },
      ],
    })!;
    expect(r.primary).toBe('endurance');
  });

  it('speed_reserve · a curve flatter than doctrine\'s neutral band', () => {
    const r = diagnoseLimiter({ ...blank(), curve: curveAt(1.01) })!;
    expect(r.primary).toBe('speed_reserve');
    expect(r.levers[0]).toMatch(/strides/i);
  });

  it('durability · late fade with the aerobic system intact and cadence breaking', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 20, lateFadeSecPerMi: 22, decouplingPct: 4, cadence: 'breaking' },
        { distanceMi: 18, lateFadeSecPerMi: 15, decouplingPct: 3, cadence: 'fading' },
      ],
    })!;
    expect(r.primary).toBe('durability');
    // Duration before the pace demand · §2's cheapest-adaptation-first order.
    expect(r.levers[0]).toMatch(/duration/i);
    expect(r.levers[r.levers.length - 1]).toMatch(/race-pace/i);
  });

  it('threshold · pace stagnant across a block while volume climbed', () => {
    const r = diagnoseLimiter({
      ...blank(),
      thresholdPaceStartSecPerMi: 400,
      thresholdPaceNowSecPerMi: 402,
      thresholdWindowWeeks: 8,
      weeklyMiAtWindowStart: 40,
      recentWeeklyMi: 70,
    })!;
    expect(r.primary).toBe('threshold');
    // The §11 progression · duration first, pace last.
    expect(r.levers[0]).toMatch(/duration/i);
    expect(r.levers[r.levers.length - 1]).toMatch(/pace/i);
  });

  it('training_volume · running under the band the plan is built to', () => {
    const r = diagnoseLimiter({ ...blank(), recentWeeklyMi: 28, blockProgressFraction: 0.8 })!;
    expect(r.primary).toBe('training_volume');
    expect(r.levers[0]).toMatch(/frequency/i);
  });

  it('training_volume does NOT fire early in a block · being under peak is the plan working', () => {
    const r = diagnoseLimiter({ ...blank(), recentWeeklyMi: 55, blockProgressFraction: 0.15 })!;
    expect(r.ranked.find((x) => x.limiter === 'training_volume')).toBeUndefined();
  });

  it('recovery_capacity · consistently needing longer than doctrine\'s hard-day gap', () => {
    const r = diagnoseLimiter({
      ...blank(),
      observedHardDayGaps: [
        { stimulus: 'vo2max', daysTaken: HARD_DAY_GAP_DAYS.vo2max + 3 },
        { stimulus: 'threshold', daysTaken: HARD_DAY_GAP_DAYS.threshold + 2 },
      ],
    })!;
    expect(r.primary).toBe('recovery_capacity');
    expect(r.levers[0]).toMatch(/gap between hard days/i);
  });

  it('recovery_capacity · doctrine\'s strongest single performance indicator', () => {
    const r = diagnoseLimiter({ ...blank(), sessionsMissingPacesInARow: INCOMPLETE_RECOVERY_WORKOUTS })!;
    expect(r.primary).toBe('recovery_capacity');
  });

  it('one missed session is not a limiter · doctrine requires two', () => {
    const r = diagnoseLimiter({ ...blank(), sessionsMissingPacesInARow: INCOMPLETE_RECOVERY_WORKOUTS - 1 })!;
    expect(r.ranked.find((x) => x.limiter === 'recovery_capacity')).toBeUndefined();
  });

  it('aerobic_capacity is the default for the events doctrine says it dominates', () => {
    for (const [mi, cat] of [[3.1, '5k'], [6.2, '10k']] as const) {
      const r = diagnoseLimiter(blank(mi, 330))!;
      expect(r.primary).toBe(DEFAULT_LIMITER[cat]);
      expect(r.primary).toBe('aerobic_capacity');
    }
  });

  it('aerobic_capacity is never diagnosed from evidence, only defaulted', () => {
    // It is not separable from `threshold` with this app's data, so no signal
    // path may ever produce it as an evidence-backed finding.
    const loaded = diagnoseLimiter({
      ...blank(3.1, 330),
      curve: curveAt(1.14),
      fadeObservations: [{ distanceMi: 10, lateFadeSecPerMi: 20, decouplingPct: 12, cadence: 'breaking' }],
      recentWeeklyMi: 12,
      blockProgressFraction: 0.9,
      sessionsMissingPacesInARow: 3,
    })!;
    expect(loaded.ranked.find((x) => x.limiter === 'aerobic_capacity')).toBeUndefined();
  });
});

describe('a flat curve is a real finding, not a failure', () => {
  it('a runner whose curve tracks the reference gets the goal-distance default at low confidence', () => {
    const mid = (CURVE_NEUTRAL_EXPONENT_BAND[0] + CURVE_NEUTRAL_EXPONENT_BAND[1]) / 2;
    const r = diagnoseLimiter({ ...blank(), curve: curveAt(mid) })!;
    expect(r.ranked).toEqual([]);
    expect(r.primary).toBe('threshold'); // marathon · doctrine says LT2 dominates
    expect(r.confidence).not.toBe('high');
    expect(r.levers).toEqual(LEVERS.threshold);
  });

  it('a runner we cannot see at all gets the default and says so', () => {
    const r = diagnoseLimiter(blank())!;
    expect(r.confidence).toBe('low');
    expect(r.ranked).toEqual([]);
    expect(r.summary).toMatch(/not enough evidence/i);
  });

  it('no goal means no diagnosis', () => {
    expect(diagnoseLimiter({ ...blank(), goalDistanceMi: null })).toBeNull();
  });
});

describe('ambiguous evidence must not produce false confidence', () => {
  it('a late fade with no HR is consistent with endurance AND durability · both rank, confidence falls', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 20, lateFadeSecPerMi: 25, decouplingPct: null, cadence: 'breaking' },
        { distanceMi: 18, lateFadeSecPerMi: 18, decouplingPct: null, cadence: 'fading' },
      ],
    })!;
    const named = r.ranked.map((x) => x.limiter);
    expect(named).toContain('durability');
    expect(named).toContain('endurance');
    expect(r.confidence).not.toBe('high');
  });

  it('two limiters neck and neck read as low confidence whatever the ordering', () => {
    // Under-volumed AND missing paces · doctrine's own note that these are
    // entangled (a runner who cannot recover cannot carry volume) shows up here
    // as two findings of near-identical strength. Neither may win by rounding.
    // TIEREVIDENCE-2 (2026-09-02) · 50 -> 32 mi/wk, because the BAR moved and
    // this case is about a runner who is under it. `classifyGoalTier` no longer
    // takes `experienceLevel`, so the volume bar is `TIER_TARGETS.m` at the row
    // the runner's EVIDENCE earns — `intermediate`'s 45 mi/wk floor with
    // nothing demonstrated — rather than `advanced`'s 65, which the fixture was
    // only reaching because `blank()` types 'advanced'. At 50 mi/wk this runner
    // is now ABOVE the bar the plan is actually built to, which is the
    // limiter's own promise about what the bar means, so the fixture states the
    // shortfall it is testing instead of inheriting it from a label. 32 is the
    // volume at which the two findings are again within a tenth of each other,
    // which is the property under test — that neither wins by rounding.
    const r = diagnoseLimiter({
      ...blank(),
      recentWeeklyMi: 32,
      blockProgressFraction: 0.8,
      sessionsMissingPacesInARow: 2,
    })!;
    const named = r.ranked.map((x) => x.limiter);
    expect(named).toContain('training_volume');
    expect(named).toContain('recovery_capacity');
    expect(r.ranked[0].severity - r.ranked[1].severity).toBeLessThan(0.1);
    expect(r.confidence).toBe('low');
    expect(r.summary).toMatch(/rather than a settled answer/i);
  });

  it('a fade on a confounded course is the terrain, not the runner', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 20, lateFadeSecPerMi: 40, decouplingPct: 4, cadence: 'breaking', courseConfounded: true },
      ],
    })!;
    expect(r.ranked.find((x) => x.limiter === 'durability')).toBeUndefined();
  });

  it('a bare fade with nothing attached accuses no one', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [{ distanceMi: 20, lateFadeSecPerMi: 30, decouplingPct: null, cadence: null }],
    })!;
    expect(r.ranked).toEqual([]);
  });
});

describe('per-observation context filters · CLAUDE.md, locked 2026-05-19 round 4', () => {
  it('decoupling in heat must clear the threshold by the artifact doctrine states', () => {
    const justOver = DECOUPLING_ENDURANCE_GAP_PCT + 1; // over the threshold, inside the heat artifact
    const cool = diagnoseLimiter({
      ...blank(),
      fadeObservations: [{ distanceMi: 18, lateFadeSecPerMi: null, decouplingPct: justOver, cadence: null }],
    })!;
    expect(cool.ranked.find((x) => x.limiter === 'endurance')).toBeDefined();

    const hot = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 18, lateFadeSecPerMi: null, decouplingPct: justOver, cadence: null, heatConfounded: true },
      ],
    })!;
    expect(hot.ranked.find((x) => x.limiter === 'endurance')).toBeUndefined();
  });

  it('a hot-day reading past the artifact still counts · the filter is not a blanket suppression', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        {
          distanceMi: 18,
          lateFadeSecPerMi: null,
          decouplingPct: DECOUPLING_ENDURANCE_GAP_PCT + DECOUPLING_HEAT_ARTIFACT_PCT + 2,
          cadence: null,
          heatConfounded: true,
        },
      ],
    })!;
    expect(r.ranked.find((x) => x.limiter === 'endurance')).toBeDefined();
  });

  it('freshness is the durability anchor\'s job · a refused read reaches here as null and yields nothing', () => {
    const r = diagnoseLimiter({ ...blank(), curve: null })!;
    expect(r.ranked).toEqual([]);
  });
});

describe('the David case · a marathoner whose half-marathon fitness outruns their marathon', () => {
  /**
   * AFC half 1:41:53 against a marathon that lands far slower than the curve
   * predicts. Riegel from the half at doctrine's default exponent gives roughly
   * 3:32; a 3:50 marathon fits an exponent well above the neutral band, which
   * is doctrine's Speedster — short form ahead of long form.
   *
   * The engine must call this ENDURANCE and reach for long-run duration, NOT
   * reach for pace, and NOT read the strong half as licence to train faster.
   */
  const david: LimiterInput = {
    ...blank(26.2, 412), // goal marathon 3:00
    // AFC half 1:41:53 and a 3:50:00 marathon: the canonical fit's raw
    // exponent for that pair, ln(13800/6113)/ln(2) ≈ 1.175.
    curve: { exponent: Math.log(13800 / 6113) / Math.log(26.2 / 13.1), races: 2, provisional: false },
    fadeObservations: [
      { distanceMi: 20, lateFadeSecPerMi: 28, decouplingPct: 11, cadence: 'fading' },
      { distanceMi: 18, lateFadeSecPerMi: 19, decouplingPct: 9.5, cadence: 'sustained' },
    ],
    recentWeeklyMi: 55,
  };

  it('names endurance, not speed and not pace', () => {
    const r = diagnoseLimiter(david)!;
    expect(r.primary).toBe('endurance');
    expect(r.primary).not.toBe('speed_reserve');
  });

  it('is confident, because the curve and the decoupling agree', () => {
    const r = diagnoseLimiter(david)!;
    expect(r.confidence).toBe('high');
  });

  it('prescribes duration and volume · never "run the workouts faster"', () => {
    const r = diagnoseLimiter(david)!;
    expect(r.levers[0]).toMatch(/long-run duration/i);
    // §11: "Do not simply make every workout faster."
    expect(r.levers[0].toLowerCase()).not.toMatch(/\bfaster\b/);
  });

  it('the same runner with the marathon removed cannot be diagnosed from the half alone', () => {
    const r = diagnoseLimiter({ ...david, curve: null, fadeObservations: null })!;
    expect(r.ranked.find((x) => x.limiter === 'endurance' && x.evidence.some((e) => /curve/i.test(e)))).toBeUndefined();
  });

  it('a provisional result costs the read a confidence notch', () => {
    const r = diagnoseLimiter({
      ...david,
      curve: { ...david.curve!, provisional: true },
    })!;
    expect(r.confidence).not.toBe('high');
  });
});

describe('the goal-gap payoff · whatClosesIt is the limiter, not hardcoded prose', () => {
  it('an endurance-limited runner is told to lengthen the long run', () => {
    const limiter = diagnoseLimiter({ ...blank(), curve: curveAt(1.14) })!;
    const out = composeWhatClosesIt('widening', 600, 12, 26.2, limiter);
    expect(out.join(' ')).toMatch(/long-run duration/i);
    // The line that used to go to everyone.
    expect(out.join(' ')).not.toMatch(/threshold density is the lever/i);
  });

  it('a speed-limited runner is told to add strides, not threshold density', () => {
    const limiter = diagnoseLimiter({ ...blank(), curve: curveAt(1.01) })!;
    const out = composeWhatClosesIt('widening', 600, 12, 26.2, limiter);
    expect(out.join(' ')).toMatch(/strides/i);
    expect(out.join(' ')).not.toMatch(/threshold density/i);
  });

  it('two runners with the same gap and different limiters get different advice', () => {
    const a = diagnoseLimiter({ ...blank(), curve: curveAt(1.14) })!;
    const b = diagnoseLimiter({ ...blank(), recentWeeklyMi: 28, blockProgressFraction: 0.8 })!;
    expect(composeWhatClosesIt('static', 600, 12, 26.2, a)).not.toEqual(
      composeWhatClosesIt('static', 600, 12, 26.2, b),
    );
  });

  it('no limiter read says so rather than inventing a lever', () => {
    const out = composeWhatClosesIt('widening', 600, 12, 26.2, null);
    expect(out.join(' ')).toMatch(/not enough evidence/i);
    expect(out.join(' ')).not.toMatch(/threshold density is the lever/i);
  });

  it('running ahead of the goal is still left alone', () => {
    const limiter = diagnoseLimiter({ ...blank(), curve: curveAt(1.14) })!;
    const out = composeWhatClosesIt('static', -300, 12, 26.2, limiter);
    expect(out.join(' ')).toMatch(/ahead of the goal/i);
  });

  it('a low-confidence limiter hedges instead of instructing', () => {
    const limiter = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 20, lateFadeSecPerMi: 25, decouplingPct: null, cadence: 'breaking' },
      ],
    })!;
    expect(limiter.confidence).toBe('low');
    const out = composeWhatClosesIt('widening', 600, 12, 26.2, limiter);
    expect(out.join(' ')).toMatch(/most likely lever/i);
  });
});

describe('§11 · the limiter selects a lever other than pace', () => {
  it('no limiter opens with a pace change', () => {
    for (const [limiter, levers] of Object.entries(LEVERS)) {
      expect(levers.length, `${limiter} has no levers`).toBeGreaterThan(0);
      expect(levers[0].toLowerCase(), `${limiter} opens on pace`).not.toMatch(/^[^·]*\bpace\b/);
    }
  });

  it('every limiter the type admits has a lever list', () => {
    const all: Array<keyof typeof LEVERS> = [
      'aerobic_capacity', 'threshold', 'speed_reserve', 'endurance',
      'durability', 'training_volume', 'recovery_capacity',
    ];
    for (const l of all) expect(LEVERS[l]?.length ?? 0).toBeGreaterThan(0);
  });
});

/**
 * 2026-08-19 · the endurance finding was structurally unreachable for a
 * short-distance runner, and duration-blind for everyone.
 *
 * `computeAerobicDecoupling` gated on `distanceMi >= 6`, a quantity Research/03
 * §12 never states. §12 states the protocol in TIME — "a steady aerobic run
 * (60–90 min)". The distance gate therefore admitted a 36-minute effort from a
 * fast runner and refused a 62-minute one from a slow runner, and since
 * `DECOUPLING_ENDURANCE_GAP_PCT` reads §12's own interpretation table, both
 * mistakes were the same mistake: the table applied outside its scope in one
 * direction and withheld inside it in the other.
 */
describe('DECOUPLING · the gate is Research/03 §12\'s duration, not a distance', () => {
  /** n mile-splits at a fixed pace, HR climbing linearly by `hrRise` overall. */
  const run = (miles: number, paceSec: number, hrStart: number, hrRise: number) =>
    Array.from({ length: miles }, (_, i) => ({
      mile: i + 1,
      pace: paceSec,
      hr: hrStart + Math.round((hrRise * i) / Math.max(1, miles - 1)),
    }));

  it('a 5K runner\'s 5-mile long run reads · 12:20/mi is 62 minutes', () => {
    const r = computeAerobicDecoupling(run(5, 740, 141, 16), 5);
    expect(r).not.toBeNull();
    expect(r!.durationMin).toBeGreaterThanOrEqual(DECOUPLING_PROTOCOL_MIN_MINUTES);
    // The old gate returned null here purely because 5 < 6.
  });

  it('a 35-minute 5-miler does not · pace, not distance, is what changed', () => {
    expect(computeAerobicDecoupling(run(5, 420, 141, 16), 5)).toBeNull();
  });

  it('a 36-minute SIX-miler does not either · the old gate admitted this one', () => {
    expect(computeAerobicDecoupling(run(6, 360, 140, 18), 6)).toBeNull();
  });

  it('a marathoner\'s 14-miler still reads · §12 extends the band to race length', () => {
    const r = computeAerobicDecoupling(run(14, 450, 138, 13), 14);
    expect(r).not.toBeNull();
    expect(r!.durationMin).toBeGreaterThan(90);
  });

  it('the bands are §12\'s four rows · 7% is "acceptable", not an endurance gap', () => {
    // 7.x% drift used to verdict `poor` off a boundary the doc does not publish,
    // while this file's own DECOUPLING_ENDURANCE_GAP_PCT (8) called it fine.
    const r = computeAerobicDecoupling(run(5, 740, 141, 16), 5)!;
    expect(r.driftPct).toBeGreaterThan(5);
    expect(r.driftPct).toBeLessThan(DECOUPLING_ENDURANCE_GAP_PCT);
    expect(r.verdict).toBe('building');
  });

  it('a stated-short effort is held back from the endurance finding', () => {
    const short = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 5, durationSec: 40 * 60, lateFadeSecPerMi: null, decouplingPct: 14, cadence: null },
        { distanceMi: 5, durationSec: 40 * 60, lateFadeSecPerMi: null, decouplingPct: 13, cadence: null },
      ],
    });
    expect(short?.ranked.some((r) => r.limiter === 'endurance')).not.toBe(true);

    // The same two readings off protocol-length efforts DO accuse the base.
    const long = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 12, durationSec: 100 * 60, lateFadeSecPerMi: null, decouplingPct: 14, cadence: null },
        { distanceMi: 12, durationSec: 100 * 60, lateFadeSecPerMi: null, decouplingPct: 13, cadence: null },
      ],
    });
    expect(long?.ranked.some((r) => r.limiter === 'endurance')).toBe(true);
  });

  it('an unstated duration still counts · the engine\'s only producer enforces it upstream', () => {
    const r = diagnoseLimiter({
      ...blank(),
      fadeObservations: [
        { distanceMi: 12, lateFadeSecPerMi: null, decouplingPct: 14, cadence: null },
        { distanceMi: 12, lateFadeSecPerMi: null, decouplingPct: 13, cadence: null },
      ],
    });
    expect(r?.ranked.some((l) => l.limiter === 'endurance')).toBe(true);
  });
});
