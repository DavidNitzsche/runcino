/**
 * lib/coach/voice-band-wiring.test.ts · voice-band tone-branch lock.
 *
 * 2026-08-17 · the voiceBand signal (lib/coach/voice-band.ts) is wired
 * into three copy composers: session-cue (pre-run cue), run-recap
 * (post-run framing), readiness-brief headline (morning brief · READY
 * tail). Contract locked here:
 *
 *   1. GUIDED IS THE DEFAULT AND IS BYTE-IDENTICAL to the pre-band
 *      output · voiceBand: 'guided', null, and absent all produce the
 *      exact same strings the composers produced before the wiring.
 *   2. calibration / challenge change WORD CHOICE, not structure ·
 *      same fact count, same verdict, same null/non-null shape.
 */
import { describe, expect, it } from 'vitest';
import { composeCue, type CueInput } from './session-cue';
import { deriveRecap, type RecapInput } from './run-recap';

describe('composeCue · voice-band tone branches', () => {
  const base = (type: CueInput['type']): CueInput => ({
    type, phase: 'BUILD', plannedMi: 6,
  });

  const lockedGuidedDefaults: Array<[CueInput['type'], string]> = [
    ['easy', 'Keep the first mile slow. The pace finds itself by mile 3.'],
    ['tempo', 'Hold the line. Comfortably hard, not racing.'],
    // 2026-09-02 · the guided threshold cue changed, and the lock moved with
    // it rather than the copy being left alone to keep this test green. What
    // this file locks is that the three guided spellings agree with EACH
    // OTHER — it is a wiring lock, not a copy freeze, and freezing "you cook
    // the back half" forever was never its intent.
    ['threshold', 'Run the band, not the cutoff. Drift early and the last reps pay for it.'],
    ['intervals', 'Even effort across the reps. Rep one sets the ceiling.'],
  ];

  it('guided band is byte-identical to the pre-band default (absent · null · guided)', () => {
    for (const [type, locked] of lockedGuidedDefaults) {
      expect(composeCue(base(type)), `${type} · absent`).toBe(locked);
      expect(composeCue({ ...base(type), voiceBand: null }), `${type} · null`).toBe(locked);
      expect(composeCue({ ...base(type), voiceBand: 'guided' }), `${type} · guided`).toBe(locked);
    }
  });

  it('calibration and challenge differ from guided, from each other, and stay single-cue shaped', () => {
    for (const [type] of lockedGuidedDefaults) {
      const guided = composeCue({ ...base(type), voiceBand: 'guided' });
      const cal = composeCue({ ...base(type), voiceBand: 'calibration' });
      const cha = composeCue({ ...base(type), voiceBand: 'challenge' });
      expect(cal, `${type} · calibration`).not.toBe(guided);
      expect(cha, `${type} · challenge`).not.toBe(guided);
      expect(cal).not.toBe(cha);
      // Voice doctrine · no em dashes, no exclamation, no emoji.
      for (const cue of [cal, cha]) {
        expect(cue).not.toMatch(/—|!/);
        expect(typeof cue).toBe('string');
      }
    }
  });

  it('contextual cues (hard-yesterday, heat, pillar streak) are band-independent', () => {
    const hard: CueInput = { ...base('easy'), recentHardSession: true };
    expect(composeCue({ ...hard, voiceBand: 'calibration' })).toBe(composeCue(hard));
    expect(composeCue({ ...hard, voiceBand: 'challenge' })).toBe(composeCue(hard));

    const hot: CueInput = { ...base('threshold'), heatSlowdownPct: 6 };
    expect(composeCue({ ...hot, voiceBand: 'calibration' })).toBe(composeCue(hot));
    expect(composeCue({ ...hot, voiceBand: 'challenge' })).toBe(composeCue(hot));
  });
});

