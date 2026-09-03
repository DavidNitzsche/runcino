/**
 * middleware.ts · the only enforcement point for the endpoint half of the
 * production write barrier.
 *
 * It exists here, and not inside `requireUserId` or a per-route helper, for one
 * reason: a route that has not been written yet is covered. The incident came
 * through `/api/ingest/workout`; the next one would come through whichever
 * endpoint the next agent adds, and a barrier you have to remember to call is
 * the same convention that already failed once.
 *
 * The decision lives in `lib/verify/client-attestation.ts` — one owner, per the
 * Brain Constitution. This file is the adapter, and it is deliberately tiny and
 * dependency-free: it runs on the edge runtime in front of every `/api/*`
 * request the app serves, so anything it drags in it drags into that path.
 *
 * WHAT IT REFUSES: a mutating request carrying a verification stamp, unless the
 * server can prove it is not pointed at production. Nothing else. An unstamped
 * request — the runner's phone, the watch, a cron, Strava's webhook — is not
 * examined beyond one header read and passes straight through.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  judgeRequest,
  refusalBody,
  CLIENT_ENV_HEADER,
  VERIFICATION_HEADER,
} from '@/lib/verify/client-attestation';

export function middleware(req: NextRequest) {
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
        `[write-barrier/http] REFUSED ${req.method} ${req.nextUrl.pathname} · ${verdict.stamp} · ${verdict.reason}`,
      );
      return NextResponse.json(refusalBody(verdict), {
        status: 403,
        headers: { 'x-faff-write-barrier': 'refused' },
      });
    }

    if (verdict.client === 'verification') {
      // Allowed, but never silent: a verification client touching production at
      // all is worth a line, and the auth exemption in particular is a judgement
      // call that should be visible in the logs rather than only in a comment.
      console.warn(
        `[write-barrier/http] allowed ${req.method} ${req.nextUrl.pathname} from a verification client · ${verdict.reason}`,
      );
    }
    return NextResponse.next();
  } catch (e) {
    // The classifier is pure string work and should not throw. If it somehow
    // does, failing the whole API closed would take the app down for the
    // runner, which is a worse outcome than the one this file prevents. So the
    // fallback narrows to the only case that matters: a request that literally
    // carries a stamp is still refused; everything else proceeds.
    const stamped = req.headers.get(CLIENT_ENV_HEADER) || req.headers.get(VERIFICATION_HEADER);
    console.error('[write-barrier/http] classifier threw · falling back to stamp-only refusal:', e);
    if (stamped && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      return NextResponse.json(
        { error: 'Refused · verification client', detail: 'barrier classifier failed; refusing a stamped mutation rather than guessing' },
        { status: 403, headers: { 'x-faff-write-barrier': 'refused-fallback' } },
      );
    }
    return NextResponse.next();
  }
}

export const config = {
  // API surface only. Pages, static assets and images never reach this.
  matcher: ['/api/:path*'],
};
