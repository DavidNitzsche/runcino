/**
 * lib/coach/race-replacement.test.ts
 *
 * Locks the second execution finding wired through `classifyFinding` into
 * the coach's log: a key session read `REPLACED` —
 * Design/execution-memory-firing.md Part 1's "Session replaced by a race."
 * See the module header in `race-replacement.ts` for the doctrine citation
 * and the design choices (one entry, not two; `isPositive: false`).
 *
 * Structure mirrors `fitness-evidence.test.ts`: a `describe` block locking
 * the pure finder against hand-built `KeySessionExecution` fixtures, a
 * second `describe` block locking the exhaustiveness claim in the module
 * header directly against the real `interpretExecution`, a `describe` block
 * locking the composed coach-voice line, and a `describe` block locking the
 * exact `CoachFindingInput` `updateRaceReplacementLog` uses.
 *
 * The DB shell (`loadRaceReplacementFindings`, and `updateRaceReplacementLog`
 * in `coach-log.ts`) is exercised in prod via the run-adaptations cron,
 * matching the house policy already used for `loadPartialFitnessEvidenceFindings`
 * — only the pure functions are locked here.
 */
import { describe, it, expect } from 'vitest';
import {
  findRaceReplacement,
  composeRaceReplacementEntry,
  type RaceReplacementFinding,
} from './race-replacement';
import { classifyFinding, atLeastAsLoud } from './firing-policy';
import { interpretExecution, type Stimulus, type ExecutionContext } from '@/lib/execution/interpret';
import type { KeySessionExecution } from '@/lib/execution/load';

function stimulus(over: Partial<Stimulus> = {}): Stimulus {
  return {
    domain: 'threshold',
    workMinutes: 30,
    workMi: 5,
    meanWorkPaceSPerMi: 390,
    recoveryIntent: 'incomplete',
    ...over,
  };
}

function session(over: Partial<KeySessionExecution> = {}): KeySessionExecution {
  return {
    dateISO: '2026-08-16',
    type: 'threshold',
    planned: stimulus(),
    plannedBasis: 'progression-spec',
    actual: null,
    actualBasis: null,
    readable: true,
    read: {
      state: 'REPLACED',
      stimulusCompletion: 1,
      evidence: { execution: 'full', adaptation: 'neutral', fitness: 'high', risk: 'watch' },
      why: 'A race stood in for this session.',
    },
    earnsProgression: false,
    watchStatus: null,
    toleranceShare: null,
    workVerdicts: [],
    replacedByRace: true,
    // F-5 · carried on the row now; null is the honest value for a fixture
    // that never exercised the anchor path.
    establishedPaceSPerMi: null,
    ...over,
  };
}

describe('findRaceReplacement', () => {
  it('fires on state REPLACED', () => {
    const f = findRaceReplacement(session());
    expect(f).not.toBeNull();
    expect(f!.dateISO).toBe('2026-08-16');
    expect(f!.displacedDomain).toBe('threshold');
    expect(f!.displacedWorkMi).toBe(5);
  });

  it('does not fire when unreadable', () => {
    expect(findRaceReplacement(session({ readable: false, read: null }))).toBeNull();
  });

  it('does not fire when read is null', () => {
    expect(findRaceReplacement(session({ read: null }))).toBeNull();
  });

  it('does not fire when planned is null', () => {
    expect(findRaceReplacement(session({ planned: null }))).toBeNull();
  });

  it('does not fire on AS_PLANNED / EQUIVALENT / PARTIAL_FAILED / PARTIAL_PRODUCTIVE / MISSED / EXTRA', () => {
    for (const state of [
      'AS_PLANNED', 'EQUIVALENT', 'PARTIAL_FAILED', 'PARTIAL_PRODUCTIVE', 'MISSED', 'EXTRA',
    ] as const) {
      const s = session({
        read: {
          state,
          stimulusCompletion: 1,
          evidence: { execution: 'full', adaptation: 'positive', fitness: 'high', risk: 'none' },
          why: 'contrived',
        },
      });
      expect(findRaceReplacement(s)).toBeNull();
    }
  });

  it('carries a null displacedWorkMi through rather than fabricating one', () => {
    const s = session({ planned: stimulus({ workMi: null }) });
    const f = findRaceReplacement(s);
    expect(f).not.toBeNull();
    expect(f!.displacedWorkMi).toBeNull();
  });

  it('reads the displaced domain from planned, not from actual (which may describe the race itself)', () => {
    const s = session({
      planned: stimulus({ domain: 'marathon', workMi: 18 }),
      actual: stimulus({ domain: 'race', workMi: 13.1, meanWorkPaceSPerMi: 420 }),
    });
    const f = findRaceReplacement(s);
    expect(f!.displacedDomain).toBe('marathon');
    expect(f!.displacedWorkMi).toBe(18);
  });
});

/**
 * The exhaustiveness claim in the race-replacement.ts module header, locked
 * directly against the real interpretExecution: state === 'REPLACED' is
 * produced only by the ctx.replacedByRace branch, and that branch always
 * pairs it with evidence.fitness === 'high' and evidence.risk === 'watch' —
 * there is no other path to state REPLACED and no variation in its evidence.
 */
