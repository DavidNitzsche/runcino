/**
 * lib/plan/_skip_respected.test.ts · a deliberate skip is a decision, not a
 * debt (owner ruling, 2026-08-28).
 *
 * The defect: `day_actions action='skip'` (POST /api/today/skip) was
 * invisible to the adapter, so a deliberately-skipped quality day read as a
 * passive no-show and `detectMissedKeyWorkout` could reschedule the session
 * the runner had just declined.
 *
 * Locked here, per the brief's three assertions:
 *   · a skipped quality day produces NO reschedule action
 *   · a note intent (plan_adapt_skip_respected) records the decision
 *   · the day is still visible to gap detection as a non-running day
 *   · passive misses keep the existing graded handling
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/runtime/runner-tz', () => ({
  runnerToday: vi.fn().mockResolvedValue('2026-08-28'),
}));
vi.mock('@/lib/runs/volume', () => ({
  getCanonicalRunIds: vi.fn().mockResolvedValue([]),
  isoDaysBefore: (iso: string, days: number) =>
    new Date(Date.parse(iso + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10),
  mileageByDay: vi.fn().mockResolvedValue(new Map()),
  observableCoverageDays: vi.fn().mockResolvedValue(0),
  weeklyAvgFromWindow: vi.fn().mockReturnValue(0),
}));

import { pool } from '@/lib/db/pool';
import {
  partitionMissedCandidates,
  skipRespectedActions,
  detectMissedKeyWorkout,
  type MissedCandidate,
} from './adapt';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = pool.query as any;
let issued: Array<{ sql: string; params: unknown[] }> = [];

const UUID = '00000000-0000-0000-0000-000000000042';
const TODAY = '2026-08-28';
const YESTERDAY = '2026-08-27';

beforeEach(() => {
  vi.clearAllMocks();
  issued = [];
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1 · the pure partition
 * ═══════════════════════════════════════════════════════════════════════ */

const CAND = (over: Partial<MissedCandidate & { original_date_iso: string | null }> = {}) => ({
  workout_id: 'wk-1', planned_date: YESTERDAY, type: 'threshold',
  distance_mi: 6, original_date_iso: null, ...over,
});

