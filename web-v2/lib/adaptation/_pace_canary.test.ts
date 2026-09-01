/**
 * lib/adaptation/_pace_canary.test.ts · pure-logic tests for the owner-only
 * PACE canary's gate (`pace-canary-config.ts`) and eligibility decision
 * (`pace-canary.ts`'s `decidePaceCanaryEligibility`).
 *
 * No database. Every refusal path the spec names (contaminated,
 * insufficient-evidence, HR-incompatible, contradictory) is exercised here
 * directly against constructed `ShadowCompareRecord` fixtures — the same
 * discipline `pace-hr-compatibility.test.ts` already uses for its own pure
 * function. Write-path tests (rate limit against real persisted state,
 * atomic apply, rollback, reanchor-defer) live in
 * `lib/adaptation-harness/pace-canary.harness.test.ts`, against the
 * disposable local scratch database — never here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  decidePaceCanaryEligibility,
  PACE_CANARY_MAX_STEP_SEC_PER_MI,
  PACE_CANARY_RATE_LIMIT_DAYS,
} from './pace-canary';
import {
  resolvePaceCanaryGate,
  paceCanaryMayRunFor,
  PACE_CANARY_OWNER_UUID_REFERENCE,
} from './pace-canary-config';
import type { ShadowCompareRecord } from './shadow-compare';
import type { PacePhaseOutcome } from './adaptation-engine';

const ENV_KEYS = ['PACE_CANARY_ENABLED', 'PACE_CANARY_ALLOWLIST', 'PACE_CANARY_KILL'] as const;
function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}
afterEach(clearEnv);

const OWNER = PACE_CANARY_OWNER_UUID_REFERENCE;
const OTHER = '11111111-1111-1111-1111-111111111111';

/* ══════════════════════════════════════════════════════════════════════════
 * GATE — both flag and allowlist default off/empty; three independent gates.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('resolvePaceCanaryGate · defaults and independence', () => {
  it('is disabled and no one is allowlisted with no env set at all (the committed default)', () => {
    clearEnv();
    const gate = resolvePaceCanaryGate(OWNER);
    expect(gate.enabled).toBe(false);
    expect(gate.allowlisted).toBe(false);
    expect(gate.killed).toBe(false);
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
  });

  it('flag alone does not make anyone eligible — allowlist is a second, independent gate', () => {
    process.env.PACE_CANARY_ENABLED = '1';
    // PACE_CANARY_ALLOWLIST intentionally left unset.
    const gate = resolvePaceCanaryGate(OWNER);
    expect(gate.enabled).toBe(true);
    expect(gate.allowlisted).toBe(false);
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
  });

  it('allowlisting alone, without the flag, does not enable anything', () => {
    process.env.PACE_CANARY_ALLOWLIST = OWNER;
    const gate = resolvePaceCanaryGate(OWNER);
    expect(gate.enabled).toBe(false);
    expect(gate.allowlisted).toBe(true);
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
  });

  it('only fires when BOTH the flag is on and the user is allowlisted', () => {
    process.env.PACE_CANARY_ENABLED = '1';
    process.env.PACE_CANARY_ALLOWLIST = `${OTHER}, ${OWNER} `;
    expect(paceCanaryMayRunFor(OWNER)).toBe(true);
    expect(paceCanaryMayRunFor(OTHER)).toBe(true);
    expect(paceCanaryMayRunFor('22222222-2222-2222-2222-222222222222')).toBe(false);
  });

  it('the kill switch always wins, even with the flag on and the user allowlisted', () => {
    process.env.PACE_CANARY_ENABLED = '1';
    process.env.PACE_CANARY_ALLOWLIST = OWNER;
    process.env.PACE_CANARY_KILL = '1';
    const gate = resolvePaceCanaryGate(OWNER);
    expect(gate.killed).toBe(true);
    expect(gate.enabled).toBe(false);
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
  });

  it('reads process.env FRESH on every call — flippable without a re-import, mirroring a no-deploy env change', () => {
    clearEnv();
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
    process.env.PACE_CANARY_ENABLED = '1';
    process.env.PACE_CANARY_ALLOWLIST = OWNER;
    // Same imported function, same process, no re-import — this is the
    // mechanical proof that the gate is not a build-time constant.
    expect(paceCanaryMayRunFor(OWNER)).toBe(true);
    delete process.env.PACE_CANARY_ENABLED;
    expect(paceCanaryMayRunFor(OWNER)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ELIGIBILITY — every hard-refusal path the spec names, plus the eligible
 * case, against constructed ShadowCompareRecord fixtures.
 * ═══════════════════════════════════════════════════════════════════════ */

