/**
 * instrumentation.ts · the app's own heartbeat.
 *
 * Next.js calls `register()` once per server process at startup. This starts a
 * timer inside the Railway container that POSTs `/api/cron/tick` every few
 * minutes, so the schedule is driven by the process that actually serves the
 * app rather than by a clock in somebody else's data centre.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IN-PROCESS AND NOT SOMETHING ELSE
 *
 * The three options, honestly:
 *
 *   · RAILWAY CRON. Rejected on the platform's own documented terms, not on a
 *     hunch. docs.railway.com/reference/cron-jobs, read 2026-08-30: a cron
 *     service is "expected to execute a task, and terminate as soon as that
 *     task is finished", the docs caution against it "for long-running
 *     processes that don't exit, such as a web server", and "if a previous
 *     execution is still running when the next scheduled execution is due,
 *     Railway will skip the new cron job." This service is a `next start` that
 *     never exits, so its cron would be skipped every single time. Using it
 *     would mean standing up a SECOND Railway service whose only job is to curl
 *     the first — a new deployable, a new bill, and a new cross-service
 *     dependency, which is the thing we were trying to remove.
 *
 *   · AN EXTERNAL PINGER (cron-job.org, UptimeRobot, a Cloudflare Worker).
 *     Reliable, and it trades a dependency on GitHub for a dependency on
 *     somebody else, plus an account and `CRON_SECRET` living in a third place.
 *     Worth having as a redundant leg one day; not worth being the primary.
 *
 *   · THIS. The container that must be up for the app to work at all is the
 *     thing that drives the schedule. If it is down, nothing was going to serve
 *     the runner anyway. Zero new services, zero new credentials, zero new
 *     vendors — and `keep-warm` exists precisely to hold this container awake,
 *     so the assumption it rests on is one the app already made.
 *
 * GitHub Actions stays switched on beside it (`.github/workflows/cron-tick.yml`
 * plus every existing per-job workflow, untouched). Two legs, and because the
 * ledger is stamped by the ROUTE rather than the caller, whichever gets there
 * first satisfies the slot and the other skips.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A RUNAWAY TIMER CANNOT HURT ANYTHING
 *
 * The tick is due-gated. Calling it a thousand times in a minute runs no job a
 * second time: each one is satisfied by its own ledger row. The worst case for
 * a loop that fires too often is a cheap SELECT against `ops_alerts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT CATCH (CLAUDE.md Rule 22)
 *
 *   · If the container is asleep or crashed, this is asleep or crashed with it.
 *     It cannot be the thing that notices its own absence — that is what the
 *     GitHub leg and the `cron_stale` alert are for, and neither of them is
 *     driven from in here.
 *   · If two containers run (a replica, or a rolling deploy's overlap), both
 *     heartbeat. Every job the tick drives is idempotent, so the cost is a
 *     duplicated pass and not corruption. This is not a distributed lock.
 *   · It cannot tell a tick that ran and found nothing due from a tick that
 *     ran and failed to reach the route: both are logged, neither is alerted
 *     from here. The ledger's staleness check is what closes that.
 */

/** Five minutes. Fast enough that a nine-job backlog drains inside an hour. */
const TICK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * A short random delay before the first tick. With more than one container the
 * jitter keeps their passes from landing on the same instant, which is not a
 * correctness requirement (the jobs are idempotent) but does stop two
 * containers running the same expensive job twice for no reason.
 */
const STARTUP_JITTER_MS = 20_000;

export async function register(): Promise<void> {
  // Only the Node server. Next also evaluates this file for the edge runtime,
  // where there is no long-lived process for a timer to live in.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // A hard off switch that needs no deploy to reach — set it in Railway and
  // restart. Named here because the first question during an incident is
  // always "how do I stop it".
  if (process.env.CRON_TICK_DISABLED === '1') {
    console.log('[cron-tick] heartbeat disabled by CRON_TICK_DISABLED');
    return;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Not fatal, and not silent. Without the secret the tick would 401 every
    // five minutes forever, and a log line at boot is the difference between
    // finding that in a minute and finding it in a week.
    console.warn('[cron-tick] CRON_SECRET is not set · heartbeat not started');
    return;
  }

  const base = process.env.CRON_TICK_BASE_URL?.replace(/\/+$/, '')
    ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

  /** One tick at a time. A slow pass must not stack behind itself. */
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(`${base}/api/cron/tick`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'x-faff-cron-origin': 'heartbeat',
        },
        // Generous: the tick's own drain budget is ~100s and it may be running
        // a job behind that. Longer than the budget so a legitimate long pass
        // is not aborted halfway and re-run from scratch next time.
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) {
        console.warn(`[cron-tick] heartbeat got HTTP ${res.status}`);
        return;
      }
      const body = await res.json().catch(() => null) as { ran?: number } | null;
      // Quiet when there is nothing to do, which is most ticks. A line every
      // five minutes saying "nothing due" is how logs stop being read.
      if (body && typeof body.ran === 'number' && body.ran > 0) {
        console.log(`[cron-tick] heartbeat ran ${body.ran} job(s)`);
      }
    } catch (e: unknown) {
      // Expected during boot, before the HTTP server is listening. Warn rather
      // than throw: a failed heartbeat must never take the process down.
      console.warn('[cron-tick] heartbeat failed:',
        e instanceof Error ? e.message : String(e));
    } finally {
      inFlight = false;
    }
  };

  const jitter = Math.floor(Math.random() * STARTUP_JITTER_MS);
  const first = setTimeout(() => {
    void tick();
    const timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);
    // Do not hold the event loop open on this timer's account. A container
    // shutting down should shut down.
    timer.unref?.();
  }, jitter);
  first.unref?.();

  console.log(`[cron-tick] heartbeat armed · every ${TICK_INTERVAL_MS / 60000}m against ${base}`);
}