describe('1 · partitionMissedCandidates', () => {
  it('a skipped quality day lands in skips, never rescheduable', () => {
    const p = partitionMissedCandidates({
      candidates: [CAND()], skippedDates: new Set([YESTERDAY]), todayISO: TODAY,
    });
    expect(p.skips).toHaveLength(1);
    expect(p.rescheduable).toHaveLength(0);
    expect(p.drops).toHaveLength(0);
  });

  it('a skipped LONG is also respected as a decision, not a missed-long record', () => {
    const p = partitionMissedCandidates({
      candidates: [CAND({ type: 'long' })], skippedDates: new Set([YESTERDAY]), todayISO: TODAY,
    });
    expect(p.skips).toHaveLength(1);
    expect(p.longMisses).toHaveLength(0);
  });

  it('passive misses keep the graded handling · fresh reschedules, stale drops, longs record', () => {
    const p = partitionMissedCandidates({
      candidates: [
        CAND(),                                                              // fresh quality
        CAND({ workout_id: 'wk-2', planned_date: '2026-08-22', original_date_iso: '2026-08-22' }), // stale
        CAND({ workout_id: 'wk-3', type: 'long', planned_date: '2026-08-24' }),                    // long
      ],
      skippedDates: new Set(), todayISO: TODAY,
    });
    expect(p.rescheduable.map((c) => c.workout_id)).toEqual(['wk-1']);
    expect(p.drops.map((c) => c.workout_id)).toEqual(['wk-2']);
    expect(p.longMisses.map((c) => c.workout_id)).toEqual(['wk-3']);
    expect(p.skips).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2 · the record-only actions
 * ═══════════════════════════════════════════════════════════════════════ */

describe('2 · skipRespectedActions', () => {
  it('emits a note intent per skip and nothing that mutates', () => {
    const actions = skipRespectedActions([CAND()]);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('note');
    expect(actions[0].noteReason).toBe('plan_adapt_skip_respected');
    expect(actions[0].workoutIds).toEqual(['wk-1']);
    expect(actions[0].noteValue).toMatchObject({ skipped_by_runner: true, planned_date: YESTERDAY });
    // Never a reschedule, never a new date.
    expect(actions.every((a) => a.kind !== 'reschedule' && a.newDate == null)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3 · the detector, end to end against a mocked DB
 * ═══════════════════════════════════════════════════════════════════════ */

function missedRouter(opts: { skipRowFor: string | null }) {
  query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    issued.push({ sql: text, params: params ?? [] });
    if (text.includes('FROM plan_workouts pw') && text.includes('BETWEEN $2::date - 7')) {
      // One uncompleted quality session yesterday.
      return { rows: [{
        id: 'wk-1', date: YESTERDAY, type: 'threshold',
        distance_mi: '6', original_date_iso: null,
      }], rowCount: 1 };
    }
    if (text.includes('FROM day_actions')) {
      return opts.skipRowFor
        ? { rows: [{ d: opts.skipRowFor }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('3 · detectMissedKeyWorkout with a day_actions skip', () => {
  it('a skipped session is never offered for reschedule · evidence carries the skip instead', async () => {
    missedRouter({ skipRowFor: YESTERDAY });
    const t = await detectMissedKeyWorkout(UUID);
    expect(t).not.toBeNull();
    // No rescheduable primary → actionsForTrigger can emit no reschedule.
    expect(t!.evidence.workout_id).toBeNull();
    expect(t!.evidence.skips).toHaveLength(1);
    expect(t!.evidence.skips[0]).toMatchObject({ workout_id: 'wk-1', type: 'threshold' });
    expect(t!.evidence.drops).toHaveLength(0);
    expect(t!.reason).toContain('skipped by choice');
  });

  it('without the skip row the same miss is rescheduable · passive handling unchanged', async () => {
    missedRouter({ skipRowFor: null });
    const t = await detectMissedKeyWorkout(UUID);
    expect(t).not.toBeNull();
    expect(t!.evidence.workout_id).toBe('wk-1');
    expect(t!.evidence.skips).toHaveLength(0);
  });

  it('the skips read fails CLOSED to passive handling, not to invented skips', async () => {
    query.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM day_actions')) throw new Error('connection terminated');
      if (text.includes('FROM plan_workouts pw') && text.includes('BETWEEN $2::date - 7')) {
        return { rows: [{ id: 'wk-1', date: YESTERDAY, type: 'threshold', distance_mi: '6', original_date_iso: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const t = await detectMissedKeyWorkout(UUID);
    expect(t!.evidence.skips).toHaveLength(0);
    expect(t!.evidence.workout_id).toBe('wk-1');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4 · the skipped day is still a non-running day to gap detection
 * ═══════════════════════════════════════════════════════════════════════ */

describe('4 · gap detection still counts the skipped day', () => {
  it('classifyGapBand counts a skipped day as a day off · a skip changes the response, not the absence', async () => {
    // The gap detector's only mileage input is mileageByDay (actual runs).
    // A day_actions skip row leaves that input untouched, so five no-run
    // days — skipped or passively missed — read as five days off either way.
    const { classifyGapBand, daysBetweenISO } = await import('./adapt');
    const lastRunISO = '2026-08-23'; // then 4 non-running days incl. the skip
    const daysOff = daysBetweenISO(lastRunISO, TODAY) - 1;
    expect(daysOff).toBe(4);
    expect(classifyGapBand(daysOff)).toBe('easy_swap');
  });

  it('the skip read lives in the missed-workout detector only · the gap detector never consults day_actions', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'adapt.ts'), 'utf8');
    const gapFn = src.split('async function detectTrainingGap')[1]?.split('async function ')[0] ?? '';
    expect(gapFn.length).toBeGreaterThan(100);
    expect(gapFn).not.toContain('day_actions');
    // mileageByDay stays the sole mileage input for daysOff.
    expect(gapFn).toContain('mileageByDay');
  });
});
