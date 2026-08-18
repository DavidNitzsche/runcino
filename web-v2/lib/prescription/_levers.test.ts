/**
 * Progression levers · doctrine tests.
 *
 * The headline test walks the canonical threshold progression from
 * `Design/adaptive-progression-engine.md` §2 and asserts the module produces
 * it. If that test fails, the engine has stopped being able to progress an
 * athlete the way a coach would.
 */

import { describe, it, expect } from 'vitest';
import {
  advanceShape,
  assignZone,
  selectLever,
  probeShape,
  probesSupportFitnessMove,
  totalWorkMinutes,
  LEVER_ORDER,
  AT_PACE_WEEKLY_SHARE_CAP,
  PROBES_FOR_FITNESS_EVIDENCE,
  type WorkShape,
  type ProbeObservation,
} from './levers';
import type { AdaptationVerdict } from '@/lib/adaptation/adaptation-model';

/** 7:00/mi threshold work. */
const T_PACE = 420;

function shape(reps: number, repMinutes: number): WorkShape {
  return { reps, repMinutes, recoveryMinutes: 1, paceSPerMi: T_PACE, zone: 'ESTABLISHED' };
}

function verdict(band: AdaptationVerdict['band'], stepMultiplier = 1): AdaptationVerdict {
  return {
    band,
    confidence: 'high',
    decision: band === 'marginal' ? 'STAY' : 'PROGRESS',
    stepMultiplier,
    dimensions: [],
    veto: null,
    summary: '',
  };
}

describe('the canonical threshold progression', () => {
  it('W1 3x8 becomes W2 3x10 at the same effort', () => {
    const w1 = shape(3, 8);
    const w2 = advanceShape({
      shape: w1,
      lever: 'quality_duration',
      stepMultiplier: 1,
      weeklyMi: 50,
      family: 'threshold',
    });
    expect(w2.capped).toBe(false);
    expect(w2.shape.reps).toBe(3);
    expect(w2.shape.repMinutes).toBe(10);
    expect(w2.shape.paceSPerMi).toBe(T_PACE); // the effort did NOT move
  });

  it('W2 3x10 becomes W3 2x15 — same volume, higher continuity, same effort', () => {
    const w3 = advanceShape({
      shape: shape(3, 10),
      lever: 'work_density',
      stepMultiplier: 1,
      weeklyMi: 50,
      family: 'threshold',
    });
    expect(w3.shape.reps).toBe(2);
    expect(w3.shape.repMinutes).toBe(15);
    expect(totalWorkMinutes(w3.shape)).toBe(30);
    expect(w3.shape.paceSPerMi).toBe(T_PACE);
  });

  it('three weeks of real progression happen before the pace moves once', () => {
    let s = shape(3, 8);
    const paces: number[] = [s.paceSPerMi];
    s = advanceShape({ shape: s, lever: 'quality_duration', stepMultiplier: 1, weeklyMi: 50, family: 'threshold' }).shape;
    paces.push(s.paceSPerMi);
    s = advanceShape({ shape: s, lever: 'work_density', stepMultiplier: 1, weeklyMi: 50, family: 'threshold' }).shape;
    paces.push(s.paceSPerMi);
    expect(new Set(paces).size).toBe(1); // pace constant throughout
    expect(totalWorkMinutes(s)).toBeGreaterThan(totalWorkMinutes(shape(3, 8)));
  });

  it('the pace step, when it finally comes, is small — not a re-anchor', () => {
    const stepped = advanceShape({
      shape: shape(3, 10),
      lever: 'pace',
      stepMultiplier: 1,
      weeklyMi: 50,
      family: 'threshold',
    });
    expect(T_PACE - stepped.shape.paceSPerMi).toBeLessThanOrEqual(10);
    expect(stepped.shape.paceSPerMi).toBeLessThan(T_PACE);
  });
});

describe("Daniels' volume caps bound every lever", () => {
  it('threshold volume cannot exceed 10% of weekly mileage', () => {
    // 30 mi/wk at 7:00 pace → 3 mi → 21 min of T work. 3x8=24 is already over,
    // so the duration lever must refuse rather than prescribe more.
    const capped = advanceShape({
      shape: shape(3, 8),
      lever: 'quality_duration',
      stepMultiplier: 1,
      weeklyMi: 30,
      family: 'threshold',
    });
    expect(capped.capped).toBe(true);
    expect(capped.shape).toEqual(shape(3, 8));
    expect(AT_PACE_WEEKLY_SHARE_CAP.threshold).toBe(0.1);
  });

  it('a strongly adapting runner earns a bigger step, never an unbounded one', () => {
    const strong = advanceShape({
      shape: shape(3, 8),
      lever: 'quality_duration',
      stepMultiplier: 1.25,
      weeklyMi: 30,
      family: 'threshold',
    });
    expect(strong.capped).toBe(true); // the cap outranks the multiplier
  });

  it('VO2 repetitions stay inside the 3-5 minute window', () => {
    const atMax = advanceShape({
      shape: { ...shape(4, 5), paceSPerMi: 380 },
      lever: 'interval_duration',
      stepMultiplier: 1,
      weeklyMi: 60,
      family: 'interval',
    });
    expect(atMax.capped).toBe(true);
  });

  it('rep count respects the same volume ceiling', () => {
    const capped = advanceShape({
      shape: shape(4, 8),
      lever: 'rep_count',
      stepMultiplier: 1,
      weeklyMi: 35,
      family: 'threshold',
    });
    expect(capped.capped).toBe(true);
  });
});

