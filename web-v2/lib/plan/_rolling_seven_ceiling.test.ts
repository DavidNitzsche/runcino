/**
 * ROLLING7-1 · the peak load ceiling is enforced in the unit it is MEASURED in.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * Rule 16, on the two sides of one inequality. `resolvePeakWeekly` measures the
 * runner's demonstrated peak as a ROLLING 7-DAY maximum;
 * `load-progression-contract.ts` multiplies it by `PER_CYCLE_PEAK_GROWTH` to
 * publish `planned_peak_mi`; and that ceiling was enforced against the block's
 * peak CALENDAR week.
 *
 * Measured on the reference marathoner by the S1.5 load audit
 * (`docs/reports/complete-coaching-brain-handback-2026-09-02/LOAD-AUDIT.md` §6):
 * the peak calendar week is authored at 60.0 against a 60.1 ceiling and passes,
 * while the block's true peak 7-day exposure is 62.0 — Tue 2026-10-06 through
 * Mon 2026-10-12, straddling a week boundary. 62.0 / 52.3 = 1.185 against the
 * engine's own 1.15.
 *
 * ── FALSIFIED (Rule 18) ─────────────────────────────────────────────────────
 *
 * Run against the composer with `enforceRollingSevenCeiling` removed from
 * `finalizeComposedPlan`, ALL SIX cases fail, and the breach one names the
 * window rather than the missing pass — the ceiling is read from the LOAD
 * CONTRACT's stamp, which exists either way:
 *
 *   AssertionError: peak rolling-7 61 mi exceeds the block's own published
 *   ceiling 60.1 mi (window opening 2026-10-21)
 *
 * (61 rather than the audit's 62.0 because MPLADDER-1 and LONGARRIVE-2 moved
 * this block in the same session; the defect is the same and the window has
 * moved with the long runs.) The Rule 9 walk fails too, at 1.5 mi of movement
 * for a tenth of a mile of demonstrated peak — the correction is what makes
 * that curve smooth, so it is evidence in both directions. Restoring the call
 * turns all six green.
 *
 * ── WHAT THIS GATE CANNOT FAIL ON (Rule 22) ─────────────────────────────────
 *
 * It cannot see a block whose contract REFUSED to publish a peak — with no
 * ceiling there is nothing to compare, and the pass records the refusal rather
 * than inventing a bound. That is most of the 11,687-arc archetype corpus,
 * whose fixtures carry no history at all, which is exactly why this file builds
 * its own runner with a measured peak instead of sweeping the matrix (Rule 15:
 * a mechanism no case can reach is untested however many cases pass).
 *
 * It says nothing about whether the ceiling is the RIGHT number — that is
 * `RAMP.cycle-over-cycle-peak-growth` and the load contract's own tests.
 * It says nothing about the days it did not trim: the pass will not cut a long
 * run, a quality session or a race day, so a block that cannot comply on easy
 * miles alone is left non-compliant ON PURPOSE and this file records that as an
 * observed state rather than failing on it — the last case below is where that
 * distinction lives, and it would go quiet if the pass started cutting
 * everything, which is why it asserts the untouched kinds explicitly.
 */
import { describe, it, expect } from 'vitest';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  ROLLING_SEVEN_DAYS,
  type ComposePlanInput, type DOW,
} from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { PER_CYCLE_PEAK_GROWTH } from './load-progression-contract';

const START_MONDAY = '2026-08-24';
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The reference marathoner, with the history the mechanism needs.
 *
 * `peakMi: 52.3` is his own measured rolling-7 maximum over 112 days, the same
 * number `resolvePeakWeekly` reads in production, so the ceiling this fixture
 * composes against is 52.3 × 1.15 = 60.1 — the one the audit measured.
 */
