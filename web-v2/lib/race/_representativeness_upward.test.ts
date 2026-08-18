/**
 * RACE REPRESENTATIVENESS · THE UPWARD LIMB.
 *
 * Rule 8 of `Design/adaptive-progression-engine.md` says a race must be
 * diagnosed before it moves the fitness model. It does not say "downward".
 *
 * `_representativeness.test.ts` covers the limb that shipped first — the one
 * that stops a hot, hilly, sick or untapered race from destroying a stable
 * anchor. This file covers the mirror that did not exist: the one that stops a
 * net-downhill course, a dead-aft wind, or an unconfirmed watch time from
 * INFLATING it.
 *
 * That is the more dangerous half. An over-read of fitness prescribes work the
 * runner cannot absorb; an under-read only prescribes work that is too easy.
 *
 * Every test here fails against the pre-fix engine, which ran the DOWNWARD
 * factor set (or no factor set at all) on a faster-than-anchor race:
 * `observedShortfallPct` was 0 for such a race, so `unexplained` was pinned at
 * 1.0 and nothing about the day could ever be priced.
 */
import { describe, it, expect } from 'vitest';
import { predictRaceTime, vdotFromRace } from '@/lib/training/vdot';
import {
  assessRepresentativeness,
  authorityScaledVdot,
  HEADWIND_COST_S_PER_MI,
  TAILWIND_BENEFIT_S_PER_MI,
  FLAT_COURSE_GAIN_FT,
  UNREPRESENTATIVE_FLOOR,
  type RepresentativenessInput,
} from './representativeness';

// ── Fixtures ───────────────────────────────────────────────────────────────

const M = 26.22;
const ANCHOR_VDOT = 46.6; // the live anchor on `users.vdot_last_reviewed`

/** A marathon 6% INSIDE the anchor's prediction · a clear pr_bank shape. */
const PREDICTED_S = predictRaceTime(ANCHOR_VDOT, M)!;
const FINISH_S = Math.round(PREDICTED_S * 0.94);
const RACE_VDOT = vdotFromRace(FINISH_S, M)!;

function fastRace(over: Partial<RepresentativenessInput> = {}): RepresentativenessInput {
  return {
    distanceMi: M,
    finishS: FINISH_S,
    anchorVdot: ANCHOR_VDOT,
    raceVdot: RACE_VDOT,
    direction: 'upward',
    ...over,
  };
}

describe('the upward limb exists at all', () => {
  it('infers direction from the race against the anchor when the caller stays quiet', () => {
    const up = assessRepresentativeness({ ...fastRace(), direction: null });
    expect(up.direction).toBe('upward');

    const slowFinish = Math.round(PREDICTED_S * 1.06);
    const down = assessRepresentativeness({
      distanceMi: M,
      finishS: slowFinish,
      anchorVdot: ANCHOR_VDOT,
      raceVdot: vdotFromRace(slowFinish, M)!,
    });
    expect(down.direction).toBe('downward');
  });

  it('reports the margin as a surplus, not as a zero shortfall', () => {
    const r = assessRepresentativeness(fastRace());
    // Pre-fix this was the whole bug: a fast race had shortfall 0, so the
    // unexplained fraction was pinned at 1 and no factor could ever bite.
    expect(r.observedShortfallPct).toBe(0);
    expect(r.observedSurplusPct).toBeGreaterThan(5);
    expect(r.observedSurplusPct).toBeLessThan(7);
  });

  it('leaves a clean race on a flat course at full authority', () => {
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 210, netElevationFt: 0 },
    }));
    expect(r.authority).toBe(1);
    expect(r.detractors).toEqual([]);
    expect(r.tier).toBe('representative');
    // The whole point of the fix is that it does NOT stop the engine believing
    // a real breakthrough.
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, r.authority)).toBe(
      Math.round(RACE_VDOT * 100) / 100,
    );
  });
});

describe('net descent · Research/11 through the one signed elevation model', () => {
  it('prices a point-to-point that drops a thousand feet', () => {
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 0, netElevationFt: -1000 },
    }));
    const d = r.detractors.find((x) => x.factor === 'net_downhill');
    expect(d).toBeDefined();
    expect(r.authority).toBeLessThan(1);
    expect(d!.detail).toMatch(/net descent/);
  });

  it('scales the re-anchor part of the way rather than all of it', () => {
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 0, netElevationFt: -1500 },
    }));
    const scaled = authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, r.authority)!;
    expect(scaled).toBeGreaterThan(ANCHOR_VDOT);
    expect(scaled).toBeLessThan(RACE_VDOT);
  });

  it('refuses to move the anchor at all when the descent explains the margin', () => {
    // A REVEL-shaped course · the drop is most of the reason for the time.
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 200, netElevationFt: -5200 },
    }));
    expect(r.authority).toBeLessThan(UNREPRESENTATIVE_FLOOR);
    expect(r.tier).toBe('unrepresentative');
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, r.authority)).toBeNull();
    expect(r.summary).toMatch(/not a new fitness number/);
  });

  it('leaves a course under the doctrine flat row alone', () => {
    const justFlat = -(FLAT_COURSE_GAIN_FT - 1);
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 0, netElevationFt: justFlat },
    }));
    expect(r.authority).toBe(1);
  });

  it('gives no credit to a course that climbs more than it drops', () => {
    // Big Sur's shape · a big net drop is not the same as a downhill course.
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 2182, netElevationFt: -260 },
    }));
    expect(r.detractors.some((d) => d.factor === 'net_downhill')).toBe(false);
    expect(r.authority).toBe(1);
  });

  it('charges the CIM shape honestly · a small net drop is a small discount', () => {
    // course_library.cim · gain 100 ft, net -340 ft. Research/22 calls CIM a
    // flat, certified course, so the model must not read it as a downhill ride.
    const r = assessRepresentativeness(fastRace({
      course: { elevationGainFt: 100, netElevationFt: -340 },
    }));
    expect(r.detractors.some((d) => d.factor === 'net_downhill')).toBe(true);
    expect(r.authority).toBeGreaterThan(0.9);
    expect(r.tier).toBe('representative');
  });
});

