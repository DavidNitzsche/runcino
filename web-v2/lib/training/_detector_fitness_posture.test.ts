/**
 * lib/training/_detector_fitness_posture.test.ts
 *
 * Q6 · all four states, as tests. Agreement, disagreement, unavailable
 * evidence, read failure — and the three silences kept apart, because
 * `return null` today collapses them and that collapse is Rule 11's most
 * expensive shape.
 *
 * ── WHAT THIS SUITE CANNOT FAIL ON (Rule 22) ────────────────────────────────
 *
 * · WHETHER `adapt.ts` ACTUALLY BEHAVES THIS WAY. It does not. Nothing on
 *   this branch is wired, by design, and this file describes a posture rather
 *   than observing one. A green run here says the SPEC is coherent and
 *   testable, never that the engine follows it (Rule 19: green is not
 *   deployed; here it is not even wired).
 * · WHETHER THE DELTA THE DETECTOR THEN COMPUTES IS RIGHT. This decides
 *   whether the detector may evaluate at all and hands it the anchor; the
 *   firing predicates (`trainingLeadFires` / `fitnessRegressionFires`) are
 *   unchanged and untested here.
 * · WHETHER AN OPS ALERT IS ACTUALLY WRITTEN. `raise` is a boolean this
 *   returns. `ops_alerts` is somebody else's write path.
 * · THE ONE THING A DIRECTION-BLIND FUNCTION CANNOT CATCH: a caller that
 *   applies the posture to one detector and not the other. Nothing here can
 *   see a call site.
 */
import { describe, it, expect } from 'vitest';
import type { CapacityReasonCode, SourceMode } from '@/lib/training/capacity-resolver';
import type { CurrentFitnessRead } from '@/lib/training/resolve-current-fitness';
import {
  fitnessDetectorPosture,
  EVIDENCE_BEARING_SOURCE_MODES,
} from '@/lib/training/detector-fitness-posture';

const REAL_REASONS: CapacityReasonCode[] = [
  'DIRECT_CORROBORATED_THRESHOLD_EVIDENCE',
  'THREE_RECENT_CORROBORATING_SESSIONS',
  'OBSERVATIONS_AGREE',
  'FRESH_EVIDENCE',
  'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
  'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
];

function read(over: {
  reasons?: CapacityReasonCode[];
  sourceMode?: SourceMode;
  evidenceIds?: string[];
  vdot?: number | null;
  legacy?: CurrentFitnessRead['provenance']['legacyProbe'];
  refuse?: { reason: 'BELIEF_SNAPSHOT_DISAGREEMENT' | 'INCOMPARABLE_BELOW_TABLE'; detail: string };
} = {}): CurrentFitnessRead {
  const provenance: CurrentFitnessRead['provenance'] = {
    canonicalBelief: {
      vdot: over.vdot === undefined ? 47.5 : over.vdot,
      paceSecPerMi: 432,
      confidence: 0.772,
      sourceMode: over.sourceMode ?? 'direct',
      reasons: over.reasons ?? REAL_REASONS,
      evidenceIds: over.evidenceIds ?? ['-258355938987883', '-87627419857791', '-75144899844434'],
      resolvedAt: '2026-09-13T10:38:55.138Z',
    },
    legacyProbe: over.legacy ?? {
      status: 'ok',
      snapshot: { reviewedVdot: 46.6, authoredStateVdot: 47.7, cascadeVdot: 46.6 },
    },
    deltaVdot: 0.9,
    disagreementThresholdVdot: 2,
  };
  if (over.refuse) {
    return { ok: false, reason: over.refuse.reason, detail: over.refuse.detail, provenance };
  }
  return {
    ok: true,
    vdot: (over.vdot === undefined ? 47.5 : over.vdot) as number,
    paceSecPerMi: 432,
    confidence: 0.772,
    sourceMode: over.sourceMode ?? 'direct',
    provenance,
  };
}

