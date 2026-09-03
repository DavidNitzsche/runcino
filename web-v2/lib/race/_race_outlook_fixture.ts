/**
 * Test fixture for the race-pace brain: a full `RaceOutlookReads` built from
 * a handful of numbers, so `composeRaceOutlook` can be driven with no
 * database. Every field names the canonical owner it stands in for.
 */
import type { RaceOutlookReads, RaceForOutlook } from './race-outlook';
import type { ThresholdCapacityEstimate } from '@/lib/training/capacity-resolver';
import type { RaceExponentRead } from '@/lib/training/durability-anchor';
import type { CurrentEquivalence } from '@/lib/training/goal-projection';
import { predictRaceTime, tPaceFromVdot } from '@/lib/training/vdot';

export interface FixtureOpts {
  vdot?: number;
  thresholdSecPerMi?: number;
  confidence?: number;
  exponent?: number | null;
  exponentRaces?: number;
  executionQuality?: number | null;
  lthrBpm?: number | null;
  maxHrBpm?: number | null;
  anchorsRefuse?: boolean;
  /** Override the equivalence function entirely (e.g. to refuse). */
  equivalenceAt?: RaceOutlookReads['equivalenceAt'];
  /** EXECTARGET-1 · the block's last authored marathon-effort pace. Undefined
   *  means "no plan to read", which is the fixture's honest default and a
   *  different fact from a plan that rehearses nothing (Rule 11). */
  plannedLastRehearsalPaceSecPerMi?: number | null;
}

export function fixtureRace(over: Partial<RaceForOutlook> = {}): RaceForOutlook {
  return {
    slug: 'cim-2026', name: 'CIM', distanceMi: 26.2, dateISO: '2026-12-06',
    priority: 'A', statedGoalSec: 3 * 3600, isPast: false, ...over,
  };
}

export function fixtureReads(o: FixtureOpts = {}): RaceOutlookReads {
  const vdot = o.vdot ?? 47.8;
  const t = o.thresholdSecPerMi ?? Math.round(tPaceFromVdot(vdot) ?? 430);
  const conf = o.confidence ?? 0.8;
  const exponent = o.exponent === undefined ? 1.09 : o.exponent;
  const threshold: ThresholdCapacityEstimate = {
    paceSecPerMi: t, vdot, confidence: conf, sourceMode: 'direct',
    evidenceIds: ['a', 'b', 'c'], reasons: [], anchorDateISO: '2026-09-01',
  } as unknown as ThresholdCapacityEstimate;
  const durabilityRead: RaceExponentRead = exponent != null
    ? ({ ok: true, value: exponent, rawFittedExponent: exponent, confidence: 0.6, races: o.exponentRaces ?? 2, reasons: [] } as unknown as RaceExponentRead)
    : ({ ok: false, reason: 'no_races', races: 0 } as RaceExponentRead);
  const anchorRead = o.anchorsRefuse
    ? ({ ok: false, reason: 'no_threshold_evidence', detail: 'fixture' } as unknown as RaceOutlookReads['anchorRead'])
    : ({
        ok: true,
        anchors: {
          thresholdSecPerMi: t,
          marathonSecPerMi: Math.round(t * Math.pow(26.2 / ((60 * 60) / t), (exponent ?? 1.07) - 1) * 1.0),
          easyCeilingSecPerMi: t + 90, intervalSecPerMi: t - 20, repetitionSecPerMi: t - 40, shakeoutCeilingSecPerMi: t + 120,
          basis: {
            threshold: { vdot, confidence: conf, sourceMode: 'direct' },
            marathon: { enduranceExponent: exponent ?? 1.07, personallyEvidenced: exponent != null, confidence: 0.6 },
          },
        },
      } as unknown as RaceOutlookReads['anchorRead']);
  const equivalenceAt: RaceOutlookReads['equivalenceAt'] = o.equivalenceAt ?? (async (v) => {
    if (v == null) return null;
    const danielsSec = predictRaceTime(v, 26.2);
    if (danielsSec == null) return null;
    // A personal exponent slower than 1.06 stretches the marathon.
    const factor = exponent != null ? Math.pow(26.2 / 13.1, exponent - 1.06) : 1;
    const expectedSec = Math.round(danielsSec * factor);
    return {
      expectedSec, danielsSec, durabilityProjectionSec: expectedSec,
      durabilityBlend: exponent != null ? { weight: 0.5 } : null,
      specificityAdjustment: null, marathonSpecificTraining: null,
    } as unknown as CurrentEquivalence;
  });
  return {
    anchorRead,
    threshold,
    durabilityRead,
    equivalenceAt,
    executionSignal: o.executionQuality === undefined
      ? ({ executionQuality: 1.0, overPerformanceBonusVdot: 0, recentTestPoints: [{}, {}], executionAbsence: null, missedKeyWorkoutDrift: null } as unknown as RaceOutlookReads['executionSignal'])
      : o.executionQuality == null ? null
      : ({ executionQuality: o.executionQuality, overPerformanceBonusVdot: 0, recentTestPoints: [{}], executionAbsence: null, missedKeyWorkoutDrift: null } as unknown as RaceOutlookReads['executionSignal']),
    lthrBpm: o.lthrBpm === undefined ? 168 : o.lthrBpm,
    maxHrBpm: o.maxHrBpm === undefined ? 180 : o.maxHrBpm,
    hrEfforts: [],
    plannedLastRehearsalPaceSecPerMi: o.plannedLastRehearsalPaceSecPerMi ?? null,
  };
}
