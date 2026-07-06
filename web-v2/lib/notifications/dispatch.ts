/**
 * Dispatcher — glue between templates, prefs, device_tokens, sender, log.
 *
 * One call: `dispatchNotification(userId, rendered)`. Handles:
 *   1. Pref check (master + per-category)
 *   2. Recent-dedup (any same dedup_key sent in prior 24h → drop)
 *   3. Quiet-hours gate (runner-local, unless bypass_quiet_hours)
 *   4. Resolve all active device_tokens for the user
 *   5. Pre-log row insert (delivered = null)
 *   6. Per-token sendPush
 *   7. Update log row with apns_id + delivered flag
 *   8. On APNs 410 Gone → revoke the device_token row
 *
 * The caller (cron / event-trigger / event-bus writer) does NOT touch the
 * sender directly. Always go through dispatch.
 *
 * Source spec: docs/2026-05-28-notifications.html (esp. §5 dedup gate).
 */

import { pool } from '@/lib/db/pool';
import { sendPush, type SendPushArgs, apnsIsConfigured, isInQuietHours, type NotificationCategory } from './apns';
import { runnerTimezone } from '@/lib/runtime/runner-tz';
import { loadNotificationPrefs, categoryEnabled } from './prefs';
import type { RenderedTemplate } from './templates';

export interface DispatchResult {
  ok: boolean;
  skipped?: 'master_off' | 'category_off' | 'no_tokens' | 'apns_not_configured' | 'recently_sent' | 'quiet_hours';
  sent_count?: number;
  failed_count?: number;
  log_ids?: number[];
  /** Set when failed_count > 0. Drives the drain loop's retry policy:
   *  permanent = true only for APNs rejections that will never succeed
   *  on retry (400 BadDeviceToken, 403, 410 Gone). Network errors,
   *  timeouts, 429 and 5xx are retryable. With multiple tokens a
   *  retryable failure wins over a permanent one — the row retries so
   *  the retryable token gets another shot. */
  failure?: { reason: string; status?: number; detail?: string; permanent: boolean };
}

/**
 * Resolve active device tokens for a user. iOS + web both surface here.
 * Filter on revoked_at IS NULL — anything else stays in the table for
 * debug but never gets a payload.
 */