describe('STATE 1 · AGREEMENT → EVALUATE, against the CANONICAL anchor', () => {
  it('evaluates on the owner’s real live read, and carries the caveats with the number', () => {
    const p = fitnessDetectorPosture(read());
    expect(p.posture).toBe('EVALUATE');
    if (p.posture !== 'EVALUATE') throw new Error('unreachable');
    // The anchor handed to the detector is 47.5, the canonical belief — NOT
    // 46.6, the frozen legacy cascade the detectors read today. That
    // substitution is the entire adoption.
    expect(p.canonicalVdot).toBe(47.5);
    expect(p.caveats).toEqual([
      'REDUCED_AUTHORITY_EVIDENCE_IN_SUPPORT',
      'NON_REPRESENTATIVE_EVIDENCE_IN_SUPPORT',
    ]);
    expect(p.evidenceIds.length).toBe(3);
  });

  it('evaluates with an EMPTY caveat list on a clean read', () => {
    const p = fitnessDetectorPosture(read({
      reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE', 'OBSERVATIONS_AGREE', 'FRESH_EVIDENCE'],
    }));
    expect(p.posture).toBe('EVALUATE');
    if (p.posture !== 'EVALUATE') throw new Error('unreachable');
    expect(p.caveats).toEqual([]);
  });

  it('still evaluates when the legacy cross-check itself FAILED — a broken cross-check does not veto §C', () => {
    const p = fitnessDetectorPosture(read({ legacy: { status: 'failed' } }));
    expect(p.posture).toBe('EVALUATE');
  });

  it('still evaluates when there is no legacy anchor at all', () => {
    expect(fitnessDetectorPosture(read({ legacy: { status: 'none' } })).posture).toBe('EVALUATE');
  });
});

describe('STATE 2 · DISAGREEMENT → HOLD, and RAISE', () => {
  it('holds both detectors and raises, rather than picking a side', () => {
    const p = fitnessDetectorPosture(read({
      refuse: {
        reason: 'BELIEF_SNAPSHOT_DISAGREEMENT',
        detail: 'canonical 51.0 vs legacy 46.6, 4.4 apart.',
      },
    }));
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('BELIEFS_DISAGREE');
    // Load-bearing: measured on 45 days of the owner's real history the
    // cross-check answered `ok` every day at delta +0.90..+1.30 against a
    // 2.00 threshold, while the legacy anchor is FROZEN and the canonical
    // belief rises. When it does cross, it crosses permanently. A silent hold
    // would stop the pace lever forever with nothing reporting it.
    expect(p.raise).toBe(true);
    expect(p.why).toMatch(/contradict/);
  });
});

describe('STATE 3 · UNAVAILABLE EVIDENCE → HOLD, no raise', () => {
  it('holds a brand-new runner answered from the population prior', () => {
    const p = fitnessDetectorPosture(read({
      sourceMode: 'population_prior',
      evidenceIds: [],
      reasons: ['MILEAGE_POPULATION_PRIOR', 'NO_DIRECT_EVIDENCE'],
      vdot: 38.0,
    }));
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('NO_RUNNER_EVIDENCE');
    // Not a fault. A new runner with no corpus is the system working.
    expect(p.raise).toBe(false);
  });

  it('holds a self-reported onboarding prior — a declaration is not an observation', () => {
    const p = fitnessDetectorPosture(read({
      sourceMode: 'user_prior', evidenceIds: [], reasons: ['ONBOARDING_PR_USER_PRIOR'], vdot: 44.0,
    }));
    expect(p.posture).toBe('HOLD');
  });

  it('holds `vdot_fallback` — admitting it would be the legacy cascade through a canonical door', () => {
    const p = fitnessDetectorPosture(read({
      sourceMode: 'vdot_fallback', evidenceIds: ['run-x'], reasons: ['MEASURED_VDOT_FALLBACK'],
    }));
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('NO_RUNNER_EVIDENCE');
  });

  it('holds an evidence-bearing sourceMode that nevertheless names ZERO observations', () => {
    // Belt and braces: the mode says `direct` and nothing is named. Rule 11 —
    // a claim of direct evidence with no evidence is not a direct read.
    const p = fitnessDetectorPosture(read({ sourceMode: 'direct', evidenceIds: [] }));
    expect(p.posture).toBe('HOLD');
  });

  it('holds a below-table runner without calling it a fault', () => {
    const p = fitnessDetectorPosture(read({
      refuse: { reason: 'INCOMPARABLE_BELOW_TABLE', detail: 'below-table pace, 900 s/mi.' },
    }));
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('NO_RUNNER_EVIDENCE');
    expect(p.raise).toBe(false);
  });

  it('the evidence-bearing list is exactly the three observed modes, and is not empty', () => {
    expect([...EVIDENCE_BEARING_SOURCE_MODES].sort())
      .toEqual(['direct', 'inferred', 'race_derived']);
  });
});

