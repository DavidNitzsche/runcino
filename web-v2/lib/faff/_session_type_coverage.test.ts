/**
 * lib/faff/_session_type_coverage.test.ts — EVERY session type the engine can
 * author is named on both switches, and none of them falls through to "easy".
 *
 * This is the third time a `plan_workouts.type` value has fallen through
 * `dayStateWordFor` / `displayTypeFor` to the default. The first two
 * (`strength`, `cross`) are documented in v5-today.ts's own comments. The two
 * this file exists for:
 *
 *   · `shakeout` — 48 production rows, and the type authored for THE DAY
 *     BEFORE A GOAL RACE. Race eve painted the green EASY gradient under the
 *     headline "EASY". The three rows whose sub_label is
 *     `SHAKEOUT · 4×20s strides` are correctly refused as a headline by
 *     `subLabelIsName` (prescription syntax), so the word "shakeout" appeared
 *     nowhere on the screen. Those rows are dated 2026-11-12 … 2026-11-28 —
 *     CIM race prep.
 *
 *   · `interval`, SINGULAR — 214 production rows, EVERY ONE with a NULL
 *     sub_label, so not one of them had a name to fall back on. Two hundred
 *     and fourteen rep sessions rendered as green easy days headlined "EASY".
 *     `intervals` (plural) was handled; the singular was not; the repo already
 *     had `lib/training/workout-type.ts` mapping one to the other.
 *
 * The sweep below is the point. Asserting the two values that were caught
 * would leave the next one to be found on David's phone, which is how the
 * previous two were found.
 */
import { describe, it, expect } from 'vitest';
import { SESSION_TYPES, canonicalSessionType } from '@/lib/training/workout-type';
import { dayStateWordFor, displayTypeFor, subLabelIsName } from './v5-today';

/** Every raw spelling production actually stores in `plan_workouts.type`,
 *  with its row count as of 2026-08-30. */
const PRODUCTION_SPELLINGS: ReadonlyArray<readonly [string, number]> = [
  ['easy', 2006], ['rest', 879], ['long', 584], ['threshold', 390], ['tempo', 249],
  ['interval', 214], ['intervals', 63], ['race', 48], ['shakeout', 48],
  ['strength', 44], ['race_week_tuneup', 11],
];

describe('every authorable session type is named on both switches', () => {
  it('no SESSION_TYPES value silently defaults to easy', () => {
    // `easy` itself is excluded — it is the only one entitled to that answer.
    const fellThrough = SESSION_TYPES
      .filter((t) => t !== 'easy')
      .filter((t) => dayStateWordFor(t) === 'easy' && displayTypeFor(t, null) === 'Easy');
    expect(fellThrough, `fell through to the easy default: ${fellThrough.join(', ')}`).toEqual([]);
  });

  it('every SESSION_TYPES value has a display name that is not the fallback', () => {
    for (const t of SESSION_TYPES) {
      const name = displayTypeFor(t, null);
      expect(name, t).toBeTruthy();
      if (t !== 'easy') expect(name, `${t} is displayed as the fallback`).not.toBe('Easy');
    }
  });

  it('every spelling in production canonicalises or is a known non-run day', () => {
    const NON_RUN = new Set(['strength', 'cross', 'xt', 'mobility']);
    for (const [raw, rows] of PRODUCTION_SPELLINGS) {
      if (NON_RUN.has(raw)) {
        expect(dayStateWordFor(raw), raw).toBe('rest');
        expect(displayTypeFor(raw, null), raw).toBe('Rest');
        continue;
      }
      expect(canonicalSessionType(raw), `${raw} (${rows} rows) is unrecognised`).not.toBeNull();
    }
  });
});

describe('race eve is not a green easy day', () => {
  it('shakeout belongs to the race gradient, like race_week_tuneup already did', () => {
    expect(dayStateWordFor('shakeout')).toBe('race');
    expect(dayStateWordFor('shakeout')).not.toBe('easy');
  });

  it('the day before CIM is headlined "Shakeout", with its real prod sub_label', () => {
    // The exact stored value on the three race-prep rows.
    const sub = 'SHAKEOUT · 4×20s strides';
    // Still correctly refused as a HEADLINE — it is a prescription, not a name.
    expect(subLabelIsName(sub)).toBe(false);
    // ...and the type column now answers, where it used to say "Easy".
    expect(displayTypeFor('shakeout', sub)).toBe('Shakeout');
  });

  it('covers the other two stored shakeout sub_label shapes too', () => {
    expect(displayTypeFor('shakeout', null)).toBe('Shakeout');       // 27 rows
    expect(displayTypeFor('shakeout', 'SHAKEOUT')).toBe('Shakeout'); // 18 rows
  });
});

describe('the singular interval spelling is a rep session, not a jog', () => {
  it('214 production rows stop rendering as green easy days', () => {
    expect(dayStateWordFor('interval')).toBe('quality');
    expect(dayStateWordFor('interval')).toBe(dayStateWordFor('intervals'));
  });

  it('and stop being headlined "Easy" with no sub_label to save them', () => {
    expect(displayTypeFor('interval', null)).toBe('Intervals');
    expect(displayTypeFor('interval', null)).toBe(displayTypeFor('intervals', null));
  });
});

describe('behaviour preserved for everything that already worked', () => {
  it.each([
    ['long', 'long', 'Long'],
    ['race', 'race', 'Race'],
    ['race_week_tuneup', 'race', 'Tune-up'],
    ['threshold', 'quality', 'Threshold'],
    ['tempo', 'quality', 'Tempo'],
    ['intervals', 'quality', 'Intervals'],
    ['fartlek', 'quality', 'Fartlek'],
    ['progression', 'quality', 'Progression'],
    ['quality', 'quality', 'Quality'],
    ['recovery', 'easy', 'Recovery'],
    ['easy', 'easy', 'Easy'],
    ['rest', 'rest', 'Rest'],
    ['unplanned', 'rest', 'Rest'],
    ['', 'rest', 'Rest'],
    ['strength', 'rest', 'Rest'],
    ['cross', 'rest', 'Rest'],
    ['vo2max', 'quality', 'VO2 max'],
  ])('%s → %s / %s', (raw, state, display) => {
    expect(dayStateWordFor(raw)).toBe(state);
    expect(displayTypeFor(raw, null)).toBe(display);
  });

  it('an unrecognised non-empty string still reads as a run day', () => {
    expect(dayStateWordFor('hill_sprints_v2')).toBe('easy');
    expect(displayTypeFor('hill_sprints_v2', null)).toBe('Easy');
  });

  it('a sub_label that IS a name still wins the headline', () => {
    expect(displayTypeFor('threshold', 'FIELD TEST')).toBe('Field test');
  });
});
