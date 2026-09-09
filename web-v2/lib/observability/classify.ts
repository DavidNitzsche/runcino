/**
 * lib/observability/classify.ts · turns a thrown value into one of the five
 * failure classes David named, plus UNKNOWN.
 *
 * Two tiers, checked in order, because a KNOWN fact must never be
 * downgraded to a GUESSED one (Rule 11):
 *
 *   1. EXPLICIT TAG. A call site that knows exactly what kind of failure it
 *      just caught (`fetchUpstream`, `observedQuery`) attaches a tag before
 *      rethrowing (`tagUpstreamError` / `tagDatabaseError`). This is the
 *      strong signal and always wins.
 *   2. HEURISTIC. No tag present — inspect the error's shape. Postgres wire-
 *      protocol errors carry a 5-character SQLSTATE `.code`
 *      (https://www.postgresql.org/docs/current/errcodes-appendix.html);
 *      `pg-pool`'s own checkout-timeout and idle-client-death errors carry
 *      no `.code` but a fixed, grep-able message text; Node's `fetch`
 *      (undici) throws `TypeError: fetch failed` with a `.cause`; an
 *      `AbortError` from `AbortSignal.timeout(...)` is, in this codebase,
 *      only ever used to bound an OUTBOUND fetch (`lib/ops/sentry.ts`,
 *      `lib/ops/alerts.ts`, `instrumentation.ts`'s cron tick) — never to
 *      bound inbound request handling — so an untagged AbortError defaults
 *      to UPSTREAM rather than CLIENT_TIMEOUT, which is reserved for the
 *      INCOMING request's own `NextRequest.signal` firing (passed in
 *      explicitly as `opts.clientAborted` by `with-observability.ts`,
 *      because that is observed directly and never needs a guess).
 *
 * WHAT THIS CANNOT DO (Rule 18's header discipline): it cannot see a true
 * EDGE failure at all — by definition nothing in this process runs when the
 * request never arrived. EDGE rows are written a different way entirely (a
 * client self-report, or an operator annotation); `classify()` never
 * returns 'EDGE' and no caller should expect it to.
 *
 * When neither tier recognizes the shape, the default is APPLICATION, not
 * UNKNOWN — an ordinary thrown `Error` with no DB/upstream signature really
 * is, most honestly, "this happened in application code", and that is a
 * substantive claim, not a shrug. UNKNOWN is reserved for the case where
 * classification itself cannot proceed (the caught value isn't an
 * Error-like object at all, or the classifier's own logic throws) — a
 * DIFFERENT fact from "we determined APPLICATION", never conflated with it.
 */
import type { ClassifiedFailure, FailureClass } from './types';

const FAFF_TAG = Symbol.for('faff.observability.failureTag');

interface FailureTag {
  failureClass: FailureClass;
  upstreamService?: string;
}

function readTag(err: unknown): FailureTag | undefined {
  if (err && typeof err === 'object' && FAFF_TAG in err) {
    return (err as Record<symbol, FailureTag>)[FAFF_TAG];
  }
  return undefined;
}

/** Explicitly mark a caught error as an UPSTREAM failure before rethrowing.
 *  Used by `fetchUpstream()`; also safe to call directly from a route that
 *  makes an outbound call some other way. Mutates and returns the same
 *  error so it can be used inline in a `catch` block. */
export function tagUpstreamError<E>(err: E, serviceName: string): E {
  if (err && typeof err === 'object') {
    (err as Record<symbol, FailureTag>)[FAFF_TAG] = { failureClass: 'UPSTREAM', upstreamService: serviceName };
  }
  return err;
}

/** Explicitly mark a caught error as a DATABASE_POOL failure before
 *  rethrowing. Used by `observedQuery()`. */