describe('deriveRecap · voice-band tone branches', () => {
  // Easy run · a touch quicker than target (delta < -25) · the branched fact.
  const quickEasy: RecapInput = {
    type: 'easy',
    phase: 'BASE',
    plannedMi: 6,
    plannedPaceSPerMi: 9 * 60,       // 9:00 target
    plannedHrCap: null,
    actualMi: 6.0,
    actualPaceSPerMi: 8 * 60 + 20,   // 8:20 · 40s quick
    actualAvgHr: null,
    actualMaxHr: null,
  };

  // Threshold run · significantly short of target (>18 s/mi off) with
  // work splits so tempoExecution reaches the branched line.
  const shortThreshold: RecapInput = {
    type: 'threshold',
    phase: 'BUILD',
    plannedMi: 6,
    plannedPaceSPerMi: 7 * 60,       // 7:00 target
    plannedHrCap: null,
    actualMi: 6,
    actualPaceSPerMi: 7 * 60 + 30,
    workPaceSPerMi: 7 * 60 + 25,     // 25s off → "significantly short" branch
    actualAvgHr: 168,
    actualMaxHr: 176,
    splits: [
      { mile: 1, paceSPerMi: 7 * 60 + 24, avgHr: 165 },
      { mile: 2, paceSPerMi: 7 * 60 + 26, avgHr: 168 },
      { mile: 3, paceSPerMi: 7 * 60 + 25, avgHr: 170 },
    ],
  };

  it('guided band recap is byte-identical to the pre-band default (absent · null · guided)', () => {
    for (const input of [quickEasy, shortThreshold]) {
      const absent = deriveRecap(input);
      const nulled = deriveRecap({ ...input, voiceBand: null });
      const guided = deriveRecap({ ...input, voiceBand: 'guided' });
      expect(nulled).toEqual(absent);
      expect(guided).toEqual(absent);
    }
  });

  it('calibration softens and challenge tersens the easy quick-day fact · structure unchanged', () => {
    const guided = deriveRecap({ ...quickEasy, voiceBand: 'guided' });
    const cal = deriveRecap({ ...quickEasy, voiceBand: 'calibration' });
    const cha = deriveRecap({ ...quickEasy, voiceBand: 'challenge' });
    expect(cal.verdict).toBe(guided.verdict);
    expect(cha.verdict).toBe(guided.verdict);
    expect(cal.facts.length).toBe(guided.facts.length);
    expect(cha.facts.length).toBe(guided.facts.length);
    expect(cal.facts.join(' ')).not.toBe(guided.facts.join(' '));
    expect(cha.facts.join(' ')).not.toBe(guided.facts.join(' '));
    expect(cal.facts.join(' ')).toContain('the target settles as we learn your easy');
    expect(cha.facts.join(' ')).toContain('Keep easy easy.');
  });

  it('calibration softens and challenge tersens the short-threshold read · structure unchanged', () => {
    const guided = deriveRecap({ ...shortThreshold, voiceBand: 'guided' });
    const cal = deriveRecap({ ...shortThreshold, voiceBand: 'calibration' });
    const cha = deriveRecap({ ...shortThreshold, voiceBand: 'challenge' });
    expect(guided.facts.join(' ')).toContain('HR is the honest grade here');
    expect(cal.facts.join(' ')).toContain('useful calibration, the target tunes from here');
    expect(cha.facts.join(' ')).toContain('HR is the honest grade.');
    expect(cal.verdict).toBe(guided.verdict);
    expect(cha.verdict).toBe(guided.verdict);
    expect(cal.facts.length).toBe(guided.facts.length);
    expect(cha.facts.length).toBe(guided.facts.length);
  });

  it('band copy carries no em dashes and no exclamation marks', () => {
    for (const band of ['calibration', 'challenge'] as const) {
      for (const input of [quickEasy, shortThreshold]) {
        const r = deriveRecap({ ...input, voiceBand: band });
        const text = r.verdict + ' ' + r.facts.join(' ');
        expect(text).not.toMatch(/—|!/);
      }
    }
  });
});
