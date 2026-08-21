/**
 * Regression · a run that can never be pushed must still record the
 * attempt, and an indoor run must upload as an indoor run.
 *
 * 2026-08-21, found while reading the strava-push-poll cron output. Every
 * pass returned `retried_failed: 1` and nothing ever changed. The cron caps
 * retries with `COUNT(*) < 3` over the strava_pushes rows for a run, but
 * pushRunToStrava returned before its INSERT on two paths — 'run not found'
 * and 'merged run, skip push' — so the count never advanced. David's
 * 2026-05-31 run, merged into a canonical sibling in June, had been
 * re-attempted twice an hour ever since. The cap was inert for exactly the
 * failures it was written to bound.
 *
 * What David lost: nothing visible, which is the point. A silent loop with
 * no exit and no record of itself.
 *
 * Both first tests fail against the old push.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db/pool', () => ({ pool: { query: (...a: any[]) => query(...a) } }));
vi.mock('./auth', () => ({ getStravaToken: vi.fn(async () => 'tok') }));

import { pushRunToStrava, isIndoorRun } from './push';

/** Insert statements against strava_pushes, with their params. */
function inserts() {
  return query.mock.calls.filter((c) => /INSERT INTO strava_pushes/.test(String(c[0])));
}

beforeEach(() => {
  query.mockReset();
  vi.unstubAllGlobals();
});

describe('pushRunToStrava · runs that cannot be pushed', () => {
  it('records the attempt when the run does not resolve', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO strava_pushes/.test(sql)) return { rows: [{ id: 99 }] };
      return { rows: [] }; // no prior push, no run row
    });
    const r = await pushRunToStrava('u1', 'missing-run');
    expect(r.status).toBe('failed');
    expect(r.error).toBe('run not found');
    const ins = inserts();
    expect(ins).toHaveLength(1);
    expect(String(ins[0][0])).toMatch(/'failed'/);
    expect(ins[0][1]).toContain('run not found');
  });

  it('records the attempt when the run was merged away', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO strava_pushes/.test(sql)) return { rows: [{ id: 100 }] };
      if (/FROM runs/.test(sql)) {
        return { rows: [{ data: { id: 'r1', date: '2026-05-31', mergedIntoId: -1466010895152803 } }] };
      }
      return { rows: [] };
    });
    const r = await pushRunToStrava('u1', 'r1');
    expect(r.status).toBe('failed');
    expect(r.error).toBe('merged run, skip push');
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0][1]).toContain('merged run, skip push');
  });

  it('never reaches Strava for either case', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    query.mockImplementation(async (sql: string) =>
      /INSERT INTO strava_pushes/.test(sql) ? { rows: [{ id: 1 }] } : { rows: [] });
    await pushRunToStrava('u1', 'missing-run');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('isIndoorRun', () => {
  it('reads the indoor flag', () => {
    expect(isIndoorRun({ indoor: true })).toBe(true);
  });
  it('reads a treadmill source', () => {
    // The prod shape: source 'treadmill', no polyline.
    expect(isIndoorRun({ source: 'treadmill', routePolyline: null })).toBe(true);
  });
  it('leaves an outdoor run alone', () => {
    expect(isIndoorRun({ source: 'apple_watch', indoor: false })).toBe(false);
    expect(isIndoorRun({ source: 'watch' })).toBe(false);
    expect(isIndoorRun(null)).toBe(false);
  });
});

describe('pushRunToStrava · upload form', () => {
  async function formFor(run: any): Promise<FormData> {
    let captured: FormData | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
      // Only the multipart upload carries a body; the follow-up status
      // poll does not, and must not clobber what we captured.
      if (init?.body instanceof FormData) captured = init.body;
      return { ok: true, status: 200, json: async () => ({ id: 1 }), text: async () => '' };
    }));
    query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO strava_pushes/.test(sql)) return { rows: [{ id: 7 }] };
      if (/FROM runs/.test(sql)) return { rows: [{ data: run }] };
      return { rows: [] };
    });
    await pushRunToStrava('u1', run.id);
    return captured!;
  }

  it('flags a treadmill run as a trainer activity', async () => {
    const form = await formFor({
      id: 'trd_1', source: 'treadmill', indoor: true, date: '2026-08-18',
      startLocal: '2026-08-18T15:39:58', durationSec: 2254, distanceMi: 4.01,
      timezone: 'America/Los_Angeles', routePolyline: null,
    });
    expect(form.get('trainer')).toBe('true');
  });

  it('leaves an outdoor run untagged', async () => {
    const form = await formFor({
      id: 'wko_1', source: 'apple_watch', date: '2026-08-16',
      startLocal: '2026-08-16T06:15:00', durationSec: 3600, distanceMi: 6,
      timezone: 'America/Los_Angeles', routePolyline: null,
    });
    expect(form.get('trainer')).toBe('false');
  });
});
