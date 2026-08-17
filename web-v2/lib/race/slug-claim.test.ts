/**
 * lib/race/slug-claim.test.ts
 *
 * 2026-08-17 · races global-slug residual risk, code side. POST /api/race
 * used a SELECT precheck (errors swallowed → rows:[]) followed by an
 * unconditional ON CONFLICT DO UPDATE — a precheck failure or a lost race
 * between check and write merged one runner's meta into ANOTHER user's
 * row. Now the upsert carries the ownership guard itself.
 *
 *   F1  free/own slug → single INSERT, natural slug kept (idempotent
 *       same-user re-add preserved — this is why DO NOTHING was rejected)
 *   F2  foreign-owned slug (guarded upsert reports rowCount 0) → retried
 *       once with the userId-suffixed slug, response carries the suffix
 *   F3  the upsert SQL itself carries the ownership WHERE — no
 *       error-swallowing precheck remains in the file
 *   F4  both suffixed and natural claim rejected → 409, never a merge
 *
 * Mock style: vi.mock pool with query-text dispatch, same as
 * races-state.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/auth/session', async () => ({
  requireUserId: vi.fn().mockResolvedValue('abcdef12-3456-7890-abcd-ef1234567890'),
}));
vi.mock('@/lib/coach/cache', () => ({ bustBriefingCacheForEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/plan/generate', () => ({ generatePlan: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('@/lib/coach/settings', () => ({ patchSettings: vi.fn().mockResolvedValue(undefined) }));

import { pool } from '@/lib/db/pool';
import { POST } from '@/app/api/race/route';

const USER8 = 'abcdef12';

function raceReq(): Request {
  return new Request('http://test.local/api/race', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'City Half', date: '2026-10-04', distance_label: 'Half Marathon', priority: 'B' }),
  });
}

/** rowCounts consumed per INSERT INTO races call, in order. */
function dispatch(insertRowCounts: number[]): void {
  let i = 0;
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO races')) {
      return Promise.resolve({ rows: [], rowCount: insertRowCounts[i++] ?? 0 });
    }
    if (typeof sql === 'string' && sql.includes('FROM training_plans')) {
      return Promise.resolve({ rows: [{ race_id: 'other-race' }] }); // active plan → no auto-generate
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function insertCalls(): Array<[string, unknown[]]> {
  return (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO races'),
  ) as Array<[string, unknown[]]>;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/race · atomic slug claim', () => {
  it('F1 · free or self-owned slug claims on first try, natural slug kept', async () => {
    dispatch([1]);
    const res = await POST(raceReq() as never);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.slug).toBe('city-half-2026-10-04');
    expect(insertCalls().length).toBe(1);
  });

  it('F2 · foreign-owned slug retries once with the userId suffix', async () => {
    dispatch([0, 1]);
    const res = await POST(raceReq() as never);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.slug).toBe(`city-half-2026-10-04-${USER8}`);
    const calls = insertCalls();
    expect(calls.length).toBe(2);
    expect(calls[0][1][0]).toBe('city-half-2026-10-04');
    expect(calls[1][1][0]).toBe(`city-half-2026-10-04-${USER8}`);
  });

  it('F3 · the upsert is ownership-guarded and the swallowed precheck is gone', async () => {
    dispatch([1]);
    await POST(raceReq() as never);
    const [sql] = insertCalls()[0];
    expect(sql).toMatch(/WHERE races\.user_uuid = EXCLUDED\.user_uuid/);
    const src = readFileSync(path.join(process.cwd(), 'app', 'api', 'race', 'route.ts'), 'utf8');
    expect(src).not.toMatch(/catch\(\(\) => \(\{ rows: \[\] as Array<\{ u: string \}> \}\)\)/);
  });

  it('F4 · both claims rejected → 409, never a cross-user merge', async () => {
    dispatch([0, 0]);
    const res = await POST(raceReq() as never);
    expect(res.status).toBe(409);
    expect(insertCalls().length).toBe(2);
  });
});