function phase(overrides: Partial<PacePhaseOutcome> = {}): PacePhaseOutcome {
  return {
    phaseLabel: 'QUALITY', prescribedSecPerMi: 440, rowCount: 3,
    firstDateISO: '2026-09-08', lastDateISO: '2026-09-21',
    previousSecPerMi: 440, proposedSecPerMi: 437, stepSecPerMi: 3, moved: true,
    ...overrides,
  };
}

function baseRecord(overrides: Partial<ShadowCompareRecord> = {}): ShadowCompareRecord {
  return {
    userUuid: OWNER, planId: 'pln_test', todayISO: '2026-09-01', resolvedAt: '2026-09-01T03:00:00.000Z',
    modelVersion: '1.0.0',
    convergence: {
      readable: true, planId: 'pln_test', authoredIso: '2026-08-01T00:00:00.000Z',
      lastCanonicalReanchorAt: '2026-08-02T00:00:00.000Z', state: 'REANCHORED_CANONICALLY',
      detail: 'converged',
    },
    engine: {
      readable: true, decision: 'PROGRESS', reasonCodes: ['REPEATED_CONTROLLED_QUALITY_EXECUTION'],
      explanation: 'Move it.', previous: { unit: 'sec_per_mi', value: 440 },
      proposed: { unit: 'sec_per_mi', value: 437 }, confidence: 0.8,
      phaseBreakdown: [phase()], refusals: [],
    },
    workoutFamily: ['threshold', 'tempo', 'cruise'],
    capacityBelief: {
      paceSecPerMi: 437, vdot: 50, confidence: 0.8, sourceMode: 'direct',
      evidenceIds: ['run_1'], reasons: [],
    },
    evidenceDates: [],
    representativeObservations: [],
    excludedObservations: {
      windowDays: 28, representativeDays: 28, excludedDays: 0,
      reachedOuterBound: false, stalenessFactor: 1,
    },
    hrCompatibility: {
      verdict: 'COMPATIBLE', paceProposalMayProceed: true, reason: 'fine',
      z4BandBpm: { lower: 158, upper: 168 }, sessionReads: [], excludedForMissingHr: [],
      lthrReanchorAdvisory: null,
    },
    contradictions: [],
    finalDecision: 'PROGRESS', finalDecisionReason: null,
    live: { readable: true, trainingLeadFired: false, recomputePacesFired: false, reason: null },
    agreesWithLive: true,
    mutation: { checksumBefore: 'a:1', checksumAfter: 'a:1', verified: true },
    ...overrides,
  };
}

describe('decidePaceCanaryEligibility · eligible case', () => {
  it('is eligible when everything lines up', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord(), tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(true);
    expect(d.refusalCode).toBeNull();
    expect(d.movingPhases).toHaveLength(1);
  });
});

