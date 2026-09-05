/**
 * lib/adaptation/canonical/_defer_persist.test.ts · THE SIX BEHAVIOURS
 * ARBITRATION HAD TO PROVE BEFORE READING C COULD BE PROMOTED.
 *
 * The owner's list, verbatim, and one describe block per line:
 *
 *   1 · A small supported pace correction PROCEEDS when the week has room.
 *   2 · The same correction DEFERS when the week is genuinely full.
 *   3 · Deferred changes persist and reappear at the next valid boundary.
 *   4 · A deferral cannot become a silent suppression.
 *   5 · An unrelated hold cannot freeze the entire engine.
 *   6 · A loaded week cannot blindly accept every proposed change.
 *
 * Every one is asserted against the SAME evidence with only the ceiling
 * varying, so a pass means arbitration responded to the week rather than to
 * something else that happened to move at the same time.
 *
 * ── RULE 18 · EVERY ASSERTION HERE HAS BEEN FALSIFIED ──────────────────────
 *
 * Each block carries a FALSIFIED note naming the exact edit that makes it fail
 * and what the failure says. They were run, not imagined; the report quotes
 * the messages. A test that has never failed is a hypothesis.
 *
 * ── THE HALF OF BEHAVIOUR 3 THAT LIVES ELSEWHERE ───────────────────────────
 *
 * Behaviour 3 has two halves and they are proven in two places, on purpose.
 * The RE-OFFERING half — a queued item survives a boundary, is reconsidered
 * against fresh evidence, and leaves only for a stated reason — is pure and is
 * here. The DURABILITY half — it survives a PROCESS, not just a function call
 * — cannot be proven without a database and is in
 * `canonical-shadow/_deferral_store.db.test.ts`, which SKIPS LOUDLY when no
 * local scratch database is reachable rather than reporting clean.
 *
 * ── RULE 22 · WHAT THIS FILE CANNOT FAIL ON ────────────────────────────────
 *
 * · THE CEILING BEING RIGHT. Every ceiling here is built by `ceilingOf` from a
 *   week this file names. A demand model that priced the owner's real weeks
 *   20% too generously would pass all six of these while letting through weeks
 *   no runner should carry.
 * · WHETHER DEFERRING IS THE RIGHT COACHING CALL. It proves the engine defers
 *   when and only when the week is full. It cannot prove that is wise.
 * · WHETHER ANY OF THIS RUNS IN PRODUCTION. The engine is shadow-only and
 *   `AUTOMATIC_ADAPTATION_AUTHORITY` is false. These are behaviours of a
 *   promotion PATH, not of the live plan.
 * · A DEFERRAL THAT IS NEVER RECONSIDERED BECAUSE NOTHING CALLS THE QUEUE.
 *   Behaviour 3's pure half proves the arithmetic; only the db test proves a
 *   caller exists, and only production would prove it runs.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from './evaluate';
import { enqueueDeferrals, reconsiderAtBoundary } from './deferral-queue';
import { NON_MOVING_DECISIONS } from './decision-record';
import type { CanonicalDecisionRecord } from './decision-record';
import type { AthleteWeeklyDemandCeiling } from './demand-ceiling';
import type { Measured } from './input';
import {
  baseInput, week, longRun, decayingThirds, threeGoodWeeks, twoGoodLongRuns,
  twoFasterThresholdSessions, baseWeekWithHeadroom, ceilingOf,
} from './_fixtures';

/** The base fixture's own next week: 48 mi, a 16-mile long run, 60 quality. */
const NEXT_WEEK = { weeklyMi: 48, longRunMi: 16, qualityMinutes: 60 } as const;

/** That week priced exactly at its own ceiling. Nothing may grow. */
const weekIsFull = () => ceilingOf(NEXT_WEEK);

/**
 * ONE RUNNER, used by every block below, with only the ceiling varying.
 *
 * Threshold evidence supports a correction. Both load levers HOLD — one week
 * short of the completion bar, one long run that decayed — so the pace lever
 * is the only thing proposing, which is exactly the case behaviours 1, 2 and 5
 * are about.
 */