function cimInput(): ComposePlanInput {
  const raceDistanceMi = 26.22;
  const goalSec = 10800;
  return {
    raceDistanceMi,
    goalSec,
    goalPaceSec: Math.round(goalSec / raceDistanceMi),
    raceDateISO: addDays(START_MONDAY, 15 * 7 - 1),
    startMondayISO: START_MONDAY,
    level: 'advanced',
    recentWeeklyMi: 44,
    easyDayMedianMi: 6.5,
    recentLongMi: 18,
    spikeAnchorLongMi: 18,
    demonstratedLongMi: 21.5,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    availableDows: null,
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    rxRaceSpecific: inlinePrescriptions(distanceCategoryOrThrow(raceDistanceMi)),
    tPaceSec: fixtureTPaceFromGoalPace(goalSec, raceDistanceMi),
    lthr: null,
    maxHr: null,
    bestRecentVdot: 47.8,
    rampBaseMi: 44,
    rampBaseEvidence: {
      baseMi: 44, meanMi: 40, sustainedMi: 43.5, peakMi: 52.3,
      interruptionWeeks: 0, allowedInterruptionWeeks: 4,
      lifted: false, heldMi: 44, returning: false, heldByCurrent: true,
    },
  } as unknown as ComposePlanInput;
}

function build() {
  const input = cimInput();
  const composed = composePlan(input);
  finalizeComposedPlan(composed, input.raceDistanceMi, input.level);
  composed.vols = composed.weeks.map((w) => w.weeklyMi);
  return { input, composed };
}

/** Every authored day in date order. Rest days are absent, as in the engine. */
function dailySeries(composed: ReturnType<typeof build>['composed']) {
  const out: { dateISO: string; mi: number; type: string; isLong: boolean; isQuality: boolean }[] = [];
  for (const w of composed.weeks) {
    const weekStartDow = new Date(`${w.startISO}T12:00:00Z`).getUTCDay();
    for (const d of w.days) {
      if (!(d.distanceMi > 0)) continue;
      out.push({
        dateISO: addDays(w.startISO, ((d.dow - weekStartDow + 7) % 7)),
        mi: d.distanceMi, type: d.type, isLong: !!d.isLong, isQuality: !!d.isQuality,
      });
    }
  }
  return out.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
}

/** The worst rolling 7-day exposure, and the day it opens on. */
function peakRollingSeven(series: ReturnType<typeof dailySeries>) {
  let best = { mi: 0, from: '' };
  for (const s of series) {
    const end = addDays(s.dateISO, ROLLING_SEVEN_DAYS - 1);
    const mi = Math.round(series
      .filter((x) => x.dateISO >= s.dateISO && x.dateISO <= end)
      .reduce((a, x) => a + x.mi, 0) * 10) / 10;
    if (mi > best.mi) best = { mi, from: s.dateISO };
  }
  return best;
}

