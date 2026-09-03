/**
 * lib/verify/client-attestation.ts · the ENDPOINT half of the write barrier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DATABASE HALF IS NOT ENOUGH
 *
 * The incident did not go near the database. An agent ran a live iOS-simulator
 * session signed in as the owner's production account, and the simulator posted
 * two junk activities through `POST /api/ingest/workout` — the app's own ingest
 * endpoint, with a valid session, over HTTPS, exactly as the real phone does.
 * Every row it wrote was well-formed. A connection-string policy could not have
 * seen it, a read-only database role could not have seen it, and
 * `production-barrier.ts` could not have seen it either: the writing process was
 * the SERVER, and the server is allowed to write.
 *
 * So the server has to be able to tell a verification client from the runner's
 * phone, and refuse the first one's mutations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IDENTIFIES A VERIFICATION CLIENT
 *
 *   1 · `x-faff-client-env: simulator` — stamped by the iOS client itself, in
 *       `API.authedSend`, under `#if targetEnvironment(simulator)`. This is a
 *       COMPILE-TIME fact: a simulator build cannot fail to send it and a device
 *       build cannot send it, because the two are different binaries. It is not
 *       a setting anybody can forget or flip. That is what makes it structural
 *       rather than conventional, which is the property the owner's ruling
 *       demanded ("environment labelling … alone is insufficient").
 *
 *   2 · `x-faff-verification: <anything>` — the self-declaration available to
 *       any harness, script or automated client. Honest tooling stamps itself
 *       and gets refused. This one IS conventional and is here for completeness,
 *       not for load-bearing protection; the honest limit is stated below.
 *
 * The header is TRUSTED, not verified. A client that wanted to write could
 * simply not send it. That is fine, and it is the correct reading of the threat
 * model: this barrier exists to stop AGENTS AND TOOLING FROM DOING THE WRONG
 * THING BY ACCIDENT, in a repo whose own rules are the security boundary. It is
 * not an authentication control and must never be described as one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN IT REFUSES · Rule 11, fail-closed
 *
 * A stamped client's mutating request is refused unless the server can PROVE it
 * is not production. Three server states, not two:
 *
 *   · production      — DATABASE_URL points at a known production host → refuse.
 *   · non-production  — DATABASE_URL is loopback → allow. This is what keeps a
 *                       developer's simulator working against `next dev` and a
 *                       local database, which is the normal way to work here.
 *   · indeterminate   — cannot tell → REFUSE. A barrier that fails open is worse
 *                       than none, because it also reports confidence.
 *
 * Note the case this deliberately covers that the incident's own shape did not:
 * a LOCAL dev server whose `.env.local` points at the production database. The
 * simulator writing "to localhost" would still land in the owner's history. The
 * question this asks is never "which server am I", it is "would this write reach
 * production".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS EXEMPT, AND WHY, SAID OUT LOUD
 *
 *   · GET / HEAD / OPTIONS — reading production from the simulator is how Rule
 *     13 ("verify by RENDERING it, with real data") gets satisfied. Taking that
 *     away would trade one broken rule for another.
 *   · `/api/auth/**` — sign-in writes a `sessions` row, so it is technically a
 *     mutation. Refusing it would mean a simulator build could never authenticate
 *     against production, and therefore could never read it either, which
 *     collapses into the same Rule 13 problem. Session bookkeeping is not
 *     training history; the owner's ruling names "post activities, complete
 *     workouts, or mutate my production account". Sign-in is allowed and LOGGED.
 *     This is a judgement call and it is the one line of this file most worth
 *     re-examining if the posture ever needs to be stricter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT DO (Rule 22)
 *
 *   · It cannot see a client that does not stamp itself — `curl`, a Node
 *     script, a rebuilt simulator binary with the stamp deleted. Deleting the
 *     stamp is a source edit that `scripts/check-write-barrier.sh` fails on,
 *     which is the enforcement; the header alone is not.
 *   · It cannot see a test that imports a route handler and calls it directly.
 *     Middleware does not run for that. `production-barrier.ts` is what covers
 *     that path, and the two are complements, not duplicates.
 *   · It cannot distinguish the owner's account from anyone else's, and does
 *     not try. Refusing every verification-client mutation is simpler than
 *     refusing some, and a rule with no exceptions is a rule that can be
 *     checked.
 */
