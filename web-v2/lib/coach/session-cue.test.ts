/**
 * The heat cue says a true thing without inventing a number.
 *
 * WHAT THIS REPLACED. `composeTempoCue` and `composeThresholdCue` spoke a
 * figure to the runner — "Heat will bump HR 12 bpm above target" — computed as
 * `(temp_max_f - 65) / 2` and cited to "Research/06 §heat · ~1 bpm per 2°F".
 *
 * There is no §heat section in Research/06 and no such rule anywhere in the
 * corpus. The only per-bpm figures in that file are the acclimation table's HR
 * DECREASES over days of exposure and a heat-illness warning sign at >15 bpm of
 * drift — neither is a per-degree penalty, and neither supports the sentence.
 *
 * The coaching was right: heat lifts HR at a given pace, so run threshold and
 * tempo by effort. Only the magnitude was fabricated. So the magnitude is gone,
 * the advice stays, and these tests keep it that way — a cue may not put a
 * number on a physiological claim the research does not make.
 */
import { describe, it, expect } from 'vitest';
import { composeCue, type CueInput } from './session-cue';

const base = (type: string): CueInput => ({
  type: type as CueInput['type'],
  phase: 'BASE' as CueInput['phase'],
  plannedMi: 6,
});

/** Any digit followed by a unit a body could be measured in. */
const QUANTIFIED = /\d+\s*(bpm|beats|°|degrees|%)/i;

/**
 * `composeCue` is nullable — some type/phase combinations have no cue. Every
 * case below expects one, so a null is a test failure rather than something to
 * be optional-chained past into a vacuous pass.
 */
function cueFor(input: CueInput): string {
  const c = composeCue(input);
  expect(c, `no cue for ${input.type}`).not.toBeNull();
  return c as string;
}

describe('the heat cue', () => {
  const hotTypes = ['tempo', 'threshold', 'long'];

  it('fires on a materially hot day', () => {
    for (const t of hotTypes) {
      const hot = cueFor({ ...base(t), heatSlowdownPct: 6 });
      const cool = cueFor({ ...base(t), heatSlowdownPct: 0 });
      expect(hot, `${t} should have a heat voice`).not.toBe(cool);
      expect(hot.toLowerCase()).toContain('heat');
    }
  });

  it('never quantifies what the research does not quantify', () => {
    for (const t of hotTypes) {
      for (const pct of [2, 6, 12, 40]) {
        const cue = cueFor({ ...base(t), heatSlowdownPct: pct });
        expect(cue, `${t} @ ${pct}% invented a figure: "${cue}"`).not.toMatch(QUANTIFIED);
      }
    }
  });

  it('says nothing about heat when it is not hot', () => {
    for (const t of hotTypes) {
      for (const pct of [null, undefined, 0, 1.9]) {
        const cue = cueFor({ ...base(t), heatSlowdownPct: pct as number | null });
        expect(cue.toLowerCase(), `${t} @ ${pct} claimed heat`).not.toContain('heat');
      }
    }
  });

  it('uses the same 2% gate as the recap and the phase panel', () => {
    // Below the gate and above it, either side of the boundary. One threshold
    // everywhere means the cue, the recap and the panel cannot disagree about
    // whether today was hot.
    const below = cueFor({ ...base('tempo'), heatSlowdownPct: 1.99 });
    const at = cueFor({ ...base('tempo'), heatSlowdownPct: 2 });
    expect(below.toLowerCase()).not.toContain('heat');
    expect(at.toLowerCase()).toContain('heat');
  });

  it('ignores a nonsense slowdown rather than speaking it', () => {
    for (const bad of [NaN, Infinity, -5]) {
      const cue = cueFor({ ...base('tempo'), heatSlowdownPct: bad });
      expect(cue.toLowerCase(), `spoke heat for ${bad}`).not.toContain('heat');
    }
  });
});
