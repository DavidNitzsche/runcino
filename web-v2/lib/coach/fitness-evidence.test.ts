/**
 * lib/coach/fitness-evidence.test.ts
 *
 * Locks the one execution finding wired through `classifyFinding` into the
 * coach's log: a key session read `PARTIAL_FAILED` with
 * `evidence.fitness === 'high'` — Design/execution-memory-firing.md Part 1's
 * "the athlete fails badly at a pace previously considered established.
 * Extremely informative." See the module header in `fitness-evidence.ts` for
 * the doctrine citation and the code-level argument for why this
 * state/evidence pair is the EXHAUSTIVE shape of that case in the current
 * `interpretExecution`, not an arbitrary narrowing of it — the second
 * `describe` block below locks that claim directly against the real
 * `interpretExecution`, so a future change to `interpret.ts` that breaks the
 * claim fails here rather than silently.
 *
 * The DB shell (`loadPartialFitnessEvidenceFindings`, and
 * `updateFitnessEvidenceLog` in `coach-log.ts`) is exercised in prod via the
 * run-adaptations cron, matching the house policy already used for
 * `loadEasyDiscipline` / `updateCoachLog` — only the pure functions are
 * locked here.
 */
import { describe, it, expect } from 'vitest';
import {
  findPartialFitnessEvidence,
  composeFitnessEvidenceEntry,
  type FitnessEvidencePartialFinding,
} from './fitness-evidence';
import { classifyFinding, atLeastAsLoud } from './firing-policy';
import { establishedPaceFor } from '@/lib/execution/reconstruct';
import { interpretExecution, type Stimulus, type ExecutionContext } from '@/lib/execution/interpret';
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
      evidence: { execution: 'partial', adaptation: 'negative', fitness: 'high', risk: 'meaningful' },
      why: 'Stopped early at a pace that has been comfortable before.',
    },
    earnsProgression: false,
    watchStatus: 'abandoned',
    toleranceShare: 0.4,
    workVerdicts: ['hit', 'missed'],
    replacedByRace: false,
    ...over,
  };
}

const VDOT = 50;

describe('findPartialFitnessEvidence', () => {
  it('fires on PARTIAL_FAILED with evidence.fitness === high', () => {
    const f = findPartialFitnessEvidence(session(), VDOT);
    expect(f).not.toBeNull();
    expect(f!.dateISO).toBe('2026-08-12');
    expect(f!.domain).toBe('threshold');
    expect(f!.stimulusCompletion).toBe(0.55);
    expect(f!.actualPaceSPerMi).toBe(405);
    expect(f!.establishedPaceSPerMi).toBe(establishedPaceFor('threshold', VDOT));
  });

  it('does not fire when unreadable', () => {
    expect(findPartialFitnessEvidence(session({ readable: false, read: null }), VDOT)).toBeNull();
  });

  it('does not fire when read is null', () => {
    expect(findPartialFitnessEvidence(session({ read: null }), VDOT)).toBeNull();
  });

  it('does not fire when planned is null', () => {
    expect(findPartialFitnessEvidence(session({ planned: null }), VDOT)).toBeNull();
  });

  it('does not fire on a different state, even with evidence.fitness high', () => {
    const s = session({
      read: {
        state: 'PARTIAL_PRODUCTIVE',
        stimulusCompletion: 0.55,
        evidence: { execution: 'partial', adaptation: 'unknown', fitness: 'high', risk: 'none' },
        why: 'contrived',
      },
    });
    expect(findPartialFitnessEvidence(s, VDOT)).toBeNull();
  });

  it('does not fire on PARTIAL_FAILED with lower evidence.fitness', () => {
    for (const fitness of ['moderate', 'low', 'none'] as const) {
      const s = session({
        read: {
          state: 'PARTIAL_FAILED',
          stimulusCompletion: 0.55,
          evidence: { execution: 'partial', adaptation: 'negative', fitness, risk: 'meaningful' },
          why: 'contrived',
        },
      });
      expect(findPartialFitnessEvidence(s, VDOT)).toBeNull();
    }
  });

  it('does not fire on AS_PLANNED / EQUIVALENT / MISSED / REPLACED / EXTRA', () => {
    for (const state of ['AS_PLANNED', 'EQUIVALENT', 'MISSED', 'REPLACED', 'EXTRA'] as const) {
      const s = session({
        read: {
          state,
          stimulusCompletion: 1,
          evidence: { execution: 'full', adaptation: 'positive', fitness: 'high', risk: 'none' },
          why: 'contrived',
        },
      });
      expect(findPartialFitnessEvidence(s, VDOT)).toBeNull();
    }
  });

  it('defensive null-vdot path never throws and abstains', () => {
    expect(findPartialFitnessEvidence(session(), null)).toBeNull();
  });

  it('defensive: no actual pace on the session abstains rather than fabricating one', () => {
    const s = session({ actual: stimulus({ meanWorkPaceSPerMi: null }) });
    expect(findPartialFitnessEvidence(s, VDOT)).toBeNull();
  });
});

