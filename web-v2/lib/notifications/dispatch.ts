/**
 * Dispatcher — glue between templates, prefs, device_tokens, sender, log.
 *
 * One call: `dispatchNotification(userId, rendered)`. Handles:
 *   1. Pref check (master + per-category)
 *   2. Recent-dedup (any same dedup_key sent in prior 24h → drop)
 *   3. Resolve all active device_tokens for the user
 *   4. Pre-log row insert (delivered = null)
 *   5. Per-token sendPush
 *   6. Update log row with apns_id + delivered flag
 *   7. On APNs 410 Gone → revoke the device_token row
 *
 * The caller (cron / event-trigger / event-bus writer) does NOT touch the
 * sender directly. Always go through dispatch.
 *
 * Source spec: docs/2026-05-28-notifications.html (esp. §5 dedup gate).
 */

import { pool } from '@/lib/db/pool';
import { sendPush, type SendPushArgs, apnsIsConfigured, type NotificationCategory } from './apns';
import { loadNotificationPrefs, categoryEnabled } from './prefs';
import type { RenderedTemplate } from './templates';

export interface DispatchResult {
  ok: boolean;
  skipped?: 'master_off' | 'category_off' | 'no_tokens' | 'apns_not_configured' | 'recently_sent';
  sent_count?: number;
  failed_count?: number;
  log_ids?: number[];
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
        WHERE user_id = $1 AND revoked_at IS NULL`,
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

  // 3. Tokens
  const tokens = await activeDeviceTokens(userId);
  if (tokens.length === 0) return { ok: true, skipped: 'no_tokens' };

  // 4. Cert / key sanity
  if (!apnsIsConfigured()) {
    // Log a row so a deck-style audit surfaces "tried, no creds" — but
    // don't crash. The scheduler keeps polling until env arrives.
    await pool.query(
      `INSERT INTO notifications_log (user_id, category, payload, dedup_key, delivered)
       VALUES ($1, $2, $3::jsonb, $4, false)`,
      [userId, tpl.category, JSON.stringify({ skipped: 'apns_not_configured', tpl }), tpl.dedup_key],
    ).catch(() => {});
    return { ok: true, skipped: 'apns_not_configured' };
  }

  // 5. Per-token send
  const log_ids: number[] = [];
  let sent = 0;
  let failed = 0;
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
      data: tpl.data,
      bypass_quiet_hours: tpl.bypass_quiet_hours,
    };

    // Pre-log row.
    let logId: number | null = null;
    try {
      const r = await pool.query(
        `INSERT INTO notifications_log (user_id, category, payload, dedup_key, delivered)
         VALUES ($1, $2, $3::jsonb, $4, null) RETURNING id`,
        [userId, tpl.category, JSON.stringify(stripDeviceToken(args)), tpl.dedup_key],
      );
      logId = Number(r.rows[0].id);
      log_ids.push(logId);
    } catch (err) {
      console.error('[dispatch] pre-log insert failed:', (err as Error).message);
    }

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
        await pool.query(
          `UPDATE notifications_log SET delivered = false,
                                        payload  = payload || $1::jsonb
            WHERE id = $2`,
          [JSON.stringify({ error: { reason: result.reason, status: result.status, detail: result.detail } }), logId],
        ).catch(() => {});
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

  return { ok: true, sent_count: sent, failed_count: failed, log_ids };
}

/** Strip the raw device_token from the SendPushArgs before persisting to
 *  notifications_log — minor PII hygiene (the token isn't a secret per se
 *  but it's per-device and best not to splatter through logs). */
function stripDeviceToken(args: SendPushArgs): Record<string, unknown> {
  const { device_token: _omit, ...rest } = args;
  return rest;
}

export type { NotificationCategory };
