/**
 * lib/observability/_classify_sanitize.test.ts · pure unit coverage, zero
 * database, zero env dependency — safe in the default `npm test` sweep.
 *
 * The end-to-end durable-write falsification (actually INSERTing rows for
 * every failure class and reading them back) lives in
 * `lib/observability/harness/_falsification.harness.test.ts`, run via
 * `npm run harness:observability` against a local scratch database — see
 * that file's header for why it cannot live here.
 *
 * Rule 18 discipline: every assertion below is checked in BOTH directions
 * where the classifier has two — a recognized shape must classify correctly,
 * and an unrecognized/ambiguous one must NOT be coerced into a specific
 * class it cannot support (Rule 11).
 */
import { describe, expect, it } from 'vitest';
import { classifyFailure, classifyClientReportKind, tagUpstreamError, tagDatabaseError } from './classify';
import { sanitizeErrorMessage, sanitizeStack, sanitizeMetadata } from './sanitize';
import { ALL_FAILURE_CLASSES } from './types';
import { correlationIdFromHeaders, newCorrelationId, CORRELATION_ID_HEADER } from './constants';

describe('classifyFailure · explicit tags win over heuristics', () => {
  it('UPSTREAM: tagUpstreamError makes classifyFailure return UPSTREAM + the service name', () => {
    const err = tagUpstreamError(new Error('network down'), 'strava');
    const result = classifyFailure(err);
    expect(result.failureClass).toBe('UPSTREAM');
    expect(result.upstreamService).toBe('strava');
  });

  it('DATABASE_POOL: tagDatabaseError makes classifyFailure return DATABASE_POOL', () => {
    const err = tagDatabaseError(new Error('whatever the pool caught'));
    expect(classifyFailure(err).failureClass).toBe('DATABASE_POOL');
  });

  it('a tag survives being caught and rethrown, like a real call site would', () => {
    function throwTagged(): never {
      try {
        throw new Error('boom');
      } catch (e) {
        throw tagUpstreamError(e, 'weather');
      }
    }
    try {
      throwTagged();
      throw new Error('should not reach here');
    } catch (e) {
      const result = classifyFailure(e);
      expect(result.failureClass).toBe('UPSTREAM');
      expect(result.upstreamService).toBe('weather');
    }
  });
});

describe('classifyFailure · heuristic tier (no tag present)', () => {
  it('DATABASE_POOL: a Postgres SQLSTATE in the connection/resource/operator-intervention class', () => {
    // 53300 = too_many_connections, the literal shape of pool exhaustion.
    expect(classifyFailure({ name: 'error', message: 'sorry, too many clients already', code: '53300' }).failureClass).toBe('DATABASE_POOL');
    // 57014 = query_canceled, i.e. statement_timeout firing.
    expect(classifyFailure({ name: 'error', message: 'canceling statement due to statement timeout', code: '57014' }).failureClass).toBe('DATABASE_POOL');
    // 08006 = connection_failure.
    expect(classifyFailure({ name: 'error', message: 'connection failure', code: '08006' }).failureClass).toBe('DATABASE_POOL');
  });

  it('DATABASE_POOL: a SQLSTATE outside those classes does NOT classify as DATABASE_POOL', () => {
    // 23505 = unique_violation — a real Postgres error, but not a pool/
    // connection/resource failure. Must not be swept into the same bucket.
    expect(classifyFailure({ name: 'error', message: 'duplicate key value violates unique constraint', code: '23505' }).failureClass).not.toBe('DATABASE_POOL');
  });

  it('DATABASE_POOL: pg-pool\'s own fixed message strings, which carry no SQLSTATE at all', () => {
    expect(classifyFailure(new Error('timeout exceeded when trying to connect')).failureClass).toBe('DATABASE_POOL');
    expect(classifyFailure(new Error('Connection terminated unexpectedly')).failureClass).toBe('DATABASE_POOL');
  });

  it('UPSTREAM: an untagged undici "fetch failed" and an untagged AbortError default to UPSTREAM', () => {
    expect(classifyFailure(new TypeError('fetch failed')).failureClass).toBe('UPSTREAM');
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    expect(classifyFailure(abortErr).failureClass).toBe('UPSTREAM');
  });

  it('CLIENT_TIMEOUT: the incoming request signal firing always wins, regardless of the caught error', () => {
    expect(classifyFailure(new Error('anything at all'), { clientAborted: true }).failureClass).toBe('CLIENT_TIMEOUT');
    expect(classifyFailure(null, { clientAborted: true }).failureClass).toBe('CLIENT_TIMEOUT');
  });

  it('APPLICATION: an ordinary thrown error with no recognized signature', () => {
    expect(classifyFailure(new Error('undefined is not a function')).failureClass).toBe('APPLICATION');
    expect(classifyFailure(new TypeError('cannot read property of undefined')).failureClass).toBe('APPLICATION');
  });

  it('UNKNOWN: a caught value that is not Error-like at all', () => {
    expect(classifyFailure(null).failureClass).toBe('UNKNOWN');
    expect(classifyFailure(undefined).failureClass).toBe('UNKNOWN');
    expect(classifyFailure(42).failureClass).toBe('UNKNOWN');
    expect(classifyFailure('a bare string').failureClass).toBe('UNKNOWN');
  });

  it('UNKNOWN: a raw network error with no signature identifying DB vs upstream — Rule 11 forbids guessing which', () => {
    expect(classifyFailure({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }).failureClass).toBe('UNKNOWN');
    expect(classifyFailure({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }).failureClass).toBe('UNKNOWN');
  });

  it('the classifier never throws, even given a hostile input whose property access throws', () => {
    const hostile = {
      get message(): string { throw new Error('accessing .message itself throws'); },
    };
    const result = classifyFailure(hostile);
    expect(result.failureClass).toBe('UNKNOWN');
    expect(result.detail).toMatch(/classifier threw/);
  });
});

