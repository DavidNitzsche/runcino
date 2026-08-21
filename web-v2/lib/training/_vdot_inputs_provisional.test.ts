/**
 * 2026-08-21 · race-data source-of-truth re-audit · REGRESSION LOCK.
 *
 * `lib/race/auto-result.ts` writes an auto-logged WATCH time straight into
 * `races.actual_result.finishS`, stamped `source:'watch_provisional',
 * provisional:true`. It IS the result until a chip time replaces it, but it is
 * not a CONFIRMED one, and CLAUDE.md's race-data rule 3 says an unconfirmed
 * finish must never render as authoritative race performance.
 *
 * `lib/coach/races-state.ts` has always read that flag. `loadVdotInputs` did
 * not: its `provisional` was set only on the rung-3 Strava date+distance
 * match, so a rung-1 watch time came back with `provisional:false`. Two live
 * consequences, both on the same screen:
 *
 *   1. `/api/v5/races` builds its EVIDENCE list from `loadVdotInputs` and its
 *      SCHEDULE list from `loadRacesState`. One response therefore printed the
 *      same race's time as a hard result ("Counts fully", `modelled:false`, no
 *      amber `~`) in evidence and as modelled in the schedule.
 *   2. `/api/v5/goal-answer` action:'confirm' refuses unless
 *      `candidate.provisional`. `/api/v5/races`'s chip-lock trigger fires off
 *      `races-state`'s flag. So the app raised a "lock your chip time" card
 *      that its own confirm endpoint answered 400 `not_provisional` — the card
 *      could not be answered.
 *
 * The load-bearing assertion is CROSS-SURFACE AGREEMENT: for every row in one
 * fixture `races` table, `loadVdotInputs(...).raceCandidates[i].provisional`
 * must equal `loadRacesState(...)` `finishProvisional` for the same slug. Two
 * readers of one column cannot be allowed to disagree again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/training/max-hr', () => ({
  loadEffectiveMaxHr: vi.fn().mockResolvedValue({ bpm: 191, source: 'user_settings' }),
}));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerTimezoneOrPacific: vi.fn().mockResolvedValue('America/Los_Angeles'),
  runnerToday: vi.fn().mockResolvedValue('2026-08-21'),
}));

import { pool } from '@/lib/db/pool';
import { loadVdotInputs } from './vdot-inputs';
import { loadRacesState } from '@/lib/coach/races-state';

const USER = 'user-uuid-test';
const TODAY = '2026-08-21';

/** One fixture `races` table, read by BOTH loaders. Each row is a distinct
 *  rung of the source-of-truth ladder. */
const RACE_TABLE = [
  {
    // Rung 1 · CURATED. The manual chip-time route's own patch shape
    // (result-chain.manualResultPatch). Must NOT be provisional.
    slug: 'americas-finest-city',
    meta: { name: 'AFC Half', date: '2026-08-16', priority: 'A', distanceMi: 13.1 },
    actual_result: {
      finishS: 6113, finishDisplay: '1:41:53', source: 'manual',
      provisional: false, confirmedAt: '2026-08-17T18:04:54.640Z',
    },
  },
  {
    // Rung 1 · AUTO-LOGGED WATCH. auto-result.provisionalResultPatch's shape.
    // THE REGRESSION: this used to come back provisional:false.
    slug: 'watch-logged-half',
    meta: { name: 'Watch Logged Half', date: '2026-08-09', priority: 'B', distanceMi: 13.1 },
    actual_result: {
      finishS: 6200, finishDisplay: '1:43:20', source: 'watch_provisional',
      provisional: true,
    },
  },
  {
    // Rung 2 · legacy curated meta.finishTime. Not provisional.
    slug: 'legacy-meta-half',
    meta: {
      name: 'Legacy Half', date: '2026-08-02', priority: 'B',
      distanceMi: 13.1, finishTime: '1:44:00',
    },
    actual_result: null,
  },
  {
    // Rung 3 · no curated result at all; only a matching run in the log.
    slug: 'unlogged-half',
    meta: { name: 'Unlogged Half', date: '2026-07-26', priority: 'C', distanceMi: 13.1 },
    actual_result: null,
  },
];

/** The run the rung-3 race matches on date+distance. */
const RUN_TABLE = [
  { data: { id: '900', date: '2026-07-26', distanceMi: 13.15, movingTimeS: 6400, elapsedTimeS: 6410 } },
];