/**
 * onRequestError · Next.js's own global error hook (stable since Next 15;
 * this app is on 15.1.6 — no `experimental.instrumentationHook` flag needed).
 * Next calls this for every error that escapes a Server Component, Route
 * Handler, Server Action or Middleware, BEFORE it renders that error's own
 * response — which makes it the correct EXTENSION point for CLAUDE.md's
 * instruction to extend an existing shared error mechanism rather than build
 * a second, parallel one. It requires editing ZERO of the 154 existing
 * `app/api/**` route files: every unhandled exception any of them already
 * throws is caught here automatically.
 *
 * 2026-09-09 · bounded, non-destructive production-observability work for the
 * real, unresolved 502/~13-second-timeout incident (David's authorization:
 * "distinguish edge, application, database/pool, upstream and client-timeout
 * failure classes and provide a durable correlation ID"). This is the
 * APPLICATION-class backbone of that work; `lib/observability/with-
 * observability.ts` is the opt-in per-route companion for the two things
 * this hook structurally cannot see (a route that returns an explicit 5xx
 * JSON body without throwing, and the incoming request's own abort signal —
 * see that file's header for why both need a separate mechanism).
 *
 * The `request`/`context` shapes below are Next.js's documented
 * `onRequestError` contract (nextjs.org/docs/app/api-reference/file-
 * conventions/instrumentation#onrequesterror-optional). Typed narrowly and
 * accessed defensively (optional chaining throughout) rather than importing
 * a Next-internal type, because this worktree has no `node_modules` to
 * typecheck against (see CLAUDE.md's "verify by self-audit" doctrine) — if
 * a future Next version reshapes this contract, defensive access degrades to
 * "correlation id defaults to a fresh one, class defaults from the error
 * alone" rather than throwing inside an error handler, which would be the
 * worst possible failure mode for this specific file.
 *
 * RULE 19, CAUGHT THIS TIME BY THE GATE IT ADDED: the first version of this
 * hook imported `lib/observability/record.ts` directly, which reaches
 * `@/lib/db/pool` → `pg`. `next build`'s pre-push check (the exact check
 * Rule 19 added after `lthr-reanchor.ts`'s dynamic import did the same thing
 * to `main` for a full day) failed immediately: this file is bundled for
 * BOTH the Node and Edge runtimes, and the `fs`/`path`/`stream` `pg` needs do
 * not exist in the edge bundle — a `NEXT_RUNTIME` check at RUN time does not
 * stop webpack needing to resolve the import graph at BUILD time. Fixed the
 * way `register()` above already solves the identical problem for the cron
 * tick: this hook imports only the PURE, dependency-free `classify.ts`/
 * `constants.ts` directly, and relays the actual database write to
 * `POST /api/internal/observability/record` — an ordinary Node-runtime route
 * (routes are never edge-bundled by default; 154 of them already import
 * `@/lib/db/pool` directly with no issue) — over the same loopback base URL
 * `register()` already resolves, with the same `CRON_SECRET` bearer auth
 * `/api/cron/tick` already uses. See that route's header for the full story.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind?: string;
    routePath?: string;
    routeType?: string;
  },
): Promise<void> {
  // Same Node-only guard as register() — this file is also evaluated for the
  // Edge runtime, which cannot run the Node-only fetch-with-secret call below
  // (the secret should never be reachable from an edge-bundled code path).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const secret = process.env.CRON_SECRET;
  if (!secret) return; // same silent-skip posture as register() when unset

  try {
    const { classifyFailure } = await import('./lib/observability/classify');
    const { CORRELATION_ID_HEADER } = await import('./lib/observability/constants');

    const headerBag = request?.headers ?? {};
    const rawHeaderVal = headerBag[CORRELATION_ID_HEADER] ?? headerBag[CORRELATION_ID_HEADER.toUpperCase()];
    const headerVal = Array.isArray(rawHeaderVal) ? rawHeaderVal[0] : rawHeaderVal;
    // middleware.ts mints/forwards this id for every /api/* request before
    // the route handler ever runs, so it should normally be present here.
    // Falling back to a fresh id rather than throwing keeps this hook alive
    // for the one case it exists to cover even if that assumption is wrong.
    const correlationId = headerVal && headerVal.trim().length > 0 ? headerVal.trim().slice(0, 128) : `no-header-${Date.now()}`;

    const classified = classifyFailure(error);
    const base = process.env.CRON_TICK_BASE_URL?.replace(/\/+$/, '')
      ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;

    await fetch(`${base}/api/internal/observability/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        correlationId,
        routePath: context?.routePath || request?.path || 'unknown',
        httpMethod: request?.method || 'UNKNOWN',
        failureClass: classified.failureClass,
        // Next.js is about to render its own 500 for a Route Handler whose
        // error escaped this far — an approximation stated as one, not a
        // fact this hook independently confirmed (it never sees the response
        // Next.js goes on to send).
        httpStatus: 500,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        upstreamService: classified.upstreamService,
        metadata: { detail: classified.detail, routerKind: context?.routerKind, routeType: context?.routeType },
        source: 'instrumentation.onRequestError',
      }),
      // Bounded, same order of magnitude as ops/sentry.ts's own outbound
      // timeouts — this hook must never itself become a hang.
      signal: AbortSignal.timeout(3000),
    });
  } catch (hookError) {
    // This IS the error-reporting path; it must not become the thing that
    // throws (Rule 18 — `lib/ops/sentry.ts`'s own header makes the same
    // promise: "error reporting can't error itself").
    console.error('[instrumentation] onRequestError observability hook failed:', hookError);
  }
}