describe('state REPLACED is exhaustively evidence.fitness "high" + evidence.risk "watch"', () => {
  const domains = ['easy', 'threshold', 'interval', 'marathon', 'repetition', 'recovery', 'race'] as const;
  const completions = [0, 0.3, 0.6, 1, 1.3] as const;

  it('every replacedByRace reading matches the doctrine-fixed evidence, regardless of other inputs', () => {
    let sawReplaced = false;
    for (const domain of domains) {
      for (const completion of completions) {
        for (const effortCollapsed of [true, false]) {
          for (const actual of [null, stimulus({ domain, workMinutes: 30 * completion })]) {
            const planned: Stimulus = {
              domain, workMinutes: 30, workMi: 5, meanWorkPaceSPerMi: 400, recoveryIntent: 'incomplete',
            };
            const ctx: ExecutionContext = { effortCollapsed, replacedByRace: true };
            const read = interpretExecution(planned, actual, ctx);
            expect(read.state).toBe('REPLACED');
            expect(read.evidence.fitness).toBe('high');
            expect(read.evidence.risk).toBe('watch');
            sawReplaced = true;
          }
        }
      }
    }
    // Guard the guard.
    expect(sawReplaced).toBe(true);
  });

  it('never reaches state REPLACED without ctx.replacedByRace', () => {
    const planned: Stimulus = {
      domain: 'threshold', workMinutes: 30, workMi: 5, meanWorkPaceSPerMi: 400, recoveryIntent: 'incomplete',
    };
    for (const completion of completions) {
      const actual = stimulus({ workMinutes: 30 * completion });
      const read = interpretExecution(planned, actual, {});
      expect(read.state).not.toBe('REPLACED');
    }
  });
});

describe('composeRaceReplacementEntry', () => {
  const base: RaceReplacementFinding = {
    dateISO: '2026-08-16',
    displacedDomain: 'threshold',
    displacedWorkMi: 5,
  };

  it('the canonical line', () => {
    const e = composeRaceReplacementEntry(base);
    expect(e.title).toBe('RACE REPLACED');
    expect(e.body).toBe(
      "A race stood in for today's threshold work (5 mi). That counts as real fitness " +
        'evidence, likely better than the session it replaced. It also costs more recovery than ' +
        'that session would have, so the days ahead should account for it rather than read today ' +
        'as a normal quality session banked.',
    );
  });

  it('domain label follows the session, not a hardcoded word', () => {
    const e = composeRaceReplacementEntry({ ...base, displacedDomain: 'marathon' });
    expect(e.body).toContain("today's marathon-effort work");
  });

  it('omits the miles clause when displacedWorkMi is null', () => {
    const e = composeRaceReplacementEntry({ ...base, displacedWorkMi: null });
    expect(e.body).toContain("today's threshold work.");
    expect(e.body).not.toContain('(');
  });

  it('coach voice: no exclamation marks, no em dashes', () => {
    for (const displacedDomain of ['easy', 'threshold', 'interval', 'marathon', 'repetition', 'race', 'recovery'] as const) {
      for (const displacedWorkMi of [null, 5, 18.4]) {
        const e = composeRaceReplacementEntry({ ...base, displacedDomain, displacedWorkMi });
        expect(e.body).not.toMatch(/!|—/);
      }
    }
  });

  it('never claims equivalence — doctrine: "replacement does not mean equivalence"', () => {
    const e = composeRaceReplacementEntry(base);
    expect(e.body.toLowerCase()).not.toContain('great');
    expect(e.body.toLowerCase()).not.toContain('nailed');
  });

  it('displacedDomain "race" gets its own line, not "stood in for today\'s race work"', () => {
    // Confirmed against prod data: David's AFC half, 2026-08-16, planned.domain
    // was 'race' because the plan scheduled the race itself that day — nothing
    // was displaced. The generic template would read "A race stood in for
    // today's race work", which is redundant.
    const e = composeRaceReplacementEntry({ ...base, displacedDomain: 'race', displacedWorkMi: 13.1 });
    expect(e.title).toBe('RACE REPLACED');
    expect(e.body).not.toContain('stood in for');
    expect(e.body).not.toContain('race work');
    expect(e.body).toContain("Today's race counts as real fitness evidence");
    expect(e.body).not.toMatch(/!|—/);
  });
});

describe('firing: the exact CoachFindingInput updateRaceReplacementLog uses', () => {
  it('classifies to SURFACE', () => {
    const level = classifyFinding({
      changed: true,
      athleteNeedsToKnow: true,
      usefulOnlyBecauseLooking: true,
      isPositive: false,
    });
    expect(level).toBe('SURFACE');
    expect(atLeastAsLoud(level, 'SURFACE')).toBe(true);
  });

  it('would go SILENT if mistakenly marked isPositive without meaningfulPositive — the reason isPositive is false here', () => {
    const level = classifyFinding({
      changed: true,
      athleteNeedsToKnow: true,
      usefulOnlyBecauseLooking: true,
      isPositive: true,
      // meaningfulPositive deliberately omitted — there is no honest one for
      // this finding (see race-replacement.ts module header).
    });
    expect(level).toBe('SILENT');
  });
});
