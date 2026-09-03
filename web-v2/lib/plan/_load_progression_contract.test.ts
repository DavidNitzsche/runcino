/**
 * lib/plan/_load_progression_contract.test.ts · LOADCONTRACT-1 (2026-09-02).
 *
 * ONE GATE FOR ONE RULING: authoring and adaptation must share a single,
 * time-aware load authority, and no self-declared experience band may reach it.
 *
 * ── WHAT IT WATCHES ────────────────────────────────────────────────────────
 *
 *   G1  liveness — the module is real and the contract resolves
 *   G2  a typed `experience_level` cannot move the block's peak (the removal)
 *   G3  Rule 9 · the ceiling is continuous and monotone in the evidence
 *   G4  Rule 9 · a hair of evidence cannot re-phase the block
 *   G5  Rule 11 · no demonstrated volume REFUSES, and the caller keeps its band
 *   G6  Rule 21 · the upward path is REACHABLE — the bar is a week a runner
 *       could actually run, and running it opens headroom
 *   G7  the template band is carried and NOT consulted
 *   G8  the prerequisite evidence named by `peakEarnedWhen` is RESOLVABLE
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · Whether 1.15 is the right per-cycle figure, or 0.05 the right headroom
 *   share. `RAMP.cycle-over-cycle-peak-growth` owns the first; the second is
 *   `adaptive-ramp.ts`'s own long-standing constant and this file only asserts
 *   the two agree, never that either is correct.
 * · Whether a bump then FIRES. That needs the database and the cron, and
 *   `_guard_fail_closed.test.ts` and the adaptation harness own it. G6 proves
 *   the gate is ANSWERABLE, which is the thing that was structurally false.
 * · Anything a runner reads. Nothing here renders (Rule 13); it proves what the
 *   composer writes.
 * · The SHAPE axis. `classifyCapacityTier` still carries the typed level's
 *   floor and still selects the long-run band, quality density and day count.
 *   That residual is argued in `goal-tiers.ts`'s TIEREVIDENCE-1 block and is
 *   deliberately out of scope: this gate watches VOLUME.
 * · `GENERAL_RAMP_CEILING[level]`, which is still keyed on the typed level for
 *   the WEEK-OVER-WEEK rate. G2 covers the peak, not the climb. Stated here
 *   rather than left for a reader to discover, because an unlisted gap is how a
 *   rule everybody believes is holding stops holding (Rule 20).
 *
 * ── RULE 22 · THE DISTRIBUTION ─────────────────────────────────────────────
 *
 * G2, G3, G4, G5 and G7 ask "did you correctly REFUSE to let something decide
 * this". G6 and G8 ask the opposite — "can the upward path ever open, and is
 * the thing it waits on real" — because a gate that can only ask the first will
 * pass an engine that can only refuse, which is Rule 21's whole complaint. Two
 * against five, and the honest note is that this pass removed one permission
 * (the label) and opened one (the recompute).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveLoadProgressionContract,
  plannedPeakBound,
  loadContractStamp,
  recomputeAdaptationCeiling,
  PER_CYCLE_PEAK_GROWTH,
  WEEKLY_STEP_GROWTH,
  ADAPTATION_HEADROOM_SHARE,
  SHORTFALL_POSTURE,
  type DemonstratedLoad,
  type LoadContractStamp,
} from './load-progression-contract';
import { composePlan, cycleBoundedPeak, type DOW, type LevelKey } from './generate';
import { CYCLE_GROWTH_CEILING, TIER_TARGETS } from './goal-tiers';

const src = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** The reference runner's measured evidence, read off production 2026-09-02
 *  and stamped into his own block's `authored_state.ramp_base`. */
const DAVID: DemonstratedLoad = {
  peakWeeklyMi: 52.3,
  sustainedWeeklyMi: 45,
  heldWeeklyMi: 34.7,
  meanWeeklyMi: 31.6,
  asOfISO: '2026-08-24',
};
const MARATHON_FLOOR = TIER_TARGETS.m.developing.peakWeeklyMileageBand[0]; // 30
const CLIMB_WEEKS = 7;

const contract = (over: Partial<DemonstratedLoad> = {}, climb = CLIMB_WEEKS) =>
  resolveLoadProgressionContract({
    demonstrated: { ...DAVID, ...over },
    climbWeeksToPeak: climb,
    distanceFloorMi: MARATHON_FLOOR,
    templatePeakBandMi: TIER_TARGETS.m.intermediate.peakWeeklyMileageBand,
  });

