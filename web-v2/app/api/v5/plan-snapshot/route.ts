/**
 * GET /api/v5/plan-snapshot
 *
 * PLANSNAPSHOT-1 · returns the runner's ENTIRE active authored block — plan
 * start through plan end (race day, or the block's final day for a goal
 * with no set race) — in one response. See `lib/plan/plan-snapshot.ts` for
 * the loader and the full design rationale.
 *
 * This is the ONE call the iPhone makes to build its local `PlanSnapshot`.
 * Per-date navigation reads that local copy afterward and never calls this
 * endpoint (or `/api/v5/today`/`/api/plan/week`) per date selected — see
 * `docs/handback-*-plan-snapshot-*.md` for the client-side contract.
 *
 * `force-dynamic`, same as `/api/v5/today` — this reads live plan/execution
 * state and must never be statically cached at the edge.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth/session';
import { runnerToday } from '@/lib/runtime/runner-tz';
import { loadPlanSnapshot } from '@/lib/plan/plan-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireUserId(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const today = await runnerToday(userId);
  const result = await loadPlanSnapshot(userId, today);
  return NextResponse.json(result);
}
