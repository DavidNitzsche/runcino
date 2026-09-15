/**
 * lib/ops/safety-readiness-check.ts · F126 (2026-09-15)
 *
 * Passive detector for the one contradiction `docs/BRAIN_CONSTITUTION.md`
 * §15 calls forbidden and that F096 exists to eventually arbitrate: Safety's
 * own `mayEmitRunnableWorkout` predicate (`lib/safety/safety-verdict.ts`)
 * said the runner should get no runnable session today, and the response a
 * route was about to send actually names one anyway.
 *
 * DETECTION ONLY. Nothing here decides what SHOULD be served, and nothing
 * here changes what a runner is served — it raises an `ops_alerts` row
 * (`safety_readiness_mismatch`, `lib/ops/alerts.ts`) so there is real
 * incidence data before anyone designs the actual arbitration policy. Kept
 * out of `safety-verdict.ts` on purpose: that file's existing predicates are
 * the thing this check reads, not a thing F126 touches.
 */
import { raiseAlert } from './alerts';
import { mayEmitRunnableWorkout, type SafetyResolution } from '@/lib/safety/safety-verdict';

/**
 * Whatever names the session about to ship — plan id, date, workout
 * type/sub-label, whatever the caller actually has in scope. Not typed
 * further than that on purpose: this is a debugging breadcrumb for
 * reconstructing the incident later, not a contract another surface reads.
 */
export type RunnableSessionShipped = Record<string, unknown>;

/**
 * Call this right before a route builds its final response. Fires exactly
 * when Safety's own predicate says the day should carry no runnable
 * session, yet the response actually carries one — the forbidden
 * combination Constitution §31 names as the required invariant
 * (`mayEmitRunnableWorkout`'s own doc comment: "Safety STOP -> no runnable
 * workout emitted").
 *
 * `raiseAlert` already swallows its own DB/webhook failures internally, so
 * awaiting this never risks the caller's response — it is safe to `await`
 * on the response's critical path (as `v5/today` does) or to fire-and-forget.
 *
 * Returns whether it fired, so a caller or a test can assert on the outcome
 * without reaching into the alert-dispatch mock.
 */
export async function detectSafetyReadinessMismatch(
  safety: SafetyResolution,
  hasRunnableSession: boolean,
  session: RunnableSessionShipped | null,
  source = 'api/v5/today',
): Promise<boolean> {
  if (mayEmitRunnableWorkout(safety) || !hasRunnableSession) return false;

  await raiseAlert({
    kind: 'safety_readiness_mismatch',
    severity: 'error',
    message:
      `F126: Safety's mayEmitRunnableWorkout forbids a runnable session today `
      + `(known=${safety.known}${safety.known ? `, driver=${safety.driver ?? 'none'}` : ''}) `
      + `but the response about to ship names one anyway.`,
    metadata: {
      safety: safety.known
        ? {
            known: true,
            state: safety.state,
            posture: safety.posture,
            reason: safety.reason,
            driver: safety.driver,
          }
        : {
            known: false,
            posture: safety.posture,
            floor: safety.floor,
            unreadable: safety.unreadable,
          },
      session,
    },
    source,
  });
  return true;
}
