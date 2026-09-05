/**
 * lib/plan/_thesis_controls_block.test.ts · THESIS-PLAN-1/2 (2026-09-02).
 *
 * THE COACHING THESIS CHANGES THE BLOCK, OR IT IS DECORATION.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * The Thesis has reached plan authoring since PHASE-ANSWERS-1 and `generate.ts`
 * said in its own comment what it did there: "the thesis is quoted into prose
 * and PRICES NOTHING". `thesisPlanDirective` — the projection of the Thesis into
 * the shape a composer consumes — had zero non-test callers across the repo.
 *
 * The plan-generation brief §3.2.I: "The Thesis identified high-intensity
 * evidence as the limiter while the early block used unpaced hills that could
 * not produce the specific evidence the Thesis said was needed; the first paced
 * interval arrived weeks later … Coincidental agreement is not strategy."
 *
 * This is Rule 21's standard applied to a coaching input rather than to an
 * adaptation: WIRED, TESTED AND INERT is this codebase's signature failure, so
 * the gate's job is to prove the mechanism FIRES, on a runner it can reach.
 *
 * ── Rule 15 · which case reaches each mechanism ─────────────────────────────
 *
 * The archetype corpus cannot reach either mechanism at all: `SimInputs` has no
 * thesis field, so every one of the 11,687 arcs composes with `thesisSlot` null.
 * Adding arcs would not help. So both tests drive `composePlan` DIRECTLY with a
 * `thesisAtAuthoring` set, which is the only shape that reaches the code.
 *
 * ── Rule 22 · what this gate cannot fail on ─────────────────────────────────
 *
 *   · Whether the limiter is RIGHT. `resolveCoachingThesis` owns that
 *     (Constitution §F) and this gate takes whatever it is told.
 *   · Whether the preferred session is BETTER training. It asserts only that a
 *     session which cannot produce a paced read is not the first answer to a
 *     limiter that needs one.
 *   · The DURABILITY limiter's own key session. Its evidence is the long run's
 *     duration, and the long slot is filled by `selectLongRunVariant`, which
 *     this wiring deliberately does not touch.
 *   · Anything about the TAPER or a race week. Neither is a development phase.
 *   · A thesis whose read FAILED. That is null here, the same as no thesis, and
 *     the two are told apart upstream by `ThesisAtAuthoring.source` (Rule 11) —
 *     this gate cannot see the difference and does not claim to.
 */
import { describe, it, expect } from 'vitest';
import { composePlan, inlinePrescriptions, type ComposePlanInput, type DOW } from './generate';
import { fixtureTPaceFromGoalPace } from './_fixture-goal-tpace';
import { distanceCategoryOrThrow } from '@/lib/race/distance-category';
import type { ThesisAtAuthoring } from './phase-answers';
import { WORKOUT_CATALOGUE } from '@/lib/workout-catalogue/catalogue';

/** A 10K build — the distance whose QUALITY phase doctrine fills with §6 rep
 *  work and §8 hills alike, so both a paced and an effort-cued answer exist on
 *  the intervals slot and the preference has something to choose between. */
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

/*
 * CONFIDENCE-STRUCTURE-1 (2026-09-02) · `basis` IS NOW LOAD-BEARING AND IS
 * SUPPLIED EXPLICITLY.
 *
 * The composer consumes the limiter only when a MEASUREMENT named it —
 * `basis: 'CURVE_SHAPE_EVIDENCE'`, doctrine's read of the runner's own graded
 * race curve (`Research/02` §7.1). On the other basis,
 * `LOWEST_CONFIDENCE_AMONG_EVIDENCED`, the limiter is the front of a sort by
 * `a.confidence - b.confidence` with no margin, so a fourth-decimal difference
 * would change the block's quality families in kind: Rule 9's defect exactly.
 * These two fixtures therefore state the basis rather than leaving it absent,
 * and the new test at the bottom of this file asserts the refusal.
 *
 * The fixtures' `confidence` values are kept and are deliberately NOT equal —
 * 0.6 against 0.5 — so a regression that started branching on confidence again
 * would have something to branch on.
 */
const HIGH_INTENSITY: ThesisAtAuthoring = {
  primaryLimiter: 'HIGH_INTENSITY',
  priority: 'increase_high_intensity_demand',
  confidence: 0.6,
  basis: 'CURVE_SHAPE_EVIDENCE',
  source: 'resolved',
};

const DURABILITY: ThesisAtAuthoring = {
  primaryLimiter: 'DURABILITY',
  priority: 'increase_long_run_demand',
  confidence: 0.5,
  basis: 'CURVE_SHAPE_EVIDENCE',
  source: 'resolved',
};

