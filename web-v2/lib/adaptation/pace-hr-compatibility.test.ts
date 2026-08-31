/**
 * lib/adaptation/pace-hr-compatibility.test.ts
 *
 * `docs/PRODUCT_DECISIONS.md` 2026-09-01 §3 requires a "mandatory
 * compatibility validator" between an independently-resolved PACE proposal
 * and an independently-resolved HR guard. Per Rule 18 (CLAUDE.md — "a gate
 * is not trusted until it has been made to fail"), this suite falsifies the
 * validator in both directions: a real, currently-live case that must pass
 * (the owner's actual 438→430 s/mi threshold proposal), and a synthetic case
 * engineered to fail (proving REFUSE actually fires, not just COMPATIBLE by
 * construction).
 *
 * The real-data case's session HR values were read from the live database
 * over the read-only role on 2026-08-31 — see `docs/reports/
 * pace-hr-compatibility-2026-09-01.md` for the full provenance, including the
 * one session excluded for missing split-level HR (Rule 11: not guessed, not
 * defaulted, named).
 */
import { describe, it, expect } from 'vitest';
import {
  checkPaceHrCompatibility,
  MATERIAL_INCOMPATIBILITY_MIN_SESSIONS,
  UNEXPLAINED_OVERAGE_MATERIAL_BPM,
  STALE_CEILING_UNDERSHOOT_BPM,
} from './pace-hr-compatibility';

describe('checkPaceHrCompatibility · real production case', () => {
  it('the owner\'s live 438→430 s/mi threshold proposal is COMPATIBLE, HR unchanged', () => {
    // resolveThresholdCapacity(userId='0645f40c-951d-4ccc-b86e-9979cd26c795',
    // '2026-09-01') returned paceSecPerMi:430, evidenceIds: ['-280549580846348',
    // '-226755616416002', '-87627419857791']. 438 is the pre-decision blended
    // prescribed pace named in adaptation-engine.ts's PacePhaseRead doc
    // comment. LTHR 168, set 2026-08-31 from Americas Finest City (fresh).
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 438,
      proposedSecPerMi: 430,
      lthrBpm: 168,
      sessions: [
        // No split data persisted for this activity — cannot isolate a
        // work-segment HR, so it is excluded rather than guessed at.
        { activityId: '-226755616416002', dateISO: '2026-08-unknown', avgWorkHrBpm: null, tempF: null },
        // Miles 3-6 (7:13, 7:04, 7:22, 6:27/mi) read as the work portion by
        // pace; avg HR across them.
        { activityId: '-87627419857791', dateISO: '2026-08-unknown', avgWorkHrBpm: (170 + 167 + 158 + 158) / 4, tempF: 70.2 },
        // Only one split (7:33/mi) reads near threshold pace; the rest of
        // the run sits at easy pace.
        { activityId: '-280549580846348', dateISO: '2026-08-unknown', avgWorkHrBpm: 149, tempF: 73.5 },
      ],
      lthrReanchor: { stale: false, action: 'none', why: 'Set 2026-08-31 · inside the re-test cadence.' },
    });

    expect(result.verdict).toBe('COMPATIBLE');
    expect(result.paceProposalMayProceed).toBe(true);
    expect(result.z4BandBpm).toEqual({ lower: 160, upper: 167 });
    expect(result.excludedForMissingHr).toEqual(['-226755616416002']);
    expect(result.sessionReads).toHaveLength(2);
    // Every read is at or under the Z4 ceiling · nothing "unexplained_hot".
    for (const r of result.sessionReads) {
      expect(['within_band', 'below_band']).toContain(r.classification);
    }
  });
});

