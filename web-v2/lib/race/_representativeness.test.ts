/**
 * RACE REPRESENTATIVENESS · rule 8 of Design/adaptive-progression-engine.md.
 *
 *   poor_race + conditions_normal + tapered + well_paced + maximal
 *       → meaningful downward re-anchor
 *   poor_race + hilly|hot|fatigued|badly_paced
 *       → reduce confidence, smaller adjustment
 *
 *   "One noisy race should not destroy a stable fitness model."
 *
 * The case that must never break is the FIRST one: a clean race that was simply
 * slower has to keep full authority, or this module has replaced an
 * over-eager re-anchor with an engine that never re-anchors at all.
 */
import { describe, it, expect } from 'vitest';
import { predictRaceTime, vdotFromRace } from '@/lib/training/vdot';
import { RECOVERY_EFFORT_SCALE } from '@/lib/plan/goal-tiers';
import {
  assessRepresentativeness,
  authorityScaledVdot,
  composeSlowdown,
  effectiveEffortClass,
  splitCvPct,
  REPRESENTATIVE_FLOOR,
  UNREPRESENTATIVE_FLOOR,
  type RepresentativenessInput,
  type RaceSplit,
} from './representativeness';

// ── Fixtures ───────────────────────────────────────────────────────────────

const HM = 13.1;
const ANCHOR_VDOT = 50;

/** The anchor's own prediction for a half at VDOT 50. */
const PREDICTED_S = predictRaceTime(ANCHOR_VDOT, HM)!;

/**
 * A race that came in 5% slower than the anchor predicted · about 1.6 VDOT
 * down, so `fitnessRegressionFires` would trip on it.
 */
const FINISH_S = Math.round(PREDICTED_S * 1.05);
const RACE_VDOT = vdotFromRace(FINISH_S, HM)!;

function race(over: Partial<RepresentativenessInput> = {}): RepresentativenessInput {
  return {
    distanceMi: HM,
    finishS: FINISH_S,
    anchorVdot: ANCHOR_VDOT,
    raceVdot: RACE_VDOT,
    ...over,
  };
}

/** Evenly-paced splits · dispersion well inside any tier band. */
function evenSplits(): RaceSplit[] {
  const target = FINISH_S / HM;
  return Array.from({ length: 13 }, (_, i) => ({
    mile: i + 1,
    paceSPerMi: target + (i % 2 ? 3 : -3),
  }));
}

/** A positive-split blow-up · out hard, wall, big fade. */
function blowupSplits(): RaceSplit[] {
  return Array.from({ length: 13 }, (_, i) => ({
    mile: i + 1,
    paceSPerMi: i < 6 ? 420 : 420 + (i - 5) * 30,
  }));
}

// ── Sanity on the fixture itself ───────────────────────────────────────────

describe('fixture', () => {
  it('is a race that would fire the downward re-anchor', () => {
    expect(RACE_VDOT).toBeLessThan(ANCHOR_VDOT - 1.5);
  });
});

// ── THE DOCTRINE'S TWO NAMED CASES ─────────────────────────────────────────

