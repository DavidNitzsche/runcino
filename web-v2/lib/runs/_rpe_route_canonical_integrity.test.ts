/**
 * `/api/runs/[id]/rpe` · CANONICAL-ROW INTEGRITY.
 *
 * The defect this proves closed: every write here used to key
 * `post_run_rpe.activity_id` on whatever string the client sent, with no
 * check against `runs` at all. An RPE submitted against an ABSORBED run's
 * id (a real, common shape — two sources reporting one run, the loser kept
 * as a pointer row per `lib/runs/canonical.ts`) wrote a row keyed to an id
 * nothing reads by again: `loadRunDetail`'s FORM read and this route's own
 * GET both resolve through the CANONICAL row's id, never the loser's.
 *
 * `resolveCanonicalRunRowId` (`lib/runs/canonical-ref.ts`) already has its
 * own full test suite for the resolution ladder itself
 * (`lib/runs/_run_id_one_answer.test.ts`) — this file does not re-test that
 * ladder. It mocks the resolver's ANSWER and asserts what THIS route does
 * with it: the write goes to the canonical id, never the request id; an
 * ambiguous day refuses outright rather than guessing; GET degrades
 * gracefully only for the one reason that is not a resolution failure.
 *
 * LIVES IN `lib/runs/`, NOT BESIDE `route.ts`. `vitest.config.ts`'s
 * `include` is `lib/**` only — no `app/**` test has ever run in this
 * project, which reads as a deliberate convention (routes stay thin
 * wrappers over tested `lib/` functions) rather than an oversight, so this
 * pass did not widen the test glob to fit one file. It imports the real
 * route module through the `@/` alias and exercises the actual exported
 * `GET`/`POST`, same as if it sat next to them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const queryMock = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

vi.mock('@/lib/auth/session', () => ({
  requireUserId: vi.fn(async () => USER),
}));

const resolveMock = vi.fn();
vi.mock('@/lib/runs/canonical-ref', () => ({
  resolveCanonicalRunRowId: (...args: unknown[]) => resolveMock(...args),
}));

vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn(async () => {}) }));

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const ABSORBED_ID = '19998028774';       // the loser's own spelling
const CANONICAL_ID = '20554811203';      // what it was merged into

beforeEach(() => {
  queryMock.mockReset();
  resolveMock.mockReset();
});

function postReq(body: unknown): NextRequest {
  return new NextRequest(`https://x/api/runs/${ABSORBED_ID}/rpe`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}
function getReq(): NextRequest {
  return new NextRequest(`https://x/api/runs/${ABSORBED_ID}/rpe`, { method: 'GET' });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('POST · an absorbed id writes to the SURVIVOR, never to itself', () => {
  it('resolves via the absorbed_pointer rung and upserts on the canonical id', async () => {
    resolveMock.mockResolvedValueOnce({ ok: true, rowId: CANONICAL_ID, via: 'absorbed_pointer' });
    queryMock.mockResolvedValueOnce({ rows: [{ rpe: 6, notes: null, logged_at: '2026-09-03T00:00:00Z' }] });

    const { POST } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await POST(postReq({ rpe: 6 }), params(ABSORBED_ID));
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(resolveMock).toHaveBeenCalledWith(USER, ABSORBED_ID);
    // The one assertion this whole file exists for: the id that reached the
    // INSERT is the CANONICAL row's id, never the absorbed id the request
    // actually carried.
    const [, params_] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params_).toContain(CANONICAL_ID);
    expect(params_).not.toContain(ABSORBED_ID);
  });

  it('refuses an ambiguous day outright — no query is ever issued', async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, reason: 'ambiguous_day' });

    const { POST } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await POST(postReq({ rpe: 6 }), params(ABSORBED_ID));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    // NOT a softer claim than "no row was written" — no attempt was made.
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('refuses when no run on the account matches the id at all', async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, reason: 'no_such_run' });

    const { POST } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await POST(postReq({ rpe: 6 }), params('not-a-real-run'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('a second submission under a DIFFERENT spelling of the same run updates the SAME row', async () => {
    // Two requests, two different id spellings, both resolving to the same
    // canonical row — the exact shape a duplicate-source ingest produces.
    resolveMock.mockResolvedValueOnce({ ok: true, rowId: CANONICAL_ID, via: 'canonical' });
    queryMock.mockResolvedValueOnce({ rows: [{ rpe: 5, notes: null, logged_at: '2026-09-03T00:00:00Z' }] });
    const { POST } = await import('@/app/api/runs/[id]/rpe/route');
    await POST(postReq({ rpe: 5 }), params(CANONICAL_ID));
    const firstParams = queryMock.mock.calls[0][1] as unknown[];

    resolveMock.mockResolvedValueOnce({ ok: true, rowId: CANONICAL_ID, via: 'absorbed_pointer' });
    queryMock.mockResolvedValueOnce({ rows: [{ rpe: 8, notes: null, logged_at: '2026-09-03T00:01:00Z' }] });
    await POST(postReq({ rpe: 8 }), params(ABSORBED_ID));
    const secondParams = queryMock.mock.calls[1][1] as unknown[];

    // Same upsert key both times — this is what "one row, not two" means at
    // the query level: the UNIQUE constraint is (user_id, activity_id), so
    // identical `activity_id` values is the whole guarantee.
    expect(firstParams).toContain(CANONICAL_ID);
    expect(secondParams).toContain(CANONICAL_ID);
  });
});

describe('GET · reads the same canonical id the POST above wrote to', () => {
  it('resolves the absorbed id and reads the canonical row, not the literal request id', async () => {
    resolveMock.mockResolvedValueOnce({ ok: true, rowId: CANONICAL_ID, via: 'absorbed_pointer' });
    queryMock.mockResolvedValueOnce({ rows: [{ rpe: 8, notes: null, logged_at: '2026-09-03T00:01:00Z' }] });

    const { GET } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await GET(getReq(), params(ABSORBED_ID));
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.rpe?.rpe).toBe(8);
    const [, params_] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params_).toContain(CANONICAL_ID);
    expect(params_).not.toContain(ABSORBED_ID);
  });

  it('refuses an ambiguous day rather than guessing which run to read', async () => {
    resolveMock.mockResolvedValueOnce({ ok: false, reason: 'ambiguous_day' });
    const { GET } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await GET(getReq(), params(ABSORBED_ID));
    expect(res.status).toBe(409);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('falls back to the literal id only for the non-adversarial no_such_run case', async () => {
    // An id shape the five rungs do not cover (Rule 11: this is not the
    // same fact as "ambiguous" or "written wrong") — GET still tries the
    // literal string rather than manufacturing a refusal for a case that
    // was always going to read as "nothing recorded yet".
    resolveMock.mockResolvedValueOnce({ ok: false, reason: 'no_such_run' });
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { GET } = await import('@/app/api/runs/[id]/rpe/route');
    const res = await GET(getReq(), params('some-unresolvable-id'));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.rpe).toBeNull();
    const [, params_] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params_).toContain('some-unresolvable-id');
  });
});
