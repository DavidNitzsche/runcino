/**
 * lib/plan/_bump_pullback_guard.test.ts · the pull-down / push-up window.
 *
 * The defect (2026-08-28 audit): `tryAdaptiveBump` only skipped when
 * pull-back actions fired the SAME cron tick, so a red-readiness downgrade
 * applied Monday did not stop a volume bump Tuesday. Doctrine spaces hard
 * from easy in DAYS (Research/00b §"The Hard-Easy Principle" · "hard day →
 * 1–2 easy/recovery/rest days → next hard day"), so the guard is now a
 * 48-hour lookback over the adapter's own applied pull-back intents.
 *
 * Locked here:
 *   · pull-back Monday BLOCKS a bump Tuesday, ALLOWS one Thursday (pure)
 *   · the DB-shell path stands down before any ramp evaluation runs
 *   · the guard fails CLOSED when the intents read fails
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
}));

import { pool } from '@/lib/db/pool';
import {
  PULLBACK_BUMP_LOOKBACK_HOURS,
  PULLBACK_INTENT_REASONS,
  pullbackBlocksBump,
  tryAdaptiveBump,
} from './adaptive-ramp';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
let issued: string[] = [];

const UUID = '00000000-0000-0000-0000-000000000042';

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · the pure window
 * ═══════════════════════════════════════════════════════════════════════ */

describe('1 · pullbackBlocksBump', () => {
  // The brief's exact scenario: the 03:00 cron applied a readiness downgrade
  // Monday morning; the Tuesday and Thursday crons then consider a bump.
  const MONDAY_PULLBACK = '2026-08-24T03:05:00Z';
  const TUESDAY_CRON = Date.parse('2026-08-25T03:00:00Z');
  const THURSDAY_CRON = Date.parse('2026-08-27T03:00:00Z');

  it('a pull-back Monday blocks a bump Tuesday', () => {
    expect(pullbackBlocksBump(MONDAY_PULLBACK, TUESDAY_CRON)).toBe(true);
  });

  it('and allows one Thursday · the window is 48h, not forever', () => {
    expect(pullbackBlocksBump(MONDAY_PULLBACK, THURSDAY_CRON)).toBe(false);
  });

  it('no pull-back on record does not block', () => {
    expect(pullbackBlocksBump(null, TUESDAY_CRON)).toBe(false);
    expect(pullbackBlocksBump(undefined, TUESDAY_CRON)).toBe(false);
  });

  it('an unparseable timestamp blocks · a guard that cannot read its evidence does not wave load through', () => {
    expect(pullbackBlocksBump('not-a-date', TUESDAY_CRON)).toBe(true);
  });

  it('the window is the doctrine window · 48h', () => {
    expect(PULLBACK_BUMP_LOOKBACK_HOURS).toBe(48);
  });

  it('the reasons cover downgrade, shave, and the red-readiness record', () => {
    expect([...PULLBACK_INTENT_REASONS]).toEqual(expect.arrayContaining([
      'plan_adapt_downgrade', 'plan_adapt_shave', 'readiness_convergence_red_no_quality',
    ]));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · the DB shell
 * ═══════════════════════════════════════════════════════════════════════ */

function routeQueries(handler: (sql: string) => { rows: Record<string, unknown>[] } | 'throw') {
  query.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    issued.push(text);
    const r = handler(text);
    if (r === 'throw') throw new Error('connection terminated');
    return { rows: r.rows, rowCount: r.rows.length };
  });
}

describe('2 · tryAdaptiveBump lookback', () => {
  it('same-tick pull-back still short-circuits before any read', async () => {
    routeQueries(() => ({ rows: [] }));
    expect(await tryAdaptiveBump(UUID, true)).toBeNull();
    expect(issued).toEqual([]);
  });

  it('a pull-back intent inside 48h blocks the bump before the ramp is even evaluated', async () => {
    routeQueries((sql) => {
      if (sql.includes('MAX(ts)')) {
        return { rows: [{ ts: new Date(Date.now() - 12 * 3600_000).toISOString() }] };
      }
      return { rows: [] };
    });
    expect(await tryAdaptiveBump(UUID, false)).toBeNull();
    // Stood down at the guard: the ramp's plan lookup never ran.
    expect(issued.some((s) => s.includes('training_plans'))).toBe(false);
  });

  it('a pull-back older than 48h does not block · the ramp evaluation proceeds', async () => {
    routeQueries((sql) => {
      if (sql.includes('MAX(ts)')) {
        return { rows: [{ ts: new Date(Date.now() - 72 * 3600_000).toISOString() }] };
      }
      return { rows: [] }; // no active plan → ramp returns null further down
    });
    expect(await tryAdaptiveBump(UUID, false)).toBeNull();
    // Proof the guard let it through: the ramp reached its plan lookup.
    expect(issued.some((s) => s.includes('training_plans'))).toBe(true);
  });

  it('fails CLOSED · an unreadable intents table is not "no recent pull-back"', async () => {
    routeQueries((sql) => (sql.includes('MAX(ts)') ? 'throw' : { rows: [] }));
    expect(await tryAdaptiveBump(UUID, false)).toBeNull();
    expect(issued.some((s) => s.includes('training_plans'))).toBe(false);
  });
});
