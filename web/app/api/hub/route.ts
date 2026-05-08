/**
 * /api/hub — the unified RunnerHub endpoint.
 *
 * One request, all the runtime state any page needs: today's
 * prescription, week shape, 30-day outlook, VDOT, daily brief,
 * readiness, all saved races, and the runner profile.
 *
 * The expensive coach payload is read through `coach_today_cache`
 * (Postgres). Races + profile are quick Postgres SELECTs. Net cost
 * on a hot cache: ~50ms. On a cold cache: ~150ms deterministic +
 * 2-5s LLM brief.
 *
 * Response shape: see `RunnerHubResponse` in lib/hub-types.ts.
 */

import { getHub } from '../../../lib/hub';

export async function GET() {
  try {
    const { hub } = await getHub();
    return Response.json(hub);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
