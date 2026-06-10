/**
 * P37 — ops alerting.
 *
 * Append-only log of failures (cron / regen / ASC / crash) + a webhook
 * dispatcher (Slack / Discord / generic) controlled by env vars.
 *
 *   OPS_SLACK_WEBHOOK_URL     — optional, posts JSON to Slack/Discord shape
 *   OPS_ALERTS_DISABLED       — set to "1" to silence dispatch entirely
 *
 * Always writes to `ops_alerts` first; webhook is best-effort second.
 */
import { pool } from '@/lib/db/pool';

export type AlertKind = 'cron_fail' | 'regen_fail' | 'asc_stall' | 'crash' | 'briefing_failure' | 'webhook_failure' | 'dedup_flag_census' | 'unknown';
export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface RaiseAlertInput {
  kind: AlertKind;
  message: string;
  severity?: AlertSeverity;
  metadata?: Record<string, any>;
  source?: string;
}

export async function raiseAlert(input: RaiseAlertInput): Promise<void> {
  const severity = input.severity ?? 'warn';
  try {
    await pool.query(
      `INSERT INTO ops_alerts (kind, severity, message, metadata, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.kind, severity, input.message, input.metadata ? JSON.stringify(input.metadata) : null, input.source ?? null],
    );
  } catch (e: any) {
    console.error('[ops/alerts] insert failed (ops_alerts table missing?):', e?.message);
  }

  if (process.env.OPS_ALERTS_DISABLED === '1') return;
  const url = process.env.OPS_SLACK_WEBHOOK_URL;
  if (!url) return;

  try {
    const emoji = severity === 'critical' ? ':rotating_light:'
                : severity === 'error'    ? ':x:'
                : severity === 'warn'     ? ':warning:'
                : ':information_source:';
    const payload = {
      text: `${emoji} *${input.kind}* (${severity}) — ${input.message}` +
            (input.source ? `\nsource: \`${input.source}\`` : '') +
            (input.metadata ? `\n\`\`\`${JSON.stringify(input.metadata, null, 2).slice(0, 1500)}\`\`\`` : ''),
    };
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e: any) {
    console.error('[ops/alerts] webhook dispatch failed:', e?.message);
  }
}

/** Get recent unacked alerts (for an admin dashboard or daily digest). */
export async function recentUnackedAlerts(limit = 50): Promise<Array<{
  id: number; kind: string; severity: string; message: string;
  metadata: any; source: string | null; created_at: string;
}>> {
  const r = (await pool.query(
    `SELECT id, kind, severity, message, metadata, source, created_at::text
       FROM ops_alerts
      WHERE acked_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  )).rows;
  return r;
}
