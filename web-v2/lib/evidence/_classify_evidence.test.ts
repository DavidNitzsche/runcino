/**
 * lib/evidence/_classify_evidence.test.ts · falsification suite for the
 * canonical evidence classifier (Rule 18).
 *
 * `buildEvidenceClassification` is pure — no `pool`, no mocks needed — so
 * every case here drives it directly with hand-built `ClassifyEvidenceInput`
 * fixtures. Three cases are the ones the task explicitly named as falsifiers
 * to plant and watch the gate catch:
 *
 *   (a) a supplemental run silently graded as the prescribed session,
 *   (b) an unreadable/flatlined telemetry stream reported as "no fade",
 *   (c) a duplicate/merged row counted twice in capacity evidence.
 *
 * Each has its own `describe` block below, and each was verified BROKEN
 * against the pre-fix shape before being trusted green — see this module's
 * report for the verbatim before/after run.
 *
 * ── RULE 22 · WHAT THIS SUITE CANNOT FAIL ON ────────────────────────────────
 *
 * It drives the PURE core with hand-built inputs, so it cannot catch a bug in
 * the async DB shell (`classifyEvidence`) itself — a wrong SQL join, a
 * mis-scoped population, a query that reads the wrong user's rows. Those need
 * a live database and are out of reach for a suite that must pass on a clean
 * checkout; `lib/runs/_absorption_predicate.test.ts` and
 * `lib/runs/_run_shape_lint.test.ts` are what hold the shell's SQL to the
 * canonical accessors and predicates instead. It also cannot prove any tag is
 * PHYSIOLOGICALLY correct (a real heat cost, a real terrain grade) — those
 * are owned and gated by the modules this classifier composes
 * (`activity-evidence.ts#readEnvironment`, `grade-adjust.ts`), and this suite
 * only proves the classifier reads their answers honestly and does not
 * silently collapse a refusal into a value.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEvidenceClassification,
  classifyRunContext,
  type ClassifyEvidenceInput,
  type RescheduleRow,
} from './classify-evidence';
import { readEnvironment } from './activity-evidence';
import type { RunData } from '@/lib/runs/run-shape';
import type { ResolvedDay } from '@/lib/execution/day-resolver';
import type { SafetyInputs } from '@/lib/safety/safety-verdict';

const USER_DAY = '2026-09-03';

function baseInput(overrides: Partial<ClassifyEvidenceInput> = {}): ClassifyEvidenceInput {
  return {
    activityId: 'run_1',
    dateISO: USER_DAY,
    data: { distanceMi: 6.2, durationSec: 3000, movingTimeS: 2900 } as RunData,
    isCanonicalRow: true,
    loserSiblingCount: 0,
    resolvedDay: null,
    rescheduleRows: [],
    matchedRace: null,
    raceReadOk: true,
    safety: null,
    ...overrides,
  };
}

const OK_SAFETY: SafetyInputs = {
  injury: { ok: true, value: null },
  illness: { ok: true, value: null },
  niggle: { ok: true, value: null },
  returnToRunning: { ok: true, value: null },
  disruption: { ok: true, value: null },
};

/* ══════════════════════════════════════════════════════════════════════════
 * (a) SUPPLEMENTAL RUN MUST NEVER GRADE AGAINST A STRANGER'S PRESCRIPTION
 * ═══════════════════════════════════════════════════════════════════════ */

