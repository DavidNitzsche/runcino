/**
 * lib/watch/_watch_cues_rules.test.ts · the 0821 watch's B5 and B7.
 *
 * What this locks:
 *
 *   1 · A cue list is a handful, not a script. Three at most, a mile apart
 *       at least, and every one of them inside the session.
 *
 *   2 · A cue never references a target the payload does not carry. The
 *       race opener says "hold the opening pace you were given" — if no
 *       pace was given, the line does not ship. Silence over an
 *       unfalsifiable claim.
 *
 *   3 · The bail splits into two registers WITHOUT touching `label`. Every
 *       deployed watch reads `label`; the day it changes is the day the
 *       wrist goes quiet in the middle of a workout.
 *
 *   4 · The copy rules, on every string this module authors. `lib/watch`
 *       is outside `check-coach-voice.sh`'s scan, so this stands in.
 */
import { describe, it, expect } from 'vitest';
import {
  composeSpokenCues, splitRuleRegisters,
  type WatchPhase, type SessionClass,
} from './build-workout';

const phase = (over: Partial<WatchPhase> & { type: WatchPhase['type'] }): WatchPhase => ({
  label: 'Work',
  durationSec: 600,
  haptic: 'transition-work',
  ...over,
});

/** Warm-up, N work reps with jog recoveries, cool-down. */
function reps(n: number, opts: { target?: number | null } = {}): WatchPhase[] {
  const out: WatchPhase[] = [phase({ type: 'warmup', label: 'Warm-up', distanceMi: 2 })];
  for (let i = 0; i < n; i++) {
    out.push(phase({
      type: 'work', label: `Rep ${i + 1}`, distanceMi: 1,
      targetPaceSPerMi: opts.target === undefined ? 400 : opts.target,
    }));
    if (i < n - 1) out.push(phase({ type: 'recovery', label: 'Jog', distanceMi: 0.25 }));
  }
  out.push(phase({ type: 'cooldown', label: 'Cool-down', distanceMi: 1.5 }));
  return out;
}

/** Rule four, on prose. Evidence lines are deliberately short (the design's
 *  own is "Two miles adrift"), so the word band applies to judgement only. */
function obeysCopyRules(line: string, opts: { band?: boolean } = {}) {
  expect(line, 'no exclamation mark').not.toMatch(/!/);
  expect(line, 'no em or en dash · the separator is ·').not.toMatch(/[—–]/);
  expect(line, 'no emoji').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  if (opts.band !== false) {
    const words = line.split(/\s+/).filter(Boolean).length;
    expect(words, `8-40 words, got ${words}: ${line}`).toBeGreaterThanOrEqual(8);
    expect(words, `8-40 words, got ${words}: ${line}`).toBeLessThanOrEqual(40);
  }
}

describe('spoken cues · a handful, never a script', () => {
  const cases: Array<{ sessionClass: SessionClass; distanceMi: number; phases: WatchPhase[] }> = [
    { sessionClass: 'easy', distanceMi: 6, phases: [phase({ type: 'work', distanceMi: 6 })] },
    { sessionClass: 'long', distanceMi: 17, phases: [phase({ type: 'work', distanceMi: 17 })] },
    { sessionClass: 'threshold', distanceMi: 9, phases: reps(4) },
    { sessionClass: 'interval', distanceMi: 8, phases: reps(6) },
    { sessionClass: 'race', distanceMi: 13.1, phases: [phase({ type: 'work', distanceMi: 13.1, targetPaceSPerMi: 412 })] },
  ];

  for (const c of cases) {
    it(`${c.sessionClass} · at most three, a mile apart, all inside the run`, () => {
      const cues = composeSpokenCues(c);
      expect(cues.length).toBeGreaterThan(0);
      expect(cues.length).toBeLessThanOrEqual(3);
      const ids = new Set(cues.map((x) => x.id));
      expect(ids.size, 'ids unique · the watch fires each once').toBe(cues.length);
      for (const cue of cues) {
        obeysCopyRules(cue.text);
        expect(cue.holdSec).toBe(3);
        // Exactly one trigger field is populated.
        const set = [cue.atMi, cue.phaseIndex, cue.atFraction].filter((v) => v != null);
        expect(set, cue.id).toHaveLength(1);
        if (cue.trigger === 'distance') {
          expect(cue.atMi!).toBeGreaterThan(0);
          expect(cue.atMi!).toBeLessThanOrEqual(c.distanceMi);
        }
        if (cue.trigger === 'fraction') {
          expect(cue.atFraction!).toBeGreaterThan(0);
          expect(cue.atFraction!).toBeLessThanOrEqual(1);
        }
        if (cue.trigger === 'phase') {
          expect(cue.phaseIndex!).toBeGreaterThanOrEqual(0);
          expect(cue.phaseIndex!).toBeLessThan(c.phases.length);
        }
      }
    });
  }

  it('never puts two cues inside the same mile', () => {
    // A 5K race: the "last two miles" line lands at 1.1, on top of the
    // opener at mile 1. One of them has to go.
    const cues = composeSpokenCues({
      sessionClass: 'race', distanceMi: 3.1,
      phases: [phase({ type: 'work', distanceMi: 3.1, targetPaceSPerMi: 360 })],
    });
    const miles = cues.filter((c) => c.trigger === 'distance').map((c) => c.atMi!);
    for (let i = 1; i < miles.length; i++) {
      expect(miles[i] - miles[i - 1]).toBeGreaterThanOrEqual(1);
    }
  });

  it('drops the opening-pace line when no pace was given', () => {
    const withTarget = composeSpokenCues({
      sessionClass: 'race', distanceMi: 13.1,
      phases: [phase({ type: 'work', distanceMi: 13.1, targetPaceSPerMi: 412 })],
    });
    const without = composeSpokenCues({
      sessionClass: 'race', distanceMi: 13.1,
      phases: [phase({ type: 'work', distanceMi: 13.1, targetPaceSPerMi: null })],
    });
    expect(withTarget.some((c) => c.id === 'race-open')).toBe(true);
    expect(without.some((c) => c.id === 'race-open')).toBe(false);
    expect(without.some((c) => /pace you were given/.test(c.text))).toBe(false);
  });

  it('gives the long-run finish its own line and drops the last-two line', () => {
    const phases = [
      phase({ type: 'work', label: 'Easy build', distanceMi: 12 }),
      phase({ type: 'work', label: 'Finish', distanceMi: 4, targetPaceSPerMi: 420, isFinishSegment: true }),
    ];
    const cues = composeSpokenCues({ sessionClass: 'long', distanceMi: 16, phases });
    expect(cues.some((c) => c.id === 'long-finish')).toBe(true);
    expect(cues.some((c) => c.id === 'long-last-two')).toBe(false);
    const finish = cues.find((c) => c.id === 'long-finish')!;
    expect(finish.trigger).toBe('phase');
    expect(finish.phaseIndex).toBe(1);
  });

  it('says nothing on a rest day or a session with no distance', () => {
    expect(composeSpokenCues({ sessionClass: 'rest', distanceMi: 0, phases: [] })).toEqual([]);
    expect(composeSpokenCues({ sessionClass: 'easy', distanceMi: 0, phases: [] })).toEqual([]);
    expect(composeSpokenCues({ sessionClass: 'other', distanceMi: 5, phases: [] })).toEqual([]);
  });

  it('keeps the design\'s own last-two-miles line verbatim', () => {
    const cues = composeSpokenCues({
      sessionClass: 'long', distanceMi: 17,
      phases: [phase({ type: 'work', distanceMi: 17 })],
    });
    const last = cues.find((c) => c.id === 'long-last-two')!;
    expect(last.text).toBe('Last two miles. Hold what you have · this is the part that counts.');
    expect(last.atMi).toBe(15);
  });
});

