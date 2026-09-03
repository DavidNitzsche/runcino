/**
 * lib/plan/validate.ts §9 · SEP-1 (2026-09-03)
 *
 * David's ruling replacing the flat universal two-easy-day rule with a
 * requirement typed by what the PRECEDING session actually demanded. See
 * `requiredSeparationDays`'s own header comment in validate.ts for his
 * verbatim wording; this file tests it against his three worked examples,
 * the Rule 9 boundary walk he asked for explicitly, and the Dodgers-weekend
 * regression (the exception must still validate exactly as
 * `designed-race-weekend.ts` already grants it).
 *
 * FATAL vs ADVISORY — see the comment above §9 in validate.ts. The "at least
 * ONE" clauses (ordinary quality, and the immediate-next-day rule for a long
 * run of ANY size) are fatal. The "normally TWO" clauses for a 16-18mi
 * intense / 18-plus / marathon-pace long run are measured and reported
 * (`SEPARATION_BAND_SHORTFALL`, advisory) but not yet fatal, because
 * `scheduleQuality` in generate.ts does not yet place quality against the
 * long run's own classification — only against the quality sessions'
 * types — and a fatal 2-day gate was falsified against real `buildSimPlan`
 * output before landing (see the commit message / report for the corpus
 * this broke and was reverted from).
 */
import { describe, it, expect } from 'vitest';
import { validateComposedPlan, requiredSeparationDays } from './validate';
import type { PlanValidationContext, ValidateOptions } from './validate';
import type { ComposePlanResult, ComposedWeek } from './generate';
import type { StressFinding } from './combined-stress';

// ── minimal day factories, mirroring validate.test.ts's pattern ────────────
// DayPlan is not exported with a literal DOW union TS can infer from a plain
// number, so these return `any` — the same convention validate.test.ts uses.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function day(dow: number, type: string, mi: number, opts: Record<string, unknown> = {}): any {
  return {
    dow, type, distanceMi: mi,
    isQuality: type !== 'easy' && type !== 'rest' && type !== 'long',
    isLong: type === 'long',
    subLabel: type.toUpperCase(), notes: '',
    ...opts,
  };
}
const easyDay = (dow: number, mi = 6) => day(dow, 'easy', mi);
const restDay = (dow: number) => day(dow, 'rest', 0);
// Small mi on purpose: Daniels' weekly dosing cap (§10, unconditional and
// fatal) binds a quality session's parsed dose to ≤10% of the week's total —
// unrelated to SEP-1, but every SEP-1 fixture still has to clear it.
const qualityDay = (dow: number, type: 'intervals' | 'threshold' | 'tempo' = 'threshold', mi = 2) =>
  day(dow, type, mi, { isQuality: true });
const longDay = (dow: number, mi: number, extra: Record<string, unknown> = {}) =>
  day(dow, 'long', mi, { isQuality: false, isLong: true, ...extra });

function maintenancePlan(weeks: ComposedWeek[], authoredState: Record<string, unknown> = {}): ComposePlanResult {
  return {
    weeks,
    blocks: { totalWeeks: weeks.length, phases: [{ label: 'BASE', weeks: weeks.length, rationale: '', citation: '' }] },
    totalWeeks: weeks.length,
    vols: weeks.map((w) => w.weeklyMi),
    authoredState,
  };
}
function week(startISO: string, days: ReturnType<typeof day>[], weeklyMi = 40): ComposedWeek {
  return { startISO, phase: 'BASE', weeklyMi, days, isRaceWeek: false };
}

const TODAY = '2026-09-01';
const CTX: PlanValidationContext = {
  level: 'advanced', isSteppingStoneToMarathon: false, priorPlanPeakLongMi: null,
  todayISO: TODAY, trailingAvgWeeklyMi: null,
};
const validate = (weeks: ComposedWeek[], authoredState: Record<string, unknown> = {}, opts?: ValidateOptions) =>
  validateComposedPlan(maintenancePlan(weeks, authoredState), 26.2, 'maintenance', CTX, opts);

// ── requiredSeparationDays · pure-function unit tests ───────────────────────

