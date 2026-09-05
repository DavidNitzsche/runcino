/**
 * lib/plan/_evidence_tier_band.test.ts · THE THREE SELF-DECLARATIONS THAT MAY
 * NO LONGER DECIDE A BLOCK (2026-09-02).
 *
 * One gate for three removals, because they are one ruling: the owner asked for
 * ONE stable, aggressive, coherent marathon plan, and named the levers that
 * must lose the power to alter it. Three were in this pass.
 *
 *   GOALSANITY-DELETE-1  · the goal-VDOT sanity screen is deleted, key and
 *                          resolver. It had no live consumer and it was a
 *                          second answer to Constitution §L's Goal Feasibility
 *                          question. Guards 1-2.
 *   TIEREVIDENCE-1       · a typed `profile.experience_level` no longer decides
 *                          the two numbers the ADAPTATION engine binds on.
 *                          Guards 3-6.
 *   CONFIDENCE-STRUCTURE-1 · a CONFIDENCE value may not pick the block's shape.
 *                          Guards 7-8.
 *
 * ── RULE 15 · WHICH CASE REACHES EACH MECHANISM ─────────────────────────────
 *
 * The 11,687-arc corpus cannot reach guards 7-8 at all: `SimInputs` has no
 * thesis field, so every arc composes with `thesisSlot` null. Those two drive
 * `composePlan` DIRECTLY with a `thesisAtAuthoring`, which is the only shape
 * that reaches the code. Guards 3-6 go through `buildSimPlan`, which is the
 * same seam onboarding authors through, and vary ONLY the typed level or the
 * demonstrated VDOT so nothing else can explain a difference.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ─────────────────────────────────
 *
 *   · It cannot tell whether the tier ROW the block is composed against is
 *     right. TIEREVIDENCE-2 (2026-09-02) made the row and the published band
 *     read ONE resolver (`classifyCapacityTier`, evidence-only), so the
 *     residual this bullet used to record is closed — but "the same row" is
 *     still not "the correct row", and this gate watches the BANDS.
 *   · It cannot see `adaptive-ramp.ts` ACT on the ceiling. It asserts the
 *     number the ceiling is read FROM. Whether a bump then fires, and whether a
 *     ceiling under the block's own peak correctly SKIPS the long bump rather
 *     than shrinking a row, both need the database — `_guard_fail_closed
 *     .test.ts` and the adaptation harness own that half.
 *   · It cannot tell whether `CYCLE_GROWTH_CEILING` is the right doctrine
 *     figure for a per-cycle ceiling. `RAMP.cycle-over-cycle-peak-growth` owns
 *     that.
 *   · It cannot see a rendered surface. Nothing here proves what the runner
 *     reads (Rule 13); it proves what the composer writes.
 *   · Guard 8 walks confidence, not the limiter's CORRECTNESS. Whether
 *     `pickLimiter` names the right capacity is `coaching-thesis.ts`'s question.
 *   · It is BLIND to a fourth self-declaration nobody has named yet. It watches
 *     three levers by name.
 *
 * ── RULE 22 · THE DISTRIBUTION ──────────────────────────────────────────────
 *
 * Guards 1, 2, 3, 5, 8 and 9 ask "did you correctly REFUSE to let a
 * self-report decide something". Guards 4 and 6 ask the opposite question —
 * "does demonstrated evidence still OPEN the ceiling, and is the ceiling still
 * a real number rather than the absent-band zero that would make the volume
 * ramp unreachable" — because a gate that can only ask the first will pass an
 * engine that can only refuse, which is Rule 21's whole complaint. Two against
 * six is itself an imbalance, and it is the honest one here: this pass removed
 * three permissions and added none.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { composePlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { readTierUpper } from './adaptive-ramp';
import { TIER_TARGETS, demonstratedLoadCeilingTier, CYCLE_GROWTH_CEILING } from './goal-tiers';
import { buildSimPlan } from './sim-inputs';
import type { SimInputs } from './sim-constants';
import type { ThesisAtAuthoring } from './phase-answers';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';

/** Counted so the file can state what it actually exercised (Rule 18). */
let plansComposed = 0;

const MARATHON_MI = 26.2188;
/** Every value `profile.experience_level` can hold, NULL included — it is NULL
 *  on real production accounts (COLD-1), which is the case a gate keyed only on
 *  the typed strings would miss. `SimInputs` types the field narrower than the
 *  engine does, so these are cast at the call site rather than the array. */
