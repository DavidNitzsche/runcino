/**
 * POST /api/observability/client-report
 *
 * The ONLY way an EDGE failure — "something failed before the app even
 * received the request" (a proxy/load-balancer timeout, exactly the
 * previously-observed 502/~13-second-timeout incident's shape) — can ever
 * become a row in `request_failures`. By definition nothing server-side runs
 * for a request the edge swallowed, so the server can never write this row
 * from its own observation; only the CLIENT that made the failed call and
 * never got a response can report it, carrying the SAME correlation id it
 * generated (or received on a previous successful request to the same
 * session) before the call went out.
 *
 * `kind`:
 *   'no_response'   · the client's own request timed out waiting for any
 *                     bytes back (the ~13s-hang shape of the named incident).
 *                     Recorded as EDGE — the strongest available inference
 *                     when nothing else corroborates a server-side row for
 *                     this correlation id (see `serverRowsFound` below).
 *   'network_error' · a transport-level failure before any HTTP response
 *                     (DNS, TLS, connection reset). Also EDGE.
 *   'client_gave_up'· the client's OWN timeout/cancellation fired — the
 *                     client-side corroboration of CLIENT_TIMEOUT, useful if
 *                     the server-side abort-signal detection in
 *                     `with-observability.ts` missed it for any reason.
 *
 * This is an INFERENCE, stated as one, not a certainty this route
 * independently verifies (Rule 11 discipline, and Rule 13's "say what you
 * cannot confirm" — a route handler cannot see what happened at the load
 * balancer any more than the client can). `serverRowsFound` in the response
 * tells the caller (and anyone querying `request_failures` later) whether
 * ANY server-side row already exists for this correlation id — if one does,
 * the request reached the app and the EDGE label on THIS report is likely
 * wrong for the underlying event (the app failed some other, observed way,
 * and the client simply never received that response either); both rows are
 * kept, because "the client experienced no response" and "the server
 * recorded an application failure" are both true facts about the same
 * request and neither should overwrite the other.
 *
 * Rate/abuse note: gated behind a resolvable session where one exists, but
 * NOT hard-required — the whole point of this endpoint is capturing failures
 * from requests where session validation itself may be part of what broke.
 * An unauthenticated report is still recorded, with `user_uuid` left null.
 */
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db/pool';
import { userIdFromRequest } from '@/lib/auth/session';
import { recordRequestFailure } from '@/lib/observability/record';
import { classifyClientReportKind } from '@/lib/observability/classify';

export const dynamic = 'force-dynamic';

const VALID_KINDS = new Set(['no_response', 'network_error', 'client_gave_up']);

interface ClientReportBody {
  correlationId?: unknown;
  routePath?: unknown;
  httpMethod?: unknown;
  kind?: unknown;
  observedDurationMs?: unknown;
}

export async function POST(req: NextRequest) {
  let body: ClientReportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const correlationId = typeof body.correlationId === 'string' ? body.correlationId.trim().slice(0, 128) : '';
  const routePath = typeof body.routePath === 'string' ? body.routePath.trim().slice(0, 300) : '';
  const httpMethod = typeof body.httpMethod === 'string' ? body.httpMethod.trim().slice(0, 16) : 'UNKNOWN';
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const observedDurationMs = typeof body.observedDurationMs === 'number' && Number.isFinite(body.observedDurationMs)
    ? Math.round(body.observedDurationMs) : null;

  if (!correlationId || !routePath) {
    return NextResponse.json({ error: 'correlationId and routePath are required' }, { status: 400 });
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: `kind must be one of ${[...VALID_KINDS].join(', ')}` }, { status: 400 });
  }

  // Best-effort — a broken session must not stop this report from landing.
  // The handler names and references its error (rather than swallowing it
  // blind) precisely because this route's whole job is recording failures:
  // a session-resolution failure on the failure-reporting endpoint itself is
  // exactly the kind of thing worth a log line, not a silent null.
  const userUuid = await userIdFromRequest(req).catch((sessionErr) => {
    console.warn('[observability/client-report] session lookup failed; recording without user_uuid', sessionErr);
    return null;
  });

  const failureClass = classifyClientReportKind(kind as 'no_response' | 'network_error' | 'client_gave_up');

  let serverRowsFound = 0;
  try {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM request_failures WHERE correlation_id = $1`,
      [correlationId],
    );
    serverRowsFound = r.rows[0]?.n ?? 0;
  } catch {
    // request_failures may not exist yet (migration 170 unapplied) — the
    // report below still goes through record.ts, which has its own honest
    // fallback for that same case.
  }

  await recordRequestFailure({
    correlationId,
    routePath,
    httpMethod,
    failureClass,
    httpStatus: null,
    durationMs: observedDurationMs,
    error: `client-reported ${kind}`,
    userUuid,
    metadata: { detail: `client self-report (${kind}); ${serverRowsFound} server-side row(s) already exist for this correlation id`, serverRowsFound },
    source: 'app/api/observability/client-report',
    clientReported: true,
  });

  return NextResponse.json({ recorded: true, failureClass, serverRowsFound });
}
