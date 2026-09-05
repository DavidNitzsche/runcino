/**
 * lib/adaptation/canonical/_deferral_queue.test.ts · A DEFERRED PROGRESSION
 * STAYS QUEUED.
 *
 * The owner's requirement, verbatim: "A deferred progression must remain queued
 * for the next valid boundary rather than disappearing."
 *
 * Every queue entry below comes from a REAL `evaluateAdaptation` run, never a
 * hand-built record. That matters more here than usual: the queue's entire
 * purpose is to survive between evaluations, so a fixture-built record would
 * prove the queue can carry a shape nothing actually emits.
 *
 * ── RULE 15 · THE CASE THAT REACHES EACH MECHANISM, NAMED ──────────────────
 *
 *   enqueue on rule 1        · full week, held load levers, faster threshold
 *                              sessions (the acceptance-test runner)
 *   enqueue on rule 3        · two material proposals on a roomy week
 *   not queued (idempotency) · the same evidence re-evaluated with its key
 *                              already raised
 *   carried, not due         · a boundary before `nextBoundaryISO`
 *   carried, nobody asked    · due, with no fresh record for that lever
 *   expired · superseded     · due, with a fresh proposal on the same lever
 *   expired · not supported  · due, with a fresh HOLD on the same lever
 *   expired · stale          · evidence older than the evidence window
 *   expired · plan rebuilt   · a different plan version in force
 *   expired · block ended    · a boundary at or past the block's end
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * · DURABILITY. The queue is in memory. Nothing here proves a deferral survives
 *   a process restart, a deploy, or a night, because nothing persists it yet.
 *   That is the single largest gap in this mechanism and it is stated rather
 *   than implied: `deferral-queue.ts`'s PERSISTENCE section carries the
 *   proposal, and `db/migrations/165_canonical_adaptation_deferrals.sql` is
 *   written and deliberately unapplied.
 * · WHETHER ANYTHING CALLS IT. No production path enqueues or reconsiders yet.
 *   A green file here is evidence about the ledger's arithmetic, never about
 *   the engine's behaviour in the runner's account.
 * · WHETHER THE DEFERRAL WAS RIGHT. The queue faithfully carries whatever
 *   arbitration deferred, including a deferral made for a bad reason.
 * · THE STALENESS WINDOW BEING CORRECT for the volume and long-run levers,
 *   whose own windows are not expressed in days at all.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAdaptation } from './evaluate';
import {
  enqueueDeferrals, reconsiderAtBoundary, queueIdFor,
  DEFERRAL_EVIDENCE_STALE_AFTER_DAYS, type QueuedDeferral,
} from './deferral-queue';
import { measured } from './input';
import { demandCeilingForWeek } from './plan-load';
import {
  baseInput, week, longRun, decayingThirds, threeGoodWeeks, twoGoodLongRuns,
  twoFasterThresholdSessions, baseWeekWithHeadroom,
} from './_fixtures';

const BASE_WEEK_INDEX = demandCeilingForWeek({
  weeklyMi: 48, longRunMi: 16, qualityMinutes: 60,
});

/** The acceptance-test runner: a full week, both load levers holding. */
const fullWeekRunner = (opts?: Parameters<typeof baseInput>[0]) =>
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
    athleteCeilingWeeklyDemand: measured(BASE_WEEK_INDEX),
    ...opts,
  });

const queueFromFullWeek = (): readonly QueuedDeferral[] =>
  enqueueDeferrals([], evaluateAdaptation(fullWeekRunner()).records);

