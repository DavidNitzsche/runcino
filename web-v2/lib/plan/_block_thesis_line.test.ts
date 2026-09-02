/**
 * _block_thesis_line.test.ts · BLOCK-THESIS-LINE-1 (2026-09-02).
 *
 * The Coaching Thesis was composed correctly, shipped correctly, and rendered
 * nowhere: `Thesis`, `reviewTrigger` and `limiter` appear zero times in the
 * whole of `native-v2`, so Block's "WHERE THIS GOES" showed the generic phase
 * line while the sentence the engine wrote for this runner was dropped on
 * arrival. `coachLine` is a string in a field the app already renders, so the
 * fix needs no app release — and this gate is what keeps it from silently
 * regressing to the generic line again.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22):
 *
 *   · Whether the phone actually DRAWS `coachLine`. This asserts the payload,
 *     which is the thing the server owns; the rendering was verified once, by
 *     hand, against production, and is reported in the handback as a payload
 *     verification rather than a device render. Rule 13's honest half.
 *   · Whether the thesis is the RIGHT thesis. `lib/training/coaching-thesis.ts`
 *     owns that and has its own suites.
 *   · A duplicated sentence on a DIFFERENT screen than Today. This checks the
 *     one overlap that exists (the week tail) and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { blockCoachLine, buildCoachLine } from './v5-block';
import { composeCoachLine, type CoachingThesis } from '@/lib/training/coaching-thesis';
import type { TrainingState } from '@/lib/coach/training-state';

const WEEKS = [
  { startDate: '2026-08-24', isCurrent: false, isRaceWeek: false },
  { startDate: '2026-08-31', isCurrent: true, isRaceWeek: false },
  { startDate: '2026-09-07', isCurrent: false, isRaceWeek: false },
];

function state(over: Partial<TrainingState> = {}): TrainingState {
  return {
    today: '2026-09-02',
    currentPhase: 'QUALITY',
    weeks: WEEKS,
    race: null,
    ...over,
  } as unknown as TrainingState;
}

/** The owner's own resolved thesis, as `composeCoachingThesis` produces it. */
function thesis(over: Partial<CoachingThesis> = {}): CoachingThesis {
  return {
    primaryLimiter: 'DURABILITY',
    basis: 'CURVE_SHAPE_EVIDENCE',
    heldConstant: [{ capacity: 'THRESHOLD', code: 'BETTER_EVIDENCED_THAN_THE_LIMITER' }],
    confidence: 0.51,
    coachLine: 'unused by this function',
    ...over,
  } as unknown as CoachingThesis;
}

describe('BLOCK-THESIS-LINE-1 · the thesis reaches the screen', () => {
  it('a named limiter in a building phase replaces the generic phase line', () => {
    const line = blockCoachLine(state(), 26.2, thesis());
    expect(line).not.toBe(buildCoachLine(state(), 26.2));
    expect(line).toContain('durability is where the work goes');
    expect(line).toContain('threshold holds');
  });

  it('RULE 17 · the week tail belongs to Today and is not repeated here', () => {
    // `thesis.coachLine` ends "and this week's long run is the session that
    // builds it" when the week addresses the limiter, and Today already says
    // that on the day itself through `thesisLeadClause`. Block asks the SAME
    // composer for the block-level register instead of writing a second
    // sentence.
    const line = blockCoachLine(state(), 26.2, thesis())!;
    expect(line).not.toMatch(/this week's/);
    expect(line).toBe(composeCoachLine('DURABILITY', thesis().heldConstant, {
      basis: 'CURVE_SHAPE_EVIDENCE', addressedThisWeek: false,
    }));
  });

  it.each(['TAPER', 'RECOVERY', 'MAINTENANCE'] as const)(
    'a %s phase keeps its own line — the thesis would be wrong there', (phase) => {
      const s = state({ currentPhase: phase } as Partial<TrainingState>);
      expect(blockCoachLine(s, 26.2, thesis())).toBe(buildCoachLine(s, 26.2));
    });

  it('race week keeps the phase line', () => {
    const s = state({
      currentPhase: 'RACE-SPECIFIC',
      weeks: WEEKS.map((w) => (w.isCurrent ? { ...w, isRaceWeek: true } : w)),
    } as Partial<TrainingState>);
    expect(blockCoachLine(s, 26.2, thesis())).toBe(buildCoachLine(s, 26.2));
  });

  it('a finished block keeps BLOCK-ENDED-1\'s sentence', () => {
    const s = state({ today: '2026-09-30' } as Partial<TrainingState>);
    expect(blockCoachLine(s, 26.2, thesis())).toContain('This block has finished');
  });

  it('RULE 11 · an absent thesis and a REFUSED thesis are different branches', () => {
    // No resolver reached at all.
    expect(blockCoachLine(state(), 26.2, null)).toBe(buildCoachLine(state(), 26.2));
    // The resolver answered, and its answer was "not enough evidence". That is
    // a claim about the MODEL, not an answer to "where this goes", so the
    // phase line stands — and the refusal keeps its own home on `thesis`.
    const unknown = thesis({ primaryLimiter: 'UNKNOWN', confidence: null, heldConstant: [] });
    expect(blockCoachLine(state(), 26.2, unknown)).toBe(buildCoachLine(state(), 26.2));
    // Both take the phase line, and the reasons are DISTINCT branches rather
    // than one fallthrough — asserted by the fact that a named limiter in the
    // same state does not.
    expect(blockCoachLine(state(), 26.2, thesis())).not.toBe(buildCoachLine(state(), 26.2));
  });

  it('BASE and RACE-SPECIFIC are building phases too', () => {
    for (const phase of ['BASE', 'RACE-SPECIFIC'] as const) {
      const s = state({ currentPhase: phase } as Partial<TrainingState>);
      expect(blockCoachLine(s, 26.2, thesis())).toContain('durability is where the work goes');
    }
  });
});
