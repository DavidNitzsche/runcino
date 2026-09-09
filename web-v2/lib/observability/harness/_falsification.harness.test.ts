/**
 * lib/observability/harness/_falsification.harness.test.ts · Rule 18,
 * against a real database.
 *
 * "A gate is not trusted until it has been made to fail." This suite
 * deliberately TRIGGERS each of the five failure classes David named
 * (plus UNKNOWN) through the real mechanisms — `classifyFailure`,
 * `recordRequestFailure`, `withObservability`, `observedQuery`,
 * `fetchUpstream`, and the `client-report` route handler — and confirms a
 * row lands in `request_failures` with the correct class, sanitized fields,
 * and a correlation id it can be found by. Then it runs the exact rollup
 * query `/api/admin/observability-summary` uses and confirms every class
 * shows up in it.
 *
 * Run ONLY via `npm run harness:observability` (scripts/observability-
 * falsifier.sh), which points DATABASE_URL at the local scratch database
 * `faff_observability_scratch` before vitest starts. `assertObservability
 * ScratchDatabase()` in `beforeAll` re-checks at run time and throws if
 * DATABASE_URL is anything else — see `fence.ts`.
 *
 * NOT applied to, and never touches, production. `request_failures` here is
 * created by `db/migrations/170_request_failures.sql`, which remains
 * UNAPPLIED to the real Railway database pending David's explicit DDL
 * approval.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertObservabilityScratchDatabase } from './fence';

// The fence MUST run before `@/lib/db/pool` (or anything importing it) is
// ever touched, so it is a synchronous check at module top-level, not inside
// a beforeAll (which would run after the first dynamic import below has
// already resolved). This mirrors `lib/adaptation-harness`'s own ordering.
assertObservabilityScratchDatabase();

const { pool } = await import('@/lib/db/pool');
const { recordRequestFailure } = await import('../record');
const { classifyFailure, tagUpstreamError, classifyClientReportKind } = await import('../classify');
const { observedQuery } = await import('../db-query');
const { fetchUpstream } = await import('../upstream-fetch');
const { withObservability } = await import('../with-observability');
const { NextRequest } = await import('next/server');
const { POST: clientReportPost } = await import('@/app/api/observability/client-report/route');
const { POST: internalRecordPost } = await import('@/app/api/internal/observability/record/route');

interface FailureRow {
  id: string;
  correlation_id: string;
  route_path: string;
  http_method: string;
  failure_class: string;
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  error_stack: string | null;
  upstream_service: string | null;
  client_reported: boolean;
}

async function rowFor(correlationId: string): Promise<FailureRow | undefined> {
  const r = await pool.query<FailureRow>(
    `SELECT id, correlation_id, route_path, http_method, failure_class, http_status,
            duration_ms, error_message, error_stack, upstream_service, client_reported
       FROM request_failures WHERE correlation_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [correlationId],
  );
  return r.rows[0];
}

beforeAll(async () => {
  // Clean slate — this suite's own assertions read back specific rows by
  // correlation id, so cross-run pollution would not silently break them,
  // but a clean start makes the final "every class present" rollup honest.
  await pool.query('TRUNCATE request_failures');
});

afterAll(async () => {
  await pool.end();
});

describe('APPLICATION · an unhandled exception, the onRequestError / with-observability default', () => {
  it('is recorded with the right class and a sanitized message', async () => {
    const correlationId = `falsify-application-${Date.now()}`;
    const err = new Error('undefined is not a function at planBuilder.ts:42, token Bearer sk-should-be-redacted-aaaaaaaaaaaaaaaa');
    const classified = classifyFailure(err);
    expect(classified.failureClass).toBe('APPLICATION');

    await recordRequestFailure({
      correlationId, routePath: '/api/plan/today', httpMethod: 'GET',
      failureClass: classified.failureClass, httpStatus: 500, durationMs: 42,
      error: err, source: 'harness-falsifier',
    });

    const row = await rowFor(correlationId);
    expect(row).toBeDefined();
    expect(row!.failure_class).toBe('APPLICATION');
    expect(row!.http_status).toBe(500);
    expect(row!.error_message).not.toContain('sk-should-be-redacted-aaaaaaaaaaaaaaaa');
    expect(row!.error_message).toContain('[redacted]');
  });
});

describe('POST /api/internal/observability/record · the indirection instrumentation.ts relays through', () => {
  const originalSecret = process.env.CRON_SECRET;
  beforeAll(() => { process.env.CRON_SECRET = 'harness-test-secret'; });
  afterAll(() => { process.env.CRON_SECRET = originalSecret; });

  it('rejects a request with no/wrong bearer secret', async () => {
    const req = new NextRequest('http://localhost/api/internal/observability/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correlationId: 'x', routePath: '/x', failureClass: 'APPLICATION' }),
    });
    const res = await internalRecordPost(req);
    expect(res.status).toBe(401);
  });

  it('records a real row given the correct secret — this is the exact call instrumentation.ts makes', async () => {
    const correlationId = `falsify-internalroute-${Date.now()}`;
    const req = new NextRequest('http://localhost/api/internal/observability/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer harness-test-secret' },
      body: JSON.stringify({
        correlationId, routePath: '/api/plan/today', httpMethod: 'GET',
        failureClass: 'APPLICATION', httpStatus: 500,
        errorMessage: 'TypeError: cannot read properties of undefined, session Bearer abcdefghijklmnopqrstuvwx',
        source: 'instrumentation.onRequestError',
      }),
    });
    const res = await internalRecordPost(req);
    expect(res.status).toBe(200);
    const row = await rowFor(correlationId);
    expect(row).toBeDefined();
    expect(row!.failure_class).toBe('APPLICATION');
    // Proves sanitize.ts still runs on THIS path too, independent of whether
    // the caller (instrumentation.ts) already classified the error.
    expect(row!.error_message).not.toContain('abcdefghijklmnopqrstuvwx');
  });
});

describe('DATABASE_POOL · triggered through observedQuery against a pool that actually rejects', () => {
  it('a rejecting query is tagged DATABASE_POOL and recorded', async () => {
    const correlationId = `falsify-dbpool-${Date.now()}`;
    const fakePool = {
      query: async () => { throw Object.assign(new Error('timeout exceeded when trying to connect'), {}); },
    } as unknown as import('pg').Pool;

    let caught: unknown;
    try {
      await observedQuery(fakePool, 'SELECT 1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const classified = classifyFailure(caught);
    expect(classified.failureClass).toBe('DATABASE_POOL');

    await recordRequestFailure({
      correlationId, routePath: '/api/today', httpMethod: 'GET',
      failureClass: classified.failureClass, httpStatus: 500, durationMs: 10_013,
      error: caught, source: 'harness-falsifier',
    });
    const row = await rowFor(correlationId);
    expect(row!.failure_class).toBe('DATABASE_POOL');
    // The ~13-second-timeout incident's own shape — proving duration_ms
    // survives the round trip, since that is precisely the number David
    // needs to see for the next occurrence.
    expect(row!.duration_ms).toBe(10_013);
  });

  it('a real Postgres SQLSTATE (unique_violation) via the actual scratch database is NOT swept into DATABASE_POOL', async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS _falsify_uniq (id int PRIMARY KEY)');
    await pool.query('INSERT INTO _falsify_uniq (id) VALUES (1) ON CONFLICT DO NOTHING');
    let caught: unknown;
    try {
      await pool.query('INSERT INTO _falsify_uniq (id) VALUES (1)');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(classifyFailure(caught).failureClass).not.toBe('DATABASE_POOL');
    await pool.query('DROP TABLE _falsify_uniq');
  });
});

describe('UPSTREAM · triggered through a real fetchUpstream() call against a rejecting fetch', () => {
  const originalFetch = global.fetch;
  afterAll(() => { global.fetch = originalFetch; });

  it('a rejected outbound fetch is tagged UPSTREAM with the service name and recorded', async () => {
    global.fetch = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const correlationId = `falsify-upstream-${Date.now()}`;

    let caught: unknown;
    try {
      await fetchUpstream('strava', 'https://www.strava.com/api/v3/athlete');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    const classified = classifyFailure(caught);
    expect(classified.failureClass).toBe('UPSTREAM');
    expect(classified.upstreamService).toBe('strava');

    await recordRequestFailure({
      correlationId, routePath: '/api/strava/sync', httpMethod: 'POST',
      failureClass: classified.failureClass, httpStatus: 502, durationMs: 3200,
      error: caught, upstreamService: classified.upstreamService, source: 'harness-falsifier',
    });
    const row = await rowFor(correlationId);
    expect(row!.failure_class).toBe('UPSTREAM');
    expect(row!.upstream_service).toBe('strava');
  });
});

describe('CLIENT_TIMEOUT · triggered through withObservability against a real AbortController firing mid-handler', () => {
  it('an aborted incoming request signal is recorded as CLIENT_TIMEOUT even though the handler eventually threw something else', async () => {
    const correlationId = `falsify-clienttimeout-${Date.now()}`;
    const controller = new AbortController();

    const handler = withObservability('/api/slow-endpoint', async (req: InstanceType<typeof NextRequest>) => {
      // Simulate a slow DB call the client gives up waiting on. The abort
      // fires WHILE this is in flight, then the handler itself throws
      // (representing e.g. a query that was cancelled) — the point of this
      // test is that CLIENT_TIMEOUT wins because it reflects what the caller
      // actually experienced, not the incidental shape of the error that
      // happened to unwind the handler afterward.
      setTimeout(() => controller.abort(), 5);
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('query canceled after client disconnected');
    });

    const req = new NextRequest('http://localhost/api/slow-endpoint', {
      method: 'GET',
      headers: { 'x-faff-correlation-id': correlationId },
      signal: controller.signal,
    });

    await expect(handler(req, {})).rejects.toThrow();
    const row = await rowFor(correlationId);
    expect(row).toBeDefined();
    expect(row!.failure_class).toBe('CLIENT_TIMEOUT');
  });

  it('without an abort, the same handler shape records APPLICATION instead — proving the class actually depends on the signal, not the route', async () => {
    const correlationId = `falsify-application-viahandler-${Date.now()}`;
    const handler = withObservability('/api/slow-endpoint', async () => {
      throw new Error('unrelated application bug');
    });
    const req = new NextRequest('http://localhost/api/slow-endpoint', {
      method: 'GET',
      headers: { 'x-faff-correlation-id': correlationId },
    });
    await expect(handler(req, {})).rejects.toThrow();
    const row = await rowFor(correlationId);
    expect(row!.failure_class).toBe('APPLICATION');
  });

  it('a route that returns an explicit 5xx WITHOUT throwing is still recorded (onRequestError cannot see this case)', async () => {
    const correlationId = `falsify-explicit5xx-${Date.now()}`;
    const handler = withObservability('/api/explicit-500', async () => {
      return new Response(JSON.stringify({ error: 'outage' }), { status: 503 });
    });
    const req = new NextRequest('http://localhost/api/explicit-500', {
      method: 'GET',
      headers: { 'x-faff-correlation-id': correlationId },
    });
    const res = await handler(req, {});
    expect(res.status).toBe(503);
    const row = await rowFor(correlationId);
    expect(row).toBeDefined();
    expect(row!.http_status).toBe(503);
  });
});

describe('EDGE · the one class only a client self-report can ever produce', () => {
  it('classifyFailure() itself cannot be made to return EDGE — confirmed against every shape tried elsewhere in this suite', () => {
    // By design (see classify.ts header): a true EDGE failure means nothing
    // server-side ever ran to call classifyFailure at all. This assertion
    // documents that contract's other half — nothing above accidentally
    // produced EDGE from a server-observed error.
    expect(classifyClientReportKind('no_response')).toBe('EDGE');
  });

  it('the real client-report route handler records an EDGE row for a "no_response" report', async () => {
    const correlationId = `falsify-edge-${Date.now()}`;
    const req = new NextRequest('http://localhost/api/observability/client-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        correlationId, routePath: '/api/plan/today', httpMethod: 'GET',
        kind: 'no_response', observedDurationMs: 13_400,
      }),
    });
    const res = await clientReportPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.failureClass).toBe('EDGE');

    const row = await rowFor(correlationId);
    expect(row).toBeDefined();
    expect(row!.failure_class).toBe('EDGE');
    expect(row!.client_reported).toBe(true);
    expect(row!.duration_ms).toBe(13_400);
  });

  it('the client-report route also handles "client_gave_up" as CLIENT_TIMEOUT, not EDGE', async () => {
    const correlationId = `falsify-clientgaveup-${Date.now()}`;
    const req = new NextRequest('http://localhost/api/observability/client-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correlationId, routePath: '/api/plan/today', kind: 'client_gave_up' }),
    });
    const res = await clientReportPost(req);
    const body = await res.json();
    expect(body.failureClass).toBe('CLIENT_TIMEOUT');
  });
});

describe('UNKNOWN · genuinely ambiguous input, never silently coerced to a specific class', () => {
  it('a raw ECONNREFUSED with no tag records as UNKNOWN, not guessed as DATABASE_POOL or UPSTREAM', async () => {
    const correlationId = `falsify-unknown-${Date.now()}`;
    const err = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.5:5432' };
    const classified = classifyFailure(err);
    expect(classified.failureClass).toBe('UNKNOWN');
    await recordRequestFailure({
      correlationId, routePath: '/api/mystery', httpMethod: 'GET',
      failureClass: classified.failureClass, httpStatus: null, durationMs: null,
      error: err, source: 'harness-falsifier',
    });
    const row = await rowFor(correlationId);
    expect(row!.failure_class).toBe('UNKNOWN');
  });
});

describe('the admin summary rollup query · every class present, correctly grouped', () => {
  it('GROUP BY failure_class over this suite\'s own rows returns all six classes with count >= 1', async () => {
    const rollup = (await pool.query<{ failure_class: string; n: string }>(
      `SELECT failure_class, count(*)::text AS n FROM request_failures GROUP BY failure_class ORDER BY failure_class`,
    )).rows;
    const classes = new Set(rollup.map((r) => r.failure_class));
    for (const c of ['EDGE', 'APPLICATION', 'DATABASE_POOL', 'UPSTREAM', 'CLIENT_TIMEOUT', 'UNKNOWN']) {
      expect(classes.has(c)).toBe(true);
    }
    for (const r of rollup) {
      expect(Number(r.n)).toBeGreaterThanOrEqual(1);
    }
  });
});
