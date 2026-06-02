/**
 * lib/plan/generator-bench.test.ts · GENERATOR bench.
 *
 * Companion to plan-engine.test.ts (simulator bench). This file tests
 * what the existing bench misses · the REAL generator output against
 * each persona's expectedPlan doctrine targets.
 *
 * The architectural hole David flagged 2026-06-02: the prior plan-engine
 * sprint shipped a simulator test that constructs a hand-built ideal
 * trajectory and feeds it to simulate(). That validates the simulator,
 * not the generator. Real generator bugs (volume ramp broken by
 * easyMileFloor, longShare goal-blind, race-pace label hardcoded) slipped
 * through CI because composePlan() was never called.
 *
 * Phase 2 of the rebuild: this file calls composePlan() for each persona
 * with persona-derived ComposePlanInput, then asserts the resulting
 * weeks[] match the persona's expectedPlan targets.
 *
 * Today this file produces FAILING assertions for the personas where
 * the generator policy is broken. Phase 3 fixes the policy until all
 * pass · then no plan-engine PR can merge without satisfying these
 * assertions.
 *
 * Cite: docs/PLAN_ENGINE_ARCHITECTURE.md
 * Cite: Research/22-plan-templates.md
 */

import { describe, it, expect } from 'vitest';
import { PERSONAS, type SyntheticRunner } from './synthetic-runners';
import {
  composePlan,
  inlinePrescriptions,
  distanceCategoryOfPublic,
  parseGoalSeconds,
  type ComposePlanInput,
  type DOW,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

describe('parseGoalSeconds · accepts multiple goal-time formats', () => {
  it.each([
    ['1:30:00', 5400],
    ['1:30',    5400],   // H:MM · David's race meta format (sub-1:30 HM)
    ['3:00:00', 10800],
    ['3:00',    10800],
    ['1:35',    5700],
    ['25:00',   1500],   // MM:SS · 25-minute 5K finish time
    ['18:30',   1110],   // MM:SS · 18:30 5K time
  ])('parseGoalSeconds(%s) = %s', (input, expected) => {
    expect(parseGoalSeconds(input)).toBe(expected);
  });

  it('rejects null + non-time strings', () => {
    expect(parseGoalSeconds(null)).toBe(null);
    expect(parseGoalSeconds(undefined)).toBe(null);
    expect(parseGoalSeconds('')).toBe(null);
    expect(parseGoalSeconds('xyz')).toBe(null);
  });
});

/**
 * Build a ComposePlanInput from a persona · all DB-sourced facts
 * synthesized from the persona profile. Deterministic · uses a fixed
 * startMondayISO so plan layouts are reproducible across test runs.
 */
function personaToComposeInput(p: SyntheticRunner): ComposePlanInput {
  const cat = distanceCategoryOfPublic(p.race.distanceMi);
  // Fixed start date · 2026-01-05 is a Monday.
  const startMondayISO = '2026-01-05';
  // Race day = startMonday + weeksOut × 7. Use Sunday as race day so the
  // last week's weekly count is reasonable.
  const raceDay = new Date('2026-01-05T12:00:00Z');
  raceDay.setUTCDate(raceDay.getUTCDate() + p.race.weeksOut * 7 - 1);
  const raceDateISO = raceDay.toISOString().slice(0, 10);

  return {
    raceDistanceMi: p.race.distanceMi,
    goalSec: p.race.goalSec,
    goalPaceSec: Math.round(p.race.goalSec / p.race.distanceMi),
    raceDateISO,
    startMondayISO,
    level: p.profile.experienceLevel,
    recentWeeklyMi: p.profile.weeklyBaseMi,
    // Easy median = weekly base / 4 days (mirrors what the median read
    // returns in practice for steady runners).
    easyDayMedianMi: Math.max(3, Math.round(p.profile.weeklyBaseMi / 5)),
    // 2026-06-03 · runner's recent peak long. For personas we infer it
    // from weeklyBaseMi × 0.25 (the canonical long-share for HM advanced)
    // so the long-run sizing starts from a believable baseline. Real
    // user reads come from runs in the last 28d (see recentPeakLongMi).
    recentLongMi: Math.round(p.profile.weeklyBaseMi * 0.25),
    isMidBlock: false,
    longRunDow: 0 as DOW,    // Sun
    restDow: 6 as DOW,        // Sat
    qualityDows: [2, 4] as DOW[],   // Tue + Thu
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: tPaceFromGoal(p.race.goalSec, p.race.distanceMi),
    lthr: null,
  };
}

/** Sum of a week's days, used to verify weekly target alignment. */
function weekTotal(week: { days: { distanceMi: number }[] }): number {
  return week.days.reduce((s, d) => s + (d.distanceMi || 0), 0);
}

/** Longest run in a week. */
function weekLong(week: { days: { distanceMi: number; type: string }[] }): number {
  const longs = week.days.filter((d) => d.type === 'long').map((d) => d.distanceMi);
  return longs.length > 0 ? Math.max(...longs) : 0;
}

/** Count of quality days in a week (non-rest, non-long, non-easy). */
function weekQualityCount(week: { days: { type: string; isQuality?: boolean }[] }): number {
  return week.days.filter((d) =>
    d.type === 'tempo' || d.type === 'threshold' || d.type === 'intervals'
  ).length;
}

describe('Generator bench · composePlan() output against persona doctrine', () => {
  for (const p of PERSONAS) {
    describe(`Persona: ${p.name}`, () => {
      const input = personaToComposeInput(p);
      const result = composePlan(input);
      const exp = p.expectedPlan;

      it('produces a multi-week plan', () => {
        expect(result.weeks.length).toBeGreaterThanOrEqual(p.race.weeksOut - 1);
      });

      it('peak weekly mileage within doctrine band', () => {
        // Look at BUILD weeks only · exclude TAPER + race week.
        const buildWeeks = result.weeks.filter((w) =>
          w.phase !== 'TAPER' && !w.isRaceWeek
        );
        const peak = Math.max(...buildWeeks.map(weekTotal));
        const [lo, hi] = exp.peakWeeklyMileageBand;
        // ±10% tolerance.
        const tolerance = 0.10;
        expect(peak).toBeGreaterThanOrEqual(lo * (1 - tolerance));
        expect(peak).toBeLessThanOrEqual(hi * (1 + tolerance));
      });

      it('peak long matches peak weekly × longRunShare ±1.5mi (build only)', () => {
        // Build-week peak only · TAPER has long=0 by design.
        let peakIdx = 0, peakMi = 0;
        for (let i = 0; i < result.weeks.length; i++) {
          const w = result.weeks[i];
          if (w.phase === 'TAPER' || w.isRaceWeek) continue;
          const t = weekTotal(w);
          if (t > peakMi) { peakMi = t; peakIdx = i; }
        }
        // Expected long · respects the tier peakLong band cap. Some
        // personas' longRunShare × peakWeekly would exceed the tier's
        // peakLong upper bound (e.g. ultra) · the generator correctly
        // caps and the assertion follows.
        const tierLongMax = result.authoredState.tier_peak_long_band
          ? (result.authoredState.tier_peak_long_band as number[])[1]
          : Infinity;
        const expectedLong = Math.min(peakMi * exp.longRunShare, tierLongMax);
        const actualLong = weekLong(result.weeks[peakIdx]);
        expect(actualLong).toBeGreaterThanOrEqual(expectedLong - 1.5);
        expect(actualLong).toBeLessThanOrEqual(expectedLong + 1.5);
      });

      it('no build-week long is shorter than runner recent long (2026-06-03)', () => {
        // The fix that closed David's "why is Sun 9mi when I just did 12?"
        // bug · the generator must not author a long shorter than the
        // runner's recent peak long (modulo cutback margin). Cutback weeks
        // can drop ~2mi; non-cutback build weeks must hold the floor.
        const recentLong = Math.round(p.profile.weeklyBaseMi * 0.25); // matches input
        if (recentLong < 8) return; // floor only kicks in for true long-runners
        for (let i = 0; i < result.weeks.length; i++) {
          const w = result.weeks[i];
          if (w.phase === 'TAPER' || w.phase === 'BASE' || w.isRaceWeek) continue;
          const isCutback = i > 0 && (i + 1) % 4 === 0;
          const floor = isCutback ? recentLong - 2 : recentLong - 1;
          const long = weekLong(w);
          if (long === 0) continue; // no long that week (rare)
          expect(long).toBeGreaterThanOrEqual(floor);
        }
      });

      it('every non-base / non-taper week has at least one quality day', () => {
        const non = result.weeks.filter((w) =>
          w.phase !== 'BASE' && w.phase !== 'TAPER' && !w.isRaceWeek
        );
        if (non.length === 0) return;
        for (const w of non) {
          expect(weekQualityCount(w)).toBeGreaterThanOrEqual(1);
        }
      });

      it('quality density matches persona qualityPerWeek (±1)', () => {
        const non = result.weeks.filter((w) =>
          w.phase === 'QUALITY' || w.phase === 'RACE-SPECIFIC'
        );
        if (non.length === 0) return;
        const avg = non.reduce((s, w) => s + weekQualityCount(w), 0) / non.length;
        expect(avg).toBeGreaterThanOrEqual(exp.qualityPerWeek - 1);
        expect(avg).toBeLessThanOrEqual(exp.qualityPerWeek + 1);
      });

      it('long-run race-pace label matches race distance', () => {
        // HM races · expect "@ HM" not "@ MP" on RACE-SPECIFIC long runs
        // (if any race-pace insert at all). Marathon races expect "@ MP".
        // 5K / 10K shouldn't carry race-pace inserts.
        const labels = result.weeks
          .filter((w) => w.phase === 'RACE-SPECIFIC')
          .flatMap((w) => w.days.filter((d) => d.type === 'long').map((d) => d.subLabel ?? ''));
        if (labels.length === 0) return;
        if (p.race.distanceMi >= 25) {
          // Marathon · expect MP inserts
          const hasMP = labels.some((l) => l.includes('MP'));
          expect(hasMP).toBe(true);
        } else if (p.race.distanceMi >= 12) {
          // Half · expect HM inserts (not MP)
          const hasHM = labels.some((l) => l.includes('HM'));
          const hasMP = labels.some((l) => l.includes('@ MP'));
          expect(hasMP).toBe(false);
          // Soft: HM insert presence depends on whether RACE-SPECIFIC phase
          // exists for this persona's weeksOut · don't hard-require here.
          if (labels.some((l) => l.includes('@'))) {
            expect(hasHM).toBe(true);
          }
        } else {
          // 5K / 10K · no race-pace inserts on long runs
          const hasMP = labels.some((l) => l.includes('@ MP'));
          const hasHM = labels.some((l) => l.includes('@ HM'));
          expect(hasMP || hasHM).toBe(false);
        }
      });

      it('volume ramps · peak weekly exceeds start-week weekly', () => {
        // Peak should be strictly greater than week-0 (otherwise the
        // ramp math is broken · the plan is flat).
        const startWk = weekTotal(result.weeks[0]);
        const peak = Math.max(...result.weeks.map(weekTotal));
        expect(peak).toBeGreaterThan(startWk);
      });

      it('every week has a long run unless taper or race week', () => {
        for (const w of result.weeks) {
          if (w.isRaceWeek || w.phase === 'TAPER') continue;
          const hasLong = w.days.some((d) => d.type === 'long' && d.distanceMi > 0);
          expect(hasLong).toBe(true);
        }
      });
    });
  }
});