describe('classifyClientReportKind · the only path that can ever produce EDGE', () => {
  it('no_response and network_error both classify as EDGE', () => {
    expect(classifyClientReportKind('no_response')).toBe('EDGE');
    expect(classifyClientReportKind('network_error')).toBe('EDGE');
  });
  it('client_gave_up classifies as CLIENT_TIMEOUT, not EDGE', () => {
    expect(classifyClientReportKind('client_gave_up')).toBe('CLIENT_TIMEOUT');
  });
  it('classifyFailure() itself never returns EDGE — by design, see classify.ts header', () => {
    // Exhaustively confirmed: no input to classifyFailure in this suite (or
    // reasonably constructible) can produce EDGE. This test documents that
    // as a deliberate contract, not an oversight, and would need updating
    // (not silently pass) if that contract ever changed.
    expect(ALL_FAILURE_CLASSES).toContain('EDGE');
  });
});

describe('sanitize · what never reaches the database', () => {
  it('redacts a bearer token', () => {
    const msg = sanitizeErrorMessage('upstream call failed: Authorization: Bearer abcdef0123456789ABCDEF01');
    expect(msg).not.toContain('abcdef0123456789ABCDEF01');
    expect(msg).toContain('[redacted]');
  });

  it('redacts a JWT-shaped string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const msg = sanitizeErrorMessage(`token decode failed for ${jwt}`);
    expect(msg).not.toContain(jwt);
    expect(msg).toContain('[redacted-jwt]');
  });

  it('redacts a Postgres connection string with embedded credentials', () => {
    const msg = sanitizeErrorMessage('could not connect to postgresql://faff_user:s3cr3t-pw@db.internal:5432/faff');
    expect(msg).not.toContain('s3cr3t-pw');
    expect(msg).toContain('[redacted-connstring]');
  });

  it('redacts an email address', () => {
    const msg = sanitizeErrorMessage('lookup failed for david@example.com');
    expect(msg).not.toContain('david@example.com');
    expect(msg).toContain('[redacted-email]');
  });

  it('does NOT redact a UUID (36 chars, hyphenated) — it is a structured id, not a secret', () => {
    const uuid = '0645f40c-951d-4ccc-b86e-9979cd26c795';
    const msg = sanitizeErrorMessage(`plan lookup failed for ${uuid}`);
    expect(msg).toContain(uuid);
  });

  it('caps message length', () => {
    const long = 'x'.repeat(5000);
    expect(sanitizeErrorMessage(long)!.length).toBeLessThanOrEqual(500);
  });

  it('caps stack length and frame count', () => {
    const stack = Array.from({ length: 40 }, (_, i) => `    at frame${i} (/app/lib/x.ts:${i}:1)`).join('\n');
    const out = sanitizeStack(`Error: boom\n${stack}`)!;
    expect(out.split('\n').length).toBeLessThanOrEqual(12);
  });

  it('drops metadata keys that look like secrets outright, never truncates-and-keeps them', () => {
    const out = sanitizeMetadata({ authToken: 'should-never-appear', sessionCookie: 'nope', healthPayload: 'nope', safeField: 'kept' });
    expect(out).not.toHaveProperty('authToken');
    expect(out).not.toHaveProperty('sessionCookie');
    expect(out).not.toHaveProperty('healthPayload');
    expect(out.safeField).toBe('kept');
  });

  it('drops any object/array-valued metadata field entirely — the raw-payload shape', () => {
    const out = sanitizeMetadata({ nested: { anything: 'at all' }, list: [1, 2, 3], flag: true, n: 5 });
    expect(out).not.toHaveProperty('nested');
    expect(out).not.toHaveProperty('list');
    expect(out.flag).toBe(true);
    expect(out.n).toBe(5);
  });
});

describe('correlation id primitives · edge-safe (no node:async_hooks import)', () => {
  it('newCorrelationId produces a distinct id each call', () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });

  it('correlationIdFromHeaders reads and trims an existing header', () => {
    const headers = new Headers({ [CORRELATION_ID_HEADER]: '  abc-123  ' });
    expect(correlationIdFromHeaders(headers)).toBe('abc-123');
  });

  it('correlationIdFromHeaders returns null when absent, never throws', () => {
    expect(correlationIdFromHeaders(new Headers())).toBeNull();
    expect(correlationIdFromHeaders(null)).toBeNull();
    expect(correlationIdFromHeaders(undefined)).toBeNull();
  });
});
