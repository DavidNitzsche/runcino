/**
 * lib/brain/proposal/_stale_dedup.test.ts · a non-mutating dedup that
 * ignores the anchor must not ALSO ignore the reason.
 *
 * STALEPROPOSAL-1 (2026-09-07). Found live: a HOLD raised against David's
 * 2026-09-13 race (`long-run-structure.ts`, before RACEDAYSTRUCTURE-1
 * excluded race days from that reader's candidate query) sat `pending`.
 * `writeActionProposal`'s dedup for non-mutating kinds (HOLD, REFUSAL,
 * SAFETY_STOP) checks only `(user_uuid, action_kind, status='pending')` —
 * deliberately ignoring the anchor, because the anchor is expected to slide
 * week to week for the SAME ongoing decision (Rule 17). But the fixed
 * reader's next candidate moved to a different session (2026-09-20) with a
 * DIFFERENT reason, and the stale row's presence silently blocked every
 * later cron pass from ever writing the corrected card — verified against a
 * real copy of production data (`docs/reports/brain-2026-09-07/HANDBACK.md`
 * session notes): the wrong card was still the one on screen the night
 * after the reader fix deployed.
 *
 * This test proves the OLD behaviour is wrong before proving the fix right:
 * a duplicate with a DIFFERENT reason must supersede the stale row and let
 * the new one through, never treat "same kind" alone as "same decision".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '@/lib/db/pool';
import { writeActionProposal } from './write';
import type { BrainAction } from './action';

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

const holdActionNamed = (because: string): BrainAction => ({
  schemaVersion: 1,
  kind: 'HOLD',
  direction: 'NEUTRAL',
  because,
  before: [],
}) as unknown as BrainAction;

const holdAction = holdActionNamed('new reason');

const mockedQuery = pool.query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('writeActionProposal · non-mutating dedup', () => {
  it('supersedes a stale pending row whose reason no longer matches, then writes the new one', async () => {
    // 1 · dedup SELECT finds an existing pending HOLD with a DIFFERENT reason.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 8, reason: 'old reason' }] });
    // 2 · the UPDATE ... SET status = 'superseded' ...
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    // 3 · the INSERT of the corrected row.
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 9 }] });

    const out = await writeActionProposal({
      userUuid: USER,
      action: holdAction,
      anchorWorkoutId: 'wko_new',
      anchorDateISO: '2026-09-20',
      reason: 'new reason',
      source: 'cron_evening',
      todayISO: '2026-09-07',
    });

    expect(out.ok).toBe(true);
    expect(out.ok && out.written).toBe(true);
    expect(mockedQuery).toHaveBeenCalledTimes(3);
    const supersedeSql = mockedQuery.mock.calls[1][0] as string;
    expect(supersedeSql).toMatch(/SET status = 'superseded'/);
    expect(mockedQuery.mock.calls[1][1]).toEqual([8]);
    const insertSql = mockedQuery.mock.calls[2][0] as string;
    expect(insertSql).toMatch(/INSERT INTO plan_workout_proposals/);
  });

  it('still dedups (no write, no supersede) when the reason is unchanged — Rule 17 holds', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 8, reason: 'same reason' }] });

    const out = await writeActionProposal({
      userUuid: USER,
      action: holdActionNamed('same reason'),
      anchorWorkoutId: 'wko_moved',
      anchorDateISO: '2026-09-14',
      reason: 'same reason',
      source: 'cron_evening',
      todayISO: '2026-09-07',
    });

    expect(out.ok).toBe(true);
    expect(out.ok && out.written).toBe(false);
    // Only the dedup SELECT ran — no supersede, no insert.
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });
});