describe('ROLLING7-1 · the block does not exceed its own published ceiling', () => {
  const { composed } = build();
  const stamp = (composed.authoredState as Record<string, unknown>)['rolling_seven_ceiling'] as {
    ceiling_mi: number | null;
    peak_rolling_seven_before_mi?: number;
    peak_rolling_seven_after_mi?: number;
    within_ceiling?: boolean;
    trims?: { date_iso: string; from_mi: number; to_mi: number }[];
    refused?: string;
  } | undefined;

  it('the fixture REACHES the mechanism · a ceiling was published at all', () => {
    // Rule 15 liveness. Without a demonstrated peak the contract refuses and
    // this whole file checks nothing — which is the state every synthetic
    // archetype is in, and the reason this fixture exists.
    expect(stamp, 'the pass did not run · `rolling_seven_ceiling` is not stamped').toBeDefined();
    expect(stamp!.refused, `the contract refused: ${stamp!.refused}`).toBeUndefined();
    expect(stamp!.ceiling_mi).toBeGreaterThan(0);
    // And it is the contract's own arithmetic, read rather than restated.
    expect(stamp!.ceiling_mi).toBeCloseTo(52.3 * PER_CYCLE_PEAK_GROWTH, 1);
  });

  it('no 7-day window exceeds the ceiling · measured off the authored days', () => {
    // The ceiling is read from the LOAD CONTRACT's own stamp, not from this
    // pass's, so the assertion still runs — and still names the window — when
    // the pass is removed. A falsification whose message is "the thing I
    // deleted is missing" proves less than one that quotes the breach.
    const contract = (composed.authoredState as Record<string, unknown>)['load_progression_contract'] as
      { planned_peak_mi?: number | null } | undefined;
    const ceilingMi = contract?.planned_peak_mi ?? null;
    expect(ceilingMi, 'the load contract published no peak · this assertion checks nothing').not.toBeNull();
    const peak = peakRollingSeven(dailySeries(composed));
    expect(
      peak.mi,
      `peak rolling-7 ${peak.mi} mi exceeds the block's own published ceiling `
      + `${ceilingMi} mi (window opening ${peak.from})`,
    ).toBeLessThanOrEqual(ceilingMi! + 1e-9);
  });

  it('the calendar week was ALREADY compliant · the two units really do differ', () => {
    // The falsification in one assertion: the old check passed on this same
    // block. If the peak calendar week ever exceeds the ceiling, the defect
    // this file is about is not the one being measured any more.
    const peakWeek = Math.max(...composed.weeks.map((w) => w.weeklyMi));
    expect(peakWeek).toBeLessThanOrEqual(stamp!.ceiling_mi! + 1e-9);
  });

  it('the trims are RECORDED, with what was cut and from where', () => {
    expect(stamp!.peak_rolling_seven_before_mi).toBeGreaterThan(0);
    expect(stamp!.peak_rolling_seven_after_mi).toBeLessThanOrEqual(stamp!.peak_rolling_seven_before_mi!);
    expect(typeof stamp!.within_ceiling).toBe('boolean');
    for (const t of stamp!.trims ?? []) {
      expect(t.to_mi).toBeLessThan(t.from_mi);
      expect(t.to_mi).toBeGreaterThanOrEqual(3);
      expect(t.date_iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('it takes EASY miles only · no long run, quality session or race day is cut', () => {
    const trimmed = new Set((stamp!.trims ?? []).map((t) => t.date_iso));
    // Rule 18 liveness: a set of zero trims proves nothing about what is
    // protected, so the fixture must actually have needed one.
    expect(trimmed.size, 'the fixture never breached the ceiling — it cannot show what is protected')
      .toBeGreaterThan(0);
    for (const d of dailySeries(composed)) {
      if (!trimmed.has(d.dateISO)) continue;
      expect(d.isLong, `${d.dateISO} · a long run was cut to satisfy a volume ceiling`).toBe(false);
      expect(d.isQuality, `${d.dateISO} · a quality session was cut`).toBe(false);
      expect(d.type, `${d.dateISO} · a race day was cut`).not.toBe('race');
    }
  });

  it('Rule 9 · a hair more demonstrated peak buys a hair more plan, not a different one', () => {
    // The correction is a `min` against a continuous quantity, so walking the
    // demonstrated peak across the value that triggered the trim must move the
    // output continuously. Falsified against a step: any implementation that
    // switched on a threshold shows a jump here.
    let prev: number | null = null;
    let worstJump = 0;
    for (const peakMi of [52.0, 52.1, 52.2, 52.3, 52.4, 52.5, 52.6]) {
      const input = cimInput();
      (input as unknown as { rampBaseEvidence: { peakMi: number } }).rampBaseEvidence.peakMi = peakMi;
      const c = composePlan(input);
      finalizeComposedPlan(c, input.raceDistanceMi, input.level);
      const mi = peakRollingSeven(dailySeries(c)).mi;
      if (prev != null) worstJump = Math.max(worstJump, Math.abs(mi - prev));
      prev = mi;
    }
    // A tenth of a mile of demonstrated peak buys 0.115 mi of ceiling. Anything
    // over a mile of movement per step is a cliff, not a curve.
    expect(worstJump, 'the peak rolling-7 jumped on a hair of demonstrated peak').toBeLessThanOrEqual(1.0);
  });
});
