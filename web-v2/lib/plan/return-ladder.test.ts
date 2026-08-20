import { describe, it, expect } from 'vitest';
import {
  computeReturnLadderState, applyCheckin, advancementGateLine,
  MIN_SESSIONS_PER_STAGE, MIN_DAYS_BETWEEN_ADVANCES,
  type ReturnCheckinEvent,
} from './return-ladder';
import { WALK_RUN_LADDER, MAX_WALK_RUN_STAGE, MAX_STAGE_ADVANCE_PER_WEEK } from './injury-protocols';

/** Calendar-correct ISO date, N days after 2026-08-01, so a long sequence of
 *  events never overflows a month's day count. */
const day = (n: number): string => {
  const d = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01
  d.setUTCDate(d.getUTCDate() + (n - 1));
  return d.toISOString().slice(0, 10);
};

describe('computeReturnLadderState — the check-in-gated ladder', () => {
  it('starts at stage 1 (run 1 · walk 4 × 5) with no events', () => {
    const s = computeReturnLadderState([], 1);
    expect(s.stage).toBe(1);
    expect(WALK_RUN_LADDER[0]).toMatchObject({ stage: 1, runMin: 1, walkMin: 4, repeats: 5 });
  });

  it('requires the doctrine minimum (2) silent sessions before advancing', () => {
    expect(MIN_SESSIONS_PER_STAGE).toBe(2);
    const events: ReturnCheckinEvent[] = [{ at: day(1), outcome: 'silent' }];
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(1);
    expect(s.sessionsAtStage).toBe(1);
  });

  it('advances exactly one stage after two silent sessions', () => {
    const events: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'silent' },
    ];
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(1 + MAX_STAGE_ADVANCE_PER_WEEK);
    expect(s.sessionsAtStage).toBe(0);
  });

  it('a something_off check-in repeats the stage and resets the session count', () => {
    const events: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'something_off' },
    ];
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(1); // no advance
    expect(s.sessionsAtStage).toBe(0); // reset, not held at 1
  });

  it('never advances more than one stage per week, even with many silent sessions in one week', () => {
    const events: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'silent' }, // clears the minimum → advances to stage 2
      { at: day(3), outcome: 'silent' },
      { at: day(4), outcome: 'silent' }, // clears the minimum again, but < 7 days since last advance
    ];
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(2); // held, not 3
    expect(s.sessionsAtStage).toBeGreaterThanOrEqual(MIN_SESSIONS_PER_STAGE);
    expect(s.advanceQueued).toBe(true);
  });

  it('advances again once the weekly gap has opened', () => {
    const events: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'silent' }, // → stage 2
      { at: day(9), outcome: 'silent' }, // 7 days later
      { at: day(10), outcome: 'silent' }, // → stage 3
    ];
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(3);
  });

  it('never advances past the top of the ladder', () => {
    const events: ReturnCheckinEvent[] = [];
    let at = 1;
    for (let i = 0; i < MAX_WALK_RUN_STAGE + 3; i++) {
      events.push({ at: day(at), outcome: 'silent' });
      events.push({ at: day(at + 1), outcome: 'silent' });
      at += 8; // clear the weekly gap each time
    }
    const s = computeReturnLadderState(events, 1);
    expect(s.stage).toBe(MAX_WALK_RUN_STAGE);
  });

  it('replays events in chronological order regardless of input order', () => {
    const forward: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'silent' },
    ];
    const reversed = [...forward].reverse();
    expect(computeReturnLadderState(forward, 1)).toEqual(computeReturnLadderState(reversed, 1));
  });

  it('honors a non-default startStage (a site whose protocol re-enters higher)', () => {
    const s = computeReturnLadderState([], 8);
    expect(s.stage).toBe(8);
  });
});

describe('applyCheckin — incremental application matches the full replay', () => {
  it('agrees with computeReturnLadderState step by step', () => {
    const events: ReturnCheckinEvent[] = [
      { at: day(1), outcome: 'silent' },
      { at: day(2), outcome: 'something_off' },
      { at: day(3), outcome: 'silent' },
      { at: day(4), outcome: 'silent' },
      { at: day(12), outcome: 'silent' },
    ];
    let state = computeReturnLadderState([], 1);
    for (const ev of events) {
      state = applyCheckin(state, ev);
    }
    expect(state).toEqual(computeReturnLadderState(events, 1));
  });
});

describe('advancementGateLine — coach voice, states the gate in one sentence', () => {
  it('never scolds and never uses an exclamation mark or em dash', () => {
    const cases = [
      computeReturnLadderState([], 1),
      computeReturnLadderState([{ at: day(1), outcome: 'silent' }], 1),
      computeReturnLadderState([
        { at: day(1), outcome: 'silent' }, { at: day(2), outcome: 'silent' },
        { at: day(3), outcome: 'silent' },
      ], 1),
      computeReturnLadderState([], MAX_WALK_RUN_STAGE),
    ];
    for (const s of cases) {
      const line = advancementGateLine(s);
      expect(line).not.toMatch(/!/);
      expect(line).not.toMatch(/—/);
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
