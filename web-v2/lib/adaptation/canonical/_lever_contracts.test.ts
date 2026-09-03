/**
 * lib/adaptation/canonical/_lever_contracts.test.ts · THE THREE PER-LEVER
 * EVIDENCE CONTRACTS, CLAUSE BY CLAUSE.
 *
 * Every case calls the REAL lever function. Nothing is mocked or stubbed.
 *
 * ── RULE 21 · THE PROPERTY THIS FILE EXISTS TO ESTABLISH ───────────────────
 *
 * The engine that motivated this work had five downgrades and ZERO upgrades
 * across 309 production intents. So for each of the three levers this file
 * asserts BOTH directions from evidence of the same strength, and the
 * distribution block at the bottom fails if the upward cases are outnumbered.
 * A suite that only asks "did you correctly refuse" will pass an engine that
 * can only refuse.
 *
 * ── RULE 15 · WHICH CASE REACHES WHICH MECHANISM ───────────────────────────
 *
 * Named per case in the test titles, because a mechanism no case can reach is
 * untested however many pass. The mechanisms and their reaching case:
 *
 *   corroboration bar          · "one session is not corroboration"
 *   separate-days rule         · "two sessions on the same day count once"
 *   direction consistency      · "sessions that disagree produce a HOLD"
 *   ordinary vs larger step    · "three FULL sessions unlock the larger step"
 *   same-day oscillation       · "an anchor already moved today holds"
 *   distance relevance         · "a marathon is not clean threshold evidence"
 *   treadmill rule             · "a treadmill session cannot price road pace"
 *   truncation, pace           · "work completed before the cut can still price"
 *   truncation, durability     · "a truncated long run refuses"
 *   Rule 11 unreadable week    · "an unreadable week refuses, it is not a zero"
 *   cutback exclusion          · "a cutback week is not a week he fell short of"
 *   plan-already-progresses    · "three good weeks authorize, they do not force"
 *   one step per cycle         · "a lever that already stepped this cycle holds"
 *   spike ceiling              · "the 30-day spike ceiling caps the step"
 *   race/taper collision       · "a long run inside the taper holds"
 *   following key session      · "a failed following session holds"
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · A belief that arrived wrong. Every lever moves the carried belief by a
 *   bounded step, so a wrong anchor produces uniformly wrong proposals and
 *   nothing here notices.
 * · A grade that was wrongly assigned upstream. Grades are fixture inputs.
 * · Whether the prescribed week was itself big enough. Completion is measured
 *   against what was prescribed.
 */
import { describe, it, expect } from 'vitest';
import { evaluateThresholdPace } from './levers/threshold-pace';
import { evaluateWeeklyVolume } from './levers/weekly-volume';
import { evaluateLongRun } from './levers/long-run';
import type { CanonicalDecision } from './decision-record';
import { measured, absent } from './input';
import {
  session, week, longRun, cleanThirds, decayingThirds,
  threeGoodWeeks, twoGoodLongRuns, twoFasterThresholdSessions,
  THRESHOLD_ANCHOR_SEC,
} from './_fixtures';

const seen: Array<{ lever: string; decision: CanonicalDecision }> = [];
const record = (lever: string, d: CanonicalDecision): CanonicalDecision => {
  seen.push({ lever, decision: d });
  return d;
};

/* ══════════════════════════════════════════════════════════════════════════
 * THRESHOLD PACE
 * ═══════════════════════════════════════════════════════════════════════ */

const threshold = (o?: Partial<Parameters<typeof evaluateThresholdPace>[0]>) =>
  evaluateThresholdPace({
    todayISO: '2026-09-06',
    currentAnchorSecPerMi: THRESHOLD_ANCHOR_SEC,
    sessions: [],
    anchorMovedToday: false,
    ...o,
  });