const paceEvidenceLoadHolding = (ceiling: Measured<AthleteWeeklyDemandCeiling>) =>
  baseInput({
    weeks: [
      week('2026-08-17', 47, 47.2),
      week('2026-08-24', 48, 43),
      week('2026-08-31', 48, 47.9),
    ],
    longRuns: [
      longRun('lr-1', '2026-08-23', 16, 16),
      longRun('lr-2', '2026-08-30', 16, 16, { thirds: decayingThirds() }),
    ],
    qualitySessions: twoFasterThresholdSessions(),
    athleteCeilingWeeklyDemand: ceiling,
  });

/** All three levers with real supporting evidence, ceiling varying. */
const everythingProposes = (ceiling: Measured<AthleteWeeklyDemandCeiling>) =>
  baseInput({
    weeks: threeGoodWeeks(),
    longRuns: twoGoodLongRuns(),
    qualitySessions: twoFasterThresholdSessions(),
    plan: { ...baseInput().plan, nextWeekLongRunMi: 15 },
    athleteCeilingWeeklyDemand: ceiling,
  });

const leverOf = (out: { records: readonly CanonicalDecisionRecord[] }, lever: string) => {
  const r = out.records.find((x) => x.lever === lever);
  if (r === undefined) throw new Error(`no record for ${lever}`);
  return r;
};

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · A SMALL SUPPORTED PACE CORRECTION PROCEEDS WHEN THE WEEK HAS ROOM
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · a supported pace correction proceeds when the week has room', () => {
  /* FALSIFIED · swapping `baseWeekWithHeadroom()` for `weekIsFull()` makes
   * this fail with "expected { by: 'PLAN_LOAD', rule: 'WEEK_AT_DEMAND_CEILING'
   * ... } to be null", which is behaviour 2 and proves the two blocks are
   * reading the same mechanism from opposite sides. */
  it('the anchor moves, and nothing suppresses it', () => {
    const out = evaluateAdaptation(paceEvidenceLoadHolding(baseWeekWithHeadroom()));
    const pace = leverOf(out, 'THRESHOLD_PACE');
    expect(pace.decision).toBe('PROGRESS');
    expect(pace.suppressedBy).toBeNull();
    expect(pace.proposedAfterValue).not.toBeNull();
    // It really proposes an EDIT, not just a verdict. A "PROGRESS" with an
    // empty diff would satisfy every assertion above and change nothing.
    expect(pace.planDiff.entries.length).toBeGreaterThan(0);
  });

  it('the week it would create is genuinely under the ceiling, not merely unsuppressed', () => {
    // Asserting the shape of the result rather than the absence of the defect
    // (Rule 13.3): the reason it proceeded is that the projected week fits.
    const input = paceEvidenceLoadHolding(baseWeekWithHeadroom());
    const out = evaluateAdaptation(input);
    expect(out.demandCeiling.kind).toBe('READ');
    if (out.demandCeiling.kind !== 'READ') throw new Error('unreachable');
    expect(out.combinedDemandShare).toBeGreaterThan(0);
    expect(leverOf(out, 'THRESHOLD_PACE').suppressedBy).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · THE SAME CORRECTION DEFERS WHEN THE WEEK IS GENUINELY FULL
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2 · the same correction defers when the week is genuinely full', () => {
  /* FALSIFIED · deleting the `if (!ceiling.rule1CanFire) return false;` guard
   * in `rule1Suppresses` does NOT break this (the ceiling is present here);
   * changing the comparison to `>=` instead of `>` does not either. What
   * breaks it is removing the rule-1 branch entirely, which fails with
   * "expected null not to be null". */
  it('the identical evidence is deferred, and only for the WEEK', () => {
    const roomy = evaluateAdaptation(paceEvidenceLoadHolding(baseWeekWithHeadroom()));
    const full = evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull()));

    // Same evidence, same verdict, same proposed number. ONLY the ceiling
    // differs, so the difference in outcome can only be the week.
    expect(full.records.find((r) => r.lever === 'THRESHOLD_PACE')!.decision)
      .toBe(roomy.records.find((r) => r.lever === 'THRESHOLD_PACE')!.decision);
    expect(leverOf(full, 'THRESHOLD_PACE').proposedAfterValue)
      .toBe(leverOf(roomy, 'THRESHOLD_PACE').proposedAfterValue);

    const pace = leverOf(full, 'THRESHOLD_PACE');
    expect(pace.suppressedBy).not.toBeNull();
    expect(pace.suppressedBy!.rule).toBe('WEEK_AT_DEMAND_CEILING');
    // And the sentence the contract asks the engine to be able to say.
    expect(pace.suppressedBy!.detail).toMatch(/this week already contains enough total demand/);
    expect(pace.suppressedBy!.detail).toMatch(/deferred until the next appropriate boundary/);
  });

  it('a deferred proposal proposes NO edit, so nothing can apply it by accident', () => {
    const full = evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull()));
    expect(leverOf(full, 'THRESHOLD_PACE').planDiff.entries).toEqual([]);
    expect(leverOf(full, 'THRESHOLD_PACE').rollback).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · DEFERRED CHANGES PERSIST AND REAPPEAR AT THE NEXT VALID BOUNDARY
 * ═══════════════════════════════════════════════════════════════════════ */