describe('decidePaceCanaryEligibility · hard refusals (item 7 of the spec)', () => {
  it('refuses when the applications table does not exist — structural, checked first', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord(), tableExists: false, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('PERSISTENCE_TABLE_MISSING');
  });

  it('refuses (never assumes "no prior application") when the rate-limit read failed', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord(), tableExists: true, lastApplied: 'UNREADABLE', todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('RATE_LIMIT_UNREADABLE');
  });

  it(`refuses a second application inside the ${PACE_CANARY_RATE_LIMIT_DAYS}-day rate limit`, () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord(), tableExists: true,
      lastApplied: '2026-08-28T00:00:00.000Z', // 4 days before todayISO
      todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('RATE_LIMITED');
  });

  it('allows an application exactly at the rate-limit boundary and beyond', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord(), tableExists: true,
      lastApplied: '2026-08-25T00:00:00.000Z', // 7 days before todayISO
      todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(true);
  });

  it('refuses on MATERIAL_INCOMPATIBILITY (HR-incompatible) via finalDecision', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        finalDecision: 'REFUSED_HR_INCOMPATIBLE',
        finalDecisionReason: 'HR evidence disagrees.',
        hrCompatibility: {
          verdict: 'INCOMPATIBLE_REFUSE', paceProposalMayProceed: false, reason: 'HR evidence disagrees.',
          z4BandBpm: { lower: 158, upper: 168 }, sessionReads: [], excludedForMissingHr: [],
          lthrReanchorAdvisory: null,
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('HR_INCOMPATIBLE');
    expect(d.refusalDetail).toContain('HR evidence disagrees');
  });

  it('does NOT refuse on INSUFFICIENT_HR_EVIDENCE — "could not check" is not "checked and disagrees"', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        // finalDecision stays PROGRESS — INSUFFICIENT_HR_EVIDENCE never refuses on its own,
        // matching pace-hr-compatibility.ts's own contract (paceProposalMayProceed: true).
        hrCompatibility: {
          verdict: 'INSUFFICIENT_HR_EVIDENCE', paceProposalMayProceed: true, reason: 'No LTHR on file.',
          z4BandBpm: null, sessionReads: [], excludedForMissingHr: ['run_1'], lthrReanchorAdvisory: null,
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(true);
  });

  it('refuses on HOLD (insufficient-evidence-shaped) PACE decisions', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        engine: {
          readable: true, decision: 'INSUFFICIENT_EVIDENCE', reasonCodes: ['NO_QUALITY_EVIDENCE_IN_WINDOW'],
          explanation: 'No quality session in the window.', previous: { unit: 'sec_per_mi', value: 440 },
          proposed: { unit: 'sec_per_mi', value: 440 }, confidence: 0, phaseBreakdown: [phase({ moved: false, stepSecPerMi: 0 })],
          refusals: [],
        },
        finalDecision: 'INSUFFICIENT_EVIDENCE',
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('NOT_PROGRESS_DECISION');
  });

  it('refuses when authoring/reanchor convergence is contaminated (AUTHORED_TOO_RECENTLY)', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        convergence: {
          readable: true, planId: 'pln_test', authoredIso: '2026-09-01T00:00:00.000Z',
          lastCanonicalReanchorAt: null, state: 'AUTHORED_TOO_RECENTLY', detail: 'no reanchor yet',
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('CONTAMINATED_EVIDENCE');
  });

  it('refuses when authoring/reanchor convergence is REANCHOR_STATUS_UNKNOWN', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        convergence: {
          readable: true, planId: 'pln_test', authoredIso: '2026-08-01T00:00:00.000Z',
          lastCanonicalReanchorAt: null, state: 'REANCHOR_STATUS_UNKNOWN', detail: 'cannot tell',
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('CONTAMINATED_EVIDENCE');
  });

  it('refuses when the shadow-compare contradiction validator named a contradiction', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        contradictions: [{
          code: 'PROGRESS_ON_UNCONVERGED_EVIDENCE',
          detail: 'The PACE engine proposed PROGRESS while convergence state is AUTHORED_TOO_RECENTLY.',
        }],
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('CONTRADICTIONS_PRESENT');
  });

  it('refuses when no phase in the breakdown actually moved, even if decision says PROGRESS', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        engine: {
          readable: true, decision: 'PROGRESS', reasonCodes: [], explanation: null,
          previous: { unit: 'sec_per_mi', value: 440 }, proposed: { unit: 'sec_per_mi', value: 440 },
          confidence: 0.8, phaseBreakdown: [phase({ moved: false, stepSecPerMi: 0, proposedSecPerMi: 440 })],
          refusals: [],
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('NO_MOVING_PHASES');
  });

  it(`refuses when a moving phase's step exceeds the ${PACE_CANARY_MAX_STEP_SEC_PER_MI} sec/mi operational canary limit`, () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        engine: {
          readable: true, decision: 'PROGRESS', reasonCodes: [], explanation: null,
          previous: { unit: 'sec_per_mi', value: 440 }, proposed: { unit: 'sec_per_mi', value: 434 },
          confidence: 0.8,
          phaseBreakdown: [phase({ stepSecPerMi: PACE_CANARY_MAX_STEP_SEC_PER_MI + 0.1, proposedSecPerMi: 434 })],
          refusals: [],
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(false);
    expect(d.refusalCode).toBe('EXCEEDS_OPERATIONAL_CANARY_LIMIT');
  });

  it('allows a step exactly AT the operational canary limit', () => {
    const d = decidePaceCanaryEligibility({
      record: baseRecord({
        engine: {
          readable: true, decision: 'PROGRESS', reasonCodes: [], explanation: null,
          previous: { unit: 'sec_per_mi', value: 440 }, proposed: { unit: 'sec_per_mi', value: 435 },
          confidence: 0.8,
          phaseBreakdown: [phase({ stepSecPerMi: PACE_CANARY_MAX_STEP_SEC_PER_MI, proposedSecPerMi: 435 })],
          refusals: [],
        },
      }),
      tableExists: true, lastApplied: null, todayISO: '2026-09-01',
    });
    expect(d.eligible).toBe(true);
  });
});