export function tagDatabaseError<E>(err: E): E {
  if (err && typeof err === 'object') {
    (err as Record<symbol, FailureTag>)[FAFF_TAG] = { failureClass: 'DATABASE_POOL' };
  }
  return err;
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/** SQLSTATE class 08 (connection exception), 53 (insufficient resources —
 *  includes 53300 too_many_connections, the literal shape of pool
 *  exhaustion reaching the database itself), 57 (operator intervention —
 *  includes 57014 query_canceled from `statement_timeout` and 57P01/57P02/
 *  57P03 admin/crash shutdown). See postgres.org/docs/current/errcodes-
 *  appendix.html. This is a class-prefix check, not an exhaustive list, so
 *  a SQLSTATE this project has never seen still classifies correctly. */
function isPostgresConnectionOrResourceCode(code: string): boolean {
  const cls = code.slice(0, 2);
  return cls === '08' || cls === '53' || cls === '57';
}

/** `pg-pool`'s own fixed message strings for the two failure shapes that
 *  never carry a SQLSTATE because they happen before/around the wire
 *  protocol: checkout timeout (`connectionTimeoutMillis`, see
 *  `lib/db/pool.ts`) and an idle client's backend dying underneath it. */
const PG_POOL_MESSAGE_PATTERNS = [
  /timeout exceeded when trying to connect/i,
  /connection terminated due to connection timeout/i,
  /connection terminated unexpectedly/i,
  /client has already been released/i,
  /pool is draining/i,
  /remaining connection slots are reserved/i,
];

function looksLikePostgresPoolMessage(message: string): boolean {
  return PG_POOL_MESSAGE_PATTERNS.some((p) => p.test(message));
}

/** Maps a CLIENT's own self-report kind (see
 *  `app/api/observability/client-report/route.ts`) to a failure class. Pulled
 *  out as its own pure function so it is unit-testable without constructing a
 *  fake `NextRequest` — the EDGE class specifically can ONLY ever be produced
 *  through this path, never through `classifyFailure()` above, because a true
 *  EDGE failure means nothing server-side ever ran to call it. */
export function classifyClientReportKind(kind: 'no_response' | 'network_error' | 'client_gave_up'): FailureClass {
  return kind === 'client_gave_up' ? 'CLIENT_TIMEOUT' : 'EDGE';
}

export function classifyFailure(
  err: unknown,
  opts?: { clientAborted?: boolean },
): ClassifiedFailure {
  try {
    // The incoming request's OWN signal firing is observed directly by
    // `with-observability.ts`, never guessed — it always wins when present.
    if (opts?.clientAborted) {
      return { failureClass: 'CLIENT_TIMEOUT', detail: 'NextRequest.signal aborted before the handler returned' };
    }

    const tag = readTag(err);
    if (tag) {
      return {
        failureClass: tag.failureClass,
        detail: `explicitly tagged ${tag.failureClass.toLowerCase()} at the call site that caught it`,
        upstreamService: tag.upstreamService,
      };
    }

    if (!(err && typeof err === 'object')) {
      return { failureClass: 'UNKNOWN', detail: `caught value is not an Error-like object (typeof ${typeof err})` };
    }

    const anyErr = err as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof anyErr.code === 'string' ? anyErr.code : undefined;
    const message = typeof anyErr.message === 'string' ? anyErr.message : '';
    const name = typeof anyErr.name === 'string' ? anyErr.name : '';

    if (code && SQLSTATE_PATTERN.test(code) && isPostgresConnectionOrResourceCode(code)) {
      return { failureClass: 'DATABASE_POOL', detail: `Postgres SQLSTATE ${code} (connection/resource/operator-intervention class)` };
    }
    if (looksLikePostgresPoolMessage(message)) {
      return { failureClass: 'DATABASE_POOL', detail: 'matched a known pg-pool checkout/idle-death message' };
    }
    // A raw TCP-level connect failure with no SQLSTATE at all could be either
    // the DB or an upstream host; without a tag we cannot tell which service
    // it was aimed at, so this is deliberately the one branch that returns
    // UNKNOWN rather than guessing — Rule 11 forbids collapsing "don't know
    // which" into either specific bucket.
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
      return { failureClass: 'UNKNOWN', detail: `low-level network error (${code}) with no tag identifying DB vs upstream target` };
    }
    if (/fetch failed/i.test(message) || name === 'AbortError') {
      return { failureClass: 'UPSTREAM', detail: name === 'AbortError' ? 'untagged AbortError — only used to bound outbound fetches in this codebase' : 'undici "fetch failed" with no tag; defaulting to the only known fetch caller shape' };
    }

    return { failureClass: 'APPLICATION', detail: 'ordinary thrown error with no recognized DB/upstream/timeout signature' };
  } catch (classifierError) {
    // The classifier itself must never be the thing that takes the request
    // down (Rule 18). If it throws, that is a genuinely different fact from
    // any of the above — say so.
    return { failureClass: 'UNKNOWN', detail: `classifier threw: ${classifierError instanceof Error ? classifierError.message : String(classifierError)}` };
  }
}
