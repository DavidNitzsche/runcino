/**
 * P37 — error reporting hook (Sentry-style, no SDK dependency).
 *
 * `reportError(err, context)` is a thin wrapper that:
 *   1. Always logs to console.error (already what Next.js does).
 *   2. Writes to ops_alerts table (alert pipeline).
 *   3. Posts to OPS_SENTRY_DSN if set — uses Sentry's wire format so any
 *      Sentry-compatible ingest can receive it without a Sentry SDK.
 *
 * Setting up Sentry:
 *   1. Create a Sentry project (or any compatible endpoint).
 *   2. Set OPS_SENTRY_DSN env var to the project's DSN URL.
 *   3. Done. No npm install required — we POST raw JSON to /api/N/store/.
 *
 * For deeper traces (stack traces, source maps), install @sentry/nextjs
 * properly. This minimal path is for "the deploy fail-loud" tier.
 */
import { raiseAlert, type AlertSeverity } from './alerts';

interface ReportContext {
  endpoint?: string;
  user_id?: string;
  metadata?: Record<string, any>;
  severity?: AlertSeverity;
}

export async function reportError(err: unknown, ctx?: ReportContext): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  const message = e.message || 'unknown error';
  const stack = e.stack ?? '';

  // 1. Always log
  console.error('[ops/error]', ctx?.endpoint ?? '', message, ctx?.metadata ?? '');

  // 2. ops_alerts (db)
  await raiseAlert({
    kind: 'crash',
    severity: ctx?.severity ?? 'error',
    message: `${ctx?.endpoint ?? 'unknown'}: ${message}`,
    metadata: { stack: stack.slice(0, 1500), ...ctx?.metadata },
    source: ctx?.endpoint,
  }).catch(() => {});

  // 3. Sentry DSN (optional)
  const dsn = process.env.OPS_SENTRY_DSN;
  if (!dsn) return;
  try {
    const parsed = parseDsn(dsn);
    if (!parsed) return;
    const eventId = randomEventId();
    const body = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: 'node',
      level: ctx?.severity ?? 'error',
      message: { formatted: message },
      exception: {
        values: [{
          type: e.name || 'Error',
          value: message,
          stacktrace: { frames: parseStack(stack) },
        }],
      },
      tags: {
        endpoint: ctx?.endpoint ?? 'unknown',
        ...(ctx?.user_id ? { user_id: ctx.user_id } : {}),
      },
      extra: ctx?.metadata ?? {},
    };
    await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7,sentry_client=faff-minimal/1.0,sentry_key=${parsed.publicKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    /* swallow — error reporting can't error itself */
  }
}

interface DSN { endpoint: string; publicKey: string }

function parseDsn(dsn: string): DSN | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.slice(1);
    const publicKey = u.username;
    const endpoint = `${u.protocol}//${u.host}/api/${projectId}/store/`;
    return { endpoint, publicKey };
  } catch { return null; }
}

function randomEventId(): string {
  // 32-hex Sentry event ID
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

function parseStack(stack: string): Array<{ function: string; filename: string; lineno: number }> {
  const lines = stack.split('\n').slice(1, 15);
  return lines.map((l) => {
    const m = l.match(/at (.+?) \((.+?):(\d+):(\d+)\)/) || l.match(/at (.+?):(\d+):(\d+)/);
    if (!m) return { function: '<anon>', filename: '<unknown>', lineno: 0 };
    if (m.length === 5) return { function: m[1], filename: m[2], lineno: Number(m[3]) };
    return { function: '<anon>', filename: m[1], lineno: Number(m[2]) };
  });
}