/** Every session the block authored on a quality day, in date order, with the
 *  catalogue entry behind it where the label names one. */
function authoredQuality(plan: ReturnType<typeof composePlan>) {
  const out: {
    weekStartISO: string; phase: string; type: string; subLabel: string;
    rationale: string; effortOnly: boolean | null; family: string | null;
  }[] = [];
  for (const w of plan.weeks) {
    for (const d of w.days) {
      if (!d.isQuality || d.isLong || d.type === 'race') continue;
      const rationale = String((d as { catalogueRationale?: string }).catalogueRationale ?? '');
      // The rationale opens with the catalogue entry's own name — the one place
      // the slug survives compose (`catalogue-rx.ts#selectSlotWorkout`).
      const entry = WORKOUT_CATALOGUE.find((e) => rationale.startsWith(e.name + ' ('));
      out.push({
        weekStartISO: w.startISO,
        phase: String(w.phase ?? ''),
        type: d.type,
        subLabel: String(d.subLabel ?? ''),
        rationale,
        effortOnly: entry ? entry.effortOnly : null,
        family: entry ? entry.family : null,
      });
    }
  }
  return out;
}

describe('THESIS-PLAN-1 · the limiter reaches the block', () => {
  /**
   * MECHANISM 1 · a limiter that needs a paced read gets one FIRST.
   *
   * Falsify by deleting `thesis: thesisSlot` from `selectSlotWorkout`'s
   * arguments in `generate.ts`: the block reverts to the no-thesis answer and
   * the first intervals-slot session is effort-cued again.
   */
  it('a HIGH_INTENSITY limiter gets a PACED session before an effort-cued one', () => {
    const blind = authoredQuality(composePlan(tenKInput(null)));
    const guided = authoredQuality(composePlan(tenKInput(HIGH_INTENSITY)));

    const firstIntervalsOf = (rows: ReturnType<typeof authoredQuality>) =>
      rows.find((r) => r.type === 'intervals' && r.effortOnly != null);

    const b = firstIntervalsOf(blind);
    const g = firstIntervalsOf(guided);

    console.log('\n=== THESIS-PLAN-1 · first intervals-slot session ===');
    console.log(`  no thesis      : ${b?.weekStartISO} "${b?.subLabel}" `
      + `family=${b?.family} effortOnly=${b?.effortOnly}`);
    console.log(`  HIGH_INTENSITY : ${g?.weekStartISO} "${g?.subLabel}" `
      + `family=${g?.family} effortOnly=${g?.effortOnly}`);
    if (g) console.log(`  rationale      : ${g.rationale}`);

    // Rule 18 liveness: the comparison is meaningless if either block authored
    // no identifiable intervals session at all.
    expect(b, 'the no-thesis block authored no catalogue intervals session').toBeTruthy();
    expect(g, 'the guided block authored no catalogue intervals session').toBeTruthy();

    // THE ASSERTION. A limiter that can only be evidenced by a clock does not
    // get an effort-cued session as its first answer.
    expect(
      g!.effortOnly,
      `HIGH_INTENSITY limiter's first intervals session is "${g!.subLabel}" (${g!.family}), `
        + 'which is prescribed by effort and cannot evidence it',
    ).toBe(false);

    // And the runner is told why (Rule 20: a decision nothing records is one
    // nobody can check). Only asserted when the preference actually had to
    // choose — if doctrine's own first pick was already paced, there is nothing
    // to explain and inventing a sentence would be worse.
    if (b!.effortOnly === true) {
      expect(
        g!.rationale,
        'the thesis changed the session and said nothing about it',
      ).toMatch(/Thesis names HIGH_INTENSITY as the limiter/);
    }
  });

  /**
   * MECHANISM 2 · a family the Thesis does not prioritise says so.
   *
   * Constitution §F's `not_priority` is a REPORTING obligation, not a ban —
   * see `ThesisSlotContext.doNotAddFamilies`. Verified live on the owner's
   * block, 2026-09-02, whose thesis resolves DURABILITY.
   *
   * Falsify by deleting `notPriorityClause` from `selectSlotWorkout`'s return.
   */
  it('a DURABILITY limiter explains every high-intensity session the block still places', () => {
    const rows = authoredQuality(composePlan(tenKInput(DURABILITY)));
    const notPriority = new Set(['vo2max', 'hills', 'speed']);
    const placed = rows.filter((r) => r.family != null && notPriority.has(r.family));
    const silent = placed.filter((r) => !/does not prioritise this family/.test(r.rationale));

    console.log(`\n=== THESIS-PLAN-2 · ${placed.length} not-priority sessions placed, `
      + `${silent.length} unexplained ===`);
    for (const r of placed.slice(0, 4)) console.log(`  ${r.weekStartISO} "${r.subLabel}" · ${r.rationale}`);

    // Rule 18 liveness. If doctrine placed none, this test proves nothing and
    // must say so rather than pass quietly.
    expect(
      placed.length,
      'the block placed no high-intensity session at all — this case cannot exercise the rule',
    ).toBeGreaterThan(0);
    expect(
      silent.length,
      `${silent.length} sessions the Thesis does not prioritise were placed with no explanation`,
    ).toBe(0);
  });

  /**
   * The boundary: no thesis, no change. A pure caller composes exactly the
   * block it always did, so the frozen periodization snapshot and the whole
   * archetype corpus are untouched by this wiring (Constitution §8 — never
   * "sometimes old, sometimes new").
   */
  it('a caller with no thesis composes an unchanged block', () => {
    const a = composePlan(tenKInput(null));
    const b = composePlan(tenKInput(null));
    const shape = (p: ReturnType<typeof composePlan>) =>
      p.weeks.map((w) => `${w.startISO}:${w.phase}:${w.weeklyMi}:`
        + w.days.map((d) => `${d.type}/${d.distanceMi}/${d.subLabel}`).join('|')).join('\n');
    expect(shape(a)).toBe(shape(b));
    // And a read that FAILED is not a limiter (Rule 11): it composes the same
    // block as no thesis at all, never the DURABILITY or HIGH_INTENSITY one.
    const failed = composePlan(tenKInput({
      primaryLimiter: 'UNKNOWN',
      priority: 'establish_evidence_before_prioritising',
      confidence: null,
      source: 'read_failed',
    }));
    expect(shape(failed)).toBe(shape(a));
  });

  /**
   * CONFIDENCE-STRUCTURE-1 (2026-09-02) · A CONFIDENCE RANKING MAY NOT PICK THE
   * BLOCK'S SHAPE.
   *
   * The same limiter, the same priority, the same `source: 'resolved'` — only
   * the BASIS differs. On `LOWEST_CONFIDENCE_AMONG_EVIDENCED` the block must
   * compose exactly as it does with no thesis at all, because that basis is a
   * sort of two confidences with no margin and the owner's own block was
   * authored against a thesis carried at 0.51.
   *
   * WHAT THIS TEST CANNOT FAIL ON (Rule 22): it cannot tell whether the
   * MEASURED basis picks the RIGHT limiter — that is `coaching-thesis.ts`'s
   * question and `_thesis_golden.test.ts`'s. It only asserts which KIND of fact
   * is allowed to reach the composer.
   */
  it('a confidence-ranked limiter composes the same block as no thesis at all', () => {
    const shape = (p: ReturnType<typeof composePlan>) =>
      p.weeks.map((w) => `${w.startISO}:${w.phase}:${w.weeklyMi}:`
        + w.days.map((d) => `${d.type}/${d.distanceMi}/${d.subLabel}`).join('|')).join('\n');
    const none = shape(composePlan(tenKInput(null)));
    // Liveness first: if the MEASURED basis changed nothing either, the
    // assertions below would pass for the wrong reason and this file would be
    // testing that composePlan ignores its own input. HIGH_INTENSITY is the
    // fixture the first test in this file already shows moves a session.
    const measured = shape(composePlan(tenKInput(HIGH_INTENSITY)));
    expect(measured).not.toBe(none);
    for (const limiter of ['DURABILITY', 'HIGH_INTENSITY', 'THRESHOLD'] as const) {
      const ranked = composePlan(tenKInput({
        primaryLimiter: limiter,
        priority: limiter === 'DURABILITY' ? 'increase_long_run_demand'
          : limiter === 'THRESHOLD' ? 'increase_threshold_demand'
          : 'increase_high_intensity_demand',
        confidence: 0.51,
        basis: 'LOWEST_CONFIDENCE_AMONG_EVIDENCED',
        source: 'resolved',
      }));
      expect(shape(ranked), `${limiter} steered the block off a confidence ranking`).toBe(none);
    }
    // A stamp written before 2026-09-02 carries NO basis. Absent is treated as
    // "not a measurement" (Rule 11 · unknown is not permission), never as one.
    const legacy = composePlan(tenKInput({
      primaryLimiter: 'DURABILITY',
      priority: 'increase_long_run_demand',
      confidence: 0.9,
      source: 'resolved',
    }));
    expect(shape(legacy)).toBe(none);
  });
});
