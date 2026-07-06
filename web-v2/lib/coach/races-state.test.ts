/**
 * lib/coach/races-state.test.ts
 *
 * 2026-07-06 · P1-19 + P1-17 falsifiers over loadRacesState.
 *
 *   F1  actual_result.finishS beats a conflicting/stale meta.finishTime
 *       (the ladder was INVERTED in code vs its own comment — a stale meta
 *       entry outranked the canonical chip time).
 *   F2  the P1-19 scenario: a DNS'd 5K + a 4-mi easy jog the next day must
 *       NOT auto-match as the finish time (old flat 2.0-mi window matched
 *       it; the proportional window rejects it).
 *   F3  a legit same-day near-distance match DOES fill the finish — but
 *       provisional:true + source:'run_match' + the canonical caption ride
 *       the payload (Rule 3: never render as authoritative).
 *   F4  a marathon race file measuring 26.5 mi still matches (the
 *       proportional window must not break real matches).
 *   F5  distance_mi is label-backfilled at read time (P1-17) — no DB write.
 *
 * Mock style: query-text dispatch (FROM races / FROM runs), same vi.mock
 * pool pattern as health-state.hrv-median.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-07-06'),
  runnerTimezone: vi.fn().mockResolvedValue('America/Los_Angeles'),
}));

import { pool } from '@/lib/db/pool';
import { loadRacesState, PROVISIONAL_FINISH_LABEL } from './races-state';

type RaceFixture = { slug: string; meta: Record<string, unknown>; actual_result: Record<string, unknown> | null };
type RunFixture = { data: Record<string, unknown> };

function dispatchQueries(races: RaceFixture[], runs: RunFixture[]): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('FROM races')) {
      return Promise.resolve({ rows: races });
    }
    if (typeof sql === 'string' && sql.includes('FROM runs')) {
      return Promise.resolve({ rows: runs });
    }
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadRacesState — finish-time ladder (P1-19)', () => {
  it('F1 · actual_result.finishS beats a stale meta.finishTime', async () => {
    dispatchQueries([
      {
        slug: 'sombrero-half',
        meta: { name: 'Sombrero Half', date: '2026-06-01', priority: 'B', distanceLabel: 'Half Marathon', finishTime: '1:35:00' },
        actual_result: { finishS: 5400 },
      },
    ], []);
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'sombrero-half')!;
    expect(race.finishTime).toBe('1:30:00'); // chip time, NOT the stale 1:35
    expect(race.finishSource).toBe('actual_result');
    expect(race.finishProvisional).toBe(false);
    expect(race.finishProvisionalLabel).toBeNull();
  });

  it('meta.finishTime still serves when actual_result is empty', async () => {
    dispatchQueries([
      {
        slug: 'retro-10k',
        meta: { name: 'Retro 10K', date: '2026-05-10', priority: 'C', distanceLabel: '10K', finishTime: '42:30' },
        actual_result: null,
      },
    ], []);
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'retro-10k')!;
    expect(race.finishTime).toBe('42:30');
    expect(race.finishSource).toBe('meta');
    expect(race.finishProvisional).toBe(false);
  });
});

describe('loadRacesState — run auto-match window (P1-19)', () => {
  it('F2 · a 4-mi jog the day after a DNS 5K does NOT become the finish time', async () => {
    dispatchQueries(
      [{ slug: 'dns-5k', meta: { name: 'DNS 5K', date: '2026-06-20', priority: 'C', distanceLabel: '5K' }, actual_result: null }],
      [{ data: { distanceMi: 4.0, date: '2026-06-21', movingTimeS: 2412, avgHr: 141 } }],
    );
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'dns-5k')!;
    expect(race.finishTime).toBeNull();
    expect(race.finishProvisional).toBe(false);
    expect(race.finishSource).toBeNull();
    expect(race.matchedRun ?? null).toBeNull();
  });

  it('F2b · a 2.6-mi shakeout the day before a 5K does NOT match either', async () => {
    dispatchQueries(
      [{ slug: 'shakeout-5k', meta: { name: 'Shakeout 5K', date: '2026-06-20', priority: 'C', distanceLabel: '5K' }, actual_result: null }],
      [{ data: { distanceMi: 2.6, date: '2026-06-19', movingTimeS: 1500 } }],
    );
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'shakeout-5k')!;
    expect(race.finishTime).toBeNull();
    expect(race.finishProvisional).toBe(false);
  });

  it('F3 · a legit same-day match fills the finish AS PROVISIONAL with the caption', async () => {
    dispatchQueries(
      [{ slug: 'park-5k', meta: { name: 'Park 5K', date: '2026-06-27', priority: 'C', distanceLabel: '5K' }, actual_result: null }],
      [{ data: { distanceMi: 3.18, date: '2026-06-27', movingTimeS: 1212, avgHr: 172 } }],
    );
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'park-5k')!;
    expect(race.finishTime).toBe('20:12');
    expect(race.finishProvisional).toBe(true);
    expect(race.finishSource).toBe('run_match');
    expect(race.finishProvisionalLabel).toBe(PROVISIONAL_FINISH_LABEL);
    expect(race.finishProvisionalLabel).toBe('Training effort · race to lock in');
    expect(race.matchedRun?.avg_hr).toBe(172);
  });

  it('F4 · a 26.5-mi marathon file still matches its marathon (window must not over-tighten)', async () => {
    dispatchQueries(
      [{ slug: 'big-sur', meta: { name: 'Big Sur', date: '2026-04-26', priority: 'A', distanceLabel: 'Marathon' }, actual_result: null }],
      [{ data: { distanceMi: 26.5, date: '2026-04-26', movingTimeS: 11700 } }],
    );
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'big-sur')!;
    expect(race.finishTime).toBe('3:15:00');
    expect(race.finishProvisional).toBe(true);
    expect(race.finishSource).toBe('run_match');
  });

  it('a curated finish is never overwritten by a matched run (actual_result always wins)', async () => {
    dispatchQueries(
      [{ slug: 'chip-5k', meta: { name: 'Chip 5K', date: '2026-06-27', priority: 'B', distanceLabel: '5K' }, actual_result: { finishS: 1230 } }],
      [{ data: { distanceMi: 3.15, date: '2026-06-27', movingTimeS: 1300, avgHr: 168 } }],
    );
    const state = await loadRacesState('u1');
    const race = state.past.find((r) => r.slug === 'chip-5k')!;
    expect(race.finishTime).toBe('20:30');           // the chip time
    expect(race.finishProvisional).toBe(false);
    expect(race.finishSource).toBe('actual_result');
    expect(race.matchedRun?.avg_hr).toBe(168);       // enrichment still attaches
  });
});

describe('loadRacesState — distance_mi read-time backfill (P1-17)', () => {
  it('F5 · label-only rows get distance_mi derived on read (no DB write)', async () => {
    dispatchQueries([
      { slug: 'app-created-half', meta: { name: 'My Half', date: '2026-09-01', priority: 'A', distanceLabel: 'Half Marathon' }, actual_result: null },
      { slug: 'numeric-row', meta: { name: 'CIM', date: '2026-12-06', priority: 'A', distanceLabel: 'Marathon', distanceMi: 26.2 }, actual_result: null },
    ], []);
    const state = await loadRacesState('u1');
    const half = state.aRaces.find((r) => r.slug === 'app-created-half')!;
    const cim = state.aRaces.find((r) => r.slug === 'numeric-row')!;
    expect(half.distance_mi).toBe(13.1);   // derived from the label
    expect(cim.distance_mi).toBe(26.2);    // numeric passes through untouched
    // read path must not write
    const writes = (pool.query as ReturnType<typeof vi.fn>).mock.calls
      .filter(([sql]) => typeof sql === 'string' && /INSERT|UPDATE|DELETE/i.test(sql));
    expect(writes).toHaveLength(0);
  });
});
