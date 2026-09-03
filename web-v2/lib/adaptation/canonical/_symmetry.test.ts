/**
 * lib/adaptation/canonical/_symmetry.test.ts · THE BAR UP, MEASURED, BESIDE THE
 * BAR DOWN.
 *
 * CLAUDE.md Rule 21:
 *
 *     "The bar to go UP may not be higher than the bar to come DOWN. When you
 *      write or touch an adaptation trigger, put its threshold beside its
 *      opposite number's and justify any asymmetry with a citation."
 *
 * Three of this engine's files assert in their own headers that they comply.
 * `contract-constants.ts`: "this engine has no downward-only lever to be
 * asymmetric against: every constant below governs a PROPOSAL, and the same
 * constant decides PROGRESS and HOLD." `threshold-pace.ts`: "this lever's bar
 * to go UP and its bar to come DOWN are THE SAME BAR." `weekly-volume.ts` used
 * to carry a sentence of exactly that shape and it was FALSE — replayed against
 * the owner's real history it produced 15 REGRESS and 0 PROGRESS, because
 * `stepsTakenThisCycle` sat below the REGRESS early return and so bound only
 * the upward path.
 *
 * That is the whole argument for this file. Rule 20: a header comment asserting
 * an invariant is documentation, not enforcement — gate the claim or delete the
 * sentence. Three sentences of that shape are live in this directory right now
 * and exactly one of them has ever been checked, by a replay, after the fact,
 * on one runner.
 *
 * ── HOW THE BAR IS MEASURED, AND WHY NOT READ ──────────────────────────────
 *
 * By SWEEP against the real lever functions, never by comparing two constants.
 *
 * Rule 18: "read numbers out of the cited source at run time rather than
 * hardcoding both sides — a check that hardcodes both only proves the test
 * agrees with itself." Comparing `VOLUME_WEEK_COMPLETION_MIN_FRAC` to itself
 * proves nothing at all, and it is precisely the check that would have passed
 * over the `weekly-volume` defect: that asymmetry was not in a constant, it was
 * in WHERE THE EARLY RETURN SAT. Only behaviour can see it.
 *
 * So for each lever, one quantity is swept across its whole range with
 * everything else held at a clean baseline, and the two crossing points are
 * found empirically:
 *
 *     barUp   · the least favourable value at which the lever still says PROGRESS
 *     barDown · the most favourable value at which the lever still says REGRESS
 *
 * A symmetric lever has ONE crossing: the same evidence that would authorise an
 * increase, pointed the other way, authorises a decrease. A gap between them is
 * a DEAD BAND — a region where the engine will pull back but will not push — and
 * a dead band that is not the same width on both sides is the Rule 21 defect
 * in its purest measurable form.
 *
 * ── WHAT IT MEASURES TODAY ─────────────────────────────────────────────────
 *
 * Swept on the shipped engine, and the three headers turn out to be telling the
 * truth:
 *
 *     WEEKLY_VOLUME   neutral 1.00 · pushes from 0.955 · pulls back from 0.95
 *     LONG_RUN        neutral 1.00 · pushes from 0.95  · pulls back from 0.945
 *     THRESHOLD_PACE  neutral 0    · pushes from +1 s/mi · pulls back from −1
 *
 * One crossing each, inside one sweep step. `ARGUED_ASYMMETRIES` is empty
 * because there is nothing to argue for. Worth stating plainly, because it is
 * the opposite of what the legacy path measured: the canonical engine's
 * inertia on the owner's real history is NOT an asymmetric bar. It is that he
 * never reached the bar at all, which is a different problem with a different
 * fix, and `scripts/adaptation-real-replay/upward-bar.ts` is where that one is
 * measured.
 *
 * ── FALSIFIED BEFORE BEING TRUSTED  ·  Rule 18 guard 1 ─────────────────────
 *
 * Two weakenings, applied to `levers/weekly-volume.ts` and watched.
 *
 *   A · the real defect, reintroduced: the `stepsTakenThisCycle` check made
 *       conditional on `allWeeksMet`, so the per-cycle cap binds only the
 *       upward path — which is exactly what "sat below the REGRESS early
 *       return" amounted to. The cadence test failed and named it.
 *   B · `allWeeksMet` raised from `VOLUME_WEEK_COMPLETION_MIN_FRAC` to 1.20, so
 *       going up needs 20% MORE than prescribed while coming down still fires
 *       at 5% less. Both the asymmetry test and the cadence test failed, and
 *       the asymmetry finding read: "the engine will PUSH only once the
 *       evidence sits 0.2 above neutral, but will PULL BACK as soon as it is
 *       0.05 below. Going up is 0.15 harder than coming down."
 *
 * The file was restored after each and the suite returned green.
 *
 * A third attempt is worth recording because it did NOT fail and taught
 * something: slackening the REGRESS side alone makes coming down HARDER, which
 * this gate deliberately permits — see the one-sidedness note on the assertion.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · **An asymmetry in a quantity it does not sweep.** It sweeps one axis per
 *   lever — the one the contract states as that lever's criterion. A lever that
 *   became asymmetric in, say, its deterioration handling would not be seen.
 *   The sweeps are listed explicitly below so that gap is countable.
 * · **A bar that is symmetric and WRONG.** Both directions being equally hard
 *   is all this measures. Whether 95% is the right number is the contract's
 *   question and `_doctrine_gate`'s, not this file's.
 * · **An asymmetry outside this engine.** The legacy `lib/plan/adapt.ts` path
 *   is what Rule 21 actually measured — five downgrades, zero upgrades, 309
 *   production intents — and it is untouched by anything here. This file can
 *   only certify the canonical engine, which is still unwired.
 * · **A dead band that doctrine WANTS.** A guard may legitimately be easier to
 *   trip downward; Rule 21 asks for a citation, not for the asymmetry to be
 *   zero. `ARGUED_ASYMMETRIES` is where such a case is recorded, and it is a
 *   ratchet: an entry whose lever has become symmetric fails until deleted.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { evaluateLongRun } from './levers/long-run';
import { evaluateThresholdPace } from './levers/threshold-pace';
import { evaluateWeeklyVolume } from './levers/weekly-volume';
import { measured } from './input';
import { THRESHOLD_ANCHOR_SEC, longRun, session, week } from './_fixtures';
import type { CanonicalDecision } from './decision-record';

/* ══════════════════════════════════════════════════════════════════════════
 * ARGUED ASYMMETRIES  ·  a ratchet, and every entry carries its citation
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Rule 21 does not forbid an asymmetry. It forbids an UNJUSTIFIED one, and it
 * requires the justification to be a citation rather than an instinct.
 *
 * Empty, and that is the finding rather than an omission: every crossing this
 * file measures came out at a single point. Rule 18 guard 4 applies — an entry
 * added here whose lever is in fact symmetric fails until it is deleted.
 */