describe('rule 8 · the two named cases', () => {
  it('poor_race + conditions_normal + tapered + well_paced + maximal → meaningful downward re-anchor', () => {
    const read = assessRepresentativeness(race({
      state: { priority: 'A', formBand: 'RACE-READY' },
      splits: evenSplits(),
      course: { elevationGainFt: 40, netElevationFt: 0 },
      weather: { tempF: 52, humidityPct: 55, windMph: 3, windRelation: 'cross' },
    }));

    expect(read.authority).toBe(1);
    expect(read.tier).toBe('representative');
    expect(read.detractors).toHaveLength(0);
    // A meaningful re-anchor · all the way to the race's own VDOT.
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)).toBe(RACE_VDOT);
  });

  it('poor_race + hilly|hot|fatigued|badly_paced → reduce confidence, smaller adjustment', () => {
    const clean = assessRepresentativeness(race({ splits: evenSplits() }));

    const compromised: Array<[string, RepresentativenessInput]> = [
      ['hilly',       race({ course: { elevationGainFt: 1800, netElevationFt: 0 } })],
      ['hot',         race({ weather: { tempF: 85, humidityPct: 70 } })],
      ['fatigued',    race({ state: { formBand: 'OVERREACH' } })],
      ['badly paced', race({ splits: blowupSplits() })],
    ];

    for (const [label, input] of compromised) {
      const read = assessRepresentativeness(input);
      expect(read.authority, label).toBeLessThan(clean.authority);
      expect(read.detractors.length, label).toBeGreaterThan(0);

      // "smaller adjustment" · never larger, and never past the race's own VDOT.
      const scaled = authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority);
      if (scaled != null) {
        expect(scaled, label).toBeGreaterThan(RACE_VDOT);
        expect(scaled, label).toBeLessThanOrEqual(ANCHOR_VDOT);
      }
    }
  });
});

// ── The case that must still work ──────────────────────────────────────────

describe('a clean race that was simply slower keeps FULL authority', () => {
  it('holds full authority with no context supplied at all', () => {
    const read = assessRepresentativeness(race());
    expect(read.authority).toBe(1);
    expect(read.tier).toBe('representative');
    expect(read.explainedPct).toBe(0);
  });

  it('holds full authority when every context field is present and benign', () => {
    const read = assessRepresentativeness(race({
      state: { priority: 'A', formBand: 'RACE-READY', illness: false, niggleSeverity: 0, fuellingFailure: false },
      splits: evenSplits(),
      course: { elevationGainFt: 0, netElevationFt: 0, altitudeFt: 200, altitudeAcclimatized: false },
      weather: { tempF: 48, dewpointF: 40, conditions: 'overcast', windMph: 0, windRelation: 'cross' },
    }));
    expect(read.authority).toBe(1);
    expect(read.detractors).toHaveLength(0);
  });

  it('a tailwind is not a detractor · it does not excuse a slow race', () => {
    const read = assessRepresentativeness(race({
      weather: { tempF: 50, windMph: 20, windRelation: 'tail' },
    }));
    expect(read.authority).toBe(1);
    expect(read.detractors.map((d) => d.factor)).not.toContain('wind');
  });

  it('re-anchors exactly as the old code did · scaled VDOT equals the race VDOT', () => {
    const read = assessRepresentativeness(race({ splits: evenSplits() }));
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)).toBe(RACE_VDOT);
  });
});

// ── Individual factors ─────────────────────────────────────────────────────

describe('a C-priority race', () => {
  it('carries the authority doctrine grants a C effort, not an A effort', () => {
    const read = assessRepresentativeness(race({ state: { priority: 'C' } }));
    expect(read.effectiveEffortClass).toBe('C');
    expect(read.authority).toBeCloseTo(RECOVERY_EFFORT_SCALE.C, 5);
    expect(read.detractors.map((d) => d.factor)).toContain('not_maximal');
  });

  it('sits at the floor · it still nudges fitness, but barely', () => {
    const read = assessRepresentativeness(race({ state: { priority: 'C' } }));
    expect(read.tier).toBe('compromised');
    const scaled = authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)!;
    expect(scaled).toBeGreaterThan(RACE_VDOT);
    expect(scaled).toBeLessThan(ANCHOR_VDOT);
  });

  it('a C race in bad conditions drops below the floor and does not fire at all', () => {
    const read = assessRepresentativeness(race({
      state: { priority: 'C' },
      weather: { tempF: 82, humidityPct: 75 },
    }));
    expect(read.tier).toBe('unrepresentative');
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)).toBeNull();
  });

  it('a B race sits between A and C', () => {
    const a = assessRepresentativeness(race({ state: { priority: 'A' } })).authority;
    const b = assessRepresentativeness(race({ state: { priority: 'B' } })).authority;
    const c = assessRepresentativeness(race({ state: { priority: 'C' } })).authority;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(b).toBeCloseTo(RECOVERY_EFFORT_SCALE.B, 5);
  });

  it('an unlabelled race is read as an A race · goal-tiers\' conservative default', () => {
    expect(assessRepresentativeness(race({ state: {} })).effectiveEffortClass).toBe('A');
    expect(assessRepresentativeness(race()).effectiveEffortClass).toBe('A');
  });
});

