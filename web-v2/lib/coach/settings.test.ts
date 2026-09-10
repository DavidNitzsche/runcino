/**
 * lib/coach/settings.test.ts · SETTINGS-RULE11-1
 *
 * `loadSettings` used to swallow every DB error into `DEFAULT_SETTINGS` —
 * byte-identical to a runner who has genuinely never customized anything.
 * That is a Rule 11 violation (CLAUDE.md): "don't know", "measured zero" and
 * "the read failed" collapsed into one fact.
 *
 * This file asserts the two cases that must now be told apart:
 *
 *   1. Genuine absence — no `profile` row, or a row with an empty
 *      `user_settings` — resolves cleanly to `DEFAULT_SETTINGS`. No throw.
 *   2. Genuine failure — `pool.query` rejects — now REJECTS the promise
 *      instead of quietly resolving to `DEFAULT_SETTINGS`. This is the
 *      failing-before / passing-after case: run it against the unfixed
 *      catch-all and it fails (Rule 18 — falsify the gate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '@/lib/db/pool';
import { loadSettings, DEFAULT_SETTINGS } from '@/lib/coach/settings';

const USER = 'abcdef12-3456-7890-abcd-ef1234567890';

describe('loadSettings · Rule 11 (genuine absence vs. genuine failure)', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('genuine absence (no row) resolves to DEFAULT_SETTINGS, not a throw', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    await expect(loadSettings(USER)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('genuine absence (row present, user_settings null/empty) resolves to DEFAULT_SETTINGS', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ user_settings: null }] } as any);
    await expect(loadSettings(USER)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('a customized row is returned, merged over the defaults', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ user_settings: { long_run_day: 'sat', push_enabled: false } }],
    } as any);
    const s = await loadSettings(USER);
    expect(s.long_run_day).toBe('sat');
    expect(s.push_enabled).toBe(false);
    // Untouched fields still carry the default.
    expect(s.units_distance).toBe(DEFAULT_SETTINGS.units_distance);
  });

  it('FAIL-BEFORE/PASS-AFTER · a genuine DB failure must not resolve to DEFAULT_SETTINGS', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    vi.mocked(pool.query).mockRejectedValueOnce(dbError);

    // Pre-fix, this call resolved to DEFAULT_SETTINGS — indistinguishable
    // from the "genuine absence" cases above. Post-fix it must reject, so a
    // caller (and ultimately the /api/settings route's own try/catch) can
    // tell the two apart.
    await expect(loadSettings(USER)).rejects.toThrow('connection terminated unexpectedly');
  });

  it('a rejection is never coincidentally equal to DEFAULT_SETTINGS', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('boom'));
    let resolved: unknown = Symbol('not resolved');
    try {
      resolved = await loadSettings(USER);
    } catch {
      // expected — resolved stays the sentinel
    }
    expect(resolved).not.toEqual(DEFAULT_SETTINGS);
  });
});