const ARGUED_ASYMMETRIES: ReadonlyArray<{
  readonly lever: string;
  readonly axis: string;
  /** The doctrine sentence that licenses the gap. Never "we felt safer". */
  readonly citation: string;
  readonly expectedDeadBand: number;
}> = [];

/* ══════════════════════════════════════════════════════════════════════════
 * THE SWEEP
 * ═══════════════════════════════════════════════════════════════════════ */

interface Crossing {
  readonly lever: string;
  readonly axis: string;
  readonly unit: string;
  /**
   * The value at which the runner did EXACTLY what was asked and the evidence
   * points neither way. Rule 21's comparison is symmetric about this point, not
   * about zero, because "the bar to go up" and "the bar to come down" are both
   * distances FROM neutral.
   */
  readonly neutral: number;
  /** Resolution of the sweep. A gap within one step is one crossing, not two. */
  readonly step: number;
  /** Least favourable value still returning PROGRESS. Null if it never does. */
  readonly barUp: number | null;
  /** Most favourable value still returning REGRESS. Null if it never does. */
  readonly barDown: number | null;
  /** How far ABOVE neutral the evidence must sit before the engine will push. */
  readonly upEffort: number | null;
  /** How far BELOW neutral it must sit before the engine will pull back. */
  readonly downEffort: number | null;
  /** upEffort − downEffort. Positive means going up is harder. */
  readonly asymmetry: number | null;
  readonly samples: number;
}

