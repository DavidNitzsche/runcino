/**
 * lib/evidence/_reexamination.test.ts · the belief-tension consumer's gate.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · It cannot tell whether `reexaminationWeight` is a GOOD number. It only
 *     checks that this file does not branch on it.
 *   · It cannot see whether the relaxed bar produced a BETTER belief. That is a
 *     capacity question and it is answered, for one real runner, in
 *     `_capacity_resolver.audit.test.ts`.
 *   · It has no opinion about whether tension SHOULD ever lower a bar. It
 *     checks that when it does, it does so by one step and no further.
 */
import { describe, it, expect } from 'vitest';
import {
  REEXAMINATION_FLOOR_MIN_OBSERVATIONS,
  REEXAMINATION_MIN_OBSERVATIONS,
  REEXAMINATION_WINDOW_DAYS,
  accumulateReexamination,
  tensionObservationsFrom,
  type TensionObservation,
} from './reexamination';
import { CAPACITY_CONFIDENCE_HALF_LIFE_DAYS } from '@/lib/training/capacity-resolver';
import { CORROBORATION_MIN_OBSERVATIONS } from '@/lib/training/vdot-corpus';

const TODAY = '2026-08-31';

const obs = (
  dateISO: string,
  direction: TensionObservation['direction'] = 'observation_stronger_than_belief',
  reexaminationWeight = 0.5,
): TensionObservation => ({
  activityId: `run-${dateISO}`,
  dateISO,
  capacity: 'threshold',
  direction,
  reexaminationWeight,
});

const run = (observations: TensionObservation[], base = CORROBORATION_MIN_OBSERVATIONS) =>
  accumulateReexamination({ capacity: 'threshold', observations, baseMinObservations: base, todayISO: TODAY });

describe('reexamination · Rule 16 · one half-life, not two opinions about ageing', () => {
  it('the window equals the confidence half-life it is written to match', () => {
    // The header says these must be equal and cannot import one from the other
    // without closing a module cycle. This is the gate that keeps them equal.
    expect(REEXAMINATION_WINDOW_DAYS).toBe(CAPACITY_CONFIDENCE_HALF_LIFE_DAYS);
  });
});

describe('reexamination · what it refuses to do', () => {
  it('no observations · the bar is untouched and says so', () => {
    const p = run([]);
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS);
    expect(p.direction).toBe('none');
    expect(p.reasons).toContain('NO_TENSION_OBSERVED');
  });

  it('ONE observation is not corroboration · the bar is untouched', () => {
    const p = run([obs('2026-08-30', 'observation_stronger_than_belief', 0.99)]);
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS);
    expect(p.reasons).toContain('TENSION_BELOW_REPETITION_FLOOR');
  });

  it('CONFLICTING directions relax nothing, however much pressure accumulates', () => {
    const p = run([
      obs('2026-08-30', 'observation_stronger_than_belief', 0.9),
      obs('2026-08-28', 'observation_weaker_than_belief', 0.9),
      obs('2026-08-26', 'observation_stronger_than_belief', 0.9),
    ]);
    expect(p.direction).toBe('conflicting');
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS);
    expect(p.reasons).toContain('CONFLICTING_TENSION_DIRECTIONS');
  });

  it('observations outside the window do not count, and the drop is stated', () => {
    const stale = new Date(Date.parse(`${TODAY}T00:00:00Z`) - (REEXAMINATION_WINDOW_DAYS + 5) * 86_400_000)
      .toISOString().slice(0, 10);
    const p = run([obs(stale), obs(stale)]);
    expect(p.observations).toHaveLength(0);
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS);
    expect(p.reasons).toContain('TENSION_OUTSIDE_WINDOW');
  });

  it('NEVER RAISES the bar, whatever the base is', () => {
    for (const base of [1, 2, 3, 4, 8]) {
      const p = run([obs('2026-08-30'), obs('2026-08-28'), obs('2026-08-26')], base);
      expect(p.effectiveMinObservations).toBeLessThanOrEqual(base);
    }
  });

  it('NEVER lowers a bar that is already at or below the floor', () => {
    // The guarantee is RELATIVE, and the distinction matters: this module may
    // not lower a bar past `REEXAMINATION_FLOOR_MIN_OBSERVATIONS`, but it also
    // does not RAISE a caller who arrived below it. A base of 1 comes back as
    // 1 — untouched, not "floored up" — because raising a bar is not this
    // module's to do either. Written as the relative invariant after an
    // absolute assertion here failed on exactly that case.
    for (const base of [1, 2]) {
      const p = run([obs('2026-08-30'), obs('2026-08-28')], base);
      expect(p.effectiveMinObservations).toBe(base);
    }
    // And at the production base, the floor binds rather than the step.
    const atFloorPlusOne = run([obs('2026-08-30'), obs('2026-08-28')], 3);
    expect(atFloorPlusOne.effectiveMinObservations)
      .toBeGreaterThanOrEqual(REEXAMINATION_FLOOR_MIN_OBSERVATIONS);
  });

  it('the floor CLAMPS a deep base rather than letting the step run past it', () => {
    // A base of exactly floor+1 steps to the floor and stops; the clamp reason
    // fires only when the unclamped step would have gone under.
    const clamped = run([obs('2026-08-30'), obs('2026-08-28')], REEXAMINATION_FLOOR_MIN_OBSERVATIONS);
    expect(clamped.effectiveMinObservations).toBe(REEXAMINATION_FLOOR_MIN_OBSERVATIONS);
    expect(clamped.reasons).toContain('RELAXATION_CLAMPED_AT_FLOOR');
  });
});

