/**
 * GET /api/plan/workout?date=YYYY-MM-DD
 *
 * The structured, described workout for one plan day, the SAME
 * describeWorkout the web /workout modal and the iPhone today-card render,
 * so a future day's detail sheet shows the real steps (warmup / N×reps /
 * cooldown with paces + zones) + effort + why, not just prose.
 *
 * Lazy by design: the /plan-range grid stays light; this is fetched only
 * when a day's detail sheet opens. Returns { workout: null } for rest days,
 * dates outside the plan, or when there's no plan.
 */

import { getActivePlan } from '@/lib/plan-store';
import { resolvePlanUserId } from '@/lib/plan-user';
import { gatherCoachState } from '@/lib/coach-state';
import { getCurrentUser } from '@/lib/auth';
import { vdotSnapshot } from '@/lib/vdot';
import { describeWorkout, describeKeyFromPlan } from '@/lib/workout-descriptions';
import type { ResolvedFitness } from '@/lib/fitness-resolver';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ ok: false, error: 'date=YYYY-MM-DD required' }, { status: 400 });
  }
  try {
    const plan = await getActivePlan(await resolvePlanUserId());
    if (!plan) return Response.json({ ok: true, workout: null });

    let found: (typeof plan.weeks)[number]['workouts'][number] | null = null;
    for (const wk of plan.weeks) {
      const w = wk.workouts.find((x) => x.dateISO === date);
      if (w) { found = w; break; }
    }
    if (!found || found.type === 'rest') return Response.json({ ok: true, workout: null });

    // VDOT-derived paces for the runner (Bearer-aware), same as plan-range.
    const userId = (await getCurrentUser(req))?.id;
    const state = await gatherCoachState({ userId });
    const vsnap = vdotSnapshot(state);
    const fitness: ResolvedFitness | null = vsnap
      ? ({
          paces: vsnap.paces,
          racePaceBand: { lowS: vsnap.paces.T.lowS, highS: vsnap.paces.T.highS, label: 'Race pace' },
          hrZones: null,
        } as unknown as ResolvedFitness)
      : null;

    const label = describeKeyFromPlan(found.type, found.subLabel ?? null);
    const description = describeWorkout(label, found.type, fitness);
    return Response.json({
      ok: true,
      workout: { label, type: found.type, distanceMi: found.distanceMi, description },
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