/**
 * Sweep one axis and find both crossings.
 *
 * `decide(x)` runs the REAL lever. `values` MUST be ordered from least
 * favourable to an increase to most favourable, so `barUp` is the FIRST
 * PROGRESS and `barDown` is the LAST REGRESS as the sweep climbs.
 *
 * The axis is expressed in FAVOURABILITY, not in raw units, which is why
 * threshold pace is swept as an improvement in s/mi rather than as a pace: a
 * lower pace is a HIGHER favourability, and sweeping the raw number would put
 * the two crossings on the wrong ends. The first draft of this file did exactly
 * that and reported a dead band of -40 s/mi, which is not a quantity.
 */
function sweep(
  lever: string, axis: string, unit: string, neutral: number, step: number,
  values: readonly number[],
  decide: (x: number) => CanonicalDecision,
): Crossing {
  let barUp: number | null = null;
  let barDown: number | null = null;
  for (const x of values) {
    const d = decide(x);
    if (d === 'PROGRESS' && barUp === null) barUp = x;
    if (d === 'REGRESS') barDown = x;
  }
  const upEffort = barUp === null ? null : Number((barUp - neutral).toFixed(6));
  const downEffort = barDown === null ? null : Number((neutral - barDown).toFixed(6));
  return {
    lever,
    axis,
    unit,
    neutral,
    step,
    barUp,
    barDown,
    upEffort,
    downEffort,
    asymmetry: upEffort !== null && downEffort !== null
      ? Number((upEffort - downEffort).toFixed(6))
      : null,
    samples: values.length,
  };
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let x = from; x <= to + 1e-9; x += step) out.push(Number(x.toFixed(6)));
  return out;
};

/* ── WEEKLY VOLUME · the axis is week completion, contract Q21's own ─────── */

const volumeCrossing = sweep(
  'WEEKLY_VOLUME', 'three-week completion fraction', 'fraction of prescribed',
  // Neutral is 1.00 · he ran exactly what the plan asked for.
  1.0, 0.005,
  range(0.70, 1.20, 0.005),
  (f) => evaluateWeeklyVolume({
    todayISO: '2026-09-06',
    currentWeeklyMi: 47,
    weeks: [
      week('2026-08-17', 48, 48 * f),
      week('2026-08-24', 48, 48 * f),
      week('2026-08-31', 48, 48 * f),
    ],
    keySessions: [],
    longRuns: [longRun('lr-1', '2026-08-30', 16, 16.0)],
    nextWeekPrescribedMi: 48,
    stepsTakenThisCycle: 0,
  }).decision,
);

/* ── LONG RUN · the axis is completion of the two most recent ────────────── */

const longRunCrossing = sweep(
  'LONG_RUN', 'two-run completion fraction', 'fraction of prescribed',
  1.0, 0.005,
  range(0.70, 1.20, 0.005),
  (f) => evaluateLongRun({
    todayISO: '2026-09-06',
    currentLongRunMi: 16,
    longRuns: [
      longRun('lr-1', '2026-08-23', 16, 16 * f),
      longRun('lr-2', '2026-08-30', 16, 16 * f),
    ],
    nextLongRunMi: 16,
    longestInPrior30DaysMi: 20,
    coherentWithWeeklyVolume: true,
    weeksRemainingInBuild: 12,
    collidesWithRaceOrTaper: false,
    stepsTakenThisCycle: 0,
  }).decision,
);

/* ── THRESHOLD PACE · the axis is the demonstrated pace itself ───────────── */

