/**
 * lib/auth/login-tz-capture.test.ts
 *
 * 2026-08-17 · multi-user hygiene: web-only runners never sync from iOS,
 * so profile.timezone stayed NULL and runner-tz fell to UTC/Pacific
 * fallbacks. Login now accepts a browser-detected IANA timezone and
 * persists it FILL-ONLY (never clobbering an existing value).
 *
 *   F1  valid timezone on login → guarded UPDATE fires, and its SQL
 *       carries the never-clobber predicate (timezone IS NULL OR '')
 *   F2  junk timezone → dropped, no timezone UPDATE at all
 *   F3  no timezone field (legacy clients) → no timezone UPDATE
 *   F4  onboarding-complete writes are COALESCE-guarded in source (the
 *       route is too heavy to drive end-to-end here; the guard is the
 *       load-bearing text)
 *
 * Mock style: vi.mock pool + createSession, query-text dispatch — same
 * pattern as races-state.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  createSession: vi.fn().mockResolvedValue({ token: 'tok', expiresAt: '2026-12-01T00:00:00.000Z' }),
}));
vi.mock('@/lib/auth/rate-limit', () => ({ authRateLimited: vi.fn().mockReturnValue(false) }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue('h') },
}));

import { pool } from '@/lib/db/pool';
import { POST } from '@/app/api/auth/email/route';

const USER = '11111111-2222-3333-4444-555555555555';

function dispatch(): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('FROM users WHERE email')) {
      return Promise.resolve({
        rows: [{
          user_uuid: USER, password_hash: 'stored-hash', status: 'active',
          onboarding_complete: true, is_admin: false, email_verified_at: '2026-06-01',
        }],
      });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function loginReq(body: Record<string, unknown>): Request {
  return new Request('http://test.local/api/auth/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function timezoneUpdateCalls(): Array<[string, unknown[]]> {
  return (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([sql]) => typeof sql === 'string' && /SET timezone/.test(sql),
  ) as Array<[string, unknown[]]>;
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatch();
});

describe('POST /api/auth/email · browser timezone capture', () => {
  it('F1 · valid IANA tz persists via a never-clobber-guarded UPDATE', async () => {
    const res = await POST(loginReq({ email: 'a@b.c', password: 'secret1', timezone: 'Europe/Berlin' }) as never);
    expect(res.status).toBe(200);
    const calls = timezoneUpdateCalls();
    expect(calls.length).toBeGreaterThanOrEqual(1); // profile (+ users)
    for (const [sql, params] of calls) {
      // The fill-only predicate is the whole point: an iOS-synced value
      // must never be overwritten by the browser's detection.
      expect(sql).toMatch(/timezone IS NULL OR timezone = ''/);
      expect(params?.[0]).toBe('Europe/Berlin');
    }
  });

  it('F2 · junk timezone is dropped before it reaches the DB', async () => {
    const res = await POST(loginReq({ email: 'a@b.c', password: 'secret1', timezone: 'Not/AZone' }) as never);
    expect(res.status).toBe(200);
    expect(timezoneUpdateCalls()).toEqual([]);
  });

  it('F3 · legacy clients without the field log in untouched', async () => {
    const res = await POST(loginReq({ email: 'a@b.c', password: 'secret1' }) as never);
    expect(res.status).toBe(200);
    expect(timezoneUpdateCalls()).toEqual([]);
  });
});

describe('onboarding-complete timezone writes are fill-only (source guard)', () => {
  it('F4 · both users + profile UPDATEs COALESCE the existing timezone', () => {
    const src = readFileSync(
      path.join(process.cwd(), 'app', 'api', 'onboarding', 'complete', 'route.ts'), 'utf8');
    const guarded = src.match(/timezone\s*=\s*COALESCE\(NULLIF\(timezone, ''\), \$\d+\)/g) ?? [];
    expect(guarded.length, 'users + profile UPDATE both need the fill-only guard').toBeGreaterThanOrEqual(2);
    // And no remaining unguarded overwrite of the column in an UPDATE.
    expect(src).not.toMatch(/timezone\s*=\s*\$\d+,/);
  });
});
