/**
 * plan-lifecycle · the entry point the API + UI calls.
 *
 * `getCurrentPlan(userId)` runs the lifecycle check first, then adapts
 * the active plan against fresh state. Three outcomes from the check
 * (per docs/PLAN_ARCHITECTURE.md §Lifecycle):
 *
 *   - 'continue': active plan is valid → adaptPlan + return.
 *   - 'transition': goalISO has passed OR there's a new A-race not yet
 *                   represented → archive, buildPlan(next), return.
 *   - 'rewrite': state has diverged dramatically (4+ weeks of
 *                completely-off-plan running) → archive, buildPlan,
 *                return.
 *
 * Auto-transitions are seamless. If no plan exists at all, this is the
 * function that authors one.
 */

import { getActivePlan, saveActivePlan } from '../lib/plan-store';
import { gatherCoachState } from '../lib/coach-state';
import type { CoachState } from '../lib/coach-state';
import { buildPlan, autoDetectLevel } from './plan-builder';
import { adaptPlan } from './plan-adapter';
import type { Plan } from './plan-types';
import type { BuildPlanRace } from './plan-builder';

export type LifecycleAction = 'continue' | 'transition' | 'rewrite' | 'first-time';

export interface LifecycleResult {
  plan: Plan;
  action: LifecycleAction;
}

/** Decide whether the active plan can continue, or whether a new plan
 *  needs to be authored. Pure — no side effects. */
export function lifecycleCheck(plan: Plan | null, state: CoachState): LifecycleAction {
  if (!plan) return 'first-time';
  if (plan.goalISO < state.now) return 'transition';
  // New A-race not yet represented in the plan
  const nextA = state.races.nextA;
  if (nextA && (plan.raceId == null || plan.goalISO !== nextA.date)) {
    return 'transition';
  }
  // Rewrite when state has diverged dramatically. Heuristic: 4 weeks
  // of completely-off-plan running without any mutations applied.
  // Approximation: if weeklyAvg4w differs from authoredFromState by
  // ≥40% in either direction AND no mutation has been recorded.
  const authoredAvg = plan.authoredFromState.weeklyAvg4w;
  if (authoredAvg > 0) {
    const drift = Math.abs(state.volume.weeklyAvg4w - authoredAvg) / authoredAvg;
    const anyMutations = plan.weeks.some(w => w.workouts.some(x => x.mutations.length > 0));
    if (drift >= 0.40 && !anyMutations) return 'rewrite';
  }
  return 'continue';
}

/** Build a `BuildPlanRace` from a `NextRace` if there is one. */
function toBuildRace(nextA: CoachState['races']['nextA']): BuildPlanRace | undefined {
  if (!nextA) return undefined;
  return {
    id: nextA.slug,
    name: nextA.name,
    dateISO: nextA.date,
    distanceMi: nextA.distanceMi,
    priority: nextA.priority,
  };
}

/** Read or author the current plan, then adapt against fresh state. */
export async function getCurrentPlan(userId = 'me'): Promise<LifecycleResult> {
  const state = await gatherCoachState();
  let plan = await getActivePlan(userId);
  let action: LifecycleAction = lifecycleCheck(plan, state);

  if (action !== 'continue') {
    const race = toBuildRace(state.races.nextA);
    const level = autoDetectLevel(state.volume.weeklyAvg4w);
    const fresh = await buildPlan({
      state,
      prefs: {
        longRunDow: state.prefs.longRunDow,
        qualityDows: state.prefs.qualityDows,
        restDow: state.prefs.restDow ?? 1,
        level,
      },
      race,
      todayISO: state.now,
      userId,
    });
    await saveActivePlan(fresh);
    plan = fresh;
  }

  // Adapt against current state (idempotent — safe to re-run).
  if (plan) {
    plan = await adaptPlan(plan, state, state.now, { persist: true });
  }
  return { plan: plan!, action };
}
