/**
 * POST /api/plan/adaptations/act — approve or skip BIG plan adaptations.
 *
 * The coach proposes (status='proposed') discretionary, plan-reshaping
 * changes — cutbacks, suppressing quality, volume drops from poor
 * check-ins, race-week reshapes, post-race pace shifts (see
 * APPROVAL_TRIGGERS in plan-adapter.ts). Those mutations are RECORDED but
 * NOT applied to the workout until the runner signs off here.
 *
 *   Body: { ids: string[], action: 'accept' | 'decline' }
 *
 * accept  → applies each mutation's changedFields to its plan_workout +
 *           flips status to 'applied'.
 * decline → flips status to 'declined' (the workout keeps its values).
 *
 * Scoped to the resolved plan owner so a request can only act on its own
 * plan's proposals. Returns { ok, updated } (count of rows acted on).
 */

import { actOnMutations } from '@/lib/plan-store';
import { resolvePlanUserId } from '@/lib/plan-user';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ids: unknown = body.ids;
    const action: unknown = body.action;

    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string') || ids.length === 0) {
      return Response.json({ ok: false, error: 'ids: non-empty string[] required' }, { status: 400 });
    }
    if (action !== 'accept' && action !== 'decline' && action !== 'dismiss') {
      return Response.json({ ok: false, error: "action must be 'accept', 'decline', or 'dismiss'" }, { status: 400 });
    }

    const userId = await resolvePlanUserId();
    const { updated } = await actOnMutations(ids as string[], action, userId);
    return Response.json({ ok: true, updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