describe('a hot race', () => {
  it('is discounted, and harder the hotter it was', () => {
    const warm = assessRepresentativeness(race({ weather: { tempF: 68, humidityPct: 50 } }));
    const hot  = assessRepresentativeness(race({ weather: { tempF: 85, humidityPct: 70 } }));
    expect(warm.authority).toBeLessThan(1);
    expect(hot.authority).toBeLessThan(warm.authority);
    expect(hot.explainedPct).toBeGreaterThan(warm.explainedPct);
  });

  it('reports heat and humidity as separate factors from one model run', () => {
    const read = assessRepresentativeness(race({ weather: { tempF: 80, humidityPct: 80 } }));
    const factors = read.detractors.map((d) => d.factor);
    expect(factors).toContain('heat');
    expect(factors).toContain('humidity');
  });

  it('a race hot enough to explain the whole shortfall does not move fitness', () => {
    const read = assessRepresentativeness(race({ weather: { tempF: 88, humidityPct: 80 } }));
    expect(read.explainedPct).toBeGreaterThan(read.observedShortfallPct);
    expect(read.authority).toBe(0);
    expect(read.tier).toBe('unrepresentative');
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)).toBeNull();
  });

  it('a cool race is not discounted · below the doctrine baseline there is no penalty', () => {
    const read = assessRepresentativeness(race({ weather: { tempF: 45, humidityPct: 60 } }));
    expect(read.detractors.map((d) => d.factor)).not.toContain('heat');
    expect(read.authority).toBe(1);
  });
});

describe('a positive-split blowup', () => {
  it('is charged to pacing, not to fitness', () => {
    const read = assessRepresentativeness(race({ splits: blowupSplits() }));
    expect(read.detractors.map((d) => d.factor)).toContain('pacing');
    expect(read.authority).toBeLessThan(REPRESENTATIVE_FLOOR);
  });

  it('even splits are never charged to pacing', () => {
    const read = assessRepresentativeness(race({ splits: evenSplits() }));
    expect(read.detractors.map((d) => d.factor)).not.toContain('pacing');
  });

  it('needs enough splits to have an opinion', () => {
    expect(splitCvPct([{ mile: 1, paceSPerMi: 400 }, { mile: 2, paceSPerMi: 500 }])).toBeNull();
    expect(splitCvPct(null)).toBeNull();
    expect(splitCvPct([])).toBeNull();
  });

  it('ignores splits flagged unreliable (null pace)', () => {
    const cv = splitCvPct([
      { mile: 1, paceSPerMi: 400 }, { mile: 2, paceSPerMi: null },
      { mile: 3, paceSPerMi: 402 }, { mile: 4, paceSPerMi: 398 },
    ]);
    expect(cv).not.toBeNull();
    expect(cv!).toBeLessThan(1);
  });
});