describe('wind · doctrine publishes both limbs of one table', () => {
  it('gives a dead-aft wind credit, and less than the same headwind costs', () => {
    const tail = assessRepresentativeness(fastRace({
      weather: { windMph: 20, windRelation: 'tail' },
    }));
    expect(tail.detractors.some((d) => d.factor === 'tailwind')).toBe(true);
    expect(tail.authority).toBeLessThan(1);

    for (const row of TAILWIND_BENEFIT_S_PER_MI) {
      const head = HEADWIND_COST_S_PER_MI.find((h) => h.mph === row.mph)!;
      expect(row.at6).toBeLessThan(head.at6);
      expect(row.at8).toBeLessThan(head.at8);
    }
  });

  it('never scores an unknown wind as help · doctrine nets an unknown course to a LOSS', () => {
    const r = assessRepresentativeness(fastRace({
      weather: { windMph: 20, windRelation: 'unknown' },
    }));
    expect(r.authority).toBe(1);
    expect(r.detractors).toEqual([]);
  });

  it('respects the Research/06 §11 materiality gate', () => {
    const r = assessRepresentativeness(fastRace({
      weather: { windMph: 8, windRelation: 'tail' },
    }));
    expect(r.authority).toBe(1);
  });
});

describe('what the upward limb deliberately does NOT charge', () => {
  it('does not discount a fast race for having been hot or hilly', () => {
    // Adversity that failed to slow the runner is evidence FOR the result.
    const r = assessRepresentativeness(fastRace({
      weather: { tempF: 88, humidityPct: 80 },
      course: { elevationGainFt: 1400, netElevationFt: 300 },
    }));
    expect(r.authority).toBe(1);
  });

  it('does not charge the effort class · a PR off a training week is still a PR', () => {
    const noTaper = assessRepresentativeness(fastRace({
      state: { priority: 'B', taperRatio: 1.0 },
    }));
    expect(noTaper.authority).toBe(1);
    expect(noTaper.detractors).toEqual([]);

    // ...while the downward limb still does, unchanged.
    const slowFinish = Math.round(PREDICTED_S * 1.06);
    const slow = assessRepresentativeness({
      distanceMi: M,
      finishS: slowFinish,
      anchorVdot: ANCHOR_VDOT,
      raceVdot: vdotFromRace(slowFinish, M)!,
      direction: 'downward',
      state: { priority: 'B', taperRatio: 1.0 },
    });
    expect(slow.authority).toBeLessThan(1);
  });
});

describe('unconfirmed watch time · the premise gate', () => {
  it('will not let an unconfirmed result move the anchor up', () => {
    const r = assessRepresentativeness(fastRace({
      state: { resultProvisional: true },
    }));
    expect(r.authority).toBe(0);
    expect(r.tier).toBe('unrepresentative');
    expect(authorityScaledVdot(ANCHOR_VDOT, RACE_VDOT, r.authority)).toBeNull();
  });

  it('says why, rather than suppressing silently', () => {
    const r = assessRepresentativeness(fastRace({ state: { resultProvisional: true } }));
    expect(r.detractors.map((d) => d.factor)).toContain('unconfirmed_result');
    expect(r.summary).toMatch(/Confirm the finish/);
  });

  it('lets the confirmed result through the moment the runner locks it in', () => {
    const r = assessRepresentativeness(fastRace({ state: { resultProvisional: false } }));
    expect(r.authority).toBe(1);
  });

  it('stays inert on the downward limb · a watch time errs FAST, so slow is conservative', () => {
    const slowFinish = Math.round(PREDICTED_S * 1.06);
    const base = {
      distanceMi: M,
      finishS: slowFinish,
      anchorVdot: ANCHOR_VDOT,
      raceVdot: vdotFromRace(slowFinish, M)!,
      direction: 'downward' as const,
    };
    const confirmed = assessRepresentativeness(base);
    const provisional = assessRepresentativeness({ ...base, state: { resultProvisional: true } });
    expect(provisional.authority).toBe(confirmed.authority);
    expect(provisional.authority).toBeGreaterThan(0);
  });
});