describe('STATE 4 · READ FAILURE → HOLD, and RAISE, distinct from state 3', () => {
  it('holds and raises on a thrown read', () => {
    const p = fitnessDetectorPosture({ threw: true, why: 'connection terminated unexpectedly' });
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('READ_FAILED');
    expect(p.raise).toBe(true);
  });

  it('READ_FAILED and NO_RUNNER_EVIDENCE are different silences and differ on `raise`', () => {
    // The Rule 11 assertion, stated as the comparison rather than as prose.
    const failed = fitnessDetectorPosture({ threw: true, why: 'x' });
    const none = fitnessDetectorPosture(read({ sourceMode: 'population_prior', evidenceIds: [] }));
    if (failed.posture !== 'HOLD' || none.posture !== 'HOLD') throw new Error('unreachable');
    expect(failed.silence).not.toBe(none.silence);
    expect(failed.raise).not.toBe(none.raise);
  });
});

describe('the disqualified-evidence silence, which is none of the four but must not be one of them', () => {
  it('holds without raising when the evidence carries a Rule 11 absence', () => {
    const p = fitnessDetectorPosture(read({
      reasons: [...REAL_REASONS, 'EVIDENCE_ENGINE_READ_UNAVAILABLE'],
    }));
    expect(p.posture).toBe('HOLD');
    if (p.posture !== 'HOLD') throw new Error('unreachable');
    expect(p.silence).toBe('EVIDENCE_DISQUALIFIED');
    expect(p.raise).toBe(false);
  });
});

describe('Rule 21 · the bar is symmetric BY SIGNATURE, not by intention', () => {
  it('the posture function takes no direction argument, so no asymmetry is expressible', () => {
    expect(fitnessDetectorPosture.length).toBe(1);
  });

  it('every posture is a typed value — no branch returns undefined/null (Rule 21)', () => {
    // "An engine that returns nothing when it cannot decide is
    // indistinguishable from an engine that was never called."
    const cases: Parameters<typeof fitnessDetectorPosture>[0][] = [
      read(),
      read({ reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'] }),
      read({ legacy: { status: 'failed' } }),
      read({ sourceMode: 'population_prior', evidenceIds: [] }),
      read({ reasons: [...REAL_REASONS, 'EVIDENCE_ENGINE_READ_UNAVAILABLE'] }),
      read({ refuse: { reason: 'BELIEF_SNAPSHOT_DISAGREEMENT', detail: 'd' } }),
      read({ refuse: { reason: 'INCOMPARABLE_BELOW_TABLE', detail: 'd' } }),
      { threw: true, why: 'x' },
    ];
    // Liveness (Rule 18): the loop is not passing over nothing.
    expect(cases.length).toBe(8);
    for (const c of cases) {
      const p = fitnessDetectorPosture(c);
      expect(p).not.toBeNull();
      expect(['EVALUATE', 'HOLD']).toContain(p.posture);
      if (p.posture === 'HOLD') expect(p.why.length).toBeGreaterThan(0);
    }
  });

  it('the distribution is counted, not accumulated (Rule 22)', () => {
    // 4 of the 8 shapes above evaluate, 4 hold. Stated so a future change
    // that quietly turns this into 1 and 7 fails here rather than passing
    // quietly as "more careful".
    const cases: Parameters<typeof fitnessDetectorPosture>[0][] = [
      read(),
      read({ reasons: ['DIRECT_CORROBORATED_THRESHOLD_EVIDENCE'] }),
      read({ legacy: { status: 'failed' } }),
      read({ legacy: { status: 'none' } }),
      read({ sourceMode: 'population_prior', evidenceIds: [] }),
      read({ reasons: [...REAL_REASONS, 'EVIDENCE_ENGINE_READ_UNAVAILABLE'] }),
      read({ refuse: { reason: 'BELIEF_SNAPSHOT_DISAGREEMENT', detail: 'd' } }),
      { threw: true, why: 'x' },
    ];
    const evaluate = cases.filter((c) => fitnessDetectorPosture(c).posture === 'EVALUATE').length;
    expect(evaluate).toBe(4);
    expect(cases.length - evaluate).toBe(4);
  });
});