describe('THRESHOLD PACE', () => {
  it('PROGRESS · two corroborating faster sessions move the anchor', () => {
    const v = threshold({ sessions: twoFasterThresholdSessions() });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('PROGRESS');
    expect(v.proposedAfterValue).toBeLessThan(v.beforeValue);
    expect(v.included).toHaveLength(2);
  });

  it('the ordinary step is bounded at 3 s/mi even when evidence suggests more', () => {
    // Sessions 20 s/mi faster than the anchor. The contract's bound holds.
    const v = threshold({
      sessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(410) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(408) }),
      ],
    });
    expect(v.decision).toBe('PROGRESS');
    expect(Math.abs(v.magnitude!.value)).toBe(3);
    expect(v.magnitude!.limitConstant).toBe('THRESHOLD_ORDINARY_STEP_SEC_PER_MI');
    expect(v.confidence.limitation).toMatch(/held to the bound/);
  });

  it('three FULL sessions unlock the larger 5 s/mi step', () => {
    const v = threshold({
      sessions: [
        session('a', '2026-08-22', { workPaceSecPerMi: measured(410) }),
        session('b', '2026-08-27', { workPaceSecPerMi: measured(409) }),
        session('c', '2026-09-01', { workPaceSecPerMi: measured(408) }),
      ],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('PROGRESS');
    expect(Math.abs(v.magnitude!.value)).toBe(5);
    expect(v.magnitude!.limitConstant).toBe('THRESHOLD_MAX_STEP_SEC_PER_MI');
  });

  it('REGRESS · two slower sessions ease the anchor, at the SAME bar', () => {
    // Rule 21 · identical evidence strength, opposite direction. If this
    // required less evidence than PROGRESS, the engine would have the exact
    // disposition Rule 21 measured.
    const v = threshold({
      sessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(440) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(442) }),
      ],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('REGRESS');
    expect(v.proposedAfterValue).toBeGreaterThan(v.beforeValue);
  });

  it('HOLD · one session is not corroboration, and the HOLD says what is missing', () => {
    const v = threshold({
      sessions: [session('a', '2026-09-01', { workPaceSecPerMi: measured(420) })],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('HOLD');
    expect(v.whatWouldChangeIt.join(' ')).toMatch(/1 more qualifying threshold session/);
    // Rule 21 · never silence.
    expect(v.reason.length).toBeGreaterThan(0);
  });

  it('HOLD · sessions that disagree produce a hold, never a bouncing anchor', () => {
    const v = threshold({
      sessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(420) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(440) }),
      ],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('HOLD');
    expect(v.contradictory.length).toBeGreaterThan(0);
  });

  it('HOLD · an anchor already moved today does not move again', () => {
    const v = threshold({ sessions: twoFasterThresholdSessions(), anchorMovedToday: true });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('HOLD');
  });

  it('two qualifying sessions on the SAME day count once', () => {
    const v = threshold({
      sessions: [
        session('a', '2026-09-01', { workPaceSecPerMi: measured(420) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(421) }),
      ],
    });
    expect(v.decision).toBe('HOLD');
    expect(v.excluded.some((e) => e.reason === 'SINGLE_EXCEPTIONAL_PERFORMANCE')).toBe(true);
  });

  it('a marathon is NOT clean threshold evidence, and says what it IS good for', () => {
    const v = threshold({
      sessions: [
        session('m', '2026-08-25', { raceDistance: 'MARATHON', workPaceSecPerMi: measured(400) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(424) }),
      ],
    });
    expect(v.decision).toBe('HOLD');
    const ex = v.excluded.find((e) => e.activityId === 'm')!;
    expect(ex.reason).toBe('WRONG_LEVER_FOR_THIS_SESSION');
    expect(ex.detail).toMatch(/durability and execution/);
    expect(ex.stillAdmissibleFor).toContain('durability evidence');
  });

  it('a 5K informs high-intensity capacity, not threshold', () => {
    const v = threshold({
      sessions: [session('f', '2026-09-01', { raceDistance: 'FIVE_K', workPaceSecPerMi: measured(380) })],
    });
    const ex = v.excluded.find((e) => e.activityId === 'f')!;
    expect(ex.detail).toMatch(/high-intensity capacity/);
  });

  it('a 10K race plus one training session corroborates', () => {
    const v = threshold({
      sessions: [
        session('r', '2026-08-25', { raceDistance: 'TEN_K', workPaceSecPerMi: measured(420) }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(423) }),
      ],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('PROGRESS');
  });

  it('a treadmill session cannot price road pace, but still counts for volume', () => {
    const v = threshold({
      sessions: [
        session('t', '2026-08-25', {
          workPaceSecPerMi: measured(415),
          provOpts: { treadmill: true },
        }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(424) }),
      ],
    });
    expect(v.decision).toBe('HOLD');
    const ex = v.excluded.find((e) => e.activityId === 't')!;
    expect(ex.reason).toBe('TREADMILL_CANNOT_PRICE_ROAD_PACE');
    expect(ex.stillAdmissibleFor).toContain('weekly volume');
  });

  it('a session that fell apart late is contradictory, however fast it was', () => {
    // The doctrine's Example B. Beating the target is not the question.
    const v = threshold({
      sessions: [
        session('a', '2026-08-25', { workPaceSecPerMi: measured(415), thirds: decayingThirds() }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(424) }),
      ],
    });
    expect(v.decision).toBe('HOLD');
    expect(v.contradictory.some((c) => c.activityId === 'a')).toBe(true);
  });

  it('truncated work that finished before the cut can still price the session', () => {
    // Q29 · "Complete, correctly segmented work intervals captured before
    // truncation may give pace or threshold evidence."
    const v = threshold({
      sessions: [
        session('a', '2026-08-25', {
          workPaceSecPerMi: measured(424),
          provOpts: {
            truncation: { truncated: true, completeWorkPhasesCaptured: true, note: 'watch died on cooldown' },
          },
          thirds: cleanThirds(),
        }),
        session('b', '2026-09-01', { workPaceSecPerMi: measured(425) }),
      ],
    });
    // Q29 permits it: the work intervals finished before the cut, so they may
    // price the session. But the contract attaches a CONDITION to that
    // permission, and the first draft took the permission without it. The
    // session is admitted, it carries half the weight of a fully recorded one,
    // the record says which portion was admitted, and it cannot unlock the
    // larger step.
    expect(v.decision).toBe('PROGRESS');
    expect(v.excluded.some((e) => e.activityId === 'a')).toBe(false);

    const admitted = v.included.find((i) => i.activityId === 'a')!;
    expect(admitted.what).toMatch(/completed work intervals only/);
    expect(admitted.weight).toBe(0.5);
    expect(v.confidence.limitation).toMatch(/counts for less/);
  });

  it('a partially recorded session never unlocks the larger 5 s/mi step', () => {
    const v = threshold({
      sessions: [
        session('a', '2026-08-22', {
          workPaceSecPerMi: measured(410),
          provOpts: {
            truncation: { truncated: true, completeWorkPhasesCaptured: true, note: 'cut on cooldown' },
          },
        }),
        session('b', '2026-08-27', { workPaceSecPerMi: measured(409) }),
        session('c', '2026-09-01', { workPaceSecPerMi: measured(408) }),
      ],
    });
    expect(record('THRESHOLD_PACE', v.decision)).toBe('PROGRESS');
    // Three FULL sessions would ordinarily unlock 5 s/mi. One of them is only
    // partially recorded, so the ordinary bound applies instead.
    expect(Math.abs(v.magnitude!.value)).toBe(3);
    expect(v.magnitude!.limitConstant).toBe('THRESHOLD_ORDINARY_STEP_SEC_PER_MI');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * WEEKLY VOLUME
 * ═══════════════════════════════════════════════════════════════════════ */

const volume = (o?: Partial<Parameters<typeof evaluateWeeklyVolume>[0]>) =>
  evaluateWeeklyVolume({
    todayISO: '2026-09-06',
    currentWeeklyMi: 47,
    weeks: threeGoodWeeks(),
    keySessions: [],
    longRuns: twoGoodLongRuns(),
    nextWeekPrescribedMi: 48,
    stepsTakenThisCycle: 0,
    ...o,
  });

describe('WEEKLY VOLUME', () => {
  it('PROGRESS · three consecutive weeks at 95% authorize a 5% step', () => {
    const v = volume();
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('PROGRESS');
    expect(v.proposedAfterValue).toBeCloseTo(48 * 1.05, 1);
    expect(v.magnitude!.limitConstant).toBe('VOLUME_MAX_STEP_FRAC');
  });

  it('REGRESS · three weeks all under the bar ease the level, at the SAME bar', () => {
    const v = volume({
      weeks: [
        week('2026-08-17', 48, 40),
        week('2026-08-24', 48, 41),
        week('2026-08-31', 48, 39),
      ],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REGRESS');
    expect(v.proposedAfterValue).toBeLessThan(v.beforeValue);
  });

  it('REFUSE · an unreadable week is not a week at zero (Rule 11)', () => {
    const v = volume({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 0, { completedMi: absent('sync failed') }),
        week('2026-08-31', 48, 47.9),
      ],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REFUSE');
    expect(v.reason).toMatch(/cannot be evaluated either way/);
    // The critical property: it did NOT read as a missed week and REGRESS.
    expect(v.decision).not.toBe('REGRESS');
  });

  it('REFUSE · a week with incomplete data refuses rather than crediting it', () => {
    const v = volume({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 48.1, { dataComplete: false }),
        week('2026-08-31', 48, 47.9),
      ],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REFUSE');
  });

  it('REFUSE · fewer than three non-cutback weeks', () => {
    const v = volume({ weeks: [week('2026-08-31', 48, 48)] });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REFUSE');
  });

  it('a cutback week is excluded, not counted as a week he fell short of', () => {
    const v = volume({
      weeks: [
        week('2026-08-10', 47, 47.2),
        week('2026-08-17', 47, 47.1),
        week('2026-08-24', 36, 35, { isCutback: true }),
        week('2026-08-31', 48, 47.9),
      ],
    });
    expect(v.decision).toBe('PROGRESS');
    expect(v.excluded.some((e) => e.reason === 'PRESCRIBED_RECOVERY_OR_TAPER')).toBe(true);
  });

  it('HOLD · one week short of the bar', () => {
    const v = volume({
      weeks: [
        week('2026-08-17', 47, 47.2),
        week('2026-08-24', 48, 43),
        week('2026-08-31', 48, 47.9),
      ],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
  });

  it('HOLD · three good weeks AUTHORIZE a proposal, they do not force one', () => {
    // The contract's own sentence, and the clause that makes this a coach
    // rather than a ratchet: the plan already steps up next week.
    const v = volume({ nextWeekPrescribedMi: 52 });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
    expect(v.reason).toMatch(/the plan is already providing that progression/);
  });

  it('HOLD · a key session that missed its stimulus holds the level', () => {
    const v = volume({
      keySessions: [session('k', '2026-09-01', { grade: 'PARTIAL' })],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
  });

  it('HOLD · repeated late deterioration holds the level', () => {
    const v = volume({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 16, { thirds: decayingThirds() }),
        longRun('l2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
      ],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
    expect(v.reason).toMatch(/fell away in their final phase/);
  });

  it('HOLD · one step per cutback cycle', () => {
    const v = volume({ stepsTakenThisCycle: 1 });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
    expect(v.reason).toMatch(/one step per cutback cycle/);
  });

  // Rule 21 · the cadence bound used to sit BELOW the REGRESS early return, so
  // "one step per cutback cycle" governed only the upward path. Replayed on
  // real history that let the same three missed weeks be re-spent at seven
  // consecutive boundaries, walking the belief 43.5 to 30.2 mi/wk. These two
  // cases are the same evidence pointed both ways against the same counter.
  it('HOLD · the cycle cap binds the DOWNWARD step too, on the same counter', () => {
    const missed = [week('2026-08-17', 47, 30), week('2026-08-24', 48, 31), week('2026-08-31', 48, 29)];
    const free = volume({ weeks: missed, stepsTakenThisCycle: 0 });
    expect(record('WEEKLY_VOLUME', free.decision)).toBe('REGRESS');

    const spent = volume({ weeks: missed, stepsTakenThisCycle: 1 });
    expect(record('WEEKLY_VOLUME', spent.decision)).toBe('HOLD');
    expect(spent.reason).toMatch(/one step per cutback cycle/);
  });

  // The compounding defect itself, in its own units. `allWeeksMissed` is
  // measured against the PRESCRIPTION and moves the BELIEF, and on 2026-08-17
  // the belief was cut to 33.5 while two of the three weeks read 39.8 and 47.5
  // mi completed. A belief already at or below demonstrated work has nothing to
  // ease.
  it('HOLD · a belief already below what he ran is not eased further', () => {
    const v = volume({
      currentWeeklyMi: 35,
      // Every week missed a prescription from a bigger block, and every week
      // was still run at or above the belief being reduced.
      weeks: [week('2026-08-17', 60, 39.8), week('2026-08-24', 60, 42.1), week('2026-08-31', 60, 47.5)],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('HOLD');
    expect(v.reason).toMatch(/What was missed was a larger prescription, not this level/);
  });

  it('REGRESS · and it still eases when he genuinely ran less than the belief', () => {
    // The falsifier for the case above: same shape, lower completed miles.
    const v = volume({
      currentWeeklyMi: 35,
      weeks: [week('2026-08-17', 60, 24.0), week('2026-08-24', 60, 26.1), week('2026-08-31', 60, 22.5)],
    });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REGRESS');
    expect(v.proposedAfterValue!).toBeLessThan(35);
    // And never below the mean he actually ran across those same weeks.
    expect(v.proposedAfterValue!).toBeGreaterThanOrEqual(24.2);
  });

  it('REFUSE · a week the plan has not authored yet is not a week prescribed at zero', () => {
    const v = volume({ weeks: threeGoodWeeks(), nextWeekPrescribedMi: 0 });
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REFUSE');
    expect(v.reason).not.toMatch(/no distance/);
  });

  // Rule 8 · the production row for the owner's post-race recovery block says
  // `is_cutback FALSE` on two weeks its own plan authored `mode: 'recovery'`.
  it('a recovery-mode plan is read as a cutback even when the flag says otherwise', () => {
    const v = volume({
      weeks: [
        week('2026-08-10', 47, 47.2),
        week('2026-08-17', 17, 28.4, { isCutback: false, authoredPlanMode: 'RECOVERY' }),
        week('2026-08-24', 20, 18.5, { isCutback: false, authoredPlanMode: 'RECOVERY' }),
      ],
    });
    // Two of three weeks are excluded, so there are not three to read.
    expect(record('WEEKLY_VOLUME', v.decision)).toBe('REFUSE');
    const excludedWeeks = v.excluded.filter((e) => e.reason === 'PRESCRIBED_RECOVERY_OR_TAPER');
    expect(excludedWeeks.length).toBe(2);
    expect(excludedWeeks[0].detail).toMatch(/flag and the plan\s+disagree|flag and the plan disagree/);
  });

  it('FALSIFIER · the same two weeks under a BUILD plan are NOT excluded', () => {
    const v = volume({
      weeks: [
        week('2026-08-10', 47, 47.2),
        week('2026-08-17', 17, 28.4, { isCutback: false, authoredPlanMode: 'BUILD' }),
        week('2026-08-24', 20, 18.5, { isCutback: false, authoredPlanMode: 'BUILD' }),
      ],
    });
    expect(v.excluded.filter((e) => e.reason === 'PRESCRIBED_RECOVERY_OR_TAPER').length).toBe(0);
  });

  it('a key session older than the weeks being read is windowed out, not held against him', () => {
    const v = volume({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      keySessions: [
        session('old', '2026-06-11', { grade: 'DIFFERENT' }),
        session('new', '2026-08-25', { grade: 'FULL' }),
      ],
    });
    expect(v.contradictory.some((c) => c.dateISO === '2026-06-11')).toBe(false);
    expect(v.excluded.some(
      (e) => e.dateISO === '2026-06-11' && e.reason === 'OUTSIDE_EVIDENCE_WINDOW',
    )).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * LONG RUN
 * ═══════════════════════════════════════════════════════════════════════ */

const long = (o?: Partial<Parameters<typeof evaluateLongRun>[0]>) =>
  evaluateLongRun({
    todayISO: '2026-09-06',
    currentLongRunMi: 16,
    longRuns: twoGoodLongRuns(),
    nextLongRunMi: 16,
    longestInPrior30DaysMi: 16.1,
    coherentWithWeeklyVolume: true,
    weeksRemainingInBuild: 10,
    collidesWithRaceOrTaper: false,
    stepsTakenThisCycle: 0,
    ...o,
  });

describe('LONG RUN', () => {
  it('PROGRESS · two completed long runs that held together add a mile', () => {
    const v = long();
    expect(record('LONG_RUN', v.decision)).toBe('PROGRESS');
    expect(v.proposedAfterValue).toBe(17);
    expect(v.magnitude!.value).toBe(1);
  });

  it('the 30-day spike ceiling caps the step below a mile', () => {
    // Rule 8 corollary · the LITERAL recent max, unfiltered. An injury guard.
    const v = long({ longestInPrior30DaysMi: 15 });
    expect(record('LONG_RUN', v.decision)).toBe('PROGRESS');
    expect(v.proposedAfterValue).toBe(16.5); // 15 * 1.10
    expect(v.magnitude!.limitConstant).toBe('SPIKE_CEILING_FRAC_OF_PRIOR_30D_MAX');
    expect(v.magnitude!.limitCitation).toMatch(/Research\/00a/);
  });

  it('REGRESS · two long runs both short ease the distance', () => {
    const v = long({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 13),
        longRun('l2', '2026-08-30', 16, 13.5),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('REGRESS');
    expect(v.proposedAfterValue).toBeLessThan(v.beforeValue);
  });

  it('REFUSE · a truncated long run cannot show how it finished', () => {
    // Q29 · "absence of a captured late decline is not evidence of durability".
    const v = long({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 16),
        longRun('l2', '2026-08-30', 16, 16, {
          provOpts: {
            truncation: { truncated: true, completeWorkPhasesCaptured: false, note: 'watch died' },
          },
        }),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('REFUSE');
    expect(v.excluded[0].reason).toBe('TRUNCATED_PORTION_REQUIRED');
    // The critical property: truncation did not read as a strong finish.
    expect(v.decision).not.toBe('PROGRESS');
  });

  it('REFUSE · only one relevant long run', () => {
    const v = long({ longRuns: [longRun('l1', '2026-08-30', 16, 16)] });
    expect(record('LONG_RUN', v.decision)).toBe('REFUSE');
  });

  it('REFUSE · no key session has followed yet, so absorption is unobservable', () => {
    const v = long({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 16, { followingKeySessionOk: absent('none yet') }),
        longRun('l2', '2026-08-30', 16, 16, { followingKeySessionOk: absent('none yet') }),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('REFUSE');
  });

  it('HOLD · a long run that deteriorated late holds the distance', () => {
    const v = long({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 16),
        longRun('l2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
  });

  it('HOLD · a key session after the long run that did not go to plan', () => {
    const v = long({
      longRuns: [
        longRun('l1', '2026-08-23', 16, 16),
        longRun('l2', '2026-08-30', 16, 16, { followingKeySessionOk: measured(false) }),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
  });

  it('HOLD · inside the taper a longer long run has no job to do', () => {
    const v = long({ collidesWithRaceOrTaper: true });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
  });

  it('HOLD · not enough weeks remain for the increase to serve the build', () => {
    const v = long({ weeksRemainingInBuild: 2 });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
  });

  it('HOLD · incoherent with weekly volume', () => {
    const v = long({ coherentWithWeeklyVolume: false });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
  });

  it('HOLD · one increase per cutback cycle', () => {
    const v = long({ stepsTakenThisCycle: 1 });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
    expect(v.reason).toMatch(/one step per cutback cycle/);
  });

  it('HOLD · the cycle cap binds the DOWNWARD step too, on the same counter', () => {
    const short = [longRun('lr-1', '2026-08-23', 16, 13.0), longRun('lr-2', '2026-08-30', 16, 13.2)];
    expect(record('LONG_RUN', long({ longRuns: short, stepsTakenThisCycle: 0 }).decision)).toBe('REGRESS');
    const spent = long({ longRuns: short, stepsTakenThisCycle: 1 });
    expect(record('LONG_RUN', spent.decision)).toBe('HOLD');
    expect(spent.reason).toMatch(/one step per cutback cycle/);
  });

  // 2026-07-27, the record that started this. `Math.max(meanCompleted, before -
  // step)` had no upper clamp, so both long runs missing LARGER prescriptions
  // proposed `+1.5 long_run_mi` under a sentence reading "the long run eases".
  it('HOLD · both short of a LARGER prescription never proposes an increase', () => {
    const v = long({
      nextLongRunMi: 12,
      longRuns: [
        longRun('lr-1', '2026-07-19', 19, 18.0),
        longRun('lr-2', '2026-07-26', 17, 9.09),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('HOLD');
    expect(v.magnitude).toBeNull();
    expect(v.reason).toMatch(/What was missed was a longer prescription, not this distance/);
  });

  it('REGRESS · and it still eases when both came in below the affected distance', () => {
    // The falsifier for the case above: same shape, completed BELOW `before`.
    const v = long({
      nextLongRunMi: 16,
      longRuns: [
        longRun('lr-1', '2026-08-23', 18, 14.0),
        longRun('lr-2', '2026-08-30', 18, 14.4),
      ],
    });
    expect(record('LONG_RUN', v.decision)).toBe('REGRESS');
    expect(v.magnitude!.value).toBeLessThan(0);
    expect(v.proposedAfterValue!).toBeLessThan(16);
  });

  it('REFUSE · a week that schedules no long run is not a long run of zero', () => {
    const v = long({ nextLongRunMi: 0 });
    expect(record('LONG_RUN', v.decision)).toBe('REFUSE');
    expect(v.reason).not.toMatch(/no distance/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * RULE 22 · DISTRIBUTION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('RULE 22 · this suite is not biased toward refusing', () => {
  it('every lever exercises every decision it can reach, and upward is not outnumbered', () => {
    const dist: Record<string, number> = {};
    for (const s of seen) {
      dist[s.decision] = (dist[s.decision] ?? 0) + 1;
      dist[`${s.lever}:${s.decision}`] = (dist[`${s.lever}:${s.decision}`] ?? 0) + 1;
    }
    // eslint-disable-next-line no-console
    console.log('LEVER CASE DISTRIBUTION', JSON.stringify(dist, null, 0));

    // Every lever must demonstrate it can go UP and it can come DOWN.
    for (const lever of ['THRESHOLD_PACE', 'WEEKLY_VOLUME', 'LONG_RUN']) {
      expect(dist[`${lever}:PROGRESS`] ?? 0, `${lever} never progresses`).toBeGreaterThanOrEqual(1);
      expect(dist[`${lever}:REGRESS`] ?? 0, `${lever} never regresses`).toBeGreaterThanOrEqual(1);
      expect(dist[`${lever}:HOLD`] ?? 0, `${lever} never holds`).toBeGreaterThanOrEqual(1);
    }

    // And the non-moving cases may not swamp the moving ones beyond 3:1. This
    // is the assertion that would have failed the engine Rule 21 measured.
    const moving = (dist.PROGRESS ?? 0) + (dist.REGRESS ?? 0);
    const notMoving = (dist.HOLD ?? 0) + (dist.REFUSE ?? 0);
    expect(moving, 'nothing moves').toBeGreaterThan(0);
    expect(notMoving / moving, `${notMoving} non-moving vs ${moving} moving`).toBeLessThanOrEqual(3);
  });
});