/** How many `composePlan` runs this file actually made. Rule 18 · a gate states
 *  what it exercised and fails on zero rather than reporting clean. */
let plansComposed = 0;

type Vec = { vols: number[]; peakWk: number; peakLong: number; bandUpper: number };

/** The CIM shape, driven directly — the 11,687-arc corpus cannot reach any of
 *  this, because `SimInputs` carries no history and `rampBaseEvidence` is
 *  therefore undefined for every arc (Rule 15). */
function block(over: Record<string, unknown> = {}): Vec {
  const r = composePlan({
    raceDistanceMi: 26.2188, goalSec: 10800, goalPaceSec: 412,
    raceDateISO: '2026-12-06', startMondayISO: '2026-08-24',
    level: 'advanced' as LevelKey,
    recentWeeklyMi: 31.6, rampBaseMi: 34.7,
    rampBaseEvidence: {
      baseMi: 34.7, meanMi: 31.6, sustainedMi: 45, peakMi: 52.3,
      interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
      heldMi: 34.7, returning: true, heldByCurrent: true,
    },
    easyDayMedianMi: 6, recentLongMi: 18, spikeAnchorLongMi: 13.5,
    demonstratedLongMi: 21.5,
    recentQualityDistanceMi: 7.5, recentQualityPerWeek: 1.5, bestRecentVdot: 46.8,
    isMidBlock: true,
    longRunDow: 0 as DOW, restDow: 6 as DOW, qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: 6, crossModes: [],
    rxQuality: {
      threshold: '2 mi WU · 4 mi @ T · 2 mi CD', intervals: '10×800m · equal jog rec',
      tempo: 'continuous tempo', families: {},
    },
    rxRaceSpecific: {
      threshold: '2 mi WU · 4 mi @ T · 2 mi CD', intervals: '10×800m · equal jog rec',
      tempo: 'continuous tempo', families: {},
    },
    tPaceSec: 430, lthr: 168, maxHr: 183,
    ...over,
  } as unknown as Parameters<typeof composePlan>[0]);
  plansComposed++;
  const st = r.authoredState as Record<string, unknown>;
  const band = st.tier_peak_weekly_band as [number, number];
  return {
    vols: r.vols,
    peakWk: Math.max(...r.vols),
    peakLong: r.weeks.reduce(
      (mx, w) => Math.max(mx, ...w.days.map((d) => (d.type === 'long' ? d.distanceMi : 0))),
      0,
    ),
    bandUpper: band[1],
  };
}