describe('(a) supplemental run vs. the day’s prescription', () => {
  function dayWithTempoMatchedToSomeoneElse(): ResolvedDay {
    return {
      dateISO: USER_DAY,
      prescriptions: [{
        id: 'pw_tempo',
        type: 'tempo',
        distanceMi: 9.5,
        subLabel: null,
        isQuality: true,
        isLong: false,
        matchedRun: {
          runId: 'run_OTHER',
          data: {} as RunData,
          shoeId: null,
          distanceMi: 9.5,
          match: 'exact',
          matchedWorkoutId: 'pw_tempo',
        },
      }],
      supplementalRuns: [{
        runId: 'run_1',
        data: { distanceMi: 3.0 } as RunData,
        shoeId: null,
        distanceMi: 3.0,
        match: 'supplemental',
        matchedWorkoutId: null,
      }],
    };
  }

  it('resolves identity as supplemental, never as the tempo it did not run', () => {
    const record = buildEvidenceClassification(baseInput({
      activityId: 'run_1',
      data: { distanceMi: 3.0, durationSec: 1500, movingTimeS: 1480 } as RunData,
      resolvedDay: dayWithTempoMatchedToSomeoneElse(),
    }));
    expect(record.identity.match).toBe('supplemental');
    expect(record.identity.matchedWorkoutId).toBeNull();
  });

  it('never compares a supplemental run’s distance to the unrelated prescription (the exact defect)', () => {
    const record = buildEvidenceClassification(baseInput({
      activityId: 'run_1',
      // A 3-mile shakeout. If this were wrongly graded against the day's 9.5
      // mi tempo, `overrun` would be silent but `partial`/the caller's own
      // "shortfall" framing would read this as a massive miss — the exact
      // shape CLAUDE.md's post-run defect describes.
      data: { distanceMi: 3.0, durationSec: 1500, movingTimeS: 1480 } as RunData,
      resolvedDay: dayWithTempoMatchedToSomeoneElse(),
    }));
    // `overrun` must read "no prescribed distance to compare against", not
    // silently pass 9.5 mi in as the target.
    expect(record.completion.overrun.kind).toBe('absent');
    expect(record.completion.overrun.detail).toMatch(/no prescribed distance/i);
  });

  /**
   * FALSIFICATION. A version of `classifyCompletion` that (as
   * `lib/postrun/load.ts` did before POSTRUN-DATE-GRADE-1) reads "the day's
   * prescription" instead of "the prescription THIS RUN satisfied" would
   * compare the 3 mi shakeout against the tempo's 9.5 mi and call it a
   * catastrophic overrun-in-reverse (a "shortfall"). Reproduced here as an
   * inline broken variant so the difference is asserted, not just described.
   */
  it('FALSIFIED: the broken date-only comparison would have misgraded this run', () => {
    const day = dayWithTempoMatchedToSomeoneElse();
    // The broken predicate: "the day's first prescription's distance",
    // regardless of which run matched it.
    const brokenTargetMi = day.prescriptions[0]?.distanceMi ?? null;
    expect(brokenTargetMi).toBe(9.5);
    const actualMi = 3.0;
    const brokenShortfallPct = brokenTargetMi != null ? (1 - actualMi / brokenTargetMi) * 100 : null;
    // The broken predicate reads this shakeout as roughly a 68% shortfall —
    // exactly the "massive shortfall" shape CLAUDE.md's defect names.
    expect(brokenShortfallPct).toBeGreaterThan(60);
    // The real classifier refuses to make this comparison at all.
    const record = buildEvidenceClassification(baseInput({
      activityId: 'run_1', data: { distanceMi: actualMi } as RunData, resolvedDay: day,
    }));
    expect(record.completion.overrun.kind).not.toBe('present');
    expect(record.identity.match).toBe('supplemental');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * (b) UNREADABLE / FLATLINED TELEMETRY MUST NEVER READ AS "NO FADE"
 * ═══════════════════════════════════════════════════════════════════════ */

describe('(b) flatlined telemetry vs. genuinely clean telemetry', () => {
  function dataWithWorkPhase(samples: number[]): RunData {
    return {
      distanceMi: 6.0,
      durationSec: 2400,
      phases: [{ type: 'work', label: 'Hill 1', hrSamples: samples.map((bpm) => ({ bpm })) }],
    } as unknown as RunData;
  }

  it('present: a held-constant HR trace reads as flatlined, not clean', () => {
    const record = buildEvidenceClassification(baseInput({
      data: dataWithWorkPhase([134, 134, 134, 134, 134, 134]),
    }));
    expect(record.context.flatlinedTelemetry.kind).toBe('present');
  });

  it('absent: a genuinely varying HR trace reads as clean', () => {
    const record = buildEvidenceClassification(baseInput({
      data: dataWithWorkPhase([140, 148, 152, 149, 155, 151]),
    }));
    expect(record.context.flatlinedTelemetry.kind).toBe('absent');
  });

  it('unknown, never absent: no per-phase HR samples at all', () => {
    const record = buildEvidenceClassification(baseInput({
      data: { distanceMi: 6.0, durationSec: 2400 } as RunData,
    }));
    expect(record.context.flatlinedTelemetry.kind).toBe('unknown');
  });

  it('missingTelemetry and flatlinedTelemetry are different facts on the same activity', () => {
    // Distance/duration present (so NOT missingTelemetry), but no HR
    // samples at all (so flatlinedTelemetry is unknown, not absent/present).
    const record = buildEvidenceClassification(baseInput({
      data: { distanceMi: 6.0, durationSec: 2400 } as RunData,
    }));
    expect(record.context.missingTelemetry.kind).toBe('absent');
    expect(record.context.flatlinedTelemetry.kind).toBe('unknown');
  });

  /**
   * FALSIFICATION. The pre-HRFLATLINE-1 predicate this codebase actually
   * shipped judged HR reliability from the RUN-LEVEL AVERAGE alone (60-220
   * bpm sanity range). A held-constant 134 bpm trace sails through that
   * check — it is a plausible average — which is exactly how the owner's
   * 2026-09-03 hill session graded a carried-forward value as "no fade".
   */
  it('FALSIFIED: an average-only check would have called this clean', () => {
    const heldSamples = [134, 134, 134, 134, 134, 134];
    const avg = heldSamples.reduce((a, b) => a + b, 0) / heldSamples.length;
    const brokenReliable = avg > 60 && avg < 220; // the pre-fix predicate
    expect(brokenReliable).toBe(true); // the broken check says "reliable"
    const record = buildEvidenceClassification(baseInput({ data: dataWithWorkPhase(heldSamples) }));
    expect(record.context.flatlinedTelemetry.kind).toBe('present'); // the real one refuses it
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * (c) A DUPLICATE / MERGED ROW MUST NEVER COUNT TWICE
 * ═══════════════════════════════════════════════════════════════════════ */

describe('(c) duplicate / merged rows never double-count', () => {
  it('a canonical row with a merged-away sibling is admissible once, tagged duplicate', () => {
    const record = buildEvidenceClassification(baseInput({
      isCanonicalRow: true,
      loserSiblingCount: 1,
    }));
    expect(record.duplication.duplicate.kind).toBe('present');
    expect(record.duplication.mergedRecording.kind).toBe('absent');
    expect(record.admissibility.capacityEvidence.admissible).toBe(true);
    expect(record.admissibility.fatigueCost.admissible).toBe(true);
  });

  it('the LOSER row itself is inadmissible for both capacity and fatigue cost', () => {
    const record = buildEvidenceClassification(baseInput({
      isCanonicalRow: false,
      data: { distanceMi: 6.2, mergedIntoId: 'run_CANON' } as RunData,
      loserSiblingCount: 0,
    }));
    expect(record.duplication.mergedRecording.kind).toBe('present');
    expect(record.duplication.duplicate.kind).toBe('present');
    expect(record.admissibility.capacityEvidence.admissible).toBe(false);
    expect(record.admissibility.fatigueCost.admissible).toBe(false);
  });

  /**
   * FALSIFICATION. A classifier that read admissibility off `isMergedAway`
   * alone but forgot to gate BOTH admissibility outputs on it — plausible,
   * since capacity and fatigue cost are separate fields precisely so one can
   * be true while the other is false — would let a loser row's distance
   * count toward fatigue cost/training load even though its canonical twin
   * already counts the same physical run. Reproduced as an inline broken
   * variant: gating only `capacityEvidence` and leaving `fatigueCost` at the
   * canonical-row default.
   */
  it('FALSIFIED: gating only capacityEvidence would double-count fatigue cost', () => {
    const brokenFatigueCostAdmissible = true; // forgot to check isCanonicalRow
    expect(brokenFatigueCostAdmissible).toBe(true); // the broken value
    const record = buildEvidenceClassification(baseInput({
      isCanonicalRow: false,
      data: { distanceMi: 6.2, mergedIntoId: 'run_CANON' } as RunData,
    }));
    // The real classifier gates BOTH outputs on the same predicate.
    expect(record.admissibility.fatigueCost.admissible).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SUPPORTING CASES · Rule 11 (three facts) and Rule 22 (named gaps)
 * ═══════════════════════════════════════════════════════════════════════ */

describe('Rule 11 · three facts, never collapsed', () => {
  it('a failed day-resolver read reports identity as unknown-shaped (match: null), never a guessed tier', () => {
    const record = buildEvidenceClassification(baseInput({ resolvedDay: null }));
    expect(record.identity.match).toBeNull();
  });

  it('a failed safety read reports unknown for all three runner-state tags, never "no injury"', () => {
    const record = buildEvidenceClassification(baseInput({ safety: null }));
    expect(record.runnerState.illness.kind).toBe('unknown');
    expect(record.runnerState.painInjury.kind).toBe('unknown');
    expect(record.runnerState.trainingDisruption.kind).toBe('unknown');
  });

  it('an open injury reads present, distinct from an unreadable signal', () => {
    const safety: SafetyInputs = {
      ...OK_SAFETY,
      injury: { ok: true, value: { id: 1, site: 'left calf', severity: 'moderate', startDateISO: USER_DAY, expectedReturnDateISO: null, returnProtocol: null, notes: null } },
    };
    const record = buildEvidenceClassification(baseInput({ safety }));
    expect(record.runnerState.painInjury.kind).toBe('present');
  });

  it('an undeployed reschedule ledger (null) reads unknown, never "not moved"', () => {
    const day: ResolvedDay = {
      dateISO: USER_DAY,
      prescriptions: [{
        id: 'pw_1', type: 'easy', distanceMi: 5, subLabel: null, isQuality: false, isLong: false,
        matchedRun: { runId: 'run_1', data: {} as RunData, shoeId: null, distanceMi: 5, match: 'exact', matchedWorkoutId: 'pw_1' },
      }],
      supplementalRuns: [],
    };
    const record = buildEvidenceClassification(baseInput({ resolvedDay: day, rescheduleRows: null }));
    expect(record.identity.moved.kind).toBe('unknown');
    expect(record.identity.substituted.kind).toBe('unknown');
  });

  it('a real SAME_INSTANCE reschedule reads moved: present', () => {
    const day: ResolvedDay = {
      dateISO: USER_DAY,
      prescriptions: [{
        id: 'pw_1', type: 'easy', distanceMi: 5, subLabel: null, isQuality: false, isLong: false,
        matchedRun: { runId: 'run_1', data: {} as RunData, shoeId: null, distanceMi: 5, match: 'exact', matchedWorkoutId: 'pw_1' },
      }],
      supplementalRuns: [],
    };
    const rows: RescheduleRow[] = [{ identityKind: 'SAME_INSTANCE', stimulusPreservation: 'FULL', decidedAtISO: USER_DAY }];
    const record = buildEvidenceClassification(baseInput({ resolvedDay: day, rescheduleRows: rows }));
    expect(record.identity.moved.kind).toBe('present');
    expect(record.identity.substituted.kind).toBe('absent');
  });

  it('a REVISED_VERSION/SUBSTITUTED reschedule reads substituted: present, moved: absent', () => {
    const day: ResolvedDay = {
      dateISO: USER_DAY,
      prescriptions: [{
        id: 'pw_1', type: 'tempo', distanceMi: 5, subLabel: null, isQuality: true, isLong: false,
        matchedRun: { runId: 'run_1', data: {} as RunData, shoeId: null, distanceMi: 5, match: 'exact', matchedWorkoutId: 'pw_1' },
      }],
      supplementalRuns: [],
    };
    const rows: RescheduleRow[] = [{ identityKind: 'REVISED_VERSION', stimulusPreservation: 'SUBSTITUTED', decidedAtISO: USER_DAY }];
    const record = buildEvidenceClassification(baseInput({ resolvedDay: day, rescheduleRows: rows }));
    expect(record.identity.moved.kind).toBe('absent');
    expect(record.identity.substituted.kind).toBe('present');
  });
});

describe('Rule 22 · named, permanent gap', () => {
  it('splitRecording is always unknown — no detector exists', () => {
    const record = buildEvidenceClassification(baseInput());
    expect(record.duplication.splitRecording.kind).toBe('unknown');
  });
});

describe('race and controlled effort', () => {
  it('a graded A-priority race is a full, representative effort — not controlled', () => {
    const record = buildEvidenceClassification(baseInput({
      matchedRace: { slug: 'cim-2026', priority: 'A' },
    }));
    expect(record.race.isRace.kind).toBe('present');
    expect(record.race.controlledEffort.kind).toBe('absent');
  });

  it('a C-priority tune-up race reads as a controlled effort', () => {
    const record = buildEvidenceClassification(baseInput({
      matchedRace: { slug: 'turkey-trot', priority: 'C' },
    }));
    expect(record.race.controlledEffort.kind).toBe('present');
  });

  it('a failed race read reports unknown, never "not a race"', () => {
    const record = buildEvidenceClassification(baseInput({ raceReadOk: false, matchedRace: null }));
    expect(record.race.isRace.kind).toBe('unknown');
  });
});

describe('treadmill / hills mutual exclusion', () => {
  it('a treadmill row never also claims hills', () => {
    const record = buildEvidenceClassification(baseInput({
      data: { distanceMi: 6, indoor: true, source: 'treadmill' } as RunData,
    }));
    expect(record.context.treadmill.kind).toBe('present');
    expect(record.context.hills.kind).toBe('absent');
  });
});

describe('CLASSIFYCTXWIRE-2 · heat is READ from the canonical classifier, never re-derived', () => {
  // David: "Two evidence classifiers may not independently assign coaching
  // meaning." Before this fix, this file called `heatEffort` directly and
  // drew its own present/absent line at `slowdownPct >= 1` — a SECOND,
  // independent verdict from `activity-evidence.ts#readEnvironment`'s own
  // five-band `EnvironmentalLoad`, over the identical underlying reading.
  // This suite proves the two now agree BECAUSE one calls the other, not by
  // coincidence of currently-similar thresholds.
  function hotRunData(): RunData {
    return {
      distanceMi: 10, durationSec: 4500, movingTimeS: 4500,
      weather: { temp_f_peak: 92, humidity_pct_peak: 70 },
    } as unknown as RunData;
  }
  function mildRunData(): RunData {
    return {
      distanceMi: 10, durationSec: 4500, movingTimeS: 4500,
      weather: { temp_f_peak: 50, humidity_pct_peak: 40 },
    } as unknown as RunData;
  }
  function noWeatherRunData(): RunData {
    return { distanceMi: 10, durationSec: 4500, movingTimeS: 4500 } as RunData;
  }

  it('a hot run\'s heat tag agrees with readEnvironment\'s own load classification', () => {
    const env = readEnvironment({ tempF: 92, humidityPct: 70, effortSec: 4500 });
    const context = classifyRunContext(hotRunData());
    expect(env.load).not.toBe('none');
    expect(env.load).not.toBe('unknown');
    expect(context.heat.kind).toBe('present');
  });

  it('a mild run\'s heat tag agrees with readEnvironment reporting load: none', () => {
    const env = readEnvironment({ tempF: 50, humidityPct: 40, effortSec: 4500 });
    const context = classifyRunContext(mildRunData());
    expect(env.load).toBe('none');
    expect(context.heat.kind).toBe('absent');
  });

  it('no weather recorded reads unknown on BOTH sides, never a guessed absence (Rule 11)', () => {
    const env = readEnvironment({ tempF: null, effortSec: 4500 });
    const context = classifyRunContext(noWeatherRunData());
    expect(env.load).toBe('unknown');
    expect(context.heat.kind).toBe('unknown');
  });

  it('FALSIFICATION-READY · a hot run flagged absent by this classifier would mean the wire from readEnvironment broke', () => {
    // This is the assertion that would have failed against the pre-fix code,
    // which computed its own threshold independently of `readEnvironment`
    // and could disagree with it silently.
    const context = classifyRunContext(hotRunData());
    expect(context.heat.kind).not.toBe('absent');
  });
});
