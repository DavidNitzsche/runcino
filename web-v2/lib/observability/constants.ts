/**
 * lib/observability/constants.ts · edge-safe primitives.
 *
 * `middleware.ts` runs in the Edge runtime (see its own header — "dependency-
 * free: it runs on the edge runtime in front of every `/api/*` request").
 * Edge runtime has no `node:async_hooks`, so the AsyncLocalStorage-based
 * request context (`lib/observability/context.ts`) lives in a SEPARATE file
 * that only Node-runtime code (route handlers, `instrumentation.ts`'s
 * `register()`/`onRequestError`) ever imports. This file holds the parts
 * both runtimes need — the header name and the id generator, both of which
 * use only Web-standard APIs (`crypto.randomUUID()`) available in both.
 *
 * Naming follows the existing `x-faff-*` convention set by
 * `lib/verify/client-attestation.ts` (`CLIENT_ENV_HEADER`,
 * `VERIFICATION_HEADER`).
 */

/** Carries the correlation id, both as an incoming request header (set by a
 *  client that pre-generates one, or by `middleware.ts` if absent) and as an
 *  outgoing response header (so Railway logs / curl / the client's own
 *  telemetry can cross-reference a specific request). */
export const CORRELATION_ID_HEADER = 'x-faff-correlation-id';

/** A route that catches its own error and returns an explicit 5xx JSON body
 *  (rather than throwing) can set this response header to tell
 *  `withObservability` which failure class applies, instead of falling back
 *  to the APPLICATION default. Optional — most routes don't need it. */
export const FAILURE_CLASS_HEADER = 'x-faff-failure-class';

/** RFC 4122 v4 UUID via the Web Crypto API — available in both the Edge and
 *  Node runtimes, so this function is safe to call from `middleware.ts`. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/** Reads an already-set correlation id off a `Headers`-like object, trimmed
 *  and length-capped. Returns null if absent or empty, never throws. */
export function correlationIdFromHeaders(
  headers: { get(name: string): string | null } | null | undefined,
): string | null {
  try {
    const v = headers?.get(CORRELATION_ID_HEADER);
    const trimmed = v?.trim();
    // `trimmed` is a string, so an empty string is already falsy here — the
    // `.length > 0` half of the old `trimmed && trimmed.length > 0` guard was
    // redundant with the truthiness check, and its exact shape (`X.length > 0
    // ? f(X) : null`) is the pattern COERCION-1 flags as a possible measured-
    // zero erasure. There is no zero being erased here (a correlation id has
    // no length-0 case worth distinguishing from absent), but the guard is
    // simplified to its true logic rather than argued in the registry.
    return trimmed ? trimmed.slice(0, 128) : null;
  } catch {
    return null;
  }
}