describe('requiredSeparationDays', () => {
  it('ordinary interval/threshold/tempo session → min 1 (bullet 1; resolves the old intervals=2 divergence)', () => {
    expect(requiredSeparationDays(qualityDay(2, 'intervals')).min).toBe(1);
    expect(requiredSeparationDays(qualityDay(2, 'threshold')).min).toBe(1);
    expect(requiredSeparationDays(qualityDay(2, 'tempo')).min).toBe(1);
  });

  it('a fartlek (type=easy, isQuality=true) needs no gap — FARTLEK-GAP-1 preserved', () => {
    expect(requiredSeparationDays(day(2, 'easy', 6, { isQuality: true })).min).toBe(0);
  });

  it('long run under ~16mi, fully easy → min 1 (bullet 1)', () => {
    expect(requiredSeparationDays(longDay(0, 15)).min).toBe(1);
    expect(requiredSeparationDays(longDay(0, 15.9)).min).toBe(1);
  });

  it('long run 16-18mi, no carried intensity → min 1, max 2 (a mostly-easy 17-miler reads the bottom)', () => {
    const r = requiredSeparationDays(longDay(0, 17));
    expect(r.min).toBe(1);
    expect(r.max).toBe(2);
  });

  it('long run 16-18mi carrying quality/progression → min 2 (the top of the band)', () => {
    expect(requiredSeparationDays(longDay(0, 17, { isQuality: true })).min).toBe(2);
    expect(requiredSeparationDays(longDay(0, 17, { longRunKind: 'progression' })).min).toBe(2);
    expect(requiredSeparationDays(longDay(0, 17, { longRunKind: 'fast_finish' })).min).toBe(2);
  });

  it('long run 18mi-plus → min 2 (bullet 3)', () => {
    expect(requiredSeparationDays(longDay(0, 18)).min).toBe(2);
    expect(requiredSeparationDays(longDay(0, 22)).min).toBe(2);
  });

  it('long run of ANY distance carrying marathon-pace work → min 2, flat ("regardless of total distance")', () => {
    for (const kind of ['mp_long', 'dress_rehearsal', 'modified_block', 'downhill_simulation']) {
      for (const mi of [8, 12, 15.9, 16, 18, 22]) {
        expect(requiredSeparationDays(longDay(0, mi, { longRunKind: kind })).min).toBe(2);
      }
    }
  });

  // ── Rule 9 · boundary walk ────────────────────────────────────────────────
  // "confirm the requirement changes by DEGREE (1 day vs 2 days, a small,
  // stated step) not by some other discontinuous jump — a mile of extra
  // distance must never produce a wildly different validator outcome beyond
  // the stated 1-vs-2-day step."

  it('Rule 9 walk · fully-easy long, 14mi→22mi in 0.1mi steps: min only ever steps by ≤1, and only at 18mi', () => {
    let prev = requiredSeparationDays(longDay(0, 14)).min;
    const steps: Array<{ mi: number; min: number }> = [{ mi: 14, min: prev }];
    for (let tenths = 141; tenths <= 220; tenths++) {
      const mi = tenths / 10;
      const cur = requiredSeparationDays(longDay(0, mi)).min;
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual(1);
      if (cur !== prev) steps.push({ mi, min: cur });
      prev = cur;
    }
    // exactly one step across the whole walk, and it lands at 18.0mi
    expect(steps.length).toBe(2);
    expect(steps[1]).toEqual({ mi: 18, min: 2 });
  });

  it('Rule 9 walk · marathon-pace long, 8mi→22mi: flat at 2, zero steps', () => {
    let prev = requiredSeparationDays(longDay(0, 8, { longRunKind: 'mp_long' })).min;
    expect(prev).toBe(2);
    for (let mi = 8.1; mi <= 22; mi = Math.round((mi + 0.1) * 10) / 10) {
      const cur = requiredSeparationDays(longDay(0, mi, { longRunKind: 'mp_long' })).min;
      expect(cur).toBe(2);
      expect(cur).toBe(prev);
      prev = cur;
    }
  });

  it('Rule 9 walk · progression-finish long, 14mi→22mi: the only step is ≤16mi min1 → ≥16mi min2, at 16.0mi', () => {
    let prev = requiredSeparationDays(longDay(0, 14, { longRunKind: 'progression' })).min;
    const steps: Array<{ mi: number; min: number }> = [];
    for (let tenths = 141; tenths <= 220; tenths++) {
      const mi = tenths / 10;
      const cur = requiredSeparationDays(longDay(0, mi, { longRunKind: 'progression' })).min;
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual(1);
      if (cur !== prev) steps.push({ mi, min: cur });
      prev = cur;
    }
    expect(steps).toEqual([{ mi: 16, min: 2 }]);
  });
});

// ── the three worked examples, end to end through validateComposedPlan ─────

describe('SEP-1 · the three worked examples', () => {
  it('1 · ordinary week — Thu quality → Fri easy → Sat rest → Sun long — clearly VALID', () => {
    const w = week('2026-09-06', [
      qualityDay(4, 'threshold'), easyDay(5), restDay(6), longDay(0, 12),
    ]);
    expect(() => validate([w])).not.toThrow();
  });

  it('2 · rescheduled Saturday 15mi EASY long — Thu quality → Fri easy → Sat long — only ONE low-stress day, still ACCEPTABLE', () => {
    // This is the case that proves the old flat two-day rule was wrong: it
    // would have rejected this.
    const w = week('2026-09-06', [
      qualityDay(4, 'threshold'), easyDay(5), longDay(6, 15),
    ]);
    expect(() => validate([w])).not.toThrow();
  });

  it('3a · Monday long → Tuesday quality — MUST fail, regardless of the long run\'s own size', () => {
    for (const mi of [10, 17, 20]) {
      const w = week('2026-09-06', [
        longDay(1, mi), qualityDay(2, 'threshold'), easyDay(3), easyDay(4),
      ]);
      expect(() => validate([w])).toThrow(/only 0 easy day/);
    }
  });

  it('3b · Monday long → Wednesday-or-later quality — passes (the immediate-next-day rule is satisfied)', () => {
    const w = week('2026-09-06', [
      longDay(1, 12), easyDay(2), qualityDay(3, 'threshold'), easyDay(4),
    ]);
    expect(() => validate([w])).not.toThrow();
  });
});

