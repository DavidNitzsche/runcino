/**
 * Which refused webhook events are worth waking someone for.
 *
 * Lives in lib/ rather than inside the route so the routing rule is
 * testable on its own. Extracted 2026-08-21 with the severity fix.
 *
 * The three reasons an event gets refused are not the same kind of news
 * and must not share an alert budget:
 *
 *   'our_fault'  — the subscription lookup failed or found nothing. Our
 *                  table is empty or stale and we are dropping REAL
 *                  events. This has happened twice: Jun 5-9 2026, and
 *                  again from 2026-06-11 to 2026-08-17, when 20 of
 *                  David's own activities were refused here. Always worth
 *                  waking to.
 *
 *   'forged'     — the event passed both gates and Strava contradicts it:
 *                  a delete for an activity that still exists, a deauth
 *                  on a live token, a create naming someone else's
 *                  activity. Refusing is the right answer, and it is
 *                  still worth waking to.
 *
 *   'not_a_user' — a valid event for an athlete with no faff account.
 *                  Someone else authorised the faff Strava application,
 *                  so their activities are pushed to us and correctly
 *                  refused. This is the system working. It is not an
 *                  alert.
 *
 * WHY THE SPLIT. The dedup used to be kind-wide: one 6h window shared by
 * every reason. On 2026-08-21 ops_alerts held 73 webhook_failure rows, 52
 * of them one non-user athlete's ordinary runs. Those benign rows were
 * silencing the window that the real fault needed — and the real fault was
 * live the whole time. Now each reason gets its own window, and the reason
 * that means nothing is not written at all.
 */
import { pool } from '@/lib/db/pool';
import { raiseAlert } from '@/lib/ops/alerts';

export type RejectReason = 'our_fault' | 'forged' | 'not_a_user';

/** Reasons that reach ops_alerts. A non-user event is not one of them. */
export function shouldAlert(reason: RejectReason): boolean {
  return reason !== 'not_a_user';
}

/**
 * Rejected-event alert, deduped per reason on a 6h window. Best-effort —
 * alerting must never break the ACK path.
 */
export async function alertWebhookRejected(
  reason: RejectReason,
  message: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!shouldAlert(reason)) {
    // Expected and ongoing. Keep it observable in the log, out of the
    // alert table.
    console.info(`[strava/webhook] ignored event for non-user athlete · ${message}`);
    return;
  }
  try {
    const recent = await pool.query(
      `SELECT 1 FROM ops_alerts
        WHERE kind = 'webhook_failure'
          AND COALESCE(metadata->>'reason', '') = $1
          AND created_at > NOW() - INTERVAL '6 hours'
        LIMIT 1`,
      [reason],
    );
    if (recent.rows.length > 0) return;
    await raiseAlert({
      kind: 'webhook_failure',
      severity: 'error',
      message,
      metadata: { ...metadata, reason },
      source: 'strava/webhook',
    });
  } catch (e: any) {
    console.error('[strava/webhook] alert write failed:', e?.message);
  }
}
