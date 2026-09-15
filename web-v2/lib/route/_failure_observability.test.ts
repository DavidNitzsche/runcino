/**
 * lib/route/_failure_observability.test.ts · OUTAGE-OBSERVABILITY-1.
 *
 * Falsifies the exact gap F162 found live: `outage()` returns a
 * `NextResponse` instead of throwing, so `onRequestError` never fires and
 * nothing reached `request_failures` for any `outage()` call — confirmed
 * against David's own real repro (19 `[v5/today] outage:` log lines, zero
 * rows). This suite proves the fix without a live database: `record.ts`'s
 * `recordRequestFailure` is mocked so the assertion is on the CALL SHAPE
 * `outage()` produces, not on Postgres actually accepting a row (the
 * DB-scratch harness under `lib/observability/harness/` already covers the
 * full round-trip for the observability system generally).
 *
 * Per Rule 18: run against the UNFIXED code first (comment out the
 * `void recordRequestFailure(...)` call in `outage()`) and confirm every
 * test below fails before trusting it passes against the fix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordRequestFailureMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/observability/record', () => ({
  recordRequestFailure: (...args: unknown[]) => recordRequestFailureMock(...args),
}));

const { outage } = await import('./failure');

beforeEach(() => {
  recordRequestFailureMock.mockClear();
});

function fakeReq(overrides?: Partial<{ method: string; correlationId: string | null }>): Request {
  const headers = new Headers();
  if (overrides?.correlationId !== null) {
    headers.set('x-faff-correlation-id', overrides?.correlationId ?? 'test-correlation-id');
  }
  return { headers, method: overrides?.method ?? 'GET' } as Request;
}

describe('outage() records a durable request_failures row (OUTAGE-OBSERVABILITY-1)', () => {
  it('calls recordRequestFailure exactly once', async () => {
    outage('v5/today', new Error('timeout exceeded when trying to connect'), fakeReq());
    expect(recordRequestFailureMock).toHaveBeenCalledTimes(1);
  });

  it('records the route tag as routePath, not a generic label', async () => {
    outage('v5/today', new Error('boom'), fakeReq());
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.routePath).toBe('v5/today');
  });

  it('records the request method', async () => {
    outage('api/plan/undo', new Error('boom'), fakeReq({ method: 'POST' }));
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.httpMethod).toBe('POST');
  });

  it('reuses the client-sent correlation id rather than minting a new one', async () => {
    outage('v5/today', new Error('boom'), fakeReq({ correlationId: 'client-generated-id-123' }));
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.correlationId).toBe('client-generated-id-123');
  });

  it('mints a fresh correlation id when the request carries none, rather than recording an empty one', async () => {
    outage('v5/today', new Error('boom'), fakeReq({ correlationId: null }));
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.correlationId).toBeTruthy();
    expect(typeof call.correlationId).toBe('string');
  });

  it('classifies the real pg-pool checkout-timeout message as DATABASE_POOL — the exact shape from F162s live repro', async () => {
    outage('v5/today', new Error('timeout exceeded when trying to connect'), fakeReq());
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.failureClass).toBe('DATABASE_POOL');
  });

  it('always records httpStatus 503 — outage() never sends anything else', async () => {
    outage('v5/today', new Error('boom'), fakeReq());
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.httpStatus).toBe(503);
  });

  it('tags the source as this file, not a generic caller', async () => {
    outage('v5/today', new Error('boom'), fakeReq());
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.source).toBe('lib/route/failure.outage');
  });

  it('accepts the narrower {headers, url?} request shape lib/auth/session.ts passes, not just a full Request', async () => {
    const narrow = { headers: new Headers({ 'x-faff-correlation-id': 'narrow-shape-id' }) };
    expect(() => outage('auth/session', new Error('boom'), narrow)).not.toThrow();
    const call = recordRequestFailureMock.mock.calls[0][0];
    expect(call.correlationId).toBe('narrow-shape-id');
    expect(call.httpMethod).toBe('UNKNOWN');
  });

  it('still returns the same 503 coach-voice response regardless of recording', async () => {
    const res = outage('v5/today', new Error('boom'), fakeReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('outage');
    expect(body.message).not.toMatch(/boom|Error:/); // never leaks the real error
  });

  it('never throws even if recordRequestFailure itself rejects — observability cannot take the response down', async () => {
    recordRequestFailureMock.mockRejectedValueOnce(new Error('DB is also down'));
    expect(() => outage('v5/today', new Error('boom'), fakeReq())).not.toThrow();
  });
});