// ── ordinary quality-to-quality separation (bullet 1) ───────────────────────

describe('SEP-1 · ordinary quality-to-quality separation', () => {
  it('0-day gap between two quality sessions is FATAL', () => {
    const w = week('2026-09-06', [
      qualityDay(2, 'intervals'), qualityDay(3, 'threshold'), easyDay(4), easyDay(5), longDay(0, 10),
    ]);
    expect(() => validate([w])).toThrow();
  });

  it('1-day gap after an INTERVALS session now PASSES — resolves the intervals=2 divergence', () => {
    // Old flat rule: intervals required 2 easy days. David's ruling: 1, same
    // as threshold. Tue intervals → Wed easy → Thu threshold.
    const w = week('2026-09-06', [
      qualityDay(2, 'intervals'), easyDay(3), qualityDay(4, 'threshold'), easyDay(5), longDay(0, 10),
    ]);
    expect(() => validate([w])).not.toThrow();
  });
});

// ── a race's separation requirement — out of §9's scope by design ──────────

describe('SEP-1 · a race day carries no §9 separation requirement', () => {
  it('a race sitting 0 days from quality or the long is not §9\'s question — it is combined-stress.ts\'s', () => {
    // race excluded from hard[] by the same filter §9 has always used
    // (type !== 'race'); §11 / §11c own race-adjacent stress instead.
    const w = week('2026-09-06', [
      day(5, 'race', 6.2), longDay(6, 10),
    ]);
    expect(() => validate([w])).not.toThrow();
  });
});

// ── DESIGNEDWEEKEND-1 · the Dodgers-weekend exception, regression ──────────

describe('SEP-1 · the designed-race-weekend exception', () => {
  const grantedWeek = () => week('2026-09-06', [
    // Sunday: an 18mi marathon-pace-carrying long run (would need 2 days
    // after it), immediately followed by Monday quality — 0 days between.
    longDay(0, 18, { longRunKind: 'mp_long' }),
    qualityDay(1, 'threshold'),
    easyDay(2), easyDay(3),
  ]);
  const grant = {
    placement_compromises: [
      { raceDateISO: '2026-09-05', dateISO: '2026-09-06', designedWeekend: { combinedMi: 24.2 } },
    ],
  };

  it('without a grant, the same 0-day gap is FATAL', () => {
    expect(() => validate([grantedWeek()])).toThrow(/only 0 easy day/);
  });

  it('with the grant recorded on placement_compromises, §9 defers — validates clean', () => {
    expect(() => validate([grantedWeek()], grant)).not.toThrow();
  });

  it('a REFUSED grant (recorded refusal, no designedWeekend.combinedMi) does NOT exempt §9', () => {
    const refused = {
      placement_compromises: [
        { raceDateISO: '2026-09-05', dateISO: '2026-09-06', refusedDesignedWeekend: { code: 'NO_EVIDENCE' } },
      ],
    };
    expect(() => validate([grantedWeek()], refused)).toThrow(/only 0 easy day/);
  });
});

// ── FATAL vs ADVISORY split ──────────────────────────────────────────────────

describe('SEP-1 · the 2-day band is advisory (SEPARATION_BAND_SHORTFALL), not yet fatal', () => {
  it('an 18mi long run followed by quality after only 1 day PASSES (fatal floor is 1) but is reported', () => {
    const w = week('2026-09-06', [
      longDay(0, 18), easyDay(1), qualityDay(2, 'threshold'), easyDay(3), easyDay(4),
    ]);
    let seen: StressFinding[] = [];
    expect(() => validate([w], {}, { onStress: (f) => { seen = f; } })).not.toThrow();
    const shortfall = seen.filter((f) => f.code === 'SEPARATION_BAND_SHORTFALL');
    expect(shortfall.length).toBe(1);
    expect(shortfall[0].enforced).toBe(false);
  });

  it('a 12mi fully-easy long run followed by quality after 1 day PASSES with NO advisory finding (band is satisfied)', () => {
    const w = week('2026-09-06', [
      longDay(0, 12), easyDay(1), qualityDay(2, 'threshold'), easyDay(3), easyDay(4),
    ]);
    let seen: StressFinding[] = [];
    expect(() => validate([w], {}, { onStress: (f) => { seen = f; } })).not.toThrow();
    expect(seen.filter((f) => f.code === 'SEPARATION_BAND_SHORTFALL').length).toBe(0);
  });
});
