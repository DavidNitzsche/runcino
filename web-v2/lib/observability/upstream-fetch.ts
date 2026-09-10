/**
 * lib/observability/upstream-fetch.ts · opt-in wrapper for outbound calls to
 * external services (Strava, Apple, weather, etc).
 *
 * A plain `fetch()` that throws (network error, DNS failure, our own
 * `AbortSignal.timeout`) is already classified as UPSTREAM by
 * `classify.ts`'s heuristic tier — but the heuristic cannot name WHICH
 * service failed. Routing a known upstream call through `fetchUpstream()`
 * instead tags the error explicitly (the strong-signal tier `classify.ts`
 * always prefers) and records the service name.
 *
 * BOUNDED SCOPE: this file is provided for any call site that wants it; it
 * has not been retrofitted across every existing outbound call in the repo
 * (Strava, weather, Apple) as part of this change — doing so would touch
 * many files well beyond the observability mechanism itself. Untagged
 * outbound-fetch failures still classify as UPSTREAM via the heuristic tier,
 * just without a service name. Named here, not silently left implied.
 */
import { tagUpstreamError } from './classify';

export async function fetchUpstream(
  serviceName: string,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    throw tagUpstreamError(err, serviceName);
  }
}
