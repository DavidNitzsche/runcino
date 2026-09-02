/**
 * lib/coach/threshold-pattern.test.ts
 *
 * Locks the repeated-pattern case `lib/coach/memory.ts` was built for but,
 * as of 2026-08-18, had zero callers: a threshold session reading
 * `PARTIAL_FAILED` repeatedly, reported as evidence through
 * `recordEvidence`, promoted to an 'active' memory only once doctrine's own
 * "repeated evidence" bar clears (Design/execution-memory-firing.md Part 2).
 *
 * The DB shells (`loadThresholdPartialFailureFindings`,
 * `recordThresholdPatternEvidence`, and `updateThresholdPatternLog` in
 * `coach-log.ts`) are exercised in prod via the run-adaptations cron,
 * matching the house policy already used for `loadEasyDiscipline` /
 * `updateEpisode` / `loadPartialFitnessEvidenceFindings`. Only the pure
 * functions are locked here.
 */
import { describe, it, expect } from 'vitest';
import {
  findThresholdPartialFailure,
  composeThresholdPatternStatement,
  composeThresholdPatternEntry,
  decideThresholdPatternWrite,
  type ThresholdPartialFailureFinding,
} from './threshold-pattern';
import { shouldPromote, DEFAULT_PROMOTION_THRESHOLDS, type MemoryRecord } from './memory';
import { weekKeyOf } from './easy-discipline';
import { classifyFinding, atLeastAsLoud } from './firing-policy';
import type { Stimulus } from '@/lib/execution/interpret';
import type { KeySessionExecution } from '@/lib/execution/load';

function stimulus(over: Partial<Stimulus> = {}): Stimulus {
  return {
    domain: 'threshold',
    workMinutes: 15,
    workMi: 2.5,
    meanWorkPaceSPerMi: 390,
    recoveryIntent: 'incomplete',
    ...over,
  };
}

function session(over: Partial<KeySessionExecution> = {}): KeySessionExecution {
  return {
    dateISO: '2026-08-12',
    type: 'threshold',
    planned: stimulus({ workMinutes: 30, workMi: 5, meanWorkPaceSPerMi: 375 }),
    plannedBasis: 'progression-spec',
    actual: stimulus({ workMi: 2, meanWorkPaceSPerMi: 405 }),
    actualBasis: 'watch-phases',
    readable: true,
    read: {
      state: 'PARTIAL_FAILED',
      stimulusCompletion: 0.55,
      evidence: { execution: 'partial', adaptation: 'negative', fitness: 'moderate', risk: 'meaningful' },
      why: 'Stopped early with the effort coming apart.',
    },
    earnsProgression: false,
    watchStatus: 'abandoned',
    toleranceShare: 0.4,
    workVerdicts: ['hit', 'slow'],
    replacedByRace: false,
    // F-5 · carried on the row now; null is the honest value for a fixture
    // that never exercised the anchor path.
    establishedPaceSPerMi: null,
    ...over,
  };
}

/* ═══════════════════════ findThresholdPartialFailure ═══════════════════ */

describe('findThresholdPartialFailure', () => {
  it('fires on PARTIAL_FAILED in the threshold domain', () => {
    const f = findThresholdPartialFailure(session());
    expect(f).not.toBeNull();
    expect(f!.dateISO).toBe('2026-08-12');
    expect(f!.stimulusCompletion).toBe(0.55);
  });

  it('fires regardless of evidence.fitness — unlike fitness-evidence.ts, this is not narrowed to "high"', () => {
    for (const fitness of ['high', 'moderate', 'low', 'none'] as const) {
      const s = session({
        read: {
          state: 'PARTIAL_FAILED',
          stimulusCompletion: 0.5,
          evidence: { execution: 'partial', adaptation: 'negative', fitness, risk: 'meaningful' },
          why: 'contrived',
        },
      });
      expect(findThresholdPartialFailure(s)).not.toBeNull();
    }
  });

  it('does not fire outside the threshold domain, even on PARTIAL_FAILED', () => {
    for (const domain of ['easy', 'recovery', 'marathon', 'interval', 'repetition', 'race'] as const) {
      const s = session({
        planned: stimulus({ domain, workMinutes: 30, workMi: 5 }),
      });
      expect(findThresholdPartialFailure(s)).toBeNull();
    }
  });

  it('does not fire on a different state, in the threshold domain', () => {
    for (const state of ['AS_PLANNED', 'EQUIVALENT', 'PARTIAL_PRODUCTIVE', 'MISSED', 'REPLACED', 'EXTRA'] as const) {
      const s = session({
        read: {
          state,
          stimulusCompletion: 1,
          evidence: { execution: 'full', adaptation: 'positive', fitness: 'none', risk: 'none' },
          why: 'contrived',
        },
      });
      expect(findThresholdPartialFailure(s)).toBeNull();
    }
  });

  it('does not fire when unreadable, or when read/planned is null', () => {
    expect(findThresholdPartialFailure(session({ readable: false, read: null }))).toBeNull();
    expect(findThresholdPartialFailure(session({ read: null }))).toBeNull();
    expect(findThresholdPartialFailure(session({ planned: null }))).toBeNull();
  });
});

