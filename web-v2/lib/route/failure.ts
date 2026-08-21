/**
 * lib/route/failure.ts — what a route says when it falls over.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULE THREE, THE SERVER HALF
 *
 * "A refusal is a correct answer, not an empty state. It must not look like
 *  the data-outage screen."
 *
 * The phone already keeps that line honestly. `APIV5.v5()` maps a 4xx that
 * carries a reason to `.absent` (a refusal, rendered as content) and
 * everything else to `.failed` (the outage screen). The split it depends on
 * is the STATUS CODE, and the server is the only half that can set it.
 *
 * Two ways the server was breaking the runner's side of that contract:
 *
 *   1 · Answering 200 with a refusal payload it had inferred from a FAILED
 *       read. `/api/v5/today`'s race-mode gate did exactly this: the gate
 *       query is `.catch(() => ({ rows: [] }))`, so a dropped connection and
 *       "this runner has never raced" were the same value. A marathoner
 *       mid-block, during a thirty-second Postgres blip, was told "Not here
 *       yet · This phone build only coaches toward a goal race." A permanent
 *       product limitation, with no retry, for a transient outage.
 *
 *   2 · Answering 500 with `err.message` in the body. That is a Postgres
 *       string on a runner's screen, it is not coach voice, and it names
 *       schema and connection detail to anyone holding the endpoint.
 *
 * So: `outage()` is the one way a route reports that it could not read. It
 * is always 5xx, never carries `reason` (the key the phone reads a refusal
 * out of), and never carries the driver's text. The driver's text goes to
 * the server log, which is where it was always useful and never harmful.
 *
 * A REFUSAL DOES NOT COME FROM HERE. A refusal is a 4xx with `reason`, or a
 * 200 whose payload says the engine decided. Those are composed by the
 * surface that made the decision, because only it knows what the decision
 * was. This file is exclusively for "we could not read it".
 */
import { NextResponse } from 'next/server';

/** Coach voice, and true of every cause: a dropped connection, a statement
 *  timeout, an exhausted pool. It says what happened, it does not guess why,
 *  and it says the runner's own data is intact — which is the thing they
 *  actually want to know when a screen will not load. */
const OUTAGE_MESSAGE = 'We could not read your training just now. Nothing is lost. Try again in a moment.';

/**
 * The one outage response. 503, because it is transient and retryable —
 * a 500 reads as "this is broken", a 503 reads as "ask again", and the
 * second is both truer and what the phone should act on.
 *
 * @param where  route tag for the server log, e.g. `'v5/today'`.
 * @param err    the real error. Logged, never sent.
 */
export function outage(where: string, err: unknown): NextResponse {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  // The stack is the useful half when the message is a bare driver string.
  console.error(`[${where}] outage:`, detail, err instanceof Error ? err.stack : '');
  return NextResponse.json(
    { error: 'outage', message: OUTAGE_MESSAGE },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Marker for a read whose failure must NOT be swallowed into a plausible
 * empty result.
 *
 * The `.catch(() => ({ rows: [] }))` idiom is right for an ADDITIVE read —
 * elevation, gear, a taper note — where absence and failure genuinely lead
 * to the same screen: the section is simply not drawn. It is wrong for a
 * LOAD-BEARING read, where absence is itself a claim about the runner. Wrap
 * those with this so the throw reaches the handler's catch and becomes an
 * outage, instead of becoming an answer.
 */
export class LoadBearingReadFailed extends Error {
  constructor(public readonly what: string, cause: unknown) {
    super(`load-bearing read failed: ${what}`);
    this.name = 'LoadBearingReadFailed';
    this.cause = cause;
  }
}
