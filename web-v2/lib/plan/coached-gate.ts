/**
 * lib/plan/coached-gate.ts · does Faff author plans for this runner at all?
 *
 * ─── the bug this closes ─────────────────────────────────────────────────────
 *
 * `coached_externally` is the fifth onboarding branch (app/api/onboarding/
 * complete/route.ts): the runner has a human coach, that coach owns the
 * prescription, and Faff is the measurement layer. Onboarding honours it —
 * `seedPlan = { ok: true, mode: 'coached' }`, no races row, no training_plans
 * row.
 *
 * Nothing else did. The flag was read in exactly two places, both of them
 * DISPLAY (`components/faff-app/seed.ts`, `lib/today/composition.ts`), and
 * never once in the plan engine. So the obvious next thing a coached runner
 * does — put their goal race on the calendar so Faff can track it — hit
 * `POST /api/race`, found no active plan, and authored a full 16-week block
 * against their coach's. Today then selected 'build' instead of 'coached'
 * (selectTodayState checks `coachedExternally` BEFORE the plan, but the plan's
 * prescriptions are what the rest of the page renders), and the COACHED
 * treatment silently disappeared. Same for `POST /api/profile/goal`, and same
 * for every automatic rebuild the lifecycle cron fires.
 *
 * ─── where the gate belongs ──────────────────────────────────────────────────
 *
 * At the single chokepoint, `generatePlan` — one call, unmissable, covers
 * paths that do not exist yet. This module exists so that call is a one-liner
 * and so every entry point can share ONE reader with ONE definition of the
 * flag. It is wired at each authoring entry point that the lifecycle owns;
 * see the report for the `generate.ts` line that makes it universal.
 *
 * ─── what "coached" does NOT block ───────────────────────────────────────────
 *
 * Only AUTHORSHIP. Saving the race row, tracking runs, readiness, health,
 * projections, the coach calendar feed and every measurement surface are
 * untouched — those are the product for this runner. A coached runner who
 * explicitly asks for a plan (taps a Generate button) is making a decision,
 * not being surprised by one; the gate is for the automatic paths.
 */

import { pool } from '@/lib/db/pool';

/** Reason string stamped on skipped authorship, in plan_proposals and in
 *  route responses. Stable — surfaces match on it. */
export const COACHED_SKIP_REASON = 'coached_externally';

/**
 * True when the runner told us their own coach writes the plan.
 *
 * Best-effort by design: a read failure returns FALSE (author the plan). The
 * failure mode of a false positive is "we silently stopped coaching someone
 * who asked to be coached", which is worse and much harder to see than an
 * extra plan a coached runner can ignore.
 */
export async function isCoachedExternally(userUuid: string): Promise<boolean> {
  try {
    const r = await pool.query<{ coached: boolean | null }>(
      `SELECT (user_settings->>'coached_externally')::boolean AS coached
         FROM profile WHERE user_uuid = $1 LIMIT 1`,
      [userUuid],
    );
    return r.rows[0]?.coached === true;
  } catch {
    return false;
  }
}
