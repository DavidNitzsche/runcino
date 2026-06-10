/**
 * lib/plan/validate.ts · unit tests
 *
 * Falsifiers:
 *   F1  HM plan with 17mi long run is REJECTED (experienced cap = 16mi)
 *   F2  HM plan with no taper is REJECTED
 *   F3  Valid HM plan (current active plan shape) PASSES
 *   F4  HM + stepping stone to marathon: 17mi long run PASSES (cap = 20mi)
 *   F5  HM + beginner: 15mi long run REJECTED (cap = 14mi)
 *   F6  Corruption check: new peak 7mi when prior was 12mi → REJECTED
 *   F7  Corruption check: new peak 10mi when prior was 12mi → PASSES
 *   F8  Past-week quality gap is skipped (sealed-day guard)
 *   F9  Future quality-phase week with no quality session → REJECTED
 *   F10 Maintenance plan skips taper + quality checks
 */

import { describe, it, expect } from 'vitest';
import { validateComposedPlan, PlanValidationError } from './validate';
import type { PlanValidationContext } from './validate';
import type { ComposePlanResult, ComposedWeek, BlockPlan } from './generate';

// ── minimal day factories ─────────────────────────────────────────────────────
// DayPlan is not exported from generate.ts and uses the DOW union type
// (0|1|2|3|4|5|6) which TypeScript won't infer from a plain number literal.
// Return `any` so test mutation sites (days[0] = longDay(...)) compile cleanly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function easyDay(mi: number): any {
  return { dow: 1, type: 'easy', distanceMi: mi, isQuality: false, isLong: false, subLabel: 'EASY', notes: '' };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function longDay(mi: number): any {
  return { dow: 0, type: 'long', distanceMi: mi, isQuality: false, isLong: true, subLabel: 'LONG', notes: '' };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function qualityDay(): any {
  return { dow: 2, type: 'intervals', distanceMi: 6, isQuality: true, isLong: false, subLabel: 'INTERVALS', notes: '' };
}

function makeWeek(
  startISO: string,
  phase: string,
  weeklyMi: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  days: any[],
  isRaceWeek = false,
): ComposedWeek {
  return { startISO, phase, weeklyMi, days, isRaceWeek };
}

function makeBlocks(withTaper = true): BlockPlan {
  const phases: BlockPlan['phases'] = [
    { label: 'QUALITY',       weeks: 4, rationale: '', citation: '' },
    { label: 'RACE-SPECIFIC', weeks: 2, rationale: '', citation: '' },
  ];
  if (withTaper) phases.push({ label: 'TAPER', weeks: 2, rationale: '', citation: '' });
  return { totalWeeks: withTaper ? 9 : 7, phases };
}

/**
 * Valid HM plan: 9 weeks, quality in every quality-phase week, taper drops
 * ≥ 30% vs peak, long ≤ 16mi, no WoW spike. Mirrors the current active plan.
 */
function validHmPlan(): ComposePlanResult {
  const weeks: ComposedWeek[] = [
    // QUALITY phase: weeks 0–3 (all future from TODAY=2026-06-07)
    makeWeek('2026-06-07', 'QUALITY',       35, [longDay(10), qualityDay(), easyDay(6), easyDay(6), easyDay(7)]),
    makeWeek('2026-06-14', 'QUALITY',       37, [longDay(11), qualityDay(), easyDay(6), easyDay(7), easyDay(7)]),
    makeWeek('2026-06-21', 'QUALITY',       39, [longDay(12), qualityDay(), easyDay(7), easyDay(7), easyDay(7)]),
    makeWeek('2026-06-28', 'QUALITY',       41, [longDay(13), qualityDay(), easyDay(7), easyDay(7), easyDay(7)]),
    // RACE-SPECIFIC: weeks 4–5
    makeWeek('2026-07-05', 'RACE-SPECIFIC', 43, [longDay(14), qualityDay(), easyDay(7), easyDay(8), easyDay(7)]),
    makeWeek('2026-07-12', 'RACE-SPECIFIC', 43, [longDay(14), qualityDay(), easyDay(7), easyDay(8), easyDay(7)]),
    // TAPER: weeks 6–7 (~60% and ~47% of peak 43mi → >30% drop each)
    makeWeek('2026-07-19', 'TAPER',         26, [longDay(10), easyDay(5), easyDay(5), easyDay(6)]),
    makeWeek('2026-07-26', 'TAPER',         20, [longDay(8),  easyDay(4), easyDay(4), easyDay(4)]),
    // RACE WEEK
    makeWeek('2026-08-02', 'TAPER',          8, [easyDay(3), easyDay(3), easyDay(2)], true),
  ];
  return { weeks, blocks: makeBlocks(), totalWeeks: 9, vols: weeks.map(w => w.weeklyMi), authoredState: {} };
}

const TODAY = '2026-06-07';
const BASE_CTX: PlanValidationContext = {
  level: 'advanced',
  isSteppingStoneToMarathon: false,
  priorPlanPeakLongMi: null,
  todayISO: TODAY,
  trailingAvgWeeklyMi: null,
};

// ── F1–F3: long-run cap + taper ───────────────────────────────────────────────

describe('validateComposedPlan · doctrine caps', () => {

  it('F1 — 17mi long is REJECTED for experienced HM (cap 16mi)', () => {
    const plan = validHmPlan();
    plan.weeks[4].days[0] = longDay(17);
    let caught: unknown;
    try { validateComposedPlan(plan, 13.1, 'race-prep', BASE_CTX); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PlanValidationError);
    const viol = (caught as PlanValidationError).violations[0];
    expect(viol).toMatch(/17mi/);
    expect(viol).toMatch(/16mi/);
  });

  it('F2 — no TAPER phase is REJECTED', () => {
    const plan = validHmPlan();
    plan.blocks = makeBlocks(false);
    let caught: unknown;
    try { validateComposedPlan(plan, 13.1, 'race-prep', BASE_CTX); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).violations.some(v => /taper/i.test(v))).toBe(true);
  });

  it('F3 — valid HM plan PASSES', () => {
    expect(() => validateComposedPlan(validHmPlan(), 13.1, 'race-prep', BASE_CTX)).not.toThrow();
  });

  it('F4 — 17mi long PASSES when HM is stepping stone to marathon (cap 20mi)', () => {
    const plan = validHmPlan();
    // Ramp week 3 to 14mi first (was 13mi) so the WoW into week 4's 17mi is
    // 17/14 = 21% — within the 30% WoW limit. Tests the cap only.
    plan.weeks[3].days[0] = longDay(14);
    plan.weeks[4].days[0] = longDay(17);
    const ctx: PlanValidationContext = { ...BASE_CTX, isSteppingStoneToMarathon: true };
    expect(() => validateComposedPlan(plan, 13.1, 'race-prep', ctx)).not.toThrow();
  });

  it('F5 — 15mi long is REJECTED for beginner HM (cap 14mi)', () => {
    const plan = validHmPlan();
    plan.weeks[4].days[0] = longDay(15);
    const ctx: PlanValidationContext = { ...BASE_CTX, level: 'beginner' };
    let caught: unknown;
    try { validateComposedPlan(plan, 13.1, 'race-prep', ctx); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).violations[0]).toMatch(/beginner/);
  });

});