const LEVELS: ReadonlyArray<string | null> = [null, 'beginner', 'intermediate', 'advanced', 'advanced_plus'];
const lvl = (level: string | null) => ({ experienceLevel: level }) as unknown as Partial<SimInputs>;

/**
 * The owner's own shape: a marathon build, five days a week, a stated
 * 'advanced' level, and a MEASURED best week well under the advanced row's
 * own entry condition ("Multiple marathons, 50+ mpw base", `Research/22`
 * §"Marathon — Advanced").
 */
const MARATHONER: SimInputs = {
  goalMode: 'race',
  distance: 'marathon',
  startDateISO: '2026-08-31',
  planWeeks: 0,
  goalTimeSec: 3 * 3600,
  raceDateISO: '2026-12-06',
  experienceLevel: 'advanced',
  weeklyFrequency: 5,
  weeklyMileageBucket: 45,
  longestRunBucket: '15+',
  raceHistory: [],
  longRunDay: 'sun',
} as unknown as SimInputs;

function author(over: Partial<SimInputs> & Record<string, unknown> = {}) {
  const built = buildSimPlan({ ...MARATHONER, ...over } as SimInputs);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error('composer refused a fixture this gate depends on');
  plansComposed++;
  return {
    state: built.composed.authoredState as Record<string, unknown>,
    peakWeekly: Math.max(...built.composed.weeks.map((w) => w.weeklyMi)),
    peakLong: built.composed.weeks.reduce(
      (mx, w) => Math.max(mx, ...w.days.map((d) => (d.type === 'long' ? d.distanceMi : 0))),
      0,
    ),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * GOALSANITY-DELETE-1 · the goal-realism screen is gone and stays gone
 * ═══════════════════════════════════════════════════════════════════════ */
describe('GOALSANITY-DELETE-1 · no second answer to "is my goal realistic"', () => {
  it('guard 1 · the composer writes neither key, on an evidenced runner or a blank one', () => {
    // Both archetypes, because a key absent from a block the composer bailed
    // out of early would satisfy this for the wrong reason.
    for (const over of [{}, { bestRecentVdotOverride: 52 }]) {
      const { state } = author(over as Partial<SimInputs>);
      expect(Object.keys(state).length).toBeGreaterThan(5);
      expect(Object.prototype.hasOwnProperty.call(state, 'goal_vdot_sanity')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(state, 'goal_realism')).toBe(false);
    }
  });

  it('guard 2 · the goal VDOT survives as an OBSERVATIONAL record and nothing more', () => {
    const { state } = author();
    const blend = state.pace_blend as Record<string, unknown>;
    // Rule 11: the key is always present. `null` means and only means "the goal
    // time is off the Daniels table", never "we did not bother to record it".
    expect(Object.prototype.hasOwnProperty.call(blend, 'goal_vdot')).toBe(true);
    // …and it is a record, not a verdict: there is no boolean beside it.
    for (const k of Object.keys(blend)) {
      expect(/sanity|realism|flag/i.test(k), `pace_blend grew a verdict field: ${k}`).toBe(false);
    }
    // The resolver module is deleted. Asserted on disk rather than by import,
    // because an import of a missing module is a load error, not a finding.
    const root = path.resolve(__dirname, '..', '..');
    for (const gone of ['lib/plan/goal-vdot-sanity.ts', 'lib/plan/_goal_vdot_sanity_gate.test.ts']) {
      expect(fs.existsSync(path.join(root, gone)), `${gone} is back`).toBe(false);
    }
    // Liveness for the disk half: a path that DOES exist, so a broken `root`
    // cannot make the two assertions above pass by looking at nothing.
    expect(fs.existsSync(path.join(root, 'lib/plan/goal-tiers.ts'))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * TIEREVIDENCE-1 · a typed experience level may not widen the published bands
 * ═══════════════════════════════════════════════════════════════════════ */
describe('TIEREVIDENCE-1 · the adaptive ceiling is evidence-derived', () => {
  it('guard 3 · a typed level cannot raise either published band', () => {
    // Identical training, identical goal. Only the word changes.
    const uppers = LEVELS.map((level) => {
      const { state } = author(lvl(level));
      return {
        level,
        weekly: readTierUpper(state, 'tier_peak_weekly_band'),
        long: readTierUpper(state, 'tier_peak_long_band'),
      };
    });
    const first = uppers[0];
    for (const u of uppers) {
      expect(u.weekly, `typed level '${u.level}' moved the weekly ceiling`).toBe(first.weekly);
      expect(u.long, `typed level '${u.level}' moved the long ceiling`).toBe(first.long);
    }
    // …and the ceiling it settles on is NOT the advanced row's, which is what
    // the word used to buy. Without this the assertion above passes on an
    // engine that gives everyone 90 mi/wk.
    expect(first.weekly).toBeLessThan(TIER_TARGETS.m.advanced.peakWeeklyMileageBand[1]);
  });

  it('guard 4 · DEMONSTRATED fitness still opens the ceiling (Rule 21)', () => {
    const blank = author().state;
    const evidenced = author({ bestRecentVdotOverride: 58 } as Partial<SimInputs>).state;
    const lo = readTierUpper(blank, 'tier_peak_weekly_band');
    const hi = readTierUpper(evidenced, 'tier_peak_weekly_band');
    expect(hi, 'demonstrated marathon fitness did not open the volume ceiling').toBeGreaterThan(lo);
    // The same direction on the long band, so the upward path is not weekly-only.
    expect(readTierUpper(evidenced, 'tier_peak_long_band'))
      .toBeGreaterThanOrEqual(readTierUpper(blank, 'tier_peak_long_band'));
    // And it is EVIDENCE that opened it, not the goal: the seal on the other
    // half is `_goal_volume_seal.test.ts`, restated here as one line so this
    // file cannot pass while a goal is doing the lifting.
    const ambitious = author({ goalTimeSec: 2 * 3600 + 30 * 60 } as Partial<SimInputs>).state;
    expect(readTierUpper(ambitious, 'tier_peak_weekly_band')).toBeLessThanOrEqual(lo);
  });

  it('guard 5 · with nothing demonstrated the ceiling is the bottom row, never the typed one', () => {
    const { state } = author(lvl('advanced_plus'));
    // TIEREVIDENCE-2 · the typed level is not an argument any more, so the
    // fixture's 'advanced_plus' can no longer be handed to it at all. The
    // function and its answer are otherwise unchanged: a PERMISSION with
    // nothing demonstrated is the bottom row.
    const row = TIER_TARGETS.m[demonstratedLoadCeilingTier(MARATHON_MI, null)];
    // Rule 11: a missing read produces the CONSERVATIVE row, not the word's.
    expect(row.peakWeeklyMileageBand).toEqual(TIER_TARGETS.m.developing.peakWeeklyMileageBand);
    expect(readTierUpper(state, 'tier_peak_weekly_band'))
      .toBeLessThanOrEqual(row.peakWeeklyMileageBand[1]);
    expect(readTierUpper(state, 'tier_peak_weekly_band'))
      .toBeLessThan(TIER_TARGETS.m.advanced.peakWeeklyMileageBand[1]);
  });

  it('guard 6 · the ceiling still BINDS · it is never the absent-band zero', () => {
    for (const level of LEVELS) {
      const a = author(lvl(level));
      const weeklyUpper = readTierUpper(a.state, 'tier_peak_weekly_band');
      const longUpper = readTierUpper(a.state, 'tier_peak_long_band');
      // `readTierUpper` answers 0 for an ABSENT band, and 0 makes
      // `peakHeadroomMi` negative and `belowTierUpper` permanently false — the
      // volume ramp unreachable by construction rather than by evidence. That
      // is the one value the band may never take.
      expect(weeklyUpper, `level '${level}' published no weekly ceiling`).toBeGreaterThan(0);
      expect(longUpper, `level '${level}' published no long ceiling`).toBeGreaterThan(0);
      expect(Number.isFinite(weeklyUpper) && Number.isFinite(longUpper)).toBe(true);
      // A ceiling UNDER the block's own peak is allowed and is the honest read
      // when the block was composed against a row the evidence does not support.
      // It refuses a bump (`belowTierUpper` false) and, at `planUpgrade`'s
      // `if (capped > old)`, skips the long bump — it never shrinks a row. This
      // gate cannot see that skip happen (it needs the DB); it asserts only the
      // number, and says so in the header.
      expect(a.peakWeekly).toBeGreaterThan(0);
    }
  });

  it('guard 7 · Rule 10 · the band carries the anchor it was struck against', () => {
    const { state } = author({ bestRecentVdotOverride: 52 } as Partial<SimInputs>);
    const anchor = state.tier_band_anchor as Record<string, unknown> | undefined;
    expect(anchor, 'the published band carries no anchor · a reader cannot recompute it').toBeTruthy();
    for (const k of ['demonstrated_peak_weekly_mi', 'cycle_growth_ceiling',
      'doctrine_band_weekly', 'doctrine_band_long', 'authored_peak_weekly_mi', 'authored_peak_long_mi']) {
      expect(Object.prototype.hasOwnProperty.call(anchor!, k), `anchor is missing ${k}`).toBe(true);
    }
    // The doctrine figure recorded is the engine's own, read at run time rather
    // than typed twice (Rule 18: a check that hardcodes both sides only proves
    // it agrees with itself).
    expect(anchor!.cycle_growth_ceiling).toBe(CYCLE_GROWTH_CEILING.advanced);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * CONFIDENCE-STRUCTURE-1 · a confidence value may not pick the block's shape
 * ═══════════════════════════════════════════════════════════════════════ */
function tenKInput(thesis: ThesisAtAuthoring | null): ComposePlanInput {
  const raceDistanceMi = 6.21;
  const cat = distanceCategoryOrThrow(raceDistanceMi);
  return {
    raceDistanceMi,
    goalSec: 2400,
    goalPaceSec: Math.round(2400 / raceDistanceMi),
    raceDateISO: '2026-04-26',
    startMondayISO: '2026-01-05',
    level: 'advanced',
    recentWeeklyMi: 45,
    easyDayMedianMi: 7,
    recentLongMi: 13,
    isMidBlock: false,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: 6,
    crossModes: [],
    rxQuality: inlinePrescriptions(cat),
    rxRaceSpecific: inlinePrescriptions(cat),
    tPaceSec: fixtureTPaceFromGoalPace(2400, raceDistanceMi),
    lthr: 168,
    maxHr: 185,
    ...(thesis ? { thesisAtAuthoring: thesis } : {}),
  };
}

const shapeOf = (thesis: ThesisAtAuthoring | null): string => {
  const p = composePlan(tenKInput(thesis));
  plansComposed++;
  return p.weeks.map((w) => `${w.startISO}:${w.phase}:${w.weeklyMi}:`
    + w.days.map((d) => `${d.type}/${d.distanceMi}/${d.subLabel}`).join('|')).join('\n');
};

describe('CONFIDENCE-STRUCTURE-1 · confidence is reported, never spent', () => {
  it('guard 8 · Rule 9 · a hair of confidence never changes the block in kind', () => {
    const none = shapeOf(null);
    // Liveness: a MEASURED basis must move something, or every assertion below
    // is satisfied by a composer that ignores its thesis input entirely.
    const measured = shapeOf({
      primaryLimiter: 'HIGH_INTENSITY',
      priority: 'increase_high_intensity_demand',
      confidence: 0.6,
      basis: 'CURVE_SHAPE_EVIDENCE',
      source: 'resolved',
    });
    expect(measured, 'a measured limiter changed nothing · this gate is inert').not.toBe(none);

    // The walk. Confidence crosses every value a ranking could produce,
    // INCLUDING the owner's own 0.51 and the 0.8400/0.8401 pair that used to
    // sit either side of `rankCapacities`' sort. The block may not move.
    for (const confidence of [0, 0.0001, 0.25, 0.5, 0.5099, 0.51, 0.5101, 0.8400, 0.8401, 0.99, 1]) {
      for (const limiter of ['DURABILITY', 'THRESHOLD', 'HIGH_INTENSITY'] as const) {
        const s = shapeOf({
          primaryLimiter: limiter,
          priority: limiter === 'DURABILITY' ? 'increase_long_run_demand'
            : limiter === 'THRESHOLD' ? 'increase_threshold_demand'
            : 'increase_high_intensity_demand',
          confidence,
          basis: 'LOWEST_CONFIDENCE_AMONG_EVIDENCED',
          source: 'resolved',
        });
        expect(s, `confidence ${confidence} on ${limiter} steered the block`).toBe(none);
      }
    }
  });

  it('guard 9 · an absent basis is "not a measurement", never a measurement', () => {
    // A `thesis_at_authoring` stamped before 2026-09-02 carries no `basis`.
    // Rule 11: unknown is not permission.
    expect(shapeOf({
      primaryLimiter: 'HIGH_INTENSITY',
      priority: 'increase_high_intensity_demand',
      confidence: 0.95,
      source: 'resolved',
    })).toBe(shapeOf(null));
  });
});

describe('LIVENESS · the gate actually composed plans', () => {
  it('LIVENESS · the scanner actually read files', () => {
    // A gate that reports clean because it looked at nothing is the worst
    // outcome available, since it also reports confidence (Rule 18).
    expect(plansComposed, 'this gate composed no plans').toBeGreaterThan(30);
  });
});
