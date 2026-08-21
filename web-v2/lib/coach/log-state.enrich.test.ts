/**
 * lib/coach/log-state.enrich.test.ts · 2026-08-17 Activity-surface truth
 * fixes, wired end-to-end through loadLogState with a query-text-dispatch
 * pool mock (same pattern as races-state.test.ts).
 *
 *   F1  a race day whose canonical row is the watch's 'Run' renders with
 *       the race name, isRace, the race slug, badge RACE, and
 *       workoutType='race' (effort donut colors it race, not easy).
 *   F2  a HISTORICAL quality day (archived plan — no active plan at all
 *       here) resolves workoutType from plan_workouts across ALL plans,
 *       so Year/All-time effort mixes stop over-reading easy.
 *   F3  badge conditions: ON TARGET within pace target, LONGEST ≥18mi,
 *       no badge on an ordinary easy run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-17'),
}));
vi.mock('@/lib/runs/volume', () => ({
  getCanonicalRunIds: vi.fn().mockResolvedValue(['101', '102', '103', '104']),
  ALL_TIME: ['1900-01-01', '2999-12-31'],
}));
vi.mock('@/lib/plan/lookup', () => ({
  loadActivePlan: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/coach/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({ long_run_day: 'sun' }),
}));

import { pool } from '@/lib/db/pool';
import { loadLogState } from './log-state';

const RUN_ROWS = [
  {
    row_id: '101',
    data: { id: '101', date: '2026-08-16', name: 'Run', source: 'watch', type: 'run', distanceMi: 13.34, paceSPerMi: 417, movingTimeS: 5563 },
    shoe_id: null, shoe_brand: null, shoe_model: null,
  },
  {
    row_id: '102',
    data: { id: '102', date: '2026-03-10', name: 'Run', source: 'watch', type: 'run', distanceMi: 6.1, paceSPerMi: 405, movingTimeS: 2470 },
    shoe_id: null, shoe_brand: null, shoe_model: null,
  },
  {
    row_id: '103',
    data: { id: '103', date: '2026-08-14', name: 'Morning Run', source: 'strava', type: 'run', distanceMi: 5.0, paceSPerMi: 540, movingTimeS: 2700 },
    shoe_id: null, shoe_brand: null, shoe_model: null,
  },
  {
    row_id: '104',
    data: { id: '104', date: '2026-08-10', name: 'Run', source: 'watch', type: 'run', distanceMi: 20.0, paceSPerMi: 545, movingTimeS: 10900 },
    shoe_id: null, shoe_brand: null, shoe_model: null,
  },
];

const TWIN_ROWS = [
  // Strava twin of the race run — carries the real name + workout_type '1'.
  { canonical_id: '101', name: 'AFC Half', source: 'strava', workout_type: '1' },
];

// Archived-plan tempo day (the ONLY plan rows — loadActivePlan is null, so
// the old active-plan-scoped loader would have bucketed run 102 as easy).
const PLAN_WORKOUT_ROWS = [
  { date_iso: '2026-03-10', type: 'tempo', pace_target: 405, is_quality: true },
];

const RACE_ROWS = [
  { slug: 'afc-half-2026', meta: { name: 'AFC Half', date: '2026-08-16', distanceLabel: 'Half Marathon', priority: 'A' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
    if (sql.includes('LEFT JOIN shoes')) return Promise.resolve({ rows: RUN_ROWS });
    if (sql.includes("mergedIntoId")) return Promise.resolve({ rows: TWIN_ROWS });
    if (sql.includes('FROM plan_workouts')) return Promise.resolve({ rows: PLAN_WORKOUT_ROWS });
    if (sql.includes('FROM races')) return Promise.resolve({ rows: RACE_ROWS });
    return Promise.resolve({ rows: [] });
  });
});

async function loadRuns() {
  const state = await loadLogState('user-uuid-1');
  return state.weeks.flatMap(w => w.runs);
}

describe('loadLogState · Activity truth enrichment', () => {
  it('F1 · race day: merged twin name + races row → RACE identity', async () => {
    const runs = await loadRuns();
    const afc = runs.find(r => r.id === '101')!;
    expect(afc).toBeDefined();
    expect(afc.name).toBe('AFC Half');          // races.meta.name, not 'Run'
    expect(afc.isRace).toBe(true);
    expect(afc.raceSlug).toBe('afc-half-2026');
    expect(afc.badge).toBe('RACE');
    expect(afc.workoutType).toBe('race');        // effort donut buckets as race
  });

  it('F1b · twin name coalescing without a races row still beats Run', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
      if (typeof sql !== 'string') return Promise.resolve({ rows: [] });
      if (sql.includes('LEFT JOIN shoes')) return Promise.resolve({ rows: [RUN_ROWS[0]] });
      if (sql.includes("mergedIntoId")) {
        return Promise.resolve({ rows: [{ canonical_id: '101', name: 'Little Monday speed hit', source: 'strava', workout_type: null }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const runs = await loadRuns();
    expect(runs[0].name).toBe('Little Monday speed hit');
    expect(runs[0].isRace).toBe(false);
  });

  it('F2 · archived-plan quality day buckets as tempo, not easy', async () => {
    const runs = await loadRuns();
    const hist = runs.find(r => r.id === '102')!;
    expect(hist.workoutType).toBe('tempo');
    expect(hist.badge).toBe('ON TARGET');        // pace 405 on target 405
  });

  it('F3 · LONGEST at 20mi, no badge on an ordinary easy run', async () => {
    const runs = await loadRuns();
    expect(runs.find(r => r.id === '104')!.badge).toBe('LONGEST');
    const easy = runs.find(r => r.id === '103')!;
    expect(easy.badge).toBeNull();
    expect(easy.isRace).toBe(false);
    expect(easy.name).toBe('Morning Run');       // generic, but no twin → kept
  });

  it('axes carry the enriched types for the filter chips', async () => {
    const state = await loadLogState('user-uuid-1');
    expect(state.axes.types).toContain('race');
    expect(state.axes.types).toContain('tempo');
  });
});
