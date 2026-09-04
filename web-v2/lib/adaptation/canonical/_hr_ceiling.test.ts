/**
 * HRCEILING-1 + HRCHANNEL-1 · the two defects that kept the Adaptation Engine
 * from ever proposing an increase, each with its own gate.
 *
 * The real-history replay is the evidence that they mattered (PROGRESS 0 -> 14
 * on the owner's own season). This file is the gate that stops either coming
 * back, because a replay over one runner's snapshot cannot be the only thing
 * holding a rule this load-bearing.
 *
 * WHAT THIS CANNOT FAIL ON (Rule 22): it exercises the grading contract with
 * constructed inputs, so it says nothing about whether the evidence layer
 * DELIVERS the right ceiling or the right work HR. `_upward_bar.test.ts` and
 * the replay own that half.
 */
import { describe, it, expect } from 'vitest';
import { workHrCeilingFor } from './work-hr-ceiling';
import { gradeStimulus, type StimulusInput } from './stimulus';
import { measured, absent } from './input';

describe('HRCEILING-1 · an aerobic cap is not a bound on quality work', () => {
  it('an easy-day cap on a threshold row is refused, by name', () => {
    // The live shape: 149 bpm stamped on a tempo row while his LTHR is 168.
    const r = workHrCeilingFor('THRESHOLD', 149);
    expect(r.ok).toBe(false);
    if (!r.ok && 'what' in r.why) expect(r.why.what).toMatch(/generic aerobic HR cap of 149/);
  });

  it('the same refusal for interval and marathon-effort work', () => {
    expect(workHrCeilingFor('HIGH_INTENSITY', 149).ok).toBe(false);
    expect(workHrCeilingFor('MARATHON_EFFORT', 151).ok).toBe(false);
  });

  it('an aerobic cap on an aerobic day is exactly the right quantity, and is KEPT', () => {
    // The other half of the rule. Removing the ceiling here would delete the
    // guard that catches an easy day run too hard, which is a real guard.
    const easy = workHrCeilingFor('EASY', 151);
    expect(easy.ok).toBe(true);
    if (easy.ok) expect(easy.value).toBe(151);
    const long = workHrCeilingFor('LONG_RUN', 151);
    expect(long.ok).toBe(true);
  });

  it('absent stays absent, and a nonsense cap is not a ceiling', () => {
    expect(workHrCeilingFor('EASY', null).ok).toBe(false);
    expect(workHrCeilingFor('EASY', 0).ok).toBe(false);
    expect(workHrCeilingFor('EASY', Number.NaN).ok).toBe(false);
  });
});

/** A threshold session executed correctly: work complete, pace on target. */
function cleanThresholdSession(over: Partial<StimulusInput> = {}): StimulusInput {
  return {
    prescribedWorkSeconds: 1800,
    completedWorkSeconds: measured(1800),
    prescribedSegments: 4,
    acceptableSegments: measured(4),
    targetWorkPaceSecPerMi: 430,
    actualWorkPaceSecPerMi: measured(430),
    meanWorkHrBpm: measured(162),
    hrCeilingBpm: absent('no HR ceiling on this prescription'),
    workSegmentHrBpm: [measured(160), measured(161), measured(163), measured(164)],
    hrReliable: true,
    majorLateCollapse: measured(false),
    prescribedRecoverySeconds: 240,
    actualRecoverySeconds: measured(240),
    dataCompleteAndSegmented: true,
    paceDiscountFlags: [],
    ...over,
  };
}

describe('HRCHANNEL-1 · no ceiling is a missing channel, never a breached one', () => {
  it('a clean threshold session with NO ceiling counts as evidence', () => {
    /* The defect: `gradeStimulus`'s "HR is not a channel" escape was gated on
     * `!hrReliable` — a dead strap — and did not cover an absent CEILING. Since
     * ZONEBAND-1 correctly stopped stamping a generic cap on quality rows, that
     * is the state of EVERY quality session authored from 2026-09-03 onward, so
     * a perfectly executed threshold session fell past every branch onto the
     * final DIFFERENT and could never corroborate a faster anchor.
     *
     * SUBSTANTIAL and not FULL is the point: a missing channel costs the larger
     * 5 s/mi step and nothing else, which is the rule already applied to a dead
     * strap two branches above. */
    const a = gradeStimulus(cleanThresholdSession());
    expect(a.grade).toBe('SUBSTANTIAL');
    expect(a.discountedChannel).toBe('HR');
  });

  it('a dead strap is still handled the same way — the two causes agree', () => {
    const a = gradeStimulus(cleanThresholdSession({
      hrReliable: false, meanWorkHrBpm: absent('no HR recorded'), workSegmentHrBpm: [],
    }));
    expect(a.grade).toBe('SUBSTANTIAL');
  });

  it('THE LOOPHOLE THIS MUST NOT OPEN · a session run over a REAL ceiling still fails', () => {
    // The whole risk of HRCHANNEL-1 is that it becomes a way to launder an
    // over-cooked session. It cannot: that case has a readable ceiling, so
    // `hrCredible` is true and `paceCannotRescueExcessiveEffort` catches it
    // long before the branch this fix touched.
    const a = gradeStimulus(cleanThresholdSession({
      hrCeilingBpm: measured(150),
      meanWorkHrBpm: measured(168),
      workSegmentHrBpm: [measured(166), measured(168), measured(169), measured(170)],
    }));
    expect(a.grade).toBe('DIFFERENT');
  });

  it('and an incomplete session is still PARTIAL, ceiling or no ceiling', () => {
    // HRCHANNEL-1 must not rescue work that did not happen. C1/C2 are untouched.
    const a = gradeStimulus(cleanThresholdSession({
      completedWorkSeconds: measured(1000),
      acceptableSegments: measured(1),
    }));
    expect(a.grade).toBe('PARTIAL');
  });
});