describe('checkPaceHrCompatibility · falsification (Rule 18) — it must actually refuse', () => {
  it('SYNTHETIC · repeated controlled sessions well over the Z4 ceiling, no heat, REFUSE the pace step', () => {
    // Constructed, not real: a runner proposing 430→410 s/mi (a large jump)
    // whose three most recent controlled threshold sessions all ran avg work
    // HR 12-15 bpm over his own Z4 ceiling (160-167 at LTHR 168), on cool
    // days (55°F, well under the 77°F heat-confounder threshold), so there
    // is no environmental explanation available.
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 430,
      proposedSecPerMi: 410,
      lthrBpm: 168,
      sessions: [
        { activityId: 'synthetic-1', dateISO: '2026-08-10', avgWorkHrBpm: 182, tempF: 55 },
        { activityId: 'synthetic-2', dateISO: '2026-08-17', avgWorkHrBpm: 180, tempF: 52 },
        { activityId: 'synthetic-3', dateISO: '2026-08-24', avgWorkHrBpm: 179, tempF: 58 },
      ],
    });

    expect(result.verdict).toBe('INCOMPATIBLE_REFUSE');
    expect(result.paceProposalMayProceed).toBe(false);
    expect(result.sessionReads.every((r) => r.classification === 'unexplained_hot')).toBe(true);
    expect(result.reason).toMatch(/refuse/i);
  });

  it('SYNTHETIC · the same HR overage, explained by heat, does NOT refuse (policy (b))', () => {
    // Same avg work HR pattern as above, but every session ran at 90°F —
    // heatHrBumpBpm(90) is the doctrine table's top-of-band (~20 bpm), which
    // fully explains a 12-15 bpm overage. This is the case the decision
    // explicitly warns against conflating with a real incompatibility.
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 430,
      proposedSecPerMi: 410,
      lthrBpm: 168,
      sessions: [
        { activityId: 'synthetic-hot-1', dateISO: '2026-08-10', avgWorkHrBpm: 182, tempF: 90 },
        { activityId: 'synthetic-hot-2', dateISO: '2026-08-17', avgWorkHrBpm: 180, tempF: 90 },
        { activityId: 'synthetic-hot-3', dateISO: '2026-08-24', avgWorkHrBpm: 179, tempF: 90 },
      ],
    });

    expect(result.verdict).toBe('COMPATIBLE_ENVIRONMENTAL_EXPLAINED');
    expect(result.paceProposalMayProceed).toBe(true);
    expect(result.sessionReads.every((r) => r.classification === 'environmental')).toBe(true);
  });

  it('SYNTHETIC · repeated clean undershoot flags a possibly-stale HR ceiling, still COMPATIBLE', () => {
    // Three controlled sessions all running 6-8 bpm under the Z4 floor —
    // policy (c): compatible, pace proceeds, but the ceiling itself is
    // flagged as the HR owner's evidence to act on, not silently moved here.
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 430,
      proposedSecPerMi: 420,
      lthrBpm: 168,
      sessions: [
        { activityId: 's1', dateISO: '2026-08-10', avgWorkHrBpm: 153, tempF: 60 },
        { activityId: 's2', dateISO: '2026-08-17', avgWorkHrBpm: 152, tempF: 60 },
        { activityId: 's3', dateISO: '2026-08-24', avgWorkHrBpm: 154, tempF: 60 },
      ],
    });

    expect(result.verdict).toBe('COMPATIBLE_HR_CEILING_LIKELY_STALE');
    expect(result.paceProposalMayProceed).toBe(true);
  });

  it('no LTHR on file → INSUFFICIENT_HR_EVIDENCE, never a silent pass through a fabricated band', () => {
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 430,
      proposedSecPerMi: 420,
      lthrBpm: null,
      sessions: [{ activityId: 's1', dateISO: '2026-08-10', avgWorkHrBpm: 180, tempF: 60 }],
    });
    expect(result.verdict).toBe('INSUFFICIENT_HR_EVIDENCE');
    expect(result.z4BandBpm).toBeNull();
    // The proposal is not blocked on a check that structurally cannot run —
    // see the file header's reasoning on this call.
    expect(result.paceProposalMayProceed).toBe(true);
  });

  it('one or two hot sessions (below the corroboration bar) do not refuse — mirrors PACE_PROGRESS_MIN_SESSIONS', () => {
    const result = checkPaceHrCompatibility({
      previousSecPerMi: 430,
      proposedSecPerMi: 420,
      lthrBpm: 168,
      sessions: [
        { activityId: 's1', dateISO: '2026-08-10', avgWorkHrBpm: 182, tempF: 55 },
        { activityId: 's2', dateISO: '2026-08-17', avgWorkHrBpm: 163, tempF: 55 },
      ],
    });
    expect(result.verdict).not.toBe('INCOMPATIBLE_REFUSE');
    expect(result.paceProposalMayProceed).toBe(true);
  });
});

describe('checkPaceHrCompatibility · policy constants are documented, not magic', () => {
  it('exposes its thresholds so a caller (or a future audit) can cite them', () => {
    expect(MATERIAL_INCOMPATIBILITY_MIN_SESSIONS).toBe(3);
    expect(UNEXPLAINED_OVERAGE_MATERIAL_BPM).toBeGreaterThan(0);
    expect(STALE_CEILING_UNDERSHOOT_BPM).toBeGreaterThan(UNEXPLAINED_OVERAGE_MATERIAL_BPM);
  });
});
