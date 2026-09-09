/**
 * lib/observability/with-observability.ts · opt-in per-route wrapper.
 *
 * `instrumentation.ts`'s `onRequestError` (Next.js's own global hook) already
 * catches every UNHANDLED exception thrown out of any route handler, app-
 * wide, with zero per-route changes — that is the PRIMARY mechanism this
 * change relies on, precisely so 154 existing route files do not each need
 * editing (CLAUDE.md's bounded, non-destructive instruction). This wrapper
 * is the SECONDARY, opt-in mechanism for what `onRequestError` structurally
 * cannot see:
 *
 *   1. A route that catches its own error internally and returns an
 *      explicit `NextResponse.json({...}, {status: 500})` WITHOUT rethrowing
 *      — no exception ever escapes the handler, so `onRequestError` never
 *      fires. Many routes in this codebase follow exactly that pattern.
 *   2. CLIENT_TIMEOUT — the one failure class that is observed directly
 *      (the incoming request's own abort signal firing) rather than
 *      inferred from a caught error, and `onRequestError` has no hook for
 *      "the client disconnected before anything threw."
 *
 * Wrap a route handler that wants either of these:
 *
 *   export const GET = withObservability('/api/today', async (req) => { ... });
 *
 * NOTE ON CLIENT_TIMEOUT DETECTION: Next.js Route Handlers expose
 * `request.signal`, which the framework aborts when the underlying
 * connection is dropped before a response is sent (documented Next.js
 * behaviour, used by the framework's own streaming-response cancellation).
 * This wrapper listens for that. What is NOT independently verified here
 * (out of this change's bounded scope — it would need a live server and a
 * real client dropping a real TCP connection mid-request) is that Railway's
 * specific proxy/runtime configuration propagates the abort all the way
 * through; the falsification test instead proves that WHEN the signal
 * fires, this wrapper correctly classifies and records it — the part of the
 * mechanism actually under this code's control. Say so plainly rather than
 * claim a guarantee this test cannot back up (Rule 13).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { CORRELATION_ID_HEADER, FAILURE_CLASS_HEADER, correlationIdFromHeaders, newCorrelationId } from './constants';
import { runWithRequestContext } from './context';
import { classifyFailure } from './classify';
import { recordRequestFailure } from './record';
import type { FailureClass } from './types';

type RouteHandler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

function isKnownFailureClass(v: string | null): v is FailureClass {
  return v === 'EDGE' || v === 'APPLICATION' || v === 'DATABASE_POOL' || v === 'UPSTREAM' || v === 'CLIENT_TIMEOUT' || v === 'UNKNOWN';
}

export function withObservability<C = unknown>(
  routeName: string,
  handler: RouteHandler<C>,
): RouteHandler<C> {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const correlationId = correlationIdFromHeaders(req.headers) ?? newCorrelationId();
    const startedAt = Date.now();
    const routePath = routeName || req.nextUrl?.pathname || 'unknown';

    let clientAborted = false;
    const signal = (req as unknown as { signal?: AbortSignal }).signal;
    const onAbort = () => { clientAborted = true; };
    signal?.addEventListener?.('abort', onAbort);

    try {
      const res = await runWithRequestContext(
        { correlationId, routePath, method: req.method, startedAt },
        () => handler(req, ctx),
      );
      const durationMs = Date.now() - startedAt;

      if (res.status >= 500) {
        const explicit = res.headers.get(FAILURE_CLASS_HEADER);
        await recordRequestFailure({
          correlationId,
          routePath,
          httpMethod: req.method,
          failureClass: isKnownFailureClass(explicit) ? explicit : 'APPLICATION',
          httpStatus: res.status,
          durationMs,
          error: `handler returned ${res.status} without throwing`,
          source: 'lib/observability/with-observability (explicit 5xx response)',
        });
      }

      // Best-effort — some route handlers return a `NextResponse` whose
      // headers are already finalized for streaming; setting one more
      // header here is harmless when it succeeds and never fatal when it
      // can't, so this is wrapped defensively rather than allowed to throw.
      try { res.headers.set(CORRELATION_ID_HEADER, correlationId); } catch { /* ignore */ }
      return res;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const classified = classifyFailure(err, { clientAborted });
      await recordRequestFailure({
        correlationId,
        routePath,
        httpMethod: req.method,
        failureClass: classified.failureClass,
        httpStatus: null,
        durationMs,
        error: err,
        upstreamService: classified.upstreamService,
        metadata: { detail: classified.detail },
        source: 'lib/observability/with-observability (thrown)',
      });
      // Rethrow rather than swallow: `instrumentation.ts`'s onRequestError
      // and Next.js's own 500 response still need to happen. This wrapper
      // ADDS a record; it does not become a second, competing error
      // boundary (CLAUDE.md's "don't build a second, parallel error-
      // handling mechanism" instruction, honored on the failure path too).
      throw err;
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
    }
  };
}

/** For a route that wants NextResponse.json({...}, {status}) to carry an
 *  explicit failure class (rather than the APPLICATION default a bare 5xx
 *  gets) — e.g. a route that itself caught a DB error and wants that fact
 *  preserved through its own error-shaping response. */
export function withFailureClass(res: NextResponse, failureClass: FailureClass): NextResponse {
  res.headers.set(FAILURE_CLASS_HEADER, failureClass);
  return res;
}