describe('a race run on tired legs', () => {
  it('LOADED steps the effort class down one', () => {
    const read = assessRepresentativeness(race({ state: { priority: 'A', formBand: 'LOADED' } }));
    expect(read.effectiveEffortClass).toBe('B');
    expect(read.detractors.map((d) => d.factor)).toContain('taper_state');
  });

  it('OVERREACH grades the race a C effort whatever the calendar called it', () => {
    const read = assessRepresentativeness(race({ state: { priority: 'A', formBand: 'OVERREACH' } }));
    expect(read.effectiveEffortClass).toBe('C');
    expect(read.detractors.map((d) => d.factor)).toContain('fatigue');
  });

  it('a niggle at or above the engine\'s own 5/10 line steps the class down', () => {
    expect(assessRepresentativeness(race({ state: { niggleSeverity: 4 } })).effectiveEffortClass).toBe('A');
    expect(assessRepresentativeness(race({ state: { niggleSeverity: 5 } })).effectiveEffortClass).toBe('B');
  });

  it('a race-ready taper is not penalised', () => {
    const read = assessRepresentativeness(race({ state: { priority: 'A', formBand: 'RACE-READY' } }));
    expect(read.effectiveEffortClass).toBe('A');
    expect(read.authority).toBe(1);
  });

  it('illness zeroes authority outright', () => {
    const read = assessRepresentativeness(race({ state: { illness: true } }));
    expect(read.authority).toBe(0);
    expect(read.tier).toBe('unrepresentative');
    expect(read.detractors.map((d) => d.factor)).toContain('illness');
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, read.authority)).toBeNull();
  });

  it('illness is still reported when the conditions had already zeroed it', () => {
    // A zero read must never come back with no stated cause.
    const read = assessRepresentativeness(race({
      state: { illness: true },
      weather: { tempF: 90, humidityPct: 80 },
    }));
    expect(read.authority).toBe(0);
    expect(read.detractors.map((d) => d.factor)).toContain('illness');
  });

  it('a reported fuelling failure caps at the C-race line, it does not zero', () => {
    const read = assessRepresentativeness(race({ state: { fuellingFailure: true } }));
    expect(read.authority).toBeCloseTo(UNREPRESENTATIVE_FLOOR, 5);
    expect(read.detractors.map((d) => d.factor)).toContain('fuelling');
  });
});

// ── THE DOUBLE-COUNTING GUARD ──────────────────────────────────────────────

describe('double-counting guard', () => {
  it('a factor named in alreadyPricedFor is skipped, not charged twice', () => {
    const hot = race({ weather: { tempF: 85, humidityPct: 70 } });
    const charged = assessRepresentativeness(hot);
    const skipped = assessRepresentativeness({
      ...hot,
      alreadyPricedFor: ['heat', 'humidity'],
    });

    expect(charged.detractors.map((d) => d.factor)).toContain('heat');
    expect(skipped.detractors.map((d) => d.factor)).not.toContain('heat');
    expect(skipped.detractors.map((d) => d.factor)).not.toContain('humidity');
    expect(skipped.explainedPct).toBe(0);
    expect(skipped.authority).toBe(1);
  });

  it('skipping terrain leaves the heat charge intact · the guard is per factor', () => {
    const both = race({
      weather: { tempF: 80, humidityPct: 70 },
      course: { elevationGainFt: 1500, netElevationFt: 0 },
    });
    const skipped = assessRepresentativeness({ ...both, alreadyPricedFor: ['course_elevation'] });
    const factors = skipped.detractors.map((d) => d.factor);
    expect(factors).not.toContain('course_elevation');
    expect(factors).toContain('heat');
  });

  it('heat is not charged again as pacing · a hot race fades, and that is the heat', () => {
    // Same fade, with and without the heat that would cause it.
    const coolFade = assessRepresentativeness(race({
      splits: blowupSplits(),
      weather: { tempF: 50 },
    }));
    const hotFade = assessRepresentativeness(race({
      splits: blowupSplits(),
      weather: { tempF: 80, humidityPct: 70 },
    }));

    const pacingOf = (r: typeof coolFade) =>
      r.detractors.find((d) => d.factor === 'pacing')?.detail ?? '';

    // The hot race's fade is attributed to heat, so the PACING share shrinks.
    const coolPacing = Number(/about ([\d.]+)% lost/.exec(pacingOf(coolFade))?.[1] ?? 0);
    const hotPacing = Number(/about ([\d.]+)% lost/.exec(pacingOf(hotFade))?.[1] ?? 0);
    expect(coolPacing).toBeGreaterThan(0);
    expect(hotPacing).toBeLessThan(coolPacing);
  });

  it('composeSlowdown multiplies, it does not add · Research/01 §Combined conditions', () => {
    // 1.05 × 1.04 = 1.092 → 9.2%, not 9.0%.
    expect(composeSlowdown({ heat: 5, course: 4 })).toBeCloseTo(9.2, 5);
  });

  it('composeSlowdown applies Research/06 §10\'s heat-and-altitude haircut', () => {
    // Doctrine's worked example: 6% heat + 6% altitude ≈ 11%, not 12%.
    const composed = composeSlowdown({ heat: 6, altitude: 6 });
    expect(composed).toBeGreaterThan(10.5);
    expect(composed).toBeLessThan(11.5);
    // And the haircut only fires when BOTH exceed 5%.
    expect(composeSlowdown({ heat: 6, altitude: 3 })).toBeCloseTo((1.06 * 1.03 - 1) * 100, 5);
  });

  it('never explains a negative amount', () => {
    expect(composeSlowdown({})).toBe(0);
    expect(composeSlowdown({ heat: -5, course: -3 })).toBe(0);
  });
});

