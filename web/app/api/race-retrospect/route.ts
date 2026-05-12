/**
 * /api/race-retrospect — post-race reflection.
 *
 * Stage 5 wired: delegates to `coach.retrospect(...)`. The route exists
 * so the client-side race detail page (`/races/[slug]`) can fetch the
 * Coach's narrative + calibration delta after the race is marked
 * completed.
 *
 * The Coach reads two opaque shapes — `plan` and `actual` — and
 * extracts the fields it cares about (goalFinishS, miles[], finishS,
 * splits). We assemble both from the race row's plan + actualResult
 * and pass through.
 *
 * @research Research/01-pace-zones-vdot.md §Freshness window
 * @research Research/00b-recovery-protocols.md §Single-race over-correction caution
 */

import { coach } from '../../../coach/coach';
import { getRaceDB } from '../../../lib/race-store';
import type { CoachDecision } from '../../../coach/types';
import type { RetrospectiveOutput } from '../../../coach/coach';

interface OkBody {
  ok: true;
  retrospect: CoachDecision<RetrospectiveOutput>;
}

interface ErrBody {
  ok: false;
  error: string;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug');
  if (!slug) {
    return Response.json({ ok: false, error: 'slug query param required' } satisfies ErrBody, { status: 400 });
  }

  try {
    const race = await getRaceDB(slug);
    if (!race) {
      return Response.json({ ok: false, error: `race "${slug}" not found` } satisfies ErrBody, { status: 404 });
    }
    if (!race.actualResult) {
      return Response.json(
        { ok: false, error: 'no actual result on file — retrospect requires a completed race' } satisfies ErrBody,
        { status: 422 },
      );
    }

    // The Coach extracts numeric fields by name (goalFinishS,
    // distanceMi, miles[], finishS, paceSPerMi). We forward the
    // plan + actual as-is so the engine reads them from one source.
    const planForCoach = {
      goalFinishS: race.plan.goal.finish_time_s,
      distanceMi: race.meta.distanceMi,
      // The intervals carry per-segment plan info but the retrospect
      // path doesn't read them today — keep payload minimal.
    };
    const actualForCoach = {
      finishS: race.actualResult.finishS,
      paceSPerMi: race.actualResult.paceSPerMi ?? null,
      distanceMi: race.meta.distanceMi,
      miles: race.actualResult.miles ?? [],
    };

    const retrospect = await coach.retrospect({
      today: new Date().toISOString().slice(0, 10),
      plan: planForCoach,
      actual: actualForCoach,
    });

    return Response.json({ ok: true, retrospect } satisfies OkBody);
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) } satisfies ErrBody,
      { status: 500 },
    );
  }
}
