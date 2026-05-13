/**
 * /api/plan/active — returns the active plan after lifecycle + adapt
 * have run. This is the single source of truth for the UI:
 *
 *   - /overview TodayCard reads today's PlanWorkout from this.
 *   - /training plan view renders all weeks from this.
 *   - PLAN ADAPTED card reads the last-7-day mutations from this.
 *
 * The endpoint is GET-only and always returns the freshest, post-adapt
 * plan. No request body. Optional ?userId=me query param (defaults).
 */

import { getCurrentPlan } from '../../../../coach/plan-lifecycle';
import { listMutations } from '../../../../lib/plan-store';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? 'me';
  const days = Number(url.searchParams.get('mutationsLastDays') ?? '7');
  try {
    const { plan, action } = await getCurrentPlan(userId);
    // Last-N-day mutations for the PLAN ADAPTED card.
    const sinceISO = new Date(Date.now() - days * 86_400_000).toISOString();
    const recentMutations = plan ? await listMutations(plan.id, sinceISO) : [];
    return Response.json({
      ok: true,
      plan,
      lifecycleAction: action,
      recentMutations,
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