describe('LOADCONTRACT-1 · one time-aware load authority', () => {
  // ── G1 · LIVENESS ────────────────────────────────────────────────────────
  it('G1 · the module exists, and the contract answers all six questions', () => {
    const text = src('lib/plan/load-progression-contract.ts');
    expect(text.length).toBeGreaterThan(3000);
    const c = contract();
    expect(c.currentlySupportedLoad.known).toBe(true);
    expect(c.immediatelyPermittedLoad.known).toBe(true);
    expect(c.plannedPeakLoad.known).toBe(true);
    expect(c.plannedFutureLoadMi.length).toBe(CLIMB_WEEKS);
    expect(c.peakEarnedWhen.demonstratedPeakWeeklyMiRequired).toBeGreaterThan(0);
    expect(c.shortfall).toBe(SHORTFALL_POSTURE);
    expect(c.adaptationCeiling.known).toBe(true);

    // The reference runner's real numbers, pinned. If any of these move, the
    // report the owner read is no longer true of the engine.
    if (!c.currentlySupportedLoad.known) throw new Error('unreachable');
    if (!c.immediatelyPermittedLoad.known) throw new Error('unreachable');
    if (!c.plannedPeakLoad.known) throw new Error('unreachable');
    expect(c.currentlySupportedLoad.mi).toBe(45);
    expect(c.immediatelyPermittedLoad.mi).toBe(39.9);
    expect(c.plannedPeakLoad.mi).toBe(60.1);
    expect(c.plannedPeakLoad.basis).toBe('per_cycle_growth_on_demonstrated_peak');
    expect(c.peakEarnedWhen.demonstratedPeakWeeklyMiRequired).toBe(55);
  });

  // ── G2 · THE REMOVAL · a typed level may not move the peak ───────────────
  it('G2 · the block peaks identically at every experience level, and at none', () => {
    const levels: LevelKey[] = [null, 'beginner', 'intermediate', 'advanced', 'advanced_plus'];
    const seen = levels.map((level) => ({ level, v: block({ level }) }));
    const first = seen[0].v;
    for (const { level, v } of seen) {
      expect(
        v.peakWk,
        `peak weekly moved to ${v.peakWk} for level=${String(level)} (was ${first.peakWk}) · `
        + 'a self-declared band is deciding load again',
      ).toBe(first.peakWk);
      expect(
        v.bandUpper,
        `published ceiling moved to ${v.bandUpper} for level=${String(level)}`,
      ).toBe(first.bandUpper);
      expect(v.vols).toEqual(first.vols);
    }
    // …and the peak is the one the owner's block actually carries.
    expect(first.peakWk).toBe(60);
    expect(first.bandUpper).toBe(60.1);
  });

  // ── G3 · RULE 9 · continuity and monotonicity in the evidence ────────────
  it('G3 · the ceiling moves continuously and monotonically with demonstrated volume', () => {
    let prev = -Infinity;
    let worstJump = 0;
    // A wide walk in 0.01 mi steps across the whole band a real marathoner
    // occupies, INCLUDING the points where each of the four bounds takes over
    // from another — those handovers are where a cliff would hide.
    for (let peak = 20; peak <= 80; peak = Math.round((peak + 0.01) * 100) / 100) {
      const r = plannedPeakBound({
        demonstratedPeakWeeklyMi: peak,
        climbFromMi: 34.7,
        climbWeeksToPeak: CLIMB_WEEKS,
        distanceFloorMi: MARATHON_FLOOR,
      });
      expect(r.known).toBe(true);
      if (!r.known) throw new Error('unreachable');
      expect(r.mi, `non-monotone at demonstrated peak ${peak}`).toBeGreaterThanOrEqual(prev);
      if (prev > -Infinity) worstJump = Math.max(worstJump, r.mi - prev);
      prev = r.mi;
    }
    // 0.01 mi of evidence may move the answer by at most one rounding step plus
    // the growth factor's own slope — nothing structural.
    expect(worstJump, `a ${worstJump} mi step for 0.01 mi of evidence is a cliff`)
      .toBeLessThanOrEqual(0.11);
  });

  it('G3b · and continuously in the climb runway too', () => {
    let prev = -Infinity;
    for (let n = 0; n <= 30; n++) {
      const r = plannedPeakBound({
        demonstratedPeakWeeklyMi: 52.3,
        climbFromMi: 34.7,
        climbWeeksToPeak: n,
        distanceFloorMi: MARATHON_FLOOR,
      });
      if (!r.known) throw new Error('unreachable');
      expect(r.mi, `runway ${n} weeks went backwards`).toBeGreaterThanOrEqual(prev);
      prev = r.mi;
    }
  });

  // ── G4 · RULE 9 · a hair of evidence cannot re-phase the block ───────────
  it('G4 · a 0.1 mi change in the demonstrated peak does not re-phase the block', () => {
    const near = [52.2, 52.25, 52.3, 52.35, 52.4].map((peakMi) => block({
      rampBaseEvidence: {
        baseMi: 34.7, meanMi: 31.6, sustainedMi: 45, peakMi,
        interruptionWeeks: 0, allowedInterruptionWeeks: 4, lifted: false,
        heldMi: 34.7, returning: true, heldByCurrent: true,
      },
    }));
    for (let i = 1; i < near.length; i++) {
      const a = near[i - 1];
      const b = near[i];
      expect(b.vols.length).toBe(a.vols.length);
      // Same calendar: a week that was a cutback stays a cutback. The cheapest
      // reliable read of "did the block re-phase" is whether the SHAPE moved,
      // not whether the numbers did.
      const shapeOf = (v: Vec) => v.vols.map((x, k) => (k > 0 && x < v.vols[k - 1] ? 'v' : '^')).join('');
      expect(shapeOf(b), 'the block re-phased on a hair of evidence').toBe(shapeOf(a));
      const worst = Math.max(...b.vols.map((x, k) => Math.abs(x - a.vols[k])));
      expect(worst, `worst weekly move ${worst} mi for 0.05 mi of evidence`).toBeLessThanOrEqual(1.0);
    }
  });

  // ── G5 · RULE 11 · a refusal is a refusal, never a zero ─────────────────
  it('G5 · no demonstrated volume refuses to bound, and the caller keeps its band', () => {
    const c = contract({ peakWeeklyMi: null, sustainedWeeklyMi: null, heldWeeklyMi: null, meanWeeklyMi: null });
    expect(c.plannedPeakLoad.known).toBe(false);
    expect(c.currentlySupportedLoad.known).toBe(false);
    expect(c.immediatelyPermittedLoad.known).toBe(false);
    expect(c.plannedFutureLoadMi).toEqual([]);
    expect(c.peakEarnedWhen.demonstratedPeakWeeklyMiRequired).toBeNull();
    // A measured ZERO is the same refusal here and a DIFFERENT fact upstream —
    // `tier_band_anchor.demonstrated_peak_weekly_mi` keeps the two apart.
    expect(contract({ peakWeeklyMi: 0 }).plannedPeakLoad.known).toBe(false);
    // …and the composer's response is the doctrine target UNTOUCHED, which is
    // what keeps all 11,687 corpus arcs byte-identical (Rule 15: every arc has
    // peakMi 0, so every arc lands here).
    for (const cat of ['5k', '10k', 'hm', 'm'] as const) {
      const target = TIER_TARGETS[cat].advanced.peakWeeklyMileageBand[0];
      expect(cycleBoundedPeak(target, null, cat, 10)).toBe(target);
      expect(cycleBoundedPeak(target, {
        baseMi: 30, meanMi: 30, sustainedMi: 0, peakMi: 0, interruptionWeeks: 0,
        allowedInterruptionWeeks: 4, lifted: false, heldMi: 0, returning: false,
        heldByCurrent: false,
      }, cat, 10)).toBe(target);
    }
  });

  // ── G6 · RULE 21 · the upward path is reachable, on a bar he could run ───
  it('G6 · running the week the contract names opens headroom above the block peak', () => {
    const c = contract();
    if (!c.plannedPeakLoad.known) throw new Error('unreachable');
    const authoredPeak = 60;            // what the block actually peaks at
    const required = c.peakEarnedWhen.demonstratedPeakWeeklyMiRequired!;

    // BEFORE · the ceiling struck at authoring leaves no headroom. This is the
    // inert state, and it is asserted so the gate can tell "the fix works" from
    // "there was never a problem".
    const atAuthoring = c.plannedPeakLoad.mi;
    expect(atAuthoring - authoredPeak).toBeLessThanOrEqual(atAuthoring * ADAPTATION_HEADROOM_SHARE);

    // AFTER · a completed week at the named volume, recomputed through the SAME
    // resolver adaptation uses.
    const stamp = loadContractStamp(c, {
      climbWeeksToPeak: CLIMB_WEEKS, distanceFloorMi: MARATHON_FLOOR,
    });
    const after = recomputeAdaptationCeiling({
      stamp,
      liveDemonstratedPeakWeeklyMi: required,
      stampedCeilingMi: atAuthoring,
    });
    expect(after.source).toBe('recomputed');
    if (!after.ceiling.known) throw new Error('unreachable');
    expect(
      after.ceiling.mi - authoredPeak,
      `a demonstrated ${required} mi week must open headroom above a ${authoredPeak} mi peak`,
    ).toBeGreaterThan(after.ceiling.mi * ADAPTATION_HEADROOM_SHARE);

    // AND THE BAR MUST BE A WEEK A HUMAN COULD RUN. Rule 21: "compute what the
    // runner would have had to DO to trigger it". 55 mi is 5.2% above the 52.3
    // he has already recorded and inside the block's own prescribed weeks
    // (59.5 and 60.0), so it is a bar this block itself walks him to — not a
    // wall.
    expect(required).toBeLessThan(authoredPeak);
    expect(required / DAVID.peakWeeklyMi!).toBeLessThan(1.15);

    // Rule 11 · and a ceiling that cannot be resolved at all is a refusal, not
    // full headroom.
    const none = recomputeAdaptationCeiling({
      stamp: null, liveDemonstratedPeakWeeklyMi: null, stampedCeilingMi: null,
    });
    expect(none.ceiling.known).toBe(false);
    expect(none.source).toBe('none');
  });

  // ── G7 · the template band is a reference, not a bound ──────────────────
  it('G7 · the Research/22 template band is carried and never consulted', () => {
    const withBand = resolveLoadProgressionContract({
      demonstrated: DAVID, climbWeeksToPeak: CLIMB_WEEKS, distanceFloorMi: MARATHON_FLOOR,
      templatePeakBandMi: [45, 55],
    });
    const withAbsurdBand = resolveLoadProgressionContract({
      demonstrated: DAVID, climbWeeksToPeak: CLIMB_WEEKS, distanceFloorMi: MARATHON_FLOOR,
      templatePeakBandMi: [1, 2],
    });
    const withNoBand = resolveLoadProgressionContract({
      demonstrated: DAVID, climbWeeksToPeak: CLIMB_WEEKS, distanceFloorMi: MARATHON_FLOOR,
    });
    if (!withBand.plannedPeakLoad.known) throw new Error('unreachable');
    if (!withAbsurdBand.plannedPeakLoad.known) throw new Error('unreachable');
    if (!withNoBand.plannedPeakLoad.known) throw new Error('unreachable');
    expect(withAbsurdBand.plannedPeakLoad.mi).toBe(withBand.plannedPeakLoad.mi);
    expect(withNoBand.plannedPeakLoad.mi).toBe(withBand.plannedPeakLoad.mi);
    // …and it survives on the record, under its own name.
    expect(withBand.templatePeakBandMi).toEqual([45, 55]);
  });

  // ── G8 · the prerequisite evidence is REAL and RESOLVABLE ───────────────
  it('G8 · what `peakEarnedWhen` waits on is a quantity a live reader produces', () => {
    // The trap this exists for, named: `lib/plan/strategy-contracts.ts` cited
    // "No readiness pull-back is active" as the prerequisite evidence for a
    // weekly-volume increase and named a DELETED function as its owner. A
    // prerequisite nothing can resolve is a step that can never be earned.
    //
    // This contract waits on ONE thing — the runner's demonstrated peak week —
    // and the reader that produces it is exported, live, and the same one
    // authoring used.
    const gen = src('lib/plan/generate.ts');
    expect(gen).toMatch(/export async function recentPeakWeeklyMileage\(/);
    const ramp = src('lib/plan/adaptive-ramp.ts');
    expect(ramp).toMatch(/recentPeakWeeklyMileage/);
    expect(ramp).toMatch(/recomputeAdaptationCeiling/);
    // …and nothing removed by the simplification doctrine is named as evidence
    // anywhere in the contract.
    const contractSrc = src('lib/plan/load-progression-contract.ts');
    for (const removed of ['readiness', 'tsbAtStart', 'computeTrainingForm', 'illness', 'injur']) {
      const body = contractSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(body.toLowerCase(), `the contract names removed authority "${removed}"`)
        .not.toContain(removed.toLowerCase());
    }
  });

  // ── SOURCING · the doctrine figures are read, never re-typed ────────────
  it('the growth figures come from the doctrine table, not from this file', () => {
    expect(PER_CYCLE_PEAK_GROWTH).toBe(CYCLE_GROWTH_CEILING.intermediate);
    expect(WEEKLY_STEP_GROWTH).toBeGreaterThan(1);
    // …and the VALUES agreeing is not enough, because a re-typed `= 1.15`
    // literal agrees too. Falsified 2026-09-02: that falsifier PASSED against
    // the first version of this gate and against the doctrine claim, whose
    // regex was satisfied by the phrase "CYCLE_GROWTH_CEILING.intermediate"
    // sitting in this file's own header comment. Comments stripped, assignment
    // matched — the Rule 18 shape where any comment satisfies the check.
    const body = src('lib/plan/load-progression-contract.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).toMatch(/PER_CYCLE_PEAK_GROWTH[^=]*=\s*CYCLE_GROWTH_CEILING\./);
    expect(body).toMatch(/WEEKLY_STEP_GROWTH[^=]*=\s*GENERAL_RAMP_CEILING\./);
    // `ADAPTATION_HEADROOM_SHARE` and `belowTierUpper`'s own factor must agree,
    // because `peakEarnedWhen` computes the volume that satisfies that line.
    expect(src('lib/plan/adaptive-ramp.ts')).toMatch(/ADAPTATION_HEADROOM_SHARE/);
    expect(src('lib/plan/adaptive-ramp.ts')).not.toMatch(/tierWeeklyUpper \* 0\.05/);
  });

  it('states what it exercised (Rule 18 · a gate that read nothing is not clean)', () => {
    expect(plansComposed, 'no plan was composed · this gate proved nothing')
      .toBeGreaterThanOrEqual(10);
  });
});

/** Kept referenced so the type import is not dead. */
export type _StampShape = LoadContractStamp;
