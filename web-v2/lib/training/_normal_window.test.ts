/**
 * RULE 8 · the shared filter's own behaviour.
 *
 * The scanner in `lib/audit/_normal_window_scan.test.ts` proves that habit
 * readers REACH this module. This file proves the module is worth reaching:
 * that the window it computes is the one doctrine names, that it refuses
 * rather than answers when the filter leaves too little, and that the refusal
 * cannot be mistaken for a measured zero.
 *
 * The worked case is the owner's own, which is what Rule 8 was written from:
 * Americas Finest City half, 2026-08-16, A priority, 13.1 mi. Taper two weeks
 * before, post-race recovery two weeks after, so 2026-08-02 → 2026-08-30 is
 * not his normal — and a 28-day habit window ending 2026-08-30 contains
 * nothing else at all.
 */
import { describe, it, expect } from 'vitest';
import {
  prescribedWindowFor,
  prescribedWindowsFrom,
  isPrescribedNonNormal,
  excludePrescribedDays,
  representativeDayCount,
  normalTrainingDaySql,
  normalWindowParams,
  weeklyRateFromRepresentative,
  readNormal,
  isRefusal,
  NORMAL_TRAINING_DAY_SQL,
  MIN_REPRESENTATIVE_DAYS,
  type NormalWindow,
} from './normal-window';
import { TAPER_WEEKS_BY_DISTANCE } from './fitness-trajectory';
import { postRaceRecoveryWeeks } from '@/lib/plan/goal-tiers';
import { MIN_COVERAGE_DAYS } from '@/lib/runs/volume';

const AFC = {
  slug: 'americas-finest-city',
  dateISO: '2026-08-16',
  distanceMi: 13.1,
  priority: 'A',
};

describe('RULE 8 · the excluded window is the one doctrine names', () => {
  it('runs from the taper lead-in to the end of post-race recovery', () => {
    const w = prescribedWindowFor(AFC);
    expect(w).not.toBeNull();
    // Not asserted as literals on both sides — that only proves the test agrees
    // with itself. The bounds are re-derived from the doctrine-bound tables and
    // the dates are then checked against the real race.
    expect(w!.taperWeeks).toBe(TAPER_WEEKS_BY_DISTANCE['hm']);
    expect(w!.recoveryWeeks).toBe(postRaceRecoveryWeeks('hm', 'A'));
    expect(w!.fromISO).toBe('2026-08-02');
    expect(w!.toISO).toBe('2026-08-30');
  });

  it('a race whose distance we cannot read opens no window', () => {
    // Same refusal `allowedInterruptionWeeksFor` makes. Inventing a half
    // marathon for an unreadable distance is the defect this codebase refuses
    // everywhere else.
    expect(prescribedWindowFor({ ...AFC, distanceMi: 0 })).toBeNull();
    expect(prescribedWindowFor({ ...AFC, distanceMi: Number.NaN })).toBeNull();
    expect(prescribedWindowFor({ ...AFC, dateISO: 'not-a-date' })).toBeNull();
  });

  it('an unrecognised priority over-excludes rather than under-excludes', () => {
    // `recoveryEffortScale` falls back to the A scale, which is the safe
    // direction: dropping a real training day costs one datum and can only push
    // toward a refusal; admitting one taper day corrupts the identity silently.
    const odd = prescribedWindowFor({ ...AFC, priority: 'hilly-excluded' })!;
    const a = prescribedWindowFor({ ...AFC, priority: 'A' })!;
    expect(odd.recoveryWeeks).toBe(a.recoveryWeeks);
  });

  it('a shorter race earns a shorter window, per distance', () => {
    const fiveK = prescribedWindowFor({ ...AFC, distanceMi: 3.1 })!;
    const marathon = prescribedWindowFor({ ...AFC, distanceMi: 26.2 })!;
    expect(fiveK.taperWeeks).toBeLessThan(marathon.taperWeeks);
    expect(fiveK.recoveryWeeks).toBeLessThan(marathon.recoveryWeeks);
  });
});

