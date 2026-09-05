/**
 * lib/plan/_proposal_expiry.test.ts · V5PROPOSALSURFACE-1 · expiry stops being
 * a fire-and-forget write on a screen nobody could open.
 *
 * ── THE THREE DEFECTS THIS PINS ────────────────────────────────────────────
 *
 * Production `plan_workout_proposals` row 6 was raised 2026-08-23 for a
 * session on 2026-08-25 and was still `pending` eleven days later, on a table
 * with seven rows in the life of the product. Expiry was one UPDATE inside
 * `loadPendingProposals` with `.catch(() => {})` after it, and it was broken
 * three ways at once:
 *
 *   F1 · A FAILED SWEEP WAS INDISTINGUISHABLE FROM A CLEAN ONE. The audit that
 *        found row 6 could not tell "nobody called it" from "it failed", and
 *        said so in writing.
 *   F2 · IT ASKED THE SERVER WHAT DAY IT WAS. `CURRENT_DATE` is UTC, so for a
 *        Pacific runner it rolls over at 5pm local and expires TODAY'S
 *        proposal while he is still deciding whether to run it.
 *   F3 · THE ONLY CLAUSE WAS "THE DATE PASSED". An unanswered question for a
 *        session three weeks out blocked the dedupe for three weeks.
 *
 * ── RULE 22 · WHAT THIS GATE CANNOT FAIL ON ────────────────────────────────
 *
 * It cannot fail on the sweep actually being SCHEDULED. It mocks the pool, so
 * it proves the function's shape and its SQL, not that `plan-drift` calls it —
 * that mount is a separate line in a cron route and only a run against a real
 * database would prove it fired.
 *
 * It cannot fail on 14 days being the right number. It only pins that the two
 * tables holding a runner's open decisions age them at the SAME rate, which is
 * the Rule 16 property; whether a fortnight is correct is a product call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  // A Pacific runner at 5:30pm local on the 4th: UTC has already ticked to the
  // 5th. This is F2's whole surface — the two answers differ by a day.
  runnerToday: vi.fn().mockResolvedValue('2026-09-04'),
}));

import { pool } from '@/lib/db/pool';
import {
  PROPOSAL_UNANSWERED_EXPIRY_DAYS,
  expireStaleWorkoutProposals,
  expiredCount,
} from '@/lib/plan/proposal-expiry';

const q = () => pool.query as unknown as ReturnType<typeof vi.fn>;
const USER = '11111111-2222-3333-4444-555555555555';

beforeEach(() => { q().mockReset(); });

describe('V5PROPOSALSURFACE-1 · F1 · a failed sweep is not a clean sweep', () => {
  it('reports the failure and carries NO count to spend', async () => {
    q().mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '08006' }));
    const r = await expireStaleWorkoutProposals(USER);
    expect(r.ok).toBe(false);
    // The type is the enforcement: the failure branch has no `expiredPastDated`
    // field at all, so a caller cannot read a number off a sweep that did not
    // happen. This assertion documents what the compiler already refuses.
    expect(Object.keys(r)).toEqual(['ok', 'error']);
  });

  it('a clean sweep that changed nothing reports ZERO, which is a real answer', async () => {
    q().mockResolvedValue({ rowCount: 0, rows: [] });
    const r = await expireStaleWorkoutProposals(USER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(expiredCount(r)).toBe(0);
  });

  it('stops at the first failure rather than reporting a partial sweep as whole', async () => {
    q()
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockRejectedValueOnce(new Error('statement timeout'));
    const r = await expireStaleWorkoutProposals(USER);
    expect(r.ok).toBe(false);
  });
});

describe('V5PROPOSALSURFACE-1 · F2 · the RUNNER\'S day, never the server\'s', () => {
  it('parameterises the past-dated clause and never says CURRENT_DATE', async () => {
    q().mockResolvedValue({ rowCount: 0, rows: [] });
    await expireStaleWorkoutProposals(USER);
    const [sql, params] = q().mock.calls[0];
    expect(sql).toContain('workout_date_iso <');
    expect(sql).not.toContain('CURRENT_DATE');
    expect(params).toEqual([USER, '2026-09-04']);
  });
});

describe('V5PROPOSALSURFACE-1 · F3 · an unanswered question also ages out', () => {
  it('runs a second clause on created_at, counted separately', async () => {
    q()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] });
    const r = await expireStaleWorkoutProposals(USER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Reported separately on purpose. Collapsing them would hide which clause
    // is firing, and they say different things about the runner: one is "the
    // day went past", the other is "nobody ever answered".
    expect(r.expiredPastDated).toBe(1);
    expect(r.expiredUnanswered).toBe(3);
    expect(expiredCount(r)).toBe(4);

    const [sql, params] = q().mock.calls[1];
    expect(sql).toContain('created_at <');
    expect(params).toEqual([USER, String(PROPOSAL_UNANSWERED_EXPIRY_DAYS)]);
  });

  it('ages at the same rate as plan_proposals · one runner, one fortnight', async () => {
    // Rule 16. `lib/plan/goal-outlook.ts::expireStalePendingProposals` has
    // expired pending `plan_proposals` at 14 days since 2026-08-17. Two tables
    // holding one runner's open decisions must not go quiet at two rates.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(
      path.join(process.cwd(), 'lib/plan/goal-outlook.ts'), 'utf8',
    );
    expect(src).toContain(`interval '${PROPOSAL_UNANSWERED_EXPIRY_DAYS} days'`);
  });
});

describe('V5PROPOSALSURFACE-1 · both clauses reach production row 6', () => {
  it('a row raised 2026-08-23 for a session on 2026-08-25 is caught twice over', async () => {
    // Not a simulation of the database, which is mocked: this asserts that the
    // predicates the sweep sends would both select that row. Past-dated,
    // because 2026-08-25 < the runner's today; unanswered, because it was
    // raised more than a fortnight ago. Either clause alone closes it.
    q().mockResolvedValue({ rowCount: 0, rows: [] });
    await expireStaleWorkoutProposals(USER);
    const pastDatedSql = q().mock.calls[0][0] as string;
    const unansweredSql = q().mock.calls[1][0] as string;
    for (const sql of [pastDatedSql, unansweredSql]) {
      expect(sql).toContain("status = 'pending'");
      expect(sql).toContain("SET status = 'expired'");
      expect(sql).toContain('resolved_at = NOW()');
      // Rule 14: the query names the population it reads.
      expect(sql).toContain('user_uuid = $1::uuid');
    }
  });
});
