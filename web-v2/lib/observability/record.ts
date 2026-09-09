/**
 * lib/observability/record.ts · the one writer of `request_failures`.
 *
 * Durable, not `console.error` — Railway's own log retention is the
 * documented gap this project already found ("no durable, queryable log of
 * 5xx/timeout events"). This is a straight INSERT via the shared `pool`
 * (`lib/db/pool.ts`), the same pattern `lib/ops/alerts.ts` already uses for
 * `ops_alerts`.
 *
 * DELIBERATELY DOES NOT CALL `raiseAlert()` (lib/ops/alerts.ts) per row.
 * `ops_alerts` dispatches to a Slack/Discord webhook on every write; this
 * table is written at REQUEST volume (every 5xx/timeout, not every event an
 * operator should be paged for), so wiring it in would be alert fatigue on
 * exactly the incident class this exists to make legible instead. The
 * `/api/admin/observability-summary` route is the intended way to review
 * this log during an incident. A future aggregate alert (e.g. "N failures of
 * one class in the last hour", Rule 23's staleness-alert shape) is a
 * reasonable follow-up and is named here rather than built, to keep this
 * change bounded to what David asked for.
 *
 * NEVER THROWS. Observability must not be the thing that takes a request
 * down (this is also Rule 18's point about `ops/sentry.ts`'s own header:
 * "error reporting can't error itself"). A failed insert — most likely
 * because migration 170 has not been applied yet — falls back to
 * `console.error` with enough shape to be recognized, but the whole reason
 * this module exists is that this fallback is NOT the durable story.
 */
import { pool } from '@/lib/db/pool';
import { sanitizeErrorMessage, sanitizeMetadata, sanitizeStack } from './sanitize';
import type { FailureClass } from './types';

export interface RequestFailureInput {
  correlationId: string;
  routePath: string;
  httpMethod: string;
  failureClass: FailureClass;
  /** null when no status was ever sent (EDGE, CLIENT_TIMEOUT). */
  httpStatus?: number | null;
  /** null when unknown/unmeasurable (e.g. an EDGE row from a client report). */
  durationMs?: number | null;
  /** The caught error (or a plain string). Sanitized before it is stored. */
  error?: unknown;
  /** Only meaningful when failureClass === 'UPSTREAM'. */
  upstreamService?: string;
  userUuid?: string | null;
  /** Small, flat, sanitized bag — see sanitize.ts. Never a raw payload. */
  metadata?: Record<string, unknown>;
  /** The code site that recorded this row, e.g.
   *  'instrumentation.onRequestError' or 'lib/observability/with-observability'. */
  source: string;
  /** True when this row was written from a client's own failure report
   *  rather than the server observing its own request. */
  clientReported?: boolean;
}

function errorMessageOf(error: unknown): string | null {
  if (error instanceof Error) return error.message || error.name || 'Error';
  if (typeof error === 'string') return error;
  if (error == null) return null;
  try { return String(error); } catch { return null; }
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export async function recordRequestFailure(input: RequestFailureInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO request_failures
        (correlation_id, route_path, http_method, failure_class, http_status, duration_ms,
         error_message, error_stack, upstream_service, user_uuid, metadata, source, client_reported)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        input.correlationId.slice(0, 128),
        input.routePath.slice(0, 300),
        input.httpMethod.slice(0, 16),
        input.failureClass,
        input.httpStatus ?? null,
        input.durationMs ?? null,
        sanitizeErrorMessage(errorMessageOf(input.error)),
        sanitizeStack(stackOf(input.error)),
        input.upstreamService?.slice(0, 100) ?? null,
        input.userUuid ?? null,
        JSON.stringify(sanitizeMetadata(input.metadata)),
        input.source.slice(0, 200),
        input.clientReported ?? false,
      ],
    );
  } catch (e: unknown) {
    // Best-effort console fallback. Not durable — see file header — but
    // better than silently swallowing the observation entirely, and it
    // names the most likely cause (migration 170 unapplied) so the gap is
    // recognizable rather than mysterious.
    console.error(
      '[observability] request_failures insert failed (migration 170 applied?):',
      e instanceof Error ? e.message : e,
      { correlationId: input.correlationId, routePath: input.routePath, failureClass: input.failureClass },
    );
  }
}