describe('RULE 8 · the two implementations of the window cannot drift', () => {
  it('agrees with generate.ts prescribedSpanFor on every distance and priority', async () => {
    // 2026-08-30 · the plan generator landed its own `prescribedSpanFor` the
    // same evening this module landed, reading the same two doctrine tables
    // (`BLOCK_SHAPE[cat].taperWeeks` and `postRaceRecoveryWeeks`) directly. Two
    // implementations of one concept is exactly what Rule 8 warns about, and
    // the reason there are two is structural rather than careless: the
    // generator imports `pg` and is 12k lines, and reaching into it from here
    // would close an import cycle through lib/runs/volume.ts.
    //
    // So they are bound by ASSERTION instead — the same move
    // TAPER.trajectory-build-weeks makes between TAPER_WEEKS_BY_DISTANCE and
    // BLOCK_SHAPE. If either side ever changes what a taper or a recovery
    // window is, this fails and someone has to decide which is right.
    const { prescribedSpanFor } = await import('@/lib/plan/generate');
    for (const distanceMi of [3.1, 6.2, 13.1, 26.2, 50]) {
      for (const priority of ['A', 'B', 'C', null, 'hilly-excluded']) {
        const mine = prescribedWindowFor({ ...AFC, distanceMi, priority });
        const theirs = prescribedSpanFor('2026-08-16', distanceMi, priority);
        const label = `${distanceMi} mi · priority ${String(priority)}`;
        if (theirs == null) {
          // The only way theirs refuses on a readable distance is a zero-length
          // span (a C-priority 5K, where doctrine asks for no recovery week and
          // the taper collapses too). Mine still returns a window; it must be
          // the degenerate one, never a wider claim.
          expect(mine == null || mine.fromISO === mine.toISO, label).toBe(true);
          continue;
        }
        expect(mine, label).not.toBeNull();
        expect(mine!.fromISO, `${label} · taper lead-in`).toBe(theirs.startISO);
        expect(mine!.toISO, `${label} · recovery end`).toBe(theirs.endISO);
      }
    }
  });
});

describe('RULE 8 · the sufficiency floor is the app\'s, not a second one', () => {
  it('MIN_REPRESENTATIVE_DAYS equals MIN_COVERAGE_DAYS', () => {
    // Bound by assertion rather than by import, the same move
    // TAPER_WEEKS_BY_DISTANCE makes against the generator's BLOCK_SHAPE. The
    // import was tried and was wrong: this module is reached from
    // lib/plan/adapt.ts, and a suite that partially mocks @/lib/runs/volume
    // left the constant undefined at load and took an unrelated file down.
    expect(MIN_REPRESENTATIVE_DAYS).toBe(MIN_COVERAGE_DAYS);
  });
});

describe('RULE 8 · the predicate and its SQL twin agree', () => {
  const windows = prescribedWindowsFrom([AFC]);

  it('names the taper, the race and the recovery block, and nothing else', () => {
    expect(isPrescribedNonNormal('2026-08-01', windows)).toBe(false); // day before taper
    expect(isPrescribedNonNormal('2026-08-02', windows)).toBe(true);  // taper opens
    expect(isPrescribedNonNormal('2026-08-16', windows)).toBe(true);  // race day
    expect(isPrescribedNonNormal('2026-08-30', windows)).toBe(true);  // recovery closes
    expect(isPrescribedNonNormal('2026-08-31', windows)).toBe(false); // back to normal
    expect(isPrescribedNonNormal('2026-07-25', windows)).toBe(false); // the real 18.0 long
  });

  it('excludePrescribedDays keeps his real training and drops the taper', () => {
    const rows = [
      { d: '2026-07-25', mi: 18.0 },  // the long Rule 8 says was the truth
      { d: '2026-08-09', mi: 12.37 }, // inside the taper
      { d: '2026-08-16', mi: 13.20 }, // the race itself
      { d: '2026-08-23', mi: 11.01 }, // inside recovery
      { d: '2026-08-31', mi: 8.0 },   // after
    ];
    const kept = excludePrescribedDays(rows, (r) => r.d, windows).map((r) => r.d);
    expect(kept).toEqual(['2026-07-25', '2026-08-31']);
  });

  it('the SQL fragment binds its ranges, never interpolates a date', () => {
    const sql = normalTrainingDaySql(`data->>'date'`, 6, 7);
    expect(sql).toContain('$6::date[]');
    expect(sql).toContain('$7::date[]');
    expect(sql).toContain("data->>'date'");
    expect(sql).not.toContain(':LO');
    expect(sql).not.toContain(':DATE');
    // No literal date may reach the string — the ranges arrive as parameters.
    expect(sql).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    const { lo, hi } = normalWindowParams(windows);
    expect(lo).toEqual(['2026-08-02']);
    expect(hi).toEqual(['2026-08-30']);
  });

  it('with no races every day is normal, in both halves', () => {
    expect(isPrescribedNonNormal('2026-08-16', [])).toBe(false);
    expect(normalWindowParams([])).toEqual({ lo: [], hi: [] });
    // Empty arrays make `unnest` yield no rows, so NOT EXISTS is true.
    expect(NORMAL_TRAINING_DAY_SQL).toContain('NOT EXISTS');
    expect(NORMAL_TRAINING_DAY_SQL).toContain('unnest');
  });
});