describe('reexamination · what it does', () => {
  it('repeated same-direction tension lowers the bar by exactly ONE', () => {
    const p = run([obs('2026-08-30'), obs('2026-08-28')]);
    expect(p.direction).toBe('stronger');
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS - 1);
    expect(p.reasons).toContain('REPEATED_TENSION_LOWERED_THE_CORROBORATION_BAR');
  });

  it('MORE tension does not lower it further · one step is the whole allowance', () => {
    const many = ['2026-08-30', '2026-08-29', '2026-08-28', '2026-08-27', '2026-08-26', '2026-08-25']
      .map((d) => obs(d, 'observation_stronger_than_belief', 0.99));
    const two = run(many.slice(0, 2));
    const six = run(many);
    expect(six.effectiveMinObservations).toBe(two.effectiveMinObservations);
  });

  it('a WEAKER-direction tension relaxes the same way · the mechanism is not upward-only', () => {
    // The bar being relaxed is about how much corroboration is needed, not
    // about which way the belief moves. An engine that only became receptive to
    // GOOD news would be the Rule 21 defect pointed at the Runner Model.
    const p = run([
      obs('2026-08-30', 'observation_weaker_than_belief'),
      obs('2026-08-28', 'observation_weaker_than_belief'),
    ]);
    expect(p.direction).toBe('weaker');
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS - 1);
  });
});

describe('reexamination · Rule 9 · the decision does not hinge on a hair', () => {
  it('the relaxation is identical across the entire weight range', () => {
    // THE FALSIFIER for the cliff this file was written to avoid. If a future
    // edit reintroduces a `pressure >= X` gate, two of these land on different
    // sides of it and this test goes red.
    const floors = new Set<number>();
    for (let w = 0.001; w <= 1.0; w += 0.001) {
      const p = run([
        obs('2026-08-30', 'observation_stronger_than_belief', w),
        obs('2026-08-28', 'observation_stronger_than_belief', w),
      ]);
      floors.add(p.effectiveMinObservations);
    }
    expect([...floors]).toEqual([CORROBORATION_MIN_OBSERVATIONS - 1]);
  });

  it('pressure is still REPORTED, and moves continuously with the weights', () => {
    const low = run([obs('2026-08-30', 'observation_stronger_than_belief', 0.10),
      obs('2026-08-28', 'observation_stronger_than_belief', 0.10)]);
    const high = run([obs('2026-08-30', 'observation_stronger_than_belief', 0.90),
      obs('2026-08-28', 'observation_stronger_than_belief', 0.90)]);
    expect(high.pressure).toBeGreaterThan(low.pressure);
    expect(low.pressure).toBeGreaterThan(0);
    expect(high.pressure).toBeLessThanOrEqual(1);
  });

  it('pressure decays with age, and a same-day pair beats an older pair', () => {
    const fresh = run([obs('2026-08-31'), obs('2026-08-30')]);
    const older = run([obs('2026-08-10'), obs('2026-08-09')]);
    expect(fresh.pressure).toBeGreaterThan(older.pressure);
  });
});

describe('reexamination · Rule 11 across the lift', () => {
  it('a refusal arm is DROPPED, never turned into a zero-weight observation', () => {
    const lifted = tensionObservationsFrom([
      { activityId: 'a', dateISO: '2026-08-30', tension: { ok: false } },
      {
        activityId: 'b', dateISO: '2026-08-29',
        tension: {
          ok: true, capacity: 'threshold',
          direction: 'observation_stronger_than_belief', reexaminationWeight: 0.4,
        },
      },
    ]);
    expect(lifted).toHaveLength(1);
    expect(lifted[0].activityId).toBe('b');
  });

  it('observations for another capacity do not contribute to this one', () => {
    const p = accumulateReexamination({
      capacity: 'durability',
      observations: [obs('2026-08-30'), obs('2026-08-28')],
      baseMinObservations: CORROBORATION_MIN_OBSERVATIONS,
      todayISO: TODAY,
    });
    expect(p.observations).toHaveLength(0);
    expect(p.effectiveMinObservations).toBe(CORROBORATION_MIN_OBSERVATIONS);
  });
});

describe('reexamination · the constants say what they are', () => {
  it('the repetition floor is at least two · one run is not corroboration', () => {
    expect(REEXAMINATION_MIN_OBSERVATIONS).toBeGreaterThanOrEqual(2);
    expect(REEXAMINATION_FLOOR_MIN_OBSERVATIONS).toBeGreaterThanOrEqual(2);
  });
});
