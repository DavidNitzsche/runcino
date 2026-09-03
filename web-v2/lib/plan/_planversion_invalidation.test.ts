/**
 * lib/plan/_planversion_invalidation.test.ts · PLANVERSION-1's own ratchet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GAP
 *
 * `planVersion` (`${training_plans.id}:${last_adapted_at}`, see
 * `app/api/v5/today/route.ts` and `lib/plan/week-loader.ts`) is the signal
 * an iPhone client uses to know a cached day's content is stale. A full
 * rebuild changes `id`, so it is always safe. An IN-PLACE mutation — same
 * `id`, different `pace_target_s_per_mi` / `authored_state` — is only safe
 * if the writer also bumps `last_adapted_at`.
 *
 * `lib/plan/reanchor-plan.ts` (the daily `snapshot-projections` cron's own
 * re-anchor, and the `race-authority` fallback both call into it) rewrote
 * `plan_workouts.pace_target_s_per_mi` and `training_plans.authored_state`
 * through `mutatePlan`'s `bypass`/`derivations` paths, and NEITHER of those
 * paths stamped `last_adapted_at` — confirmed by reading every write site
 * in the file (2026-09-03). A runner's prescribed paces could move, daily,
 * for every active runner, with `planVersion` never noticing — the exact
 * gap that would leave an iPhone showing yesterday's pace band under a
 * "fresh" label forever.
 *
 * THE FIX: `mutatePlan` (`lib/plan/mutate.ts`) is the one door in front of
 * `plan_workouts` — every in-place writer this codebase has (`reanchor-plan`,
 * `adapt.ts`'s field_test limb, etc.) already routes through it. So the
 * stamp lives THERE, once, rather than at each of the (currently four, and
 * growing) raw UPDATE sites inside `reanchor-plan.ts` alone. `run-adaptations`
 * stamps directly in its own route file for historical reasons (it predates
 * this fix) and is exempted below on that basis, checked explicitly rather
 * than assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS GATES
 *
 * 1. `mutatePlan` itself still stamps every exit that commits a write to an
 *    EXISTING plan (excludes `authorship` — a brand-new row, safe via its
 *    own new `id` — and the true no-op early return).
 * 2. Every `AUTOMATIC_MUTATIONS` registry entry that overwrites plan content
 *    IN PLACE (`reach !== 'replaces_plan'`, `changes` touches
 *    `plan_workouts` or `training_plans`) is demonstrated to reach either
 *    `mutatePlan(` or an explicit `last_adapted_at` stamp — in its own route
 *    file, or in `lib/plan/reanchor-plan.ts` for the one entry that is known
 *    to call through it. A NEW writer with neither fails this gate, by
 *    design — it is a floor, not an allowlist that grows to match whatever
 *    ships.
 *
 * Falsify before trusting (Rule 18): delete `await stampAdapted(afterPlanId)`
 * from the `structural` commit path in `mutate.ts` and confirm test 1 fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AUTOMATIC_MUTATIONS } from '../audit/automatic-mutation-registry';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
// `mutatePlan<T>(...)` — several call sites pass an explicit generic, so the
// literal substring `mutatePlan(` never appears there. Allow an optional
// `<...>` between the name and the call.
const CALLS_MUTATE_PLAN = /mutatePlan(<[^>]*>)?\s*\(/;

describe('PLANVERSION-1 · every in-place plan writer moves the version signal', () => {
  it('mutatePlan stamps last_adapted_at on every commit path that writes an EXISTING plan', () => {
    const s = read('lib/plan/mutate.ts');
    expect(s).toContain(
      'UPDATE training_plans SET last_adapted_at = NOW() WHERE id = $1',
    );
    // bypass, derivations, structural — the three paths that can commit a
    // write against a plan that already exists. `authorship` (a brand-new
    // row) and the true no-op are deliberately not among them.
    const stampCallCount = (s.match(/await stampAdapted\(/g) ?? []).length;
    expect(stampCallCount).toBeGreaterThanOrEqual(3);
  });

  it('every in-place plan-content writer in the automatic-mutation registry reaches the stamp', () => {
    const CONTENT_TABLES = ['plan_workouts', 'training_plans', 'training_plans.authored_state'];
    const inPlaceWriters = AUTOMATIC_MUTATIONS.filter(
      (m) => m.reach !== 'replaces_plan' && m.changes.some((c) => CONTENT_TABLES.includes(c)),
    );
    // Floor: a scanner matching zero writers is indistinguishable from one
    // that stopped working, per check-automatic-mutations.sh's own posture.
    expect(inPlaceWriters.length).toBeGreaterThanOrEqual(2);

    for (const writer of inPlaceWriters) {
      const routeSrc = read(writer.route);
      const stampsDirectly = routeSrc.includes('last_adapted_at');
      const callsMutatePlanDirectly = CALLS_MUTATE_PLAN.test(routeSrc);
      if (stampsDirectly || callsMutatePlanDirectly) continue;

      // The one indirection this repo's plan writers actually take today:
      // a cron route delegating to lib/plan/reanchor-plan.ts, which is the
      // file that calls mutatePlan on its behalf. Named explicitly rather
      // than resolved by import-graph analysis — if a writer takes a
      // DIFFERENT indirection, this assertion fails and says so, rather
      // than silently passing.
      const delegatesToReanchor = routeSrc.includes('reanchor-plan');
      expect(delegatesToReanchor, `${writer.id}: neither stamps last_adapted_at nor calls mutatePlan directly, and does not delegate to reanchor-plan.ts — name where it invalidates planVersion`).toBe(true);
      const reanchorSrc = read('lib/plan/reanchor-plan.ts');
      expect(CALLS_MUTATE_PLAN.test(reanchorSrc), `${writer.id} delegates to reanchor-plan.ts, which must call mutatePlan`).toBe(true);
    }
  });
});
