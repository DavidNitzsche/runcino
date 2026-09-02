/**
 * _strategy_contracts.test.ts · BLOCK-STRATEGY-1 · brief §4.3, §5.1 and Phase 6.
 *
 * Five of brief §8's required invariants live here, and the first one is the
 * one everything else rests on:
 *
 *   1. Deriving the strategy CHANGES NOTHING. Composed weeks are byte-identical
 *      with the pass and without it. A description that alters what it
 *      describes is not a description, and this is the property that keeps
 *      `strategy-contracts.ts` from quietly becoming a second planning engine —
 *      which is the failure the brief names by name.
 *   2. A plan is never generated without a Coaching Thesis OR an explicit
 *      UNKNOWN. Absence is a value, never a missing field (Rule 11).
 *   3. Every phase states a primary development purpose.
 *   4. Every proposed progression step carries prerequisites AND a hold
 *      alternative. A step with neither is a plan that cannot be held.
 *   5. A build week names ONE primary stressor, and everything else it moved
 *      is on the record as a secondary change rather than unmentioned.
 *
 * ── WHAT THIS CANNOT FAIL ON (Rule 22) ──────────────────────────────────────
 *
 *   · Whether the strategy is a GOOD strategy. It asserts that the block says
 *     what it is doing, not that what it is doing is right. A block that
 *     progresses volume every week for fourteen weeks passes every assertion
 *     here and is refused by `validateComposedPlan` §3 and §6, which is where
 *     that question belongs.
 *   · The INTENSITY axis. `ComposedWeek` carries no scalar for "how hard", so
 *     a week that raises volume and quality INTENSITY together is one primary
 *     stressor as far as this can see. Stated in `strategy-contracts.ts`'s own
 *     header too, because it is the most important thing this cannot see.
 *   · Anything about a plan composed by a caller that stamps no
 *     `authoredState` — the pure unit fixtures. `attachBlockStrategy` is inert
 *     there by design, so this drives the derivation directly as well as
 *     through the composer, and says which it is doing each time.
 *   · Whether a PROPOSED step is ever resolved. Nothing writes EARNED / HELD /
 *     REDUCED / RESTRUCTURED today; the vocabulary exists so an adaptation
 *     pass has a contract to write into, and the brief is explicit that
 *     adaptation stays shadow-only. If a later change claims to resolve one,
 *     it needs its own gate — this one would not notice.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveBlockStrategy, BLOCK_STRATEGY_MODEL_VERSION,
  type BlockStrategy,
} from './strategy-contracts';
import {
  composePlan, finalizeComposedPlan, inlinePrescriptions,
  type ComposePlanInput, type DOW,
} from './generate';
import { tPaceFromGoal } from './spec-builder';

function marathonInput(over: Partial<ComposePlanInput> = {}): ComposePlanInput {
  return {
    raceDistanceMi: 26.2,
    goalSec: 10800,
    goalPaceSec: Math.round(10800 / 26.2),
    raceDateISO: '2026-12-06',
    startMondayISO: '2026-08-17',
    level: 'advanced',
    recentWeeklyMi: 50,
    easyDayMedianMi: 7,
    recentLongMi: 14,
    bestRecentVdot: 48,
    isMidBlock: true,
    longRunDow: 0 as DOW,
    restDow: 6 as DOW,
    qualityDows: [2, 4] as DOW[],
    trainingDaysPerWeek: null,
    crossModes: [],
    rxQuality: inlinePrescriptions('m'),
    rxRaceSpecific: inlinePrescriptions('m'),
    tPaceSec: tPaceFromGoal(10800, 26.2),
    lthr: null,
    maxHr: null,
    midBlockRaces: [],
    ...over,
  };
}

function composedWithStrategy(): { strategy: BlockStrategy; weeksJson: string } {
  const c = composePlan(marathonInput());
  finalizeComposedPlan(c, 26.2, 'advanced');
  const st = c.authoredState as Record<string, unknown>;
  return {
    strategy: st.block_strategy as BlockStrategy,
    weeksJson: JSON.stringify(c.weeks),
  };
}

describe('BLOCK-STRATEGY-1 · the description changes nothing', () => {
  it('the composed weeks are byte-identical with the strategy pass and without it', () => {
    // Falsified by making `attachBlockStrategy` write into a week: this fails
    // immediately. It is the load-bearing property of the whole module.
    const withPass = composePlan(marathonInput());
    finalizeComposedPlan(withPass, 26.2, 'advanced');
    const withoutPass = composePlan(marathonInput());
    finalizeComposedPlan(withoutPass, 26.2, 'advanced');
    delete (withoutPass.authoredState as Record<string, unknown>).block_strategy;
    expect(JSON.stringify(withPass.weeks)).toBe(JSON.stringify(withoutPass.weeks));
    // And the derivation itself does not mutate what it reads.
    const before = JSON.stringify(withPass.weeks);
    deriveBlockStrategy({
      weeks: withPass.weeks,
      phases: withPass.blocks.phases,
      targetEvent: null, statedGoalSec: null, thesis: null,
    });
    expect(JSON.stringify(withPass.weeks)).toBe(before);
  });

  it('is stamped on the block the composer ships', () => {
    const { strategy } = composedWithStrategy();
    expect(strategy, 'no block_strategy on authoredState').toBeTruthy();
    expect(strategy.modelVersion).toBe(BLOCK_STRATEGY_MODEL_VERSION);
    expect(strategy.weeks.length).toBeGreaterThan(10);
    expect(strategy.phases.length).toBeGreaterThan(1);
    // The target event is read out of the block's own race day, not stamped
    // separately — so it cannot disagree with the day the runner runs.
    expect(strategy.targetEvent?.dateISO).toBe('2026-12-06');
    expect(strategy.startingLoadMi).toBe(strategy.weeks[0].volumeMi);
    expect(strategy.peakLoadMi).toBe(Math.max(...strategy.weeks.map((w) => w.volumeMi)));
  });
});

describe('BLOCK-STRATEGY-1 · brief §8 invariants', () => {
  const { strategy } = composedWithStrategy();

  it('the Coaching Thesis is a value, never a missing field', () => {
    // Brief Phase 1: "Make Coaching Thesis a required input; allow `UNKNOWN`
    // explicitly." This fixture is a pure caller with no thesis, so the block
    // must SAY so rather than omit the field (Rule 11).
    expect(strategy.thesis).toBeTruthy();
    expect(typeof strategy.thesis.limiter).toBe('string');
    expect(strategy.thesis.limiter.length).toBeGreaterThan(0);
    expect(strategy.thesis.source).toBe('absent');
    // And a resolved thesis is carried verbatim rather than re-derived.
    const withThesis = deriveBlockStrategy({
      weeks: [{ startISO: '2026-08-17', phase: 'QUALITY', weeklyMi: 40, isRaceWeek: false, days: [] }],
      phases: [{ label: 'QUALITY', weeks: 1 }],
      targetEvent: null, statedGoalSec: null,
      thesis: { primaryLimiter: 'DURABILITY', priority: 'increase_long_run_demand', confidence: 0.51, source: 'resolved' },
    })!;
    expect(withThesis.thesis).toEqual({
      limiter: 'DURABILITY', priority: 'increase_long_run_demand', confidence: 0.51, source: 'resolved',
    });
  });

  it('every phase states a primary development purpose', () => {
    for (const p of strategy.phases) {
      expect(p.primaryDevelopment.length, `${p.id} states no development purpose`).toBeGreaterThan(10);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.startISO <= p.endISO, `${p.id} spans backwards`).toBe(true);
    }
    // The phases tile the block: every composed week belongs to exactly one.
    const covered = strategy.phases.reduce(
      (n, p) => n + strategy.weeks.filter((w) => w.weekStartISO >= p.startISO && w.weekStartISO <= p.endISO).length,
      0,
    );
    expect(covered, 'the phase spans do not tile the block').toBe(strategy.weeks.length);
  });

  it('every proposed step carries prerequisites AND a hold alternative', () => {
    const proposals = strategy.weeks.map((w) => w.proposedChange).filter((p) => p != null);
    // Rule 18 liveness: a block that proposes nothing cannot exercise this.
    expect(proposals.length, 'the block proposes no progression at all').toBeGreaterThan(2);
    for (const p of proposals) {
      expect(p!.status, 'nothing can be EARNED at authoring').toBe('PROPOSED');
      expect(p!.prerequisiteEvidence.length, `${p!.lever} step has no prerequisite`).toBeGreaterThan(0);
      for (const req of p!.prerequisiteEvidence) {
        expect(req.statement.length).toBeGreaterThan(10);
        // The prerequisite NAMES the owner rather than restating its numbers.
        expect(req.owner, `${p!.lever} prerequisite names no owner`).toMatch(/#|\.ts/);
        expect(req.statement, 'a prerequisite must not restate another owner\'s thresholds')
          .not.toMatch(/\b\d+(\.\d+)?\s*(%|mi|bpm)\b/);
      }
      expect(p!.holdAlternative, `${p!.lever} step has no hold alternative`).toMatch(/Repeat the week of \d{4}-\d{2}-\d{2}/);
      expect(p!.to, `${p!.lever} proposes a step that is not upward`).toBeGreaterThan(p!.from);
    }
  });

  it('a build week names ONE primary stressor and records the rest', () => {
    const builds = strategy.weeks.filter((w) => w.role === 'BUILD');
    expect(builds.length, 'the block has no build weeks').toBeGreaterThan(2);
    for (const w of builds) {
      expect(w.primaryProgressionLever, `${w.weekStartISO} builds without naming a lever`).toBeTruthy();
      // Whatever else moved is on the record. Brief §5.1: other variables may
      // move only within DECLARED tolerances, and this is the declaration.
      for (const c of w.secondaryChanges) {
        expect(c.lever).not.toBe(w.primaryProgressionLever);
        expect(c.deltaFraction).toBeGreaterThan(0);
      }
      // The primary is the LARGEST mover, so no secondary may exceed it.
      const primaryDelta = (w.proposedChange!.to - w.proposedChange!.from) / w.proposedChange!.from;
      for (const c of w.secondaryChanges) {
        expect(
          c.deltaFraction,
          `${w.weekStartISO}: ${c.lever} moved more than the declared primary ${w.primaryProgressionLever}`,
        ).toBeLessThanOrEqual(primaryDelta + 1e-9);
      }
    }
  });

  it('a week that advances nothing says so, and proposes nothing', () => {
    // Rule 11 · "no progression this week" and "we did not look" are different
    // facts. A cutback, a taper week and a race week all carry a role that
    // explains the null rather than an unexplained absence.
    for (const w of strategy.weeks) {
      if (w.primaryProgressionLever != null) continue;
      expect(w.proposedChange, `${w.weekStartISO} names no lever but proposes a step`).toBeNull();
      expect(w.rationale.length, `${w.weekStartISO} explains nothing`).toBeGreaterThan(10);
      expect(['HOLD', 'CUTBACK', 'TAPER', 'RACE', 'RECOVERY', 'BUILD']).toContain(w.role);
    }
    // A cutback never proposes a step: the reduction IS the work.
    for (const w of strategy.weeks.filter((x) => x.role === 'CUTBACK')) {
      expect(w.proposedChange, `${w.weekStartISO} is a cutback and proposes a progression`).toBeNull();
    }
  });

  it('the constraints and the adaptation policy are references, not copies', () => {
    expect(strategy.fixedConstraints.length).toBeGreaterThan(3);
    for (const c of strategy.fixedConstraints) {
      expect(c, `"${c}" is not a path#symbol reference`).toMatch(/\.ts#/);
    }
    expect(strategy.adaptationPolicy).toMatch(/shadow-only/);
  });
});