type QueryMock = ReturnType<typeof vi.fn>;
const queryMock = pool.query as unknown as QueryMock;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM races')) return { rows: RACE_TABLE };
    if (sql.includes('FROM runs')) return { rows: RUN_TABLE };
    // vdot-inputs makes a few auxiliary reads (plan zones, profile, terrain);
    // an empty result is the honest "nothing to add" answer for all of them.
    return { rows: [] };
  });
});

const bySlug = async () => {
  const { raceCandidates } = await loadVdotInputs(USER, TODAY);
  return new Map(raceCandidates.map(c => [c.slug, c]));
};

describe('loadVdotInputs · provisional flag reads the whole ladder', () => {
  it('a CURATED chip time is not provisional', async () => {
    const c = (await bySlug()).get('americas-finest-city')!;
    expect(c.finish_seconds).toBe(6113);
    expect(c.provisional).toBe(false);
    expect(c.provisionalSource).toBeNull();
  });

  it('an AUTO-LOGGED WATCH result in actual_result IS provisional', async () => {
    // Fails against the old code: `provisional` was initialised to false and
    // only the rung-3 branch could ever set it, so rung 1 always returned
    // false no matter what `actual_result.provisional` said.
    const c = (await bySlug()).get('watch-logged-half')!;
    expect(c.finish_seconds).toBe(6200);
    expect(c.provisional).toBe(true);
    expect(c.provisionalSource).toBe('watch');
  });

  it('a legacy curated meta.finishTime is not provisional', async () => {
    const c = (await bySlug()).get('legacy-meta-half')!;
    expect(c.finish_seconds).toBe(6240);
    expect(c.provisional).toBe(false);
    expect(c.provisionalSource).toBeNull();
  });

  it('a rung-3 Strava/run date+distance match is provisional', async () => {
    const c = (await bySlug()).get('unlogged-half')!;
    expect(c.finish_seconds).toBe(6400);
    expect(c.provisional).toBe(true);
    expect(c.provisionalSource).toBe('run_match');
  });
});

describe('cross-surface agreement · one column, two readers, one answer', () => {
  it('every race is provisional to loadVdotInputs exactly when it is to loadRacesState', async () => {
    // This is the assertion that would have caught the defect on the day it
    // landed. /api/v5/races builds evidence from the first loader and the
    // schedule from the second; a disagreement here IS a response that
    // contradicts itself about whether a time is a result.
    const candidates = await bySlug();
    const state = await loadRacesState(USER);
    const stateRows = new Map(
      [...state.aRaces, ...state.upcomingBs, ...state.upcomingCs, ...state.past]
        .map(r => [r.slug, r]),
    );

    expect(candidates.size).toBeGreaterThan(0);
    for (const [slug, c] of candidates) {
      const row = stateRows.get(slug);
      expect(row, `races-state has no row for ${slug}`).toBeDefined();
      expect(
        c.provisional,
        `${slug}: evidence says provisional=${c.provisional}, schedule says ${row!.finishProvisional}`,
      ).toBe(row!.finishProvisional);
    }
  });

  it('the watch-logged race is provisional on BOTH surfaces', async () => {
    const c = (await bySlug()).get('watch-logged-half')!;
    const state = await loadRacesState(USER);
    const row = [...state.upcomingBs, ...state.past].find(r => r.slug === 'watch-logged-half')!;
    expect(c.provisional).toBe(true);
    expect(row.finishProvisional).toBe(true);
    // And the schedule's caption says WHY, so the evidence list can print the
    // same sentence rather than the run-match one.
    expect(row.finishProvisionalLabel).toBe('Watch time · chip time to lock in');
  });
});

describe('/api/v5/goal-answer confirm gate · the card the app raised is answerable', () => {
  it('a watch-logged race passes the confirm precondition', async () => {
    // The route's guard, verbatim:
    //   if (!candidate || !candidate.provisional || !candidate.finish_seconds)
    //     → 400 not_provisional
    // Against the old code this guard rejected the exact race the chip-lock
    // trigger had just told the runner to confirm.
    const candidate = (await bySlug()).get('watch-logged-half');
    const refused = !candidate || !candidate.provisional || !candidate.finish_seconds;
    expect(refused).toBe(false);
  });

  it('an already-confirmed chip time still fails the confirm precondition', async () => {
    const candidate = (await bySlug()).get('americas-finest-city');
    const refused = !candidate || !candidate.provisional || !candidate.finish_seconds;
    expect(refused).toBe(true);
  });
});
