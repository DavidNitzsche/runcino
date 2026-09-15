/**
 * lib/coach/non-adherence-offer.test.ts
 *
 * `resolveNonAdherenceOffer` per consult-log 2026-09-15-025 Ruling 2: the
 * first ask is genuine (leads with RECOMMIT); if the SAME pattern recurs
 * after a prior RECOMMIT, the default framing shifts toward RECALIBRATE.
 * Rule 18 falsification throughout — no clock, no database, hand-built
 * history arrays only.
 */
import { describe, expect, it } from 'vitest';
import {
  RECOMMIT_CYCLE_THRESHOLD,
  resolveNonAdherenceOffer,
  type NonAdherenceOfferHistoryEntry,
} from './non-adherence-offer';

describe('resolveNonAdherenceOffer · gated on the reader, not re-derived', () => {
  it('never offers when the reader has not triggered, regardless of history', () => {
    const busyHistory: NonAdherenceOfferHistoryEntry[] = [
      { offeredAtISO: '2026-06-01', choice: 'RECOMMIT' },
      { offeredAtISO: '2026-07-01', choice: 'RECOMMIT' },
    ];
    const v = resolveNonAdherenceOffer(false, busyHistory);
    expect(v.shouldOffer).toBe(false);
    expect(v.defaultFraming).toBeNull();
  });
});

describe('resolveNonAdherenceOffer · Ruling 2: first ask is genuine', () => {
  it('leads with RECOMMIT the first time this pattern is offered', () => {
    const v = resolveNonAdherenceOffer(true, []);
    expect(v.shouldOffer).toBe(true);
    expect(v.defaultFraming).toBe('RECOMMIT');
    expect(v.priorRecommitCount).toBe(0);
  });
});

describe('resolveNonAdherenceOffer · Ruling 2: recurrence after one RECOMMIT shifts framing', () => {
  it('defaults to RECALIBRATE once the identical pattern has recurred after a RECOMMIT', () => {
    expect(RECOMMIT_CYCLE_THRESHOLD).toBe(2);
    const history: NonAdherenceOfferHistoryEntry[] = [
      { offeredAtISO: '2026-06-01', choice: 'RECOMMIT' },
    ];
    const v = resolveNonAdherenceOffer(true, history);
    expect(v.shouldOffer).toBe(true);
    expect(v.defaultFraming).toBe('RECALIBRATE');
    expect(v.priorRecommitCount).toBe(1);
  });

  it('stays RECALIBRATE-leaning on a third, fourth occurrence — never resets to genuine-first-ask', () => {
    const history: NonAdherenceOfferHistoryEntry[] = [
      { offeredAtISO: '2026-04-01', choice: 'RECOMMIT' },
      { offeredAtISO: '2026-05-01', choice: 'RECALIBRATE' },
      { offeredAtISO: '2026-06-01', choice: 'RECOMMIT' },
    ];
    const v = resolveNonAdherenceOffer(true, history);
    expect(v.defaultFraming).toBe('RECALIBRATE');
    expect(v.priorRecommitCount).toBe(2);
  });

  it('a prior RECALIBRATE alone (no RECOMMIT yet) does not by itself force RECALIBRATE framing', () => {
    // Doctrine's escalation is specifically about a RECOMMIT that then
    // recurs ("the runner is saying the plan is still right... if the SAME
    // pattern recurs after that"). A runner who recalibrated straight away
    // has not yet had a recommit-then-repeat cycle, so the next occurrence
    // (a fresh block, fresh pattern) still gets a genuine first ask.
    const history: NonAdherenceOfferHistoryEntry[] = [
      { offeredAtISO: '2026-04-01', choice: 'RECALIBRATE' },
    ];
    const v = resolveNonAdherenceOffer(true, history);
    expect(v.defaultFraming).toBe('RECOMMIT');
    expect(v.priorRecommitCount).toBe(0);
  });
});

describe('resolveNonAdherenceOffer · never forced', () => {
  it('both choices are always available in shape — this only sets the lean', () => {
    const v = resolveNonAdherenceOffer(true, []);
    // The type itself only allows 'RECOMMIT' | 'RECALIBRATE' as a lean, never
    // a third "forced" state — this assertion documents that contract.
    expect(['RECOMMIT', 'RECALIBRATE']).toContain(v.defaultFraming);
  });
});