/* ═══════════════════════ Coach voice ═══════════════════════════════════ */

describe('composeThresholdPatternStatement / composeThresholdPatternEntry', () => {
  const base: ThresholdPartialFailureFinding = {
    dateISO: '2026-08-12',
    stimulusCompletion: 0.55,
    why: 'Stopped early with the effort coming apart.',
  };

  it('the canonical line', () => {
    const s = composeThresholdPatternStatement(base);
    expect(s).toBe(
      'Threshold work keeps coming apart before it finishes. The most recent attempt ' +
        'landed only 55% of the session. Treat this as a durability limiter, not a bad day.',
    );
  });

  it('coach voice: no exclamation marks, no em dashes', () => {
    for (const stimulusCompletion of [0, 0.1, 0.39, 0.61, 1]) {
      const s = composeThresholdPatternStatement({ ...base, stimulusCompletion });
      expect(s).not.toMatch(/!|—/);
    }
  });

  it('stimulus completion is clamped into 0..100%', () => {
    const over = composeThresholdPatternStatement({ ...base, stimulusCompletion: 1.4 });
    expect(over).toContain('landed only 100% of the session');
    const under = composeThresholdPatternStatement({ ...base, stimulusCompletion: -0.2 });
    expect(under).toContain('landed only 0% of the session');
  });

  it('composeThresholdPatternEntry titles the entry PATTERN and reuses the statement as the body', () => {
    const e = composeThresholdPatternEntry(base);
    expect(e.title).toBe('PATTERN');
    expect(e.body).toBe(composeThresholdPatternStatement(base));
  });
});

/* ═══════════════════ decideThresholdPatternWrite ═══════════════════════ */

function fakeRecord(over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    category: 'pattern',
    tier: 'medium',
    status: 'active',
    statement: 'contrived',
    evidenceCount: 3,
    distinctPeriods: 3,
    firstObservedISO: '2026-07-01',
    lastObservedISO: '2026-08-12',
    detail: {},
    ...over,
  };
}

describe('decideThresholdPatternWrite', () => {
  it('skips when recordEvidence returned null — still below the promotion bar', () => {
    expect(decideThresholdPatternWrite(false, null)).toBe('skip');
    expect(decideThresholdPatternWrite(true, null)).toBe('skip');
  });

  it('promotes when the memory was NOT active before and recordEvidence returned a record', () => {
    expect(decideThresholdPatternWrite(false, fakeRecord())).toBe('promote');
  });

  it('refreshes (does not re-announce) when the memory was ALREADY active before this call', () => {
    expect(decideThresholdPatternWrite(true, fakeRecord())).toBe('refresh');
  });
});

/* ═══════ shouldPromote, exercised with this module's real period key ═══ */

/**
 * The exact thing `memory.ts`'s `shouldPromote` exists to test, run against
 * THIS module's own `weekKeyOf`-derived period key rather than abstract
 * numbers: does not promote at 1 or 2 occurrences, promotes at 3
 * occurrences spread across 3 distinct weeks, and — the guard a raw count
 * cannot provide on its own — does NOT promote on 3 occurrences crammed
 * into a single week.
 */
describe('the promotion bar, applied to real threshold-durability dates', () => {
  it('does not promote after 1 occurrence', () => {
    const periods = new Set([weekKeyOf('2026-07-20')]);
    expect(shouldPromote(1, periods.size, DEFAULT_PROMOTION_THRESHOLDS)).toBe(false);
  });

  it('does not promote after 2 occurrences, even in 2 distinct weeks', () => {
    const periods = new Set([weekKeyOf('2026-07-20'), weekKeyOf('2026-07-29')]);
    expect(periods.size).toBe(2);
    expect(shouldPromote(2, periods.size, DEFAULT_PROMOTION_THRESHOLDS)).toBe(false);
  });

  it('DOES promote at 3 occurrences across 3 distinct weeks', () => {
    const dates = ['2026-07-20', '2026-07-29', '2026-08-12'];
    const periods = new Set(dates.map(weekKeyOf));
    expect(periods.size).toBe(3);
    expect(shouldPromote(dates.length, periods.size, DEFAULT_PROMOTION_THRESHOLDS)).toBe(true);
  });

  it('does NOT promote on 3 occurrences inside a single week — one bad week is not a pattern', () => {
    const dates = ['2026-08-10', '2026-08-11', '2026-08-13']; // same Sun-anchored week
    const periods = new Set(dates.map(weekKeyOf));
    expect(periods.size).toBe(1);
    expect(shouldPromote(dates.length, periods.size, DEFAULT_PROMOTION_THRESHOLDS)).toBe(false);
  });
});

/* ═══════════════════════════════ Firing ═════════════════════════════════ */

describe('firing: the exact CoachFindingInput updateThresholdPatternLog uses', () => {
  it('classifies to SURFACE, matching the doctrine pipeline\'s worked example (firing: SURFACE, importance: high)', () => {
    const level = classifyFinding({
      changed: true,
      athleteNeedsToKnow: true,
      usefulOnlyBecauseLooking: true,
      isPositive: false,
    });
    expect(level).toBe('SURFACE');
    expect(atLeastAsLoud(level, 'SURFACE')).toBe(true);
  });
});