describe('RULE 8 · exclude, do not widen', () => {
  const windows = prescribedWindowsFrom([AFC]);

  it('widening the window does not clean it — it only dilutes it', () => {
    // The clause stated as a measurement. Reaching from 28 days back to 90
    // leaves the SAME 29 prescribed days in the sample; all it changes is the
    // share, which is why a reader "fixed" by a bigger number is not fixed.
    const excluded28 = 28 - representativeDayCount('2026-08-03', '2026-08-30', windows);
    const excluded90 = 90 - representativeDayCount('2026-06-02', '2026-08-30', windows);
    expect(excluded28).toBe(28);  // the whole 28-day window is prescribed
    expect(excluded90).toBe(29);  // the same block, plus the one day 08-02 the
                                  // shorter window started after. Widening added
                                  // representative days; it removed no taper.
    expect(excluded90).toBeGreaterThanOrEqual(excluded28);
  });

  it('the denominator is the surviving days, not the nominal window', () => {
    const w: NormalWindow = {
      fromISO: '2026-06-02', toISO: '2026-08-30', windows,
      representativeDays: 61, excludedDays: 29, sufficient: true,
    };
    const r = weeklyRateFromRepresentative(305, w);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // 305 mi over 61 representative days is 35.0 mi/wk. Dividing the same
      // total by the nominal 90 days would read 23.7 — the taper reported as a
      // collapse instead of as absent.
      expect(r.value).toBeCloseTo(35.0, 1);
      expect(r.value).not.toBeCloseTo(305 / (90 / 7), 1);
    }
  });
});

describe('RULE 8 · refuse rather than answer, and never as a zero', () => {
  const windows = prescribedWindowsFrom([AFC]);

  it("the owner's 28-day window on 2026-08-30 survives nothing", () => {
    // The live case that makes this rule concrete. A 28-day habit window ending
    // today is 2026-08-03 → 2026-08-30, and the AFC window is 2026-08-02 →
    // 2026-08-30. Every single day is prescribed.
    expect(representativeDayCount('2026-08-03', '2026-08-30', windows)).toBe(0);
  });

  it('a thin window refuses, and the refusal carries no value at all', () => {
    const w: NormalWindow = {
      fromISO: '2026-08-03', toISO: '2026-08-30', windows,
      representativeDays: 0, excludedDays: 28, sufficient: false,
    };
    const r = readNormal(w, 42);
    expect(r.ok).toBe(false);
    expect(isRefusal(r)).toBe(true);
    // The discriminated union is the whole point: a refusal has no `value`
    // field, so a caller cannot read one without branching first. A zero
    // measured inside a prescribed recovery block and a zero measured off a
    // detrained runner are OPPOSITE FACTS.
    expect('value' in r).toBe(false);
    if (!r.ok) {
      expect(r.refusal.code).toBe('not-enough-representative-training');
      expect(r.refusal.needDays).toBe(MIN_REPRESENTATIVE_DAYS);
      expect(r.refusal.message).toMatch(/taper, race or prescribed recovery/);
    }
  });

  it('a real zero is an answer, and stays distinguishable from a refusal', () => {
    const w: NormalWindow = {
      fromISO: '2026-06-02', toISO: '2026-08-30', windows,
      representativeDays: 61, excludedDays: 29, sufficient: true,
    };
    const detrained = weeklyRateFromRepresentative(0, w);
    expect(detrained.ok).toBe(true);
    if (detrained.ok) expect(detrained.value).toBe(0);
    // Same call shape, opposite meaning, and the two cannot be confused.
    expect(isRefusal(detrained)).toBe(false);
  });
});
