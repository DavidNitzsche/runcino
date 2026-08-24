/**
 * lib/faff/_display_type_name.test.ts — the 56pt headline holds a NAME.
 *
 * `V5Panel.type` is drawn by the phone at 56pt Archivo with `lineLimit(1)` and
 * `minimumScaleFactor(0.5)` (native-v2 FontsV5.swift:447). Anything longer than
 * the line shrinks to 28pt and then TRUNCATES.
 *
 * `displayTypeFor` preferred `sub_label` unconditionally, and `sub_label` is
 * written by two different kinds of author: some rows carry a name, and some
 * carry the whole prescription derived by `subLabelFromSpec`. On a threshold
 * day the headline rendered
 *
 *     3×1MI @ T PACE · 6…
 *
 * — engine shorthand, in the display register, losing the recovery spec
 * mid-number. Verified on the simulator against screen 5a before the fix.
 *
 * This is the same defect class `_sublabel_voice.test.ts` was written for
 * (`EASY (MEDIUM)`), but that test only scans generator source for parentheses
 * and doubled type words, so every prescription-shaped label walked past it.
 * This one tests the display function itself, on the strings the generator
 * actually writes.
 */
import { describe, it, expect } from 'vitest';
import { displayTypeFor, subLabelIsName } from './v5-today';

/** Real `sub_label` values, taken from lib/plan/generate.ts and from
 *  `subLabelFromSpec`'s own documented output in lib/training/expand-spec.ts. */
const PRESCRIPTIONS = [
  '2 mi WU · 4 mi @ T · 2 mi CD',
  '2 mi WU · 5 mi @ T · 3 mi CD',
  '2.5 mi WU · 11 mi @ MP · 1.5 mi CD',
  '3×1mi @ T pace · 60s jog',
  '3×13 min @ T pace · 60s jog',
  '5×400m @ 5K pace · 90s jog',
  '10×100m @ mile race pace',
  '8×200m @ R pace',
  '2×90s @ 5K · 90s jog + 4×30s · 30s jog',
  'LONG · 4mi @ MP',
  'LONG · 8mi @ HM',
  'EASY · 40 MIN',
  'EASY · 6×20s strides',
  'SHAKEOUT · 4×20s strides',
  '4 mi continuous tempo',
];

/** Real `sub_label` values that ARE names and must survive. */
const NAMES: Array<[string, string]> = [
  ['THRESHOLD', 'Threshold'],
  ['INTERVALS', 'Intervals'],
  ['FIELD TEST', 'Field test'],
  ['MEDIUM-LONG', 'Medium-long'],
  ['CRUISE INTERVALS', 'Cruise intervals'],
  ['SHAKEOUT', 'Shakeout'],
  ['OFF-DAY', 'Off-day'],
  ['EASY', 'Easy'],
  ['LONG', 'Long'],
  ['RACE', 'Race'],
];

describe('displayTypeFor · the display register holds a name', () => {
  it('never returns a prescription as the headline', () => {
    const offenders: string[] = [];
    for (const p of PRESCRIPTIONS) {
      const out = displayTypeFor('threshold', p);
      if (out === p) offenders.push(p);
    }
    expect(offenders).toEqual([]);
  });

  it('falls back to the session type word when sub_label is a prescription', () => {
    expect(displayTypeFor('threshold', '3×1mi @ T pace · 60s jog')).toBe('Threshold');
    expect(displayTypeFor('tempo', '2 mi WU · 4 mi @ T · 2 mi CD')).toBe('Tempo');
    expect(displayTypeFor('long', 'LONG · 4mi @ MP')).toBe('Long');
    expect(displayTypeFor('easy', 'EASY · 40 MIN')).toBe('Easy');
    expect(displayTypeFor('intervals', '5×400m @ 5K pace · 90s jog')).toBe('Intervals');
  });

  it('keeps every headline inside the one-line display budget', () => {
    // 16 characters. Longer than this truncates at 56pt rather than wrapping,
    // because the display register is lineLimit(1) by design.
    const all = [...PRESCRIPTIONS, ...NAMES.map(([raw]) => raw)];
    for (const raw of all) {
      for (const t of ['easy', 'long', 'threshold', 'tempo', 'intervals', 'race', 'rest']) {
        expect(displayTypeFor(t, raw).length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('never emits prescription syntax in the headline', () => {
    const BAD = /[@×]|\bWU\b|\bCD\b|·/;
    for (const raw of [...PRESCRIPTIONS, ...NAMES.map(([r]) => r)]) {
      expect(displayTypeFor('threshold', raw)).not.toMatch(BAD);
    }
  });

  it('still prefers a sub_label that is a real name', () => {
    for (const [raw, want] of NAMES) {
      expect(displayTypeFor('threshold', raw)).toBe(want);
    }
  });

  it('does not flatten a label already written as copy', () => {
    // Only an ENTIRELY uppercase string is an enum being de-shouted.
    expect(displayTypeFor('threshold', 'Cruise Intervals')).toBe('Cruise Intervals');
  });

  it('rejects a bare pace-zone letter as a name', () => {
    // "T" / "I" / "M" / "R" are Daniels zone shorthand, not session names.
    for (const letter of ['T', 'I', 'M', 'R']) {
      expect(subLabelIsName(letter)).toBe(false);
      expect(displayTypeFor('threshold', letter)).toBe('Threshold');
    }
  });

  it('names quality variants distinctly rather than collapsing to "Quality"', () => {
    // dayStateWordFor collapses these to one gradient bucket. The headline
    // does not have to: the runner should be told which session it is.
    expect(displayTypeFor('threshold', null)).toBe('Threshold');
    expect(displayTypeFor('intervals', null)).toBe('Intervals');
    expect(displayTypeFor('tempo', null)).toBe('Tempo');
    expect(displayTypeFor('fartlek', null)).toBe('Fartlek');
    expect(displayTypeFor('progression', null)).toBe('Progression');
  });

  it('still answers Rest for a rest day', () => {
    expect(displayTypeFor('rest', null)).toBe('Rest');
    expect(displayTypeFor('rest', 'REST')).toBe('Rest');
    expect(displayTypeFor(null, null)).toBe('Rest');
  });
});
