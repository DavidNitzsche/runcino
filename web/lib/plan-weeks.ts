/**
 * Real-plan → PlanWeek[] resolver.
 *
 * The ONE place the app turns the persisted, coach-generated plan
 * (getCurrentPlan → buildPlan, grounded in /Research) into the week grid
 * every surface renders. Returns [] when the runner has no plan, callers
 * show an honest empty state, NEVER a synthetic fallback.
 *
 * This is the replacement for the old buildSyntheticPlan(): there is no
 * fabricated plan anywhere. Web and phone read the same real artifact.
 */

import { getCurrentPlan } from '@/coach/plan-lifecycle';
import { getActivePlan } from './plan-store';
import { resolvePlanUserId } from './plan-user';
import { realPlanToWeeks, type PlanWeek } from './synthetic-plan';
import { describeKeyFromPlan } from './workout-descriptions';

/**
 * The runner's real plan as week rows, or [] when no plan exists yet.
 * `.catch` → [] so a transient build/state error never falls back to fake
 * data; the surface renders its empty state instead.
 */
export async function getRealPlanWeeks(userId: string): Promise<PlanWeek[]> {
  const res = await getCurrentPlan(userId).catch(() => null);
  return res?.plan ? realPlanToWeeks(res.plan, describeKeyFromPlan) : [];
}

/**
 * READ-ONLY plan weeks for background / non-page contexts (Strava webhook,
 * activity sync, run-detail lookups). Reads the persisted active plan WITHOUT
 * the build/adapt/persist side effects of getCurrentPlan, an activity sync
 * must never trigger a plan rebuild. Always keyed to the plan user, not the
 * caller's id. Returns [] when no plan exists yet (callers skip honestly).
 */
export async function getActivePlanWeeks(): Promise<PlanWeek[]> {
  const plan = await getActivePlan(await resolvePlanUserId()).catch(() => null);
  return plan ? realPlanToWeeks(plan, describeKeyFromPlan) : [];
}