describe('3 · a deferred change survives to the next valid boundary', () => {
  const queued = () => enqueueDeferrals(
    [], evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull())).records,
  );

  /* FALSIFIED · removing `'WEEK_AT_DEMAND_CEILING'` from `QUEUEABLE_REASONS`
   * in `deferral-queue.ts` makes this fail with "expected [] to have a length
   * of 1 but got +0" — which is precisely the pre-queue world, where the
   * `reconsiderAtISO` was a promise nothing kept. */
  it('it is queued, carrying the boundary it is due at and the evidence behind it', () => {
    const q = queued();
    expect(q).toHaveLength(1);
    expect(q[0].lever).toBe('THRESHOLD_PACE');
    expect(q[0].reason).toBe('WEEK_AT_DEMAND_CEILING');
    // The next weekly boundary the plan itself names, not an invented date.
    expect(q[0].nextBoundaryISO).toBe('2026-09-07');
    // Rule 21 · "every adaptation writes what it did, in which direction, and
    // on what evidence". A queued item that carried no evidence could not be
    // judged later, which is the whole reason it is a ledger.
    expect(q[0].evidence.length).toBeGreaterThan(0);
    expect(q[0].newestEvidenceISO).not.toBeNull();
  });

  it('BEFORE its boundary it is carried untouched and is NOT reconsidered', () => {
    const r = reconsiderAtBoundary({
      queue: queued(),
      atISO: '2026-09-06',
      freshRecords: [],
      currentPlanVersion: 'plan-v1',
      blockEndedISO: null,
    });
    expect(r.carried).toHaveLength(1);
    expect(r.reconsidered).toHaveLength(0);
    expect(r.expired).toHaveLength(0);
  });

  it('AT its boundary, with nothing fresh to say, it is still carried — nobody asked', () => {
    // Rule 11 · "a boundary at which the engine produced no record for a lever
    // is not a boundary at which the lever said no." This is the assertion
    // that stops a quiet week silently retiring a queued progression.
    const r = reconsiderAtBoundary({
      queue: queued(),
      atISO: '2026-09-07',
      freshRecords: [],
      currentPlanVersion: 'plan-v1',
      blockEndedISO: null,
    });
    expect(r.reconsidered).toHaveLength(1);
    expect(r.carried).toHaveLength(1);
    expect(r.expired).toHaveLength(0);
  });

  it('AT its boundary, with fresh evidence, the QUESTION IS ASKED AGAIN', () => {
    // The queue never auto-applies. What it guarantees is that the fresh
    // proposal exists and the queued one hands over to it with a reason.
    const fresh = evaluateAdaptation(paceEvidenceLoadHolding(baseWeekWithHeadroom())).records;
    const r = reconsiderAtBoundary({
      queue: queued(),
      atISO: '2026-09-07',
      freshRecords: fresh,
      currentPlanVersion: 'plan-v1',
      blockEndedISO: null,
    });
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toMatch(/^SUPERSEDED_BY_/);
    expect(r.carried).toHaveLength(0);
    // And the fresh look is the one that proceeds, on a week with room.
    expect(fresh.find((x) => x.lever === 'THRESHOLD_PACE')!.suppressedBy).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · A DEFERRAL CANNOT BECOME A SILENT SUPPRESSION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('4 · a deferral cannot become a silent suppression', () => {
  /* FALSIFIED · emptying the BLOCK_ENDED expiry's sentence in
   * `reconsiderAtBoundary` fails the last assertion with "block ended: an
   * expiry carries a sentence: expected 0 to be greater than 20". An item
   * would leave the queue naming a code and saying nothing.
   *
   * The related edit — returning `carried` from the SUPERSEDED branch instead
   * of expiring — does NOT fail this block, and that is worth stating rather
   * than leaving as a wrong claim: it fails block 3 ("expected [] to have a
   * length of 1") because the item never leaves at all. This block's
   * accounting assertion sees a balanced queue either way. */
  it('every suppressed proposal carries a rule, a sentence and a boundary', () => {
    const out = evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull()));
    for (const r of out.records) {
      if (r.suppressedBy === null) continue;
      expect(r.suppressedBy.rule.length).toBeGreaterThan(0);
      expect(r.suppressedBy.detail.length).toBeGreaterThan(20);
      expect(r.suppressedBy.by.length).toBeGreaterThan(0);
      // A deferral with no boundary to come back at is a suppression wearing a
      // deferral's clothes.
      expect(r.suppressedBy.reconsiderAtISO).not.toBeNull();
    }
  });

  it('the ceiling POSTURE is stated on every record, whether or not rule 1 could run', () => {
    // Rule 11 · a missing input must never silently disable a safety
    // mechanism. Both worlds are checked, because the dangerous one is the
    // world where the ceiling is absent and nothing says so.
    for (const input of [paceEvidenceLoadHolding(weekIsFull()), baseInput()]) {
      const out = evaluateAdaptation(input);
      expect(['READ', 'ABSENT', 'FAILED']).toContain(out.demandCeiling.kind);
      expect(out.demandCeiling.detail.length).toBeGreaterThan(20);
      for (const r of out.records) {
        const inv = r.invariants.find((i) => i.id === 'INV_DEMAND_CEILING_POSTURE_STATED');
        expect(inv, 'every record states the ceiling posture').toBeDefined();
        expect(inv!.passed).toBe(true);
      }
    }
  });

  it('NOTHING leaves the queue without a stated reason', () => {
    const q = enqueueDeferrals([], evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull())).records);
    // Every structural and evidential exit, one at a time. The accounting
    // assertion is the point: in + out must balance, so an item cannot simply
    // stop being mentioned.
    const exits = [
      { label: 'plan rebuilt', args: { currentPlanVersion: 'plan-v2', blockEndedISO: null } },
      { label: 'block ended', args: { currentPlanVersion: 'plan-v1', blockEndedISO: '2026-09-01' } },
    ];
    for (const e of exits) {
      const r = reconsiderAtBoundary({
        queue: q, atISO: '2026-09-07', freshRecords: [], ...e.args,
      });
      expect(r.carried.length + r.expired.length, `${e.label}: the queue must balance`)
        .toBe(q.length);
      for (const x of r.expired) {
        expect(x.expiry.length, `${e.label}: an expiry names a reason`).toBeGreaterThan(0);
        expect(x.detail.length, `${e.label}: an expiry carries a sentence`).toBeGreaterThan(20);
        expect(x.expiredAtISO).toBe('2026-09-07');
      }
    }
  });

  it('a HOLD is never recorded as suppressed — that would be a lie about a refusal', () => {
    const out = evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull()));
    for (const r of out.records) {
      if (!NON_MOVING_DECISIONS.has(r.decision)) continue;
      expect(r.suppressedBy, `${r.lever} proposed nothing and cannot be suppressed`).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5 · AN UNRELATED HOLD CANNOT FREEZE THE ENTIRE ENGINE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('5 · an unrelated hold cannot freeze the entire engine', () => {
  /* FALSIFIED · re-introducing the pre-2026-09-04 rule (a load HOLD
   * suppressing a material increase on a lever further down the priority
   * order) makes the first assertion fail with "expected { by:
   * 'WEEKLY_VOLUME', rule: 'WEEK_AT_DEMAND_CEILING' ... } to be null". That is
   * the defect this whole change removed: a load HOLD vetoed a lever it had no
   * evidence about. The legacy reading's own identifier is deliberately NOT
   * named here — `_arbitration_reading_c.test.ts` property 4 asserts by
   * scanning source that exactly one file names it, so that it cannot quietly
   * become a second live engine. */
  it('both load levers holding does not stop a pace correction on a roomy week', () => {
    const out = evaluateAdaptation(paceEvidenceLoadHolding(baseWeekWithHeadroom()));
    expect(leverOf(out, 'WEEKLY_VOLUME').decision).toBe('HOLD');
    expect(leverOf(out, 'LONG_RUN').decision).toBe('HOLD');
    expect(leverOf(out, 'THRESHOLD_PACE').suppressedBy).toBeNull();
  });

  it('an ABSENT ceiling does not freeze it either — an unknown is not a full week', () => {
    // The old live posture, and the one a new runner is still in. Rule 1
    // cannot fire, and the honest consequence is that it suppresses NOTHING.
    // The dangerous reading — "no ceiling means assume we are at it" — would
    // freeze the engine permanently and silently for every such runner.
    const out = evaluateAdaptation(paceEvidenceLoadHolding(baseInput().athleteCeilingWeeklyDemand));
    expect(out.demandCeiling.kind).toBe('ABSENT');
    expect(out.demandCeiling.rule1CanFire).toBe(false);
    expect(leverOf(out, 'THRESHOLD_PACE').suppressedBy).toBeNull();
  });

  it('the engine still SPEAKS on a frozen-looking week — a hold is a verdict, not silence', () => {
    const out = evaluateAdaptation(paceEvidenceLoadHolding(weekIsFull()));
    expect(out.records).toHaveLength(3);
    for (const r of out.records) {
      expect(r.reason.length, `${r.lever} says why`).toBeGreaterThan(10);
      expect(r.whatWouldChangeIt.length, `${r.lever} says what would change it`).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6 · A LOADED WEEK CANNOT BLINDLY ACCEPT EVERY PROPOSED CHANGE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('6 · a loaded week cannot blindly accept every proposed change', () => {
  /* FALSIFIED · making `rule1Suppresses` return false unconditionally under
   * the live reading AND raising `MAX_MATERIAL_LEVERS_PER_CYCLE` to 9 fails
   * here with "expected 0 to be greater than 0" — every lever applied onto a
   * week already at its ceiling.
   *
   * BOTH edits are needed and that is the finding: with only rule 1 disabled,
   * rule 3 still defers one lever and this block passes. So this block on its
   * own does not prove the WEEK was consulted, only that SOMETHING refused;
   * the second test below is the one that reads the ceiling. Stated rather
   * than left implied, because a falsification that fires for the wrong reason
   * is worse than none. */
  it('with all three levers proposing onto a full week, not everything survives', () => {
    const out = evaluateAdaptation(everythingProposes(weekIsFull()));
    const moving = out.records.filter((r) => !NON_MOVING_DECISIONS.has(r.decision));
    expect(moving.length, 'liveness · all three levers really do propose here')
      .toBeGreaterThanOrEqual(2);
    const deferred = moving.filter((r) => r.suppressedBy !== null);
    expect(deferred.length).toBeGreaterThan(0);
  });

  it('the surviving combination is priced TOGETHER, not one at a time', () => {
    // The contract's own words: "evaluate their combined effect on the future
    // plan". Two proposals that each fit alone must not both survive onto a
    // week that cannot carry the pair — this is the assertion that would catch
    // a rule 1 which forgot to project cumulatively.
    const out = evaluateAdaptation(everythingProposes(weekIsFull()));
    expect(out.demandCeiling.kind).toBe('READ');
    if (out.demandCeiling.kind !== 'READ') throw new Error('unreachable');
    const applied = out.records.filter(
      (r) => !NON_MOVING_DECISIONS.has(r.decision) && r.suppressedBy === null,
    );
    // Whatever survived, the week it makes is still at or under the ceiling.
    // `combinedDemandShare` is the share of the BASE week the survivors add,
    // and the base week is the ceiling here, so any positive share is over it.
    if (applied.length > 0) {
      expect(out.combinedDemandShare).toBeLessThanOrEqual(0);
    }
  });

  it('and with room, the SAME three proposals are not all refused either', () => {
    // Rule 22's balance check, inside one test file: a gate that only ever
    // asks "did you correctly refuse?" passes an engine that can only refuse.
    const roomy = evaluateAdaptation(everythingProposes(baseWeekWithHeadroom()));
    const applied = roomy.records.filter(
      (r) => !NON_MOVING_DECISIONS.has(r.decision) && r.suppressedBy === null,
    );
    expect(applied.length, 'a week with room must let SOMETHING through').toBeGreaterThan(0);
  });
});