const thresholdCrossing = sweep(
  'THRESHOLD_PACE', 'demonstrated improvement on the anchor', 's/mi faster than the anchor',
  // Neutral is 0 · he ran exactly at his anchor. Swept as an IMPROVEMENT so
  // higher is more favourable to an increase, matching the other two axes.
  0, 1,
  range(-20, 20, 1),
  (improvement) => {
    const p = THRESHOLD_ANCHOR_SEC - improvement;
    return evaluateThresholdPace({
      todayISO: '2026-09-06',
      currentAnchorSecPerMi: THRESHOLD_ANCHOR_SEC,
      sessions: [
        session('s-1', '2026-08-25', { workPaceSecPerMi: measured(p), thresholdEquivalentPaceSecPerMi: measured(p) }),
        session('s-2', '2026-09-01', { workPaceSecPerMi: measured(p), thresholdEquivalentPaceSecPerMi: measured(p) }),
      ],
      anchorMovedToday: false,
    }).decision;
  },
);

/* ── THE CADENCE AXIS · the one that was actually broken ─────────────────── */

/**
 * `stepsTakenThisCycle` is not a physiological quantity, so it gets its own
 * pair rather than a sweep: does the per-cycle cap bind BOTH directions, or
 * only the upward one?
 *
 * This is the exact shape of the real defect. The constant was correct, the
 * citation was correct, and the check sat below the REGRESS early return, so
 * the same three missed weeks were re-spent at every weekly boundary and walked
 * the belief from 43.5 mi/wk to 30.2.
 */
function volumeAt(f: number, steps: number): CanonicalDecision {
  return evaluateWeeklyVolume({
    todayISO: '2026-09-06',
    currentWeeklyMi: 47,
    weeks: [
      week('2026-08-17', 48, 48 * f),
      week('2026-08-24', 48, 48 * f),
      week('2026-08-31', 48, 48 * f),
    ],
    keySessions: [],
    longRuns: [longRun('lr-1', '2026-08-30', 16, 16.0)],
    nextWeekPrescribedMi: 48,
    stepsTakenThisCycle: steps,
  }).decision;
}

function longRunAt(f: number, steps: number): CanonicalDecision {
  return evaluateLongRun({
    todayISO: '2026-09-06',
    currentLongRunMi: 16,
    longRuns: [
      longRun('lr-1', '2026-08-23', 16, 16 * f),
      longRun('lr-2', '2026-08-30', 16, 16 * f),
    ],
    nextLongRunMi: 16,
    longestInPrior30DaysMi: 20,
    coherentWithWeeklyVolume: true,
    weeksRemainingInBuild: 12,
    collidesWithRaceOrTaper: false,
    stepsTakenThisCycle: steps,
  }).decision;
}

const CROSSINGS = [volumeCrossing, longRunCrossing, thresholdCrossing];

