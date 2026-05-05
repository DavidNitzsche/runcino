/**
 * /api/coach/today — daily prescription endpoint.
 *
 * GET → CoachToday (see lib/coach-engine.ts for the full shape).
 *
 * Reads aggregated state from Postgres + Strava cache via
 * gatherCoachState(), then runs the engine. iOS will call this every
 * morning to get today's workout + rationale + week shape + alerts.
 *
 * The engine is intentionally placeholder until the coaching research
 * doc lands. Response carries `isPlaceholder: true` so the UI can
 * surface a chip making that explicit.
 */

import { gatherCoachState } from '../../../../lib/coach-state';
import { coachDaily } from '../../../../lib/coach-engine';

export async function GET() {
  try {
    const state = await gatherCoachState();
    const today = coachDaily(state);
    return Response.json({ ok: true, today, state });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
