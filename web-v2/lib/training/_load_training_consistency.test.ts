/**
 * lib/training/_load_training_consistency.test.ts · F077 follow-up.
 *
 * `training-consistency.test.ts` covers `resolveTrainingConsistency` (the
 * pure resolver) in full, but the actual loader, `loadTrainingConsistency`
 * — the one thing a real caller invokes — had zero coverage. External
 * review's own read confirmed the taper filter reads correctly on
 * inspection; this closes the gap by exercising it with a real mocked
 * read rather than leaving it unverified. Per the file's own header, the
 * loader's whole reason to exist beyond the pure resolver is: (1) excluding
 * a prescribed taper/recovery window so it can't manufacture a false
 * RECOMMIT signal, and (2) never throwing on a failed read.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/execution/load', () => ({
  loadKeySessionExecutions: vi.fn(),
}));
vi.mock('@/lib/training/projection-snapshots', () => ({
  resolveCurrentVdotSnapshot: vi.fn(),
}));
vi.mock('@/lib/training/normal-window', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadPrescribedWindows: vi.fn(),
}));

import { loadKeySessionExecutions, type KeySessionExecution } from '@/lib/execution/load';
import { resolveCurrentVdotSnapshot } from '@/lib/training/projection-snapshots';
import { loadPrescribedWindows, type PrescribedWindow } from '@/lib/training/normal-window';
import { loadTrainingConsistency } from './training-consistency';

const USER = '0645f40c-951d-4ccc-b86e-9979cd26c795';
const TODAY = '2026-09-15';

function execution(dateISO: string, earnsProgression: boolean): KeySessionExecution {
  return {
    dateISO,
    type: 'threshold',
    planned: null,
    plannedBasis: null,
    actual: null,
    actualBasis: null,
    watchStatus: null,
    toleranceShare: null,
    workVerdicts: [],
    establishedPaceSPerMi: null,
    replacedByRace: false,
    readable: true,
    read: {
      state: earnsProgression ? 'AS_PLANNED' : 'MISSED',
      stimulusCompletion: earnsProgression ? 1 : 0,
      evidence: { fitness: 'none', adaptation: 'unknown' } as any,
      why: 'test fixture',
      telemetryCompromised: false,
    } as any,
    earnsProgression,
  };
}

function window(fromISO: string, toISO: string): PrescribedWindow {
  return {
    raceSlug: 'test-race',
    raceDateISO: toISO,
    raceDistanceMi: 26.2,
    category: 'marathon' as any,
    priority: 'A',
    taperWeeks: 2,
    recoveryWeeks: 1,
    fromISO,
    toISO,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveCurrentVdotSnapshot as any).mockResolvedValue({ ok: false });
});

describe('F077 · loadTrainingConsistency', () => {
  it('RULE 18 FALSIFICATION · excludes sessions inside a prescribed taper/recovery window, so a taper cannot manufacture a false RECOMMIT signal', async () => {
    // Two missed quality sessions land INSIDE a prescribed taper window --
    // the exact "cutback week is adherence, not inconsistency" case the
    // file's header names. Without the filter this would trigger the
    // non-adherence offer at exactly NON_ADHERENCE_TRIGGER_STREAK (2); with
    // it, both are excluded and no signal fires.
    (loadKeySessionExecutions as any).mockResolvedValue([
      execution('2026-08-01', true),
      execution('2026-09-10', false), // inside the taper window
      execution('2026-09-13', false), // inside the taper window
    ]);
    (loadPrescribedWindows as any).mockResolvedValue([window('2026-09-08', '2026-09-20')]);

    const v = await loadTrainingConsistency(USER, TODAY);

    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0].dateISO).toBe('2026-08-01');
    expect(v.consecutiveMissedQuality).toBe(0);
    expect(v.triggersNonAdherenceOffer).toBe(false);
  });

  it('the same two misses fire the offer when there is no prescribed window covering them', async () => {
    (loadKeySessionExecutions as any).mockResolvedValue([
      execution('2026-08-01', true),
      execution('2026-09-10', false),
      execution('2026-09-13', false),
    ]);
    (loadPrescribedWindows as any).mockResolvedValue([]);

    const v = await loadTrainingConsistency(USER, TODAY);

    expect(v.sessions).toHaveLength(3);
    expect(v.consecutiveMissedQuality).toBe(2);
    expect(v.triggersNonAdherenceOffer).toBe(true);
  });

  it('excludes an unreadable session and a telemetry-compromised one -- neither is real evidence either way', async () => {
    (loadKeySessionExecutions as any).mockResolvedValue([
      execution('2026-09-01', true),
      { ...execution('2026-09-05', false), readable: false, read: null },
      { ...execution('2026-09-08', false), read: { ...execution('2026-09-08', false).read, telemetryCompromised: true } },
    ]);
    (loadPrescribedWindows as any).mockResolvedValue([]);

    const v = await loadTrainingConsistency(USER, TODAY);

    expect(v.sessions).toHaveLength(1);
    expect(v.sessions[0].dateISO).toBe('2026-09-01');
  });

  it('a failed read says nothing today rather than crashing or fabricating a non-adherence accusation', async () => {
    (loadKeySessionExecutions as any).mockRejectedValue(new Error('db unreachable'));
    (loadPrescribedWindows as any).mockResolvedValue([]);

    const v = await loadTrainingConsistency(USER, TODAY);

    expect(v.sessions).toEqual([]);
    expect(v.triggersNonAdherenceOffer).toBe(false);
    expect(v.qualityDeliveryShare).toBeNull();
  });
});