describe('lever selection · pace is the ninth choice, not the first', () => {
  it('pace sits late in the ladder and two levers sit after it', () => {
    expect(LEVER_ORDER.indexOf('pace')).toBe(8);
    expect(LEVER_ORDER.length).toBeGreaterThan(9);
  });

  it('pace is never selected while a cheaper lever has room', () => {
    const sel = selectLever({
      limiter: 'threshold',
      adaptation: verdict('strong', 1.25),
      recentLevers: [],
      exhausted: [],
    });
    expect(sel!.lever).not.toBe('pace');
  });

  it('pace becomes available only once the cheaper levers are exhausted', () => {
    const exhausted = LEVER_ORDER.filter((l) => l !== 'pace' && LEVER_ORDER.indexOf(l) < 8);
    const sel = selectLever({
      limiter: null,
      adaptation: verdict('strong', 1.25),
      recentLevers: [],
      exhausted: [...exhausted],
    });
    expect(sel!.lever).toBe('pace');
  });

  it('even exhausted of alternatives, pace needs strong adaptation behind it', () => {
    const exhausted = LEVER_ORDER.filter((l) => l !== 'pace' && LEVER_ORDER.indexOf(l) < 8);
    const sel = selectLever({
      limiter: null,
      adaptation: verdict('normal', 1),
      recentLevers: [],
      exhausted: [...exhausted],
    });
    expect(sel?.lever).not.toBe('pace');
  });

  it('nothing advances when adaptation says hold', () => {
    expect(
      selectLever({ limiter: 'threshold', adaptation: verdict('marginal', 0), recentLevers: [], exhausted: [] }),
    ).toBeNull();
    expect(
      selectLever({ limiter: 'threshold', adaptation: verdict('poor', -0.5), recentLevers: [], exhausted: [] }),
    ).toBeNull();
  });

  it('the limiter chooses which lever family to reach for', () => {
    const endurance = selectLever({
      limiter: 'endurance',
      adaptation: verdict('normal'),
      recentLevers: [],
      exhausted: [],
    });
    const speed = selectLever({
      limiter: 'speed_reserve',
      adaptation: verdict('normal'),
      recentLevers: [],
      exhausted: [],
    });
    expect(endurance!.lever).toBe('long_run_duration');
    expect(speed!.lever).toBe('interval_duration');
  });

  it('one lever per cycle — productive overload, not maximal overload', () => {
    const sel = selectLever({
      limiter: 'endurance',
      adaptation: verdict('strong', 1.25),
      recentLevers: [],
      exhausted: [],
    });
    expect(typeof sel!.lever).toBe('string'); // a single lever, never a set
  });

  it('does not pull the same lever two cycles running when an alternative exists', () => {
    const sel = selectLever({
      limiter: 'endurance',
      adaptation: verdict('normal'),
      recentLevers: ['long_run_duration'],
      exhausted: [],
    });
    expect(sel!.lever).not.toBe('long_run_duration');
  });

  it('records what it skipped, so the choice is auditable', () => {
    const sel = selectLever({
      limiter: null,
      adaptation: verdict('normal'),
      recentLevers: [],
      exhausted: ['quality_duration', 'interval_duration'],
    });
    expect(sel!.skipped.map((s) => s.lever)).toContain('quality_duration');
    expect(sel!.skipped[0].reason).toBeTruthy();
  });
});

describe('the challenge zone', () => {
  it('marginal and poor adaptation get established work only', () => {
    expect(assignZone({ adaptation: 'marginal', lever: 'quality_duration', cyclesSinceProbe: 9 })).toBe('ESTABLISHED');
    expect(assignZone({ adaptation: 'poor', lever: 'quality_duration', cyclesSinceProbe: 9 })).toBe('ESTABLISHED');
  });

  it('normal adaptation with a lever to pull gets progressive work', () => {
    expect(assignZone({ adaptation: 'normal', lever: 'quality_duration', cyclesSinceProbe: 9 })).toBe('PROGRESSIVE');
  });

  it('a probe requires strong adaptation, the pace lever, and spacing', () => {
    expect(assignZone({ adaptation: 'strong', lever: 'pace', cyclesSinceProbe: 3 })).toBe('PROBE');
    expect(assignZone({ adaptation: 'strong', lever: 'pace', cyclesSinceProbe: 1 })).toBe('PROGRESSIVE');
    expect(assignZone({ adaptation: 'normal', lever: 'pace', cyclesSinceProbe: 9 })).toBe('PROGRESSIVE');
  });

  it('a probe reaches on the terminal rep only, and says the bail out loud', () => {
    const p = probeShape(shape(3, 10));
    expect(p.terminalPaceSPerMi).toBeLessThan(T_PACE);
    expect(p.shape.paceSPerMi).toBe(T_PACE); // early reps unchanged
    expect(p.instruction).toMatch(/controlled/i);
    expect(p.instruction).toMatch(/not a failed one/i);
  });
});

describe('a successful probe is one observation, not new fitness', () => {
  function probe(succeeded: boolean, controlled = true): ProbeObservation {
    return {
      dateISO: '2026-08-17',
      achievedPaceSPerMi: T_PACE - 12,
      targetPaceSPerMi: T_PACE - 12,
      controlled,
      succeeded,
    };
  }

  it('one good probe does not support a fitness move', () => {
    const r = probesSupportFitnessMove([probe(true)]);
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/not yet a pattern/i);
  });

  it('repeated controlled probes do', () => {
    const r = probesSupportFitnessMove(Array.from({ length: PROBES_FOR_FITNESS_EVIDENCE }, () => probe(true)));
    expect(r.supported).toBe(true);
    expect(r.reason).toMatch(/not one good day/i);
  });

  it('uncontrolled probes generate no usable evidence however fast they were', () => {
    const r = probesSupportFitnessMove(
      Array.from({ length: PROBES_FOR_FITNESS_EVIDENCE + 2 }, () => probe(true, false)),
    );
    expect(r.supported).toBe(false);
  });
});