import { classifyDatabaseTarget } from './production-barrier';

/** Header the iOS client stamps under `#if targetEnvironment(simulator)`. */
export const CLIENT_ENV_HEADER = 'x-faff-client-env';
/** Header any automated client may stamp to declare itself verification tooling. */
export const VERIFICATION_HEADER = 'x-faff-verification';
/** Value of `CLIENT_ENV_HEADER` that means "this binary is a simulator build". */
export const SIMULATOR_ENV = 'simulator';

export type ServerPosture = 'production' | 'non-production' | 'indeterminate';

/**
 * Would a write served by this process reach production?
 *
 * Deliberately asks about the DATABASE and not about the deployment. A local
 * `next dev` wired to the production `DATABASE_URL` is production for every
 * purpose that matters here, and that configuration is the normal one on this
 * project's development machines.
 */
export function classifyServerPosture(
  env: Record<string, string | undefined> = process.env,
): { posture: ServerPosture; reason: string } {
  const target = classifyDatabaseTarget(env.DATABASE_URL, env);
  if (target.kind === 'production') {
    return { posture: 'production', reason: `database target ${target.describe} · ${target.reason}` };
  }
  if (target.kind === 'local') {
    return { posture: 'non-production', reason: `database target ${target.describe} · ${target.reason}` };
  }
  return { posture: 'indeterminate', reason: target.reason };
}

const MUTATING_METHOD = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Paths whose mutations are allowed even from a stamped client. See the header. */
function isExemptPath(pathname: string): boolean {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

export type AttestationVerdict =
  | { refuse: false; client: 'unstamped' | 'verification'; reason: string }
  | { refuse: true; client: 'verification'; reason: string; stamp: string };

/**
 * The whole decision, as one pure function over the three things it needs.
 *
 * Pure so `middleware.ts` stays a four-line adapter and so the proof test can
 * drive every branch without a server, a database or a network.
 */
export function judgeRequest(input: {
  method: string;
  pathname: string;
  /** Case-insensitive lookup, i.e. `req.headers.get`. */
  header: (name: string) => string | null | undefined;
  env?: Record<string, string | undefined>;
}): AttestationVerdict {
  const clientEnv = (input.header(CLIENT_ENV_HEADER) ?? '').trim().toLowerCase();
  const declared = (input.header(VERIFICATION_HEADER) ?? '').trim();
  const stamped = clientEnv === SIMULATOR_ENV || declared !== '';

  if (!stamped) {
    return { refuse: false, client: 'unstamped', reason: 'no verification stamp · treated as the real application' };
  }

  const stamp = clientEnv === SIMULATOR_ENV
    ? `${CLIENT_ENV_HEADER}: ${SIMULATOR_ENV}`
    : `${VERIFICATION_HEADER}: ${declared.slice(0, 40)}`;

  const method = input.method.toUpperCase();
  if (!MUTATING_METHOD.has(method)) {
    return { refuse: false, client: 'verification', reason: `${method} cannot mutate` };
  }
  if (isExemptPath(input.pathname)) {
    return { refuse: false, client: 'verification', reason: 'auth path · a session row is not training history (see header)' };
  }

  const { posture, reason } = classifyServerPosture(input.env ?? process.env);
  if (posture === 'non-production') {
    return { refuse: false, client: 'verification', reason: `server proved non-production · ${reason}` };
  }

  return {
    refuse: true,
    client: 'verification',
    stamp,
    reason: posture === 'production'
      ? `verification client attempted ${method} ${input.pathname} against production · ${reason}`
      : `verification client attempted ${method} ${input.pathname} and the server CANNOT PROVE it is not production · ${reason} · refusing rather than guessing (Rule 11)`,
  };
}

/** The body served on a refusal. Explicit, so nobody debugs this for an hour. */
export function refusalBody(v: Extract<AttestationVerdict, { refuse: true }>) {
  return {
    error: 'Refused · verification client',
    detail: v.reason,
    stamp: v.stamp,
    remedy:
      'This request carried a verification stamp, so the server refused to let it change anything. '
      + 'Point the client at a local server backed by a loopback database, or drop the stamp only by '
      + 'building for a real device. See web-v2/lib/verify/client-attestation.ts.',
  };
}