async function activeDeviceTokens(userId: string): Promise<Array<{ device_token: string; platform: string }>> {
  try {
    const r = await pool.query(
      `SELECT device_token, platform
         FROM device_tokens
        WHERE COALESCE(user_uuid, user_id) = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return r.rows;
  } catch {
    return [];
  }
}

/**
 * 24h dedup gate. If we've already sent the same key successfully in the
 * prior 24h, drop the second attempt silently. Matches deck §5.
 */
async function recentlySent(dedupKey: string, withinHours = 24): Promise<boolean> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM notifications_log
        WHERE dedup_key = $1
          AND fired_at > now() - ($2 || ' hours')::interval
          AND delivered = true
        LIMIT 1`,
      [dedupKey, String(withinHours)],
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * The one entry point. Pass a fully-rendered template; this handles the
 * rest. Returns a DispatchResult so the caller can log per-call telemetry.
 */
export async function dispatchNotification(
  userId: string,
  tpl: RenderedTemplate,
): Promise<DispatchResult> {
  // 1. Prefs
  const prefs = await loadNotificationPrefs(userId);
  if (!prefs.master_enabled) return { ok: true, skipped: 'master_off' };
  if (!categoryEnabled(prefs, tpl.category)) return { ok: true, skipped: 'category_off' };

  // 2. Dedup
  if (await recentlySent(tpl.dedup_key)) {
    return { ok: true, skipped: 'recently_sent' };
  }

  // 3. Quiet hours (RK-5/M-21). Runner-local clock via profile.timezone,
  // same resolution the cron scheduler uses. Window comes from
  // notification_prefs (migration 121, default 22:00 → 06:00). Templates
  // that must wake the runner (race_day, deck §A) carry
  // bypass_quiet_hours = true and sail through. The drain loop leaves a
  // quiet_hours-skipped pending row UNPROCESSED so it delivers at the
  // first tick after quiet hours end — this is a defer, not a drop.
  if (!tpl.bypass_quiet_hours) {
    const tz = await runnerTimezone(userId).catch(() => 'UTC');
    if (isInQuietHours(new Date(), tz, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
      return { ok: true, skipped: 'quiet_hours' };
    }
  }

  // 4. Tokens
  const tokens = await activeDeviceTokens(userId);
  if (tokens.length === 0) return { ok: true, skipped: 'no_tokens' };

  // 5. Cert / key sanity
  if (!apnsIsConfigured()) {
    // Log a row so a deck-style audit surfaces "tried, no creds" — but
    // don't crash. The scheduler keeps polling until env arrives.
    await pool.query(
      `INSERT INTO notifications_log (user_id, user_uuid, category, payload, dedup_key, delivered)
       VALUES ($1, $1, $2, $3::jsonb, $4, false)`,
      [userId, tpl.category, JSON.stringify({ skipped: 'apns_not_configured', tpl }), tpl.dedup_key],
    ).catch(() => {});
    return { ok: true, skipped: 'apns_not_configured' };
  }

  // 6. Per-token send
  const log_ids: number[] = [];
  let sent = 0;
  let failed = 0;
  let failure: DispatchResult['failure'];
  for (const tok of tokens) {
    if (tok.platform !== 'ios') continue; // v1 ships iOS only
    const args: SendPushArgs = {
      device_token: tok.device_token,
      category: tpl.category,
      title: tpl.title,
      body: tpl.body,
      interruption_level: tpl.interruption_level,
      thread_id: tpl.thread_id,
      action_buttons: tpl.action_buttons,
      // 2026-07-06 · audit P1-25 · sick check emits FAFF_SICK instead of
      // the bucket's FAFF_NIGGLE so RECOVERED can register on iOS.
      apns_category_id: tpl.apns_category_id,
      data: tpl.data,
      // 2026-07-06 · audit P1-25 · dedup_key rides in the faff dict.
      // NotificationsAppDelegate reads faff.dedup_key; the ack endpoint
      // routes sick-vs-niggle on its prefix and stamps ack_action by it.
      dedup_key: tpl.dedup_key,
      bypass_quiet_hours: tpl.bypass_quiet_hours,
    };

    // Pre-log row.
    let logId: number | null = null;
    try {
      const r = await pool.query(
        `INSERT INTO notifications_log (user_id, user_uuid, category, payload, dedup_key, delivered)
         VALUES ($1, $1, $2, $3::jsonb, $4, null) RETURNING id`,
        [userId, tpl.category, JSON.stringify(stripDeviceToken(args)), tpl.dedup_key],
      );
      logId = Number(r.rows[0].id);
      log_ids.push(logId);
    } catch (err) {
      console.error('[dispatch] pre-log insert failed:', (err as Error).message);
    }

    // P1-25 · echo the log row id into faff.notification_id so the ack
    // POST can stamp ack_action/ack_at by primary key. Set after the
    // pre-log insert (the id doesn't exist earlier); the persisted
    // payload row therefore doesn't carry it — by design, it IS the row.
    if (logId != null) args.notification_id = logId;

    const result = await sendPush(args);
    if (result.ok) {
      sent++;
      if (logId != null) {
        await pool.query(
          `UPDATE notifications_log SET apns_id = $1, delivered = true WHERE id = $2`,
          [result.apns_id, logId],
        ).catch(() => {});
      }
    } else {
      failed++;
      if (logId != null) {
        // RK-6: persist the APNs host alongside the failure so a 400
        // BadDeviceToken is diagnosable as a host/token-environment
        // mismatch straight from notifications_log.
        await pool.query(
          `UPDATE notifications_log SET delivered = false,
                                        payload  = payload || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify({ error: { reason: result.reason, status: result.status, detail: result.detail, host: result.host } }), logId],
        ).catch(() => {});
      }
      // Classify for the drain loop's retry policy (M-21). Permanent =
      // APNs said this will never work: 400 BadDeviceToken, 403 auth,
      // 410 Gone. Everything else (network, timeout, 429, 5xx,
      // apns_not_configured mid-loop) is worth retrying.
      const permanent =
        result.reason === 'apns_rejected' &&
        (result.status === 400 || result.status === 403 || result.status === 410);
      if (!failure || (failure.permanent && !permanent)) {
        failure = { reason: result.reason, status: result.status, detail: result.detail, permanent };
      }
      // APNs 410 Gone → revoke the device token so future sends skip it.
      if (result.reason === 'apns_rejected' && result.status === 410) {
        await pool.query(
          `UPDATE device_tokens SET revoked_at = now() WHERE device_token = $1`,
          [tok.device_token],
        ).catch(() => {});
      }
    }
  }

  return { ok: true, sent_count: sent, failed_count: failed, log_ids, failure };
}

/** Strip the raw device_token from the SendPushArgs before persisting to
 *  notifications_log — minor PII hygiene (the token isn't a secret per se
 *  but it's per-device and best not to splatter through logs). */
function stripDeviceToken(args: SendPushArgs): Record<string, unknown> {
  const { device_token: _omit, ...rest } = args;
  return rest;
}

export type { NotificationCategory };
