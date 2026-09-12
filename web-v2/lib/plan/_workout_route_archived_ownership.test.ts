/**
 * PATCH /api/plan/workout · the ownership query must exclude archived plans.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────
 *
 * The ownership check was `SELECT id FROM training_plans WHERE id = $1 AND
 * user_uuid = $2` — no `archived_iso IS NULL`. `mutatePlan`'s own internal
 * snapshot read (`lib/plan/mutate.ts`) also resolves the plan by bare `id`
 * with no archived/ownership filter of its own, so this route's SELECT was
 * the only gate. Given any archived plan id belonging to the caller, the
 * route would happily route a PATCH into that dead plan's `plan_workouts`
 * rows — silently, since archiving never deletes them (the same fact Rule
 * 14 / ACTIVEPLAN-1 exists to guard reads against, applied here to a write).
 *
 * Inert in production today only because no client path currently sends a
 * stale/archived plan id — but a cached client holding an old plan
 * reference across a rebuild is exactly the shape that would trigger it,
 * and nothing would tell either the runner or the engine that it happened.
 *
 * This is a behavioural test, not a static scan — `_active_plan_scan.test.ts`
 * (ACTIVEPLAN-1) does not catch this shape because it only inspects
 * `plan_workouts` statements, and pins-by-`plan_id` reads as "guarded" under
 * that scanner's model (correctly, for the cross-version-read concern it
 * exists to catch — this is a different concern: whether the `plan_id` was
 * itself resolved against a live plan before ever reaching that statement).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({ requireUserId: vi.fn() }));
vi.mock('@/lib/plan/mutate', () => ({ mutatePlan: vi.fn() }));
vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn() }));
vi.mock('@/lib/runtime/runner-tz', () => ({ runnerToday: vi.fn().mockResolvedValue('2026-09-12') }));

import { pool } from '@/lib/db/pool';
import { requireUserId } from '@/lib/auth/session';
import { mutatePlan } from '@/lib/plan/mutate';
import { PATCH } from '../../app/api/plan/workout/route';

const ROUTE_FILE = path.join(__dirname, '..', '..', 'app', 'api', 'plan', 'workout', 'route.ts');

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/plan/workout', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/plan/workout · archived-plan ownership guard', () => {
  const USER = 'user-1234';

  beforeEach(() => {
    vi.mocked(requireUserId).mockResolvedValue(USER as any);
    vi.mocked(pool.query).mockReset();
    vi.mocked(mutatePlan).mockReset();
  });

  it('the ownership SELECT text excludes archived plans (regression guard on the literal SQL)', () => {
    const src = fs.readFileSync(ROUTE_FILE, 'utf8');
    const selectStart = src.indexOf('SELECT id FROM training_plans');
    expect(selectStart, 'ownership SELECT not found where expected — route.ts shape changed').toBeGreaterThan(-1);
    const statement = src.slice(selectStart, src.indexOf('`', selectStart));
    expect(statement).toMatch(/user_uuid\s*=\s*\$2/);
    expect(statement, 'ownership SELECT must exclude archived plans').toMatch(/archived_iso IS NULL/i);
  });

  it('404s on an archived plan id and never reaches mutatePlan', async () => {
    // The archived-aware SELECT correctly finds no row for an archived plan
    // belonging to this user.
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const res = await PATCH(patchRequest({
      plan_id: 'archived-plan-id',
      date_iso: '2026-09-12',
      type: 'easy',
    }) as any);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: 'plan not found' });
    // The whole point: an archived plan must never reach the mutation
    // boundary, whatever plan_id the caller supplies.
    expect(mutatePlan).not.toHaveBeenCalled();
  });

  it('proceeds to mutatePlan when the plan is live (positive control)', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ id: 'live-plan-id' }] } as any);
    vi.mocked(mutatePlan).mockResolvedValueOnce({
      ok: true,
      value: { rowCount: 1, row: { date_iso: '2026-09-12', dow: 'FRI', type: 'easy', distance_mi: 5, sub_label: null } },
    } as any);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any); // coach_intents insert

    const res = await PATCH(patchRequest({
      plan_id: 'live-plan-id',
      date_iso: '2026-09-12',
      type: 'easy',
    }) as any);

    expect(mutatePlan).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