describe('Rule 21 · the bar to go up, measured beside the bar to come down', () => {
  it('liveness · every sweep actually found both crossings', () => {
    // Rule 18 guard 2. A sweep that found neither crossing would report an
    // asymmetry of null and quietly assert nothing, which is worse than a
    // failure because it also reports confidence.
    const blind: string[] = [];
    for (const c of CROSSINGS) {
      expect(c.samples).toBeGreaterThan(20);
      if (c.barUp === null) {
        blind.push(`${c.lever}: no PROGRESS anywhere on ${c.axis} across ${c.samples} samples `
          + '— the upward path is unreachable on its own criterion, which is a wall.');
      }
      if (c.barDown === null) {
        blind.push(`${c.lever}: no REGRESS anywhere on ${c.axis} across ${c.samples} samples.`);
      }
    }
    expect(blind).toEqual([]);
  });

  it('going UP is not harder than coming DOWN, or the gap is argued with a citation', () => {
    // Rule 21's sentence, as arithmetic: "the bar to go UP may not be higher
    // than the bar to come DOWN". Both are distances from neutral — the point
    // at which the runner did exactly what was asked — so the comparison is
    // upEffort against downEffort, not one raw value against the other.
    //
    // Note this is deliberately ONE-SIDED. A lever that pushes more readily
    // than it pulls back passes, because that is not the defect Rule 21 was
    // locked over and this engine has no history of it. If that ever becomes
    // the failure, this is where the other half goes.
    const findings: string[] = [];
    for (const c of CROSSINGS) {
      const argued = ARGUED_ASYMMETRIES.find(
        (a) => a.lever === c.lever && a.axis === c.axis,
      );
      const asym = c.asymmetry ?? 0;
      // A gap within one sweep step is one crossing measured at finite
      // precision, not an asymmetry.
      const asymmetric = asym > c.step * 1.5;

      if (asymmetric && !argued) {
        findings.push(
          `${c.lever} · ${c.axis}: the engine will PUSH only once the evidence sits `
          + `${c.upEffort} ${c.unit} above neutral, but will PULL BACK as soon as it is `
          + `${c.downEffort} below. Going up is ${asym} ${c.unit} harder than coming down. `
          + 'Rule 21: put the threshold beside its opposite number and justify the asymmetry '
          + 'with a citation, or remove it.',
        );
      }
      // Rule 18 guard 4 · the allowlist is a ratchet. An entry whose lever has
      // become symmetric must be deleted, not left "in case".
      if (argued && !asymmetric) {
        findings.push(
          `${c.lever} · ${c.axis} is now symmetric, so the argued exemption citing `
          + `"${argued.citation}" is stale and must be deleted.`,
        );
      }
    }
    expect(findings).toEqual([]);
  });

  it('the per-cycle cadence cap binds BOTH directions, not just the upward one', () => {
    // The real defect, as a behavioural assertion rather than a code shape.
    // With a step already taken this cycle, evidence that WOULD have moved the
    // lever must move it in NEITHER direction.
    const findings: string[] = [];

    for (const [name, at] of [
      ['WEEKLY_VOLUME', volumeAt],
      ['LONG_RUN', longRunAt],
    ] as const) {
      // Evidence that clears the bar upward, and evidence that misses it — both
      // strong enough to move the lever when no step has been taken.
      const upFresh = at(1.05, 0);
      const downFresh = at(0.75, 0);
      expect(upFresh, `${name}: the sweep baseline should PROGRESS with no step taken`).toBe('PROGRESS');
      expect(downFresh, `${name}: the sweep baseline should REGRESS with no step taken`).toBe('REGRESS');

      const upCapped = at(1.05, 1);
      const downCapped = at(0.75, 1);
      if (upCapped === 'PROGRESS') {
        findings.push(`${name}: the per-cycle cap did not hold the UPWARD path.`);
      }
      if (downCapped === 'REGRESS') {
        findings.push(
          `${name}: the per-cycle cap holds the upward path but NOT the downward one. `
          + 'That is the exact defect that walked the owner\'s belief from 43.5 mi/wk to 30.2 '
          + 'across seven applied steps off substantially one piece of evidence.',
        );
      }
    }
    expect(findings).toEqual([]);
  });

  it('reports the measured crossings, so the numbers are readable rather than implied', () => {
    const lines = CROSSINGS.map(
      (c) => `${c.lever.padEnd(16)} ${c.axis.padEnd(40)} neutral ${c.neutral}`
        + ` · PROGRESS from ${String(c.barUp).padStart(7)} (effort +${c.upEffort})`
        + ` · REGRESS up to ${String(c.barDown).padStart(7)} (effort ${c.downEffort})`
        + ` · up-minus-down ${c.asymmetry} ${c.unit}`,
    );
    // `vitest.config.ts` silences console in this suite, so the numbers go to a
    // file when asked for rather than to a stream nobody sees. Rule 18's spirit:
    // a report that cannot be read is a report that is not made.
    const out = process.env.SYMMETRY_OUT;
    if (out) {
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `Rule 21 · measured crossings (swept, not read)\n${lines.join('\n')}\n`);
    }
    expect(lines.length).toBe(3);
  });
});