describe('enqueue · a deferred progression is written down, in full', () => {
  it('a rule-1 deferral is queued with its lever, value, evidence, reason and boundary', () => {
    const queue = queueFromFullWeek();
    expect(queue).toHaveLength(1);
    const q = queue[0];
    expect(q.lever).toBe('THRESHOLD_PACE');
    expect(q.reason).toBe('WEEK_AT_DEMAND_CEILING');
    expect(q.reasonDetail).toMatch(/already contains enough total demand/);
    expect(q.beforeValue).toBeGreaterThan(0);
    expect(q.proposedAfterValue).toBeLessThan(q.beforeValue); // faster is smaller
    expect(q.magnitude.unit).toBe('sec_per_mi');
    expect(q.evidence.length).toBeGreaterThan(0);
    expect(q.newestEvidenceISO).toBe('2026-09-01');
    expect(q.nextBoundaryISO).not.toBeNull();
    expect(q.queueId).toBe(queueIdFor(q.athleteId, q.lever, q.idempotencyKey));
  });

  it('a rule-3 deferral is queued too · attributability is still a deferral', () => {
    const out = evaluateAdaptation(baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      plan: { ...baseInput().plan, nextWeekLongRunMi: 15 },
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    }));
    const queue = enqueueDeferrals([], out.records);
    expect(queue.map((q) => q.lever)).toEqual(['LONG_RUN']);
    expect(queue[0].reason).toBe('ONE_MATERIAL_LEVER_PER_CYCLE');
  });

  it('a HOLD is never queued · it proposed nothing to defer', () => {
    const out = evaluateAdaptation(baseInput());
    expect(out.records.every((r) => r.decision === 'REFUSE' || r.decision === 'HOLD')).toBe(true);
    expect(enqueueDeferrals([], out.records)).toEqual([]);
  });

  it('an idempotency suppression is NOT queued · it was already raised', () => {
    // Queueing it would re-offer the same proposal on the same evidence, which
    // is exactly what the idempotency key exists to prevent.
    const input = baseInput({
      weeks: threeGoodWeeks(),
      longRuns: twoGoodLongRuns(),
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    });
    const first = evaluateAdaptation(input);
    const raised = new Set(
      first.records.filter((r) => r.suppressedBy === null).map((r) => r.idempotencyKey),
    );
    const second = evaluateAdaptation(input, raised);
    const volume = second.records.find((r) => r.lever === 'WEEKLY_VOLUME')!;
    expect(volume.suppressedBy!.rule).toBe('ALREADY_RAISED_ON_THIS_EVIDENCE');
    expect(enqueueDeferrals([], second.records).map((q) => q.lever))
      .not.toContain('WEEKLY_VOLUME');
  });

  it('re-queueing the same deferral REPLACES it rather than growing the queue', () => {
    const records = evaluateAdaptation(fullWeekRunner()).records;
    const once = enqueueDeferrals([], records);
    const twice = enqueueDeferrals(once, records);
    expect(twice).toHaveLength(1);
    expect(twice[0].queueId).toBe(once[0].queueId);
  });
});

