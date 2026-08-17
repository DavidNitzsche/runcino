/**
 * 2026-08-17 · F1 regression lock — the fade that never fired.
 *
 * vdot-anchor-fade.test.ts proves bestRecentVdot fades correctly when
 * candidates are fed IN-MEMORY. Prod cliffed anyway on Aug 1 (47.9 → 44.1
 * overnight, 15 days before the A-race) because loadVdotInputs applied a
 * hard 180-day SQL cutoff — fade-window candidates (age 180..300) never
 * left the database, so the fade had nothing to fade. That gap is exactly
 * what a unit test with in-memory fixtures cannot see.
 *
 * These tests go THROUGH loadVdotInputs' windowing logic: the pool is
 * mocked, but the mock applies the date-window predicate the real SQL
 * expresses, using the cutoff parameter the code under test computed. If
 * the loader ever regresses to a hard `windowDays` fetch again, Disney
 * drops out of the returned candidates on Aug 1 and the continuity
 * assertions below cliff exactly like prod did.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/training/max-hr', () => ({
  loadEffectiveMaxHr: vi.fn().mockResolvedValue({ bpm: 191, source: 'user_settings' }),
}));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { loadVdotInputs } from './vdot-inputs';
import { bestRecentVdot, FADE_TAIL_DAYS } from './vdot';

const USER = 'user-uuid-test';

/** The runner's real A/B race history as `races` table rows (meta +
 *  actual_result jsonb), the shape the loader's SQL reads. */
const RACE_TABLE = [
  { slug: 'rose-bowl-half-2026', meta: { name: 'Rose Bowl Half', date: '2026-01-18', priority: 'A', distanceMi: 13.109 }, actual_result: { finishS: 5918 } },
  { slug: 'disney-half-2026', meta: { name: 'Disney Half Marathon', date: '2026-02-01', priority: 'A', distanceMi: 13.109 }, actual_result: { finishS: 5694 } },
  { slug: 'la-marathon-2026', meta: { name: 'LA Marathon', date: '2026-03-08', priority: 'A', distanceMi: 26.219 }, actual_result: { finishS: 12700 } },
];

type QueryMock = ReturnType<typeof vi.fn>;
const queryMock = pool.query as unknown as QueryMock;

beforeEach(() => {
  queryMock.mockReset();
  // Emulate the SQL WHERE clauses with the PARAMETERS the code under test
  // computed — the race-date window predicate is the thing being tested.
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM races')) {
      const [, cutoff, today] = (params ?? []) as string[];
      return {
        rows: RACE_TABLE.filter((r) =>
          r.meta.date >= cutoff &&
          r.meta.date < today &&
          ['A', 'B'].includes(r.meta.priority)),
      };
    }
    // Both run queries (Strava match-fallback + run candidates): no runs in
    // this fixture — race anchors only, isolating the windowing behavior.
    if (sql.includes('FROM runs')) return { rows: [] };
    throw new Error('unexpected query in vdot-inputs-window test: ' + sql.slice(0, 100));
  });
});

const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

async function headlineVdot(today: string): Promise<number | null> {
  const { raceCandidates, runCandidates } = await loadVdotInputs(USER, today);
  const { best } = bestRecentVdot(raceCandidates, today, 180, runCandidates, 4);
  return best?.vdot ?? null;
}

describe('loadVdotInputs windowing — fade-tail candidates reach bestRecentVdot', () => {
  it('fetches races over lookbackDays + FADE_TAIL_DAYS, not a hard 180d wall', async () => {
    // Aug 17: Disney is 197 days old — outside the old 180d SQL window,
    // inside the fade tail. It MUST come back from the loader.
    const { raceCandidates } = await loadVdotInputs(USER, '2026-08-17');
    expect(raceCandidates.map((r) => r.slug)).toContain('disney-half-2026');
    // And the tail has a real end: a race older than 180 + FADE_TAIL_DAYS
    // is legitimately excluded. Rose Bowl (2026-01-18) crosses that line
    // 300 days later.
    const past = await loadVdotInputs(USER, addDays('2026-01-18', 180 + FADE_TAIL_DAYS + 1));
    expect(past.raceCandidates.map((r) => r.slug)).not.toContain('rose-bowl-half-2026');
  });

  it('Aug 1 (the prod cliff day): Disney fades through the pipeline, no cliff', async () => {
    const jul31 = await headlineVdot('2026-07-31');
    const aug1 = await headlineVdot('2026-08-01');
    // Prod: 47.9 → 44.1 overnight. Fixed pipeline: 47.9 → 47.9 (fade is
    // 0.1 VDOT per 14 days — invisible at day granularity).
    expect(jul31).toBe(47.9);
    expect(aug1).toBeGreaterThanOrEqual(47.8);
    expect(Math.abs(aug1! - jul31!)).toBeLessThanOrEqual(0.5);
  });

  it('continuity: no >0.5 single-day VDOT move from windowing alone (Jul 25 → Aug 20)', async () => {
    let prev = await headlineVdot('2026-07-25');
    for (let d = 1; d <= 26; d++) {
      const today = addDays('2026-07-25', d);
      const v = await headlineVdot(today);
      expect(v, `headline VDOT null on ${today}`).not.toBeNull();
      expect(Math.abs(v! - prev!), `cliff on ${today}: ${prev} → ${v}`).toBeLessThanOrEqual(0.5);
      prev = v;
    }
    // And the endpoint is the honest glide value, matching the in-memory
    // fade tests: 47.8 on race morning ±.
    expect(prev).toBe(47.8);
  });

  it('Aug 17 headline through the full pipeline: 47.8 (faded Disney), not 44.1', async () => {
    // Scenario (a) of the Aug-17 prod state — AFC result not yet logged.
    expect(await headlineVdot('2026-08-17')).toBe(47.8);
  });

  it('fresh race precedence survives the pipeline: logging AFC flips the anchor to it', async () => {
    // Scenario (b): the AFC Half result (Aug 16, 1:41:53) lands in races.
    RACE_TABLE.push({ slug: 'afc-half-2026', meta: { name: 'AFC Half', date: '2026-08-16', priority: 'A', distanceMi: 13.109 }, actual_result: { finishS: 6113 } });
    try {
      const { raceCandidates, runCandidates } = await loadVdotInputs(USER, '2026-08-17');
      const { best } = bestRecentVdot(raceCandidates, '2026-08-17', 180, runCandidates, 4);
      expect(best).not.toBeNull();
      // The faded 47.8 Disney must NOT outrank the fresh A-race reality.
      expect(best!.age_days).toBeLessThanOrEqual(180);
      expect(best!.vdot).toBeLessThan(45);
      expect(best!.vdot).toBeGreaterThanOrEqual(43.6);
    } finally {
      RACE_TABLE.pop();
    }
  });
});