describe('the bail · evidence quietly, then the judgement', () => {
  const hrBail = {
    kind: 'bail', metric: 'hr', op: '>', value: 167, scope: 'work',
    action: 'drop_to_easy',
    label: 'HR over 167 and climbing · finish easy, the stimulus is banked',
  };

  it('splits a work-scoped HR bail into two registers', () => {
    const r = splitRuleRegisters(hrBail);
    expect(r.evidence).toBe('Heart rate over 167 and still climbing');
    expect(r.judgement).toBeTruthy();
    obeysCopyRules(r.evidence!, { band: false });
    obeysCopyRules(r.judgement!);
    // The evidence is the quiet half · it states, it does not conclude.
    expect(r.evidence!.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('leaves `label` alone · deployed watches read it', () => {
    const before = { ...hrBail };
    splitRuleRegisters(hrBail);
    expect(hrBail).toEqual(before);
    expect(hrBail.label).toBe('HR over 167 and climbing · finish easy, the stimulus is banked');
  });

  it('names the finish, the checkpoint mile and the pace it was measured against', () => {
    const finish = splitRuleRegisters({
      kind: 'bail', metric: 'hr', value: 167, scope: 'finish',
      action: 'cut_finish_half', label: 'x',
    });
    expect(finish.evidence).toBe('Heart rate over 167 through the finish');

    const hrAbort = splitRuleRegisters({
      kind: 'abort', metric: 'hr', value: 172, scope: 'mile-10',
      action: 'switch_to_b_goal', label: 'x',
    });
    expect(hrAbort.evidence).toBe('Mile 10 heart rate over 172');

    const paceAbort = splitRuleRegisters({
      kind: 'abort', metric: 'pace', value: 430, scope: 'mile-5',
      action: 'switch_to_b_goal', label: 'x',
    });
    expect(paceAbort.evidence).toBe('Mile 5 pace slower than 7:10');
    for (const r of [finish, hrAbort, paceAbort]) obeysCopyRules(r.judgement!);
  });

  it('gives a pass rule nothing · there is no judgement to make yet', () => {
    expect(splitRuleRegisters({
      kind: 'pass', metric: 'hr', op: '<=', value: 158, scope: 'work',
      action: null, label: 'Pass: avgHr ≤ 158 on the work',
    })).toEqual({ evidence: null, judgement: null });
  });

  it('falls back to the label\'s own break, and never invents the second half', () => {
    const split = splitRuleRegisters({ kind: 'bail', label: 'Two miles adrift · take the short way home' });
    expect(split.evidence).toBe('Two miles adrift');
    expect(split.judgement).toBe('take the short way home');

    const unbroken = splitRuleRegisters({ kind: 'bail', label: 'Two miles adrift' });
    expect(unbroken.evidence).toBe('Two miles adrift');
    expect(unbroken.judgement, 'no break in the label · no judgement invented').toBeNull();
  });
});
