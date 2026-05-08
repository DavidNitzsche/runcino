/**
 * /api/retrospect — post-race reflection.
 *
 * POST body: { slug: string }
 * Looks up the race by slug, requires actualResult to be set, calls
 * coach.retrospect with the plan + actual + ambient state, returns
 * the LLM-generated narrative + optional calibration delta.
 *
 * No caching yet — runners trigger this manually after a race lands;
 * the cost is one LLM call per race, not per page-load. Future
 * iteration: cache the result on the race row so re-loading the
 * race detail page doesn't re-pay the LLM cost.
 */

import { coach } from '../../../coach/coach';
import { getRaceDB } from '../../../lib/race-store';
import { gatherCoachState } from '../../../lib/coach-state';

export async function POST(req: Request) {
  try {
    const body = await req.json() as { slug?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (!slug) {
      return Response.json({ ok: false, error: 'slug required' }, { status: 400 });
    }
    const race = await getRaceDB(slug);
    if (!race) {
      return Response.json({ ok: false, error: 'race not found' }, { status: 404 });
    }
    if (!race.actualResult) {
      return Response.json(
        { ok: false, error: 'race has no actualResult — record a finish first' },
        { status: 400 },
      );
    }

    // The retrospect call uses today's coach state for context (e.g.
    // current VDOT vs the race's implied VDOT, recent training load).
    const state = await gatherCoachState();
    const decision = await coach.retrospect({
      today: state.now,
      state,
      plan: race.plan,
      actual: race.actualResult,
    });
    return Response.json({ ok: true, ...decision });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