describe('reconsider · the queued item is re-offered, never auto-applied', () => {
  const base = {
    freshRecords: [],
    currentPlanVersion: 'plan-v1',
    blockEndedISO: null,
  } as const;

  it('before its boundary it is carried untouched and NOT reconsidered', () => {
    const queue = queueFromFullWeek();
    const r = reconsiderAtBoundary({ ...base, queue, atISO: '2026-09-06' });
    expect(r.carried).toEqual(queue);
    expect(r.expired).toEqual([]);
    expect(r.reconsidered).toEqual([]);
  });

  it('AT its boundary with no fresh record it is reconsidered and CARRIED · Rule 11', () => {
    // "Nobody asked" is not "the lever said no". This is the clause that stops
    // a queue from quietly draining itself on evaluations that never ran.
    const queue = queueFromFullWeek();
    const r = reconsiderAtBoundary({ ...base, queue, atISO: queue[0].nextBoundaryISO! });
    expect(r.reconsidered).toHaveLength(1);
    expect(r.carried).toHaveLength(1);
    expect(r.expired).toEqual([]);
  });

  it('a fresh proposal on the same lever SUPERSEDES it, with the reason recorded', () => {
    const queue = queueFromFullWeek();
    // The same runner a cycle later, with room. The threshold lever proposes
    // again on current evidence, so the queued item hands over.
    const fresh = evaluateAdaptation(fullWeekRunner({
      athleteCeilingWeeklyDemand: baseWeekWithHeadroom(),
    })).records;
    const r = reconsiderAtBoundary({
      ...base, queue, atISO: queue[0].nextBoundaryISO!, freshRecords: fresh,
    });
    expect(r.carried).toEqual([]);
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toMatch(/^SUPERSEDED_BY_/);
    expect(r.expired[0].detail).toMatch(/Re-asked at/);
    expect(r.expired[0].expiredAtISO).toBe(queue[0].nextBoundaryISO);
    // And the queued proposal was NOT applied. It expired in favour of the
    // fresh one, which is arbitrated on its own account.
    expect(r.expired[0].item.proposedAfterValue).toBe(queue[0].proposedAfterValue);
  });

  it('a fresh HOLD on the same lever expires it as NO LONGER SUPPORTED', () => {
    const queue = queueFromFullWeek();
    // A runner with nothing supporting a pace change any more.
    const fresh = evaluateAdaptation(baseInput()).records;
    expect(fresh.find((x) => x.lever === 'THRESHOLD_PACE')!.decision)
      .not.toBe('PROGRESS');
    const r = reconsiderAtBoundary({
      ...base, queue, atISO: queue[0].nextBoundaryISO!, freshRecords: fresh,
    });
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toBe('FRESH_EVIDENCE_NO_LONGER_SUPPORTS_IT');
  });

  it('evidence past the window expires it as STALE, naming the age', () => {
    const queue = queueFromFullWeek();
    const wayLater = '2026-11-01'; // well past 28 days from 2026-09-01
    const r = reconsiderAtBoundary({ ...base, queue, atISO: wayLater });
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toBe('EVIDENCE_WENT_STALE');
    expect(r.expired[0].detail).toContain(String(DEFERRAL_EVIDENCE_STALE_AFTER_DAYS));
    expect(r.expired[0].detail).toContain('2026-09-01');
  });

  it('a rebuilt plan expires it, because the value it moved from is gone', () => {
    const queue = queueFromFullWeek();
    const r = reconsiderAtBoundary({
      ...base, queue, atISO: '2026-09-06', currentPlanVersion: 'plan-v2',
    });
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toBe('PLAN_VERSION_CHANGED');
    expect(r.expired[0].detail).toContain('plan-v2');
  });

  it('a finished block expires it, ahead of any evidential question', () => {
    const queue = queueFromFullWeek();
    const r = reconsiderAtBoundary({
      ...base, queue, atISO: '2026-09-20', blockEndedISO: '2026-09-15',
    });
    expect(r.expired).toHaveLength(1);
    expect(r.expired[0].expiry).toBe('BLOCK_ENDED');
  });

  it('every item ends up in exactly one of carried or expired · nothing evaporates', () => {
    // The property the whole file exists for, asserted as a conservation law
    // rather than case by case.
    const queue = queueFromFullWeek();
    const boundaries = ['2026-09-06', '2026-09-07', '2026-10-05', '2026-11-01'];
    for (const atISO of boundaries) {
      const r = reconsiderAtBoundary({ ...base, queue, atISO });
      expect(r.carried.length + r.expired.length).toBe(queue.length);
      const seen = new Set([...r.carried.map((q) => q.queueId),
        ...r.expired.map((e) => e.item.queueId)]);
      expect(seen.size).toBe(queue.length);
      // And every expiry states a reason and a sentence.
      for (const e of r.expired) {
        expect(e.expiry.length).toBeGreaterThan(0);
        expect(e.detail.length).toBeGreaterThan(20);
      }
    }
  });

  it('reconsidered items are a SUBSET of what the boundary resolved', () => {
    const queue = queueFromFullWeek();
    const r = reconsiderAtBoundary({ ...base, queue, atISO: '2026-10-05' });
    const resolved = new Set([...r.carried.map((q) => q.queueId),
      ...r.expired.map((e) => e.item.queueId)]);
    for (const q of r.reconsidered) expect(resolved.has(q.queueId)).toBe(true);
  });
});
