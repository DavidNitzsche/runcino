/**
 * lib/faff/race-on-today.test.ts
 *
 * `buildRaceOnToday` is a THIN composer over already-canonical resolvers —
 * these tests exist to prove it wires them correctly (goal vs. execution
 * target kept distinct, HR/abort/fueling threaded through, additive
 * failure behavior) without re-testing `race-outlook.ts` itself, which has
 * its own suite. `loadEffectiveRaceTarget` is mocked to a controlled
 * `EffectiveRaceTarget`; `resolveRaceFuel`/`computeRaceFueling`/`raceHrLine`
 * run for REAL (pure functions, no DB) so the fueling/HR sentences in the
 * assertions are the actual canonical wording, not a stand-in for it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/pool', () => ({ pool: { query: vi.fn() } }));
vi.mock('@/lib/race/effective-race-target', () => ({ loadEffectiveRaceTarget: vi.fn() }));

import { pool } from '@/lib/db/pool';
import { loadEffectiveRaceTarget } from '@/lib/race/effective-race-target';
import { buildRaceOnToday } from './race-on-today';
import type { RaceHrGuidance } from '@/lib/race/race-hr-guidance';

type RaceRow = { slug: string; meta: Record<string, unknown> };

function dispatchQueries(opts: {
  todaysRace?: RaceRow[];
  planRace?: RaceRow[];
  fuelDefaults?: { fuel_brand: string | null; fuel_gel_carbs_g: number | null; fuel_target_g_per_hr: number | null } | null;
}): void {
  (pool.query as ReturnType<typeof vi.fn>).mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes("FROM races") && sql.includes("meta->>'date'")) {
      return Promise.resolve({ rows: opts.todaysRace ?? [] });
    }
    if (typeof sql === 'string' && sql.includes('FROM races') && sql.includes('slug = $2')) {
      return Promise.resolve({ rows: opts.planRace ?? [] });
    }
    if (typeof sql === 'string' && sql.includes('FROM users')) {
      return Promise.resolve({ rows: opts.fuelDefaults ? [opts.fuelDefaults] : [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

const hrGuidance: RaceHrGuidance = {
  lthrBpm: 168,
  distanceCategory: 'm',
  expectedRangeBpm: [150, 160],
  earlyCeilingBpm: 155,
  earlyThroughMi: 3,
  lateAllowanceBpm: 165,
  checkpointMi: 20,
  checkpointAbortBpm: 175,
  informationalOnly: false,
  evidence: { comparableEfforts: 3, observedMeanHr: 158, conflictBpm: null, efforts: [] },
  reasons: ['DOCTRINE_BAND_FOR_DISTANCE'],
  citation: 'Research/03',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildRaceOnToday', () => {
  it('returns null when no race is dated today and the plan carries none either', async () => {
    dispatchQueries({});
    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result).toBeNull();
    expect(loadEffectiveRaceTarget).not.toHaveBeenCalled();
  });

  it('keeps the execution target and the stated goal as two distinct fields, never merged', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'cim-2026', meta: { name: 'CIM', distanceMi: 26.2, goalDisplay: '3:00:00', priority: 'A' } }],
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
      targetSec: 12680, // 3:31:20 — the projection-derived target, NOT the 3:00:00 goal
      source: 'projection',
      goalSec: 10800,
      projectionSec: 12680,
      projectionDateISO: '2026-09-03',
      outlook: {
        execution: {
          targetSec: 12680,
          paceSecPerMi: null,
          paceBandSecPerMi: null,
          source: 'current_evidence',
          effortCharacter: 'race',
          strategyLabel: 'Controlled start · 8:04/mi average',
          reasonVsExpected: '',
          hr: hrGuidance,
        },
      },
    });

    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result).not.toBeNull();
    expect(result!.executionTargetSec).toBe(12680);
    expect(result!.goalSec).toBe(10800); // the STATED goal (3:00:00), parsed independently
    expect(result!.executionTargetSec).not.toBe(result!.goalSec);
    expect(result!.strategyLabel).toBe('Controlled start · 8:04/mi average');
    expect(result!.role).toBe('race');
  });

  it('threads the HR checkpoint/abort fields through from the SAME guidance object raceHrLine renders', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'cim-2026', meta: { name: 'CIM', distanceMi: 26.2, goalDisplay: '3:00:00' } }],
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
      targetSec: 12000, source: 'projection', goalSec: 10800, projectionSec: 12000, projectionDateISO: '2026-09-03',
      outlook: {
        execution: {
          targetSec: 12000, paceSecPerMi: null, paceBandSecPerMi: null, source: 'current_evidence',
          effortCharacter: 'race', strategyLabel: null, reasonVsExpected: '', hr: hrGuidance,
        },
      },
    });

    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result!.checkpointMi).toBe(20);
    expect(result!.checkpointAbortBpm).toBe(175);
    expect(result!.hrLine).not.toBeNull();
    expect(result!.hrLine).toContain('150'); // the same band raceHrLine() would state
  });

  it('a controlled_c_effort day states that role, not "race"', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'tuneup-10k', meta: { name: 'Tune-up 10K', distanceMi: 6.2, priority: 'B' } }],
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
      targetSec: 2400, source: 'projection', goalSec: 0, projectionSec: 2400, projectionDateISO: '2026-09-03',
      outlook: {
        execution: {
          targetSec: 2400, paceSecPerMi: null, paceBandSecPerMi: null, source: 'controlled_c_effort',
          effortCharacter: 'controlled_c_effort', strategyLabel: 'Strong, not all-out', reasonVsExpected: '', hr: null,
        },
      },
    });

    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result!.role).toBe('controlled_c_effort');
    expect(result!.goalSec).toBeNull(); // no goalDisplay in meta — Rule 11: absence, not a fabricated zero
    expect(result!.hrLine).toBeNull();
    expect(result!.checkpointMi).toBeNull();
  });

  it('falls back to the plan-level race when nothing is dated today', async () => {
    dispatchQueries({
      todaysRace: [],
      planRace: [{ slug: 'cim-2026', meta: { name: 'CIM', distanceMi: 26.2, goalDisplay: '3:00:00' } }],
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
      targetSec: 12000, source: 'projection', goalSec: 10800, projectionSec: 12000, projectionDateISO: '2026-09-03',
      outlook: { execution: { targetSec: 12000, paceSecPerMi: null, paceBandSecPerMi: null, source: 'current_evidence', effortCharacter: 'race', strategyLabel: null, reasonVsExpected: '', hr: null } },
    });

    const result = await buildRaceOnToday('u1', '2026-09-03', 'cim-2026');
    expect(result?.slug).toBe('cim-2026');
  });

  it('never throws when the outlook resolver fails — Today must fall back, not 500', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'cim-2026', meta: { name: 'CIM', distanceMi: 26.2 } }],
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('outlook resolver exploded'));

    await expect(buildRaceOnToday('u1', '2026-09-03', null)).resolves.toBeNull();
  });

  it('returns null when the race meta carries no usable distance', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'mystery-race', meta: { name: 'Mystery' } }], // no distanceMi, no distanceLabel
    });
    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result).toBeNull();
    expect(loadEffectiveRaceTarget).not.toHaveBeenCalled();
  });

  it('produces a fueling summary from the SAME resolver the watch uses, only when there is a target to fuel', async () => {
    dispatchQueries({
      todaysRace: [{ slug: 'cim-2026', meta: { name: 'CIM', distanceMi: 26.2, goalDisplay: '3:00:00' } }],
      fuelDefaults: { fuel_brand: 'Maurten', fuel_gel_carbs_g: 25, fuel_target_g_per_hr: 60 },
    });
    (loadEffectiveRaceTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
      targetSec: 12000, source: 'projection', goalSec: 10800, projectionSec: 12000, projectionDateISO: '2026-09-03',
      outlook: { execution: { targetSec: 12000, paceSecPerMi: null, paceBandSecPerMi: null, source: 'current_evidence', effortCharacter: 'race', strategyLabel: null, reasonVsExpected: '', hr: null } },
    });

    const result = await buildRaceOnToday('u1', '2026-09-03', null);
    expect(result!.fuelingSummary).not.toBeNull();
    expect(typeof result!.fuelingSummary).toBe('string');
  });
});
