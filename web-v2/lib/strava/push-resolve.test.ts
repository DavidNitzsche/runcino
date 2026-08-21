/**
 * Regression · resolvePendingPush must read Strava's `status`, not only
 * `error` and `activity_id`.
 *
 * 2026-08-21. A rejected Strava upload comes back as:
 *
 *   { "id": 20964239861, "error": null,
 *     "status": "There was an error processing your activity.",
 *     "activity_id": null }
 *
 * `error` is null. The old resolver read `activity_id` then `error`, found
 * neither, and returned 'pending'. So a push Strava had already refused sat
 * in the live window being re-polled every 30 minutes for a full day, until
 * the cron's 24h sweep buried it under an invented message about an expired
 * upload id. The id had not expired: it still answered five days later,
 * with the same verdict, which is how this was diagnosed.
 *
 * What David lost: the real reason, on every failed push, for two months.
 *
 * The first test here fails against the old resolver.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: any[]) => query(...a) } }));
vi.mock('./auth', () => ({ getStravaToken: vi.fn(async () => 'tok') }));

import { resolvePendingPush } from './push';

/** Every UPDATE the resolver wrote, as { status, message }. */
function writes(): Array<{ status: string; message: string | null }> {
  return query.mock.calls
    .filter((c) => /UPDATE strava_pushes/.test(String(c[0])))
    .map((c) => {
      const sql = String(c[0]);
      const status = sql.match(/status\s*=\s*'(\w+)'/)?.[1] ?? '?';
      const params = (c[1] ?? []) as any[];
      return { status, message: typeof params[0] === 'string' ? params[0] : null };
    });
}

function stravaReturns(json: any, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  })));
}

const PUSH = { id: 44, run_id: 'trd_A52AE3D4', strava_upload_id: 20964239861 };

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  vi.unstubAllGlobals();
});

describe('resolvePendingPush · Strava verdicts', () => {
  it('marks a rejected upload failed and records Strava\'s own words', async () => {
    // The exact prod payload for upload 20964239861.
    stravaReturns({
      id: 20964239861,
      external_id: 'faff-trd_A52AE3D4-AF74-44DF-84F6-41C8EAF082C2.tcx',
      error: null,
      status: 'There was an error processing your activity.',
      activity_id: null,
    });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('There was an error processing your activity.');
    const w = writes();
    expect(w).toHaveLength(1);
    expect(w[0].status).toBe('failed');
    expect(w[0].message).toBe('There was an error processing your activity.');
  });

  it('leaves a still-processing upload pending', async () => {
    stravaReturns({ error: null, status: 'Your activity is still being processed.', activity_id: null });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('pending');
    expect(writes()).toHaveLength(0);
  });

  it('leaves an unrecognized status pending rather than failing a good push', async () => {
    // Strava changing its wording must slow us down, not bury a live push.
    stravaReturns({ error: null, status: 'Queued behind 3 other uploads.', activity_id: null });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('pending');
    expect(writes()).toHaveLength(0);
  });

  it('still resolves a successful upload from activity_id', async () => {
    stravaReturns({ error: null, status: 'Your activity is ready.', activity_id: 19768940238 });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('uploaded');
    expect(r.stravaActivityId).toBe(19768940238);
    expect(writes()[0].status).toBe('uploaded');
  });

  it('still prefers the error field when Strava populates it', async () => {
    stravaReturns({ error: 'duplicate of activity 123', status: 'Your activity is ready.', activity_id: null });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('duplicate');
  });

  it('reads a duplicate verdict out of status too', async () => {
    stravaReturns({ error: null, status: 'This activity is a duplicate of an existing one.', activity_id: null });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('duplicate');
  });

  it('treats a deleted upload as terminal', async () => {
    stravaReturns({ error: null, status: 'The created activity has been deleted.', activity_id: null });
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('failed');
  });

  it('stays pending on a transient non-OK response', async () => {
    stravaReturns({}, 500);
    const r = await resolvePendingPush('u1', PUSH);
    expect(r.status).toBe('pending');
    expect(writes()).toHaveLength(0);
  });

  it('stays pending with no upload id', async () => {
    const r = await resolvePendingPush('u1', { ...PUSH, strava_upload_id: null });
    expect(r.status).toBe('pending');
  });
});