/**
 * The exhaustiveness claim in the fitness-evidence.ts module header, locked
 * directly against the real interpretExecution rather than trusted from
 * reading the source once: across a representative sweep of
 * domain/completion/effort-collapse/pace combinations, evidence.fitness
 * never reaches 'high' without state also being PARTIAL_FAILED.
 */
describe('evidence.fitness === "high" is exhaustively PARTIAL_FAILED in interpretExecution', () => {
  const domains = ['easy', 'threshold', 'interval', 'marathon', 'repetition'] as const;
  const completions = [0.1, 0.3, 0.39, 0.41, 0.6, 0.8, 1, 1.1, 1.3] as const;

  it('no combination produces fitness high outside PARTIAL_FAILED', () => {
    let sawHigh = false;
    for (const domain of domains) {
      for (const completion of completions) {
        for (const effortCollapsed of [true, false]) {
          for (const paceDelta of [-10, 0, 3, 20]) {
            const planned: Stimulus = {
              domain, workMinutes: 30, workMi: 5, meanWorkPaceSPerMi: 400, recoveryIntent: 'incomplete',
            };
            const actualMinutes = 30 * completion;
            const established = 400;
            const actual: Stimulus = {
              domain,
              workMinutes: actualMinutes,
              workMi: (actualMinutes / 30) * 5,
              meanWorkPaceSPerMi: established + paceDelta,
              recoveryIntent: 'incomplete',
            };
            const ctx: ExecutionContext = {
              effortCollapsed,
              establishedPaceSPerMi: established,
            };
            const read = interpretExecution(planned, actual, ctx);
            if (read.evidence.fitness === 'high') {
              sawHigh = true;
              expect(read.state).toBe('PARTIAL_FAILED');
            }
          }
        }
      }
    }
    // Guard the guard: the sweep must actually exercise the 'high' branch at
    // least once, or the assertion above is vacuous.
    expect(sawHigh).toBe(true);
  });
});

describe('composeFitnessEvidenceEntry', () => {
  const base: FitnessEvidencePartialFinding = {
    dateISO: '2026-08-12',
    domain: 'threshold',
    stimulusCompletion: 0.55,
    establishedPaceSPerMi: 390, // 6:30/mi
    actualPaceSPerMi: 405, // 6:45/mi
  };

  it('the canonical line', () => {
    const e = composeFitnessEvidenceEntry(base);
    expect(e.title).toBe('FITNESS SIGNAL');
    expect(e.body).toBe(
      'Threshold work came apart at 6:45/mi. That pace has been comfortable before, at 6:30/mi. ' +
        'Only 55% of the session landed, but stopping at a known pace says more about fitness than ' +
        'the miles that were missed.',
    );
  });

  it('domain label follows the session, not a hardcoded word', () => {
    const e = composeFitnessEvidenceEntry({ ...base, domain: 'interval' });
    expect(e.body).toContain('Interval work came apart');
  });

  it('coach voice: no exclamation marks, no em dashes', () => {
    for (const domain of ['easy', 'threshold', 'interval', 'marathon', 'repetition', 'race', 'recovery'] as const) {
      const e = composeFitnessEvidenceEntry({ ...base, domain });
      expect(e.body).not.toMatch(/!|—/);
    }
  });

  it('stimulus completion is clamped into 0..100%', () => {
    const over = composeFitnessEvidenceEntry({ ...base, stimulusCompletion: 1.4 });
    expect(over.body).toContain('Only 100% of the session landed');
    const under = composeFitnessEvidenceEntry({ ...base, stimulusCompletion: -0.2 });
    expect(under.body).toContain('Only 0% of the session landed');
  });
});

describe('firing: the exact CoachFindingInput updateFitnessEvidenceLog uses', () => {
  it('classifies to SURFACE, matching the doctrine pipeline\'s worked example', () => {
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
