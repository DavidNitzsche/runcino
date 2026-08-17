/**
 * 2026-08-17 · F1 regression lock — the fade that never fired.
 *
 * vdot-anchor-fade.test.ts proves bestRecentVdot fades correctly when
 * candidates are fed IN-MEMORY. Prod cliffed anyway because loadVdotInputs
 * applied a hard `windowDays` SQL cutoff — fade-window candidates never left
 * the database, so the fade had nothing to fade. That gap is exactly what a
 * unit test with in-memory fixtures cannot see.
 *
 * These tests go THROUGH loadVdotInputs' windowing logic: the pool is
 * mocked, but the mock applies the date-window predicate the real SQL
 * expresses, using the cutoff parameter the code under test computed. If the
 * loader ever regresses to a hard `windowDays` fetch again, the anchor drops
 * out of the returned candidates the day it crosses the full-value window and
 * the continuity assertions below cliff exactly like prod did.
 *
 * DOCTRINE-2 (2026-08-17): the window itself moved from 180 + 120 days to
 * Research/01's 56 + 28 (see vdot.ts VDOT_FULL_VALUE_DAYS). The INVARIANT
 * under test is unchanged — the loader must fetch the whole band the fade can
 * still see, never just the full-value window — so the scenario dates are
 * expressed relative to the constants rather than hardcoded.
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
import { bestRecentVdot, FADE_TAIL_DAYS, VDOT_FULL_VALUE_DAYS } from './vdot';

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
  const { best } = bestRecentVdot(raceCandidates, today, VDOT_FULL_VALUE_DAYS, runCandidates, 4);
  return best?.vdot ?? null;
}

describe('loadVdotInputs windowing — fade-tail candidates reach bestRecentVdot', () => {
  const DISNEY = '2026-02-01';

  it('fetches races over windowDays + FADE_TAIL_DAYS, not a hard full-value wall', async () => {
    // A day inside the floor-only band: past the full-value window, still
    // visible to the fade. The loader MUST return it.
    const inTail = addDays(DISNEY, VDOT_FULL_VALUE_DAYS + 5);
    const { raceCandidates } = await loadVdotInputs(USER, inTail);
    expect(raceCandidates.map((r) => r.slug)).toContain('disney-half-2026');
    // And the tail has a real end: past windowDays + FADE_TAIL_DAYS the race
    // is legitimately excluded (Research/01: "Expired").
    const past = await loadVdotInputs(USER, addDays(DISNEY, VDOT_FULL_VALUE_DAYS + FADE_TAIL_DAYS + 1));
    expect(past.raceCandidates.map((r) => r.slug)).not.toContain('disney-half-2026');
  });

  /** Run `fn` with only Disney in the races table.
   *
   *  The continuity guarantee this file exists to lock is about WINDOWING: an
   *  aging anchor must not vanish because the loader stopped fetching it. It is
   *  NOT a guarantee that the headline never steps — DOCTRINE-2's floor-only
   *  demotion makes a fresher race supersede a stale one the day the stale one
   *  leaves the full-value window, and that step is doctrine working, not a
   *  cliff. Isolating to a single anchor tests the loader and nothing else. */
  async function withOnlyDisney<T>(fn: () => Promise<T>): Promise<T> {
    const saved = RACE_TABLE.splice(0, RACE_TABLE.length);
    RACE_TABLE.push(saved.find((r) => r.slug === 'disney-half-2026')!);
    try { return await fn(); } finally {
      RACE_TABLE.splice(0, RACE_TABLE.length, ...saved);
    }
  }

  it('the old cliff day: crossing the full-value window fades, does not vanish', async () => {
    await withOnlyDisney(async () => {
      const dayBefore = await headlineVdot(addDays(DISNEY, VDOT_FULL_VALUE_DAYS));
      const dayAfter = await headlineVdot(addDays(DISNEY, VDOT_FULL_VALUE_DAYS + 1));
      expect(dayBefore).toBe(47.9);
      expect(dayAfter).not.toBeNull();
      // The fade is 0.1 VDOT per 14 days — invisible at day granularity.
      expect(Math.abs(dayAfter! - dayBefore!)).toBeLessThanOrEqual(0.5);
    });
  });

  it('continuity: no >0.5 single-day VDOT move from windowing alone, across the whole band', async () => {
    await withOnlyDisney(async () => {
      let prev: number | null = null;
      for (let age = VDOT_FULL_VALUE_DAYS - 10; age <= VDOT_FULL_VALUE_DAYS + FADE_TAIL_DAYS; age++) {
        const today = addDays(DISNEY, age);
        const v = await headlineVdot(today);
        expect(v, `headline VDOT null on ${today} (age ${age}, still in band)`).not.toBeNull();
        if (prev != null) {
          expect(Math.abs(v! - prev), `cliff on ${today}: ${prev} → ${v}`).toBeLessThanOrEqual(0.5);
        }
        prev = v;
      }
      // Endpoint is the honest glide value, matching the in-memory fade tests.
      expect(prev).toBeGreaterThanOrEqual(47.6);
      expect(prev).toBeLessThan(47.9);
    });
  });

  it('past expiry the pipeline returns NO anchor rather than a stale one', async () => {
    // Aug 17: every race in the fixture is 160+ days old. Research/01 §"Freshness
    // window" calls 12+ weeks expired — "Don't anchor pace prescription on this
    // VDOT. Use field test or recent race instead." The honest answer is null,
    // and the surfaces above this fall through to their own estimate tiers.
    expect(await headlineVdot('2026-08-17')).toBeNull();
  });

  it('fresh race precedence survives the pipeline: logging a fresh race flips the anchor to it', async () => {
    // The AFC Half result (Aug 16, 1:41:53) lands in races. It is slower than
    // the (expired) Disney read, and it is the only in-window evidence, so it
    // becomes the anchor.
    RACE_TABLE.push({ slug: 'afc-half-2026', meta: { name: 'AFC Half', date: '2026-08-16', priority: 'A', distanceMi: 13.109 }, actual_result: { finishS: 6113 } });
    try {
      const { raceCandidates, runCandidates } = await loadVdotInputs(USER, '2026-08-17');
      const { best } = bestRecentVdot(raceCandidates, '2026-08-17', VDOT_FULL_VALUE_DAYS, runCandidates, 4);
      expect(best).not.toBeNull();
      expect(best!.age_days).toBeLessThanOrEqual(VDOT_FULL_VALUE_DAYS);
      expect(best!.vdot).toBeLessThan(45);
      expect(best!.vdot).toBeGreaterThanOrEqual(43.6);
    } finally {
      RACE_TABLE.pop();
    }
  });
});
