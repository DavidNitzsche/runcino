/**
 * lib/plan/_supersede_intents.test.ts · coach_intents supersede on archive.
 *
 * plan_proposals pointing at archived plans have been superseded since
 * 2026-08-27 (supersedeProposalsForArchivedPlans). coach_intents rows had
 * the identical dangling shape with nothing closing it: their `field` holds
 * a plan_workouts.id, and archiving the plan left plan_adapt_* intents
 * pointing at workouts that no longer belong to any active plan, with
 * pending ones still feeding the briefing voice.
 *
 * `supersedeIntentsForArchivedPlans` (2026-08-28) marks them — never
 * deletes — and the plan-drift cron sweeps it nightly per user. This suite
 * locks the write's shape: what it stamps, what it refuses to touch, and
 * that it is a mark, not a delete.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));

import { supersedeIntentsForArchivedPlans } from './proposals-state';

describe('supersedeIntentsForArchivedPlans', () => {
  async function run() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: unknown, params?: unknown[]) => {
        calls.push({ sql: String(sql), params: params ?? [] });
        return { rows: [], rowCount: 3 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    };
    const n = await supersedeIntentsForArchivedPlans(client, 'user-1');
    return { calls, n };
  }

  it('is one UPDATE · a mark, never a DELETE', async () => {
    const { calls, n } = await run();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('UPDATE coach_intents');
    expect(calls[0].sql).not.toContain('DELETE');
    expect(n).toBe(3);
  });

  it('stamps superseded_at and backfills acknowledged_at without clobbering a real ack', async () => {
    const { calls } = await run();
    expect(calls[0].sql).toContain('superseded_at = NOW()');
    expect(calls[0].sql).toContain('acknowledged_at = COALESCE(ci.acknowledged_at, NOW())');
  });

  it('touches only plan_adapt_* intents whose workout belongs to an ARCHIVED plan, once', async () => {
    const { calls } = await run();
    const sql = calls[0].sql;
    expect(sql).toContain("ci.reason LIKE 'plan_adapt_%'");
    expect(sql).toContain('tp.archived_iso IS NOT NULL');
    // Idempotent across nightly sweeps: an already-marked row is skipped.
    expect(sql).toContain('ci.superseded_at IS NULL');
    // Scoped to the user, like its plan_proposals sibling.
    expect(calls[0].params).toEqual(['user-1']);
  });
});
