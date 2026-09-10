/**
 * middleware.ts · the only enforcement point for the endpoint half of the
 * production write barrier, AND (2026-09-09, bounded observability work for
 * the 502/~13s-timeout incident) the one place a correlation id is minted
 * for every `/api/*` request before anything else in the app runs.
 *
 * It exists here, and not inside `requireUserId` or a per-route helper, for one
 * reason: a route that has not been written yet is covered. The incident came
 * through `/api/ingest/workout`; the next one would come through whichever
 * endpoint the next agent adds, and a barrier you have to remember to call is
 * the same convention that already failed once. The same reasoning is why the
 * correlation id is minted here rather than inside `withObservability()`
 * (`lib/observability/with-observability.ts`): a route that never adopts that
 * wrapper still gets an id, and `instrumentation.ts`'s `onRequestError` (which
 * covers every route, wrapped or not) can read the SAME id off the request
 * headers rather than minting a second, disagreeing one (Rule 16 — one
 * quantity, one name).
 *
 * The decision lives in `lib/verify/client-attestation.ts` — one owner, per the
 * Brain Constitution. This file is the adapter, and it is deliberately tiny and
 * dependency-free: it runs on the edge runtime in front of every `/api/*`
 * request the app serves, so anything it drags in it drags into that path.
 * `lib/observability/constants.ts` is the same kind of file — edge-safe, no
 * `node:async_hooks` — for exactly that reason.
 *
 * WHAT IT REFUSES: a mutating request carrying a verification stamp, unless the
 * server can prove it is not pointed at production. Nothing else. An unstamped
 * request — the runner's phone, the watch, a cron, Strava's webhook — is not
 * examined beyond one header read and passes straight through.
 *
 * CORRELATION ID: reused from an `x-faff-correlation-id` request header if the
 * CLIENT already set one, minted fresh otherwise. Reusing rather than always
 * minting matters for the one failure class this app can never observe from
 * the inside — EDGE (the request never reaches this file at all, by
 * definition) — see `lib/observability/record.ts`'s header: the only way to
 * recognize that gap later is a client self-report carrying the SAME id the
 * client generated before the request left the device. Set on both the
 * forwarded REQUEST headers (so the route handler and `onRequestError` can
 * read it) and the RESPONSE headers (so Railway logs / curl / the client's
 * own telemetry can cross-reference this exact request).
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  judgeRequest,
  refusalBody,
  CLIENT_ENV_HEADER,
  VERIFICATION_HEADER,
} from '@/lib/verify/client-attestation';
import { CORRELATION_ID_HEADER, correlationIdFromHeaders, newCorrelationId } from '@/lib/observability/constants';

/** Clones the incoming headers with the correlation id set, for use as the
 *  `request.headers` of a `NextResponse.next()`/`NextResponse.json()` reply —
 *  this is how a middleware adds a header the DOWNSTREAM route handler will
 *  see (setting only the outgoing response's headers would not). */
function withCorrelationRequestHeaders(req: NextRequest, correlationId: string): Headers {
  const headers = new Headers(req.headers);
  headers.set(CORRELATION_ID_HEADER, correlationId);
  return headers;
}

export function middleware(req: NextRequest) {
  const correlationId = correlationIdFromHeaders(req.headers) ?? newCorrelationId();
  const requestHeaders = withCorrelationRequestHeaders(req, correlationId);

  try {
    const verdict = judgeRequest({
      method: req.method,
      pathname: req.nextUrl.pathname,
      header: (n) => req.headers.get(n),
    });

    if (verdict.refuse) {
      // Loud and logged. This line is the one a person greps for after asking
      // "why did nothing land"; it must name the client, the target and the path.
      console.error(
        `[write-barrier/http] REFUSED ${req.method} ${req.nextUrl.pathname} · ${verdict.stamp} · ${verdict.reason} · correlation=${correlationId}`,
      );
      const res = NextResponse.json(refusalBody(verdict), {
        status: 403,
        headers: { 'x-faff-write-barrier': 'refused' },
      });
      res.headers.set(CORRELATION_ID_HEADER, correlationId);
      return res;
    }

    if (verdict.client === 'verification') {
      // Allowed, but never silent: a verification client touching production at
      // all is worth a line, and the auth exemption in particular is a judgement
      // call that should be visible in the logs rather than only in a comment.
      console.warn(
        `[write-barrier/http] allowed ${req.method} ${req.nextUrl.pathname} from a verification client · ${verdict.reason}`,
      );
    }
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set(CORRELATION_ID_HEADER, correlationId);
    return res;
  } catch (e) {
    // The classifier is pure string work and should not throw. If it somehow
    // does, failing the whole API closed would take the app down for the
    // runner, which is a worse outcome than the one this file prevents. So the
    // fallback narrows to the only case that matters: a request that literally
    // carries a stamp is still refused; everything else proceeds.
    const stamped = req.headers.get(CLIENT_ENV_HEADER) || req.headers.get(VERIFICATION_HEADER);
    console.error('[write-barrier/http] classifier threw · falling back to stamp-only refusal:', e);
    if (stamped && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const res = NextResponse.json(
        { error: 'Refused · verification client', detail: 'barrier classifier failed; refusing a stamped mutation rather than guessing' },
        { status: 403, headers: { 'x-faff-write-barrier': 'refused-fallback' } },
      );
      res.headers.set(CORRELATION_ID_HEADER, correlationId);
      return res;
    }
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set(CORRELATION_ID_HEADER, correlationId);
    return res;
  }
}

export const config = {
  // API surface only. Pages, static assets and images never reach this.
  matcher: ['/api/:path*'],
};