// ── Magnitude scaling ──────────────────────────────────────────────────────

describe('authorityScaledVdot', () => {
  it('full authority lands the anchor on the race VDOT', () => {
    expect(authorityScaledVdot(50, 45, 1)).toBe(45);
  });

  it('half authority moves half way', () => {
    expect(authorityScaledVdot(50, 45, 0.5)).toBe(47.5);
  });

  it('below the unrepresentative floor it does not fire at all', () => {
    expect(authorityScaledVdot(50, 45, UNREPRESENTATIVE_FLOOR - 0.001)).toBeNull();
    expect(authorityScaledVdot(50, 45, 0)).toBeNull();
  });

  it('fires exactly at the floor', () => {
    expect(authorityScaledVdot(50, 45, UNREPRESENTATIVE_FLOOR)).not.toBeNull();
  });

  it('is monotonic in authority · less authority always means a smaller move', () => {
    // The race VDOT (45) is BELOW the anchor (50), so a bigger move lands
    // LOWER. As authority falls the new anchor climbs back toward the old one.
    let prev = -Infinity;
    for (const a of [1, 0.9, 0.75, 0.6, 0.45, UNREPRESENTATIVE_FLOOR]) {
      const v = authorityScaledVdot(50, 45, a)!;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(authorityScaledVdot(50, 45, 1)).toBeLessThan(authorityScaledVdot(50, 45, 0.5)!);
  });

  it('never overshoots past the evidence', () => {
    for (const a of [0, 0.35, 0.5, 0.8, 1]) {
      const v = authorityScaledVdot(50, 45, a);
      if (v == null) continue;
      expect(v).toBeGreaterThanOrEqual(45);
      expect(v).toBeLessThanOrEqual(50);
    }
  });

  it('rejects non-finite inputs', () => {
    expect(authorityScaledVdot(NaN, 45, 1)).toBeNull();
    expect(authorityScaledVdot(50, NaN, 1)).toBeNull();
    expect(authorityScaledVdot(50, 45, NaN)).toBeNull();
  });
});

// ── Floors are doctrine-derived, not invented ──────────────────────────────

describe('tier floors come off Research/00b\'s effort table', () => {
  it('the representative floor is doctrine\'s B-race line', () => {
    expect(REPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.B);
  });
  it('the unrepresentative floor is doctrine\'s C-race line', () => {
    expect(UNREPRESENTATIVE_FLOOR).toBe(RECOVERY_EFFORT_SCALE.C);
  });
  it('the floors are ordered', () => {
    expect(UNREPRESENTATIVE_FLOOR).toBeLessThan(REPRESENTATIVE_FLOOR);
    expect(REPRESENTATIVE_FLOOR).toBeLessThan(1);
  });
});

// ── Effort class ───────────────────────────────────────────────────────────

describe('effectiveEffortClass', () => {
  it('never steps below C', () => {
    expect(effectiveEffortClass({ priority: 'C', formBand: 'LOADED' }).cls).toBe('C');
    expect(effectiveEffortClass({ priority: 'C', formBand: 'OVERREACH' }).cls).toBe('C');
  });

  it('does not stack taper and fatigue as two separate penalties', () => {
    // One row of Research/00b binds effort and taper · one charge, not two.
    const both = effectiveEffortClass({ priority: 'A', formBand: 'LOADED', niggleSeverity: 6 });
    expect(both.cls).toBe('B');
  });

  it('tolerates a lowercase or unrecognised priority string', () => {
    expect(effectiveEffortClass({ priority: 'b' }).cls).toBe('B');
    expect(effectiveEffortClass({ priority: 'nonsense' }).cls).toBe('A');
    expect(effectiveEffortClass(null).cls).toBe('A');
    expect(effectiveEffortClass(undefined).cls).toBe('A');
  });
});

// ── Robustness ─────────────────────────────────────────────────────────────

describe('degrades honestly on missing data', () => {
  it('a race that met its prediction has nothing to explain', () => {
    const onPace = Math.round(PREDICTED_S);
    const read = assessRepresentativeness({
      distanceMi: HM, finishS: onPace,
      anchorVdot: ANCHOR_VDOT, raceVdot: vdotFromRace(onPace, HM)!,
      weather: { tempF: 85, humidityPct: 70 },
    });
    expect(read.observedShortfallPct).toBe(0);
    expect(read.authority).toBe(1);
  });

  it('unknown weather is never an invented penalty', () => {
    const read = assessRepresentativeness(race({
      weather: { tempF: null, humidityPct: null, windMph: null },
    }));
    expect(read.authority).toBe(1);
    expect(read.detractors).toHaveLength(0);
  });

  it('a stub course with no elevation data is not charged', () => {
    const read = assessRepresentativeness(race({
      course: { elevationGainFt: null, netElevationFt: null },
    }));
    expect(read.authority).toBe(1);
  });

  // Research/06 §11 "When to slow paces" · doctrine says WHEN its curves apply.
  // Below these thresholds the right adjustment is zero, not a small number.
  describe('doctrine\'s materiality gates', () => {
    it('a cool day is not charged · (Tair + Td) under 110 and Td under 60', () => {
      const read = assessRepresentativeness(race({
        weather: { tempF: 52, dewpointF: 40 },
      }));
      expect(read.explainedPct).toBe(0);
      expect(read.authority).toBe(1);
    });

    it('the gate opens once doctrine says it does', () => {
      const under = assessRepresentativeness(race({ weather: { tempF: 58, dewpointF: 45 } }));
      const over  = assessRepresentativeness(race({ weather: { tempF: 75, dewpointF: 65 } }));
      expect(under.explainedPct).toBe(0);
      expect(over.explainedPct).toBeGreaterThan(0);
    });

    it('a breeze under 10 mph is not charged', () => {
      const calm = assessRepresentativeness(race({ weather: { tempF: 50, windMph: 8, windRelation: 'head' } }));
      const windy = assessRepresentativeness(race({ weather: { tempF: 50, windMph: 20, windRelation: 'head' } }));
      expect(calm.explainedPct).toBe(0);
      expect(windy.explainedPct).toBeGreaterThan(0);
    });

    it('elevation under 3,000 ft is not charged', () => {
      const low  = assessRepresentativeness(race({ course: { altitudeFt: 2000 } }));
      const high = assessRepresentativeness(race({ course: { altitudeFt: 6000 } }));
      expect(low.explainedPct).toBe(0);
      expect(high.explainedPct).toBeGreaterThan(0);
    });

    it('a course under 100 ft of gain is flat, per Research/02 §13.2', () => {
      const flat  = assessRepresentativeness(race({ course: { elevationGainFt: 80, netElevationFt: 0 } }));
      const rolly = assessRepresentativeness(race({ course: { elevationGainFt: 900, netElevationFt: 0 } }));
      expect(flat.explainedPct).toBe(0);
      expect(rolly.explainedPct).toBeGreaterThan(0);
    });

    it('all four gates together leave a genuinely clean race untouched', () => {
      const read = assessRepresentativeness(race({
        weather: { tempF: 52, dewpointF: 40, windMph: 6, windRelation: 'head' },
        course: { elevationGainFt: 60, netElevationFt: 0, altitudeFt: 900 },
        splits: evenSplits(),
        state: { priority: 'A', formBand: 'RACE-READY' },
      }));
      expect(read.explainedPct).toBe(0);
      expect(read.authority).toBe(1);
      expect(read.detractors).toHaveLength(0);
    });
  });

  it('always returns a read · callers never branch on null', () => {
    const read = assessRepresentativeness({
      distanceMi: 0, finishS: 0, anchorVdot: 0, raceVdot: 0,
    });
    expect(read).toBeTruthy();
    expect(read.authority).toBeGreaterThanOrEqual(0);
    expect(read.authority).toBeLessThanOrEqual(1);
    expect(read.summary.length).toBeGreaterThan(0);
  });

  it('authority is always inside [0,1] across a wide sweep', () => {
    for (const tempF of [40, 60, 75, 90, 100]) {
      for (const gain of [0, 500, 2000, 5000]) {
        for (const priority of ['A', 'B', 'C'] as const) {
          for (const slowPct of [1, 5, 15]) {
            const f = Math.round(PREDICTED_S * (1 + slowPct / 100));
            const v = vdotFromRace(f, HM);
            if (v == null) continue;
            const read = assessRepresentativeness({
              distanceMi: HM, finishS: f, anchorVdot: ANCHOR_VDOT, raceVdot: v,
              weather: { tempF, humidityPct: 65 },
              course: { elevationGainFt: gain, netElevationFt: 0 },
              state: { priority },
              splits: blowupSplits(),
            });
            expect(read.authority).toBeGreaterThanOrEqual(0);
            expect(read.authority).toBeLessThanOrEqual(1);
            for (const d of read.detractors) {
              expect(d.authorityCost).toBeGreaterThan(0);
              expect(d.detail.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
});

// ── Coach voice ────────────────────────────────────────────────────────────

describe('summary copy obeys the brief', () => {
  const samples = [
    assessRepresentativeness(race({ splits: evenSplits() })),
    assessRepresentativeness(race({ weather: { tempF: 85, humidityPct: 70 } })),
    assessRepresentativeness(race({ state: { priority: 'C' } })),
    assessRepresentativeness(race({ state: { formBand: 'LOADED' } })),
    assessRepresentativeness(race({ course: { elevationGainFt: 1800, netElevationFt: 0 } })),
    assessRepresentativeness(race({ state: { illness: true } })),
  ];

  it('no em dashes, no exclamation marks, no emoji', () => {
    for (const s of samples) {
      expect(s.summary, s.summary).not.toMatch(/[—–]/);
      expect(s.summary, s.summary).not.toMatch(/!/);
      expect(s.summary, s.summary).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('agrees with itself on singular and plural', () => {
    const one = assessRepresentativeness(race({ course: { elevationGainFt: 1800, netElevationFt: 0 } }));
    expect(one.summary).toMatch(/accounts for/);
    const many = assessRepresentativeness(race({ weather: { tempF: 85, humidityPct: 70 } }));
    expect(many.detractors.length).toBeGreaterThan(1);
    expect(many.summary).toMatch(/account for/);
  });

  it('does not claim conditions explained anything when they did not', () => {
    const c = assessRepresentativeness(race({ state: { priority: 'C' } }));
    expect(c.explainedPct).toBe(0);
    expect(c.summary).not.toMatch(/about 0%/);
  });
});
