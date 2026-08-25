/**
 * THE CARD'S BODY · what and then why, in the applied voice.
 *
 * `synthesizeMessage` is not exported, so this exercises it through the row →
 * `PlanProposal` translation that both surfaces share. That is the right level:
 * the claim is about what a runner reads, and both web and iPhone read exactly
 * this string.
 *
 * The gap being closed: on 2026-08-25 the most any surface could have said
 * about a block being replaced overnight was "your long runs have drifted from
 * this plan's targets". True, and no use at all in working out that the week
 * had gone from 23 miles to 38.
 */
import { describe, it, expect, vi } from 'vitest';

// The loader's only dependency is the pool, and this test never reaches it.
vi.mock('@/lib/db/pool', () => ({ pool: { query: async () => ({ rows: [] }) } }));

import { loadAllPlanProposals } from './proposals-state';
import { pool } from '@/lib/db/pool';

const DELTA_23_TO_38 = {
  thisWeekMiFrom: 23, thisWeekMiTo: 38,
  longRunMiFrom: 7, longRunMiTo: 13,
  daysChangedFromToday: 6,
  lastDayFrom: '2026-09-06', lastDayTo: '2026-08-30',
  weeksFrom: 2, weeksTo: 1,
  unchanged: false,
};

/** One row, as `plan_proposals` would return it. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 41,
    plan_id: 'pln_old',
    new_plan_id: 'pln_new',
    proposal_kind: 'long_drift',
    status: 'auto_applied',
    source: 'drift_cron_auto',
    reasons: {},
    created_at: '2026-08-25T09:29:32.000Z',
    resolved_at: '2026-08-25T09:29:32.000Z',
    ...over,
  };
}

async function messageFor(over: Record<string, unknown> = {}): Promise<string> {
  vi.mocked(pool).query = (async () => ({ rows: [row(over)] })) as never;
  const [p] = await loadAllPlanProposals('u');
  return p.message;
}

describe('an applied rebuild says what moved first', () => {
  it('leads with the miles when the rebuild recorded a delta', async () => {
    const msg = await messageFor({
      reasons: {
        message: 'Your long runs have drifted from this plan\'s targets. Refit for an honest progression.',
        plan_delta: DELTA_23_TO_38,
      },
    });
    expect(msg).toMatch(/^Drift raised this week from 23 to 38 miles, and the long run from 7 to 13\./);
  });

  it('drops the detector\'s "Refit" instruction, which the runner cannot act on', async () => {
    // That copy is written for a PROPOSAL. Once the rebuild has happened it
    // asks the runner to do something that is already done.
    const msg = await messageFor({
      reasons: {
        message: 'Your long runs have drifted from this plan\'s targets. Refit for an honest progression.',
        plan_delta: DELTA_23_TO_38,
      },
    });
    expect(msg).not.toMatch(/Refit/i);
    expect(msg).toContain('Your long runs had moved past what the block prescribed.');
  });

  it('is short, direct, and does not scold', async () => {
    const msg = await messageFor({ reasons: { plan_delta: DELTA_23_TO_38 } });
    expect(msg).not.toMatch(/!/);
    expect(msg).not.toMatch(/[—–]/);
    expect(msg).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(msg.length).toBeLessThan(200);
  });

  it('falls back to the applied voice when no delta was recorded', async () => {
    // Every rebuild before tonight is in this state. It must still read as an
    // account of something that happened, not a request.
    const msg = await messageFor({ reasons: { message: 'Your long runs have drifted. Refit.' } });
    expect(msg).toBe('Your long runs had moved past what the block prescribed.');
  });

  it('never returns an empty body, whatever the row carries', async () => {
    for (const reasons of [{}, { message: '' }, { plan_delta: null }, { plan_delta: 'nonsense' }]) {
      const msg = await messageFor({ reasons });
      expect(msg.length, `reasons=${JSON.stringify(reasons)}`).toBeGreaterThan(0);
    }
  });

  it('handles a kind this build has never heard of without going blank', async () => {
    const msg = await messageFor({
      proposal_kind: 'some_future_kind', reasons: { plan_delta: DELTA_23_TO_38 },
    });
    expect(msg).toBe('The plan raised this week from 23 to 38 miles, and the long run from 7 to 13.');
  });
});

describe('a PENDING proposal still asks rather than reports', () => {
  it('keeps the detector\'s own copy, because nothing has happened yet', async () => {
    const msg = await messageFor({
      status: 'pending',
      reasons: { message: 'Your long runs have drifted from this plan\'s targets. Refit for an honest progression.' },
    });
    expect(msg).toMatch(/Refit for an honest progression/);
  });

  it('has no delta to describe', async () => {
    const msg = await messageFor({ status: 'pending', reasons: {} });
    expect(msg).toBe('Your long runs have drifted from this plan\'s targets. Refit for an honest progression.');
  });
});

describe('an unchanged rebuild has nothing to say', () => {
  it('does not manufacture a mileage sentence from a null delta', async () => {
    const msg = await messageFor({
      status: 'no_change',
      reasons: {
        unchanged: true,
        plan_delta: { ...DELTA_23_TO_38, unchanged: true },
        message: 'This plan was authored more than 8 weeks ago.',
      },
    });
    // describeDelta returns null for an unchanged delta, so the why stands
    // alone. The row does not surface anyway; this is belt and braces on the
    // one function that could invent a number.
    expect(msg).toBe('This plan was authored more than 8 weeks ago.');
  });
});