// ── F6–F7: prior-plan corruption check ───────────────────────────────────────

describe('validateComposedPlan · prior-plan corruption check', () => {

  it('F6 — new peak 7mi when prior was 12mi is REJECTED (< 80% floor)', () => {
    const plan = validHmPlan();
    // Replace every long day with 7mi.
    for (const w of plan.weeks) {
      w.days = w.days.map(d => (d as { isLong: boolean }).isLong ? longDay(7) : d);
    }
    const ctx: PlanValidationContext = { ...BASE_CTX, priorPlanPeakLongMi: 12 };
    let caught: unknown;
    try { validateComposedPlan(plan, 13.1, 'race-prep', ctx); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect(
      (caught as PlanValidationError).violations.some(v => /corruption|80%/i.test(v)),
    ).toBe(true);
  });

  it('F7 — new peak 10mi when prior was 12mi PASSES (≥ 80% floor)', () => {
    const plan = validHmPlan();
    for (const w of plan.weeks) {
      w.days = w.days.map(d => (d as { isLong: boolean }).isLong ? longDay(10) : d);
    }
    const ctx: PlanValidationContext = { ...BASE_CTX, priorPlanPeakLongMi: 12 };
    expect(() => validateComposedPlan(plan, 13.1, 'race-prep', ctx)).not.toThrow();
  });

});

// ── F8–F9: sealed-day guard ───────────────────────────────────────────────────

describe('validateComposedPlan · sealed-day guard (quality check)', () => {

  it('F8 — past quality-phase week with no quality session is SKIPPED', () => {
    // weekEndISO = 2026-05-31 + 6 = 2026-06-06 < TODAY (2026-06-07) → past week.
    const plan = validHmPlan();
    plan.weeks[0] = makeWeek('2026-05-31', 'QUALITY', 35, [longDay(10), easyDay(6), easyDay(6), easyDay(7), easyDay(6)]);
    expect(() => validateComposedPlan(plan, 13.1, 'race-prep', BASE_CTX)).not.toThrow();
  });

  it('F9 — future quality-phase week with no quality session is REJECTED', () => {
    const plan = validHmPlan();
    // Week 1 starts 2026-06-14 — entirely future. Strip quality.
    plan.weeks[1].days = [longDay(11), easyDay(7), easyDay(7), easyDay(7), easyDay(6)];
    let caught: unknown;
    try { validateComposedPlan(plan, 13.1, 'race-prep', BASE_CTX); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PlanValidationError);
    expect((caught as PlanValidationError).violations.some(v => /quality/i.test(v))).toBe(true);
  });

});

// ── F10: non-race-prep modes ──────────────────────────────────────────────────

describe('validateComposedPlan · non-race-prep modes', () => {

  it('F10 — maintenance plan (no taper, no quality phases) PASSES', () => {
    const maintenanceWeeks: ComposedWeek[] = [
      makeWeek('2026-06-07', 'BASE', 30, [longDay(8), easyDay(5), easyDay(5), easyDay(6), easyDay(6)]),
      makeWeek('2026-06-14', 'BASE', 33, [longDay(9), easyDay(5), easyDay(6), easyDay(6), easyDay(7)]),
      makeWeek('2026-06-21', 'BASE', 36, [longDay(10), easyDay(6), easyDay(6), easyDay(7), easyDay(7)]),
    ];
    const plan: ComposePlanResult = {
      weeks: maintenanceWeeks,
      blocks: { totalWeeks: 3, phases: [{ label: 'BASE', weeks: 3, rationale: '', citation: '' }] },
      totalWeeks: 3,
      vols: [30, 33, 36],
      authoredState: {},
    };
    expect(() => validateComposedPlan(plan, 13.1, 'maintenance', BASE_CTX)).not.toThrow();
  });

});
