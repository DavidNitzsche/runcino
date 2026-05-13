/**
 * /api/plan-reset — archive the active plan so the next request to
 * /api/plan-range rebuilds it fresh from current state + prefs.
 *
 * POST (no body required). Returns { ok: true } on success.
 * The rebuild happens lazily on the next getCurrentPlan() call
 * (plan-range, overview, today) — lifecycle returns 'first-time'
 * and buildPlan() runs with the current builder code.
 */

import { getActivePlan, archivePlan } from '../../../lib/plan-store';

export async function POST(): Promise<Response> {
  try {
    const plan = await getActivePlan('me');
    if (plan) {
      await archivePlan(plan.id);
    }
    return Response.json({ ok: true, hadPlan: plan != null });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
